import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { closeTestServer, createTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { config as appConfig } from '@/config';
import {
  AVAILABILITY_HEARTBEAT_GRACE_MS,
  buildAvailabilityReport,
  recordScreenAvailabilityHeartbeat,
} from './screen-availability';

describe('screen availability history', () => {
  let server: FastifyInstance;
  const checkpointIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    const db = getDatabase();
    if (checkpointIds.length > 0) {
      await db.delete(schema.backendReadinessCheckpoints).where(inArray(schema.backendReadinessCheckpoints.id, checkpointIds));
    }
    await closeTestServer(server);
  });

  it('persists an estimated outage when the next heartbeat arrives after the grace period', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const first = new Date('2026-11-01T00:00:00.000Z');
    const returned = new Date(first.getTime() + AVAILABILITY_HEARTBEAT_GRACE_MS + 110_000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Availability transition', created_at: first });

    try {
      await db.transaction(async (tx) => {
        await tx.select().from(schema.screens).where(eq(schema.screens.id, screenId)).for('update');
        await recordScreenAvailabilityHeartbeat(tx, {
          screenId,
          status: 'ONLINE',
          receivedAt: first,
          previousLastHeartbeatAt: null,
        });
        await tx.update(schema.screens).set({ last_heartbeat_at: first }).where(eq(schema.screens.id, screenId));
      });
      await db.transaction(async (tx) => {
        await tx.select().from(schema.screens).where(eq(schema.screens.id, screenId)).for('update');
        await recordScreenAvailabilityHeartbeat(tx, {
          screenId,
          status: 'ONLINE',
          receivedAt: returned,
          previousLastHeartbeatAt: first,
        });
        await tx.update(schema.screens).set({ last_heartbeat_at: returned }).where(eq(schema.screens.id, screenId));
      });

      const rows = await db
        .select()
        .from(schema.screenAvailabilityIntervals)
        .where(eq(schema.screenAvailabilityIntervals.screen_id, screenId));
      expect(rows.map((row) => [row.state, row.source])).toEqual([
        ['ONLINE', 'HEARTBEAT'],
        ['OFFLINE', 'STALE_TIMEOUT'],
        ['ONLINE', 'HEARTBEAT'],
      ]);
      expect(rows[0]?.ended_at?.toISOString()).toBe(new Date(first.getTime() + AVAILABILITY_HEARTBEAT_GRACE_MS).toISOString());
      expect(rows[1]?.ended_at?.toISOString()).toBe(returned.toISOString());
      expect(rows[2]?.ended_at).toBeNull();
    } finally {
      await db.delete(schema.screens).where(eq(schema.screens.id, screenId));
    }
  });

  it('excludes backend gaps from uptime and splits durations at IST midnight', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const rangeStart = new Date('2026-11-01T18:28:00.000Z'); // 23:58 IST
    const rangeEnd = new Date('2026-11-01T18:34:00.000Z'); // 00:04 IST
    await db.insert(schema.screens).values({
      id: screenId,
      name: 'IST boundary screen',
      created_at: rangeStart,
      last_heartbeat_at: new Date('2026-11-01T18:32:00.000Z'),
      status: 'OFFLINE',
    });
    await db.insert(schema.screenAvailabilityIntervals).values([
      {
        screen_id: screenId,
        state: 'ONLINE',
        source: 'HEARTBEAT',
        started_at: rangeStart,
        ended_at: new Date('2026-11-01T18:30:00.000Z'),
      },
      {
        screen_id: screenId,
        state: 'OFFLINE',
        source: 'EXPLICIT_OFFLINE',
        started_at: new Date('2026-11-01T18:30:00.000Z'),
        ended_at: rangeEnd,
      },
    ]);

    // The backend is known for minutes 0-2 and 4-6. Minutes 2-4 remain unknown.
    const checkpointTimes = [rangeStart, new Date('2026-11-01T18:28:30.000Z'), new Date('2026-11-01T18:32:00.000Z'), new Date('2026-11-01T18:32:30.000Z')];
    const rows = checkpointTimes.map((observedAt) => {
      const id = `availability-test:${randomUUID()}`;
      checkpointIds.push(id);
      return {
        id,
        deployment_id: appConfig.SIGNHEX_DEPLOYMENT_ID,
        server_id: 'availability-test',
        observed_at: observedAt,
      };
    });
    await db.insert(schema.backendReadinessCheckpoints).values(rows);

    try {
      const report = await buildAvailabilityReport({ rangeStart, rangeEnd });
      const screen = report.screens.find((item) => item.screen_id === screenId);
      expect(screen).toMatchObject({
        online_seconds: 120,
        estimated_offline_seconds: 120,
        unknown_seconds: 120,
        uptime_percent: 50,
      });
      expect(report.daily.map((day) => day.date)).toEqual(expect.arrayContaining(['2026-11-01', '2026-11-02']));
    } finally {
      await db.delete(schema.screens).where(eq(schema.screens.id, screenId));
    }
  });
});
