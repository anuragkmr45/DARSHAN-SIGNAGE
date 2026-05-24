import { FastifyInstance } from 'fastify';
import { Socket } from 'socket.io';
import { desc, eq } from 'drizzle-orm';
import { config } from '@/config';
import { getDatabase, schema } from '@/db';
import { deviceConnectionRegistry } from '@/realtime/device-connection-registry';
import { getOrCreateSocketServer } from '@/realtime/socket-server';
import { createLogger } from '@/utils/logger';

const logger = createLogger('device-realtime-gateway');

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
};

function stringFromHandshake(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim().length > 0) return value[0].trim();
  return null;
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

async function authenticateDeviceSocket(socket: Socket) {
  const deviceId =
    stringFromHandshake(socket.handshake.auth?.device_id) ?? stringFromHandshake(socket.handshake.query?.device_id);
  const serial =
    stringFromHandshake(socket.handshake.auth?.device_serial) ??
    stringFromHandshake(socket.handshake.auth?.serial) ??
    stringFromHandshake(socket.handshake.headers['x-device-serial']);

  if (!deviceId || !serial) {
    throw new Error('Missing device identity');
  }

  const db = getDatabase();
  const certificates = await db
    .select()
    .from(schema.deviceCertificates)
    .where(eq(schema.deviceCertificates.screen_id, deviceId))
    .orderBy(desc(schema.deviceCertificates.created_at));

  const cert = certificates.find((entry) => entry.serial === serial) ?? null;
  if (!cert || cert.is_revoked || cert.revoked_at || cert.expires_at.getTime() <= Date.now()) {
    throw new Error('Invalid device credentials');
  }

  const [screen] = await db.select({ id: schema.screens.id }).from(schema.screens).where(eq(schema.screens.id, deviceId));
  if (!screen) {
    throw new Error('Device not registered');
  }

  return { deviceId, serial };
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

  nsp.use(async (socket, next) => {
    try {
      const auth = await authenticateDeviceSocket(socket);
      (socket.data as any).deviceId = auth.deviceId;
      (socket.data as any).deviceSerial = auth.serial;
      return next();
    } catch (error) {
      logger.warn({ err: error }, 'Device realtime socket auth failed');
      return next(new Error('Unauthorized'));
    }
  });

  nsp.on('connection', (socket: Socket) => {
    socket.on('HELLO', (payload: DeviceHelloPayload, ack?: (result: unknown) => void) => {
      try {
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

        const response = buildHelloAck({
          deviceId,
          sessionId,
          connectionId: entry.connectionId,
          protocolVersion,
        });
        assertNotificationPayloadAllowed(response);
        socket.emit('HELLO_ACK', response);
        if (ack) ack(response);
      } catch (error) {
        const response = {
          type: 'ERROR',
          code: 'HELLO_INVALID',
          message: error instanceof Error ? error.message : 'Invalid HELLO payload',
          retryable: false,
          server_time: new Date().toISOString(),
        };
        socket.emit('ERROR', response);
        if (ack) ack(response);
      }
    });

    socket.on('PING', (payload: unknown, ack?: (result: unknown) => void) => {
      const response = {
        type: 'PONG',
        server_time: new Date().toISOString(),
        echo: payload ?? null,
      };
      socket.emit('PONG', response);
      if (ack) ack(response);
    });

    socket.on('disconnect', () => {
      deviceConnectionRegistry.unregisterSocket(socket.id);
    });
  });

  fastify.addHook('onClose', async () => {
    deviceConnectionRegistry.clear();
  });

  (fastify as any)._deviceRealtimeGatewayReady = true;
}

export function sendDeviceNotification(deviceId: string, type: 'COMMAND_AVAILABLE' | 'RESYNC_REQUIRED' | 'SERVER_TIME', payload: unknown) {
  const message = {
    ...(payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}),
    type,
    device_id: deviceId,
    sent_at: new Date().toISOString(),
  };
  assertNotificationPayloadAllowed(message);
  return deviceConnectionRegistry.emitToDevice(deviceId, type, message);
}
