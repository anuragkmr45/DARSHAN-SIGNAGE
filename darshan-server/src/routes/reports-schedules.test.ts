import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { getDatabase, schema } from '@/db';

async function issueSuperAdminToken() {
  const db = getDatabase();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN')).limit(1);
  if (!role) {
    throw new Error('SUPER_ADMIN role is required for reports schedule tests');
  }

  const token = await generateAccessToken(testUser.id, testUser.email, role.id, role.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });

  return token.token;
}

describe('Schedule activity report', () => {
  let server: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await issueSuperAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('returns grouped schedule activity for screens and screen groups', async () => {
    const db = getDatabase();
    const scheduleId = randomUUID();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const screenId = randomUUID();
    const groupId = randomUUID();

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Lobby Screen',
      status: 'ACTIVE',
    });

    await db.insert(schema.screenGroups).values({
      id: groupId,
      name: 'Ground Floor Group',
    });

    await db.insert(schema.schedules).values({
      id: scheduleId,
      name: 'Morning Rotation',
      start_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      end_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
      created_by: testUser.id,
    });

    await db.insert(schema.scheduleSnapshots).values({
      id: snapshotId,
      schedule_id: scheduleId,
      payload: { items: [] },
    });

    await db.insert(schema.publishes).values({
      id: publishId,
      schedule_id: scheduleId,
      snapshot_id: snapshotId,
      published_by: testUser.id,
      status: 'ACTIVE',
      published_at: new Date(Date.now() - 60 * 60 * 1000),
    });

    await db.insert(schema.publishTargets).values([
      {
        id: randomUUID(),
        publish_id: publishId,
        screen_id: screenId,
        status: 'SUCCESS',
        applied_at: new Date(),
      },
      {
        id: randomUUID(),
        publish_id: publishId,
        screen_group_id: groupId,
        status: 'PENDING',
      },
    ]);
    await db.insert(schema.proofOfPlay).values({
      screen_id: screenId,
      schedule_id: scheduleId,
      publish_id: publishId,
      playback_instance_id: randomUUID(),
      started_at: new Date(),
      ended_at: new Date(),
      idempotency_key: randomUUID().replaceAll('-', ''),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reports/schedules?days=7',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.summary.schedules).toBeGreaterThan(0);
    expect(body.summary.target_events).toBeGreaterThanOrEqual(2);
    expect(body.summary.pending_targets).toBeGreaterThanOrEqual(1);
    expect(body.summary.applied_targets).toBeGreaterThanOrEqual(1);
    expect(body.summary.proof_observed_targets).toBeGreaterThanOrEqual(1);
    expect(body.by_screen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_id: screenId,
          target_name: 'Lobby Screen',
          entries: expect.arrayContaining([
            expect.objectContaining({ proof_observed: true }),
          ]),
        }),
      ]),
    );
    expect(body.by_group).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target_id: groupId,
          target_name: 'Ground Floor Group',
        }),
      ]),
    );
  });

  it('counts screens with stale heartbeats even when the last reported status is ACTIVE', async () => {
    const db = getDatabase();
    const staleId = randomUUID();
    const newId = randomUUID();
    const neverSeenId = randomUUID();
    await db.insert(schema.screens).values([
      {
        id: staleId,
        name: 'Stale active screen',
        status: 'ACTIVE',
        last_heartbeat_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
      { id: newId, name: 'New unpaired screen', status: 'ACTIVE' },
      { id: neverSeenId, name: 'Never seen old screen', status: 'OFFLINE', created_at: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    ]);
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/offline-screens',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const ids = response.json().screens.map((screen: { id: string }) => screen.id);
      expect(ids).toContain(staleId);
      expect(ids).toContain(neverSeenId);
      expect(ids).not.toContain(newId);
    } finally {
      await db.delete(schema.screens).where(eq(schema.screens.id, staleId));
      await db.delete(schema.screens).where(eq(schema.screens.id, newId));
      await db.delete(schema.screens).where(eq(schema.screens.id, neverSeenId));
    }
  });

  it('returns historical availability with explicit unknown time and IST report buckets', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reports/availability?days=1',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      range: {
        timezone: 'Asia/Kolkata',
        offline_threshold_seconds: 90,
      },
      summary: {
        online_seconds: expect.any(Number),
        estimated_offline_seconds: expect.any(Number),
        unknown_seconds: expect.any(Number),
      },
      screens: expect.any(Array),
      daily: expect.any(Array),
    });
  });

  it('keeps last publish available when pg-boss statistics fail', async () => {
    const db = getDatabase();
    const execute = vi.spyOn(db, 'execute').mockRejectedValue(new Error('pg-boss unavailable'));
    try {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/reports/system-health',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().transcode_queue.pending).toBeNull();
      expect(response.json().jobs.failed_last_24h).toBeNull();
      expect(response.json().publishes).toHaveProperty('last_published_at');
    } finally {
      execute.mockRestore();
    }
  });
});
