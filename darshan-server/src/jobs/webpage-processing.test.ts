import { randomUUID } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  getWebpageProcessingStage,
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

    await processWebpageVerifyCaptureJob(
      { mediaId, sourceUrl: 'https://example.com/dashboard?token=secret' },
      { db, verifySource, putObject, upsertStorageObject, logger, now: () => updatedAt }
    );

    expect(verifySource).toHaveBeenCalledWith('https://example.com/dashboard?token=secret');
    expect(putObject).toHaveBeenCalledWith(
      'media-ready',
      `${mediaId}/webpage-fallback.png`,
      screenshot,
      'image/png'
    );
    expect(upsertStorageObject).toHaveBeenCalledWith({
      bucket: 'media-ready',
      objectKey: `${mediaId}/webpage-fallback.png`,
      contentType: 'image/png',
      size: screenshot.length,
      sha256: 'a'.repeat(64),
    });
    expect(updates).toContainEqual({
      source_url: 'https://example.com/',
      ready_object_id: 'ready-object-id',
      status: 'READY',
      status_reason: null,
      updated_at: updatedAt,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses the same fallback object key on retry so processing is idempotent', async () => {
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

    await processWebpageVerifyCaptureJob(job, { db, verifySource, putObject, upsertStorageObject, logger });
    await processWebpageVerifyCaptureJob(job, { db, verifySource, putObject, upsertStorageObject, logger });

    expect(putObject.mock.calls.map((call) => call[1])).toEqual([
      `${mediaId}/webpage-fallback.png`,
      `${mediaId}/webpage-fallback.png`,
    ]);
    expect(upsertStorageObject).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
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
