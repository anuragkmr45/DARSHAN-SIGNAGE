import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/db';
import * as tables from '@/db/schema';
import { config } from '@/config';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { AppError, formatErrorResponse } from '@/utils/app-error';
import { toAppError } from '@/utils/errors';
import { liveSessionRoutes } from './live-sessions';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined,
  tokens: new Map<string, { sub: string; jti: string; role_id: string; role: string; department_id: string | null }>() }));
vi.mock('@/db', async () => ({
  schema: await vi.importActual('@/db/schema'),
  getDatabase: () => fixture.db,
}));
// Only token decoding is replaced. Public route decisions, current role graph,
// users, session revocation, membership, locking and every write use PostgreSQL.
vi.mock('@/auth/jwt', () => ({
  extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => {
    const payload = fixture.tokens.get(token);
    if (!payload) throw AppError.unauthorized();
    return payload;
  },
}));

describe('live-session routes on an isolated PostgreSQL schema', () => {
  const namespace = `live_sessions_test_${randomUUID().replace(/-/g, '')}`;
  let adminPool: Pool, pool: Pool, server: FastifyInstance;
  let admin: User, owner: User, peer: User, other: User, presenter: User, conditional: User;
  const deptA = randomUUID(), deptB = randomUUID();
  const legacyItemId = randomUUID(), legacyPresentationId = randomUUID();
  type User = { id: string; token: string; role_id: string; department_id: string | null };
  const route = '/api/v1/live-sessions';
  const invoke = (user: User | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path = route, payload?: unknown) =>
    server.inject({ method, url: path, ...(user ? { headers: { authorization: `Bearer ${user.token}` } } : {}), payload });

  async function makeUser(role: string, grants: unknown[], department: string | null): Promise<User> {
    const roleId = randomUUID(), id = randomUUID(), token = randomUUID();
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [roleId, role, JSON.stringify({ grants })]);
    await pool.query('INSERT INTO users(id,email,password_hash,role_id,department_id) VALUES($1,$2,$3,$4,$5)',
      [id, `${id}@example.test`, 'synthetic-unused-password-hash', roleId, department]);
    await pool.query('INSERT INTO sessions(user_id,access_jti,expires_at) VALUES($1,$2,now()+interval \'1 hour\')', [id, token]);
    fixture.tokens.set(token, { sub: id, jti: token, role_id: roleId, role, department_id: department });
    return { id, token, role_id: roleId, department_id: department };
  }
  async function create(user = owner, overrides: Record<string, unknown> = {}) {
    const response = await invoke(user, 'POST', route, { name: `Synthetic Live ${randomUUID()}`, presenter_user_id: presenter.id, ...overrides });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }
  const rowFor = async (id: string) => (await pool.query('SELECT * FROM live_sessions WHERE id=$1', [id])).rows[0];
  async function waitForBlockedMutation() {
    const deadline = Date.now() + 2000;
    do {
      const result = await pool.query(`SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE application_name=$1 AND wait_event_type='Lock'`, [namespace]);
      if (result.rows[0].count > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Expected the real concurrent mutation to wait on the held row lock');
  }
  async function addReference(id: string, ended = false, historicalPublish = false) {
    const scheduleId = randomUUID(), itemId = randomUUID();
    const from = new Date(Date.now() + (ended ? -120_000 : 120_000));
    const to = new Date(from.getTime() + 60_000);
    await pool.query('INSERT INTO schedules(id,name,start_at,end_at,created_by) VALUES($1,$2,$3,$4,$5)', [scheduleId, 'Synthetic reference', from.toISOString(), to.toISOString(), owner.id]);
    await pool.query(`INSERT INTO schedule_items(id,schedule_id,presentation_id,start_at,end_at,source_kind,live_session_id)
      VALUES($1,$2,$3,$4,$5,'LIVE',$6)`, [itemId, scheduleId, randomUUID(), from.toISOString(), to.toISOString(), id]);
    if (historicalPublish) await pool.query(`INSERT INTO publishes(id,schedule_id,snapshot_id,published_by,status)
      VALUES($1,$2,$3,$4,'TAKEN_DOWN')`, [randomUUID(), scheduleId, randomUUID(), owner.id]);
    return { scheduleId, itemId };
  }

  beforeAll(async () => {
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Live session schema tests');
    const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.port).toBe('55455');
    adminPool = new Pool({ connectionString: config.DATABASE_URL, max: 1 });
    await adminPool.query(`CREATE SCHEMA "${namespace}"`);
    pool = new Pool({ connectionString: config.DATABASE_URL, max: 8, application_name: namespace,
      // No public fallback: an accidentally missing test table fails instead of
      // writing unrelated existing feature data. pg_catalog remains implicit.
      options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=5000 -c lock_timeout=4000` });
    expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    for (const table of ['roles', 'departments', 'users', 'sessions', 'user_additional_departments',
      'schedules', 'schedule_items', 'schedule_snapshots', 'publishes', 'audit_logs']) {
      await pool.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    await pool.query(`INSERT INTO schedule_items(id,schedule_id,presentation_id,start_at,end_at)
      VALUES($1,$2,$3,now(),now()+interval '1 hour')`, [legacyItemId, randomUUID(), legacyPresentationId]);
    const migration = await readFile(new URL('../../drizzle/migrations/0057_live_broadcast_sessions.sql', import.meta.url), 'utf8');
    await pool.query(migration);
    fixture.db = drizzle(pool, { schema: tables });
    await pool.query('INSERT INTO departments(id,name) VALUES($1,$2),($3,$4)', [deptA, 'Synthetic A', deptB, 'Synthetic B']);
    admin = await makeUser('ADMIN', [{ action: 'manage', subject: 'LiveBroadcast' }], null);
    const grants = ['create', 'read', 'update', 'delete'].map(action => ({ action, subject: 'LiveBroadcast' }));
    owner = await makeUser('LIVE_AUTHOR', grants, deptA);
    peer = await makeUser('LIVE_PEER', grants, deptA);
    other = await makeUser('LIVE_OTHER', grants, deptB);
    presenter = await makeUser('PRESENTER_NO_LIBRARY', [], deptA);
    conditional = await makeUser('LIVE_CONDITIONAL_MANAGER', [{ action: 'manage', subject: 'LiveBroadcast', conditions: { created_by: '$user.id' } }], deptA);
    server = Fastify({ logger: false });
    server.setErrorHandler((error, _request, reply) => {
      const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe));
    });
    await server.register(liveSessionRoutes);
    await server.ready();
  });
  afterAll(async () => {
    await server?.close();
    await pool?.end();
    // This schema was created by this test and contains no copied rows. Exact
    // ownership is the random name above; never reset or drop public tables.
    if (adminPool) { await adminPool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await adminPool.end(); }
  });

  it('creates stable department ownership and no admission credentials', async () => {
    const row = await create();
    expect(row).toMatchObject({ revision: 1, policy_revision: 1, microphone: false, screen_share_audio: false,
      owner_scope: 'DEPARTMENT', owner_department_id: deptA, presenter_user_id: presenter.id });
    expect(Object.keys(row).some(key => /ticket|token|secret|room/.test(key))).toBe(false);
    expect((await invoke(presenter, 'GET', `${route}/${row.id}`)).statusCode).toBe(403);
    expect((await invoke(peer, 'GET', `${route}/${row.id}`)).statusCode).toBe(200);
    expect((await invoke(other, 'GET', `${route}/${row.id}`)).statusCode).toBe(403);
    const denied = await invoke(peer, 'PATCH', `${route}/${row.id}`, { expected_revision: 1, name: 'Hijacked' });
    expect(denied.statusCode).toBe(403); expect((await rowFor(row.id)).name).toBe(row.name);
  });

  it('binds conditional manage to actual records and never promotes it to global ownership', async () => {
    const own = await create(conditional), foreign = await create(owner);
    expect(own.owner_scope).toBe('DEPARTMENT');
    expect((await invoke(conditional, 'GET', `${route}/${foreign.id}`)).statusCode).toBe(403);
    expect((await invoke(conditional, 'PATCH', `${route}/${foreign.id}`, { expected_revision: 1, name: 'Hijacked' })).statusCode).toBe(403);
    const listed = await invoke(conditional, 'GET');
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((row: { id: string }) => row.id)).toEqual([own.id]);
    expect(listed.json().pagination.total).toBe(1);
    const scopedOut = await makeUser('NO_DEPARTMENT_CONDITION', [{ action: 'manage', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }], null);
    const beforeMissingDepartment = await rowFor(foreign.id);
    const countBeforeMissingDepartment = (await pool.query('SELECT count(*) FROM live_sessions')).rows[0].count;
    expect((await invoke(scopedOut, 'GET', `${route}/${foreign.id}`)).statusCode).toBe(403);
    expect((await invoke(scopedOut, 'POST', route, { name: 'No scope', presenter_user_id: presenter.id })).statusCode).toBe(403);
    expect((await invoke(scopedOut, 'PATCH', `${route}/${foreign.id}`, { expected_revision: 1, microphone: true })).statusCode).toBe(403);
    expect(await rowFor(foreign.id)).toEqual(beforeMissingDepartment);
    expect((await pool.query('SELECT count(*) FROM live_sessions')).rows[0].count).toBe(countBeforeMissingDepartment);
    const selfOnly = await makeUser('SELF_PRESENTING_MANAGER', [{ action: 'manage', subject: 'LiveBroadcast', conditions: { presenter_user_id: '$user.id' } }], deptA);
    const selfSession = await create(selfOnly, { presenter_user_id: selfOnly.id });
    expect((await invoke(selfOnly, 'PATCH', `${route}/${selfSession.id}`, { expected_revision: 1, presenter_user_id: presenter.id })).statusCode).toBe(403);
    expect((await rowFor(selfSession.id)).presenter_user_id).toBe(selfOnly.id);
  });

  it('keeps metadata and policy revisions separate and rejects stale/forged writes unchanged', async () => {
    const row = await create();
    const metadata = await invoke(owner, 'PATCH', `${route}/${row.id}`, { expected_revision: 1, name: 'Renamed' });
    expect(metadata.statusCode).toBe(200); expect(metadata.json()).toMatchObject({ revision: 2, policy_revision: 1 });
    const stale = await invoke(owner, 'PATCH', `${route}/${row.id}`, { expected_revision: 1, microphone: true });
    expect(stale.statusCode).toBe(409); expect(stale.json().error.code).toBe('LIVE_SESSION_REVISION_CONFLICT');
    const forged = await invoke(owner, 'PATCH', `${route}/${row.id}`, { expected_revision: 2, owner_scope: 'ORGANIZATION' });
    expect(forged.statusCode).toBe(422);
    expect((await invoke(owner, 'DELETE', `${route}/${row.id}`, { expected_revision: 1 })).statusCode).toBe(409);
    expect(await rowFor(row.id)).toMatchObject({ name: 'Renamed', revision: 2, policy_revision: 1, microphone: false, owner_scope: 'DEPARTMENT' });
  });

  it('allows a source-policy change with draft references, preserving frozen published policy', async () => {
    const row = await create(); const reference = await addReference(row.id);
    const snapshotId = randomUUID(); const frozen = { schedule: { items: [{ source_kind: 'LIVE', live_session_id: row.id,
      end_at: new Date(Date.now() + 300_000).toISOString(), live_policy: { presenter_user_id: presenter.id, microphone: false, policy_revision: 1 } }] } };
    await pool.query('INSERT INTO schedule_snapshots(id,schedule_id,payload) VALUES($1,$2,$3)', [snapshotId, reference.scheduleId, frozen]);
    const changed = await invoke(owner, 'PATCH', `${route}/${row.id}`, { expected_revision: 1, microphone: true, is_active: false });
    expect(changed.statusCode).toBe(200); expect(changed.json()).toMatchObject({ revision: 2, policy_revision: 2, microphone: true, is_active: false });
    expect((await pool.query('SELECT payload FROM schedule_snapshots WHERE id=$1', [snapshotId])).rows[0].payload).toEqual(frozen);
    // Existing draft reference remains, but new source selection is refused.
    await expect(addReference(row.id)).rejects.toMatchObject({ code: '23514' });
  });

  it('blocks referenced deletion without touching source, item, snapshot or audit rows', async () => {
    const row = await create(); const reference = await addReference(row.id);
    const before = await rowFor(row.id);
    const audits = (await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count;
    const denied = await invoke(owner, 'DELETE', `${route}/${row.id}`, { expected_revision: 1 });
    expect(denied.statusCode).toBe(409); expect(denied.json().error).toMatchObject({ code: 'LIVE_SESSION_IN_USE', details: { blockers: { schedule_items: 1 } } });
    expect(await rowFor(row.id)).toEqual(before);
    expect((await pool.query('SELECT id FROM schedule_items WHERE id=$1', [reference.itemId])).rowCount).toBe(1);
    expect((await pool.query('SELECT count(*) FROM audit_logs')).rows[0].count).toBe(audits);
  });

  it('blocks an immutable active snapshot even after mutable items were removed', async () => {
    const row = await create(); const scheduleId = randomUUID(), snapshotId = randomUUID();
    await pool.query('INSERT INTO schedule_snapshots(id,schedule_id,payload) VALUES($1,$2,$3)', [snapshotId, scheduleId,
      { schedule: { items: [{ source_kind: 'LIVE', live_session_id: row.id, end_at: new Date(Date.now() + 300_000).toISOString() }] } }]);
    await pool.query('INSERT INTO publishes(id,schedule_id,snapshot_id,published_by) VALUES($1,$2,$3,$4)', [randomUUID(), scheduleId, snapshotId, owner.id]);
    const denied = await invoke(owner, 'DELETE', `${route}/${row.id}`, { expected_revision: 1 });
    expect(denied.statusCode).toBe(409); expect(denied.json().error.details.blockers.active_publishes).toBe(1);
    expect((await rowFor(row.id)).deleted_at).toBeNull();
  });

  it('permits historical-only deletion as a tombstone and rejects re-reference', async () => {
    const row = await create(); const reference = await addReference(row.id, true, true);
    const result = await invoke(owner, 'DELETE', `${route}/${row.id}`, { expected_revision: 1 });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ id: row.id, revision: 2, deleted: true });
    expect(await rowFor(row.id)).toMatchObject({ is_active: false, revision: 2, deleted_by: owner.id, presenter_user_id: presenter.id });
    expect((await rowFor(row.id)).deleted_at).not.toBeNull();
    expect((await pool.query('SELECT id FROM schedule_items WHERE id=$1', [reference.itemId])).rowCount).toBe(1);
    expect((await invoke(owner, 'GET', `${route}/${row.id}`)).statusCode).toBe(404);
    await expect(addReference(row.id)).rejects.toMatchObject({ code: '23514' });
  });

  it('uses current account/session/department/permissions rather than stale claims', async () => {
    const row = await create();
    await pool.query('UPDATE users SET department_id=$1 WHERE id=$2', [deptB, owner.id]);
    expect((await invoke(owner, 'PATCH', `${route}/${row.id}`, { expected_revision: 1, name: 'Moved owner' })).statusCode).toBe(403);
    expect((await rowFor(row.id)).owner_department_id).toBe(deptA);
    await pool.query('UPDATE users SET department_id=$1 WHERE id=$2', [deptA, owner.id]);
    const temporary = await makeUser('TEMPORARY_LIVE_USER', [{ action: 'manage', subject: 'LiveBroadcast' }], deptA);
    const own = await create(temporary);
    await pool.query('UPDATE roles SET permissions=$1 WHERE id=$2', [JSON.stringify({ grants: [] }), temporary.role_id]);
    expect((await invoke(temporary, 'PATCH', `${route}/${own.id}`, { expected_revision: 1, name: 'Revoked grant' })).statusCode).toBe(403);
    await pool.query('DELETE FROM sessions WHERE access_jti=$1', [temporary.token]);
    expect((await invoke(temporary, 'PATCH', `${route}/${own.id}`, { expected_revision: 1, name: 'Revoked session' })).statusCode).toBe(401);
    expect((await rowFor(own.id)).revision).toBe(1);
  });

  it('rejects inactive/deleted or wrong-department presenters without inserting a source', async () => {
    const unavailable = await makeUser('UNAVAILABLE_PRESENTER', [], deptA);
    await pool.query('UPDATE users SET is_active=false WHERE id=$1', [unavailable.id]);
    const before = (await pool.query('SELECT count(*) FROM live_sessions')).rows[0].count;
    for (const id of [unavailable.id, other.id, randomUUID()]) {
      const response = await invoke(owner, 'POST', route, { name: 'Unavailable', presenter_user_id: id });
      expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('LIVE_PRESENTER_UNAVAILABLE');
    }
    await pool.query('UPDATE users SET is_active=true,deleted_at=now() WHERE id=$1', [unavailable.id]);
    expect((await invoke(owner, 'POST', route, { name: 'Deleted presenter', presenter_user_id: unavailable.id })).statusCode).toBe(422);
    await pool.query('UPDATE users SET deleted_at=NULL,role_id=$1 WHERE id=$2', [randomUUID(), unavailable.id]);
    expect((await invoke(owner, 'POST', route, { name: 'Missing-role presenter', presenter_user_id: unavailable.id })).statusCode).toBe(422);
    expect((await pool.query('SELECT count(*) FROM live_sessions')).rows[0].count).toBe(before);
  });

  it('accepts an explicitly shared presenter department without changing stable source ownership', async () => {
    await pool.query('INSERT INTO user_additional_departments(user_id,department_id,assigned_by) VALUES($1,$2,$3)', [other.id, deptA, admin.id]);
    const row = await create(owner, { presenter_user_id: other.id });
    expect(row).toMatchObject({ owner_scope: 'DEPARTMENT', owner_department_id: deptA, presenter_user_id: other.id });
    await pool.query('DELETE FROM user_additional_departments WHERE user_id=$1 AND department_id=$2', [other.id, deptA]);
    expect((await invoke(owner, 'PATCH', `${route}/${row.id}`, { expected_revision: 1, is_active: true })).statusCode).toBe(422);
    expect(await rowFor(row.id)).toMatchObject({ revision: 1, owner_department_id: deptA });
  });

  it('serializes a current presenter disable before create and supports cross-assignments without deadlock', async () => {
    const connection = await pool.connect();
    let pending;
    try {
      await connection.query('BEGIN');
      await connection.query('UPDATE users SET is_active=false WHERE id=$1', [presenter.id]);
      pending = invoke(owner, 'POST', route, { name: 'Presenter disable race', presenter_user_id: presenter.id });
      await waitForBlockedMutation();
      await connection.query('COMMIT');
    } finally { await connection.query('ROLLBACK'); connection.release(); }
    expect((await pending).statusCode).toBe(422);
    await pool.query('UPDATE users SET is_active=true WHERE id=$1', [presenter.id]);
    const left = await create(owner, { presenter_user_id: owner.id }), right = await create(peer, { presenter_user_id: peer.id });
    const results = await Promise.all([
      invoke(owner, 'PATCH', `${route}/${left.id}`, { expected_revision: 1, presenter_user_id: peer.id }),
      invoke(peer, 'PATCH', `${route}/${right.id}`, { expected_revision: 1, presenter_user_id: owner.id }),
    ]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
  });

  it('serializes a reference committing before the real API delete', async () => {
    const row = await create(); const connection = await pool.connect();
    let pending;
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT id FROM live_sessions WHERE id=$1 FOR SHARE', [row.id]);
      const scheduleId = randomUUID();
      await connection.query('INSERT INTO schedules(id,name,start_at,end_at,created_by) VALUES($1,$2,now(),now()+interval \'1 hour\',$3)', [scheduleId, 'Concurrent reference', owner.id]);
      await connection.query(`INSERT INTO schedule_items(schedule_id,presentation_id,start_at,end_at,source_kind,live_session_id)
        VALUES($1,$2,now(),now()+interval '1 hour','LIVE',$3)`, [scheduleId, randomUUID(), row.id]);
      pending = invoke(owner, 'DELETE', `${route}/${row.id}`, { expected_revision: 1 });
      await waitForBlockedMutation();
      await connection.query('COMMIT');
    } finally { await connection.query('ROLLBACK'); connection.release(); }
    expect((await pending).statusCode).toBe(409);
    expect((await rowFor(row.id)).deleted_at).toBeNull();
  });

  it('preserves old-client ordinary inserts and enforces new source/fallback constraints', async () => {
    expect((await pool.query('SELECT presentation_id,source_kind,live_session_id FROM schedule_items WHERE id=$1', [legacyItemId])).rows[0])
      .toEqual({ presentation_id: legacyPresentationId, source_kind: 'PRESENTATION', live_session_id: null });
    const source = await create(); const scheduleId = randomUUID(), presentationId = randomUUID();
    const old = await pool.query(`INSERT INTO schedule_items(schedule_id,presentation_id,start_at,end_at)
      VALUES($1,$2,now(),now()+interval '1 hour') RETURNING source_kind,live_session_id,presentation_id`, [scheduleId, presentationId]);
    expect(old.rows[0]).toEqual({ source_kind: 'PRESENTATION', live_session_id: null, presentation_id: presentationId });
    await expect(pool.query(`INSERT INTO schedule_items(schedule_id,presentation_id,start_at,end_at,source_kind,live_session_id)
      VALUES($1,$2,now(),now()+interval '1 hour','PRESENTATION',$3)`, [scheduleId, presentationId, source.id])).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`INSERT INTO schedule_items(schedule_id,start_at,end_at,source_kind,live_session_id)
      VALUES($1,now(),now()+interval '1 hour','LIVE',$2)`, [scheduleId, source.id])).rejects.toMatchObject({ code: '23502' });
    await expect(pool.query(`INSERT INTO schedule_items(schedule_id,presentation_id,start_at,end_at,source_kind)
      VALUES($1,$2,now(),now()+interval '1 hour','LIVE')`, [scheduleId, presentationId])).rejects.toMatchObject({ code: '23514' });
    expect((await invoke(null, 'GET')).statusCode).toBe(401);
    // No app-secret/transient-token columns exist to retain or leak.
    const columns = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2', [namespace, 'live_sessions']);
    expect(columns.rows.some(row => /token|ticket|secret/.test(row.column_name))).toBe(false);
    // PostgreSQL refuses blindly dropping the source table while the new item
    // foreign key exists. A downgrade requires the documented live-data review
    // and explicit dependent-column removal, never an automatic cascade.
    await expect(pool.query('DROP TABLE live_sessions')).rejects.toMatchObject({ code: '2BP01' });
  });
});
