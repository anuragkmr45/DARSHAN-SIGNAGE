import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  getObservabilityRegistry,
  appendLegacySignhexMetricAliases,
  categorizeRealtimeSocketDisconnectReason,
  observeJobProcessing,
  observeS3Operation,
  recordDeviceAuthAttempt,
  recordDeviceCommandAck,
  recordDeviceCommandClaim,
  recordDeviceNodeRegistryMiss,
  recordDeviceNodeRegistryWrite,
  recordDeviceRealtimeAuth,
  recordDeviceRealtimeNotification,
  recordDeviceSocketAuth,
  recordDeviceSocketAuthReplay,
  recordJobEnqueue,
  recordMediaCacheReport,
  recordOutboxDispatch,
  recordPairingCodeAllocation,
  recordPairingCsrValidation,
  recordRealtimeBusFallback,
  recordRealtimeBusNodeMessage,
  recordRealtimeBusPublish,
  recordRealtimeBusSubscribeFailure,
  recordRealtimeSocketAuth,
  recordRealtimeSocketClientEvent,
  recordRealtimeSocketConnect,
  recordRealtimeSocketDisconnect,
  recordRealtimeSocketReject,
  recordRealtimeSocketServerEvent,
  recordTelemetryIngest,
  recordWebsocketNotificationPayloadTooLarge,
  resetObservabilityMetricsForTests,
} from '@/observability/metrics';
import { closeTestServer, createTestServer } from '@/test/helpers';

describe('backend observability instrumentation', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  beforeEach(() => {
    resetObservabilityMetricsForTests();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('records custom telemetry, job, and S3 metrics in the shared registry', async () => {
    recordJobEnqueue('telemetry:heartbeat', 'success');
    recordTelemetryIngest({
      telemetryType: 'heartbeat',
      persistMode: 'queue',
      result: 'success',
      heartbeatStatus: 'ONLINE',
      durationSeconds: 0.01,
    });
    await observeJobProcessing('telemetry:heartbeat', async () => undefined);
    await observeS3Operation('put_object', async () => ({ ok: true }));

    const output = await getObservabilityRegistry().metrics();

    expect(output).toContain('darshan_server_job_enqueued_total{queue="telemetry:heartbeat",result="success"} 1');
    expect(output).toContain('darshan_server_device_telemetry_ingest_total{telemetry_type="heartbeat",result="success",persist_mode="queue"} 1');
    expect(output).toContain('darshan_server_device_heartbeats_received_total{status="ONLINE",result="success",persist_mode="queue"} 1');
    expect(output).toContain('darshan_server_job_processing_total{queue="telemetry:heartbeat",result="success"} 1');
    expect(output).toContain('darshan_server_s3_operations_total{operation="put_object",result="success"} 1');
  });

  it('records runtime hardening metrics for pairing, auth, and command claim paths', async () => {
    recordPairingCodeAllocation('device_request', 'collision_retry');
    recordPairingCodeAllocation('device_request', 'success');
    recordPairingCsrValidation('rejected', 'weak_rsa_key');
    recordPairingCsrValidation('accepted', 'valid');
    recordDeviceAuthAttempt({
      configuredMode: 'dual',
      authMethod: 'signature',
      result: 'success',
      reason: 'authorized',
    });
    recordDeviceAuthAttempt({
      configuredMode: 'signature',
      authMethod: 'signature',
      result: 'failure',
      reason: 'missing_device_signature',
    });
    recordDeviceCommandClaim('heartbeat', 3);
    recordDeviceCommandClaim('poll', 1);

    const output = await getObservabilityRegistry().metrics();

    expect(output).toContain(
      'darshan_server_device_pairing_code_allocations_total{mode="device_request",result="collision_retry"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_pairing_code_allocations_total{mode="device_request",result="success"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_pairing_csr_validation_total{result="rejected",reason="weak_rsa_key"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_pairing_csr_validation_total{result="accepted",reason="valid"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_auth_total{configured_mode="dual",auth_method="signature",result="success",reason="authorized"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_auth_total{configured_mode="signature",auth_method="signature",result="failure",reason="missing_device_signature"} 1'
    );
    expect(output).toContain('darshan_server_device_commands_claimed_total{source="heartbeat"} 3');
    expect(output).toContain('darshan_server_device_commands_claimed_total{source="poll"} 1');
  });

  it('records realtime sync readiness metrics for outbox, realtime, ACK, and media-cache paths', async () => {
    recordOutboxDispatch('dispatched', 'COMMAND_AVAILABLE');
    recordOutboxDispatch('deferred', 'COMMAND_AVAILABLE');
    recordOutboxDispatch('failed', 'RESYNC_REQUIRED');
    recordDeviceRealtimeAuth('success', 'authorized');
    recordDeviceRealtimeAuth('failure', 'Missing device identity');
    recordDeviceSocketAuth({
      namespace: '/device',
      mode: 'signed',
      result: 'success',
      reason: 'authorized',
    });
    recordDeviceSocketAuth({
      namespace: '/device',
      mode: 'signed',
      result: 'failure',
      reason: 'signature_invalid',
    });
    recordDeviceSocketAuth({
      namespace: '/device',
      mode: 'device-controlled-mode',
      result: 'failure',
      reason: 'serial-bearing raw reason',
    });
    recordDeviceSocketAuthReplay({
      namespace: '/device',
      result: 'accepted',
      reason: 'stored',
    });
    recordDeviceSocketAuthReplay({
      namespace: '/device',
      result: 'rejected',
      reason: 'replay_detected',
    });
    recordDeviceSocketAuthReplay({
      namespace: '/tenant-controlled-namespace',
      result: 'client-controlled-result',
      reason: 'raw nonce-bearing replay reason',
    });
    recordDeviceRealtimeNotification('COMMAND_AVAILABLE', 'delivered');
    recordDeviceRealtimeNotification('COMMAND_AVAILABLE', 'deferred');
    recordWebsocketNotificationPayloadTooLarge('COMMAND_AVAILABLE');
    recordRealtimeBusPublish('valkey', 'published', 'COMMAND_AVAILABLE');
    recordRealtimeBusPublish('valkey', 'failed', 'COMMAND_AVAILABLE');
    recordRealtimeBusSubscribeFailure('valkey', 'subscriber_error');
    recordRealtimeBusNodeMessage('received', 'COMMAND_AVAILABLE');
    recordRealtimeBusNodeMessage('socket_missing', 'COMMAND_AVAILABLE');
    recordDeviceNodeRegistryWrite('valkey', 'register', 'success');
    recordDeviceNodeRegistryWrite('valkey', 'refresh', 'error');
    recordDeviceNodeRegistryMiss('valkey');
    recordRealtimeBusFallback('valkey_unavailable');
    recordDeviceCommandAck('success', 0.025);
    recordDeviceCommandAck('failure', 0.05);
    recordMediaCacheReport({ eventType: 'DOWNLOAD_FAILED', severity: 'ERROR', result: 'accepted' });
    recordMediaCacheReport({ eventType: 'DISK_FULL', severity: 'CRITICAL', result: 'error' });

    const output = await getObservabilityRegistry().metrics();

    expect(output).toContain(
      'darshan_server_command_outbox_dispatch_total{result="dispatched",event_type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_command_outbox_dispatch_total{result="deferred",event_type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_command_outbox_dispatch_total{result="failed",event_type="RESYNC_REQUIRED"} 1'
    );
    expect(output).toContain('darshan_server_device_realtime_auth_total{result="success",reason="authorized"} 1');
    expect(output).toContain(
      'darshan_server_device_realtime_auth_total{result="failure",reason="Missing device identity"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_total{namespace="/device",mode="signed",result="success",reason="authorized"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_total{namespace="/device",mode="signed",result="failure",reason="signature_invalid"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_total{namespace="/device",mode="unknown",result="failure",reason="unknown"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_replay_total{namespace="/device",result="accepted",reason="stored"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_replay_total{namespace="/device",result="rejected",reason="replay_detected"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_socket_auth_replay_total{namespace="unknown",result="error",reason="unknown"} 1'
    );
    expect(output).not.toContain('device-controlled-mode');
    expect(output).not.toContain('serial-bearing raw reason');
    expect(output).not.toContain('/tenant-controlled-namespace');
    expect(output).not.toContain('client-controlled-result');
    expect(output).not.toContain('raw nonce-bearing replay reason');
    expect(output).toContain(
      'darshan_server_device_realtime_notifications_total{type="COMMAND_AVAILABLE",result="delivered"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_realtime_notifications_total{type="COMMAND_AVAILABLE",result="deferred"} 1'
    );
    expect(output).toContain(
      'darshan_server_websocket_notification_payload_too_large_total{type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_bus_publish_total{provider="valkey",result="published",type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_bus_publish_total{provider="valkey",result="failed",type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_bus_subscribe_failures_total{provider="valkey",reason="subscriber_error"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_bus_node_messages_total{result="received",type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_bus_node_messages_total{result="socket_missing",type="COMMAND_AVAILABLE"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_node_registry_writes_total{provider="valkey",operation="register",result="success"} 1'
    );
    expect(output).toContain(
      'darshan_server_device_node_registry_writes_total{provider="valkey",operation="refresh",result="error"} 1'
    );
    expect(output).toContain('darshan_server_device_node_registry_misses_total{provider="valkey"} 1');
    expect(output).toContain('darshan_server_realtime_bus_fallback_total{reason="valkey_unavailable"} 1');
    expect(output).toContain('darshan_server_device_command_acks_total{result="success"} 1');
    expect(output).toContain('darshan_server_device_command_acks_total{result="failure"} 1');
    expect(output).toContain(
      'darshan_server_media_cache_reports_total{event_type="DOWNLOAD_FAILED",severity="ERROR",result="accepted"} 1'
    );
    expect(output).toContain(
      'darshan_server_media_cache_reports_total{event_type="DISK_FULL",severity="CRITICAL",result="error"} 1'
    );
  });

  it('records low-cardinality realtime socket namespace metrics', async () => {
    recordRealtimeSocketConnect('/chat');
    recordRealtimeSocketClientEvent('/chat', 'chat:typing');
    recordRealtimeSocketServerEvent('/chat', 'chat:typing');
    recordRealtimeSocketReject('/chat', 'chat:typing', 'invalid_payload');
    recordRealtimeSocketReject('/chat', 'chat:typing', 'rate_limited');
    recordRealtimeSocketAuth('/chat', 'failure', 'invalid_token');
    recordRealtimeSocketDisconnect('/chat', 'transport close');
    recordRealtimeSocketConnect('/tenant-controlled-namespace');
    recordRealtimeSocketDisconnect('/tenant-controlled-namespace', 'raw disconnect reason with token');
    recordRealtimeSocketClientEvent('/chat', 'client-controlled:event');
    recordRealtimeSocketServerEvent('/device', 'device-123-controlled-event');
    recordRealtimeSocketAuth('/screens', 'failure', 'raw token-bearing auth failure');

    const output = await getObservabilityRegistry().metrics();

    expect(categorizeRealtimeSocketDisconnectReason('transport close')).toBe('transport_close');
    expect(categorizeRealtimeSocketDisconnectReason('unexpected user supplied reason')).toBe('unknown');
    expect(output).toContain('darshan_server_realtime_socket_connect_total{namespace="/chat"} 1');
    expect(output).toContain('darshan_server_realtime_socket_disconnect_total{namespace="/chat",reason="transport_close"} 1');
    expect(output).toContain('darshan_server_realtime_socket_client_events_total{namespace="/chat",event="chat:typing"} 1');
    expect(output).toContain('darshan_server_realtime_socket_server_events_total{namespace="/chat",event="chat:typing"} 1');
    expect(output).toContain(
      'darshan_server_realtime_socket_rejects_total{namespace="/chat",event="chat:typing",reason="invalid_payload"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_socket_rejects_total{namespace="/chat",event="chat:typing",reason="rate_limited"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_socket_auth_total{namespace="/chat",result="failure",reason="invalid_token"} 1'
    );
    expect(output).toContain('darshan_server_realtime_socket_connect_total{namespace="unknown"} 1');
    expect(output).toContain('darshan_server_realtime_socket_disconnect_total{namespace="unknown",reason="unknown"} 1');
    expect(output).toContain(
      'darshan_server_realtime_socket_client_events_total{namespace="/chat",event="unknown"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_socket_server_events_total{namespace="/device",event="unknown"} 1'
    );
    expect(output).toContain(
      'darshan_server_realtime_socket_auth_total{namespace="/screens",result="failure",reason="unknown"} 1'
    );
    expect(output).not.toContain('socket_id=');
    expect(output).not.toContain('user_id=');
    expect(output).not.toContain('device_id=');
    expect(output).not.toContain('/tenant-controlled-namespace');
    expect(output).not.toContain('raw disconnect reason with token');
    expect(output).not.toContain('client-controlled:event');
    expect(output).not.toContain('device-123-controlled-event');
    expect(output).not.toContain('raw token-bearing auth failure');
  });

  it('exposes a Prometheus scrape endpoint and preserves route templates', async () => {
    await server.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    const response = await server.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('darshan_server_http_requests_total');
    expect(response.body).toContain('signhex_server_http_requests_total');
    expect(response.body).toContain('route="/api/v1/health"');
    expect(response.body).toContain('darshan_server_db_pool_connections');
    expect(response.body).toContain('darshan_fleet_players_total');
    expect(response.body).toContain('signhex_fleet_players_total');
  });

  it('can append one-release Signhex metric aliases for dashboard migration', () => {
    const output = appendLegacySignhexMetricAliases(
      [
        '# HELP darshan_server_example_total Example.',
        '# TYPE darshan_server_example_total counter',
        'darshan_server_example_total{result="ok"} 1',
      ].join('\n')
    );

    expect(output).toContain('darshan_server_example_total{result="ok"} 1');
    expect(output).toContain('signhex_server_example_total{result="ok"} 1');
  });

  it('keeps the CMS metrics overview route JSON-shaped and blocks non-loopback scrape traffic by default', async () => {
    const overviewResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/metrics/overview',
    });

    expect(overviewResponse.statusCode).toBe(401);
    expect(overviewResponse.headers['content-type']).toContain('application/json');
    expect(overviewResponse.json()).toHaveProperty('success', false);
    expect(overviewResponse.json()).toHaveProperty('error.code', 'UNAUTHORIZED');

    const scrapeResponse = await server.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '192.168.50.10',
    });

    expect(scrapeResponse.statusCode).toBe(403);
  });
});
