import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { generateAccessToken } from '@/auth/jwt';
import { closeTestServer, createTestActor, createTestServer, generateTestToken, testRoles, testUser } from '@/test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';

async function waitForRowLockWait(table: 'departments' | 'users') {
  const pool = getDatabasePool();
  if (!pool) throw new Error('Test database pool is unavailable');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname = current_database()
         AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock'
         AND query ILIKE $1
       LIMIT 1`,
      [`%${table}%`]
    );
    if (result.rowCount) return;
    await delay(20);
  }
  throw new Error('Expected the competing Department operation to wait for the row lock');
}

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

  it('refuses Department deletion after an assignment commits while deletion waits', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('Test database pool is unavailable');
    const departmentId = randomUUID();
    const userId = randomUUID();
    await db.insert(schema.departments).values({ id: departmentId, name: `Assignment race ${departmentId}` });
    const client = await pool.connect();
    let transactionOpen = false;
    let competing: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query('SELECT id FROM departments WHERE id = $1 FOR SHARE', [departmentId]);
      await client.query(
        'INSERT INTO users (id, email, password_hash, role_id, department_id, is_active) VALUES ($1, $2, $3, $4, $5, true)',
        [userId, `assignment-${userId}@example.test`, 'test-only-hash', testRoles.OPERATOR.id, departmentId]
      );

      const deletion = server.inject({
        method: 'DELETE', url: `/api/v1/departments/${departmentId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      competing = deletion;
      await waitForRowLockWait('departments');
      await client.query('COMMIT');
      transactionOpen = false;

      const response = await deletion;
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe('DEPARTMENT_IN_USE');
      expect(await db.select().from(schema.departments).where(eq(schema.departments.id, departmentId)))
        .toHaveLength(1);
      expect(await db.select().from(schema.users).where(eq(schema.users.id, userId)))
        .toHaveLength(1);
    } finally {
      if (transactionOpen) await client.query('ROLLBACK');
      client.release();
      await competing?.catch(() => undefined);
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await db.delete(schema.departments).where(eq(schema.departments.id, departmentId));
    }
  }, 15_000);

  it('rejects account creation when Department deletion commits before assignment', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('Test database pool is unavailable');
    const departmentId = randomUUID();
    const email = `deleted-department-${randomUUID()}@example.test`;
    await db.insert(schema.departments).values({ id: departmentId, name: `Deletion race ${departmentId}` });
    const client = await pool.connect();
    let transactionOpen = false;
    let competing: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query('SELECT id FROM departments WHERE id = $1 FOR UPDATE', [departmentId]);
      await client.query('DELETE FROM departments WHERE id = $1', [departmentId]);

      const creation = server.inject({
        method: 'POST', url: '/api/v1/users',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { email, password: 'Password123!', role_id: testRoles.OPERATOR.id, department_id: departmentId },
      });
      competing = creation;
      await waitForRowLockWait('departments');
      await client.query('COMMIT');
      transactionOpen = false;

      const response = await creation;
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error.code).toBe('NOT_FOUND');
      expect(await db.select().from(schema.users).where(eq(schema.users.email, email)))
        .toHaveLength(0);
    } finally {
      if (transactionOpen) await client.query('ROLLBACK');
      client.release();
      await competing?.catch(() => undefined);
      await db.delete(schema.users).where(eq(schema.users.email, email));
      await db.delete(schema.departments).where(eq(schema.departments.id, departmentId));
    }
  }, 15_000);

  it('applies conditional Department grants to list, detail, create, update and delete', async () => {
    const db = getDatabase();
    const allowedId = randomUUID();
    const deniedId = randomUUID();
    const roleId = randomUUID();
    const actorId = randomUUID();
    const allowedName = `Allowed ${allowedId}`;
    const newName = `New department ${randomUUID()}`;
    const roleName = `DEPT_DELETE_${roleId}`;
    const email = `department-editor-${actorId}@example.test`;
    await db.insert(schema.departments).values([
      { id: allowedId, name: allowedName },
      { id: deniedId, name: `Denied ${deniedId}` },
    ]);
    await db.insert(schema.roles).values({
      id: roleId, name: roleName, is_system: false,
      permissions: { grants: [
        { action: 'read', subject: 'Department', conditions: { id: allowedId } },
        { action: 'create', subject: 'Department', conditions: { name: newName } },
        { action: 'update', subject: 'Department', conditions: { name: allowedName } },
        { action: 'delete', subject: 'Department', conditions: { id: allowedId } },
      ] },
    });
    await db.insert(schema.users).values({
      id: actorId, email, password_hash: 'test-only-hash', role_id: roleId, is_active: true,
    });
    const access = await generateAccessToken(actorId, email, roleId, roleName);
    await db.insert(schema.sessions).values({
      user_id: actorId, access_jti: access.jti, expires_at: access.expiresAt,
    });
    try {
      const list = await server.inject({
        method: 'GET', url: '/api/v1/departments?page=1&limit=1',
        headers: { authorization: `Bearer ${access.token}` },
      });
      expect(list.statusCode).toBe(200);
      expect(JSON.parse(list.body).pagination.total).toBe(1);
      expect(JSON.parse(list.body).items.map((item: { id: string }) => item.id)).toEqual([allowedId]);

      const hiddenDetail = await server.inject({
        method: 'GET', url: `/api/v1/departments/${deniedId}`,
        headers: { authorization: `Bearer ${access.token}` },
      });
      expect(hiddenDetail.statusCode).toBe(404);

      const deniedCreate = await server.inject({
        method: 'POST', url: '/api/v1/departments',
        headers: { authorization: `Bearer ${access.token}` },
        payload: { name: `Rejected ${randomUUID()}` },
      });
      expect(deniedCreate.statusCode).toBe(403);
      const allowedCreate = await server.inject({
        method: 'POST', url: '/api/v1/departments',
        headers: { authorization: `Bearer ${access.token}` },
        payload: { name: newName },
      });
      expect(allowedCreate.statusCode).toBe(201);

      const deniedUpdate = await server.inject({
        method: 'PATCH', url: `/api/v1/departments/${deniedId}`,
        headers: { authorization: `Bearer ${access.token}` },
        payload: { description: 'Must not change' },
      });
      expect(deniedUpdate.statusCode).toBe(403);
      const deniedRename = await server.inject({
        method: 'PATCH', url: `/api/v1/departments/${allowedId}`,
        headers: { authorization: `Bearer ${access.token}` },
        payload: { name: `Outside grant ${randomUUID()}` },
      });
      expect(deniedRename.statusCode).toBe(403);
      const allowedUpdate = await server.inject({
        method: 'PATCH', url: `/api/v1/departments/${allowedId}`,
        headers: { authorization: `Bearer ${access.token}` },
        payload: { description: 'Within grant' },
      });
      expect(allowedUpdate.statusCode).toBe(200);
      expect(JSON.parse(allowedUpdate.body).description).toBe('Within grant');

      const denied = await server.inject({
        method: 'DELETE', url: `/api/v1/departments/${deniedId}`,
        headers: { authorization: `Bearer ${access.token}` },
      });
      expect(denied.statusCode).toBe(403);
      expect(await db.select().from(schema.departments).where(eq(schema.departments.id, deniedId)))
        .toHaveLength(1);

      const allowed = await server.inject({
        method: 'DELETE', url: `/api/v1/departments/${allowedId}`,
        headers: { authorization: `Bearer ${access.token}` },
      });
      expect(allowed.statusCode).toBe(200);
      expect(await db.select().from(schema.departments).where(eq(schema.departments.id, allowedId)))
        .toHaveLength(0);
    } finally {
      await db.delete(schema.sessions).where(eq(schema.sessions.user_id, actorId));
      await db.delete(schema.users).where(eq(schema.users.id, actorId));
      await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
      await db.delete(schema.departments).where(eq(schema.departments.id, allowedId));
      await db.delete(schema.departments).where(eq(schema.departments.id, deniedId));
      await db.delete(schema.departments).where(eq(schema.departments.name, newName));
    }
  });

  it('does not delete a Department after the caller session is revoked while its actor row is locked', async () => {
    const db = getDatabase();
    const pool = getDatabasePool();
    if (!pool) throw new Error('Test database pool is unavailable');
    const departmentId = randomUUID();
    const actor = await createTestActor('ADMIN');
    await db.insert(schema.departments).values({ id: departmentId, name: `Revoked ${departmentId}` });
    const client = await pool.connect();
    let transactionOpen = false;
    let competing: Promise<unknown> | undefined;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [actor.id]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [actor.id]);

      const deletion = server.inject({
        method: 'DELETE', url: `/api/v1/departments/${departmentId}`,
        headers: { authorization: `Bearer ${actor.token}` },
      });
      competing = deletion;
      await waitForRowLockWait('users');
      await client.query('COMMIT');
      transactionOpen = false;

      const response = await deletion;
      expect(response.statusCode).toBe(401);
      expect(await db.select().from(schema.departments).where(eq(schema.departments.id, departmentId)))
        .toHaveLength(1);
    } finally {
      if (transactionOpen) await client.query('ROLLBACK');
      client.release();
      await competing?.catch(() => undefined);
      await db.delete(schema.sessions).where(eq(schema.sessions.user_id, actor.id));
      await db.delete(schema.users).where(eq(schema.users.id, actor.id));
      await db.delete(schema.departments).where(eq(schema.departments.id, departmentId));
    }
  }, 15_000);
});
