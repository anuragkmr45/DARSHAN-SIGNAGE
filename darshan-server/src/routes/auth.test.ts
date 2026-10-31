import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { decodeJwt } from 'jose';
import { eq } from 'drizzle-orm';
import { createTestServer, generateTestToken, testRoles, testUser, closeTestServer } from '../test/helpers';
import { HTTP_STATUS } from '@/http-status-codes';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { hashPassword } from '@/auth/password';
import { generateAccessToken, verifyAccessToken, type JWTPayload } from '@/auth/jwt';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { SessionRepository } from '@/db/repositories/session';

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
      expect(body.user.authorization.is_global_user_manager).toBe(true);
      expect(body.user.authorization.rules).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'manage', subject: 'all' }),
      ]));
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
      expect(body.authorization.is_global_user_manager).toBe(true);
      expect(body.authorization.rules).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: 'manage', subject: 'all' }),
      ]));
    });

    it('rejects a live session whose signed role or department claims differ from the stored account', async () => {
      const db = getDatabase();
      const mismatches = [
        { roleId: testRoles.OPERATOR.id, roleName: 'OPERATOR', departmentId: undefined },
        { roleId: testRoles.ADMIN.id, roleName: 'OPERATOR', departmentId: undefined },
        { roleId: testRoles.ADMIN.id, roleName: 'ADMIN', departmentId: randomUUID() },
      ];
      for (const mismatch of mismatches) {
        const access = await generateAccessToken(
          testUser.id, testUser.email, mismatch.roleId, mismatch.roleName, mismatch.departmentId
        );
        await db.insert(schema.sessions).values({
          user_id: testUser.id,
          access_jti: access.jti,
          expires_at: access.expiresAt,
        });
        try {
          const response = await server.inject({
            method: 'GET',
            url: '/api/v1/auth/me',
            headers: { authorization: `Bearer ${access.token}` },
          });
          expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
        } finally {
          await db.delete(schema.sessions).where(eq(schema.sessions.access_jti, access.jti));
        }
      }
    });

    it('rechecks signed role and department claims under the mutation lock even when the session row remains', async () => {
      const db = getDatabase();
      const userId = randomUUID();
      const departmentId = randomUUID();
      const email = `mutation-claim-${userId}@example.test`;
      await db.insert(schema.departments).values({ id: departmentId, name: `Mutation claim ${userId}` });
      await db.insert(schema.users).values({
        id: userId,
        email,
        password_hash: await hashPassword('TestPassword123!'),
        role_id: testRoles.OPERATOR.id,
        is_active: true,
      });
      const access = await generateAccessToken(userId, email, testRoles.OPERATOR.id, 'OPERATOR');
      await db.insert(schema.sessions).values({ user_id: userId, access_jti: access.jti, expires_at: access.expiresAt });
      const signedClaims = decodeJwt(access.token) as JWTPayload;
      let mutationReached = false;
      const attempt = () => withCurrentMutationAuthorization(signedClaims, async () => {
        mutationReached = true;
      });

      try {
        await expect(attempt()).resolves.toBeUndefined();
        expect(mutationReached).toBe(true);
        mutationReached = false;
        await db.update(schema.users).set({ role_id: testRoles.ADMIN.id }).where(eq(schema.users.id, userId));
        await expect(attempt()).rejects.toMatchObject({ statusCode: HTTP_STATUS.UNAUTHORIZED });
        await db.update(schema.users).set({ role_id: testRoles.OPERATOR.id, department_id: departmentId })
          .where(eq(schema.users.id, userId));
        await expect(attempt()).rejects.toMatchObject({ statusCode: HTTP_STATUS.UNAUTHORIZED });
        expect(mutationReached).toBe(false);
        expect(await db.select().from(schema.sessions).where(eq(schema.sessions.access_jti, access.jti))).toHaveLength(1);
      } finally {
        await db.delete(schema.sessions).where(eq(schema.sessions.user_id, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        await db.delete(schema.departments).where(eq(schema.departments.id, departmentId));
      }
    });

    it('rejects a mutation queued behind a committed department change even if its session row survives', async () => {
      const pool = getDatabasePool();
      if (!pool) throw new Error('Database pool is required for mutation race coverage');
      const db = getDatabase();
      const userId = randomUUID();
      const departmentId = randomUUID();
      const email = `mutation-race-${userId}@example.test`;
      await db.insert(schema.departments).values({ id: departmentId, name: `Mutation race ${userId}` });
      await db.insert(schema.users).values({
        id: userId,
        email,
        password_hash: await hashPassword('TestPassword123!'),
        role_id: testRoles.OPERATOR.id,
        is_active: true,
      });
      const access = await generateAccessToken(userId, email, testRoles.OPERATOR.id, 'OPERATOR');
      await db.insert(schema.sessions).values({ user_id: userId, access_jti: access.jti, expires_at: access.expiresAt });
      // Model a route that verified the token before the account change began.
      const initiallyValidClaims = await verifyAccessToken(access.token);
      const blocker = await pool.connect();
      const observer = await pool.connect();
      let pendingWrite: Promise<void> | undefined;
      let pendingOutcome: Promise<{ ok: boolean; error?: unknown }> | undefined;
      let mutationReached = false;
      try {
        await blocker.query('BEGIN');
        const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        await blocker.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
        await blocker.query('UPDATE users SET department_id = $2, updated_at = NOW() WHERE id = $1', [userId, departmentId]);

        pendingWrite = withCurrentMutationAuthorization(initiallyValidClaims, async () => {
          mutationReached = true;
        });
        pendingOutcome = pendingWrite.then(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, error })
        );
        await waitForDatabaseCondition(async () => {
          const result = await observer.query(
            'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) LIMIT 1',
            [blockerPid]
          );
          return result.rowCount === 1;
        }, 'the mutation to wait for the account-change user lock');

        await blocker.query('COMMIT');
        const outcome = await pendingOutcome;
        expect(outcome.ok).toBe(false);
        expect(outcome.error).toMatchObject({ statusCode: HTTP_STATUS.UNAUTHORIZED });
        expect(mutationReached).toBe(false);
        expect(await db.select().from(schema.sessions).where(eq(schema.sessions.access_jti, access.jti))).toHaveLength(1);
      } finally {
        await blocker.query('ROLLBACK').catch(() => undefined);
        await pendingOutcome;
        blocker.release();
        observer.release();
        await db.delete(schema.sessions).where(eq(schema.sessions.user_id, userId));
        await db.delete(schema.users).where(eq(schema.users.id, userId));
        await db.delete(schema.departments).where(eq(schema.departments.id, departmentId));
      }
    }, 15000);

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

    it('does not refresh a session removed between verification and extension', async () => {
      const token = await generateTestToken(testUser.id);
      const extend = vi.spyOn(SessionRepository.prototype, 'extendByJti').mockResolvedValue(null);
      try {
        const response = await server.inject({
          method: 'GET', url: '/api/v1/auth/me',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
        expect(response.headers['x-access-token']).toBeUndefined();
        expect(extend).toHaveBeenCalledTimes(1);
      } finally {
        extend.mockRestore();
      }
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
      const clearingCookies = logoutResponse.headers['set-cookie'];
      const cookieHeader = Array.isArray(clearingCookies) ? clearingCookies.join('\n') : String(clearingCookies);
      expect(cookieHeader).toContain('access_token=; Max-Age=0');
      expect(cookieHeader).toContain('csrf_token=; Max-Age=0');
      expect(logoutResponse.headers['x-access-token']).toBeUndefined();

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
