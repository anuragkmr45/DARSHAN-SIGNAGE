import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAccessToken } from '@/auth/jwt';
import { getDatabase, schema } from '@/db';
import { createSessionRepository } from '@/db/repositories/session';
import { lockScreenTargetReferences } from '@/services/screen-deletion-guard';
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

    // The item keeps its original target and future timestamps as immutable
    // history. Once the parent schedule has ended it must not block deletion.
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

  it('reports inherited publish, reservation, emergency, and default blockers without mutation', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const groupId = randomUUID();
    const scheduleId = randomUUID();
    const snapshotId = randomUUID();
    const publishId = randomUUID();
    const reservationId = randomUUID();
    const emergencyId = randomUUID();
    const mediaId = randomUUID();
    const future = new Date(Date.now() + 3600_000);
    const end = new Date(Date.now() + 7200_000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Inherited blocker target' });
    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Inherited blocker group' });
    await db.insert(schema.screenGroupMembers).values({ screen_id: screenId, group_id: groupId });
    await db.insert(schema.media).values({ id: mediaId, name: 'Inherited default', type: 'IMAGE', status: 'READY', created_by: testUser.id });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Published group schedule', start_at: future, end_at: end, created_by: testUser.id });
    await db.insert(schema.scheduleSnapshots).values({ id: snapshotId, schedule_id: scheduleId, payload: { schedule: { id: scheduleId } } });
    await db.insert(schema.publishes).values({ id: publishId, schedule_id: scheduleId, snapshot_id: snapshotId, published_by: testUser.id });
    await db.insert(schema.publishTargets).values({ publish_id: publishId, screen_group_id: groupId });
    await db.insert(schema.scheduleReservations).values({
      id: reservationId,
      screen_id: screenId,
      schedule_id: scheduleId,
      schedule_item_id: randomUUID(),
      owner_user_id: testUser.id,
      state: 'RESERVED',
      start_at: future,
      end_at: end,
      reservation_token: randomUUID(),
    });
    await db.insert(schema.emergencies).values({
      id: emergencyId,
      message: 'Group emergency',
      screen_group_ids: [groupId],
      is_active: true,
    });
    await db.insert(schema.settings).values({
      key: 'default_media_targets',
      value: [{ target_type: 'GROUP', target_id: groupId, media_id: mediaId, aspect_ratio: '16:9', priority: 1 }],
    }).onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: [{ target_type: 'GROUP', target_id: groupId, media_id: mediaId, aspect_ratio: '16:9', priority: 1 }], updated_at: new Date() },
    });

    for (const response of [await deleteScreen(screenId), await deleteGroup(groupId)]) {
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.details.blockers).toMatchObject({
        active_publishes: 1,
        reservations: 1,
        active_emergencies: 1,
        defaults: 1,
      });
    }
    expect(await db.select().from(schema.screens).where(eq(schema.screens.id, screenId))).toHaveLength(1);
    expect(await db.select().from(schema.screenGroups).where(eq(schema.screenGroups.id, groupId))).toHaveLength(1);
    expect(await db.select().from(schema.screenGroupMembers).where(eq(schema.screenGroupMembers.group_id, groupId))).toHaveLength(1);

    await db.update(schema.publishes).set({ status: 'TAKEN_DOWN', taken_down_at: new Date() }).where(eq(schema.publishes.id, publishId));
    await db.update(schema.scheduleReservations).set({ state: 'RELEASED', released_at: new Date() }).where(eq(schema.scheduleReservations.id, reservationId));
    await db.update(schema.emergencies).set({ is_active: false, cleared_at: new Date() }).where(eq(schema.emergencies.id, emergencyId));
    await db.update(schema.settings).set({ value: [], updated_at: new Date() }).where(eq(schema.settings.key, 'default_media_targets'));
    expect((await deleteScreen(screenId)).statusCode).toBe(200);
    expect((await deleteGroup(groupId)).statusCode).toBe(204);
    expect(await db.select().from(schema.scheduleSnapshots).where(eq(schema.scheduleSnapshots.id, snapshotId))).toHaveLength(1);
  });

  it('checks permission before revealing blockers and leaves referenced data unchanged', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const scheduleId = randomUUID();
    const roleId = randomUUID();
    const future = new Date(Date.now() + 3600_000);
    const end = new Date(Date.now() + 7200_000);
    await db.insert(schema.roles).values({
      id: roleId,
      name: `SCREEN_READ_ONLY_${roleId}`,
      permissions: { grants: [{ action: 'read', subject: 'Screen' }] },
      is_system: false,
    });
    const access = await generateAccessToken(testUser.id, testUser.email, roleId, `SCREEN_READ_ONLY_${roleId}`);
    await createSessionRepository().create({ user_id: testUser.id, access_jti: access.jti, expires_at: access.expiresAt });
    await db.insert(schema.screens).values({ id: screenId, name: 'Permission protected target' });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Hidden blocker schedule', start_at: future, end_at: end, created_by: testUser.id });
    const [item] = await db.insert(schema.scheduleItems).values({
      schedule_id: scheduleId,
      presentation_id: randomUUID(),
      start_at: future,
      end_at: end,
      screen_ids: [screenId],
    }).returning();

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/screens/${screenId}`,
      headers: { authorization: `Bearer ${access.token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error).toMatchObject({ code: 'FORBIDDEN' });
    expect(JSON.parse(response.body).error.details).toBeNull();
    expect(await db.select().from(schema.screens).where(eq(schema.screens.id, screenId))).toHaveLength(1);
    expect(await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, item.id))).toHaveLength(1);
  });

  it('returns an empty list instead of Forbidden when an authorized role has no accessible screens', async () => {
    const db = getDatabase();
    const roleId = randomUUID();
    const inaccessibleDepartmentId = randomUUID();
    await db.insert(schema.roles).values({
      id: roleId,
      name: `SCREEN_SCOPED_EMPTY_${roleId}`,
      permissions: {
        grants: [{
          action: 'read',
          subject: 'Screen',
          conditions: { department_id: inaccessibleDepartmentId },
        }],
      },
      is_system: false,
    });
    const access = await generateAccessToken(testUser.id, testUser.email, roleId, `SCREEN_SCOPED_EMPTY_${roleId}`);
    await createSessionRepository().create({ user_id: testUser.id, access_jti: access.jti, expires_at: access.expiresAt });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/screens?page=1&limit=9&include_summary=true',
      headers: { authorization: `Bearer ${access.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      items: [],
      pagination: { total: 0, page: 1, limit: 9 },
    });
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

  it('rejects a stale writer when deletion wins the shared target lock', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const scheduleId = randomUUID();
    const future = new Date(Date.now() + 3600_000);
    const end = new Date(Date.now() + 7200_000);
    await db.insert(schema.screens).values({ id: screenId, name: 'Deletion-first target' });
    await db.insert(schema.schedules).values({ id: scheduleId, name: 'Deletion-first schedule', start_at: future, end_at: end, created_by: testUser.id });
    let deletionLocked!: () => void;
    let releaseDeletion!: () => void;
    const deletionLockedPromise = new Promise<void>((resolve) => { deletionLocked = resolve; });
    const releaseDeletionPromise = new Promise<void>((resolve) => { releaseDeletion = resolve; });
    const deletion = db.transaction(async (tx) => {
      await lockScreenTargetReferences(tx);
      await tx.select({ id: schema.screens.id }).from(schema.screens).where(eq(schema.screens.id, screenId)).for('update');
      deletionLocked();
      await releaseDeletionPromise;
      await tx.delete(schema.screens).where(eq(schema.screens.id, screenId));
    });
    await deletionLockedPromise;
    const writer = db.transaction(async (tx) => {
      await tx.insert(schema.scheduleItems).values({
        schedule_id: scheduleId,
        presentation_id: randomUUID(),
        start_at: future,
        end_at: end,
        screen_ids: [screenId],
      });
    });
    releaseDeletion();
    await deletion;
    await expect(writer).rejects.toThrow(/target no longer exists/i);
    expect(await db.select().from(schema.screens).where(eq(schema.screens.id, screenId))).toHaveLength(0);
    expect(await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.schedule_id, scheduleId))).toHaveLength(0);
  });
});
