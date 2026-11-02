import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { closeTestServer, createTestServer, generateTestToken, testRoles } from '@/test/helpers';
import * as mediaAccess from '@/utils/media-access';

describe('operator additional departments', () => {
  let server: FastifyInstance;
  let adminToken: string;
  let operatorId: string;
  let operatorEmail: string;
  let operatorToken: string;
  let departmentA: string;
  let departmentB: string;
  let departmentC: string;

  const authorization = (token: string) => ({ authorization: `Bearer ${token}` });
  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) =>
    server.inject({ method, url, headers: authorization(token), payload });

  async function operatorSession(primaryDepartmentId: string) {
    const issued = await generateAccessToken(
      operatorId, operatorEmail, testRoles.OPERATOR.id, 'OPERATOR', primaryDepartmentId
    );
    await createSessionRepository().create({
      user_id: operatorId,
      access_jti: issued.jti,
      expires_at: issued.expiresAt,
    });
    return issued.token;
  }

  beforeAll(async () => {
    server = await createTestServer();
    adminToken = await generateTestToken('00000000-0000-0000-0000-000000000001', 'ADMIN');
    const db = getDatabase();
    const names = ['A', 'B', 'C'];
    const departments = await db.insert(schema.departments).values(names.map((name) => ({
      id: randomUUID(), name: `Multi-department ${name} ${randomUUID()}`,
    }))).returning();
    [departmentA, departmentB, departmentC] = departments.map((item) => item.id);
    operatorEmail = `multi-${randomUUID()}@example.test`;
    const created = await request('POST', '/api/v1/users', adminToken, {
      email: operatorEmail,
      password: 'Password123!',
      role_id: testRoles.OPERATOR.id,
      department_id: departmentA,
      additional_department_ids: [departmentB],
    });
    expect(created.statusCode).toBe(201);
    operatorId = created.json().id;
    operatorToken = await operatorSession(departmentA);
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('keeps the scalar primary field and adds one consistent membership view', async () => {
    const detail = await request('GET', `/api/v1/users/${operatorId}`, adminToken);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      department_id: departmentA,
      department_ids: [departmentA, departmentB],
      additional_department_ids: [departmentB],
      departments: [
        { id: departmentA, is_primary: true },
        { id: departmentB, is_primary: false },
      ],
    });
    const me = await request('GET', '/api/v1/auth/me', operatorToken);
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      department_id: departmentA,
      department_ids: [departmentA, departmentB],
    });
    const filtered = await request('GET', `/api/v1/users?department_id=${departmentB}&limit=100`, adminToken);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().items.filter((user: { id: string }) => user.id === operatorId)).toHaveLength(1);
    const searched = await request('GET',
      `/api/v1/users?role=OPERATOR&search=${encodeURIComponent(operatorEmail)}&page=1&limit=9`, adminToken);
    expect(searched.statusCode).toBe(200);
    expect(searched.json().pagination.total).toBe(1);
    expect(searched.json().items[0].id).toBe(operatorId);
    const firstDepartment = await request('GET',
      `/api/v1/departments?search=${encodeURIComponent(operatorEmail)}&page=1&limit=1`, adminToken);
    const secondDepartment = await request('GET',
      `/api/v1/departments?search=${encodeURIComponent(operatorEmail)}&page=2&limit=1`, adminToken);
    expect(firstDepartment.statusCode).toBe(200);
    expect(secondDepartment.statusCode).toBe(200);
    expect(firstDepartment.json().pagination.total).toBe(2);
    expect(new Set([firstDepartment.json().items[0].id, secondDepartment.json().items[0].id]))
      .toEqual(new Set([departmentA, departmentB]));
  });

  it('shows A/B people and content, but denies C, without granting global management', async () => {
    const db = getDatabase();
    const fixture = await db.insert(schema.users).values([
      { id: randomUUID(), email: `b-${randomUUID()}@example.test`, password_hash: 'fixture', role_id: testRoles.OPERATOR.id, department_id: departmentB },
      { id: randomUUID(), email: `c-${randomUUID()}@example.test`, password_hash: 'fixture', role_id: testRoles.OPERATOR.id, department_id: departmentC },
    ]).returning();
    const users = await request('GET', '/api/v1/users?limit=100', operatorToken);
    expect(users.statusCode).toBe(200);
    const visible = new Set(users.json().items.map((item: { id: string }) => item.id));
    expect(visible.has(fixture[0].id)).toBe(true);
    expect(visible.has(fixture[1].id)).toBe(false);

    const media = await db.insert(schema.media).values([
      { id: randomUUID(), name: 'B media', type: 'IMAGE', created_by: fixture[0].id, owner_scope: 'DEPARTMENT', owner_department_id: departmentB },
      { id: randomUUID(), name: 'C media', type: 'IMAGE', created_by: fixture[1].id, owner_scope: 'DEPARTMENT', owner_department_id: departmentC },
    ]).returning();
    const list = await request('GET', '/api/v1/media?limit=100', operatorToken);
    expect(list.statusCode).toBe(200);
    const mediaIds = new Set(list.json().items.map((item: { id: string }) => item.id));
    expect(mediaIds.has(media[0].id)).toBe(true);
    expect(mediaIds.has(media[1].id)).toBe(false);
    expect((await request('GET', `/api/v1/media/${media[1].id}`, operatorToken)).statusCode).toBe(403);
    expect((await request('POST', '/api/v1/users', operatorToken, {
      email: `forbidden-${randomUUID()}@example.test`, password: 'Password123!',
      role_id: testRoles.OPERATOR.id, department_id: departmentA,
    })).statusCode).toBe(403);
  });

  it('rejects invalid assignments and preserves extras on an old PATCH', async () => {
    for (const [primary, extras, role] of [
      [departmentA, [departmentB, departmentB], testRoles.OPERATOR.id],
      [departmentA, [departmentA], testRoles.OPERATOR.id],
      [departmentA, [randomUUID()], testRoles.OPERATOR.id],
      [undefined, [departmentB], testRoles.OPERATOR.id],
      [departmentA, [departmentB], testRoles.DEPARTMENT.id],
    ] as const) {
      const response = await request('POST', '/api/v1/users', adminToken, {
        email: `invalid-${randomUUID()}@example.test`, password: 'Password123!',
        role_id: role, department_id: primary, additional_department_ids: extras,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_DEPARTMENT_MEMBERSHIP');
    }
    const oldPatch = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      first_name: 'Renamed', department_id: departmentA,
    });
    expect(oldPatch.statusCode).toBe(200);
    expect(oldPatch.json().additional_department_ids).toEqual([departmentB]);
    const conflict = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      department_id: departmentB,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('PRIMARY_DEPARTMENT_CONFLICT');
  });

  it('supports two secondary departments without duplicating filtered or paginated users', async () => {
    const extras = [departmentB, departmentC].sort();
    const created = await request('POST', '/api/v1/users', adminToken, {
      email: `three-departments-${randomUUID()}@example.test`, password: 'Password123!',
      role_id: testRoles.OPERATOR.id, department_id: departmentA,
      additional_department_ids: [departmentC, departmentB],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json()).toMatchObject({
      department_id: departmentA,
      department_ids: [departmentA, ...extras],
      additional_department_ids: extras,
    });
    for (const departmentId of [departmentA, departmentB, departmentC]) {
      const filtered = await request('GET', `/api/v1/users?department_id=${departmentId}&limit=100`, adminToken);
      expect(filtered.statusCode).toBe(200);
      expect(filtered.json().items.filter((user: { id: string }) => user.id === id)).toHaveLength(1);
    }
    const paginated = await request('GET', '/api/v1/users?role=OPERATOR&page=1&limit=100', adminToken);
    expect(paginated.statusCode).toBe(200);
    expect(paginated.json().items.filter((user: { id: string }) => user.id === id)).toHaveLength(1);
    expect(new Set(paginated.json().items.map((user: { id: string }) => user.id)).size)
      .toBe(paginated.json().items.length);
  });

  it('restricts secondary assignment to global User managers for create, invite, and update', async () => {
    const [manager] = await getDatabase().insert(schema.users).values({
      email: `department-manager-${randomUUID()}@example.test`, password_hash: 'fixture',
      role_id: testRoles.DEPARTMENT.id, department_id: departmentA,
    }).returning();
    const issued = await generateAccessToken(
      manager.id, manager.email, testRoles.DEPARTMENT.id, 'DEPARTMENT', departmentA
    );
    await createSessionRepository().create({
      user_id: manager.id, access_jti: issued.jti, expires_at: issued.expiresAt,
    });
    const create = await request('POST', '/api/v1/users', issued.token, {
      email: `manager-create-${randomUUID()}@example.test`, password: 'Password123!',
      role_id: testRoles.OPERATOR.id, department_id: departmentA,
      additional_department_ids: [departmentB],
    });
    expect(create.statusCode).toBe(403);
    const invite = await request('POST', '/api/v1/users/invite', issued.token, {
      email: `manager-invite-${randomUUID()}@example.test`,
      role_id: testRoles.OPERATOR.id, department_id: departmentA,
      additional_department_ids: [departmentB],
    });
    expect(invite.statusCode).toBe(403);
    const update = await request('PATCH', `/api/v1/users/${operatorId}`, issued.token, {
      additional_department_ids: [departmentB, departmentC],
    });
    expect(update.statusCode).toBe(403);
    const detail = await request('GET', `/api/v1/users/${operatorId}`, adminToken);
    expect(detail.json().additional_department_ids).not.toContain(departmentC);
  });

  it('preserves membership metadata through invitation and list responses', async () => {
    const extras = [departmentB, departmentC].sort();
    const invited = await request('POST', '/api/v1/users/invite', adminToken, {
      email: `invited-multi-${randomUUID()}@example.test`,
      role_id: testRoles.OPERATOR.id, department_id: departmentA,
      additional_department_ids: [departmentB, departmentC],
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({
      department_id: departmentA,
      department_ids: [departmentA, ...extras],
      additional_department_ids: extras,
    });
    const listed = await request('GET', '/api/v1/users/invite?limit=100', adminToken);
    expect(listed.statusCode).toBe(200);
    const row = listed.json().items.find((user: { id: string }) => user.id === invited.json().id);
    expect(row).toMatchObject({
      department_id: departmentA,
      department_ids: [departmentA, ...extras],
    });
  });

  it('allows chat discovery through a shared additional department only', async () => {
    const users = await getDatabase().insert(schema.users).values([
      { id: randomUUID(), email: `chat-b-${randomUUID()}@example.test`, password_hash: 'fixture',
        role_id: testRoles.OPERATOR.id, department_id: departmentB },
      { id: randomUUID(), email: `chat-c-${randomUUID()}@example.test`, password_hash: 'fixture',
        role_id: testRoles.OPERATOR.id, department_id: departmentC },
    ]).returning();
    operatorToken = await operatorSession(departmentA);
    const allowed = await request('POST', '/api/v1/chat/dm', operatorToken, { otherUserId: users[0].id });
    expect(allowed.statusCode).toBe(200);
    const denied = await request('POST', '/api/v1/chat/dm', operatorToken, { otherUserId: users[1].id });
    expect(denied.statusCode).toBe(404);
  });

  it('keeps an already shared chat file while removed B membership blocks library and new discovery', async () => {
    const db = getDatabase();
    const [bOnly] = await db.insert(schema.users).values({
      email: `chat-retained-b-${randomUUID()}@example.test`, password_hash: 'fixture',
      role_id: testRoles.OPERATOR.id, department_id: departmentB,
    }).returning();
    const dm = await request('POST', '/api/v1/chat/dm', operatorToken, { otherUserId: bOnly.id });
    expect(dm.statusCode).toBe(200);
    const conversationId = dm.json().conversation.id as string;
    const [media] = await db.insert(schema.media).values({
      name: 'Previously shared B file', type: 'IMAGE', status: 'READY',
      created_by: bOnly.id, owner_scope: 'DEPARTMENT', owner_department_id: departmentB,
    }).returning();
    const [bookmarkedMedia] = await db.insert(schema.media).values({
      name: 'Previously bookmarked B file', type: 'IMAGE', status: 'READY',
      created_by: operatorId, owner_scope: 'DEPARTMENT', owner_department_id: departmentB,
    }).returning();
    const bookmark = await request('POST', `/api/v1/chat/conversations/${conversationId}/bookmarks`,
      operatorToken, { type: 'FILE', label: 'Shared B bookmark', mediaAssetId: bookmarkedMedia.id });
    expect(bookmark.statusCode).toBe(200);
    expect(bookmark.json().bookmark.share_authorized_at).toBeTruthy();
    const [message] = await db.insert(schema.chatMessages).values({
      conversation_id: conversationId, sender_id: bOnly.id, seq: 1,
      body_text: 'shared before membership removal', body_rich: {},
    }).returning();
    await db.insert(schema.chatAttachments).values({ message_id: message.id, media_asset_id: media.id });
    const removed = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      additional_department_ids: [],
    });
    expect(removed.statusCode).toBe(200);
    expect((await request('GET', '/api/v1/auth/me', operatorToken)).statusCode).toBe(401);
    operatorToken = await operatorSession(departmentA);
    expect((await request('GET', `/api/v1/media/${media.id}`, operatorToken)).statusCode).toBe(403);
    expect((await request('GET', `/api/v1/media/${bookmarkedMedia.id}`, operatorToken)).statusCode).toBe(403);
    expect((await request('POST', '/api/v1/chat/dm', operatorToken, { otherUserId: bOnly.id })).statusCode)
      .toBe(404);
    const accessSpy = vi.spyOn(mediaAccess, 'resolveMediaAccess').mockResolvedValue({
      media_url: 'http://example.test/shared-before-removal', is_object_missing: false,
      content_type: 'image/png', source_content_type: 'image/png', size: 4,
      ready_object_id: null, ready_object_sha256: null, ready_object_created_at: null,
    });
    try {
      const chatFile = await request('GET',
        `/api/v1/chat/conversations/${conversationId}/attachments/${media.id}`, operatorToken);
      expect(chatFile.statusCode).toBe(200);
      expect(chatFile.json().media_url).toContain('shared-before-removal');
      const bookmarkedFile = await request('GET',
        `/api/v1/chat/conversations/${conversationId}/attachments/${bookmarkedMedia.id}`, operatorToken);
      expect(bookmarkedFile.statusCode).toBe(200);
      const [legacyMedia] = await db.insert(schema.media).values({
        name: 'Legacy B bookmark file', type: 'IMAGE', status: 'READY',
        created_by: operatorId, owner_scope: 'DEPARTMENT', owner_department_id: departmentB,
      }).returning();
      const [legacyBookmark] = await db.insert(schema.chatBookmarks).values({
        conversation_id: conversationId, type: 'FILE', label: 'Legacy B bookmark',
        media_asset_id: legacyMedia.id, created_by: operatorId,
      }).returning();
      expect(legacyBookmark.share_authorized_at).toBeNull();
      expect((await request('GET',
        `/api/v1/chat/conversations/${conversationId}/attachments/${legacyMedia.id}`, operatorToken))
        .statusCode).toBe(404);
    } finally {
      accessSpy.mockRestore();
    }
    const restored = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      additional_department_ids: [departmentB],
    });
    expect(restored.statusCode).toBe(200);
    operatorToken = await operatorSession(departmentA);
  });

  it('moves primary only for future ownership, revokes sessions and blocks department deletion', async () => {
    const db = getDatabase();
    const oldLayout = await request('POST', '/api/v1/layouts', operatorToken, {
      name: 'Owned in A', aspect_ratio: '16:9',
      spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
    });
    // A previous update may already have revoked the operator token.
    if (oldLayout.statusCode === 401) {
      operatorToken = await operatorSession(departmentA);
    }
    const inA = oldLayout.statusCode === 401
      ? await request('POST', '/api/v1/layouts', operatorToken, {
          name: 'Owned in A', aspect_ratio: '16:9',
          spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
        }) : oldLayout;
    expect(inA.statusCode).toBe(201);
    expect(inA.json().ownership.department_id).toBe(departmentA);

    const updated = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      department_id: departmentB,
      additional_department_ids: [departmentA],
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ department_id: departmentB,
      department_ids: [departmentB, departmentA] });
    expect((await request('GET', '/api/v1/auth/me', operatorToken)).statusCode).toBe(401);
    operatorToken = await operatorSession(departmentB);
    const inB = await request('POST', '/api/v1/layouts', operatorToken, {
      name: 'Owned in B', aspect_ratio: '16:9',
      spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
    });
    expect(inB.statusCode).toBe(201);
    expect(inB.json().ownership.department_id).toBe(departmentB);
    const [retained] = await db.select().from(schema.layouts).where(eq(schema.layouts.id, inA.json().id));
    expect(retained.owner_department_id).toBe(departmentA);
    expect((await request('GET', `/api/v1/layouts/${retained.id}`, operatorToken)).statusCode).toBe(200);
    const blocked = await request('DELETE', `/api/v1/departments/${departmentA}`, adminToken);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('DEPARTMENT_IN_USE');
  });

  it('blocks deletion for an additional-only assignment, then permits it after removal', async () => {
    const [department] = await getDatabase().insert(schema.departments)
      .values({ name: `Additional only ${randomUUID()}` }).returning();
    const assigned = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      additional_department_ids: [departmentA, department.id],
    });
    expect(assigned.statusCode).toBe(200);
    const blocked = await request('DELETE', `/api/v1/departments/${department.id}`, adminToken);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details).toMatchObject({
      users: 0, additional_users: 1, media: 0, layouts: 0,
    });
    const removed = await request('PATCH', `/api/v1/users/${operatorId}`, adminToken, {
      additional_department_ids: [departmentA],
    });
    expect(removed.statusCode).toBe(200);
    expect((await request('DELETE', `/api/v1/departments/${department.id}`, adminToken)).statusCode).toBe(200);
  });

  it('serializes a content creation against membership removal in both lock orders', async () => {
    const created = await request('POST', '/api/v1/users', adminToken, {
      email: `race-${randomUUID()}@example.test`, password: 'Password123!',
      role_id: testRoles.OPERATOR.id, department_id: departmentA,
      additional_department_ids: [departmentB],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const email = created.json().email as string;
    const issueToken = async () => {
      const issued = await generateAccessToken(id, email, testRoles.OPERATOR.id, 'OPERATOR', departmentA);
      await createSessionRepository().create({ user_id: id, access_jti: issued.jti,
        expires_at: issued.expiresAt });
      return issued.token;
    };
    const layoutPayload = (name: string) => ({
      name, aspect_ratio: '16:9',
      spec: { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] },
    });
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is required for membership race coverage');
    const blocker = await pool.connect();
    const observer = await pool.connect();
    const waitForBlock = async (pid: number) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const blocked = await observer.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1', [pid]);
        if (blocked.rowCount) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      throw new Error('Timed out waiting for the membership transaction lock');
    };

    try {
      // Removal queues first. The later creation must see a revoked session.
      const staleToken = await issueToken();
      await blocker.query('BEGIN');
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
      const removal = request('PATCH', `/api/v1/users/${id}`, adminToken,
        { additional_department_ids: [] });
      await waitForBlock(pid);
      const deniedCreation = request('POST', '/api/v1/layouts', staleToken,
        layoutPayload('Rejected after removal'));
      await blocker.query('COMMIT');
      expect((await removal).statusCode).toBe(200);
      expect((await deniedCreation).statusCode).toBe(401);

      // Creation queues first. It may commit, then removal revokes its token.
      expect((await request('PATCH', `/api/v1/users/${id}`, adminToken,
        { additional_department_ids: [departmentB] })).statusCode).toBe(200);
      const validToken = await issueToken();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id]);
      const allowedCreation = request('POST', '/api/v1/layouts', validToken,
        layoutPayload('Committed before removal'));
      await waitForBlock(pid);
      const secondRemoval = request('PATCH', `/api/v1/users/${id}`, adminToken,
        { additional_department_ids: [] });
      await blocker.query('COMMIT');
      const layout = await allowedCreation;
      expect(layout.statusCode).toBe(201);
      expect(layout.json().ownership.department_id).toBe(departmentA);
      expect((await secondRemoval).statusCode).toBe(200);
      expect((await request('GET', '/api/v1/auth/me', validToken)).statusCode).toBe(401);
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      observer.release();
    }
  });

  it('settles a department deletion and assignment race without a dangling membership', async () => {
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is required for department deletion race coverage');
    const blocker = await pool.connect();
    const observer = await pool.connect();
    const waitForBlock = async (pid: number) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const blocked = await observer.query(
          'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1', [pid]);
        if (blocked.rowCount) return;
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      throw new Error('Timed out waiting for a department row lock');
    };
    try {
      const [retained] = await getDatabase().insert(schema.departments)
        .values({ name: `Race retained ${randomUUID()}` }).returning();
      await blocker.query('BEGIN');
      const pid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query(
        'INSERT INTO user_additional_departments (user_id, department_id) VALUES ($1, $2)',
        [operatorId, retained.id]
      );
      const deletion = request('DELETE', `/api/v1/departments/${retained.id}`, adminToken);
      await waitForBlock(pid);
      await blocker.query('COMMIT');
      expect((await deletion).statusCode).toBe(409);
      expect((await request('PATCH', `/api/v1/users/${operatorId}`, adminToken,
        { additional_department_ids: [departmentA] })).statusCode).toBe(200);
      expect((await request('DELETE', `/api/v1/departments/${retained.id}`, adminToken)).statusCode).toBe(200);

      const [removed] = await getDatabase().insert(schema.departments)
        .values({ name: `Race removed ${randomUUID()}` }).returning();
      await blocker.query('BEGIN');
      await blocker.query('DELETE FROM departments WHERE id = $1', [removed.id]);
      const lateAssignment = request('PATCH', `/api/v1/users/${operatorId}`, adminToken,
        { additional_department_ids: [departmentA, removed.id] });
      await waitForBlock(pid);
      await blocker.query('COMMIT');
      const response = await lateAssignment;
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_DEPARTMENT_MEMBERSHIP');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
      observer.release();
    }
  });

  it('clears secondary memberships atomically on role change and tombstone', async () => {
    const email = `role-change-${randomUUID()}@example.test`;
    const created = await request('POST', '/api/v1/users', adminToken, {
      email, password: 'Password123!', role_id: testRoles.OPERATOR.id,
      department_id: departmentA, additional_department_ids: [departmentB],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const changed = await request('PATCH', `/api/v1/users/${id}`, adminToken, {
      role_id: testRoles.DEPARTMENT.id,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().additional_department_ids).toEqual([]);
    const [row] = await getDatabase().select().from(schema.userAdditionalDepartments)
      .where(eq(schema.userAdditionalDepartments.user_id, id));
    expect(row).toBeUndefined();

    const createdForDeletion = await request('POST', '/api/v1/users', adminToken, {
      email: `tombstone-${randomUUID()}@example.test`, password: 'Password123!',
      role_id: testRoles.OPERATOR.id,
      department_id: departmentA, additional_department_ids: [departmentB],
    });
    expect(createdForDeletion.statusCode).toBe(201);
    const deletionId = createdForDeletion.json().id as string;
    expect((await request('DELETE', `/api/v1/users/${deletionId}`, adminToken)).statusCode).toBe(200);
    const [deletedMembership] = await getDatabase().select().from(schema.userAdditionalDepartments)
      .where(eq(schema.userAdditionalDepartments.user_id, deletionId));
    expect(deletedMembership).toBeUndefined();
  });
});
