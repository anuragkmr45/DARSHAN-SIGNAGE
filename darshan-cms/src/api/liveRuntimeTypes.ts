import { z } from 'zod';

export const liveUuidSchema = z.string().uuid().transform(value => value.toLowerCase());
const sequence = z.number().int().positive().safe(), instant = z.string().datetime({ offset: true });
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const audience = z.array(liveUuidSchema).min(1).max(25).refine(ids => new Set(ids).size === ids.length);
export const liveRunSummarySchema = z.object({ id: liveUuidSchema, generation: sequence,
  state: z.enum(['PREPARING', 'RUNNING', 'STOPPING', 'STOPPED']), node_instance_id: liveUuidSchema,
  presenter_participant_id: z.string().min(1), created_at: instant, stopped_at: instant.nullable(), owns_current_attempt: z.boolean(),
}).strict().refine(run => run.presenter_participant_id === `presenter_${run.id}`);
export const liveRuntimeOccurrenceSchema = z.object({ id: liveUuidSchema, publish_id: liveUuidSchema,
  schedule_item_id: liveUuidSchema, live_session_id: liveUuidSchema, start_at: instant, end_at: instant,
  control_revision: sequence, enabled: z.boolean(), item_fingerprint: sha, presenter_user_id: liveUuidSchema,
  microphone: z.boolean(), screen_share_audio: z.boolean(), screen_ids: audience, run: liveRunSummarySchema.nullable(),
  can_start: z.boolean(), can_stop: z.boolean(), can_manage: z.boolean(),
}).strict();
export const liveRuntimeListSchema = z.object({ items: z.array(liveRuntimeOccurrenceSchema), total: z.number().int().nonnegative().safe(),
  page: sequence, page_size: z.number().int().min(1).max(100), from: instant, until: instant,
}).strict().refine(value => value.items.length <= value.page_size && Date.parse(value.until) > Date.parse(value.from));
export const liveRuntimePreflightReasonSchema = z.enum(['READY', 'OCCURRENCE_UNAVAILABLE', 'MEDIA_UNAVAILABLE',
  'MEDIA_PREPARING', 'MEDIA_CAPACITY', 'RUNTIME_CAPACITY']);
export const liveRuntimePreflightSchema = z.object({ version: z.literal(1), occurrence_id: liveUuidSchema,
  authority_epoch: liveUuidSchema, control_revision: sequence, item_fingerprint: sha, checked_at: instant,
  business_eligible: z.boolean(), media_ready: z.boolean(), capacity_ready: z.boolean(), ready: z.boolean(),
  reason: liveRuntimePreflightReasonSchema }).strict().superRefine((value, context) => {
  const ready = value.business_eligible && value.media_ready && value.capacity_ready;
  if (value.ready !== ready || (value.reason === 'READY') !== ready) context.addIssue({ code: 'custom', message: 'Inconsistent live preflight.' });
  if (!value.business_eligible && value.reason !== 'OCCURRENCE_UNAVAILABLE') context.addIssue({ code: 'custom', message: 'Invalid unavailable reason.' });
});
export const liveEpochResponseSchema = z.object({ version: z.literal(1), nonce: liveUuidSchema, epoch_id: liveUuidSchema, server_now: instant }).strict();
export const liveStartInputSchema = z.object({ request_id: liveUuidSchema, runtime_session_id: liveUuidSchema, expected_authority_epoch: liveUuidSchema,
  expected_control_revision: sequence, expected_item_fingerprint: sha }).strict();
export const liveControlInputSchema = z.object({ request_id: liveUuidSchema, expected_authority_epoch: liveUuidSchema, expected_control_revision: sequence,
  reason: z.string().trim().min(1).max(1000), run_id: liveUuidSchema.optional(), generation: sequence.optional() }).strict();
export const liveStopInputSchema = liveControlInputSchema.extend({ mode: z.enum(['PRESENTER', 'ADMIN']), runtime_session_id: liveUuidSchema.optional() })
  .superRefine((input, context) => { if (input.mode === 'PRESENTER' && (!input.run_id || !input.generation || !input.runtime_session_id)) context.addIssue({ code: 'custom', message: 'Presenter stop requires its exact run and document session.' }); });
export const liveAdmissionActionInputSchema = z.object({ request_id: liveUuidSchema, runtime_session_id: liveUuidSchema,
  run_id: liveUuidSchema, generation: sequence }).strict();
export const livePresenterAdmissionInputSchema = z.object({ request_id: liveUuidSchema, runtime_session_id: liveUuidSchema }).strict();
const identity = { version: z.literal(1), authority_epoch: liveUuidSchema, server_now: instant, live_version: z.string().nullable(),
  occurrence_id: liveUuidSchema, publish_id: liveUuidSchema, schedule_item_id: liveUuidSchema, run_id: liveUuidSchema, generation: sequence,
  admission_id: liveUuidSchema, role: z.literal('presenter'), participant_id: z.string().min(1), presenter_participant_id: z.string().min(1),
  presenter_user_id: liveUuidSchema, microphone: z.boolean(), screen_share_audio: z.boolean() };
const presenterIdentity = (value: { participant_id: string; presenter_participant_id: string; run_id: string }) =>
  value.participant_id === `presenter_${value.run_id}` && value.presenter_participant_id === value.participant_id;
export const liveAdmissionPendingSchema = z.object({ ...identity, status: z.enum(['PREPARING', 'READY']), retry_after_ms: z.literal(500) }).strict().refine(presenterIdentity);
const signalingUrl = z.string().url().refine(raw => { try { const value = new URL(raw); return value.protocol === 'wss:' && !value.username && !value.password && !value.search && !value.hash && value.pathname === '/'; } catch { return false; } });
export const liveAdmissionGrantSchema = z.object({ ...identity, status: z.literal('AUTHORIZED'),
  lease_ms: z.number().int().positive().max(10_000), window_remaining_ms: sequence, renew_after_ms: z.literal(3000),
  signaling: z.object({ url: signalingUrl, ticket: z.string().min(1).max(8192) }).strict().optional() }).strict().refine(presenterIdentity);
export const liveObservationInputSchema = z.object({ runtime_session_id: liveUuidSchema, run_id: liveUuidSchema,
  generation: sequence, sequence, connection: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED']),
  subscription: z.enum(['NONE', 'SUBSCRIBING', 'SUBSCRIBED']), frame: z.enum(['NONE', 'READY']),
  audio: z.enum(['NONE', 'READY', 'DEGRADED', 'MUTED']), fallback_ready: z.boolean(), fallback_reason: z.string().max(160).nullable() }).strict();
export const liveObservationResultSchema = z.object({ accepted: z.boolean(), sequence, server_received_at: instant }).strict();
// Explicit required wire types: this project has strictNullChecks disabled,
// which makes z.infer object fields optional despite runtime validation.
export interface LiveRunSummary { id: string; generation: number; state: 'PREPARING' | 'RUNNING' | 'STOPPING' | 'STOPPED';
  node_instance_id: string; presenter_participant_id: string; created_at: string; stopped_at: string | null; owns_current_attempt: boolean }
export interface LiveRuntimeOccurrence { id: string; publish_id: string; schedule_item_id: string; live_session_id: string;
  start_at: string; end_at: string; control_revision: number; enabled: boolean; item_fingerprint: string; presenter_user_id: string;
  microphone: boolean; screen_share_audio: boolean; screen_ids: string[]; run: LiveRunSummary | null; can_start: boolean; can_stop: boolean; can_manage: boolean }
export type LiveRuntimePreflightReason = z.infer<typeof liveRuntimePreflightReasonSchema>;
export interface LiveRuntimePreflight { version: 1; occurrence_id: string; authority_epoch: string; control_revision: number;
  item_fingerprint: string; checked_at: string; business_eligible: boolean; media_ready: boolean; capacity_ready: boolean;
  ready: boolean; reason: LiveRuntimePreflightReason }
export interface LiveRuntimeList { items: LiveRuntimeOccurrence[]; total: number; page: number; page_size: number; from: string; until: string }
export interface LiveEpochResponse { version: 1; nonce: string; epoch_id: string; server_now: string }
export interface LiveStartInput { request_id: string; runtime_session_id: string; expected_authority_epoch: string; expected_control_revision: number; expected_item_fingerprint: string }
export interface LiveControlInput { request_id: string; expected_authority_epoch: string; expected_control_revision: number; reason: string; run_id?: string; generation?: number }
export type LiveStopInput = LiveControlInput & ({ mode: 'ADMIN'; runtime_session_id?: string } |
  { mode: 'PRESENTER'; runtime_session_id: string; run_id: string; generation: number });
export interface LiveAdmissionActionInput { request_id: string; runtime_session_id: string; run_id: string; generation: number }
export interface LivePresenterAdmissionInput { request_id: string; runtime_session_id: string }
export interface LiveAdmissionIdentity { version: 1; authority_epoch: string; server_now: string; live_version: string | null;
  occurrence_id: string; publish_id: string; schedule_item_id: string; run_id: string; generation: number; admission_id: string;
  role: 'presenter'; participant_id: string; presenter_participant_id: string; presenter_user_id: string; microphone: boolean; screen_share_audio: boolean }
export interface LiveAdmissionPending extends LiveAdmissionIdentity { status: 'PREPARING' | 'READY'; retry_after_ms: 500 }
export interface LiveAdmissionGrant extends LiveAdmissionIdentity { status: 'AUTHORIZED'; lease_ms: number; window_remaining_ms: number; renew_after_ms: 3000;
  signaling?: { url: string; ticket: string } }
export interface LiveObservationInput { runtime_session_id: string; run_id: string; generation: number; sequence: number;
  connection: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'; subscription: 'NONE' | 'SUBSCRIBING' | 'SUBSCRIBED'; frame: 'NONE' | 'READY';
  audio: 'NONE' | 'READY' | 'DEGRADED' | 'MUTED'; fallback_ready: boolean; fallback_reason: string | null }
export interface LiveObservationResult { accepted: boolean; sequence: number; server_received_at: string }
export interface LiveRuntimeActionResult extends LiveRuntimeOccurrence { idempotent: boolean }
export interface LiveRuntimeListParams { runtime_session_id?: string; page: number; page_size: number; from: string; until: string }
