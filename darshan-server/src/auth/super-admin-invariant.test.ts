import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { closeTestServer, createTestServer, testRoles } from '@/test/helpers';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { createUserRepository } from '@/db/repositories/user';
import { generateAccessToken } from '@/auth/jwt';
import { createSessionRepository } from '@/db/repositories/session';

describe('last active SUPER_ADMIN invariant', () => {
  let server: FastifyInstance;
  const ids = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    server = await createTestServer();
    await getDatabase().insert(schema.users).values(ids.map((id) => ({
      id,
      email: `last-sa-${id}@example.test`,
      password_hash: 'not-used',
      role_id: testRoles.SUPER_ADMIN.id,
      is_active: true,
    })));
  });

  afterAll(async () => {
    await closeTestServer(server);
  });

  it('serializes competing removals and rejects every way to remove the survivor', async () => {
    const repo = createUserRepository();
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is required for concurrent removal coverage');
    const blocker = await pool.connect();
    const observer = await pool.connect();
    let attempts: Promise<PromiseSettledResult<Awaited<ReturnType<typeof repo.update>>>[]> | undefined;
    let outcomes: PromiseSettledResult<Awaited<ReturnType<typeof repo.update>>>[];
    try {
      await blocker.query('BEGIN');
      const blockerPid = Number((await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await blocker.query('SELECT id FROM roles WHERE id = $1 FOR UPDATE', [testRoles.SUPER_ADMIN.id]);
      attempts = Promise.allSettled(ids.map((id) => repo.update(id, { is_active: false })));
      const deadline = Date.now() + 5000;
      let blockedCount = 0;
      while (Date.now() < deadline) {
        const observed = await observer.query(
          'SELECT count(*)::int AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
          [blockerPid]
        );
        blockedCount = Number(observed.rows[0].count);
        if (blockedCount >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedCount).toBeGreaterThanOrEqual(2);
      await blocker.query('COMMIT');
      outcomes = await attempts;
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      if (attempts) await attempts;
      blocker.release();
      observer.release();
    }
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected?.status).toBe('rejected');
    if (rejected?.status === 'rejected') {
      expect(rejected.reason?.code).toBe('LAST_ACTIVE_SUPER_ADMIN');
    }

    const db = getDatabase();
    const [active] = await db.select({ count: sql<number>`count(*)` }).from(schema.users).where(and(
      eq(schema.users.role_id, testRoles.SUPER_ADMIN.id),
      eq(schema.users.is_active, true),
      isNull(schema.users.deleted_at)
    ));
    expect(Number(active.count)).toBe(1);
    const [survivor] = await db.select().from(schema.users).where(and(
      eq(schema.users.role_id, testRoles.SUPER_ADMIN.id), eq(schema.users.is_active, true)
    ));
    expect(survivor).toBeTruthy();
    const access = await generateAccessToken(survivor.id, survivor.email,
      testRoles.SUPER_ADMIN.id, 'SUPER_ADMIN');
    await createSessionRepository().create({
      user_id: survivor.id, access_jti: access.jti, expires_at: access.expiresAt,
    });

    for (const [method, payload] of [
      ['PATCH', { is_active: false }],
      ['PATCH', { role_id: testRoles.ADMIN.id }],
      ['DELETE', undefined],
    ] as const) {
      const response = await server.inject({
        method,
        url: `/api/v1/users/${survivor.id}`,
        headers: { authorization: `Bearer ${access.token}` },
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error.code).toBe('LAST_ACTIVE_SUPER_ADMIN');
    }
    const [stillActive] = await db.select().from(schema.users).where(eq(schema.users.id, survivor.id));
    expect(stillActive.is_active).toBe(true);
    expect(stillActive.role_id).toBe(testRoles.SUPER_ADMIN.id);
    expect(stillActive.deleted_at).toBeNull();
  });

  it('does not count a pending invited SUPER_ADMIN as a usable survivor', async () => {
    const db = getDatabase();
    const [survivor] = await db.select().from(schema.users).where(and(
      eq(schema.users.role_id, testRoles.SUPER_ADMIN.id),
      eq(schema.users.is_active, true),
      isNull(schema.users.deleted_at)
    ));
    if (!survivor) throw new Error('Missing active SUPER_ADMIN survivor');
    const pendingId = randomUUID();
    const access = await generateAccessToken(survivor.id, survivor.email,
      testRoles.SUPER_ADMIN.id, 'SUPER_ADMIN');
    await createSessionRepository().create({
      user_id: survivor.id, access_jti: access.jti, expires_at: access.expiresAt,
    });
    try {
      await db.insert(schema.users).values({
        id: pendingId,
        email: `pending-sa-${pendingId}@example.test`,
        password_hash: 'not-used',
        role_id: testRoles.SUPER_ADMIN.id,
        is_active: true,
        ext: {
          invite_status: 'PENDING',
          invite_token: randomUUID(),
          invite_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      });
      for (const [method, payload] of [
        ['PATCH', { is_active: false }],
        ['PATCH', { role_id: testRoles.ADMIN.id }],
        ['DELETE', undefined],
      ] as const) {
        const response = await server.inject({
          method,
          url: `/api/v1/users/${survivor.id}`,
          headers: { authorization: `Bearer ${access.token}` },
          ...(payload ? { payload } : {}),
        });
        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body).error.code).toBe('LAST_ACTIVE_SUPER_ADMIN');
      }
      const [unchanged] = await db.select().from(schema.users).where(eq(schema.users.id, survivor.id));
      expect(unchanged.is_active).toBe(true);
      expect(unchanged.role_id).toBe(testRoles.SUPER_ADMIN.id);
      expect(unchanged.deleted_at).toBeNull();
    } finally {
      await db.delete(schema.users).where(eq(schema.users.id, pendingId));
      await db.delete(schema.sessions).where(eq(schema.sessions.access_jti, access.jti));
    }
  });

  it('does not apply built-in protection to a SUPER_ADMIN name after its system identity is lost', async () => {
    const db = getDatabase();
    const [candidate] = await db.select().from(schema.users).where(and(
      eq(schema.users.role_id, testRoles.SUPER_ADMIN.id),
      eq(schema.users.is_active, true),
      isNull(schema.users.deleted_at)
    ));
    if (!candidate) throw new Error('Missing SUPER_ADMIN collision candidate');
    try {
      await db.update(schema.roles).set({ is_system: false }).where(eq(schema.roles.id, testRoles.SUPER_ADMIN.id));
      await expect(createUserRepository().update(candidate.id, { is_active: false }))
        .resolves.toMatchObject({ id: candidate.id, is_active: false });
    } finally {
      await db.update(schema.roles).set({ is_system: true }).where(eq(schema.roles.id, testRoles.SUPER_ADMIN.id));
      await db.update(schema.users).set({ is_active: true }).where(eq(schema.users.id, candidate.id));
    }
  });
});
