import type { FastifyInstance, FastifyRequest } from 'fastify';
import { subject } from '@casl/ability';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { extractTokenFromHeader, verifyAccessToken } from '@/auth/jwt';
import { withCurrentMutationAuthorization, type MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { apiEndpoints } from '@/config/apiEndpoints';
import { getDatabase, schema } from '@/db';
import { liveAuthoringDrafts } from '@/db/live-authoring-schema';
import { canAccessContentMutationScope, ownershipForNewContent } from '@/rbac/content-ownership';
import { canReadScheduleRecord } from '@/rbac/schedule-read-authorization';
import { lockScreenTargetReferences } from '@/services/screen-deletion-guard';
import { liveSchedulingFingerprint, prepareLiveSchedule, type LiveSchedulingHints } from '@/services/live-scheduling';
import { createScheduleReservationService } from '@/services/scheduling/reservation-service';
import { assertLiveApprovalFingerprint, freezeLiveApproval, liveApprovalMetadata } from './live-publishing-helpers';
import { emitScheduleRequestsChanged } from '@/realtime/screens-namespace';
import { AppError } from '@/utils/app-error';
import { respondWithError } from '@/utils/errors';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const ids = z.array(uuid).transform(value => [...new Set(value)].sort());
const iso = z.string().datetime().transform(value => new Date(value).toISOString());
const paramsSchema = z.object({ id: uuid }).strict();
const reviewSchema = z.object({
  request_id: uuid, expected_revision: z.number().int().nonnegative(), name: z.string().trim().min(1).max(255),
  description: z.string().max(4000).default(''), timezone: z.string().min(1).max(100),
  live_session_id: uuid, presentation_id: uuid, preparation_id: uuid,
  start_at: iso, end_at: iso, priority: z.number().int().min(0).max(2), screen_ids: ids, screen_group_ids: ids,
}).strict();
const submitSchema = z.object({ request_id: uuid, expected_revision: z.number().int().positive(),
  expected_live_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), notes: z.string().max(4000).optional() }).strict();
const routeSchema = { schema: { tags: ['Live broadcasts'], security: [{ bearerAuth: [] }] } };
type Draft = typeof liveAuthoringDrafts.$inferSelect;
const conflict = (message: string): never => { throw new AppError({ statusCode: 409, code: 'LIVE_DRAFT_CONFLICT', message }); };
async function payloadFor(request: FastifyRequest) {
  const token = extractTokenFromHeader(request.headers.authorization);
  if (!token) throw AppError.unauthorized('Missing authorization header');
  return verifyAccessToken(token);
}
async function sourceHint(id: string) {
  const [row] = await getDatabase().select({ id: schema.liveSessions.id, presenter_user_id: schema.liveSessions.presenter_user_id,
    policy_revision: schema.liveSessions.policy_revision }).from(schema.liveSessions).where(eq(schema.liveSessions.id, id));
  return row;
}
function hintsFor(schedule: typeof schema.schedules.$inferSelect, hint: Awaited<ReturnType<typeof sourceHint>> | undefined): LiveSchedulingHints {
  return { schedule_id: schedule.id, schedule_revision: schedule.revision,
    presenter_user_ids: hint ? [hint.presenter_user_id] : [], sessions: hint ? [hint] : [] };
}
function assertDraftActor(context: MutationAuthorizationContext, draft: Draft) {
  // A draft UUID is a retry identity, never delegated write access.
  if (draft.created_by !== context.actor.userId) throw AppError.forbidden();
  if (!draft.schedule_id) throw new AppError({ statusCode: 409, code: 'LIVE_DRAFT_RETIRED', message: 'This draft was deleted. Start a new draft.' });
}
function assertScheduleAccess(context: MutationAuthorizationContext, schedule: typeof schema.schedules.$inferSelect) {
  const scoped = { can: (action: string) => context.ability.can(action as never, subject('Schedule', schedule) as never) };
  if (!canAccessContentMutationScope(context.actor, schedule, scoped, 'Schedule')) throw AppError.forbidden();
}

/** Atomic authoring prevents duplicate items, unknown-ID half-drafts and
 * response-loss retries from creating another schedule or approval hold. */
export async function liveScheduleDraftRoutes(fastify: FastifyInstance) {
  fastify.get(apiEndpoints.liveDrafts.get, routeSchema, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      const payload = await payloadFor(request), { id } = paramsSchema.parse(request.params);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        await lockScreenTargetReferences(context.executor);
        const [draft] = await context.executor.select().from(liveAuthoringDrafts).where(eq(liveAuthoringDrafts.id, id)).for('share');
        if (!draft) throw AppError.notFound('Live draft not found'); assertDraftActor(context, draft);
        const [schedule] = await context.executor.select().from(schema.schedules).where(eq(schema.schedules.id, draft.schedule_id!)).for('share');
        if (!schedule) conflict('The draft schedule is no longer available.');
        if (!canReadScheduleRecord(context.actor, schedule, context.ability)) throw AppError.forbidden();
        const items = await context.executor.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.schedule_id, schedule.id)).for('share');
        if (items.length !== 1 || items[0]?.source_kind !== 'LIVE') conflict('The draft items changed outside this wizard. Start a new draft.');
        const item = items[0], review = draft.last_review as { items?: Array<{ fallback?: { preparation_id?: string } }> };
        // Retry/edit metadata only. Actual bytes need current library access
        // through the prepared-preview endpoint; no signed URL is journalled.
        return { draft_id: id, draft_revision: draft.revision, submitted_request_id: draft.submitted_request_id, review_request_id: draft.last_request_id,
          can_edit: context.ability.can('update', subject('Schedule', schedule) as never) && context.ability.can('update', subject('ScheduleItem', item) as never),
          schedule_id: schedule.id, form: { name: schedule.name, description: schedule.description ?? '', timezone: schedule.timezone ?? 'UTC',
            live_session_id: item.live_session_id, presentation_id: item.presentation_id,
            preparation_id: review.items?.[0]?.fallback?.preparation_id ?? null, start_at: item.start_at.toISOString(), end_at: item.end_at.toISOString(),
            priority: item.priority, screen_ids: item.screen_ids, screen_group_ids: item.screen_group_ids } };
      }, { userLock: 'share' });
      return reply.send(result);
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.post(apiEndpoints.liveDrafts.review, routeSchema, async (request, reply) => {
    try {
      const payload = await payloadFor(request), { id } = paramsSchema.parse(request.params), input = reviewSchema.parse(request.body);
      try { Intl.DateTimeFormat(undefined, { timeZone: input.timezone }); }
      catch { throw AppError.badRequest('Invalid timezone'); }
      const hint = await sourceHint(input.live_session_id), fingerprint = liveSchedulingFingerprint(input);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const { executor, actor, ability } = context;
        if (!ability.can('create', 'Schedule') || !ability.can('create', 'ScheduleItem')) throw AppError.forbidden();
        await lockScreenTargetReferences(executor);
        await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`live-draft:${id}`},0))`);
        const [draft] = await executor.select().from(liveAuthoringDrafts).where(eq(liveAuthoringDrafts.id, id)).for('update');
        if (draft) assertDraftActor(context, draft);
        const replay = draft?.last_request_id === input.request_id;
        if (replay && (draft.last_request_fingerprint !== fingerprint || draft.revision !== input.expected_revision + 1)) conflict('This retry does not match the saved draft request. Reload the latest draft.');
        if (!replay && (draft?.revision ?? 0) !== input.expected_revision) conflict('The draft changed in another tab. Reload before editing.');
        if (draft?.submitted_request_id) conflict('This draft has been submitted. Open its request in Schedule Queue.');
        if (!replay && (Date.parse(input.start_at) <= Date.now() || Date.parse(input.end_at) <= Date.parse(input.start_at))) {
          throw AppError.badRequest('Choose a future start and a later end time.');
        }
        let schedule: typeof schema.schedules.$inferSelect;
        if (draft) {
          const [existing] = await executor.select().from(schema.schedules).where(eq(schema.schedules.id, draft.schedule_id!)).for('update');
          if (!existing) conflict('The draft schedule is no longer available.');
          schedule = existing; assertScheduleAccess(context, schedule);
          const [reference] = await executor.select({ id: schema.scheduleRequests.id }).from(schema.scheduleRequests)
            .where(eq(schema.scheduleRequests.schedule_id, schedule.id)).limit(1);
          const [published] = await executor.select({ id: schema.publishes.id }).from(schema.publishes).where(eq(schema.publishes.schedule_id, schedule.id)).limit(1);
          if (reference || published) conflict('This schedule already has request or publish history. Start a new draft.');
          if (!replay) {
            const changes = { name: input.name, description: input.description ?? null, timezone: input.timezone,
              start_at: new Date(input.start_at), end_at: new Date(input.end_at) };
            if (!ability.can('update', subject('Schedule', schedule) as never) ||
                !ability.can('update', subject('Schedule', { ...schedule, ...changes }) as never)) throw AppError.forbidden();
            [schedule] = await executor.update(schema.schedules).set({ ...changes,
              revision: sql`${schema.schedules.revision}+1`, updated_at: new Date() }).where(eq(schema.schedules.id, schedule.id)).returning();
          }
        } else {
          const values = { name: input.name, description: input.description ?? null, timezone: input.timezone,
            start_at: new Date(input.start_at), end_at: new Date(input.end_at), created_by: actor.userId,
            ...ownershipForNewContent(actor, ability, 'Schedule') };
          if (!ability.can('create', subject('Schedule', values) as never)) throw AppError.forbidden();
          [schedule] = await executor.insert(schema.schedules).values(values).returning();
        }
        const existingItems = await executor.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.schedule_id, schedule.id)).for('update');
        if ((draft && existingItems.length !== 1) || existingItems.some(item => item.source_kind !== 'LIVE')) conflict('The draft items changed outside this wizard. Start a new draft.');
        if (!replay) {
          const values = { source_kind: 'LIVE' as const, live_session_id: input.live_session_id, presentation_id: input.presentation_id,
            start_at: new Date(input.start_at), end_at: new Date(input.end_at), priority: input.priority,
            screen_ids: input.screen_ids, screen_group_ids: input.screen_group_ids };
          if (existingItems[0]) {
            if (!ability.can('update', subject('ScheduleItem', existingItems[0]) as never) ||
                !ability.can('update', subject('ScheduleItem', { ...existingItems[0], ...values }) as never)) throw AppError.forbidden();
            await executor.update(schema.scheduleItems).set(values).where(eq(schema.scheduleItems.id, existingItems[0].id));
          } else {
            if (!ability.can('create', subject('ScheduleItem', { ...values, schedule_id: schedule.id }) as never)) throw AppError.forbidden();
            await executor.insert(schema.scheduleItems).values({ ...values, schedule_id: schedule.id });
          }
        }
        const prepared = await prepareLiveSchedule(context, { scheduleId: schedule.id, identityHints: hintsFor(schedule, hint),
          fallbackPreparationIds: { [input.presentation_id]: input.preparation_id } });
        if (prepared.items.length !== 1) conflict('The live draft must contain exactly one item.');
        const [currentItem] = await executor.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, prepared.items[0]!.policy.schedule_item_id));
        const review = { draft_id: id, draft_revision: draft ? draft.revision + (replay ? 0 : 1) : 1,
          can_edit: ability.can('update', subject('Schedule', schedule) as never) && ability.can('update', subject('ScheduleItem', currentItem!) as never),
          schedule_id: schedule.id, schedule_revision: schedule.revision, approval_fingerprint: prepared.fingerprint,
          items: prepared.items.map(item => item.policy) };
        if (replay) {
          const prior = draft.last_review as { approval_fingerprint?: unknown };
          if (prior.approval_fingerprint !== review.approval_fingerprint) throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_STALE',
            message: 'The reviewed source, fallback or audience changed. Review again before submitting.' });
          return review;
        }
        const values = { schedule_id: schedule.id, created_by: actor.userId, revision: review.draft_revision,
          last_request_id: input.request_id, last_request_fingerprint: fingerprint, last_review: review, updated_at: new Date() };
        if (draft) await executor.update(liveAuthoringDrafts).set(values).where(eq(liveAuthoringDrafts.id, id));
        else await executor.insert(liveAuthoringDrafts).values({ ...values, id });
        return review;
      }, { userLock: 'share', additionalUserIdsToLock: hint ? [hint.presenter_user_id] : [] });
      return reply.send(result);
    } catch (error) { return respondWithError(reply, error); }
  });

  fastify.post(apiEndpoints.liveDrafts.submit, routeSchema, async (request, reply) => {
    try {
      const payload = await payloadFor(request), { id } = paramsSchema.parse(request.params), input = submitSchema.parse(request.body);
      const [untrusted] = await getDatabase().select().from(liveAuthoringDrafts).where(eq(liveAuthoringDrafts.id, id));
      const prior = untrusted?.last_review as { items?: Array<{ live_session_id?: string }> } | undefined;
      const sourceId = prior?.items?.[0]?.live_session_id;
      const hint = sourceId && z.string().uuid().safeParse(sourceId).success ? await sourceHint(sourceId) : undefined;
      const fingerprint = liveSchedulingFingerprint(input);
      const result = await withCurrentMutationAuthorization(payload, async context => {
        const { executor, actor, ability } = context;
        if (!ability.can('create', 'ScheduleRequest')) throw AppError.forbidden();
        await lockScreenTargetReferences(executor);
        await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`live-draft:${id}`},0))`);
        const [draft] = await executor.select().from(liveAuthoringDrafts).where(eq(liveAuthoringDrafts.id, id)).for('update');
        if (!draft) throw AppError.notFound('Live draft not found'); assertDraftActor(context, draft);
        if (draft.revision !== input.expected_revision) conflict('The draft changed. Review its latest version before submitting.');
        const [schedule] = await executor.select().from(schema.schedules).where(eq(schema.schedules.id, draft.schedule_id!)).for('update');
        if (!schedule) conflict('The draft schedule is no longer available.'); assertScheduleAccess(context, schedule);
        if (!ability.can('create', subject('ScheduleRequest', { schedule_id: schedule.id, requested_by: actor.userId }) as never)) throw AppError.forbidden();
        if (draft.submitted_request_id) {
          if (draft.submission_request_id !== input.request_id || draft.submission_fingerprint !== fingerprint) conflict('This draft already has a submitted request. Open Schedule Queue.');
          const [existing] = await executor.select().from(schema.scheduleRequests).where(and(eq(schema.scheduleRequests.id, draft.submitted_request_id), eq(schema.scheduleRequests.requested_by, actor.userId)));
          if (!existing) conflict('The submitted request is no longer available.');
          return existing;
        }
        const [other] = await executor.select({ id: schema.scheduleRequests.id }).from(schema.scheduleRequests).where(eq(schema.scheduleRequests.schedule_id, schedule.id)).limit(1);
        if (other) conflict('This draft already has request history. Open Schedule Queue.');
        const review = draft.last_review as { approval_fingerprint: string; items: Array<{ fallback: { preparation_id: string; manifest: { presentation: { id: string } } } }> };
        if (review.approval_fingerprint !== input.expected_live_fingerprint) conflict('Submit the exact reviewed policy.');
        const fallback = review.items[0]?.fallback;
        if (!fallback) conflict('The draft review is invalid. Review again.');
        const prepared = await prepareLiveSchedule(context, { scheduleId: schedule.id, identityHints: hintsFor(schedule, hint),
          fallbackPreparationIds: { [fallback.manifest.presentation.id]: fallback.preparation_id } });
        assertLiveApprovalFingerprint(prepared, input.expected_live_fingerprint);
        const [created] = await executor.insert(schema.scheduleRequests).values({ schedule_id: schedule.id, notes: input.notes,
          requested_by: actor.userId, schedule_payload: { live_approval: freezeLiveApproval(prepared) } }).returning();
        await createScheduleReservationService().acquireHoldsForRequest({ scheduleRequestId: created.id, scheduleId: schedule.id,
          ownerUserId: actor.userId, allowPrivateRefs: ability.can('manage', 'Schedule'),
          live: { context, prepared, expectedFingerprint: prepared.fingerprint } }, executor);
        await executor.update(liveAuthoringDrafts).set({ submission_request_id: input.request_id, submission_fingerprint: fingerprint,
          submitted_request_id: created.id, updated_at: new Date() }).where(eq(liveAuthoringDrafts.id, id));
        const [updated] = await executor.select().from(schema.scheduleRequests).where(eq(schema.scheduleRequests.id, created.id));
        return updated ?? created;
      }, { userLock: 'share', additionalUserIdsToLock: hint ? [hint.presenter_user_id] : [] });
      emitScheduleRequestsChanged(fastify);
      return reply.send({ id: result.id, schedule_id: result.schedule_id, status: result.status, notes: result.notes,
        live_approval: liveApprovalMetadata(result.schedule_payload) });
    } catch (error) { return respondWithError(reply, error); }
  });
}
