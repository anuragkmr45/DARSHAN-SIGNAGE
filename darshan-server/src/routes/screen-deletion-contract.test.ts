import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAccessToken } from '@/auth/jwt';
import { getDatabase, schema } from '@/db';
import { createSessionRepository } from '@/db/repositories/session';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';

describe('screen and group deletion references', () => {
  let server: FastifyInstance;
  let token: string;
  const headers = () => ({ authorization: `Bearer ${token}` });
  const deleteScreen = (id: string) => server.inject({ method: 'DELETE', url: `/api/v1/screens/${id}`, headers: headers() });
  const deleteGroup = (id: string) => server.inject({ method: 'DELETE', url: `/api/v1/screen-groups/${id}`, headers: headers() });

  beforeAll(async () => {
    server = await createTestServer();
    const db = getDatabase();
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN'));
    const access = await generateAccessToken(testUser.id, testUser.email, role.id, role.name);
    await createSessionRepository().create({ user_id: testUser.id, access_jti: access.jti, expires_at: access.expiresAt });
    token = access.token;
  });

  afterAll(async () => { await closeTestServer(server); });

  it('blocks direct and inherited future schedule targets, then permits historical-only deletion', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const groupId = randomUUID();
    const scheduleId = randomUUID();
    const future = new Date(Date.now() + 3600_000);
    const end = new Date(Date.now() + 7200_000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Scheduled target' });
    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Scheduled group' });
    await db.insert(schema.screenGroupMembers).values({ screen_id: screenId, group_id: groupId });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Future schedule', start_at: future, end_at: end, created_by: testUser.id });
    const [item] = await db.insert(schema.scheduleItems).values({
      schedule_id: scheduleId, presentation_id: randomUUID(), start_at: future, end_at: end,
      screen_ids: [screenId], screen_group_ids: [groupId],
    }).returning();

    const blockedScreen = await deleteScreen(screenId);
    const blockedGroup = await deleteGroup(groupId);
    expect(blockedScreen.statusCode).toBe(409);
    expect(JSON.parse(blockedScreen.body).error).toMatchObject({ code: 'SCREEN_IN_USE', details: { blockers: { schedule_items: 1 } } });
    expect(blockedGroup.statusCode).toBe(409);
    expect(JSON.parse(blockedGroup.body).error).toMatchObject({ code: 'SCREEN_GROUP_IN_USE', details: { blockers: { schedule_items: 1 } } });
    expect(await db.select().from(schema.screenGroupMembers).where(eq(schema.screenGroupMembers.screen_id, screenId))).toHaveLength(1);

    await db.update(schema.scheduleItems).set({ start_at: new Date(Date.now() - 7200_000), end_at: new Date(Date.now() - 3600_000) })
      .where(eq(schema.scheduleItems.id, item.id));
    await db.update(schema.schedules).set({ end_at: new Date(Date.now() - 3600_000) }).where(eq(schema.schedules.id, scheduleId));
    expect((await deleteScreen(screenId)).statusCode).toBe(200);
    expect((await deleteGroup(groupId)).statusCode).toBe(204);
    expect(await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, item.id))).toHaveLength(1);
  });

  it('blocks active global emergency but ignores a cleared emergency', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const emergencyId = randomUUID();
    await db.insert(schema.screens).values({ id: screenId, name: 'Emergency target' });
    await db.insert(schema.emergencies).values({ id: emergencyId, message: 'Global test', target_all: true, is_active: true });
    const blocked = await deleteScreen(screenId);
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).error).toMatchObject({ code: 'SCREEN_IN_USE', details: { blockers: { active_emergencies: 1 } } });
    await db.update(schema.emergencies).set({ is_active: false, cleared_at: new Date() }).where(eq(schema.emergencies.id, emergencyId));
    expect((await deleteScreen(screenId)).statusCode).toBe(200);
    expect(await db.select().from(schema.emergencies).where(eq(schema.emergencies.id, emergencyId))).toHaveLength(1);
  });

  it('serializes a new schedule reference against deletion', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const scheduleId = randomUUID();
    const future = new Date(Date.now() + 3600_000);
    const end = new Date(Date.now() + 7200_000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Concurrent target' });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Concurrent schedule', start_at: future, end_at: end, created_by: testUser.id });
    let release!: () => void;
    let inserted!: () => void;
    const insertedPromise = new Promise<void>((resolve) => { inserted = resolve; });
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    const writer = db.transaction(async (tx) => {
      await tx.insert(schema.scheduleItems).values({ schedule_id: scheduleId, presentation_id: randomUUID(), start_at: future, end_at: end, screen_ids: [screenId] });
      inserted();
      await releasePromise;
    });
    await insertedPromise;
    const deletion = deleteScreen(screenId);
    release();
    await writer;
    const result = await deletion;
    expect(result.statusCode).toBe(409);
    expect(await db.select().from(schema.screens).where(eq(schema.screens.id, screenId))).toHaveLength(1);
  });
});
