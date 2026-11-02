import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { getDatabase, schema } from '@/db';

async function issueToken() {
  const [role] = await getDatabase().select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN')).limit(1);
  if (!role) throw new Error('SUPER_ADMIN role is required');
  const token = await generateAccessToken(testUser.id, testUser.email, role.id, role.name);
  await createSessionRepository().create({ user_id: testUser.id, access_jti: token.jti, expires_at: token.expiresAt });
  return token.token;
}

describe('dashboard schedule delivery evidence', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await issueToken();
  });
  afterAll(async () => closeTestServer(server));

  it('separates assigned, applied, reported playback, and proof-observed screens', async () => {
    const db = getDatabase();
    const beforeResponse = await server.inject({
      method: 'GET', url: '/api/v1/metrics/overview', headers: { authorization: `Bearer ${token}` },
    });
    expect(beforeResponse.statusCode).toBe(200);
    const before = beforeResponse.json().schedules;
    const scheduleId = randomUUID();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const screenIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const now = new Date();
    const activeSlot = (screenId: string) => [{
      scene_id: 'scene-1', slot_id: 'slot-1', item_id: 'item-1', media_id: randomUUID(),
      schedule_id: scheduleId, playback_instance_id: randomUUID(), started_at: now.toISOString(), screen_id: screenId,
    }];

    await db.insert(schema.screens).values(screenIds.map((id, index) => ({
      id,
      name: `Evidence ${index}`,
      status: 'ACTIVE' as const,
      last_heartbeat_at: now,
      current_schedule_id: index < 3 ? scheduleId : null,
      active_slots: index < 3 ? activeSlot(id) : [],
    })));
    await db.insert(schema.schedules).values({
      id: scheduleId, name: 'Current evidence', start_at: new Date(now.getTime() - 60_000),
      end_at: new Date(now.getTime() + 60_000), is_active: true, created_by: testUser.id,
    });
    await db.insert(schema.scheduleSnapshots).values({ id: snapshotId, schedule_id: scheduleId, payload: {} });
    await db.insert(schema.publishes).values({
      id: publishId, schedule_id: scheduleId, snapshot_id: snapshotId, published_by: testUser.id,
      published_at: new Date(now.getTime() - 30_000),
    });
    await db.insert(schema.publishTargets).values(screenIds.map((screenId, index) => ({
      publish_id: publishId,
      screen_id: screenId,
      status: index < 3 ? 'SUCCESS' : 'PENDING',
      applied_at: index < 3 ? now : null,
    })));
    await db.insert(schema.proofOfPlay).values({
      screen_id: screenIds[0], schedule_id: scheduleId, publish_id: publishId,
      playback_instance_id: randomUUID(), started_at: now, ended_at: now,
      idempotency_key: randomUUID().replaceAll('-', ''),
    });

    const response = await server.inject({
      method: 'GET', url: '/api/v1/metrics/overview', headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const after = response.json().schedules;
    expect(after.assigned_screens_now - before.assigned_screens_now).toBe(4);
    expect(after.applied_screens_now - before.applied_screens_now).toBe(3);
    expect(after.reporting_playback_now - before.reporting_playback_now).toBe(3);
    expect(after.proof_observed_now - before.proof_observed_now).toBe(1);
  });
});
