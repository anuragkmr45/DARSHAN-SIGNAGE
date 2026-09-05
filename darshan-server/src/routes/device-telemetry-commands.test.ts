import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';

const { queueHeartbeatTelemetryMock } = vi.hoisted(() => ({
  queueHeartbeatTelemetryMock: vi.fn(),
}));

vi.mock('@/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/jobs')>('@/jobs');
  return {
    ...actual,
    queueHeartbeatTelemetry: queueHeartbeatTelemetryMock,
  };
});

import { createTestServer, closeTestServer, generateTestToken, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';

describe('device telemetry command claiming', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  beforeEach(() => {
    queueHeartbeatTelemetryMock.mockReset();
    queueHeartbeatTelemetryMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  async function seedCommandTarget(
    commandOverrides: Partial<typeof schema.deviceCommands.$inferInsert> = {}
  ) {
    const db = getDatabase();
    const deviceId = randomUUID();
    const serial = `serial-${randomUUID()}`;

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Command Claim Screen',
      status: 'OFFLINE',
    });

    await db.insert(schema.deviceCertificates).values({
      screen_id: deviceId,
      serial,
      certificate_pem: 'dummy-cert',
      expires_at: new Date(Date.now() + 60_000),
    });

    const [command] = await db
      .insert(schema.deviceCommands)
      .values({
        screen_id: deviceId,
        type: 'REFRESH',
        status: 'PENDING',
        payload: { reason: 'claim-test' },
        created_by: testUser.id,
        ...commandOverrides,
      })
      .returning();

    return { db, deviceId, serial, commandId: command.id };
  }

  async function expireLease(commandId: string) {
    const db = getDatabase();
    const staleClaimedAt = new Date(Date.now() - 61_000);

    await db
      .update(schema.deviceCommands)
      .set({
        status: 'SENT',
        claimed_at: staleClaimedAt,
        lease_expires_at: staleClaimedAt,
        updated_at: staleClaimedAt,
        acknowledged_at: null,
      })
      .where(eq(schema.deviceCommands.id, commandId));
  }

  it('claims commands from heartbeat so a follow-up poll does not redeliver them', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget();

    const heartbeatResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/device/heartbeat',
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        device_id: deviceId,
        status: 'ONLINE',
        uptime: 100,
        memory_usage: 10,
        cpu_usage: 5,
      },
    });

    expect(heartbeatResponse.statusCode).toBe(HTTP_STATUS.OK);
    const heartbeatBody = JSON.parse(heartbeatResponse.body);
    expect(heartbeatBody.commands).toHaveLength(1);
    expect(heartbeatBody.commands[0].id).toBe(commandId);

    const followUpPoll = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(followUpPoll.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(followUpPoll.body)).toEqual({ commands: [] });

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('SENT');
  });

  it('claims commands from polling so a follow-up heartbeat does not redeliver them', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget();

    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);
    const pollBody = JSON.parse(pollResponse.body);
    expect(pollBody.commands).toHaveLength(1);
    expect(pollBody.commands[0].id).toBe(commandId);

    const followUpHeartbeat = await server.inject({
      method: 'POST',
      url: '/api/v1/device/heartbeat',
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        device_id: deviceId,
        status: 'ONLINE',
        uptime: 100,
        memory_usage: 10,
        cpu_usage: 5,
      },
    });

    expect(followUpHeartbeat.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(followUpHeartbeat.body).commands).toEqual([]);

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('SENT');
  });

  it('claims higher priority commands first', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget({ priority: 0 });
    const [critical] = await db
      .insert(schema.deviceCommands)
      .values({
        screen_id: deviceId,
        type: 'PING',
        status: 'PENDING',
        payload: { reason: 'priority-test' },
        priority: 100,
        created_by: testUser.id,
      })
      .returning();

    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);
    const commands = JSON.parse(pollResponse.body).commands;
    expect(commands.map((command: { id: string }) => command.id)).toEqual([critical.id, commandId]);
  });

  it('marks expired commands without delivering them', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget({
      expires_at: new Date(Date.now() - 1000),
    });

    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(pollResponse.body).commands).toEqual([]);

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('EXPIRED');
    expect(stored?.last_error).toBe('Command expired before delivery');
  });

  it('dead-letters commands that already exhausted max attempts', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget({
      attempt_count: 1,
      delivery_attempts: 1,
      max_attempts: 1,
    });

    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(pollResponse.body).commands).toEqual([]);

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('DEAD_LETTER');
    expect(stored?.dead_lettered_at).toBeTruthy();
  });

  it('does not double-claim a command when heartbeat and poll race each other', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget();

    const [heartbeatResponse, pollResponse] = await Promise.all([
      server.inject({
        method: 'POST',
        url: '/api/v1/device/heartbeat',
        headers: {
          'x-device-serial': serial,
        },
        payload: {
          device_id: deviceId,
          status: 'ONLINE',
          uptime: 100,
          memory_usage: 10,
          cpu_usage: 5,
        },
      }),
      server.inject({
        method: 'GET',
        url: `/api/v1/device/${deviceId}/commands`,
        headers: {
          'x-device-serial': serial,
        },
      }),
    ]);

    expect(heartbeatResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);

    const heartbeatCommands = JSON.parse(heartbeatResponse.body).commands ?? [];
    const polledCommands = JSON.parse(pollResponse.body).commands ?? [];
    const deliveredIds = [...heartbeatCommands, ...polledCommands].map(
      (command: { id: string }) => command.id
    );

    expect(deliveredIds).toEqual([commandId]);

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('SENT');
    expect(stored?.delivery_token).toBeTruthy();
    expect(stored?.delivery_attempts).toBe(1);
  });

  it('requires the matching delivery token to acknowledge a leased command', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget();

    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);
    const claimedCommand = JSON.parse(pollResponse.body).commands[0];
    expect(claimedCommand.delivery_token).toBeTruthy();

    const missingTokenAck = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {},
    });

    expect(missingTokenAck.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

    const matchedAck = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        delivery_token: claimedCommand.delivery_token,
        success: true,
        message: 'Refresh applied',
      },
    });

    expect(matchedAck.statusCode).toBe(HTTP_STATUS.OK);

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('COMPLETED');
    expect(stored?.acknowledged_at).toBeTruthy();
    expect((stored?.payload as Record<string, any>)?.execution_result).toMatchObject({
      success: true,
      error: null,
      message: 'Refresh applied',
    });
    expect(stored?.result_payload).toMatchObject({
      success: true,
      error: null,
      message: 'Refresh applied',
    });
  });

  it('reclaims stale leases and rejects stale or tokenless acknowledgements', async () => {
    const { db, deviceId, serial, commandId } = await seedCommandTarget();

    const initialClaim = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });

    expect(initialClaim.statusCode).toBe(HTTP_STATUS.OK);
    const initiallyLeasedCommand = JSON.parse(initialClaim.body).commands[0];
    expect(initiallyLeasedCommand.delivery_token).toBeTruthy();

    await expireLease(commandId);

    const reclaimedClaim = await server.inject({
      method: 'POST',
      url: '/api/v1/device/heartbeat',
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        device_id: deviceId,
        status: 'ONLINE',
        uptime: 100,
        memory_usage: 10,
        cpu_usage: 5,
      },
    });

    expect(reclaimedClaim.statusCode).toBe(HTTP_STATUS.OK);
    const reclaimedCommand = JSON.parse(reclaimedClaim.body).commands[0];
    expect(reclaimedCommand.id).toBe(commandId);
    expect(reclaimedCommand.delivery_token).toBeTruthy();
    expect(reclaimedCommand.delivery_token).not.toBe(initiallyLeasedCommand.delivery_token);

    const tokenlessAck = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {},
    });
    expect(tokenlessAck.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

    const staleTokenAck = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        delivery_token: initiallyLeasedCommand.delivery_token,
      },
    });
    expect(staleTokenAck.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

    const matchingAck = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        delivery_token: reclaimedCommand.delivery_token,
        success: false,
        error: 'Command rate-limited locally',
      },
    });
    expect(matchingAck.statusCode).toBe(HTTP_STATUS.OK);

    const duplicateAck = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        delivery_token: reclaimedCommand.delivery_token,
      },
    });
    expect(duplicateAck.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(duplicateAck.body)).toMatchObject({
      success: true,
      already_acknowledged: true,
    });

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));
    expect(stored?.status).toBe('FAILED');
    expect(stored?.delivery_attempts).toBe(2);
    expect(stored?.acknowledged_at).toBeTruthy();
    expect((stored?.payload as Record<string, any>)?.execution_result).toMatchObject({
      success: false,
      error: 'Command rate-limited locally',
      message: null,
    });
    expect(stored?.last_error).toBe('Command rate-limited locally');
    expect(stored?.result_payload).toMatchObject({
      success: false,
      error: 'Command rate-limited locally',
      message: null,
    });
  });

  it('rolls back a leased update when the transaction fails before commit', async () => {
    const { db, deviceId, commandId } = await seedCommandTarget();
    const deliveryToken = randomUUID();
    const claimedAt = new Date();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT id
          FROM device_commands
          WHERE screen_id = ${deviceId}
            AND status = 'PENDING'
          FOR UPDATE SKIP LOCKED
        `);

        await tx
          .update(schema.deviceCommands)
          .set({
            status: 'SENT',
            delivery_token: deliveryToken,
            claimed_at: claimedAt,
            updated_at: claimedAt,
            delivery_attempts: sql`${schema.deviceCommands.delivery_attempts} + 1`,
          })
          .where(eq(schema.deviceCommands.id, commandId));

        throw new Error('rollback-probe');
      })
    ).rejects.toThrow('rollback-probe');

    const [stored] = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.id, commandId));

    expect(stored?.status).toBe('PENDING');
    expect(stored?.delivery_token).toBeNull();
    expect(stored?.claimed_at).toBeNull();
    expect(stored?.delivery_attempts).toBe(0);
  });

  it('accepts all command types handled by the Electron player through the admin command route', async () => {
    const { db, deviceId } = await seedCommandTarget();
    await db.delete(schema.deviceCommands).where(eq(schema.deviceCommands.screen_id, deviceId));
    const adminToken = await generateTestToken(testUser.id, 'ADMIN');
    const commandTypes = [
      'REBOOT',
      'REFRESH',
      'TEST_PATTERN',
      'TAKE_SCREENSHOT',
      'SET_SCREENSHOT_INTERVAL',
      'REFRESH_SCHEDULE',
      'SCREENSHOT',
      'CLEAR_CACHE',
      'PING',
      'RESYNC',
    ];

    for (const type of commandTypes) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/device/${deviceId}/commands`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          type,
          payload: { reason: 'compatibility-test' },
        },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
    }

    const rows = await db
      .select()
      .from(schema.deviceCommands)
      .where(eq(schema.deviceCommands.screen_id, deviceId));
    expect(rows.map((row) => row.type).sort()).toEqual(commandTypes.sort());
    expect(rows.every((row) => row.expires_at)).toBe(true);
  });

  it('lists recent command lifecycle state for a screen', async () => {
    const { deviceId, serial, commandId } = await seedCommandTarget({
      priority: 50,
      expires_at: new Date(Date.now() + 60_000),
    });
    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });
    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);

    const adminToken = await generateTestToken(testUser.id, 'ADMIN');
    const recentResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screens/${deviceId}/commands/recent?limit=10`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(recentResponse.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(recentResponse.body);
    expect(body.screen_id).toBe(deviceId);
    expect(body.commands[0]).toMatchObject({
      id: commandId,
      status: 'SENT',
      lifecycle_status: 'LEASED',
      priority: 50,
      attempt_count: 1,
    });
    expect(body.commands[0].status_history.length).toBeGreaterThan(0);
  });

  it('returns aggregated delivery status for CMS screen details', async () => {
    const { db, deviceId, serial } = await seedCommandTarget();
    await db.delete(schema.deviceCommands).where(eq(schema.deviceCommands.screen_id, deviceId));
    const adminToken = await generateTestToken(testUser.id, 'ADMIN');

    const createResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        type: 'RESYNC',
        payload: { reason: 'EMERGENCY_START' },
        priority: 75,
        desired_emergency_version: 'emergency-v1',
      },
    });
    expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const commandId = JSON.parse(createResponse.body).id;

    const pollResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        'x-device-serial': serial,
      },
    });
    expect(pollResponse.statusCode).toBe(HTTP_STATUS.OK);
    const claimedCommand = JSON.parse(pollResponse.body).commands[0];

    const ackResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands/${commandId}/ack`,
      headers: {
        'x-device-serial': serial,
      },
      payload: {
        delivery_token: claimedCommand.delivery_token,
        success: false,
        error: 'phase-5-delivery-test',
        result_payload: { source: 'delivery-status-test' },
      },
    });
    expect(ackResponse.statusCode).toBe(HTTP_STATUS.OK);

    const statusResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/screens/${deviceId}/delivery-status?limit=10`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(statusResponse.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(statusResponse.body);
    expect(body.screen_id).toBe(deviceId);
    expect(body.desired_state).toMatchObject({
      screen_id: deviceId,
      emergency_version: 'emergency-v1',
      last_command_id: commandId,
      last_command_type: 'RESYNC',
    });
    expect(body.commands).toMatchObject({
      total: 1,
      failed: 1,
    });
    expect(body.commands.by_lifecycle.ACKED_FAILURE).toBe(1);
    expect(body.commands.recent[0]).toMatchObject({
      id: commandId,
      lifecycle_status: 'ACKED_FAILURE',
      last_error: 'phase-5-delivery-test',
    });
    expect(body.outbox.total).toBe(1);
    expect(body.emergency.delivery.total_recent).toBe(1);
  });

  it('writes desired state and outbox atomically when creating a command through the admin route', async () => {
    const { db, deviceId, serial } = await seedCommandTarget();
    await db.delete(schema.deviceCommands).where(eq(schema.deviceCommands.screen_id, deviceId));
    const adminToken = await generateTestToken(testUser.id, 'ADMIN');
    const snapshotId = randomUUID();

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/device/${deviceId}/commands`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        type: 'RESYNC',
        payload: { reason: 'DESIRED_STATE_RESYNC' },
        desired_snapshot_id: snapshotId,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
    const commandId = JSON.parse(response.body).id;

    const [state] = await db
      .select()
      .from(schema.deviceDesiredState)
      .where(eq(schema.deviceDesiredState.screen_id, deviceId));
    expect(state).toMatchObject({
      screen_id: deviceId,
      snapshot_id: snapshotId,
      command_version: 1,
      state_version: 1,
      last_command_id: commandId,
      last_command_type: 'RESYNC',
      last_command_reason: 'DESIRED_STATE_RESYNC',
    });

    const outboxRows = await db
      .select()
      .from(schema.commandOutbox)
      .where(eq(schema.commandOutbox.command_id, commandId));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({
      screen_id: deviceId,
      event_type: 'COMMAND_AVAILABLE',
      status: 'PENDING',
      reason: 'DESIRED_STATE_RESYNC',
    });

    const desiredStateResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/device/${deviceId}/desired-state`,
      headers: {
        'x-device-serial': serial,
      },
    });
    expect(desiredStateResponse.statusCode).toBe(HTTP_STATUS.OK);
    const desiredStateBody = JSON.parse(desiredStateResponse.body);
    expect(desiredStateBody).toMatchObject({
      device_id: deviceId,
      state: {
        state_version: 1,
        command_version: 1,
        snapshot_id: snapshotId,
        last_command_id: commandId,
        last_command_type: 'RESYNC',
      },
    });
    expect(desiredStateBody.resources.commands).toBe(`/api/v1/device/${deviceId}/commands`);
  });
});
