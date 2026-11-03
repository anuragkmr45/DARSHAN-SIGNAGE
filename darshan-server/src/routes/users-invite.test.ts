import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, generateTestToken, testRoles, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';

describe('User invite and activation routes', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await generateTestToken(testUser.id, 'ADMIN');
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('creates an invite and lists it through both invite endpoints', async () => {
    const inviteEmail = `invite-${Date.now()}@example.com`;

    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        email: inviteEmail,
        role_id: testRoles.OPERATOR.id,
      },
    });

    expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const inviteBody = JSON.parse(createResponse.body);
    expect(inviteBody.email).toBe(inviteEmail);
    expect(inviteBody.role).toBe('OPERATOR');
    expect(inviteBody.invite_status).toBe('PENDING');
    expect(inviteBody.invite_token).toBeTruthy();
    expect(inviteBody.temp_password).toBeUndefined();
    const [pendingUser] = await getDatabase().select().from(schema.users).where(eq(schema.users.id, inviteBody.id)).limit(1);
    expect(pendingUser?.is_active).toBe(false);

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/users/invite?page=1&limit=20&status=pending',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listBody = JSON.parse(listResponse.body);
    expect(Array.isArray(listBody.items)).toBe(true);
    expect(listBody.items.some((item: any) => item.email === inviteEmail)).toBe(true);
    expect(listBody.items.find((item: any) => item.email === inviteEmail)?.invite_token).toBeUndefined();

    const pendingResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/users/invite/pending',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(pendingResponse.statusCode).toBe(HTTP_STATUS.OK);
    const pendingBody = JSON.parse(pendingResponse.body);
    expect(pendingBody.items.some((item: any) => item.email === inviteEmail)).toBe(true);
    expect(pendingBody.items.find((item: any) => item.email === inviteEmail)?.invite_token).toBeUndefined();
  });

  it('activates an invited user with a valid invite token', async () => {
    const inviteEmail = `activate-${Date.now()}@example.com`;

    const inviteResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        email: inviteEmail,
        role_id: testRoles.OPERATOR.id,
      },
    });

    expect(inviteResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const inviteBody = JSON.parse(inviteResponse.body) as { invite_token: string; id: string };

    const activateResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/users/activate',
      payload: {
        token: inviteBody.invite_token,
        password: 'StrongerPassword123!',
      },
    });

    expect(activateResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(activateResponse.body)).toEqual({
      success: true,
      user_id: inviteBody.id,
    });

    const db = getDatabase();
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, inviteBody.id)).limit(1);
    expect(user?.is_active).toBe(true);
    expect(user?.ext?.invite_status).toBe('ACTIVATED');
    expect(user?.ext?.invite_token).toBeNull();

    const replayResponse = await server.inject({ method: 'POST', url: '/api/v1/users/activate', payload: { token: inviteBody.invite_token, password: 'AnotherPassword123!' } });
    expect(replayResponse.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('reissues a pending code, invalidates the old code, and activates with the replacement', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/users/invite', headers: { authorization: `Bearer ${adminToken}` }, payload: { email: `reissue-${Date.now()}@example.com`, role_id: testRoles.OPERATOR.id } });
    expect(create.statusCode).toBe(HTTP_STATUS.CREATED);
    const original = JSON.parse(create.body) as { id: string; invite_token: string };
    const reissue = await server.inject({ method: 'POST', url: `/api/v1/users/invite/${original.id}/reissue`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(reissue.statusCode).toBe(HTTP_STATUS.OK);
    const replacement = JSON.parse(reissue.body) as { invite_token: string };
    expect(replacement.invite_token).not.toBe(original.invite_token);
    const oldAttempt = await server.inject({ method: 'POST', url: '/api/v1/users/activate', payload: { token: original.invite_token, password: 'StrongerPassword123!' } });
    expect(oldAttempt.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    const newAttempt = await server.inject({ method: 'POST', url: '/api/v1/users/activate', payload: { token: replacement.invite_token, password: 'StrongerPassword123!' } });
    expect(newAttempt.statusCode).toBe(HTTP_STATUS.OK);
    const afterActivation = await server.inject({ method: 'POST', url: `/api/v1/users/invite/${original.id}/reissue`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(afterActivation.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });

  it('accepts only one concurrent activation for the same code', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/users/invite', headers: { authorization: `Bearer ${adminToken}` }, payload: { email: `activation-race-${Date.now()}@example.com`, role_id: testRoles.OPERATOR.id } });
    expect(create.statusCode).toBe(HTTP_STATUS.CREATED);
    const { invite_token: token } = JSON.parse(create.body) as { invite_token: string };
    const outcomes = await Promise.all([
      server.inject({ method: 'POST', url: '/api/v1/users/activate', payload: { token, password: 'FirstPassword123!' } }),
      server.inject({ method: 'POST', url: '/api/v1/users/activate', payload: { token, password: 'SecondPassword123!' } }),
    ]);
    expect(outcomes.map((item) => item.statusCode).sort()).toEqual([HTTP_STATUS.OK, HTTP_STATUS.NOT_FOUND].sort());
  });

  it('lists an expired invitation as expired without revealing its code and allows renewal', async () => {
    const create = await server.inject({ method: 'POST', url: '/api/v1/users/invite', headers: { authorization: `Bearer ${adminToken}` }, payload: { email: `expired-${Date.now()}@example.com`, role_id: testRoles.OPERATOR.id } });
    expect(create.statusCode).toBe(HTTP_STATUS.CREATED);
    const original = JSON.parse(create.body) as { id: string; email: string; invite_token: string };
    await getDatabase().update(schema.users).set({ ext: {
      invite_token: original.invite_token, invite_status: 'PENDING', invited_at: new Date(Date.now() - 8 * 86400000).toISOString(), invite_expires_at: new Date(Date.now() - 86400000).toISOString(),
    } }).where(eq(schema.users.id, original.id));
    const list = await server.inject({ method: 'GET', url: '/api/v1/users/invite?status=pending,expired', headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(HTTP_STATUS.OK);
    const item = (JSON.parse(list.body) as { items: Array<{ id: string; invite_status: string; invite_token?: string }> }).items.find((entry) => entry.id === original.id);
    expect(item?.invite_status).toBe('EXPIRED');
    expect(item?.invite_token).toBeUndefined();
    const renew = await server.inject({ method: 'POST', url: `/api/v1/users/invite/${original.id}/reissue`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(renew.statusCode).toBe(HTTP_STATUS.OK);
  });

  it('allows a department creator to renew only invitations in their own department', async () => {
    const db = getDatabase();
    const [ownDepartment, otherDepartment] = await db.insert(schema.departments).values([
      { name: `Invite own ${Date.now()}` }, { name: `Invite other ${Date.now()}` },
    ]).returning();
    const [manager] = await db.insert(schema.users).values({
      email: `invite-manager-${Date.now()}@example.com`, password_hash: 'unused-test-hash',
      role_id: testRoles.DEPARTMENT.id, department_id: ownDepartment.id, is_active: true,
    }).returning();
    const managerToken = await generateTestToken(manager.id, 'DEPARTMENT');
    const ownCreate = await server.inject({ method: 'POST', url: '/api/v1/users/invite', headers: { authorization: `Bearer ${managerToken}` }, payload: { email: `own-invite-${Date.now()}@example.com`, role_id: testRoles.OPERATOR.id, department_id: ownDepartment.id } });
    expect(ownCreate.statusCode).toBe(HTTP_STATUS.CREATED);
    const ownId = (JSON.parse(ownCreate.body) as { id: string }).id;
    const otherCreate = await server.inject({ method: 'POST', url: '/api/v1/users/invite', headers: { authorization: `Bearer ${adminToken}` }, payload: { email: `other-invite-${Date.now()}@example.com`, role_id: testRoles.OPERATOR.id, department_id: otherDepartment.id } });
    expect(otherCreate.statusCode).toBe(HTTP_STATUS.CREATED);
    const otherId = (JSON.parse(otherCreate.body) as { id: string }).id;

    const list = await server.inject({ method: 'GET', url: '/api/v1/users/invite?status=pending,expired', headers: { authorization: `Bearer ${managerToken}` } });
    expect(list.statusCode).toBe(HTTP_STATUS.OK);
    const ids = (JSON.parse(list.body) as { items: Array<{ id: string }> }).items.map((item) => item.id);
    expect(ids).toContain(ownId);
    expect(ids).not.toContain(otherId);
    const ownRenew = await server.inject({ method: 'POST', url: `/api/v1/users/invite/${ownId}/reissue`, headers: { authorization: `Bearer ${managerToken}` } });
    expect(ownRenew.statusCode).toBe(HTTP_STATUS.OK);
    const deniedRenew = await server.inject({ method: 'POST', url: `/api/v1/users/invite/${otherId}/reissue`, headers: { authorization: `Bearer ${managerToken}` } });
    expect(deniedRenew.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
