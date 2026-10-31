import type { PoolClient } from 'pg';
import { digest } from '../../src/recovery/controlled-docker/contracts';
import { loadMigrationManifest, loadProductionBaseline } from '../../src/deployment/migration-manifest';
import { D3_BACKUP_QUEUE_PARTITION, D3_CONTROL_COLUMNS, D3_CONTROL_DDL, D3_CONTROL_TRIGGER_BODY, type D3ControlSql } from './controlled-recovery-d3-reservation-control';
import { d3ReservationAuthoritySchema } from './controlled-recovery-d3-reservation-contract';
import { FixedD3BackupReservation } from './controlled-recovery-d3-reservation';
import { d3ReservationProfileSchema } from './controlled-recovery-d3-reservation-profile';
import { FakeD3DataDatabase } from './controlled-recovery-d3-source-data.test-support';
import { observeD3SourceSeal, verifyD3MigrationLedger } from './controlled-recovery-d3-source-seal';
import { testD3Operation } from './controlled-recovery-d3.test-support';
import profileJson from '../../../deploy/development/controlled-recovery/tiny-d3.reservation-profile.json';

export const reservationProfile = d3ReservationProfileSchema.parse(profileJson);
const acl = [{ grantor: 'darshan', grantee: 'darshan', privilege: 'SELECT', grantable: false }];
export function controlCatalog(text: string): Record<string, unknown>[] | null {
  if (text.includes("WHERE nspname='darshan_d3_control'")) return [{ owner: 'darshan', acl }];
  if (text.startsWith('SELECT c.relname AS name,c.relkind')) return ['operation_backup_bindings', 'operation_backup_bindings_pkey', 'operation_backup_bindings_run_key'].map((name, index) => ({ name, kind: index ? 'i' : 'r', persistence: 'p', rls: false, force_rls: false, owner: 'darshan', acl }));
  if (text.startsWith('SELECT a.attname')) return D3_CONTROL_COLUMNS.map(([name, type, required, default_value]) => ({ name, type, required, default_value }));
  if (text.startsWith('SELECT c.conname')) return [
    ['operation_backup_bindings_bound', 'c', ['binding'], 'octet_length(binding::text) <= 16384'], ['operation_backup_bindings_digest', 'c', ['binding_sha256'], "binding_sha256 ~ '^[a-f0-9]{64}$'::text"], ['operation_backup_bindings_object', 'c', ['binding'], "jsonb_typeof(binding) = 'object'::text"], ['operation_backup_bindings_pkey', 'p', ['operation_id'], null], ['operation_backup_bindings_run_key', 'u', ['backup_run_id'], null],
  ].map(([name, type, columns, expression]) => ({ name, type, columns, expression, reference: null, delete_action: null, validated: true, deferrable: false, deferred: false }));
  if (text.startsWith('SELECT p.proname AS name,p.prosrc')) return [{ name: 'reject_binding_mutation', body: D3_CONTROL_TRIGGER_BODY, language: 'plpgsql', security_definer: false, config: ['search_path=pg_catalog'], returns: 'trigger', arguments: 0, owner: 'darshan', acl }];
  if (text.startsWith('SELECT t.tgname')) return [{ name: 'operation_binding_rows', enabled: 'O', type: 27, internal: false, condition: null, arguments: 0, deferrable: false, initially_deferred: false, function: 'reject_binding_mutation', function_schema: 'darshan_d3_control' }, { name: 'operation_binding_truncate', enabled: 'O', type: 34, internal: false, condition: null, arguments: 0, deferrable: false, initially_deferred: false, function: 'reject_binding_mutation', function_schema: 'darshan_d3_control' }];
  if (text.startsWith('SELECT c.relname AS name,i.indisprimary')) return ['operation_backup_bindings_pkey', 'operation_backup_bindings_run_key'].map((name, i) => ({ name, primary: i === 0, unique: true, valid: true, ready: true, predicate: null }));
  if (text.startsWith('SELECT (SELECT count(*)::int FROM pg_type')) return [{ extra: 0 }];
  return null;
}
type State = { control: boolean; queue: boolean; bindings: Record<string, unknown>[]; runs: Record<string, unknown>[]; jobs: Record<string, unknown>[] };
/** Transactional SQL fake; real PgBoss creates queue/INSERT SQL and passes values to this transport. No database acceptance claim. */
export class FakeD3ReservationSql {
  state: State = { control: false, queue: false, bindings: [], runs: [], jobs: [] };
  readonly calls: Array<{ connection: number; text: string; values: unknown[] }> = [];
  private readonly locks = new Map<string, number>(); private next = 0; closes = 0;
  fail: ((text: string, after: boolean) => boolean) | null = null; before: ((text: string) => Promise<void> | void) | null = null;
  catalogChange: ((text: string, rows: Record<string, unknown>[]) => Record<string, unknown>[]) | null = null;
  physical = { system_identifier: '743030001', database_oid: '16384', database: 'darshan', user: 'darshan', version: 160013, ssl: true };
  constructor(readonly source: FakeD3DataDatabase) {}
  session = async () => {
    const connection = ++this.next; let draft: State | null = null;
    const release = () => { for (const [key, owner] of this.locks) if (owner === connection) this.locks.delete(key); };
    const query: D3ControlSql['query'] = async (text, values = []) => {
      this.calls.push({ connection, text, values }); await this.before?.(text); if (this.fail?.(text, false)) throw new Error('SECRET untrusted SQL failure');
      const rows = await execute(text, values); if (this.fail?.(text, true)) throw new Error('SECRET ambiguous transport'); return { rows };
    };
    const execute = async (text: string, values: unknown[]): Promise<Record<string, unknown>[]> => {
      if (text.startsWith('BEGIN')) { draft = structuredClone(this.state); return []; }
      if (text === 'COMMIT') { if (draft) this.state = draft; draft = null; release(); return []; }
      if (text === 'ROLLBACK') { draft = null; release(); return []; }
      if (text.startsWith('SET LOCAL')) return [];
      if (!draft) throw new Error('SQL outside checked-out transaction');
      if (text.includes('pg_try_advisory_xact_lock')) { const key = String(values[0]), owned = this.locks.get(key); if (owned && owned !== connection) return [{ locked: false }]; this.locks.set(key, connection); return [{ locked: true }]; }
      if (text === D3_CONTROL_DDL) { if (draft.control) throw new Error('schema exists'); draft.control = true; return []; }
      const catalog = controlCatalog(text); if (catalog) return !draft.control ? [] : this.catalogChange?.(text, structuredClone(catalog)) ?? catalog;
      if (text.startsWith('SELECT name,policy,retry_limit')) return draft.queue ? [{ name: 'backup', policy: 'standard', retry_limit: 0, retry_delay: 0, retry_backoff: false, expire_seconds: 14700, retention_minutes: 43200, dead_letter: null, partition_name: D3_BACKUP_QUEUE_PARTITION }] : [];
      if (text.startsWith('SELECT c.relname AS name,pg_get_userbyid')) return [{ name: D3_BACKUP_QUEUE_PARTITION, owner: 'darshan', kind: 'r', persistence: 'p', rls: false, force_rls: false, bound: "FOR VALUES IN ('backup')", parent: 'pgboss.job' }];
      if (text.startsWith('SELECT c.relname AS name,jsonb_build_object')) return [{ name: 'backup-partition', shape: { verifiedFixture: true } }, { name: 'fixture-partition', shape: { verifiedFixture: true } }];
      if (text.startsWith('SELECT binding FROM')) return draft.bindings.map(({ binding }) => ({ binding }));
      if (text.startsWith("SELECT name FROM pgboss.schedule WHERE name='backup'")) return [];
      if (text.startsWith('SELECT operation_id,site_id')) return structuredClone(draft.bindings);
      if (text.startsWith('INSERT INTO darshan_d3_control')) { if (draft.bindings.length) throw new Error('unique operation/run'); draft.bindings.push({ operation_id: values[0], site_id: values[1], repository_id: values[2], backup_run_id: values[3], binding: JSON.parse(values[4] as string), binding_sha256: values[5] }); return []; }
      if (text.startsWith('SELECT pgboss.create_queue')) { if (values[0] !== 'backup' || digest(values[1]) !== digest({ policy: 'standard', retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 14700, retentionMinutes: 43200 })) throw new Error('nonfixed real pg-boss queue'); draft.queue = true; return []; }
      if (text.includes('INSERT INTO pgboss.job')) { if (!draft.queue || values.length !== 19 || !text.includes('pgboss.queue')) throw new Error('not real pg-boss enqueue'); draft.jobs.push({ id: values[0], name: values[1], data: values[2], state: 'created' }); return [{ id: values[0] }]; }
      if (text.startsWith('SELECT id,name,data')) return structuredClone(text.includes('AND id=$1') ? draft.jobs.filter(({ id }) => id === values[0]) : draft.jobs);
      if (text.includes('SELECT * FROM backup_runs')) return structuredClone(text.includes('WHERE id=$1') ? draft.runs.filter(({ id }) => id === values[0]) : draft.runs.filter(({ coordination_key, status }) => coordination_key === values[0] && ['PENDING', 'RUNNING', 'RETRY_WAIT'].includes(String(status))));
      if (text.includes('INSERT INTO backup_runs')) { const run = { id: values[0], trigger_type: values[1], status: 'PENDING', triggered_by: values[2], repository_kind: values[3], coordination_key: values[4], schedule_identity: values[5], queue_job_id: values[6], stage: 'QUEUED', attempt_id: null, lease_expires_at: null, deadline_at: null, cancellation_requested_at: null, repository_id: null }; draft.runs.push(run); return [run]; }
      if (text.includes('FROM pg_stat_activity')) return [{ own: true, application_name: 'darshan-d3-reservation', usename: 'darshan' }];
      if (text.includes('FROM pg_control_system')) return [this.physical];
      if (draft.queue) {
        const scan = text.match(/^SELECT to_jsonb\(t\)::text AS row FROM "pgboss"\."([a-z_]+)"/);
        if (scan && ['job', 'queue'].includes(scan[1]!)) { const base = (await this.source.query(text, values)).rows; const added = scan[1] === 'job' ? draft.jobs : [{ name: 'backup', policy: 'standard' }]; return text.includes("WHERE name <> 'backup'") ? base : [...base, ...added.map((row) => ({ row: JSON.stringify(row) }))]; }
        if (text.startsWith('SELECT to_jsonb(d)::text AS definition')) return [...(await this.source.query(text)).rows, { definition: JSON.stringify({ table_schema: 'pgboss', table_name: D3_BACKUP_QUEUE_PARTITION, column_name: 'id' }) }];
        if (text.includes('FROM pg_constraint con')) return [{ schema: 'pgboss', table: D3_BACKUP_QUEUE_PARTITION, name: 'q_fkey', definition: 'owned backup queue foreign key' }];
        if (text.startsWith('SELECT schemaname,tablename,indexname,indexdef')) return [{ schemaname: 'pgboss', tablename: D3_BACKUP_QUEUE_PARTITION, indexname: `${D3_BACKUP_QUEUE_PARTITION}_pkey`, indexdef: 'owned backup partition index' }];
        if (text.startsWith('SELECT n.nspname AS schema,c.relname AS name,c.relkind')) return [{ schema: 'pgboss', name: D3_BACKUP_QUEUE_PARTITION, kind: 'r' }];
        if (text.includes('FROM pg_trigger t')) { if (!text.includes(`fk.conrelid <> 'pgboss.${D3_BACKUP_QUEUE_PARTITION}'::regclass`)) throw new Error('backup FK enforcement trigger was not projected narrowly'); return this.source.triggerCatalog; }
      }
      return (await this.source.query(text, values)).rows;
    };
    return { client: { query } as unknown as PoolClient, close: async () => { draft = null; release(); this.closes++; } };
  };
}
export async function reservationFixture() {
  const source = new FakeD3DataDatabase(), manifest = await loadMigrationManifest(), baseline = new Set((await loadProductionBaseline(undefined, manifest)).migrationIds);
  for (const name of ['job', 'queue', 'archive', 'schedule', 'subscription']) source.tables.set(`pgboss.${name}`, []);
  source.tables.get('pgboss.queue')!.push({ name: 'd3-source-fixture', policy: 'standard' });
  source.tables.get('pgboss.job')!.push({ name: 'd3-source-fixture', state: 'active', data: { stale: true } });
  source.ledger = manifest.map(({ id, checksum }) => ({ migration_id: id, checksum_sha256: checksum, release_id: 'release-03', applied_method: baseline.has(id) ? 'BASELINED' : 'APPLIED', execution_state: baseline.has(id) ? 'BASELINED' : 'SUCCEEDED', approval_ticket: null }));
  const db = new FakeD3ReservationSql(source), resources: unknown[] = [], layoutSha256 = digest('retained-layout'), sqlReceipt = { fixed: 'real-shaped fake seed receipt' }; source.receipt = sqlReceipt;
  const physicalIdentity = { operationId: testD3Operation.operationId, siteId: testD3Operation.siteId, repositoryId: testD3Operation.repositoryId, sourceProfileSha256: reservationProfile.source_profile_sha256, resources, layoutSha256, database: db.physical };
  const migrations = verifyD3MigrationLedger(manifest, source.ledger), configurationSha256 = digest('retained-configuration');
  const seal = await observeD3SourceSeal(source, { physicalIdentity, configurationSha256, migrationFingerprint: migrations.fingerprint, objects: [] });
  const hashes = Object.fromEntries(['sourceIntentSha256', 'schemaReceiptSha256', 'sourceSealReceiptSha256', 'keyId', 'recipientSha256', 'ageReceiptSha256', 'capsuleReceiptSha256', 'capsuleSha256', 'capsulePolicySha256', 'capsuleInventorySha256'].map((key) => [key, digest(key)]));
  const authority = d3ReservationAuthoritySchema.parse({ format: 'darshan-d3-backup-reservation-authority-v1', operationId: testD3Operation.operationId, siteId: testD3Operation.siteId, repositoryId: testD3Operation.repositoryId, sourceProfileSha256: reservationProfile.source_profile_sha256, dataProfileSha256: reservationProfile.data_profile_sha256, capsuleProfileSha256: reservationProfile.capsule_profile_sha256, reservationProfileSha256: digest(reservationProfile), ...hashes, sourceSealSha256: seal.sealSha256, sqlSeedReceiptSha256: digest(sqlReceipt), physicalIdentitySha256: seal.physicalIdentitySha256, businessContentSha256: seal.businessContentSha256, migrationFingerprint: seal.migrationFingerprint, configurationSha256, layoutSha256, resourcesSha256: digest(resources), controlDdlSha256: reservationProfile.control_ddl_sha256 });
  const input = { authority, seal, manifest, resources }, prerequisites = { read: async () => structuredClone(input) };
  const dependencies = { profile: reservationProfile, profileSha256: digest(reservationProfile), prerequisites, session: db.session, admit: async () => undefined, withOperationLock: async <T>(action: () => Promise<T>) => action(), now: () => new Date('2026-10-31T12:00:00Z') };
  return { source, db, input, dependencies, reservation: new FixedD3BackupReservation(dependencies) };
}
