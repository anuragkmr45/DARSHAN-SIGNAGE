import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDatabase, getDatabase, getDatabasePool, initializeDatabase, schema } from '@/db';

const putObjectMock = vi.fn();
const deleteObjectMock = vi.fn();

vi.mock('@/s3', async () => {
  const actual = await vi.importActual<typeof import('@/s3')>('@/s3');
  return {
    ...actual,
    putObject: putObjectMock,
    deleteObject: deleteObjectMock,
  };
});

const {
  HEARTBEAT_BUCKET,
  PROOF_OF_PLAY_BUCKET,
  SCREENSHOT_BUCKET,
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

async function screenTelemetryLockTriggersExist() {
  const result = await getDatabase().execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'heartbeats_screen_target_lock',
        'proof_of_play_screen_target_lock',
        'screenshots_screen_target_lock'
      )
  `);
  return Number(result.rows[0]?.count ?? 0) === 3;
}

async function waitForBlockedTelemetryWriters(expected: number, timeoutMs = 5_000) {
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} telemetry writers to block on Screen deletion`);
}

describe('device telemetry persistence workers', () => {
  beforeAll(async () => {
    await initializeDatabase();
    if (!(await proofOfPlayIdempotencyColumnExists())) {
      await applyMigrationFile('0026_telemetry_async_persistence.sql');
    }
    if (!(await screenTelemetryLockTriggersExist())) {
      await applyMigrationFile('0051_screen_telemetry_delete_serialization.sql');
    }
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(() => {
    putObjectMock.mockReset();
    putObjectMock.mockResolvedValue({ etag: 'etag-test', sha256: 'sha-test' });
    deleteObjectMock.mockReset();
    deleteObjectMock.mockResolvedValue(undefined);
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
      completed: false,
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
      completed: false,
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
    expect(rows[0]?.completed).toBe(false);
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
      objectKey: buildHeartbeatObjectKey(deviceId, receivedAt, payload),
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

  it('serializes delete-first telemetry and removes every rejected upload without leaving storage rows', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is not initialized');
    const deletion = await pool.connect();
    const deletedDeviceId = randomUUID();
    const heartbeatStorageObjectId = randomUUID();
    const screenshotStorageObjectId = randomUUID();
    const receivedAt = new Date().toISOString();
    const heartbeatObjectKey = `heartbeats/${deletedDeviceId}/delete-first.json`;
    const popObjectKey = `proof-of-play/${deletedDeviceId}/delete-first.json`;
    const screenshotObjectKey = `device-screenshots/${deletedDeviceId}/delete-first.png`;

    await db.insert(schema.screens).values({ id: deletedDeviceId, name: 'Deletion wins telemetry race' });
    try {
      await deletion.query('BEGIN');
      await deletion.query('SELECT id FROM screens WHERE id = $1 FOR UPDATE', [deletedDeviceId]);

      const outcomesPromise = Promise.allSettled([
        processHeartbeatTelemetry({
          deviceId: deletedDeviceId,
          status: 'ONLINE',
          payload: { device_id: deletedDeviceId },
          receivedAt,
          objectKey: heartbeatObjectKey,
          storageObjectId: heartbeatStorageObjectId,
        }),
        processProofOfPlayTelemetry({
          deviceId: deletedDeviceId,
          mediaId: randomUUID(),
          scheduleId: randomUUID(),
          playbackInstanceId: randomUUID(),
          startTime: receivedAt,
          endTime: receivedAt,
          duration: 0,
          completed: false,
          receivedAt,
          objectKey: popObjectKey,
          idempotencyKey: `delete-first-${randomUUID().replaceAll('-', '')}`,
        }),
        processScreenshotTelemetry({
          deviceId: deletedDeviceId,
          timestamp: receivedAt,
          imageData: Buffer.from('delete-first-image').toString('base64'),
          objectKey: screenshotObjectKey,
          storageObjectId: screenshotStorageObjectId,
        }),
      ]);

      await waitForBlockedTelemetryWriters(3);
      await deletion.query('DELETE FROM screens WHERE id = $1', [deletedDeviceId]);
      await deletion.query('COMMIT');

      const outcomes = await outcomesPromise;
      expect(outcomes).toHaveLength(3);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') {
          expect(String(outcome.reason?.message ?? outcome.reason)).toMatch(/target no longer exists/i);
        }
      }
    } finally {
      await deletion.query('ROLLBACK').catch(() => undefined);
      deletion.release();
    }

    expect(deleteObjectMock.mock.calls).toEqual(expect.arrayContaining([
      [HEARTBEAT_BUCKET, heartbeatObjectKey],
      [PROOF_OF_PLAY_BUCKET, popObjectKey],
      [SCREENSHOT_BUCKET, screenshotObjectKey],
    ]));
    expect(deleteObjectMock).toHaveBeenCalledTimes(3);
    expect(await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, heartbeatStorageObjectId))).toHaveLength(0);
    expect(await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, screenshotStorageObjectId))).toHaveLength(0);
    const proofStorageRows = await db.select().from(schema.storageObjects)
      .where(and(eq(schema.storageObjects.bucket, PROOF_OF_PLAY_BUCKET), eq(schema.storageObjects.object_key, popObjectKey)));
    expect(proofStorageRows).toHaveLength(0);
  });

  it('does not delete the winning proof-of-play object when a concurrent duplicate loses persistence', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is not initialized');
    const winner = await pool.connect();
    const deviceId = randomUUID();
    const storageObjectId = randomUUID();
    const idempotencyKey = `pop-winner-${randomUUID().replaceAll('-', '')}`;
    const objectKey = `proof-of-play/${deviceId}/concurrent-winner.json`;
    const timestamp = new Date().toISOString();
    await db.insert(schema.screens).values({ id: deviceId, name: 'Concurrent PoP winner' });

    try {
      await winner.query('BEGIN');
      await winner.query(
        'INSERT INTO storage_objects (id, bucket, object_key) VALUES ($1, $2, $3)',
        [storageObjectId, PROOF_OF_PLAY_BUCKET, objectKey]
      );
      await winner.query(
        `INSERT INTO proof_of_play (screen_id, started_at, storage_object_id, idempotency_key)
         VALUES ($1, $2, $3, $4)`,
        [deviceId, timestamp, storageObjectId, idempotencyKey]
      );

      const loserOutcomePromise = Promise.allSettled([processProofOfPlayTelemetry({
        deviceId,
        mediaId: randomUUID(),
        scheduleId: randomUUID(),
        playbackInstanceId: randomUUID(),
        startTime: timestamp,
        endTime: timestamp,
        duration: 0,
        completed: false,
        receivedAt: timestamp,
        objectKey,
        idempotencyKey,
      })]);
      await waitForBlockedTelemetryWriters(1);
      await winner.query('COMMIT');

      const [loserOutcome] = await loserOutcomePromise;
      expect(loserOutcome?.status).toBe('rejected');
      expect(deleteObjectMock).not.toHaveBeenCalled();
      expect(await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, storageObjectId))).toHaveLength(1);
      expect(await db.select().from(schema.proofOfPlay).where(eq(schema.proofOfPlay.idempotency_key, idempotencyKey))).toHaveLength(1);
    } finally {
      await winner.query('ROLLBACK').catch(() => undefined);
      winner.release();
    }
  });

  it('retains an addressable storage row when rejected telemetry object cleanup must be retried', async () => {
    const db = getDatabase();
    const deletedDeviceId = randomUUID();
    const storageObjectId = randomUUID();
    const objectKey = `heartbeats/${deletedDeviceId}/cleanup-retry.json`;
    await db.insert(schema.screens).values({ id: deletedDeviceId, name: 'Deleted before cleanup retry' });
    await db.delete(schema.screens).where(eq(schema.screens.id, deletedDeviceId));
    deleteObjectMock.mockRejectedValueOnce(new Error('object store unavailable'));

    await expect(processHeartbeatTelemetry({
      deviceId: deletedDeviceId,
      status: 'ONLINE',
      payload: { device_id: deletedDeviceId },
      receivedAt: new Date().toISOString(),
      objectKey,
      storageObjectId,
    })).rejects.toThrow(/target no longer exists/i);

    expect(await db.select().from(schema.heartbeats).where(eq(schema.heartbeats.storage_object_id, storageObjectId))).toHaveLength(0);
    expect(await db.select().from(schema.storageObjects).where(eq(schema.storageObjects.id, storageObjectId))).toEqual([
      expect.objectContaining({ id: storageObjectId, bucket: HEARTBEAT_BUCKET, object_key: objectKey }),
    ]);
  });
});
