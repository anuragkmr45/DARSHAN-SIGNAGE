import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer, testUser, testRoles, closeTestServer, createTestActor, generateTestToken } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { getDatabase, schema } from '@/db';
import { eq } from 'drizzle-orm';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '@/auth/password';
import { getRealtimeFanoutState } from '@/realtime/realtime-fanout';

const { abortMultipartUploadMock, deleteObjectMock } = vi.hoisted(() => ({
  abortMultipartUploadMock: vi.fn(),
  deleteObjectMock: vi.fn(),
}));

vi.mock('@/s3', async () => {
  const actual = await vi.importActual<typeof import('@/s3')>('@/s3');
  return {
    ...actual,
    abortMultipartUpload: abortMultipartUploadMock,
    deleteObject: deleteObjectMock,
  };
});

async function issueCustomActor(
  grants: Array<{ action: string; subject: string; conditions?: Record<string, string> }>,
  departmentId?: string,
  inherits: string[] = []
) {
  const db = getDatabase();
  const roleId = randomUUID();
  const actorId = randomUUID();
  const email = `manager-${actorId}@example.test`;
  await db.insert(schema.roles).values({
    id: roleId,
    name: `CUSTOM_MANAGER_${roleId}`,
    permissions: { grants, inherits },
    is_system: false,
  });
  await db.insert(schema.users).values({
    id: actorId,
    email,
    password_hash: await hashPassword('TestPassword123!'),
    role_id: roleId,
    department_id: departmentId,
    is_active: true,
  });
  const access = await generateAccessToken(actorId, email, roleId, `CUSTOM_MANAGER_${roleId}`, departmentId);
  await createSessionRepository().create({ user_id: actorId, access_jti: access.jti, expires_at: access.expiresAt });
  return { id: actorId, token: access.token, roleId };
}

async function issueAdminToken() {
  return generateTestToken(testUser.id, 'ADMIN');
}

async function issueSuperAdminToken() {
  return (await createTestActor('SUPER_ADMIN')).token;
}

async function getRoleIdByName(name: string) {
  const db = getDatabase();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, name)).limit(1);
  if (!role) {
    throw new Error(`${name} role is required for users route tests`);
  }
  return role.id;
}

describe('User Routes', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await issueAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('lets a custom global User manager administer accounts without Role read permission', async () => {
    const db = getDatabase();
    const [department] = await db.insert(schema.departments).values({ name: `Global target ${randomUUID()}` }).returning();
    const actor = await issueCustomActor([{ action: 'manage', subject: 'User' }]);
    const deniedCatalog = await server.inject({
      method: 'GET', url: '/api/v1/roles', headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(deniedCatalog.statusCode).toBe(403);
    const options = await server.inject({
      method: 'GET', url: '/api/v1/users/management-options', headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(options.statusCode).toBe(200);
    const managementOptions = JSON.parse(options.body) as {
      roles: Array<{ id: string; name: string }>;
      departments: Array<{ id: string; name: string }>;
      is_global_user_manager: boolean;
    };
    expect(managementOptions.is_global_user_manager).toBe(true);
    expect(managementOptions.roles.map((role) => role.name)).toEqual(
      expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'DEPARTMENT', 'OPERATOR', `CUSTOM_MANAGER_${actor.roleId}`])
    );
    expect(managementOptions.roles.every((role) => Object.keys(role).sort().join(',') === 'id,name')).toBe(true);
    expect(managementOptions.departments.every((departmentOption) =>
      Object.keys(departmentOption).sort().join(',') === 'id,name')).toBe(true);
    const adminRoleId = await getRoleIdByName('ADMIN');
    const targetEmail = `global-target-${randomUUID()}@example.test`;
    const created = await server.inject({
      method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${actor.token}` },
      payload: {
        email: targetEmail, password: 'Password123!',
        role_id: adminRoleId, department_id: department.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const targetId = JSON.parse(created.body).id;
    const targetAccess = await generateAccessToken(targetId, targetEmail, adminRoleId, 'ADMIN', department.id);
    await createSessionRepository().create({
      user_id: targetId,
      access_jti: targetAccess.jti,
      expires_at: targetAccess.expiresAt,
    });
    const customCreated = await server.inject({
      method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${actor.token}` },
      payload: { email: `global-custom-${randomUUID()}@example.test`, password: 'Password123!',
        role_id: actor.roleId, department_id: department.id },
    });
    expect(customCreated.statusCode).toBe(201);
    const customTargetId = JSON.parse(customCreated.body).id;
    const unchangedDepartment = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${customTargetId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { first_name: 'Still assigned' },
    });
    expect(unchangedDepartment.statusCode).toBe(200);
    expect(JSON.parse(unchangedDepartment.body).department_id).toBe(department.id);
    const clearedDepartment = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${customTargetId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { department_id: null },
    });
    expect(clearedDepartment.statusCode).toBe(200);
    expect(JSON.parse(clearedDepartment.body).department_id).toBeNull();
    const [unassigned] = await db.select().from(schema.users).where(eq(schema.users.id, customTargetId));
    expect(unassigned.department_id).toBeNull();

    // Keep an independent usable SUPER_ADMIN so deleting the target below
    // exercises global User management rather than the last-admin safeguard.
    await createTestActor('SUPER_ADMIN');
    const lifecycleTargets = [{ name: 'CUSTOM', id: customTargetId }];
    for (const roleName of ['SUPER_ADMIN', 'DEPARTMENT', 'OPERATOR'] as const) {
      const lifecycleTarget = await server.inject({
        method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${actor.token}` },
        payload: {
          email: `global-${roleName.toLowerCase()}-${randomUUID()}@example.test`,
          password: 'Password123!',
          role_id: await getRoleIdByName(roleName),
          department_id: department.id,
        },
      });
      expect(lifecycleTarget.statusCode).toBe(201);
      lifecycleTargets.push({ name: roleName, id: JSON.parse(lifecycleTarget.body).id });
    }
    for (const lifecycleTarget of lifecycleTargets) {
      const updated = await server.inject({
        method: 'PATCH', url: `/api/v1/users/${lifecycleTarget.id}`,
        headers: { authorization: `Bearer ${actor.token}` }, payload: { first_name: lifecycleTarget.name },
      });
      expect(updated.statusCode).toBe(200);
      const deleted = await server.inject({
        method: 'DELETE', url: `/api/v1/users/${lifecycleTarget.id}`,
        headers: { authorization: `Bearer ${actor.token}` },
      });
      expect(deleted.statusCode).toBe(200);
    }

    const disabled = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${targetId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { is_active: false },
    });
    expect(disabled.statusCode).toBe(200);
    const inactive = await server.inject({
      method: 'GET', url: `/api/v1/users?is_active=false&department_id=${department.id}`, headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(JSON.parse(inactive.body).items.some((user: { id: string }) => user.id === targetId)).toBe(true);
    const reactivated = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${targetId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { is_active: true },
    });
    expect(reactivated.statusCode).toBe(200);
    expect(JSON.parse(reactivated.body).is_active).toBe(true);
    const active = await server.inject({
      method: 'GET', url: `/api/v1/users?is_active=true&department_id=${department.id}`,
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(JSON.parse(active.body).items.some((user: { id: string }) => user.id === targetId)).toBe(true);
    expect((await server.inject({
      method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${targetAccess.token}` },
    })).statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('restricts a custom scoped manager to active operators in its own department', async () => {
    const db = getDatabase();
    const [departmentA, departmentB] = await db.insert(schema.departments).values([
      { name: `Scope A ${randomUUID()}` }, { name: `Scope B ${randomUUID()}` },
    ]).returning();
    const actor = await issueCustomActor([
      { action: 'read', subject: 'User' },
      { action: 'create', subject: 'User' },
      { action: 'update', subject: 'User' },
      { action: 'delete', subject: 'User' },
    ], departmentA.id);
    const options = await server.inject({
      method: 'GET', url: '/api/v1/users/management-options', headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(JSON.parse(options.body).roles.map((role: { name: string }) => role.name)).toEqual(['OPERATOR']);
    expect(JSON.parse(options.body).roles[0]).toEqual({ id: await getRoleIdByName('OPERATOR'), name: 'OPERATOR' });
    expect(JSON.parse(options.body).departments.map((department: { id: string }) => department.id)).toEqual([departmentA.id]);
    expect(JSON.parse(options.body).departments[0]).toEqual({ id: departmentA.id, name: departmentA.name });

    const create = (roleId: string, departmentId: string) => server.inject({
      method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${actor.token}` },
      payload: { email: `scoped-${randomUUID()}@example.test`, password: 'Password123!',
        role_id: roleId, department_id: departmentId },
    });
    const operatorRoleId = await getRoleIdByName('OPERATOR');
    const own = await create(operatorRoleId, departmentA.id);
    expect(own.statusCode).toBe(201);
    expect((await create(operatorRoleId, departmentB.id)).statusCode).toBe(403);
    expect((await create(actor.roleId, departmentA.id)).statusCode).toBe(403);
    const otherId = randomUUID();
    const otherEmail = `cross-department-${otherId}@example.test`;
    await db.insert(schema.users).values({ id: otherId, email: otherEmail, password_hash: 'not-used',
      role_id: operatorRoleId, department_id: departmentB.id, is_active: true });
    const otherAccess = await generateAccessToken(otherId, otherEmail, operatorRoleId, 'OPERATOR', departmentB.id);
    await createSessionRepository().create({ user_id: otherId, access_jti: otherAccess.jti, expires_at: otherAccess.expiresAt });
    const [beforeCross] = await db.select().from(schema.users).where(eq(schema.users.id, otherId));
    for (const [method, url, payload] of [
      ['PATCH', `/api/v1/users/${otherId}`, { first_name: 'Forged' }],
      ['DELETE', `/api/v1/users/${otherId}`, undefined],
      ['POST', `/api/v1/users/${otherId}/reset-password`, undefined],
    ] as const) {
      const denied = await server.inject({ method, url,
        headers: { authorization: `Bearer ${actor.token}` }, ...(payload ? { payload } : {}) });
      expect(denied.statusCode).toBe(403);
    }
    const [afterCross] = await db.select().from(schema.users).where(eq(schema.users.id, otherId));
    expect(afterCross.updated_at).toEqual(beforeCross.updated_at);
    expect(afterCross.deleted_at).toBeNull();
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.access_jti, otherAccess.jti)))
      .toHaveLength(1);
    const ownId = JSON.parse(own.body).id;
    const privileged = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${ownId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { role_id: actor.roleId },
    });
    expect(privileged.statusCode).toBe(403);
    const unassign = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${ownId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { department_id: null },
    });
    expect(unassign.statusCode).toBe(403);
    const [stillScoped] = await db.select().from(schema.users).where(eq(schema.users.id, ownId));
    expect(stillScoped.department_id).toBe(departmentA.id);
    const disabled = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${ownId}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { is_active: false },
    });
    expect(disabled.statusCode).toBe(200);
    const invisible = await server.inject({
      method: 'GET', url: '/api/v1/users?is_active=false', headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(JSON.parse(invisible.body).pagination.total).toBe(0);
    const direct = await server.inject({
      method: 'GET', url: `/api/v1/users/${ownId}`, headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(direct.statusCode).toBe(404);

    const deletable = await create(operatorRoleId, departmentA.id);
    expect(deletable.statusCode).toBe(201);
    const deletableId = JSON.parse(deletable.body).id;
    const firstDelete = await server.inject({
      method: 'DELETE', url: `/api/v1/users/${deletableId}`, headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(firstDelete.statusCode).toBe(200);
    const hiddenRepeat = await server.inject({
      method: 'DELETE', url: `/api/v1/users/${deletableId}`, headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(hiddenRepeat.statusCode).toBe(404);
  });

  it('keeps a departmentless non-global manager self-only with no assignable options', async () => {
    const actor = await issueCustomActor([
      { action: 'read', subject: 'User' },
      { action: 'create', subject: 'User' },
    ]);

    const options = await server.inject({
      method: 'GET', url: '/api/v1/users/management-options',
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(options.statusCode).toBe(200);
    expect(JSON.parse(options.body)).toEqual({
      roles: [],
      departments: [],
      is_global_user_manager: false,
    });

    const directory = await server.inject({
      method: 'GET', url: '/api/v1/users?limit=100',
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(directory.statusCode).toBe(200);
    expect(JSON.parse(directory.body).items.map((user: { id: string }) => user.id)).toEqual([actor.id]);
    expect(JSON.parse(directory.body).pagination.total).toBe(1);

    const self = await server.inject({
      method: 'GET', url: `/api/v1/users/${actor.id}`,
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(self.statusCode).toBe(200);
    const hiddenPeer = await server.inject({
      method: 'GET', url: `/api/v1/users/${testUser.id}`,
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(hiddenPeer.statusCode).toBe(404);

    const deniedCreate = await server.inject({
      method: 'POST', url: '/api/v1/users',
      headers: { authorization: `Bearer ${actor.token}` },
      payload: {
        email: `departmentless-target-${randomUUID()}@example.test`,
        password: 'Password123!',
        role_id: testRoles.OPERATOR.id,
      },
    });
    expect(deniedCreate.statusCode).toBe(403);
  });

  it('keeps conditional manage User scoped and rejects missing condition context', async () => {
    const db = getDatabase();
    const [departmentA, departmentB] = await db.insert(schema.departments).values([
      { name: `Conditional A ${randomUUID()}` }, { name: `Conditional B ${randomUUID()}` },
    ]).returning();
    const grant = { action: 'manage', subject: 'User', conditions: { department_id: '$user.department_id' } };
    const actor = await issueCustomActor([grant], departmentA.id);
    const noDepartment = await issueCustomActor([grant]);
    const scopedOptions = await server.inject({
      method: 'GET', url: '/api/v1/users/management-options',
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(scopedOptions.statusCode).toBe(200);
    expect(JSON.parse(scopedOptions.body).is_global_user_manager).toBe(false);
    expect(JSON.parse(scopedOptions.body).roles.map((role: { name: string }) => role.name)).toEqual(['OPERATOR']);

    const create = (departmentId: string) => server.inject({
      method: 'POST', url: '/api/v1/users', headers: { authorization: `Bearer ${actor.token}` },
      payload: { email: `conditional-${randomUUID()}@example.test`, password: 'Password123!',
        role_id: testRoles.OPERATOR.id, department_id: departmentId },
    });
    expect((await create(departmentA.id)).statusCode).toBe(201);
    expect((await create(departmentB.id)).statusCode).toBe(403);
    const missingContext = await server.inject({
      method: 'GET', url: '/api/v1/users',
      headers: { authorization: `Bearer ${noDepartment.token}` },
    });
    expect(missingContext.statusCode).toBe(403);
  });

  it('rejects an update that moves an operator outside a conditional User grant', async () => {
    const db = getDatabase();
    const [department] = await db.insert(schema.departments)
      .values({ name: `Conditional update ${randomUUID()}` }).returning();
    const actor = await issueCustomActor([
      { action: 'update', subject: 'User', conditions: { first_name: 'Allowed' } },
    ], department.id);
    const id = randomUUID();
    const email = `conditional-update-${id}@example.test`;
    await db.insert(schema.users).values({
      id, email, password_hash: 'not-used', first_name: 'Allowed',
      role_id: testRoles.OPERATOR.id, department_id: department.id, is_active: true,
    });
    const targetAccess = await generateAccessToken(id, email, testRoles.OPERATOR.id, 'OPERATOR', department.id);
    await createSessionRepository().create({
      user_id: id, access_jti: targetAccess.jti, expires_at: targetAccess.expiresAt,
    });

    const denied = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${id}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { first_name: 'Outside grant' },
    });
    expect(denied.statusCode).toBe(403);
    const [unchanged] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(unchanged.first_name).toBe('Allowed');
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.access_jti, targetAccess.jti)))
      .toHaveLength(1);

    const allowed = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${id}`,
      headers: { authorization: `Bearer ${actor.token}` }, payload: { last_name: 'Still allowed' },
    });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body).first_name).toBe('Allowed');
  });

  it('keeps a committed account change successful if the post-commit broadcast throws', async () => {
    const db = getDatabase();
    const id = randomUUID();
    const email = `broadcast-failure-${id}@example.test`;
    await db.insert(schema.users).values({
      id, email, password_hash: 'not-used', role_id: testRoles.OPERATOR.id, is_active: true,
    });
    const targetAccess = await generateAccessToken(id, email, testRoles.OPERATOR.id, 'OPERATOR');
    await createSessionRepository().create({
      user_id: id, access_jti: targetAccess.jti, expires_at: targetAccess.expiresAt,
    });
    const publish = vi.spyOn(getRealtimeFanoutState().bus, 'publishBroadcast')
      .mockRejectedValue(new Error('test publish exception'));
    try {
      const response = await server.inject({
        method: 'PATCH', url: `/api/v1/users/${id}`,
        headers: { authorization: `Bearer ${adminToken}` }, payload: { first_name: 'Committed' },
      });
      expect(response.statusCode).toBe(200);
      const [updated] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      expect(updated.first_name).toBe('Committed');
      expect(await db.select().from(schema.sessions).where(eq(schema.sessions.access_jti, targetAccess.jti)))
        .toHaveLength(0);
      expect(publish).toHaveBeenCalledTimes(1);
    } finally {
      publish.mockRestore();
    }
  });

  it('preserves distinct inherited record grants before directory pagination', async () => {
    const db = getDatabase();
    const [department] = await db.insert(schema.departments).values({ name: `Inherited ${randomUUID()}` }).returning();
    const roleById = randomUUID();
    const roleByType = randomUUID();
    await db.insert(schema.roles).values([
      { id: roleById, name: `READ_SELF_${roleById}`, is_system: false,
        permissions: { grants: [{ action: 'read', subject: 'User', conditions: { id: '$user.id' } }] } },
      { id: roleByType, name: `READ_OPERATORS_${roleByType}`, is_system: false,
        permissions: { grants: [{ action: 'read', subject: 'User', conditions: { role_id: testRoles.OPERATOR.id } }] } },
    ]);
    const actor = await issueCustomActor([], department.id, [roleById, roleByType]);
    const peerId = randomUUID();
    const otherId = randomUUID();
    await db.insert(schema.users).values([
      { id: peerId, email: `inherited-peer-${peerId}@example.test`, password_hash: 'not-used',
        role_id: testRoles.OPERATOR.id, department_id: department.id, is_active: true },
      { id: otherId, email: `inherited-other-${otherId}@example.test`, password_hash: 'not-used',
        role_id: testRoles.OPERATOR.id, is_active: true },
    ]);
    const listed = await server.inject({
      method: 'GET', url: '/api/v1/users?page=1&limit=100',
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(listed.statusCode).toBe(200);
    const body = JSON.parse(listed.body);
    expect(body.items.map((user: { id: string }) => user.id)).toEqual(expect.arrayContaining([actor.id, peerId]));
    expect(body.items.some((user: { id: string }) => user.id === otherId)).toBe(false);
    expect(body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it('keeps pending invitations out of scoped people directories but available to invitation managers', async () => {
    const db = getDatabase();
    const [department] = await db.insert(schema.departments)
      .values({ name: `Invitation directory ${randomUUID()}` }).returning();
    const actor = await issueCustomActor([{ action: 'read', subject: 'User' }], department.id);
    const pendingId = randomUUID();
    const activatedId = randomUUID();
    await db.insert(schema.users).values([
      {
        id: pendingId,
        email: `pending-directory-${pendingId}@example.test`,
        password_hash: 'not-used',
        role_id: testRoles.OPERATOR.id,
        department_id: department.id,
        is_active: true,
        ext: {
          invite_status: 'PENDING',
          invite_token: 'a'.repeat(32),
          invite_expires_at: new Date(Date.now() + 60_000).toISOString(),
          invited_at: new Date().toISOString(),
        },
      },
      {
        id: activatedId,
        email: `activated-directory-${activatedId}@example.test`,
        password_hash: 'not-used',
        role_id: testRoles.OPERATOR.id,
        department_id: department.id,
        is_active: true,
        ext: { invite_status: 'ACTIVATED', invite_token: null },
      },
    ]);

    const scopedList = await server.inject({
      method: 'GET', url: '/api/v1/users?limit=100',
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(scopedList.statusCode).toBe(200);
    const scopedIds = JSON.parse(scopedList.body).items.map((user: { id: string }) => user.id);
    expect(scopedIds).toContain(activatedId);
    expect(scopedIds).not.toContain(pendingId);

    const hiddenDetail = await server.inject({
      method: 'GET', url: `/api/v1/users/${pendingId}`,
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(hiddenDetail.statusCode).toBe(404);

    const invitationList = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=pending&limit=100',
      headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(invitationList.statusCode).toBe(200);
    expect(JSON.parse(invitationList.body).items.map((user: { id: string }) => user.id)).toContain(pendingId);

    const globalList = await server.inject({
      method: 'GET', url: `/api/v1/users?department_id=${department.id}&limit=100`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(globalList.statusCode).toBe(200);
    expect(JSON.parse(globalList.body).items.map((user: { id: string }) => user.id)).toContain(pendingId);
  });

  it('rejects a malformed UUID directory grant without issuing an invalid SQL query', async () => {
    const actor = await issueCustomActor([
      { action: 'read', subject: 'User', conditions: { role_id: 'not-a-uuid' } },
    ]);
    const list = await server.inject({
      method: 'GET', url: '/api/v1/users', headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(list.statusCode).toBe(403);
    const detail = await server.inject({
      method: 'GET', url: `/api/v1/users/${actor.id}`, headers: { authorization: `Bearer ${actor.token}` },
    });
    expect(detail.statusCode).toBe(404);
  });

  describe('POST /api/v1/users', () => {
    it('should return 401 without authorization', async () => {
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        payload: {
          email: 'newuser@example.com',
          password: 'Password123!',
          first_name: 'New',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should create user with valid admin token', async () => {
      const uniqueEmail = `newuser+${Date.now()}@example.com`;
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: uniqueEmail,
          password: 'Password123!',
          first_name: 'New',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('id');
      expect(body.email).toBe(uniqueEmail);
      expect(body.role_id).toBe(operatorRoleId);
    });

    it('rejects nonexistent department IDs on create and update without changing an account or session', async () => {
      const db = getDatabase();
      const missingDepartmentId = randomUUID();
      const deniedEmail = `missing-dept-${randomUUID()}@example.test`;
      const createPayload = {
        email: deniedEmail,
        password: 'Password123!',
        role_id: testRoles.OPERATOR.id,
        department_id: missingDepartmentId,
      };
      const deniedCreate = await server.inject({
        method: 'POST', url: '/api/v1/users',
        headers: { authorization: `Bearer ${adminToken}` }, payload: createPayload,
      });
      expect(deniedCreate.statusCode).toBe(404);
      expect(JSON.parse(deniedCreate.body).error.code).toBe('NOT_FOUND');
      expect(await db.select().from(schema.users).where(eq(schema.users.email, deniedEmail))).toHaveLength(0);

      const email = `existing-dept-${randomUUID()}@example.test`;
      const created = await server.inject({
        method: 'POST', url: '/api/v1/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email, password: 'Password123!', role_id: testRoles.OPERATOR.id },
      });
      expect(created.statusCode).toBe(201);
      const userId = JSON.parse(created.body).id as string;
      const access = await generateAccessToken(userId, email, testRoles.OPERATOR.id, 'OPERATOR');
      await createSessionRepository().create({ user_id: userId, access_jti: access.jti, expires_at: access.expiresAt });
      const [before] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      const deniedUpdate = await server.inject({
        method: 'PATCH', url: `/api/v1/users/${userId}`,
        headers: { authorization: `Bearer ${adminToken}` }, payload: { department_id: missingDepartmentId },
      });
      expect(deniedUpdate.statusCode).toBe(404);
      expect(JSON.parse(deniedUpdate.body).error.code).toBe('NOT_FOUND');
      const [after] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(after.department_id).toBeNull();
      expect(after.updated_at).toEqual(before.updated_at);
      expect(await db.select().from(schema.sessions).where(eq(schema.sessions.access_jti, access.jti)))
        .toHaveLength(1);
    });

    it('allows SUPER_ADMIN to create a DEPARTMENT user', async () => {
      const token = await issueSuperAdminToken();
      const departmentRoleId = await getRoleIdByName('DEPARTMENT');
      const db = getDatabase();
      const [department] = await db
        .insert(schema.departments)
        .values({ name: `Super Admin Managed ${Date.now()}` })
        .returning();
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          email: `super-admin-department-${Date.now()}@example.com`,
          password: 'Password123!',
          first_name: 'Department',
          last_name: 'Lead',
          role_id: departmentRoleId,
          department_id: department.id,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.CREATED);
      expect(JSON.parse(response.body)).toMatchObject({
        role: 'DEPARTMENT',
        department_id: department.id,
      });
    });

    it('should return 422 for invalid email', async () => {
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: 'invalid-email',
          password: 'Password123!',
          first_name: 'New',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNPROCESSABLE_CONTENT);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/users', () => {
    it('should return 401 without authorization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should list users with valid token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.items)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users?page=1&limit=10',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
    });

    it('should filter users by role name in the database query', async () => {
      const operatorEmail = `operator-${Date.now()}@example.com`;
      const adminEmail = `admin-${Date.now()}@example.com`;
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const adminRoleId = await getRoleIdByName('ADMIN');

      await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: operatorEmail,
          password: 'Password123!',
          first_name: 'Operator',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: adminEmail,
          password: 'Password123!',
          first_name: 'Admin',
          last_name: 'User',
          role_id: adminRoleId,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users?role=OPERATOR',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.items.some((user: any) => user.email === operatorEmail)).toBe(true);
      expect(body.items.some((user: any) => user.email === adminEmail)).toBe(false);
      expect(body.items.every((user: any) => user.role === 'OPERATOR')).toBe(true);
    });

  });

  describe('GET /api/v1/users/:id', () => {
    it('should return 401 without authorization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/users/${testUser.id}`,
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/users/00000000-0000-0000-0000-000000000099',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    });

    it('should get user by ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/v1/users/${testUser.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(testUser.id);
    });
  });

  describe('DELETE /api/v1/users/:id', () => {
    it('allows deleting a SUPER_ADMIN when another active SUPER_ADMIN remains', async () => {
      const superAdminRoleId = await getRoleIdByName('SUPER_ADMIN');
      const db = getDatabase();
      const actorId = randomUUID();
      const actorEmail = `surviving-super-admin-${actorId}@example.test`;
      await db.insert(schema.users).values({
        id: actorId,
        email: actorEmail,
        password_hash: 'not-used',
        first_name: 'Surviving',
        last_name: 'Administrator',
        role_id: superAdminRoleId,
        is_active: true,
      });
      const actorToken = await generateAccessToken(
        actorId,
        actorEmail,
        superAdminRoleId,
        'SUPER_ADMIN'
      );
      await createSessionRepository().create({
        user_id: actorId,
        access_jti: actorToken.jti,
        expires_at: actorToken.expiresAt,
      });
      const [target] = await db
        .insert(schema.users)
        .values({
          email: `protected-super-admin-${Date.now()}@example.com`,
          password_hash: 'not-used',
          first_name: 'Protected',
          last_name: 'Administrator',
          role_id: superAdminRoleId,
          is_active: true,
        })
        .returning();

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/users/${target.id}`,
        headers: { authorization: `Bearer ${actorToken.token}` },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const [deleted] = await db.select().from(schema.users).where(eq(schema.users.id, target.id));
      expect(deleted?.deleted_at).toBeInstanceOf(Date);
      expect(deleted?.is_active).toBe(false);
    });

    it('tombstones the account while preserving linked history and revoking its session', async () => {
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const originalEmail = `delete-linked-${Date.now()}@example.com`;
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          email: originalEmail,
          password: 'Password123!',
          first_name: 'Participant',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });

      expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
      const createdUser = JSON.parse(createResponse.body) as { id: string };
      const db = getDatabase();
      const [conversation] = await db
        .insert(schema.chatConversations)
        .values({
          type: 'GROUP_CLOSED',
          title: 'Delete Reference Test',
          created_by: testUser.id,
        })
        .returning();

      await db.insert(schema.chatMembers).values({
        conversation_id: conversation.id,
        user_id: createdUser.id,
        role: 'MEMBER',
      });
      const [processingMedia, completedMedia] = await db
        .insert(schema.media)
        .values([
          {
            name: 'Processing document at deletion',
            type: 'DOCUMENT',
            status: 'PROCESSING',
            created_by: createdUser.id,
            owner_scope: 'RESTRICTED',
          },
          {
            name: 'Completed media retained after deletion',
            type: 'IMAGE',
            status: 'READY',
            created_by: createdUser.id,
            owner_scope: 'RESTRICTED',
          },
        ])
        .returning();

      const targetAccess = await generateAccessToken(
        createdUser.id,
        `delete-linked-${Date.now()}@example.com`,
        operatorRoleId,
        'OPERATOR'
      );
      await createSessionRepository().create({
        user_id: createdUser.id,
        access_jti: targetAccess.jti,
        expires_at: targetAccess.expiresAt,
      });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/v1/users/${createdUser.id}`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body.already_deleted).toBe(false);

      const [deletedUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, createdUser.id));
      expect(deletedUser?.deleted_at).toBeInstanceOf(Date);
      expect(deletedUser?.email).toBe(`deleted+${createdUser.id}@deleted.invalid`);
      expect(deletedUser?.first_name).toBe('Participant');
      expect(deletedUser?.last_name).toBe('User');

      const [stoppedProcessingMedia, retainedCompletedMedia] = await Promise.all([
        db.select().from(schema.media).where(eq(schema.media.id, processingMedia.id)).then((rows) => rows[0]),
        db.select().from(schema.media).where(eq(schema.media.id, completedMedia.id)).then((rows) => rows[0]),
      ]);
      expect(stoppedProcessingMedia).toMatchObject({
        status: 'FAILED',
        status_reason: 'USER_DELETED_CLEANUP_PENDING',
        created_by: createdUser.id,
        owner_scope: 'RESTRICTED',
      });
      expect(retainedCompletedMedia).toMatchObject({
        status: 'READY',
        created_by: createdUser.id,
        owner_scope: 'RESTRICTED',
      });

      const [preservedMembership] = await db
        .select()
        .from(schema.chatMembers)
        .where(eq(schema.chatMembers.user_id, createdUser.id));
      expect(preservedMembership?.conversation_id).toBe(conversation.id);

      const revokedResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${targetAccess.token}` },
      });
      expect(revokedResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

      const secondDelete = await server.inject({
        method: 'DELETE',
        url: `/api/v1/users/${createdUser.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(secondDelete.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(secondDelete.body)).toMatchObject({
        id: createdUser.id,
        already_deleted: true,
        aborted_uploads: 0,
        cleaned_uploads: 0,
      });
      const deletionAudit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entity_id, createdUser.id));
      expect(deletionAudit.filter((row) => row.action === 'USER_DELETED')).toHaveLength(1);

      const listResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/users?page=1&limit=100',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(listResponse.body).items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: createdUser.id })])
      );

      const deletedDetail = await server.inject({
        method: 'GET',
        url: `/api/v1/users/${createdUser.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(deletedDetail.statusCode).toBe(HTTP_STATUS.NOT_FOUND);

      const emailReuse = await server.inject({
        method: 'POST',
        url: '/api/v1/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: originalEmail,
          password: 'Password123!',
          first_name: 'Replacement',
          last_name: 'User',
          role_id: operatorRoleId,
        },
      });
      expect(emailReuse.statusCode).toBe(HTTP_STATUS.CREATED);
      expect(JSON.parse(emailReuse.body).email).toBe(originalEmail);

      const deletionAudits = await db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.entity_id, createdUser.id));
      expect(deletionAudits.filter((entry) => entry.action === 'USER_DELETED')).toHaveLength(1);
    });

    it('invalidates sessions before object cleanup and keeps failed cleanup retryable', async () => {
      const db = getDatabase();
      const operatorRoleId = await getRoleIdByName('OPERATOR');
      const targetId = randomUUID();
      const mediaId = randomUUID();
      const uploadSessionId = randomUUID();
      const email = `delete-cleanup-failure-${targetId}@example.test`;
      await db.insert(schema.users).values({
        id: targetId,
        email,
        password_hash: await hashPassword('Password123!'),
        role_id: operatorRoleId,
        is_active: true,
      });
      const targetAccess = await generateAccessToken(targetId, email, operatorRoleId, 'OPERATOR');
      await createSessionRepository().create({
        user_id: targetId,
        access_jti: targetAccess.jti,
        expires_at: targetAccess.expiresAt,
      });
      await db.insert(schema.media).values({
        id: mediaId,
        name: 'Deletion cleanup failure fixture',
        type: 'VIDEO',
        status: 'PROCESSING',
        created_by: targetId,
        owner_scope: 'RESTRICTED',
      });
      await db.insert(schema.mediaUploadSessions).values({
        id: uploadSessionId,
        media_id: mediaId,
        created_by: targetId,
        idempotency_key: `delete-cleanup-${uploadSessionId}`,
        state: 'ACTIVE',
        strategy: 'multipart',
        original_filename: 'unfinished.mp4',
        display_name: 'Unfinished upload',
        content_type: 'video/mp4',
        expected_size: 1024,
        checksum_sha256: 'a'.repeat(64),
        part_size: 1024,
        staging_bucket: 'media-staging',
        staging_object_key: `staging/${uploadSessionId}.mp4`,
        canonical_bucket: 'media-source',
        canonical_object_key: `source/${mediaId}.mp4`,
        multipart_upload_id: `multipart-${uploadSessionId}`,
        expires_at: new Date(Date.now() + 60_000),
      });

      const events: string[] = [];
      abortMultipartUploadMock.mockImplementation(async () => {
        events.push('cleanup');
      });
      deleteObjectMock.mockImplementation(async () => {
        events.push('cleanup');
        throw new Error('synthetic object-store outage');
      });
      const publish = vi.spyOn(getRealtimeFanoutState().bus, 'publishBroadcast')
        .mockImplementation(async () => {
          events.push('broadcast');
          throw new Error('synthetic realtime fanout outage');
        });

      try {
        const response = await server.inject({
          method: 'DELETE',
          url: `/api/v1/users/${targetId}`,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(response.statusCode).toBe(HTTP_STATUS.OK);
        expect(JSON.parse(response.body)).toMatchObject({
          id: targetId,
          already_deleted: false,
          aborted_uploads: 1,
          cleaned_uploads: 0,
        });
        expect(events[0]).toBe('broadcast');
        expect(events).toContain('cleanup');
        expect(publish).toHaveBeenCalledTimes(1);
        expect(abortMultipartUploadMock).toHaveBeenCalledWith(
          'media-staging',
          `staging/${uploadSessionId}.mp4`,
          `multipart-${uploadSessionId}`
        );
        expect(deleteObjectMock).toHaveBeenCalled();

        const [deletedUser] = await db.select().from(schema.users).where(eq(schema.users.id, targetId));
        expect(deletedUser).toMatchObject({ is_active: false, deleted_by: testUser.id });
        expect(deletedUser.deleted_at).toBeInstanceOf(Date);
        expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, targetId)))
          .toHaveLength(0);
        const deletionAudits = await db.select().from(schema.auditLogs)
          .where(eq(schema.auditLogs.entity_id, targetId));
        expect(deletionAudits.filter((entry) => entry.action === 'USER_DELETED')).toHaveLength(1);
        expect((await server.inject({
          method: 'GET',
          url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${targetAccess.token}` },
        })).statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);

        const [abortedUpload] = await db.select().from(schema.mediaUploadSessions)
          .where(eq(schema.mediaUploadSessions.id, uploadSessionId));
        expect(abortedUpload).toMatchObject({
          state: 'ABORTED',
          failure_reason: 'USER_DELETED_CLEANUP_PENDING',
        });
        const [failedMedia] = await db.select().from(schema.media).where(eq(schema.media.id, mediaId));
        expect(failedMedia).toMatchObject({
          status: 'FAILED',
          status_reason: 'USER_DELETED_CLEANUP_PENDING',
        });
      } finally {
        publish.mockRestore();
        abortMultipartUploadMock.mockReset();
        deleteObjectMock.mockReset();
      }
    });
  });
});
