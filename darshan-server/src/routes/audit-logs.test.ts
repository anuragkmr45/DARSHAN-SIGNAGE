import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { closeTestServer, createTestActor, createTestServer, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';

async function issueSuperAdminToken() {
  return (await createTestActor('SUPER_ADMIN')).token;
}

describe('Audit log routes', () => {
  let server: FastifyInstance;
  let token: string;
  const createdAuditLogIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
    token = await issueSuperAdminToken();
  });

  afterAll(async () => {
    const db = getDatabase();
    if (createdAuditLogIds.length > 0) {
      await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.id, createdAuditLogIds));
    }
    await closeTestServer(server);
  });

  it('returns stored audit log fields plus resolved user details in list and get responses', async () => {
    const db = getDatabase();
    const auditLogId = randomUUID();
    createdAuditLogIds.push(auditLogId);

    await db.insert(schema.auditLogs).values({
      id: auditLogId,
      user_id: testUser.id,
      action: 'SCREEN_UPDATE',
      entity_type: 'SCREEN',
      entity_id: randomUUID(),
      ip_address: '127.0.0.1',
      storage_object_id: randomUUID(),
    });

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?page=1&limit=10&action=SCREEN_UPDATE',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(listResponse.statusCode).toBe(200);
    const listBody = JSON.parse(listResponse.body);
    const listed = listBody.items.find((item: any) => item.id === auditLogId);
    expect(listed).toBeTruthy();
    expect(listed.user_id).toBe(testUser.id);
    expect(listed.user).toMatchObject({
      id: testUser.id,
      email: testUser.email,
    });
    expect(listed.storage_object_id).toBeTruthy();
    expect(listed.ip_address).toBe('127.0.0.1');

    const getResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/audit-logs/${auditLogId}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(getResponse.statusCode).toBe(200);
    const getBody = JSON.parse(getResponse.body);
    expect(getBody.id).toBe(auditLogId);
    expect(getBody.user).toMatchObject({
      id: testUser.id,
      email: testUser.email,
    });
    expect(getBody.storage_object_id).toBeTruthy();
  });
});
