import { createHash } from 'node:crypto';
import { z } from 'zod';
import { frozenLivePolicySchema, frozenLiveSnapshotItemSchema } from '@/screens/live-snapshot-audience';

export const liveUuid = z.string().uuid().transform(value => value.toLowerCase());
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.string().datetime({ offset: true });
export const liveRunStateSchema = z.enum(['PREPARING', 'RUNNING', 'STOPPING', 'STOPPED']);
export const liveFallbackReadinessSchema = z.object({ preparation_id: liveUuid,
  source_fingerprint: sha, asset_set_sha256: sha, ready: z.literal(true) }).strict();
export const liveOccurrenceSelectorSchema = z.object({ publish_id: liveUuid, schedule_item_id: liveUuid,
  runtime_session_id: liveUuid }).strict();
export const liveStartSchema = z.object({ request_id: liveUuid, runtime_session_id: liveUuid,
  expected_authority_epoch: liveUuid,
  expected_control_revision: sequence, expected_item_fingerprint: sha }).strict();
export const liveControlSchema = z.object({ request_id: liveUuid, expected_control_revision: sequence,
  expected_authority_epoch: liveUuid,
  reason: z.string().trim().min(1).max(1000), run_id: liveUuid.optional(), generation: sequence.optional() }).strict();
export const liveStopSchema = liveControlSchema.extend({ mode: z.enum(['PRESENTER', 'ADMIN']),
  runtime_session_id: liveUuid.optional() }).superRefine((value, context) => {
  if (value.mode === 'PRESENTER' && (!value.run_id || !value.generation || !value.runtime_session_id)) {
    context.addIssue({ code: 'custom', message: 'Presenter stop requires its exact run, generation and document session.' });
  }
});
export const livePresenterAdmissionSchema = z.object({ request_id: liveUuid, runtime_session_id: liveUuid }).strict();
export const liveDeviceAdmissionSchema = liveOccurrenceSelectorSchema.extend({ request_id: liveUuid,
  run_id: liveUuid, generation: sequence, fallback: liveFallbackReadinessSchema }).strict();
export const liveAdmissionActionSchema = z.object({ request_id: liveUuid, runtime_session_id: liveUuid,
  run_id: liveUuid, generation: sequence, fallback: liveFallbackReadinessSchema.optional() }).strict();
export const liveEpochChallengeSchema = z.object({ nonce: liveUuid }).strict();
export const liveEpochResponseSchema = z.object({ version: z.literal(1), nonce: liveUuid,
  epoch_id: liveUuid, server_now: instant }).strict();

export const liveAuthorityCheckSchema = z.object({ action: z.enum(['CREATE', 'RENEW', 'TICKET']),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => Buffer.from(value, 'base64url').toString('base64url') === value),
  id: liveUuid, run_id: liveUuid, generation: sequence,
  node_instance_id: liveUuid, authority_epoch: liveUuid, operation_revision: sequence }).strict();
export const liveAudioSchema = z.object({ microphone: z.boolean(), screen_share_audio: z.boolean() }).strict();
export const liveAuthorityGrantSchema = liveAuthorityCheckSchema.extend({ allowed: z.literal(true),
  participant_id: z.string().min(1).max(255), role: z.enum(['presenter', 'receiver']), audio: liveAudioSchema,
  lease_ms: z.number().int().positive().max(10_000), window_remaining_ms: z.number().int().positive().max(2_147_483_647) }).strict();

export const liveRunSummarySchema = z.object({ id: liveUuid, generation: sequence, state: liveRunStateSchema,
  node_instance_id: liveUuid, presenter_participant_id: z.string(), created_at: instant,
  stopped_at: instant.nullable(), owns_current_attempt: z.boolean() }).strict();
export const liveOccurrenceSummarySchema = z.object({ id: liveUuid, publish_id: liveUuid,
  schedule_item_id: liveUuid, live_session_id: liveUuid, start_at: instant, end_at: instant,
  control_revision: sequence, enabled: z.boolean(), item_fingerprint: sha,
  presenter_user_id: liveUuid, microphone: z.boolean(), screen_share_audio: z.boolean(),
  screen_ids: z.array(liveUuid), run: liveRunSummarySchema.nullable(),
  can_start: z.boolean(), can_stop: z.boolean(), can_manage: z.boolean() }).strict();
export const liveRuntimePreflightReasonSchema = z.enum(['READY', 'OCCURRENCE_UNAVAILABLE', 'MEDIA_UNAVAILABLE',
  'MEDIA_PREPARING', 'MEDIA_CAPACITY', 'RUNTIME_CAPACITY']);
export const liveRuntimePreflightSchema = z.object({ version: z.literal(1), occurrence_id: liveUuid,
  authority_epoch: liveUuid, control_revision: sequence, item_fingerprint: sha, checked_at: instant,
  business_eligible: z.boolean(), media_ready: z.boolean(), capacity_ready: z.boolean(), ready: z.boolean(),
  reason: liveRuntimePreflightReasonSchema }).strict().superRefine((value, context) => {
  const ready = value.business_eligible && value.media_ready && value.capacity_ready;
  if (value.ready !== ready || (value.reason === 'READY') !== ready) {
    context.addIssue({ code: 'custom', message: 'Live preflight readiness is inconsistent.' });
  }
  if (!value.business_eligible && value.reason !== 'OCCURRENCE_UNAVAILABLE') {
    context.addIssue({ code: 'custom', message: 'Unavailable occurrence requires its explicit reason.' });
  }
});
export const liveDeviceStateSchema = z.object({ version: z.literal(1), authority_epoch: liveUuid,
  server_now: instant, live_version: z.string().nullable(),
  availability: z.enum(['READY', 'NOT_RUNNING', 'PREPARING', 'STOPPING', 'DISABLED', 'ENDED', 'EMERGENCY', 'UNAVAILABLE']),
  occurrence_id: liveUuid, publish_id: liveUuid, schedule_id: liveUuid, schedule_item_id: liveUuid,
  start_at: instant, end_at: instant, screen_ids: z.array(liveUuid).min(1).max(25),
  control_revision: sequence, enabled: z.boolean(), policy_status: z.enum(['VALID', 'INVALID']), policy: frozenLivePolicySchema.nullable(),
  run: liveRunSummarySchema.nullable() }).strict();
const liveDownloadSchema = z.object({ asset_id: liveUuid, cache_key: z.string(), sha256: sha, size: z.number().int().positive(),
  content_type: z.string(), url: z.string().url(), expires_at: instant }).strict();
export const liveDiscoveryEntrySchema = z.object({ state: liveDeviceStateSchema,
  item: frozenLiveSnapshotItemSchema.extend({ live_fallback_downloads: z.array(liveDownloadSchema).optional(),
    live_fallback_download_status: z.enum(['AVAILABLE', 'UNAVAILABLE']).optional(), live_fallback_policy_status: z.literal('INVALID').optional() }).strict().nullable() }).strict();
export const liveBlockedWindowSchema = z.object({ occurrence_id: liveUuid, publish_id: liveUuid, schedule_id: liveUuid,
  schedule_item_id: liveUuid, start_at: instant, end_at: instant, screen_ids: z.array(liveUuid).min(1).max(25) }).strict();
export const liveDiscoverySchema = z.object({ version: z.literal(1), authority_epoch: liveUuid, server_now: instant,
  live_version: z.string().nullable(), current: liveDiscoveryEntrySchema.nullable(), next: liveDiscoveryEntrySchema.nullable(),
  blocked_windows: z.array(liveBlockedWindowSchema) }).strict();
export type LiveDeviceIdentity = { screenId: string; serial: string; runtimeSessionId: string };

const admissionIdentity = { version: z.literal(1), authority_epoch: liveUuid, server_now: instant,
  live_version: z.string().nullable(), occurrence_id: liveUuid, publish_id: liveUuid, schedule_item_id: liveUuid,
  run_id: liveUuid, generation: sequence, admission_id: liveUuid, role: z.enum(['presenter', 'receiver']),
  participant_id: z.string(), presenter_participant_id: z.string(), presenter_user_id: liveUuid,
  microphone: z.boolean(), screen_share_audio: z.boolean() };
/** Creation commits intent only. No lease/ticket is inferred from a durable row. */
export const liveAdmissionPendingSchema = z.object({ ...admissionIdentity,
  status: z.enum(['PREPARING', 'READY']), retry_after_ms: z.literal(500) }).strict();
/** Only a fresh successful media operation may produce this response. */
export const liveAdmissionGrantSchema = z.object({ ...admissionIdentity, status: z.literal('AUTHORIZED'),
  lease_ms: z.number().int().positive().max(10_000), window_remaining_ms: z.number().int().positive(),
  renew_after_ms: z.literal(3000), signaling: z.object({ url: z.string().url(), ticket: z.string().min(1) }).strict().optional() }).strict();
export const liveObservationSchema = z.object({ runtime_session_id: liveUuid, run_id: liveUuid,
  generation: sequence, sequence, connection: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED']),
  subscription: z.enum(['NONE', 'SUBSCRIBING', 'SUBSCRIBED']), frame: z.enum(['NONE', 'READY']),
  audio: z.enum(['NONE', 'READY', 'DEGRADED', 'MUTED']), fallback_ready: z.boolean(),
  fallback_reason: z.string().max(160).nullable() }).strict();

/** Must be mirrored exactly by the player: every transitive dependency included. */
export function hashLiveFallbackAssetSet(assets: ReadonlyArray<{
  id: string; cache_key: string; sha256: string; size: number; content_type: string;
}>): string {
  const rows = [...assets].sort((a, b) => a.id.toLowerCase() < b.id.toLowerCase() ? -1 : a.id.toLowerCase() > b.id.toLowerCase() ? 1 : 0)
    .map(asset => ({ asset_id: asset.id.toLowerCase(), cache_key: asset.cache_key,
      sha256: asset.sha256, size: asset.size, content_type: asset.content_type }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}
export type LiveRuntimeOccurrence = z.infer<typeof liveOccurrenceSummarySchema>;
export type LiveRuntimePreflight = z.infer<typeof liveRuntimePreflightSchema>;
export type LiveRuntimeDeviceState = z.infer<typeof liveDeviceStateSchema>;
export type LiveAdmissionPending = z.infer<typeof liveAdmissionPendingSchema>;
export type LiveAdmissionGrant = z.infer<typeof liveAdmissionGrantSchema>;
export type LiveAuthorityCheck = z.infer<typeof liveAuthorityCheckSchema>;
export type LiveAuthorityGrant = z.infer<typeof liveAuthorityGrantSchema>;
export type LiveFallbackReadiness = z.infer<typeof liveFallbackReadinessSchema>;
