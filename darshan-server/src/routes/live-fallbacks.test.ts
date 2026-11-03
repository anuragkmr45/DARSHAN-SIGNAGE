import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '@/config';
import type { Database } from '@/db';
import * as tables from '@/db/schema';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { AppError, formatErrorResponse } from '@/utils/app-error';
import { toAppError } from '@/utils/errors';
import { liveFallbackRoutes } from './live-fallbacks';

type Token = { sub: string; jti: string; role_id: string; role: string; department_id: string | null; department_ids: string[] };
const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, queue: vi.fn(), tokens: new Map<string, Token>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/jobs', () => ({ queueLiveFallbackPreparation: fixture.queue }));
// Only JWT decoding and queue dispatch are substituted. Authorization, graph
// collection, row locks, transactions and every persisted state use PostgreSQL.
vi.mock('@/auth/jwt', () => ({ extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => { const payload = fixture.tokens.get(token); if (!payload) throw AppError.unauthorized(); return payload; } }));

describe('durable live fallback preparation API on an owned PostgreSQL database', () => {
  const suffix = randomUUID().replace(/-/g, ''), name = `darshan_live_fallback_${suffix}_test`, namespace = `live_fallback_${suffix}_test`;
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  type User = { id: string; token: string; roleId: string; role: string; department: string | null };
  let admin: User, author: User, secondary: User, conditional: User, forbidden: User;
  const departmentA = randomUUID(), departmentB = randomUUID(), route = '/api/v1/live-fallback-preparations';
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const localize = (value: string) => value.replace(/\bpublic\./g, '');
  const invoke = (user: User, method: 'GET' | 'POST', path = route, payload?: unknown) => server.inject({ method, url: path,
    headers: { authorization: `Bearer ${user.token}` }, payload });
  const row = async (id: string) => (await pool.query('SELECT * FROM live_fallback_preparations WHERE id=$1', [id])).rows[0];
  const count = async () => (await pool.query('SELECT count(*)::int n FROM live_fallback_preparations')).rows[0].n;

  async function sessionFor(user: User): Promise<User> {
    const token = randomUUID();
    await pool.query(`INSERT INTO sessions(user_id,access_jti,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [user.id, token]);
    fixture.tokens.set(token, { sub: user.id, jti: token, role_id: user.roleId, role: user.role, department_id: user.department,
      department_ids: user.department ? [user.department] : [] });
    return { ...user, token };
  }
  async function makeUser(role: string, grants: unknown[], department: string | null): Promise<User> {
    const id = randomUUID(), roleId = randomUUID();
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [roleId, role, { grants }]);
    await pool.query('INSERT INTO users(id,email,password_hash,role_id,department_id) VALUES($1,$2,$3,$4,$5)',
      [id, `${id}@example.test`, 'synthetic-unused-password-hash', roleId, department]);
    return sessionFor({ id, roleId, role, department, token: '' });
  }
  async function graph(owner = admin.id) {
    const presentation = randomUUID(), media = randomUUID(), object = randomUUID(), entry = randomUUID();
    await pool.query('INSERT INTO storage_objects(id,bucket,object_key,content_type,size,sha256) VALUES($1,$2,$3,$4,64,$5)',
      [object, 'synthetic-live-fallback-source', `${object}.png`, 'image/png', 'd'.repeat(64)]);
    await pool.query(`INSERT INTO media(id,name,type,status,created_by,owner_scope,owner_department_id,source_object_id,ready_object_id)
      VALUES($1,$2,'IMAGE','READY',$3,'DEPARTMENT',$4,$5,$5)`, [media, 'Synthetic verified image descriptor', owner, departmentA, object]);
    await pool.query(`INSERT INTO presentations(id,name,created_by,owner_scope,owner_department_id) VALUES($1,$2,$3,'DEPARTMENT',$4)`,
      [presentation, 'Synthetic fallback presentation', owner, departmentA]);
    await pool.query('INSERT INTO presentation_items(id,presentation_id,media_id,"order",duration_seconds) VALUES($1,$2,$3,0,15)', [entry, presentation, media]);
    return { presentation, media, object, entry };
  }

  beforeAll(async () => {
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only fallback API fixture source');
    const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname); expect(url.port).toBe('55455');
    source = new Pool({ connectionString: config.DATABASE_URL, max: 1,
      options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000' });
    url.pathname = '/postgres'; adminPool = new Pool({ connectionString: url.toString(), max: 1 });
    url.pathname = `/${name}`; assertDedicatedTestDatabase(url.toString());
    await adminPool.query(`CREATE DATABASE ${quote(name)}`); created = true;
    pool = new Pool({ connectionString: url.toString(), max: 8, application_name: namespace,
      options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=5000 -c lock_timeout=4000` });
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`);
    expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    const enums = await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t
      JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const enumRow of enums.rows) await pool.query(`CREATE TYPE ${quote(enumRow.typname)} AS ENUM (${enumRow.labels.map((value: string) => `'${value.replace(/'/g, "''")}'`).join(',')})`);
    for (const table of ['roles', 'departments', 'users', 'sessions', 'user_additional_departments', 'storage_objects', 'media', 'presentations',
      'presentation_items', 'presentation_slot_items', 'layouts', 'schedules', 'schedule_items', 'schedule_reservations']) {
      const columns = await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
      expect(columns.rows.length).toBeGreaterThan(0);
      const excluded = table === 'schedule_items' ? new Set(['source_kind', 'live_session_id']) : new Set<string>();
      const definitions = columns.rows.filter(column => !excluded.has(column.attname)).map(column => {
        if (column.default_sql && /\bnextval\s*\(/i.test(column.default_sql)) throw new Error('Fixture refuses source sequence defaults');
        return `${quote(column.attname)} ${localize(column.type)}${column.attnotnull ? ' NOT NULL' : ''}${column.default_sql ? ` DEFAULT ${localize(column.default_sql)}` : ''}`;
      });
      const checks = await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [table]);
      for (const check of checks.rows) if (![...excluded].some(column => new RegExp(`\\b${column}\\b`).test(check.definition))) {
        definitions.push(`CONSTRAINT ${quote(check.conname)} ${localize(check.definition)}`);
      }
      await pool.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')})`);
    }
    await pool.query(`CREATE EXTENSION btree_gist WITH SCHEMA ${quote(namespace)}`);
    for (const migration of ['0057_live_broadcast_sessions.sql', '0058_live_scheduling.sql']) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query(await readFile(new URL(`../../drizzle/migrations/${migration}`, import.meta.url), 'utf8')); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    fixture.db = drizzle(pool, { schema: tables });
    await pool.query('INSERT INTO departments(id,name) VALUES($1,$2),($3,$4)', [departmentA, 'Synthetic A', departmentB, 'Synthetic B']);
    admin = await makeUser('SUPER_ADMIN', [], null);
    const reads = ['Presentation', 'Media', 'Layout'].map(subject => ({ action: 'read', subject }));
    const grants = [{ action: 'create', subject: 'ScheduleItem' }, ...reads];
    author = await makeUser('SYNTHETIC_FALLBACK_AUTHOR', grants, departmentA);
    secondary = await makeUser('SYNTHETIC_SECONDARY_AUTHOR', grants, departmentB);
    conditional = await makeUser('SYNTHETIC_CONDITIONAL_AUTHOR', [{ action: 'create', subject: 'LiveBroadcast' },
      { action: 'read', subject: 'Presentation', conditions: { created_by: '$user.id' } },
      ...reads.filter(grant => grant.subject !== 'Presentation')], departmentA);
    forbidden = await makeUser('SYNTHETIC_READ_ONLY', reads, departmentA);
    server = Fastify({ logger: false });
    server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(liveFallbackRoutes); await server.ready();
  }, 30_000);

  afterAll(async () => {
    await server?.close(); await pool?.end(); await source?.end();
    if (adminPool) { if (created) await adminPool.query(`DROP DATABASE ${quote(name)}`); await adminPool.end(); }
  }, 15_000);

  it('commits durable PENDING work before queue dispatch and exposes no claim credentials', async () => {
    const data = await graph(), observed: string[] = [];
    fixture.queue.mockReset(); fixture.queue.mockImplementation(async ({ preparationId }: { preparationId: string }) => { observed.push((await row(preparationId)).state); });
    const response = await invoke(author, 'POST', route, { presentation_id: data.presentation });
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({ state: 'PENDING', dispatch_pending: false, manifest: null });
    expect(observed).toEqual(['PENDING']);
    expect((await row(response.json().id)).source_graph.assets[0].object).toMatchObject({ storage_object_id: data.object, sha256: 'd'.repeat(64), size: 64 });
    expect(Object.keys(response.json()).some(key => /claim|lease|token|secret|cookie/i.test(key))).toBe(false);
  });

  it('coalesces concurrent clicks from two current sessions without sharing another creator work', async () => {
    const data = await graph(), secondSession = await sessionFor(author), before = await count();
    fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    const results = await Promise.all([author, secondSession].map(user => invoke(user, 'POST', route, { presentation_id: data.presentation })));
    expect(results.map(result => result.statusCode)).toEqual([202, 202]);
    expect(results[0].json().id).toBe(results[1].json().id); expect(await count()).toBe(before + 1);
    const other = await invoke(admin, 'POST', route, { presentation_id: data.presentation });
    expect(other.statusCode, other.body).toBe(202); expect(other.json().id).not.toBe(results[0].json().id); expect(await count()).toBe(before + 2);
  });

  it('returns202 dispatch_pending during queue failure while retaining accepted PENDING work', async () => {
    const data = await graph(); fixture.queue.mockReset(); fixture.queue.mockRejectedValue(new Error('Synthetic queue outage'));
    const response = await invoke(author, 'POST', route, { presentation_id: data.presentation });
    expect(response.statusCode, response.body).toBe(202); expect(response.json()).toMatchObject({ state: 'PENDING', dispatch_pending: true });
    expect(await row(response.json().id)).toMatchObject({ state: 'PENDING', failure_code: null, created_by: author.id, presentation_id: data.presentation });
  });

  it('retries FAILED work only explicitly and persists retry intent even if redispatch fails', async () => {
    const data = await graph(); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    const initial = await invoke(author, 'POST', route, { presentation_id: data.presentation }), id = initial.json().id;
    await pool.query(`UPDATE live_fallback_preparations SET state='FAILED',failure_code='SYNTHETIC_FAILURE' WHERE id=$1`, [id]);
    fixture.queue.mockReset(); fixture.queue.mockRejectedValue(new Error('Synthetic retry dispatch outage'));
    const noRetry = await invoke(author, 'POST', route, { presentation_id: data.presentation });
    expect(noRetry.statusCode, noRetry.body).toBe(200); expect(noRetry.json()).toMatchObject({ id, state: 'FAILED', dispatch_pending: false }); expect(fixture.queue).not.toHaveBeenCalled();
    const retried = await invoke(author, 'POST', route, { presentation_id: data.presentation, retry_failed: true });
    expect(retried.statusCode, retried.body).toBe(202); expect(retried.json()).toMatchObject({ id, state: 'PENDING', failure_code: null, dispatch_pending: true });
    expect(await row(id)).toMatchObject({ state: 'PENDING', claim_token: null, lease_expires_at: null, failure_code: null });
  });

  it('returns409 for stale graph reads and prepares the new revision without rewriting old work', async () => {
    const data = await graph(); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    const first = await invoke(author, 'POST', route, { presentation_id: data.presentation }), before = await row(first.json().id);
    expect((await invoke(author, 'GET', `${route}/${before.id}`)).statusCode).toBe(200);
    await pool.query('UPDATE presentation_items SET duration_seconds=16 WHERE id=$1', [data.entry]);
    const stale = await invoke(author, 'GET', `${route}/${before.id}`);
    expect(stale.statusCode, stale.body).toBe(409); expect(stale.json().error.code).toBe('LIVE_APPROVAL_STALE');
    const next = await invoke(author, 'POST', route, { presentation_id: data.presentation });
    expect(next.statusCode, next.body).toBe(202); expect(next.json().id).not.toBe(before.id); expect(await row(before.id)).toEqual(before);
  });

  it('uses current secondary department membership for both preparation and subsequent GET', async () => {
    const data = await graph(); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    await pool.query('INSERT INTO user_additional_departments(user_id,department_id,assigned_by) VALUES($1,$2,$3)', [secondary.id, departmentA, admin.id]);
    const response = await invoke(secondary, 'POST', route, { presentation_id: data.presentation });
    expect(response.statusCode, response.body).toBe(202); expect((await invoke(secondary, 'GET', `${route}/${response.json().id}`)).statusCode).toBe(200);
    await pool.query('DELETE FROM user_additional_departments WHERE user_id=$1 AND department_id=$2', [secondary.id, departmentA]);
    fixture.queue.mockClear();
    expect((await invoke(secondary, 'GET', `${route}/${response.json().id}`)).statusCode).toBe(403);
    expect((await invoke(secondary, 'POST', route, { presentation_id: data.presentation })).statusCode).toBe(403); expect(fixture.queue).not.toHaveBeenCalled();
    expect((await row(response.json().id)).state).toBe('PENDING');
  });

  it('binds conditional grants to the source record and denies read-only users before durable/queue work', async () => {
    const foreign = await graph(), own = await graph(conditional.id), before = await count();
    fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    expect((await invoke(conditional, 'POST', route, { presentation_id: foreign.presentation })).statusCode).toBe(403);
    expect((await invoke(forbidden, 'POST', route, { presentation_id: foreign.presentation })).statusCode).toBe(403);
    expect(await count()).toBe(before); expect(fixture.queue).not.toHaveBeenCalled();
    const accepted = await invoke(conditional, 'POST', route, { presentation_id: own.presentation });
    expect(accepted.statusCode, accepted.body).toBe(202); expect((await invoke(conditional, 'GET', `${route}/${accepted.json().id}`)).statusCode).toBe(200);
  });

  it('rejects forged workflow fields and unverified image descriptors before enqueueing work', async () => {
    const data = await graph(), before = await count(); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    const forged = await invoke(author, 'POST', route, { presentation_id: data.presentation, state: 'READY', manifest: { assets: [] } });
    expect(forged.statusCode, forged.body).toBe(422);
    await pool.query('UPDATE storage_objects SET sha256=NULL WHERE id=$1', [data.object]);
    const unverified = await invoke(author, 'POST', route, { presentation_id: data.presentation });
    expect(unverified.statusCode, unverified.body).toBe(422); expect(unverified.json().error.code).toBe('LIVE_FALLBACK_UNVERIFIED');
    expect(await count()).toBe(before); expect(fixture.queue).not.toHaveBeenCalled();
  });
});
