import { desc, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';

export type MediaCacheReportSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type MediaCacheReportStatus = 'OPEN' | 'RESOLVED';

export interface CreateMediaCacheReportInput {
  id?: string;
  screenId: string;
  mediaId?: string | null;
  eventType: string;
  severity?: MediaCacheReportSeverity;
  source?: string | null;
  status?: MediaCacheReportStatus;
  errorCode?: string | null;
  httpStatus?: number | null;
  message?: string | null;
  cacheKey?: string | null;
  urlHost?: string | null;
  urlPathHash?: string | null;
  snapshotId?: string | null;
  scheduleId?: string | null;
  defaultMediaVersion?: string | null;
  playbackMode?: string | null;
  attemptCount?: number | null;
  metadata?: Record<string, unknown> | null;
  reportedAt?: Date | null;
  receivedAt?: Date;
}

export async function createMediaCacheReport(input: CreateMediaCacheReportInput) {
  const db = getDatabase();
  const receivedAt = input.receivedAt ?? new Date();
  const [inserted] = await db
    .insert(schema.mediaCacheReports)
    .values({
      id: input.id,
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
      reported_at: input.reportedAt ?? receivedAt,
      received_at: receivedAt,
      created_at: receivedAt,
      updated_at: receivedAt,
    })
    .onConflictDoNothing({ target: schema.mediaCacheReports.id })
    .returning();

  if (inserted) return inserted;
  if (!input.id) {
    throw new Error('Media cache report insert was not applied.');
  }
  const [existing] = await db
    .select()
    .from(schema.mediaCacheReports)
    .where(eq(schema.mediaCacheReports.id, input.id))
    .limit(1);
  if (!existing) {
    throw new Error(`Media cache report ${input.id} could not be loaded after idempotent replay.`);
  }
  return existing;
}

export async function listRecentMediaCacheReports(screenId: string, limit = 25) {
  const db = getDatabase();
  return await db
    .select()
    .from(schema.mediaCacheReports)
    .where(eq(schema.mediaCacheReports.screen_id, screenId))
    .orderBy(desc(schema.mediaCacheReports.reported_at), desc(schema.mediaCacheReports.received_at))
    .limit(Math.max(1, Math.min(100, limit)));
}
