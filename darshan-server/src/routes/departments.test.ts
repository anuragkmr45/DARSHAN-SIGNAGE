import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';

describe('Department routes', () => {
  let server: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await generateTestToken(testUser.id, 'ADMIN');
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('creates, lists, reads, updates, and deletes departments with an admin token', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/departments',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        name: `Dept ${Date.now()}`,
        description: 'Phase 1 regression department',
      },
    });

    expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const created = JSON.parse(createResponse.body) as { id: string; name: string };
    expect(created.id).toBeTruthy();

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/departments?page=1&limit=20',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listBody = JSON.parse(listResponse.body);
    expect(listBody.items.some((item: any) => item.id === created.id)).toBe(true);

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/departments/${created.id}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(getResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(getResponse.body).id).toBe(created.id);

    const updateResponse = await server.inject({
      method: 'PATCH',
      url: `/api/v1/departments/${created.id}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        description: 'Updated description',
      },
    });

    expect(updateResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(updateResponse.body).description).toBe('Updated description');

    const deleteResponse = await server.inject({
      method: 'DELETE',
      url: `/api/v1/departments/${created.id}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(deleteResponse.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(deleteResponse.body)).toEqual({
      message: 'Department deleted successfully',
      id: created.id,
    });
  });
});
