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
import { eq, sql } from 'drizzle-orm';

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
    server_time: new Date().toISOString(),
    session_id: input.sessionId,
    device_id: input.deviceId,
    connection_id: input.connectionId,
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

export function setupDeviceRealtimeGateway(fastify: FastifyInstance, options: { force?: boolean } = {}) {
  if ((fastify as any)._deviceRealtimeGatewayReady) return;
  if (!options.force && !config.REALTIME_SYNC_ENABLED) return;

  const io = getOrCreateSocketServer(fastify);
  const nsp = io.of(config.REALTIME_DEVICE_NAMESPACE);
  attachNamespaceSocketObservability(nsp, config.REALTIME_DEVICE_NAMESPACE);

  void initializeRealtimeFanout((message) => {
    handleLocalFanoutDelivery(message, (incoming) => {
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
      (socket.data as any).deviceAuthMode = result.mode;
      try {
        await recordDeviceAuthRolloutObservation({
          screenId: result.deviceId,
          channel: 'socket',
          method: result.mode === 'signed' ? 'signed' : 'legacy',
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
    socket.on('HELLO', (payloadOrAck: unknown, maybeAck?: SocketAck) => {
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
