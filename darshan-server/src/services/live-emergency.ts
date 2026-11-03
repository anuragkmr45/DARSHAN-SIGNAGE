import { and, eq, isNull, sql, type AnyColumn } from 'drizzle-orm';
import { schema, type DbExecutor } from '@/db';

/** Preserve screens/playback.ts legacy semantics: no selectors means GLOBAL,
 * including old records whose target_all column defaults to false. */
export async function hasLiveBlockingEmergency(tx: DbExecutor, screenId: string) {
  const now = sql`(${new Date(Date.now()).toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  const empty = (column: AnyColumn) => sql`jsonb_array_length(CASE WHEN jsonb_typeof(${column})='array' THEN ${column} ELSE '[]'::jsonb END)=0`;
  const rows = await tx.select({ id: schema.emergencies.id }).from(schema.emergencies).where(and(
    eq(schema.emergencies.is_active, true), isNull(schema.emergencies.cleared_at),
    sql`(${schema.emergencies.expires_at} IS NULL OR ${schema.emergencies.expires_at}>${now})`,
    sql`(${schema.emergencies.target_all}=true OR (${empty(schema.emergencies.screen_ids)} AND ${empty(schema.emergencies.screen_group_ids)})
      OR ${schema.emergencies.screen_ids} ? ${screenId} OR EXISTS(SELECT 1 FROM ${schema.screenGroupMembers} member
        WHERE member.screen_id=${screenId}::uuid AND ${schema.emergencies.screen_group_ids} ? member.group_id::text))`
  )).limit(1);
  return rows.length > 0;
}
