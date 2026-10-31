import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createServer } from '@/server';
import { createSessionRepository } from '@/db/repositories/session';
import { generateAccessToken } from '@/auth/jwt';
import { closeDatabase, getDatabase, initializeDatabase, schema } from '@/db';
import { hashPassword } from '@/auth/password';
import { HTTP_STATUS } from '@/http-status-codes';
import { testRoles, testUser } from '@/test/helpers';
import { createChatRepository } from '@/db/repositories/chat';

async function applyMigrationFile(filename: string) {
  const db = getDatabase();
  const migrationPath = path.resolve(process.cwd(), 'drizzle', 'migrations', filename);
  const content = await readFile(migrationPath, 'utf8');
  const statements = content
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function tableExists(tableName: string) {
  const db = getDatabase();
  const result = await db.execute<{ regclass: string | null }>(
    sql`SELECT to_regclass(${`public.${tableName}`}) AS regclass`
  );
  const first = result.rows[0] as { regclass?: string | null } | undefined;
  return Boolean(first?.regclass);
}

describe('Conversation Routes - chat DM shim', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let otherUserId: string;

  beforeAll(async () => {
    await initializeDatabase();
    server = await createServer();
    if (!(await tableExists('chat_conversations'))) {
      await applyMigrationFile('0008_chat_core.sql');
    }
    await applyMigrationFile('0012_chat_dm_pair_active_unique.sql');

    const db = getDatabase();
    const ensureRole = async (
      name: string,
      fallbackId: string,
      permissions: { grants: Array<{ action: string; subject: string }> } = { grants: [] }
    ) => {
      const [existing] = await db
        .select()
        .from(schema.roles)
        .where(eq(schema.roles.name, name))
        .limit(1);
      if (existing) {
        const [updated] = await db
          .update(schema.roles)
          .set({ permissions })
          .where(eq(schema.roles.id, existing.id))
          .returning();
        return updated ?? existing;
      }
      const [created] = await db
        .insert(schema.roles)
        .values({
          id: fallbackId,
          name,
          permissions,
          is_system: true,
        })
        .returning();
      return created;
    };

    const adminRole = await ensureRole('ADMIN', testRoles.ADMIN.id, {
      grants: [
        { action: 'read', subject: 'Conversation' },
        { action: 'read', subject: 'User' },
      ],
    });
    const operatorRole = await ensureRole('OPERATOR', testRoles.OPERATOR.id);
    const departmentId = randomUUID();
    await db.insert(schema.departments).values({
      id: departmentId,
      name: `Legacy chat ${departmentId}`,
    });

    const adminPassword = await hashPassword('Password123!');
    await db
      .insert(schema.users)
      .values({
        id: testUser.id,
        email: testUser.email,
        password_hash: adminPassword,
        first_name: testUser.first_name,
        last_name: testUser.last_name,
        role_id: adminRole.id,
        department_id: departmentId,
        is_active: true,
      })
      .onConflictDoUpdate({
        target: schema.users.id,
        set: {
          email: testUser.email,
          password_hash: adminPassword,
          first_name: testUser.first_name,
          last_name: testUser.last_name,
          role_id: adminRole.id,
          department_id: departmentId,
          is_active: true,
        },
      });

    const token = await generateAccessToken(
      testUser.id,
      testUser.email,
      adminRole.id,
      adminRole.name,
      departmentId
    );
    await createSessionRepository().create({
      user_id: testUser.id,
      access_jti: token.jti,
      expires_at: token.expiresAt,
    });
    adminToken = token.token;

    otherUserId = randomUUID();
    await db.insert(schema.users).values({
      id: otherUserId,
      email: `legacy-chat-shim-${Date.now()}@example.com`,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Legacy',
      last_name: 'Peer',
      role_id: operatorRole.id,
      department_id: departmentId,
      is_active: true,
    });
  });

  afterAll(async () => {
    await server.close();
    await closeDatabase();
  });

  it('keeps legacy response shape while writing messages to chat_*', async () => {
    const db = getDatabase();

    const startResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { participant_id: otherUserId },
    });
    expect(startResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const startedConversation = JSON.parse(startResponse.body);
    expect(startedConversation).toMatchObject({
      id: expect.any(String),
      participant_a: expect.any(String),
      participant_b: expect.any(String),
    });

    const [chatConversation] = await db
      .select()
      .from(schema.chatConversations)
      .where(eq(schema.chatConversations.id, startedConversation.id))
      .limit(1);
    expect(chatConversation?.type).toBe('DM');
    expect(chatConversation?.state).toBe('ACTIVE');

    const sendResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/conversations/${startedConversation.id}/messages`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        content: 'legacy shim message',
        attachments: [{ media_asset_id: randomUUID(), note: 'legacy' }],
      },
    });
    expect(sendResponse.statusCode).toBe(HTTP_STATUS.CREATED);
    const sentMessage = JSON.parse(sendResponse.body);
    expect(sentMessage).toMatchObject({
      id: expect.any(String),
      conversation_id: startedConversation.id,
      author_id: testUser.id,
      content: 'legacy shim message',
    });

    const [legacyMessage] = await db
      .select()
      .from(schema.conversationMessages)
      .where(eq(schema.conversationMessages.id, sentMessage.id))
      .limit(1);
    expect(legacyMessage).toBeUndefined();

    const [chatMessage] = await db
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, sentMessage.id))
      .limit(1);
    expect(chatMessage?.conversation_id).toBe(startedConversation.id);
    expect(chatMessage?.body_text).toBe('legacy shim message');

    const listResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/conversations/${startedConversation.id}/messages?page=1&limit=20`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listResponse.statusCode).toBe(HTTP_STATUS.OK);
    const listed = JSON.parse(listResponse.body);
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(listed.items[0]).toMatchObject({
      id: sentMessage.id,
      conversation_id: startedConversation.id,
      author_id: testUser.id,
      content: 'legacy shim message',
    });
    expect(Array.isArray(listed.items[0].attachments)).toBe(true);

    const readResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/conversations/${startedConversation.id}/read`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(readResponse.statusCode).toBe(HTTP_STATUS.OK);
    const readBody = JSON.parse(readResponse.body);
    expect(readBody.conversation_id).toBe(startedConversation.id);

    const [receipt] = await db
      .select()
      .from(schema.chatReceipts)
      .where(
        and(
          eq(schema.chatReceipts.conversation_id, startedConversation.id),
          eq(schema.chatReceipts.user_id, testUser.id)
        )
      )
      .limit(1);
    expect(receipt).toBeTruthy();
  });

  it('applies a conditional Conversation read grant to the legacy DM shim', async () => {
    const db = getDatabase();
    const [operatorRole] = await db.select().from(schema.roles).where(eq(schema.roles.name, 'OPERATOR')).limit(1);
    const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, testUser.id)).limit(1);
    if (!operatorRole || !owner?.department_id) throw new Error('Missing legacy chat fixtures');

    const actorId = randomUUID();
    const roleId = randomUUID();
    await db.insert(schema.roles).values({ id: roleId, name: `CONDITIONAL_DM_${roleId}`, is_system: false, permissions: { grants: [] } });
    await db.insert(schema.users).values({
      id: actorId,
      email: `conditional-dm-${actorId}@example.com`,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Conditional',
      last_name: 'Reader',
      role_id: roleId,
      department_id: owner.department_id,
      is_active: true,
    });

    const chatRepo = createChatRepository();
    const permitted = await chatRepo.getOrCreateDm(actorId, testUser.id);
    const denied = await chatRepo.getOrCreateDm(actorId, otherUserId);
    await db.update(schema.roles).set({ permissions: { grants: [
      { action: 'read', subject: 'Conversation', conditions: { id: permitted.id } },
      { action: 'read', subject: 'User' },
    ] } }).where(eq(schema.roles.id, roleId));

    const token = await generateAccessToken(actorId, `conditional-dm-${actorId}@example.com`, roleId, `CONDITIONAL_DM_${roleId}`, owner.department_id);
    await createSessionRepository().create({ user_id: actorId, access_jti: token.jti, expires_at: token.expiresAt });
    const headers = { authorization: `Bearer ${token.token}` };

    const list = await server.inject({ method: 'GET', url: '/api/v1/conversations', headers });
    expect(list.statusCode).toBe(HTTP_STATUS.OK);
    expect(JSON.parse(list.body).items.map((item: { id: string }) => item.id)).toEqual([permitted.id]);

    const allowedMessages = await server.inject({ method: 'GET', url: `/api/v1/conversations/${permitted.id}/messages`, headers });
    expect(allowedMessages.statusCode).toBe(HTTP_STATUS.OK);
    const deniedMessages = await server.inject({ method: 'GET', url: `/api/v1/conversations/${denied.id}/messages`, headers });
    expect(deniedMessages.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const allowedStart = await server.inject({ method: 'POST', url: '/api/v1/conversations', headers, payload: { participant_id: testUser.id } });
    expect(allowedStart.statusCode).toBe(HTTP_STATUS.CREATED);
    const deniedStart = await server.inject({ method: 'POST', url: '/api/v1/conversations', headers, payload: { participant_id: otherUserId } });
    expect(deniedStart.statusCode).toBe(HTTP_STATUS.FORBIDDEN);

    const deniedSend = await server.inject({ method: 'POST', url: `/api/v1/conversations/${denied.id}/messages`, headers, payload: { content: 'must not send' } });
    expect(deniedSend.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    const deniedRead = await server.inject({ method: 'POST', url: `/api/v1/conversations/${denied.id}/read`, headers });
    expect(deniedRead.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    const [message] = await db.select().from(schema.chatMessages).where(and(eq(schema.chatMessages.conversation_id, denied.id), eq(schema.chatMessages.body_text, 'must not send'))).limit(1);
    expect(message).toBeUndefined();
    const [receipt] = await db.select().from(schema.chatReceipts).where(and(eq(schema.chatReceipts.conversation_id, denied.id), eq(schema.chatReceipts.user_id, actorId))).limit(1);
    expect(receipt).toBeUndefined();

    const legacyPeerId = randomUUID();
    await db.insert(schema.users).values({
      id: legacyPeerId,
      email: `legacy-only-peer-${legacyPeerId}@example.com`,
      password_hash: await hashPassword('Password123!'),
      first_name: 'Legacy',
      last_name: 'Only',
      role_id: operatorRole.id,
      department_id: owner.department_id,
      is_active: true,
    });
    const [participantA, participantB] = [actorId, legacyPeerId].sort();
    const [legacyOnly] = await db.insert(schema.conversations).values({
      participant_a: participantA,
      participant_b: participantB,
    }).returning();
    const legacyRead = await server.inject({ method: 'GET', url: `/api/v1/conversations/${legacyOnly.id}/messages`, headers });
    expect(legacyRead.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    const [migrated] = await db.select().from(schema.chatConversations).where(eq(schema.chatConversations.dm_pair_key, `${participantA}:${participantB}`)).limit(1);
    expect(migrated).toBeUndefined();
  });
});
