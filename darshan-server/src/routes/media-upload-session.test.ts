import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { hashPassword } from '@/auth/password';
import { HTTP_STATUS } from '@/http-status-codes';

const {
  createBucketIfNotExistsMock,
  createMultipartUploadMock,
  getPresignedPutUrlMock,
  getPresignedUploadPartUrlMock,
  listMultipartUploadPartsMock,
  completeMultipartUploadMock,
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
  abortMultipartUpload: vi.fn(),
}));

const { createServer } = await import('@/server');

const SHA_256 = 'a'.repeat(64);
const MULTIPART_SIZE = 100 * 1024 * 1024;
const PART_SIZE = 16 * 1024 * 1024;

describe('Media upload sessions', () => {
  let server: FastifyInstance;
  let ownerToken: string;
  let ownerUserId: string;

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
    headObjectMock.mockResolvedValue({ ContentLength: MULTIPART_SIZE, ContentType: 'image/png' });
    computeObjectSha256Mock.mockResolvedValue(SHA_256);
    copyObjectMock.mockResolvedValue(undefined);
    deleteObjectMock.mockResolvedValue(undefined);
    getPresignedUrlMock.mockResolvedValue('https://cms.example.test/media-source/ready');
  });

  const createSession = async (params?: { idempotencyKey?: string; size?: number; checksum?: string }) =>
    await server.inject({
      method: 'POST',
      url: '/api/v1/media/uploads',
      headers: {
        authorization: `Bearer ${ownerToken}`,
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
      allowed_mime_types: [],
    });
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
    expect(JSON.parse(complete.body)).toMatchObject({ state: 'COMPLETED', media: { status: 'READY' } });
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
});
