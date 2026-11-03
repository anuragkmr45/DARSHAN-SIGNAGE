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
import { liveScheduleDraftRoutes } from './live-schedule-drafts';

type Token = { sub: string; jti: string; role_id: string; role: string; department_id: string | null; department_ids: string[] };
const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, queue: vi.fn(), sign: vi.fn(), tokens: new Map<string, Token>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/jobs', () => ({ queueLiveFallbackPreparation: fixture.queue }));
vi.mock('@/s3', () => ({ getPresignedUrl: fixture.sign }));
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

  async function readyPreparation() {
    const data = await graph(); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    fixture.sign.mockReset(); fixture.sign.mockResolvedValue('https://media.example.test/immutable-preview?synthetic=1');
    const initial = await invoke(author, 'POST', route, { presentation_id: data.presentation });
    expect(initial.statusCode, initial.body).toBe(202);
    const preparation = await row(initial.json().id), assetId = randomUUID(), objectId = randomUUID();
    const sha256 = 'd'.repeat(64), objectKey = `live-fallbacks/v1/sha256/${sha256}.png`;
    await pool.query('INSERT INTO storage_objects(id,bucket,object_key,content_type,size,sha256) VALUES($1,$2,$3,$4,64,$5)',
      [objectId, 'synthetic-immutable-live-fallback', objectKey, 'image/png', sha256]);
    await pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,
      sha256,size,content_type,render_type,source_type,representation) VALUES($1,$2,$3,$4,$5,64,'image/png','image','IMAGE','SOURCE')`,
      [preparation.id, assetId, data.media, objectId, sha256]);
    const manifest = { version: 1, presentation: { id: data.presentation, layout: preparation.source_graph.presentation.layout,
      items: preparation.source_graph.presentation.items.map(({ media_id: _mediaId, ...entry }: { media_id: string; [key: string]: unknown }) => ({ ...entry, asset_id: assetId })) },
      assets: [{ id: assetId, media_id: data.media, storage_object_id: objectId, bucket: 'synthetic-immutable-live-fallback',
        object_key: objectKey, sha256, size: 64, content_type: 'image/png', render_type: 'image', representation: 'SOURCE',
        dependencies: [], cache_key: `live_${sha256}_image` }] };
    await pool.query("UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1", [preparation.id, manifest]);
    return { ...data, preparation: await row(preparation.id), manifest, assetId, objectId, objectKey };
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
      'presentation_items', 'presentation_slot_items', 'layouts', 'schedules', 'schedule_items', 'schedule_reservations',
      'schedule_requests', 'publishes', 'screens', 'screen_groups', 'screen_group_members']) {
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
    for (const migration of ['0057_live_broadcast_sessions.sql', '0058_live_scheduling.sql', '0061_live_authoring_drafts.sql']) {
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
    await server.register(liveFallbackRoutes); await server.register(liveScheduleDraftRoutes); await server.ready();
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

  it('previews only the verified immutable CAS graph with response-only CMS URLs', async () => {
    const data = await readyPreparation(), before = await row(data.preparation.id); fixture.queue.mockClear();
    const response = await invoke(author, 'GET', `${route}/${data.preparation.id}/preview`);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toMatchObject({ preparation_id: data.preparation.id, presentation_id: data.presentation,
      source_fingerprint: before.source_fingerprint, manifest: data.manifest,
      downloads: [{ asset_id: data.assetId, cache_key: `live_${'d'.repeat(64)}_image`, sha256: 'd'.repeat(64), size: 64,
        content_type: 'image/png', url: 'https://media.example.test/immutable-preview?synthetic=1' }] });
    expect(Date.parse(response.json().downloads[0].expires_at) - Date.parse(response.json().checked_at)).toBe(900_000);
    expect(fixture.sign).toHaveBeenCalledTimes(1);
    expect(fixture.sign).toHaveBeenCalledWith('synthetic-immutable-live-fallback', data.objectKey,
      { expiresIn: 900, responseContentType: 'image/png', responseContentDisposition: 'inline', audience: 'cms' });
    expect(await row(before.id)).toEqual(before); expect(fixture.queue).not.toHaveBeenCalled();
  });

  it('rejects pending, stale, missing and unauthorized previews before signing', async () => {
    const pending = await graph(); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
    const accepted = await invoke(author, 'POST', route, { presentation_id: pending.presentation }); fixture.sign.mockClear();
    const waiting = await invoke(author, 'GET', `${route}/${accepted.json().id}/preview`);
    expect(waiting.statusCode, waiting.body).toBe(409); expect(waiting.json().error.code).toBe('LIVE_FALLBACK_PREPARING');
    expect((await invoke(author, 'GET', `${route}/${randomUUID()}/preview`)).statusCode).toBe(404);
    const ready = await readyPreparation(); fixture.sign.mockClear();
    expect((await invoke(forbidden, 'GET', `${route}/${ready.preparation.id}/preview`)).statusCode).toBe(403);
    expect((await invoke(conditional, 'GET', `${route}/${ready.preparation.id}/preview`)).statusCode).toBe(403);
    await pool.query('UPDATE presentation_items SET duration_seconds=17 WHERE id=$1', [ready.entry]);
    const stale = await invoke(author, 'GET', `${route}/${ready.preparation.id}/preview`);
    expect(stale.statusCode, stale.body).toBe(409); expect(stale.json().error.code).toBe('LIVE_APPROVAL_STALE');
    expect(fixture.sign).not.toHaveBeenCalled();
  });

  it('rechecks current secondary membership for a READY preview', async () => {
    const data = await readyPreparation();
    await pool.query('INSERT INTO user_additional_departments(user_id,department_id,assigned_by) VALUES($1,$2,$3)', [secondary.id, departmentA, admin.id]);
    expect((await invoke(secondary, 'GET', `${route}/${data.preparation.id}/preview`)).statusCode).toBe(200);
    await pool.query('DELETE FROM user_additional_departments WHERE user_id=$1 AND department_id=$2', [secondary.id, departmentA]);
    fixture.sign.mockClear();
    expect((await invoke(secondary, 'GET', `${route}/${data.preparation.id}/preview`)).statusCode).toBe(403);
    expect(fixture.sign).not.toHaveBeenCalled();
  });

  it('rejects inconsistent normalized storage metadata before preview signing', async () => {
    const data = await readyPreparation();
    await pool.query('UPDATE storage_objects SET size=65 WHERE id=$1', [data.objectId]); fixture.sign.mockClear();
    const response = await invoke(author, 'GET', `${route}/${data.preparation.id}/preview`);
    expect(response.statusCode, response.body).toBe(422); expect(response.json().error.code).toBe('LIVE_FALLBACK_UNVERIFIED');
    expect(fixture.sign).not.toHaveBeenCalled();
  });

  it('returns a safe retriable error for signing failure without rewriting READY work', async () => {
    const data = await readyPreparation(), before = await row(data.preparation.id);
    fixture.sign.mockRejectedValue(new Error('https://media.example.test/?X-Amz-Signature=must-not-leak'));
    const response = await invoke(author, 'GET', `${route}/${data.preparation.id}/preview`);
    expect(response.statusCode, response.body).toBe(503); expect(response.json().error.code).toBe('LIVE_FALLBACK_PREVIEW_UNAVAILABLE');
    expect(response.body).not.toContain('must-not-leak'); expect(await row(before.id)).toEqual(before);
  });

  let draftIndex = 0;
  async function draftFixture() {
    const data = await readyPreparation(), source = randomUUID(), screen = randomUUID(), draftId = randomUUID();
    await pool.query(`INSERT INTO live_sessions(id,name,presenter_user_id,created_by,owner_scope)
      VALUES($1,'Synthetic draft source',$2,$2,'ORGANIZATION')`, [source, admin.id]);
    await pool.query(`INSERT INTO screens(id,name,device_info) VALUES($1,'Synthetic draft receiver',$2)`,
      [screen, { player_capabilities: { features: ['live_broadcast_v1'] } }]);
    const start = new Date(Date.UTC(2050, 0, 1 + draftIndex++, 10));
    const input = { request_id: randomUUID(), expected_revision: 0, name: 'Synthetic atomic live draft', timezone: 'Asia/Kolkata',
      live_session_id: source, presentation_id: data.presentation, preparation_id: data.preparation.id,
      start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), priority: 0,
      screen_ids: [screen], screen_group_ids: [] as string[] };
    return { ...data, source, screen, draftId, input, path: `/api/v1/live-schedule-drafts/${draftId}` };
  }
  const draftCounts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM live_authoring_drafts) drafts,
    (SELECT count(*)::int FROM schedules) schedules,(SELECT count(*)::int FROM schedule_items) items,
    (SELECT count(*)::int FROM schedule_requests) requests,(SELECT count(*)::int FROM schedule_reservations) reservations,
    (SELECT count(*)::int FROM live_schedule_occurrences) occurrences`)).rows[0];

  it('atomically creates one live draft, coalesces concurrent response-loss retries and rejects altered retries', async () => {
    const data = await draftFixture(), second = await sessionFor(admin), before = await draftCounts();
    const responses = await Promise.all([admin, second].map(user => invoke(user, 'POST', `${data.path}/review`, data.input)));
    for (const response of responses) expect(response.statusCode, response.body).toBe(200);
    expect(responses[0].json()).toEqual(responses[1].json());
    expect(responses[0].json()).toMatchObject({ draft_id: data.draftId, draft_revision: 1,
      items: [{ live_session_id: data.source, screen_ids: [data.screen], fallback: { preparation_id: data.preparation.id } }] });
    expect(await draftCounts()).toEqual({ ...before, drafts: before.drafts + 1, schedules: before.schedules + 1, items: before.items + 1 });
    const changed = await invoke(admin, 'POST', `${data.path}/review`, { ...data.input, priority: 1 });
    expect(changed.statusCode, changed.body).toBe(409); expect(changed.json().error.code).toBe('LIVE_DRAFT_CONFLICT');
    expect((await invoke(author, 'POST', `${data.path}/review`, data.input)).statusCode).toBe(403);
  });

  it('edits the same draft/item with revision fencing and leaves invalid review mutations rolled back', async () => {
    const data = await draftFixture(), initial = await invoke(admin, 'POST', `${data.path}/review`, data.input);
    expect(initial.statusCode, initial.body).toBe(200);
    const first = initial.json(), before = await draftCounts(), itemId = first.items[0].schedule_item_id;
    const edited = await invoke(admin, 'POST', `${data.path}/review`, { ...data.input, request_id: randomUUID(), expected_revision: 1, priority: 1, name: 'Edited atomic draft' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ schedule_id: first.schedule_id, draft_revision: 2,
      items: [{ schedule_item_id: itemId, priority: 1 }] });
    expect(edited.json().approval_fingerprint).not.toBe(first.approval_fingerprint); expect(await draftCounts()).toEqual(before);
    const invalid = await invoke(admin, 'POST', `${data.path}/review`, { ...data.input, request_id: randomUUID(), expected_revision: 2,
      name: 'Must roll back', screen_ids: [randomUUID()] });
    expect(invalid.statusCode, invalid.body).toBe(422);
    const saved = (await pool.query('SELECT name,revision FROM schedules WHERE id=$1', [first.schedule_id])).rows[0];
    expect(saved.name).toBe('Edited atomic draft'); expect(saved.revision).toBe(2);
    expect((await pool.query('SELECT revision FROM live_authoring_drafts WHERE id=$1', [data.draftId])).rows[0].revision).toBe(2);
    const recovered = await invoke(admin, 'GET', data.path);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.headers['cache-control']).toBe('private, no-store');
    expect(recovered.json()).toMatchObject({ draft_id: data.draftId, draft_revision: 2, schedule_id: first.schedule_id,
      submitted_request_id: null, form: { name: 'Edited atomic draft', priority: 1, preparation_id: data.preparation.id } });
    expect(recovered.body).not.toContain('https:'); expect((await invoke(author, 'GET', data.path)).statusCode).toBe(403);
    const stale = await invoke(admin, 'POST', `${data.path}/review`, { ...data.input, request_id: randomUUID(), expected_revision: 1 });
    expect(stale.statusCode, stale.body).toBe(409); expect(await draftCounts()).toEqual(before);
  });

  it('does not leave any half-draft after unsupported players or incompatible nested ownership', async () => {
    const data = await draftFixture(), before = await draftCounts();
    await pool.query("UPDATE screens SET device_info='{}' WHERE id=$1", [data.screen]);
    const unsupported = await invoke(admin, 'POST', `${data.path}/review`, data.input);
    expect(unsupported.statusCode, unsupported.body).toBe(422); expect(unsupported.json().error.code).toBe('LIVE_PLAYER_UNSUPPORTED');
    expect(await draftCounts()).toEqual(before);
    await pool.query('UPDATE screens SET device_info=$2 WHERE id=$1', [data.screen, { player_capabilities: { features: ['live_broadcast_v1'] } }]);
    await pool.query("UPDATE media SET owner_scope='RESTRICTED',owner_department_id=NULL WHERE id=$1", [data.media]);
    const ownership = await invoke(admin, 'POST', `${data.path}/review`, data.input);
    expect(ownership.statusCode, ownership.body).toBe(403);
    expect(await draftCounts()).toEqual(before);
  });

  it('submits exactly one request/hold/occurrence despite concurrent response-loss retries', async () => {
    const data = await draftFixture(), review = await invoke(admin, 'POST', `${data.path}/review`, data.input);
    expect(review.statusCode, review.body).toBe(200);
    const reviewed = review.json(), second = await sessionFor(admin), before = await draftCounts();
    const input = { request_id: randomUUID(), expected_revision: 1, expected_live_fingerprint: reviewed.approval_fingerprint, notes: 'Synthetic reviewed live event' };
    const responses = await Promise.all([admin, second].map(user => invoke(user, 'POST', `${data.path}/submit`, input)));
    for (const response of responses) expect(response.statusCode, response.body).toBe(200);
    expect(responses[0].json()).toEqual(responses[1].json()); expect(responses[0].json()).toMatchObject({ status: 'PENDING', live_approval: { approval_fingerprint: reviewed.approval_fingerprint } });
    expect(await draftCounts()).toEqual({ ...before, requests: before.requests + 1, reservations: before.reservations + 1, occurrences: before.occurrences + 1 });
    const mismatch = await invoke(admin, 'POST', `${data.path}/submit`, { ...input, notes: 'Changed retry' });
    expect(mismatch.statusCode, mismatch.body).toBe(409);
    const edited = await invoke(admin, 'POST', `${data.path}/review`, { ...data.input, request_id: randomUUID(), expected_revision: 1, priority: 1 });
    expect(edited.statusCode, edited.body).toBe(409); expect(edited.json().error.code).toBe('LIVE_DRAFT_CONFLICT');
    const recovered = await invoke(admin, 'GET', data.path);
    expect(recovered.statusCode, recovered.body).toBe(200); expect(recovered.json().submitted_request_id).toBe(responses[0].json().id);
  });

  it('requires fresh review after a same-count audience change and creates no rejected submission data', async () => {
    const data = await draftFixture(), group = randomUUID(), replacement = randomUUID();
    await pool.query("INSERT INTO screen_groups(id,name) VALUES($1,'Synthetic mutable draft audience')", [group]);
    await pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)', [group, data.screen]);
    data.input.screen_ids = []; data.input.screen_group_ids = [group];
    const review = await invoke(admin, 'POST', `${data.path}/review`, data.input); expect(review.statusCode, review.body).toBe(200);
    const before = await draftCounts();
    await pool.query('INSERT INTO screens(id,name,device_info) VALUES($1,$2,$3)', [replacement, 'Synthetic replacement', { player_capabilities: { features: ['live_broadcast_v1'] } }]);
    await pool.query('UPDATE screen_group_members SET screen_id=$2 WHERE group_id=$1', [group, replacement]);
    const stale = await invoke(admin, 'POST', `${data.path}/submit`, { request_id: randomUUID(), expected_revision: 1, expected_live_fingerprint: review.json().approval_fingerprint });
    expect(stale.statusCode, stale.body).toBe(409); expect(stale.json().error.code).toBe('LIVE_APPROVAL_STALE'); expect(await draftCounts()).toEqual(before);
    const repeatedReview = await invoke(admin, 'POST', `${data.path}/review`, data.input);
    expect(repeatedReview.statusCode, repeatedReview.body).toBe(409); expect(repeatedReview.json().error.code).toBe('LIVE_APPROVAL_STALE');
  });

  it('allows create-only custom operators to review/submit but never update an existing item', async () => {
    const grants = ['Presentation', 'Media', 'Layout', 'LiveBroadcast', 'Screen', 'ScreenGroup', 'Schedule', 'ScheduleRequest'].map(subject => ({ action: 'read', subject }));
    const operator = await makeUser('SYNTHETIC_CREATE_ONLY_DRAFT_OPERATOR', [...grants,
      { action: 'create', subject: 'Schedule' }, { action: 'update', subject: 'Schedule' },
      { action: 'create', subject: 'ScheduleItem' }, { action: 'create', subject: 'ScheduleRequest' }], departmentA);
    const data = await draftFixture(), initial = await invoke(operator, 'POST', `${data.path}/review`, data.input);
    expect(initial.statusCode, initial.body).toBe(200); expect(initial.json().can_edit).toBe(false);
    const before = await draftCounts();
    const denied = await invoke(operator, 'POST', `${data.path}/review`, { ...data.input, request_id: randomUUID(), expected_revision: 1, priority: 1 });
    expect(denied.statusCode, denied.body).toBe(403); expect(await draftCounts()).toEqual(before);
    const detail = await invoke(operator, 'GET', data.path); expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toMatchObject({ can_edit: false, review_request_id: data.input.request_id, draft_revision: 1 });
    const replay = await invoke(operator, 'POST', `${data.path}/review`, { ...detail.json().form, request_id: detail.json().review_request_id, expected_revision: 0 });
    expect(replay.statusCode, replay.body).toBe(200); expect(replay.json()).toEqual(initial.json());
    const submitted = await invoke(operator, 'POST', `${data.path}/submit`, { request_id: randomUUID(), expected_revision: 1, expected_live_fingerprint: replay.json().approval_fingerprint });
    expect(submitted.statusCode, submitted.body).toBe(200);
  });

  it('checks conditional Schedule update grants against both current and proposed draft values', async () => {
    const data = await draftFixture();
    const reads = ['Presentation', 'Media', 'Layout', 'LiveBroadcast', 'Screen', 'ScreenGroup', 'Schedule', 'ScheduleRequest']
      .map(subject => ({ action: 'read', subject }));
    const operator = await makeUser('SYNTHETIC_CONDITIONAL_DRAFT_EDITOR', [...reads,
      { action: 'create', subject: 'Schedule' }, { action: 'create', subject: 'ScheduleItem' },
      { action: 'update', subject: 'ScheduleItem' },
      { action: 'update', subject: 'Schedule', conditions: { name: data.input.name } }], departmentA);
    const initial = await invoke(operator, 'POST', `${data.path}/review`, data.input);
    expect(initial.statusCode, initial.body).toBe(200); expect(initial.json().can_edit).toBe(true);
    const allowed = await invoke(operator, 'POST', `${data.path}/review`, { ...data.input,
      request_id: randomUUID(), expected_revision: 1, priority: 1 });
    expect(allowed.statusCode, allowed.body).toBe(200); expect(allowed.json().draft_revision).toBe(2);
    const before = (await pool.query(`SELECT row_to_json(s) schedule,row_to_json(d) draft,row_to_json(i) item
      FROM live_authoring_drafts d JOIN schedules s ON s.id=d.schedule_id JOIN schedule_items i ON i.schedule_id=s.id
      WHERE d.id=$1`, [data.draftId])).rows[0];
    const denied = await invoke(operator, 'POST', `${data.path}/review`, { ...data.input,
      request_id: randomUUID(), expected_revision: 2, name: 'Outside the conditional grant', priority: 2 });
    expect(denied.statusCode, denied.body).toBe(403);
    const after = (await pool.query(`SELECT row_to_json(s) schedule,row_to_json(d) draft,row_to_json(i) item
      FROM live_authoring_drafts d JOIN schedules s ON s.id=d.schedule_id JOIN schedule_items i ON i.schedule_id=s.id
      WHERE d.id=$1`, [data.draftId])).rows[0];
    expect(after).toEqual(before);
  });

  it('returns an explicit retired-draft conflict after a permitted underlying schedule deletion', async () => {
    const data = await draftFixture(), initial = await invoke(admin, 'POST', `${data.path}/review`, data.input);
    expect(initial.statusCode, initial.body).toBe(200);
    await pool.query('DELETE FROM schedules WHERE id=$1', [initial.json().schedule_id]);
    const before = await draftCounts();
    for (const response of [await invoke(admin, 'GET', data.path), await invoke(admin, 'POST', `${data.path}/review`, data.input)]) {
      expect(response.statusCode, response.body).toBe(409); expect(response.json().error.code).toBe('LIVE_DRAFT_RETIRED');
    }
    expect(await draftCounts()).toEqual(before);
  });

  it('serializes a draft edit against submission of its old review without changing an approved hold', async () => {
    const data = await draftFixture(), initial = await invoke(admin, 'POST', `${data.path}/review`, data.input), second = await sessionFor(admin);
    expect(initial.statusCode, initial.body).toBe(200);
    const [edit, submit] = await Promise.all([
      invoke(admin, 'POST', `${data.path}/review`, { ...data.input, request_id: randomUUID(), expected_revision: 1, priority: 1 }),
      invoke(second, 'POST', `${data.path}/submit`, { request_id: randomUUID(), expected_revision: 1, expected_live_fingerprint: initial.json().approval_fingerprint }),
    ]);
    expect([edit.statusCode, submit.statusCode].sort()).toEqual([200, 409]);
    const record = (await pool.query('SELECT revision,submitted_request_id FROM live_authoring_drafts WHERE id=$1', [data.draftId])).rows[0];
    if (submit.statusCode === 200) { expect(record.revision).toBe(1); expect(record.submitted_request_id).toBe(submit.json().id); }
    else { expect(record.revision).toBe(2); expect(record.submitted_request_id).toBeNull(); }
  });
});
