import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import { prepareDeviceIdentitySessionObservation } from '@/services/device-identity-session-service';
import type { DisplayProfileV1 } from '@/utils/display-profile';

const putObjectMock = vi.fn();

vi.mock('@/s3', async () => {
  const actual = await vi.importActual<typeof import('@/s3')>('@/s3');
  return {
    ...actual,
    putObject: putObjectMock,
  };
});

const {
  buildHeartbeatObjectKey,
  buildProofOfPlayIdempotencyKey,
  buildProofOfPlayObjectKey,
  processHeartbeatTelemetry,
  processProofOfPlayTelemetry,
  processScreenshotTelemetry,
} = await import('@/jobs/device-telemetry');

async function applyMigrationFile(filename: string) {
  const db = getDatabase();
  const migrationPath = path.resolve(process.cwd(), 'drizzle', 'migrations', filename);
  const content = await readFile(migrationPath, 'utf8');
  const statements = content
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function proofOfPlayIdempotencyColumnExists() {
  const db = getDatabase();
  const result = await db.execute<{ exists: boolean }>(
    sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'proof_of_play'
          AND column_name = 'idempotency_key'
      ) AS exists
    `
  );
  return Boolean((result.rows[0] as { exists?: boolean } | undefined)?.exists);
}

function displayProfile(input: {
  sessionId: string;
  sequence: number;
  observedAt: string;
  width: number;
}): DisplayProfileV1 {
  const output = {
    key: 'platform:1',
    electron_id: '1',
    identity_confidence: 'PLATFORM' as const,
    label: 'Display 1',
    detected: true,
    internal: false,
    primary: true,
    bounds_dip: { x: 0, y: 0, width: input.width, height: 1080 },
    work_area_dip: { x: 0, y: 0, width: input.width, height: 1040 },
    scale_factor: 1,
    estimated_backing_px: { width: input.width, height: 1080 },
    native_mode_px: null,
    rotation_degrees: 0,
    refresh_rate_hz: 60,
    orientation: 'LANDSCAPE' as const,
    aspect: {
      exact_key: `${input.width}:1080`,
      numeric_value: input.width / 1080,
      match_key: `${input.width}:1080`,
      relative_error: 0,
      normalizer_version: 1 as const,
    },
  };
  return {
    schema_version: 1,
    runtime_session_id: input.sessionId,
    observation_seq: input.sequence,
    observed_at: input.observedAt,
    selection: {
      mode: 'PRIMARY',
      preferred_key: null,
      active_key: output.key,
      fallback_used: false,
      fallback_reason: null,
    },
    placement: 'VERIFIED',
    output,
    inventory: [output],
    viewport: null,
  };
}

describe('device telemetry persistence workers', () => {
  beforeAll(async () => {
    await initializeDatabase();
    if (!(await proofOfPlayIdempotencyColumnExists())) {
      await applyMigrationFile('0026_telemetry_async_persistence.sql');
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    putObjectMock.mockReset();
    putObjectMock.mockResolvedValue({ etag: 'etag-test', sha256: 'sha-test' });
  });

  it('uses the selected document page in proof-of-play idempotency', () => {
    const base = {
      deviceId: randomUUID(),
      mediaId: randomUUID(),
      scheduleId: randomUUID(),
      startTime: new Date(Date.now() - 15_000).toISOString(),
      endTime: new Date().toISOString(),
      duration: 15,
      completed: true,
    };

    expect(buildProofOfPlayIdempotencyKey({ ...base, pageNumber: 1 })).not.toBe(
      buildProofOfPlayIdempotencyKey({ ...base, pageNumber: 2 })
    );
  });

  it('deduplicates proof-of-play duplicate delivery by idempotency key', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const mediaId = randomUUID();
    const scheduleId = randomUUID();
    const startTime = new Date(Date.now() - 15_000).toISOString();
    const endTime = new Date().toISOString();
    const idempotencyKey = buildProofOfPlayIdempotencyKey({
      deviceId,
      mediaId,
      scheduleId,
      startTime,
      endTime,
      duration: 15,
      completed: true,
    });

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'PoP Worker Device',
      status: 'ACTIVE',
    });

    const job = {
      deviceId,
      mediaId,
      scheduleId,
      startTime,
      endTime,
      duration: 15,
      completed: true,
      receivedAt: new Date().toISOString(),
      idempotencyKey,
      objectKey: buildProofOfPlayObjectKey(deviceId, idempotencyKey),
    };

    await processProofOfPlayTelemetry(job);
    await processProofOfPlayTelemetry(job);

    const rows = await db
      .select()
      .from(schema.proofOfPlay)
      .where(eq(schema.proofOfPlay.idempotency_key, idempotencyKey));

    expect(rows).toHaveLength(1);
    expect(putObjectMock).toHaveBeenCalledOnce();
  });

  it('treats heartbeat worker retries as idempotent for a queued event', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const receivedAt = new Date().toISOString();
    const storageObjectId = randomUUID();

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Heartbeat Worker Device',
      status: 'ACTIVE',
    });

    const payload = {
      device_id: deviceId,
      status: 'ONLINE',
      uptime: 120,
      memory_usage: 20,
      cpu_usage: 10,
    };
    const job = {
      deviceId,
      status: 'ONLINE' as const,
      payload,
      receivedAt,
      objectKey: buildHeartbeatObjectKey(deviceId, receivedAt, storageObjectId, payload),
      storageObjectId,
    };

    await processHeartbeatTelemetry(job);
    await processHeartbeatTelemetry(job);

    const rows = await db
      .select()
      .from(schema.heartbeats)
      .where(eq(schema.heartbeats.storage_object_id, storageObjectId));

    expect(rows).toHaveLength(1);
    expect(putObjectMock).toHaveBeenCalledOnce();
  });

  it('persists distinct same-millisecond heartbeat events without object-key collisions', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const receivedAt = new Date().toISOString();
    const firstStorageObjectId = randomUUID();
    const secondStorageObjectId = randomUUID();
    const payload = { device_id: deviceId, status: 'ONLINE' };

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Same-millisecond Heartbeat Worker Device',
      status: 'ACTIVE',
    });

    const makeJob = (storageObjectId: string) => ({
      deviceId,
      status: 'ONLINE' as const,
      payload,
      receivedAt,
      storageObjectId,
      objectKey: buildHeartbeatObjectKey(deviceId, receivedAt, storageObjectId, payload),
    });
    const first = makeJob(firstStorageObjectId);
    const second = makeJob(secondStorageObjectId);

    expect(first.objectKey).not.toBe(second.objectKey);
    await processHeartbeatTelemetry(first);
    await processHeartbeatTelemetry(second);
    await processHeartbeatTelemetry(first);
    await processHeartbeatTelemetry(second);

    const rows = await db
      .select()
      .from(schema.heartbeats)
      .where(inArray(schema.heartbeats.storage_object_id, [firstStorageObjectId, secondStorageObjectId]));

    expect(rows).toHaveLength(2);
    expect(putObjectMock).toHaveBeenCalledTimes(2);
  });

  it('does not let delayed or replayed heartbeat observations roll device state backwards', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const runtimeSessionId = randomUUID();
    const newerReceivedAt = new Date().toISOString();
    const olderReceivedAt = new Date(Date.parse(newerReceivedAt) - 60_000).toISOString();

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Out-of-order heartbeat worker device',
      status: 'OFFLINE',
    });

    const job = (input: {
      receivedAt: string;
      storageObjectId: string;
      status: 'ONLINE' | 'OFFLINE';
      mediaId: string;
      sequence: number;
      width: number;
      playerVersion: string;
    }) => ({
      deviceId,
      status: input.status,
      payload: { device_id: deviceId, status: input.status },
      receivedAt: input.receivedAt,
      objectKey: buildHeartbeatObjectKey(
        deviceId,
        input.receivedAt,
        input.storageObjectId,
        { status: input.status }
      ),
      storageObjectId: input.storageObjectId,
      screenObservation: {
        status: input.status === 'ONLINE' ? 'ACTIVE' as const : 'OFFLINE' as const,
        currentScheduleId: null,
        currentMediaId: input.mediaId,
        currentSceneId: null,
        activeSlots: [],
      },
      identityObservation: prepareDeviceIdentitySessionObservation({
        deviceId,
        source: 'heartbeat',
        runtimeSessionId,
        playerVersion: input.playerVersion,
        now: new Date(input.receivedAt),
      }),
      displayProfile: displayProfile({
        sessionId: runtimeSessionId,
        sequence: input.sequence,
        observedAt: input.receivedAt,
        width: input.width,
      }),
    });
    const newerMediaId = randomUUID();
    const olderMediaId = randomUUID();
    const newer = job({
      receivedAt: newerReceivedAt,
      storageObjectId: randomUUID(),
      status: 'ONLINE',
      mediaId: newerMediaId,
      sequence: 2,
      width: 1920,
      playerVersion: '2.0.0',
    });
    const older = job({
      receivedAt: olderReceivedAt,
      storageObjectId: randomUUID(),
      status: 'OFFLINE',
      mediaId: olderMediaId,
      sequence: 1,
      width: 1280,
      playerVersion: '1.0.0',
    });

    await processHeartbeatTelemetry(newer);
    await processHeartbeatTelemetry(older);
    await processHeartbeatTelemetry(newer);

    const [screen] = await db.select().from(schema.screens).where(eq(schema.screens.id, deviceId));
    const [display] = await db
      .select()
      .from(schema.screenDisplayStates)
      .where(eq(schema.screenDisplayStates.screen_id, deviceId));
    const identitySessions = (screen.device_info as any)?.identity_sessions?.sessions ?? [];

    expect(screen).toMatchObject({
      status: 'ACTIVE',
      current_media_id: newerMediaId,
      width: 1920,
    });
    expect(screen.last_heartbeat_at?.toISOString()).toBe(newerReceivedAt);
    expect(display).toMatchObject({ observation_seq: 2, observed_at: new Date(newerReceivedAt) });
    expect(identitySessions[0]).toMatchObject({
      playerVersion: '2.0.0',
      lastSeenAt: newerReceivedAt,
    });
    expect(putObjectMock).toHaveBeenCalledTimes(2);
  });

  it('treats screenshot worker retries as idempotent for a queued event', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const storageObjectId = randomUUID();
    const timestamp = new Date().toISOString();
    const objectKey = `device-screenshots/${deviceId}/${Date.parse(timestamp)}-${storageObjectId}.png`;

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'Screenshot Worker Device',
      status: 'ACTIVE',
    });

    const job = {
      deviceId,
      timestamp,
      imageData: Buffer.from('retry-safe-image').toString('base64'),
      objectKey,
      storageObjectId,
    };

    await processScreenshotTelemetry(job);
    await processScreenshotTelemetry(job);

    const rows = await db
      .select()
      .from(schema.screenshots)
      .where(eq(schema.screenshots.storage_object_id, storageObjectId));

    expect(rows).toHaveLength(1);
    expect(putObjectMock).toHaveBeenCalledOnce();
  });
});
