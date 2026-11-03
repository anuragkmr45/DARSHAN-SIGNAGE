import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import { frozenLivePolicySchema, readFrozenLiveSnapshotItem, type FrozenLiveSnapshotItem } from '@/screens/live-snapshot-audience';
import { liveDeviceStateSchema, liveDiscoverySchema, type LiveDeviceIdentity } from '@/schemas/live-runtime';
import { hydrateLiveFallbackItems } from './live-fallback-delivery';
import { liveError, requireLiveAuthorityEpoch } from './live-authority-epoch';
import { hasLiveBlockingEmergency } from './live-emergency';
import { validLiveControlRunBinding } from './live-control-binding';

type Occurrence = typeof schema.liveScheduleOccurrences.$inferSelect;
const utcNow = sql`(now() AT TIME ZONE 'UTC')`;
async function identity(tx: DbExecutor, device: LiveDeviceIdentity) {
  const [screen] = await tx.select().from(schema.screens).where(eq(schema.screens.id, device.screenId)).for('share');
  const [cert] = await tx.select().from(schema.deviceCertificates).where(and(eq(schema.deviceCertificates.screen_id, device.screenId),
    eq(schema.deviceCertificates.serial, device.serial))).for('share');
  if (!screen || !cert || !cert.public_key_pem || cert.is_revoked || cert.revoked_at || cert.expires_at.getTime() <= Date.now()) {
    throw liveError('FORBIDDEN', 'Device credentials are no longer valid.', 403, { reason: 'DEVICE_CREDENTIALS_REVOKED' });
  }
  const info = screen.device_info as { player_capabilities?: { features?: unknown } } | null;
  if (!Array.isArray(info?.player_capabilities?.features) || !info.player_capabilities.features.includes('live_broadcast_v1')) {
    throw liveError('LIVE_UNSUPPORTED_PLAYER', 'This player has not advertised the required live protocol.');
  }
}
async function withRead<T>(device: LiveDeviceIdentity, callback: (tx: DbExecutor) => Promise<T>) {
  requireLiveAuthorityEpoch();
  return getDatabase().transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext('darshan_screen_target_references_v1'))`);
    await identity(tx, device);
    const result = await callback(tx); requireLiveAuthorityEpoch(); return result;
  });
}
function policyFor(row: Occurrence) {
  const parsed = frozenLivePolicySchema.safeParse(row.frozen_policy);
  if (!parsed.success) return null;
  const p = parsed.data;
  const consistent = p.schedule_id === row.schedule_id && p.schedule_item_id === row.schedule_item_id && p.schedule_revision === row.schedule_revision &&
    p.live_session_id === row.live_session_id && p.presenter_user_id === row.presenter_user_id && p.policy_revision === row.policy_revision &&
    p.fallback.preparation_id === row.preparation_id && Date.parse(p.start_at) === row.start_at.getTime() && Date.parse(p.end_at) === row.end_at.getTime() &&
    JSON.stringify(p.screen_ids) === JSON.stringify(row.screen_ids);
  if (!consistent) return null;
  return readFrozenLiveSnapshotItem({ id: p.schedule_item_id, presentation_id: p.fallback.manifest.presentation.id, source_kind: 'LIVE',
    live_session_id: p.live_session_id, start_at: p.start_at, end_at: p.end_at, priority: p.priority, screen_ids: p.screen_ids,
    screen_group_ids: p.screen_group_ids, resolved_screen_ids: p.screen_ids, live_policy: p, presentation: null }) ? p : null;
}
async function state(tx: DbExecutor, device: LiveDeviceIdentity, row: Occurrence) {
  if (!row.screen_ids.includes(device.screenId)) throw liveError('LIVE_AUDIENCE_DENIED', 'This screen is outside the frozen audience.');
  const [control] = await tx.select().from(schema.liveOccurrenceControls).where(eq(schema.liveOccurrenceControls.occurrence_id, row.id)).for('share');
  const [run] = control?.current_run_id ? await tx.select().from(schema.liveRuns).where(eq(schema.liveRuns.id, control.current_run_id)).for('share') : [];
  const bindingValid = validLiveControlRunBinding(row, control, run);
  const [desired] = await tx.select({ live_version: schema.deviceDesiredState.live_version }).from(schema.deviceDesiredState).where(eq(schema.deviceDesiredState.screen_id, device.screenId));
  const emergency = await hasLiveBlockingEmergency(tx, device.screenId);
  const policy = policyFor(row), now = Date.now();
  const availability = !bindingValid || !policy ? 'UNAVAILABLE' : now >= row.end_at.getTime() ? 'ENDED' : control?.enabled === false ? 'DISABLED'
    : emergency ? 'EMERGENCY' : run?.state === 'STOPPING' ? 'STOPPING' : now < row.start_at.getTime() || run?.state === 'PREPARING' ? 'PREPARING'
      : run?.state === 'RUNNING' ? 'READY' : 'NOT_RUNNING';
  return liveDeviceStateSchema.parse({ version: 1, authority_epoch: requireLiveAuthorityEpoch().epoch_id, server_now: new Date().toISOString(),
    live_version: desired?.live_version ?? null, availability, occurrence_id: row.id, publish_id: row.publish_id,
    schedule_id: row.schedule_id, schedule_item_id: row.schedule_item_id, start_at: row.start_at.toISOString(), end_at: row.end_at.toISOString(),
    screen_ids: row.screen_ids, control_revision: control?.revision ?? 1, enabled: control?.enabled ?? true, policy_status: policy ? 'VALID' : 'INVALID', policy,
    run: bindingValid && run ? { id: run.id, generation: run.generation, state: run.state, node_instance_id: run.node_instance_id,
      presenter_participant_id: `presenter_${run.id}`, created_at: run.created_at.toISOString(), stopped_at: run.stopped_at?.toISOString() ?? null,
      owns_current_attempt: false } : null });
}
const published = (screenId: string) => and(eq(schema.liveScheduleOccurrences.state, 'PUBLISHED'), eq(schema.publishes.status, 'ACTIVE'),
  isNull(schema.publishes.taken_down_at), sql`${screenId}::uuid=ANY(${schema.liveScheduleOccurrences.screen_ids})`);
async function selected(tx: DbExecutor, device: LiveDeviceIdentity) {
  const rows = await tx.select({ row: schema.liveScheduleOccurrences }).from(schema.liveScheduleOccurrences)
    .innerJoin(schema.publishes, eq(schema.publishes.id, schema.liveScheduleOccurrences.publish_id))
    .where(and(published(device.screenId), sql`${schema.liveScheduleOccurrences.end_at}>${utcNow}`))
    .orderBy(asc(schema.liveScheduleOccurrences.start_at), asc(schema.liveScheduleOccurrences.id));
  const now = Date.now(), current = rows.filter(({ row }) => row.start_at.getTime() <= now).map(({ row }) => row);
  const next = rows.find(({ row }) => row.start_at.getTime() > now)?.row ?? null;
  return { current, next };
}
function itemFrom(value: Awaited<ReturnType<typeof state>>): FrozenLiveSnapshotItem | null {
  const p = value.policy;
  if (!p) return null;
  return { id: p.schedule_item_id, presentation_id: p.fallback.manifest.presentation.id, source_kind: 'LIVE', live_session_id: p.live_session_id,
    start_at: p.start_at, end_at: p.end_at, priority: p.priority, screen_ids: p.screen_ids, screen_group_ids: p.screen_group_ids,
    resolved_screen_ids: p.screen_ids, live_policy: p, presentation: null };
}
function window(row: Occurrence) { return { occurrence_id: row.id, publish_id: row.publish_id!, schedule_id: row.schedule_id,
  schedule_item_id: row.schedule_item_id, start_at: row.start_at.toISOString(), end_at: row.end_at.toISOString(), screen_ids: row.screen_ids }; }
export async function readLiveDeviceOccurrenceState(device: LiveDeviceIdentity, publishId: string, itemId: string) {
  return withRead(device, async tx => {
    const rows = await tx.select({ row: schema.liveScheduleOccurrences, status: schema.publishes.status, taken_down_at: schema.publishes.taken_down_at })
      .from(schema.liveScheduleOccurrences).innerJoin(schema.publishes, eq(schema.publishes.id, schema.liveScheduleOccurrences.publish_id))
      .where(and(eq(schema.liveScheduleOccurrences.publish_id, publishId), eq(schema.liveScheduleOccurrences.schedule_item_id, itemId)));
    if (rows.length !== 1 || !rows[0].row.screen_ids.includes(device.screenId)) throw liveError('LIVE_OCCURRENCE_NOT_FOUND', 'The approved occurrence was not found for this screen.', 404);
    const value = rows[0];
    if (value.row.end_at.getTime() > Date.now() && (value.row.state !== 'PUBLISHED' || value.status !== 'ACTIVE' || value.taken_down_at)) {
      throw liveError('LIVE_REVOKED', 'The live publication is no longer active.', 410);
    }
    return state(tx, device, value.row);
  });
}
export async function discoverLiveDeviceOccurrences(device: LiveDeviceIdentity) {
  // At most two preparation attempts. Signing happens outside SQL locks; the
  // final selection and identity are read again before returning any URL.
  for (let attempt = 0; attempt < 2; attempt++) {
    const initial = await withRead(device, async tx => {
      const selection = await selected(tx, device), rows = [...(selection.current.length === 1 ? selection.current : []), ...(selection.next ? [selection.next] : [])];
      const entries = [];
      for (const row of rows) { const value = await state(tx, device, row); entries.push({ state: value, item: itemFrom(value) }); }
      return { selection, entries };
    });
    const hydrated = new Map<string, (typeof initial.entries)[number]>();
    for (const entry of initial.entries) {
      const items = entry.item ? await hydrateLiveFallbackItems([entry.item], { publishId: entry.state.publish_id,
        scheduleId: entry.state.schedule_id, screenId: device.screenId, includeUrls: true }) : [];
      hydrated.set(entry.state.occurrence_id, { state: entry.state, item: items[0] ?? null });
    }
    const result = await withRead(device, async tx => {
      const final = await selected(tx, device), wanted = [...(final.current.length === 1 ? final.current : []), ...(final.next ? [final.next] : [])];
      const entries = new Map<string, (typeof initial.entries)[number]>(); let changed = false;
      for (const row of wanted) {
        const fresh = await state(tx, device, row), prior = hydrated.get(row.id);
        // The policy is immutable. Current control/run state is refreshed here;
        // changed selection on the last attempt returns a blocking window and
        // no item, rather than exposing stale URLs or ordinary fallback.
        if (!prior || prior.state.publish_id !== fresh.publish_id || prior.state.schedule_item_id !== fresh.schedule_item_id) changed = true;
        entries.set(row.id, { state: fresh, item: prior?.item ?? null });
      }
      if (changed && attempt === 0) return null;
      const [desired] = await tx.select({ version: schema.deviceDesiredState.live_version }).from(schema.deviceDesiredState).where(eq(schema.deviceDesiredState.screen_id, device.screenId));
      return liveDiscoverySchema.parse({ version: 1, authority_epoch: requireLiveAuthorityEpoch().epoch_id, server_now: new Date().toISOString(),
        live_version: desired?.version ?? null, current: final.current.length === 1 ? entries.get(final.current[0].id) : null,
        next: final.next ? entries.get(final.next.id) : null, blocked_windows: final.current.length > 1 ? final.current.map(window) : [] });
    });
    if (result) return result;
  }
  throw liveError('LIVE_DISCOVERY_CHANGED', 'Live selection changed while preparing; retry current discovery.', 503);
}
