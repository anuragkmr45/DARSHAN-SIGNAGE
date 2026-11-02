import { createHash, randomUUID } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  getWebpageProcessingStage,
  processWebpageRefreshDueJob,
  processWebpageVerifyCaptureJob,
  serializeWebpageProcessingError,
  WebpageProcessingStageError,
  type WebpageVerifyCaptureJob,
} from '@/jobs';

function createDb(media: { id: string; status: string; ready_object_id?: string | null } | null) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (media ? [media] : [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ id: media?.id }]),
          })),
        };
      }),
    })),
  };

  return { db: db as any, updates };
}

describe('webpage media processing job', () => {
  it('queues every due webpage in the bounded automatic refresh batch', async () => {
    const due = [{ id: randomUUID() }, { id: randomUUID() }];
    const limit = vi.fn(async () => due);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
    } as any;
    const now = new Date('2026-10-17T00:00:00.000Z');
    const requestRefresh = vi.fn()
      .mockResolvedValueOnce({ mediaId: due[0].id, refreshStatus: 'QUEUED', requestedAt: now, refreshToken: randomUUID() })
      .mockResolvedValueOnce({ mediaId: due[1].id, refreshStatus: 'ALREADY_QUEUED', requestedAt: now, refreshToken: randomUUID() });

    const result = await processWebpageRefreshDueJob({}, { db, now: () => now, requestRefresh });

    expect(limit).toHaveBeenCalledTimes(1);
    expect(requestRefresh).toHaveBeenCalledTimes(2);
    expect(requestRefresh).toHaveBeenNthCalledWith(1, { mediaId: due[0].id, executor: db, requestedAt: now });
    expect(requestRefresh).toHaveBeenNthCalledWith(2, { mediaId: due[1].id, executor: db, requestedAt: now });
    expect(result).toEqual({ due: 2, queued: 1 });
  });

  it('captures, uploads, upserts, and marks webpage media READY', async () => {
    const mediaId = randomUUID();
    const screenshot = Buffer.from('png-preview');
    const { db, updates } = createDb({ id: mediaId, status: 'PROCESSING' });
    const verifySource = vi.fn().mockResolvedValue({
      finalUrl: 'https://example.com/',
      contentType: 'text/html; charset=utf-8',
      title: 'Example Domain',
      screenshot,
    });
    const putObject = vi.fn().mockResolvedValue({ sha256: 'a'.repeat(64), etag: '"etag"' });
    const upsertStorageObject = vi.fn().mockResolvedValue({ id: 'ready-object-id' });
    const logger = { warn: vi.fn(), error: vi.fn() };
    const updatedAt = new Date('2026-10-03T00:00:00.000Z');
    const previewKey = `${mediaId}/webpage-previews/${createHash('sha256').update(screenshot).digest('hex')}.png`;

    await processWebpageVerifyCaptureJob(
      { mediaId, sourceUrl: 'https://example.com/dashboard?token=secret' },
      { db, verifySource, putObject, upsertStorageObject, logger, now: () => updatedAt }
    );

    expect(verifySource).toHaveBeenCalledWith('https://example.com/dashboard?token=secret');
    expect(putObject).toHaveBeenCalledWith(
      'media-ready',
      previewKey,
      screenshot,
      'image/png'
    );
    expect(upsertStorageObject).toHaveBeenCalledWith({
      bucket: 'media-ready',
      objectKey: previewKey,
      contentType: 'image/png',
      size: screenshot.length,
      sha256: 'a'.repeat(64),
    });
    expect(updates).toContainEqual({
      webpage_preview_captured_at: updatedAt,
      webpage_preview_attempted_at: updatedAt,
      webpage_preview_refresh_token: null,
      webpage_preview_last_error: null,
      ready_object_id: 'ready-object-id',
      status: 'READY',
      status_reason: null,
      updated_at: updatedAt,
    });
    expect(updates).not.toContainEqual(expect.objectContaining({ source_url: expect.anything() }));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses the same content-addressed object key on retry so processing is idempotent', async () => {
    const mediaId = randomUUID();
    const { db } = createDb({ id: mediaId, status: 'PROCESSING' });
    const verifySource = vi.fn().mockResolvedValue({
      finalUrl: 'https://example.com/',
      contentType: 'text/html',
      title: 'Example Domain',
      screenshot: Buffer.from('retry-preview'),
    });
    const putObject = vi.fn().mockResolvedValue({ sha256: 'b'.repeat(64), etag: '"etag"' });
    const upsertStorageObject = vi.fn().mockResolvedValue({ id: 'same-ready-object-id' });
    const logger = { warn: vi.fn(), error: vi.fn() };
    const job: WebpageVerifyCaptureJob = { mediaId, sourceUrl: 'https://example.com/' };
    const expectedKey = `${mediaId}/webpage-previews/${createHash('sha256').update('retry-preview').digest('hex')}.png`;

    await processWebpageVerifyCaptureJob(job, { db, verifySource, putObject, upsertStorageObject, logger });
    await processWebpageVerifyCaptureJob(job, { db, verifySource, putObject, upsertStorageObject, logger });

    expect(putObject.mock.calls.map((call) => call[1])).toEqual([
      expectedKey,
      expectedKey,
    ]);
    expect(upsertStorageObject).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps a READY webpage and its existing preview when a refresh fails', async () => {
    const mediaId = randomUUID();
    const refreshToken = randomUUID();
    const attemptedAt = new Date('2026-10-03T01:00:00.000Z');
    const { db, updates } = createDb({
      id: mediaId,
      status: 'READY',
      ready_object_id: 'last-good-object',
      webpage_preview_refresh_token: refreshToken,
    } as any);

    await processWebpageVerifyCaptureJob(
      {
        mediaId,
        sourceUrl: 'https://example.com/',
        mode: 'REFRESH',
        refreshToken,
      },
      {
        db,
        verifySource: vi.fn().mockRejectedValue(new Error('navigation timeout')),
        logger: { warn: vi.fn(), error: vi.fn() },
        now: () => attemptedAt,
      }
    );

    expect(updates).toContainEqual({
      webpage_preview_refresh_token: null,
      webpage_preview_last_error: 'WEBPAGE_REQUEST_TIMEOUT',
      webpage_preview_attempted_at: attemptedAt,
    });
    expect(updates).not.toContainEqual(expect.objectContaining({ status: 'FAILED' }));
    expect(updates).not.toContainEqual(expect.objectContaining({ ready_object_id: expect.anything() }));
  });

  it('keeps the entry URL after a refresh redirects to a cookie-gated page', async () => {
    const mediaId = randomUUID();
    const refreshToken = randomUUID();
    const { db, updates } = createDb({
      id: mediaId,
      status: 'READY',
      ready_object_id: 'previous-preview',
      webpage_preview_refresh_token: refreshToken,
      source_url: 'https://example.com/cookie-gate',
      created_by: randomUUID(),
    } as any);

    await processWebpageVerifyCaptureJob(
      { mediaId, sourceUrl: 'https://example.com/cookie-gate', mode: 'REFRESH', refreshToken },
      {
        db,
        verifySource: vi.fn().mockResolvedValue({
          finalUrl: 'https://example.com/cookie-content',
          contentType: 'text/html',
          title: 'Cookie content',
          screenshot: Buffer.from('cookie-preview'),
        }),
        putObject: vi.fn().mockResolvedValue({ sha256: 'a'.repeat(64), etag: 'etag' }),
        upsertStorageObject: vi.fn().mockResolvedValue({ id: 'new-preview' }),
        logger: { warn: vi.fn(), error: vi.fn() },
      }
    );

    expect(updates).toContainEqual(expect.objectContaining({ ready_object_id: 'new-preview' }));
    expect(updates).not.toContainEqual(expect.objectContaining({ source_url: expect.anything() }));
  });

  it('discards a newly produced preview when deletion wins the refresh commit race', async () => {
    const mediaId = randomUUID();
    const refreshToken = randomUUID();
    const screenshot = Buffer.from('stale-preview');
    const media = {
      id: mediaId,
      status: 'READY',
      ready_object_id: 'retained-ready-object',
      webpage_preview_refresh_token: refreshToken,
      created_by: randomUUID(),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [media]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        })),
      })),
    } as any;
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const previewKey = `${mediaId}/webpage-previews/${createHash('sha256').update(screenshot).digest('hex')}.png`;

    await processWebpageVerifyCaptureJob(
      {
        mediaId,
        sourceUrl: 'https://example.com/',
        mode: 'REFRESH',
        refreshToken,
      },
      {
        db,
        verifySource: vi.fn().mockResolvedValue({
          finalUrl: 'https://example.com/',
          contentType: 'text/html',
          title: 'Example Domain',
          screenshot,
        }),
        putObject: vi.fn().mockResolvedValue({ sha256: 'c'.repeat(64), etag: 'etag' }),
        upsertStorageObject: vi.fn().mockResolvedValue({ id: 'new-stale-ready-object' }),
        deleteObject,
        logger: { warn: vi.fn(), error: vi.fn() },
      }
    );

    expect(deleteObject).toHaveBeenCalledWith('media-ready', previewKey);
  });

  it('does not delete the object committed by a duplicate refresh winner', async () => {
    const mediaId = randomUUID();
    const refreshToken = randomUUID();
    const screenshot = Buffer.from('duplicate-preview');
    const oldMedia = {
      id: mediaId,
      status: 'READY',
      ready_object_id: 'old-ready-object',
      webpage_preview_refresh_token: refreshToken,
      created_by: randomUUID(),
    };
    const selectResults = [
      [oldMedia],
      [{ readyObjectId: 'winner-ready-object' }],
    ];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        })),
      })),
    } as any;
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    await processWebpageVerifyCaptureJob(
      {
        mediaId,
        sourceUrl: 'https://example.com/',
        mode: 'REFRESH',
        refreshToken,
      },
      {
        db,
        verifySource: vi.fn().mockResolvedValue({
          finalUrl: 'https://example.com/',
          contentType: 'text/html',
          title: 'Example Domain',
          screenshot,
        }),
        putObject: vi.fn().mockResolvedValue({ sha256: 'd'.repeat(64), etag: 'etag' }),
        upsertStorageObject: vi.fn().mockResolvedValue({ id: 'winner-ready-object' }),
        deleteObject,
        logger: { warn: vi.fn(), error: vi.fn() },
      }
    );

    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('logs structured stage errors and stores a mapped failure reason', async () => {
    const mediaId = randomUUID();
    const { db, updates } = createDb({ id: mediaId, status: 'PROCESSING' });
    const sourceUrl = 'https://example.com/dashboard?token=secret';
    const putFailure = Object.assign(new Error(`put failed for ${sourceUrl}`), { code: 'ECONNRESET' });
    const verifySource = vi.fn().mockResolvedValue({
      finalUrl: 'https://example.com/',
      contentType: 'text/html',
      title: 'Example Domain',
      screenshot: Buffer.from('preview'),
    });
    const logger = { warn: vi.fn(), error: vi.fn() };

    await processWebpageVerifyCaptureJob(
      { mediaId, sourceUrl },
      {
        db,
        verifySource,
        putObject: vi.fn().mockRejectedValue(putFailure),
        upsertStorageObject: vi.fn(),
        logger,
      }
    );

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [logObject] = logger.error.mock.calls[0];
    expect(logObject).toMatchObject({
      stage: 'fallback-upload',
      mediaId,
      sourceOrigin: 'https://example.com/',
      error: {
        name: 'Error',
        code: 'ECONNRESET',
      },
    });
    expect(logObject.error.message).toContain('https://example.com/');
    expect(logObject.error.message).not.toContain('token=secret');
    expect(updates.at(-1)).toMatchObject({
      status: 'FAILED',
      status_reason: 'WEBPAGE_FALLBACK_UPLOAD_FAILED',
    });
  });

  it('preserves the failing stage and redacts URLs from serialized error stacks', () => {
    const sourceUrl = 'https://example.com/path?token=secret';
    const cause = Object.assign(new Error(`failed at ${sourceUrl}`), { code: 'ETIMEDOUT' });
    const staged = new WebpageProcessingStageError('webpage-capture', cause);
    const serialized = serializeWebpageProcessingError(staged, sourceUrl);

    expect(getWebpageProcessingStage(staged)).toBe('webpage-capture');
    expect(serialized).toMatchObject({
      name: 'Error',
      code: 'ETIMEDOUT',
      message: 'failed at https://example.com/',
    });
    expect(serialized.stack).not.toContain('token=secret');
  });
});
