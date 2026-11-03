import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from '@/config';
import type { Database } from '@/db';
import * as tables from '@/db/schema';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { defineAbilityFor } from '@/rbac';
import type { MutationAuthorizationContext } from '@/auth/mutation-authorization';
import { lockScreenTargetReferences } from './screen-deletion-guard';
import { createScheduleReservationService } from './scheduling/reservation-service';
import { collectLiveFallbackPreparationSource, collectLiveFallbackSource, preloadLiveSchedulingHints, prepareLiveSchedule, reserveLiveSchedule,
  transitionLiveReservations, releaseLiveReservations, expireLiveHolds, type PreparedLiveSchedule } from './live-scheduling';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, deleteObject: vi.fn() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/s3', async () => ({ ...await vi.importActual('@/s3'), deleteObject: fixture.deleteObject }));

// Source access is read-only catalog access. Every write, extension and migration
// belongs to a newly created, random *_test database; public is never a fallback.
const baseTables = ['roles', 'departments', 'users', 'user_additional_departments',
  'storage_objects', 'media', 'presentations', 'presentation_items', 'presentation_slot_items',
  'layouts', 'screens', 'screen_groups', 'screen_group_members', 'schedules', 'schedule_items',
  'schedule_snapshots', 'publishes', 'schedule_requests', 'schedule_reservations', 'heartbeats', 'proof_of_play',
  'screenshots', 'request_attachments', 'audit_logs', 'system_logs', 'login_attempts', 'log_archives'];
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const localize = (value: string) => value.replace(/\bpublic\./g, '');
type OwnedDatabase = { name: string; namespace: string; pool: Pool; db: Database; close: () => Promise<void> };

describe('live scheduling on independently owned PostgreSQL databases', () => {
  let source: Pool, admin: Pool, owned: OwnedDatabase;
  const openDatabases = new Set<OwnedDatabase>();
  let migration57: string, migration58: string;
  let foundation: Awaited<ReturnType<typeof seedFoundation>>;
  let servicePreparation: string;
  let windowIndex = 0;
  const nextWindow = () => {
    const start = new Date(Date.UTC(2040, 0, 1 + windowIndex++, 10));
    return { start, end: new Date(start.getTime() + 3_600_000) };
  };

  async function copyEmptyBaseTables(pool: Pool) {
    const enums = await source.query(`SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels
      FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
      JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const row of enums.rows) await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map(literal).join(',')})`);
    for (const table of baseTables) {
      const columns = await source.query(`SELECT a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod) type,
        a.attnotnull, pg_catalog.pg_get_expr(d.adbin,d.adrelid) default_sql
        FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
      expect(columns.rows.length, `Missing source table definition: ${table}`).toBeGreaterThan(0);
      const excluded = table === 'schedule_items' ? new Set(['source_kind', 'live_session_id']) : new Set<string>();
      const definitions = columns.rows.filter(row => !excluded.has(row.attname)).map(row => {
        if (row.default_sql && /\bnextval\s*\(/i.test(row.default_sql)) throw new Error('Fixture refuses a source sequence default');
        return `${quote(row.attname)} ${localize(row.type)}${row.attnotnull ? ' NOT NULL' : ''}${row.default_sql ? ` DEFAULT ${localize(row.default_sql)}` : ''}`;
      });
      const constraints = await source.query(`SELECT con.conname, pg_catalog.pg_get_constraintdef(con.oid) definition
        FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [table]);
      for (const row of constraints.rows) {
        if ([...excluded].some(column => new RegExp(`\\b${column}\\b`).test(row.definition))) continue;
        definitions.push(`CONSTRAINT ${quote(row.conname)} ${localize(row.definition)}`);
      }
      await pool.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')})`);
    }
  }

  async function newDatabase(apply58 = true): Promise<OwnedDatabase> {
    const suffix = randomUUID().replace(/-/g, '');
    const name = `darshan_live_sched_${suffix}_test`;
    const namespace = `live_sched_${suffix}_test`;
    const url = new URL(config.DATABASE_URL); url.pathname = `/${name}`;
    assertDedicatedTestDatabase(url.toString(), 'Owned live scheduling database');
    await admin.query(`CREATE DATABASE ${quote(name)}`);
    const pool = new Pool({ connectionString: url.toString(), max: 6, application_name: namespace,
      options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=6000 -c lock_timeout=5000` });
    const handle: OwnedDatabase = { name, namespace, pool, db: drizzle(pool, { schema: tables }), close: async () => {
      if (!openDatabases.has(handle)) return;
      await pool.end();
      // Exact random database created above, after its pool is closed. No FORCE,
      // session termination, public cleanup or feature-database extension writes.
      await admin.query(`DROP DATABASE ${quote(name)}`);
      openDatabases.delete(handle);
    } };
    openDatabases.add(handle);
    try {
      await pool.query(`CREATE SCHEMA ${quote(namespace)}`);
      expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
      await copyEmptyBaseTables(pool);
      await pool.query(`CREATE EXTENSION btree_gist WITH SCHEMA ${quote(namespace)}`);
      await pool.query(migration57);
      if (apply58) await applyMigration58(pool);
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }

  async function applyMigration58(pool: Pool) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(migration58); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  beforeAll(async () => {
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only live scheduling fixture source');
    const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname);
    expect(url.port).toBe('55455');
    source = new Pool({ connectionString: config.DATABASE_URL, max: 1,
      options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=6000' });
    url.pathname = '/postgres';
    admin = new Pool({ connectionString: url.toString(), max: 1 });
    migration57 = await readFile(new URL('../../drizzle/migrations/0057_live_broadcast_sessions.sql', import.meta.url), 'utf8');
    migration58 = await readFile(new URL('../../drizzle/migrations/0058_live_scheduling.sql', import.meta.url), 'utf8');
    owned = await newDatabase();
    fixture.db = owned.db;
    foundation = await seedFoundation();
    servicePreparation = await seedServicePreparation();
  }, 30_000);

  afterAll(async () => {
    for (const database of [...openDatabases]) await database.close();
    await source?.end();
    await admin?.end();
  }, 15_000);

  async function insertLegacyReservation(pool: Pool, screenId: string, start = '2035-01-01T10:00:00Z', end = '2035-01-01T11:00:00Z') {
    const id = randomUUID();
    await pool.query(`INSERT INTO schedule_reservations(id,screen_id,schedule_id,schedule_item_id,owner_user_id,state,start_at,end_at,reservation_token)
      VALUES($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8)`, [id, screenId, randomUUID(), randomUUID(), randomUUID(), start, end, randomUUID()]);
    return id;
  }

  async function seedFoundation() {
    const owner = randomUUID(), presenter = randomUUID(), role = randomUUID(), live = randomUUID();
    const presentation = randomUUID(), media = randomUUID(), object = randomUUID(), preparation = randomUUID(), entry = randomUUID();
    await owned.pool.query(`INSERT INTO roles(id,name,permissions) VALUES($1,'SUPER_ADMIN','{"grants":[]}')`, [role]);
    for (const id of [owner, presenter]) await owned.pool.query('INSERT INTO users(id,email,password_hash,role_id) VALUES($1,$2,$3,$4)',
      [id, `${id}@example.test`, 'synthetic-unused-password-hash', role]);
    await owned.pool.query('INSERT INTO live_sessions(id,name,presenter_user_id,created_by) VALUES($1,$2,$3,$4)', [live, 'Synthetic live source', presenter, owner]);
    await owned.pool.query(`INSERT INTO storage_objects(id,bucket,object_key,content_type,size,sha256) VALUES($1,$2,$3,'image/png',64,$4)`,
      [object, 'synthetic-live-test', `${object}.png`, 'a'.repeat(64)]);
    await owned.pool.query(`INSERT INTO media(id,name,type,status,created_by,ready_object_id,source_object_id) VALUES($1,$2,'IMAGE','READY',$3,$4,$4)`, [media, 'Synthetic fallback', owner, object]);
    await owned.pool.query('INSERT INTO presentations(id,name,created_by) VALUES($1,$2,$3)', [presentation, 'Synthetic fallback presentation', owner]);
    await owned.pool.query('INSERT INTO presentation_items(id,presentation_id,media_id,"order",duration_seconds) VALUES($1,$2,$3,0,15)', [entry, presentation, media]);
    const asset = { id: media, media_id: media, storage_object_id: object, bucket: 'synthetic-live-test', object_key: `${object}.png`,
      sha256: 'a'.repeat(64), size: 64, content_type: 'image/png', render_type: 'image', representation: 'READY_OBJECT',
      dependencies: [] as string[], cache_key: `live_${'a'.repeat(64)}_image` };
    const manifest = { version: 1, presentation: { id: presentation, items: [{ id: entry, order: 0, asset_id: media, duration_seconds: 15 }] }, assets: [asset] };
    await owned.pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph) VALUES($1,$2,$3,$4,$5)`,
      [preparation, presentation, owner, 'a'.repeat(64), { purpose: 'Synthetic database constraint fixture' }]);
    await owned.pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation)
      VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY_OBJECT')`, [preparation, media, object, 'a'.repeat(64)]);
    await owned.pool.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`, [preparation, manifest]);
    return { owner, presenter, role, live, presentation, media, object, preparation, entry, manifest };
  }

  async function insertOccurrence(input: { slot: number; start: Date; end: Date; audience?: Array<string | null>; copyAssets?: boolean;
    preparationId?: string; beforeCommit?: () => Promise<void> }) {
    const id = randomUUID(), client = await owned.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO live_schedule_occurrences(id,schedule_id,schedule_item_id,reservation_token,schedule_revision,
        owner_user_id,live_session_id,presenter_user_id,policy_revision,preparation_id,approval_fingerprint,item_fingerprint,
        frozen_policy,screen_ids,capacity_slot,start_at,end_at,state,publish_id)
        VALUES($1,$2,$3,$4,1,$5,$6,$7,1,$8,$9,$9,$10,$11,$12,$13,$14,'PUBLISHED',$15)`,
      [id, randomUUID(), randomUUID(), randomUUID(), foundation.owner, foundation.live, foundation.presenter,
        input.preparationId ?? foundation.preparation, 'b'.repeat(64), { purpose: 'Synthetic database constraint fixture' }, input.audience ?? [randomUUID()], input.slot, input.start, input.end, randomUUID()]);
      if (input.copyAssets !== false) await client.query(`INSERT INTO live_occurrence_assets(occurrence_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,
        source_type,status,representation,dependencies,source_object_id,source_sha256,source_content_type)
        SELECT $1,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,status,representation,
        dependencies,source_object_id,source_sha256,source_content_type FROM live_fallback_preparation_assets WHERE preparation_id=$2`, [id, input.preparationId ?? foundation.preparation]);
      await input.beforeCommit?.();
      await client.query('COMMIT');
      return id;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function waitForOwnedLock() {
    const deadline = Date.now() + 2000;
    do {
      const result = await owned.pool.query(`SELECT count(*)::int n FROM pg_stat_activity
        WHERE application_name=$1 AND datname=$2 AND wait_event_type='Lock'`, [owned.namespace, owned.name]);
      if (result.rows[0].n > 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Expected a real lock wait in this test-owned database');
  }

  async function withContext<T>(run: (context: MutationAuthorizationContext) => Promise<T>) {
    return owned.db.transaction(async executor => {
      await executor.select().from(tables.roles).orderBy(asc(tables.roles.id)).for('share');
      await executor.select().from(tables.users).where(inArray(tables.users.id, [foundation.owner, foundation.presenter]))
        .orderBy(asc(tables.users.id)).for('share');
      const ability = await defineAbilityFor(foundation.role, foundation.owner);
      return run({ actor: { userId: foundation.owner, roleName: 'SUPER_ADMIN', departmentId: null, departmentIds: [] }, ability, executor });
    });
  }

  async function seedServicePreparation() {
    const source = await withContext(context => collectLiveFallbackSource(context, foundation.presentation));
    const id = randomUUID(), object = randomUUID(), key = `live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`;
    await owned.pool.query(`INSERT INTO storage_objects(id,bucket,object_key,content_type,size,sha256) VALUES($1,$2,$3,'image/png',64,$4)`,
      [object, 'synthetic-prepared-fallbacks', key, 'a'.repeat(64)]);
    const asset = { id: foundation.media, media_id: foundation.media, storage_object_id: object, bucket: 'synthetic-prepared-fallbacks',
      object_key: key, sha256: 'a'.repeat(64), size: 64, content_type: 'image/png', render_type: 'image', representation: 'READY', dependencies: [],
      cache_key: `live_${'a'.repeat(64)}_image` };
    const manifest = { version: 1, presentation: { id: foundation.presentation, layout: null,
      items: source.source_graph.presentation.items.map(({ media_id, ...entry }) => ({ ...entry, asset_id: media_id })) }, assets: [asset] };
    await owned.pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph) VALUES($1,$2,$3,$4,$5)`,
      [id, foundation.presentation, foundation.owner, source.source_fingerprint, source.source_graph]);
    await owned.pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,
      render_type,source_type,representation,source_object_id,source_sha256,source_content_type)
      VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY',$5,$4,'image/png')`, [id, foundation.media, object, 'a'.repeat(64), foundation.object]);
    await owned.pool.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`, [id, manifest]);
    return id;
  }

  async function serviceSchedule(input: { count?: number; screens?: string[]; groups?: string[]; start?: Date; end?: Date; capable?: boolean } = {}) {
    const window = input.start ? { start: input.start, end: input.end! } : nextWindow();
    const scheduleId = randomUUID(), itemId = randomUUID();
    const screens = input.screens ?? Array.from({ length: input.count ?? 1 }, () => randomUUID());
    if (!input.screens) for (const id of screens) await owned.pool.query('INSERT INTO screens(id,name,device_info) VALUES($1,$2,$3)',
      [id, 'Synthetic capable screen', { player_capabilities: { features: input.capable === false ? [] : ['live_broadcast_v1'] } }]);
    await owned.pool.query('INSERT INTO schedules(id,name,start_at,end_at,created_by) VALUES($1,$2,$3,$4,$5)',
      [scheduleId, 'Synthetic live service schedule', window.start, window.end, foundation.owner]);
    await owned.pool.query(`INSERT INTO schedule_items(id,schedule_id,presentation_id,source_kind,live_session_id,start_at,end_at,screen_ids,screen_group_ids)
      VALUES($1,$2,$3,'LIVE',$4,$5,$6,$7,$8)`, [itemId, scheduleId, foundation.presentation, foundation.live,
      window.start, window.end, JSON.stringify(screens), JSON.stringify(input.groups ?? [])]);
    return { scheduleId, itemId, screens, ...window };
  }

  type ServiceSchedule = Awaited<ReturnType<typeof serviceSchedule>>;
  async function prepare(context: MutationAuthorizationContext, schedule: ServiceSchedule,
    hints?: Awaited<ReturnType<typeof preloadLiveSchedulingHints>>, preparationIds = { [foundation.presentation]: servicePreparation },
    scope: { explicitScreenIds?: string[]; explicitScreenGroupIds?: string[] } = {}) {
    return prepareLiveSchedule(context, { scheduleId: schedule.scheduleId,
      identityHints: hints ?? await preloadLiveSchedulingHints(schedule.scheduleId, context.executor), fallbackPreparationIds: preparationIds, ...scope });
  }
  async function reserve(schedule: ServiceSchedule, input: { state?: 'HELD' | 'PUBLISHED'; token?: string;
    tamper?: (prepared: PreparedLiveSchedule) => void; screenRowOverride?: string[] } = {}) {
    const token = input.token ?? randomUUID(), state = input.state ?? 'PUBLISHED', publishId = randomUUID(), requestId = randomUUID();
    const holdExpiresAt = new Date(Date.now() + 120_000);
    return withContext(async context => {
      await lockScreenTargetReferences(context.executor);
      await context.executor.select().from(tables.schedules).where(eq(tables.schedules.id, schedule.scheduleId)).for('update');
      const prepared = await prepare(context, schedule);
      if (state === 'HELD') await context.executor.insert(tables.scheduleRequests).values({ id: requestId, schedule_id: schedule.scheduleId,
        schedule_payload: {}, requested_by: foundation.owner, reservation_token: token, reservation_version: prepared.schedule_revision,
        reservation_state: 'HELD', hold_expires_at: holdExpiresAt });
      else await context.executor.insert(tables.publishes).values({ id: publishId, schedule_id: schedule.scheduleId, snapshot_id: randomUUID(), published_by: foundation.owner });
      const rows = prepared.items.flatMap(({ policy }) => (input.screenRowOverride ?? policy.screen_ids).map(screenId => ({
        screen_id: screenId, schedule_id: schedule.scheduleId, schedule_item_id: policy.schedule_item_id, schedule_request_id: state === 'HELD' ? requestId : null,
        owner_user_id: foundation.owner, state, start_at: new Date(policy.start_at), end_at: new Date(policy.end_at),
        hold_expires_at: state === 'HELD' ? holdExpiresAt : null, reservation_token: token, publish_id: state === 'PUBLISHED' ? publishId : null,
      })));
      await context.executor.insert(tables.scheduleReservations).values(rows);
      input.tamper?.(prepared);
      const occurrences = await reserveLiveSchedule(context, { prepared, reservationToken: token, state,
        ...(state === 'HELD' ? { scheduleRequestId: requestId, holdExpiresAt } : { publishId }) });
      return { token, publishId, requestId, holdExpiresAt, prepared, occurrences };
    });
  }

  it('repairs a missing ordinary-screen exclusion constraint and preserves half-open boundaries', async () => {
    const screen = randomUUID();
    const first = await insertLegacyReservation(owned.pool, screen);
    await expect(insertLegacyReservation(owned.pool, screen)).rejects.toMatchObject({ code: '23P01' });
    await insertLegacyReservation(owned.pool, screen, '2035-01-01T11:00:00Z', '2035-01-01T12:00:00Z');
    expect((await owned.pool.query('SELECT id FROM schedule_reservations WHERE screen_id=$1 ORDER BY start_at', [screen])).rows[0].id).toBe(first);
    expect((await owned.pool.query('SELECT count(*)::int n FROM schedule_reservations WHERE screen_id=$1', [screen])).rows[0].n).toBe(2);
  });

  it('aborts an unsafe legacy overlap migration without deleting or modifying existing rows', async () => {
    const legacy = await newDatabase(false);
    try {
      const screen = randomUUID();
      await insertLegacyReservation(legacy.pool, screen);
      await insertLegacyReservation(legacy.pool, screen);
      const before = (await legacy.pool.query('SELECT * FROM schedule_reservations ORDER BY id')).rows;
      await expect(applyMigration58(legacy.pool)).rejects.toMatchObject({ code: '23P01' });
      expect((await legacy.pool.query('SELECT * FROM schedule_reservations ORDER BY id')).rows).toEqual(before);
      expect(before).toHaveLength(2);
    } finally { await legacy.close(); }
  });

  it('enforces ten physical GiST capacity slots and permits adjacent half-open windows', async () => {
    const window = nextWindow();
    for (let slot = 1; slot <= 10; slot++) await insertOccurrence({ ...window, slot });
    await expect(insertOccurrence({ ...window, slot: 1 })).rejects.toMatchObject({ code: '23P01' });
    await expect(insertOccurrence({ ...window, slot: 11 })).rejects.toMatchObject({ code: '23514' });
    await insertOccurrence({ slot: 1, start: window.end, end: new Date(window.end.getTime() + 3_600_000) });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE start_at=$1', [window.start])).rows[0].n).toBe(10);
  });

  it('accepts 25 distinct targets and rejects 26, duplicate, empty and null audiences', async () => {
    const window = nextWindow();
    await insertOccurrence({ ...window, slot: 1, audience: Array.from({ length: 25 }, () => randomUUID()) });
    const repeated = randomUUID();
    for (const audience of [Array.from({ length: 26 }, () => randomUUID()), [repeated, repeated], [], [null]]) {
      await expect(insertOccurrence({ ...window, slot: 2, audience })).rejects.toMatchObject({ code: '23514' });
    }
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE start_at=$1', [window.start])).rows[0].n).toBe(1);
  });

  it('freezes occurrence policy, targets, provenance and publish identity while allowing a safe slot move', async () => {
    const id = await insertOccurrence({ ...nextWindow(), slot: 1 });
    const before = (await owned.pool.query('SELECT * FROM live_schedule_occurrences WHERE id=$1', [id])).rows[0];
    for (const [set, value] of [['frozen_policy=$2', { forged: true }], ['screen_ids=$2', [randomUUID()]],
      ['schedule_revision=$2', 2], ['publish_id=$2', randomUUID()], ['preparation_id=$2', randomUUID()]]) {
      await expect(owned.pool.query(`UPDATE live_schedule_occurrences SET ${set} WHERE id=$1`, [id, value])).rejects.toMatchObject({ code: '23514' });
    }
    await expect(owned.pool.query('DELETE FROM live_schedule_occurrences WHERE id=$1', [id])).rejects.toMatchObject({ code: '23514' });
    expect((await owned.pool.query('SELECT * FROM live_schedule_occurrences WHERE id=$1', [id])).rows[0]).toEqual(before);
    await owned.pool.query('UPDATE live_schedule_occurrences SET capacity_slot=2 WHERE id=$1', [id]);
    expect((await owned.pool.query('SELECT capacity_slot,frozen_policy FROM live_schedule_occurrences WHERE id=$1', [id])).rows[0]).toEqual({ capacity_slot: 2, frozen_policy: before.frozen_policy });
  });

  it('rejects directly READY preparations and freezes every mutation of their sealed assets', async () => {
    const preparation = foundation.preparation;
    await expect(owned.pool.query(`INSERT INTO live_fallback_preparations(presentation_id,created_by,state,source_fingerprint,source_graph,manifest)
      VALUES($1,$2,'READY',$3,'{}',$4)`, [foundation.presentation, foundation.owner, 'c'.repeat(64), foundation.manifest])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query(`UPDATE live_fallback_preparation_assets SET sha256=$2 WHERE preparation_id=$1`, [preparation, 'c'.repeat(64)])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query('DELETE FROM live_fallback_preparation_assets WHERE preparation_id=$1', [preparation])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query(`INSERT INTO live_fallback_preparation_assets SELECT preparation_id,$2,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,status,representation,dependencies,source_object_id,source_sha256,source_content_type
      FROM live_fallback_preparation_assets WHERE preparation_id=$1`, [preparation, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query(`UPDATE live_fallback_preparations SET state='PROCESSING' WHERE id=$1`, [preparation])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query(`UPDATE live_fallback_preparations SET manifest=$2 WHERE id=$1`, [preparation, { assets: [] }])).rejects.toMatchObject({ code: '23514' });
    expect((await owned.pool.query('SELECT state,manifest FROM live_fallback_preparations WHERE id=$1', [preparation])).rows[0]).toEqual({ state: 'READY', manifest: foundation.manifest });
  });

  it('requires the complete approved asset graph at commit and rejects late occurrence graph changes', async () => {
    const window = nextWindow();
    await expect(insertOccurrence({ ...window, slot: 1, copyAssets: false })).rejects.toMatchObject({ code: '23514' });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE start_at=$1', [window.start])).rows[0].n).toBe(0);
    const id = await insertOccurrence({ ...window, slot: 1 });
    await expect(owned.pool.query('UPDATE live_occurrence_assets SET size=size+1 WHERE occurrence_id=$1', [id])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query('DELETE FROM live_occurrence_assets WHERE occurrence_id=$1', [id])).rejects.toMatchObject({ code: '23514' });
    await expect(owned.pool.query(`INSERT INTO live_occurrence_assets SELECT occurrence_id,$2,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,status,representation,dependencies,source_object_id,source_sha256,source_content_type
      FROM live_occurrence_assets WHERE occurrence_id=$1`, [id, randomUUID()])).rejects.toMatchObject({ code: '23514' });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_occurrence_assets WHERE occurrence_id=$1', [id])).rows[0].n).toBe(1);
  });

  it('serializes READY sealing against an already in-flight asset append', async () => {
    const preparation = randomUUID();
    await owned.pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph)
      VALUES($1,$2,$3,$4,'{}')`, [preparation, foundation.presentation, foundation.owner, 'd'.repeat(64)]);
    await owned.pool.query(`INSERT INTO live_fallback_preparation_assets SELECT $1,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,
      source_type,status,representation,dependencies,source_object_id,source_sha256,source_content_type
      FROM live_fallback_preparation_assets WHERE preparation_id=$2`, [preparation, foundation.preparation]);
    const sealing = await owned.pool.connect();
    let append: Promise<unknown> | undefined;
    let appendSettled: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await sealing.query('BEGIN');
      await sealing.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`, [preparation, foundation.manifest]);
      append = owned.pool.query(`INSERT INTO live_fallback_preparation_assets SELECT $1,$3,media_id,storage_object_id,sha256,size,content_type,render_type,
        source_type,status,representation,dependencies,source_object_id,source_sha256,source_content_type
        FROM live_fallback_preparation_assets WHERE preparation_id=$2`, [preparation, foundation.preparation, randomUUID()]);
      // Attach rejection handling before intentionally waiting for PostgreSQL.
      appendSettled = Promise.allSettled([append]);
      await waitForOwnedLock();
      await sealing.query('COMMIT');
      const [result] = await appendSettled;
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: '23514' });
    } finally {
      await sealing.query('ROLLBACK'); sealing.release();
      if (appendSettled) await appendSettled;
    }
    expect((await owned.pool.query('SELECT state FROM live_fallback_preparations WHERE id=$1', [preparation])).rows[0].state).toBe('READY');
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_fallback_preparation_assets WHERE preparation_id=$1', [preparation])).rows[0].n).toBe(1);
  });

  it('lets only one concurrent transaction commit an overlapping physical slot', async () => {
    const window = nextWindow();
    let acquired!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const first = insertOccurrence({ ...window, slot: 1, beforeCommit: async () => { acquired(); await barrier; } });
    const firstSettled = Promise.allSettled([first]);
    await Promise.race([ready, first.then(() => { throw new Error('Occurrence committed before its barrier'); })]);
    const second = insertOccurrence({ ...window, slot: 1 });
    const secondSettled = Promise.allSettled([second]);
    try {
      await waitForOwnedLock();
      release();
      expect((await firstSettled)[0].status).toBe('fulfilled');
      const loser = (await secondSettled)[0];
      expect(loser.status).toBe('rejected');
      if (loser.status === 'rejected') expect(loser.reason).toMatchObject({ code: '23P01' });
    } finally { release(); await Promise.all([firstSettled, secondSettled]); }
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE start_at=$1', [window.start])).rows[0].n).toBe(1);
  });

  it('prepares a verified CAS fallback, de-duplicates 25 targets and rejects 26 or unsupported players', async () => {
    const accepted = await serviceSchedule({ count: 25 });
    await owned.pool.query('UPDATE schedule_items SET screen_ids=$2 WHERE id=$1', [accepted.itemId, JSON.stringify([...accepted.screens, accepted.screens[0]])]);
    const result = await reserve(accepted);
    expect(result.occurrences[0].screen_ids).toEqual([...accepted.screens].sort());
    expect(result.occurrences[0].frozen_policy).toMatchObject({ source_kind: 'LIVE', fallback: { preparation_id: servicePreparation } });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_occurrence_assets WHERE occurrence_id=$1', [result.occurrences[0].id])).rows[0].n).toBe(1);
    const tooMany = await serviceSchedule({ count: 26 });
    await expect(reserve(tooMany)).rejects.toMatchObject({ code: 'LIVE_AUDIENCE_LIMIT', statusCode: 422 });
    expect((await owned.pool.query('SELECT count(*)::int n FROM schedule_reservations WHERE schedule_id=$1', [tooMany.scheduleId])).rows[0].n).toBe(0);
    const unsupported = await serviceSchedule({ capable: false });
    await expect(reserve(unsupported)).rejects.toMatchObject({ code: 'LIVE_PLAYER_UNSUPPORTED', statusCode: 422 });
  });

  it('recolors fragmented disjoint bookings instead of falsely reporting full capacity', async () => {
    const base = nextWindow().start;
    const oldIds: string[] = [];
    for (let index = 0; index < 10; index++) oldIds.push(await insertOccurrence({ slot: index + 1,
      start: new Date(base.getTime() + index * 120_000), end: new Date(base.getTime() + index * 120_000 + 60_000) }));
    const spanning = await serviceSchedule({ start: base, end: new Date(base.getTime() + 20 * 60_000) });
    const result = await reserve(spanning);
    const slots = (await owned.pool.query('SELECT capacity_slot FROM live_schedule_occurrences WHERE id=ANY($1::uuid[])',
      [[...oldIds, result.occurrences[0].id]])).rows.map(row => row.capacity_slot);
    expect(slots).toHaveLength(11); expect(Math.max(...slots)).toBeLessThanOrEqual(2);
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE id=ANY($1::uuid[])', [oldIds])).rows[0].n).toBe(10);
  });

  it('admits only the tenth of two concurrent requests and rolls the loser screen/publication writes back', async () => {
    const window = nextWindow();
    for (let index = 0; index < 9; index++) await reserve(await serviceSchedule(window));
    const candidates = await Promise.all([serviceSchedule(window), serviceSchedule(window)]);
    const results = await Promise.allSettled(candidates.map(schedule => reserve(schedule)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const loserIndex = results.findIndex(result => result.status === 'rejected');
    const loser = results[loserIndex];
    if (loser.status === 'rejected') expect(loser.reason).toMatchObject({ code: 'LIVE_CAPACITY_EXCEEDED', statusCode: 409 });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE start_at=$1', [window.start])).rows[0].n).toBe(10);
    expect((await owned.pool.query('SELECT count(*)::int n FROM schedule_reservations WHERE schedule_id=$1', [candidates[loserIndex].scheduleId])).rows[0].n).toBe(0);
    expect((await owned.pool.query('SELECT count(*)::int n FROM publishes WHERE schedule_id=$1', [candidates[loserIndex].scheduleId])).rows[0].n).toBe(0);
  });

  it('rejects same-count screen mismatches and tampered/serialized prepared authority unchanged', async () => {
    const mismatch = await serviceSchedule();
    await expect(reserve(mismatch, { screenRowOverride: [randomUUID()] })).rejects.toMatchObject({ code: 'LIVE_RESERVATION_MISMATCH' });
    const tampered = await serviceSchedule();
    await expect(reserve(tampered, { tamper: prepared => { prepared.items[0].policy.microphone = !prepared.items[0].policy.microphone; } }))
      .rejects.toMatchObject({ code: 'LIVE_APPROVAL_STALE' });
    const prepared = await withContext(context => prepare(context, tampered));
    await expect(withContext(context => reserveLiveSchedule(context, { prepared: JSON.parse(JSON.stringify(prepared)),
      reservationToken: randomUUID(), state: 'PUBLISHED', publishId: randomUUID() }))).rejects.toMatchObject({ code: 'LIVE_APPROVAL_STALE' });
    for (const schedule of [mismatch, tampered]) {
      expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE schedule_id=$1', [schedule.scheduleId])).rows[0].n).toBe(0);
      expect((await owned.pool.query('SELECT count(*)::int n FROM schedule_reservations WHERE schedule_id=$1', [schedule.scheduleId])).rows[0].n).toBe(0);
    }
  });

  it('rejects stale schedule/presenter hints, missing preparation and changed fallback source', async () => {
    const schedule = await serviceSchedule();
    const hints = await preloadLiveSchedulingHints(schedule.scheduleId, owned.db);
    await owned.pool.query('UPDATE schedules SET revision=revision+1 WHERE id=$1', [schedule.scheduleId]);
    await expect(withContext(context => prepare(context, schedule, hints))).rejects.toMatchObject({ code: 'LIVE_AUTHORIZATION_RETRY' });
    await expect(withContext(context => prepare(context, schedule, undefined, {}))).rejects.toMatchObject({ code: 'LIVE_FALLBACK_PREPARING' });
    const freshHints = await preloadLiveSchedulingHints(schedule.scheduleId, owned.db);
    try {
      await owned.pool.query('UPDATE live_sessions SET revision=revision+1,policy_revision=policy_revision+1,microphone=true WHERE id=$1', [foundation.live]);
      await expect(withContext(context => prepare(context, schedule, freshHints))).rejects.toMatchObject({ code: 'LIVE_AUTHORIZATION_RETRY' });
    } finally { await owned.pool.query('UPDATE live_sessions SET revision=revision+1,policy_revision=policy_revision+1,microphone=false WHERE id=$1', [foundation.live]); }
    try {
      await owned.pool.query('UPDATE presentation_items SET duration_seconds=duration_seconds+1 WHERE id=$1', [foundation.entry]);
      await expect(reserve(schedule)).rejects.toMatchObject({ code: 'LIVE_APPROVAL_STALE' });
    } finally { await owned.pool.query('UPDATE presentation_items SET duration_seconds=15 WHERE id=$1', [foundation.entry]); }
  });

  it('freezes group audience and rejects equal-size membership replacement before approval', async () => {
    const screens = (await serviceSchedule({ count: 2 })).screens;
    const group = randomUUID();
    await owned.pool.query('INSERT INTO screen_groups(id,name) VALUES($1,$2)', [group, 'Synthetic frozen audience']);
    await owned.pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)', [group, screens[0]]);
    const schedule = await serviceSchedule({ screens: [], groups: [group] });
    const held = await reserve(schedule, { state: 'HELD' });
    const before = (await owned.pool.query('SELECT frozen_policy,screen_ids,state FROM live_schedule_occurrences WHERE id=$1', [held.occurrences[0].id])).rows[0];
    await owned.pool.query('UPDATE screen_group_members SET screen_id=$2 WHERE group_id=$1', [group, screens[1]]);
    await expect(withContext(async context => {
      const prepared = await prepare(context, schedule);
      return transitionLiveReservations(context.executor, { prepared, reservationToken: held.token,
        expectedFingerprint: held.prepared.fingerprint, nextState: 'RESERVED' });
    })).rejects.toMatchObject({ code: 'LIVE_APPROVAL_STALE' });
    expect((await owned.pool.query('SELECT frozen_policy,screen_ids,state FROM live_schedule_occurrences WHERE id=$1', [held.occurrences[0].id])).rows[0]).toEqual(before);
    expect(before.screen_ids).toEqual([screens[0]]);
  });

  it('promotes an unchanged hold through publication idempotently and retains policy after explicit release', async () => {
    const schedule = await serviceSchedule(), held = await reserve(schedule, { state: 'HELD' });
    const before = held.occurrences[0].frozen_policy;
    const promote = (state: 'RESERVED' | 'PUBLISHED', publishId?: string) => withContext(async context => {
      const prepared = await prepare(context, schedule);
      await context.executor.update(tables.scheduleReservations).set({ state, hold_expires_at: null,
        ...(publishId ? { publish_id: publishId } : {}) }).where(eq(tables.scheduleReservations.reservation_token, held.token));
      return transitionLiveReservations(context.executor, { prepared, reservationToken: held.token,
        expectedFingerprint: held.prepared.fingerprint, nextState: state, publishId });
    });
    expect((await promote('RESERVED'))[0].state).toBe('RESERVED');
    expect((await promote('RESERVED'))[0].state).toBe('RESERVED');
    const publish = randomUUID();
    await owned.pool.query('INSERT INTO publishes(id,schedule_id,snapshot_id,published_by) VALUES($1,$2,$3,$4)', [publish, schedule.scheduleId, randomUUID(), foundation.owner]);
    expect((await promote('PUBLISHED', publish))[0]).toMatchObject({ state: 'PUBLISHED', publish_id: publish });
    expect((await promote('PUBLISHED', publish))[0]).toMatchObject({ state: 'PUBLISHED', publish_id: publish });
    const released = await owned.db.transaction(tx => releaseLiveReservations(tx, { publishId: publish, nextState: 'RELEASED', reason: 'synthetic-admin-stop' }));
    expect(released[0].frozen_policy).toEqual(before); expect(released[0].state).toBe('RELEASED');
    expect(await owned.db.transaction(tx => releaseLiveReservations(tx, { publishId: publish, nextState: 'RELEASED', reason: 'retry' }))).toEqual([]);
    await expect(owned.db.transaction(tx => releaseLiveReservations(tx, { publishId: publish, reservationToken: held.token,
      nextState: 'RELEASED', reason: 'ambiguous' }))).rejects.toMatchObject({ code: 'LIVE_RELEASE_SELECTOR_REQUIRED' });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_occurrence_assets WHERE occurrence_id=$1', [held.occurrences[0].id])).rows[0].n).toBe(1);
  });

  it('expires scheduled holds while preserving immutable evidence and never pretending to stop a runtime room', async () => {
    const held = await reserve(await serviceSchedule(), { state: 'HELD' });
    const policy = held.occurrences[0].frozen_policy;
    await owned.db.transaction(tx => expireLiveHolds(tx, new Date(held.holdExpiresAt.getTime() + 1)));
    const row = (await owned.pool.query('SELECT * FROM live_schedule_occurrences WHERE id=$1', [held.occurrences[0].id])).rows[0];
    expect(row).toMatchObject({ state: 'EXPIRED', hold_expires_at: null, frozen_policy: policy });
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_occurrence_assets WHERE occurrence_id=$1', [row.id])).rows[0].n).toBe(1);
    // Ordinary reservations and live runtime authority belong to other owners.
    expect((await owned.pool.query('SELECT state FROM schedule_reservations WHERE reservation_token=$1', [held.token])).rows[0].state).toBe('HELD');
  });

  it('retains CAS orphans and normalized preparation/occurrence objects while pruning an old ordinary orphan', async () => {
    const { cleanupOrphanedStorageObjects } = await import('@/jobs');
    const cas = randomUUID(), normalized = randomUUID(), ordinary = randomUUID(), prep = randomUUID(), asset = randomUUID();
    for (const [id, key] of [[cas, `live-fallbacks/v1/sha256/${'e'.repeat(64)}.png`], [normalized, 'ordinary-but-pinned.png'], [ordinary, 'ordinary-unreferenced.png']]) {
      await owned.pool.query(`INSERT INTO storage_objects(id,bucket,object_key,content_type,size,sha256,created_at) VALUES($1,$2,$3,'image/png',64,$4,'2000-01-01')`,
        [id, 'synthetic-orphan-test', key, 'e'.repeat(64)]);
    }
    await owned.pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph)
      VALUES($1,$2,$3,$4,'{}')`, [prep, foundation.presentation, foundation.owner, 'e'.repeat(64)]);
    await owned.pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation)
      VALUES($1,$2,$3,$4,$5,64,'image/png','image','IMAGE','READY')`, [prep, asset, foundation.media, normalized, 'e'.repeat(64)]);
    await owned.pool.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`, [prep, { assets: [{ id: asset }] }]);
    const occurrence = await insertOccurrence({ ...nextWindow(), slot: 1, preparationId: prep });
    expect((await owned.pool.query('SELECT storage_object_id FROM live_occurrence_assets WHERE occurrence_id=$1', [occurrence])).rows[0].storage_object_id).toBe(normalized);
    fixture.deleteObject.mockReset(); fixture.deleteObject.mockResolvedValue(undefined);
    expect(await cleanupOrphanedStorageObjects({ storageObjectIds: [cas, normalized, ordinary], now: () => new Date('2050-01-01'), minimumAgeMs: 0 })).toEqual({ cleaned: 1, pending: 0 });
    expect(fixture.deleteObject.mock.calls).toEqual([['synthetic-orphan-test', 'ordinary-unreferenced.png']]);
    expect((await owned.pool.query('SELECT id FROM storage_objects WHERE id=ANY($1::uuid[]) ORDER BY id', [[cas, normalized, ordinary]])).rows.map(row => row.id)).toEqual([cas, normalized].sort());
    // Complete unreferenced CAS objects are deliberately retained for a future,
    // explicit maintenance policy; this test does not claim bounded storage.
  });

  it('intersects LIVE direct/group audiences with explicit publish scope and never widens an empty group scope', async () => {
    const data = await serviceSchedule({ count: 3 }), outsider = (await serviceSchedule()).screens[0];
    const group = randomUUID(), emptyGroup = randomUUID(), authoredGroup = randomUUID();
    for (const id of [group, emptyGroup, authoredGroup]) await owned.pool.query('INSERT INTO screen_groups(id,name) VALUES($1,$2)', [id, 'Synthetic explicit scope']);
    for (const screen of [data.screens[0], outsider]) await owned.pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)', [group, screen]);
    for (const screen of data.screens.slice(0, 2)) await owned.pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)', [authoredGroup, screen]);
    const direct = await withContext(context => prepare(context, data, undefined, undefined, { explicitScreenIds: data.screens.slice(1) }));
    expect(direct.items[0].policy.screen_ids).toEqual(data.screens.slice(1).sort());
    const scopedGroup = await withContext(context => prepare(context, data, undefined, undefined, { explicitScreenGroupIds: [group] }));
    expect(scopedGroup.items[0].policy.screen_ids).toEqual([data.screens[0]]);
    const grouped = await serviceSchedule({ screens: [], groups: [authoredGroup] });
    const scopedDirect = await withContext(context => prepare(context, grouped, undefined, undefined, { explicitScreenIds: [data.screens[1]] }));
    expect(scopedDirect.items[0].policy.screen_ids).toEqual([data.screens[1]]);
    await expect(withContext(context => prepare(context, data, undefined, undefined, { explicitScreenIds: [outsider] })))
      .rejects.toMatchObject({ code: 'LIVE_AUDIENCE_LIMIT' });
    await expect(withContext(context => prepare(context, data, undefined, undefined, { explicitScreenGroupIds: [emptyGroup] })))
      .rejects.toMatchObject({ code: 'LIVE_AUDIENCE_LIMIT' });
    const ordinary = await serviceSchedule({ count: 2 });
    await owned.pool.query(`UPDATE schedule_items SET source_kind='PRESENTATION',live_session_id=NULL WHERE id=$1`, [ordinary.itemId]);
    const legacy = await createScheduleReservationService().resolveScheduleWindows({ scheduleId: ordinary.scheduleId, explicitScreenIds: [outsider] }, owned.db);
    expect(legacy.windows.map(window => window.screen_id).sort()).toEqual(ordinary.screens.sort());
  });

  it('rejects inactive schedules and unavailable presenter identities without reservation writes', async () => {
    const schedule = await serviceSchedule();
    await owned.pool.query('UPDATE schedules SET is_active=false WHERE id=$1', [schedule.scheduleId]);
    await expect(reserve(schedule)).rejects.toMatchObject({ code: 'LIVE_SCHEDULE_INACTIVE' });
    await owned.pool.query('UPDATE schedules SET is_active=true WHERE id=$1', [schedule.scheduleId]);
    try {
      await owned.pool.query('UPDATE users SET is_active=false WHERE id=$1', [foundation.presenter]);
      await expect(reserve(schedule)).rejects.toMatchObject({ code: 'LIVE_SESSION_UNAVAILABLE' });
      await owned.pool.query('UPDATE users SET is_active=true,role_id=$2 WHERE id=$1', [foundation.presenter, randomUUID()]);
      await expect(reserve(schedule)).rejects.toMatchObject({ code: 'LIVE_SESSION_UNAVAILABLE' });
    } finally { await owned.pool.query('UPDATE users SET is_active=true,role_id=$2 WHERE id=$1', [foundation.presenter, foundation.role]); }
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE schedule_id=$1', [schedule.scheduleId])).rows[0].n).toBe(0);
  });

  it('rechecks durable-worker authoring authority before READY even when library read remains granted', async () => {
    const { createLiveFallbackPreparationRepository } = await import('./live-fallback-preparation');
    const role = randomUUID(), user = randomUUID(), presentation = randomUUID(), media = randomUUID(), entry = randomUUID(), preparation = randomUUID();
    const reads = ['Presentation', 'Media', 'Layout'].map(subject => ({ action: 'read', subject }));
    await owned.pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [role, `SYNTHETIC_PREPARER_${role.slice(0, 8)}`,
      { grants: [...reads, { action: 'create', subject: 'ScheduleItem' }] }]);
    await owned.pool.query('INSERT INTO users(id,email,password_hash,role_id) VALUES($1,$2,$3,$4)', [user, `${user}@example.test`, 'synthetic-unused-password-hash', role]);
    await owned.pool.query(`INSERT INTO presentations(id,name,created_by,owner_scope) VALUES($1,$2,$3,'ORGANIZATION')`, [presentation, 'Synthetic worker permission fixture', user]);
    await owned.pool.query(`INSERT INTO media(id,name,type,status,created_by,owner_scope,source_object_id,ready_object_id)
      VALUES($1,$2,'IMAGE','READY',$3,'ORGANIZATION',$4,$4)`, [media, 'Synthetic worker source', user, foundation.object]);
    await owned.pool.query('INSERT INTO presentation_items(id,presentation_id,media_id,"order",duration_seconds) VALUES($1,$2,$3,0,15)', [entry, presentation, media]);
    const collected = await owned.db.transaction(tx => collectLiveFallbackPreparationSource(user, presentation, tx));
    await owned.pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph) VALUES($1,$2,$3,$4,$5)`,
      [preparation, presentation, user, collected.source_fingerprint, collected.source_graph]);
    const repository = createLiveFallbackPreparationRepository(owned.db);
    const claim = await repository.claim(preparation, randomUUID(), false);
    if (!('row' in claim)) throw new Error('Synthetic preparation should have a live processing claim');
    const object = (await owned.pool.query(`SELECT so.* FROM storage_objects so JOIN live_fallback_preparation_assets a ON a.storage_object_id=so.id WHERE a.preparation_id=$1`, [servicePreparation])).rows[0];
    await owned.pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation)
      VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY')`, [preparation, media, object.id, 'a'.repeat(64)]);
    const manifest = { version: 1 as const, presentation: { id: presentation, layout: null, items: [{ id: entry, order: 0, asset_id: media, duration_seconds: 15 }] },
      assets: [{ id: media, media_id: media, storage_object_id: object.id, bucket: object.bucket, object_key: object.object_key,
        sha256: 'a'.repeat(64), size: 64, content_type: 'image/png', render_type: 'image' as const, representation: 'READY',
        dependencies: [], cache_key: `live_${'a'.repeat(64)}_image` }] };
    await owned.pool.query('UPDATE roles SET permissions=$2 WHERE id=$1', [role, { grants: reads }]);
    const ability = await defineAbilityFor(role, user);
    expect(ability.can('read', 'Presentation')).toBe(true); expect(ability.can('create', 'ScheduleItem')).toBe(false);
    const libraryOnly = await owned.db.transaction(executor => collectLiveFallbackSource({ executor, ability,
      actor: { userId: user, roleName: `SYNTHETIC_PREPARER_${role.slice(0, 8)}`, departmentId: null, departmentIds: [] } }, presentation));
    expect(libraryOnly.source_fingerprint).toBe(collected.source_fingerprint);
    const before = (await owned.pool.query('SELECT * FROM live_fallback_preparations WHERE id=$1', [preparation])).rows[0];
    await expect(owned.db.transaction(tx => collectLiveFallbackPreparationSource(user, presentation, tx))).rejects.toMatchObject({ statusCode: 403 });
    await expect(repository.finalize(claim, manifest)).rejects.toMatchObject({ statusCode: 403 });
    expect((await owned.pool.query('SELECT * FROM live_fallback_preparations WHERE id=$1', [preparation])).rows[0]).toEqual(before);
    expect(before.state).toBe('PROCESSING'); expect(before.manifest).toBeNull();
  });

  it('rejects high-level LIVE reservation mutations without current live context before writing rows', async () => {
    const schedule = await serviceSchedule(), request = randomUUID(), service = createScheduleReservationService();
    await owned.pool.query('INSERT INTO schedule_requests(id,schedule_id,schedule_payload,requested_by) VALUES($1,$2,$3,$4)',
      [request, schedule.scheduleId, {}, foundation.owner]);
    await expect(service.acquireHoldsForRequest({ scheduleRequestId: request, scheduleId: schedule.scheduleId,
      ownerUserId: foundation.owner, allowPrivateRefs: true }, owned.db)).rejects.toMatchObject({ code: 'LIVE_APPROVAL_REQUIRED' });
    await expect(service.acquireDirectPublishedReservations({ scheduleId: schedule.scheduleId, ownerUserId: foundation.owner,
      publishId: randomUUID() }, owned.db)).rejects.toMatchObject({ code: 'LIVE_APPROVAL_REQUIRED' });
    expect((await owned.pool.query('SELECT reservation_token,reservation_state FROM schedule_requests WHERE id=$1', [request])).rows[0])
      .toEqual({ reservation_token: null, reservation_state: null });
    expect((await owned.pool.query('SELECT count(*)::int n FROM schedule_reservations WHERE schedule_id=$1', [schedule.scheduleId])).rows[0].n).toBe(0);
    expect((await owned.pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE schedule_id=$1', [schedule.scheduleId])).rows[0].n).toBe(0);
  });

  it('returns the high-level direct publish token matching frozen LIVE and screen reservations and releases both on takedown', async () => {
    const schedule = await serviceSchedule({ count: 2 }), publish = randomUUID(), service = createScheduleReservationService();
    const result = await withContext(async context => {
      await lockScreenTargetReferences(context.executor);
      await context.executor.select().from(tables.schedules).where(eq(tables.schedules.id, schedule.scheduleId)).for('update');
      const prepared = await prepare(context, schedule, undefined, undefined, { explicitScreenIds: [schedule.screens[0]] });
      await context.executor.insert(tables.publishes).values({ id: publish, schedule_id: schedule.scheduleId,
        snapshot_id: randomUUID(), published_by: foundation.owner });
      return service.acquireDirectPublishedReservations({ scheduleId: schedule.scheduleId, ownerUserId: foundation.owner,
        publishId: publish, explicitScreenIds: [schedule.screens[0]], live: { context, prepared } }, context.executor);
    });
    const occurrence = (await owned.pool.query('SELECT * FROM live_schedule_occurrences WHERE reservation_token=$1', [result.reservation_token])).rows[0];
    expect(occurrence).toMatchObject({ state: 'PUBLISHED', publish_id: publish, screen_ids: [schedule.screens[0]] });
    expect((await owned.pool.query('SELECT reservation_token,screen_id,state FROM schedule_reservations WHERE publish_id=$1', [publish])).rows)
      .toEqual([{ reservation_token: result.reservation_token, screen_id: schedule.screens[0], state: 'PUBLISHED' }]);
    await service.takeDownPublish({ publishId: publish, takenDownBy: foundation.owner }, owned.db);
    expect((await owned.pool.query('SELECT state,frozen_policy FROM live_schedule_occurrences WHERE id=$1', [occurrence.id])).rows[0])
      .toEqual({ state: 'RELEASED', frozen_policy: occurrence.frozen_policy });
    expect((await owned.pool.query('SELECT state FROM schedule_reservations WHERE publish_id=$1', [publish])).rows[0].state).toBe('RELEASED');
    expect((await service.takeDownPublish({ publishId: publish, takenDownBy: foundation.owner }, owned.db)).alreadyTakenDown).toBe(true);
  });

  it('keeps high-level request hold/reuse/approval/publication/takedown in parity and rejects same-size group replacement', async () => {
    const screens = (await serviceSchedule({ count: 2 })).screens, group = randomUUID(), request = randomUUID(), service = createScheduleReservationService();
    await owned.pool.query('INSERT INTO screen_groups(id,name) VALUES($1,$2)', [group, 'Synthetic high-level request group']);
    await owned.pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)', [group, screens[0]]);
    const schedule = await serviceSchedule({ screens: [], groups: [group] });
    await owned.pool.query('INSERT INTO schedule_requests(id,schedule_id,schedule_payload,requested_by) VALUES($1,$2,$3,$4)',
      [request, schedule.scheduleId, {}, foundation.owner]);
    const authorized = <T>(run: (context: MutationAuthorizationContext, prepared: PreparedLiveSchedule) => Promise<T>) => withContext(async context => {
      await lockScreenTargetReferences(context.executor);
      await context.executor.select().from(tables.schedules).where(eq(tables.schedules.id, schedule.scheduleId)).for('update');
      return run(context, await prepare(context, schedule));
    });
    const acquire = () => authorized((context, prepared) => service.acquireHoldsForRequest({ scheduleRequestId: request,
      scheduleId: schedule.scheduleId, ownerUserId: foundation.owner, allowPrivateRefs: true, live: { context, prepared } }, context.executor));
    const held = await acquire(), reused = await acquire();
    expect(reused.reservation_token).toBe(held.reservation_token);
    const frozen = (await owned.pool.query('SELECT * FROM live_schedule_occurrences WHERE reservation_token=$1', [held.reservation_token])).rows[0];
    expect(frozen.state).toBe('HELD');
    await owned.pool.query('UPDATE screen_group_members SET screen_id=$2 WHERE group_id=$1', [group, screens[1]]);
    await expect(acquire()).rejects.toMatchObject({ statusCode: 409, details: { conflict_type: 'STALE_RESERVATION' } });
    expect((await owned.pool.query('SELECT frozen_policy,screen_ids,state FROM live_schedule_occurrences WHERE id=$1', [frozen.id])).rows[0])
      .toEqual({ frozen_policy: frozen.frozen_policy, screen_ids: [screens[0]], state: 'HELD' });
    await owned.pool.query('UPDATE screen_group_members SET screen_id=$2 WHERE group_id=$1', [group, screens[0]]);
    await authorized((context, prepared) => service.promoteRequestHold({ scheduleRequestId: request, reviewerId: foundation.owner,
      live: { context, prepared, expectedFingerprint: frozen.approval_fingerprint } }, context.executor));
    const publish = randomUUID();
    await authorized(async (context, prepared) => {
      const live = { context, prepared, expectedFingerprint: frozen.approval_fingerprint };
      expect((await service.validateApprovedRequestForPublish(request, context.executor, live)).alreadyPublished).toBe(false);
      await context.executor.insert(tables.publishes).values({ id: publish, schedule_id: schedule.scheduleId, snapshot_id: randomUUID(), published_by: foundation.owner });
      await service.finalizeRequestPublish({ scheduleRequestId: request, publishId: publish, live }, context.executor);
    });
    expect((await owned.pool.query('SELECT state,publish_id FROM live_schedule_occurrences WHERE id=$1', [frozen.id])).rows[0]).toEqual({ state: 'PUBLISHED', publish_id: publish });
    expect((await owned.pool.query('SELECT state,publish_id FROM schedule_reservations WHERE schedule_request_id=$1', [request])).rows[0]).toEqual({ state: 'PUBLISHED', publish_id: publish });
    await service.takeDownPublishedRequest({ scheduleRequestId: request, takenDownBy: foundation.owner }, owned.db);
    expect((await owned.pool.query('SELECT state,frozen_policy FROM live_schedule_occurrences WHERE id=$1', [frozen.id])).rows[0]).toEqual({ state: 'RELEASED', frozen_policy: frozen.frozen_policy });
    expect((await owned.pool.query('SELECT state FROM schedule_reservations WHERE schedule_request_id=$1', [request])).rows[0].state).toBe('RELEASED');
    expect((await owned.pool.query('SELECT status FROM schedule_requests WHERE id=$1', [request])).rows[0].status).toBe('TAKEN_DOWN');
    expect((await owned.pool.query('SELECT status FROM publishes WHERE id=$1', [publish])).rows[0].status).toBe('TAKEN_DOWN');
  });
});
