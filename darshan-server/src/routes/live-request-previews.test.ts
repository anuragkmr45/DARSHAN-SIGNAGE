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
import { liveRequestPreviewRoutes } from './live-request-previews';
import { liveSchedulingFingerprint } from '@/services/live-scheduling';

type Token = { sub: string; jti: string; role_id: string; role: string; department_id: string | null; department_ids: string[] };
const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, queue: vi.fn(), sign: vi.fn(), tokens: new Map<string, Token>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/jobs', () => ({ queueLiveFallbackPreparation: fixture.queue }));
vi.mock('@/s3', () => ({ getPresignedUrl: fixture.sign }));
// Only JWT decoding and queue dispatch are substituted. Authorization, graph
// collection, row locks, transactions and every persisted state use PostgreSQL.
vi.mock('@/auth/jwt', () => ({ extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => { const payload = fixture.tokens.get(token); if (!payload) throw AppError.unauthorized(); return payload; } }));

describe('request-bound immutable live fallback previews on an owned PostgreSQL database', () => {
  const suffix = randomUUID().replace(/-/g, ''), name = `darshan_live_request_preview_${suffix}_test`, namespace = `live_request_preview_${suffix}_test`;
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  type User = { id: string; token: string; roleId: string; role: string; department: string | null };
  let admin: User, author: User;
  const departmentA = randomUUID(), departmentB = randomUUID(), route = '/api/v1/live-fallback-preparations';
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const localize = (value: string) => value.replace(/\bpublic\./g, '');
  const invoke = (user: User, method: 'GET' | 'POST', path = route, payload?: unknown) => server.inject({ method, url: path,
    headers: { authorization: `Bearer ${user.token}` }, payload });
  const row = async (id: string) => (await pool.query('SELECT * FROM live_fallback_preparations WHERE id=$1', [id])).rows[0];

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
  async function graph(owner = admin.id, withLayout = false) {
    const presentation = randomUUID(), media = randomUUID(), object = randomUUID(), entry = randomUUID();
    await pool.query('INSERT INTO storage_objects(id,bucket,object_key,content_type,size,sha256) VALUES($1,$2,$3,$4,64,$5)',
      [object, 'synthetic-live-fallback-source', `${object}.png`, 'image/png', 'd'.repeat(64)]);
    await pool.query(`INSERT INTO media(id,name,type,status,created_by,owner_scope,owner_department_id,source_object_id,ready_object_id)
      VALUES($1,$2,'IMAGE','READY',$3,'DEPARTMENT',$4,$5,$5)`, [media, 'Synthetic verified image descriptor', owner, departmentA, object]);
    await pool.query(`INSERT INTO presentations(id,name,created_by,owner_scope,owner_department_id) VALUES($1,$2,$3,'DEPARTMENT',$4)`,
      [presentation, 'Synthetic fallback presentation', owner, departmentA]);
    const layout = withLayout ? randomUUID() : undefined;
    if (layout) {
      await pool.query(`INSERT INTO layouts(id,name,aspect_ratio,spec,created_by,owner_scope,owner_department_id) VALUES($1,'Synthetic old layout','16:9',$2,$3,'DEPARTMENT',$4)`,
        [layout, { slots: [{ id: 'main', x: 0, y: 0, w: 1, h: 1 }] }, owner, departmentA]);
      await pool.query('UPDATE presentations SET layout_id=$2 WHERE id=$1', [presentation, layout]);
      await pool.query(`INSERT INTO presentation_slot_items(id,presentation_id,slot_id,media_id,"order",duration_seconds,fit_mode)
        VALUES($1,$2,'main',$3,0,15,'contain')`, [entry, presentation, media]);
    } else await pool.query('INSERT INTO presentation_items(id,presentation_id,media_id,"order",duration_seconds) VALUES($1,$2,$3,0,15)', [entry, presentation, media]);
    return { presentation, media, object, entry, layout };
  }

  async function readyPreparation(withLayout = false) {
    const data = await graph(admin.id, withLayout); fixture.queue.mockReset(); fixture.queue.mockResolvedValue(undefined);
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
    server = Fastify({ logger: false });
    server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(liveFallbackRoutes); await server.register(liveRequestPreviewRoutes); await server.ready();
  }, 30_000);

  afterAll(async () => {
    await server?.close(); await pool?.end(); await source?.end();
    if (adminPool) { if (created) await adminPool.query(`DROP DATABASE ${quote(name)}`); await adminPool.end(); }
  }, 15_000);


  const previewPath = (requestId: string, itemId: string) => `/api/v1/schedule-requests/${requestId}/live-items/${itemId}/fallback-preview`;
  async function reviewedRequest(withLayout = false) {
    const data = await readyPreparation(withLayout), scheduleId = randomUUID(), itemId = randomUUID(), sourceId = randomUUID(), requestId = randomUUID();
    await pool.query(`INSERT INTO schedules(id,name,start_at,end_at,created_by,owner_scope,owner_department_id)
      VALUES($1,'Synthetic frozen request','2049-01-01','2050-01-01',$2,'DEPARTMENT',$3)`, [scheduleId, admin.id, departmentA]);
    await pool.query(`INSERT INTO live_sessions(id,name,presenter_user_id,created_by,owner_scope,owner_department_id)
      VALUES($1,'Synthetic source',$2,$2,'DEPARTMENT',$3)`, [sourceId, admin.id, departmentA]);
    const policy = { version: 1, source_kind: 'LIVE', schedule_id: scheduleId, schedule_item_id: itemId, schedule_revision: 1,
      live_session_id: sourceId, presenter_user_id: admin.id, policy_revision: 1, microphone: false, screen_share_audio: true,
      start_at: '2049-01-01T00:00:00.000Z', end_at: '2050-01-01T00:00:00.000Z', priority: 0, screen_ids: [randomUUID()], screen_group_ids: [],
      fallback: { preparation_id: data.preparation.id, source_fingerprint: data.preparation.source_fingerprint, manifest: data.manifest } };
    const approval = { version: 1, approval_fingerprint: liveSchedulingFingerprint({ schedule_id: scheduleId, schedule_revision: 1,
      items: [{ policy, item_fingerprint: liveSchedulingFingerprint(policy) }] }),
      fallback_preparation_ids: { [data.presentation]: data.preparation.id }, items: [policy] };
    await pool.query(`INSERT INTO schedule_requests(id,schedule_id,requested_by,schedule_payload) VALUES($1,$2,$3,$4)`,
      [requestId, scheduleId, author.id, { live_approval: approval }]);
    return { ...data, scheduleId, itemId, sourceId, requestId, policy, approval, path: previewPath(requestId, itemId) };
  }
  const readGrants = ['ScheduleRequest', 'Schedule', 'LiveBroadcast', 'Presentation', 'Media', 'Layout'].map(subject => ({ action: 'read', subject }));

  it('returns exact frozen descriptors with no-store and never journals response credentials', async () => {
    const data = await reviewedRequest(), reviewer = await makeUser(`REVIEWER_${randomUUID()}`, readGrants, departmentA);
    const before = (await pool.query('SELECT schedule_payload FROM schedule_requests WHERE id=$1', [data.requestId])).rows[0].schedule_payload;
    fixture.sign.mockClear();
    const response = await invoke(reviewer, 'GET', data.path);
    expect(response.statusCode, response.body).toBe(200); expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toMatchObject({ request_id: data.requestId, schedule_item_id: data.itemId,
      approval_fingerprint: data.approval.approval_fingerprint, manifest: data.manifest, downloads: [{ asset_id: data.assetId, sha256: 'd'.repeat(64), size: 64 }] });
    expect(fixture.sign).toHaveBeenCalledWith('synthetic-immutable-live-fallback', data.objectKey,
      expect.objectContaining({ expiresIn: 900, audience: 'cms', responseContentDisposition: 'inline' }));
    expect((await pool.query('SELECT schedule_payload FROM schedule_requests WHERE id=$1', [data.requestId])).rows[0].schedule_payload).toEqual(before);
    expect(JSON.stringify(before)).not.toContain('https://');
  });

  it('keeps approved bytes previewable after mutable graph edits and soft-deleted source/media', async () => {
    const data = await reviewedRequest();
    await pool.query('UPDATE presentation_items SET duration_seconds=99 WHERE id=$1', [data.entry]);
    await pool.query(`UPDATE live_sessions SET name='Changed source',is_active=false,deleted_at=now(),revision=2,policy_revision=2 WHERE id=$1`, [data.sourceId]);
    await pool.query('UPDATE media SET deleted_at=now() WHERE id=$1', [data.media]);
    const response = await invoke(admin, 'GET', data.path);
    expect(response.statusCode, response.body).toBe(200); expect(response.json().manifest).toEqual(data.manifest);
    expect(response.json().manifest.presentation.items[0].duration_seconds).toBe(15);
  });

  it('applies current secondary-department and conditional READ grants, with no signing on denial', async () => {
    const data = await reviewedRequest(), reviewer = await makeUser(`SECONDARY_${randomUUID()}`, readGrants, departmentB);
    await pool.query('INSERT INTO user_additional_departments(user_id,department_id,assigned_by) VALUES($1,$2,$3)', [reviewer.id, departmentA, admin.id]);
    expect((await invoke(reviewer, 'GET', data.path)).statusCode).toBe(200);
    await pool.query('DELETE FROM user_additional_departments WHERE user_id=$1', [reviewer.id]); fixture.sign.mockClear();
    expect((await invoke(reviewer, 'GET', data.path)).statusCode).toBe(403); expect(fixture.sign).not.toHaveBeenCalled();
    const conditionalReader = await makeUser(`CONDITIONAL_${randomUUID()}`, [...readGrants.filter(grant => grant.subject !== 'Media'),
      { action: 'read', subject: 'Media', conditions: { created_by: '$user.id' } }], departmentA);
    expect((await invoke(conditionalReader, 'GET', data.path)).statusCode).toBe(403); expect(fixture.sign).not.toHaveBeenCalled();
    const noRequestRead = await makeUser(`NO_REQUEST_${randomUUID()}`, readGrants.filter(grant => grant.subject !== 'ScheduleRequest'), departmentA);
    expect((await invoke(noRequestRead, 'GET', data.path)).statusCode).toBe(403); expect(fixture.sign).not.toHaveBeenCalled();
    const withdrawn = await makeUser(`WITHDRAWN_${randomUUID()}`, readGrants, departmentA);
    expect((await invoke(withdrawn, 'GET', data.path)).statusCode).toBe(200);
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [withdrawn.roleId, { grants: readGrants.filter(grant => grant.subject !== 'Media') }]);
    fixture.sign.mockClear(); expect((await invoke(withdrawn, 'GET', data.path)).statusCode).toBe(403); expect(fixture.sign).not.toHaveBeenCalled();
  });

  it('rejects wrong request/item bindings and corrupted stored fingerprints before signing', async () => {
    const data = await reviewedRequest(); fixture.sign.mockClear();
    expect((await invoke(admin, 'GET', previewPath(data.requestId, randomUUID()))).statusCode).toBe(404);
    const payload = { live_approval: { ...data.approval, approval_fingerprint: '0'.repeat(64) } };
    await pool.query('UPDATE schedule_requests SET schedule_payload=$2 WHERE id=$1', [data.requestId, payload]);
    const response = await invoke(admin, 'GET', data.path); expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe('LIVE_APPROVAL_STALE'); expect(fixture.sign).not.toHaveBeenCalled();
    await pool.query('UPDATE schedule_requests SET schedule_payload=$2 WHERE id=$1', [data.requestId,
      { live_approval: { ...data.approval, fallback_preparation_ids: { [data.presentation]: randomUUID() } } }]);
    expect((await invoke(admin, 'GET', data.path)).statusCode).toBe(409); expect(fixture.sign).not.toHaveBeenCalled();
    const otherSchedule = randomUUID();
    await pool.query(`INSERT INTO schedules(id,name,start_at,end_at,created_by,owner_scope,owner_department_id)
      VALUES($1,'Other synthetic schedule','2049-01-01','2050-01-01',$2,'DEPARTMENT',$3)`, [otherSchedule, admin.id, departmentA]);
    await pool.query('UPDATE schedule_requests SET schedule_payload=$2,schedule_id=$3 WHERE id=$1',
      [data.requestId, { live_approval: data.approval }, otherSchedule]);
    expect((await invoke(admin, 'GET', data.path)).statusCode).toBe(409); expect(fixture.sign).not.toHaveBeenCalled();
  });

  it('checks source, presentation and original frozen layout READ even after the library layout changes', async () => {
    const data = await reviewedRequest(true);
    await pool.query('UPDATE presentations SET layout_id=NULL WHERE id=$1', [data.presentation]);
    expect((await invoke(admin, 'GET', data.path)).statusCode).toBe(200);
    for (const resource of ['LiveBroadcast', 'Presentation', 'Layout']) {
      const reader = await makeUser(`BOUND_${randomUUID()}`, [...readGrants.filter(grant => grant.subject !== resource),
        { action: 'read', subject: resource, conditions: { created_by: '$user.id' } }], departmentA);
      fixture.sign.mockClear(); expect((await invoke(reader, 'GET', data.path)).statusCode).toBe(403); expect(fixture.sign).not.toHaveBeenCalled();
    }
  });

  it('verifies normalized CAS checksums and fails closed if a retained metadata record is missing', async () => {
    const checksum = await reviewedRequest(); fixture.sign.mockClear();
    await pool.query('UPDATE storage_objects SET sha256=$2 WHERE id=$1', [checksum.objectId, 'a'.repeat(64)]);
    expect((await invoke(admin, 'GET', checksum.path)).statusCode).toBe(409); expect(fixture.sign).not.toHaveBeenCalled();
    const missing = await reviewedRequest(); fixture.sign.mockClear();
    await pool.query('DELETE FROM media WHERE id=$1', [missing.media]);
    expect((await invoke(admin, 'GET', missing.path)).statusCode).toBe(404); expect(fixture.sign).not.toHaveBeenCalled();
  });

  it('denies revoked sessions and redacts signing failures without changing approval', async () => {
    const data = await reviewedRequest(), reviewer = await makeUser(`REVOKED_${randomUUID()}`, readGrants, departmentA);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [reviewer.id]); fixture.sign.mockClear();
    expect((await invoke(reviewer, 'GET', data.path)).statusCode).toBe(401); expect(fixture.sign).not.toHaveBeenCalled();
    fixture.sign.mockRejectedValueOnce(new Error('https://private-signed-url.example/?token=must-not-escape'));
    const response = await invoke(admin, 'GET', data.path); expect(response.statusCode, response.body).toBe(503);
    expect(response.json().error.code).toBe('LIVE_FALLBACK_PREVIEW_UNAVAILABLE'); expect(response.body).not.toContain('must-not-escape');
  });
});
