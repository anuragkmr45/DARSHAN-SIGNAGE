import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';

async function issueAdminToken() {
  const db = getDatabase();
  const [adminRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'ADMIN')).limit(1);
  if (!adminRole) {
    throw new Error('ADMIN role is required for screen group route tests');
  }

  const currentPermissions =
    adminRole.permissions && typeof adminRole.permissions === 'object'
      ? (adminRole.permissions as { grants?: Array<{ action: string; subject: string }> })
      : {};
  const mergedGrants = [...(currentPermissions.grants || [])];
  for (const grant of [{ action: 'read', subject: 'ScreenGroup' }]) {
    if (!mergedGrants.some((current) => current.action === grant.action && current.subject === grant.subject)) {
      mergedGrants.push(grant);
    }
  }

  await db
    .update(schema.roles)
    .set({ permissions: { grants: mergedGrants } })
    .where(eq(schema.roles.id, adminRole.id));

  const token = await generateAccessToken(testUser.id, testUser.email, adminRole.id, adminRole.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });
  return token.token;
}

describe('Screen group list summaries', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('returns paginated group summaries with server-side search', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const groupId = randomUUID();
    const searchToken = `group-${randomUUID().slice(0, 8)}`;

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Group Summary Screen',
      location: 'Group Summary Lobby',
      status: 'ACTIVE',
      last_heartbeat_at: new Date(),
    });

    await db.insert(schema.screenGroups).values({
      id: groupId,
      name: `North Group Summary ${searchToken}`,
      description: `North Group Summary Description ${searchToken}`,
    });

    await db.insert(schema.screenGroupMembers).values({
      group_id: groupId,
      screen_id: screenId,
    });

    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/screen-groups?include_summary=true&q=${encodeURIComponent(searchToken)}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body) as any;
    expect(typeof body.server_time).toBe('string');
    expect(body.pagination.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(
      expect.objectContaining({
        id: groupId,
        name: `North Group Summary ${searchToken}`,
        screen_ids: [screenId],
      }),
    );
    expect(Array.isArray(body.items[0].active_items)).toBe(true);
    expect(Array.isArray(body.items[0].upcoming_items)).toBe(true);
  });

  it('applies group screenshot controls atomically only when every member Screen is permitted and unlocked', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('PostgreSQL pool is required for screen group lifecycle tests');
    const groupId = randomUUID();
    const screenA = randomUUID();
    const screenB = randomUUID();
    const roleId = randomUUID();
    const userId = randomUUID();
    const roleName = `SCOPED_GROUP_CONTROL_${roleId}`;
    const email = `scoped-group-${userId}@example.test`;

    await db.insert(schema.screens).values([
      { id: screenA, name: 'Scoped group screen A' },
      { id: screenB, name: 'Scoped group screen B' },
    ]);
    await db.insert(schema.screenGroups).values({ id: groupId, name: 'Scoped control group' });
    await db.insert(schema.screenGroupMembers).values([
      { group_id: groupId, screen_id: screenA },
      { group_id: groupId, screen_id: screenB },
    ]);
    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      is_system: false,
      permissions: {
        grants: [
          { action: 'create', subject: 'ScreenGroup' },
          { action: 'update', subject: 'ScreenGroup', conditions: { id: groupId } },
          { action: 'delete', subject: 'ScreenGroup', conditions: { id: groupId } },
          { action: 'update', subject: 'Screen', conditions: { id: screenA } },
        ],
      },
    });
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash: 'not-used-by-token-test',
      role_id: roleId,
      is_active: true,
    });
    const access = await generateAccessToken(userId, email, roleId, roleName);
    await createSessionRepository().create({
      user_id: userId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });

    const denied = await server.inject({
      method: 'POST',
      url: `/api/v1/screen-groups/${groupId}/screenshot-settings`,
      headers: { authorization: `Bearer ${access.token}` },
      payload: { enabled: true, interval_seconds: 45 },
    });
    expect(denied.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(
      await db.select().from(schema.deviceCommands).where(eq(schema.deviceCommands.created_by, userId)),
    ).toHaveLength(0);
    const deniedScreens = await db
      .select()
      .from(schema.screens)
      .where(inArray(schema.screens.id, [screenA, screenB]));
    expect(deniedScreens.every((screen) => !screen.screenshot_enabled)).toBe(true);

    const deniedCreateName = `Must not create ${randomUUID()}`;
    const deniedCreate = await server.inject({
      method: 'POST',
      url: '/api/v1/screen-groups',
      headers: { authorization: `Bearer ${access.token}` },
      payload: { name: deniedCreateName, screen_ids: [screenA, screenB] },
    });
    expect(deniedCreate.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(
      await db.select().from(schema.screenGroups).where(eq(schema.screenGroups.name, deniedCreateName)),
    ).toHaveLength(0);

    const deniedDelete = await server.inject({
      method: 'DELETE',
      url: `/api/v1/screen-groups/${groupId}`,
      headers: { authorization: `Bearer ${access.token}` },
    });
    expect(deniedDelete.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(await db.select().from(schema.screenGroups).where(eq(schema.screenGroups.id, groupId))).toHaveLength(1);

    const deniedMembershipChange = await server.inject({
      method: 'PATCH',
      url: `/api/v1/screen-groups/${groupId}`,
      headers: { authorization: `Bearer ${access.token}` },
      payload: { screen_ids: [screenA] },
    });
    expect(deniedMembershipChange.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(
      (await db
        .select({ screen_id: schema.screenGroupMembers.screen_id })
        .from(schema.screenGroupMembers)
        .where(eq(schema.screenGroupMembers.group_id, groupId)))
        .map((member) => member.screen_id)
        .sort(),
    ).toEqual([screenA, screenB].sort());

    await db
      .update(schema.roles)
      .set({
        permissions: {
          grants: [
            { action: 'create', subject: 'ScreenGroup' },
            { action: 'update', subject: 'ScreenGroup', conditions: { id: groupId } },
            { action: 'delete', subject: 'ScreenGroup', conditions: { id: groupId } },
            { action: 'update', subject: 'Screen', conditions: { id: screenA } },
            { action: 'update', subject: 'Screen', conditions: { id: screenB } },
          ],
        },
      })
      .where(eq(schema.roles.id, roleId));

    const permitted = await server.inject({
      method: 'POST',
      url: `/api/v1/screen-groups/${groupId}/screenshot-settings`,
      headers: { authorization: `Bearer ${access.token}` },
      payload: { enabled: true, interval_seconds: 45 },
    });
    expect(permitted.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(permitted.body).commands).toHaveLength(2);

    const triggered = await server.inject({
      method: 'POST',
      url: `/api/v1/screen-groups/${groupId}/screenshot`,
      headers: { authorization: `Bearer ${access.token}` },
      payload: { reason: 'scoped_group_test' },
    });
    expect(triggered.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(triggered.body).commands_created).toBe(2);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`darshan:device-pairing:${screenB}`],
      );
      const contended = await server.inject({
        method: 'POST',
        url: `/api/v1/screen-groups/${groupId}/screenshot-settings`,
        headers: { authorization: `Bearer ${access.token}` },
        payload: { enabled: false },
      });
      expect(contended.statusCode).toBe(HTTP_STATUS.CONFLICT);
      const unchanged = await db
        .select()
        .from(schema.screens)
        .where(inArray(schema.screens.id, [screenA, screenB]));
      expect(unchanged.every((screen) => screen.screenshot_enabled && screen.screenshot_interval_seconds === 45)).toBe(true);
      expect(
        await db.select().from(schema.deviceCommands).where(eq(schema.deviceCommands.created_by, userId)),
      ).toHaveLength(4);

      const contendedMembershipChange = await server.inject({
        method: 'PATCH',
        url: `/api/v1/screen-groups/${groupId}`,
        headers: { authorization: `Bearer ${access.token}` },
        payload: { screen_ids: [screenA] },
      });
      expect(contendedMembershipChange.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(
        (await db
          .select({ screen_id: schema.screenGroupMembers.screen_id })
          .from(schema.screenGroupMembers)
          .where(eq(schema.screenGroupMembers.group_id, groupId)))
          .map((member) => member.screen_id)
          .sort(),
      ).toEqual([screenA, screenB].sort());
      expect(
        await db.select().from(schema.deviceCommands).where(eq(schema.deviceCommands.created_by, userId)),
      ).toHaveLength(4);
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }

    const retry = await server.inject({
      method: 'POST',
      url: `/api/v1/screen-groups/${groupId}/screenshot-settings`,
      headers: { authorization: `Bearer ${access.token}` },
      payload: { enabled: false },
    });
    expect(retry.statusCode).toBe(HTTP_STATUS.OK);
    const disabled = await db
      .select()
      .from(schema.screens)
      .where(inArray(schema.screens.id, [screenA, screenB]));
    expect(disabled.every((screen) => !screen.screenshot_enabled)).toBe(true);

    const deleted = await server.inject({
      method: 'DELETE',
      url: `/api/v1/screen-groups/${groupId}`,
      headers: { authorization: `Bearer ${access.token}` },
    });
    expect(deleted.statusCode).toBe(HTTP_STATUS.NO_CONTENT);
    expect(await db.select().from(schema.screenGroups).where(eq(schema.screenGroups.id, groupId))).toHaveLength(0);
    expect(
      await db.select().from(schema.screenGroupMembers).where(eq(schema.screenGroupMembers.group_id, groupId)),
    ).toHaveLength(0);
  });
});
