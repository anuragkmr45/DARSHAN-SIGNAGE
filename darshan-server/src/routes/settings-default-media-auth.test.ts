import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { closeTestServer, createTestServer } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { getDatabase, schema } from '@/db';
import { hashPassword } from '@/auth/password';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';

describe('Settings routes default media auth contract', () => {
  let server: FastifyInstance;
  const createdRoleIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    const db = getDatabase();
    if (createdUserIds.length > 0) {
      await db.delete(schema.sessions).where(inArray(schema.sessions.user_id, createdUserIds));
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    }
    if (createdRoleIds.length > 0) {
      await db.delete(schema.roles).where(inArray(schema.roles.id, createdRoleIds));
    }
    await closeTestServer(server);
  });

  it('requires authentication for default media settings reads', async () => {
    const [defaultMediaResponse, variantsResponse, targetsResponse] = await Promise.all([
      server.inject({
        method: 'GET',
        url: '/api/v1/settings/default-media',
      }),
      server.inject({
        method: 'GET',
        url: '/api/v1/settings/default-media/variants',
      }),
      server.inject({
        method: 'GET',
        url: '/api/v1/settings/default-media/targets',
      }),
    ]);

    expect(defaultMediaResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(variantsResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(targetsResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect((await server.inject({ method: 'POST', url: '/api/v1/settings', payload: {} })).statusCode)
      .toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('rejects conditional singleton grants and keeps branding out of generic OrgSettings access', async () => {
    const db = getDatabase();
    const actor = async (grants: Array<{ action: string; subject: string; conditions?: Record<string, string> }>) => {
      const roleId = randomUUID();
      const userId = randomUUID();
      const roleName = `SETTINGS_SCOPE_${roleId}`;
      const email = `settings-scope-${userId}@example.com`;
      await db.insert(schema.roles).values({ id: roleId, name: roleName, is_system: false, permissions: { grants } });
      createdRoleIds.push(roleId);
      await db.insert(schema.users).values({
        id: userId, email, password_hash: await hashPassword('Password123!'),
        role_id: roleId, is_active: true,
      });
      createdUserIds.push(userId);
      const token = await generateAccessToken(userId, email, roleId, roleName);
      await createSessionRepository().create({ user_id: userId, access_jti: token.jti, expires_at: token.expiresAt });
      return { authorization: `Bearer ${token.token}` };
    };

    const conditionalHeaders = await actor([
      { action: 'read', subject: 'OrgSettings', conditions: { id: 'limited' } },
      { action: 'update', subject: 'OrgSettings', conditions: { id: 'limited' } },
      { action: 'read', subject: 'BrandingSettings', conditions: { id: 'limited' } },
      { action: 'update', subject: 'BrandingSettings', conditions: { id: 'limited' } },
    ]);
    expect((await server.inject({ method: 'GET', url: '/api/v1/settings/general', headers: conditionalHeaders })).statusCode)
      .toBe(HTTP_STATUS.FORBIDDEN);
    expect((await server.inject({ method: 'GET', url: '/api/v1/settings', headers: conditionalHeaders })).statusCode)
      .toBe(HTTP_STATUS.FORBIDDEN);
    expect((await server.inject({ method: 'GET', url: '/api/v1/settings/branding', headers: conditionalHeaders })).statusCode)
      .toBe(HTTP_STATUS.FORBIDDEN);
    expect((await server.inject({ method: 'PUT', url: '/api/v1/settings/branding', headers: conditionalHeaders, payload: {} })).statusCode)
      .toBe(HTTP_STATUS.FORBIDDEN);

    const [originalBranding] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'org.branding'));
    try {
      await db.insert(schema.settings).values({ key: 'org.branding', value: { app_name: 'Private branding' } })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: { app_name: 'Private branding' } } });
      const orgHeaders = await actor([
        { action: 'read', subject: 'OrgSettings' },
        { action: 'update', subject: 'OrgSettings' },
        { action: 'read', subject: 'BrandingSettings', conditions: { id: 'limited' } },
        { action: 'update', subject: 'BrandingSettings', conditions: { id: 'limited' } },
      ]);
      const list = await server.inject({ method: 'GET', url: '/api/v1/settings', headers: orgHeaders });
      expect(list.statusCode).toBe(HTTP_STATUS.OK);
      expect(JSON.parse(list.body).items.some((item: { key: string }) => item.key === 'org.branding')).toBe(false);
      const bypass = await server.inject({
        method: 'POST', url: '/api/v1/settings', headers: orgHeaders,
        payload: { key: 'org.branding', value: { app_name: 'Changed branding' } },
      });
      expect(bypass.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
      const [branding] = await db.select().from(schema.settings).where(eq(schema.settings.key, 'org.branding'));
      expect(branding.value).toMatchObject({ app_name: 'Private branding' });
    } finally {
      if (originalBranding) {
        await db.update(schema.settings).set({ value: originalBranding.value, updated_at: originalBranding.updated_at })
          .where(eq(schema.settings.key, 'org.branding'));
      } else {
        await db.delete(schema.settings).where(eq(schema.settings.key, 'org.branding'));
      }
    }
  });
});
