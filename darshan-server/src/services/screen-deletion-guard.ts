import { and, eq, gt, inArray, sql, type AnyColumn } from 'drizzle-orm';
import { type DbExecutor, schema } from '@/db';
import { AppError } from '@/utils/app-error';
import { DEFAULT_MEDIA_TARGETS_SETTING_KEY, extractDefaultMediaTargets } from '@/utils/default-media';

type Target = { kind: 'SCREEN' | 'GROUP'; id: string; groupIds?: string[]; memberScreenIds?: string[] };
type Blockers = Record<'schedule_items' | 'active_publishes' | 'reservations' | 'active_emergencies' | 'defaults', number>;

function containsAny(column: AnyColumn, ids: string[]) {
  return sql`${column} ?| array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`;
}

/** Read under the same transaction and target lock as the eventual delete. */
export async function assertTargetCanBeDeleted(db: DbExecutor, target: Target): Promise<void> {
  const now = new Date();
  const screenIds = target.kind === 'SCREEN' ? [target.id] : [];
  const reservedScreenIds = target.kind === 'SCREEN' ? screenIds : target.memberScreenIds ?? [];
  const groupIds = target.kind === 'GROUP' ? [target.id] : target.groupIds ?? [];
  const screenMatch = screenIds.length ? containsAny(schema.scheduleItems.screen_ids, screenIds) : sql`false`;
  const groupMatch = groupIds.length ? containsAny(schema.scheduleItems.screen_group_ids, groupIds) : sql`false`;
  // A transaction uses one PostgreSQL client. Run these reads in order so a
  // driver never receives concurrent queries on that same client.
  const scheduleItems = await db.select({ id: schema.scheduleItems.id }).from(schema.scheduleItems)
      .innerJoin(schema.schedules, eq(schema.scheduleItems.schedule_id, schema.schedules.id))
      .where(and(gt(schema.scheduleItems.end_at, now), sql`(${screenMatch} OR ${groupMatch})`));
  const publishes = await db.select({ id: schema.publishTargets.id }).from(schema.publishTargets)
      .innerJoin(schema.publishes, eq(schema.publishTargets.publish_id, schema.publishes.id))
      .innerJoin(schema.schedules, eq(schema.publishes.schedule_id, schema.schedules.id))
      .where(and(eq(schema.publishes.status, 'ACTIVE'), gt(schema.schedules.end_at, now),
        sql`(${screenIds.length ? inArray(schema.publishTargets.screen_id, screenIds) : sql`false`}
          OR ${groupIds.length ? inArray(schema.publishTargets.screen_group_id, groupIds) : sql`false`})`));
  const reservations = reservedScreenIds.length ? await db.select({ id: schema.scheduleReservations.id }).from(schema.scheduleReservations)
      .where(and(inArray(schema.scheduleReservations.screen_id, reservedScreenIds), gt(schema.scheduleReservations.end_at, now),
        inArray(schema.scheduleReservations.state, ['HELD', 'RESERVED', 'PUBLISHED']))) : [];
  const emergencies = await db.select({ id: schema.emergencies.id }).from(schema.emergencies)
      .where(and(eq(schema.emergencies.is_active, true),
        sql`(${schema.emergencies.expires_at} IS NULL OR ${schema.emergencies.expires_at} > ${now})`,
        sql`(${target.kind === 'SCREEN' ? eq(schema.emergencies.target_all, true) : sql`false`}
          OR ${screenIds.length ? containsAny(schema.emergencies.screen_ids, screenIds) : sql`false`}
          OR ${groupIds.length ? containsAny(schema.emergencies.screen_group_ids, groupIds) : sql`false`})`));
  const setting = await db.select({ value: schema.settings.value }).from(schema.settings)
      .where(eq(schema.settings.key, DEFAULT_MEDIA_TARGETS_SETTING_KEY));
  const assignments = extractDefaultMediaTargets(setting[0]?.value);
  const blockers: Blockers = {
    schedule_items: scheduleItems.length,
    active_publishes: publishes.length,
    reservations: reservations.length,
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
