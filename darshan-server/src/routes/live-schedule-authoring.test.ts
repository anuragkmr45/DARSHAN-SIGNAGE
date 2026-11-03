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
import { scheduleRoutes } from './schedules';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined,
  tokens: new Map<string, { sub: string; jti: string; role_id: string; role: string; department_id: string | null; department_ids: string[] }>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
// JWT decoding alone is replaced; current account/session, role graph, CASL,
// ownership, transactions, source triggers and HTTP handlers remain real.
vi.mock('@/auth/jwt', () => ({
  extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => {
    const payload = fixture.tokens.get(token); if (!payload) throw AppError.unauthorized(); return payload;
  },
}));

describe('LIVE schedule authoring against an independently owned PostgreSQL database', () => {
  const suffix = randomUUID().replace(/-/g, '');
  const database = `darshan_live_authoring_${suffix}_test`, namespace = `live_authoring_${suffix}_test`;
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  type User = { id: string; token: string; roleId: string; department: string | null };
  let admin: User, author: User, conditional: User;
  const departmentA = randomUUID(), departmentB = randomUUID();
  const start = '2045-01-01T10:00:00.000Z', end = '2045-01-01T11:00:00.000Z';
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const localize = (value: string) => value.replace(/\bpublic\./g, '');
  const invoke = (user: User, method: 'GET' | 'POST', path: string, payload?: unknown) => server.inject({
    method, url: path, headers: { authorization: `Bearer ${user.token}` }, payload,
  });
  const itemPath = (scheduleId: string) => `/api/v1/schedules/${scheduleId}/items`;

  async function makeUser(name: string, grants: unknown[], department: string | null): Promise<User> {
    const id = randomUUID(), roleId = randomUUID(), token = randomUUID();
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [roleId, name, { grants }]);
    await pool.query('INSERT INTO users(id,email,password_hash,role_id,department_id) VALUES($1,$2,$3,$4,$5)',
      [id, `${id}@example.test`, 'synthetic-unused-password-hash', roleId, department]);
    await pool.query(`INSERT INTO sessions(user_id,access_jti,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [id, token]);
    fixture.tokens.set(token, { sub: id, jti: token, role_id: roleId, role: name, department_id: department, department_ids: department ? [department] : [] });
    return { id, roleId, token, department };
  }

  async function seed(scope = 'DEPARTMENT', department: string | null = departmentA, owner = admin.id) {
    const scheduleId = randomUUID(), presentationId = randomUUID(), mediaId = randomUUID(), liveId = randomUUID(), screenId = randomUUID();
    await pool.query('INSERT INTO schedules(id,name,start_at,end_at,created_by,owner_scope,owner_department_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [scheduleId, 'Synthetic live authoring', start, end, author.id, scope, scope === 'DEPARTMENT' ? department : null]);
    await pool.query('INSERT INTO presentations(id,name,created_by,owner_scope,owner_department_id) VALUES($1,$2,$3,$4,$5)',
      [presentationId, 'Required synthetic fallback', owner, scope, scope === 'DEPARTMENT' ? department : null]);
    await pool.query(`INSERT INTO media(id,name,type,status,created_by,owner_scope,owner_department_id) VALUES($1,$2,'IMAGE','READY',$3,$4,$5)`,
      [mediaId, 'Synthetic fallback image', owner, scope, scope === 'DEPARTMENT' ? department : null]);
    await pool.query('INSERT INTO presentation_items(presentation_id,media_id,"order",duration_seconds) VALUES($1,$2,0,15)', [presentationId, mediaId]);
    await pool.query('INSERT INTO live_sessions(id,name,presenter_user_id,created_by,owner_scope,owner_department_id) VALUES($1,$2,$3,$4,$5,$6)',
      [liveId, 'Synthetic source', admin.id, owner, scope, scope === 'DEPARTMENT' ? department : null]);
    await pool.query('INSERT INTO screens(id,name) VALUES($1,$2)', [screenId, 'Synthetic screen']);
    return { scheduleId, presentationId, mediaId, liveId, screenId };
  }
  const bodyFor = (data: Awaited<ReturnType<typeof seed>>, extra: Record<string, unknown> = {}) => ({
    presentation_id: data.presentationId, start_at: start, end_at: end, screen_ids: [data.screenId], ...extra,
  });
  const unchanged = async (id: string) => {
    expect((await pool.query('SELECT revision FROM schedules WHERE id=$1', [id])).rows[0].revision).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM schedule_items WHERE schedule_id=$1', [id])).rows[0].n).toBe(0);
  };

  beforeAll(async () => {
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only authoring fixture source');
    const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname); expect(url.port).toBe('55455');
    source = new Pool({ connectionString: config.DATABASE_URL, max: 1,
      options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000' });
    url.pathname = '/postgres'; adminPool = new Pool({ connectionString: url.toString(), max: 1 });
    url.pathname = `/${database}`; assertDedicatedTestDatabase(url.toString());
    await adminPool.query(`CREATE DATABASE ${quote(database)}`); created = true;
    pool = new Pool({ connectionString: url.toString(), max: 8, application_name: namespace,
      options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=5000 -c lock_timeout=4000` });
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`);
    expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    const enums = await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t
      JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const row of enums.rows) await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map((value: string) => `'${value.replace(/'/g, "''")}'`).join(',')})`);
    for (const table of ['roles', 'departments', 'users', 'sessions', 'user_additional_departments', 'schedules', 'schedule_items',
      'schedule_snapshots', 'publishes', 'publish_targets', 'schedule_requests', 'schedule_reservations', 'presentations', 'presentation_items',
      'presentation_slot_items', 'layouts', 'media', 'screens', 'screen_groups', 'screen_group_members', 'audit_logs', 'storage_objects']) {
      const columns = await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
      expect(columns.rows.length).toBeGreaterThan(0);
      const excluded = table === 'schedule_items' ? new Set(['source_kind', 'live_session_id']) : new Set<string>();
      const definitions = columns.rows.filter(row => !excluded.has(row.attname)).map(row => {
        if (row.default_sql && /\bnextval\s*\(/i.test(row.default_sql)) throw new Error('Fixture refuses source sequence defaults');
        return `${quote(row.attname)} ${localize(row.type)}${row.attnotnull ? ' NOT NULL' : ''}${row.default_sql ? ` DEFAULT ${localize(row.default_sql)}` : ''}`;
      });
      const checks = await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con
        JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [table]);
      for (const row of checks.rows) if (![...excluded].some(column => new RegExp(`\\b${column}\\b`).test(row.definition))) {
        definitions.push(`CONSTRAINT ${quote(row.conname)} ${localize(row.definition)}`);
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
    const grants = [{ action: 'create', subject: 'ScheduleItem' }, { action: 'read', subject: 'Schedule' }, { action: 'update', subject: 'Schedule' },
      ...['Presentation', 'Media', 'Layout'].map(subject => ({ action: 'read', subject }))];
    author = await makeUser('SYNTHETIC_LIVE_AUTHOR', [...grants, { action: 'read', subject: 'LiveBroadcast' }], departmentA);
    conditional = await makeUser('SYNTHETIC_BOUND_READER', [...grants, { action: 'read', subject: 'LiveBroadcast', conditions: { created_by: '$user.id' } }], departmentA);
    server = Fastify({ logger: false });
    server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(scheduleRoutes); await server.ready();
  }, 30_000);

  afterAll(async () => {
    await server?.close(); await pool?.end(); await source?.end();
    if (adminPool) { if (created) await adminPool.query(`DROP DATABASE ${quote(database)}`); await adminPool.end(); }
  }, 15_000);

  it('keeps legacy presentation input compatible and returns explicit source fields', async () => {
    const data = await seed();
    const result = await invoke(author, 'POST', itemPath(data.scheduleId), bodyFor(data));
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json()).toMatchObject({ source_kind: 'PRESENTATION', live_session_id: null, presentation_id: data.presentationId });
    const listed = await invoke(author, 'GET', itemPath(data.scheduleId));
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items[0]).toMatchObject({ source_kind: 'PRESENTATION', live_session_id: null });
  });

  it('rejects missing/mismatched live identities and missing fallback with422 and no revision writes', async () => {
    const data = await seed();
    for (const body of [bodyFor(data, { source_kind: 'LIVE' }), bodyFor(data, { source_kind: 'LIVE', live_session_id: null }),
      bodyFor(data, { source_kind: 'PRESENTATION', live_session_id: data.liveId }),
      bodyFor(data, { live_session_id: data.liveId }), bodyFor(data, { source_kind: 'LIVE', live_session_id: data.liveId, presentation_id: undefined })]) {
      const result = await invoke(author, 'POST', itemPath(data.scheduleId), body);
      expect(result.statusCode, result.body).toBe(422); await unchanged(data.scheduleId);
    }
  });

  it('persists a LIVE source and required fallback and exposes both in the real GET journey', async () => {
    const data = await seed();
    const result = await invoke(author, 'POST', itemPath(data.scheduleId), bodyFor(data, { source_kind: 'LIVE', live_session_id: data.liveId }));
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json()).toMatchObject({ source_kind: 'LIVE', live_session_id: data.liveId, presentation_id: data.presentationId });
    expect((await pool.query('SELECT revision FROM schedules WHERE id=$1', [data.scheduleId])).rows[0].revision).toBe(2);
    const listed = await invoke(author, 'GET', itemPath(data.scheduleId));
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().items[0]).toMatchObject({ source_kind: 'LIVE', live_session_id: data.liveId,
      presentation_id: data.presentationId, presentation: { id: data.presentationId } });
  });

  it('rejects inactive, deleted and missing sources without item or schedule revision writes', async () => {
    for (const state of ['inactive', 'deleted', 'missing']) {
      const data = await seed();
      if (state !== 'missing') await pool.query(`UPDATE live_sessions SET is_active=false,deleted_at=${state === 'deleted' ? 'now()' : 'NULL'} WHERE id=$1`, [data.liveId]);
      const result = await invoke(author, 'POST', itemPath(data.scheduleId), bodyFor(data, { source_kind: 'LIVE', live_session_id: state === 'missing' ? randomUUID() : data.liveId }));
      expect(result.statusCode, result.body).toBe(409); expect(result.json().error.code).toBe('LIVE_SESSION_UNAVAILABLE');
      await unchanged(data.scheduleId);
    }
  });

  it('enforces department ownership and narrower-source restrictions for authored references', async () => {
    const foreign = await seed();
    await pool.query(`UPDATE live_sessions SET owner_department_id=$2 WHERE id=$1`, [foreign.liveId, departmentB]);
    const denied = await invoke(author, 'POST', itemPath(foreign.scheduleId), bodyFor(foreign, { source_kind: 'LIVE', live_session_id: foreign.liveId }));
    expect(denied.statusCode, denied.body).toBe(403); await unchanged(foreign.scheduleId);
    const broad = await seed('ORGANIZATION', null);
    await pool.query(`UPDATE live_sessions SET owner_scope='DEPARTMENT',owner_department_id=$2 WHERE id=$1`, [broad.liveId, departmentA]);
    const narrowed = await invoke(admin, 'POST', itemPath(broad.scheduleId), bodyFor(broad, { source_kind: 'LIVE', live_session_id: broad.liveId }));
    expect(narrowed.statusCode, narrowed.body).toBe(400); await unchanged(broad.scheduleId);
  });

  it('binds conditional source read to the actual row on both POST and GET', async () => {
    const data = await seed();
    const denied = await invoke(conditional, 'POST', itemPath(data.scheduleId), bodyFor(data, { source_kind: 'LIVE', live_session_id: data.liveId }));
    expect(denied.statusCode, denied.body).toBe(403); await unchanged(data.scheduleId);
    await pool.query('UPDATE live_sessions SET created_by=$2 WHERE id=$1', [data.liveId, conditional.id]);
    const accepted = await invoke(conditional, 'POST', itemPath(data.scheduleId), bodyFor(data, { source_kind: 'LIVE', live_session_id: data.liveId }));
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect((await invoke(conditional, 'GET', itemPath(data.scheduleId))).statusCode).toBe(200);
    await pool.query('UPDATE live_sessions SET created_by=$2 WHERE id=$1', [data.liveId, admin.id]);
    expect((await invoke(conditional, 'GET', itemPath(data.scheduleId))).statusCode).toBe(403);
  });

  it('fails live publication closed before creating any ordinary snapshot, publish or target', async () => {
    const data = await seed();
    expect((await invoke(author, 'POST', itemPath(data.scheduleId), bodyFor(data, { source_kind: 'LIVE', live_session_id: data.liveId }))).statusCode).toBe(201);
    const before = (await pool.query('SELECT revision,updated_at FROM schedules WHERE id=$1', [data.scheduleId])).rows[0];
    const counts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM schedule_snapshots) snapshots,
      (SELECT count(*)::int FROM publishes) publishes,(SELECT count(*)::int FROM publish_targets) targets`)).rows[0];
    const beforeCounts = await counts();
    const result = await invoke(admin, 'POST', `/api/v1/schedules/${data.scheduleId}/publish`, { screen_ids: [data.screenId] });
    expect(result.statusCode, result.body).toBe(409); expect(result.json().error.code).toBe('LIVE_APPROVAL_REQUIRED');
    expect(await counts()).toEqual(beforeCounts);
    expect((await pool.query('SELECT revision,updated_at FROM schedules WHERE id=$1', [data.scheduleId])).rows[0]).toEqual(before);
  });
});
