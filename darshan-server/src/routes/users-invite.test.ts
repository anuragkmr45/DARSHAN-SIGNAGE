import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { closeTestServer, createTestActor, createTestServer, generateTestToken, testRoles, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { generateAccessToken, type JWTPayload } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { hashPassword } from '@/auth/password';

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
    expect(createResponse.headers['cache-control']).toBe('no-store');
    const inviteBody = JSON.parse(createResponse.body);
    expect(inviteBody.email).toBe(inviteEmail);
    expect(inviteBody.role).toBe('OPERATOR');
    expect(inviteBody.invite_status).toBe('PENDING');
    expect(inviteBody.invite_token).toBeTruthy();
    expect(inviteBody).not.toHaveProperty('temp_password');

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
    expect(listBody.items.find((item: any) => item.email === inviteEmail)).not.toHaveProperty('invite_token');

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
    expect(pendingBody.items.find((item: any) => item.email === inviteEmail)).not.toHaveProperty('invite_token');

    for (const status of ['unknown', 'pending,unknown', 'pending,']) {
      const invalid = await server.inject({
        method: 'GET',
        url: `/api/v1/users/invite?status=${encodeURIComponent(status)}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(invalid.statusCode).toBe(400);
      expect(JSON.parse(invalid.body).error.code).toBe('BAD_REQUEST');
    }
  });

  it('rejects an invitation for a nonexistent department without creating an account', async () => {
    const email = `invalid-invite-department-${randomUUID()}@example.test`;
    const response = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email, role_id: testRoles.OPERATOR.id, department_id: randomUUID() },
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe('NOT_FOUND');
    expect(await getDatabase().select().from(schema.users).where(eq(schema.users.email, email))).toHaveLength(0);
  });

  it('does not let an invitation token reactivate an administrator-disabled account', async () => {
    const invited = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `disabled-invite-${Date.now()}@example.test`, role_id: testRoles.OPERATOR.id },
    });
    expect(invited.statusCode).toBe(201);
    const { id, invite_token } = JSON.parse(invited.body);
    const disabled = await server.inject({
      method: 'PATCH', url: `/api/v1/users/${id}`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { is_active: false },
    });
    expect(disabled.statusCode).toBe(200);
    const activation = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: invite_token, password: 'StrongerPassword123!' },
    });
    expect(activation.statusCode).toBe(404);
    const [current] = await getDatabase().select().from(schema.users).where(eq(schema.users.id, id));
    expect(current?.is_active).toBe(false);
  });

  it('reports an expired pending invite as EXPIRED without exposing its token', async () => {
    const invited = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `expired-invite-${Date.now()}@example.test`, role_id: testRoles.OPERATOR.id },
    });
    expect(invited.statusCode).toBe(201);
    const { id } = JSON.parse(invited.body);
    const knownPendingPassword = 'PendingPassword123!';
    const db = getDatabase();
    const [current] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!current || !current.ext || typeof current.ext !== 'object' || Array.isArray(current.ext)) {
      throw new Error('Expected invite metadata for expiry test');
    }
    await db.update(schema.users).set({
      password_hash: await hashPassword(knownPendingPassword),
      ext: { ...current.ext, invite_expires_at: new Date(Date.now() - 1000).toISOString() },
    }).where(eq(schema.users.id, id));

    const listed = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=expired',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listed.statusCode).toBe(200);
    const item = JSON.parse(listed.body).items.find((candidate: { id: string }) => candidate.id === id);
    expect(item?.invite_status).toBe('EXPIRED');
    expect(item).not.toHaveProperty('invite_token');
    const login = await server.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: current.email, password: knownPendingPassword },
    });
    expect(login.statusCode).toBe(403);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, id))).toHaveLength(0);
  });

  it('lists malformed legacy expiry metadata as recoverable EXPIRED state without a database error', async () => {
    const invited = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `malformed-expiry-${randomUUID()}@example.test`, role_id: testRoles.OPERATOR.id },
    });
    expect(invited.statusCode).toBe(201);
    const { id, invite_token } = JSON.parse(invited.body);
    const db = getDatabase();
    const [current] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!current || !current.ext || typeof current.ext !== 'object' || Array.isArray(current.ext)) {
      throw new Error('Expected invitation metadata');
    }
    await db.update(schema.users).set({
      ext: { ...current.ext, invite_expires_at: 'not-a-date' },
    }).where(eq(schema.users.id, id));

    const activation = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: invite_token, password: 'StrongerPassword123!' },
    });
    expect(activation.statusCode).toBe(400);
    expect(JSON.parse(activation.body).error.message).toBe('Invite token expired');

    const listed = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=expired',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listed.statusCode).toBe(200);
    const item = JSON.parse(listed.body).items.find((candidate: { id: string }) => candidate.id === id);
    expect(item).toMatchObject({ invite_status: 'EXPIRED', can_replace: true });
    expect(item).not.toHaveProperty('invite_token');
  });

  it('rejects blank public activation tokens while keeping corrupt pending metadata replaceable', async () => {
    const invited = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `blank-token-${randomUUID()}@example.test`, role_id: testRoles.OPERATOR.id },
    });
    expect(invited.statusCode).toBe(201);
    const { id } = JSON.parse(invited.body);
    const db = getDatabase();
    const [current] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!current || !current.ext || typeof current.ext !== 'object' || Array.isArray(current.ext)) {
      throw new Error('Expected invitation metadata');
    }
    await db.update(schema.users).set({
      ext: { ...current.ext, invite_token: '' },
    }).where(eq(schema.users.id, id));

    const activation = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: '   ', password: 'StrongerPassword123!' },
    });
    expect(activation.statusCode).toBe(400);

    const listed = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=expired',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const item = JSON.parse(listed.body).items.find((candidate: { id: string }) => candidate.id === id);
    expect(item).toMatchObject({ invite_status: 'EXPIRED', can_replace: true });
    expect(item).not.toHaveProperty('invite_token');
  });

  it('fails closed when a canonical activation token ambiguously matches two invitation rows', async () => {
    const first = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `duplicate-token-a-${randomUUID()}@example.test`, role_id: testRoles.OPERATOR.id },
    });
    const second = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: `duplicate-token-b-${randomUUID()}@example.test`, role_id: testRoles.OPERATOR.id },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstBody = JSON.parse(first.body);
    const secondBody = JSON.parse(second.body);
    const db = getDatabase();
    const [secondUser] = await db.select().from(schema.users).where(eq(schema.users.id, secondBody.id));
    if (!secondUser || !secondUser.ext || typeof secondUser.ext !== 'object' || Array.isArray(secondUser.ext)) {
      throw new Error('Expected second invitation metadata');
    }
    await db.update(schema.users).set({
      ext: { ...secondUser.ext, invite_token: firstBody.invite_token },
    }).where(eq(schema.users.id, secondBody.id));

    const activation = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: firstBody.invite_token, password: 'StrongerPassword123!' },
    });
    expect(activation.statusCode).toBe(404);
    for (const id of [firstBody.id, secondBody.id]) {
      const [current] = await db.select().from(schema.users).where(eq(schema.users.id, id));
      expect(current?.ext).toMatchObject({ invite_status: 'PENDING' });
    }
  });

  it('requires invitation activation before login and rejects old pending sessions', async () => {
    const email = `pending-login-${randomUUID()}@example.test`;
    const invited = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email, role_id: testRoles.OPERATOR.id },
    });
    expect(invited.statusCode).toBe(201);
    const { id, invite_token } = JSON.parse(invited.body);
    const knownPendingPassword = 'PendingPassword123!';
    await getDatabase().update(schema.users)
      .set({ password_hash: await hashPassword(knownPendingPassword) })
      .where(eq(schema.users.id, id));
    const before = await server.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: knownPendingPassword },
    });
    expect(before.statusCode).toBe(403);
    expect(JSON.parse(before.body).error.message).toBe('Activate invitation before signing in');
    expect(await getDatabase().select().from(schema.sessions).where(eq(schema.sessions.user_id, id))).toHaveLength(0);

    // Older builds could have issued a session to a pending invitee. It must
    // not authorize a request after this build is deployed.
    const oldAccess = await generateAccessToken(id, email, testRoles.OPERATOR.id, 'OPERATOR');
    await getDatabase().insert(schema.sessions).values({
      user_id: id, access_jti: oldAccess.jti, expires_at: oldAccess.expiresAt,
    });
    const oldSession = await server.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${oldAccess.token}` },
    });
    expect(oldSession.statusCode).toBe(401);
    let mutationReached = false;
    await expect(withCurrentMutationAuthorization(decodeJwt(oldAccess.token) as JWTPayload, async () => {
      mutationReached = true;
    })).rejects.toMatchObject({ statusCode: 401 });
    expect(mutationReached).toBe(false);

    const activated = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: invite_token, password: 'StrongerPassword123!' },
    });
    expect(activated.statusCode).toBe(200);
    expect(await getDatabase().select().from(schema.sessions).where(eq(schema.sessions.user_id, id))).toHaveLength(0);
    const oldPassword = await server.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: knownPendingPassword },
    });
    expect(oldPassword.statusCode).toBe(401);
    const after = await server.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email, password: 'StrongerPassword123!' },
    });
    expect(after.statusCode).toBe(200);
    expect(JSON.parse(after.body).user.id).toBe(id);
  });

  it('replaces a pending or expired link once and never exposes either token in invitation lists', async () => {
    const email = `replace-invite-${randomUUID()}@example.test`;
    const invited = await server.inject({
      method: 'POST', url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email, role_id: testRoles.OPERATOR.id },
    });
    expect(invited.statusCode).toBe(201);
    const { id, invite_token: originalToken } = JSON.parse(invited.body);
    const db = getDatabase();
    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!before || !before.ext || typeof before.ext !== 'object' || Array.isArray(before.ext)) {
      throw new Error('Expected invitation metadata');
    }
    await db.update(schema.users).set({
      ext: {
        ...before.ext,
        invite_status: 'EXPIRED',
        invite_expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    }).where(eq(schema.users.id, id));

    const expiredList = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=expired',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const expiredItem = JSON.parse(expiredList.body).items.find((item: { id: string }) => item.id === id);
    expect(expiredItem).toMatchObject({ invite_status: 'EXPIRED', can_replace: true });
    expect(expiredItem).not.toHaveProperty('invite_token');

    const noAuth = await server.inject({ method: 'POST', url: `/api/v1/users/invite/${id}/replace` });
    expect(noAuth.statusCode).toBe(401);
    const operator = await createTestActor('OPERATOR');
    const denied = await server.inject({
      method: 'POST', url: `/api/v1/users/invite/${id}/replace`,
      headers: { authorization: `Bearer ${operator.token}` },
      payload: { expected_updated_at: before.updated_at.toISOString() },
    });
    expect(denied.statusCode).toBe(404);

    const replacement = await server.inject({
      method: 'POST', url: `/api/v1/users/invite/${id}/replace`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expected_updated_at: before.updated_at.toISOString() },
    });
    expect(replacement.statusCode).toBe(200);
    expect(replacement.headers['cache-control']).toBe('no-store');
    const replacementBody = JSON.parse(replacement.body);
    expect(replacementBody.invite_token).toBeTruthy();
    expect(replacementBody.invite_token).not.toBe(originalToken);
    expect(new Date(replacementBody.invite_expires_at).getTime()).toBeGreaterThan(Date.now());
    const [afterReplacement] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(afterReplacement?.ext).toMatchObject({ invite_status: 'PENDING' });
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, id))).toHaveLength(0);
    expect(await db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.entity_id, id),
      eq(schema.auditLogs.action, 'USER_INVITE_LINK_REPLACED'),
    ))).toHaveLength(1);

    const staleReplacement = await server.inject({
      method: 'POST', url: `/api/v1/users/invite/${id}/replace`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expected_updated_at: before.updated_at.toISOString() },
    });
    expect(staleReplacement.statusCode).toBe(409);
    expect(JSON.parse(staleReplacement.body).error.code).toBe('INVITATION_CHANGED');

    const staleActivation = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: originalToken, password: 'StrongerPassword123!' },
    });
    expect(staleActivation.statusCode).toBe(404);
    const currentList = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=pending',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const currentItem = JSON.parse(currentList.body).items.find((item: { id: string }) => item.id === id);
    expect(currentItem).toMatchObject({ invite_status: 'PENDING', can_replace: true });
    expect(currentItem).not.toHaveProperty('invite_token');

    const activated = await server.inject({
      method: 'POST', url: '/api/v1/users/activate',
      payload: { token: replacementBody.invite_token, password: 'StrongerPassword123!' },
    });
    expect(activated.statusCode).toBe(200);
    const afterActivation = await server.inject({
      method: 'POST', url: `/api/v1/users/invite/${id}/replace`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expected_updated_at: before.updated_at.toISOString() },
    });
    expect(afterActivation.statusCode).toBe(409);
    expect(await db.select().from(schema.auditLogs).where(and(
      eq(schema.auditLogs.entity_id, id),
      eq(schema.auditLogs.action, 'USER_INVITE_LINK_REPLACED'),
    ))).toHaveLength(1);
    const activatedList = await server.inject({
      method: 'GET', url: '/api/v1/users/invite?status=activated',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const activatedItem = JSON.parse(activatedList.body).items.find((item: { id: string }) => item.id === id);
    expect(activatedItem).toMatchObject({ invite_status: 'ACTIVATED', can_replace: false });
    const [finalUser] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(finalUser?.ext).toMatchObject({ invite_token: null, invite_status: 'ACTIVATED' });
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
    expect(user?.ext).toMatchObject({ invite_status: 'ACTIVATED', invite_token: null });
  });
});
