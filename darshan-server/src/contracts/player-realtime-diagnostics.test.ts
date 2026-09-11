import { describe, expect, it } from 'vitest';
import { playerRealtimeDiagnosticsSchema } from './player-realtime-diagnostics';

describe('playerRealtimeDiagnosticsSchema', () => {
  it('accepts legacy Electron realtime delivery states', () => {
    expect(playerRealtimeDiagnosticsSchema.parse({
      release_id: 'site-a-2026-09-08-r1',
      source_commit: '0123456789abcdef0123456789abcdef01234567',
      server_release_id: 'site-a-2026-09-08-r1',
      connection_state: 'WSS_HEALTHY',
      last_hello_ack_at: '2026-09-08T00:00:00.000Z',
      observed_state_version: 7,
      applied_state_version: 7,
      reconnect_count: 2,
      reconciliation_failure_count: 0,
    })).toMatchObject({
      connection_state: 'WSS_HEALTHY',
      reconnect_count: 2,
    });
  });

  it('accepts native wake diagnostics as first-class operator telemetry', () => {
    expect(playerRealtimeDiagnosticsSchema.parse({
      release_id: 'native-player-0.1.0',
      connection_state: 'CONNECTED',
      socket_generation: 4,
      connect_count: 3,
      disconnect_count: 1,
      connect_error_count: 1,
      accepted_wake_count: 8,
      ignored_wake_count: 2,
      flushed_wake_count: 5,
      last_connected_at: '2026-09-08T00:00:01.000Z',
      last_disconnected_at: '2026-09-08T00:00:02.000Z',
      last_disconnect_reason: 'transport close',
      last_connect_error: 'previous TLS failure',
      last_wake_at: '2026-09-08T00:00:03.000Z',
      last_wake_type: 'RESYNC_REQUIRED',
    })).toMatchObject({
      connection_state: 'CONNECTED',
      accepted_wake_count: 8,
      last_wake_type: 'RESYNC_REQUIRED',
    });
  });

  it('bounds native diagnostics before accepting heartbeat payloads', () => {
    expect(() => playerRealtimeDiagnosticsSchema.parse({
      release_id: 'native-player-0.1.0',
      connection_state: 'CONNECTED',
      accepted_wake_count: 1_000_001,
    })).toThrow();
    expect(() => playerRealtimeDiagnosticsSchema.parse({
      release_id: 'native-player-0.1.0',
      connection_state: 'CONNECTED',
      last_connect_error: 'x'.repeat(241),
    })).toThrow();
  });
});
