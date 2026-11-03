import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { createServer as createHttpServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { isPrivateAddress } from '@/utils/network-address-policy';

describe('Admin ops route contracts', () => {
  let server: FastifyInstance;
  let superAdminToken: string;
  const createdApiKeyIds: string[] = [];
  const createdWebhookIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
    superAdminToken = await generateTestToken(testUser.id, 'SUPER_ADMIN');
  });

  afterAll(async () => {
    const db = getDatabase();

    if (createdApiKeyIds.length > 0) {
      await db.delete(schema.apiKeys).where(inArray(schema.apiKeys.id, createdApiKeyIds));
    }

    if (createdWebhookIds.length > 0) {
      await db
        .delete(schema.webhookSubscriptions)
        .where(inArray(schema.webhookSubscriptions.id, createdWebhookIds));
    }

    await closeTestServer(server);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the paginated API key envelope and one-time secrets for create, rotate, and revoke', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/api-keys',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: {
        name: `RG7 API Key ${Date.now()}`,
        scopes: ['read', 'write'],
        roles: ['ADMIN'],
      },
    });

    expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const created = JSON.parse(createResponse.body) as {
      id: string;
      name: string;
      secret?: string;
      is_revoked: boolean;
    };
    createdApiKeyIds.push(created.id);
    expect(created.secret).toBeTruthy();
    expect(created.is_revoked).toBe(false);

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/api-keys',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listed = JSON.parse(listResponse.body) as {
      items: Array<{ id: string; name: string }>;
      total: number;
      page: number;
      limit: number;
    };
    expect(Array.isArray(listed.items)).toBe(true);
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);
    expect(listed.total).toBeGreaterThan(0);
    expect(listed.page).toBe(1);
    expect(listed.limit).toBe(100);

    const rotateResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/api-keys/${created.id}/rotate`,
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(rotateResponse.statusCode).toBe(HTTP_STATUS.OK);
    const rotated = JSON.parse(rotateResponse.body) as {
      id: string;
      secret?: string;
      is_revoked: boolean;
    };
    expect(rotated.id).toBe(created.id);
    expect(rotated.secret).toBeTruthy();
    expect(rotated.secret).not.toBe(created.secret);
    expect(rotated.is_revoked).toBe(false);

    const revokeResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/api-keys/${created.id}/revoke`,
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(revokeResponse.statusCode).toBe(HTTP_STATUS.OK);
    const revoked = JSON.parse(revokeResponse.body) as { id: string; is_revoked: boolean };
    expect(revoked.id).toBe(created.id);
    expect(revoked.is_revoked).toBe(true);
  });

  it('does not expose SSO management routes in the air-gapped release', async () => {
    for (const request of [
      { method: 'GET' as const, url: '/api/v1/sso-config' },
      { method: 'POST' as const, url: '/api/v1/sso-config', payload: { provider: 'oidc' } },
      { method: 'POST' as const, url: '/api/v1/sso-config/00000000-0000-4000-8000-000000000000/deactivate' },
    ]) {
      const response = await server.inject({ ...request, headers: { authorization: `Bearer ${superAdminToken}` } });
      expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
    }
  });

  it('attempts outbound webhook delivery and records the latest delivery status', async () => {
    const siteAddress = Object.values(networkInterfaces()).flat().find((entry) =>
      entry?.family === 'IPv4' && !entry.internal && isPrivateAddress(entry.address))?.address;
    if (!siteAddress) throw new Error('A private network interface is required for the webhook fixture');
    const received: Array<{ event: string | undefined; body: string }> = [];
    const fixture = createHttpServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk.toString(); });
      request.on('end', () => {
        received.push({ event: request.headers['x-darshan-event'] as string | undefined, body });
        response.writeHead(202, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => fixture.listen(0, '0.0.0.0', resolve));
    const address = fixture.address();
    if (!address || typeof address === 'string') throw new Error('Webhook fixture has no TCP port');
    const targetUrl = `http://${siteAddress}:${address.port}/darshan`;
    const previousPolicy = {
      hosts: process.env.WEBHOOK_TEST_ALLOWED_HOSTS,
      ports: process.env.WEBHOOK_TEST_ALLOWED_PORTS,
      cidrs: process.env.WEBHOOK_TEST_ALLOWED_CIDRS,
    };
    process.env.WEBHOOK_TEST_ALLOWED_HOSTS = siteAddress;
    process.env.WEBHOOK_TEST_ALLOWED_PORTS = String(address.port);
    process.env.WEBHOOK_TEST_ALLOWED_CIDRS = `${siteAddress}/32`;
    try {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: {
        name: `RG7 Webhook ${Date.now()}`,
        event_types: ['content.published'],
        target_url: targetUrl,
        headers: {
          'x-phase': 'rg-7',
        },
      },
    });

    expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const created = JSON.parse(createResponse.body) as {
      id: string;
      target_url: string;
      secret?: string;
    };
    createdWebhookIds.push(created.id);
    expect(created.secret).toBeTruthy();

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listed = JSON.parse(listResponse.body) as {
      items: Array<{ id: string; target_url: string }>;
    };
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);

    const testResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/webhooks/${created.id}/test`,
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(testResponse.statusCode).toBe(HTTP_STATUS.OK);
    const testBody = JSON.parse(testResponse.body) as {
      success: boolean;
      attempted: string;
      status_code: number;
      sent_at: string;
    };
    expect(testBody.success).toBe(true);
    expect(testBody.attempted).toBe(created.target_url);
    expect(testBody.status_code).toBe(202);
    expect(testBody.sent_at).toBeTruthy();
    expect(received).toHaveLength(1);
    expect(received[0]?.event).toBe('webhook.test');
    expect(JSON.parse(received[0]!.body).type).toBe('webhook.test');

    const db = getDatabase();
    const [stored] = await db
      .select({
        id: schema.webhookSubscriptions.id,
        last_status: schema.webhookSubscriptions.last_status,
        last_status_at: schema.webhookSubscriptions.last_status_at,
      })
      .from(schema.webhookSubscriptions)
      .where(inArray(schema.webhookSubscriptions.id, [created.id]));

    expect(stored?.id).toBe(created.id);
    expect(stored?.last_status).toBe('SUCCESS');
    expect(stored?.last_status_at).toBeTruthy();
    } finally {
      if (previousPolicy.hosts === undefined) delete process.env.WEBHOOK_TEST_ALLOWED_HOSTS;
      else process.env.WEBHOOK_TEST_ALLOWED_HOSTS = previousPolicy.hosts;
      if (previousPolicy.ports === undefined) delete process.env.WEBHOOK_TEST_ALLOWED_PORTS;
      else process.env.WEBHOOK_TEST_ALLOWED_PORTS = previousPolicy.ports;
      if (previousPolicy.cidrs === undefined) delete process.env.WEBHOOK_TEST_ALLOWED_CIDRS;
      else process.env.WEBHOOK_TEST_ALLOWED_CIDRS = previousPolicy.cidrs;
      await new Promise<void>((resolve, reject) => fixture.close((error) => error ? reject(error) : resolve()));
    }
  });
});
