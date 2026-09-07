import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config as appConfig } from '@/config';
import { getDatabasePool } from '@/db';

const registry = new Registry();

const OBSERVED_QUEUE_NAMES = [
  'playback:refresh-dispatch',
  'telemetry:heartbeat',
  'telemetry:proof-of-play',
  'telemetry:screenshot',
  'ffmpeg:transcode',
  'ffmpeg:thumbnail',
  'document:convert',
  'webpage:verify-capture',
  'archive',
  'cleanup',
  'chat:media-cleanup',
  'backup',
  'backup:check',
] as const;

const OBSERVED_QUEUE_STATES = ['created', 'retry', 'active'] as const;
const FLEET_STATES = ['ACTIVE', 'INACTIVE', 'OFFLINE'] as const;
const DEVICE_COMMAND_STATUSES = [
  'PENDING',
  'SENT',
  'ACKNOWLEDGED',
  'COMPLETED',
  'FAILED',
  'LEASED',
  'PROCESSING',
  'ACKED_SUCCESS',
  'ACKED_FAILURE',
  'EXPIRED',
  'DEAD_LETTER',
  'CANCELLED',
] as const;
const COMMAND_OUTBOX_STATUSES = ['PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED', 'CANCELLED'] as const;
const MEDIA_CACHE_EVENT_TYPES = [
  'URL_EXPIRED',
  'DOWNLOAD_FAILED',
  'CHECKSUM_MISMATCH',
  'DISK_FULL',
  'CACHE_EVICTION_FAILED',
  'CACHE_WRITE_FAILED',
  'CACHE_MISS',
  'PLAYBACK_ERROR',
  'UNKNOWN',
] as const;
const MEDIA_CACHE_SEVERITIES = ['INFO', 'WARN', 'ERROR', 'CRITICAL'] as const;

type TelemetryType = 'heartbeat' | 'proof_of_play' | 'screenshot';
type TelemetryPersistMode = 'queue' | 'inline' | 'fallback';
type PairingCodeMode = 'device_request' | 'recovery';
type PairingCodeAllocationResult = 'success' | 'collision_retry' | 'exhausted';
type PairingCsrValidationResult = 'accepted' | 'rejected';
type PairingCsrValidationReason =
  | 'valid'
  | 'invalid_format'
  | 'verification_failed'
  | 'missing_public_key'
  | 'missing_common_name'
  | 'weak_rsa_key'
  | 'device_mismatch'
  | 'unknown';
type DeviceAuthMode = 'legacy' | 'dual' | 'signature';
type DeviceAuthMethod = 'legacy_serial' | 'signature' | 'user_token' | 'missing_identity';
type DeviceAuthResult = 'success' | 'failure';
type DeviceCommandClaimSource = 'heartbeat' | 'poll';
type DeviceCommandAckResult = 'success' | 'failure' | 'error';
type OutboxDispatchResult = 'dispatched' | 'deferred' | 'failed' | 'skipped_disabled';
type RealtimeAuthResult = 'success' | 'failure';
type DeviceSocketAuthMode = 'legacy' | 'signed' | 'unknown';
type DeviceSocketAuthReason =
  | 'authorized'
  | 'missing_identity'
  | 'legacy_disabled'
  | 'signed_disabled'
  | 'missing_signature'
  | 'malformed_auth'
  | 'signature_invalid'
  | 'signature_expired'
  | 'signature_unavailable'
  | 'invalid_credentials'
  | 'device_not_registered'
  | 'replay_detected'
  | 'replay_store_unavailable'
  | 'replay_store_error'
  | 'unknown';
type DeviceSocketAuthReplayResult = 'accepted' | 'rejected' | 'bypassed' | 'error';
type DeviceSocketAuthReplayReason =
  | 'stored'
  | 'replay_detected'
  | 'disabled'
  | 'store_unavailable'
  | 'store_error'
  | 'unknown';
type RealtimeNotificationResult = 'delivered' | 'deferred' | 'payload_too_large' | 'error';
type RealtimeBusProvider = 'memory' | 'valkey';
type RealtimeBusPublishResult = 'published' | 'failed' | 'unavailable' | 'payload_too_large';
type RealtimeBusNodeMessageResult = 'received' | 'delivered' | 'socket_missing' | 'error';
type DeviceNodeRegistryOperation = 'register' | 'refresh' | 'unregister';
type DeviceNodeRegistryResult = 'success' | 'error' | 'unavailable';
type RealtimeBusFallbackReason = 'valkey_unavailable' | 'device_node_missing';
type PlayerRealtimeConnectionState = 'WSS_HEALTHY' | 'REST_FALLBACK' | 'OFFLINE' | 'VERSION_MISMATCH';
type PlayerReleaseAlignment = 'match' | 'mismatch' | 'missing';
type RealtimeSocketAuthResult = 'success' | 'failure';
type RealtimeSocketNamespace = '/device' | '/screens' | '/chat' | '/notifications' | 'unknown';
type RealtimeSocketDisconnectReason =
  | 'client_disconnect'
  | 'server_disconnect'
  | 'ping_timeout'
  | 'transport_close'
  | 'transport_error'
  | 'namespace_disconnect'
  | 'unknown';
type RealtimeSocketRejectReason =
  | 'invalid_payload'
  | 'payload_too_large'
  | 'rate_limited'
  | 'unauthorized'
  | 'auth_failed';
type RealtimeSocketAuthReason =
  | 'authorized'
  | 'missing_identity'
  | 'legacy_disabled'
  | 'signed_disabled'
  | 'missing_signature'
  | 'malformed_auth'
  | 'signature_invalid'
  | 'signature_expired'
  | 'signature_unavailable'
  | 'invalid_credentials'
  | 'device_not_registered'
  | 'replay_detected'
  | 'replay_store_unavailable'
  | 'replay_store_error'
  | 'origin_not_allowed'
  | 'origin_required'
  | 'missing_token'
  | 'token_revoked'
  | 'invalid_token'
  | 'unauthorized'
  | 'unknown';
type MediaCacheReportResult = 'accepted' | 'disabled' | 'error';

type JobResult = 'success' | 'error';

type S3Operation =
  | 'create_bucket'
  | 'delete_object'
  | 'get_object'
  | 'head_bucket'
  | 'head_object'
  | 'presign_get'
  | 'presign_put'
  | 'put_object';

type S3Result = 'success' | 'not_found' | 'conflict' | 'error';

const requestCounter = new Counter({
  name: 'darshan_server_http_requests_total',
  help: 'Total backend HTTP requests handled by darshan-server.',
  labelNames: ['method', 'route', 'status_class'],
  registers: [registry],
});

const requestDurationHistogram = new Histogram({
  name: 'darshan_server_http_request_duration_seconds',
  help: 'Backend HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_class'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const telemetryIngestCounter = new Counter({
  name: 'darshan_server_device_telemetry_ingest_total',
  help: 'Device telemetry ingestion attempts handled by the backend.',
  labelNames: ['telemetry_type', 'result', 'persist_mode'],
  registers: [registry],
});

const telemetryIngestDurationHistogram = new Histogram({
  name: 'darshan_server_device_telemetry_ingest_duration_seconds',
  help: 'Duration of backend device telemetry ingestion handling.',
  labelNames: ['telemetry_type', 'persist_mode', 'result'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

const heartbeatCounter = new Counter({
  name: 'darshan_server_device_heartbeats_received_total',
  help: 'Heartbeat payloads received by the backend.',
  labelNames: ['status', 'result', 'persist_mode'],
  registers: [registry],
});

const pairingCodeAllocationCounter = new Counter({
  name: 'darshan_server_device_pairing_code_allocations_total',
  help: 'Device pairing code allocation attempts and retries by flow.',
  labelNames: ['mode', 'result'],
  registers: [registry],
});

const pairingCsrValidationCounter = new Counter({
  name: 'darshan_server_device_pairing_csr_validation_total',
  help: 'CSR validation outcomes during device pairing completion.',
  labelNames: ['result', 'reason'],
  registers: [registry],
});

const deviceAuthCounter = new Counter({
  name: 'darshan_server_device_auth_total',
  help: 'Device authentication outcomes by configured auth mode and request auth method.',
  labelNames: ['configured_mode', 'auth_method', 'result', 'reason'],
  registers: [registry],
});

const deviceCommandClaimCounter = new Counter({
  name: 'darshan_server_device_commands_claimed_total',
  help: 'Device commands claimed for delivery by source.',
  labelNames: ['source'],
  registers: [registry],
});

const deviceCommandAckCounter = new Counter({
  name: 'darshan_server_device_command_acks_total',
  help: 'Device command acknowledgements handled by the backend.',
  labelNames: ['result'],
  registers: [registry],
});

const deviceCommandAckDurationHistogram = new Histogram({
  name: 'darshan_server_device_command_ack_duration_seconds',
  help: 'Duration of backend device command acknowledgement handling.',
  labelNames: ['result'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

const deviceCommandRowsGauge = new Gauge({
  name: 'darshan_server_device_commands_rows',
  help: 'Device command rows by lifecycle status.',
  labelNames: ['status'],
  registers: [registry],
  collect: async function collectDeviceCommandRows() {
    for (const status of DEVICE_COMMAND_STATUSES) {
      this.set({ status }, 0);
    }

    const pool = getDatabasePool();
    if (!pool) return;

    try {
      const result = await pool.query<{ status: string; count: string }>(
        `
          SELECT status::text AS status, COUNT(*)::bigint AS count
          FROM device_commands
          GROUP BY status
        `
      );

      for (const row of result.rows) {
        this.set({ status: row.status }, Number(row.count));
      }
    } catch (error) {
      recordCollectionError('device_commands');
      void error;
    }
  },
});

const commandOutboxRowsGauge = new Gauge({
  name: 'darshan_server_command_outbox_rows',
  help: 'Command outbox rows by dispatch status.',
  labelNames: ['status'],
  registers: [registry],
  collect: async function collectCommandOutboxRows() {
    for (const status of COMMAND_OUTBOX_STATUSES) {
      this.set({ status }, 0);
    }

    const pool = getDatabasePool();
    if (!pool) return;

    try {
      const result = await pool.query<{ status: string; count: string }>(
        `
          SELECT status, COUNT(*)::bigint AS count
          FROM command_outbox
          GROUP BY status
        `
      );

      for (const row of result.rows) {
        this.set({ status: row.status }, Number(row.count));
      }
    } catch (error) {
      recordCollectionError('command_outbox');
      void error;
    }
  },
});

const commandOutboxOldestPendingAgeGauge = new Gauge({
  name: 'darshan_server_command_outbox_oldest_pending_age_seconds',
  help: 'Age in seconds of the oldest pending command outbox row.',
  registers: [registry],
  collect: async function collectCommandOutboxOldestPendingAge() {
    const pool = getDatabasePool();
    if (!pool) {
      this.set(0);
      return;
    }

    try {
      const result = await pool.query<{ age_seconds: number | null }>(
        `
          SELECT EXTRACT(EPOCH FROM (NOW() - MIN(available_at)))::double precision AS age_seconds
          FROM command_outbox
          WHERE status = 'PENDING'
            AND available_at <= NOW()
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        `
      );
      const ageSeconds = result.rows[0]?.age_seconds;
      this.set(Number.isFinite(ageSeconds) && ageSeconds !== null ? Math.max(ageSeconds, 0) : 0);
    } catch (error) {
      recordCollectionError('command_outbox');
      this.set(0);
      void error;
    }
  },
});

const commandOutboxDispatchCounter = new Counter({
  name: 'darshan_server_command_outbox_dispatch_total',
  help: 'Command outbox dispatch outcomes.',
  labelNames: ['result', 'event_type'],
  registers: [registry],
});

const jobEnqueueCounter = new Counter({
  name: 'darshan_server_job_enqueued_total',
  help: 'Jobs enqueued into pg-boss by queue and outcome.',
  labelNames: ['queue', 'result'],
  registers: [registry],
});

const jobProcessingCounter = new Counter({
  name: 'darshan_server_job_processing_total',
  help: 'Jobs processed by queue and outcome.',
  labelNames: ['queue', 'result'],
  registers: [registry],
});

const jobProcessingDurationHistogram = new Histogram({
  name: 'darshan_server_job_processing_duration_seconds',
  help: 'Background job processing duration in seconds.',
  labelNames: ['queue', 'result'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
  registers: [registry],
});

const pgBossQueueStateGauge = new Gauge({
  name: 'darshan_server_pg_boss_queue_jobs',
  help: 'Approximate pg-boss jobs by queue and state.',
  labelNames: ['queue', 'state'],
  registers: [registry],
  collect: async function collectPgBossQueueState() {
    for (const queue of OBSERVED_QUEUE_NAMES) {
      for (const state of OBSERVED_QUEUE_STATES) {
        this.set({ queue, state }, 0);
      }
    }

    const pool = getDatabasePool();
    if (!pool) {
      pgBossAvailableGauge.set(0);
      return;
    }

    try {
      const result = await pool.query<{ name: string; state: string; count: string }>(
        `
          SELECT name, state, COUNT(*)::bigint AS count
          FROM ${quoteIdentifier(appConfig.PG_BOSS_SCHEMA)}.job
          WHERE name = ANY($1::text[])
            AND state = ANY($2::text[])
          GROUP BY name, state
        `,
        [Array.from(OBSERVED_QUEUE_NAMES), Array.from(OBSERVED_QUEUE_STATES)]
      );

      pgBossAvailableGauge.set(1);
      for (const row of result.rows) {
        this.set({ queue: row.name, state: row.state }, Number(row.count));
      }
    } catch (error) {
      recordCollectionError('pg_boss');
      pgBossAvailableGauge.set(0);
      void error;
    }
  },
});

const pgBossAvailableGauge = new Gauge({
  name: 'darshan_server_pg_boss_available',
  help: 'Whether pg-boss queue metadata is queryable by the backend observability collector.',
  registers: [registry],
});

const dbPoolConnectionsGauge = new Gauge({
  name: 'darshan_server_db_pool_connections',
  help: 'Database pool connections by state.',
  labelNames: ['state'],
  registers: [registry],
  collect: function collectDbPoolConnections() {
    const pool = getDatabasePool();
    const total = pool?.totalCount ?? 0;
    const idle = pool?.idleCount ?? 0;
    const inUse = Math.max(total - idle, 0);

    this.set({ state: 'total' }, total);
    this.set({ state: 'idle' }, idle);
    this.set({ state: 'in_use' }, inUse);
  },
});

const dbPoolWaitingGauge = new Gauge({
  name: 'darshan_server_db_pool_waiting_clients',
  help: 'Clients currently waiting for a PostgreSQL pool connection.',
  registers: [registry],
  collect: function collectDbPoolWaiting() {
    const pool = getDatabasePool();
    this.set(pool?.waitingCount ?? 0);
  },
});

const s3OperationCounter = new Counter({
  name: 'darshan_server_s3_operations_total',
  help: 'S3 or MinIO operations attempted by darshan-server.',
  labelNames: ['operation', 'result'],
  registers: [registry],
});

const s3OperationDurationHistogram = new Histogram({
  name: 'darshan_server_s3_operation_duration_seconds',
  help: 'S3 or MinIO operation duration in seconds.',
  labelNames: ['operation', 'result'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const websocketConnectionsGauge = new Gauge({
  name: 'darshan_server_websocket_connections',
  help: 'Current websocket connections on darshan-server.',
  registers: [registry],
});

const REALTIME_SOCKET_NAMESPACES = new Set<string>(['/device', '/screens', '/chat', '/notifications']);

const realtimeSocketConnectionsGauge = new Gauge({
  name: 'darshan_server_realtime_socket_connections',
  help: 'Current realtime Socket.IO connections by namespace.',
  labelNames: ['namespace'],
  registers: [registry],
  collect: function collectRealtimeSocketConnections() {
    // Include an explicit zero for every known namespace, so alert queries can
    // detect absent expected device connections immediately after a restart.
    for (const namespace of REALTIME_SOCKET_NAMESPACES) {
      this.set({ namespace }, realtimeSocketConnectionCounts.get(namespace) ?? 0);
    }
  },
});
const realtimeSocketConnectionCounts = new Map<string, number>();

const realtimeSocketConnectCounter = new Counter({
  name: 'darshan_server_realtime_socket_connect_total',
  help: 'Realtime Socket.IO connection attempts accepted by namespace.',
  labelNames: ['namespace'],
  registers: [registry],
});

const realtimeSocketDisconnectCounter = new Counter({
  name: 'darshan_server_realtime_socket_disconnect_total',
  help: 'Realtime Socket.IO disconnects by namespace and low-cardinality reason category.',
  labelNames: ['namespace', 'reason'],
  registers: [registry],
});

const realtimeSocketClientEventCounter = new Counter({
  name: 'darshan_server_realtime_socket_client_events_total',
  help: 'Client-originated realtime Socket.IO events by namespace and event name.',
  labelNames: ['namespace', 'event'],
  registers: [registry],
});

const realtimeSocketServerEventCounter = new Counter({
  name: 'darshan_server_realtime_socket_server_events_total',
  help: 'Server-emitted realtime Socket.IO events by namespace and event name.',
  labelNames: ['namespace', 'event'],
  registers: [registry],
});

const realtimeSocketRejectCounter = new Counter({
  name: 'darshan_server_realtime_socket_rejects_total',
  help: 'Realtime Socket.IO event rejects by namespace, event, and low-cardinality reason.',
  labelNames: ['namespace', 'event', 'reason'],
  registers: [registry],
});

const realtimeSocketAuthCounter = new Counter({
  name: 'darshan_server_realtime_socket_auth_total',
  help: 'Realtime Socket.IO namespace authentication outcomes by namespace and reason category.',
  labelNames: ['namespace', 'result', 'reason'],
  registers: [registry],
});
const REALTIME_SOCKET_EVENTS = new Set<string>([
  'HELLO',
  'HELLO_ACK',
  'PING',
  'PONG',
  'ERROR',
  'COMMAND_AVAILABLE',
  'RESYNC_REQUIRED',
  'SERVER_TIME',
  'screens:subscribe',
  'screens:sync',
  'screens:error',
  'screens:state:update',
  'screens:preview:update',
  'screens:refresh:required',
  'schedule-requests:changed',
  'chat:subscribe',
  'chat:typing',
  'chat:read',
  'chat:error',
  'chat:message:new',
  'chat:message:updated',
  'chat:message:deleted',
  'chat:conversation:updated',
  'chat:pin:update',
  'chat:bookmark:update',
  'notifications:sync',
  'notifications:error',
  'notifications:count',
]);
const REALTIME_SOCKET_AUTH_REASONS = new Set<string>([
  'authorized',
  'missing_identity',
  'legacy_disabled',
  'signed_disabled',
  'missing_signature',
  'malformed_auth',
  'signature_invalid',
  'signature_expired',
  'signature_unavailable',
  'invalid_credentials',
  'device_not_registered',
  'replay_detected',
  'replay_store_unavailable',
  'replay_store_error',
  'origin_not_allowed',
  'origin_required',
  'missing_token',
  'token_revoked',
  'invalid_token',
  'unauthorized',
]);
const DEVICE_SOCKET_AUTH_MODES = new Set<string>(['legacy', 'signed', 'unknown']);
const DEVICE_SOCKET_AUTH_REASONS = new Set<string>([
  'authorized',
  'missing_identity',
  'legacy_disabled',
  'signed_disabled',
  'missing_signature',
  'malformed_auth',
  'signature_invalid',
  'signature_expired',
  'signature_unavailable',
  'invalid_credentials',
  'device_not_registered',
  'replay_detected',
  'replay_store_unavailable',
  'replay_store_error',
  'unknown',
]);
const DEVICE_SOCKET_AUTH_REPLAY_RESULTS = new Set<string>(['accepted', 'rejected', 'bypassed', 'error']);
const DEVICE_SOCKET_AUTH_REPLAY_REASONS = new Set<string>([
  'stored',
  'replay_detected',
  'disabled',
  'store_unavailable',
  'store_error',
  'unknown',
]);

const deviceRealtimeAuthCounter = new Counter({
  name: 'darshan_server_device_realtime_auth_total',
  help: 'Device realtime socket authentication outcomes.',
  labelNames: ['result', 'reason'],
  registers: [registry],
});

const deviceSocketAuthCounter = new Counter({
  name: 'darshan_server_device_socket_auth_total',
  help: 'Device Socket.IO namespace authentication outcomes by auth mode and bounded reason category.',
  labelNames: ['namespace', 'mode', 'result', 'reason'],
  registers: [registry],
});

const deviceSocketAuthReplayCounter = new Counter({
  name: 'darshan_server_device_socket_auth_replay_total',
  help: 'Replay protection outcomes for signed device Socket.IO authentication.',
  labelNames: ['namespace', 'result', 'reason'],
  registers: [registry],
});

const deviceRealtimeNotificationCounter = new Counter({
  name: 'darshan_server_device_realtime_notifications_total',
  help: 'Device realtime notification delivery outcomes. Notifications are wake-up only; REST remains authoritative.',
  labelNames: ['type', 'result'],
  registers: [registry],
});

const websocketNotificationPayloadTooLargeCounter = new Counter({
  name: 'darshan_server_websocket_notification_payload_too_large_total',
  help: 'Rejected websocket notification payloads that exceeded the configured byte limit.',
  labelNames: ['type'],
  registers: [registry],
});

const realtimeBusConnectionGauge = new Gauge({
  name: 'darshan_server_realtime_bus_connection_status',
  help: 'Realtime bus connection status by provider. 1 means configured and available from the last observed operation, 0 means unavailable.',
  labelNames: ['provider'],
  registers: [registry],
});

const realtimeBusPublishCounter = new Counter({
  name: 'darshan_server_realtime_bus_publish_total',
  help: 'Realtime bus wake notification publish attempts. Valkey is wake-only; DB outbox remains durable truth.',
  labelNames: ['provider', 'result', 'type'],
  registers: [registry],
});

const realtimeBusSubscribeFailureCounter = new Counter({
  name: 'darshan_server_realtime_bus_subscribe_failures_total',
  help: 'Realtime bus subscribe failures by provider and reason.',
  labelNames: ['provider', 'reason'],
  registers: [registry],
});

const realtimeBusNodeMessageCounter = new Counter({
  name: 'darshan_server_realtime_bus_node_messages_total',
  help: 'Realtime bus node messages received and local socket delivery outcomes.',
  labelNames: ['result', 'type'],
  registers: [registry],
});

const deviceNodeRegistryWritesCounter = new Counter({
  name: 'darshan_server_device_node_registry_writes_total',
  help: 'Device-to-realtime-node mapping write attempts.',
  labelNames: ['provider', 'operation', 'result'],
  registers: [registry],
});

const deviceNodeRegistryMissCounter = new Counter({
  name: 'darshan_server_device_node_registry_misses_total',
  help: 'Device-to-realtime-node mapping lookup misses.',
  labelNames: ['provider'],
  registers: [registry],
});

const realtimeBusFallbackCounter = new Counter({
  name: 'darshan_server_realtime_bus_fallback_total',
  help: 'Realtime wake attempts that relied on DB/REST/polling fallback because fanout was unavailable or no device node was known.',
  labelNames: ['reason'],
  registers: [registry],
});

const playerRealtimeDiagnosticsCounter = new Counter({
  name: 'darshan_server_player_realtime_diagnostics_total',
  help: 'Player heartbeat delivery diagnostics with bounded state and release-alignment labels.',
  labelNames: ['connection_state', 'player_release_alignment', 'server_release_alignment'],
  registers: [registry],
});

const mediaCacheReportsCounter = new Counter({
  name: 'darshan_server_media_cache_reports_total',
  help: 'Media/cache reports received from players.',
  labelNames: ['event_type', 'severity', 'result'],
  registers: [registry],
});

const unresolvedMediaCacheReportsGauge = new Gauge({
  name: 'darshan_server_media_cache_reports_unresolved',
  help: 'Open media/cache reports by event type and severity.',
  labelNames: ['event_type', 'severity'],
  registers: [registry],
  collect: async function collectUnresolvedMediaCacheReports() {
    for (const eventType of MEDIA_CACHE_EVENT_TYPES) {
      for (const severity of MEDIA_CACHE_SEVERITIES) {
        this.set({ event_type: eventType, severity }, 0);
      }
    }

    const pool = getDatabasePool();
    if (!pool) return;

    try {
      const result = await pool.query<{ event_type: string; severity: string; count: string }>(
        `
          SELECT event_type, severity, COUNT(*)::bigint AS count
          FROM media_cache_reports
          WHERE status = 'OPEN'
          GROUP BY event_type, severity
        `
      );

      for (const row of result.rows) {
        this.set({ event_type: row.event_type, severity: row.severity }, Number(row.count));
      }
    } catch (error) {
      recordCollectionError('media_cache_reports');
      void error;
    }
  },
});

const fleetPlayersGauge = new Gauge({
  name: 'darshan_fleet_players_total',
  help: 'Current screen fleet totals derived from backend state.',
  labelNames: ['state'],
  registers: [registry],
  collect: async function collectFleetPlayers() {
    for (const state of FLEET_STATES) {
      this.set({ state }, 0);
    }

    const pool = getDatabasePool();
    if (!pool) {
      latestHeartbeatAgeGauge.set(0);
      recentHeartbeatsGauge.set(0);
      return;
    }

    try {
      const [screenCounts, latestHeartbeat, heartbeatsLast5m] = await Promise.all([
        pool.query<{ status: string; count: string }>(
          `
            SELECT status, COUNT(*)::bigint AS count
            FROM screens
            GROUP BY status
          `
        ),
        pool.query<{ age_seconds: number | null }>(
          `
            SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::double precision AS age_seconds
            FROM heartbeats
          `
        ),
        pool.query<{ count: string }>(
          `
            SELECT COUNT(*)::bigint AS count
            FROM heartbeats
            WHERE created_at >= NOW() - INTERVAL '5 minutes'
          `
        ),
      ]);

      for (const row of screenCounts.rows) {
        if (FLEET_STATES.includes(row.status as (typeof FLEET_STATES)[number])) {
          this.set({ state: row.status }, Number(row.count));
        }
      }

      const latestAge = latestHeartbeat.rows[0]?.age_seconds;
      latestHeartbeatAgeGauge.set(Number.isFinite(latestAge) && latestAge !== null ? Math.max(latestAge, 0) : 0);
      recentHeartbeatsGauge.set(Number(heartbeatsLast5m.rows[0]?.count ?? 0));
    } catch (error) {
      recordCollectionError('fleet_rollups');
      latestHeartbeatAgeGauge.set(0);
      recentHeartbeatsGauge.set(0);
      void error;
    }
  },
});

const latestHeartbeatAgeGauge = new Gauge({
  name: 'darshan_fleet_latest_heartbeat_age_seconds',
  help: 'Age in seconds of the most recent heartbeat persisted by the backend.',
  registers: [registry],
});

const recentHeartbeatsGauge = new Gauge({
  name: 'darshan_fleet_heartbeats_last_5m',
  help: 'Heartbeats persisted during the last five minutes.',
  registers: [registry],
});

const collectionErrorsCounter = new Counter({
  name: 'darshan_server_observability_collection_errors_total',
  help: 'Observability collector errors encountered while gathering scrape-time gauges.',
  labelNames: ['collector'],
  registers: [registry],
});

const registeredCollectors = [
  pgBossQueueStateGauge,
  dbPoolConnectionsGauge,
  dbPoolWaitingGauge,
  deviceCommandRowsGauge,
  commandOutboxRowsGauge,
  commandOutboxOldestPendingAgeGauge,
  unresolvedMediaCacheReportsGauge,
  fleetPlayersGauge,
];
void registeredCollectors;

let defaultMetricsInitialized = false;

function initializeDefaultMetrics() {
  if (defaultMetricsInitialized) {
    return;
  }

  collectDefaultMetrics({ register: registry });
  defaultMetricsInitialized = true;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function recordCollectionError(
  collector: 'pg_boss' | 'fleet_rollups' | 'device_commands' | 'command_outbox' | 'media_cache_reports'
) {
  try {
    collectionErrorsCounter.inc({ collector });
  } catch {
    // Observability must never break runtime paths.
  }
}

function safeRecord(callback: () => void) {
  try {
    callback();
  } catch {
    // Metrics failures are intentionally swallowed.
  }
}

function resolveRouteTemplate(request: FastifyRequest) {
  const routeOptionsUrl = (request as FastifyRequest & { routeOptions?: { url?: string } }).routeOptions?.url;
  if (typeof routeOptionsUrl === 'string' && routeOptionsUrl.length > 0) {
    return routeOptionsUrl;
  }

  const routerPath = (request as FastifyRequest & { routerPath?: string }).routerPath;
  if (typeof routerPath === 'string' && routerPath.length > 0) {
    return routerPath;
  }

  return 'unmatched';
}

function getStatusClass(statusCode: number) {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return '1xx';
}

export function ensureObservabilityInitialized() {
  initializeDefaultMetrics();
}

export function getObservabilityRegistry() {
  initializeDefaultMetrics();
  return registry;
}

export function appendLegacySignhexMetricAliases(metricsOutput: string) {
  const aliasLines = metricsOutput
    .split('\n')
    .filter((line) => line.includes('darshan_'))
    .map((line) => line.replace(/\bdarshan_/g, 'signhex_'));

  if (aliasLines.length === 0) {
    return metricsOutput;
  }

  return `${metricsOutput.trimEnd()}\n# DARSHAN rename compatibility aliases for one release.\n${aliasLines.join('\n')}\n`;
}

export function observeHttpRequest(request: FastifyRequest, reply: FastifyReply, durationSeconds: number) {
  safeRecord(() => {
    const labels = {
      method: request.method,
      route: resolveRouteTemplate(request),
      status_class: getStatusClass(reply.statusCode),
    };

    requestCounter.inc(labels);
    requestDurationHistogram.observe(labels, durationSeconds);
  });
}

export function recordTelemetryIngest(params: {
  telemetryType: TelemetryType;
  persistMode: TelemetryPersistMode;
  result: 'success' | 'error';
  durationSeconds: number;
  heartbeatStatus?: 'ONLINE' | 'OFFLINE' | 'ERROR';
}) {
  safeRecord(() => {
    telemetryIngestCounter.inc({
      telemetry_type: params.telemetryType,
      result: params.result,
      persist_mode: params.persistMode,
    });
    telemetryIngestDurationHistogram.observe(
      {
        telemetry_type: params.telemetryType,
        persist_mode: params.persistMode,
        result: params.result,
      },
      params.durationSeconds
    );

    if (params.telemetryType === 'heartbeat' && params.heartbeatStatus) {
      heartbeatCounter.inc({
        status: params.heartbeatStatus,
        result: params.result,
        persist_mode: params.persistMode,
      });
    }
  });
}

export function recordPairingCodeAllocation(mode: PairingCodeMode, result: PairingCodeAllocationResult) {
  safeRecord(() => {
    pairingCodeAllocationCounter.inc({ mode, result });
  });
}

export function recordPairingCsrValidation(
  result: PairingCsrValidationResult,
  reason: PairingCsrValidationReason
) {
  safeRecord(() => {
    pairingCsrValidationCounter.inc({ result, reason });
  });
}

export function recordDeviceAuthAttempt(params: {
  configuredMode: DeviceAuthMode;
  authMethod: DeviceAuthMethod;
  result: DeviceAuthResult;
  reason: string;
}) {
  safeRecord(() => {
    deviceAuthCounter.inc({
      configured_mode: params.configuredMode,
      auth_method: params.authMethod,
      result: params.result,
      reason: params.reason,
    });
  });
}

export function recordDeviceCommandClaim(source: DeviceCommandClaimSource, count: number) {
  safeRecord(() => {
    if (count > 0) {
      deviceCommandClaimCounter.inc({ source }, count);
    }
  });
}

export function recordDeviceCommandAck(result: DeviceCommandAckResult, durationSeconds: number) {
  safeRecord(() => {
    deviceCommandAckCounter.inc({ result });
    deviceCommandAckDurationHistogram.observe({ result }, durationSeconds);
  });
}

export function recordOutboxDispatch(result: OutboxDispatchResult, eventType = 'unknown', count = 1) {
  safeRecord(() => {
    commandOutboxDispatchCounter.inc({ result, event_type: eventType }, Math.max(count, 0));
  });
}

export function recordDeviceRealtimeAuth(result: RealtimeAuthResult, reason: string) {
  safeRecord(() => {
    deviceRealtimeAuthCounter.inc({ result, reason });
  });
}

export function recordDeviceSocketAuth(params: {
  namespace: string;
  mode: string;
  result: RealtimeAuthResult;
  reason: string;
}) {
  safeRecord(() => {
    deviceSocketAuthCounter.inc({
      namespace: normalizeRealtimeSocketNamespace(params.namespace),
      mode: normalizeDeviceSocketAuthMode(params.mode),
      result: params.result,
      reason: normalizeDeviceSocketAuthReason(params.reason),
    });
  });
}

export function recordDeviceSocketAuthReplay(params: {
  namespace: string;
  result: string;
  reason: string;
}) {
  safeRecord(() => {
    deviceSocketAuthReplayCounter.inc({
      namespace: normalizeRealtimeSocketNamespace(params.namespace),
      result: normalizeDeviceSocketAuthReplayResult(params.result),
      reason: normalizeDeviceSocketAuthReplayReason(params.reason),
    });
  });
}

export function categorizeRealtimeSocketDisconnectReason(reason: string): RealtimeSocketDisconnectReason {
  switch (reason) {
    case 'client namespace disconnect':
    case 'io client disconnect':
      return 'client_disconnect';
    case 'server namespace disconnect':
    case 'server shutting down':
    case 'forced close':
      return 'server_disconnect';
    case 'ping timeout':
      return 'ping_timeout';
    case 'transport close':
      return 'transport_close';
    case 'transport error':
      return 'transport_error';
    case 'namespace disconnect':
      return 'namespace_disconnect';
    default:
      return 'unknown';
  }
}

function normalizeRealtimeSocketNamespace(namespace: string): RealtimeSocketNamespace {
  return REALTIME_SOCKET_NAMESPACES.has(namespace) ? (namespace as RealtimeSocketNamespace) : 'unknown';
}

function normalizeRealtimeSocketEvent(event: string): string {
  return REALTIME_SOCKET_EVENTS.has(event) ? event : 'unknown';
}

function normalizeRealtimeSocketAuthReason(reason: string): RealtimeSocketAuthReason {
  return REALTIME_SOCKET_AUTH_REASONS.has(reason) ? (reason as RealtimeSocketAuthReason) : 'unknown';
}

function normalizeDeviceSocketAuthMode(mode: string): DeviceSocketAuthMode {
  return DEVICE_SOCKET_AUTH_MODES.has(mode) ? (mode as DeviceSocketAuthMode) : 'unknown';
}

function normalizeDeviceSocketAuthReason(reason: string): DeviceSocketAuthReason {
  return DEVICE_SOCKET_AUTH_REASONS.has(reason) ? (reason as DeviceSocketAuthReason) : 'unknown';
}

function normalizeDeviceSocketAuthReplayResult(result: string): DeviceSocketAuthReplayResult {
  return DEVICE_SOCKET_AUTH_REPLAY_RESULTS.has(result) ? (result as DeviceSocketAuthReplayResult) : 'error';
}

function normalizeDeviceSocketAuthReplayReason(reason: string): DeviceSocketAuthReplayReason {
  return DEVICE_SOCKET_AUTH_REPLAY_REASONS.has(reason) ? (reason as DeviceSocketAuthReplayReason) : 'unknown';
}

export function recordRealtimeSocketConnect(namespace: string) {
  safeRecord(() => {
    const normalizedNamespace = normalizeRealtimeSocketNamespace(namespace);
    const nextCount = (realtimeSocketConnectionCounts.get(normalizedNamespace) || 0) + 1;
    realtimeSocketConnectionCounts.set(normalizedNamespace, nextCount);
    realtimeSocketConnectionsGauge.set({ namespace: normalizedNamespace }, nextCount);
    realtimeSocketConnectCounter.inc({ namespace: normalizedNamespace });
  });
}

export function recordRealtimeSocketDisconnect(namespace: string, reason: string) {
  safeRecord(() => {
    const normalizedNamespace = normalizeRealtimeSocketNamespace(namespace);
    const nextCount = Math.max((realtimeSocketConnectionCounts.get(normalizedNamespace) || 0) - 1, 0);
    realtimeSocketConnectionCounts.set(normalizedNamespace, nextCount);
    realtimeSocketConnectionsGauge.set({ namespace: normalizedNamespace }, nextCount);
    realtimeSocketDisconnectCounter.inc({
      namespace: normalizedNamespace,
      reason: categorizeRealtimeSocketDisconnectReason(reason),
    });
  });
}

export function recordRealtimeSocketClientEvent(namespace: string, event: string) {
  safeRecord(() => {
    realtimeSocketClientEventCounter.inc({
      namespace: normalizeRealtimeSocketNamespace(namespace),
      event: normalizeRealtimeSocketEvent(event),
    });
  });
}

export function recordRealtimeSocketServerEvent(namespace: string, event: string, count = 1) {
  safeRecord(() => {
    realtimeSocketServerEventCounter.inc(
      {
        namespace: normalizeRealtimeSocketNamespace(namespace),
        event: normalizeRealtimeSocketEvent(event),
      },
      Math.max(count, 0)
    );
  });
}

export function recordRealtimeSocketReject(
  namespace: string,
  event: string,
  reason: RealtimeSocketRejectReason
) {
  safeRecord(() => {
    realtimeSocketRejectCounter.inc({
      namespace: normalizeRealtimeSocketNamespace(namespace),
      event: normalizeRealtimeSocketEvent(event),
      reason,
    });
  });
}

export function recordRealtimeSocketAuth(
  namespace: string,
  result: RealtimeSocketAuthResult,
  reason: string
) {
  safeRecord(() => {
    realtimeSocketAuthCounter.inc({
      namespace: normalizeRealtimeSocketNamespace(namespace),
      result,
      reason: normalizeRealtimeSocketAuthReason(reason),
    });
  });
}

export function recordDeviceRealtimeNotification(type: string, result: RealtimeNotificationResult) {
  safeRecord(() => {
    deviceRealtimeNotificationCounter.inc({ type, result });
  });
}

export function recordWebsocketNotificationPayloadTooLarge(type: string) {
  safeRecord(() => {
    websocketNotificationPayloadTooLargeCounter.inc({ type });
  });
}

export function setRealtimeBusConnectionStatus(provider: RealtimeBusProvider, connected: boolean) {
  safeRecord(() => {
    realtimeBusConnectionGauge.set({ provider }, connected ? 1 : 0);
  });
}

export function recordRealtimeBusPublish(provider: RealtimeBusProvider, result: RealtimeBusPublishResult, type: string) {
  safeRecord(() => {
    realtimeBusPublishCounter.inc({ provider, result, type });
    if (provider === 'valkey') {
      realtimeBusConnectionGauge.set({ provider }, result === 'published' ? 1 : 0);
    }
  });
}

export function recordRealtimeBusSubscribeFailure(provider: RealtimeBusProvider, reason: string) {
  safeRecord(() => {
    realtimeBusSubscribeFailureCounter.inc({ provider, reason });
    if (provider === 'valkey') {
      realtimeBusConnectionGauge.set({ provider }, 0);
    }
  });
}

export function recordRealtimeBusNodeMessage(result: RealtimeBusNodeMessageResult, type: string) {
  safeRecord(() => {
    realtimeBusNodeMessageCounter.inc({ result, type });
  });
}

export function recordDeviceNodeRegistryWrite(
  provider: RealtimeBusProvider,
  operation: DeviceNodeRegistryOperation,
  result: DeviceNodeRegistryResult
) {
  safeRecord(() => {
    deviceNodeRegistryWritesCounter.inc({ provider, operation, result });
  });
}

export function recordDeviceNodeRegistryMiss(provider: RealtimeBusProvider) {
  safeRecord(() => {
    deviceNodeRegistryMissCounter.inc({ provider });
  });
}

export function recordRealtimeBusFallback(reason: RealtimeBusFallbackReason) {
  safeRecord(() => {
    realtimeBusFallbackCounter.inc({ reason });
  });
}

function getPlayerReleaseAlignment(reportedReleaseId: string | undefined): PlayerReleaseAlignment {
  if (!reportedReleaseId) return 'missing';
  return reportedReleaseId === appConfig.DARSHAN_RELEASE_ID ? 'match' : 'mismatch';
}

export function recordPlayerRealtimeDiagnostics(params: {
  connectionState: PlayerRealtimeConnectionState;
  playerReleaseId?: string;
  serverReleaseId?: string;
}) {
  safeRecord(() => {
    playerRealtimeDiagnosticsCounter.inc({
      connection_state: params.connectionState,
      player_release_alignment: getPlayerReleaseAlignment(params.playerReleaseId),
      server_release_alignment: getPlayerReleaseAlignment(params.serverReleaseId),
    });
  });
}

export function recordMediaCacheReport(params: {
  eventType: string;
  severity: string;
  result: MediaCacheReportResult;
}) {
  safeRecord(() => {
    mediaCacheReportsCounter.inc({
      event_type: params.eventType,
      severity: params.severity,
      result: params.result,
    });
  });
}

export function recordJobEnqueue(queue: string, result: JobResult) {
  safeRecord(() => {
    jobEnqueueCounter.inc({ queue, result });
  });
}

export async function observeJobProcessing<T>(queue: string, work: () => Promise<T>) {
  const start = process.hrtime.bigint();

  try {
    const result = await work();
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    safeRecord(() => {
      jobProcessingCounter.inc({ queue, result: 'success' });
      jobProcessingDurationHistogram.observe({ queue, result: 'success' }, durationSeconds);
    });
    return result;
  } catch (error) {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    safeRecord(() => {
      jobProcessingCounter.inc({ queue, result: 'error' });
      jobProcessingDurationHistogram.observe({ queue, result: 'error' }, durationSeconds);
    });
    throw error;
  }
}

function classifyS3Error(error: unknown): S3Result {
  const metadataStatus = typeof error === 'object' && error !== null ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined;
  if (metadataStatus === 404) return 'not_found';
  if (metadataStatus === 409 || metadataStatus === 412) return 'conflict';

  const errorName = typeof error === 'object' && error !== null ? (error as { name?: string }).name : undefined;
  if (errorName === 'NotFound' || errorName === 'NoSuchKey') return 'not_found';
  if (errorName === 'Conflict' || errorName === 'PreconditionFailed') return 'conflict';
  return 'error';
}

export async function observeS3Operation<T>(operation: S3Operation, work: () => Promise<T>) {
  const start = process.hrtime.bigint();

  try {
    const result = await work();
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    safeRecord(() => {
      s3OperationCounter.inc({ operation, result: 'success' });
      s3OperationDurationHistogram.observe({ operation, result: 'success' }, durationSeconds);
    });
    return result;
  } catch (error) {
    const result = classifyS3Error(error);
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    safeRecord(() => {
      s3OperationCounter.inc({ operation, result });
      s3OperationDurationHistogram.observe({ operation, result }, durationSeconds);
    });
    throw error;
  }
}

export function setWebsocketConnections(count: number) {
  safeRecord(() => {
    websocketConnectionsGauge.set(Math.max(count, 0));
  });
}

export function resetObservabilityMetricsForTests() {
  registry.resetMetrics();
  realtimeSocketConnectionCounts.clear();
  setWebsocketConnections(0);
  pgBossAvailableGauge.set(0);
  latestHeartbeatAgeGauge.set(0);
  recentHeartbeatsGauge.set(0);
}
