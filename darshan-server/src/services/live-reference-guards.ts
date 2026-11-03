import { and, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';

/** Current normalized authority, independent of mutable authoring/group rows.
 * Stale rows left by an interrupted older writer are not live references after
 * their request/publication has ended. Historical rows remain retained. */
export function activeLiveOccurrenceReference(now: Date | SQL = sql`(clock_timestamp() AT TIME ZONE 'UTC')`): SQL {
  const occurrence = schema.liveScheduleOccurrences;
  // Raw SQL Date parameters bypass Drizzle's timestamp encoder. pg formats
  // them in the host TZ and a timestamp-without-zone comparison then ignores
  // the offset. Bind an explicit UTC instant instead.
  const at = now instanceof Date ? sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')` : now;
  const matchingRequest = sql`EXISTS (SELECT 1 FROM ${schema.scheduleRequests} request
    WHERE request.id=${occurrence.schedule_request_id} AND request.reservation_token=${occurrence.reservation_token}
      AND request.reservation_version=${occurrence.schedule_revision}
      AND ((request.status='PENDING' AND ${occurrence.state}='HELD') OR (request.status='APPROVED' AND ${occurrence.state}='RESERVED')))`;
  const activePublish = sql`EXISTS (SELECT 1 FROM ${schema.publishes} publication
    WHERE publication.id=${occurrence.publish_id} AND publication.status='ACTIVE' AND publication.taken_down_at IS NULL)`;
  return and(gt(occurrence.end_at, at), inArray(occurrence.state, ['HELD', 'RESERVED', 'PUBLISHED']),
    sql`((${occurrence.state}='HELD' AND ${occurrence.hold_expires_at}>${at} AND ${matchingRequest})
      OR (${occurrence.state}='RESERVED' AND ${matchingRequest}) OR (${occurrence.state}='PUBLISHED' AND ${activePublish}))`)!;
}
