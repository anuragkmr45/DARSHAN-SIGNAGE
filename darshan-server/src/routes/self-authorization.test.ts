import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database } from '@/db';
import * as tables from '@/db/schema';
import { config } from '@/config';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { AppError, formatErrorResponse } from '@/utils/app-error';
import { toAppError } from '@/utils/errors';
import { selfAuthorizationRoutes } from './self-authorization';
import { roleRoutes } from './roles';
import { liveSessionRoutes } from './live-sessions';
import { defineAbilityFor } from '@/rbac';
import { subject } from '@casl/ability';
const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, tokens: new Map<string, { sub: string; jti: string; role_id: string; role: string; department_id: string }>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/auth/jwt', () => ({ extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => { const payload = fixture.tokens.get(token); if (!payload) throw AppError.unauthorized(); return payload; } }));

describe('self-only effective CMS authorization without Role read on owned PostgreSQL', () => {
  const suffix = randomUUID().replace(/-/g, ''), database = `darshan_self_authorization_${suffix}_test`, namespace = `self_authorization_${suffix}_test`;
  const departmentA = randomUUID(), departmentB = randomUUID();
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  type User = { id: string; roleId: string; token: string };
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  async function user(name: string, grants: unknown[], inherits: string[] = [], department = departmentA): Promise<User> {
    const id = randomUUID(), roleId = randomUUID(), token = randomUUID();
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [roleId, name, { grants, inherits }]);
    await pool.query(`INSERT INTO users(id,email,password_hash,role_id,department_id) VALUES($1,$2,'synthetic-unused-hash',$3,$4)`, [id, `${id}@example.test`, roleId, department]);
    await pool.query(`INSERT INTO sessions(user_id,access_jti,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [id, token]);
    fixture.tokens.set(token, { sub: id, jti: token, role_id: roleId, role: name, department_id: department }); return { id, roleId, token };
  }
  const request = (user: User | null, url = '/api/v1/auth/authorization') => server.inject({ method: 'GET', url, headers: user ? { authorization: `Bearer ${user.token}` } : {} });
  beforeAll(async () => {
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only self authorization catalog'); const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname); expect(url.port).toBe('55455');
    source = new Pool({ connectionString: url.toString(), max: 1, options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000' });
    url.pathname = '/postgres'; adminPool = new Pool({ connectionString: url.toString(), max: 1 }); url.pathname = `/${database}`; assertDedicatedTestDatabase(url.toString());
    await adminPool.query(`CREATE DATABASE ${quote(database)}`); created = true;
    pool = new Pool({ connectionString: url.toString(), max: 5, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=7000 -c lock_timeout=5000` });
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`); expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    const enums = await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const row of enums.rows) await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map((s: string) => `'${s.replace(/'/g, "''")}'`).join(',')})`);
    for (const name of ['roles', 'departments', 'users', 'sessions', 'user_additional_departments', 'live_sessions', 'audit_logs']) {
      const columns = await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [name]);
      expect(columns.rows.length).toBeGreaterThan(0);
      const definitions = columns.rows.map(row => { if (/\bnextval\s*\(/i.test(row.default_sql ?? '')) throw Error('External sequence refused'); return `${quote(row.attname)} ${row.type.replace(/\bpublic\./g, '')}${row.attnotnull ? ' NOT NULL' : ''}${row.default_sql ? ` DEFAULT ${row.default_sql.replace(/\bpublic\./g, '')}` : ''}`; });
      const constraints = await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [name]);
      for (const row of constraints.rows) definitions.push(`CONSTRAINT ${quote(row.conname)} ${row.definition.replace(/\bpublic\./g, '')}`);
      await pool.query(`CREATE TABLE ${quote(name)} (${definitions.join(',')})`);
    }
    fixture.db = drizzle(pool, { schema: tables }); await pool.query('INSERT INTO departments(id,name) VALUES($1,$2),($3,$4)', [departmentA, 'Synthetic A', departmentB, 'Synthetic B']);
    server = Fastify({ logger: false }); server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(selfAuthorizationRoutes); await server.register(roleRoutes); await server.register(liveSessionRoutes); await server.ready();
  }, 30000);
  afterAll(async () => { await server?.close(); await pool?.end(); await source?.end(); if (adminPool) { if (created) await adminPool.query(`DROP DATABASE ${quote(database)}`); await adminPool.end(); } }, 15000);

  it('returns a create-only user’s inherited visibility and permits its real LIVE source operation while denying the role directory', async () => {
    const inherited = randomUUID();
    await pool.query(`INSERT INTO roles(id,name,permissions) SELECT gen_random_uuid(),'Synthetic pagination filler '||n,'{}'::jsonb FROM generate_series(1,120)n`);
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [inherited, 'Synthetic inherited authoring rights', { grants: [
      ...['Schedule', 'ScheduleItem', 'ScheduleRequest'].map(subject => ({ action: 'create', subject })),
      ...['Schedule', 'Presentation', 'Media', 'Screen'].map(subject => ({ action: 'read', subject }))] }]);
    const author = await user('SYNTHETIC_CREATE_ONLY_LIVE', [{ action: 'create', subject: 'LiveBroadcast' }, { action: 'read', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }], [inherited]);
    const response = await request(author); expect(response.statusCode, response.body).toBe(200); expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toMatchObject({ version: 1, user_id: author.id, role: { id: author.roleId, name: 'SYNTHETIC_CREATE_ONLY_LIVE' }, department_id: departmentA, department_ids: [departmentA] });
    expect(response.json().capabilities).toContainEqual({ action: 'create', subject: 'ScheduleItem' }); expect(response.json().capabilities).toContainEqual({ action: 'read', subject: 'Media' });
    expect(response.json().capabilities).not.toContainEqual({ action: 'read', subject: 'Role' }); expect(response.body).not.toContain(inherited); expect(response.body).not.toContain('pagination filler');
    expect((await request(author, '/api/v1/roles?limit=100')).statusCode).toBe(403);
    const created = await server.inject({ method: 'POST', url: '/api/v1/live-sessions', headers: { authorization: `Bearer ${author.token}` }, payload: { name: 'Actual create-only test source', presenter_user_id: author.id } });
    expect(created.statusCode, created.body).toBe(201); expect(created.json()).toMatchObject({ created_by: author.id, owner_scope: 'DEPARTMENT', owner_department_id: departmentA });
  });
  it('does not accept another user/role selector and rejects missing, revoked or disabled sessions', async () => {
    expect((await request(null)).statusCode).toBe(401); const actor = await user(`SELF_${randomUUID()}`, []);
    expect((await request(actor, `/api/v1/auth/authorization?user_id=${randomUUID()}`)).statusCode).toBe(422);
    await pool.query('DELETE FROM sessions WHERE access_jti=$1', [actor.token]); expect((await request(actor)).statusCode).toBe(401);
    const inactive = await user(`INACTIVE_${randomUUID()}`, []); await pool.query('UPDATE users SET is_active=false WHERE id=$1', [inactive.id]); expect((await request(inactive)).statusCode).toBe(401);
  });
  it('uses current role membership and additional departments while preserving primary department conditional scope', async () => {
    const actor = await user(`CONDITIONAL_${randomUUID()}`, [{ action: 'read', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }]);
    await pool.query('INSERT INTO user_additional_departments(user_id,department_id) VALUES($1,$2)', [actor.id, departmentB]);
    const response = await request(actor); expect(response.statusCode, response.body).toBe(200); expect(response.json().department_ids).toEqual([departmentA, departmentB].sort());
    expect(response.json().capabilities).toContainEqual({ action: 'read', subject: 'LiveBroadcast' });
    const ability = await defineAbilityFor(actor.roleId, actor.id, departmentA, fixture.db);
    expect(ability.can('read', subject('LiveBroadcast', { owner_department_id: departmentA }) as never)).toBe(true);
    expect(ability.can('read', subject('LiveBroadcast', { owner_department_id: departmentB }) as never)).toBe(false);
    await pool.query(`UPDATE roles SET permissions='{}' WHERE id=$1`, [actor.roleId]); expect((await request(actor)).json().capabilities).toEqual([]);
  });
  it('expands canonical manage/all and preserves server inverted Branding denial without exposing a graph', async () => {
    const admin = await user('ADMIN', [{ action: 'manage', subject: 'all' }]); const response = await request(admin); expect(response.statusCode, response.body).toBe(200);
    expect(response.json().capabilities).toContainEqual({ action: 'create', subject: 'LiveBroadcast' }); expect(response.json().capabilities).toContainEqual({ action: 'read', subject: 'Role' });
    expect(response.json().capabilities.filter((entry: { subject: string }) => entry.subject === 'BrandingSettings')).toEqual([]);
    const superAdmin = await user('SUPER_ADMIN', []); expect((await request(superAdmin)).json().capabilities).toContainEqual({ action: 'update', subject: 'BrandingSettings' });
  });
});
