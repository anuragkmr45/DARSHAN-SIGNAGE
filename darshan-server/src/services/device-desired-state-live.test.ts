import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
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
import { screenRoutes } from '@/routes/screens';
import { deviceTelemetryRoutes } from '@/routes/device-telemetry';
import { buildDeviceRequestSignaturePayload } from '@/utils/device-request-auth';
import { createDeviceCommands, type CreateDeviceCommandInput } from './command-lifecycle-service';
import { getDeviceDesiredState, recordDesiredStateForCommand, type DesiredStateCommandInput } from './device-desired-state-service';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined,
  actor: undefined as { sub: string; jti: string; role_id: string; role: string } | undefined,
  tokens: new Map<string, { sub: string; jti: string; role_id: string; role: string }>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
// Only CMS token decoding and unrelated socket startup are replaced. Device
// identity uses real RSA signatures; state, history, SQL locks and HTTP are real.
vi.mock('@/auth/jwt', () => ({ extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => { const actor = fixture.tokens.get(token); if (!actor) throw AppError.unauthorized(); return actor; } }));
vi.mock('@/realtime/screens-namespace', () => ({ setupScreensNamespace: vi.fn(async () => undefined), emitScreensRefreshRequired: vi.fn() }));

describe('opaque desired live version on an independently owned PostgreSQL database', () => {
  const suffix = randomUUID().replace(/-/g, ''), name = `darshan_desired_live_${suffix}_test`, namespace = `desired_live_${suffix}_test`;
  const legacyScreen = randomUUID(), legacyCommand = randomUUID();
  let source: Pool, admin: Pool, pool: Pool, server: FastifyInstance, created = false;
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const localize = (value: string) => value.replace(/\bpublic\./g, '');
  const state = (screenId: string) => getDeviceDesiredState(screenId);
  const history = async (screenId: string) => (await pool.query('SELECT *,state_version::int AS version FROM device_desired_state_history WHERE screen_id=$1 ORDER BY state_version', [screenId])).rows;
  const command = (screenId: string, extra: Partial<CreateDeviceCommandInput> = {}): CreateDeviceCommandInput => ({ screenId,
    createdBy: fixture.actor!.sub, type: 'RESYNC', payload: { reason: 'SYNTHETIC_DESIRED_STATE' }, ...extra });
  const write = (screenId: string, extra: Partial<DesiredStateCommandInput> = {}) => fixture.db!.transaction(tx => recordDesiredStateForCommand(tx, {
    screenId, commandId: randomUUID(), commandType: 'RESYNC', ...extra,
  }));
  async function screen(id: string = randomUUID()) {
    await pool.query('INSERT INTO screens(id,name) VALUES($1,$2)', [id, 'Synthetic desired live prerequisite']); return id;
  }
  async function waitForLocks(count: number) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if ((await pool.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1 AND application_name=$2 AND wait_event_type='Lock'`, [name, namespace])).rows[0].n >= count) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Expected actual test-owned PostgreSQL lock contention');
  }
  async function withHeldStateRows(screenIds: string[], start: () => Promise<unknown>) {
    const holder = await pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT screen_id FROM device_desired_state WHERE screen_id=ANY($1::uuid[]) ORDER BY screen_id FOR UPDATE', [screenIds]);
      pending = start(); void pending.catch(() => undefined);
      await waitForLocks(2); await holder.query('COMMIT'); await pending;
    } finally { await holder.query('ROLLBACK'); holder.release(); if (pending) await pending; }
  }

  beforeAll(async () => {
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only desired-state fixture catalog');
    const url = new URL(config.DATABASE_URL); expect(url.hostname).toBe('127.0.0.1'); expect(url.port).toBe('55455');
    expect(config.DEVICE_DESIRED_STATE_ENABLED).toBe(true); expect(config.COMMAND_OUTBOX_WRITE_ENABLED).toBe(true);
    source = new Pool({ connectionString: url.toString(), max: 1,
      options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000' });
    url.pathname = '/postgres'; admin = new Pool({ connectionString: url.toString(), max: 1 });
    url.pathname = `/${name}`; assertDedicatedTestDatabase(url.toString());
    await admin.query(`CREATE DATABASE ${quote(name)}`); created = true;
    pool = new Pool({ connectionString: url.toString(), max: 8, application_name: namespace,
      options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=5000 -c lock_timeout=4000` });
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`); expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    const enums = await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t
      JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const row of enums.rows) await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map((value: string) => `'${value.replace(/'/g, "''")}'`).join(',')})`);
    for (const table of ['roles', 'departments', 'users', 'sessions', 'user_additional_departments', 'screens', 'screen_display_states',
      'device_certificates', 'device_auth_rollout_observations', 'device_commands', 'device_command_status_history', 'command_outbox',
      'device_desired_state', 'device_desired_state_history', 'schedule_reservations', 'schedule_requests', 'publishes', 'schedule_snapshots',
      'publish_targets', 'emergencies', 'emergency_types', 'screen_groups', 'screen_group_members', 'settings', 'storage_objects', 'media',
      'presentation_items', 'presentation_slot_items', 'proof_of_play', 'screenshots', 'heartbeats']) {
      const columns = await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
      expect(columns.rows.length).toBeGreaterThan(0);
      const excluded = table.startsWith('device_desired_state') ? new Set(['live_version']) : new Set<string>();
      const definitions = columns.rows.filter(row => !excluded.has(row.attname)).map(row => {
        if (/\bnextval\s*\(/i.test(row.default_sql ?? '')) throw new Error('Fixture refuses external sequence defaults');
        return `${quote(row.attname)} ${localize(row.type)}${row.attnotnull ? ' NOT NULL' : ''}${row.default_sql ? ` DEFAULT ${localize(row.default_sql)}` : ''}`;
      });
      const checks = await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [table]);
      for (const row of checks.rows) if (![...excluded].some(column => new RegExp(`\\b${column}\\b`).test(row.definition))) definitions.push(`CONSTRAINT ${quote(row.conname)} ${localize(row.definition)}`);
      await pool.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')})`);
    }
    // Copy the actual idempotency partial index, not just table constraints.
    await pool.query(`CREATE UNIQUE INDEX desired_test_command_idempotency ON device_commands(screen_id,idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await pool.query('INSERT INTO device_desired_state(screen_id,state_version,command_version,last_command_id) VALUES($1,11,7,$2)', [legacyScreen, legacyCommand]);
    await pool.query('INSERT INTO device_desired_state_history(screen_id,state_version,command_version,command_id) VALUES($1,11,7,$2)', [legacyScreen, legacyCommand]);
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(await readFile(new URL('../../drizzle/migrations/0059_device_desired_live_version.sql', import.meta.url), 'utf8')); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    fixture.db = drizzle(pool, { schema: tables });
    const actor = { sub: randomUUID(), jti: randomUUID(), role_id: randomUUID(), role: 'SUPER_ADMIN' }; fixture.actor = actor;
    fixture.tokens.set(actor.jti, actor);
    await pool.query(`INSERT INTO roles(id,name,permissions) VALUES($1,'SUPER_ADMIN','{"grants":[]}')`, [actor.role_id]);
    await pool.query(`INSERT INTO users(id,email,password_hash,role_id) VALUES($1,$2,'synthetic-unused-password',$3)`, [actor.sub, `${actor.sub}@example.test`, actor.role_id]);
    server = Fastify({ logger: false }); server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(screenRoutes); await server.register(deviceTelemetryRoutes); await server.ready();
  }, 30_000);

  afterAll(async () => {
    await server?.close(); await pool?.end(); await source?.end();
    if (admin) { if (created) await admin.query(`DROP DATABASE ${quote(name)}`); await admin.end(); }
  }, 15_000);

  it('migrates existing rows additively without rewriting versions or inventing past live authority', async () => {
    expect(await state(legacyScreen)).toMatchObject({ state_version: 11, command_version: 7, last_command_id: legacyCommand, live_version: null });
    expect((await history(legacyScreen))[0]).toMatchObject({ version: 11, live_version: null });
    const columns = (await pool.query(`SELECT table_name,is_nullable,data_type FROM information_schema.columns
      WHERE table_schema=$1 AND column_name='live_version' ORDER BY table_name`, [namespace])).rows;
    expect(columns).toEqual(['device_desired_state', 'device_desired_state_history'].map(table_name => ({ table_name, is_nullable: 'YES', data_type: 'text' })));
  });

  it('preserves a sequential live version through bulk and sequential ordinary commands, including history', async () => {
    const a = await screen(), b = await screen(), snapshot = randomUUID();
    await write(a, { liveVersion: 'opaque:Epoch_A/run-7', snapshotId: snapshot });
    await createDeviceCommands([command(a), command(b)]);
    await write(a, { defaultMediaVersion: 'default-2', liveVersion: undefined });
    expect(await state(a)).toMatchObject({ live_version: 'opaque:Epoch_A/run-7', snapshot_id: snapshot, state_version: 3, command_version: 3, default_media_version: 'default-2' });
    expect((await history(a)).map(row => [row.version, row.live_version])).toEqual([[1, 'opaque:Epoch_A/run-7'], [2, 'opaque:Epoch_A/run-7'], [3, 'opaque:Epoch_A/run-7']]);
    expect((await state(b))?.live_version).toBeNull();
    const outbox = (await pool.query('SELECT payload FROM command_outbox WHERE screen_id=$1', [a])).rows[0].payload;
    expect(outbox).not.toHaveProperty('desired_live_version');
  });

  it('supports explicit clear in bulk and sequential paths while an ordinary follow-up preserves null', async () => {
    const a = await screen(), b = await screen();
    await createDeviceCommands([command(a, { desiredLiveVersion: 'live-A' }), command(b, { desiredLiveVersion: 'live-B' })]);
    await createDeviceCommands([command(a, { desiredLiveVersion: null }), command(b, { desiredLiveVersion: null })]);
    await write(a); expect((await state(a))?.live_version).toBeNull(); expect((await state(b))?.live_version).toBeNull();
    await write(a, { liveVersion: 'replacement' }); await write(a, { liveVersion: null });
    expect((await history(a)).map(row => row.live_version)).toEqual(['live-A', null, null, 'replacement', null]);
    const cleared = (await pool.query('SELECT payload FROM command_outbox WHERE screen_id=$1 ORDER BY created_at DESC,id DESC', [b])).rows;
    expect(cleared.some(row => Object.hasOwn(row.payload, 'desired_live_version') && row.payload.desired_live_version === null)).toBe(true);
  });

  it('falls back safely for mixed explicit and omitted modes without clearing another screen', async () => {
    const a = await screen(), b = await screen(); await write(b, { liveVersion: 'keep-B' });
    const commands = await createDeviceCommands([command(a, { desiredLiveVersion: 'set-A' }), command(b)]);
    expect(commands.map(row => row.screen_id)).toEqual([a, b]);
    expect((await state(a))?.live_version).toBe('set-A'); expect((await state(b))?.live_version).toBe('keep-B');
    const metadata = (await history(b)).at(-1)!.metadata; expect(metadata).not.toHaveProperty('desired_live_version');
  });

  it('correlates duplicate-screen inputs by command UUID and preserves their own input order', async () => {
    const a = await screen(), snapshot = randomUUID();
    const commands = await createDeviceCommands([
      command(a, { payload: { step: 1 }, desiredLiveVersion: 'first-live', desiredSnapshotId: snapshot }),
      command(a, { payload: { step: 2 }, desiredDefaultMediaVersion: 'second-default' }),
      command(a, { payload: { step: 3 }, desiredLiveVersion: null }),
    ]);
    expect(commands.map(row => (row.payload as { step: number }).step)).toEqual([1, 2, 3]);
    const rows = await history(a); expect(rows.map(row => [row.version, row.command_id, row.live_version])).toEqual([
      [1, commands[0].id, 'first-live'], [2, commands[1].id, 'first-live'], [3, commands[2].id, null],
    ]);
    expect(await state(a)).toMatchObject({ snapshot_id: snapshot, default_media_version: 'second-default', live_version: null, state_version: 3 });
    const events = (await pool.query('SELECT command_id,payload FROM command_outbox WHERE screen_id=$1', [a])).rows;
    expect(events.find(row => row.command_id === commands[0].id).payload.desired_live_version).toBe('first-live');
    expect(events.find(row => row.command_id === commands[1].id).payload).not.toHaveProperty('desired_live_version');
    expect(events.find(row => row.command_id === commands[2].id).payload.desired_live_version).toBeNull();
  });

  it('does not replay an ignored idempotent live command or misassociate its input with a new command', async () => {
    const a = await screen(), key = randomUUID();
    const [original] = await createDeviceCommands([command(a, { idempotencyKey: key, desiredLiveVersion: 'old-live' })]);
    await write(a, { liveVersion: 'current-live' }); const before = await state(a), beforeHistory = await history(a);
    expect(await createDeviceCommands([command(a, { idempotencyKey: key, desiredLiveVersion: 'old-live' })], { ignoreIdempotencyConflicts: true })).toEqual([]);
    expect(await state(a)).toEqual(before); expect(await history(a)).toEqual(beforeHistory);
    const fresh = await createDeviceCommands([command(a, { desiredLiveVersion: 'fresh-live' }), command(a, { idempotencyKey: key, desiredLiveVersion: 'wrong-ignored-live' })], { ignoreIdempotencyConflicts: true });
    expect(fresh).toHaveLength(1); expect(fresh[0].id).not.toBe(original.id); expect((await state(a))?.live_version).toBe('fresh-live');
    expect((await history(a)).at(-1)).toMatchObject({ command_id: fresh[0].id, live_version: 'fresh-live' });
    expect((await pool.query('SELECT count(*)::int n FROM command_outbox WHERE screen_id=$1', [a])).rows[0].n).toBe(2);
  });

  it('serializes concurrent sequential live and bulk ordinary writes without losing the live revision', async () => {
    const a = await screen(), b = await screen(); await write(a, { liveVersion: 'old' });
    await withHeldStateRows([a], () => Promise.all([createDeviceCommands([command(a), command(b)]), write(a, { liveVersion: 'new' })]));
    expect(await state(a)).toMatchObject({ live_version: 'new', state_version: 3, command_version: 3 });
    const rows = await history(a); expect(rows.map(row => row.version)).toEqual([1, 2, 3]); expect(rows.every(row => row.live_version !== null)).toBe(true);
    expect(rows.at(-1).live_version).toBe('new');
  });

  it('acquires opposite-order batched transactions in stable screen order and retains both live values', async () => {
    const screens = [await screen(), await screen()].sort(), [a, b] = screens;
    await write(a, { liveVersion: 'old-A' }); await write(b, { liveVersion: 'old-B' });
    await withHeldStateRows(screens, () => Promise.all([
      createDeviceCommands([command(a), command(b)]),
      createDeviceCommands([command(b, { desiredLiveVersion: 'new-B' }), command(a, { desiredLiveVersion: 'new-A' })]),
    ]));
    expect(await state(a)).toMatchObject({ live_version: 'new-A', state_version: 3 });
    expect(await state(b)).toMatchObject({ live_version: 'new-B', state_version: 3 });
  });

  it.each([{ label: 'ASCII', left: 'A', right: 'B' }, { label: 'Unicode', left: 'e\u0301', right: '\u00e9' }])(
    'orders $label duplicate-screen idempotency keys physically without changing the winning logical input order', async ({ left, right }) => {
    const a = await screen(), suffix = randomUUID(), keyA = `${left}-${suffix}`, keyB = `${right}-${suffix}`, barrier = `desired_unique_${randomUUID()}`;
    expect((await pool.query('SELECT $1::text=$2::text AS same', [keyA, keyB])).rows[0].same).toBe(false);
    // AFTER ROW holds the first inserted unique key until the controller lets
    // both transactions proceed. Old [A,B]/[B,A] INSERT order then deadlocks;
    // canonical physical order instead makes the second writer wait on A.
    await pool.query(`CREATE FUNCTION desired_unique_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.screen_id='${a}'::uuid THEN PERFORM pg_advisory_xact_lock_shared(hashtext('${barrier}')); END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER desired_unique_test_barrier AFTER INSERT ON device_commands FOR EACH ROW EXECUTE FUNCTION desired_unique_test_barrier()');
    const holder = await pool.connect(); let pending: Promise<unknown> | undefined;
    try {
      await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [barrier]);
      const batches = [
        [command(a, { idempotencyKey: keyA, desiredLiveVersion: 'A-first' }), command(a, { idempotencyKey: keyB, desiredLiveVersion: 'A-last' })],
        [command(a, { idempotencyKey: keyB, desiredLiveVersion: 'B-first' }), command(a, { idempotencyKey: keyA, desiredLiveVersion: 'B-last' })],
      ];
      const outcomes = Promise.allSettled(batches.map(batch => createDeviceCommands(batch, { ignoreIdempotencyConflicts: true })));
      pending = outcomes; await waitForLocks(2); await holder.query('COMMIT');
      const results = await outcomes;
      expect(results.map(result => result.status), results.filter(result => result.status === 'rejected').map(result =>
        (result as PromiseRejectedResult).reason?.code).join(',')).toEqual(['fulfilled', 'fulfilled']);
      const completed = results as PromiseFulfilledResult<Awaited<ReturnType<typeof createDeviceCommands>>>[];
      expect(completed.map(result => result.value.length).sort()).toEqual([0, 2]);
      const winner = completed.findIndex(result => result.value.length === 2), commands = completed[winner].value;
      expect(commands.map(row => row.idempotency_key)).toEqual(batches[winner].map(input => input.idempotencyKey));
      expect(await state(a)).toMatchObject({ live_version: winner === 0 ? 'A-last' : 'B-last', state_version: 2 });
      expect((await history(a)).map(row => row.live_version)).toEqual(winner === 0 ? ['A-first', 'A-last'] : ['B-first', 'B-last']);
    } finally {
      await holder.query('ROLLBACK'); holder.release(); if (pending) await pending;
      await pool.query('DROP TRIGGER desired_unique_test_barrier ON device_commands'); await pool.query('DROP FUNCTION desired_unique_test_barrier()');
    }
  });

  it('normalizes duplicate screen UUID letter case before choosing the bulk upsert mode', async () => {
    const a = await screen(`abcdefab${randomUUID().slice(8)}`);
    const commands = await createDeviceCommands([
      command(a.toUpperCase(), { idempotencyKey: 'case-A', desiredLiveVersion: 'case-first' }),
      command(a, { idempotencyKey: 'case-B', desiredLiveVersion: 'case-last' }),
    ]);
    expect(commands.map(row => row.screen_id)).toEqual([a, a]);
    expect(await state(a)).toMatchObject({ live_version: 'case-last', state_version: 2 });
    expect((await history(a)).map(row => row.live_version)).toEqual(['case-first', 'case-last']);
  });

  it('projects nullable live versions through genuine signed device REST and CMS delivery status', async () => {
    const a = await screen(), pair = generateKeyPairSync('rsa', { modulusLength: 2048 }), serial = randomUUID();
    await pool.query(`INSERT INTO device_certificates(screen_id,serial,certificate_pem,public_key_pem,auth_version,expires_at)
      VALUES($1,$2,'Synthetic desired-state fixture',$3,'v1',now()+interval '1 day')`, [a, serial, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()]);
    const url = `/api/v1/device/${a}/desired-state`;
    const readDevice = () => {
      const timestamp = String(Date.now()), signer = createSign('RSA-SHA256'); signer.update(buildDeviceRequestSignaturePayload({ method: 'GET', url, deviceId: a, timestamp })); signer.end();
      return server.inject({ method: 'GET', url, headers: { 'x-device-serial': serial, 'x-device-auth-version': 'v1',
        'x-device-timestamp': timestamp, 'x-device-signature': signer.sign(pair.privateKey, 'base64') } });
    };
    const empty = await readDevice(); expect(empty.statusCode, empty.body).toBe(200); expect(empty.json().state).toMatchObject({ live_version: null, state_version: 0 });
    await write(a, { liveVersion: 'opaque-current' });
    const device = await readDevice(); expect(device.statusCode, device.body).toBe(200); expect(device.json().state.live_version).toBe('opaque-current');
    const cms = await server.inject({ method: 'GET', url: `/api/v1/screens/${a}/delivery-status`, headers: { authorization: `Bearer ${fixture.actor!.jti}` } });
    expect(cms.statusCode, cms.body).toBe(200); expect(cms.json().desired_state.live_version).toBe('opaque-current');
    await write(a, { liveVersion: null }); expect((await readDevice()).json().state.live_version).toBeNull();
  });

  it('binds conditional command permission before any foreign command, history, outbox or state write', async () => {
    const own = await screen(), foreign = await screen();
    const actor = { sub: randomUUID(), jti: randomUUID(), role_id: randomUUID(), role: `SYNTHETIC_SCREEN_COMMAND_${randomUUID()}` };
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [actor.role_id, actor.role,
      { grants: [{ action: 'update', subject: 'Screen', conditions: { id: own } }] }]);
    await pool.query(`INSERT INTO users(id,email,password_hash,role_id) VALUES($1,$2,'synthetic-unused-password',$3)`, [actor.sub, `${actor.sub}@example.test`, actor.role_id]);
    fixture.tokens.set(actor.jti, actor);
    const writes = async () => (await pool.query(`SELECT
      (SELECT count(*)::int FROM device_commands WHERE screen_id=$1) commands,
      (SELECT count(*)::int FROM device_command_status_history WHERE screen_id=$1) command_history,
      (SELECT count(*)::int FROM command_outbox WHERE screen_id=$1) outbox,
      (SELECT count(*)::int FROM device_desired_state WHERE screen_id=$1) desired,
      (SELECT count(*)::int FROM device_desired_state_history WHERE screen_id=$1) desired_history`, [foreign])).rows[0];
    const before = await writes();
    const denied = await server.inject({ method: 'POST', url: `/api/v1/device/${foreign}/commands`,
      headers: { authorization: `Bearer ${actor.jti}` }, payload: { type: 'PING' } });
    expect(denied.statusCode, denied.body).toBe(403); expect(await writes()).toEqual(before);
    const allowed = await server.inject({ method: 'POST', url: `/api/v1/device/${own}/commands`,
      headers: { authorization: `Bearer ${actor.jti}` }, payload: { type: 'PING' } });
    expect(allowed.statusCode, allowed.body).toBe(201); expect(allowed.json().screen_id).toBe(own);
    expect((await state(own))?.last_command_id).toBe(allowed.json().id); expect(await writes()).toEqual(before);
  });

  it('preserves all four desired versions when public PING omits them and updates only an explicitly supplied snapshot', async () => {
    const a = await screen(), first = randomUUID(), second = randomUUID();
    await write(a, { snapshotId: first, defaultMediaVersion: 'default-current', emergencyVersion: 'emergency-current', liveVersion: 'live-current' });
    const headers = { authorization: `Bearer ${fixture.actor!.jti}` };
    const ping = await server.inject({ method: 'POST', url: `/api/v1/device/${a}/commands`, headers, payload: { type: 'PING' } });
    expect(ping.statusCode, ping.body).toBe(201);
    expect(await state(a)).toMatchObject({ snapshot_id: first, default_media_version: 'default-current',
      emergency_version: 'emergency-current', live_version: 'live-current', state_version: 2 });
    expect((await history(a)).at(-1)).toMatchObject({ snapshot_id: first, default_media_version: 'default-current',
      emergency_version: 'emergency-current', live_version: 'live-current' });
    const snapshotOnly = await server.inject({ method: 'POST', url: `/api/v1/device/${a}/commands`, headers,
      // A public caller cannot promote an unknown live-version property into
      // the internal authority input while updating an allowed ordinary field.
      payload: { type: 'RESYNC', desired_snapshot_id: second, desired_live_version: 'forged-public-live' } });
    expect(snapshotOnly.statusCode, snapshotOnly.body).toBe(201);
    expect(await state(a)).toMatchObject({ snapshot_id: second, default_media_version: 'default-current',
      emergency_version: 'emergency-current', live_version: 'live-current', state_version: 3 });
  });
});
