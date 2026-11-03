import { and, eq, gt, inArray, sql, type AnyColumn } from 'drizzle-orm';
import { type DbExecutor, schema } from '@/db';
import { AppError } from '@/utils/app-error';
import { DEFAULT_MEDIA_TARGETS_SETTING_KEY, extractDefaultMediaTargets } from '@/utils/default-media';
import { filterFrozenAudienceItemsForGroup, filterFrozenAudienceItemsForScreen, isLiveSnapshotCandidate } from '@/screens/live-snapshot-audience';
import { activeLiveOccurrenceReference } from './live-reference-guards';

type Target = { kind: 'SCREEN' | 'GROUP'; id: string; groupIds?: string[]; memberScreenIds?: string[] };
type Blockers = Record<'schedule_items' | 'active_publishes' | 'reservations' | 'active_emergencies' | 'defaults' | 'live_occurrences', number>;

function containsAny(column: AnyColumn, ids: string[]) {
  return sql`${column} ?| array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`;
}

/** Read under the same transaction and target lock as the eventual delete. */
export async function assertTargetCanBeDeleted(db: DbExecutor, target: Target): Promise<void> {
  const now = new Date();
  const nowUtc = sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const screenIds = target.kind === 'SCREEN' ? [target.id] : [];
  const reservedScreenIds = target.kind === 'SCREEN' ? screenIds : target.memberScreenIds ?? [];
  const groupIds = target.kind === 'GROUP' ? [target.id] : target.groupIds ?? [];
  const screenMatch = screenIds.length ? containsAny(schema.scheduleItems.screen_ids, screenIds) : sql`false`;
  const groupMatch = groupIds.length ? containsAny(schema.scheduleItems.screen_group_ids, groupIds) : sql`false`;
  // A transaction uses one PostgreSQL client. Run these reads in order so a
  // driver never receives concurrent queries on that same client.
  const scheduleItems = await db.select({ id: schema.scheduleItems.id }).from(schema.scheduleItems)
      .innerJoin(schema.schedules, eq(schema.scheduleItems.schedule_id, schema.schedules.id))
      .where(and(
        gt(schema.schedules.end_at, now),
        gt(schema.scheduleItems.end_at, now),
        sql`(${screenMatch} OR ${groupMatch})`
      ));
  const publishes = await db.select({ id: schema.publishTargets.id, payload: schema.scheduleSnapshots.payload }).from(schema.publishTargets)
      .innerJoin(schema.publishes, eq(schema.publishTargets.publish_id, schema.publishes.id))
      .innerJoin(schema.schedules, eq(schema.publishes.schedule_id, schema.schedules.id))
      .innerJoin(schema.scheduleSnapshots, eq(schema.publishes.snapshot_id, schema.scheduleSnapshots.id))
      .where(and(eq(schema.publishes.status, 'ACTIVE'), gt(schema.schedules.end_at, now),
        sql`(${screenIds.length ? inArray(schema.publishTargets.screen_id, screenIds) : sql`false`}
          OR ${groupIds.length ? inArray(schema.publishTargets.screen_group_id, groupIds) : sql`false`})`));
  const reservations = reservedScreenIds.length ? await db.select({ id: schema.scheduleReservations.id }).from(schema.scheduleReservations)
      .where(and(inArray(schema.scheduleReservations.screen_id, reservedScreenIds), gt(schema.scheduleReservations.end_at, now),
        inArray(schema.scheduleReservations.state, ['HELD', 'RESERVED', 'PUBLISHED']),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.liveScheduleOccurrences} live_owner
          WHERE live_owner.schedule_id=${schema.scheduleReservations.schedule_id}
            AND live_owner.schedule_item_id=${schema.scheduleReservations.schedule_item_id}
            AND live_owner.reservation_token=${schema.scheduleReservations.reservation_token})`,
        sql`(${schema.scheduleReservations.state} <> 'HELD' OR ${schema.scheduleReservations.hold_expires_at} > ${nowUtc})`)) : [];
  const liveOccurrences = await db.select({ id: schema.liveScheduleOccurrences.id }).from(schema.liveScheduleOccurrences)
      .where(and(activeLiveOccurrenceReference(now),
        target.kind === 'SCREEN' ? sql`${target.id}::uuid = ANY(${schema.liveScheduleOccurrences.screen_ids})`
          : sql`${schema.liveScheduleOccurrences.frozen_policy}->'screen_group_ids' ? ${target.id}`));
  const emergencies = await db.select({ id: schema.emergencies.id }).from(schema.emergencies)
      .where(and(eq(schema.emergencies.is_active, true),
        sql`(${schema.emergencies.expires_at} IS NULL OR ${schema.emergencies.expires_at} > ${nowUtc})`,
        sql`(${target.kind === 'SCREEN' ? eq(schema.emergencies.target_all, true) : sql`false`}
          OR ${screenIds.length ? containsAny(schema.emergencies.screen_ids, screenIds) : sql`false`}
          OR ${groupIds.length ? containsAny(schema.emergencies.screen_group_ids, groupIds) : sql`false`})`));
  const setting = await db.select({ value: schema.settings.value }).from(schema.settings)
      .where(eq(schema.settings.key, DEFAULT_MEDIA_TARGETS_SETTING_KEY));
  const assignments = extractDefaultMediaTargets(setting[0]?.value);
  const blockers: Blockers = {
    schedule_items: scheduleItems.length,
    active_publishes: publishes.filter(publish => {
      const payload = publish.payload as { schedule?: { items?: unknown[] } };
      const items = Array.isArray(payload?.schedule?.items) ? payload.schedule.items : [];
      // Ordinary legacy publications retain their existing guard. LIVE rows
      // use concrete, window-scoped occurrence authority so an ended item in
      // a longer mixed schedule cannot keep its former target blocked forever.
      if (!items.some(isLiveSnapshotCandidate)) return true;
      const ordinary = items.filter(item => !isLiveSnapshotCandidate(item));
      const relevant = target.kind === 'SCREEN'
        ? filterFrozenAudienceItemsForScreen(ordinary, target.id, groupIds)
        : filterFrozenAudienceItemsForGroup(ordinary, target.id, target.memberScreenIds ?? []);
      return relevant.some(item => {
        const end = Date.parse(String((item as { end_at?: unknown })?.end_at));
        return !Number.isFinite(end) || end > now.getTime();
      });
    }).length,
    reservations: reservations.length,
    live_occurrences: liveOccurrences.length,
    active_emergencies: emergencies.length,
    defaults: assignments.filter((assignment) =>
      (target.kind === 'GROUP' && assignment.target_type === 'GROUP' && assignment.target_id === target.id)
      || (target.kind === 'SCREEN' && (
        (assignment.target_type === 'SCREEN' && assignment.target_id === target.id)
        || (assignment.target_type === 'GROUP' && groupIds.includes(assignment.target_id))
      ))).length,
  };
  if (Object.values(blockers).some((count) => count > 0)) {
    throw new AppError({
      statusCode: 409,
      code: target.kind === 'SCREEN' ? 'SCREEN_IN_USE' : 'SCREEN_GROUP_IN_USE',
      message: 'Remove current and future content references before deleting this target.',
      details: { blockers },
    });
  }
}

/** Must precede target row locks and reference reads within the delete transaction. */
export async function lockScreenTargetReferences(db: DbExecutor): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'))`);
}
