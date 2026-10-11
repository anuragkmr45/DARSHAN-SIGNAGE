import { desc, eq } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index.js';
export async function createMediaCacheReport(input) {
    const db = getDatabase();
    const now = new Date();
    const [report] = await db
        .insert(schema.mediaCacheReports)
        .values({
        screen_id: input.screenId,
        media_id: input.mediaId ?? null,
        event_type: input.eventType,
        severity: input.severity ?? 'ERROR',
        source: input.source ?? null,
        status: input.status ?? 'OPEN',
        error_code: input.errorCode ?? null,
        http_status: input.httpStatus ?? null,
        message: input.message ?? null,
        cache_key: input.cacheKey ?? null,
        url_host: input.urlHost ?? null,
        url_path_hash: input.urlPathHash ?? null,
        snapshot_id: input.snapshotId ?? null,
        schedule_id: input.scheduleId ?? null,
        default_media_version: input.defaultMediaVersion ?? null,
        playback_mode: input.playbackMode ?? null,
        attempt_count: input.attemptCount ?? 1,
        metadata: input.metadata ?? null,
        reported_at: input.reportedAt ?? now,
        received_at: now,
        created_at: now,
        updated_at: now,
    })
        .returning();
    return report;
}
export async function listRecentMediaCacheReports(screenId, limit = 25) {
    const db = getDatabase();
    return await db
        .select()
        .from(schema.mediaCacheReports)
        .where(eq(schema.mediaCacheReports.screen_id, screenId))
        .orderBy(desc(schema.mediaCacheReports.reported_at), desc(schema.mediaCacheReports.received_at))
        .limit(Math.max(1, Math.min(100, limit)));
}
