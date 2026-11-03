import { createHash } from 'node:crypto';
import { subject } from '@casl/ability';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { getDatabase, schema, type DbExecutor } from '@/db';
import type { MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { defineAbilityFor, type Action } from '@/rbac';
import { canReadContentResource, canReferenceContentResource, type ContentOwnedResource, type ContentSubject } from '@/rbac/content-ownership';
import { getUserDepartments } from '@/db/repositories/user-departments';
import { createScheduleReservationService } from '@/services/scheduling/reservation-service';
import { normalizeDocumentPage } from '@/utils/document-page-selection';
import { normalizeVideoLoopEnabled } from '@/utils/video-loop';
import { AppError } from '@/utils/app-error';
import { LiveFallbackManifestError, validateLiveFallbackManifest, type FrozenFallbackManifest, type NormalizedFallbackAsset } from './live-fallback-manifest';
import { assertCanPrepareLiveFallback } from './live-fallback-authorization';

export const LIVE_PLAYER_CAPABILITY = 'live_broadcast_v1';
const activeStates: Array<'HELD' | 'RESERVED' | 'PUBLISHED'> = ['HELD', 'RESERVED', 'PUBLISHED'];
function fail(code: string, message: string, statusCode = 409, details?: Record<string, unknown>): never {
  throw new AppError({ code, message, statusCode, details });
}

/** Stable streaming canonical JSON hash: no asset-count/dependency-depth cap. */
export function liveSchedulingFingerprint(value: unknown): string {
  const hash = createHash('sha256');
  const pending: Array<{ value?: unknown; token?: string }> = [{ value }];
  while (pending.length) {
    const next = pending.pop()!;
    if (next.token !== undefined) { hash.update(next.token); continue; }
    const current = next.value;
    if (current === null || current === undefined) { hash.update('null'); continue; }
    if (typeof current !== 'object') {
      if (!['string', 'number', 'boolean'].includes(typeof current) || (typeof current === 'number' && !Number.isFinite(current))) {
        fail('LIVE_POLICY_INVALID', 'Live policy must contain finite JSON values.', 422);
      }
      hash.update(JSON.stringify(current)); continue;
    }
    if (Array.isArray(current)) {
      hash.update('['); pending.push({ token: ']' });
      for (let i = current.length - 1; i >= 0; i--) {
        pending.push({ value: current[i] }); if (i > 0) pending.push({ token: ',' });
      }
    } else {
      const object = current as Record<string, unknown>, keys = Object.keys(object).filter(key => object[key] !== undefined).sort();
      hash.update('{'); pending.push({ token: '}' });
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]!; pending.push({ value: object[key] }); pending.push({ token: ':' }); pending.push({ token: JSON.stringify(key) });
        if (i > 0) pending.push({ token: ',' });
      }
    }
  }
  return hash.digest('hex');
}

export type LiveSchedulingHints = {
  schedule_id: string;
  schedule_revision: number | null;
  presenter_user_ids: string[];
  sessions: Array<{ id: string; presenter_user_id: string; policy_revision: number }>;
};
export async function preloadLiveSchedulingHints(scheduleId: string, db: DbExecutor = getDatabase()): Promise<LiveSchedulingHints> {
  const [schedule] = await db.select({ revision: schema.schedules.revision }).from(schema.schedules).where(eq(schema.schedules.id, scheduleId));
  const items = await db.select({ id: schema.scheduleItems.live_session_id }).from(schema.scheduleItems)
    .where(and(eq(schema.scheduleItems.schedule_id, scheduleId), eq(schema.scheduleItems.source_kind, 'LIVE')));
  const ids = [...new Set(items.flatMap(item => item.id ? [item.id] : []))].sort();
  const sessions = ids.length ? await db.select({ id: schema.liveSessions.id, presenter_user_id: schema.liveSessions.presenter_user_id,
    policy_revision: schema.liveSessions.policy_revision }).from(schema.liveSessions).where(inArray(schema.liveSessions.id, ids)).orderBy(asc(schema.liveSessions.id)) : [];
  return { schedule_id: scheduleId, schedule_revision: schedule?.revision ?? null,
    presenter_user_ids: [...new Set(sessions.map(row => row.presenter_user_id))].sort(), sessions };
}

export type LiveFallbackSourceObject = {
  storage_object_id: string; bucket: string; object_key: string; sha256: string; size: number; content_type: string;
};
export type LiveFallbackSourceEntry = {
  id: string; media_id: string; order: number; slot_id?: string;
  duration_seconds?: number; page_number?: number; fit_mode?: 'contain' | 'cover' | 'stretch';
  audio_enabled?: boolean; loop_enabled?: boolean;
};
export type LiveFallbackSourceGraph = {
  version: 1;
  presentation: { id: string; layout: { id: string; aspect_ratio: string; spec: unknown } | null; items: LiveFallbackSourceEntry[] };
  assets: Array<{
    media_id: string; source_type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'WEBPAGE';
    representation: 'SOURCE' | 'READY' | 'WEBPAGE_PREVIEW';
    object: LiveFallbackSourceObject; source_object: LiveFallbackSourceObject | null;
    duration_seconds: number | null; page_count: number | null;
    /** Legacy HLS segments aren't independently catalogued. This conservative
     * processing revision may stale preparation on unrelated metadata edits. */
    legacy_hls_revision?: string;
  }>;
};
export type CollectedLiveFallbackSource = { source_fingerprint: string; source_graph: LiveFallbackSourceGraph };

/** Privileged durable-worker entrypoint, not an HTTP authorization substitute.
 * Rechecks the current creator's account/role/department/library permissions.
 * Call BEFORE locking the preparation row to preserve role→user→content order. */
export async function collectLiveFallbackPreparationSource(createdBy: string, presentationId: string, executor: DbExecutor): Promise<CollectedLiveFallbackSource> {
  const roles = await executor.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles).orderBy(asc(schema.roles.id)).for('share');
  const [user] = await executor.select().from(schema.users).where(eq(schema.users.id, createdBy)).for('share');
  const role = user ? roles.find(row => row.id === user.role_id) : undefined;
  if (!user || !user.is_active || user.deleted_at || !role) throw AppError.unauthorized('Fallback creator access is no longer active.');
  const membership = await getUserDepartments(user.id, executor);
  const actor = { userId: user.id, roleName: role.name, departmentId: user.department_id,
    departmentIds: membership?.departmentIds ?? [] };
  const ability = await defineAbilityFor(role.id, user.id, user.department_id ?? undefined);
  assertCanPrepareLiveFallback({ ability });
  return collectLiveFallbackSource({ actor, ability, executor }, presentationId);
}

function requireRead(context: MutationAuthorizationContext, row: ContentOwnedResource, type: ContentSubject) {
  const ability = { can: (action: string) => context.ability.can(action as Action, subject(type, row) as never) };
  if (!canReadContentResource(context.actor, row, ability, type)) throw AppError.forbidden();
}
function sourceObject(row: typeof schema.storageObjects.$inferSelect | undefined): LiveFallbackSourceObject {
  if (!row || !row.sha256 || !/^[a-f0-9]{64}$/i.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size! <= 0 || !row.content_type) {
    fail('LIVE_FALLBACK_UNVERIFIED', 'The fallback does not have a verified playback object.', 422);
  }
  return { storage_object_id: row.id, bucket: row.bucket, object_key: row.object_key,
    sha256: row.sha256.toLowerCase(), size: row.size!, content_type: row.content_type.toLowerCase() };
}

/** DB-only collection, also used before asynchronous copy work. The caller
 * provides current authorization; all graph locks are SHARE and no S3 I/O runs. */
export async function collectLiveFallbackSource(context: MutationAuthorizationContext, presentationId: string): Promise<CollectedLiveFallbackSource> {
  const db = context.executor;
  const [presentation] = await db.select().from(schema.presentations).where(eq(schema.presentations.id, presentationId)).for('share');
  if (!presentation) throw AppError.notFound('Fallback presentation not found');
  requireRead(context, presentation, 'Presentation');
  const [layout] = presentation.layout_id ? await db.select().from(schema.layouts).where(eq(schema.layouts.id, presentation.layout_id)).for('share') : [];
  if (presentation.layout_id && !layout) fail('LIVE_FALLBACK_UNVERIFIED', 'The fallback layout is missing.', 422);
  if (layout) {
    requireRead(context, layout, 'Layout');
    if (!canReferenceContentResource(presentation, layout)) throw AppError.forbidden();
  }
  const legacy = await db.select().from(schema.presentationItems).where(eq(schema.presentationItems.presentation_id, presentationId))
    .orderBy(asc(schema.presentationItems.order), asc(schema.presentationItems.id));
  const slots = await db.select().from(schema.presentationSlotItems).where(eq(schema.presentationSlotItems.presentation_id, presentationId))
    .orderBy(asc(schema.presentationSlotItems.slot_id), asc(schema.presentationSlotItems.order), asc(schema.presentationSlotItems.id));
  const entries: Array<{ id: string; media_id: string; order: number; duration_seconds: number | null; page_number: number | null;
    slot_id?: string; fit_mode?: string | null; audio_enabled?: boolean | null; loop_enabled?: boolean | null }> = [...legacy, ...slots];
  if (!entries.length || (slots.length && !layout)) fail('LIVE_FALLBACK_UNVERIFIED', 'The fallback has no playable presentation entries.', 422);
  const mediaIds = [...new Set(entries.map(row => row.media_id))].sort();
  const media = await db.select().from(schema.media).where(inArray(schema.media.id, mediaIds)).orderBy(asc(schema.media.id)).for('share');
  if (media.length !== mediaIds.length) fail('LIVE_FALLBACK_UNVERIFIED', 'The fallback contains missing media.', 422);
  const mediaMap = new Map(media.map(row => [row.id, row]));
  const objectIds = [...new Set(media.flatMap(row => [row.ready_object_id, row.source_object_id].filter((id): id is string => Boolean(id))))].sort();
  const objects = objectIds.length ? await db.select().from(schema.storageObjects).where(inArray(schema.storageObjects.id, objectIds))
    .orderBy(asc(schema.storageObjects.id)).for('share') : [];
  const objectMap = new Map(objects.map(row => [row.id, row]));
  const assets: LiveFallbackSourceGraph['assets'] = [];
  for (const row of media) {
    requireRead(context, row, 'Media');
    if (!canReferenceContentResource(presentation, row)) throw AppError.forbidden();
    if (row.status !== 'READY' || row.deleted_at) fail('LIVE_FALLBACK_UNVERIFIED', 'All fallback media must be READY and available.', 422);
    let source = row.source_object_id ? objectMap.get(row.source_object_id) : undefined;
    if (!source && row.source_bucket && row.source_object_key) {
      [source] = await db.select().from(schema.storageObjects).where(and(eq(schema.storageObjects.bucket, row.source_bucket), eq(schema.storageObjects.object_key, row.source_object_key))).for('share');
    }
    const delivered = sourceObject(row.ready_object_id ? objectMap.get(row.ready_object_id) : source);
    if ((row.type === 'DOCUMENT' && (delivered.content_type !== 'application/pdf' || !row.page_count || row.page_count < 1)) ||
      (row.type === 'WEBPAGE' && (!row.ready_object_id || !delivered.content_type.startsWith('image/'))) ||
      (row.type === 'IMAGE' && !delivered.content_type.startsWith('image/')) ||
      (row.type === 'VIDEO' && !row.ready_object_id)) {
      fail('LIVE_FALLBACK_UNVERIFIED', 'The fallback playback representation is not ready.', 422);
    }
    const isHls = row.type === 'VIDEO' && /mpegurl/i.test(delivered.content_type);
    const verifiedSource = source && source.sha256 && /^[a-f0-9]{64}$/i.test(source.sha256) && Number.isSafeInteger(source.size) && source.size! > 0 && source.content_type ? sourceObject(source) : null;
    assets.push({ media_id: row.id, source_type: row.type,
      representation: row.type === 'WEBPAGE' ? 'WEBPAGE_PREVIEW' : row.ready_object_id ? 'READY' : 'SOURCE',
      object: delivered, source_object: verifiedSource,
      duration_seconds: row.duration_seconds, page_count: row.page_count,
      ...(isHls ? { legacy_hls_revision: row.updated_at.toISOString() } : {}) });
  }
  const items: LiveFallbackSourceEntry[] = entries.map(entry => {
    const row = mediaMap.get(entry.media_id)!;
    const page = normalizeDocumentPage(row, entry.page_number ?? undefined);
    if (entry.fit_mode && !['contain', 'cover', 'stretch'].includes(entry.fit_mode)) fail('LIVE_FALLBACK_UNVERIFIED', 'Unsupported fallback fit mode.', 422);
    return { id: entry.id, media_id: entry.media_id, order: entry.order,
      ...(entry.slot_id ? { slot_id: entry.slot_id } : {}),
      ...(entry.duration_seconds ? { duration_seconds: entry.duration_seconds } : {}),
      ...(page ? { page_number: page } : {}),
      ...(entry.fit_mode ? { fit_mode: entry.fit_mode as 'contain' | 'cover' | 'stretch' } : {}),
      ...(entry.slot_id ? { audio_enabled: entry.audio_enabled ?? false, loop_enabled: normalizeVideoLoopEnabled(row.type, entry.loop_enabled) } : {}) };
  });
  const source_graph: LiveFallbackSourceGraph = { version: 1, presentation: { id: presentation.id,
    layout: layout ? { id: layout.id, aspect_ratio: layout.aspect_ratio, spec: layout.spec } : null, items }, assets };
  return { source_fingerprint: liveSchedulingFingerprint(source_graph), source_graph };
}

export type FrozenLivePolicy = {
  version: 1; source_kind: 'LIVE'; schedule_id: string; schedule_item_id: string; schedule_revision: number;
  live_session_id: string; presenter_user_id: string; policy_revision: number;
  microphone: boolean; screen_share_audio: boolean; start_at: string; end_at: string; priority: number;
  screen_ids: string[];
  fallback: { preparation_id: string; source_fingerprint: string; manifest: FrozenFallbackManifest };
};
export type PreparedLiveItem = { policy: FrozenLivePolicy; item_fingerprint: string };
export type PreparedLiveSchedule = { schedule_id: string; schedule_revision: number; fingerprint: string; items: PreparedLiveItem[] };
const authorizations = new WeakMap<PreparedLiveSchedule, { executor: DbExecutor; seal: string }>();

async function preparedFallback(context: MutationAuthorizationContext, presentationId: string, preparationId: string | undefined) {
  const collected = await collectLiveFallbackSource(context, presentationId);
  if (!preparationId) fail('LIVE_FALLBACK_PREPARING', 'Prepare the immutable fallback before submitting this schedule.');
  const [preparation] = await context.executor.select().from(schema.liveFallbackPreparations)
    .where(eq(schema.liveFallbackPreparations.id, preparationId)).for('share');
  if (!preparation || preparation.presentation_id !== presentationId || preparation.state !== 'READY') fail('LIVE_FALLBACK_PREPARING', 'The immutable fallback is not READY.');
  if (preparation.source_fingerprint !== collected.source_fingerprint) fail('LIVE_APPROVAL_STALE', 'The fallback changed after preparation. Prepare it again and obtain fresh approval.');
  const rows = await context.executor.select().from(schema.liveFallbackPreparationAssets)
    .innerJoin(schema.storageObjects, eq(schema.liveFallbackPreparationAssets.storage_object_id, schema.storageObjects.id))
    .where(eq(schema.liveFallbackPreparationAssets.preparation_id, preparationId))
    .orderBy(asc(schema.liveFallbackPreparationAssets.asset_id)).for('share');
  const assets: NormalizedFallbackAsset[] = rows.map(({ live_fallback_preparation_assets: asset, storage_objects: object }) => {
    if (asset.sha256 !== object.sha256 || asset.size !== object.size || asset.content_type !== object.content_type) fail('LIVE_FALLBACK_UNVERIFIED', 'Prepared fallback storage metadata does not match its frozen checksum.', 422);
    return { id: asset.asset_id, media_id: asset.media_id, storage_object_id: asset.storage_object_id,
      bucket: object.bucket, object_key: object.object_key, sha256: asset.sha256, size: asset.size,
      content_type: asset.content_type, render_type: asset.render_type, source_type: asset.source_type,
      status: asset.status, representation: asset.representation, dependencies: asset.dependencies,
      source_object_id: asset.source_object_id, source_sha256: asset.source_sha256, source_content_type: asset.source_content_type };
  });
  try {
    const manifest = validateLiveFallbackManifest(preparation.manifest, { presentationId, assets });
    const sources = new Map(collected.source_graph.assets.map(asset => [asset.media_id, asset]));
    if (assets.some(asset => !sources.has(asset.media_id) || sources.get(asset.media_id)!.source_type !== asset.source_type)) fail('LIVE_FALLBACK_MANIFEST_INVALID', 'Prepared media does not match the approved source graph.', 422);
    if (liveSchedulingFingerprint(manifest.presentation.layout ?? null) !== liveSchedulingFingerprint(collected.source_graph.presentation.layout)) fail('LIVE_FALLBACK_MANIFEST_INVALID', 'Prepared layout differs from the source graph.', 422);
    const manifestAssets = new Map(manifest.assets.map(asset => [asset.id, asset]));
    const entries = new Map(manifest.presentation.items.map(entry => [entry.id, entry]));
    const semantics = (entry: Omit<LiveFallbackSourceEntry, 'media_id'>) => ({ id: entry.id, slot_id: entry.slot_id ?? null,
      order: entry.order, duration_seconds: entry.duration_seconds ?? null, page_number: entry.page_number ?? null,
      fit_mode: entry.fit_mode ?? 'contain', audio_enabled: entry.audio_enabled ?? false, loop_enabled: entry.loop_enabled ?? false });
    if (entries.size !== collected.source_graph.presentation.items.length || collected.source_graph.presentation.items.some(source => {
      const entry = entries.get(source.id);
      return !entry || manifestAssets.get(entry.asset_id)?.media_id !== source.media_id || liveSchedulingFingerprint(semantics(entry)) !== liveSchedulingFingerprint(semantics(source));
    })) fail('LIVE_FALLBACK_MANIFEST_INVALID', 'Prepared playback entries differ from the source graph.', 422);
    return { preparation, manifest };
  }
  catch (error) { if (error instanceof LiveFallbackManifestError) fail(error.code, 'The prepared fallback graph is invalid.', 422, { reason: error.reason }); throw error; }
}

/** Caller order: current sorted shared identity locks → global target lock →
 * schedule row lock → this function. Hints authorize no data: any changed
 * presenter/policy identity returns409 before a late user lock could deadlock. */
export async function prepareLiveSchedule(context: MutationAuthorizationContext, params: {
  scheduleId: string; identityHints: LiveSchedulingHints; fallbackPreparationIds: Record<string, string>;
  explicitScreenIds?: string[]; explicitScreenGroupIds?: string[];
}): Promise<PreparedLiveSchedule> {
  const resolved = await createScheduleReservationService().resolveScheduleWindows(params, context.executor);
  const items = resolved.scheduleItems.filter(item => item.source_kind === 'LIVE');
  if (items.length) {
    requireRead(context, resolved.schedule, 'Schedule');
    if (!resolved.schedule.is_active) fail('LIVE_SCHEDULE_INACTIVE', 'Activate the schedule before submitting live items.', 422);
  }
  const prepared: PreparedLiveSchedule = { schedule_id: params.scheduleId, schedule_revision: resolved.schedule.revision, fingerprint: '', items: [] };
  if (params.identityHints.schedule_id !== params.scheduleId || params.identityHints.schedule_revision !== resolved.schedule.revision) fail('LIVE_AUTHORIZATION_RETRY', 'Schedule identities changed. Reload and retry.');
  const ids = [...new Set(items.flatMap(item => item.live_session_id ? [item.live_session_id] : []))].sort();
  const sessions = ids.length ? await context.executor.select().from(schema.liveSessions).where(inArray(schema.liveSessions.id, ids)).orderBy(asc(schema.liveSessions.id)).for('share') : [];
  const hints = new Map(params.identityHints.sessions.map(row => [row.id, row]));
  for (const session of sessions) {
    const hint = hints.get(session.id);
    if (!hint || hint.presenter_user_id !== session.presenter_user_id || hint.policy_revision !== session.policy_revision || !params.identityHints.presenter_user_ids.includes(session.presenter_user_id)) fail('LIVE_AUTHORIZATION_RETRY', 'Presenter identities changed. Reload and retry.');
  }
  if (sessions.length !== ids.length) fail('LIVE_SESSION_UNAVAILABLE', 'A selected live source is unavailable.', 422);
  const sessionMap = new Map(sessions.map(row => [row.id, row]));
  const sourceUsers = [...new Set(sessions.map(row => row.presenter_user_id))].sort();
  const users = sourceUsers.length ? await context.executor.select().from(schema.users).where(inArray(schema.users.id, sourceUsers)) : [];
  const userMap = new Map(users.map(row => [row.id, row]));
  const presenterRoleIds = [...new Set(users.map(row => row.role_id))];
  const presenterRoles = presenterRoleIds.length ? await context.executor.select({ id: schema.roles.id }).from(schema.roles).where(inArray(schema.roles.id, presenterRoleIds)) : [];
  const presenterRoleSet = new Set(presenterRoles.map(row => row.id));
  for (const session of sessions) {
    requireRead(context, session, 'LiveBroadcast');
    if (!canReferenceContentResource(resolved.schedule, session)) throw AppError.forbidden();
    const presenter = userMap.get(session.presenter_user_id);
    if (!session.is_active || session.deleted_at || !presenter || !presenter.is_active || presenter.deleted_at || !presenterRoleSet.has(presenter.role_id)) fail('LIVE_SESSION_UNAVAILABLE', 'The source or assigned presenter is unavailable.', 422);
    if (session.owner_scope === 'DEPARTMENT' && !(await getUserDepartments(presenter.id, context.executor))?.departmentIds.includes(session.owner_department_id!)) fail('LIVE_PRESENTER_UNAVAILABLE', 'The assigned presenter no longer belongs to the source department.', 422);
  }
  const windows = new Map<string, Set<string>>();
  for (const window of resolved.windows) { const set = windows.get(window.schedule_item_id) ?? new Set<string>(); set.add(window.screen_id); windows.set(window.schedule_item_id, set); }
  const hasExplicitScope = Boolean(params.explicitScreenIds?.length || params.explicitScreenGroupIds?.length);
  const explicitScope = new Set(hasExplicitScope
    ? await createScheduleReservationService().resolveScreenIds(params.explicitScreenIds, params.explicitScreenGroupIds, context.executor) : []);
  if (hasExplicitScope) for (const item of items) {
    windows.set(item.id, new Set([...(windows.get(item.id) ?? [])].filter(id => explicitScope.has(id))));
  }
  const targetIds = [...new Set(items.flatMap(item => [...(windows.get(item.id) ?? [])]))].sort();
  const screens = targetIds.length ? await context.executor.select().from(schema.screens).where(inArray(schema.screens.id, targetIds)).orderBy(asc(schema.screens.id)).for('share') : [];
  if (screens.length !== targetIds.length) fail('LIVE_TARGET_UNAVAILABLE', 'A selected target screen is no longer available.', 422, { missing_count: targetIds.length - screens.length });
  const screenMap = new Map(screens.map(row => [row.id, row]));
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    const audience = [...(windows.get(item.id) ?? [])].sort();
    if (!audience.length || audience.length > 25) fail('LIVE_AUDIENCE_LIMIT', 'Each live item requires between 1 and 25 distinct target screens.', 422, { target_count: audience.length, maximum: 25 });
    if (!(item.start_at < item.end_at) || item.start_at < resolved.schedule.start_at || item.end_at > resolved.schedule.end_at) fail('LIVE_WINDOW_INVALID', 'A live item must be inside its schedule window.', 422);
    const unsupported = audience.filter(id => {
      const target = screenMap.get(id);
      if (target && !context.ability.can('read', subject('Screen', target) as never)) throw AppError.forbidden();
      const info = screenMap.get(id)?.device_info as { player_capabilities?: { features?: unknown } } | null | undefined;
      return !Array.isArray(info?.player_capabilities?.features) || !info.player_capabilities.features.includes(LIVE_PLAYER_CAPABILITY);
    });
    if (unsupported.length) fail('LIVE_PLAYER_UNSUPPORTED', 'Upgrade every selected player before scheduling live.', 422, { unsupported_screen_ids: unsupported });
    const [presentation] = await context.executor.select().from(schema.presentations).where(eq(schema.presentations.id, item.presentation_id)).for('share');
    if (!presentation || !canReferenceContentResource(resolved.schedule, presentation)) throw AppError.forbidden();
    const fallback = await preparedFallback(context, item.presentation_id, params.fallbackPreparationIds?.[item.presentation_id]);
    const session = sessionMap.get(item.live_session_id!)!;
    const policy: FrozenLivePolicy = { version: 1, source_kind: 'LIVE', schedule_id: resolved.schedule.id, schedule_item_id: item.id,
      schedule_revision: resolved.schedule.revision, live_session_id: session.id, presenter_user_id: session.presenter_user_id,
      policy_revision: session.policy_revision, microphone: session.microphone, screen_share_audio: session.screen_share_audio,
      start_at: item.start_at.toISOString(), end_at: item.end_at.toISOString(), priority: item.priority, screen_ids: audience,
      fallback: { preparation_id: fallback.preparation.id, source_fingerprint: fallback.preparation.source_fingerprint, manifest: fallback.manifest } };
    prepared.items.push({ policy, item_fingerprint: liveSchedulingFingerprint(policy) });
  }
  prepared.fingerprint = liveSchedulingFingerprint({ schedule_id: prepared.schedule_id, schedule_revision: prepared.schedule_revision, items: prepared.items });
  authorizations.set(prepared, { executor: context.executor, seal: liveSchedulingFingerprint(prepared) });
  return prepared;
}

export function assertPreparedLiveSchedule(db: DbExecutor, prepared: PreparedLiveSchedule) {
  const authorization = authorizations.get(prepared);
  if (!authorization || authorization.executor !== db || authorization.seal !== liveSchedulingFingerprint(prepared)) fail('LIVE_APPROVAL_STALE', 'Revalidate current live policy inside this transaction before reserving it.');
}

type Occurrence = typeof schema.liveScheduleOccurrences.$inferSelect;
let savepointSequence = 0;
async function capacityMutation<T>(db: DbExecutor, run: () => Promise<T>): Promise<T> {
  // SAVEPOINT also rejects an accidental autocommit executor before any write.
  const name = `darshan_live_capacity_${++savepointSequence}`;
  await db.execute(sql.raw(`SAVEPOINT ${name}`));
  try {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_live_scheduled_capacity_v1'))`);
    const result = await run();
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    return result;
  } catch (error) {
    await db.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
    await db.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    throw error;
  }
}

async function expireScheduledMetadata(db: DbExecutor, now: Date) {
  const held = await db.update(schema.liveScheduleOccurrences).set({ state: 'EXPIRED', released_at: now,
    release_reason: 'hold-or-window-expired', hold_expires_at: null, updated_at: now })
    .where(and(eq(schema.liveScheduleOccurrences.state, 'HELD'), or(lte(schema.liveScheduleOccurrences.hold_expires_at, now), lte(schema.liveScheduleOccurrences.end_at, now)))).returning();
  const reserved = await db.update(schema.liveScheduleOccurrences).set({ state: 'EXPIRED', released_at: now,
    release_reason: 'reservation-window-expired', updated_at: now })
    .where(and(eq(schema.liveScheduleOccurrences.state, 'RESERVED'), lte(schema.liveScheduleOccurrences.end_at, now))).returning();
  const published = await db.update(schema.liveScheduleOccurrences).set({ state: 'RELEASED', released_at: now,
    release_reason: 'published-window-ended', updated_at: now })
    .where(and(eq(schema.liveScheduleOccurrences.state, 'PUBLISHED'), lte(schema.liveScheduleOccurrences.end_at, now))).returning();
  // This is scheduled bookkeeping only. Never touches a runtime room/run table.
  return [...held, ...reserved, ...published];
}
export async function expireLiveHolds(db: DbExecutor, now = new Date()) {
  return capacityMutation(db, () => expireScheduledMetadata(db, now));
}

async function recolorScheduledIntervals(db: DbExecutor) {
  const rows = await db.select().from(schema.liveScheduleOccurrences)
    .where(inArray(schema.liveScheduleOccurrences.state, activeStates))
    .orderBy(asc(schema.liveScheduleOccurrences.start_at), asc(schema.liveScheduleOccurrences.end_at), asc(schema.liveScheduleOccurrences.id)).for('update');
  const ends: Array<number | undefined> = new Array(10);
  for (const row of rows) {
    const start = row.start_at.getTime();
    const slot = ends.findIndex(end => end === undefined || end <= start);
    if (slot < 0) fail('LIVE_CAPACITY_EXCEEDED', 'At most ten broadcasts may overlap.', 409, { maximum: 10, start_at: row.start_at.toISOString() });
    ends[slot] = row.end_at.getTime();
    if (row.capacity_slot !== slot + 1) await db.update(schema.liveScheduleOccurrences).set({ capacity_slot: slot + 1 }).where(eq(schema.liveScheduleOccurrences.id, row.id));
  }
  // Validate the real PostgreSQL backstop before returning to the caller.
  await db.execute(sql`SET CONSTRAINTS live_occurrences_active_capacity_excl IMMEDIATE`);
}

async function assertScreenReservations(db: DbExecutor, prepared: PreparedLiveSchedule, token: string, state: 'HELD' | 'RESERVED' | 'PUBLISHED') {
  if (!prepared.items.length) return;
  const ids = prepared.items.map(item => item.policy.schedule_item_id);
  const rows = await db.select().from(schema.scheduleReservations).where(and(
    eq(schema.scheduleReservations.reservation_token, token), inArray(schema.scheduleReservations.schedule_item_id, ids),
    inArray(schema.scheduleReservations.state, activeStates)));
  for (const { policy } of prepared.items) {
    const owned = rows.filter(row => row.schedule_item_id === policy.schedule_item_id);
    const actual = owned.map(row => row.screen_id).sort();
    if (JSON.stringify(actual) !== JSON.stringify(policy.screen_ids) || owned.some(row => row.schedule_id !== prepared.schedule_id ||
      row.state !== state || row.start_at.toISOString() !== policy.start_at || row.end_at.toISOString() !== policy.end_at)) {
      fail('LIVE_RESERVATION_MISMATCH', 'The live audience no longer matches the owned screen windows. Obtain fresh approval.');
    }
  }
}
async function assertNoUnexpectedLiveReservations(db: DbExecutor, token: string) {
  const [unexpected] = await db.select({ id: schema.liveScheduleOccurrences.id }).from(schema.liveScheduleOccurrences)
    .where(and(eq(schema.liveScheduleOccurrences.reservation_token, token), inArray(schema.liveScheduleOccurrences.state, activeStates))).limit(1);
  if (unexpected) fail('LIVE_APPROVAL_STALE', 'The reservation still contains live items. Obtain fresh approval.');
}
async function requirePublish(db: DbExecutor, prepared: PreparedLiveSchedule, publishId?: string) {
  if (!publishId) fail('LIVE_PUBLISH_REQUIRED', 'A current publication is required.');
  const [publish] = await db.select().from(schema.publishes).where(eq(schema.publishes.id, publishId));
  if (!publish || publish.schedule_id !== prepared.schedule_id || publish.status !== 'ACTIVE') fail('LIVE_PUBLISH_REQUIRED', 'The publication is unavailable.');
}

/** Call after the matching screen reservation writes in the SAME authorized
 * transaction. All logical capacity windows are colored optimally; physical
 * transmitting-room capacity is not allocated or released here. */
export async function reserveLiveSchedule(context: MutationAuthorizationContext, params: {
  prepared: PreparedLiveSchedule; reservationToken: string; state: 'HELD' | 'PUBLISHED';
  scheduleRequestId?: string; holdExpiresAt?: Date; publishId?: string;
}): Promise<Occurrence[]> {
  const db = context.executor, { prepared } = params;
  assertPreparedLiveSchedule(db, prepared);
  if (!prepared.items.length) { await assertNoUnexpectedLiveReservations(db, params.reservationToken); return []; }
  return capacityMutation(db, async () => {
    const now = new Date();
    await expireScheduledMetadata(db, now);
    await assertScreenReservations(db, prepared, params.reservationToken, params.state);
    if (params.state === 'HELD') {
      if (!params.scheduleRequestId || !params.holdExpiresAt || !Number.isFinite(params.holdExpiresAt.getTime()) || params.holdExpiresAt <= now) fail('LIVE_HOLD_REQUIRED', 'A current request hold is required.');
      const [request] = await db.select().from(schema.scheduleRequests).where(eq(schema.scheduleRequests.id, params.scheduleRequestId));
      if (!request || request.schedule_id !== prepared.schedule_id || request.reservation_token !== params.reservationToken || request.reservation_version !== prepared.schedule_revision) fail('LIVE_HOLD_REQUIRED', 'The request does not own this reservation token.');
    } else await requirePublish(db, prepared, params.publishId);
    const existing = await db.select().from(schema.liveScheduleOccurrences).where(eq(schema.liveScheduleOccurrences.reservation_token, params.reservationToken)).for('update');
    if (existing.length) {
      if (existing.length !== prepared.items.length || existing.some(row => row.approval_fingerprint !== prepared.fingerprint || row.state !== params.state ||
        !prepared.items.some(item => item.policy.schedule_item_id === row.schedule_item_id && item.item_fingerprint === row.item_fingerprint))) {
        fail('LIVE_APPROVAL_STALE', 'This reservation token already belongs to a different or ended live policy.');
      }
      return existing;
    }
    await db.execute(sql`SET CONSTRAINTS live_occurrences_active_capacity_excl DEFERRED`);
    const inserted: Occurrence[] = [];
    for (const item of prepared.items) {
      const policy = item.policy;
      const [row] = await db.insert(schema.liveScheduleOccurrences).values({ schedule_id: prepared.schedule_id,
        schedule_item_id: policy.schedule_item_id, schedule_request_id: params.scheduleRequestId ?? null,
        reservation_token: params.reservationToken, schedule_revision: prepared.schedule_revision, owner_user_id: context.actor.userId,
        live_session_id: policy.live_session_id, presenter_user_id: policy.presenter_user_id, policy_revision: policy.policy_revision,
        preparation_id: policy.fallback.preparation_id, approval_fingerprint: prepared.fingerprint,
        item_fingerprint: item.item_fingerprint, frozen_policy: policy, screen_ids: policy.screen_ids, capacity_slot: 1,
        start_at: new Date(policy.start_at), end_at: new Date(policy.end_at), state: params.state,
        hold_expires_at: params.state === 'HELD' ? params.holdExpiresAt : null,
        publish_id: params.publishId ?? null, published_at: params.state === 'PUBLISHED' ? now : null }).returning();
      const assets = await db.select().from(schema.liveFallbackPreparationAssets).where(eq(schema.liveFallbackPreparationAssets.preparation_id, policy.fallback.preparation_id));
      await db.insert(schema.liveOccurrenceAssets).values(assets.map(({ preparation_id: _preparation, ...asset }) => ({ ...asset, occurrence_id: row.id })));
      inserted.push(row);
    }
    await recolorScheduledIntervals(db);
    return db.select().from(schema.liveScheduleOccurrences).where(inArray(schema.liveScheduleOccurrences.id, inserted.map(row => row.id))).orderBy(asc(schema.liveScheduleOccurrences.schedule_item_id));
  });
}

export async function transitionLiveReservations(db: DbExecutor, params: {
  reservationToken: string; prepared: PreparedLiveSchedule; expectedFingerprint: string;
  nextState: 'RESERVED' | 'PUBLISHED'; publishId?: string;
}): Promise<Occurrence[]> {
  assertPreparedLiveSchedule(db, params.prepared);
  if (!params.prepared.items.length) { await assertNoUnexpectedLiveReservations(db, params.reservationToken); return []; }
  if (params.expectedFingerprint !== params.prepared.fingerprint) fail('LIVE_APPROVAL_STALE', 'Live policy changed after its hold. Obtain fresh approval.');
  return capacityMutation(db, async () => {
    const now = new Date(); await expireScheduledMetadata(db, now);
    const rows = await db.select().from(schema.liveScheduleOccurrences).where(eq(schema.liveScheduleOccurrences.reservation_token, params.reservationToken)).for('update');
    if (rows.length !== params.prepared.items.length || rows.some(row => row.approval_fingerprint !== params.prepared.fingerprint ||
      !params.prepared.items.some(item => item.policy.schedule_item_id === row.schedule_item_id && item.item_fingerprint === row.item_fingerprint))) {
      fail('LIVE_APPROVAL_STALE', 'Live policy or audience changed after its hold. Obtain fresh approval.');
    }
    const priorState = params.nextState === 'RESERVED' ? 'HELD' : 'RESERVED';
    if (rows.some(row => row.state !== priorState && row.state !== params.nextState)) fail('LIVE_RESERVATION_ENDED', 'The live reservation is no longer active.');
    if (params.nextState === 'PUBLISHED') {
      await requirePublish(db, params.prepared, params.publishId);
      if (rows.some(row => row.publish_id && row.publish_id !== params.publishId)) fail('LIVE_RESERVATION_CONFLICT', 'This live occurrence already belongs to another publish.');
    }
    await assertScreenReservations(db, params.prepared, params.reservationToken, params.nextState);
    if (rows.every(row => row.state === params.nextState)) return rows;
    return db.update(schema.liveScheduleOccurrences).set({ state: params.nextState, hold_expires_at: null,
      ...(params.nextState === 'RESERVED' ? { approved_at: now } : { published_at: now, publish_id: params.publishId }), updated_at: now })
      .where(eq(schema.liveScheduleOccurrences.reservation_token, params.reservationToken)).returning();
  });
}

export async function releaseLiveReservations(db: DbExecutor, params: {
  reservationToken?: string; publishId?: string; scheduleRequestId?: string;
  nextState: 'RELEASED' | 'EXPIRED' | 'CANCELLED'; reason: string;
}): Promise<Occurrence[]> {
  const selected = [params.reservationToken, params.publishId, params.scheduleRequestId].filter(Boolean);
  if (selected.length !== 1 || !params.reason) fail('LIVE_RELEASE_SELECTOR_REQUIRED', 'Select exactly one live reservation owner to release.', 422);
  return capacityMutation(db, async () => {
    const now = new Date();
    return db.update(schema.liveScheduleOccurrences).set({ state: params.nextState, released_at: now, release_reason: params.reason,
      hold_expires_at: null, updated_at: now }).where(and(inArray(schema.liveScheduleOccurrences.state, activeStates),
      params.reservationToken ? eq(schema.liveScheduleOccurrences.reservation_token, params.reservationToken) :
        params.publishId ? eq(schema.liveScheduleOccurrences.publish_id, params.publishId) : eq(schema.liveScheduleOccurrences.schedule_request_id, params.scheduleRequestId!))).returning();
  });
}
