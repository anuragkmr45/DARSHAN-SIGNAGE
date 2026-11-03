import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { subject } from '@casl/ability';
import { and, asc, eq, inArray, isNull, or, sql, getTableColumns, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { withCurrentMutationAuthorization, type MutationAuthorizationContext } from '@/auth/mutation-authorization';
import type { JWTPayload } from '@/auth/jwt';
import { defineAbilityFor, type AppAbility } from '@/rbac';
import { canReadContentResource } from '@/rbac/content-ownership';
import { getUserDepartments } from '@/db/repositories/user-departments';
import { frozenLivePolicySchema } from '@/screens/live-snapshot-audience';
import { hashLiveFallbackAssetSet, liveAuthorityGrantSchema, liveFallbackReadinessSchema,
  type LiveAuthorityCheck, type LiveFallbackReadiness } from '@/schemas/live-runtime';
import { createDeviceCommandsInTransaction } from './command-lifecycle-service';
import { liveError, requireLiveAuthorityEpoch } from './live-authority-epoch';
import { liveMediaClient, liveMediaEndpointFingerprint, type LiveMediaTransport, type LiveMediaHealth, type LiveMediaFence } from './live-media-client';
import { readLiveDeviceOccurrenceState } from './live-runtime-discovery';
import { hasLiveBlockingEmergency } from './live-emergency';
import { validLiveControlRunBinding } from './live-control-binding';

type Occurrence = typeof schema.liveScheduleOccurrences.$inferSelect;
type Run = typeof schema.liveRuns.$inferSelect;
type Admission = typeof schema.liveAdmissions.$inferSelect;
type Control = typeof schema.liveOccurrenceControls.$inferSelect;
type Payload = Pick<JWTPayload, 'sub' | 'jti'>;
type Selector = { occurrenceId: string } | { publishId: string; itemId: string };
type Device = { screenId: string; serial: string; runtimeSessionId: string };
type Locked = { tx: DbExecutor; occurrence: Occurrence; policy: z.infer<typeof frozenLivePolicySchema>;
  source: typeof schema.liveSessions.$inferSelect; control: Control; run: Run | null;
  actor?: MutationAuthorizationContext; actorSessionJti?: string; presenterAllowed: boolean; presenterEligible: boolean; publicationActive: boolean };
const nowUtc = () => sql`(now() AT TIME ZONE 'UTC')`;
export const liveRuntimeVersion = (run: Run, revision: number) => `${run.authority_epoch}/${run.id}/${run.generation}/${revision}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function supportedLiveRules(ability: AppAbility, action: 'read' | 'manage' | 'publish') {
  const columns = getTableColumns(schema.liveSessions);
  return ability.rulesFor(action, 'LiveBroadcast').every(rule => {
    if (rule.fields !== undefined) return false;
    if (rule.conditions === undefined) return true;
    if (!rule.conditions || typeof rule.conditions !== 'object' || Array.isArray(rule.conditions) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(rule.conditions))) return false;
    return Object.entries(rule.conditions).every(([key, value]) => {
      const column = columns[key as keyof typeof columns];
      return Boolean(column && (value === null || column.dataType === 'string' && typeof value === 'string' ||
        column.dataType === 'boolean' && typeof value === 'boolean' || column.dataType === 'number' && typeof value === 'number' && Number.isFinite(value)));
    });
  });
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
}
export const presenterParticipantId = (runId: string) => `presenter_${runId}`;
const occurrenceWhere = (selector: Selector) => 'occurrenceId' in selector ? eq(schema.liveScheduleOccurrences.id, selector.occurrenceId)
  : and(eq(schema.liveScheduleOccurrences.publish_id, selector.publishId), eq(schema.liveScheduleOccurrences.schedule_item_id, selector.itemId));
async function preload(selector: Selector) {
  const db = getDatabase();
  const found = await db.select().from(schema.liveScheduleOccurrences).where(occurrenceWhere(selector));
  if (found.length !== 1) throw liveError('LIVE_OCCURRENCE_NOT_FOUND', 'Published live occurrence was not found.', 404);
  const occurrence = found[0];
  const [control] = await db.select().from(schema.liveOccurrenceControls).where(eq(schema.liveOccurrenceControls.occurrence_id, occurrence.id));
  const [run] = control?.current_run_id ? await db.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, control.current_run_id)) : [];
  return { occurrence, run: run ?? null };
}
async function presenterAllowed(tx: DbExecutor, occurrence: Occurrence, source: typeof schema.liveSessions.$inferSelect, run?: Run | null) {
  const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, occurrence.presenter_user_id));
  if (!user || !user.is_active || user.deleted_at || source.deleted_at) return false;
  const [role] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.id, user.role_id));
  if (!role) return false;
  if (run) {
    const [session] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.user_id, user.id), eq(schema.sessions.access_jti, run.presenter_session_jti)));
    if (!session || session.expires_at.getTime() <= Date.now()) return false;
  }
  const membership = await getUserDepartments(user.id, tx);
  if (source.owner_scope === 'DEPARTMENT' && (!source.owner_department_id || !membership?.departmentIds.includes(source.owner_department_id))) return false;
  const policy = frozenLivePolicySchema.parse(occurrence.frozen_policy);
  const record = { ...source, presenter_user_id: policy.presenter_user_id, microphone: policy.microphone,
    screen_share_audio: policy.screen_share_audio, is_active: true, policy_revision: policy.policy_revision };
  const ability = await defineAbilityFor(role.id, user.id, user.department_id ?? undefined, tx);
  return supportedLiveRules(ability, 'publish') && ability.can('publish', subject('LiveBroadcast', record) as never);
}

/** Identity/session locks precede the shared/exclusive target lock. Preloaded
 * identities are hints only and are rechecked under the occurrence lock. */
export async function withLiveOccurrence<T>(selector: Selector, payload: Payload | undefined, write: boolean,
  execute: (context: Locked) => Promise<T>): Promise<T> {
  requireLiveAuthorityEpoch();
  const hint = await preload(selector);
  const users = [hint.occurrence.presenter_user_id];
  const sessions = hint.run ? [hint.run.presenter_session_jti] : [];
  async function inside(tx: DbExecutor, actor?: MutationAuthorizationContext): Promise<T> {
    await tx.execute(write ? sql`SELECT pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'))`
      : sql`SELECT pg_advisory_xact_lock_shared(hashtext('darshan_screen_target_references_v1'))`);
    const [occurrence] = await tx.select().from(schema.liveScheduleOccurrences).where(eq(schema.liveScheduleOccurrences.id, hint.occurrence.id)).for(write ? 'update' : 'share');
    if (!occurrence || occurrence.presenter_user_id !== hint.occurrence.presenter_user_id) throw liveError('LIVE_AUTHORITY_CHANGED', 'Live identity changed. Retry with current state.');
    if (write) await tx.insert(schema.liveOccurrenceControls).values({ occurrence_id: occurrence.id }).onConflictDoNothing();
    const [stored] = await tx.select().from(schema.liveOccurrenceControls).where(eq(schema.liveOccurrenceControls.occurrence_id, occurrence.id)).for(write ? 'update' : 'share');
    const control: Control = stored ?? { occurrence_id: occurrence.id, enabled: true, revision: 1, generation: 0,
      current_run_id: null, disabled_by: null, disable_reason: null, start_notified_at: null, end_notified_at: null, updated_at: new Date() };
    const [source] = await tx.select().from(schema.liveSessions).where(eq(schema.liveSessions.id, occurrence.live_session_id)).for('share');
    if (!source) throw liveError('LIVE_REVOKED', 'The live source is no longer available.', 410);
    const [run] = control.current_run_id ? await tx.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, control.current_run_id)).for(write ? 'update' : 'share') : [];
    if (!validLiveControlRunBinding(occurrence, control, run)) {
      throw liveError('LIVE_RUNTIME_STATE_INCONSISTENT', 'Live runtime control is inconsistent. Reconcile it before requesting authority.', 503);
    }
    const lockedSessionJtis = new Set([...sessions, ...(payload ? [payload.jti] : [])]);
    if (run && (run.presenter_user_id !== occurrence.presenter_user_id ||
        (run.state !== 'STOPPED' && !lockedSessionJtis.has(run.presenter_session_jti)))) {
      throw liveError('LIVE_AUTHORITY_CHANGED', 'Live identity changed. Retry with current state.');
    }
    const policy = frozenLivePolicySchema.parse(occurrence.frozen_policy);
    if (policy.schedule_item_id !== occurrence.schedule_item_id || policy.presenter_user_id !== occurrence.presenter_user_id ||
        policy.schedule_id !== occurrence.schedule_id || policy.schedule_revision !== occurrence.schedule_revision ||
        policy.policy_revision !== occurrence.policy_revision || policy.fallback.preparation_id !== occurrence.preparation_id ||
        Date.parse(policy.start_at) !== occurrence.start_at.getTime() || Date.parse(policy.end_at) !== occurrence.end_at.getTime() ||
        policy.live_session_id !== occurrence.live_session_id || JSON.stringify(policy.screen_ids) !== JSON.stringify(occurrence.screen_ids)) {
      throw liveError('LIVE_POLICY_INVALID', 'The approved live policy is inconsistent.', 503);
    }
    const eligible = await presenterAllowed(tx, occurrence, source);
    const [publication] = occurrence.publish_id ? await tx.select().from(schema.publishes).where(eq(schema.publishes.id, occurrence.publish_id)).for('share') : [];
    let sessionActive = true;
    if (run && run.state !== 'STOPPED') {
      const [session] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.user_id, run.presenter_user_id), eq(schema.sessions.access_jti, run.presenter_session_jti)));
      sessionActive = Boolean(session && session.expires_at.getTime() > Date.now());
    }
    const context: Locked = { tx, occurrence, control, source, policy, run: run ?? null, actor, actorSessionJti: payload?.jti,
      presenterEligible: eligible, presenterAllowed: eligible && sessionActive,
      publicationActive: Boolean(occurrence.state === 'PUBLISHED' && publication?.status === 'ACTIVE' && !publication.taken_down_at) };
    const result = await execute(context);
    requireLiveAuthorityEpoch();
    return result;
  }
  if (payload) return withCurrentMutationAuthorization(payload, context => inside(context.executor, context), {
    userLock: 'share', sessionLock: 'share', additionalUserIdsToLock: users, additionalSessionJtisToLock: sessions });
  return getDatabase().transaction(async tx => {
    await tx.select({ id: schema.roles.id }).from(schema.roles).orderBy(asc(schema.roles.id)).for('share');
    await tx.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, users)).orderBy(asc(schema.users.id)).for('share');
    if (sessions.length) await tx.select({ id: schema.sessions.id }).from(schema.sessions).where(inArray(schema.sessions.access_jti, sessions)).orderBy(asc(schema.sessions.access_jti)).for('share');
    return inside(tx);
  });
}
function sourceRecord(context: Locked) {
  return { ...context.source, presenter_user_id: context.policy.presenter_user_id, microphone: context.policy.microphone,
    screen_share_audio: context.policy.screen_share_audio, is_active: true, policy_revision: context.policy.policy_revision };
}
function canManage(context: Locked) { return Boolean(context.actor && supportedLiveRules(context.actor.ability, 'manage') && context.actor.ability.can('manage', subject('LiveBroadcast', sourceRecord(context)) as never)); }
function isPresenter(context: Locked) { return context.actor?.actor.userId === context.policy.presenter_user_id && context.presenterEligible; }
function assertCanRead(context: Locked) {
  const bound = { can: (action: string) => context.actor?.ability.can(action as never, subject('LiveBroadcast', sourceRecord(context)) as never) ?? false };
  if (!context.actor || (!isPresenter(context) && (!supportedLiveRules(context.actor.ability, 'read') || !supportedLiveRules(context.actor.ability, 'manage') ||
      !canReadContentResource(context.actor.actor, context.source, bound, 'LiveBroadcast')))) {
    throw liveError('FORBIDDEN', 'You cannot read this live occurrence.', 403);
  }
}
// Reuse the same current record-bound occurrence access for diagnostics;
// diagnostics must not infer authorization from an occurrence UUID.
export { assertCanRead as assertCanReadLiveOccurrence };

async function assertPublished(context: Locked, window = true) {
  const now = Date.now();
  if (window && now >= context.occurrence.end_at.getTime()) throw liveError('LIVE_ENDED', 'The approved live window has ended.', 410);
  if (!context.publicationActive) {
    throw liveError('LIVE_REVOKED', 'The live publication is no longer active.', 410);
  }
  if (window && now < context.occurrence.start_at.getTime()) throw liveError('LIVE_WINDOW_NOT_STARTED', 'The approved live window has not started.');
}
function assertRun(context: Locked, runId?: string, generation?: number) {
  if (!context.control.enabled) throw liveError('LIVE_DISABLED', 'The live occurrence is disabled.');
  if (!context.presenterAllowed) throw liveError('LIVE_PRESENTER_UNAVAILABLE', 'The assigned presenter is no longer authorized.');
  const run = context.run;
  if (!run) throw liveError('LIVE_NOT_RUNNING', 'The presenter has not started a live attempt.');
  if ((runId && run.id !== runId) || (generation && run.generation !== generation)) throw liveError('LIVE_REVOKED', 'This live attempt has been replaced.', 410);
  if (run.authority_epoch !== requireLiveAuthorityEpoch().epoch_id) throw liveError('LIVE_REVOKED', 'This live attempt belongs to an older authority.', 410);
  if (run.state === 'STOPPING') throw liveError('LIVE_STOPPING', 'The prior live attempt is still stopping.');
  if (run.state === 'STOPPED') throw liveError('LIVE_REVOKED', 'This live attempt has stopped.', 410);
  return run;
}
async function assertDevice(context: Locked, device: Device, allowEmergency = false) {
  if (!context.policy.screen_ids.includes(device.screenId)) throw liveError('LIVE_AUDIENCE_DENIED', 'This screen is outside the frozen live audience.', 409);
  const [screen] = await context.tx.select({ id: schema.screens.id, device_info: schema.screens.device_info }).from(schema.screens).where(eq(schema.screens.id, device.screenId)).for('share');
  const [certificate] = await context.tx.select().from(schema.deviceCertificates)
    .where(and(eq(schema.deviceCertificates.screen_id, device.screenId), eq(schema.deviceCertificates.serial, device.serial))).for('share');
  if (!screen || !certificate || certificate.is_revoked || certificate.revoked_at || !certificate.public_key_pem || certificate.expires_at.getTime() <= Date.now()) {
    throw liveError('FORBIDDEN', 'Device credentials are no longer valid.', 403, { reason: 'DEVICE_CREDENTIALS_REVOKED' });
  }
  const info = screen.device_info as { player_capabilities?: { features?: unknown } } | null;
  if (!Array.isArray(info?.player_capabilities?.features) || !info.player_capabilities.features.includes('live_broadcast_v1')) {
    throw liveError('LIVE_UNSUPPORTED_PLAYER', 'This player has not advertised the required live protocol.');
  }
  if (!allowEmergency && await hasLiveBlockingEmergency(context.tx, device.screenId)) throw liveError('LIVE_EMERGENCY_ACTIVE', 'Emergency content takes precedence on this screen.');
}
function assertReadiness(context: Locked, input: unknown): LiveFallbackReadiness {
  const parsed = liveFallbackReadinessSchema.safeParse(input);
  if (!parsed.success || parsed.data.preparation_id !== context.policy.fallback.preparation_id ||
      parsed.data.source_fingerprint !== context.policy.fallback.source_fingerprint ||
      parsed.data.asset_set_sha256 !== hashLiveFallbackAssetSet(context.policy.fallback.manifest.assets)) {
    throw liveError('LIVE_FALLBACK_NOT_READY', 'The complete approved fallback must be locally verified before joining.');
  }
  return parsed.data;
}
async function receipt(context: Locked, scope: string, action: string, requestId: string, body: unknown) {
  const key = { scope_hash: hash(scope), action, request_id: requestId };
  const [row] = await context.tx.select().from(schema.liveRuntimeReceipts).where(and(eq(schema.liveRuntimeReceipts.scope_hash, key.scope_hash),
    eq(schema.liveRuntimeReceipts.action, action), eq(schema.liveRuntimeReceipts.request_id, requestId)));
  const bodyHash = hash(canonical({ occurrence_id: context.occurrence.id, body }));
  if (row && (row.body_sha256 !== bodyHash || row.occurrence_id !== context.occurrence.id)) throw liveError('LIVE_IDEMPOTENCY_CONFLICT', 'The request ID was already used for different live intent.');
  return { row, key, bodyHash };
}
async function saveReceipt(context: Locked, value: Awaited<ReturnType<typeof receipt>>, runId: string | null, admissionId: string | null = null) {
  await context.tx.insert(schema.liveRuntimeReceipts).values({ ...value.key, body_sha256: value.bodyHash,
    occurrence_id: context.occurrence.id, run_id: runId, admission_id: admissionId });
}
async function enqueueMedia(tx: DbExecutor, run: Run, kind: 'CREATE' | 'REVOKE_RUN' | 'REVOKE_ADMISSION', admission?: Admission) {
  const revision = admission?.operation_revision ?? run.operation_revision;
  await tx.insert(schema.liveMediaOperations).values({ id: randomUUID(), run_id: run.id, admission_id: admission?.id ?? null,
    kind, operation_revision: revision, dedupe_key: `${kind}:${admission?.id ?? run.id}:${revision}` }).onConflictDoNothing();
}
async function notify(context: Locked, run: Run, revision: number, actorId: string, stopping = false) {
  let screens = [...context.policy.screen_ids].sort();
  if (stopping) {
    const states = await context.tx.select({ screen_id: schema.deviceDesiredState.screen_id, live_version: schema.deviceDesiredState.live_version })
      .from(schema.deviceDesiredState).where(inArray(schema.deviceDesiredState.screen_id, screens)).orderBy(asc(schema.deviceDesiredState.screen_id));
    // All live transitions hold the exclusive target lock. Ordinary writers
    // preserve this field; do not invert their command-INSERT -> state order.
    const newer = new Set(states.filter(state => state.live_version && !state.live_version.startsWith(`${run.authority_epoch}/${run.id}/`)).map(state => state.screen_id));
    screens = screens.filter(id => !newer.has(id));
  }
  await createDeviceCommandsInTransaction(context.tx, screens.map(screenId => ({ screenId, type: 'RESYNC', createdBy: actorId,
    payload: { reason: 'LIVE_STATE_CHANGED' }, desiredLiveVersion: liveRuntimeVersion(run, revision),
    idempotencyKey: `live:${run.id}:${revision}`, priority: 100 })), { ignoreIdempotencyConflicts: true });
}
function summarize(context: Locked, runtimeSessionId?: string) {
  const run = context.run;
  return { id: context.occurrence.id, publish_id: context.occurrence.publish_id!, schedule_item_id: context.occurrence.schedule_item_id,
    live_session_id: context.occurrence.live_session_id, start_at: context.occurrence.start_at.toISOString(), end_at: context.occurrence.end_at.toISOString(),
    control_revision: context.control.revision, enabled: context.control.enabled, item_fingerprint: context.occurrence.item_fingerprint,
    presenter_user_id: context.policy.presenter_user_id, microphone: context.policy.microphone, screen_share_audio: context.policy.screen_share_audio,
    screen_ids: context.policy.screen_ids, run: run ? { id: run.id, generation: run.generation, state: run.state, node_instance_id: run.node_instance_id,
      presenter_participant_id: presenterParticipantId(run.id), created_at: run.created_at.toISOString(), stopped_at: run.stopped_at?.toISOString() ?? null,
      owns_current_attempt: Boolean(runtimeSessionId && runtimeSessionId === run.presenter_runtime_session_id && context.actor?.actor.userId === run.presenter_user_id && context.actorSessionJti === run.presenter_session_jti) } : null,
    can_start: context.publicationActive && isPresenter(context) && context.control.enabled && Date.now() >= context.occurrence.start_at.getTime() && Date.now() < context.occurrence.end_at.getTime() && (!run || run.state === 'STOPPED'),
    can_stop: canManage(context) || Boolean(isPresenter(context) && run && run.state !== 'STOPPED' && context.actorSessionJti === run.presenter_session_jti && runtimeSessionId === run.presenter_runtime_session_id), can_manage: canManage(context) };
}
export async function getLiveOccurrence(payload: Payload, id: string, runtimeSessionId?: string) {
  return withLiveOccurrence({ occurrenceId: id }, payload, false, async context => { assertCanRead(context); return summarize(context, runtimeSessionId); });
}
type RuntimePreflightReason = 'READY' | 'OCCURRENCE_UNAVAILABLE' | 'MEDIA_UNAVAILABLE' | 'MEDIA_PREPARING' |
  'MEDIA_CAPACITY' | 'RUNTIME_CAPACITY';
function runtimePreflight(summary: ReturnType<typeof summarize>, reason: RuntimePreflightReason,
  mediaReady: boolean, capacityReady: boolean) {
  const businessEligible = summary.can_start;
  const ready = businessEligible && mediaReady && capacityReady;
  return { version: 1 as const, occurrence_id: summary.id, authority_epoch: requireLiveAuthorityEpoch().epoch_id,
    control_revision: summary.control_revision, item_fingerprint: summary.item_fingerprint, checked_at: new Date().toISOString(),
    business_eligible: businessEligible, media_ready: mediaReady, capacity_ready: capacityReady, ready,
    reason: ready ? 'READY' as const : reason };
}
/** Advisory presenter preflight only. It returns no media identity or admission
 * material, performs no durable writes, and never replaces Start's locked
 * authority/capacity checks. Media I/O is deliberately outside DB locks. */
export async function getLiveRuntimePreflight(payload: Payload, id: string, runtimeSessionId?: string,
  media: LiveMediaTransport = liveMediaClient) {
  const initial = await getLiveOccurrence(payload, id, runtimeSessionId);
  if (!initial.can_start) return runtimePreflight(initial, 'OCCURRENCE_UNAVAILABLE', false, false);
  let health: LiveMediaHealth;
  try { health = await media.discover(); }
  catch {
    const current = await getLiveOccurrence(payload, id, runtimeSessionId);
    return runtimePreflight(current, current.can_start ? 'MEDIA_UNAVAILABLE' : 'OCCURRENCE_UNAVAILABLE', false, false);
  }
  return withLiveOccurrence({ occurrenceId: id }, payload, false, async context => {
    assertCanRead(context);
    const current = summarize(context, runtimeSessionId);
    if (!current.can_start) return runtimePreflight(current, 'OCCURRENCE_UNAVAILABLE', false, false);
    const trusted = health.authority_epoch === requireLiveAuthorityEpoch().epoch_id && health.status === 'ready' && !health.isolation_complete;
    if (!trusted) return runtimePreflight(current, 'MEDIA_UNAVAILABLE', false, false);
    const accepting = health.accepting_new_runs && health.pending_authority_checks < health.pending_check_limit;
    if (!accepting) return runtimePreflight(current, 'MEDIA_PREPARING', false, false);
    if (health.tracked_remaining < context.policy.screen_ids.length + 2) {
      return runtimePreflight(current, 'MEDIA_CAPACITY', true, false);
    }
    const [occupied] = await context.tx.select({ total: sql<number>`count(*)::int` }).from(schema.liveRuns)
      .where(isNull(schema.liveRuns.teardown_confirmed_at));
    if ((occupied?.total ?? 0) >= 10) return runtimePreflight(current, 'RUNTIME_CAPACITY', true, false);
    return runtimePreflight(current, 'READY', true, true);
  });
}
function sourcePermissionSql(context: MutationAuthorizationContext, action: 'read' | 'manage' | 'publish'): SQL {
  if (!supportedLiveRules(context.ability, action)) return sql`false`;
  const columns = getTableColumns(schema.liveSessions), clauses: SQL[] = [];
  for (const rule of context.ability.rulesFor(action, 'LiveBroadcast')) {
    if (rule.fields !== undefined) return sql`false`;
    if (rule.conditions !== undefined && (!rule.conditions || typeof rule.conditions !== 'object' || Array.isArray(rule.conditions) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(rule.conditions)))) return sql`false`;
    const parts: SQL[] = [];
    for (const [key, value] of Object.entries(rule.conditions ?? {})) {
      const column = columns[key as keyof typeof columns];
      if (!column) return sql`false`;
      const expression = key === 'presenter_user_id' ? schema.liveScheduleOccurrences.presenter_user_id
        : key === 'policy_revision' ? schema.liveScheduleOccurrences.policy_revision : key === 'is_active' ? sql`true`
          : key === 'microphone' || key === 'screen_share_audio' ? sql`${schema.liveScheduleOccurrences.frozen_policy}->${key}` : column;
      if (key === 'microphone' || key === 'screen_share_audio') {
        if (typeof value !== 'boolean') return sql`false`;
        parts.push(sql`${expression}=to_jsonb(${value}::boolean)`);
      } else if (value === null) parts.push(sql`${expression} IS NULL`);
      else if (column.dataType === 'string' && typeof value === 'string') parts.push(sql`COALESCE(${expression}::text=${value},false)`);
      else if (column.dataType === 'boolean' && typeof value === 'boolean') parts.push(sql`${expression}=${value}`);
      else if (column.dataType === 'number' && typeof value === 'number' && Number.isFinite(value)) parts.push(sql`${expression}=${value}`);
      else return sql`false`;
    }
    clauses.push(sql`WHEN ${and(...parts) ?? sql`true`} THEN ${!rule.inverted}`);
  }
  return clauses.length ? sql`CASE ${sql.join(clauses, sql` `)} ELSE false END` : sql`false`;
}
export async function listLiveOccurrences(payload: Payload, runtimeSessionId?: string, options: { page?: number; page_size?: number; from?: string; until?: string } = {}) {
  requireLiveAuthorityEpoch();
  const page = options.page ?? 1, size = options.page_size ?? 25;
  const from = new Date(options.from ?? Date.now()), until = new Date(options.until ?? from.getTime() + 7 * 86_400_000);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 100 || !Number.isFinite(from.getTime()) ||
      !Number.isFinite(until.getTime()) || until <= from || until.getTime() - from.getTime() > 366 * 86_400_000) {
    throw liveError('LIVE_LIST_WINDOW_INVALID', 'Choose a valid page and reporting window of at most 366 days.', 422);
  }
  const selection = await withCurrentMutationAuthorization(payload, async context => {
    await context.executor.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext('darshan_screen_target_references_v1'))`);
    const departments = context.actor.departmentIds ?? [], manage = sourcePermissionSql(context, 'manage');
    const ownership = or(eq(schema.liveSessions.owner_scope, 'ORGANIZATION'), departments.length
      ? and(eq(schema.liveSessions.owner_scope, 'DEPARTMENT'), inArray(schema.liveSessions.owner_department_id, departments)) : sql`false`);
    const assigned = and(eq(schema.liveScheduleOccurrences.presenter_user_id, context.actor.userId), sourcePermissionSql(context, 'publish'),
      or(sql`${schema.liveSessions.owner_scope}<>'DEPARTMENT'`, departments.length ? inArray(schema.liveSessions.owner_department_id, departments) : sql`false`));
    const where = and(eq(schema.liveScheduleOccurrences.state, 'PUBLISHED'), eq(schema.publishes.status, 'ACTIVE'), isNull(schema.publishes.taken_down_at),
      isNull(schema.liveSessions.deleted_at), sql`${schema.liveScheduleOccurrences.end_at}>${nowUtc()}`,
      sql`${schema.liveScheduleOccurrences.end_at}>(${from.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
      sql`${schema.liveScheduleOccurrences.start_at}<(${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
      or(assigned, and(sourcePermissionSql(context, 'read'), or(manage, ownership))));
    const join = () => context.executor.select({ id: schema.liveScheduleOccurrences.id }).from(schema.liveScheduleOccurrences)
      .innerJoin(schema.publishes, eq(schema.publishes.id, schema.liveScheduleOccurrences.publish_id))
      .innerJoin(schema.liveSessions, eq(schema.liveSessions.id, schema.liveScheduleOccurrences.live_session_id));
    const [count] = await context.executor.select({ total: sql<number>`count(*)::int` }).from(schema.liveScheduleOccurrences)
      .innerJoin(schema.publishes, eq(schema.publishes.id, schema.liveScheduleOccurrences.publish_id))
      .innerJoin(schema.liveSessions, eq(schema.liveSessions.id, schema.liveScheduleOccurrences.live_session_id)).where(where);
    const rows = await join().where(where).orderBy(asc(schema.liveScheduleOccurrences.start_at), asc(schema.liveScheduleOccurrences.id)).limit(size).offset((page - 1) * size);
    return { rows, total: count?.total ?? 0 };
  }, { userLock: 'share', sessionLock: 'share' });
  const items = [];
  for (const row of selection.rows) items.push(await getLiveOccurrence(payload, row.id, runtimeSessionId));
  return { items, total: selection.total, page, page_size: size, from: from.toISOString(), until: until.toISOString() };
}
function assertExpectedEpoch(epoch: string) {
  if (epoch !== requireLiveAuthorityEpoch().epoch_id) throw liveError('LIVE_AUTHORITY_EPOCH_CHANGED', 'Live authority changed. Refresh the epoch and review this intent before retrying.');
}
async function observeLiveMediaNode(tx: DbExecutor, health: LiveMediaHealth) {
  const epoch = requireLiveAuthorityEpoch().epoch_id;
  const fingerprint = liveMediaEndpointFingerprint();
  if (health.authority_epoch !== epoch || health.status !== 'ready' || health.isolation_complete) {
    throw liveError('LIVE_MEDIA_FENCE_MISMATCH', 'Media boot metadata does not match the current authority.', 503);
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_live_media_node_v1'),hashtext(${health.node_instance_id}))`);
  const [known] = await tx.select().from(schema.liveMediaNodes).where(eq(schema.liveMediaNodes.id, health.node_instance_id)).for('update');
  if (known && (known.authority_epoch !== epoch || known.managed_instance_id !== health.managed_instance_id ||
      known.endpoint_fingerprint !== fingerprint || known.observed_dead_at)) {
    throw liveError('LIVE_MEDIA_FENCE_MISMATCH', 'The discovered media identity cannot be reused.', 503);
  }
  const accepting = health.accepting_new_runs && health.status === 'ready' && !health.isolation_complete;
  if (known) {
    await tx.update(schema.liveMediaNodes).set({ last_seen_at: new Date(), accepting_new_runs: accepting })
      .where(eq(schema.liveMediaNodes.id, known.id));
  } else {
    await tx.insert(schema.liveMediaNodes).values({ id: health.node_instance_id, managed_instance_id: health.managed_instance_id,
      authority_epoch: epoch, endpoint_fingerprint: fingerprint, accepting_new_runs: accepting });
  }
}
export async function startLiveRun(payload: Payload, id: string, input: { request_id: string; runtime_session_id: string; expected_authority_epoch: string; expected_control_revision: number; expected_item_fingerprint: string }, media: LiveMediaTransport = liveMediaClient) {
  const replay = await withLiveOccurrence({ occurrenceId: id }, payload, false, async context => {
    assertExpectedEpoch(input.expected_authority_epoch);
    if (!isPresenter(context)) throw liveError('FORBIDDEN', 'Only the currently authorized assigned presenter can start.', 403);
    const saved = await receipt(context, `${payload.sub}:${payload.jti}:${input.runtime_session_id}`, 'START', input.request_id, input);
    if (!saved.row?.run_id) return null;
    const [prior] = await context.tx.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, saved.row.run_id));
    if (!prior) throw liveError('LIVE_RECEIPT_INVALID', 'The prior live request cannot be reconciled.', 503);
    return { ...summarize({ ...context, run: prior }, input.runtime_session_id), idempotent: true };
  });
  if (replay) return replay;
  const health = await media.discover(); // Never while authorization/target rows are locked.
  if (!health.accepting_new_runs || health.status !== 'ready' || health.pending_authority_checks >= health.pending_check_limit) {
    throw liveError('LIVE_MEDIA_PREPARING', 'The media node cannot accept another live run yet.');
  }
  return withLiveOccurrence({ occurrenceId: id }, payload, true, async context => {
    assertExpectedEpoch(input.expected_authority_epoch);
    if (!isPresenter(context)) throw liveError('FORBIDDEN', 'Only the currently authorized assigned presenter can start.', 403);
    const saved = await receipt(context, `${payload.sub}:${payload.jti}:${input.runtime_session_id}`, 'START', input.request_id, input);
    if (saved.row?.run_id) {
      const [prior] = await context.tx.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, saved.row.run_id));
      if (!prior) throw liveError('LIVE_RECEIPT_INVALID', 'The prior live request cannot be reconciled.', 503);
      return { ...summarize({ ...context, run: prior }, input.runtime_session_id), idempotent: true };
    }
    await assertPublished(context);
    if (health.tracked_remaining < context.policy.screen_ids.length + 2) throw liveError('LIVE_MEDIA_PREPARING', 'The media node needs maintenance before this audience can join.');
    if (context.control.revision !== input.expected_control_revision || context.occurrence.item_fingerprint !== input.expected_item_fingerprint) {
      throw liveError('LIVE_CONTROL_STALE', 'Live control changed. Reload the occurrence before starting.');
    }
    if (!context.control.enabled) throw liveError('LIVE_DISABLED', 'An administrator disabled this occurrence.');
    if (context.run && !context.run.teardown_confirmed_at) throw liveError('LIVE_STOPPING', 'The current attempt must finish teardown before a new explicit start.');
    await context.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_live_runtime_capacity_v1'))`);
    const occupied = await context.tx.select({ slot: schema.liveRuns.runtime_slot }).from(schema.liveRuns).where(isNull(schema.liveRuns.teardown_confirmed_at));
    const slot = Array.from({ length: 10 }, (_, n) => n + 1).find(value => !occupied.some(row => row.slot === value));
    if (!slot) throw liveError('LIVE_RUNTIME_CAPACITY', 'Ten live runs still occupy media capacity; wait for observed teardown.');
    const epoch = requireLiveAuthorityEpoch().epoch_id;
    if (health.authority_epoch !== epoch) throw liveError('LIVE_MEDIA_FENCE_MISMATCH', 'Media authority changed before start.', 503);
    await observeLiveMediaNode(context.tx, health);
    const [run] = await context.tx.insert(schema.liveRuns).values({ id: randomUUID(), occurrence_id: id, generation: context.control.generation + 1,
      authority_epoch: epoch, node_instance_id: health.node_instance_id, runtime_slot: slot,
      presenter_user_id: context.policy.presenter_user_id, presenter_session_jti: payload.jti, presenter_runtime_session_id: input.runtime_session_id }).returning();
    const [control] = await context.tx.update(schema.liveOccurrenceControls).set({ current_run_id: run.id, generation: run.generation,
      revision: context.control.revision + 1, updated_at: new Date() }).where(eq(schema.liveOccurrenceControls.occurrence_id, id)).returning();
    const [admission] = await context.tx.insert(schema.liveAdmissions).values({ id: randomUUID(), run_id: run.id, generation: run.generation,
      role: 'presenter', participant_id: presenterParticipantId(run.id), user_id: payload.sub,
      session_jti: payload.jti, runtime_session_id: input.runtime_session_id }).returning();
    await enqueueMedia(context.tx, run, 'CREATE', admission);
    await notify(context, run, control.revision, payload.sub);
    await saveReceipt(context, saved, run.id, admission.id);
    await context.tx.insert(schema.auditLogs).values({ user_id: payload.sub, action: 'LIVE_RUN_START', entity_type: 'LiveRun', entity_id: run.id });
    return { ...summarize({ ...context, run, control }, input.runtime_session_id), idempotent: false };
  });
}
async function stopRun(context: Locked, reason: string, actorId: string, controlAlreadyChanged = false) {
  const run = context.run;
  if (!run || run.state === 'STOPPED' || run.state === 'STOPPING') return;
  if (!controlAlreadyChanged) {
    const [control] = await context.tx.update(schema.liveOccurrenceControls).set({ revision: context.control.revision + 1, updated_at: new Date() })
      .where(eq(schema.liveOccurrenceControls.occurrence_id, run.occurrence_id)).returning();
    context.control = control;
  }
  const [updated] = await context.tx.update(schema.liveRuns).set({ state: 'STOPPING', stop_reason: reason,
    operation_revision: run.operation_revision + 1, revision: run.revision + 1, updated_at: new Date() }).where(eq(schema.liveRuns.id, run.id)).returning();
  await context.tx.update(schema.liveAdmissions).set({ state: 'REVOKING', revoked_at: new Date(), updated_at: new Date() })
    .where(and(eq(schema.liveAdmissions.run_id, run.id), isNull(schema.liveAdmissions.teardown_confirmed_at)));
  await enqueueMedia(context.tx, updated, 'REVOKE_RUN');
  await notify(context, updated, context.control.revision, actorId, true);
  context.run = updated;
}
export async function controlLiveOccurrence(payload: Payload, id: string, input: { request_id: string; expected_authority_epoch: string; expected_control_revision: number; reason: string;
  mode?: 'PRESENTER' | 'ADMIN'; runtime_session_id?: string; run_id?: string; generation?: number }, action: 'STOP' | 'ENABLE') {
  return withLiveOccurrence({ occurrenceId: id }, payload, true, async context => {
    assertExpectedEpoch(input.expected_authority_epoch);
    const manage = canManage(context);
    if (action === 'ENABLE' || input.mode === 'ADMIN') { if (!manage) throw liveError('FORBIDDEN', 'Managing this live occurrence requires its current manage permission.', 403); }
    else if (!isPresenter(context)) throw liveError('FORBIDDEN', 'The assigned presenter is no longer authorized.', 403);
    const saved = await receipt(context, `${payload.sub}:${payload.jti}:${input.runtime_session_id ?? 'admin'}`, `${action}:${input.mode ?? 'ADMIN'}`, input.request_id, input);
    if (saved.row) {
      const [prior] = saved.row.run_id ? await context.tx.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, saved.row.run_id)) : [];
      return { ...summarize({ ...context, run: prior ?? null }, input.runtime_session_id), idempotent: true };
    }
    if (action === 'STOP' && input.mode !== 'ADMIN' && (!context.run || context.run.presenter_session_jti !== payload.jti ||
      context.run.presenter_runtime_session_id !== input.runtime_session_id || context.run.id !== input.run_id || context.run.generation !== input.generation)) {
      throw liveError('LIVE_ATTEMPT_NOT_OWNED', 'This document does not own the current presenter attempt.');
    }
    if (context.control.revision !== input.expected_control_revision) throw liveError('LIVE_CONTROL_STALE', 'Live control changed. Reload before changing it.');
    if (action === 'ENABLE') {
      await assertPublished(context, false);
      if (Date.now() >= context.occurrence.end_at.getTime()) throw liveError('LIVE_ENDED', 'The approved live window has ended.', 410);
    }
    if (input.run_id && context.run?.id !== input.run_id) throw liveError('LIVE_REVOKED', 'This attempt has been replaced.', 410);
    const [control] = await context.tx.update(schema.liveOccurrenceControls).set({ revision: context.control.revision + 1,
      ...(action === 'ENABLE' ? { enabled: true, disabled_by: null, disable_reason: null }
        : input.mode === 'ADMIN' ? { enabled: false, disabled_by: payload.sub, disable_reason: input.reason } : {}), updated_at: new Date() })
      .where(eq(schema.liveOccurrenceControls.occurrence_id, id)).returning();
    context.control = control;
    if (action === 'STOP') {
      const wasStopping = context.run?.state === 'STOPPING';
      await stopRun(context, input.mode === 'ADMIN' ? 'ADMIN_STOP' : 'PRESENTER_STOP', payload.sub, true);
      if (wasStopping && context.run) await notify(context, context.run, control.revision, payload.sub, true);
    }
    else if (context.run) await notify(context, context.run, control.revision, payload.sub, true);
    await saveReceipt(context, saved, context.run?.id ?? null);
    await context.tx.insert(schema.auditLogs).values({ user_id: payload.sub,
      action: action === 'ENABLE' ? 'LIVE_OCCURRENCE_ENABLE' : input.mode === 'ADMIN' ? 'LIVE_OCCURRENCE_DISABLE' : 'LIVE_RUN_STOP',
      entity_type: 'LiveOccurrence', entity_id: context.occurrence.id });
    return { ...summarize(context, input.runtime_session_id), idempotent: false };
  });
}

function admissionIdentity(context: Locked, run: Run, admission: Admission, liveVersion: string | null) {
  return { version: 1 as const, authority_epoch: run.authority_epoch, server_now: new Date().toISOString(), live_version: liveVersion,
    occurrence_id: context.occurrence.id, publish_id: context.occurrence.publish_id!, schedule_item_id: context.occurrence.schedule_item_id,
    run_id: run.id, generation: run.generation, admission_id: admission.id, role: admission.role,
    participant_id: admission.participant_id, presenter_participant_id: presenterParticipantId(run.id),
    presenter_user_id: context.policy.presenter_user_id, microphone: context.policy.microphone, screen_share_audio: context.policy.screen_share_audio };
}
async function desiredLiveVersion(context: Locked, screenId?: string) {
  if (!screenId) return context.run ? liveRuntimeVersion(context.run, context.control.revision) : null;
  const [state] = await context.tx.select({ live_version: schema.deviceDesiredState.live_version }).from(schema.deviceDesiredState)
    .where(eq(schema.deviceDesiredState.screen_id, screenId));
  return state?.live_version ?? null;
}
function assertOwnedAdmission(context: Locked, admission: Admission, runtimeSessionId: string, device?: Device) {
  if (admission.runtime_session_id !== runtimeSessionId || admission.run_id !== context.run?.id || admission.generation !== context.run.generation) {
    throw liveError('LIVE_REVOKED', 'This admission belongs to another live attempt or runtime.', 410);
  }
  if (device) {
    if (admission.role !== 'receiver' || admission.screen_id !== device.screenId || admission.certificate_serial !== device.serial) {
      throw liveError('LIVE_ADMISSION_NOT_OWNED', 'This device does not own the live admission.');
    }
  } else if (!context.actor || admission.role !== 'presenter' || admission.user_id !== context.actor.actor.userId ||
      admission.session_jti !== context.actorSessionJti || admission.session_jti !== (context.run?.presenter_session_jti) || context.run?.presenter_runtime_session_id !== runtimeSessionId) {
    throw liveError('LIVE_ATTEMPT_NOT_OWNED', 'This document does not own the current presenter admission.');
  }
}
async function admissionRow(context: Locked, id: string) {
  const [admission] = await context.tx.select().from(schema.liveAdmissions).where(eq(schema.liveAdmissions.id, id)).for('update');
  if (!admission || admission.run_id !== context.run?.id) throw liveError('LIVE_REVOKED', 'The requested live admission is no longer current.', 410);
  return admission;
}
async function revokeAdmission(context: Locked, admission: Admission) {
  if (admission.teardown_confirmed_at) return;
  let current = admission;
  if (current.state !== 'REVOKING' && current.state !== 'REVOKED') {
    [current] = await context.tx.update(schema.liveAdmissions).set({ state: 'REVOKING', operation_revision: current.operation_revision + 1,
      revoked_at: new Date(), updated_at: new Date() }).where(eq(schema.liveAdmissions.id, current.id)).returning();
  }
  await enqueueMedia(context.tx, context.run!, 'REVOKE_ADMISSION', current);
}
export async function getDeviceLiveState(device: Device, publishId: string, itemId: string) {
  return readLiveDeviceOccurrenceState(device, publishId, itemId);
}
export async function createLiveAdmission(selector: Selector, payload: Payload | undefined,
  input: { request_id: string; runtime_session_id: string; run_id?: string; generation?: number; fallback?: LiveFallbackReadiness }, device?: Device) {
  const result = await withLiveOccurrence(selector, payload, true, async context => {
    await assertPublished(context);
    const run = assertRun(context, input.run_id, input.generation);
    if (device) {
      await assertDevice(context, device); assertReadiness(context, input.fallback);
      if (run.state !== 'RUNNING') throw liveError('LIVE_PREPARING', 'The presenter attempt is still preparing.');
    } else if (!isPresenter(context) || run.presenter_session_jti !== payload?.jti || run.presenter_runtime_session_id !== input.runtime_session_id) {
      throw liveError('LIVE_ATTEMPT_NOT_OWNED', 'This document does not own the current attempt.');
    }
    const scope = device ? `${device.screenId}:${device.serial}:${device.runtimeSessionId}` : `${payload!.sub}:${payload!.jti}:${input.runtime_session_id}`;
    const saved = await receipt(context, scope, 'ADMISSION', input.request_id, input);
    let admission: Admission | undefined;
    if (saved.row?.admission_id) [admission] = await context.tx.select().from(schema.liveAdmissions).where(eq(schema.liveAdmissions.id, saved.row.admission_id));
    else {
      [admission] = await context.tx.select().from(schema.liveAdmissions).where(and(eq(schema.liveAdmissions.run_id, run.id),
        eq(schema.liveAdmissions.role, device ? 'receiver' : 'presenter'), device ? eq(schema.liveAdmissions.screen_id, device.screenId) : undefined,
        isNull(schema.liveAdmissions.teardown_confirmed_at)));
      if (admission && device && (admission.runtime_session_id !== input.runtime_session_id || admission.certificate_serial !== device.serial)) {
        // A copied certificate must not let a second player evict a receiver
        // that is still renewing. Wait until its bounded media authority has
        // expired before starting the exact-teardown handover.
        if (admission.state !== 'REVOKING' && admission.state !== 'REVOKED' &&
            Date.now() - (admission.last_authorized_at ?? admission.created_at).getTime() < 10_000) {
          return { receiver_active: true as const };
        }
        // The old receiver may still occupy the media slot after a player
        // restart or certificate rotation. Commit its revocation before asking
        // the new runtime to retry; throwing here would roll it back.
        await revokeAdmission(context, admission);
        return { restart_teardown_pending: true as const };
      }
      if (admission) assertOwnedAdmission(context, admission, input.runtime_session_id, device);
      else {
        if (!device) throw liveError('LIVE_REVOKED', 'The presenter admission ended; explicitly start a new attempt.', 410);
        [admission] = await context.tx.insert(schema.liveAdmissions).values({ id: randomUUID(), run_id: run.id, generation: run.generation,
          role: 'receiver', participant_id: `receiver_${device.screenId}_${input.runtime_session_id}`,
          screen_id: device.screenId, certificate_serial: device.serial, runtime_session_id: input.runtime_session_id,
          readiness: assertReadiness(context, input.fallback) }).returning();
        await enqueueMedia(context.tx, run, 'CREATE', admission);
      }
      await saveReceipt(context, saved, run.id, admission.id);
    }
    if (!admission || ['REVOKING', 'REVOKED'].includes(admission.state)) throw liveError('LIVE_REVOKED', 'The admission is no longer authorized.', 410);
    assertOwnedAdmission(context, admission, input.runtime_session_id, device);
    return { ...admissionIdentity(context, run, admission, await desiredLiveVersion(context, device?.screenId)),
      status: admission.state === 'ACTIVE' ? 'READY' : 'PREPARING', retry_after_ms: 500 };
  });
  if ('receiver_active' in result) {
    throw liveError('LIVE_RECEIVER_ACTIVE', 'This screen still has a recently authorized player connection. Retry shortly.', 409);
  }
  if ('restart_teardown_pending' in result) {
    throw liveError('LIVE_TEARDOWN_PENDING', 'The previous player connection is being removed. Retry shortly.', 503);
  }
  return result;
}
export async function occurrenceForRun(runId: string) {
  const [run] = await getDatabase().select({ occurrence_id: schema.liveRuns.occurrence_id }).from(schema.liveRuns).where(eq(schema.liveRuns.id, runId));
  if (!run) throw liveError('LIVE_REVOKED', 'The live attempt is no longer available.', 410);
  return run.occurrence_id;
}
export async function occurrenceForAdmission(admissionId: string) {
  const [row] = await getDatabase().select({ occurrence_id: schema.liveRuns.occurrence_id }).from(schema.liveAdmissions)
    .innerJoin(schema.liveRuns, eq(schema.liveRuns.id, schema.liveAdmissions.run_id)).where(eq(schema.liveAdmissions.id, admissionId));
  if (!row) throw liveError('LIVE_REVOKED', 'The live admission is no longer available.', 410);
  return row.occurrence_id;
}
const fenceFor = (run: Run, revision: number, id?: string): LiveMediaFence => ({ run_id: run.id, generation: run.generation,
  node_instance_id: run.node_instance_id, authority_epoch: run.authority_epoch, operation_revision: revision, ...(id ? { id } : {}) });
export async function renewOrTicketLiveAdmission(payload: Payload | undefined, id: string,
  input: { request_id: string; runtime_session_id: string; run_id: string; generation: number; fallback?: LiveFallbackReadiness },
  kind: 'RENEW' | 'TICKET', device?: Device, media: LiveMediaTransport = liveMediaClient) {
  const occurrenceId = await occurrenceForAdmission(id);
  const prepared = await withLiveOccurrence({ occurrenceId }, payload, false, async context => {
    await assertPublished(context); const run = assertRun(context, input.run_id, input.generation);
    if (device) { await assertDevice(context, device); assertReadiness(context, input.fallback); }
    else if (!isPresenter(context) || run.presenter_session_jti !== payload?.jti) throw liveError('LIVE_ATTEMPT_NOT_OWNED', 'This session does not own the presenter attempt.');
    const admission = await admissionRow(context, id); assertOwnedAdmission(context, admission, input.runtime_session_id, device);
    if (admission.state === 'PENDING') throw liveError('LIVE_PREPARING', 'The admission has not been confirmed by the media node.');
    if (admission.state !== 'ACTIVE' || admission.teardown_confirmed_at) throw liveError('LIVE_REVOKED', 'The admission has stopped.', 410);
    // RENEW/TICKET are always fresh, never replayed from durable receipts.
    // request_id is client correlation only; identity/readiness and the
    // monotonically reserved operation revision fence every returned result.
    const [current] = await context.tx.update(schema.liveAdmissions).set({ operation_revision: admission.operation_revision + 1,
      updated_at: new Date() }).where(eq(schema.liveAdmissions.id, id)).returning();
    return { run, admission: current, fence: fenceFor(run, current.operation_revision, id) };
  });
  const anchor = performance.now();
  const result = await media.perform(kind, prepared.fence); // Fresh media callback, no DB locks held.
  const elapsed = Math.ceil(performance.now() - anchor);
  if (!['IDLE', 'ISSUED', 'CONNECTING', 'CONNECTED'].includes(result.state)) throw liveError('LIVE_REVOKED', 'The media admission is no longer active.', 410);
  return withLiveOccurrence({ occurrenceId }, payload, false, async context => {
    await assertPublished(context); const run = assertRun(context, input.run_id, input.generation);
    if (device) { await assertDevice(context, device); assertReadiness(context, input.fallback); }
    const admission = await admissionRow(context, id); assertOwnedAdmission(context, admission, input.runtime_session_id, device);
    if (admission.state !== 'ACTIVE' || admission.operation_revision !== prepared.admission.operation_revision) throw liveError('LIVE_REVOKED', 'A newer operation superseded this response.', 410);
    const lease = Math.floor(Math.min(10_000, result.lease_ms ?? 0) - elapsed), window = Math.floor(Math.min(result.window_remaining_ms ?? 0,
      context.occurrence.end_at.getTime() - Date.now()) - elapsed);
    if (lease <= 0 || window <= 0) throw liveError('LIVE_REVOKED', 'The live response arrived after its authority expired.', 410);
    let signaling: { url: string; ticket: string } | undefined;
    if (kind === 'TICKET') {
      if (!result.ticket || !result.signal_url) throw liveError('LIVE_MEDIA_UNAVAILABLE', 'No signaling admission was confirmed.', 503);
      const target = new URL(result.signal_url);
      if (target.protocol !== 'wss:' || target.username || target.password || target.search || target.hash) throw liveError('LIVE_MEDIA_UNAVAILABLE', 'Media signaling is not securely configured.', 503);
      signaling = { url: target.toString(), ticket: result.ticket };
    }
    return { ...admissionIdentity(context, run, admission, await desiredLiveVersion(context, device?.screenId)), status: 'AUTHORIZED',
      lease_ms: lease, window_remaining_ms: window, renew_after_ms: 3000, ...(signaling ? { signaling } : {}) };
  });
}
export async function verifyLiveMediaAuthority(input: LiveAuthorityCheck) {
  if (input.authority_epoch !== requireLiveAuthorityEpoch().epoch_id) return { ...input, allowed: false as const };
  const occurrenceId = await occurrenceForRun(input.run_id).catch(() => null);
  if (!occurrenceId) return { ...input, allowed: false as const };
  return withLiveOccurrence({ occurrenceId }, undefined, false, async context => {
    const run = context.run;
    if (!run || run.id !== input.run_id || run.generation !== input.generation || run.node_instance_id !== input.node_instance_id || run.authority_epoch !== input.authority_epoch) {
      return { ...input, allowed: false as const };
    }
    const admission = await admissionRow(context, input.id);
    try {
      await assertPublished(context); assertRun(context, input.run_id, input.generation);
      if (admission.operation_revision !== input.operation_revision || ['REVOKING', 'REVOKED'].includes(admission.state) || admission.teardown_confirmed_at ||
          (input.action !== 'CREATE' && admission.state !== 'ACTIVE')) throw liveError('LIVE_REVOKED', 'Admission authority has changed.', 410);
      if (admission.role === 'receiver') {
        await assertDevice(context, { screenId: admission.screen_id!, serial: admission.certificate_serial!, runtimeSessionId: admission.runtime_session_id });
        assertReadiness(context, admission.readiness);
        const [observed] = await context.tx.select({ ready: schema.liveAdmissionObservations.fallback_ready }).from(schema.liveAdmissionObservations)
          .where(eq(schema.liveAdmissionObservations.admission_id, admission.id));
        if (observed?.ready === false) throw liveError('LIVE_FALLBACK_NOT_READY', 'The player reported an unavailable fallback.');
      } else if (admission.user_id !== run.presenter_user_id || admission.session_jti !== run.presenter_session_jti || admission.runtime_session_id !== run.presenter_runtime_session_id) {
        throw liveError('LIVE_REVOKED', 'Presenter admission identity changed.', 410);
      }
      const remaining = Math.floor(context.occurrence.end_at.getTime() - Date.now());
      if (remaining <= 3000) throw liveError('LIVE_ENDED', 'Insufficient approved window remains for safe media enforcement.', 410);
      await context.tx.update(schema.liveAdmissions).set({ last_authorized_at: new Date(), updated_at: new Date() }).where(eq(schema.liveAdmissions.id, admission.id));
      return liveAuthorityGrantSchema.parse({ ...input, allowed: true, participant_id: admission.participant_id, role: admission.role,
        audio: admission.role === 'presenter' ? { microphone: context.policy.microphone, screen_share_audio: context.policy.screen_share_audio }
          : { microphone: false, screen_share_audio: false }, lease_ms: 10_000, window_remaining_ms: Math.min(remaining, 2_147_483_647) });
    } catch (error) {
      if (!(error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500)) throw error;
      await revokeAdmission(context, admission);
      return { ...input, allowed: false as const };
    }
  });
}
export async function observeLiveAdmission(payload: Payload | undefined, id: string, input: {
  runtime_session_id: string; run_id: string; generation: number; sequence: number; connection: string; subscription: string;
  frame: string; audio: string; fallback_ready: boolean; fallback_reason: string | null;
}, device?: Device) {
  return withLiveOccurrence({ occurrenceId: await occurrenceForAdmission(id) }, payload, false, async context => {
    await assertPublished(context); assertRun(context, input.run_id, input.generation);
    if (device) await assertDevice(context, device);
    const admission = await admissionRow(context, id); assertOwnedAdmission(context, admission, input.runtime_session_id, device);
    const values = { runtime_session_id: input.runtime_session_id, sequence: input.sequence, connection: input.connection,
      subscription: input.subscription, frame: input.frame, audio: input.audio,
      fallback_ready: input.fallback_ready, fallback_reason: input.fallback_reason };
    const updated = await context.tx.insert(schema.liveAdmissionObservations).values({ admission_id: id, ...values, received_at: new Date() })
      .onConflictDoUpdate({ target: schema.liveAdmissionObservations.admission_id, set: { ...values, received_at: new Date() },
        where: sql`${schema.liveAdmissionObservations.runtime_session_id}=${input.runtime_session_id}::uuid AND ${schema.liveAdmissionObservations.sequence}<${input.sequence}` }).returning({ sequence: schema.liveAdmissionObservations.sequence });
    if (!input.fallback_ready && admission.role === 'receiver' && updated.length) await revokeAdmission(context, admission);
    return { accepted: updated.length > 0, sequence: input.sequence, server_received_at: new Date().toISOString() };
  });
}

async function confirmRunTeardown(context: Locked, run: Run) {
  if (run.teardown_confirmed_at) return;
  const time = new Date();
  await context.tx.update(schema.liveAdmissions).set({ state: 'REVOKED', revoked_at: time, teardown_confirmed_at: time, updated_at: time })
    .where(eq(schema.liveAdmissions.run_id, run.id));
  const [stopped] = await context.tx.update(schema.liveRuns).set({ state: 'STOPPED', stopped_at: time,
    teardown_confirmed_at: time, revision: run.revision + 1, updated_at: time }).where(eq(schema.liveRuns.id, run.id)).returning();
  if (context.control.current_run_id === run.id) {
    const [control] = await context.tx.update(schema.liveOccurrenceControls).set({ revision: context.control.revision + 1, updated_at: time })
      .where(eq(schema.liveOccurrenceControls.occurrence_id, run.occurrence_id)).returning();
    context.control = control; context.run = stopped;
    await notify(context, stopped, control.revision, run.presenter_user_id, true);
  }
}
function matchingMediaProof(view: Awaited<ReturnType<LiveMediaTransport['perform']>>, run: Run, admissionId?: string) {
  return view.protocol_version === 1 && view.node_instance_id === run.node_instance_id && view.authority_epoch === run.authority_epoch &&
    view.run_id === run.id && view.generation === run.generation && (!admissionId || view.admission_id === admissionId);
}
export async function dispatchOneLiveMediaOperation(media: LiveMediaTransport = liveMediaClient) {
  requireLiveAuthorityEpoch();
  const claimed = await getDatabase().transaction(async tx => {
    const selected = await tx.execute(sql`SELECT id FROM ${schema.liveMediaOperations}
      WHERE (state='PENDING' AND available_at<=${nowUtc()}) OR (state='PROCESSING' AND lease_expires_at<=${nowUtc()})
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
    const id = (selected.rows as Array<{ id: string }>)[0]?.id;
    if (!id) return null;
    const [row] = await tx.update(schema.liveMediaOperations).set({ state: 'PROCESSING', claim_token: randomUUID(),
      lease_expires_at: new Date(Date.now() + 10_000), attempts: sql`${schema.liveMediaOperations.attempts}+1`, updated_at: new Date() })
      .where(eq(schema.liveMediaOperations.id, id)).returning();
    return row;
  });
  if (!claimed) return false;
  try {
    const [run] = await getDatabase().select().from(schema.liveRuns).where(eq(schema.liveRuns.id, claimed.run_id));
    if (!run) throw liveError('LIVE_OPERATION_INVALID', 'The live operation lost its immutable run.', 503);
    let result: Awaited<ReturnType<LiveMediaTransport['perform']>> | undefined;
    if (claimed.kind === 'CREATE' && claimed.attempts > 1 && !['STOPPING', 'STOPPED'].includes(run.state)) {
      try { result = await media.perform('ADMISSION_STATUS', fenceFor(run, claimed.operation_revision, claimed.admission_id!)); }
      catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'LIVE_MEDIA_NOT_FOUND')) throw error;
        // The controller never replays a CREATE grant. Reserve a fresh revision
        // after observed absence; delayed old checks fail their DB revision.
        await withLiveOccurrence({ occurrenceId: run.occurrence_id }, undefined, true, async context => {
          const [operation] = await context.tx.select().from(schema.liveMediaOperations).where(eq(schema.liveMediaOperations.id, claimed.id)).for('update');
          if (!operation || operation.claim_token !== claimed.claim_token || operation.state !== 'PROCESSING') return;
          const [admission] = await context.tx.select().from(schema.liveAdmissions).where(eq(schema.liveAdmissions.id, claimed.admission_id!)).for('update');
          if (context.run?.id === run.id && !['STOPPING', 'STOPPED'].includes(context.run.state) && admission?.state === 'PENDING' &&
              admission.operation_revision === claimed.operation_revision) {
            const [next] = await context.tx.update(schema.liveAdmissions).set({ operation_revision: admission.operation_revision + 1, updated_at: new Date() })
              .where(eq(schema.liveAdmissions.id, admission.id)).returning();
            await enqueueMedia(context.tx, context.run, 'CREATE', next);
          } else if (context.run?.id === run.id && !context.run.teardown_confirmed_at) await enqueueMedia(context.tx, context.run, 'REVOKE_RUN');
          await context.tx.update(schema.liveMediaOperations).set({ state: 'ACKED', claim_token: null, lease_expires_at: null, updated_at: new Date() })
            .where(eq(schema.liveMediaOperations.id, claimed.id));
        });
        return true;
      }
    }
    // Never send a stale CREATE for an already stopping/replaced run. A run
    // tombstone is still dispatched so a delayed earlier HTTP call is fenced.
    if (!result && !(claimed.kind === 'CREATE' && ['STOPPING', 'STOPPED'].includes(run.state))) {
      result = await media.perform(claimed.kind, fenceFor(run, claimed.operation_revision, claimed.admission_id ?? undefined));
    }
    if (result && !matchingMediaProof(result, run, claimed.admission_id ?? undefined)) throw liveError('LIVE_MEDIA_FENCE_MISMATCH', 'Media proof did not match the assigned node/run.', 503);
    if (claimed.kind !== 'CREATE' && result?.teardown_confirmed !== true) throw liveError('LIVE_TEARDOWN_UNCONFIRMED', 'Media removal remains unconfirmed.', 503);
    await withLiveOccurrence({ occurrenceId: run.occurrence_id }, undefined, true, async context => {
      const [operation] = await context.tx.select().from(schema.liveMediaOperations).where(eq(schema.liveMediaOperations.id, claimed.id)).for('update');
      if (!operation || operation.state !== 'PROCESSING' || operation.claim_token !== claimed.claim_token) return;
      const [actual] = await context.tx.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, run.id)).for('update');
      if (claimed.kind === 'CREATE') {
        const [admission] = await context.tx.select().from(schema.liveAdmissions).where(eq(schema.liveAdmissions.id, claimed.admission_id!)).for('update');
        if (!admission) throw liveError('LIVE_OPERATION_INVALID', 'The admission intent was lost.', 503);
        if (!result || context.run?.id !== actual.id || ['STOPPING', 'STOPPED'].includes(actual.state)) {
          if (!actual.teardown_confirmed_at) await enqueueMedia(context.tx, actual, 'REVOKE_RUN');
        } else if (!context.presenterAllowed) await stopRun(context, 'LIVE_PRESENTER_UNAVAILABLE', actual.presenter_user_id);
        else if (!['IDLE', 'ISSUED', 'CONNECTING', 'CONNECTED'].includes(result.state) || (result.lease_ms ?? 0) <= 0 ||
            ['REVOKING', 'REVOKED'].includes(admission.state) || admission.operation_revision !== claimed.operation_revision) {
          if (admission.role === 'presenter') await stopRun(context, 'PRESENTER_ADMISSION_ENDED', actual.presenter_user_id);
          else await revokeAdmission(context, admission);
        } else {
          await context.tx.update(schema.liveAdmissions).set({ state: 'ACTIVE', updated_at: new Date() }).where(eq(schema.liveAdmissions.id, admission.id));
          if (admission.role === 'presenter' && actual.state === 'PREPARING') {
            await context.tx.update(schema.liveRuns).set({ state: 'RUNNING', started_at: new Date(), revision: actual.revision + 1, updated_at: new Date() })
              .where(eq(schema.liveRuns.id, actual.id));
          }
        }
      } else if (claimed.kind === 'REVOKE_RUN') await confirmRunTeardown(context, actual);
      else {
        const [admission] = await context.tx.update(schema.liveAdmissions).set({ state: 'REVOKED', revoked_at: new Date(),
          teardown_confirmed_at: new Date(), updated_at: new Date() }).where(eq(schema.liveAdmissions.id, claimed.admission_id!)).returning();
        if (admission?.role === 'presenter' && context.run?.id === actual.id) await stopRun(context, 'PRESENTER_ADMISSION_ENDED', actual.presenter_user_id);
      }
      await context.tx.update(schema.liveMediaOperations).set({ state: 'ACKED', claim_token: null, lease_expires_at: null,
        last_error_code: null, updated_at: new Date() }).where(eq(schema.liveMediaOperations.id, operation.id));
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(error.code)
      ? error.code : 'LIVE_MEDIA_UNAVAILABLE';
    await getDatabase().update(schema.liveMediaOperations).set({ state: 'PENDING', claim_token: null, lease_expires_at: null,
      available_at: new Date(Date.now() + Math.min(30_000, 500 * 2 ** Math.min(claimed.attempts, 6))), last_error_code: code, updated_at: new Date() })
      .where(and(eq(schema.liveMediaOperations.id, claimed.id), eq(schema.liveMediaOperations.claim_token, claimed.claim_token!), eq(schema.liveMediaOperations.state, 'PROCESSING')));
  }
  return true;
}

export async function reconcileLiveRuntime(media: LiveMediaTransport = liveMediaClient) {
  requireLiveAuthorityEpoch();
  let health: LiveMediaHealth | undefined;
  try {
    health = await media.discover();
    await getDatabase().transaction(tx => observeLiveMediaNode(tx, health!));
  } catch { health = undefined; /* Unreachability or invalid boot metadata is never proof of old-node death. */ }
  const rows = await getDatabase().select({ id: schema.liveRuns.id, occurrence_id: schema.liveRuns.occurrence_id }).from(schema.liveRuns)
    .where(isNull(schema.liveRuns.teardown_confirmed_at)).orderBy(asc(schema.liveRuns.created_at));
  for (const row of rows) await withLiveOccurrence({ occurrenceId: row.occurrence_id }, undefined, true, async context => {
    if (!context.run || context.run.id !== row.id || context.run.teardown_confirmed_at) return;
    const run = context.run;
    const [node] = await context.tx.select().from(schema.liveMediaNodes).where(eq(schema.liveMediaNodes.id, run.node_instance_id));
    if (node?.observed_dead_at) { await confirmRunTeardown(context, run); return; }
    let reason: string | null = null;
    try { await assertPublished(context); assertRun(context); }
    catch (error) { reason = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'LIVE_AUTHORITY_UNAVAILABLE'; }
    const [presenter] = await context.tx.select().from(schema.liveAdmissions).where(and(eq(schema.liveAdmissions.run_id, run.id), eq(schema.liveAdmissions.role, 'presenter')));
    if (!presenter || presenter.teardown_confirmed_at || ['REVOKING', 'REVOKED'].includes(presenter.state) ||
        Date.now() - (presenter.last_authorized_at ?? run.created_at).getTime() >= 10_000) reason ??= 'PRESENTER_AUTHORITY_EXPIRED';
    if (health && (health.node_instance_id !== run.node_instance_id || health.authority_epoch !== run.authority_epoch)) reason ??= 'LIVE_MEDIA_NODE_REPLACED';
    if (reason && run.state !== 'STOPPING') await stopRun(context, reason, run.presenter_user_id);
    // STOPPING retains its capacity and durable retry until matching observed
    // teardown or a separately authenticated host death witness arrives.
  });
  return { inspected: rows.length };
}
export const liveDeathWitnessSchema = z.object({ witness_id: z.string().uuid().transform(v => v.toLowerCase()),
  node_instance_id: z.string().uuid().transform(v => v.toLowerCase()), authority_epoch: z.string().uuid().transform(v => v.toLowerCase()),
  managed_instance_id: z.string().uuid().transform(v => v.toLowerCase()), process_start_ticks: z.string().regex(/^[0-9]{1,32}$/),
  reason: z.literal('PINNED_PROCESS_EXIT') }).strict();
export async function acceptLiveMediaDeathWitness(input: z.infer<typeof liveDeathWitnessSchema>) {
  const epoch = requireLiveAuthorityEpoch().epoch_id;
  if (input.authority_epoch !== epoch) throw liveError('LIVE_WITNESS_FENCE_MISMATCH', 'The host witness does not match the current authority.');
  await getDatabase().transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_live_host_witness_v1'),hashtext(${input.witness_id}))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_live_media_node_v1'),hashtext(${input.node_instance_id}))`);
    let [node] = await tx.select().from(schema.liveMediaNodes).where(eq(schema.liveMediaNodes.id, input.node_instance_id)).for('update');
    if (node && (node.authority_epoch !== input.authority_epoch || node.managed_instance_id !== input.managed_instance_id)) {
      throw liveError('LIVE_WITNESS_FENCE_MISMATCH', 'The host witness does not match a recorded media boot.');
    }
    if (!node) {
      [node] = await tx.insert(schema.liveMediaNodes).values({ id: input.node_instance_id, managed_instance_id: input.managed_instance_id,
        authority_epoch: input.authority_epoch, endpoint_fingerprint: liveMediaEndpointFingerprint(), accepting_new_runs: false,
        observed_dead_at: new Date(), death_witness_id: input.witness_id }).returning();
    }
    const digest = hash(canonical(input));
    const [prior] = await tx.select().from(schema.liveMediaDeathWitnesses).where(eq(schema.liveMediaDeathWitnesses.id, input.witness_id));
    if (prior && prior.body_sha256 !== digest) throw liveError('LIVE_IDEMPOTENCY_CONFLICT', 'The witness ID was already used for different process evidence.');
    if (!prior) await tx.insert(schema.liveMediaDeathWitnesses).values({ id: input.witness_id, node_instance_id: node.id,
      authority_epoch: input.authority_epoch, managed_instance_id: input.managed_instance_id, process_start_ticks: input.process_start_ticks, body_sha256: digest });
    await tx.update(schema.liveMediaNodes).set({ observed_dead_at: node.observed_dead_at ?? new Date(), death_witness_id: input.witness_id,
      accepting_new_runs: false }).where(eq(schema.liveMediaNodes.id, node.id));
  });
  // Persisting the matching witness first makes partial reconciliation safe.
  // A crash here retains slots until the normal reconciler sees that witness.
  await reconcileLiveRuntime();
  return { accepted: true, node_instance_id: input.node_instance_id };
}

export async function reconcileLiveWindowBoundaries() {
  requireLiveAuthorityEpoch();
  const rows = await getDatabase().select({ occurrence: schema.liveScheduleOccurrences, control: schema.liveOccurrenceControls })
    .from(schema.liveScheduleOccurrences).leftJoin(schema.liveOccurrenceControls, eq(schema.liveOccurrenceControls.occurrence_id, schema.liveScheduleOccurrences.id))
    .where(sql`${schema.liveScheduleOccurrences.publish_id} IS NOT NULL AND (
      (${schema.liveScheduleOccurrences.state}='PUBLISHED' AND ${schema.liveScheduleOccurrences.start_at}<=${nowUtc()}
        AND ${schema.liveScheduleOccurrences.end_at}>${nowUtc()} AND ${schema.liveOccurrenceControls.start_notified_at} IS NULL)
      OR (${schema.liveOccurrenceControls.start_notified_at} IS NOT NULL AND ${schema.liveOccurrenceControls.end_notified_at} IS NULL
        AND ${schema.liveScheduleOccurrences.end_at}<=${nowUtc()}))`);
  for (const { occurrence: hint } of rows) await getDatabase().transaction(async tx => {
    // A boundary is a durable wake hint, not a grant. It must work even when a
    // fallback manifest is invalid, using only normalized audience/windows.
    await tx.select({ id: schema.roles.id }).from(schema.roles).orderBy(asc(schema.roles.id)).for('share');
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, hint.presenter_user_id)).for('share');
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'))`);
    const [row] = await tx.select().from(schema.liveScheduleOccurrences).where(eq(schema.liveScheduleOccurrences.id, hint.id)).for('update');
    if (!row) return;
    await tx.insert(schema.liveOccurrenceControls).values({ occurrence_id: row.id }).onConflictDoNothing();
    const [control] = await tx.select().from(schema.liveOccurrenceControls).where(eq(schema.liveOccurrenceControls.occurrence_id, row.id)).for('update');
    const now = new Date(), ended = row.end_at <= now;
    if (ended ? !control.start_notified_at || control.end_notified_at : control.start_notified_at || row.start_at > now || row.state !== 'PUBLISHED') return;
    const [publication] = await tx.select().from(schema.publishes).where(eq(schema.publishes.id, row.publish_id!)).for('share');
    if (!ended && (!publication || publication.status !== 'ACTIVE' || publication.taken_down_at)) return;
    await createDeviceCommandsInTransaction(tx, [...row.screen_ids].sort().map(screenId => ({ screenId, type: 'RESYNC', createdBy: row.presenter_user_id,
      payload: { reason: ended ? 'LIVE_WINDOW_ENDED' : 'LIVE_WINDOW_STARTED' }, priority: 100,
      idempotencyKey: `liveboundary:${row.id}:${ended ? 'END' : 'START'}` })), { ignoreIdempotencyConflicts: true });
    await tx.update(schema.liveOccurrenceControls).set({ ...(ended ? { end_notified_at: now } : { start_notified_at: now }), updated_at: now })
      .where(eq(schema.liveOccurrenceControls.occurrence_id, row.id));
    requireLiveAuthorityEpoch();
  });
  return { inspected: rows.length };
}
