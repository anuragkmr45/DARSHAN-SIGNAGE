import { z } from 'zod';
import { ApiError, apiClient } from '../apiClient';
import { endpoints } from '../endpoints';
import { liveUuidSchema } from '../liveRuntimeTypes';

export const liveTargetReasons = ['NO_RUN', 'PUBLICATION_INACTIVE', 'WINDOW_NOT_ACTIVE', 'OCCURRENCE_DISABLED', 'RUN_STOPPED',
  'AUTHORITY_CHANGED', 'PRESENTER_UNAVAILABLE', 'NO_ADMISSION', 'ADMISSION_PENDING', 'ADMISSION_REVOKED', 'RUNTIME_MISMATCH',
  'NO_REPORT', 'STALE_REPORT', 'CLOCK_UNCERTAIN', 'INVALID_REPORT'] as const;
export interface LivePlayerReport { sequence: number; connection: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'; subscription: 'NONE' | 'SUBSCRIBING' | 'SUBSCRIBED';
  frame: 'NONE' | 'READY'; audio: 'NONE' | 'READY' | 'DEGRADED' | 'MUTED'; fallback_ready: boolean; fallback_reason: string | null }
export interface LiveTargetReport { screen_id: string; screen_name: string | null; freshness: 'FRESH' | 'UNKNOWN'; reason: typeof liveTargetReasons[number] | null;
  received_at: string | null; age_ms: number | null; report: LivePlayerReport | null }
export interface LiveTargetReports { version: 1; occurrence_id: string; server_now: string; fresh_for_ms: 10000;
  run: { id: string; generation: number; state: 'PREPARING' | 'RUNNING' | 'STOPPING' | 'STOPPED' } | null; targets: LiveTargetReport[] }
const playerReport = z.object({ sequence: z.number().int().positive().safe(), connection: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED']),
  subscription: z.enum(['NONE', 'SUBSCRIBING', 'SUBSCRIBED']), frame: z.enum(['NONE', 'READY']), audio: z.enum(['NONE', 'READY', 'DEGRADED', 'MUTED']),
  fallback_ready: z.boolean(), fallback_reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable() }).strict();
const schema = z.object({ version: z.literal(1), occurrence_id: liveUuidSchema, server_now: z.string().datetime({ offset: true }), fresh_for_ms: z.literal(10000),
  run: z.object({ id: liveUuidSchema, generation: z.number().int().positive(), state: z.enum(['PREPARING', 'RUNNING', 'STOPPING', 'STOPPED']) }).strict().nullable(),
  targets: z.array(z.object({ screen_id: liveUuidSchema, screen_name: z.string().nullable(), freshness: z.enum(['FRESH', 'UNKNOWN']), reason: z.enum(liveTargetReasons).nullable(),
    received_at: z.string().datetime({ offset: true }).nullable(), age_ms: z.number().int().nonnegative().safe().nullable(), report: playerReport.nullable() }).strict()).min(1).max(25),
}).strict();
const invalid = () => new ApiError({ status: 502, code: 'LIVE_REPORT_INVALID', message: 'Player reports could not be verified. Refresh current occurrence state.' });
export async function getLiveTargetReports(occurrenceId: string, expected: { screenIds: string[]; run: { id: string; generation: number } | null }, signal?: AbortSignal): Promise<LiveTargetReports> {
  if (!liveUuidSchema.safeParse(occurrenceId).success) throw invalid();
  const parsed = schema.safeParse(await apiClient.request({ path: endpoints.liveRuntime.targets(occurrenceId), method: 'GET', signal }));
  if (!parsed.success) throw invalid(); const value = parsed.data as LiveTargetReports;
  const ids = value.targets.map(row => row.screen_id);
  if (value.occurrence_id !== occurrenceId || new Set(ids).size !== ids.length || ids.length !== expected.screenIds.length || !ids.every(id => expected.screenIds.includes(id)) ||
    Boolean(value.run) !== Boolean(expected.run) || value.run && (value.run.id !== expected.run.id || value.run.generation !== expected.run.generation) ||
    value.targets.some(row => row.freshness === 'FRESH' && (row.reason !== null || !row.report || !row.received_at || row.age_ms === null || row.age_ms > 10000) || row.freshness === 'UNKNOWN' && row.reason === null)) throw invalid();
  return value;
}
