import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { closeTestServer, createTestServer, generateTestToken, testUser } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';

describe('Admin ops route contracts', () => {
  let server: FastifyInstance;
  let superAdminToken: string;
  const createdApiKeyIds: string[] = [];
  const createdWebhookIds: string[] = [];
  const createdSsoIds: string[] = [];

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

    if (createdSsoIds.length > 0) {
      await db.delete(schema.ssoConfigs).where(inArray(schema.ssoConfigs.id, createdSsoIds));
    }

    await closeTestServer(server);
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

  it('persists active SSO config lifecycle through upsert, list, and deactivate routes', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/sso-config',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: {
        provider: 'oidc',
        issuer: `https://issuer-${Date.now()}.example.com`,
        client_id: `client-${Date.now()}`,
        client_secret: 'super-secret',
        authorization_url: 'https://issuer.example.com/auth',
        token_url: 'https://issuer.example.com/token',
        jwks_url: 'https://issuer.example.com/jwks',
        redirect_uri: 'https://cms.example.com/auth/callback',
        scopes: ['openid', 'profile', 'email'],
      },
    });

    expect(createResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const created = JSON.parse(createResponse.body) as {
      id: string;
      issuer: string;
      is_active: boolean;
    };
    createdSsoIds.push(created.id);
    expect(created.is_active).toBe(true);

    const listResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/sso-config',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listed = JSON.parse(listResponse.body) as {
      items: Array<{ id: string; issuer: string; is_active: boolean }>;
    };
    expect(Array.isArray(listed.items)).toBe(true);
    expect(listed.items.some((item) => item.id === created.id && item.is_active)).toBe(true);

    const deactivateResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/sso-config/${created.id}/deactivate`,
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
    });

    expect(deactivateResponse.statusCode).toBe(HTTP_STATUS.OK);
    const deactivated = JSON.parse(deactivateResponse.body) as { id: string; is_active: boolean };
    expect(deactivated.id).toBe(created.id);
    expect(deactivated.is_active).toBe(false);
  });

  it('returns webhook test success without recording any delivery status side effect', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: {
        name: `RG7 Webhook ${Date.now()}`,
        event_types: ['content.published'],
        target_url: 'https://hooks.example.test/signhex',
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
    expect(JSON.parse(testResponse.body)).toEqual({
      success: true,
      attempted: created.target_url,
    });

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
    expect(stored?.last_status).toBeNull();
    expect(stored?.last_status_at).toBeNull();
  });
});
