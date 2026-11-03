import { z } from 'zod';
import { liveUuid } from './live-runtime';

export const liveTargetUnknownReasons = ['NO_RUN', 'PUBLICATION_INACTIVE', 'WINDOW_NOT_ACTIVE', 'OCCURRENCE_DISABLED',
  'RUN_STOPPED', 'AUTHORITY_CHANGED', 'PRESENTER_UNAVAILABLE', 'NO_ADMISSION', 'ADMISSION_PENDING', 'ADMISSION_REVOKED',
  'RUNTIME_MISMATCH', 'NO_REPORT', 'STALE_REPORT', 'CLOCK_UNCERTAIN', 'INVALID_REPORT'] as const;
export const livePlayerReportSchema = z.object({ sequence: z.number().int().positive().safe(),
  connection: z.enum(['DISCONNECTED', 'CONNECTING', 'CONNECTED']), subscription: z.enum(['NONE', 'SUBSCRIBING', 'SUBSCRIBED']),
  frame: z.enum(['NONE', 'READY']), audio: z.enum(['NONE', 'READY', 'DEGRADED', 'MUTED']), fallback_ready: z.boolean(),
  fallback_reason: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable() }).strict();
export const liveTargetReportsSchema = z.object({ version: z.literal(1), occurrence_id: liveUuid, server_now: z.string().datetime({ offset: true }),
  fresh_for_ms: z.literal(10000), run: z.object({ id: liveUuid, generation: z.number().int().positive(),
    state: z.enum(['PREPARING', 'RUNNING', 'STOPPING', 'STOPPED']) }).strict().nullable(),
  targets: z.array(z.object({ screen_id: liveUuid, screen_name: z.string().nullable(),
    freshness: z.enum(['FRESH', 'UNKNOWN']), reason: z.enum(liveTargetUnknownReasons).nullable(),
    received_at: z.string().datetime({ offset: true }).nullable(), age_ms: z.number().int().nonnegative().safe().nullable(),
    report: livePlayerReportSchema.nullable() }).strict()).min(1).max(25),
}).strict();
export type LiveTargetReports = z.infer<typeof liveTargetReportsSchema>;
export type LiveTargetUnknownReason = typeof liveTargetUnknownReasons[number];
