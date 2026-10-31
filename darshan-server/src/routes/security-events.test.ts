import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { closeTestServer, createTestActor, createTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';

describe('Security event routes', () => {
  let server: FastifyInstance;
  let token: string;
  let actorId: string;

  beforeAll(async () => {
    server = await createTestServer();
    const actor = await createTestActor('SUPER_ADMIN');
    token = actor.token;
    actorId = actor.id;
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('records authenticated CMS client security events in the audit log', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/security/client-events',
      headers: {
        authorization: `Bearer ${token}`,
        'user-agent': 'Vitest Browser',
      },
      payload: {
        event: 'CMS_DEVTOOLS_ATTEMPT',
        context: {
          route: '/reports',
          trigger: 'shortcut',
          detected_at: '2026-03-29T12:00:00.000Z',
        },
      },
    });

    expect(response.statusCode).toBe(204);

    const db = getDatabase();
    const [auditLog] = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.action, 'CMS_DEVTOOLS_ATTEMPT'))
      .orderBy(desc(schema.auditLogs.created_at));

    expect(auditLog).toBeTruthy();
    expect(auditLog?.user_id).toBe(actorId);
    expect(auditLog?.entity_type).toBe('SECURITY_EVENT');
    expect(auditLog?.ip_address).toBeTruthy();
  });
});
