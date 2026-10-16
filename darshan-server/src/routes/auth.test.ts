import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestServer, generateTestToken, testRoles, testUser, closeTestServer } from '../test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { hashPassword } from '@/auth/password';

async function waitForDatabaseCondition(
  check: () => Promise<boolean>,
  description: string,
  timeoutMs = 5000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe('Auth Routes', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createTestServer();
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  describe('POST /api/v1/auth/login', () => {
    it('should return 400 for invalid email rejected by the route schema', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'invalid-email',
          password: 'password123',
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(body.error.message).toBe('Invalid request');
    });

    it('should return 401 for invalid credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return JWT token for valid credentials', async () => {
      // This test assumes a test user exists in the database
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: testUser.email,
          password: testUser.password,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body).toHaveProperty('expiresAt');
    });

    it('does not issue a session from credentials invalidated by a concurrent password change', async () => {
      const pool = getDatabasePool();
      if (!pool) throw new Error('Database pool is required for login race coverage');
      const db = getDatabase();
      const userId = randomUUID();
      const email = `login-race-${userId}@example.test`;
      const oldPassword = 'OldPassword123!';
      const newPasswordHash = await hashPassword('NewPassword123!');
      await db.insert(schema.users).values({
        id: userId,
        email,
        password_hash: await hashPassword(oldPassword),
        role_id: testRoles.ADMIN.id,
        is_active: true,
      });

      const blocker = await pool.connect();
      const observer = await pool.connect();
      try {
        await blocker.query('BEGIN');
        const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await blocker.query('UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1', [
          userId,
          newPasswordHash,
        ]);
        await blocker.query('DELETE FROM sessions WHERE user_id = $1', [userId]);

        const loginPromise = server.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email, password: oldPassword },
        });

        await waitForDatabaseCondition(async () => {
          const result = await observer.query(
            'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1',
            [blockerPid]
          );
          return result.rowCount === 1;
        }, 'login session issuance to wait on the password-change user lock');

        await blocker.query('COMMIT');
        const response = await loginPromise;
        expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
        expect(
          await db.select().from(schema.sessions).where(eq(schema.sessions.user_id, userId))
        ).toHaveLength(0);
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        await db.delete(schema.sessions).where(eq(schema.sessions.user_id, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        blocker.release();
        observer.release();
      }
    }, 15000);
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 without authorization header', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(response.headers['x-request-id']).toBeDefined();
      expect(body.error.traceId).toBe(response.headers['x-request-id']);
    });

    it('should return 401 with invalid token', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });

    it('should return current user with valid token', async () => {
      const token = await generateTestToken(testUser.id);
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('email');
      expect(body).toHaveProperty('role');
    });

    it('should accept access_token cookie when authorization header is absent', async () => {
      const token = await generateTestToken(testUser.id);

      const meResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          cookie: `access_token=${token}`,
        },
      });

      expect(meResponse.statusCode).toBe(HTTP_STATUS.OK);
      expect(meResponse.headers['x-access-token']).toBeTruthy();

      const body = JSON.parse(meResponse.body);
      expect(body.id).toBe(testUser.id);
      expect(body.email).toBe(testUser.email);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should still clear auth cookies and return 200 without authorization header', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      const body = JSON.parse(response.body);
      expect(body).toEqual({ message: 'Logged out successfully' });
      const setCookie = response.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie);
      expect(cookieHeader).toContain('access_token=');
      expect(cookieHeader).toContain('csrf_token=');
    });

    it('should revoke token on logout', async () => {
      const token = await generateTestToken(testUser.id);

      // First logout
      const logoutResponse = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(logoutResponse.statusCode).toBe(HTTP_STATUS.OK);

      // Try to use the same token again
      const meResponse = await server.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(meResponse.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    });
  });
});
