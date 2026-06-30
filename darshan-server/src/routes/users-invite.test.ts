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
  });
});
