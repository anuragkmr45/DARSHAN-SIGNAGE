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
import { scheduleRequestRoutes } from './schedule-requests';
import { collectLiveFallbackPreparationSource, preloadLiveSchedulingHints, prepareLiveSchedule } from '@/services/live-scheduling';
import { withCurrentMutationAuthorization } from '@/auth/mutation-authorization';
import { lockScreenTargetReferences } from '@/services/screen-deletion-guard';
import { createScheduleReservationService } from '@/services/scheduling/reservation-service';
import { publishScheduleSnapshot } from './schedule-publish-helper';
import { eq } from 'drizzle-orm';
import { createMongoAbility, subject } from '@casl/ability';
import { createScheduleRequestRepository } from '@/db/repositories/schedule-request';
import { createScheduleRepository } from '@/db/repositories/schedule';

const fixture = vi.hoisted(() => ({ db: undefined as Database | undefined,
  tokens: new Map<string, { sub: string; jti: string; role_id: string; role: string; department_id: string | null; department_ids: string[] }>() }));
vi.mock('@/db', async () => ({ schema: await vi.importActual('@/db/schema'), getDatabase: () => fixture.db }));
// JWT decoding and postcommit device dispatch alone are replaced; current
// accounts/sessions, CASL, SQL locks, reservations and snapshots remain real.
vi.mock('@/services/playback-refresh-dispatch', () => ({ dispatchPlaybackRefresh: vi.fn(async () => undefined) }));
vi.mock('@/auth/jwt', () => ({
  extractTokenFromHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  verifyAccessToken: async (token: string) => {
    const payload = fixture.tokens.get(token); if (!payload) throw AppError.unauthorized(); return payload;
  },
}));

describe('LIVE publishing and approval against an independently owned PostgreSQL database', () => {
  const suffix = randomUUID().replace(/-/g, '');
  const database = `darshan_live_publishing_${suffix}_test`, namespace = `live_publishing_${suffix}_test`;
  let source: Pool, adminPool: Pool, pool: Pool, server: FastifyInstance, created = false;
  type User = { id: string; token: string; roleId: string; department: string | null };
  let admin: User, author: User, conditional: User;
  const departmentA = randomUUID(), departmentB = randomUUID();
  const start = '2045-01-01T10:00:00.000Z', end = '2045-01-01T11:00:00.000Z';
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const localize = (value: string) => value.replace(/\bpublic\./g, '');
  const invoke = (user: User, method: 'GET' | 'POST' | 'PATCH', path: string, payload?: unknown) => server.inject({
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


  let windowIndex = 0;
  type Data = Awaited<ReturnType<typeof seed>>;
  async function seed(options: { group?: boolean; ordinary?: boolean; presenter?: string; owner?: User; layout?: boolean } = {}) {
    const owner = options.owner ?? author;
    const schedule = randomUUID(), item = randomUUID(), presentation = randomUUID(), media = randomUUID(), object = randomUUID();
    const source = randomUUID(), entry = randomUUID(), screen = randomUUID(), group = options.group ? randomUUID() : undefined;
    const startAt = new Date(Date.UTC(2045,0,1 + windowIndex++,10)), endAt = new Date(startAt.getTime() + 3_600_000);
    await pool.query(`INSERT INTO schedules(id,name,start_at,end_at,created_by,owner_scope,owner_department_id)
      VALUES($1,'Synthetic publishing schedule',$2,$3,$4,'DEPARTMENT',$5)`, [schedule,startAt,endAt,owner.id,departmentA]);
    await pool.query(`INSERT INTO presentations(id,name,created_by,owner_scope,owner_department_id)
      VALUES($1,'Synthetic approved fallback',$2,'DEPARTMENT',$3)`, [presentation,owner.id,departmentA]);
    await pool.query(`INSERT INTO storage_objects(id,bucket,object_key,sha256,size,content_type)
      VALUES($1,'synthetic-live-source',$2,$3,64,'image/png')`, [object,`${object}.png`,'a'.repeat(64)]);
    await pool.query(`INSERT INTO media(id,name,type,status,created_by,owner_scope,owner_department_id,source_object_id,ready_object_id)
      VALUES($1,'Synthetic image','IMAGE','READY',$2,'DEPARTMENT',$3,$4,$4)`, [media,owner.id,departmentA,object]);
    await pool.query(`INSERT INTO presentation_items(id,presentation_id,media_id,"order",duration_seconds)
      VALUES($1,$2,$3,0,15)`,[entry,presentation,media]);
    if(options.layout){
      const layout=randomUUID();await pool.query(`INSERT INTO layouts(id,name,aspect_ratio,spec,created_by,owner_scope,owner_department_id)
        VALUES($1,'Synthetic landscape fallback','16:9',$2,$3,'DEPARTMENT',$4)`,[layout,{slots:[]},owner.id,departmentA]);
      await pool.query('UPDATE presentations SET layout_id=$2 WHERE id=$1',[presentation,layout]);
    }
    await pool.query(`INSERT INTO live_sessions(id,name,presenter_user_id,created_by,owner_scope,owner_department_id)
      VALUES($1,'Synthetic reusable source',$2,$3,'DEPARTMENT',$4)`,[source,options.presenter ?? admin.id,owner.id,departmentA]);
    await pool.query(`INSERT INTO screens(id,name,device_info) VALUES($1,'Synthetic capable player',$2)`,
      [screen,{player_capabilities:{features:['live_broadcast_v1']}}]);
    if(group){
      await pool.query(`INSERT INTO screen_groups(id,name) VALUES($1,'Synthetic target group')`,[group]);
      await pool.query(`INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)`,[group,screen]);
    }
    await pool.query(`INSERT INTO schedule_items(id,schedule_id,presentation_id,source_kind,live_session_id,start_at,end_at,screen_ids,screen_group_ids)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[item,schedule,presentation,options.ordinary?'PRESENTATION':'LIVE',options.ordinary?null:source,
        startAt,endAt,JSON.stringify(group?[]:[screen]),JSON.stringify(group?[group]:[])]);
    const collected = await fixture.db!.transaction(tx => collectLiveFallbackPreparationSource(admin.id,presentation,tx));
    const preparation=randomUUID(), frozenObject=randomUUID(), key=`live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`;
    await pool.query(`INSERT INTO storage_objects(id,bucket,object_key,sha256,size,content_type)
      VALUES($1,'synthetic-frozen-fallbacks',$2,$3,64,'image/png')`,[frozenObject,key,'a'.repeat(64)]);
    const asset={id:media,media_id:media,storage_object_id:frozenObject,bucket:'synthetic-frozen-fallbacks',object_key:key,
      sha256:'a'.repeat(64),size:64,content_type:'image/png',render_type:'image',representation:'READY',dependencies:[],cache_key:`live_${'a'.repeat(64)}_image`};
    const manifest={version:1,presentation:{id:presentation,layout:collected.source_graph.presentation.layout,
      items:collected.source_graph.presentation.items.map(({media_id,...value})=>({...value,asset_id:media_id}))},assets:[asset]};
    await pool.query(`INSERT INTO live_fallback_preparations(id,presentation_id,created_by,source_fingerprint,source_graph)
      VALUES($1,$2,$3,$4,$5)`,[preparation,presentation,admin.id,collected.source_fingerprint,collected.source_graph]);
    await pool.query(`INSERT INTO live_fallback_preparation_assets(preparation_id,asset_id,media_id,storage_object_id,sha256,size,content_type,
      render_type,source_type,representation,source_object_id,source_sha256,source_content_type)
      VALUES($1,$2,$2,$3,$4,64,'image/png','image','IMAGE','READY',$5,$4,'image/png')`,[preparation,media,frozenObject,'a'.repeat(64),object]);
    await pool.query(`UPDATE live_fallback_preparations SET state='READY',manifest=$2 WHERE id=$1`,[preparation,manifest]);
    return {schedule,item,presentation,media,object,source,entry,screen,group,preparation,manifest};
  }
  const prepIds=(d:Data)=>({[d.presentation]:d.preparation});
  const publishPath=(d:Data)=>`/api/v1/schedules/${d.schedule}/publish`;
  const reqPath=(id:string,suffix='')=>`/api/v1/schedule-requests/${id}${suffix}`;
  const counts=async()=> (await pool.query(`SELECT (SELECT count(*)::int FROM schedule_snapshots) snapshots,
    (SELECT count(*)::int FROM publishes) publishes,(SELECT count(*)::int FROM publish_targets) targets,
    (SELECT count(*)::int FROM schedule_requests) requests,(SELECT count(*)::int FROM schedule_reservations) reservations,
    (SELECT count(*)::int FROM live_schedule_occurrences) occurrences`)).rows[0];
  async function preflight(d:Data,user=admin,extra:Record<string,unknown>={}){
    return invoke(user,'POST','/api/v1/schedules/live-preflight',{schedule_id:d.schedule,fallback_preparation_ids:prepIds(d),...extra});
  }
  async function createRequest(d:Data,user=author){
    const r=await invoke(user,'POST','/api/v1/schedule-requests',{schedule_id:d.schedule,fallback_preparation_ids:prepIds(d)});
    expect(r.statusCode,r.body).toBe(201); return r.json();
  }
  async function approve(id:string){ const r=await invoke(admin,'POST',reqPath(id,'/approve'),{});expect(r.statusCode,r.body).toBe(200);return r.json(); }
  async function snapshot(id:string){return (await pool.query('SELECT payload FROM schedule_snapshots WHERE id=$1',[id])).rows[0].payload;}
  async function waitForLock(){
    const deadline=Date.now()+2000;
    while(Date.now()<deadline){
      if((await pool.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND datname=$2 AND wait_event_type='Lock'`,[namespace,database])).rows[0].n)return;
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw new Error('Expected an actual test-owned PostgreSQL lock wait');
  }
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
      'presentation_slot_items', 'layouts', 'media', 'screens', 'screen_groups', 'screen_group_members', 'audit_logs', 'storage_objects', 'screen_display_states', 'system_logs']) {
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
    admin = await makeUser('SUPER_ADMIN', [], departmentA);
    const grants = [{ action: 'create', subject: 'ScheduleRequest' }, { action: 'read', subject: 'ScheduleRequest' }, { action: 'read', subject: 'Schedule' }, { action: 'update', subject: 'Schedule' },
      ...['Presentation', 'Media', 'Layout', 'Screen', 'ScreenGroup'].map(subject => ({ action: 'read', subject }))];
    author = await makeUser('SYNTHETIC_LIVE_AUTHOR', [...grants, { action: 'read', subject: 'LiveBroadcast' }, { action: 'publish', subject: 'LiveBroadcast' }], departmentA);
    conditional = await makeUser('SYNTHETIC_BOUND_READER', [...grants, { action: 'read', subject: 'LiveBroadcast' }, { action: 'publish', subject: 'LiveBroadcast' }, { action: 'publish', subject: 'ScheduleRequest', conditions: { requested_by: '$user.id' } }], departmentA);
    server = Fastify({ logger: false });
    server.setErrorHandler((error, _request, reply) => { const safe = toAppError(error); reply.code(safe.statusCode).send(formatErrorResponse(safe)); });
    await server.register(scheduleRoutes); await server.register(scheduleRequestRoutes); await server.ready();
  }, 30_000);

  afterAll(async () => {
    await server?.close(); await pool?.end(); await source?.end();
    if (adminPool) { if (created) await adminPool.query(`DROP DATABASE ${quote(database)}`); await adminPool.end(); }
  }, 15_000);


  it('preflights immutable policy through the real HTTP route without writes or admission tokens',async()=>{
    const d=await seed(), before=await counts(),r=await preflight(d,author);
    expect(r.statusCode,r.body).toBe(200); const data=r.json();
    expect(data).toMatchObject({schedule_id:d.schedule,schedule_revision:1,items:[{source_kind:'LIVE',live_session_id:d.source,
      presenter_user_id:admin.id,screen_ids:[d.screen],fallback:{preparation_id:d.preparation,manifest:d.manifest}}]});
    expect(data.approval_fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(r.body).not.toMatch(/access_token|ticket|wss:|https:/);
    expect(await counts()).toEqual(before);
  });
  it('binds presenter permission to the actual source and rechecks withdrawal before reserving or publishing',async()=>{
    const presenter=await makeUser('SYNTHETIC_CONDITIONAL_PRESENTER', [{action:'publish',subject:'LiveBroadcast',
      conditions:{presenter_user_id:'$user.id',owner_department_id:'$user.department_id'}}], departmentA);
    const d=await seed({presenter:presenter.id}), before=await counts();
    const reviewed=await preflight(d);expect(reviewed.statusCode,reviewed.body).toBe(200);
    const request=await createRequest(d),held=await counts();
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:[]}]);
    for(const [path,body] of [
      ['/api/v1/schedules/live-preflight',{schedule_id:d.schedule,fallback_preparation_ids:prepIds(d)}],
      [reqPath(request.id,'/approve'),{}],
      [publishPath(d),{fallback_preparation_ids:prepIds(d),expected_live_fingerprint:reviewed.json().approval_fingerprint}],
    ] as const){
      const denied=await invoke(admin,'POST',path,body),isReview=path.endsWith('/live-preflight');
      expect(denied.statusCode,denied.body).toBe(isReview?422:409);
      expect(denied.json().error.code).toBe(isReview?'LIVE_PRESENTER_UNAVAILABLE':'LIVE_APPROVAL_STALE');
      if(!isReview)expect(denied.json().error.details.reason).toBe('LIVE_PRESENTER_UNAVAILABLE');
      expect(await counts()).toEqual(held);
    }
    expect(held.occurrences).toBe(before.occurrences+1);
    expect((await pool.query('SELECT status FROM schedule_requests WHERE id=$1',[request.id])).rows[0].status).toBe('PENDING');
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:[{action:'publish',subject:'LiveBroadcast',
      conditions:{presenter_user_id:'$user.id',owner_department_id:'$user.department_id'}}]}]);
    await approve(request.id);const reserved=await counts();
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:[]}]);
    const deniedPublish=await invoke(admin,'POST',reqPath(request.id,'/publish'),{});
    expect(deniedPublish.statusCode,deniedPublish.body).toBe(409);
    expect(deniedPublish.json().error).toMatchObject({code:'LIVE_APPROVAL_STALE',details:{reason:'LIVE_PRESENTER_UNAVAILABLE'}});
    expect(await counts()).toEqual(reserved);
    expect((await pool.query('SELECT status FROM schedule_requests WHERE id=$1',[request.id])).rows[0].status).toBe('APPROVED');
    expect((await pool.query('SELECT state FROM live_schedule_occurrences WHERE schedule_id=$1',[d.schedule])).rows).toEqual([{state:'RESERVED'}]);
  });
  it('rejects a foreign conditional presenter grant and permits inherited current source permission',async()=>{
    const presenter=await makeUser('SYNTHETIC_WRONG_SOURCE_PRESENTER',[{action:'publish',subject:'LiveBroadcast',
      conditions:{created_by:'$user.id'}}],departmentA);
    const d=await seed({presenter:presenter.id}),before=await counts();
    const denied=await preflight(d);expect(denied.statusCode,denied.body).toBe(422);
    expect(denied.json().error.code).toBe('LIVE_PRESENTER_UNAVAILABLE');expect(await counts()).toEqual(before);
    const inherited=await makeUser('SYNTHETIC_INHERITED_PRESENTER_PERMISSION',[{action:'publish',subject:'LiveBroadcast',
      conditions:{presenter_user_id:'$user.id',owner_department_id:'$user.department_id'}}],departmentA);
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[presenter.roleId,{grants:[],inherits:[inherited.roleId]}]);
    const allowed=await preflight(d);expect(allowed.statusCode,allowed.body).toBe(200);expect(await counts()).toEqual(before);
  });
  it('requires fresh direct review and commits frozen snapshot, screen reservations and capacity together',async()=>{
    const d=await seed(),before=await counts();
    const missing=await invoke(admin,'POST',publishPath(d),{fallback_preparation_ids:prepIds(d)});
    expect(missing.statusCode,missing.body).toBe(409);expect(missing.json().error.code).toBe('LIVE_APPROVAL_REQUIRED');
    expect(await counts()).toEqual(before);
    const pf=(await preflight(d)).json();
    const result=await invoke(admin,'POST',publishPath(d),{fallback_preparation_ids:prepIds(d),expected_live_fingerprint:pf.approval_fingerprint});
    expect(result.statusCode,result.body).toBe(200);const body=result.json(),payload=await snapshot(body.snapshot_id);
    expect(payload.schedule.items[0]).toMatchObject({source_kind:'LIVE',live_policy:pf.items[0]});
    expect(payload.schedule.items[0].presentation).toBeNull();
    expect(payload.schedule.items[0].live_policy.fallback.manifest.assets[0]).toMatchObject({
      object_key:`live-fallbacks/v1/sha256/${'a'.repeat(64)}.png`,sha256:'a'.repeat(64)});
    expect(JSON.stringify(payload)).not.toMatch(/access_token|ticket|https?:|synthetic-live-source/);
    expect((await pool.query('SELECT state,publish_id,screen_ids FROM live_schedule_occurrences WHERE schedule_id=$1',[d.schedule])).rows)
      .toEqual([{state:'PUBLISHED',publish_id:body.publish_id,screen_ids:[d.screen]}]);
    expect((await pool.query('SELECT state,publish_id FROM schedule_reservations WHERE schedule_id=$1',[d.schedule])).rows)
      .toEqual([{state:'PUBLISHED',publish_id:body.publish_id}]);
  });
  it('rolls back every snapshot/reservation write when an internal publication callback is missing, incomplete or fails late',async()=>{
    const d=await seed(),hints=await preloadLiveSchedulingHints(d.schedule),before=await counts();
    await withCurrentMutationAuthorization(fixture.tokens.get(admin.token)!,async context=>{
      await lockScreenTargetReferences(context.executor);
      await context.executor.select().from(tables.schedules).where(eq(tables.schedules.id,d.schedule)).for('update');
      const prepared=await prepareLiveSchedule(context,{scheduleId:d.schedule,identityHints:hints,fallbackPreparationIds:prepIds(d)});
      const base={scheduleId:d.schedule,screenIds:[],screenGroupIds:[],publishedBy:admin.id,db:context.executor,preparedLive:prepared};
      await expect(publishScheduleSnapshot(base)).rejects.toMatchObject({code:'LIVE_APPROVAL_REQUIRED'});
      await expect(publishScheduleSnapshot({...base,onPublished:async()=>undefined})).rejects.toMatchObject({code:'LIVE_RESERVATION_MISMATCH'});
      await expect(publishScheduleSnapshot({...base,onPublished:async({tx,publish})=>{
        expect(tx).toBe(context.executor);
        await createScheduleReservationService().acquireDirectPublishedReservations({scheduleId:d.schedule,
          ownerUserId:admin.id,publishId:publish.id,live:{context,prepared,expectedFingerprint:prepared.fingerprint}},tx);
        throw AppError.conflict('Synthetic failure after both reservations');
      }})).rejects.toMatchObject({statusCode:409});
    },{userLock:'share',additionalUserIdsToLock:hints.presenter_user_ids});
    expect(await counts()).toEqual(before);
  });
  it('rejects stale direct policy before any publication writes',async()=>{
    const d=await seed(),pf=(await preflight(d)).json(),before=await counts();
    await pool.query('UPDATE live_sessions SET microphone=true WHERE id=$1',[d.source]);
    const r=await invoke(admin,'POST',publishPath(d),{fallback_preparation_ids:prepIds(d),expected_live_fingerprint:pf.approval_fingerprint});
    expect(r.statusCode,r.body).toBe(409);expect(r.json().error.code).toBe('LIVE_APPROVAL_STALE');expect(await counts()).toEqual(before);
  });
  it('excludes outside-scope aspect warnings and delivers only the approved explicit audience',async()=>{
    const d=await seed({layout:true}),outside=randomUUID();
    await pool.query(`UPDATE screens SET aspect_ratio='16:9' WHERE id=$1`,[d.screen]);
    await pool.query(`INSERT INTO screens(id,name,aspect_ratio,device_info) VALUES($1,'Outside portrait','9:16',$2)`,
      [outside,{player_capabilities:{features:['live_broadcast_v1']}}]);
    await pool.query('UPDATE schedule_items SET screen_ids=$2 WHERE id=$1',[d.item,JSON.stringify([d.screen,outside])]);
    const wide=await invoke(admin,'POST','/api/v1/schedules/display-preflight',{schedule_id:d.schedule});
    expect(wide.statusCode,wide.body).toBe(200);expect(wide.json().issues.map((x:any)=>x.screen_id)).toEqual([outside]);
    const display=await invoke(admin,'POST','/api/v1/schedules/display-preflight',{schedule_id:d.schedule,screen_ids:[d.screen]});
    expect(display.statusCode,display.body).toBe(200);expect(display.json()).toMatchObject({issues:[],compatible:true,target_screen_ids:[d.screen]});
    const pf=await preflight(d,admin,{screen_ids:[d.screen]});expect(pf.statusCode,pf.body).toBe(200);
    const result=await invoke(admin,'POST',publishPath(d),{screen_ids:[d.screen],fallback_preparation_ids:prepIds(d),expected_live_fingerprint:pf.json().approval_fingerprint});
    expect(result.statusCode,result.body).toBe(200);expect(result.json().resolved_screen_ids).toEqual([d.screen]);
    expect((await pool.query('SELECT screen_id FROM publish_targets WHERE publish_id=$1',[result.json().publish_id])).rows).toEqual([{screen_id:d.screen}]);
  });
  it('preserves frozen request review through create, approve, publish and idempotent retry after draft/source changes',async()=>{
    const d=await seed(),request=await createRequest(d);
    expect(request.live_approval).toMatchObject({version:1,fallback_preparation_ids:prepIds(d),items:[{screen_ids:[d.screen]}]});
    expect((await invoke(author,'GET',reqPath(request.id))).json().live_approval).toEqual(request.live_approval);
    const approved=await approve(request.id);expect(approved.live_approval).toEqual(request.live_approval);
    const published=await invoke(admin,'POST',reqPath(request.id,'/publish'),{});
    expect(published.statusCode,published.body).toBe(200);const record=published.json(),before=await counts(),frozen=await snapshot(record.snapshot_id);
    await pool.query('UPDATE live_sessions SET is_active=false WHERE id=$1',[d.source]);
    await pool.query('UPDATE presentations SET name=$2 WHERE id=$1',[d.presentation,'Changed mutable draft']);
    await pool.query(`UPDATE screens SET device_info='{}' WHERE id=$1`,[d.screen]);
    for(const path of [reqPath(request.id,'/publish'),publishPath(d)]){
      const r=await invoke(admin,'POST',path,path===publishPath(d)?{schedule_request_id:request.id}:{});
      expect(r.statusCode,r.body).toBe(200);expect(r.json()).toMatchObject({publish_id:record.publish_id,snapshot_id:record.snapshot_id});
    }
    expect(await counts()).toEqual(before);expect(await snapshot(record.snapshot_id)).toEqual(frozen);
    // Emulate later ordinary reservation history cleanup: normalized immutable
    // LIVE occurrence history must still identify this existing publication.
    await pool.query('DELETE FROM schedule_reservations WHERE schedule_request_id=$1',[request.id]);
    const afterCleanup=await counts();
    const historical=await invoke(admin,'POST',publishPath(d),{schedule_request_id:request.id,screen_ids:[randomUUID()]});
    expect(historical.statusCode,historical.body).toBe(200);expect(historical.json().publish_id).toBe(record.publish_id);
    expect(await counts()).toEqual(afterCleanup);
  });
  it('rejects same-count group replacement at approval and leaves frozen holds unchanged',async()=>{
    const d=await seed({group:true}),request=await createRequest(d);
    const held=(await pool.query('SELECT * FROM live_schedule_occurrences WHERE schedule_id=$1',[d.schedule])).rows;
    const replacement=randomUUID();await pool.query(`INSERT INTO screens(id,name,device_info) VALUES($1,'Replacement',$2)`,[replacement,{player_capabilities:{features:['live_broadcast_v1']}}]);
    await pool.query('DELETE FROM screen_group_members WHERE group_id=$1',[d.group]);
    await pool.query('INSERT INTO screen_group_members(group_id,screen_id) VALUES($1,$2)',[d.group,replacement]);
    const before=await counts(),r=await invoke(admin,'POST',reqPath(request.id,'/approve'),{});
    expect(r.statusCode,r.body).toBe(409);expect(r.json().error.code).toBe('LIVE_APPROVAL_STALE');expect(await counts()).toEqual(before);
    expect((await pool.query('SELECT * FROM live_schedule_occurrences WHERE schedule_id=$1',[d.schedule])).rows).toEqual(held);
    expect((await pool.query('SELECT status FROM schedule_requests WHERE id=$1',[request.id])).rows[0].status).toBe('PENDING');
  });
  it('rejects malformed or fingerprint-tampered stored review without changing its holds',async()=>{
    for(const fault of ['shape','fingerprint']){
      const d=await seed(),request=await createRequest(d),payload=request.payload;
      if(fault==='shape')delete payload.live_approval.items[0].screen_group_ids;
      else payload.live_approval.items[0].microphone=!payload.live_approval.items[0].microphone;
      await pool.query('UPDATE schedule_requests SET schedule_payload=$2 WHERE id=$1',[request.id,payload]);const before=await counts();
      const result=await invoke(admin,'POST',reqPath(request.id,'/approve'),{});
      expect(result.statusCode,result.body).toBe(409);expect(result.json().error.code).toBe('LIVE_APPROVAL_STALE');expect(await counts()).toEqual(before);
      expect((await pool.query('SELECT status,schedule_payload FROM schedule_requests WHERE id=$1',[request.id])).rows[0]).toEqual({status:'PENDING',schedule_payload:payload});
    }
  });
  it('rejects changed approved fallback or target capability at publish without altering reservations',async()=>{
    for(const fault of ['fallback','capability']){
      const d=await seed(),request=await createRequest(d);await approve(request.id);const before=await counts();
      if(fault==='fallback')await pool.query('UPDATE presentation_items SET duration_seconds=20 WHERE presentation_id=$1',[d.presentation]);
      else await pool.query(`UPDATE screens SET device_info='{}' WHERE id=$1`,[d.screen]);
      const r=await invoke(admin,'POST',reqPath(request.id,'/publish'),{});expect(r.statusCode,r.body).toBe(409);expect(await counts()).toEqual(before);
      expect((await pool.query('SELECT status FROM schedule_requests WHERE id=$1',[request.id])).rows[0].status).toBe('APPROVED');
      expect((await pool.query('SELECT state FROM live_schedule_occurrences WHERE schedule_id=$1',[d.schedule])).rows[0].state).toBe('RESERVED');
    }
  });
  it('does not promote operator create/read into approval or conditional publish authority',async()=>{
    const d=await seed(),request=await createRequest(d),before=await counts();
    const denied=await invoke(author,'POST',reqPath(request.id,'/approve'),{});expect(denied.statusCode,denied.body).toBe(403);expect(await counts()).toEqual(before);
    await approve(request.id);
    const foreign=await invoke(conditional,'POST',reqPath(request.id,'/publish'),{});expect(foreign.statusCode,foreign.body).toBe(403);
    const bypass=await invoke(conditional,'POST',publishPath(d),{fallback_preparation_ids:prepIds(d),expected_live_fingerprint:request.live_approval.approval_fingerprint});
    expect(bypass.statusCode,bypass.body).toBe(403);
  });
  it('locks opposite actor/presenter pairs in one shared order under concurrent HTTP preflights',async()=>{
    const a=await seed({owner:author,presenter:conditional.id}),b=await seed({owner:conditional,presenter:author.id});
    const results=await Promise.all([preflight(a,author),preflight(b,conditional)]);
    for(const r of results)expect(r.statusCode,r.body).toBe(200);
  });
  it('rejects a presenter replacement committed while preflight waits for target locks, without taking late user locks',async()=>{
    const d=await seed(),before=await counts(),holder=await pool.connect();let pending:ReturnType<typeof preflight>|undefined;
    try{
      await holder.query('BEGIN');await holder.query(`SELECT pg_advisory_xact_lock(hashtext('darshan_screen_target_references_v1'))`);
      pending=preflight(d,author); const running=Promise.resolve(pending);await waitForLock();
      await pool.query('UPDATE live_sessions SET presenter_user_id=$2 WHERE id=$1',[d.source,conditional.id]);
      await holder.query('COMMIT');const result=await running;
      expect(result.statusCode,result.body).toBe(409);expect(result.json().error.code).toBe('LIVE_AUTHORIZATION_RETRY');
      expect(await counts()).toEqual(before);
    }finally{await holder.query('ROLLBACK');holder.release();if(pending)await pending;}
  });
  it('rechecks account activity after a concurrent deactivation wins its identity lock',async()=>{
    const d=await seed(),before=await counts(),holder=await pool.connect();let pending:ReturnType<typeof invoke>|undefined;
    try{
      await holder.query('BEGIN');await holder.query('UPDATE users SET is_active=false WHERE id=$1',[author.id]);
      pending=invoke(author,'POST','/api/v1/schedule-requests',{schedule_id:d.schedule,fallback_preparation_ids:prepIds(d)});
      const running=Promise.resolve(pending);await waitForLock();await holder.query('COMMIT');const r=await running;
      expect(r.statusCode,r.body).toBe(401);expect(await counts()).toEqual(before);
    }finally{await holder.query('ROLLBACK');holder.release();if(pending)await pending;await pool.query('UPDATE users SET is_active=true WHERE id=$1',[author.id]);}
  });
  it('preserves legacy ordinary direct and request publishing without live fields',async()=>{
    const direct=await seed({ordinary:true}),r=await invoke(admin,'POST',publishPath(direct),{});
    expect(r.statusCode,r.body).toBe(200);expect((await snapshot(r.json().snapshot_id)).schedule.items[0].source_kind).toBe('PRESENTATION');
    const queued=await seed({ordinary:true});const created=await invoke(author,'POST','/api/v1/schedule-requests',{schedule_id:queued.schedule});
    expect(created.statusCode,created.body).toBe(201);expect(created.json().live_approval).toBeNull();await approve(created.json().id);
    const published=await invoke(admin,'POST',reqPath(created.json().id,'/publish'),{});expect(published.statusCode,published.body).toBe(200);
    expect((await pool.query('SELECT count(*)::int n FROM live_schedule_occurrences WHERE schedule_id=$1',[queued.schedule])).rows[0].n).toBe(0);
  });
  it('applies inherited own-request read permissions to GET, paginated rows, totals and summaries',async()=>{
    const inherited=randomUUID(),reader=await makeUser('SYNTHETIC_OWN_REQUEST_READER',[],departmentA);
    await pool.query('INSERT INTO roles(id,name,permissions) VALUES($1,$2,$3)',[inherited,'SYNTHETIC_INHERITED_READS',{
      grants:[{action:'create',subject:'ScheduleRequest'},...['Schedule','Presentation','Media','Layout','Screen','ScreenGroup','LiveBroadcast'].map(subject=>({action:'read',subject}))]}]);
    await pool.query('UPDATE roles SET permissions=$2 WHERE id=$1',[reader.roleId,{inherits:[inherited],grants:[
      {action:'read',subject:'ScheduleRequest',conditions:{requested_by:'$user.id'}}]}]);
    const shared=await seed(),foreign=await createRequest(shared),ownData=await seed({owner:reader}),own=await createRequest(ownData,reader);
    const foreignDept=await seed(),hidden=await createRequest(foreignDept);
    await pool.query('UPDATE schedule_requests SET requested_by=$2 WHERE id=$1',[hidden.id,reader.id]);
    await pool.query('UPDATE schedules SET owner_department_id=$2 WHERE id=$1',[foreignDept.schedule,departmentB]);
    for(const id of [foreign.id,hidden.id]){
      const denied=await invoke(reader,'GET',reqPath(id));expect(denied.statusCode,denied.body).toBe(403);
      const filtered=await invoke(reader,'GET',`/api/v1/schedule-requests?q=${id}`);
      expect(filtered.statusCode,filtered.body).toBe(200);expect(filtered.json()).toMatchObject({items:[],pagination:{total:0}});
      const summary=await invoke(reader,'GET',`/api/v1/schedule-requests/status-summary?q=${id}`);
      expect(summary.statusCode,summary.body).toBe(200);expect(Object.values(summary.json().counts)).toEqual([0,0,0,0,0,0]);
    }
    expect((await invoke(reader,'GET',reqPath(own.id))).json().live_approval).toEqual(own.live_approval);
    const listed=await invoke(reader,'GET','/api/v1/schedule-requests?limit=1');expect(listed.statusCode,listed.body).toBe(200);
    expect(listed.json().items.map((x:any)=>x.id)).toEqual([own.id]);expect(listed.json().pagination.total).toBe(1);
    const summary=await invoke(reader,'GET','/api/v1/schedule-requests/status-summary');
    expect(summary.statusCode,summary.body).toBe(200);expect(summary.json().counts.pending).toBe(1);
  });
  it('binds conditional Schedule management to actual rows without granting global department visibility',async()=>{
    const reader=await makeUser('SYNTHETIC_CONDITIONAL_SCHEDULE_MANAGER',[
      {action:'read',subject:'Schedule'},{action:'read',subject:'ScheduleRequest'},
      {action:'manage',subject:'Schedule',conditions:{created_by:'$user.id'}}],departmentA);
    const other=await seed(),foreign=await createRequest(other);
    await pool.query('UPDATE schedules SET owner_department_id=$2 WHERE id=$1',[other.schedule,departmentB]);
    const own=await seed({owner:reader});await pool.query('UPDATE schedules SET owner_department_id=$2 WHERE id=$1',[own.schedule,departmentB]);
    expect((await invoke(reader,'GET',`/api/v1/schedules/${other.schedule}`)).statusCode).toBe(403);
    expect((await invoke(reader,'GET',reqPath(foreign.id))).statusCode).toBe(403);
    const allowed=await invoke(reader,'GET',`/api/v1/schedules/${own.schedule}`);expect(allowed.statusCode,allowed.body).toBe(200);
    const listed=await invoke(reader,'GET','/api/v1/schedules?limit=100');expect(listed.statusCode,listed.body).toBe(200);
    expect(listed.json().items.map((x:any)=>x.id)).not.toContain(other.schedule);expect(listed.json().items.map((x:any)=>x.id)).toContain(own.schedule);
    const expected=(await pool.query(`SELECT count(*)::int n FROM schedules WHERE owner_scope='ORGANIZATION'
      OR (owner_scope='DEPARTMENT' AND owner_department_id=$1) OR created_by=$2`,[departmentA,reader.id])).rows[0].n;
    expect(listed.json().pagination.total).toBe(expected);
    const summary=await invoke(reader,'GET',`/api/v1/schedule-requests/status-summary?q=${foreign.id}`);
    expect(summary.statusCode,summary.body).toBe(200);expect(summary.json().counts.pending).toBe(0);
  });
  it('preserves CASL inversion and priority in SQL and fails closed for unsupported conditions',async()=>{
    const d=await seed(),request=await createRequest(d),repo=createScheduleRequestRepository();
    const actor={userId:author.id,roleName:'IGNORED',departmentId:departmentA,departmentIds:[departmentA]};
    const base=[{action:'read',subject:'Schedule'},{action:'read',subject:'ScheduleRequest'},
      {action:'read',subject:'ScheduleRequest',inverted:true,conditions:{requested_by:author.id}}];
    const denied=createMongoAbility(base),row=(await pool.query('SELECT * FROM schedule_requests WHERE id=$1',[request.id])).rows[0];
    expect(denied.can('read',subject('ScheduleRequest',row))).toBe(false);
    expect(await repo.list({actor,ability:denied,q:request.id})).toMatchObject({items:[],total:0});
    expect((await repo.countSummary({actor,ability:denied,q:request.id})).pending).toBe(0);
    const allowed=createMongoAbility([...base,{action:'read',subject:'ScheduleRequest',conditions:{id:request.id}}]);
    expect(allowed.can('read',subject('ScheduleRequest',row))).toBe(true);
    expect(await repo.list({actor,ability:allowed,q:request.id})).toMatchObject({items:[{id:request.id}],total:1});
    for(const conditions of [{id:'not-a-uuid'},{id:request.id.toUpperCase()},{'schedule.id':d.schedule},{unknown_field:author.id},{$or:[{id:request.id}]}]){
      const ability=createMongoAbility([{action:'read',subject:'Schedule'},{action:'read',subject:'ScheduleRequest',conditions}]);
      expect(await repo.list({actor,ability,q:request.id})).toMatchObject({items:[],total:0});
      expect((await repo.countSummary({actor,ability,q:request.id})).pending).toBe(0);
    }
    const unsupportedSchedule=createMongoAbility([{action:'read',subject:'Schedule',conditions:{owner_scope:{$ne:'RESTRICTED'}}}]);
    expect(await createScheduleRepository().list({actor,ability:unsupportedSchedule})).toMatchObject({items:[],total:0});
    const unsupported=await makeUser('SYNTHETIC_UNSUPPORTED_STORED_RULE',[
      {action:'read',subject:'Schedule'},{action:'read',subject:'ScheduleRequest',conditions:{$or:[{id:request.id}]}}],departmentA);
    expect((await invoke(unsupported,'GET',reqPath(request.id))).statusCode).toBe(403);
    expect((await invoke(unsupported,'GET',`/api/v1/schedule-requests?q=${request.id}`)).json()).toMatchObject({items:[],pagination:{total:0}});
  });
  it('does not let conditional Schedule management alter another schedule target delivery status',async()=>{
    const manager=await makeUser('SYNTHETIC_OWN_DELIVERY_MANAGER',[{action:'read',subject:'Schedule'},
      {action:'manage',subject:'Schedule',conditions:{created_by:'$user.id'}}],departmentA);
    const d=await seed({ordinary:true}),published=await invoke(admin,'POST',publishPath(d),{});
    expect(published.statusCode,published.body).toBe(200);
    const target=(await pool.query('SELECT * FROM publish_targets WHERE publish_id=$1',[published.json().publish_id])).rows[0];
    const result=await invoke(manager,'PATCH',`/api/v1/publishes/${target.publish_id}/targets/${target.id}`,{status:'SUCCESS'});
    expect(result.statusCode,result.body).toBe(403);
    expect((await pool.query('SELECT * FROM publish_targets WHERE id=$1',[target.id])).rows[0]).toEqual(target);
  });
});
