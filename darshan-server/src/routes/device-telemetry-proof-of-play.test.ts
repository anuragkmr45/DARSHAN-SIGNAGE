import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const { queueProofOfPlayTelemetryMock, putObjectMock } = vi.hoisted(() => ({
  queueProofOfPlayTelemetryMock: vi.fn(),
  putObjectMock: vi.fn(),
}));

vi.mock('@/jobs', async () => {
  const actual = await vi.importActual<typeof import('@/jobs')>('@/jobs');
  return {
    ...actual,
    queueProofOfPlayTelemetry: queueProofOfPlayTelemetryMock,
  };
});

vi.mock('@/s3', async () => {
  const actual = await vi.importActual<typeof import('@/s3')>('@/s3');
  return {
    ...actual,
    putObject: putObjectMock,
  };
});

import { FastifyInstance } from 'fastify';
import { createTestServer, closeTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { buildProofOfPlayIdempotencyKey } from '@/jobs/device-telemetry';

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

async function proofOfPlayPublishColumnExists() {
  const result = await getDatabase().execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'proof_of_play' AND column_name = 'publish_id'
    ) AS exists
  `);
  return Boolean(result.rows[0]?.exists);
}

describe('device telemetry proof-of-play idempotency', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
    if (!(await proofOfPlayIdempotencyColumnExists())) {
      await applyMigrationFile('0026_telemetry_async_persistence.sql');
    }
    if (!(await proofOfPlayPublishColumnExists())) {
      await applyMigrationFile('0053_publish_delivery_evidence.sql');
    }
  });

  beforeEach(() => {
    queueProofOfPlayTelemetryMock.mockReset();
    queueProofOfPlayTelemetryMock.mockRejectedValue(new Error('queue unavailable'));
    putObjectMock.mockReset();
    putObjectMock.mockResolvedValue({ etag: 'etag-test', sha256: 'sha-test' });
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('treats duplicate proof-of-play delivery as success with one durable row when persisting inline', async () => {
    const db = getDatabase();
    const deviceId = randomUUID();
    const serial = `serial-${randomUUID()}`;
    const mediaId = randomUUID();
    const scheduleId = randomUUID();
    const publishId = randomUUID();
    const startTime = new Date(Date.now() - 15_000).toISOString();
    const endTime = new Date().toISOString();

    await db.insert(schema.screens).values({
      id: deviceId,
      name: 'PoP Route Device',
      status: 'ACTIVE',
    });

    await db.insert(schema.deviceCertificates).values({
      screen_id: deviceId,
      serial,
      certificate_pem: 'dummy-cert',
      expires_at: new Date(Date.now() + 60_000),
    });

    const payload = {
      device_id: deviceId,
      media_id: mediaId,
      schedule_id: scheduleId,
      publish_id: publishId,
      start_time: startTime,
      end_time: endTime,
      duration: 15,
      completed: true,
      page_number: 4,
    };

    const firstResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/device/proof-of-play',
      headers: {
        'x-device-serial': serial,
      },
      payload,
    });

    const secondResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/device/proof-of-play',
      headers: {
        'x-device-serial': serial,
      },
      payload,
    });

    expect(firstResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(secondResponse.statusCode).toBe(HTTP_STATUS.CREATED);

    const idempotencyKey = buildProofOfPlayIdempotencyKey({
      deviceId,
      mediaId,
      scheduleId,
      publishId,
      startTime,
      endTime,
      duration: 15,
      completed: true,
      pageNumber: 4,
    });

    const rows = await db
      .select()
      .from(schema.proofOfPlay)
      .where(eq(schema.proofOfPlay.idempotency_key, idempotencyKey));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.page_number).toBe(4);
    expect(rows[0]?.publish_id).toBe(publishId);
    expect(putObjectMock).toHaveBeenCalledOnce();
  });
});
