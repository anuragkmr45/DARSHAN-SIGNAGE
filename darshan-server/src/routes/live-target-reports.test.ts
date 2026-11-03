import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database } from '@/db';
import { config } from '@/config';
import * as tables from '@/db/schema';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { liveError } from '@/services/live-authority-epoch';
import { toAppError } from '@/utils/errors';
import { formatErrorResponse } from '@/utils/app-error';
import { liveTargetReportRoutes } from './live-target-reports';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, directory: '', tokens: new Map<string, { sub: string; jti: string }>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/config', async () => { const actual = await vi.importActual<typeof import('@/config')>('@/config'); return { ...actual,
  config: { ...actual.config, DARSHAN_LIVE_RUNTIME_ENABLED: true, DEVICE_DESIRED_STATE_ENABLED: true, COMMAND_OUTBOX_WRITE_ENABLED: true,
    DARSHAN_LIVE_MEDIA_CONTROL_URL: 'https://127.0.0.1:19999', get DARSHAN_LIVE_MEDIA_CONTROL_SECRET_FILE() { return path.join(fixture.directory, 'control'); },
    get DARSHAN_LIVE_AUTHORITY_FILE() { return path.join(fixture.directory, 'authority.json'); } } }; });
vi.mock('@/auth/jwt', () => ({ extractTokenFromHeader: (value?: string) => value?.startsWith('Bearer ') ? value.slice(7) : undefined,
  verifyAccessToken: async (token: string) => { const value = fixture.tokens.get(token); if (!value) throw liveError('UNAUTHORIZED', 'Synthetic session missing', 401); return value; } }));

describe('current live target reports on an owned PostgreSQL database', () => {
  const suffix = randomUUID().replace(/-/g, ''), database = `darshan_live_targets_${suffix}_test`, namespace = `live_targets_${suffix}_test`;
  const epoch = randomUUID(), departmentA = randomUUID(), departmentB = randomUUID();
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  type User = { id: string; roleId: string; token: string };
  let manager: User, presenter: User, foreign: User;
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`, localize = (value: string) => value.replace(/\bpublic\./g, '');
  const presenterGrants = [{ action: 'publish', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }];
  async function user(name: string, grants: unknown[], department: string): Promise<User> {
    const id = randomUUID(), roleId = randomUUID(), token = randomUUID();
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [roleId, name, { grants }]);
    await pool.query(`INSERT INTO users(id,email,password_hash,role_id,department_id) VALUES($1,$2,'synthetic-unused-hash',$3,$4)`, [id, `${id}@example.test`, roleId, department]);
    await pool.query(`INSERT INTO sessions(user_id,access_jti,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [id, token]);
    fixture.tokens.set(token, { sub: id, jti: token }); return { id, roleId, token };
  }
  const invoke = (actor: User, occurrenceId: string) => server.inject({ method: 'GET', url: `/api/v1/live-occurrences/${occurrenceId}/targets`, headers: { authorization: `Bearer ${actor.token}` } });
  async function seed() {
    const id = randomUUID(), schedule = randomUUID(), item = randomUUID(), sourceId = randomUUID(), preparation = randomUUID(), presentation = randomUUID(),
      asset = randomUUID(), object = randomUUID(), publish = randomUUID(), snapshot = randomUUID(), group = randomUUID(), screenIds = [randomUUID(), randomUUID(), randomUUID()];
    const start = new Date(Date.now() - 60000).toISOString(), end = new Date(Date.now() + 1200000).toISOString();
    for (const [index, screenId] of screenIds.entries()) await pool.query('INSERT INTO screens(id,name,device_info) VALUES($1,$2,$3)', [screenId, `Synthetic secret screen ${index}`, { private_hardware: 'NEVER_RETURN_THIS' }]);
    await pool.query('INSERT INTO screen_groups(id,name) VALUES($1,$2)', [group, 'Synthetic mutable group']);
    for (const screenId of screenIds) await pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)', [group, screenId]);
    await pool.query(`INSERT INTO live_sessions(id,name,presenter_user_id,created_by,owner_scope,owner_department_id) VALUES($1,'Synthetic frozen source',$2,$3,'DEPARTMENT',$4)`, [sourceId, presenter.id, manager.id, departmentA]);
    await pool.query('INSERT INTO storage_objects(id,bucket,object_key,sha256,size,content_type) VALUES($1,$2,$3,$4,64,$5)', [object, 'synthetic-cas', `live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`, 'a'.repeat(64), 'image/png']);
    const manifest = { version: 1, presentation: { id: presentation, layout: null, items: [{ id: randomUUID(), order: 0, asset_id: asset }] },
      assets: [{ id: asset, media_id: asset, storage_object_id: object, bucket: 'synthetic-cas', object_key: `live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`, sha256: 'a'.repeat(64), size: 64,
        content_type: 'image/png', render_type: 'image', representation: 'READY', dependencies: [], cache_key: `live_${'a'.repeat(64)}_image` }] };
    await pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph) VALUES($1,$2,$3,$4,'{}')`, [preparation, presentation, manager.id, 'b'.repeat(64)]);
    await pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation) VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY')`, [preparation, asset, object, 'a'.repeat(64)]);
    await pool.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`, [preparation, manifest]);
    await pool.query('INSERT INTO schedule_snapshots(id,schedule_id,payload) VALUES($1,$2,$3)', [snapshot, schedule, {}]);
    await pool.query('INSERT INTO publishes(id,schedule_id,snapshot_id,published_by) VALUES($1,$2,$3,$4)', [publish, schedule, snapshot, manager.id]);
    const policy = { version: 1, source_kind: 'LIVE', schedule_id: schedule, schedule_item_id: item, schedule_revision: 1, live_session_id: sourceId,
      presenter_user_id: presenter.id, policy_revision: 1, microphone: false, screen_share_audio: false, start_at: start, end_at: end, priority: 0, screen_ids: screenIds, screen_group_ids: [group],
      fallback: { preparation_id: preparation, source_fingerprint: 'b'.repeat(64), manifest } };
    const client = await pool.connect(); try { await client.query('BEGIN');
      await client.query(`INSERT INTO live_schedule_occurrences(id,schedule_id,schedule_item_id,reservation_token,schedule_revision,owner_user_id,live_session_id,presenter_user_id,policy_revision,preparation_id,
        approval_fingerprint,item_fingerprint,frozen_policy,screen_ids,capacity_slot,start_at,end_at,state,publish_id) VALUES($1,$2,$3,$4,1,$5,$6,$7,1,$8,$9,$10,$11,$12,1,$13,$14,'PUBLISHED',$15)`,
      [id, schedule, item, randomUUID(), manager.id, sourceId, presenter.id, preparation, 'c'.repeat(64), 'd'.repeat(64), policy, screenIds, start, end, publish]);
      await client.query(`INSERT INTO live_occurrence_assets(occurrence_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation) VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY')`, [id, asset, object, 'a'.repeat(64)]);
      await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return { id, screenIds, sourceId, publish, group };
  }
  async function run(data: Awaited<ReturnType<typeof seed>>, generation = 1, state = 'RUNNING', authorityEpoch = epoch) {
    const node = randomUUID(), id = randomUUID();
    await pool.query('INSERT INTO live_media_nodes(id,managed_instance_id,authority_epoch,endpoint_fingerprint) VALUES($1,$2,$3,$4)', [node, randomUUID(), authorityEpoch, 'e'.repeat(64)]);
    await pool.query(`INSERT INTO live_runs(id,occurrence_id,generation,authority_epoch,node_instance_id,runtime_slot,state,presenter_user_id,presenter_session_jti,presenter_runtime_session_id,teardown_confirmed_at)
      VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10)`, [id, data.id, generation, authorityEpoch, node, state, presenter.id, presenter.token, randomUUID(), state === 'STOPPED' ? new Date().toISOString() : null]);
    await pool.query(`INSERT INTO live_occurrence_controls(occurrence_id,generation,current_run_id) VALUES($1,$2,$3) ON CONFLICT(occurrence_id) DO UPDATE SET generation=$2,current_run_id=$3`, [data.id, generation, id]);
    return { id, generation };
  }
  async function admission(run: { id: string; generation: number }, screen: string, state = 'ACTIVE', createdAt = new Date()) {
    const id = randomUUID(), runtime = randomUUID();
    await pool.query(`INSERT INTO live_admissions(id,run_id,generation,role,participant_id,screen_id,certificate_serial,runtime_session_id,readiness,state,created_at,revoked_at,teardown_confirmed_at)
      VALUES($1,$2,$3,'receiver',$4,$5,'SYNTHETIC_PRIVATE_CERTIFICATE_SERIAL',$6,'{}',$7,$8,$9,$9)`,
    [id, run.id, run.generation, `receiver_${screen}_${runtime}`, screen, runtime, state, createdAt.toISOString(), state === 'REVOKED' ? new Date().toISOString() : null]);
    return { id, runtime };
  }
  async function observe(admission: { id: string; runtime: string }, change: { runtime?: string; age?: number; frame?: string; fallback?: boolean; reason?: string } = {}) {
    await pool.query(`INSERT INTO live_admission_observations(admission_id,runtime_session_id,sequence,connection,subscription,frame,audio,fallback_ready,fallback_reason,received_at)
      VALUES($1,$2,10,'CONNECTED','SUBSCRIBED',$3,'NONE',$4,$5,$6)`, [admission.id, change.runtime ?? admission.runtime, change.frame ?? 'NONE', change.fallback ?? true, change.reason ?? null, new Date(Date.now() - (change.age ?? 1000)).toISOString()]);
  }
  beforeAll(async () => {
    fixture.directory = await mkdtemp(path.join(tmpdir(), 'darshan-owned-target-reports-'));
    await writeFile(path.join(fixture.directory, 'authority.json'), JSON.stringify({ version: 1, epoch_id: epoch, authority_secret: randomBytes(32).toString('base64url') }), { mode: 0o600 });
    await writeFile(path.join(fixture.directory, 'control'), 'synthetic-never-network-control-secret-at-least32', { mode: 0o600 });
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only target fixture catalog'); const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname); expect(url.port).toBe('55455');
    source = new Pool({ connectionString: url.toString(), max: 1, options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000' });
    url.pathname = '/postgres'; adminPool = new Pool({ connectionString: url.toString(), max: 1 }); url.pathname = `/${database}`; assertDedicatedTestDatabase(url.toString());
    await adminPool.query(`CREATE DATABASE ${quote(database)}`); created = true;
    pool = new Pool({ connectionString: url.toString(), max: 5, options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=7000 -c lock_timeout=5000` });
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`); expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    const enums = await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const row of enums.rows) await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map((v: string) => `'${v.replace(/'/g, "''")}'`).join(',')})`);
    for (const table of ['roles', 'departments', 'users', 'sessions', 'user_additional_departments', 'storage_objects', 'media', 'presentations', 'presentation_items', 'presentation_slot_items', 'layouts', 'schedules', 'schedule_items', 'schedule_reservations', 'schedule_snapshots', 'publishes', 'screens', 'screen_groups', 'screen_group_members']) {
      const columns = await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
      expect(columns.rows.length).toBeGreaterThan(0); const excluded = table === 'schedule_items' ? new Set(['source_kind', 'live_session_id']) : new Set<string>();
      const definitions = columns.rows.filter(row => !excluded.has(row.attname)).map(row => { if (/\bnextval\s*\(/i.test(row.default_sql ?? '')) throw Error('Source sequences refused'); return `${quote(row.attname)} ${localize(row.type)}${row.attnotnull ? ' NOT NULL' : ''}${row.default_sql ? ` DEFAULT ${localize(row.default_sql)}` : ''}`; });
      const constraints = await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [table]);
      for (const row of constraints.rows) if (![...excluded].some(column => new RegExp(`\\b${column}\\b`).test(row.definition))) definitions.push(`CONSTRAINT ${quote(row.conname)} ${localize(row.definition)}`);
      await pool.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')})`);
    }
    await pool.query(`CREATE EXTENSION btree_gist WITH SCHEMA ${quote(namespace)}`);
    for (const migration of ['0057_live_broadcast_sessions.sql', '0058_live_scheduling.sql', '0060_live_runtime_authority.sql']) {
      const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(await readFile(new URL(`../../drizzle/migrations/${migration}`, import.meta.url), 'utf8')); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    fixture.db = drizzle(pool, { schema: tables }); await pool.query('INSERT INTO departments(id,name) VALUES($1,$2),($3,$4)', [departmentA, 'Synthetic A', departmentB, 'Synthetic B']);
    manager = await user('SYNTHETIC_TARGET_MANAGER', [{ action: 'manage', subject: 'LiveBroadcast', conditions: { created_by: '$user.id' } }], departmentA);
    presenter = await user('SYNTHETIC_TARGET_PRESENTER', presenterGrants, departmentA); foreign = await user('SYNTHETIC_TARGET_FOREIGN', presenterGrants, departmentB);
    server = Fastify({ logger: false }); server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(liveTargetReportRoutes); await server.ready();
  }, 30000);
  beforeEach(async () => { await pool.query('TRUNCATE live_schedule_occurrences CASCADE'); });
  afterAll(async () => { await server?.close(); await pool?.end(); await source?.end(); if (adminPool) { if (created) await adminPool.query(`DROP DATABASE ${quote(database)}`); await adminPool.end(); }
    if (fixture.directory) await rm(fixture.directory, { recursive: true, force: false }); }, 15000);

  it('returns exactly frozen audience despite group edits, masks names without Screen read and never infers frame from connection', async () => {
    const data = await seed(), active = await run(data), joined = await admission(active, data.screenIds[0]); await observe(joined);
    const outside = randomUUID(), outsider = await admission(active, outside); await observe(outsider, { frame: 'READY' }); await pool.query('DELETE FROM screen_group_members WHERE group_id=$1', [data.group]);
    const result = await invoke(presenter, data.id); expect(result.statusCode, result.body).toBe(200); expect(result.headers['cache-control']).toBe('no-store');
    expect(result.json().targets.map((row: { screen_id: string }) => row.screen_id)).toEqual(data.screenIds);
    expect(result.json().targets[0]).toMatchObject({ screen_name: null, freshness: 'FRESH', reason: null, report: { connection: 'CONNECTED', frame: 'NONE', audio: 'NONE' } });
    expect(result.json().targets[1]).toMatchObject({ freshness: 'UNKNOWN', reason: 'NO_ADMISSION', received_at: null, age_ms: null, report: null });
    expect(result.body).not.toContain('NEVER_RETURN_THIS'); expect(result.body).not.toContain('PRIVATE_CERTIFICATE'); expect(result.body).not.toContain(outside); expect(result.body).not.toContain('ticket');
  });
  it('requires current record-bound source/department and session authorization, not token-carried cached grants', async () => {
    const data = await seed(); expect((await invoke(foreign, data.id)).statusCode).toBe(403);
    const reader = await user(`READER_${randomUUID()}`, [{ action: 'read', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }], departmentA);
    expect((await invoke(reader, data.id)).statusCode).toBe(200); await pool.query(`UPDATE roles SET permissions='{}' WHERE id=$1`, [reader.roleId]); expect((await invoke(reader, data.id)).statusCode).toBe(403);
    await pool.query('DELETE FROM sessions WHERE access_jti=$1', [reader.token]); expect((await invoke(reader, data.id)).statusCode).toBe(401);
  });
  it('reveals each screen name only when current conditional Screen READ allows that actual record', async () => {
    const data = await seed(), reader = await user(`SCREEN_READER_${randomUUID()}`, [{ action: 'read', subject: 'LiveBroadcast' }, { action: 'read', subject: 'Screen', conditions: { id: data.screenIds[1] } }], departmentA);
    const response = await invoke(reader, data.id); expect(response.statusCode, response.body).toBe(200);
    expect(response.json().targets.map((row: { screen_name: string | null }) => row.screen_name)).toEqual([null, 'Synthetic secret screen 1', null]);
  });
  it('separates stale, never-reported and future-receipt uncertainty without clamping a future report fresh', async () => {
    const data = await seed(), active = await run(data);
    await observe(await admission(active, data.screenIds[0]), { age: 11000, frame: 'READY' }); await admission(active, data.screenIds[1]); await observe(await admission(active, data.screenIds[2]), { age: -20000 });
    const result = await invoke(presenter, data.id); expect(result.statusCode, result.body).toBe(200);
    expect(result.json().targets).toEqual(expect.arrayContaining([expect.objectContaining({ freshness: 'UNKNOWN', reason: 'STALE_REPORT', report: expect.objectContaining({ frame: 'READY' }) }),
      expect.objectContaining({ freshness: 'UNKNOWN', reason: 'NO_REPORT', received_at: null }), expect.objectContaining({ freshness: 'UNKNOWN', reason: 'CLOCK_UNCERTAIN', age_ms: null })]));
  });
  it('does not reuse an old run or replaced runtime report and retains revoked fallback failure only as historical facts', async () => {
    const data = await seed(), old = await run(data, 1, 'STOPPED'); await observe(await admission(old, data.screenIds[0]), { frame: 'READY' });
    const active = await run(data, 2), revoked = await admission(active, data.screenIds[0], 'REVOKED', new Date(Date.now() - 5000)); await observe(revoked, { frame: 'READY' });
    await admission(active, data.screenIds[0], 'PENDING'); const mismatch = await admission(active, data.screenIds[1]); await observe(mismatch, { runtime: randomUUID(), frame: 'READY' });
    await observe(await admission(active, data.screenIds[2], 'REVOKED'), { fallback: false, reason: 'https://private.example.test/object?ticket=must-not-return' });
    const result = await invoke(presenter, data.id); expect(result.statusCode, result.body).toBe(200); expect(result.json().run).toMatchObject(active);
    expect(result.json().targets[0]).toMatchObject({ freshness: 'UNKNOWN', reason: 'ADMISSION_PENDING', report: null });
    expect(result.json().targets[1]).toMatchObject({ freshness: 'UNKNOWN', reason: 'RUNTIME_MISMATCH', report: null, received_at: null });
    expect(result.json().targets[2]).toMatchObject({ freshness: 'UNKNOWN', reason: 'ADMISSION_REVOKED', report: { fallback_ready: false, fallback_reason: 'PLAYER_REASON_REDACTED' } });
    expect(result.body).not.toContain('private.example'); expect(result.body).not.toContain('must-not-return');
  });
  it('marks fresh-looking reports unknown when the publication or current authority/run no longer permits live use', async () => {
    const data = await seed(), active = await run(data, 1, 'RUNNING', randomUUID()); await observe(await admission(active, data.screenIds[0]));
    let response = await invoke(presenter, data.id); expect(response.json().targets[0]).toMatchObject({ freshness: 'UNKNOWN', reason: 'AUTHORITY_CHANGED' });
    await pool.query(`UPDATE publishes SET status='TAKEN_DOWN',taken_down_at=now() WHERE id=$1`, [data.publish]); response = await invoke(manager, data.id);
    expect(response.statusCode, response.body).toBe(200); expect(response.json().targets[0]).toMatchObject({ freshness: 'UNKNOWN', reason: 'PUBLICATION_INACTIVE' });
  });
});
