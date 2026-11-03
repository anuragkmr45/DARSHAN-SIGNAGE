import { randomUUID, createHash, createSign, generateKeyPairSync } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import type { AddressInfo } from 'node:net';
import { io as connectSocket } from 'socket.io-client';
import { drizzle } from 'drizzle-orm/node-postgres';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/db';
import * as tables from '@/db/schema';
import { config } from '@/config';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { buildDeviceRequestSignaturePayload } from '@/utils/device-request-auth';
import { recordDeviceIdentitySession } from '@/services/device-identity-session-service';
import { deviceTelemetryRoutes } from './device-telemetry';
import { setupDeviceRealtimeGateway } from '@/realtime/device-gateway';
import { buildDeviceSocketSignaturePayload } from '@/realtime/device-socket-auth';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, queued: vi.fn(async (_job: any) => undefined) }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/config', async () => { const actual = await vi.importActual<typeof import('@/config')>('@/config'); return {
  ...actual, config: { ...actual.config, REALTIME_BUS_PROVIDER: 'memory', DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: true,
    DEVICE_SOCKET_SIGNED_AUTH_ENABLED: true, DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED: false },
}; });
vi.mock('@/jobs', async () => ({ ...await vi.importActual<typeof import('@/jobs')>('@/jobs'), queueHeartbeatTelemetry: fixture.queued }));
vi.mock('@/services/screen-state-refresh', () => ({ queueScreenStateRefresh: vi.fn() }));
vi.mock('@/services/screen-availability', async () => ({ ...await vi.importActual<typeof import('@/services/screen-availability')>('@/services/screen-availability'),
  recordScreenAvailabilityHeartbeat: vi.fn(async () => undefined), recordBackendReadinessCheckpoint: vi.fn(async () => undefined) }));
vi.mock('@/services/command-lifecycle-service', async () => ({ ...await vi.importActual<typeof import('@/services/command-lifecycle-service')>('@/services/command-lifecycle-service'),
  claimDeviceCommands: vi.fn(async () => []) }));

describe('REST capability bootstrap with real RSA authentication and owned PostgreSQL transactions', () => {
  const suffix = randomUUID().replace(/-/g, ''), database = `darshan_heartbeat_caps_${suffix}_test`, namespace = `heartbeat_caps_${suffix}_test`;
  let source: Pool, admin: Pool, pool: Pool, server: FastifyInstance, created = false, socketBase = '';
  let keys: ReturnType<typeof generateKeyPairSync>;
  const previousMode = process.env.DARSHAN_DEVICE_AUTH_MODE;
  const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const localize = (v: string) => v.replace(/\bpublic\./g, '');
  const caps = { features: ['message_emergency_v1', 'live_broadcast_v1'], commands: ['SCREENSHOT'], screenshot: true };
  const hash = (v: string) => createHash('sha256').update(v).digest('hex');
  async function seed() {
    const screen = randomUUID(), serial = randomUUID(), runtime = randomUUID();
    await pool.query(`INSERT INTO screens(id,name,status,device_info) VALUES($1,'Owned REST capability fixture','OFFLINE',$2)`, [screen, { model: 'preserved-existing-model' }]);
    await pool.query(`INSERT INTO device_certificates(screen_id,serial,certificate_pem,public_key_pem,expires_at)
      VALUES($1,$2,'synthetic-certificate',$3,(now() AT TIME ZONE 'UTC')+interval '1 day')`, [screen, serial, keys.publicKey]);
    return { screen, serial, runtime };
  }
  async function heartbeat(d: Awaited<ReturnType<typeof seed>>, options: { signed?: boolean; badSignature?: boolean; capabilities?: unknown; runtime?: string; runtimeHeader?: string } = {}) {
    const headers: Record<string, string> = { 'x-device-serial': d.serial };
    if (options.signed) {
      const timestamp = String(Date.now()), signer = createSign('RSA-SHA256');
      signer.update(buildDeviceRequestSignaturePayload({ method: 'POST', url: '/api/v1/device/heartbeat', deviceId: d.screen, timestamp })); signer.end();
      Object.assign(headers, { 'x-device-auth-version': 'v1', 'x-device-timestamp': timestamp,
        'x-device-signature': options.badSignature ? Buffer.alloc(256).toString('base64') : signer.sign(keys.privateKey as string, 'base64') });
    }
    if (options.runtimeHeader) headers['x-darshan-runtime-session-id'] = options.runtimeHeader;
    return server.inject({ method: 'POST', url: '/api/v1/device/heartbeat', headers, payload: {
      device_id: d.screen, status: 'ONLINE', uptime: 1, memory_usage: 1, cpu_usage: 1,
      runtime_session_id: options.runtime ?? d.runtime, ...(options.capabilities !== undefined ? { player_capabilities: options.capabilities } : {}),
    } });
  }
  const screenInfo = async (id: string) => (await pool.query('SELECT device_info,status,last_heartbeat_at FROM screens WHERE id=$1', [id])).rows[0];
  async function hello(d: Awaited<ReturnType<typeof seed>>, options: { signed?: boolean; runtime?: string; capabilities?: unknown } = {}) {
    const auth: Record<string, string> = { device_id: d.screen, device_serial: d.serial };
    if (options.signed) {
      const timestamp = String(Date.now()), nonce = randomUUID().replace(/-/g, ''), signer = createSign('RSA-SHA256');
      signer.update(buildDeviceSocketSignaturePayload({ deviceId: d.screen, serial: d.serial, timestamp, nonce })); signer.end();
      Object.assign(auth, { auth_version: 'v1', auth_timestamp: timestamp, auth_nonce: nonce, auth_signature: signer.sign(keys.privateKey as string, 'base64') });
    }
    const socket = connectSocket(`${socketBase}/device`, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 2000, auth });
    try {
      await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      const ack: any = await new Promise((resolve, reject) => { socket.timeout(4000).emit('HELLO', {
        type: 'HELLO', device_id: d.screen, session_id: 'owned-test-session', capabilities: options.capabilities ?? caps,
        ...(options.runtime ? { runtime_session_id: options.runtime } : {}),
      }, (error: Error | null, response: unknown) => error ? reject(error) : resolve(response)); });
      expect(ack.type).toBe('HELLO_ACK'); return ack;
    } finally { socket.disconnect(); }
  }
  beforeAll(async () => {
    process.env.DARSHAN_DEVICE_AUTH_MODE = 'legacy';
    assertDedicatedTestDatabase(config.DATABASE_URL, 'Read-only heartbeat fixture catalog'); const url = new URL(config.DATABASE_URL);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname); expect(url.port).toBe('55455');
    source = new Pool({ connectionString: url.toString(), max: 1, options: '-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000' });
    url.pathname = '/postgres'; admin = new Pool({ connectionString: url.toString(), max: 1 });
    url.pathname = `/${database}`; assertDedicatedTestDatabase(url.toString()); await admin.query(`CREATE DATABASE ${quote(database)}`); created = true;
    pool = new Pool({ connectionString: url.toString(), max: 6, application_name: namespace,
      options: `-c search_path=${namespace} -c timezone=UTC -c statement_timeout=7000 -c lock_timeout=5000` });
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`);
    const enums = await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t
      JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for (const row of enums.rows) await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map((v: string) => `'${v.replace(/'/g, "''")}'`).join(',')})`);
    for (const table of ['screens', 'device_certificates', 'device_auth_rollout_observations']) {
      const columns = await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [table]);
      expect(columns.rows.length).toBeGreaterThan(0);
      const definitions = columns.rows.map(row => {
        if (/\bnextval\s*\(/i.test(row.default_sql ?? '')) throw Error('External fixture sequence refused');
        return `${quote(row.attname)} ${localize(row.type)}${row.attnotnull ? ' NOT NULL' : ''}${row.default_sql ? ` DEFAULT ${localize(row.default_sql)}` : ''}`;
      });
      const constraints = await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con
        JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`, [table]);
      for (const row of constraints.rows) definitions.push(`CONSTRAINT ${quote(row.conname)} ${localize(row.definition)}`);
      await pool.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')})`);
    }
    fixture.db = drizzle(pool, { schema: tables }); keys = generateKeyPairSync('rsa', {
      modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    server = Fastify({ logger: false }); await server.register(deviceTelemetryRoutes);
    await setupDeviceRealtimeGateway(server, { force: true }); await server.listen({ host: '127.0.0.1', port: 0 });
    socketBase = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
  }, 20000);
  afterAll(async () => {
    if (previousMode === undefined) delete process.env.DARSHAN_DEVICE_AUTH_MODE; else process.env.DARSHAN_DEVICE_AUTH_MODE = previousMode;
    await server?.close(); await pool?.end(); await source?.end(); if (admin) { if (created) await admin.query(`DROP DATABASE ${quote(database)}`); await admin.end(); }
  }, 15000);
  it('bootstraps capability and hashed runtime session through genuine signed REST with global legacy mode and no HELLO', async () => {
    const d = await seed(), response = await heartbeat(d, { signed: true, capabilities: caps });
    expect(response.statusCode).toBe(200); const row = await screenInfo(d.screen);
    expect(row.device_info.player_capabilities).toEqual(caps); expect(row.device_info.player_capabilities_observed_at).toBeTruthy();
    expect(row.device_info.player_capabilities_runtime_session_hash).toBe(hash(d.runtime));
    expect(row.device_info.identity_sessions.sessions.map((s: any) => s.runtimeSessionHash)).toContain(hash(d.runtime));
    expect(row.device_info.model).toBe('preserved-existing-model'); expect(row.status).toBe('ACTIVE');
  });
  it('keeps unsigned legacy heartbeat behavior while ignoring even malformed optional capability claims and removing them from telemetry', async () => {
    const d = await seed(), response = await heartbeat(d, { capabilities: { features: 'untrusted-invalid', token: 'synthetic-must-not-be-stored' } });
    expect(response.statusCode).toBe(200); const row = await screenInfo(d.screen);
    expect(row.device_info.player_capabilities).toBeUndefined(); expect(row.status).toBe('ACTIVE');
    expect(fixture.queued.mock.calls.at(-1)?.[0].payload).not.toHaveProperty('player_capabilities');
  });
  it('rejects an invalid supplied signature without storing capabilities or accepting heartbeat state', async () => {
    const d = await seed(), response = await heartbeat(d, { signed: true, badSignature: true, capabilities: caps });
    expect(response.statusCode).toBe(403); const row = await screenInfo(d.screen);
    expect(row.device_info.player_capabilities).toBeUndefined(); expect(row.last_heartbeat_at).toBeNull();
  });
  it('replaces a prior LIVE declaration with the current no-LIVE declaration after the player gate is disabled', async () => {
    const d = await seed(); expect((await heartbeat(d, { signed: true, capabilities: caps })).statusCode).toBe(200);
    const ordinary = { ...caps, features: ['message_emergency_v1'] };
    expect((await heartbeat(d, { signed: true, capabilities: ordinary })).statusCode).toBe(200);
    expect((await screenInfo(d.screen)).device_info.player_capabilities).toEqual(ordinary);
  });
  it('does not let unsigned legacy diagnostics replace trusted capability/process metadata', async () => {
    const d = await seed(); expect((await heartbeat(d, { signed: true, capabilities: caps })).statusCode).toBe(200);
    expect((await heartbeat(d, { capabilities: { features: [] }, runtime: randomUUID() })).statusCode).toBe(200);
    const info = (await screenInfo(d.screen)).device_info;
    expect(info.player_capabilities).toEqual(caps); expect(info.player_capabilities_runtime_session_hash).toBe(hash(d.runtime));
  });
  it('rejects a mismatched supplied runtime header before signed capability/session metadata is written', async () => {
    const d = await seed(); const response = await heartbeat(d, { signed: true, capabilities: caps, runtimeHeader: randomUUID() });
    expect(response.statusCode).toBe(400); expect((await screenInfo(d.screen)).device_info.player_capabilities).toBeUndefined();
  });
  it('requires a valid runtime UUID for signed capability metadata while retaining legacy runtime strings without trusted metadata', async () => {
    const d = await seed(); const rejected = await heartbeat(d, { signed: true, capabilities: caps, runtime: 'legacy-runtime-string' });
    expect(rejected.statusCode).toBe(422); expect((await screenInfo(d.screen)).device_info.player_capabilities).toBeUndefined();
    expect((await heartbeat(d, { runtime: 'legacy-runtime-string' })).statusCode).toBe(200);
  });
  it('preserves ordinary legacy HELLO compatibility but never accepts its LIVE declaration or trusted process binding', async () => {
    const d = await seed(); await hello(d, { capabilities: caps, runtime: d.runtime });
    const info = (await screenInfo(d.screen)).device_info;
    expect(info.player_capabilities.features).toEqual(['message_emergency_v1']);
    expect(info.player_capabilities.screenshot).toBe(true); expect(info.player_capabilities_trusted).toBe(false);
    expect(info.player_capabilities_runtime_session_hash).toBeNull();
  });
  it('ignores legacy HELLO after signed REST and retains one consistent trusted capability/process document', async () => {
    const d = await seed(); expect((await heartbeat(d, { signed: true, capabilities: caps })).statusCode).toBe(200);
    const before = (await screenInfo(d.screen)).device_info;
    await hello(d, { capabilities: { features: ['legacy_other_feature'] }, runtime: randomUUID() });
    const after = (await screenInfo(d.screen)).device_info;
    expect(after.player_capabilities).toEqual(before.player_capabilities);
    expect(after.player_capabilities_runtime_session_hash).toBe(hash(d.runtime));
    expect(after.player_capabilities_source).toBe('REST_SIGNED');
  });
  it('withholds LIVE for signed HELLO lacking a runtime UUID until the next signed REST report establishes binding', async () => {
    const d = await seed(); await hello(d, { signed: true });
    let info = (await screenInfo(d.screen)).device_info;
    expect(info.player_capabilities.features).not.toContain('live_broadcast_v1'); expect(info.player_capabilities_runtime_session_hash).toBeNull();
    expect(info.player_capabilities_trusted).toBe(true);
    expect((await heartbeat(d, { signed: true, capabilities: caps })).statusCode).toBe(200);
    info = (await screenInfo(d.screen)).device_info;
    expect(info.player_capabilities.features).toContain('live_broadcast_v1'); expect(info.player_capabilities_runtime_session_hash).toBe(hash(d.runtime));
  });
  it('serializes actual heartbeat and other identity-session writers without losing capabilities, sessions or unrelated metadata', async () => {
    const d = await seed(), first = randomUUID(), third = randomUUID();
    let entered!: () => void, release!: () => void;
    const locked = new Promise<void>(r => { entered = r; }), proceed = new Promise<void>(r => { release = r; });
    const owner = fixture.db!.transaction(async tx => { await recordDeviceIdentitySession({ deviceId: d.screen, runtimeSessionId: first, source: 'pairing_status' }, tx); entered(); await proceed; });
    await locked;
    const restCapabilities = { ...caps, features: [...caps.features, 'rest_marker'] }, helloCapabilities = { ...caps, features: [...caps.features, 'hello_marker'] };
    const helloRuntime = randomUUID();
    const beat = heartbeat(d, { signed: true, capabilities: restCapabilities });
    const other = recordDeviceIdentitySession({ deviceId: d.screen, runtimeSessionId: third, source: 'pairing_status' });
    const socketReport = hello(d, { signed: true, runtime: helloRuntime, capabilities: helloCapabilities });
    // Observe actual PostgreSQL lock waits rather than assuming a timer created a race.
    let waiting = false;
    try {
      for (let i = 0; i < 80; i++) {
        const { rows } = await pool.query("SELECT count(*)::int count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [namespace]);
        if (rows[0].count >= 3) { waiting = true; break; }
        await new Promise(r => setTimeout(r, 10));
      }
    } finally { release(); }
    await owner; expect((await beat).statusCode).toBe(200); await other; await socketReport; expect(waiting).toBe(true);
    const info = (await screenInfo(d.screen)).device_info;
    const helloWon = info.player_capabilities_source === 'HELLO_SIGNED';
    expect(info.player_capabilities).toEqual(helloWon ? helloCapabilities : restCapabilities);
    expect(info.player_capabilities_runtime_session_hash).toBe(hash(helloWon ? helloRuntime : d.runtime));
    expect(info.player_capabilities_trusted).toBe(true); expect(info.model).toBe('preserved-existing-model');
    expect(info.identity_sessions.sessions.map((s: any) => s.runtimeSessionHash)).toEqual(expect.arrayContaining([hash(first), hash(d.runtime), hash(third)]));
  });
});
