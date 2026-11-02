import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { hashPassword } from '@/auth/password';
import { HTTP_STATUS } from '@/http-status-codes';
import { SYSTEM_ROLE_DEFAULTS } from '@/rbac/system-roles';

const {
  createBucketIfNotExistsMock,
  createMultipartUploadMock,
  getPresignedPutUrlMock,
  getPresignedUploadPartUrlMock,
  listMultipartUploadPartsMock,
  completeMultipartUploadMock,
  abortMultipartUploadMock,
  headObjectMock,
  computeObjectSha256Mock,
  copyObjectMock,
  deleteObjectMock,
  getPresignedUrlMock,
} = vi.hoisted(() => ({
  createBucketIfNotExistsMock: vi.fn(),
  createMultipartUploadMock: vi.fn(),
  getPresignedPutUrlMock: vi.fn(),
  getPresignedUploadPartUrlMock: vi.fn(),
  listMultipartUploadPartsMock: vi.fn(),
  completeMultipartUploadMock: vi.fn(),
  abortMultipartUploadMock: vi.fn(),
  headObjectMock: vi.fn(),
  computeObjectSha256Mock: vi.fn(),
  copyObjectMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  getPresignedUrlMock: vi.fn(),
}));

vi.mock('@/s3', () => ({
  createBucketIfNotExists: createBucketIfNotExistsMock,
  createMultipartUpload: createMultipartUploadMock,
  getPresignedPutUrl: getPresignedPutUrlMock,
  getPresignedUploadPartUrl: getPresignedUploadPartUrlMock,
  listMultipartUploadParts: listMultipartUploadPartsMock,
  completeMultipartUpload: completeMultipartUploadMock,
  headObject: headObjectMock,
  computeObjectSha256: computeObjectSha256Mock,
  copyObject: copyObjectMock,
  deleteObject: deleteObjectMock,
  getPresignedUrl: getPresignedUrlMock,
  abortMultipartUpload: abortMultipartUploadMock,
}));

const { createServer } = await import('@/server');

const SHA_256 = 'a'.repeat(64);
const MULTIPART_SIZE = 100 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('Media upload sessions', () => {
  let server: FastifyInstance;
  let ownerToken: string;
  let ownerUserId: string;
  let deletionAdminToken: string;

  beforeAll(async () => {
    await initializeDatabase();
    server = await createServer();

    const db = getDatabase();
    const [existingRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, 'SUPER_ADMIN'))
      .limit(1);
    const role =
      existingRole ??
      (
        await db
          .insert(schema.roles)
          .values({ id: randomUUID(), name: 'SUPER_ADMIN', permissions: { grants: [] }, is_system: true })
          .returning()
      )[0];

    ownerUserId = randomUUID();
    const email = `media-upload-session-${Date.now()}@example.test`;
    await db.insert(schema.users).values({
      id: ownerUserId,
      email,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Upload',
      last_name: 'Owner',
      role_id: role.id,
      is_active: true,
    });

    const access = await generateAccessToken(ownerUserId, email, role.id, role.name);
    await createSessionRepository().create({
      user_id: ownerUserId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });
    ownerToken = access.token;

    const [existingAdminRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, 'ADMIN'))
      .limit(1);
    const adminRole =
      existingAdminRole ??
      (
        await db
          .insert(schema.roles)
          .values({
            id: randomUUID(),
            name: 'ADMIN',
            permissions: SYSTEM_ROLE_DEFAULTS.ADMIN,
            is_system: true,
          })
          .returning()
      )[0];
    await db
      .insert(schema.roles)
      .values({
        id: randomUUID(),
        name: 'OPERATOR',
        permissions: SYSTEM_ROLE_DEFAULTS.OPERATOR,
        is_system: true,
      })
      .onConflictDoNothing();
    const deletionAdminId = randomUUID();
    const deletionAdminEmail = `upload-deletion-admin-${deletionAdminId}@example.test`;
    await db.insert(schema.users).values({
      id: deletionAdminId,
      email: deletionAdminEmail,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Upload',
      last_name: 'Deletion Admin',
      role_id: adminRole.id,
      is_active: true,
    });
    const deletionAdminAccess = await generateAccessToken(
      deletionAdminId,
      deletionAdminEmail,
      adminRole.id,
      adminRole.name
    );
    await createSessionRepository().create({
      user_id: deletionAdminId,
      access_jti: deletionAdminAccess.jti,
      expires_at: deletionAdminAccess.expiresAt,
    });
    deletionAdminToken = deletionAdminAccess.token;
  });

  afterAll(async () => {
    await server.close();
    await closeDatabase();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createBucketIfNotExistsMock.mockResolvedValue(undefined);
    createMultipartUploadMock.mockResolvedValue({ UploadId: 'multipart-1' });
    getPresignedPutUrlMock.mockResolvedValue('https://cms.example.test/media-staging/single-upload');
    getPresignedUploadPartUrlMock.mockImplementation(async ({ partNumber }: { partNumber: number }) =>
      `https://cms.example.test/media-staging/part-${partNumber}`
    );
    listMultipartUploadPartsMock.mockResolvedValue({ Parts: [] });
    completeMultipartUploadMock.mockResolvedValue({});
    abortMultipartUploadMock.mockResolvedValue({});
    headObjectMock.mockResolvedValue({ ContentLength: MULTIPART_SIZE, ContentType: 'image/png' });
    computeObjectSha256Mock.mockResolvedValue(SHA_256);
    copyObjectMock.mockResolvedValue(undefined);
    deleteObjectMock.mockResolvedValue(undefined);
    getPresignedUrlMock.mockResolvedValue('https://cms.example.test/media-source/ready');
  });

  const createSession = async (params?: { idempotencyKey?: string; size?: number; checksum?: string }) =>
    createSessionFor(ownerToken, params);

  const createSessionFor = async (
    token: string,
    params?: { idempotencyKey?: string; size?: number; checksum?: string }
  ) =>
    await server.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': params?.idempotencyKey ?? randomUUID(),
      },
      payload: {
        filename: 'lobby.png',
        display_name: 'Lobby display',
        content_type: 'image/png',
        size: params?.size ?? 1024,
        checksum_sha256: params?.checksum ?? SHA_256,
      },
    });

  const createDeletableUploader = async () => {
    const db = getDatabase();
    const [operatorRole] = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.name, 'OPERATOR'))
      .limit(1);
    if (!operatorRole) throw new Error('OPERATOR role is required for upload deletion race tests');

    const departmentId = randomUUID();
    await db.insert(schema.departments).values({
      id: departmentId,
      name: `Upload race ${departmentId}`,
    });
    const userId = randomUUID();
    const email = `upload-race-${userId}@example.test`;
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Upload',
      last_name: 'Race Owner',
      role_id: operatorRole.id,
      department_id: departmentId,
      is_active: true,
    });
    const access = await generateAccessToken(userId, email, operatorRole.id, operatorRole.name, departmentId);
    await createSessionRepository().create({
      user_id: userId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });
    return { userId, departmentId, token: access.token, email, roleId: operatorRole.id, roleName: operatorRole.name };
  };

  const transferUploader = async (uploader: Awaited<ReturnType<typeof createDeletableUploader>>) => {
    const db = getDatabase();
    const nextDepartmentId = randomUUID();
    await db.insert(schema.departments).values({
      id: nextDepartmentId,
      name: `Upload transfer ${nextDepartmentId}`,
    });
    await db
      .update(schema.users)
      .set({ department_id: nextDepartmentId, updated_at: new Date() })
      .where(eq(schema.users.id, uploader.userId));
    const access = await generateAccessToken(
      uploader.userId,
      uploader.email,
      uploader.roleId,
      uploader.roleName,
      nextDepartmentId
    );
    await createSessionRepository().create({
      user_id: uploader.userId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });
    return { departmentId: nextDepartmentId, token: access.token };
  };

  const deleteUser = async (userId: string) =>
    server.inject({
      method: 'DELETE',
      url: `/api/v1/users/${userId}`,
      headers: { authorization: `Bearer ${deletionAdminToken}` },
    });

  it('reports the effective 500 MiB upload policy before a browser starts transferring data', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/media/upload-policy',
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(response.body)).toEqual({
      max_bytes: 500 * 1024 * 1024,
      max_mb: 500,
      multipart_threshold_bytes: MULTIPART_SIZE,
      part_size_bytes: PART_SIZE,
      multipart_concurrency: 3,
      allowed_mime_types: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'video/mp4',
        'video/quicktime',
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
    });
  });

  it('returns stable ownership and server permissions for the legacy presign-created media row', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/media/presign-upload',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        filename: 'legacy-poster.png',
        display_name: 'Legacy poster',
        content_type: 'image/png',
        size: 1024,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    expect(body.media).toMatchObject({
      id: body.media_id,
      status: 'PENDING',
      created_by: ownerUserId,
      ownership: {
        scope: 'RESTRICTED',
        department_id: null,
        creator: { id: ownerUserId, status: 'ACTIVE' },
      },
      permissions: { can_update: true, can_delete: true },
    });
  });

  it('compensates a legacy uploaded object when deletion wins before finalization commit', async () => {
    const uploader = await createDeletableUploader();
    const presigned = await server.inject({
      method: 'POST',
      url: '/api/v1/media/presign-upload',
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: {
        filename: 'legacy-race.png',
        display_name: 'Legacy race',
        content_type: 'image/png',
        size: 1024,
      },
    });
    expect(presigned.statusCode).toBe(HTTP_STATUS.OK);
    const upload = JSON.parse(presigned.body) as {
      media_id: string;
      bucket: string;
      object_key: string;
    };

    const validationEntered = deferred();
    const releaseValidation = deferred();
    headObjectMock.mockImplementationOnce(async () => {
      validationEntered.resolve();
      await releaseValidation.promise;
      return { ContentLength: 1024, ContentType: 'image/png' };
    });

    const completionPromise = server.inject({
      method: 'POST',
      url: `/api/v1/media/${upload.media_id}/complete`,
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: { width: 1920, height: 1080 },
    });
    await validationEntered.promise;

    const deleted = await deleteUser(uploader.userId);
    expect(deleted.statusCode).toBe(HTTP_STATUS.OK);
    releaseValidation.resolve();

    const completion = await completionPromise;
    expect(completion.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

    const db = getDatabase();
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    const sourceRows = await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.object_key, upload.object_key));
    expect(media).toMatchObject({
      status: 'FAILED',
      status_reason: 'USER_DELETED_UPLOAD_ABORTED_RETAINED',
    });
    expect(sourceRows).toHaveLength(0);
    expect(
      deleteObjectMock.mock.calls.filter(
        ([bucket, key]) => bucket === upload.bucket && key === upload.object_key
      )
    ).toHaveLength(1);
  });

  it.each([
    { label: '2.75 MiB', size: Math.round(2.75 * 1024 * 1024), strategy: 'single', status: HTTP_STATUS.CREATED },
    { label: '99 MiB', size: 99 * 1024 * 1024, strategy: 'single', status: HTTP_STATUS.CREATED },
    { label: '100 MiB', size: 100 * 1024 * 1024, strategy: 'multipart', status: HTTP_STATUS.CREATED },
    { label: '101 MiB', size: 101 * 1024 * 1024, strategy: 'multipart', status: HTTP_STATUS.CREATED },
    { label: '500 MiB', size: 500 * 1024 * 1024, strategy: 'multipart', status: HTTP_STATUS.CREATED },
    { label: 'over 500 MiB', size: 500 * 1024 * 1024 + 1, strategy: null, status: HTTP_STATUS.UNPROCESSABLE_CONTENT },
  ])('enforces upload strategy and application limit at $label', async ({ size, strategy, status }) => {
    const response = await createSession({ size });
    expect(response.statusCode).toBe(status);
    if (strategy) {
      expect(JSON.parse(response.body).strategy).toBe(strategy);
    }
  });

  it('issues only CMS-origin signed URLs and returns the same session for an identical retry', async () => {
    const idempotencyKey = randomUUID();
    const first = await createSession({ idempotencyKey });
    expect(first.statusCode).toBe(HTTP_STATUS.CREATED);
    const firstBody = JSON.parse(first.body);
    expect(firstBody.strategy).toBe('single');
    expect(firstBody.upload_url).toMatch(/^https:\/\/cms\.example\.test\/media-staging\//);
    expect(firstBody.media).toMatchObject({
      id: firstBody.media_id,
      status: 'PENDING',
      created_by: ownerUserId,
      ownership: {
        scope: 'RESTRICTED',
        department_id: null,
        creator: { id: ownerUserId, status: 'ACTIVE' },
      },
      permissions: { can_update: true, can_delete: true },
    });
    expect(getPresignedPutUrlMock).toHaveBeenLastCalledWith(
      'media-staging',
      expect.any(String),
      3600,
      'cms'
    );

    const retry = await createSession({ idempotencyKey });
    expect(retry.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(retry.body).session_id).toBe(firstBody.session_id);

    const mismatch = await createSession({ idempotencyKey, checksum: 'b'.repeat(64) });
    expect(mismatch.statusCode).toBe(HTTP_STATUS.CONFLICT);
  });

  it('uses object-store parts as the authority, verifies SHA-256, and stores it after promotion', async () => {
    const expectedParts = Array.from({ length: Math.ceil(MULTIPART_SIZE / PART_SIZE) }, (_value, index) => ({
      PartNumber: index + 1,
      ETag: `etag-${index + 1}`,
      Size: index === 6 ? MULTIPART_SIZE - PART_SIZE * 6 : PART_SIZE,
    }));
    listMultipartUploadPartsMock.mockResolvedValue({ Parts: expectedParts });

    const created = await createSession({ size: MULTIPART_SIZE });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const session = JSON.parse(created.body);
    expect(session.strategy).toBe('multipart');
    expect(session.part_count).toBe(7);

    const complete = await server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${session.session_id}/complete`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        parts: expectedParts.map((part) => ({ part_number: part.PartNumber, etag: part.ETag })),
        width: 1920,
        height: 1080,
      },
    });

    expect(complete.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(complete.body)).toMatchObject({
      state: 'COMPLETED',
      media: {
        status: 'READY',
        created_by: ownerUserId,
        ownership: { scope: 'RESTRICTED', creator: { id: ownerUserId, status: 'ACTIVE' } },
        permissions: { can_update: true, can_delete: true },
      },
    });
    expect(completeMultipartUploadMock).toHaveBeenCalledWith(
      expect.objectContaining({ parts: expectedParts.map((part) => ({ partNumber: part.PartNumber, etag: part.ETag })) })
    );
    expect(computeObjectSha256Mock).toHaveBeenCalledWith('media-staging', expect.any(String));
    expect(copyObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ sourceBucket: 'media-staging', destinationBucket: 'media-source' })
    );

    const db = getDatabase();
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, session.media_id));
    const [source] = await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, media.source_object_id!));
    expect(source.sha256).toBe(SHA_256);
  });

  it('rejects a forged multipart completion list without promoting an object', async () => {
    const expectedParts = Array.from({ length: Math.ceil(MULTIPART_SIZE / PART_SIZE) }, (_value, index) => ({
      PartNumber: index + 1,
      ETag: `etag-${index + 1}`,
      Size: index === 6 ? MULTIPART_SIZE - PART_SIZE * 6 : PART_SIZE,
    }));
    listMultipartUploadPartsMock.mockResolvedValue({ Parts: expectedParts });
    const created = await createSession({ size: MULTIPART_SIZE });
    const session = JSON.parse(created.body);

    const complete = await server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${session.session_id}/complete`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        parts: expectedParts.map((part) => ({
          part_number: part.PartNumber,
          etag: part.PartNumber === 1 ? 'forged-etag' : part.ETag,
        })),
      },
    });

    expect(complete.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(completeMultipartUploadMock).not.toHaveBeenCalled();
    expect(copyObjectMock).not.toHaveBeenCalled();
  });

  it('cancels an INITIALIZING multipart upload when deletion commits before object-store activation', async () => {
    const uploader = await createDeletableUploader();
    const createEnteredObjectStore = deferred();
    const releaseObjectStore = deferred();
    createMultipartUploadMock.mockImplementationOnce(async () => {
      createEnteredObjectStore.resolve();
      await releaseObjectStore.promise;
      return { UploadId: 'multipart-after-delete' };
    });

    const createPromise = createSessionFor(uploader.token, { size: MULTIPART_SIZE });
    await createEnteredObjectStore.promise;

    const deleted = await deleteUser(uploader.userId);
    expect(deleted.statusCode).toBe(HTTP_STATUS.OK);
    releaseObjectStore.resolve();

    const created = await createPromise;
    expect(created.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(abortMultipartUploadMock).toHaveBeenCalledWith(
      'media-staging',
      expect.any(String),
      'multipart-after-delete'
    );

    const db = getDatabase();
    const [upload] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.created_by, uploader.userId));
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    expect(upload).toMatchObject({ state: 'ABORTED', failure_reason: 'USER_DELETED_UPLOAD_ABORTED' });
    expect(media).toMatchObject({ status: 'FAILED', status_reason: 'USER_DELETED_UPLOAD_ABORTED' });
  });

  it('prevents READY media and compensates promoted objects when deletion commits before finalization', async () => {
    const uploader = await createDeletableUploader();
    headObjectMock.mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' });
    const created = await createSessionFor(uploader.token, { size: 1024 });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const upload = JSON.parse(created.body) as { session_id: string; media_id: string };

    const copyEntered = deferred();
    const releaseCopy = deferred();
    copyObjectMock.mockImplementationOnce(async () => {
      copyEntered.resolve();
      await releaseCopy.promise;
    });

    const completionPromise = server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${upload.session_id}/complete`,
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: { width: 1920, height: 1080 },
    });
    await copyEntered.promise;

    const deleted = await deleteUser(uploader.userId);
    expect(deleted.statusCode).toBe(HTTP_STATUS.OK);
    releaseCopy.resolve();

    const completion = await completionPromise;
    expect(completion.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

    const db = getDatabase();
    const [storedUpload] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, upload.session_id));
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    const sourceRows = await db
      .select()
      .from(schema.storageObjects)
      .where(eq(schema.storageObjects.object_key, storedUpload.canonical_object_key));
    expect(storedUpload.state).toBe('ABORTED');
    expect(media.status).toBe('FAILED');
    expect(media.status).not.toBe('READY');
    expect(sourceRows).toHaveLength(0);
    expect(deleteObjectMock).toHaveBeenCalledWith(storedUpload.staging_bucket, storedUpload.staging_object_key);
    expect(deleteObjectMock).toHaveBeenCalledWith(storedUpload.canonical_bucket, storedUpload.canonical_object_key);
    expect(
      deleteObjectMock.mock.calls.filter(
        ([bucket, key]) => bucket === storedUpload.canonical_bucket && key === storedUpload.canonical_object_key
      )
    ).toHaveLength(2);
  });

  it('does not overwrite a deletion-aborted upload when validation fails after deletion', async () => {
    const uploader = await createDeletableUploader();
    const created = await createSessionFor(uploader.token, { size: 1024 });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const upload = JSON.parse(created.body) as { session_id: string; media_id: string };

    const validationEntered = deferred();
    const releaseValidation = deferred();
    headObjectMock.mockImplementationOnce(async () => {
      validationEntered.resolve();
      await releaseValidation.promise;
      return { ContentLength: 1000, ContentType: 'image/png' };
    });

    const completionPromise = server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${upload.session_id}/complete`,
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: { width: 1920, height: 1080 },
    });
    await validationEntered.promise;

    const deleted = await deleteUser(uploader.userId);
    expect(deleted.statusCode).toBe(HTTP_STATUS.OK);
    releaseValidation.resolve();

    const completion = await completionPromise;
    expect(completion.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

    const db = getDatabase();
    const [storedUpload] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, upload.session_id));
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    expect(storedUpload).toMatchObject({
      state: 'ABORTED',
      failure_reason: 'USER_DELETED_UPLOAD_ABORTED',
    });
    expect(media).toMatchObject({
      status: 'FAILED',
      status_reason: 'USER_DELETED_UPLOAD_ABORTED',
    });
    expect(storedUpload.failure_reason).not.toBe('UPLOAD_SIZE_MISMATCH');
    expect(media.status_reason).not.toBe('UPLOAD_SIZE_MISMATCH');
  });

  it('does not write a validation failure after the uploader transfers departments', async () => {
    const uploader = await createDeletableUploader();
    const created = await createSessionFor(uploader.token, { size: 1024 });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const upload = JSON.parse(created.body) as { session_id: string; media_id: string };

    const validationEntered = deferred();
    const releaseValidation = deferred();
    headObjectMock.mockImplementationOnce(async () => {
      validationEntered.resolve();
      await releaseValidation.promise;
      return { ContentLength: 1000, ContentType: 'image/png' };
    });

    const completionPromise = server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${upload.session_id}/complete`,
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: { width: 1920, height: 1080 },
    });
    await validationEntered.promise;

    await transferUploader(uploader);
    releaseValidation.resolve();

    const completion = await completionPromise;
    expect(completion.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const db = getDatabase();
    const [storedUpload] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, upload.session_id));
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    expect(storedUpload.state).toBe('ACTIVE');
    expect(storedUpload.failure_reason).toBeNull();
    expect(media).toMatchObject({ status: 'PENDING', status_reason: null });
  });

  it('retains completed media under stable ownership when finalization commits before deletion', async () => {
    const uploader = await createDeletableUploader();
    headObjectMock.mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' });
    const created = await createSessionFor(uploader.token, { size: 1024 });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const upload = JSON.parse(created.body) as { session_id: string; media_id: string };

    const cleanupEntered = deferred();
    const releaseCleanup = deferred();
    deleteObjectMock.mockImplementationOnce(async () => {
      cleanupEntered.resolve();
      await releaseCleanup.promise;
    });

    const completionPromise = server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${upload.session_id}/complete`,
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: { width: 1920, height: 1080 },
    });
    await cleanupEntered.promise;

    const deleted = await deleteUser(uploader.userId);
    expect(deleted.statusCode).toBe(HTTP_STATUS.OK);
    releaseCleanup.resolve();

    const completion = await completionPromise;
    expect(completion.statusCode).toBe(HTTP_STATUS.OK);

    const db = getDatabase();
    const [storedUpload] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, upload.session_id));
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    expect(storedUpload.state).toBe('COMPLETED');
    expect(media).toMatchObject({
      status: 'READY',
      created_by: uploader.userId,
      owner_scope: 'DEPARTMENT',
      owner_department_id: uploader.departmentId,
    });
  });

  it('denies resume and idempotent retry after the uploader transfers departments', async () => {
    const uploader = await createDeletableUploader();
    const idempotencyKey = randomUUID();
    const created = await createSessionFor(uploader.token, { idempotencyKey, size: 1024 });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const upload = JSON.parse(created.body) as { session_id: string; media_id: string };
    const transferred = await transferUploader(uploader);

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/media/uploads/${upload.session_id}`,
      headers: { authorization: `Bearer ${transferred.token}` },
    });
    expect(getResponse.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const idempotentRetry = await createSessionFor(transferred.token, { idempotencyKey, size: 1024 });
    expect(idempotentRetry.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(getPresignedPutUrlMock).toHaveBeenCalledTimes(1);

    const db = getDatabase();
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    expect(media).toMatchObject({
      status: 'PENDING',
      created_by: uploader.userId,
      owner_scope: 'DEPARTMENT',
      owner_department_id: uploader.departmentId,
    });
  });

  it('prevents READY media when a department transfer commits during finalization', async () => {
    const uploader = await createDeletableUploader();
    headObjectMock.mockResolvedValue({ ContentLength: 1024, ContentType: 'image/png' });
    const created = await createSessionFor(uploader.token, { size: 1024 });
    expect(created.statusCode).toBe(HTTP_STATUS.CREATED);
    const upload = JSON.parse(created.body) as { session_id: string; media_id: string };

    const copyEntered = deferred();
    const releaseCopy = deferred();
    copyObjectMock.mockImplementationOnce(async () => {
      copyEntered.resolve();
      await releaseCopy.promise;
    });
    const completionPromise = server.inject({
      method: 'POST',
      url: `/api/v1/media/uploads/${upload.session_id}/complete`,
      headers: { authorization: `Bearer ${uploader.token}` },
      payload: { width: 1920, height: 1080 },
    });
    await copyEntered.promise;
    await transferUploader(uploader);
    releaseCopy.resolve();

    const completion = await completionPromise;
    expect(completion.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const db = getDatabase();
    const [storedUpload] = await db
      .select()
      .from(schema.mediaUploadSessions)
      .where(eq(schema.mediaUploadSessions.id, upload.session_id));
    const [media] = await db.select().from(schema.media).where(eq(schema.media.id, upload.media_id));
    expect(storedUpload.state).toBe('ACTIVE');
    expect(media).toMatchObject({
      status: 'PENDING',
      created_by: uploader.userId,
      owner_scope: 'DEPARTMENT',
      owner_department_id: uploader.departmentId,
    });
    expect(media.status).not.toBe('READY');
    expect(deleteObjectMock).toHaveBeenCalledWith(storedUpload.staging_bucket, storedUpload.staging_object_key);
    expect(deleteObjectMock).toHaveBeenCalledWith(storedUpload.canonical_bucket, storedUpload.canonical_object_key);
  });
});
