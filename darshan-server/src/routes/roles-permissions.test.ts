import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { getDatabase, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { hashPassword } from '@/auth/password';

describe('Role and permission routes', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await generateTestToken(testUser.id, 'ADMIN');
    superAdminToken = await generateTestToken(testUser.id, 'SUPER_ADMIN');
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
    expect(JSON.parse(superAdminResponse.body).name).toBe(createPayload.name);
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
    expect(JSON.parse(response.body).details).toEqual({ inheritor_role_ids: [childRoleId] });
    expect(await db.select().from(schema.roles).where(eq(schema.roles.id, parentRoleId))).toHaveLength(1);
    expect(await db.select().from(schema.roles).where(eq(schema.roles.id, childRoleId))).toHaveLength(1);
  });
});
