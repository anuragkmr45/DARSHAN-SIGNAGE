import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID, randomBytes, generateKeyPairSync, createSign } from 'node:crypto';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database } from '@/db';
import { config } from '@/config';
import * as tables from '@/db/schema';
import { assertDedicatedTestDatabase } from '@/db/test-database-safety';
import { liveRuntimeRoutes } from './live-runtime';
import { toAppError } from '@/utils/errors';
import { formatErrorResponse } from '@/utils/app-error';
import { liveError } from '@/services/live-authority-epoch';
import { dispatchOneLiveMediaOperation, reconcileLiveRuntime, reconcileLiveWindowBoundaries } from '@/services/live-runtime';
import { hashLiveFallbackAssetSet, liveAuthorityCheckSchema } from '@/schemas/live-runtime';
import { buildDeviceRequestSignaturePayload, resolveDeviceAuthMode } from '@/utils/device-request-auth';
import { authenticateDeviceOrThrow } from '@/middleware/device-auth';
import * as deviceAuthMetrics from '@/observability/metrics';
import type { LiveMediaFence, LiveMediaView } from '@/services/live-media-client';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined, directory: '', enabled: true,
  media: undefined as any, tokens: new Map<string, any>(), sign: vi.fn() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
vi.mock('@/config', async () => { const actual = await vi.importActual<typeof import('@/config')>('@/config');
  return { ...actual, config: { ...actual.config, get DARSHAN_LIVE_RUNTIME_ENABLED() { return fixture.enabled; },
    get DARSHAN_LIVE_AUTHORITY_FILE() { return path.join(fixture.directory, 'authority.json'); },
    DARSHAN_LIVE_MEDIA_CONTROL_URL: 'https://127.0.0.1:19999',
    get DARSHAN_LIVE_MEDIA_CONTROL_SECRET_FILE() { return path.join(fixture.directory, 'control'); },
    get DARSHAN_LIVE_NODE_WITNESS_SECRET_FILE() { return path.join(fixture.directory, 'witness'); },
    DEVICE_DESIRED_STATE_ENABLED: true, COMMAND_OUTBOX_WRITE_ENABLED: true } }; });
vi.mock('@/auth/jwt', () => ({ extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => { const value = fixture.tokens.get(token); if (!value) throw liveError('UNAUTHORIZED', 'Synthetic session missing.', 401); return value; } }));
vi.mock('@/services/live-media-client', async () => { const actual = await vi.importActual<typeof import('@/services/live-media-client')>('@/services/live-media-client');
  return { ...actual, get liveMediaClient() { return fixture.media; }, liveMediaEndpointFingerprint: () => 'd'.repeat(64) }; });
vi.mock('@/s3', () => ({ getPresignedUrl: (...args: unknown[]) => fixture.sign(...args) }));

describe('durable live runtime with actual PostgreSQL and Fastify authorization', () => {
  const suffix = randomUUID().replace(/-/g, ''), database = `darshan_live_runtime_${suffix}_test`, namespace = `live_runtime_${suffix}_test`;
  const epoch = randomUUID(), authoritySecret = Buffer.alloc(32, 7).toString('base64url'), witnessSecret = 'test-owned-host-witness-credential-000000000';
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  let keys: ReturnType<typeof generateKeyPairSync>;
  type User = { id: string; roleId: string; token: string; department: string | null };
  let manager: User, presenter: User, foreign: User, author: User;
  const departmentA = randomUUID(), departmentB = randomUUID();
  let node = randomUUID(), managed = randomUUID(), teardown = true, loseCreate = false;
  const entries = new Map<string, { fence: LiveMediaFence; lease: number; window: number; state: string }>();
  let creates = 0, tickets = 0;
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`, localize = (value: string) => value.replace(/\bpublic\./g, '');
  const presenterGrants = [{ action: 'publish', subject: 'LiveBroadcast', conditions: { owner_department_id: '$user.department_id' } }];
  async function user(name: string, grants: unknown[], department: string | null): Promise<User> {
    const id = randomUUID(), roleId = randomUUID(), token = randomUUID();
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)', [roleId, name, { grants }]);
    await pool.query(`INSERT INTO users(id,email,password_hash,role_id,department_id) VALUES($1,$2,'test-unused-hash',$3,$4)`, [id, `${id}@example.test`, roleId, department]);
    await pool.query(`INSERT INTO sessions(user_id,access_jti,expires_at) VALUES($1,$2,(now() AT TIME ZONE 'UTC')+interval '1 hour')`, [id, token]);
    fixture.tokens.set(token, { sub: id, jti: token, role_id: roleId, role: name, department_id: department, department_ids: department ? [department] : [] });
    return { id, roleId, token, department };
  }
  const invoke = (actor: User, method: 'GET' | 'POST', url: string, payload?: unknown) => server.inject({ method, url,
    headers: { authorization: `Bearer ${actor.token}` }, payload: method === 'POST' && /\/live-occurrences\/.+\/(start|stop|enable)$/.test(url) && payload && typeof payload === 'object'
      ? { expected_authority_epoch: epoch, ...payload } : payload });
  async function deviceInvoke(data: Data, method: 'GET' | 'POST', url: string, payload?: any, extra: Record<string,string> = {}) {
    const timestamp = String(Date.now()), signer = createSign('RSA-SHA256');
    signer.update(buildDeviceRequestSignaturePayload({ method, url, deviceId: data.screen, timestamp })); signer.end();
    return server.inject({ method, url, payload, headers: { 'x-device-serial': data.serial, 'x-device-auth-version': 'v1',
      'x-device-timestamp': timestamp, 'x-device-signature': signer.sign(keys.privateKey as string, 'base64'), ...extra } });
  }
  type Data = Awaited<ReturnType<typeof seed>>;
  async function seed(options: { start?: number; end?: number; screen?: string; slot?: number } = {}) {
    const id = randomUUID(), schedule = randomUUID(), item = randomUUID(), sourceId = randomUUID(), preparation = randomUUID();
    const presentation = randomUUID(), assetId = randomUUID(), object = randomUUID(), publish = randomUUID(), snapshot = randomUUID();
    const screen = options.screen ?? randomUUID(), group = randomUUID(), serial = randomUUID();
    const start = new Date(options.start ?? Date.now() - 60_000).toISOString(), end = new Date(options.end ?? Date.now() + 1_200_000).toISOString();
    if (!options.screen) await pool.query(`INSERT INTO screens(id,name,device_info) VALUES($1,'Synthetic live receiver',$2)`, [screen,{player_capabilities:{features:['live_broadcast_v1']}}]);
    await pool.query(`INSERT INTO device_certificates(screen_id,serial,certificate_pem,public_key_pem,expires_at) VALUES($1,$2,'synthetic-certificate-metadata',$3,(now() AT TIME ZONE 'UTC')+interval '1 day')`, [screen,serial,keys.publicKey]);
    await pool.query('INSERT INTO screen_groups(id,name) VALUES($1,$2)',[group,'Synthetic frozen group']);
    await pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)',[group,screen]);
    await pool.query(`INSERT INTO live_sessions(id,name,presenter_user_id,created_by,owner_scope,owner_department_id,microphone)
      VALUES($1,'Synthetic current owner source',$2,$3,'DEPARTMENT',$4,true)`,[sourceId,presenter.id,manager.id,departmentA]);
    await pool.query('INSERT INTO storage_objects(id,bucket,object_key,sha256,size,content_type) VALUES($1,$2,$3,$4,64,$5)',[object,'synthetic-cas',`live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`,'a'.repeat(64),'image/png']);
    const asset = { id:assetId,media_id:assetId,storage_object_id:object,bucket:'synthetic-cas',object_key:`live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`,
      sha256:'a'.repeat(64),size:64,content_type:'image/png',render_type:'image',representation:'READY',dependencies:[],cache_key:`live_${'a'.repeat(64)}_image` };
    const manifest = {version:1,presentation:{id:presentation,layout:null,items:[{id:randomUUID(),order:0,asset_id:assetId,duration_seconds:15}]},assets:[asset]};
    await pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph) VALUES($1,$2,$3,$4,'{}')`,[preparation,presentation,manager.id,'b'.repeat(64)]);
    await pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation)
      VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY')`,[preparation,assetId,object,'a'.repeat(64)]);
    await pool.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`,[preparation,manifest]);
    await pool.query('INSERT INTO schedule_snapshots(id,schedule_id,payload) VALUES($1,$2,$3)',[snapshot,schedule,{schedule:{id:schedule,items:[]}}]);
    await pool.query('INSERT INTO publishes(id,schedule_id,snapshot_id,published_by) VALUES($1,$2,$3,$4)',[publish,schedule,snapshot,manager.id]);
    const policy = {version:1,source_kind:'LIVE',schedule_id:schedule,schedule_item_id:item,schedule_revision:1,live_session_id:sourceId,
      presenter_user_id:presenter.id,policy_revision:1,microphone:true,screen_share_audio:false,start_at:start,end_at:end,priority:0,screen_ids:[screen],screen_group_ids:[group],
      fallback:{preparation_id:preparation,source_fingerprint:'b'.repeat(64),manifest}};
    const client=await pool.connect();
    try { await client.query('BEGIN');
      await client.query(`INSERT INTO live_schedule_occurrences(id,schedule_id,schedule_item_id,reservation_token,schedule_revision,owner_user_id,live_session_id,presenter_user_id,policy_revision,
        preparation_id,approval_fingerprint,item_fingerprint,frozen_policy,screen_ids,capacity_slot,start_at,end_at,state,publish_id,published_at)
        VALUES($1,$2,$3,$4,1,$5,$6,$7,1,$8,$9,$10,$11,$12,$13,$14,$15,'PUBLISHED',$16,(now() AT TIME ZONE 'UTC'))`,
      [id,schedule,item,randomUUID(),author.id,sourceId,presenter.id,preparation,'c'.repeat(64),'d'.repeat(64),policy,[screen],options.slot ?? 1,start,end,publish]);
      await client.query(`INSERT INTO live_occurrence_assets(occurrence_id,asset_id,media_id,storage_object_id,sha256,size,content_type,render_type,source_type,representation)
        VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY')`,[id,assetId,object,'a'.repeat(64)]);
      await client.query('COMMIT');
    } catch(error) {await client.query('ROLLBACK');throw error;}finally{client.release();}
    return { id,schedule,item,sourceId,preparation,presentation,assetId,object,publish,snapshot,screen,group,serial,policy,manifest };
  }
  const occurrencePath = (d:Data,suffix='')=>`/api/v1/live-occurrences/${d.id}${suffix}`;
  const startBody = (runtime=randomUUID())=>({request_id:randomUUID(),runtime_session_id:runtime,expected_authority_epoch:epoch,expected_control_revision:1,expected_item_fingerprint:'d'.repeat(64)});
  async function start(d:Data,body=startBody()) {const r=await invoke(presenter,'POST',occurrencePath(d,'/start'),body);expect(r.statusCode,r.body).toBe(202);return {body,result:r.json()};}
  async function pump(limit=4){for(let i=0;i<limit;i++)if(!await dispatchOneLiveMediaOperation())break;}
  async function presenterAdmission(d:Data,started:Awaited<ReturnType<typeof start>>){await pump();const r=await invoke(presenter,'POST',`/api/v1/live-runs/${started.result.run.id}/admissions`,{request_id:randomUUID(),runtime_session_id:started.body.runtime_session_id});expect(r.statusCode,r.body).toBe(202);return r.json();}
  async function scalar(sql:string,values:unknown[]=[]){return (await pool.query(sql,values)).rows[0];}
  const canonicalView = (fence:LiveMediaFence,entry?:{lease:number;window:number;state:string}):LiveMediaView=>({protocol_version:1,node_instance_id:node,authority_epoch:epoch,
    run_id:fence.run_id,generation:fence.generation,...(fence.id?{admission_id:fence.id}:{}),state:entry?.state ?? 'REVOKED',teardown_confirmed:entry?false:teardown,
    lease_ms:entry?Math.max(0,entry.lease-Date.now()):0,window_remaining_ms:entry?Math.max(0,entry.window-Date.now()):0});
  beforeAll(async()=>{
    fixture.directory=await mkdtemp(path.join(tmpdir(),'darshan-owned-live-runtime-'));
    await writeFile(path.join(fixture.directory,'authority.json'),JSON.stringify({version:1,epoch_id:epoch,authority_secret:authoritySecret}),{mode:0o600});
    await writeFile(path.join(fixture.directory,'control'),'synthetic-control-secret-0000000000000000',{mode:0o600});
    await writeFile(path.join(fixture.directory,'witness'),witnessSecret,{mode:0o600});
    keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    assertDedicatedTestDatabase(config.DATABASE_URL,'Read-only runtime fixture catalog');const url=new URL(config.DATABASE_URL);
    expect(['127.0.0.1','localhost','[::1]']).toContain(url.hostname);expect(url.port).toBe('55455');
    source=new Pool({connectionString:url.toString(),max:1,options:'-c default_transaction_read_only=on -c search_path=pg_catalog -c statement_timeout=5000'});
    url.pathname='/postgres';adminPool=new Pool({connectionString:url.toString(),max:1});url.pathname=`/${database}`;assertDedicatedTestDatabase(url.toString());
    await adminPool.query(`CREATE DATABASE ${quote(database)}`);created=true;
    pool=new Pool({connectionString:url.toString(),max:8,application_name:namespace,options:`-c search_path=${namespace} -c timezone=UTC -c statement_timeout=7000 -c lock_timeout=5000`});
    await pool.query(`CREATE SCHEMA ${quote(namespace)}`);expect((await pool.query('SHOW search_path')).rows[0].search_path).toBe(namespace);
    const enums=await source.query(`SELECT t.typname,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' GROUP BY t.typname`);
    for(const row of enums.rows)await pool.query(`CREATE TYPE ${quote(row.typname)} AS ENUM (${row.labels.map((v:string)=>`'${v.replace(/'/g,"''")}'`).join(',')})`);
    for(const table of ['roles','departments','users','sessions','user_additional_departments','storage_objects','media','presentations','presentation_items','presentation_slot_items','layouts','schedules','schedule_items','schedule_reservations','schedule_snapshots','publishes','screens','screen_groups','screen_group_members','device_certificates','device_auth_rollout_observations','device_commands','device_command_status_history','device_desired_state','device_desired_state_history','command_outbox','emergencies','audit_logs']){
      const columns=await source.query(`SELECT a.attname,format_type(a.atttypid,a.atttypmod) type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_sql FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[table]);
      expect(columns.rows.length).toBeGreaterThan(0);const excluded=table==='schedule_items'?new Set(['source_kind','live_session_id']):table.startsWith('device_desired_state')?new Set(['live_version']):new Set<string>();
      const definitions=columns.rows.filter(r=>!excluded.has(r.attname)).map(r=>{if(/\bnextval\s*\(/i.test(r.default_sql??''))throw Error('External sequence refused');return`${quote(r.attname)} ${localize(r.type)}${r.attnotnull?' NOT NULL':''}${r.default_sql?` DEFAULT ${localize(r.default_sql)}`:''}`;});
      const checks=await source.query(`SELECT con.conname,pg_get_constraintdef(con.oid) definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND con.contype IN ('p','u','c')`,[table]);
      for(const r of checks.rows)if(![...excluded].some(c=>new RegExp(`\\b${c}\\b`).test(r.definition)))definitions.push(`CONSTRAINT ${quote(r.conname)} ${localize(r.definition)}`);
      await pool.query(`CREATE TABLE ${quote(table)} (${definitions.join(',')})`);
    }
    await pool.query(`CREATE EXTENSION btree_gist WITH SCHEMA ${quote(namespace)}`);
    for(const migration of ['0057_live_broadcast_sessions.sql','0058_live_scheduling.sql','0059_device_desired_live_version.sql','0060_live_runtime_authority.sql']){
      const client=await pool.connect();try{await client.query('BEGIN');await client.query(await readFile(new URL(`../../drizzle/migrations/${migration}`,import.meta.url),'utf8'));await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
    await pool.query('CREATE UNIQUE INDEX runtime_command_idempotency ON device_commands(screen_id,idempotency_key) WHERE idempotency_key IS NOT NULL');
    fixture.db=drizzle(pool,{schema:tables});await pool.query('INSERT INTO departments(id,name) VALUES($1,$2),($3,$4)',[departmentA,'Synthetic A',departmentB,'Synthetic B']);
    manager=await user('SYNTHETIC_LIVE_MANAGER',[{action:'manage',subject:'LiveBroadcast',conditions:{created_by:'$user.id'}}],departmentA);
    presenter=await user('SYNTHETIC_LIVE_PRESENTER',presenterGrants,departmentA);foreign=await user('SYNTHETIC_FOREIGN_PRESENTER',presenterGrants,departmentB);author=await user('SYNTHETIC_PUBLICATION_AUTHOR',[],departmentB);
    fixture.media={discover:async()=>({protocol_version:1,node_instance_id:node,managed_instance_id:managed,authority_epoch:epoch,authority_mode:'backend',accepting_new_runs:true,status:'ready',isolation_complete:false,active_admissions:entries.size,occupied_runs:new Set([...entries.values()].map(x=>x.fence.run_id)).size,tracked_remaining:10000,pending_authority_checks:0,pending_check_limit:512}),
      perform:async(kind:string,fence:LiveMediaFence)=>{
        if(fence.node_instance_id!==node||fence.authority_epoch!==epoch)throw liveError('LIVE_MEDIA_FENCE_MISMATCH','Synthetic node changed.',503);
        if(kind==='CREATE'||kind==='RENEW'||kind==='TICKET'){
          const check={action:kind,nonce:randomBytes(32).toString('base64url'),id:fence.id!,run_id:fence.run_id,generation:fence.generation,node_instance_id:node,authority_epoch:epoch,operation_revision:fence.operation_revision};
          const response=await server.inject({method:'POST',url:'/api/v1/internal/live-authority',headers:{'x-darshan-live-authority-secret':authoritySecret},payload:check});
          if(response.statusCode!==200||response.json().allowed!==true)throw liveError('LIVE_MEDIA_DENIED','Fresh DB authority refused.',409);
          const grant=response.json(),entry={fence,lease:Date.now()+grant.lease_ms,window:Date.now()+grant.window_remaining_ms,state:kind==='TICKET'?'ISSUED':'IDLE'};
          if(kind==='CREATE'){creates++;entries.set(fence.id!,entry);if(loseCreate){loseCreate=false;throw liveError('LIVE_MEDIA_UNAVAILABLE','Synthetic lost response.',503);}}
          else entries.set(fence.id!,entry);
          return {...canonicalView(fence,entry),...(kind==='TICKET'?{ticket:`synthetic-transient-signaling-ticket-${++tickets}`,signal_url:'wss://127.0.0.1:19998'}:{})};
        }
        if(kind==='ADMISSION_STATUS'){const entry=entries.get(fence.id!);if(!entry)throw liveError('LIVE_MEDIA_NOT_FOUND','Synthetic absence.',404);return canonicalView(fence,entry);}
        if(kind==='REVOKE_RUN'){if(teardown)for(const [id,entry] of entries)if(entry.fence.run_id===fence.run_id)entries.delete(id);return canonicalView(fence);}
        if(kind==='REVOKE_ADMISSION'){if(teardown)entries.delete(fence.id!);return canonicalView(fence);}
        return canonicalView(fence);
      }};
    fixture.sign.mockImplementation(async()=> 'https://synthetic-artifact.example.test/exact');
    server=Fastify({logger:false});server.setErrorHandler((error,_request,reply)=>{const safe=toAppError(error);reply.code(safe.statusCode).send(formatErrorResponse(safe));});
    server.get<{Params:{deviceId:string}}>('/test-owned/ordinary-device-identity/:deviceId',async(request)=>{
      const identity=await authenticateDeviceOrThrow(request,request.params.deviceId);return{type:identity.type,auth_method:request.device?.authMethod};});
    server.get<{Params:{deviceId:string}}>('/test-owned/forced-device-identity/:deviceId',async(request)=>{
      const identity=await authenticateDeviceOrThrow(request,request.params.deviceId,{allowUserToken:true,requireSignature:true});return{type:identity.type,auth_method:request.device?.authMethod};});
    await server.register(liveRuntimeRoutes);await server.ready();
  },30000);
  beforeEach(async()=>{fixture.enabled=true;entries.clear();creates=0;tickets=0;teardown=true;loseCreate=false;node=randomUUID();managed=randomUUID();fixture.sign.mockReset();fixture.sign.mockResolvedValue('https://synthetic-artifact.example.test/exact');
    await pool.query('TRUNCATE live_schedule_occurrences CASCADE');await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:presenterGrants}]);
    await pool.query('UPDATE users SET is_active=true,deleted_at=NULL,department_id=$2 WHERE id=$1',[presenter.id,departmentA]);
    await pool.query(`INSERT INTO sessions(user_id,access_jti,expires_at) SELECT $1::uuid,$2::varchar(255),(now() AT TIME ZONE 'UTC')+interval '1 hour'
      WHERE NOT EXISTS(SELECT 1 FROM sessions WHERE access_jti=$2::varchar(255))`,[presenter.id,presenter.token]);
    await pool.query(`UPDATE sessions SET expires_at=(now() AT TIME ZONE 'UTC')+interval '1 hour' WHERE user_id=$1`,[presenter.id]);});
  afterAll(async()=>{await server?.close();await pool?.end();await source?.end();if(adminPool){if(created)await adminPool.query(`DROP DATABASE ${quote(database)}`);await adminPool.end();}if(fixture.directory)await rm(fixture.directory,{recursive:true,force:false});},15000);

  it('keeps runtime default-off without mutating durable state',async()=>{const d=await seed();fixture.enabled=false;const r=await invoke(presenter,'POST',occurrencePath(d,'/start'),startBody());expect(r.statusCode).toBe(503);expect(r.json().error.code).toBe('LIVE_RUNTIME_DISABLED');expect(await scalar('SELECT count(*)::int n FROM live_runs')).toEqual({n:0});});
  it('uses actual source ownership and assigned permission without granting library read; commits intents and versions atomically',async()=>{
    const d=await seed();expect((await invoke(presenter,'GET',occurrencePath(d))).statusCode).toBe(200);expect((await invoke(foreign,'POST',occurrencePath(d,'/start'),startBody())).statusCode).toBe(403);
    await pool.query(`INSERT INTO device_desired_state(screen_id,snapshot_id,default_media_version,emergency_version) VALUES($1,$2,'default-kept','emergency-kept')`,[d.screen,randomUUID()]);
    const value=await start(d);expect(value.result.run.state).toBe('PREPARING');expect(value.result.run.generation).toBe(1);
    expect(await scalar(`SELECT (SELECT count(*)::int FROM live_runs) runs,(SELECT count(*)::int FROM live_admissions) admissions,(SELECT count(*)::int FROM live_media_operations) operations`)).toEqual({runs:1,admissions:1,operations:1});
    const state=await scalar('SELECT * FROM device_desired_state WHERE screen_id=$1',[d.screen]);expect(state).toMatchObject({default_media_version:'default-kept',emergency_version:'emergency-kept'});expect(state.live_version).toContain(value.result.run.id);
    expect(await scalar('SELECT count(*)::int n FROM command_outbox WHERE screen_id=$1',[d.screen])).toEqual({n:1});
  });
  it('preflights business, media and audience capacity without exposing media identity or creating runtime state',async()=>{
    const d=await seed(),url=occurrencePath(d,'/preflight')+`?runtime_session_id=${randomUUID()}`;
    let r=await invoke(presenter,'GET',url);expect(r.statusCode,r.body).toBe(200);
    expect(r.json()).toMatchObject({version:1,occurrence_id:d.id,authority_epoch:epoch,control_revision:1,
      item_fingerprint:'d'.repeat(64),business_eligible:true,media_ready:true,capacity_ready:true,ready:true,reason:'READY'});
    expect(r.json()).not.toHaveProperty('node_instance_id');expect(r.json()).not.toHaveProperty('tracked_remaining');
    expect(await scalar('SELECT count(*)::int n FROM live_runs')).toEqual({n:0});
    expect((await invoke(foreign,'GET',url)).statusCode).toBe(403);
    const discover=fixture.media.discover;
    try{
      fixture.media.discover=async()=>{throw Error('synthetic-private-media-detail');};
      r=await invoke(presenter,'GET',url);expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({ready:false,media_ready:false,capacity_ready:false,reason:'MEDIA_UNAVAILABLE'});
      expect(r.body).not.toContain('synthetic-private-media-detail');
      fixture.media.discover=async()=>({...await discover(),tracked_remaining:2});
      r=await invoke(presenter,'GET',url);expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({business_eligible:true,media_ready:true,capacity_ready:false,ready:false,reason:'MEDIA_CAPACITY'});
      fixture.media.discover=async()=>({...await discover(),accepting_new_runs:false});
      r=await invoke(presenter,'GET',url);expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({media_ready:false,capacity_ready:false,ready:false,reason:'MEDIA_PREPARING'});
    }finally{fixture.media.discover=discover;}
  });
  it('serializes concurrent identical starts and rejects stale/body-changed intent without duplicate runs',async()=>{const d=await seed(),body=startBody();
    const results=await Promise.all([invoke(presenter,'POST',occurrencePath(d,'/start'),body),invoke(presenter,'POST',occurrencePath(d,'/start'),body)]);expect(results.map(r=>r.statusCode)).toEqual([202,202]);expect(results[0].json().run.id).toBe(results[1].json().run.id);
    const conflict=await invoke(presenter,'POST',occurrencePath(d,'/start'),{...body,expected_item_fingerprint:'e'.repeat(64)});expect(conflict.statusCode).toBe(409);expect(conflict.json().error.code).toBe('LIVE_IDEMPOTENCY_CONFLICT');expect(await scalar('SELECT count(*)::int n FROM live_runs')).toEqual({n:1});
  });
  it('returns the same recorded run after a lost start response even if media health is now unavailable',async()=>{const d=await seed(),first=await start(d),original=fixture.media.discover;
    fixture.media.discover=async()=>{throw liveError('LIVE_MEDIA_UNAVAILABLE','Synthetic partition',503);};try{const replay=await invoke(presenter,'POST',occurrencePath(d,'/start'),first.body);expect(replay.statusCode,replay.body).toBe(202);expect(replay.json().run.id).toBe(first.result.run.id);expect(replay.json().idempotent).toBe(true);}finally{fixture.media.discover=original;}
  });
  it('recovers a lost CREATE response by matching evidence without replaying its grant or storing its ticket',async()=>{const d=await seed(),first=await start(d);loseCreate=true;await pump(1);expect((await scalar('SELECT state FROM live_runs WHERE id=$1',[first.result.run.id])).state).toBe('PREPARING');
    await pool.query(`UPDATE live_media_operations SET available_at=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PENDING'`);await pump(1);expect((await scalar('SELECT state FROM live_runs WHERE id=$1',[first.result.run.id])).state).toBe('RUNNING');expect(creates).toBe(1);
    const dump=await pool.query(`SELECT to_jsonb(t)::text value FROM live_media_operations t UNION ALL SELECT to_jsonb(t)::text FROM live_runtime_receipts t`);expect(JSON.stringify(dump.rows)).not.toContain('synthetic-transient-signaling-ticket');
  });
  it('keeps approved presenter/audio/availability after future source edits and refuses a different document',async()=>{const d=await seed(),first=await start(d);const admission=await presenterAdmission(d,first);
    await pool.query('UPDATE live_sessions SET presenter_user_id=$2,microphone=false,is_active=false,policy_revision=2,revision=2 WHERE id=$1',[d.sourceId,manager.id]);
    const body={request_id:randomUUID(),runtime_session_id:first.body.runtime_session_id,run_id:first.result.run.id,generation:1};
    const response=await invoke(presenter,'POST',`/api/v1/live-admissions/${admission.admission_id}/ticket`,body);expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({microphone:true,screen_share_audio:false,presenter_user_id:presenter.id});
    expect(response.json().signaling.ticket).toMatch(/^synthetic-transient-signaling-ticket-/);expect(response.json().lease_ms).toBeLessThanOrEqual(10000);
    const other=await invoke(presenter,'POST',`/api/v1/live-admissions/${admission.admission_id}/renew`,{...body,request_id:randomUUID(),runtime_session_id:randomUUID()});expect(other.statusCode).toBe(410);
  });
  it('admin stop disables attempts until explicit re-enable and matching teardown; old cleanup cannot alter replacement',async()=>{const d=await seed(),first=await start(d);await pump();teardown=false;
    const stop={request_id:randomUUID(),expected_control_revision:2,reason:'Synthetic admin stop',mode:'ADMIN',run_id:first.result.run.id,generation:1};let r=await invoke(manager,'POST',occurrencePath(d,'/stop'),stop);expect(r.statusCode,r.body).toBe(202);expect(r.json().enabled).toBe(false);await pump(1);
    expect(await scalar('SELECT state,teardown_confirmed_at FROM live_runs WHERE id=$1',[first.result.run.id])).toEqual({state:'STOPPING',teardown_confirmed_at:null});
    r=await invoke(presenter,'POST',occurrencePath(d,'/start'),{...startBody(),expected_control_revision:3});expect(r.statusCode).toBe(409);
    r=await invoke(manager,'POST',occurrencePath(d,'/enable'),{request_id:randomUUID(),expected_control_revision:3,reason:'Synthetic re-enable'});expect(r.statusCode,r.body).toBe(200);expect(r.json().run.state).toBe('STOPPING');expect(await scalar('SELECT count(*)::int n FROM live_runs')).toEqual({n:1});
    teardown=true;await pool.query(`UPDATE live_media_operations SET available_at=(now() AT TIME ZONE 'UTC')-interval '1 second' WHERE state='PENDING'`);await pump();
    const current=(await invoke(presenter,'GET',occurrencePath(d))).json();const second=await start(d,{...startBody(),expected_control_revision:current.control_revision});expect(second.result.run.id).not.toBe(first.result.run.id);expect(second.result.run.generation).toBe(2);
    const replay=await invoke(manager,'POST',occurrencePath(d,'/stop'),stop);expect(replay.statusCode,replay.body).toBe(202);expect(replay.json().run.id).toBe(first.result.run.id);expect((await scalar('SELECT state FROM live_runs WHERE id=$1',[second.result.run.id])).state).toBe('PREPARING');
  });
  it('presenter stop requires its document and permits only a new explicit attempt after teardown',async()=>{const d=await seed(),first=await start(d);await pump();
    const body={request_id:randomUUID(),expected_control_revision:2,mode:'PRESENTER',reason:'Synthetic presenter stop',run_id:first.result.run.id,generation:1,runtime_session_id:randomUUID()};
    expect((await invoke(presenter,'POST',occurrencePath(d,'/stop'),body)).statusCode).toBe(409);const stopped=await invoke(presenter,'POST',occurrencePath(d,'/stop'),{...body,runtime_session_id:first.body.runtime_session_id});expect(stopped.statusCode,stopped.body).toBe(202);expect(stopped.json().enabled).toBe(true);await pump();expect(await scalar('SELECT count(*)::int n FROM live_runs')).toEqual({n:1});
  });
  it('rechecks current presenter grants and queues revocation without a replayable durable renew grant',async()=>{const d=await seed(),first=await start(d),admission=await presenterAdmission(d,first);
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:[]}]);
    const check={action:'RENEW',nonce:randomBytes(32).toString('base64url'),id:admission.admission_id,run_id:first.result.run.id,generation:1,node_instance_id:node,authority_epoch:epoch,operation_revision:1};
    const denied=await server.inject({method:'POST',url:'/api/v1/internal/live-authority',headers:{'x-darshan-live-authority-secret':authoritySecret},payload:check});expect(denied.statusCode,denied.body).toBe(200);expect(denied.json().allowed).toBe(false);expect(denied.json()).not.toHaveProperty('lease_ms');
    expect((await scalar('SELECT state FROM live_admissions WHERE id=$1',[admission.admission_id])).state).toBe('REVOKING');await reconcileLiveRuntime();expect((await scalar('SELECT state FROM live_runs WHERE id=$1',[first.result.run.id])).state).toBe('STOPPING');
  });
  it('excludes CMS bearer and serial-only identities, while genuine RSA epoch challenge and admission succeed',async()=>{const d=await seed(),first=await start(d);await pump();const runtime=randomUUID();
    const url=`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${runtime}`;
    expect((await invoke(manager,'GET',url)).statusCode).toBe(401);expect((await server.inject({method:'GET',url,headers:{'x-device-serial':d.serial}})).statusCode).toBe(401);
    const nonce=randomUUID(),challenge=await deviceInvoke(d,'POST',`/api/v1/device/${d.screen}/live-authority-epoch`,{nonce});expect(challenge.statusCode,challenge.body).toBe(200);expect(challenge.json()).toMatchObject({version:1,nonce,epoch_id:epoch});
    const discovery=await deviceInvoke(d,'GET',url);expect(discovery.statusCode,discovery.body).toBe(200);expect(discovery.json().current.state.publish_id).toBe(d.publish);
    const body={request_id:randomUUID(),runtime_session_id:runtime,publish_id:d.publish,schedule_item_id:d.item,run_id:first.result.run.id,generation:1,
      fallback:{preparation_id:d.preparation,source_fingerprint:'b'.repeat(64),asset_set_sha256:hashLiveFallbackAssetSet(d.manifest.assets),ready:true}};
    const admission=await deviceInvoke(d,'POST',`/api/v1/device/${d.screen}/live-admissions`,body);expect(admission.statusCode,admission.body).toBe(202);expect(admission.json()).not.toHaveProperty('lease_ms');await pump();
    const action={request_id:randomUUID(),runtime_session_id:runtime,run_id:first.result.run.id,generation:1,fallback:body.fallback};
    const ticket=await deviceInvoke(d,'POST',`/api/v1/device/${d.screen}/live-admissions/${admission.json().admission_id}/ticket`,action);expect(ticket.statusCode,ticket.body).toBe(200);expect(ticket.json()).toMatchObject({role:'receiver',presenter_participant_id:`presenter_${first.result.run.id}`});
    const renew=await deviceInvoke(d,'POST',`/api/v1/device/${d.screen}/live-admissions/${admission.json().admission_id}/renew`,{...action,request_id:randomUUID()});expect(renew.statusCode,renew.body).toBe(200);expect(renew.json()).not.toHaveProperty('signaling');
  });
  it('requires real RSA verification for LIVE under global legacy and preserves ordinary serial compatibility and configured-mode metrics',async()=>{
    const names=['DARSHAN_DEVICE_AUTH_MODE','HEXMON_DEVICE_AUTH_MODE','DEVICE_AUTH_MODE'] as const;
    const previous=names.map(name=>process.env[name]),metric=vi.spyOn(deviceAuthMetrics,'recordDeviceAuthAttempt');
    for(const name of names)process.env[name]='legacy';
    try{
      expect(resolveDeviceAuthMode()).toBe('legacy');const d=await seed(),url=`/api/v1/device/${d.screen}/live-authority-epoch`,body={nonce:randomUUID()};
      const count=()=>scalar(`SELECT (SELECT count(*)::int FROM live_admissions) admissions,(SELECT count(*)::int FROM live_runtime_receipts) receipts,
        (SELECT count(*)::int FROM live_media_operations) operations,(SELECT count(*)::int FROM device_commands) commands,(SELECT count(*)::int FROM command_outbox) outbox`);
      const baseline=await count();
      const valid=await deviceInvoke(d,'POST',url,body);expect(valid.statusCode,valid.body).toBe(200);expect(valid.json().nonce).toBe(body.nonce);
      expect(metric).toHaveBeenCalledWith({configuredMode:'legacy',authMethod:'signature',result:'success',reason:'authorized'});
      const signedObservation=await scalar('SELECT last_signed_http_at IS NOT NULL AS signed,last_legacy_http_at IS NULL AS legacy_absent FROM device_auth_rollout_observations WHERE screen_id=$1',[d.screen]);
      expect(signedObservation).toEqual({signed:true,legacy_absent:true});
      const invalid=await deviceInvoke(d,'POST',url,body,{'x-device-signature':randomBytes(256).toString('base64'),authorization:`Bearer ${manager.token}`});
      expect(invalid.statusCode,invalid.body).toBe(403);expect(invalid.json().error.details.reason).toBe('DEVICE_SIGNATURE_INVALID');
      expect(metric).toHaveBeenCalledWith({configuredMode:'legacy',authMethod:'signature',result:'failure',reason:'device_signature_invalid'});
      expect((await deviceInvoke(d,'POST',url,body,{'x-device-timestamp':''})).statusCode).toBe(401);
      expect((await server.inject({method:'POST',url,payload:body,headers:{'x-device-serial':d.serial}})).statusCode).toBe(401);
      expect((await invoke(manager,'POST',url,body)).statusCode).toBe(401);
      const forced=`/test-owned/forced-device-identity/${d.screen}`;
      const forcedFallback=await server.inject({method:'GET',url:forced,headers:{authorization:`Bearer ${manager.token}`}});
      expect(forcedFallback.statusCode,forcedFallback.body).toBe(401);
      const ordinary=await server.inject({method:'GET',url:`/test-owned/ordinary-device-identity/${d.screen}`,headers:{'x-device-serial':d.serial}});
      expect(ordinary.statusCode,ordinary.body).toBe(200);expect(ordinary.json()).toEqual({type:'device',auth_method:'legacy_serial'});
      const forcedValid=await deviceInvoke(d,'GET',forced);expect(forcedValid.statusCode,forcedValid.body).toBe(200);expect(forcedValid.json().auth_method).toBe('signature');
      await pool.query("UPDATE device_certificates SET is_revoked=true,revoked_at=(now() AT TIME ZONE 'UTC') WHERE screen_id=$1 AND serial=$2",[d.screen,d.serial]);
      const revoked=await deviceInvoke(d,'POST',url,body);expect(revoked.statusCode,revoked.body).toBe(403);expect(revoked.json().error.details.reason).toBe('DEVICE_CREDENTIALS_REVOKED');
      expect(await count()).toEqual(baseline);
    }finally{metric.mockRestore();names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];});}
  });
  it('orders server-received observations and never equates connection with first frame',async()=>{const d=await seed(),first=await start(d);await pump();const runtime=randomUUID(),body={request_id:randomUUID(),runtime_session_id:runtime,publish_id:d.publish,schedule_item_id:d.item,run_id:first.result.run.id,generation:1,fallback:{preparation_id:d.preparation,source_fingerprint:'b'.repeat(64),asset_set_sha256:hashLiveFallbackAssetSet(d.manifest.assets),ready:true}};
    const admission=(await deviceInvoke(d,'POST',`/api/v1/device/${d.screen}/live-admissions`,body)).json();await pump();const url=`/api/v1/device/${d.screen}/live-admissions/${admission.admission_id}/observations`,observation={runtime_session_id:runtime,run_id:first.result.run.id,generation:1,sequence:10,connection:'CONNECTED',subscription:'SUBSCRIBED',frame:'NONE',audio:'NONE',fallback_ready:true,fallback_reason:null};
    let r=await deviceInvoke(d,'POST',url,observation);expect(r.statusCode,r.body).toBe(200);expect(r.json().accepted).toBe(true);r=await deviceInvoke(d,'POST',url,{...observation,sequence:9,frame:'READY'});expect(r.json().accepted).toBe(false);expect(await scalar('SELECT sequence,connection,frame FROM live_admission_observations WHERE admission_id=$1',[admission.admission_id])).toMatchObject({sequence:'10',connection:'CONNECTED',frame:'NONE'});
  });
  it('discovers frozen current/next independently of latest ordinary publish or current group membership',async()=>{const d=await seed(),future=await seed({screen:d.screen,start:Date.now()+1_800_000,end:Date.now()+2_400_000});
    await pool.query('DELETE FROM screen_group_members WHERE group_id=$1',[d.group]);await pool.query('INSERT INTO schedule_snapshots(id,schedule_id,payload) VALUES($1,$2,$3)',[randomUUID(),randomUUID(),{ordinary:true}]);
    const r=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(r.statusCode,r.body).toBe(200);expect(r.json().current.state.publish_id).toBe(d.publish);expect(r.json().next.state.publish_id).toBe(future.publish);expect(r.json().current.item.resolved_screen_ids).toEqual([d.screen]);
  });
  it('retains the current approved window when signing fails or its static fallback is corrupt',async()=>{const d=await seed();fixture.sign.mockRejectedValueOnce(Error('Synthetic storage offline'));
    let r=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(r.statusCode,r.body).toBe(200);expect(r.json().current.state.occurrence_id).toBe(d.id);expect(r.json().current.item.live_fallback_download_status).toBe('UNAVAILABLE');
    await pool.query('ALTER TABLE live_schedule_occurrences DISABLE TRIGGER live_occurrence_freeze');try{await pool.query(`UPDATE live_schedule_occurrences SET frozen_policy=jsonb_set(frozen_policy,'{fallback,manifest}','{}') WHERE id=$1`,[d.id]);}finally{await pool.query('ALTER TABLE live_schedule_occurrences ENABLE TRIGGER live_occurrence_freeze');}
    r=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(r.statusCode,r.body).toBe(200);expect(r.json().current).toMatchObject({state:{occurrence_id:d.id,policy_status:'INVALID',policy:null,screen_ids:[d.screen]},item:null});
  });
  it('rechecks identity after presigning and returns no URLs after certificate revocation',async()=>{const d=await seed();fixture.sign.mockImplementationOnce(async()=>{await pool.query('UPDATE device_certificates SET is_revoked=true WHERE serial=$1',[d.serial]);return'https://synthetic-artifact.example.test/exact';});
    const r=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(r.statusCode,r.body).toBe(403);expect(r.body).not.toContain('synthetic-artifact');
  });
  it('returns blocking validated windows for conflicting current occurrences instead of ordinary fallback',async()=>{const d=await seed();const other=await seed({screen:d.screen,slot:2});
    const r=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(r.statusCode,r.body).toBe(200);expect(r.json().current).toBeNull();expect(r.json().blocked_windows.map((w:any)=>w.occurrence_id).sort()).toEqual([d.id,other.id].sort());
  });
  it('durably records a boundary and wake notification once, with REST recovery independent of missed notification',async()=>{const d=await seed();await reconcileLiveWindowBoundaries();await reconcileLiveWindowBoundaries();
    expect(await scalar(`SELECT count(*)::int n FROM device_commands WHERE screen_id=$1 AND payload->>'reason'='LIVE_WINDOW_STARTED'`,[d.screen])).toEqual({n:1});expect((await scalar('SELECT start_notified_at IS NOT NULL notified FROM live_occurrence_controls WHERE occurrence_id=$1',[d.id])).notified).toBe(true);
    const r=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(r.statusCode,r.body).toBe(200);expect(r.json().current.state.occurrence_id).toBe(d.id);
  });
  it('never releases old-node occupancy from replacement health alone; a separate matching host witness is required',async()=>{const d=await seed(),first=await start(d);await pump();const oldNode=node,oldManaged=managed;node=randomUUID();managed=randomUUID();await reconcileLiveRuntime();
    expect(await scalar('SELECT state,teardown_confirmed_at FROM live_runs WHERE id=$1',[first.result.run.id])).toEqual({state:'STOPPING',teardown_confirmed_at:null});
    const bad=await server.inject({method:'POST',url:'/api/v1/internal/live-media-witness',headers:{'x-darshan-live-authority-secret':authoritySecret},payload:{witness_id:randomUUID(),node_instance_id:oldNode,authority_epoch:epoch,managed_instance_id:oldManaged,process_start_ticks:'1234',reason:'PINNED_PROCESS_EXIT'}});expect(bad.statusCode).toBe(401);
    const r=await server.inject({method:'POST',url:'/api/v1/internal/live-media-witness',headers:{'x-darshan-live-witness-secret':witnessSecret},payload:{witness_id:randomUUID(),node_instance_id:oldNode,authority_epoch:epoch,managed_instance_id:oldManaged,process_start_ticks:'1234',reason:'PINNED_PROCESS_EXIT'}});expect(r.statusCode,r.body).toBe(200);expect((await scalar('SELECT state,teardown_confirmed_at IS NOT NULL confirmed FROM live_runs WHERE id=$1',[first.result.run.id]))).toEqual({state:'STOPPED',confirmed:true});
  });
  it('records a verified idle media boot so its physical-death witness can be acknowledged before any run',async()=>{
    await reconcileLiveRuntime();
    expect(await scalar('SELECT id,managed_instance_id,authority_epoch,accepting_new_runs,observed_dead_at FROM live_media_nodes WHERE id=$1',[node]))
      .toEqual({id:node,managed_instance_id:managed,authority_epoch:epoch,accepting_new_runs:true,observed_dead_at:null});
    const witnessId=randomUUID();
    const r=await server.inject({method:'POST',url:'/api/v1/internal/live-media-witness',headers:{'x-darshan-live-witness-secret':witnessSecret},payload:{witness_id:witnessId,node_instance_id:node,authority_epoch:epoch,managed_instance_id:managed,process_start_ticks:'5678',reason:'PINNED_PROCESS_EXIT'}});
    expect(r.statusCode,r.body).toBe(200);expect(r.json()).toEqual({accepted:true,node_instance_id:node});
    expect(await scalar('SELECT accepting_new_runs,observed_dead_at IS NOT NULL dead,death_witness_id FROM live_media_nodes WHERE id=$1',[node]))
      .toEqual({accepting_new_runs:false,dead:true,death_witness_id:witnessId});
  });
  it('accepts an authenticated current-epoch death witness racing the first health sample and fences reuse',async()=>{
    const witnessId=randomUUID();
    const r=await server.inject({method:'POST',url:'/api/v1/internal/live-media-witness',headers:{'x-darshan-live-witness-secret':witnessSecret},payload:{witness_id:witnessId,node_instance_id:node,authority_epoch:epoch,managed_instance_id:managed,process_start_ticks:'9012',reason:'PINNED_PROCESS_EXIT'}});
    expect(r.statusCode,r.body).toBe(200);expect(r.json()).toEqual({accepted:true,node_instance_id:node});
    expect(await scalar('SELECT managed_instance_id,accepting_new_runs,observed_dead_at IS NOT NULL dead,death_witness_id FROM live_media_nodes WHERE id=$1',[node]))
      .toEqual({managed_instance_id:managed,accepting_new_runs:false,dead:true,death_witness_id:witnessId});
    await reconcileLiveRuntime();
    expect(await scalar('SELECT accepting_new_runs,observed_dead_at IS NOT NULL dead,death_witness_id FROM live_media_nodes WHERE id=$1',[node]))
      .toEqual({accepting_new_runs:false,dead:true,death_witness_id:witnessId});
  });
  it('never rewrites an observed media boot when the same node UUID claims another managed instance',async()=>{
    const originalManaged=managed;await reconcileLiveRuntime();managed=randomUUID();await reconcileLiveRuntime();
    expect(await scalar('SELECT managed_instance_id,observed_dead_at FROM live_media_nodes WHERE id=$1',[node]))
      .toEqual({managed_instance_id:originalManaged,observed_dead_at:null});
    const r=await server.inject({method:'POST',url:'/api/v1/internal/live-media-witness',headers:{'x-darshan-live-witness-secret':witnessSecret},payload:{witness_id:randomUUID(),node_instance_id:node,authority_epoch:epoch,managed_instance_id:managed,process_start_ticks:'5678',reason:'PINNED_PROCESS_EXIT'}});
    expect(r.statusCode,r.body).toBe(409);expect(r.json().error.code).toBe('LIVE_WITNESS_FENCE_MISMATCH');
  });
  it('filters taken-down publications and disables start on their historical diagnostic summary',async()=>{const d=await seed();
    await pool.query("UPDATE publishes SET status='TAKEN_DOWN',taken_down_at=(now() AT TIME ZONE 'UTC') WHERE id=$1",[d.publish]);
    const detail=await invoke(presenter,'GET',occurrencePath(d));expect(detail.statusCode,detail.body).toBe(200);expect(detail.json().can_start).toBe(false);
    const preflight=await invoke(presenter,'GET',occurrencePath(d,'/preflight'));expect(preflight.statusCode,preflight.body).toBe(200);
    expect(preflight.json()).toMatchObject({business_eligible:false,media_ready:false,capacity_ready:false,ready:false,reason:'OCCURRENCE_UNAVAILABLE'});
    const list=await invoke(presenter,'GET','/api/v1/live-occurrences');expect(list.statusCode,list.body).toBe(200);expect(list.json()).toMatchObject({items:[],total:0,page:1,page_size:25});
  });
  it('uses the same conditional SQL scope for paginated rows and totals',async()=>{await seed();await seed({slot:2});
    const list=await invoke(presenter,'GET','/api/v1/live-occurrences?page=1&page_size=1');expect(list.statusCode,list.body).toBe(200);expect(list.json().items).toHaveLength(1);expect(list.json().total).toBe(2);
    const denied=await invoke(foreign,'GET','/api/v1/live-occurrences?page=1&page_size=1');expect(denied.statusCode,denied.body).toBe(200);expect(denied.json()).toMatchObject({items:[],total:0});
  });
  it('rolls back run, admission, operation, receipt and desired intent when command publication fails',async()=>{const d=await seed();
    await pool.query(`CREATE FUNCTION fail_runtime_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Owned atomicity fault' USING ERRCODE='23514'; END $$`);
    await pool.query('CREATE TRIGGER fail_runtime_command BEFORE INSERT ON device_commands FOR EACH ROW EXECUTE FUNCTION fail_runtime_command()');
    try{const r=await invoke(presenter,'POST',occurrencePath(d,'/start'),startBody());expect(r.statusCode).toBeGreaterThanOrEqual(500);
      expect(await scalar(`SELECT (SELECT count(*)::int FROM live_runs) runs,(SELECT count(*)::int FROM live_admissions) admissions,
        (SELECT count(*)::int FROM live_media_operations) operations,(SELECT count(*)::int FROM live_runtime_receipts) receipts,
        (SELECT count(*)::int FROM live_occurrence_controls) controls`)).toEqual({runs:0,admissions:0,operations:0,receipts:0,controls:0});
    }finally{await pool.query('DROP TRIGGER fail_runtime_command ON device_commands');await pool.query('DROP FUNCTION fail_runtime_command()');}
  });
  it('locks the other presenter session before a target lock, so logout cannot pass an authorized admin mutation',async()=>{const d=await seed(),first=await start(d);await pump();const barrier=await pool.connect();
    let request:Promise<any>|undefined,deletion:Promise<any>|undefined,deleted=false;
    try{await barrier.query('BEGIN');await barrier.query("SELECT pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'))");
      request=invoke(manager,'POST',occurrencePath(d,'/stop'),{request_id:randomUUID(),expected_control_revision:2,mode:'ADMIN',reason:'Synthetic session-lock race',run_id:first.result.run.id,generation:1});
      const until=Date.now()+2000;while(Date.now()<until){if((await scalar(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%darshan_screen_target_references_v1%'`,[namespace])).n)break;await new Promise(r=>setTimeout(r,10));}
      expect((await scalar(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%darshan_screen_target_references_v1%'`,[namespace])).n).toBeGreaterThan(0);
      deletion=pool.query('DELETE FROM sessions WHERE access_jti=$1',[presenter.token]).then(()=>{deleted=true;});await new Promise(r=>setTimeout(r,30));expect(deleted).toBe(false);
      await barrier.query('COMMIT');const response=await request;expect(response.statusCode,response.body).toBe(202);await deletion;expect(deleted).toBe(true);
    }finally{await barrier.query('ROLLBACK');barrier.release();await request;await deletion;}
  });
  it('retains ten runtime slots across ended scheduled windows without teardown proof',async()=>{
    for(let index=0;index<10;index++)await start(await seed({slot:index+1}));
    const time=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(time+1_800_000);
    try{const replacement=await seed({slot:1});const preflight=await invoke(presenter,'GET',occurrencePath(replacement,'/preflight'));
      expect(preflight.statusCode,preflight.body).toBe(200);expect(preflight.json()).toMatchObject({media_ready:true,capacity_ready:false,ready:false,reason:'RUNTIME_CAPACITY'});
      const r=await invoke(presenter,'POST',occurrencePath(replacement,'/start'),startBody());expect(r.statusCode,r.body).toBe(409);expect(r.json().error.code).toBe('LIVE_RUNTIME_CAPACITY');
      await reconcileLiveRuntime();expect(await scalar("SELECT count(*)::int n FROM live_runs WHERE state='STOPPING' AND teardown_confirmed_at IS NULL")).toEqual({n:10});
    }finally{clock.mockRestore();}
  });
  it('gives a fresh CMS epoch challenge to an active session without source grants or writes',async()=>{const nonce=randomUUID(),r=await invoke(author,'POST','/api/v1/live-authority-epoch',{nonce});
    expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({version:1,nonce,epoch_id:epoch});expect(await scalar('SELECT count(*)::int n FROM live_runs')).toEqual({n:0});
  });
  it('keeps renew/ticket requests fresh without growing durable receipts or replaying after revocation',async()=>{const d=await seed(),first=await start(d),admission=await presenterAdmission(d,first);
    const body={request_id:randomUUID(),runtime_session_id:first.body.runtime_session_id,run_id:first.result.run.id,generation:1},base=await scalar('SELECT count(*)::int n FROM live_runtime_receipts');
    const one=await invoke(presenter,'POST',`/api/v1/live-admissions/${admission.admission_id}/ticket`,body),two=await invoke(presenter,'POST',`/api/v1/live-admissions/${admission.admission_id}/ticket`,body);
    expect(one.statusCode,one.body).toBe(200);expect(two.statusCode,two.body).toBe(200);expect(two.json().signaling.ticket).not.toBe(one.json().signaling.ticket);
    for(let i=0;i<2;i++){const r=await invoke(presenter,'POST',`/api/v1/live-admissions/${admission.admission_id}/renew`,body);expect(r.statusCode,r.body).toBe(200);expect(r.json()).not.toHaveProperty('signaling');}
    expect(await scalar('SELECT count(*)::int n FROM live_runtime_receipts')).toEqual(base);
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:[]}]);
    for(const action of ['renew','ticket']){const r=await invoke(presenter,'POST',`/api/v1/live-admissions/${admission.admission_id}/${action}`,body);expect(r.statusCode,r.body).toBe(409);expect(r.body).not.toContain(one.json().signaling.ticket);expect(r.json()).not.toHaveProperty('lease_ms');}
    expect(await scalar('SELECT count(*)::int n FROM live_runtime_receipts')).toEqual(base);
  });
  it('preserves legacy empty-selector GLOBAL emergency precedence in discovery and admission',async()=>{const d=await seed(),first=await start(d);await pump();
    const emergency=randomUUID(),constraint=(await scalar("SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='emergencies'::regclass AND conname='emergencies_exactly_one_target_scope_check'")).definition;
    await pool.query('ALTER TABLE emergencies DROP CONSTRAINT emergencies_exactly_one_target_scope_check');
    try{await pool.query("INSERT INTO emergencies(id,message,target_all,screen_ids,screen_group_ids) VALUES($1,'Synthetic legacy global emergency',false,'[]','[]')",[emergency]);
      const runtime=randomUUID(),discovery=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${runtime}`);expect(discovery.statusCode,discovery.body).toBe(200);expect(discovery.json().current.state.availability).toBe('EMERGENCY');
      const r=await deviceInvoke(d,'POST',`/api/v1/device/${d.screen}/live-admissions`,{request_id:randomUUID(),runtime_session_id:runtime,publish_id:d.publish,schedule_item_id:d.item,run_id:first.result.run.id,generation:1,
        fallback:{preparation_id:d.preparation,source_fingerprint:'b'.repeat(64),asset_set_sha256:hashLiveFallbackAssetSet(d.manifest.assets),ready:true}});expect(r.statusCode,r.body).toBe(409);expect(r.json().error.code).toBe('LIVE_EMERGENCY_ACTIVE');
    }finally{await pool.query('DELETE FROM emergencies WHERE id=$1',[emergency]);await pool.query(`ALTER TABLE emergencies ADD CONSTRAINT emergencies_exactly_one_target_scope_check ${constraint}`);}
  });
  it('accepts the actual43-character media nonce and rejects malformed fresh grant requests',async()=>{const good={action:'CREATE',nonce:randomBytes(32).toString('base64url'),id:randomUUID(),run_id:randomUUID(),generation:1,node_instance_id:node,authority_epoch:epoch,operation_revision:1};expect(liveAuthorityCheckSchema.safeParse(good).success).toBe(true);expect(liveAuthorityCheckSchema.safeParse({...good,nonce:randomUUID()}).success).toBe(false);});
  it.each(['DANGLING','FOREIGN_OCCURRENCE','GENERATION','NULL_WITH_GENERATION','PRESENTER'] as const)(
    'rejects inconsistent control/run %s without granting or freeing capacity, while retaining approved discovery',async fault=>{
      const d=await seed(),first=await start(d),admission=await presenterAdmission(d,first);
      if(fault==='DANGLING')await pool.query('UPDATE live_occurrence_controls SET current_run_id=$2 WHERE occurrence_id=$1',[d.id,randomUUID()]);
      else if(fault==='FOREIGN_OCCURRENCE'){
        const other=await seed({slot:2}),second=await start(other);await pump();
        await pool.query('UPDATE live_occurrence_controls SET current_run_id=$2,generation=$3 WHERE occurrence_id=$1',[d.id,second.result.run.id,second.result.run.generation]);
      }else if(fault==='GENERATION')await pool.query('UPDATE live_occurrence_controls SET generation=generation+1 WHERE occurrence_id=$1',[d.id]);
      else if(fault==='NULL_WITH_GENERATION')await pool.query('UPDATE live_occurrence_controls SET current_run_id=NULL WHERE occurrence_id=$1',[d.id]);
      else{
        await pool.query('ALTER TABLE live_runs DISABLE TRIGGER live_run_binding_freeze');
        try{await pool.query('UPDATE live_runs SET presenter_user_id=$2 WHERE id=$1',[first.result.run.id,foreign.id]);}
        finally{await pool.query('ALTER TABLE live_runs ENABLE TRIGGER live_run_binding_freeze');}
      }
      const rows=()=>pool.query('SELECT id,state,operation_revision,teardown_confirmed_at FROM live_runs ORDER BY id'),before=(await rows()).rows;
      const denied=await invoke(presenter,'GET',occurrencePath(d));expect(denied.statusCode,denied.body).toBe(503);expect(denied.json().error.code).toBe('LIVE_RUNTIME_STATE_INCONSISTENT');
      const check={action:'RENEW',nonce:randomBytes(32).toString('base64url'),id:admission.admission_id,run_id:first.result.run.id,generation:1,node_instance_id:node,authority_epoch:epoch,operation_revision:1};
      const authority=await server.inject({method:'POST',url:'/api/v1/internal/live-authority',headers:{'x-darshan-live-authority-secret':authoritySecret},payload:check});
      expect(authority.statusCode,authority.body).toBe(503);expect(authority.json().error.code).toBe('LIVE_RUNTIME_STATE_INCONSISTENT');expect(authority.json()).not.toHaveProperty('lease_ms');
      const discovery=await deviceInvoke(d,'GET',`/api/v1/device/${d.screen}/live-occurrences?runtime_session_id=${randomUUID()}`);expect(discovery.statusCode,discovery.body).toBe(200);
      expect(discovery.json().current.state).toMatchObject({occurrence_id:d.id,availability:'UNAVAILABLE',policy_status:'VALID',run:null,start_at:d.policy.start_at,end_at:d.policy.end_at,screen_ids:[d.screen]});
      expect(discovery.json().current.item.live_policy).toEqual(d.policy);expect((await rows()).rows).toEqual(before);
    });
  it('fences pending Start/Stop/Enable intents across an external epoch rotation and reloaded authority process context',async()=>{const d=await seed(),pending=startBody();
    const counts=()=>scalar(`SELECT (SELECT count(*)::int FROM live_runs) runs,(SELECT count(*)::int FROM live_runtime_receipts) receipts,
      (SELECT count(*)::int FROM live_occurrence_controls) controls,(SELECT count(*)::int FROM live_media_operations) operations,
      (SELECT count(*)::int FROM device_commands) commands,(SELECT count(*)::int FROM command_outbox) outbox`);
    const before=await counts(),nextEpoch=randomUUID();await writeFile(path.join(fixture.directory,'authority.json'),JSON.stringify({version:1,epoch_id:nextEpoch,authority_secret:Buffer.alloc(32,8).toString('base64url')}));
    const oldProcess=await invoke(presenter,'POST',occurrencePath(d,'/start'),pending);expect(oldProcess.statusCode,oldProcess.body).toBe(503);expect(oldProcess.json().error.code).toBe('LIVE_AUTHORITY_EPOCH_CHANGED');
    vi.resetModules();const reloaded=await import('./live-runtime'),freshErrors=await import('@/utils/errors'),freshAppErrors=await import('@/utils/app-error');
    const fresh=Fastify({logger:false});fresh.setErrorHandler((error,_request,reply)=>{const safe=freshErrors.toAppError(error);reply.code(safe.statusCode).send(freshAppErrors.formatErrorResponse(safe));});
    try{await fresh.register(reloaded.liveRuntimeRoutes);await fresh.ready();
      for(const [who,action,body] of [[presenter,'start',pending],[manager,'stop',{request_id:randomUUID(),expected_control_revision:1,expected_authority_epoch:epoch,mode:'ADMIN',reason:'Old pending stop'}],
        [manager,'enable',{request_id:randomUUID(),expected_control_revision:1,expected_authority_epoch:epoch,reason:'Old pending enable'}]] as const){
        const r=await fresh.inject({method:'POST',url:occurrencePath(d,`/${action}`),headers:{authorization:`Bearer ${who.token}`},payload:body});expect(r.statusCode,r.body).toBe(409);expect(r.json().error.code).toBe('LIVE_AUTHORITY_EPOCH_CHANGED');expect(await counts()).toEqual(before);
      }
      const nonce=randomUUID(),challenge=await fresh.inject({method:'POST',url:'/api/v1/live-authority-epoch',headers:{authorization:`Bearer ${author.token}`},payload:{nonce}});expect(challenge.statusCode,challenge.body).toBe(200);expect(challenge.json()).toMatchObject({nonce,epoch_id:nextEpoch});
    }finally{await fresh.close();}
  });
});
