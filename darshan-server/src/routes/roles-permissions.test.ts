import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, createTestActor, generateTestToken, testRoles, testUser } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { getDatabase, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { hashPassword } from '@/auth/password';
import { syncSystemRolePermissions, SYSTEM_ROLE_DEFAULTS } from '@/rbac/system-roles';

describe('Role and permission routes', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await generateTestToken(testUser.id, 'ADMIN');
    superAdminToken = (await createTestActor('SUPER_ADMIN')).token;
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('returns permission metadata for authorized callers', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/permissions/metadata',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(Array.isArray(body.subjects)).toBe(true);
    expect(body.actions).toContain('create');
    expect(body.subjects).toContain('User');
  });

  it('lists system roles for authorized callers', async () => {
    const db = getDatabase();
    const suffix = Date.now();
    await db.insert(schema.roles).values(
      Array.from({ length: 25 }, (_, index) => ({
        name: `CUSTOM_ROLE_PAGE_PRESSURE_${suffix}_${index}`,
        permissions: { grants: [] },
        is_system: false,
      }))
    );

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/roles?page=1&limit=20',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.some((item: any) => item.name === 'SUPER_ADMIN')).toBe(true);
    expect(body.items.some((item: any) => item.name === 'ADMIN')).toBe(true);
    expect(body.items.slice(0, 4).map((item: any) => item.name)).toEqual([
      'SUPER_ADMIN',
      'ADMIN',
      'DEPARTMENT',
      'OPERATOR',
    ]);
  });

  it('allows role creation whenever the caller has create Role permission', async () => {
    const createPayload = {
      name: `CUSTOM_ROLE_${Date.now()}`,
      description: 'Phase 1 regression role',
      permissions: {
        grants: [{ action: 'read', subject: 'Dashboard' }],
      },
    };

    const adminResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: createPayload,
    });

    expect(adminResponse.statusCode).toBe(HTTP_STATUS.CREATED);

    const superAdminResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: { ...createPayload, name: `${createPayload.name}_SUPER` },
    });

    expect(superAdminResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(JSON.parse(superAdminResponse.body).name).toBe(`${createPayload.name}_SUPER`);
  });

  it('enforces conditional Role grants against records and denies subject-wide catalogue access', async () => {
    const db = getDatabase();
    const actorRoleId = randomUUID();
    const actorId = randomUUID();
    const allowedRoleId = randomUUID();
    const deniedRoleId = randomUUID();
    const guardedRoleId = randomUUID();
    const guardedRoleName = `GUARDED_${guardedRoleId}`;
    const permittedName = `CONDITIONAL_CREATE_${randomUUID()}`;
    const actorRoleName = `CONDITIONAL_MANAGER_${randomUUID()}`;
    await db.insert(schema.roles).values([
      {
        id: actorRoleId,
        name: actorRoleName,
        permissions: { grants: [
          { action: 'read', subject: 'Role', conditions: { id: allowedRoleId } },
          { action: 'update', subject: 'Role', conditions: { id: allowedRoleId } },
          { action: 'update', subject: 'Role', conditions: { name: guardedRoleName } },
          { action: 'delete', subject: 'Role', conditions: { id: allowedRoleId } },
          { action: 'create', subject: 'Role', conditions: { name: permittedName } },
        ] },
        is_system: false,
      },
      { id: allowedRoleId, name: `ALLOWED_${randomUUID()}`, permissions: { grants: [] }, is_system: false },
      { id: deniedRoleId, name: `DENIED_${randomUUID()}`, permissions: { grants: [] }, is_system: false },
      { id: guardedRoleId, name: guardedRoleName, permissions: { grants: [] }, is_system: false },
    ]);
    const email = `conditional-manager-${actorId}@example.test`;
    await db.insert(schema.users).values({
      id: actorId,
      email,
      password_hash: await hashPassword('TestPassword123!'),
      role_id: actorRoleId,
      is_active: true,
    });
    const access = await generateAccessToken(actorId, email, actorRoleId, actorRoleName);
    await db.insert(schema.sessions).values({
      user_id: actorId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });
    const authorization = `Bearer ${access.token}`;
    const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => server.inject({
      method, url, headers: { authorization }, ...(payload ? { payload } : {}),
    });

    expect((await inject('GET', '/api/v1/roles')).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/permissions/metadata')).statusCode).toBe(403);
    expect((await inject('GET', `/api/v1/roles/${allowedRoleId}`)).statusCode).toBe(200);
    expect((await inject('GET', `/api/v1/roles/${deniedRoleId}`)).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/roles', { name: `WRONG_${randomUUID()}`, permissions: { grants: [] } })).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/roles', { name: permittedName, permissions: { grants: [] } })).statusCode).toBe(201);
    expect((await inject('PUT', `/api/v1/roles/${deniedRoleId}`, { description: 'Forbidden change' })).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/roles/${deniedRoleId}`)).statusCode).toBe(403);
    expect((await inject('PUT', `/api/v1/roles/${allowedRoleId}`, { description: 'Permitted change' })).statusCode).toBe(200);
    expect((await inject('PUT', `/api/v1/roles/${guardedRoleId}`, { description: 'Still guarded' })).statusCode).toBe(200);
    expect((await inject('PUT', `/api/v1/roles/${guardedRoleId}`, { name: `ESCAPED_${guardedRoleId}` })).statusCode).toBe(403);
    const [deniedRole] = await db.select().from(schema.roles).where(eq(schema.roles.id, deniedRoleId));
    const [guardedRole] = await db.select().from(schema.roles).where(eq(schema.roles.id, guardedRoleId));
    expect(deniedRole?.description).not.toBe('Forbidden change');
    expect(guardedRole?.name).toBe(guardedRoleName);
  });

  it('keeps every built-in definition immutable without revoking sessions', async () => {
    const db = getDatabase();
    const builtInRoleNames = ['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT', 'OPERATOR'] as const;
    type BuiltInRoleName = (typeof builtInRoleNames)[number];
    const beforeByRole = new Map<BuiltInRoleName, typeof schema.roles.$inferSelect>();
    const actorByRole = new Map<BuiltInRoleName, Awaited<ReturnType<typeof createTestActor>>>();
    const sessionCountBeforeByRole = new Map<BuiltInRoleName, number>();

    for (const roleName of builtInRoleNames) {
      const role = testRoles[roleName];
      const [before] = await db.select().from(schema.roles).where(eq(schema.roles.id, role.id));
      expect(before).toBeDefined();
      beforeByRole.set(roleName, before);

      const actor = await createTestActor(roleName);
      actorByRole.set(roleName, actor);
      const [sessionCount] = await db.select({ value: count(schema.sessions.id) }).from(schema.sessions)
        .where(eq(schema.sessions.user_id, actor.id));
      sessionCountBeforeByRole.set(roleName, sessionCount.value);
    }

    const expectBuiltInStateUnchanged = async () => {
      for (const roleName of builtInRoleNames) {
        const role = testRoles[roleName];
        const [after] = await db.select().from(schema.roles).where(eq(schema.roles.id, role.id));
        expect(after).toEqual(beforeByRole.get(roleName));
        const actor = actorByRole.get(roleName);
        if (!actor) {
          throw new Error(`Missing ${roleName} actor fixture`);
        }
        const [sessionCountAfter] = await db.select({ value: count(schema.sessions.id) }).from(schema.sessions)
          .where(eq(schema.sessions.user_id, actor.id));
        expect(sessionCountAfter.value).toBe(sessionCountBeforeByRole.get(roleName));
      }
    };

    for (const roleName of builtInRoleNames) {
      const role = testRoles[roleName];
      for (const [method, payload] of [
        ['PUT', { description: 'Changed' }],
        ['DELETE', undefined],
      ] as const) {
        const response = await server.inject({
          method,
          url: `/api/v1/roles/${role.id}`,
          headers: { authorization: `Bearer ${superAdminToken}` },
          ...(payload ? { payload } : {}),
        });
        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body).error.code).toBe('SYSTEM_ROLE_IMMUTABLE');
      }
    }
    await expectBuiltInStateUnchanged();

    const operator = actorByRole.get('OPERATOR');
    if (!operator) {
      throw new Error('Missing OPERATOR actor fixture');
    }
    for (const roleName of builtInRoleNames) {
      const role = testRoles[roleName];
      for (const [method, payload] of [
        ['PUT', { description: 'Not allowed' }],
        ['DELETE', undefined],
      ] as const) {
        const unauthorized = await server.inject({
          method,
          url: `/api/v1/roles/${role.id}`,
          headers: { authorization: `Bearer ${operator.token}` },
          ...(payload ? { payload } : {}),
        });
        expect(unauthorized.statusCode).toBe(403);
      }
    }
    await expectBuiltInStateUnchanged();
  });

  it('rejects trimmed and case-insensitive built-in names for custom roles', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { name: ' operator ', permissions: { grants: [] } },
    });
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('RESERVED_ROLE_NAME');

    const created = await server.inject({
      method: 'POST', url: '/api/v1/roles',
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { name: `RENAME_CANDIDATE_${randomUUID()}`, permissions: { grants: [] } },
    });
    expect(created.statusCode).toBe(201);
    const roleId = JSON.parse(created.body).id;
    const renamed = await server.inject({
      method: 'PUT', url: `/api/v1/roles/${roleId}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { name: ' aDmIn ' },
    });
    expect(renamed.statusCode).toBe(409);
    expect(JSON.parse(renamed.body).error.code).toBe('RESERVED_ROLE_NAME');
    const [unchanged] = await getDatabase().select().from(schema.roles).where(eq(schema.roles.id, roleId));
    expect(unchanged.name).toMatch(/^RENAME_CANDIDATE_/);
  });

  it('revokes sessions for every user assigned to an updated role', async () => {
    const db = getDatabase();
    const roleId = randomUUID();
    const userId = randomUUID();
    const email = `role-revoke-${userId}@example.test`;
    await db.insert(schema.roles).values({
      id: roleId,
      name: `ROLE_REVOKE_${roleId}`,
      permissions: { grants: [{ action: 'read', subject: 'Dashboard' }] },
      is_system: false,
    });
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash: await hashPassword('Password123!'),
      role_id: roleId,
      is_active: true,
    });
    const access = await generateAccessToken(userId, email, roleId, `ROLE_REVOKE_${roleId}`);
    await db.insert(schema.sessions).values({
      user_id: userId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });

    const response = await server.inject({
      method: 'PUT',
      url: `/api/v1/roles/${roleId}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { permissions: { grants: [] } },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, userId))).toHaveLength(0);
    expect((await server.inject({ method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${access.token}` } })).statusCode).toBe(401);
  });

  it('revokes sessions for users whose role transitively inherits the updated role', async () => {
    const db = getDatabase();
    const parentRoleId = randomUUID();
    const childRoleId = randomUUID();
    const grandchildRoleId = randomUUID();
    const userId = randomUUID();
    const email = `inherited-role-revoke-${userId}@example.test`;
    await db.insert(schema.roles).values([
      {
        id: parentRoleId,
        name: `ROLE_PARENT_${parentRoleId}`,
        permissions: { grants: [{ action: 'read', subject: 'Dashboard' }] },
        is_system: false,
      },
      {
        id: childRoleId,
        name: `ROLE_CHILD_${childRoleId}`,
        permissions: { inherits: [parentRoleId], grants: [] },
        is_system: false,
      },
      {
        id: grandchildRoleId,
        name: `ROLE_GRANDCHILD_${grandchildRoleId}`,
        permissions: { inherits: [childRoleId], grants: [] },
        is_system: false,
      },
    ]);
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash: await hashPassword('Password123!'),
      role_id: grandchildRoleId,
      is_active: true,
    });
    const access = await generateAccessToken(
      userId,
      email,
      grandchildRoleId,
      `ROLE_GRANDCHILD_${grandchildRoleId}`
    );
    await db.insert(schema.sessions).values({
      user_id: userId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });

    const response = await server.inject({
      method: 'PUT',
      url: `/api/v1/roles/${parentRoleId}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
      payload: { permissions: { grants: [] } },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.OK);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, userId))).toHaveLength(0);
    expect((await server.inject({ method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${access.token}` } })).statusCode).toBe(401);
  });

  it('rejects deleting a custom role that another role inherits', async () => {
    const db = getDatabase();
    const parentRoleId = randomUUID();
    const childRoleId = randomUUID();
    await db.insert(schema.roles).values([
      {
        id: parentRoleId,
        name: `ROLE_DELETE_PARENT_${parentRoleId}`,
        permissions: { grants: [{ action: 'read', subject: 'Dashboard' }] },
        is_system: false,
      },
      {
        id: childRoleId,
        name: `ROLE_DELETE_CHILD_${childRoleId}`,
        permissions: { inherits: [parentRoleId], grants: [] },
        is_system: false,
      },
    ]);

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/v1/roles/${parentRoleId}`,
      headers: { authorization: `Bearer ${superAdminToken}` },
    });

    expect(response.statusCode).toBe(HTTP_STATUS.CONFLICT);
    expect(JSON.parse(response.body).error.details).toEqual({ inheritor_role_ids: [childRoleId] });
    expect(await db.select().from(schema.roles).where(eq(schema.roles.id, parentRoleId))).toHaveLength(1);
    expect(await db.select().from(schema.roles).where(eq(schema.roles.id, childRoleId))).toHaveLength(1);
  });

  it('repairs built-in drift once, revokes direct and transitive sessions, and leaves custom definitions unchanged', async () => {
    const db = getDatabase();
    const directActor = await createTestActor('OPERATOR');
    const roleId = randomUUID();
    const userId = randomUUID();
    const roleName = `STARTUP_INHERITOR_${roleId}`;
    const email = `startup-inheritor-${userId}@example.test`;
    const customPermissions = { inherits: [testRoles.OPERATOR.id], grants: [{ action: 'read', subject: 'Dashboard' }] };
    await db.insert(schema.roles).values({ id: roleId, name: roleName, permissions: customPermissions, is_system: false });
    await db.insert(schema.users).values({
      id: userId, email, password_hash: await hashPassword('Password123!'), role_id: roleId, is_active: true,
    });
    const access = await generateAccessToken(userId, email, roleId, roleName);
    await db.insert(schema.sessions).values({ user_id: userId, access_jti: access.jti, expires_at: access.expiresAt });
    const [customBefore] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));

    await db.update(schema.roles).set({ permissions: { grants: [] } })
      .where(eq(schema.roles.id, testRoles.OPERATOR.id));
    const invalidated = await syncSystemRolePermissions();
    expect(invalidated).toContain(directActor.id);
    expect(invalidated).toContain(userId);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, directActor.id))).toHaveLength(0);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, userId))).toHaveLength(0);
    const [operator] = await db.select().from(schema.roles).where(eq(schema.roles.id, testRoles.OPERATOR.id));
    const [customAfter] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
    expect(operator?.is_system).toBe(true);
    expect(operator?.permissions).toEqual(SYSTEM_ROLE_DEFAULTS.OPERATOR);
    expect(customAfter?.permissions).toEqual(customBefore?.permissions);
    expect(customAfter?.updated_at).toEqual(customBefore?.updated_at);
    expect(await syncSystemRolePermissions()).toEqual([]);
    const [operatorAfterSecondSync] = await db.select().from(schema.roles).where(eq(schema.roles.id, testRoles.OPERATOR.id));
    expect(operatorAfterSecondSync?.updated_at).toEqual(operator?.updated_at);
  });

  it('stops startup reconciliation when a built-in name is attached to a non-system role', async () => {
    const db = getDatabase();
    const [operatorBefore] = await db.select().from(schema.roles).where(eq(schema.roles.id, testRoles.OPERATOR.id));
    const [departmentBefore] = await db.select().from(schema.roles).where(eq(schema.roles.id, testRoles.DEPARTMENT.id));
    if (!operatorBefore || !departmentBefore) throw new Error('Missing seeded system role');
    const directActor = await createTestActor('OPERATOR');
    try {
      await db.update(schema.roles).set({ is_system: false }).where(eq(schema.roles.id, operatorBefore.id));
      await db.update(schema.roles).set({ permissions: { grants: [] } }).where(eq(schema.roles.id, departmentBefore.id));

      await expect(syncSystemRolePermissions()).rejects.toThrow(
        `SYSTEM_ROLE_IDENTITY_CONFLICT: role OPERATOR (${operatorBefore.id})`
      );
      const [operatorAfter] = await db.select().from(schema.roles).where(eq(schema.roles.id, operatorBefore.id));
      const [departmentAfter] = await db.select().from(schema.roles).where(eq(schema.roles.id, departmentBefore.id));
      expect(operatorAfter?.is_system).toBe(false);
      expect(departmentAfter?.permissions).toEqual({ grants: [] });
      expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, directActor.id))).toHaveLength(1);
    } finally {
      await db.update(schema.roles).set({
        is_system: operatorBefore.is_system,
        permissions: operatorBefore.permissions,
        updated_at: operatorBefore.updated_at,
      }).where(eq(schema.roles.id, operatorBefore.id));
      await db.update(schema.roles).set({
        is_system: departmentBefore.is_system,
        permissions: departmentBefore.permissions,
        updated_at: departmentBefore.updated_at,
      }).where(eq(schema.roles.id, departmentBefore.id));
    }
  });

  it.each([false, true])(
    'stops startup reconciliation for a reserved case/space variant with is_system=%s',
    async (isSystem) => {
      const db = getDatabase();
      const roleId = randomUUID();
      const name = ' admin ';
      const [operatorBefore] = await db.select().from(schema.roles).where(eq(schema.roles.id, testRoles.OPERATOR.id));
      if (!operatorBefore) throw new Error('Missing seeded system role');
      try {
        await db.insert(schema.roles).values({ id: roleId, name, permissions: { grants: [] }, is_system: isSystem });
        await db.update(schema.roles).set({ permissions: { grants: [] } }).where(eq(schema.roles.id, operatorBefore.id));
        await expect(syncSystemRolePermissions()).rejects.toThrow(
          `SYSTEM_ROLE_IDENTITY_CONFLICT: role ${name} (${roleId})`
        );
        const [operatorAfter] = await db.select().from(schema.roles).where(eq(schema.roles.id, operatorBefore.id));
        expect(operatorAfter?.permissions).toEqual({ grants: [] });
      } finally {
        await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
        await db.update(schema.roles).set({
          permissions: operatorBefore.permissions,
          updated_at: operatorBefore.updated_at,
        }).where(eq(schema.roles.id, operatorBefore.id));
      }
    },
  );
});
