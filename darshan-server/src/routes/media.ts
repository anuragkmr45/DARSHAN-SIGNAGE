import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  completeUploadSchema,
  completeUploadSessionSchema,
  createUploadSessionSchema,
  createMediaSchema,
  presignUploadSchema,
  listMediaQuerySchema,
  uploadPartPresignSchema,
  uploadSessionParamsSchema,
} from '@/schemas/media';
import { createMediaRepository } from '@/db/repositories/media';
import { createMediaUploadSessionRepository } from '@/db/repositories/media-upload-session';
import type { MediaUsageReference } from '@/db/repositories/media';
import { createUserRepository } from '@/db/repositories/user';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { defineAbilityFor } from '@/rbac';
import {
  canAccessOwnedResource,
  canReadAdminSharedResource,
  getAdminUserIds,
  getDepartmentUserIds,
  isDepartmentScopedRole,
} from '@/rbac/policy';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  computeObjectSha256,
  copyObject,
  createBucketIfNotExists,
  createMultipartUpload,
  deleteObject,
  getPresignedPutUrl,
  getPresignedUploadPartUrl,
  headObject,
  listMultipartUploadParts,
} from '@/s3';
import { createLogger } from '@/utils/logger';
import { randomUUID, timingSafeEqual } from 'crypto';
import { apiEndpoints, PENDINGSTATUS } from '@/config/apiEndpoints';
import { HTTP_STATUS } from '@/http-status-codes';
import { respondWithError } from '@/utils/errors';
import { getDatabase, schema } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { AppError } from '@/utils/app-error';
import { config as appConfig } from '@/config';
import {
  buildObjectKey,
  normalizeDisplayName,
  normalizeOriginalFilename,
} from '@/utils/object-key';
import { serializeMediaRecord } from '@/utils/media';
import { resolveMediaAccess } from '@/utils/media-access';
import {
  inferUploadMediaType,
  normalizeWebpageUrl,
  requiresDocumentConversion,
} from '@/utils/media-processing';
import {
  queueDocumentConvert,
  queueFFmpegThumbnail,
  queueFFmpegTranscode,
  queueWebpageVerifyCapture,
} from '@/jobs';

const logger = createLogger('media-routes');
const { CREATED, FORBIDDEN, OK } = HTTP_STATUS;
const LEGACY_WEBPAGE_PREVIEW_REQUEUE_COOLDOWN_MS = 5 * 60 * 1000;
const UPLOAD_MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
const UPLOAD_PART_SIZE_BYTES = 16 * 1024 * 1024;
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const UPLOAD_SINGLE_URL_TTL_SECONDS = 60 * 60;
const UPLOAD_PART_URL_TTL_SECONDS = 15 * 60;
const UPLOAD_STAGING_BUCKET = 'media-staging';
const UPLOAD_CANONICAL_BUCKET = 'media-source';
const legacyWebpagePreviewRequeueAt = new Map<string, number>();

export async function mediaRoutes(fastify: FastifyInstance) {
  const mediaRepo = createMediaRepository();
  const uploadSessionRepo = createMediaUploadSessionRepository();
  const userRepo = createUserRepository();
  const db = getDatabase();

  const isDeleteBypassRole = (roleName?: string) =>
    roleName === 'ADMIN' || roleName === 'SUPER_ADMIN';

  const resolveOwnerDisplayName = (user: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null) => {
    if (!user) return 'another user';
    const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
    if (fullName.length > 0) return fullName;
    if (user.email) return user.email;
    return 'another user';
  };

  const mediaUsageMessageByReference: Record<MediaUsageReference, string> = {
    chat_attachments: 'Media cannot be deleted because it is still used by chat messages.',
    chat_bookmarks: 'Media cannot be deleted because it is still bookmarked in chat.',
    presentations: 'Media cannot be deleted because it is still used in presentations.',
    screens: 'Media cannot be deleted because it is currently assigned to a screen.',
    emergencies: 'Media cannot be deleted because it is used by emergency content.',
    settings: 'Media cannot be deleted because it is configured as the default media.',
    proof_of_play: 'Media cannot be deleted because it is referenced by playback history.',
  };

  const resolveApiStatus = (
    media: { status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' },
    isObjectMissing: boolean
  ) => {
    if (media.status === 'READY' && isObjectMissing) {
      return {
        status: 'FAILED' as const,
        status_reason: 'MEDIA_OBJECT_MISSING' as const,
      };
    }

    return {
      status: media.status,
      status_reason: null,
    };
  };

  const normalizeHeadSize = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };

  const ensureSourceStorageObject = async (params: {
    bucket: string;
    objectKey: string;
    contentType?: string | null;
    size?: number | null;
  }) => {
    const [storageObject] = await db
      .insert(schema.storageObjects)
      .values({
        bucket: params.bucket,
        object_key: params.objectKey,
        content_type: params.contentType ?? null,
        size: params.size ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.storageObjects.bucket, schema.storageObjects.object_key],
        set: {
          content_type: params.contentType ?? null,
          size: params.size ?? null,
        },
      })
      .returning();

    return storageObject;
  };

  const isLegacyWebpagePreview = (params: {
    media: any;
    readyObject?: any;
    resolvedContentType?: string | null;
  }) => {
    if ((params.media.type ?? '').toUpperCase() !== 'WEBPAGE') return false;
    if (params.media.status !== 'READY') return false;
    if (!params.media.source_url) return false;

    const contentType = (params.readyObject?.content_type ?? params.resolvedContentType ?? '')
      .toString()
      .toLowerCase();
    const objectKey = (params.readyObject?.object_key ?? '').toString().toLowerCase();

    return contentType === 'image/svg+xml' || objectKey.endsWith('/webpage-fallback.svg');
  };

  const maybeQueueLegacyWebpagePreviewRefresh = async (params: {
    media: any;
    readyObject?: any;
    resolvedContentType?: string | null;
  }) => {
    if (!isLegacyWebpagePreview(params)) {
      return;
    }

    const now = Date.now();
    const lastQueuedAt = legacyWebpagePreviewRequeueAt.get(params.media.id) ?? 0;
    if (now - lastQueuedAt < LEGACY_WEBPAGE_PREVIEW_REQUEUE_COOLDOWN_MS) {
      return;
    }

    legacyWebpagePreviewRequeueAt.set(params.media.id, now);

    try {
      await queueWebpageVerifyCapture({
        mediaId: params.media.id,
        sourceUrl: params.media.source_url,
      });
      logger.info({ mediaId: params.media.id }, 'Queued legacy webpage preview recapture');
    } catch (error) {
      logger.warn(
        {
          error,
          mediaId: params.media.id,
        },
        'Failed to queue legacy webpage preview recapture'
      );
    }
  };

  const serializeMediaWithResolvedState = async (media: any, readyMap?: Map<string, any>) => {
    const mediaAccess = await resolveMediaAccess(media, db, { readyObjectMap: readyMap });
    const readyObject = media.ready_object_id ? readyMap?.get(media.ready_object_id) : undefined;
    await maybeQueueLegacyWebpagePreviewRefresh({
      media,
      readyObject,
      resolvedContentType: mediaAccess.content_type,
    });
    const statusState = resolveApiStatus(media, mediaAccess.is_object_missing);
    return serializeMediaRecord(media, mediaAccess.media_url, {
      status: statusState.status,
      status_reason: statusState.status_reason,
      content_type: mediaAccess.content_type,
      source_content_type: mediaAccess.source_content_type,
      size: mediaAccess.size,
    });
  };

  const serializeCurrentMediaState = async (media: any) => {
    if (media.status !== 'READY') {
      return serializeMediaRecord(media, null, {
        status: media.status,
        status_reason: media.status_reason ?? undefined,
        content_type: media.source_content_type ?? undefined,
        source_content_type: media.source_content_type ?? undefined,
      });
    }

    return serializeMediaWithResolvedState(media);
  };

  const queueVideoFinalization = async (mediaId: string, sourceObjectId: string) => {
    try {
      await Promise.all([
        queueFFmpegTranscode({
          mediaId,
          sourceObjectId,
          targetFormat: 'mp4',
          quality: 'high',
        }),
        queueFFmpegThumbnail({
          mediaId,
          sourceObjectId,
        }),
      ]);
    } catch (error) {
      await mediaRepo.update(mediaId, { status: 'FAILED', status_reason: 'VIDEO_PROCESSING_QUEUE_FAILED' });
      throw AppError.internal('Failed to queue video processing jobs', {
        media_id: mediaId,
        source_object_id: sourceObjectId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const queueDocumentFinalization = async (mediaId: string, sourceObjectId: string) => {
    try {
      await queueDocumentConvert({ mediaId, sourceObjectId });
    } catch (error) {
      await mediaRepo.update(mediaId, {
        status: 'FAILED',
        status_reason: 'DOCUMENT_CONVERSION_QUEUE_FAILED',
      });
      throw AppError.internal('Failed to queue document conversion job', {
        media_id: mediaId,
        source_object_id: sourceObjectId,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const queueWebpageVerification = async (mediaId: string, sourceUrl: string) => {
    try {
      await queueWebpageVerifyCapture({ mediaId, sourceUrl });
    } catch (error) {
      await mediaRepo.update(mediaId, {
        status: 'FAILED',
        status_reason: 'WEBPAGE_CAPTURE_QUEUE_FAILED',
      });
      throw AppError.internal('Failed to queue webpage verification job', {
        media_id: mediaId,
        source_url: sourceUrl,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const finalizeVerifiedUpload = async (media: any, data: typeof completeUploadSchema._type) => {
    if (!media.source_bucket || !media.source_object_key) {
      throw AppError.badRequest('Media missing source object info');
    }

    let head: any;
    try {
      head = await headObject(media.source_bucket, media.source_object_key);
    } catch (error) {
      logger.error(error, 'Head object failed');
      throw AppError.badRequest('Source object not found in storage');
    }

    const storageSize = normalizeHeadSize(head?.ContentLength);
    if (
      typeof media.source_size === 'number' &&
      typeof storageSize === 'number' &&
      media.source_size !== storageSize
    ) {
      throw AppError.badRequest('Uploaded object size does not match expected size', {
        expected_size: media.source_size,
        actual_size: storageSize,
      });
    }

    const sourceContentType = head?.ContentType ?? media.source_content_type ?? data.content_type;
    const sourceSize = storageSize ?? media.source_size ?? data.size;
    const sourceObject = await ensureSourceStorageObject({
      bucket: media.source_bucket,
      objectKey: media.source_object_key,
      contentType: sourceContentType,
      size: sourceSize,
    });

    const updateBase = {
      source_object_id: sourceObject.id,
      source_content_type: sourceContentType,
      source_size: sourceSize,
      status_reason: null,
      width: data.width ?? media.width,
      height: data.height ?? media.height,
      duration_seconds: data.duration_seconds ?? media.duration_seconds,
    };

    if (media.type === 'VIDEO') {
      const processingMedia = await mediaRepo.update(media.id, {
        ...updateBase,
        status: 'PROCESSING',
      });

      if (!processingMedia) {
        throw AppError.internal('Failed to update media processing state');
      }

      await queueVideoFinalization(processingMedia.id, sourceObject.id);
      return processingMedia;
    }

    if (
      requiresDocumentConversion({
        type: media.type,
        sourceContentType,
        filename: media.name,
        objectKey: media.source_object_key,
      })
    ) {
      const processingMedia = await mediaRepo.update(media.id, {
        ...updateBase,
        status: 'PROCESSING',
      });

      if (!processingMedia) {
        throw AppError.internal('Failed to update media processing state');
      }

      await queueDocumentFinalization(processingMedia.id, sourceObject.id);
      return processingMedia;
    }

    const readyMedia = await mediaRepo.update(media.id, {
      ...updateBase,
      status: 'READY',
    });

    if (!readyMedia) {
      throw AppError.internal('Failed to finalize media upload');
    }

    return readyMedia;
  };

  const requireMediaCreateAbility = async (request: FastifyRequest) => {
    const token = extractTokenFromHeader(request.headers.authorization);
    if (!token) {
      throw AppError.unauthorized('Missing authorization header');
    }

    const payload = await verifyAccessToken(token);
    const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
    if (!ability.can('create', 'Media')) {
      throw AppError.forbidden('Forbidden');
    }
    return payload;
  };

  const getIdempotencyKey = (request: FastifyRequest) => {
    const rawHeader = request.headers['idempotency-key'];
    const idempotencyKey = (Array.isArray(rawHeader) ? rawHeader[0] : rawHeader)?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw AppError.badRequest('Idempotency-Key header is required and must be at most 255 characters');
    }
    return idempotencyKey;
  };

  const isSessionExpired = (session: { expires_at: Date }) => session.expires_at.getTime() <= Date.now();

  const assertSessionOwner = async (request: FastifyRequest, sessionId: string) => {
    const payload = await requireMediaCreateAbility(request);
    const session = await uploadSessionRepo.findById(sessionId);
    if (!session) {
      throw AppError.notFound('Upload session not found');
    }
    if (session.created_by !== payload.sub) {
      throw AppError.forbidden('This upload session belongs to another user');
    }
    return { payload, session };
  };

  const sessionPartCount = (session: { expected_size: number; part_size: number | null }) => {
    if (!session.part_size) return 0;
    return Math.ceil(session.expected_size / session.part_size);
  };

  const safeChecksumEquals = (actual: string, expected: string) => {
    const actualBytes = Buffer.from(actual, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  };

  const listUploadedParts = async (session: {
    strategy: string;
    multipart_upload_id: string | null;
    staging_bucket: string;
    staging_object_key: string;
  }) => {
    if (session.strategy !== 'multipart' || !session.multipart_upload_id) return [];
    const response = await listMultipartUploadParts(
      session.staging_bucket,
      session.staging_object_key,
      session.multipart_upload_id
    );
    return (response.Parts ?? [])
      .filter((part): part is { PartNumber: number; ETag: string; Size?: number } =>
        typeof part.PartNumber === 'number' && typeof part.ETag === 'string'
      )
      .map((part) => ({ part_number: part.PartNumber, etag: part.ETag, size: part.Size ?? null }))
      .sort((left, right) => left.part_number - right.part_number);
  };

  const serializeUploadSession = async (session: any, includeSingleUploadUrl = false) => {
    let uploadedParts: Array<{ part_number: number; etag: string; size: number | null }> = [];
    if (session.strategy === 'multipart' && session.state === 'ACTIVE' && session.multipart_upload_id) {
      uploadedParts = await listUploadedParts(session);
    }

    const singleUploadUrl =
      includeSingleUploadUrl && session.strategy === 'single' && session.state === 'ACTIVE'
        ? await getPresignedPutUrl(
            session.staging_bucket,
            session.staging_object_key,
            UPLOAD_SINGLE_URL_TTL_SECONDS,
            'cms'
          )
        : undefined;
    const media = session.state === 'COMPLETED' ? await mediaRepo.findById(session.media_id) : null;

    return {
      session_id: session.id,
      media_id: session.media_id,
      state: session.state,
      strategy: session.strategy,
      expires_at: session.expires_at.toISOString(),
      part_size: session.part_size,
      part_count: sessionPartCount(session),
      uploaded_parts: uploadedParts,
      upload_url: singleUploadUrl,
      media: media ? await serializeCurrentMediaState(media) : null,
      failure_reason: session.failure_reason,
    };
  };

  const markUploadSessionFailed = async (session: any, reason: string, deleteStaging = false) => {
    if (deleteStaging) {
      await deleteObject(session.staging_bucket, session.staging_object_key).catch((error) => {
        logger.warn({ error, sessionId: session.id }, 'Failed to remove rejected staging object');
      });
    }
    await uploadSessionRepo.update(session.id, { state: 'FAILED', failure_reason: reason });
    await mediaRepo.update(session.media_id, { status: 'FAILED', status_reason: reason });
  };

  // Resumable upload session. The browser only receives CMS-origin signed URLs
  // for an immutable staging key; no staging object is ever playable.
  fastify.post<{ Body: typeof createUploadSessionSchema._type }>(
    apiEndpoints.media.uploadSessions,
    {
      schema: {
        description: 'Create or resume an idempotent, verified media upload session',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const payload = await requireMediaCreateAbility(request);
        const idempotencyKey = getIdempotencyKey(request);
        const data = createUploadSessionSchema.parse(request.body);
        const existing = await uploadSessionRepo.findByUserAndIdempotencyKey(payload.sub, idempotencyKey);
        if (existing) {
          const requestMatchesExisting =
            existing.original_filename === normalizeOriginalFilename(data.filename) &&
            existing.display_name === normalizeDisplayName(data.display_name || data.filename) &&
            existing.content_type === data.content_type &&
            existing.expected_size === data.size &&
            safeChecksumEquals(existing.checksum_sha256, data.checksum_sha256);
          if (!requestMatchesExisting) {
            throw AppError.conflict('Idempotency-Key is already associated with a different upload');
          }
          return reply.send(await serializeUploadSession(existing, true));
        }

        const mediaId = randomUUID();
        const sessionId = randomUUID();
        const originalFilename = normalizeOriginalFilename(data.filename);
        const displayName = normalizeDisplayName(data.display_name || originalFilename);
        const { objectKey } = buildObjectKey({
          originalFilename,
          mimeType: data.content_type,
          id: mediaId,
        });
        const strategy = data.size >= UPLOAD_MULTIPART_THRESHOLD_BYTES ? 'multipart' : 'single';
        const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
        const stagingObjectKey = `uploads/${sessionId}/${objectKey}`;

        await Promise.all([
          createBucketIfNotExists(UPLOAD_STAGING_BUCKET),
          createBucketIfNotExists(UPLOAD_CANONICAL_BUCKET),
        ]);

        await mediaRepo.create({
          id: mediaId,
          name: displayName,
          type: inferUploadMediaType(data.content_type) as any,
          status: PENDINGSTATUS,
          source_bucket: UPLOAD_CANONICAL_BUCKET,
          source_object_key: objectKey,
          source_content_type: data.content_type,
          source_size: data.size,
          status_reason: null,
          created_by: payload.sub,
        });

        let session = await uploadSessionRepo.create({
          id: sessionId,
          media_id: mediaId,
          created_by: payload.sub,
          idempotency_key: idempotencyKey,
          state: 'INITIALIZING',
          strategy,
          original_filename: originalFilename,
          display_name: displayName,
          content_type: data.content_type,
          expected_size: data.size,
          checksum_sha256: data.checksum_sha256,
          part_size: strategy === 'multipart' ? UPLOAD_PART_SIZE_BYTES : null,
          staging_bucket: UPLOAD_STAGING_BUCKET,
          staging_object_key: stagingObjectKey,
          canonical_bucket: UPLOAD_CANONICAL_BUCKET,
          canonical_object_key: objectKey,
          expires_at: expiresAt,
        });

        try {
          if (strategy === 'multipart') {
            const multipart = await createMultipartUpload({
              bucket: UPLOAD_STAGING_BUCKET,
              key: stagingObjectKey,
              contentType: data.content_type,
              checksumSha256: data.checksum_sha256,
            });
            if (!multipart.UploadId) {
              throw new Error('Object storage did not return a multipart upload id');
            }
            session = await uploadSessionRepo.update(session.id, {
              state: 'ACTIVE',
              multipart_upload_id: multipart.UploadId,
            });
          } else {
            session = await uploadSessionRepo.update(session.id, { state: 'ACTIVE' });
          }
        } catch (error) {
          await markUploadSessionFailed(session, 'UPLOAD_SESSION_INITIALIZATION_FAILED');
          throw error;
        }

        if (!session) {
          throw AppError.internal('Failed to activate upload session');
        }
        return reply.status(CREATED).send(await serializeUploadSession(session, true));
      } catch (error) {
        logger.error(error, 'Create upload session error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.get<{ Params: typeof uploadSessionParamsSchema._type }>(
    apiEndpoints.media.uploadSession,
    {
      schema: { description: 'Get resumable upload session state', tags: ['Media'], security: [{ bearerAuth: [] }] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { sessionId } = uploadSessionParamsSchema.parse(request.params);
        const { session } = await assertSessionOwner(request, sessionId);
        if (isSessionExpired(session) && session.state === 'ACTIVE') {
          await uploadSessionRepo.update(session.id, { state: 'EXPIRED', failure_reason: 'UPLOAD_SESSION_EXPIRED' });
          await mediaRepo.update(session.media_id, { status: 'FAILED', status_reason: 'UPLOAD_SESSION_EXPIRED' });
          return reply.send(await serializeUploadSession({ ...session, state: 'EXPIRED', failure_reason: 'UPLOAD_SESSION_EXPIRED' }));
        }
        return reply.send(await serializeUploadSession(session, true));
      } catch (error) {
        logger.error(error, 'Get upload session error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: typeof uploadSessionParamsSchema._type; Body: typeof uploadPartPresignSchema._type }>(
    apiEndpoints.media.uploadSessionParts,
    {
      schema: { description: 'Issue short-lived CMS-origin URLs for upload parts', tags: ['Media'], security: [{ bearerAuth: [] }] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { sessionId } = uploadSessionParamsSchema.parse(request.params);
        const { session } = await assertSessionOwner(request, sessionId);
        if (session.strategy !== 'multipart' || !session.multipart_upload_id) {
          throw AppError.badRequest('This upload session does not use multipart upload');
        }
        if (session.state !== 'ACTIVE' || isSessionExpired(session)) {
          throw AppError.conflict('Upload session is no longer active');
        }

        const data = uploadPartPresignSchema.parse(request.body);
        const maxPartNumber = sessionPartCount(session);
        const partNumbers = Array.from(new Set(data.part_numbers)).sort((left, right) => left - right);
        if (partNumbers.some((partNumber) => partNumber > maxPartNumber)) {
          throw AppError.badRequest('Requested part number is outside the upload bounds');
        }

        const parts = await Promise.all(
          partNumbers.map(async (partNumber) => ({
            part_number: partNumber,
            upload_url: await getPresignedUploadPartUrl({
              bucket: session.staging_bucket,
              key: session.staging_object_key,
              uploadId: session.multipart_upload_id as string,
              partNumber,
              expiresIn: UPLOAD_PART_URL_TTL_SECONDS,
              audience: 'cms',
            }),
            expires_in: UPLOAD_PART_URL_TTL_SECONDS,
          }))
        );
        return reply.send({ session_id: session.id, parts });
      } catch (error) {
        logger.error(error, 'Presign upload part error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.post<{ Params: typeof uploadSessionParamsSchema._type; Body: typeof completeUploadSessionSchema._type }>(
    apiEndpoints.media.uploadSessionComplete,
    {
      schema: { description: 'Verify, promote, and finalize an upload session', tags: ['Media'], security: [{ bearerAuth: [] }] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      let finalizingSessionId: string | undefined;
      try {
        const { sessionId } = uploadSessionParamsSchema.parse(request.params);
        const { session: originalSession } = await assertSessionOwner(request, sessionId);
        const data = completeUploadSessionSchema.parse(request.body);
        if (originalSession.state === 'COMPLETED') {
          return reply.send(await serializeUploadSession(originalSession));
        }
        if (originalSession.state !== 'ACTIVE' || isSessionExpired(originalSession)) {
          throw AppError.conflict('Upload session is no longer active');
        }

        let session = await uploadSessionRepo.claimForFinalization(originalSession.id);
        if (!session) throw AppError.conflict('Upload session is already being finalized');
        finalizingSessionId = session.id;

        if (session.strategy === 'multipart') {
          const suppliedParts = data.parts ?? [];
          const uploadedParts = await listUploadedParts(session);
          const expectedPartCount = sessionPartCount(session);
          if (uploadedParts.length !== expectedPartCount || suppliedParts.length !== expectedPartCount) {
            throw AppError.badRequest('All upload parts must be present before completion');
          }

          const suppliedByNumber = new Map(suppliedParts.map((part) => [part.part_number, part.etag]));
          const authoritativeParts = uploadedParts.map((part) => ({ partNumber: part.part_number, etag: part.etag }));
          const validParts =
            authoritativeParts.length === expectedPartCount &&
            authoritativeParts.every(
              (part, index) =>
                part.partNumber === index + 1 &&
                typeof suppliedByNumber.get(part.partNumber) === 'string' &&
                suppliedByNumber.get(part.partNumber) === part.etag
            );
          if (!validParts) {
            throw AppError.badRequest('Upload part list does not match object storage state');
          }
          await completeMultipartUpload({
            bucket: session.staging_bucket,
            key: session.staging_object_key,
            uploadId: session.multipart_upload_id as string,
            parts: authoritativeParts,
          });
        }

        const stagingHead = await headObject(session.staging_bucket, session.staging_object_key);
        const stagingSize = normalizeHeadSize(stagingHead?.ContentLength);
        if (stagingSize !== session.expected_size) {
          await markUploadSessionFailed(session, 'UPLOAD_SIZE_MISMATCH', true);
          throw AppError.badRequest('Uploaded object size does not match expected size', {
            expected_size: session.expected_size,
            actual_size: stagingSize,
          });
        }
        const actualChecksum = await computeObjectSha256(session.staging_bucket, session.staging_object_key);
        if (!safeChecksumEquals(actualChecksum, session.checksum_sha256)) {
          await markUploadSessionFailed(session, 'UPLOAD_CHECKSUM_MISMATCH', true);
          throw AppError.badRequest('Uploaded object checksum does not match expected SHA-256');
        }

        await copyObject({
          sourceBucket: session.staging_bucket,
          sourceKey: session.staging_object_key,
          destinationBucket: session.canonical_bucket,
          destinationKey: session.canonical_object_key,
        });
        const canonicalHead = await headObject(session.canonical_bucket, session.canonical_object_key);
        if (normalizeHeadSize(canonicalHead?.ContentLength) !== session.expected_size) {
          await markUploadSessionFailed(session, 'UPLOAD_PROMOTION_SIZE_MISMATCH');
          throw AppError.internal('Promoted object did not match the verified staging object size');
        }

        const media = await mediaRepo.findById(session.media_id);
        if (!media) throw AppError.internal('Upload session media record is missing');
        const finalizedMedia = await finalizeVerifiedUpload(media, {
          content_type: session.content_type,
          size: session.expected_size,
          width: data.width,
          height: data.height,
          duration_seconds: data.duration_seconds,
        });
        if (finalizedMedia.source_object_id) {
          await db
            .update(schema.storageObjects)
            .set({ sha256: actualChecksum })
            .where(eq(schema.storageObjects.id, finalizedMedia.source_object_id));
        }
        await deleteObject(session.staging_bucket, session.staging_object_key).catch((error) => {
          logger.warn({ error, sessionId: session.id }, 'Promoted staging object will be cleaned up later');
        });
        session = await uploadSessionRepo.update(session.id, {
          state: 'COMPLETED',
          completed_at: new Date(),
          failure_reason: null,
        });
        if (!session) throw AppError.internal('Failed to mark upload session complete');
        return reply.send(await serializeUploadSession(session));
      } catch (error) {
        if (finalizingSessionId) {
          const latestSession = await uploadSessionRepo.findById(finalizingSessionId).catch(() => null);
          if (latestSession?.state === 'FINALIZING') {
            await uploadSessionRepo.releaseFinalization(finalizingSessionId).catch((releaseError) => {
              logger.error({ releaseError, sessionId: finalizingSessionId }, 'Failed to release upload finalization lock');
            });
          }
        }
        logger.error(error, 'Complete upload session error');
        return respondWithError(reply, error);
      }
    }
  );

  fastify.delete<{ Params: typeof uploadSessionParamsSchema._type }>(
    apiEndpoints.media.uploadSession,
    {
      schema: { description: 'Abort and clean up an incomplete upload session', tags: ['Media'], security: [{ bearerAuth: [] }] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { sessionId } = uploadSessionParamsSchema.parse(request.params);
        const { session } = await assertSessionOwner(request, sessionId);
        if (session.state === 'COMPLETED') {
          throw AppError.conflict('Completed upload sessions cannot be aborted');
        }
        if (session.strategy === 'multipart' && session.multipart_upload_id) {
          await abortMultipartUpload(session.staging_bucket, session.staging_object_key, session.multipart_upload_id).catch((error) => {
            logger.warn({ error, sessionId: session.id }, 'Failed to abort multipart upload');
          });
        }
        await deleteObject(session.staging_bucket, session.staging_object_key).catch(() => undefined);
        await uploadSessionRepo.update(session.id, { state: 'ABORTED', aborted_at: new Date(), failure_reason: 'UPLOAD_ABORTED' });
        await mediaRepo.update(session.media_id, { status: 'FAILED', status_reason: 'UPLOAD_ABORTED' });
        return reply.status(OK).send({ session_id: session.id, state: 'ABORTED' });
      } catch (error) {
        logger.error(error, 'Abort upload session error');
        return respondWithError(reply, error);
      }
    }
  );

  // Legacy direct presign route. New CMS uploads use resumable sessions above.
  // Presign upload URL
  fastify.post<{ Body: typeof presignUploadSchema._type }>(
    apiEndpoints.media.presignUpload,
    {
      schema: {
        description: 'Get presigned URL for direct media upload to MinIO',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('create', 'Media')) {
          throw AppError.forbidden('Forbidden');
        }

        const data = presignUploadSchema.parse(request.body);
        const mediaId = randomUUID();
        const originalFilename = normalizeOriginalFilename(data.filename);
        const displayName = normalizeDisplayName(data.display_name || originalFilename);
        const { objectKey } = buildObjectKey({
          originalFilename,
          mimeType: data.content_type,
          id: mediaId,
        });
        const bucket = 'media-source';

        const inferredType = inferUploadMediaType(data.content_type);

        // Ensure bucket exists
        await createBucketIfNotExists(bucket);

        // CMS web browsers are restricted to the CMS HTTPS origin. Sign the
        // path-style URL for that Nginx gateway, never for the internal MinIO
        // endpoint that a browser cannot reliably reach.
        const uploadUrl = await getPresignedPutUrl(bucket, objectKey, 3600, 'cms');

        // Create media record
        const media = await mediaRepo.create({
          id: mediaId,
          name: displayName,
          type: inferredType as any,
          status: PENDINGSTATUS,
          source_bucket: bucket,
          source_object_key: objectKey,
          source_content_type: data.content_type,
          source_size: data.size,
          status_reason: null,
          created_by: payload.sub,
        });

        return reply.send({
          upload_url: uploadUrl,
          media_id: media.id,
          bucket,
          object_key: objectKey,
          original_filename: originalFilename,
          expires_in: 3600,
        });
      } catch (error) {
        logger.error(error, 'Presign upload error');
        return respondWithError(reply, error);
      }
    }
  );

  // Create media metadata
  fastify.post<{ Body: typeof createMediaSchema._type }>(
    apiEndpoints.media.create,
    {
      schema: {
        description: 'Create media metadata',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);

        if (!ability.can('create', 'Media')) {
          throw AppError.forbidden('Forbidden');
        }

        const data = createMediaSchema.parse(request.body);
        if (data.type === 'WEBPAGE') {
          const normalizedUrl = normalizeWebpageUrl(data.source_url, appConfig.NODE_ENV);
          const media = await mediaRepo.create({
            name: normalizeDisplayName(data.display_name || data.name),
            type: 'WEBPAGE',
            status: 'PROCESSING',
            status_reason: null,
            source_url: normalizedUrl,
            created_by: payload.sub,
          });

          await queueWebpageVerification(media.id, normalizedUrl);
          return reply.status(CREATED).send(await serializeCurrentMediaState(media));
        }

        const originalFilename = normalizeOriginalFilename(data.name);
        const displayName = normalizeDisplayName(originalFilename);
        const media = await mediaRepo.create({
          name: displayName,
          type: data.type,
          status: 'PENDING',
          status_reason: null,
          created_by: payload.sub,
        });

        return reply.status(CREATED).send(await serializeCurrentMediaState(media));
      } catch (error) {
        logger.error(error, 'Create media error');
        return respondWithError(reply, error);
      }
    }
  );

  // List media
  fastify.get<{ Querystring: typeof listMediaQuerySchema._type }>(
    apiEndpoints.media.list,
    {
      schema: {
        description: 'List media with pagination and filtering',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);

        const query = listMediaQuerySchema.parse(request.query);
        const createdByIds = isDepartmentScopedRole(payload.role)
          ? Array.from(new Set([...(await getDepartmentUserIds(payload.department_id)), ...(await getAdminUserIds())]))
          : undefined;
        if (query.status === 'READY') {
          const requestedOffset = (query.page - 1) * query.limit;
          const batchSize = Math.max(query.limit, 100);
          const collected: any[] = [];
          let validTotal = 0;
          let scanPage = 1;
          let hasMore = true;

          while (hasMore) {
            const batch = await mediaRepo.list({
              page: scanPage,
              limit: batchSize,
              type: query.type,
              status: query.status,
              created_by_ids: createdByIds,
            });

            hasMore = batch.items.length === batchSize;
            if (batch.items.length === 0) {
              break;
            }

            const readyIds = batch.items
              .map((m: any) => m.ready_object_id)
              .filter(Boolean) as string[];
            const readyObjects = readyIds.length
              ? await db
                  .select()
                  .from(schema.storageObjects)
                  .where(inArray(schema.storageObjects.id, readyIds as any))
              : [];
            const readyMap = new Map(readyObjects.map((o: any) => [o.id, o]));

            const resolvedBatch = await Promise.all(
              batch.items.map((m) => serializeMediaWithResolvedState(m, readyMap))
            );

            for (const item of resolvedBatch) {
              if (item.status !== 'READY') continue;

              if (validTotal >= requestedOffset && collected.length < query.limit) {
                collected.push(item);
              }
              validTotal += 1;
            }

            scanPage += 1;
          }

          return reply.send({
            items: collected,
            pagination: {
              page: query.page,
              limit: query.limit,
              total: validTotal,
            },
          });
        }

        const result = await mediaRepo.list({
          page: query.page,
          limit: query.limit,
          type: query.type,
          status: query.status,
          created_by_ids: createdByIds,
        });

        const readyIds = result.items.map((m: any) => m.ready_object_id).filter(Boolean) as string[];
        const readyObjects = readyIds.length
          ? await db.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, readyIds as any))
          : [];
        const readyMap = new Map(readyObjects.map((o: any) => [o.id, o]));

        const items = await Promise.all(result.items.map((m) => serializeMediaWithResolvedState(m, readyMap)));

        return reply.send({
          items,
          pagination: {
            page: result.page,
            limit: result.limit,
            total: result.total,
          },
        });
      } catch (error) {
        logger.error(error, 'List media error');
        return respondWithError(reply, error);
      }
    }
  );

  // Get media by ID
  fastify.get<{ Params: { id: string } }>(
    apiEndpoints.media.get,
    {
      schema: {
        description: 'Get media by ID',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);

        const mediaId = (request.params as any).id;
        const media = await mediaRepo.findById(mediaId);
        if (!media) {
          throw AppError.notFound('Media not found');
        }
        const canReadMedia = await canReadAdminSharedResource(
          { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id },
          media.created_by
        );
        if (!canReadMedia) throw AppError.forbidden('Forbidden');

        return reply.send(await serializeMediaWithResolvedState(media));
      } catch (error) {
        logger.error(error, 'Get media error');
        return respondWithError(reply, error);
      }
    }
  );

  // Finalize upload after client PUT
  fastify.post<{ Params: { id: string }; Body: typeof completeUploadSchema._type }>(
    apiEndpoints.media.complete,
    {
      schema: {
        description: 'Finalize media upload and verify object',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('update', 'Media')) {
          throw AppError.forbidden('Forbidden');
        }

        const data = completeUploadSchema.parse(request.body);
        const media = await mediaRepo.findById((request.params as any).id);
        if (!media) {
          throw AppError.notFound('Media not found');
        }
        const canUpdateMedia = await canAccessOwnedResource(
          { userId: payload.sub, roleName: payload.role, departmentId: payload.department_id },
          media.created_by
        );
        if (!canUpdateMedia) throw AppError.forbidden('Forbidden');

        if (media.status === 'READY' || media.status === 'PROCESSING') {
          return reply.send(await serializeCurrentMediaState(media));
        }

        const updated = await finalizeVerifiedUpload(media, data);
        return reply.send(await serializeCurrentMediaState(updated));
      } catch (error) {
        logger.error(error, 'Complete upload error');
        return respondWithError(reply, error);
      }
    }
  );

  // Delete media (soft by default, hard with ?hard=true)
  fastify.delete<{ Params: { id: string }; Querystring: { hard?: string } }>(
    apiEndpoints.media.delete,
    {
      schema: {
        description: 'Delete media (soft delete by default, hard delete with ?hard=true)',
        tags: ['Media'],
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const token = extractTokenFromHeader(request.headers.authorization);
        if (!token) {
          throw AppError.unauthorized('Missing authorization header');
        }

        const payload = await verifyAccessToken(token);
        const ability = await defineAbilityFor(payload.role_id, payload.sub, payload.department_id);
        if (!ability.can('delete', 'Media')) {
          throw AppError.forbidden('Forbidden');
        }

        const media = await mediaRepo.findById((request.params as any).id);
        if (!media) {
          throw AppError.notFound('Media not found');
        }

        const owner = media.created_by ? await userRepo.findById(media.created_by) : null;
        const canDeleteThisMedia =
          media.created_by === payload.sub || isDeleteBypassRole(payload.role);
        if (!canDeleteThisMedia) {
          throw new AppError({
            statusCode: FORBIDDEN,
            code: 'MEDIA_DELETE_FORBIDDEN_OWNER',
            message: `You can only delete media you uploaded. This media was uploaded by ${resolveOwnerDisplayName(owner)}.`,
            details: {
              owner_user_id: media.created_by,
              owner_display_name: resolveOwnerDisplayName(owner),
            },
          });
        }

        const hardDelete =
          typeof (request.query as any).hard === 'string' &&
          ((request.query as any).hard as string).toLowerCase() === 'true';

        const usageSummary = await mediaRepo.getUsageSummary(media.id);
        if (usageSummary.inUse) {
          throw new AppError({
            statusCode: 409,
            code: 'MEDIA_IN_USE',
            message:
              mediaUsageMessageByReference[usageSummary.primaryReason ?? 'chat_attachments'],
            details: {
              references: usageSummary.references,
            },
          });
        }

        const db = getDatabase();
        const storageObjects = new Map<string, { bucket: string; key: string; id?: string }>();
        const deletedObjects: { bucket: string; key: string; success: boolean; error?: string }[] = [];

        const addStorageObject = (obj: { bucket: string; key: string; id?: string }) => {
          const mapKey = obj.id ?? `${obj.bucket}:${obj.key}`;
          storageObjects.set(mapKey, obj);
        };

        if (media.source_bucket && media.source_object_key) {
          addStorageObject({ bucket: media.source_bucket, key: media.source_object_key });
        }

        if (media.source_object_id) {
          const [obj] = await db
            .select()
            .from(schema.storageObjects)
            .where(eq(schema.storageObjects.id, media.source_object_id));
          if (obj) addStorageObject({ bucket: obj.bucket, key: obj.object_key, id: obj.id });
        }

        if (media.ready_object_id) {
          const [obj] = await db
            .select()
            .from(schema.storageObjects)
            .where(eq(schema.storageObjects.id, media.ready_object_id));
          if (obj) addStorageObject({ bucket: obj.bucket, key: obj.object_key, id: obj.id });
        }

        if (media.thumbnail_object_id) {
          const [obj] = await db
            .select()
            .from(schema.storageObjects)
            .where(eq(schema.storageObjects.id, media.thumbnail_object_id));
          if (obj) addStorageObject({ bucket: obj.bucket, key: obj.object_key, id: obj.id });
        }

        for (const obj of storageObjects.values()) {
          try {
            await deleteObject(obj.bucket, obj.key);
            deletedObjects.push({ bucket: obj.bucket, key: obj.key, success: true });
          } catch (err) {
            logger.warn(err, 'Failed to delete media object from storage');
            deletedObjects.push({
              bucket: obj.bucket,
              key: obj.key,
              success: false,
              error: (err as Error).message,
            });
          }
        }

        // Remove storage object rows for ready/thumbnail if present
        for (const obj of storageObjects.values()) {
          if (obj.id) {
            try {
              await db.delete(schema.storageObjects).where(eq(schema.storageObjects.id, obj.id));
            } catch (err) {
              logger.warn(err, 'Failed to delete storage object row');
            }
          }
        }

        if (hardDelete) {
          await mediaRepo.delete(media.id);
          return reply.status(OK).send({
            message: 'Media hard deleted (DB row removed, storage cleaned where possible)',
            id: media.id,
            storage_deleted: deletedObjects,
          });
        }

        await mediaRepo.update(media.id, {
          status: 'FAILED',
          source_object_id: null as any,
          source_bucket: null as any,
          source_object_key: null as any,
          ready_object_id: null as any,
          thumbnail_object_id: null as any,
        });

        return reply.status(OK).send({
          message: 'Media soft deleted (DB retained, storage cleaned where possible)',
          id: media.id,
          storage_deleted: deletedObjects,
        });
      } catch (error) {
        logger.error(error, 'Delete media error');
        return respondWithError(reply, error);
      }
    }
  );
}
