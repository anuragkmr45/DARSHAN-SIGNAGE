import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../index.js';
const ACTIVE_STATES = ['HELD', 'RESERVED', 'PUBLISHED'];
export class ScheduleReservationRepository {
    async expireStaleHolds(now = new Date(), db = getDatabase()) {
        const expiredRows = await db
            .update(schema.scheduleReservations)
            .set({
            state: 'EXPIRED',
            released_at: now,
            release_reason: 'hold-expired',
            updated_at: now,
        })
            .where(and(eq(schema.scheduleReservations.state, 'HELD'), isNotNull(schema.scheduleReservations.hold_expires_at), lt(schema.scheduleReservations.hold_expires_at, now)))
            .returning({
            id: schema.scheduleReservations.id,
            schedule_request_id: schema.scheduleReservations.schedule_request_id,
        });
        const expiredReservedRows = await db
            .update(schema.scheduleReservations)
            .set({
            state: 'EXPIRED',
            released_at: now,
            release_reason: 'reservation-window-expired',
            updated_at: now,
        })
            .where(and(eq(schema.scheduleReservations.state, 'RESERVED'), lt(schema.scheduleReservations.end_at, now)))
            .returning({
            id: schema.scheduleReservations.id,
            schedule_request_id: schema.scheduleReservations.schedule_request_id,
        });
        await db
            .update(schema.scheduleReservations)
            .set({
            state: 'RELEASED',
            released_at: now,
            release_reason: 'publish-window-completed',
            updated_at: now,
        })
            .where(and(eq(schema.scheduleReservations.state, 'PUBLISHED'), lt(schema.scheduleReservations.end_at, now)));
        const expiredRequestIds = Array.from(new Set([...expiredRows, ...expiredReservedRows]
            .map((row) => row.schedule_request_id)
            .filter(Boolean)));
        if (expiredRequestIds.length > 0) {
            await db
                .update(schema.scheduleRequests)
                .set({
                status: 'EXPIRED',
                reservation_state: 'EXPIRED',
                updated_at: now,
            })
                .where(and(inArray(schema.scheduleRequests.id, expiredRequestIds), inArray(schema.scheduleRequests.status, ['PENDING', 'APPROVED'])));
        }
        return expiredRows;
    }
    async listActiveByRequest(scheduleRequestId, db = getDatabase()) {
        return db
            .select()
            .from(schema.scheduleReservations)
            .where(and(eq(schema.scheduleReservations.schedule_request_id, scheduleRequestId), inArray(schema.scheduleReservations.state, ACTIVE_STATES)))
            .orderBy(asc(schema.scheduleReservations.start_at), asc(schema.scheduleReservations.screen_id));
    }
    async listActiveConflicts(params, db = getDatabase()) {
        if (params.screenIds.length === 0)
            return [];
        const conditions = [
            inArray(schema.scheduleReservations.screen_id, params.screenIds),
            inArray(schema.scheduleReservations.state, ACTIVE_STATES),
            lt(schema.scheduleReservations.start_at, params.endAt),
            gt(schema.scheduleReservations.end_at, params.startAt),
        ];
        if (params.excludeRequestId) {
            conditions.push(or(ne(schema.scheduleReservations.schedule_request_id, params.excludeRequestId), sql `${schema.scheduleReservations.schedule_request_id} IS NULL`));
        }
        return db
            .select()
            .from(schema.scheduleReservations)
            .where(and(...conditions))
            .orderBy(asc(schema.scheduleReservations.start_at), asc(schema.scheduleReservations.screen_id));
    }
    async insertMany(rows, db = getDatabase()) {
        if (rows.length === 0)
            return [];
        return db.insert(schema.scheduleReservations).values(rows).returning();
    }
    async promoteHeldToReserved(scheduleRequestId, approvedAt = new Date(), db = getDatabase()) {
        return db
            .update(schema.scheduleReservations)
            .set({
            state: 'RESERVED',
            hold_expires_at: null,
            approved_at: approvedAt,
            updated_at: approvedAt,
        })
            .where(and(eq(schema.scheduleReservations.schedule_request_id, scheduleRequestId), eq(schema.scheduleReservations.state, 'HELD')))
            .returning();
    }
    async markRequestReservationsReleased(scheduleRequestId, nextState, releaseReason, db = getDatabase()) {
        const releasedAt = new Date();
        return db
            .update(schema.scheduleReservations)
            .set({
            state: nextState,
            released_at: releasedAt,
            release_reason: releaseReason,
            hold_expires_at: null,
            updated_at: releasedAt,
        })
            .where(and(eq(schema.scheduleReservations.schedule_request_id, scheduleRequestId), inArray(schema.scheduleReservations.state, ['HELD', 'RESERVED'])))
            .returning();
    }
    async markPublishedRequestReservationsReleased(scheduleRequestId, releaseReason, db = getDatabase()) {
        const releasedAt = new Date();
        return db
            .update(schema.scheduleReservations)
            .set({
            state: 'RELEASED',
            released_at: releasedAt,
            release_reason: releaseReason,
            hold_expires_at: null,
            updated_at: releasedAt,
        })
            .where(and(eq(schema.scheduleReservations.schedule_request_id, scheduleRequestId), eq(schema.scheduleReservations.state, 'PUBLISHED')))
            .returning({
            id: schema.scheduleReservations.id,
            screen_id: schema.scheduleReservations.screen_id,
            publish_id: schema.scheduleReservations.publish_id,
        });
    }
    async markPublishedReservationsReleasedByPublishId(publishId, releaseReason, db = getDatabase()) {
        const releasedAt = new Date();
        return db
            .update(schema.scheduleReservations)
            .set({
            state: 'RELEASED',
            released_at: releasedAt,
            release_reason: releaseReason,
            hold_expires_at: null,
            updated_at: releasedAt,
        })
            .where(and(eq(schema.scheduleReservations.publish_id, publishId), eq(schema.scheduleReservations.state, 'PUBLISHED')))
            .returning({
            id: schema.scheduleReservations.id,
            screen_id: schema.scheduleReservations.screen_id,
            schedule_request_id: schema.scheduleReservations.schedule_request_id,
        });
    }
    async finalizeRequestPublish(scheduleRequestId, publishId, db = getDatabase()) {
        const now = new Date();
        return db
            .update(schema.scheduleReservations)
            .set({
            state: 'PUBLISHED',
            publish_id: publishId,
            published_at: now,
            updated_at: now,
        })
            .where(and(eq(schema.scheduleReservations.schedule_request_id, scheduleRequestId), eq(schema.scheduleReservations.state, 'RESERVED')))
            .returning();
    }
    async createPublishedRows(rows, db = getDatabase()) {
        return this.insertMany(rows, db);
    }
    async findCurrentPublishedForScreen(screenId, now = new Date(), db = getDatabase()) {
        const [row] = await db
            .select({
            reservation_id: schema.scheduleReservations.id,
            reservation_version: schema.scheduleReservations.reservation_version,
            publish_id: schema.scheduleReservations.publish_id,
            published_at: schema.scheduleReservations.published_at,
            start_at: schema.scheduleReservations.start_at,
            end_at: schema.scheduleReservations.end_at,
            schedule_id: schema.publishes.schedule_id,
            snapshot_id: schema.publishes.snapshot_id,
            payload: schema.scheduleSnapshots.payload,
        })
            .from(schema.scheduleReservations)
            .innerJoin(schema.publishes, eq(schema.scheduleReservations.publish_id, schema.publishes.id))
            .innerJoin(schema.scheduleSnapshots, eq(schema.publishes.snapshot_id, schema.scheduleSnapshots.id))
            .where(and(eq(schema.scheduleReservations.screen_id, screenId), eq(schema.scheduleReservations.state, 'PUBLISHED'), eq(schema.publishes.status, 'ACTIVE'), lte(schema.scheduleReservations.start_at, now), gt(schema.scheduleReservations.end_at, now)))
            .orderBy(desc(schema.scheduleReservations.start_at), desc(schema.scheduleReservations.published_at), desc(schema.scheduleReservations.publish_id))
            .limit(1);
        return row ?? null;
    }
    async findUpcomingPublishedForScreen(screenId, now = new Date(), db = getDatabase()) {
        const [row] = await db
            .select({
            reservation_id: schema.scheduleReservations.id,
            reservation_version: schema.scheduleReservations.reservation_version,
            publish_id: schema.scheduleReservations.publish_id,
            published_at: schema.scheduleReservations.published_at,
            start_at: schema.scheduleReservations.start_at,
            end_at: schema.scheduleReservations.end_at,
            schedule_id: schema.publishes.schedule_id,
            snapshot_id: schema.publishes.snapshot_id,
            payload: schema.scheduleSnapshots.payload,
        })
            .from(schema.scheduleReservations)
            .innerJoin(schema.publishes, eq(schema.scheduleReservations.publish_id, schema.publishes.id))
            .innerJoin(schema.scheduleSnapshots, eq(schema.publishes.snapshot_id, schema.scheduleSnapshots.id))
            .where(and(eq(schema.scheduleReservations.screen_id, screenId), eq(schema.scheduleReservations.state, 'PUBLISHED'), eq(schema.publishes.status, 'ACTIVE'), gt(schema.scheduleReservations.start_at, now)))
            .orderBy(asc(schema.scheduleReservations.start_at), desc(schema.scheduleReservations.published_at), desc(schema.scheduleReservations.publish_id))
            .limit(1);
        return row ?? null;
    }
}
export function createScheduleReservationRepository() {
    return new ScheduleReservationRepository();
}
