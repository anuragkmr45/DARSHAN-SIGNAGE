import type { FastifyInstance } from 'fastify';
import { subject } from '@casl/ability';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization, type MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { apiEndpoints } from '@/config/apiEndpoints';
import { schema } from '@/db';
import { canReadContentResource, type ContentOwnedResource, type ContentSubject } from '@/rbac/content-ownership';
import { canReadScheduleRecord, canReadScheduleRequestRecord } from '@/rbac/schedule-read-authorization';
import { validateLiveFallbackManifest, type NormalizedFallbackAsset } from '@/services/live-fallback-manifest';
import { liveSchedulingFingerprint } from '@/services/live-scheduling';
import { lockScreenTargetReferences } from '@/services/screen-deletion-guard';
import { getPresignedUrl } from '@/s3';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import { liveApprovalMetadata } from './live-publishing-helpers';

const logger = createLogger('live-request-previews');
const paramsSchema = z.object({ id: z.string().uuid().transform(id => id.toLowerCase()),
  itemId: z.string().uuid().transform(id => id.toLowerCase()) }).strict();
function invalid(): never { throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_STALE',
  message: 'The stored live approval or its immutable fallback could not be verified. Reload the request and contact an administrator.' }); }
function requireRead(context: MutationAuthorizationContext, row: ContentOwnedResource, resource: ContentSubject) {
  const bound = { can: (action: string) => context.ability.can(action as never, subject(resource, row) as never) };
  if (!canReadContentResource(context.actor, row, bound, resource)) throw AppError.forbidden();
}

/** Historical preview is bound to a currently readable request, not a mutable
 * library graph. It never changes eligibility, grants media authority or writes
 * a signed URL into a durable record. */
export async function liveRequestPreviewRoutes(fastify: FastifyInstance) {
  fastify.get(apiEndpoints.scheduleRequests.liveFallbackPreview, {
    schema: { tags: ['Live broadcasts'], security: [{ bearerAuth: [] }] },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      const token = extractTokenFromHeader(request.headers.authorization);
      if (!token) throw AppError.unauthorized('Missing authorization header');
      const payload = await verifyAccessToken(token), { id, itemId } = paramsSchema.parse(request.params);
      const frozen = await withCurrentMutationAuthorization(payload, async context => {
        const db = context.executor;
        await lockScreenTargetReferences(db);
        const [record] = await db.select().from(schema.scheduleRequests).where(eq(schema.scheduleRequests.id, id)).for('share');
        if (!record) throw AppError.notFound('Schedule request not found');
        if (!canReadScheduleRequestRecord(record, context.ability)) throw AppError.forbidden();
        const [schedule] = await db.select().from(schema.schedules).where(eq(schema.schedules.id, record.schedule_id)).for('share');
        if (!schedule) throw AppError.notFound('Schedule not found');
        if (!canReadScheduleRecord(context.actor, schedule, context.ability)) throw AppError.forbidden();
        const approval = liveApprovalMetadata(record.schedule_payload);
        if (!approval || approval.items.some(item => item.schedule_id !== schedule.id ||
            approval.fallback_preparation_ids[item.fallback.manifest.presentation.id] !== item.fallback.preparation_id)) invalid();
        const policy = approval.items.find(item => item.schedule_item_id === itemId);
        if (!policy) throw AppError.notFound('This request has no approved live item with that identity');
        const presentationId = policy.fallback.manifest.presentation.id;
        const [source] = await db.select().from(schema.liveSessions).where(eq(schema.liveSessions.id, policy.live_session_id)).for('share');
        const [presentation] = await db.select().from(schema.presentations).where(eq(schema.presentations.id, presentationId)).for('share');
        if (!source || !presentation) throw AppError.notFound('The original live source or fallback presentation is no longer available');
        requireRead(context, source, 'LiveBroadcast'); requireRead(context, presentation, 'Presentation');
        // Frozen IDs determine which old records require current READ access.
        // Edits/deletion flags do not silently substitute the new library graph.
        const layoutId = policy.fallback.manifest.presentation.layout?.id;
        if (layoutId) {
          const [layout] = await db.select().from(schema.layouts).where(eq(schema.layouts.id, layoutId)).for('share');
          if (!layout) throw AppError.notFound('The original fallback layout is no longer available');
          requireRead(context, layout, 'Layout');
        }
        const mediaIds = [...new Set(policy.fallback.manifest.assets.map(asset => asset.media_id))].sort();
        const media = await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds)).orderBy(asc(schema.media.id)).for('share');
        if (media.length !== mediaIds.length) throw AppError.notFound('An original fallback media record is no longer available');
        for (const row of media) requireRead(context, row, 'Media');
        const [preparation] = await db.select().from(schema.liveFallbackPreparations)
          .where(eq(schema.liveFallbackPreparations.id, policy.fallback.preparation_id)).for('share');
        if (!preparation || preparation.state !== 'READY' || preparation.presentation_id !== presentationId ||
            preparation.source_fingerprint !== policy.fallback.source_fingerprint) invalid();
        const rows = await db.select().from(schema.liveFallbackPreparationAssets)
          .innerJoin(schema.storageObjects, eq(schema.liveFallbackPreparationAssets.storage_object_id, schema.storageObjects.id))
          .where(eq(schema.liveFallbackPreparationAssets.preparation_id, preparation.id))
          .orderBy(asc(schema.liveFallbackPreparationAssets.asset_id)).for('share');
        const normalized: NormalizedFallbackAsset[] = rows.map(({ live_fallback_preparation_assets: asset, storage_objects: object }) => {
          if (asset.sha256 !== object.sha256 || asset.size !== object.size || asset.content_type !== object.content_type) invalid();
          return { id: asset.asset_id, media_id: asset.media_id, storage_object_id: asset.storage_object_id,
            bucket: object.bucket, object_key: object.object_key, sha256: asset.sha256, size: asset.size,
            content_type: asset.content_type, render_type: asset.render_type, source_type: asset.source_type,
            status: asset.status, representation: asset.representation, dependencies: asset.dependencies,
            source_object_id: asset.source_object_id, source_sha256: asset.source_sha256, source_content_type: asset.source_content_type };
        });
        let manifest;
        try {
          manifest = validateLiveFallbackManifest(policy.fallback.manifest, { presentationId, assets: normalized });
          const prepared = validateLiveFallbackManifest(preparation.manifest, { presentationId, assets: normalized });
          if (liveSchedulingFingerprint(manifest) !== liveSchedulingFingerprint(prepared)) invalid();
        } catch { invalid(); }
        return { requestId: record.id, itemId, approvalFingerprint: approval.approval_fingerprint, preparation, manifest: manifest! };
      }, { userLock: 'share', sessionLock: 'share' });
      const checkedAt = new Date(), expiresAt = new Date(checkedAt.getTime() + 900_000).toISOString();
      const downloads = [];
      try {
        for (const asset of frozen.manifest.assets) downloads.push({ asset_id: asset.id, cache_key: asset.cache_key,
          sha256: asset.sha256, size: asset.size, content_type: asset.content_type, expires_at: expiresAt,
          url: await getPresignedUrl(asset.bucket, asset.object_key, { expiresIn: 900, responseContentType: asset.content_type,
            responseContentDisposition: 'inline', audience: 'cms' }) });
      } catch {
        logger.warn({ requestId: id, itemId }, 'Frozen request preview signing is unavailable');
        throw new AppError({ statusCode: 503, code: 'LIVE_FALLBACK_PREVIEW_UNAVAILABLE', message: 'The frozen request preview is unavailable. Please retry.' });
      }
      return reply.send({ request_id: frozen.requestId, schedule_item_id: frozen.itemId,
        approval_fingerprint: frozen.approvalFingerprint, preparation_id: frozen.preparation.id,
        presentation_id: frozen.preparation.presentation_id, source_fingerprint: frozen.preparation.source_fingerprint,
        checked_at: checkedAt.toISOString(), manifest: frozen.manifest, downloads });
    } catch (error) { return respondWithError(reply, error); }
  });
}
