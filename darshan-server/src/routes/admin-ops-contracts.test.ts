import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { closeTestServer, createTestActor, createTestServer } from '@/test/helpers';
import { getDatabase, schema } from '@/db';
import { HTTP_STATUS } from '@/http-status-codes';
import { generateAccessToken } from '@/auth/jwt';
import { hashPassword } from '@/auth/password';

describe('Admin ops route contracts', () => {
  let server: FastifyInstance;
  let superAdminToken: string;
  const createdApiKeyIds: string[] = [];
  const createdWebhookIds: string[] = [];
  const createdSsoIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
    superAdminToken = (await createTestActor('SUPER_ADMIN')).token;
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

  it('does not treat record-conditional SSO grants as global configuration access', async () => {
    const db = getDatabase();
    const roleId = randomUUID();
    const userId = randomUUID();
    const permittedId = randomUUID();
    const roleName = `SSO_CONDITIONAL_${roleId}`;
    const email = `sso-conditional-${userId}@example.test`;
    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      permissions: { grants: [
        { action: 'read', subject: 'SsoConfig', conditions: { id: permittedId } },
        { action: 'update', subject: 'SsoConfig', conditions: { id: permittedId } },
      ] },
      is_system: false,
    });
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash: await hashPassword('TestPassword123!'),
      role_id: roleId,
      is_active: true,
    });
    const access = await generateAccessToken(userId, email, roleId, roleName);
    await db.insert(schema.sessions).values({ user_id: userId, access_jti: access.jti, expires_at: access.expiresAt });
    const [active] = await db.insert(schema.ssoConfigs).values({
      id: permittedId,
      issuer: 'https://conditional-sso.example.test',
      client_id: 'conditional-test-client',
      client_secret: 'fixture-only-secret',
      is_active: true,
    }).returning();
    createdSsoIds.push(active.id);
    const attemptedIssuer = `https://new-sso-${userId}.example.test`;

    try {
      const authorization = `Bearer ${access.token}`;
      const list = await server.inject({ method: 'GET', url: '/api/v1/sso-config', headers: { authorization } });
      const upsert = await server.inject({
        method: 'POST', url: '/api/v1/sso-config', headers: { authorization },
        payload: { issuer: attemptedIssuer, client_id: 'new-client', client_secret: 'fixture-only-secret' },
      });
      const deactivate = await server.inject({
        method: 'POST', url: `/api/v1/sso-config/${active.id}/deactivate`, headers: { authorization },
      });
      expect([list.statusCode, upsert.statusCode, deactivate.statusCode]).toEqual([403, 403, 403]);
      const [unchanged] = await db.select().from(schema.ssoConfigs).where(eq(schema.ssoConfigs.id, active.id));
      expect(unchanged?.is_active).toBe(true);
      expect(await db.select().from(schema.ssoConfigs).where(eq(schema.ssoConfigs.issuer, attemptedIssuer))).toHaveLength(0);
    } finally {
      await db.delete(schema.ssoConfigs).where(eq(schema.ssoConfigs.issuer, attemptedIssuer));
      await db.delete(schema.sessions).where(eq(schema.sessions.user_id, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }
  });

  it('applies conditional integration grants to records and never returns stored secrets', async () => {
    const db = getDatabase();
    const roleId = randomUUID();
    const userId = randomUUID();
    const roleName = `INTEGRATION_SCOPED_${roleId}`;
    const email = `integration-scoped-${userId}@example.test`;
    const allowedKeyName = `Allowed key ${userId}`;
    const allowedWebhookName = `Allowed webhook ${userId}`;
    await db.insert(schema.roles).values({
      id: roleId,
      name: roleName,
      permissions: { grants: [
        ...(['create', 'read', 'update', 'delete'] as const).map((action) => ({
          action, subject: 'ApiKey', conditions: { name: allowedKeyName },
        })),
        ...(['create', 'read', 'update', 'delete'] as const).map((action) => ({
          action, subject: 'Webhook', conditions: { name: allowedWebhookName },
        })),
      ] },
      is_system: false,
    });
    await db.insert(schema.users).values({
      id: userId,
      email,
      password_hash: await hashPassword('TestPassword123!'),
      role_id: roleId,
      is_active: true,
    });
    const access = await generateAccessToken(userId, email, roleId, roleName);
    await db.insert(schema.sessions).values({
      user_id: userId,
      access_jti: access.jti,
      expires_at: access.expiresAt,
    });
    const authorization = `Bearer ${access.token}`;
    const hiddenKeyId = randomUUID();
    const hiddenWebhookId = randomUUID();
    await db.insert(schema.apiKeys).values({
      id: hiddenKeyId,
      name: `Hidden key ${userId}`,
      token_prefix: hiddenKeyId.replaceAll('-', '').slice(0, 12),
      secret_hash: 'fixture-only-hash',
      created_by: userId,
    });
    await db.insert(schema.webhookSubscriptions).values({
      id: hiddenWebhookId,
      name: `Hidden webhook ${userId}`,
      event_types: ['content.published'],
      target_url: 'https://hidden-webhook.example.test/events',
      secret: 'fixture-only-secret',
      headers: { authorization: 'fixture-only-header' },
      created_by: userId,
    });
    createdApiKeyIds.push(hiddenKeyId);
    createdWebhookIds.push(hiddenWebhookId);

    try {
      const keyCreate = await server.inject({
        method: 'POST', url: '/api/v1/api-keys', headers: { authorization },
        payload: { name: allowedKeyName, scopes: ['read'] },
      });
      expect(keyCreate.statusCode).toBe(201);
      expect(keyCreate.headers['cache-control']).toBe('no-store');
      const key = JSON.parse(keyCreate.body) as { id: string; secret?: string; secret_hash?: string };
      createdApiKeyIds.push(key.id);
      expect(key.secret).toBeTruthy();
      expect(key).not.toHaveProperty('secret_hash');
      expect((await server.inject({
        method: 'POST', url: '/api/v1/api-keys', headers: { authorization },
        payload: { name: `Denied key ${userId}`, scopes: ['read'] },
      })).statusCode).toBe(403);

      const keyList = await server.inject({ method: 'GET', url: '/api/v1/api-keys', headers: { authorization } });
      expect(keyList.statusCode).toBe(200);
      const listedKeys = JSON.parse(keyList.body).items as Array<Record<string, unknown>>;
      expect(listedKeys.map((item) => item.id)).toEqual([key.id]);
      expect(listedKeys[0]).not.toHaveProperty('secret_hash');
      expect((await server.inject({
        method: 'POST', url: `/api/v1/api-keys/${hiddenKeyId}/rotate`, headers: { authorization },
      })).statusCode).toBe(403);
      const rotated = await server.inject({
        method: 'POST', url: `/api/v1/api-keys/${key.id}/rotate`, headers: { authorization },
      });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(rotated.body)).not.toHaveProperty('secret_hash');

      const webhookCreate = await server.inject({
        method: 'POST', url: '/api/v1/webhooks', headers: { authorization },
        payload: {
          name: allowedWebhookName,
          event_types: ['content.published'],
          target_url: 'https://allowed-webhook.example.test/events',
          headers: { authorization: 'one-time-config-secret' },
        },
      });
      expect(webhookCreate.statusCode).toBe(201);
      expect(webhookCreate.headers['cache-control']).toBe('no-store');
      const webhook = JSON.parse(webhookCreate.body) as Record<string, unknown> & { id: string; secret?: string };
      createdWebhookIds.push(webhook.id);
      expect(webhook.secret).toBeTruthy();
      expect(webhook).not.toHaveProperty('headers');
      expect((await server.inject({
        method: 'POST', url: '/api/v1/webhooks', headers: { authorization },
        payload: {
          name: `Denied webhook ${userId}`,
          event_types: ['content.published'],
          target_url: 'https://denied-webhook.example.test/events',
        },
      })).statusCode).toBe(403);

      const webhookList = await server.inject({ method: 'GET', url: '/api/v1/webhooks', headers: { authorization } });
      expect(webhookList.statusCode).toBe(200);
      const listedWebhooks = JSON.parse(webhookList.body).items as Array<Record<string, unknown>>;
      expect(listedWebhooks.map((item) => item.id)).toEqual([webhook.id]);
      expect(listedWebhooks[0]).not.toHaveProperty('secret');
      expect(listedWebhooks[0]).not.toHaveProperty('headers');
      expect((await server.inject({
        method: 'PATCH', url: `/api/v1/webhooks/${hiddenWebhookId}`, headers: { authorization },
        payload: { is_active: false },
      })).statusCode).toBe(403);
      expect((await server.inject({
        method: 'PATCH', url: `/api/v1/webhooks/${webhook.id}`, headers: { authorization },
        payload: { name: `Out of scope ${userId}` },
      })).statusCode).toBe(403);
      const webhookUpdate = await server.inject({
        method: 'PATCH', url: `/api/v1/webhooks/${webhook.id}`, headers: { authorization },
        payload: { is_active: false },
      });
      expect(webhookUpdate.statusCode).toBe(200);
      expect(JSON.parse(webhookUpdate.body)).not.toHaveProperty('secret');
      expect(JSON.parse(webhookUpdate.body)).not.toHaveProperty('headers');
    } finally {
      await db.delete(schema.sessions).where(eq(schema.sessions.user_id, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    }
  });

  it('attempts outbound webhook delivery and records the latest delivery status', async () => {
    const createResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: {
        authorization: `Bearer ${superAdminToken}`,
      },
      payload: {
        name: `RG7 Webhook ${Date.now()}`,
        event_types: ['content.published'],
        target_url: 'https://hooks.example.test/darshan',
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

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: {
          'content-type': 'application/json',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

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
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(created.target_url);

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
  });
});
