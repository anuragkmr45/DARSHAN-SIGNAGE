import { z } from 'zod';

export const playerRealtimeConnectionStateSchema = z.enum([
  'WSS_HEALTHY',
  'REST_FALLBACK',
  'OFFLINE',
  'VERSION_MISMATCH',
  'CONNECTED',
  'CONNECTING',
  'DISCONNECTED',
]);

export type PlayerRealtimeConnectionState = z.infer<typeof playerRealtimeConnectionStateSchema>;

export const playerRealtimeDiagnosticsSchema = z.object({
  release_id: z.string().trim().min(1).max(128).optional(),
  source_commit: z.string().regex(/^[0-9a-f]{7,64}$/i).optional(),
  server_release_id: z.string().trim().min(1).max(128).optional(),
  connection_state: playerRealtimeConnectionStateSchema,
  socket_generation: z.number().int().nonnegative().max(1_000_000).optional(),
  connect_count: z.number().int().nonnegative().max(1_000_000).optional(),
  disconnect_count: z.number().int().nonnegative().max(1_000_000).optional(),
  connect_error_count: z.number().int().nonnegative().max(1_000_000).optional(),
  accepted_wake_count: z.number().int().nonnegative().max(1_000_000).optional(),
  ignored_wake_count: z.number().int().nonnegative().max(1_000_000).optional(),
  flushed_wake_count: z.number().int().nonnegative().max(1_000_000).optional(),
  last_connected_at: z.string().datetime().optional(),
  last_disconnected_at: z.string().datetime().optional(),
  last_disconnect_reason: z.string().trim().max(240).optional(),
  last_connect_error: z.string().trim().max(240).optional(),
  last_wake_at: z.string().datetime().optional(),
  last_wake_type: z.enum(['COMMAND_AVAILABLE', 'RESYNC_REQUIRED']).optional(),
  last_hello_ack_at: z.string().datetime().optional(),
  last_event_at: z.string().datetime().optional(),
  last_reconciliation_at: z.string().datetime().optional(),
  last_fallback_fetch_at: z.string().datetime().optional(),
  observed_state_version: z.number().int().nonnegative().optional(),
  applied_state_version: z.number().int().nonnegative().optional(),
  reconnect_count: z.number().int().nonnegative().max(1_000_000).optional(),
  reconciliation_failure_count: z.number().int().nonnegative().max(1_000_000).optional(),
});

export type PlayerRealtimeDiagnostics = z.infer<typeof playerRealtimeDiagnosticsSchema>;
