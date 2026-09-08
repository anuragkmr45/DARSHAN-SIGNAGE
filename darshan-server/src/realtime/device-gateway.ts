import { FastifyInstance } from 'fastify';
import { Socket } from 'socket.io';
import { config } from '@/config';
import {
  recordDeviceRealtimeAuth,
  recordDeviceSocketAuth,
  recordDeviceRealtimeNotification,
  recordRealtimeSocketAuth,
  recordRealtimeSocketClientEvent,
  recordRealtimeSocketServerEvent,
  recordWebsocketNotificationPayloadTooLarge,
} from '@/observability/metrics';
import { deviceConnectionRegistry } from '@/realtime/device-connection-registry';
import {
  handleLocalFanoutDelivery,
  initializeRealtimeFanout,
  closeRealtimeFanout,
  getRealtimeFanoutState,
  publishWakeBroadcast,
  publishWakeToDevice,
  refreshDeviceForFanout,
  registerDeviceForFanout,
  unregisterDeviceForFanout,
} from '@/realtime/realtime-fanout';
import { attachNamespaceSocketObservability, getOrCreateSocketServer } from '@/realtime/socket-server';
import {
  buildDeviceSocketError,
  consumeSocketRateLimit,
  deviceHelloPayloadSchema,
  devicePingPayloadSchema,
  normalizePayloadAndAck,
  SocketEventRateLimiter,
  validateSocketPayload,
  type SocketAck,
} from '@/realtime/socket-hardening';
import { authenticateDeviceSocketHandshake, type DeviceSocketAuthFailure } from '@/realtime/device-socket-auth';
import { recordDeviceAuthRolloutObservation } from '@/deployment/device-auth-rollout';
import { createLogger } from '@/utils/logger';
import { getDatabase, schema } from '@/db';
import { and, eq, sql } from 'drizzle-orm';
import { NATIVE_PLAYER_CONTRACT_VERSION, NATIVE_PLAYER_SUPPORTED_CONTRACT_VERSIONS, type RuntimeProfile } from '@/contracts/native-player';

const logger = createLogger('device-realtime-gateway');
let deviceNodeRefreshTimer: NodeJS.Timeout | null = null;
const devicePingRateLimiter = new SocketEventRateLimiter(30, 1);

export const DEVICE_REALTIME_MESSAGE_TYPES = [
  'HELLO',
  'HELLO_ACK',
  'COMMAND_AVAILABLE',
  'RESYNC_REQUIRED',
  'SERVER_TIME',
  'PING',
  'PONG',
  'ERROR',
] as const;

type DeviceHelloPayload = {
  type?: string;
  protocol_version?: string;
  device_id?: string;
  session_id?: string;
  app?: { version?: string };
  platform?: { family?: string };
  capabilities?: {
    commands?: string[];
    features?: string[];
    screenshot?: boolean;
    log_upload?: boolean;
    offline_startup?: boolean;
    background_push?: boolean;
  };
  native_player?: {
    credential_id?: string;
    installation_id?: string;
    installation_epoch?: number;
    runtime_profile?: RuntimeProfile;
    capability_hash?: string;
    release_id?: string;
    protocol_versions?: string[];
  };
};

function sendDeviceError(socket: Socket, ack: SocketAck | undefined, response: Record<string, unknown>) {
  recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, 'ERROR');
  socket.emit('ERROR', response);
  if (ack) ack(response);
}

function notificationSizeBytes(payload: unknown) {
  return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

export function assertNotificationPayloadAllowed(payload: unknown) {
  const size = notificationSizeBytes(payload);
  if (size > config.WS_NOTIFICATION_MAX_BYTES) {
    throw new Error(`WebSocket notification exceeds ${config.WS_NOTIFICATION_MAX_BYTES} bytes`);
  }
  return size;
}

function buildHelloAck(input: {
  deviceId: string;
  sessionId: string | null;
  connectionId: string;
  protocolVersion: string;
}) {
  return {
    type: 'HELLO_ACK',
    protocol_version: input.protocolVersion,
    supported_protocol_versions: NATIVE_PLAYER_SUPPORTED_CONTRACT_VERSIONS,
    server_time: new Date().toISOString(),
    session_id: input.sessionId,
    device_id: input.deviceId,
    connection_id: input.connectionId,
    server_release_id: config.DARSHAN_RELEASE_ID,
    recommended_intervals: {
      heartbeat_ms: 30_000,
      command_safety_poll_ms: 60_000,
      fallback_poll_ms: 5_000,
      desired_state_poll_ms: 300_000,
    },
    limits: {
      ws_notification_max_bytes: config.WS_NOTIFICATION_MAX_BYTES,
      command_payload_max_bytes: 65_536,
      snapshot_warning_bytes: 2_097_152,
    },
  };
}

/**
 * Socket authentication proves possession of a credential key. Native 1.1
 * additionally binds the HELLO facts to that exact enrolled installation so
 * stale restored state cannot claim another installation's screen. Native 1.0
 * remains readable throughout the compatibility window.
 */
async function assertNativeHelloMatchesEnrollment(input: {
  deviceId: string;
  credentialId: string | null;
  protocolVersion: string;
  nativePlayer: NonNullable<DeviceHelloPayload['native_player']> | undefined;
}) {
  if (!NATIVE_PLAYER_SUPPORTED_CONTRACT_VERSIONS.includes(input.protocolVersion as typeof NATIVE_PLAYER_SUPPORTED_CONTRACT_VERSIONS[number])) {
    throw new Error('Unsupported native player protocol version');
  }
  if (input.protocolVersion === '1.0') return;
  const player = input.nativePlayer;
  if (!player || !input.credentialId || !player.credential_id || !player.installation_id || !player.installation_epoch ||
    !player.runtime_profile || !player.capability_hash || !player.protocol_versions?.includes(NATIVE_PLAYER_CONTRACT_VERSION)) {
    throw new Error('Native HELLO is missing required installation or protocol metadata');
  }
  if (player.credential_id !== input.credentialId) throw new Error('Native HELLO credential does not match authenticated credential');
  const db = getDatabase();
  const [credential] = await db
    .select({ screenId: schema.deviceCredentials.screen_id, installationId: schema.deviceCredentials.installation_id, installationEpoch: schema.deviceCredentials.installation_epoch })
    .from(schema.deviceCredentials)
    .where(eq(schema.deviceCredentials.credential_id, input.credentialId))
    .limit(1);
  if (!credential || credential.screenId !== input.deviceId || credential.installationId !== player.installation_id || credential.installationEpoch !== player.installation_epoch) {
    throw new Error('Native HELLO installation does not match enrolled credential');
  }
  const [installation] = await db
    .select({ screenId: schema.deviceInstallations.screen_id, runtimeProfile: schema.deviceInstallations.runtime_profile, capabilityHash: schema.deviceInstallations.capability_hash, status: schema.deviceInstallations.status })
    .from(schema.deviceInstallations)
    .where(and(
      eq(schema.deviceInstallations.installation_id, player.installation_id),
      eq(schema.deviceInstallations.installation_epoch, player.installation_epoch)
    ))
    .limit(1);
  if (!installation || installation.status !== 'ACTIVE' || installation.screenId !== input.deviceId ||
    installation.runtimeProfile !== player.runtime_profile || installation.capabilityHash !== player.capability_hash) {
    throw new Error('Native HELLO runtime profile or capability fingerprint does not match enrollment');
  }
}

export function setupDeviceRealtimeGateway(fastify: FastifyInstance, options: { force?: boolean } = {}) {
  if ((fastify as any)._deviceRealtimeGatewayReady) return;
  if (!options.force && !config.REALTIME_SYNC_ENABLED) return;

  const io = getOrCreateSocketServer(fastify);
  const nsp = io.of(config.REALTIME_DEVICE_NAMESPACE);
  attachNamespaceSocketObservability(nsp, config.REALTIME_DEVICE_NAMESPACE);

  void initializeRealtimeFanout((message) => {
    // The originating API node already delivered this wake synchronously.
    // Every other node expands it into device-bound messages for its own
    // sockets, which avoids transmitting a fleet list through Valkey.
    if (message.broadcast === true && message.origin_node_id === getRealtimeFanoutState().nodeId) {
      return;
    }
    handleLocalFanoutDelivery(message, (incoming) => {
      if (incoming.broadcast === true) {
        return deviceConnectionRegistry.emitToAll(incoming.type, (deviceId) => ({
          ...notificationForDevice(incoming, deviceId),
        }));
      }
      if (!incoming.device_id || typeof incoming.device_id !== 'string') return 0;
      return deviceConnectionRegistry.emitToDevice(incoming.device_id, incoming.type, incoming);
    });
  }, options).catch((error) => {
    logger.warn({ err: error }, 'Device realtime fanout initialization failed; polling fallback remains authoritative');
  });

  nsp.use(async (socket, next) => {
    const result = await authenticateDeviceSocketHandshake({
      auth: socket.handshake.auth as Record<string, unknown>,
      query: socket.handshake.query as Record<string, unknown>,
      headers: socket.handshake.headers as Record<string, unknown>,
    });

    if (result.ok) {
      (socket.data as any).deviceId = result.deviceId;
      (socket.data as any).deviceSerial = result.serial;
      (socket.data as any).deviceCredentialId = result.credentialId;
      (socket.data as any).deviceAuthMode = result.mode;
      try {
        await recordDeviceAuthRolloutObservation({
          screenId: result.deviceId,
          channel: 'socket',
          method: result.mode === 'legacy' ? 'legacy' : 'signed',
        });
      } catch (observationError) {
        // The handshake is already cryptographically authenticated. Retain
        // availability while logging the missing evidence; promotion tooling
        // will then refuse to claim this screen is signature-ready.
        logger.warn({ err: observationError, device_id: result.deviceId }, 'Failed to record device socket rollout observation');
      }
      recordDeviceRealtimeAuth('success', 'authorized');
      recordDeviceSocketAuth({
        namespace: config.REALTIME_DEVICE_NAMESPACE,
        mode: result.mode,
        result: 'success',
        reason: 'authorized',
      });
      recordRealtimeSocketAuth(config.REALTIME_DEVICE_NAMESPACE, 'success', 'authorized');
      return next();
    }

    const failure: DeviceSocketAuthFailure = result;
    recordDeviceRealtimeAuth('failure', failure.reason);
    recordDeviceSocketAuth({
      namespace: config.REALTIME_DEVICE_NAMESPACE,
      mode: failure.mode,
      result: 'failure',
      reason: failure.reason,
    });
    recordRealtimeSocketAuth(config.REALTIME_DEVICE_NAMESPACE, 'failure', failure.reason);
    logger.warn({ mode: failure.mode, reason: failure.reason }, 'Device realtime socket auth failed');
    return next(new Error('Unauthorized'));
  });

  nsp.on('connection', (socket: Socket) => {
    socket.on('HELLO', async (payloadOrAck: unknown, maybeAck?: SocketAck) => {
      recordRealtimeSocketClientEvent(config.REALTIME_DEVICE_NAMESPACE, 'HELLO');
      const { payload: rawPayload, ack } = normalizePayloadAndAck(payloadOrAck, maybeAck);
      try {
        const parsed = validateSocketPayload({
          socket,
          namespace: '/device',
          event: 'HELLO',
          payload: rawPayload,
          schema: deviceHelloPayloadSchema,
        });
        if (!parsed.ok) {
          if (parsed.reason === 'payload_too_large') {
            recordWebsocketNotificationPayloadTooLarge('HELLO');
          }
          sendDeviceError(
            socket,
            ack,
            buildDeviceSocketError(
              'HELLO_INVALID',
              parsed.reason === 'payload_too_large' ? 'HELLO payload too large' : 'Invalid HELLO payload',
              false
            )
          );
          return;
        }

        const payload = parsed.data as DeviceHelloPayload;
        assertNotificationPayloadAllowed(payload);
        const deviceId = (socket.data as any).deviceId as string;
        if (payload?.device_id && payload.device_id !== deviceId) {
          throw new Error('HELLO device_id does not match authenticated device');
        }

        const protocolVersion = typeof payload?.protocol_version === 'string' ? payload.protocol_version : '1.0';
        const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : null;
        if ((socket.data as any).deviceAuthMode === 'native_signature') {
          await assertNativeHelloMatchesEnrollment({
            deviceId,
            credentialId: (socket.data as any).deviceCredentialId as string | null,
            protocolVersion,
            nativePlayer: payload.native_player,
          });
        }
        const entry = deviceConnectionRegistry.register(socket, {
          deviceId,
          sessionId,
          protocolVersion,
          appVersion: typeof payload?.app?.version === 'string' ? payload.app.version : null,
          platformFamily: typeof payload?.platform?.family === 'string' ? payload.platform.family : null,
        });
        if (payload.capabilities) {
          const capabilityDocument = JSON.stringify({
            player_capabilities: payload.capabilities,
            player_capabilities_observed_at: new Date().toISOString(),
          });
          void getDatabase()
            .update(schema.screens)
            .set({
              device_info: sql`COALESCE(${schema.screens.device_info}, '{}'::jsonb) || ${capabilityDocument}::jsonb`,
              updated_at: new Date(),
            })
            .where(eq(schema.screens.id, deviceId))
            .catch((error) => {
              logger.warn({ err: error, device_id: deviceId }, 'Failed to persist player capability report');
            });
        }
        void registerDeviceForFanout(deviceId);

        const response = buildHelloAck({
          deviceId,
          sessionId,
          connectionId: entry.connectionId,
          protocolVersion,
        });
        assertNotificationPayloadAllowed(response);
        recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, 'HELLO_ACK');
        socket.emit('HELLO_ACK', response);
        if (ack) ack(response);
      } catch (error) {
        if (error instanceof Error && error.message.includes('WebSocket notification exceeds')) {
          recordWebsocketNotificationPayloadTooLarge('HELLO');
        }
        const response = {
          type: 'ERROR',
          code: 'HELLO_INVALID',
          message: error instanceof Error ? error.message : 'Invalid HELLO payload',
          retryable: false,
          server_time: new Date().toISOString(),
        };
        recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, 'ERROR');
        socket.emit('ERROR', response);
        if (ack) ack(response);
      }
    });

    socket.on('PING', (payloadOrAck: unknown, maybeAck?: SocketAck) => {
      recordRealtimeSocketClientEvent(config.REALTIME_DEVICE_NAMESPACE, 'PING');
      const { payload: rawPayload, ack } = normalizePayloadAndAck(payloadOrAck, maybeAck);
      try {
        const parsed = validateSocketPayload({
          socket,
          namespace: '/device',
          event: 'PING',
          payload: rawPayload,
          schema: devicePingPayloadSchema,
        });
        if (!parsed.ok) {
          if (parsed.reason === 'payload_too_large') {
            recordWebsocketNotificationPayloadTooLarge('PING');
          }
          sendDeviceError(
            socket,
            ack,
            buildDeviceSocketError(
              'PING_INVALID',
              parsed.reason === 'payload_too_large' ? 'PING payload too large' : 'Invalid PING payload',
              false
            )
          );
          return;
        }

        const rateLimit = consumeSocketRateLimit({
          socket,
          namespace: '/device',
          event: 'PING',
          limiter: devicePingRateLimiter,
        });
        if (!rateLimit.allowed) {
          sendDeviceError(
            socket,
            ack,
            buildDeviceSocketError(
              'RATE_LIMITED',
              'PING rate limit exceeded',
              true,
              rateLimit.retryAfterSeconds
            )
          );
          return;
        }

        const deviceId = (socket.data as any).deviceId as string | undefined;
        if (deviceId) {
          void refreshDeviceForFanout(deviceId);
        }
        const response = {
          type: 'PONG',
          server_time: new Date().toISOString(),
          echo: parsed.data ?? null,
        };
        recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, 'PONG');
        socket.emit('PONG', response);
        if (ack) ack(response);
      } catch (error) {
        logger.warn({ err: error, socket_id: socket.id }, 'Failed to handle device PING');
        const response = buildDeviceSocketError('PING_INVALID', 'Invalid PING payload', false);
        sendDeviceError(socket, ack, response);
      }
    });

    socket.on('disconnect', () => {
      devicePingRateLimiter.clear(socket.id);
      const deviceId = (socket.data as any).deviceId as string | undefined;
      deviceConnectionRegistry.unregisterSocket(socket.id);
      if (deviceId) {
        if (deviceConnectionRegistry.getConnections(deviceId).length > 0) {
          void refreshDeviceForFanout(deviceId);
        } else {
          void unregisterDeviceForFanout(deviceId);
        }
      }
    });
  });

  if (!deviceNodeRefreshTimer) {
    deviceNodeRefreshTimer = setInterval(() => {
      for (const deviceId of deviceConnectionRegistry.getConnectedDeviceIds()) {
        void refreshDeviceForFanout(deviceId);
      }
    }, Math.max(10_000, Math.floor(config.REALTIME_DEVICE_NODE_TTL_MS / 2)));
    deviceNodeRefreshTimer.unref?.();
  }

  fastify.addHook('onClose', async () => {
    if (deviceNodeRefreshTimer) {
      clearInterval(deviceNodeRefreshTimer);
      deviceNodeRefreshTimer = null;
    }
    deviceConnectionRegistry.clear();
    await closeRealtimeFanout();
  });

  (fastify as any)._deviceRealtimeGatewayReady = true;
}

export async function sendDeviceNotification(deviceId: string, type: 'COMMAND_AVAILABLE' | 'RESYNC_REQUIRED' | 'SERVER_TIME', payload: unknown) {
  const message = {
    ...(payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}),
    type,
    device_id: deviceId,
    sent_at: new Date().toISOString(),
  };
  try {
    assertNotificationPayloadAllowed(message);
    const deliveredConnections = deviceConnectionRegistry.emitToDevice(deviceId, type, message);
    if (deliveredConnections > 0) {
      recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, type, deliveredConnections);
      recordDeviceRealtimeNotification(type, 'delivered');
      return deliveredConnections;
    }

    const fanout = await publishWakeToDevice(deviceId, message);
    if (fanout.status === 'published') {
      recordDeviceRealtimeNotification(type, 'delivered');
      return 1;
    }
    if (fanout.status === 'payload_too_large') {
      recordWebsocketNotificationPayloadTooLarge(type);
      recordDeviceRealtimeNotification(type, 'payload_too_large');
      throw new Error(fanout.reason);
    }

    recordDeviceRealtimeNotification(type, 'deferred');
    return 0;
  } catch (error) {
    if (error instanceof Error && error.message.includes('WebSocket notification exceeds')) {
      recordWebsocketNotificationPayloadTooLarge(type);
      recordDeviceRealtimeNotification(type, 'payload_too_large');
    } else {
      recordDeviceRealtimeNotification(type, 'error');
    }
    throw error;
  }
}

function notificationForDevice(message: Record<string, unknown>, deviceId: string) {
  const payload = { ...message };
  // Cross-node fanout bookkeeping must not reach a player. Delete rather than
  // destructure into ignored variables so the sanitizer stays lint-clean and
  // cannot accidentally start forwarding new transport metadata.
  delete payload.broadcast;
  delete payload.origin_node_id;
  return { ...payload, device_id: deviceId };
}

/**
 * Wakes every currently connected player without enumerating the fleet in the
 * API response path. It is advisory only: every player performs its own
 * authenticated REST reconciliation, and offline players retain the normal
 * command/polling recovery path.
 */
export async function sendConnectedDeviceResync(payload: { reason: string; resources?: string[] }) {
  const current = getRealtimeFanoutState();
  const message = {
    type: 'RESYNC_REQUIRED' as const,
    reason: payload.reason,
    resources: payload.resources ?? ['desired_state', 'snapshot'],
    sent_at: new Date().toISOString(),
    broadcast: true,
    origin_node_id: current.nodeId,
  };
  try {
    assertNotificationPayloadAllowed(message);
    const localConnections = deviceConnectionRegistry.emitToAll('RESYNC_REQUIRED', (deviceId) =>
      notificationForDevice(message, deviceId)
    );
    if (localConnections > 0) {
      recordRealtimeSocketServerEvent(config.REALTIME_DEVICE_NAMESPACE, 'RESYNC_REQUIRED', localConnections);
    }

    // Local sockets were already notified above. A remote-node publish can
    // wait for a reconnecting Valkey client, so it must never extend the CMS
    // request latency. Remote delivery is still measured and the durable
    // command/polling paths remain the recovery mechanism.
    void publishWakeBroadcast(message)
      .then((fanout) => {
        if (fanout.status === 'payload_too_large') {
          recordWebsocketNotificationPayloadTooLarge('RESYNC_REQUIRED');
          recordDeviceRealtimeNotification('RESYNC_REQUIRED', 'error');
          logger.warn({ reason: fanout.reason }, 'Fleet resync wake exceeded the realtime payload limit');
          return;
        }
        recordDeviceRealtimeNotification('RESYNC_REQUIRED', fanout.status === 'published' || localConnections > 0 ? 'delivered' : 'deferred');
      })
      .catch((error) => {
        recordDeviceRealtimeNotification('RESYNC_REQUIRED', 'error');
        logger.warn({ err: error }, 'Fleet resync wake could not reach remote API nodes');
      });
    return { localConnections, broadcastQueued: true };
  } catch (error) {
    recordDeviceRealtimeNotification('RESYNC_REQUIRED', 'error');
    throw error;
  }
}
