import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { closeTestServer, createTestServer, testUser } from '@/test/helpers';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { getDatabase, schema } from '@/db';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function readPdfText(bytes: Uint8Array) {
  const document = await getDocument({ data: bytes, useSystemFonts: true }).promise;
  const content = await (await document.getPage(1)).getTextContent();
  return content.items.map((item) => 'str' in item ? item.str : '').join(' ');
}

async function issueSuperAdminToken() {
  const db = getDatabase();
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'SUPER_ADMIN')).limit(1);
  if (!role) {
    throw new Error('SUPER_ADMIN role is required for reports export tests');
  }

  const token = await generateAccessToken(testUser.id, testUser.email, role.id, role.name);
  await createSessionRepository().create({
    user_id: testUser.id,
    access_jti: token.jti,
    expires_at: token.expiresAt,
  });

  return token.token;
}

describe('Reports PDF exports', () => {
  let server: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    token = await issueSuperAdminToken();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('exports the reports snapshot as a non-empty PDF', async () => {
    const db = getDatabase();
    const screenId = randomUUID();
    const mediaId = randomUUID();

    await db.insert(schema.screens).values({
      id: screenId,
      name: 'Export Screen',
      status: 'ACTIVE',
    });
    await db.insert(schema.media).values({
      id: mediaId,
      name: 'Export Media',
      type: 'IMAGE',
      status: 'READY',
      created_by: testUser.id,
    });
    await db.insert(schema.notifications).values({
      id: randomUUID(),
      user_id: testUser.id,
      title: 'Export Notification',
      message: 'Notification body',
      type: 'INFO',
      is_read: false,
    });
    await db.insert(schema.proofOfPlay).values({
      id: randomUUID(),
      screen_id: screenId,
      media_id: mediaId,
      started_at: new Date('2026-03-01T10:00:00.000Z'),
      ended_at: new Date('2026-03-01T10:05:00.000Z'),
      idempotency_key: `reports-export-${randomUUID()}`,
      created_at: new Date('2026-03-01T10:05:30.000Z'),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reports/export',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/pdf',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('.pdf');
    expect(response.body.startsWith('%PDF')).toBe(true);
    expect(response.body.length).toBeGreaterThan(500);
    const text = await readPdfText(new Uint8Array(response.rawPayload));
    expect(text).toContain('Emergency Status');
    expect(text).toContain('Recent Proof of Play');
    expect(text).toContain('Outcome unknown');
  });

  it('allows a Report-only role to export and denies a role without report access', async () => {
    const db = getDatabase();
    const issueToken = async (grants: Array<{ action: 'read'; subject: 'Report' | 'Media' }>) => {
      const roleId = randomUUID();
      await db.insert(schema.roles).values({
        id: roleId,
        name: `Report export fixture ${roleId}`,
        permissions: { grants },
      });
      const issued = await generateAccessToken(testUser.id, testUser.email, roleId, 'CUSTOM');
      await createSessionRepository().create({
        user_id: testUser.id,
        access_jti: issued.jti,
        expires_at: issued.expiresAt,
      });
      return issued.token;
    };
    const reportToken = await issueToken([{ action: 'read', subject: 'Report' }]);
    const reportResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${reportToken}` },
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.body.startsWith('%PDF')).toBe(true);
    const text = await readPdfText(new Uint8Array(reportResponse.rawPayload));
    expect(text).not.toContain('Emergency Status');
    expect(text).not.toContain('Recent Proof of Play');

    const deniedToken = await issueToken([{ action: 'read', subject: 'Media' }]);
    const deniedResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/reports/export',
      headers: { authorization: `Bearer ${deniedToken}` },
    });
    expect(deniedResponse.statusCode).toBe(403);
  });

  it('exports filtered audit logs as a non-empty PDF', async () => {
    const db = getDatabase();

    await db.insert(schema.auditLogs).values({
      id: randomUUID(),
      user_id: testUser.id,
      action: 'SCREEN_UPDATE',
      entity_type: 'Screen',
      entity_id: randomUUID(),
      ip_address: '127.0.0.1',
      created_at: new Date('2026-03-02T09:00:00.000Z'),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/audit-logs/export?action=SCREEN_UPDATE',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/pdf',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('.pdf');
    expect(response.body.startsWith('%PDF')).toBe(true);
    expect(response.body.length).toBeGreaterThan(500);
  });
});
