import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';

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
  });

  it('rejects role creation for plain admins but allows super admins', async () => {
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

    expect(adminResponse.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const superAdminResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/roles',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: createPayload,
    });

    expect(superAdminResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    expect(JSON.parse(superAdminResponse.body).name).toBe(createPayload.name);
  });
});
