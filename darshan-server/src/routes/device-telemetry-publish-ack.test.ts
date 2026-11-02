import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const { queueHeartbeatTelemetryMock } = vi.hoisted(() => ({
  queueHeartbeatTelemetryMock: vi.fn(),
}));

vi.mock('@/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/jobs')>('@/jobs');
  return { ...actual, queueHeartbeatTelemetry: queueHeartbeatTelemetryMock };
});
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';

async function applyMigration(filename: string) {
  const content = await readFile(path.resolve(process.cwd(), 'drizzle', 'migrations', filename), 'utf8');
  for (const statement of content.split('--> statement-breakpoint').map((value) => value.trim()).filter(Boolean)) {
    await getDatabase().execute(sql.raw(statement));
  }
}

async function ensureDeliveryColumns() {
  const availability = await getDatabase().execute<{ exists: boolean }>(sql`
    SELECT to_regclass('public.screen_availability_intervals') IS NOT NULL AS exists
  `);
  if (!availability.rows[0]?.exists) await applyMigration('0052_screen_availability_history.sql');
  const result = await getDatabase().execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'publish_targets' AND column_name = 'applied_at'
    ) AS exists
  `);
  if (!result.rows[0]?.exists) await applyMigration('0053_publish_delivery_evidence.sql');
}

function heartbeat(deviceId: string, applied?: { publishId: string; snapshotId: string }) {
  return {
    device_id: deviceId,
    status: 'ONLINE',
    uptime: 120,
    memory_usage: 20,
    cpu_usage: 5,
    ...(applied ? {
      applied_publish_id: applied.publishId,
      applied_snapshot_id: applied.snapshotId,
    } : {}),
  };
}

describe('device publish delivery acknowledgement', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;

  beforeAll(async () => {
    server = await createTestServer();
    await ensureDeliveryColumns();
  });

  beforeEach(() => {
    queueHeartbeatTelemetryMock.mockReset();
    queueHeartbeatTelemetryMock.mockResolvedValue('heartbeat-job');
  });

  afterAll(async () => closeTestServer(server));

  it('marks exact concrete targets applied and derives group success only after every fixed member applies', async () => {
    const db = getDatabase();
    const firstScreenId = randomUUID();
    const secondScreenId = randomUUID();
    const firstSerial = `serial-${randomUUID()}`;
    const secondSerial = `serial-${randomUUID()}`;
    const groupId = randomUUID();
    const scheduleId = randomUUID();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const now = Date.now();

    await db.insert(schema.screens).values([
      { id: firstScreenId, name: 'Delivery one', status: 'ACTIVE' },
      { id: secondScreenId, name: 'Delivery two', status: 'ACTIVE' },
    ]);
    await db.insert(schema.deviceCertificates).values([
      { screen_id: firstScreenId, serial: firstSerial, certificate_pem: 'test', expires_at: new Date(now + 60_000) },
      { screen_id: secondScreenId, serial: secondSerial, certificate_pem: 'test', expires_at: new Date(now + 60_000) },
    ]);
    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Fixed delivery group' });
    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: 'Future delivery',
      start_at: new Date(now + 60 * 60 * 1000),
      end_at: new Date(now + 2 * 60 * 60 * 1000),
      is_active: true,
      created_by: testUser.id,
    });
    await db.insert(schema.scheduleSnapshots).values({ id: snapshotId, schedule_id: scheduleId, payload: {} });
    await db.insert(schema.publishes).values({
      id: publishId, schedule_id: scheduleId, snapshot_id: snapshotId, published_by: testUser.id,
    });
    await db.insert(schema.publishTargets).values([
      { publish_id: publishId, screen_id: firstScreenId },
      { publish_id: publishId, screen_id: secondScreenId },
      { publish_id: publishId, screen_group_id: groupId, resolved_screen_ids: [firstScreenId, secondScreenId] },
    ]);

    const first = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat',
      headers: { 'x-device-serial': firstSerial },
      payload: heartbeat(firstScreenId, { publishId, snapshotId }),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().publish_delivery_ack).toMatchObject({ status: 'APPLIED', publish_id: publishId, snapshot_id: snapshotId });

    let targets = await db.select().from(schema.publishTargets).where(eq(schema.publishTargets.publish_id, publishId));
    expect(targets.find((target) => target.screen_id === firstScreenId)?.status).toBe('SUCCESS');
    expect(targets.find((target) => target.screen_group_id === groupId)?.status).toBe('PENDING');

    const second = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat',
      headers: { 'x-device-serial': secondSerial },
      payload: heartbeat(secondScreenId, { publishId, snapshotId }),
    });
    expect(second.statusCode).toBe(200);
    targets = await db.select().from(schema.publishTargets).where(eq(schema.publishTargets.publish_id, publishId));
    expect(targets.filter((target) => target.status === 'SUCCESS')).toHaveLength(3);
    expect(targets.every((target) => target.applied_at instanceof Date)).toBe(true);
    const secondAppliedAt = targets.find((target) => target.screen_id === secondScreenId)?.applied_at;

    const duplicate = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat',
      headers: { 'x-device-serial': secondSerial },
      payload: heartbeat(secondScreenId, { publishId, snapshotId }),
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().publish_delivery_ack.status).toBe('APPLIED');
    targets = await db.select().from(schema.publishTargets).where(eq(schema.publishTargets.publish_id, publishId));
    expect(targets.find((target) => target.screen_id === secondScreenId)?.applied_at).toEqual(secondAppliedAt);
    expect(duplicate.json().publish_delivery_ack.applied_at).toBe(secondAppliedAt?.toISOString());
  });

  it('rejects a mismatched snapshot without changing its target and keeps legacy heartbeats valid', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const serial = `serial-${randomUUID()}`;
    const scheduleId = randomUUID();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const now = Date.now();

    await db.insert(schema.screens).values({ id: screenId, name: 'Rejected delivery', status: 'ACTIVE' });
    await db.insert(schema.deviceCertificates).values({
      screen_id: screenId, serial, certificate_pem: 'test', expires_at: new Date(now + 60_000),
    });
    await db.insert(schema.schedules).values({
      id: scheduleId, name: 'Mismatch', start_at: new Date(now - 60_000), end_at: new Date(now + 60_000),
      created_by: testUser.id,
    });
    await db.insert(schema.scheduleSnapshots).values({ id: snapshotId, schedule_id: scheduleId, payload: {} });
    await db.insert(schema.publishes).values({
      id: publishId, schedule_id: scheduleId, snapshot_id: snapshotId, published_by: testUser.id,
    });
    await db.insert(schema.publishTargets).values({ publish_id: publishId, screen_id: screenId });

    const rejected = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat', headers: { 'x-device-serial': serial },
      payload: heartbeat(screenId, { publishId, snapshotId: randomUUID() }),
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().publish_delivery_ack).toMatchObject({ status: 'REJECTED', reason: 'SNAPSHOT_MISMATCH' });
    const [target] = await db.select().from(schema.publishTargets).where(eq(schema.publishTargets.publish_id, publishId));
    expect(target.status).toBe('PENDING');
    expect(target.applied_at).toBeNull();

    const outsiderId = randomUUID();
    const outsiderSerial = `serial-${randomUUID()}`;
    await db.insert(schema.screens).values({ id: outsiderId, name: 'Untargeted delivery', status: 'ACTIVE' });
    await db.insert(schema.deviceCertificates).values({
      screen_id: outsiderId, serial: outsiderSerial, certificate_pem: 'test', expires_at: new Date(now + 60_000),
    });
    const untargeted = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat', headers: { 'x-device-serial': outsiderSerial },
      payload: heartbeat(outsiderId, { publishId, snapshotId }),
    });
    expect(untargeted.statusCode).toBe(200);
    expect(untargeted.json().publish_delivery_ack).toMatchObject({ status: 'REJECTED', reason: 'SCREEN_NOT_TARGETED' });

    await db.update(schema.publishes).set({ status: 'TAKEN_DOWN', taken_down_at: new Date() })
      .where(eq(schema.publishes.id, publishId));
    const takenDown = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat', headers: { 'x-device-serial': serial },
      payload: heartbeat(screenId, { publishId, snapshotId }),
    });
    expect(takenDown.statusCode).toBe(200);
    expect(takenDown.json().publish_delivery_ack).toMatchObject({ status: 'REJECTED', reason: 'PUBLISH_NOT_ACTIVE' });

    const legacy = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat', headers: { 'x-device-serial': serial },
      payload: heartbeat(screenId),
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().publish_delivery_ack).toBeNull();

    const incomplete = await server.inject({
      method: 'POST', url: '/api/v1/device/heartbeat', headers: { 'x-device-serial': serial },
      payload: { ...heartbeat(screenId), applied_publish_id: publishId },
    });
    expect(incomplete.statusCode).toBe(422);
  });
});
