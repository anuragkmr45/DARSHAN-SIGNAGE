import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { apiEndpoints } from '@/config/apiEndpoints';
import { schema } from '@/db';
import { queueLiveFallbackPreparation } from '@/jobs';
import { collectLiveFallbackSource, readCurrentPreparedLiveFallback } from '@/services/live-scheduling';
import { assertCanPrepareLiveFallback } from '@/services/live-fallback-authorization';
import { getPresignedUrl } from '@/s3';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';

const logger = createLogger('live-fallback-routes');
const createSchema = z.object({ presentation_id: z.string().uuid(), retry_failed: z.boolean().default(false) }).strict();
const paramsSchema = z.object({ id: z.string().uuid() }).strict();
const routeSchema = { schema: { tags: ['Live broadcasts'], security: [{ bearerAuth: [] }] } };
type Preparation = typeof schema.liveFallbackPreparations.$inferSelect;
const serialize = (row: Preparation, dispatchPending = false) => ({ id: row.id, presentation_id: row.presentation_id,
  state: row.state, source_fingerprint: row.source_fingerprint, failure_code: row.failure_code,
  manifest: row.state === 'READY' ? row.manifest : null, dispatch_pending: dispatchPending,
  created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() });

async function currentPayload(request: FastifyRequest) {
  const token = extractTokenFromHeader(request.headers.authorization);
  if (!token) throw AppError.unauthorized('Missing authorization header');
  return verifyAccessToken(token);
}

/** Preparation is durable before dispatch. A queue outage leaves PENDING work
 * for the worker's periodic reconciliation, rather than losing accepted work. */
export async function liveFallbackRoutes(fastify: FastifyInstance) {
  fastify.post(apiEndpoints.liveFallbacks.create, routeSchema, async (request, reply) => {
    try {
      const payload = await currentPayload(request), input = createSchema.parse(request.body);
      const preparation = await withCurrentMutationAuthorization(payload, async context => {
        assertCanPrepareLiveFallback(context);
        const source = await collectLiveFallbackSource(context, input.presentation_id);
        // Coalesce repeated clicks/retries only within the current creator and
        // exact graph revision. Different users never acquire each other's work.
        const key = `live-fallback:${context.actor.userId}:${input.presentation_id}:${source.source_fingerprint}`;
        await context.executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`);
        const [existing] = await context.executor.select().from(schema.liveFallbackPreparations).where(and(
          eq(schema.liveFallbackPreparations.presentation_id, input.presentation_id),
          eq(schema.liveFallbackPreparations.created_by, context.actor.userId),
          eq(schema.liveFallbackPreparations.source_fingerprint, source.source_fingerprint),
          inArray(schema.liveFallbackPreparations.state, ['PENDING', 'PROCESSING', 'READY', 'FAILED'])
        )).orderBy(desc(schema.liveFallbackPreparations.created_at)).limit(1).for('update');
        if (existing) {
          if (existing.state !== 'FAILED' || !input.retry_failed) return existing;
          // Persist retry intent before dispatch, so a queue outage cannot lose
          // an explicit retry while leaving an unreconcilable FAILED row.
          const [retry] = await context.executor.update(schema.liveFallbackPreparations).set({
            state: 'PENDING', failure_code: null, claim_token: null, lease_expires_at: null, updated_at: new Date(),
          }).where(eq(schema.liveFallbackPreparations.id, existing.id)).returning();
          return retry;
        }
        const [created] = await context.executor.insert(schema.liveFallbackPreparations).values({
          presentation_id: input.presentation_id, created_by: context.actor.userId,
          source_fingerprint: source.source_fingerprint, source_graph: source.source_graph,
        }).returning();
        return created;
      }, { userLock: 'share' });
      let dispatchPending = false;
      if (preparation.state === 'PENDING' || preparation.state === 'PROCESSING') {
        try { await queueLiveFallbackPreparation({ preparationId: preparation.id, retryFailed: input.retry_failed }); }
        catch (error) {
          dispatchPending = true;
          logger.warn({ preparationId: preparation.id, error }, 'Durable live fallback is awaiting queue dispatch');
        }
      }
      return reply.code(['READY', 'FAILED'].includes(preparation.state) ? 200 : 202).send(serialize(preparation, dispatchPending));
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.get(apiEndpoints.liveFallbacks.get, routeSchema, async (request, reply) => {
    try {
      const payload = await currentPayload(request), { id } = paramsSchema.parse(request.params);
      const row = await withCurrentMutationAuthorization(payload, async context => {
        assertCanPrepareLiveFallback(context);
        const [preparation] = await context.executor.select().from(schema.liveFallbackPreparations)
          .where(eq(schema.liveFallbackPreparations.id, id));
        if (!preparation) throw AppError.notFound('Live fallback preparation not found');
        // Re-check current library access, including secondary departments and
        // conditional grants. The preparation ID is not a library bypass.
        const current = await collectLiveFallbackSource(context, preparation.presentation_id);
        if (current.source_fingerprint !== preparation.source_fingerprint) throw new AppError({
          statusCode: 409, code: 'LIVE_APPROVAL_STALE', message: 'The fallback changed. Prepare its current revision again.',
        });
        return preparation;
      }, { userLock: 'share' });
      return reply.send(serialize(row));
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.get(apiEndpoints.liveFallbacks.preview, routeSchema, async (request, reply) => {
    // This response contains short-lived media credentials. Never allow a
    // shared browser/proxy cache to serve it after an account change.
    reply.header('Cache-Control', 'private, no-store');
    try {
      const payload = await currentPayload(request), { id } = paramsSchema.parse(request.params);
      const { preparation, manifest } = await withCurrentMutationAuthorization(payload, async context => {
        assertCanPrepareLiveFallback(context);
        const [row] = await context.executor.select().from(schema.liveFallbackPreparations)
          .where(eq(schema.liveFallbackPreparations.id, id));
        if (!row) throw AppError.notFound('Live fallback preparation not found');
        return readCurrentPreparedLiveFallback(context, row.presentation_id, id);
      }, { userLock: 'share' });
      // No storage/network operation runs under identity or graph locks. These
      // URLs are response-only; final approval still rechecks the current graph.
      const checkedAt = new Date(), expiresAt = new Date(checkedAt.getTime() + 15 * 60_000).toISOString();
      const downloads = [];
      try {
        for (const asset of manifest.assets) downloads.push({
          asset_id: asset.id, cache_key: asset.cache_key, sha256: asset.sha256,
          size: asset.size, content_type: asset.content_type, expires_at: expiresAt,
          url: await getPresignedUrl(asset.bucket, asset.object_key, {
            expiresIn: 900, responseContentType: asset.content_type, responseContentDisposition: 'inline', audience: 'cms',
          }),
        });
      } catch {
        // SDK failures may contain a signed URL. Log only the preparation ID.
        logger.warn({ preparationId: id }, 'Prepared fallback preview signing is unavailable');
        throw new AppError({ statusCode: 503, code: 'LIVE_FALLBACK_PREVIEW_UNAVAILABLE',
          message: 'The prepared fallback preview is unavailable. Please try again.' });
      }
      return reply.send({ preparation_id: preparation.id, presentation_id: preparation.presentation_id,
        source_fingerprint: preparation.source_fingerprint, checked_at: checkedAt.toISOString(), manifest, downloads });
    } catch (error) { return respondWithError(reply, error); }
  });
}
