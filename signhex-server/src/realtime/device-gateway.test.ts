import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { FastifyInstance } from 'fastify';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { setupDeviceRealtimeGateway } from '@/realtime/device-gateway';
import { deviceConnectionRegistry } from '@/realtime/device-connection-registry';
import { dispatchPendingCommandOutboxBatch } from '@/services/outbox-dispatcher';

function waitForSocketConnect(socket: ClientSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 5000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
  });
}

async function seedDevice() {
  const db = getDatabase();
  const deviceId = randomUUID();
  const serial = `device-ws-${randomUUID()}`;

  await db.insert(schema.screens).values({
    id: deviceId,
    name: 'Realtime Device',
    status: 'OFFLINE',
  });

  await db.insert(schema.deviceCertificates).values({
    screen_id: deviceId,
    serial,
    certificate_pem: 'test-cert',
    is_revoked: false,
    expires_at: new Date(Date.now() + 60_000),
  });

  return { db, deviceId, serial };
}

describe('device realtime gateway and outbox dispatcher', () => {
  let server: FastifyInstance;
  let baseUrl: string;
  let socket: ClientSocket | null = null;

  beforeAll(async () => {
    server = await createTestServer();
    setupDeviceRealtimeGateway(server, { force: true });
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db.delete(schema.commandOutbox);
  });

  afterEach(() => {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
    deviceConnectionRegistry.clear();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('authenticates a device socket and completes HELLO negotiation', async () => {
    const { deviceId, serial } = await seedDevice();

    socket = createClient(`${baseUrl}/device`, {
      transports: ['websocket'],
      auth: {
        device_id: deviceId,
        device_serial: serial,
      },
      reconnection: false,
      forceNew: true,
    });

    await waitForSocketConnect(socket);
    const ack = await new Promise<any>((resolve) => {
      socket!.emit(
        'HELLO',
        {
          type: 'HELLO',
          protocol_version: '1.0',
          device_id: deviceId,
          session_id: 'test-session',
          app: { version: 'test' },
          platform: { family: 'electron' },
        },
        resolve
      );
    });

    expect(ack).toMatchObject({
      type: 'HELLO_ACK',
      device_id: deviceId,
      session_id: 'test-session',
      protocol_version: '1.0',
    });
    expect(deviceConnectionRegistry.getConnections(deviceId)).toHaveLength(1);
  });

  it('dispatches command outbox rows as notification-only COMMAND_AVAILABLE messages', async () => {
    const { db, deviceId, serial } = await seedDevice();
    const commandId = randomUUID();
    const stateVersion = 7;

    await db.insert(schema.commandOutbox).values({
      screen_id: deviceId,
      command_id: commandId,
      event_type: 'COMMAND_AVAILABLE',
      reason: 'PUBLISH',
      priority: 10,
      payload: {
        command_id: commandId,
        command_type: 'REFRESH',
        state_version: stateVersion,
        command_version: 3,
      },
      max_attempts: 3,
      created_at: new Date(),
    });

    socket = createClient(`${baseUrl}/device`, {
      transports: ['websocket'],
      auth: {
        device_id: deviceId,
        device_serial: serial,
      },
      reconnection: false,
      forceNew: true,
    });
    await waitForSocketConnect(socket);
    await new Promise<void>((resolve) => {
      socket!.emit('HELLO', { type: 'HELLO', protocol_version: '1.0', device_id: deviceId }, () => resolve());
    });

    const notificationPromise = waitForEvent<any>(socket, 'COMMAND_AVAILABLE');
    const result = await dispatchPendingCommandOutboxBatch({ force: true, batchSize: 10 });
    const notification = await notificationPromise;

    expect(result).toMatchObject({
      skipped: false,
      claimed: 1,
      dispatched: 1,
      deferred: 0,
      failed: 0,
    });
    expect(notification).toMatchObject({
      type: 'COMMAND_AVAILABLE',
      device_id: deviceId,
      state_version: stateVersion,
      command_hint: {
        command_id: commandId,
        command_type: 'REFRESH',
        priority: 10,
        reason: 'PUBLISH',
      },
    });
    expect(notification.snapshot).toBeUndefined();
    expect(notification.media).toBeUndefined();

    const [stored] = await db.select().from(schema.commandOutbox).where(eq(schema.commandOutbox.command_id, commandId));
    expect(stored?.status).toBe('DISPATCHED');
    expect(stored?.dispatched_at).toBeTruthy();
  });

  it('defers outbox rows when the target device is not connected', async () => {
    const { db, deviceId } = await seedDevice();
    const commandId = randomUUID();

    await db.insert(schema.commandOutbox).values({
      screen_id: deviceId,
      command_id: commandId,
      event_type: 'COMMAND_AVAILABLE',
      reason: 'PUBLISH',
      max_attempts: 3,
    });

    const result = await dispatchPendingCommandOutboxBatch({ force: true, batchSize: 10 });
    expect(result).toMatchObject({
      skipped: false,
      claimed: 1,
      dispatched: 0,
      deferred: 1,
      failed: 0,
    });

    const [stored] = await db.select().from(schema.commandOutbox).where(eq(schema.commandOutbox.command_id, commandId));
    expect(stored?.status).toBe('PENDING');
    expect(stored?.attempt_count).toBe(1);
    expect(stored?.next_attempt_at).toBeTruthy();
    expect(stored?.last_error).toBe('No active device realtime connection');
  });

  it('rejects device sockets with mismatched serial credentials', async () => {
    const { deviceId } = await seedDevice();

    const badSocket = createClient(`${baseUrl}/device`, {
      transports: ['websocket'],
      auth: {
        device_id: deviceId,
        device_serial: `wrong-${randomUUID()}`,
      },
      reconnection: false,
      forceNew: true,
    });

    const error = await new Promise<Error>((resolve) => {
      badSocket.once('connect_error', resolve);
    });

    expect(error).toBeTruthy();
    badSocket.disconnect();
  });
});
