import { z } from 'zod';
import type { MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { liveFallbackPreparationIdsSchema } from '@/schemas/schedule';
import { liveSchedulingFingerprint, prepareLiveSchedule, type FrozenLivePolicy, type LiveSchedulingHints, type PreparedLiveSchedule } from '@/services/live-scheduling';
import { AppError } from '@/utils/app-error';
import { and, eq, isNotNull } from 'drizzle-orm';
import { schema, type DbExecutor } from '@/db';
import { frozenLivePolicySchema } from '@/screens/live-snapshot-audience';

const storedLiveApprovalSchema = z.object({
  version: z.literal(1), approval_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  fallback_preparation_ids: liveFallbackPreparationIdsSchema,
  items: z.array(frozenLivePolicySchema).min(1),
}).strict();
export type LiveApproval = { version: 1; approval_fingerprint: string; fallback_preparation_ids: Record<string, string>; items: FrozenLivePolicy[] };

export function liveApprovalMetadata(payload: unknown): LiveApproval | null {
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).live_approval : undefined;
  const result = storedLiveApprovalSchema.safeParse(raw);
  if (!result.success) return null;
  const { items, approval_fingerprint } = result.data;
  const first = items[0]!;
  if (new Set(items.map(policy => policy.schedule_item_id)).size !== items.length ||
      items.some(policy => policy.schedule_id !== first.schedule_id || policy.schedule_revision !== first.schedule_revision) ||
      liveSchedulingFingerprint({ schedule_id: first.schedule_id, schedule_revision: first.schedule_revision,
        items: items.map(policy => ({ policy, item_fingerprint: liveSchedulingFingerprint(policy) })) }) !== approval_fingerprint) return null;
  return result.data;
}
export function freezeLiveApproval(prepared: PreparedLiveSchedule): LiveApproval | undefined {
  if (!prepared.items.length) return undefined;
  return { version: 1, approval_fingerprint: prepared.fingerprint,
    fallback_preparation_ids: Object.fromEntries(prepared.items.map(({ policy }) => [policy.fallback.manifest.presentation.id, policy.fallback.preparation_id])),
    items: prepared.items.map(item => item.policy) };
}
export function assertLiveApprovalFingerprint(prepared: PreparedLiveSchedule, expected: string | undefined) {
  if (prepared.items.length && !expected) throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_REQUIRED',
    message: 'Review the live preflight before publishing.' });
  if (expected && expected !== prepared.fingerprint) throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_STALE',
    message: 'Live policy changed after review. Refresh the preflight and obtain fresh approval.' });
}
export async function prepareReviewedLiveSchedule(context: MutationAuthorizationContext, params: Parameters<typeof prepareLiveSchedule>[1]) {
  try { return await prepareLiveSchedule(context, params); }
  catch (error) {
    if (error instanceof AppError && error.statusCode === 422 && error.code.startsWith('LIVE_')) {
      throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_STALE',
        message: 'A reviewed live source, fallback or target is no longer eligible. Refresh and obtain fresh approval.',
        details: { reason: error.code } });
    }
    throw error;
  }
}
export async function prepareStoredLiveApproval(context: MutationAuthorizationContext, scheduleId: string,
  hints: LiveSchedulingHints, payload: unknown,
  scope: { explicitScreenIds?: string[]; explicitScreenGroupIds?: string[] } = {}): Promise<PreparedLiveSchedule | undefined> {
  const stored = liveApprovalMetadata(payload);
  const hasStored = payload && typeof payload === 'object' && Object.hasOwn(payload, 'live_approval');
  if (!stored && !hints.sessions.length && !hasStored) return undefined;
  if (!stored && hasStored) throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_STALE', message: 'The stored live review is invalid. Cancel and resubmit for fresh approval.' });
  if (!stored) throw new AppError({ statusCode: 409, code: 'LIVE_APPROVAL_REQUIRED', message: 'Submit this live schedule with an immutable fallback for approval.' });
  const prepared = await prepareReviewedLiveSchedule(context, { scheduleId, identityHints: hints, fallbackPreparationIds: stored.fallback_preparation_ids, ...scope });
  assertLiveApprovalFingerprint(prepared, stored.approval_fingerprint);
  return prepared;
}

/** Publication retries read frozen identity, never reapprove a mutable draft. */
export async function existingRequestPublish(executor: DbExecutor, request: { id: string; status: string; schedule_id: string }) {
  if (request.status !== 'PUBLISHED') return undefined;
  const rows = await executor.select({ publish_id: schema.scheduleReservations.publish_id }).from(schema.scheduleReservations)
    .where(and(eq(schema.scheduleReservations.schedule_request_id, request.id), isNotNull(schema.scheduleReservations.publish_id)));
  // LIVE history survives permitted historical target cleanup; ordinary screen
  // reservation rows alone are not a durable identity after that cleanup.
  const liveRows = await executor.select({ publish_id: schema.liveScheduleOccurrences.publish_id }).from(schema.liveScheduleOccurrences)
    .where(and(eq(schema.liveScheduleOccurrences.schedule_request_id, request.id), isNotNull(schema.liveScheduleOccurrences.publish_id)));
  const ids = [...new Set([...rows, ...liveRows].map(row => row.publish_id!).filter(Boolean))];
  if (ids.length !== 1) throw AppError.conflict('Published request has no unique publication record. Refresh and contact an administrator.');
  const [publish] = await executor.select().from(schema.publishes).where(eq(schema.publishes.id, ids[0]!));
  if (!publish || publish.schedule_id !== request.schedule_id) throw AppError.conflict('The request publication record could not be found.');
  return publish;
}
