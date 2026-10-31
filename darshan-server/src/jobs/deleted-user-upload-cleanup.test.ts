import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';

const { abortMultipartUploadMock, deleteObjectMock } = vi.hoisted(() => ({
  abortMultipartUploadMock: vi.fn(),
  deleteObjectMock: vi.fn(),
}));

vi.mock('@/s3', async () => {
  const actual = await vi.importActual<typeof import('@/s3')>('@/s3');
  return {
    ...actual,
    abortMultipartUpload: abortMultipartUploadMock,
    deleteObject: deleteObjectMock,
  };
});

const { cleanupDeletedUserUploads, cleanupOrphanedStorageObjects } = await import('@/jobs');

describe('deleted-user upload cleanup retries', () => {
  let creatorId: string;

  beforeAll(async () => {
    await initializeDatabase();
    const db = getDatabase();
    const roleId = randomUUID();
    creatorId = randomUUID();
    await db.insert(schema.roles).values({
      id: roleId,
      name: `DELETED_UPLOAD_CLEANUP_${roleId}`,
      permissions: { grants: [] },
      is_system: false,
    });
    await db.insert(schema.users).values({
      id: creatorId,
      email: `deleted-upload-cleanup-${creatorId}@example.test`,
      password_hash: 'test-only-invalid-hash',
      role_id: roleId,
      is_active: false,
      deleted_at: new Date(),
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    abortMultipartUploadMock.mockReset();
    deleteObjectMock.mockReset();
    abortMultipartUploadMock.mockResolvedValue(undefined);
    deleteObjectMock.mockResolvedValue(undefined);
  });

  it('retries incomplete upload cleanup while retaining accepted legacy media', async () => {
    const db = getDatabase();
    const baseTime = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const retryTime = new Date(baseTime.getTime() + 3 * 60 * 60 * 1000);
    const terminalTime = new Date(retryTime.getTime() + 6 * 60 * 60 * 1000);
    const uploadMediaId = randomUUID();
    const legacyMediaId = randomUUID();
    const uploadSessionId = randomUUID();
    const sourceStorageId = randomUUID();
    const readyStorageId = randomUUID();
    const thumbnailStorageId = randomUUID();

    await db.insert(schema.storageObjects).values([
      {
        id: sourceStorageId,
        bucket: 'media-source',
        object_key: `legacy/${legacyMediaId}.png`,
      },
      {
        id: readyStorageId,
        bucket: 'media-ready',
        object_key: `${legacyMediaId}/partial-ready.png`,
      },
      {
        id: thumbnailStorageId,
        bucket: 'media-thumbnails',
        object_key: `${legacyMediaId}/thumbnail.jpg`,
      },
    ]);

    await db.insert(schema.media).values([
      {
        id: uploadMediaId,
        name: 'Deleted multipart upload',
        type: 'VIDEO',
        status: 'FAILED',
        status_reason: 'USER_DELETED_CLEANUP_PENDING',
        source_bucket: 'media-source',
        source_object_key: `source/${uploadMediaId}.mp4`,
        created_by: creatorId,
        updated_at: baseTime,
      },
      {
        id: legacyMediaId,
        name: 'Deleted legacy upload',
        type: 'IMAGE',
        status: 'FAILED',
        status_reason: 'USER_DELETED_CLEANUP_PENDING',
        source_object_id: sourceStorageId,
        source_bucket: 'media-source',
        source_object_key: `legacy/${legacyMediaId}.png`,
        ready_object_id: readyStorageId,
        thumbnail_object_id: thumbnailStorageId,
        created_by: creatorId,
        updated_at: baseTime,
      },
    ]);
    await db.insert(schema.mediaUploadSessions).values({
      id: uploadSessionId,
      media_id: uploadMediaId,
      created_by: creatorId,
      idempotency_key: `cleanup-${uploadSessionId}`,
      state: 'ABORTED',
      strategy: 'multipart',
      original_filename: 'deleted.mp4',
      display_name: 'Deleted multipart upload',
      content_type: 'video/mp4',
      expected_size: 1024,
      checksum_sha256: 'a'.repeat(64),
      part_size: 1024,
      staging_bucket: 'media-staging',
      staging_object_key: `staging/${uploadSessionId}.mp4`,
      canonical_bucket: 'media-source',
      canonical_object_key: `source/${uploadMediaId}.mp4`,
      multipart_upload_id: `multipart-${uploadSessionId}`,
      expires_at: baseTime,
      aborted_at: baseTime,
      failure_reason: 'USER_DELETED_CLEANUP_PENDING',
      updated_at: baseTime,
    });

    deleteObjectMock.mockRejectedValue(new Error('synthetic object-store outage'));
    const failed = await cleanupDeletedUserUploads({ now: () => retryTime });
    expect(failed.upload_sessions_pending).toBeGreaterThanOrEqual(1);
    expect(failed.legacy_media_pending).toBe(0);

    const [pendingSession] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, uploadSessionId));
    expect(pendingSession.failure_reason).toBe('USER_DELETED_CLEANUP_PENDING');
    const pendingMedia = await db
      .select()
      .from(schema.media)
      .where(inArray(schema.media.id, [uploadMediaId, legacyMediaId]));
    expect(pendingMedia.map((media) => media.status_reason)).toEqual([
      'USER_DELETED_CLEANUP_PENDING',
      'USER_DELETED_CLEANUP_PENDING',
    ]);

    deleteObjectMock.mockReset();
    deleteObjectMock.mockResolvedValue(undefined);
    const recovered = await cleanupDeletedUserUploads({ now: () => retryTime });
    expect(recovered.upload_sessions_cleaned).toBeGreaterThanOrEqual(1);
    expect(recovered.upload_sessions_pending).toBe(0);
    expect(abortMultipartUploadMock).toHaveBeenCalledWith(
      'media-staging',
      `staging/${uploadSessionId}.mp4`,
      `multipart-${uploadSessionId}`
    );
    expect(deleteObjectMock).not.toHaveBeenCalledWith('media-source', `legacy/${legacyMediaId}.png`);
    expect(deleteObjectMock).not.toHaveBeenCalledWith('media-ready', `${legacyMediaId}/partial-ready.png`);
    expect(deleteObjectMock).not.toHaveBeenCalledWith('media-thumbnails', `${legacyMediaId}/thumbnail.jpg`);

    const [recoveredSession] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, uploadSessionId));
    expect(recoveredSession.failure_reason).toBe('USER_DELETED_UPLOAD_ABORTED_FINAL');
    const [recoveredUploadMedia, recoveredLegacyMedia] = await Promise.all([
      db.select().from(schema.media).where(eq(schema.media.id, uploadMediaId)).then((rows) => rows[0]),
      db.select().from(schema.media).where(eq(schema.media.id, legacyMediaId)).then((rows) => rows[0]),
    ]);
    expect(recoveredUploadMedia).toMatchObject({
      status: 'FAILED',
      status_reason: 'USER_DELETED_UPLOAD_ABORTED',
    });
    expect(recoveredLegacyMedia).toMatchObject({
      status: 'FAILED',
      status_reason: 'USER_DELETED_CLEANUP_PENDING',
      source_object_id: sourceStorageId,
      source_bucket: 'media-source',
      source_object_key: `legacy/${legacyMediaId}.png`,
      ready_object_id: readyStorageId,
      thumbnail_object_id: thumbnailStorageId,
    });

    await cleanupDeletedUserUploads({ now: () => terminalTime, limit: 1_000 });
    const [terminalUploadMedia] = await db
      .select()
      .from(schema.media)
      .where(eq(schema.media.id, uploadMediaId));
    expect(terminalUploadMedia).toMatchObject({
      status: 'FAILED',
      status_reason: 'USER_DELETED_UPLOAD_ABORTED',
    });

    // Other integration cases can leave newly aborted uploads in the shared
    // test database. Advance through their two-hour terminal-cleanup window
    // before asserting that another run is globally idempotent.
    const convergenceTime = new Date(terminalTime.getTime() + 3 * 60 * 60 * 1000);
    await cleanupDeletedUserUploads({ now: () => convergenceTime, limit: 1_000 });
    deleteObjectMock.mockClear();
    abortMultipartUploadMock.mockClear();
    const idempotent = await cleanupDeletedUserUploads({ now: () => convergenceTime, limit: 1_000 });
    expect(idempotent).toEqual({
      upload_sessions_cleaned: 0,
      upload_sessions_pending: 0,
      legacy_media_cleaned: 0,
      legacy_media_pending: 0,
    });
    expect(deleteObjectMock).not.toHaveBeenCalled();
    expect(abortMultipartUploadMock).not.toHaveBeenCalled();
  });

  it('retains failed orphan cleanup for the next hourly retry', async () => {
    const db = getDatabase();
    const storageObjectId = randomUUID();
    const objectKey = `orphan-retry/${storageObjectId}.bin`;
    await db.insert(schema.storageObjects).values({
      id: storageObjectId,
      bucket: 'media-source',
      object_key: objectKey,
      content_type: 'application/octet-stream',
      size: 128,
      created_at: new Date('2000-01-01T00:00:00.000Z'),
    });

    deleteObjectMock.mockRejectedValueOnce(new Error('synthetic orphan cleanup outage'));
    expect(
      await cleanupOrphanedStorageObjects({ storageObjectIds: [storageObjectId] })
    ).toEqual({ cleaned: 0, pending: 1 });
    const [pending] = await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, storageObjectId));
    expect(pending?.id).toBe(storageObjectId);

    deleteObjectMock.mockResolvedValue(undefined);
    expect(
      await cleanupOrphanedStorageObjects({ storageObjectIds: [storageObjectId] })
    ).toEqual({ cleaned: 1, pending: 0 });
    const [cleaned] = await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.id, storageObjectId));
    expect(cleaned).toBeUndefined();

    deleteObjectMock.mockClear();
    expect(
      await cleanupOrphanedStorageObjects({ storageObjectIds: [storageObjectId] })
    ).toEqual({ cleaned: 0, pending: 0 });
    expect(deleteObjectMock).not.toHaveBeenCalled();

    const freshStorageObjectId = randomUUID();
    const freshNow = new Date('2026-10-16T18:00:00.000Z');
    const futureCreationTime = new Date('2099-01-01T00:00:00.000Z');
    await db.insert(schema.storageObjects).values({
      id: freshStorageObjectId,
      bucket: 'media-source',
      object_key: `orphan-retry/${freshStorageObjectId}.bin`,
      created_at: futureCreationTime,
    });
    expect(
      await cleanupOrphanedStorageObjects({
        storageObjectIds: [freshStorageObjectId],
        now: () => freshNow,
      })
    ).toEqual({ cleaned: 0, pending: 0 });
    expect(deleteObjectMock).not.toHaveBeenCalled();
    await db.delete(schema.storageObjects).where(eq(schema.storageObjects.id, freshStorageObjectId));
  });
});
