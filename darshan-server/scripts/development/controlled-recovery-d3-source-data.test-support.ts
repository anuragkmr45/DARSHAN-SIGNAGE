import type { PoolClient } from 'pg';
import { digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3DataClients, D3DataObjects } from './controlled-recovery-d3-source-data-clients';
import { D3_SEED_TABLES, type D3SeedObject } from './controlled-recovery-d3-source-data-fixtures';

/** Deliberately fake SQL transport: tests verify ordering/transactions, never claim PostgreSQL acceptance. */
export class FakeD3DataDatabase {
  tables = new Map<string, Array<Record<string, unknown>>>([...D3_SEED_TABLES.keys()].map((name) => [`public.${name}`, []]));
  ledger: Record<string, unknown>[] = []; receipt: Record<string, unknown> | null = null; role = false; grants = false; currentRole = false; lease = true; otherWriter = false;
  readonly calls: string[] = []; commits = 0; inserts = 0; beforeQuery: ((text: string) => void) | null = null; failure: ((text: string) => boolean) | null = null; private saved: unknown = null;
  afterCommitFailure = false;
  roleOid = '20000';
  enumCatalog: Record<string, unknown>[] = [];
  triggerCatalog: Record<string, unknown>[] = [];
  async query(text: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls.push(text); this.beforeQuery?.(text); if (this.failure?.(text)) { this.failure = null; throw new Error('private database-error-marker'); }
    const rows = (value: Record<string, unknown>[] = []) => ({ rows: value });
    if (text.includes("WHERE nspname='darshan_d3_control'")) return rows();
    if (text.startsWith('BEGIN')) { this.saved = structuredClone({ tables: this.tables, receipt: this.receipt, role: this.role, grants: this.grants }); return rows(); }
    if (text === 'ROLLBACK') { if (this.saved) Object.assign(this, this.saved); this.currentRole = false; this.saved = null; return rows(); }
    if (text === 'COMMIT') { this.saved = null; this.commits++; if (this.afterCommitFailure) { this.afterCommitFailure = false; throw new Error('ambiguous commit transport'); } return rows(); }
    if (text.includes('pg_try_advisory_lock')) return rows([{ acquired: this.lease }]);
    if (text.includes('FROM pg_stat_activity')) return rows([{ own: true, application_name: 'darshan-d3-source-data', usename: 'darshan' }, ...(this.otherWriter ? [{ own: false, application_name: 'ordinary-app', usename: 'darshan' }] : [])]);
    if (text.includes('FROM pg_control_system')) return rows([{ system_identifier: '743030001', database_oid: '16384', database: 'darshan', user: 'darshan', version: 160013, ssl: true }]);
    if (text.startsWith('SELECT migration_id')) return rows(this.ledger);
    if (text.includes("to_regclass('darshan_d3.source_seed_receipts')")) return rows([{ present: this.tables.has('darshan_d3.source_seed_receipts') }]);
    if (text.startsWith('SELECT receipt FROM')) return rows(this.receipt ? [{ receipt: this.receipt }] : []);
    if (text.startsWith('SELECT EXISTS (SELECT 1 FROM pg_namespace')) return rows([{ conflict: this.role || this.tables.has('pgboss.job') || this.tables.has('darshan_d3.source_seed_receipts') }]);
    if (text.includes('FROM pg_roles WHERE')) return rows(this.role ? [{ role_oid: this.roleOid, rolname: 'darshan_d3_seed', rolcanlogin: false, rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolinherit: false, rolreplication: false, rolbypassrls: false, membership: false }] : []);
    if (text.includes('has_table_privilege')) return rows(this.grants ? [{ nspname: 'public', relname: 'users' }] : []);
    if (text.startsWith('SELECT to_jsonb(d)::text AS definition')) return rows([...this.tables.keys()].sort().map((table) => ({ definition: JSON.stringify({ table, columns: D3_SEED_TABLES.get(table.split('.')[1]!)?.columns.map(({ name }) => name) ?? ['fixture'] }) })));
    if (text.includes('FROM pg_constraint con') || text.startsWith('SELECT schemaname,tablename,indexname,indexdef')) return rows();
    if (text.includes('FROM pg_enum e') || text.includes('JOIN pg_enum e')) return rows(this.enumCatalog);
    if (text.includes('FROM pg_trigger t')) return rows(this.triggerCatalog);
    if (text.includes('FROM pg_proc p') || text.includes('FROM pg_policies') || text.startsWith('SELECT n.nspname AS schema,c.relname AS name,c.relkind')) return rows();
    if (text.includes('FROM pg_class c JOIN pg_namespace') && text.includes('pg_inherits')) return rows([...this.tables.keys()].sort().map((table) => { const [schema, name] = table.split('.'); return { schema, name }; }));
    const scan = text.match(/^SELECT to_jsonb\(t\)::text AS row FROM "([a-z0-9_]+)"\."([a-z0-9_]+)"/); if (scan) return rows((this.tables.get(`${scan[1]}.${scan[2]}`) ?? []).map((row) => ({ row: JSON.stringify(Object.fromEntries(Object.entries(row).sort())) })).sort((a, b) => a.row < b.row ? -1 : a.row > b.row ? 1 : 0));
    if (text.startsWith('SELECT bucket, object_key')) return rows((this.tables.get('public.storage_objects') ?? []).map(({ bucket, object_key, size, sha256 }) => ({ bucket, key: object_key, bytes: size, sha256 })));
    if (text.startsWith('SELECT m.source_bucket')) return rows((this.tables.get('public.media') ?? []).map((media) => ({ bucket: media.source_bucket, key: media.source_object_key, bytes: media.source_size, source_object_id: media.source_object_id, registered_id: this.tables.get('public.storage_objects')?.find(({ id }) => id === media.source_object_id)?.id })));
    if (text.includes('CREATE SCHEMA IF NOT EXISTS pgboss')) { if (/^\s*BEGIN;/.test(text) || /COMMIT;\s*$/.test(text)) throw new Error('nested transaction'); this.tables.set('pgboss.version', [{ version: 24 }]); this.tables.set('pgboss.job', []); this.tables.set('pgboss.queue', []); return rows(); }
    if (text.startsWith('SELECT pgboss.create_queue')) { this.tables.get('pgboss.queue')!.push({ name: 'd3-source-fixture' }); return rows(); }
    if (text.startsWith('UPDATE pgboss.queue')) { Object.assign(this.tables.get('pgboss.queue')![0]!, { created_on: values[0], updated_on: values[0] }); return rows(); }
    if (text === 'CREATE SCHEMA darshan_d3') return rows();
    if (text.startsWith('CREATE TABLE darshan_d3.source_seed_receipts')) { this.tables.set('darshan_d3.source_seed_receipts', []); return rows(); }
    if (text.startsWith('CREATE ROLE')) { this.role = true; return rows(); }
    if (text.startsWith('GRANT SELECT')) { this.grants = true; return rows(); }
    if (text.startsWith('GRANT USAGE') || text.startsWith('REVOKE ALL PRIVILEGES ON SCHEMA')) return rows();
    if (text.startsWith('REVOKE ALL PRIVILEGES ON ALL TABLES')) { this.grants = false; return rows(); }
    if (text.startsWith('SET LOCAL ROLE')) { if (!this.role || !this.grants) throw new Error('writer permission'); this.currentRole = true; return rows(); }
    if (text === 'RESET ROLE') { this.currentRole = false; return rows(); }
    const insert = text.match(/^INSERT INTO public\."([a-z_]+)" \(([^)]+)\) VALUES/); if (insert) {
      if (!this.currentRole || !this.grants) throw new Error('writer not leased'); const name = insert[1]!; const table = D3_SEED_TABLES.get(name)!; const row = Object.fromEntries(insert[2]!.split(',').map((column, index) => { const key = column.replaceAll('"', ''); return [key, table.columns.find((value) => value.name === key)?.dataType === 'json' && values[index] !== null ? JSON.parse(values[index] as string) : values[index]]; }));
      for (const column of table.columns) { const value = row[column.name]; if (column.notNull && !column.hasDefault && value == null) throw new Error('not-null'); if (value != null && column.enumValues && !column.enumValues.includes(value as string)) throw new Error('enum'); }
      const foreign = { role_id: 'roles', department_id: 'departments', user_id: 'users', created_by: 'users', triggered_by: 'users', sender_id: 'users', actor_id: 'users', owner_department_id: 'departments', storage_object_id: 'storage_objects', source_object_id: 'storage_objects', ready_object_id: 'storage_objects', thumbnail_object_id: 'storage_objects', media_id: 'media', media_asset_id: 'media', layout_id: 'layouts', presentation_id: 'presentations', schedule_id: 'schedules', current_schedule_id: 'schedules', current_media_id: 'media', screen_id: 'screens', device_id: 'screens', conversation_id: 'chat_conversations', message_id: 'chat_messages', emergency_type_id: 'emergency_types', emergency_id: 'emergencies', command_id: 'device_commands', last_command_id: 'device_commands' };
      for (const [key, target] of Object.entries(foreign)) if (row[key] != null && !this.tables.get(`public.${target}`)?.some(({ id }) => id === row[key])) throw new Error(`fixture reference ${name}.${key}`);
      if (row.id && this.tables.get(`public.${name}`)!.some(({ id }) => id === row.id)) throw new Error('duplicate'); this.tables.get(`public.${name}`)!.push(row); this.inserts++; return rows(); }
    if (text.startsWith('INSERT INTO pgboss.job')) { if (!this.currentRole) throw new Error('writer permission'); this.tables.get('pgboss.job')!.push({ id: values[0], name: 'd3-source-fixture', data: JSON.parse(values[1] as string), state: 'active', start_after: values[2], started_on: values[2], created_on: values[2], keep_until: values[3], retry_count: 1 }); return rows(); }
    if (text.startsWith('INSERT INTO darshan_d3.source_seed_receipts')) { if (!this.currentRole) throw new Error('writer permission'); this.receipt = JSON.parse(values[1] as string); this.tables.get('darshan_d3.source_seed_receipts')!.push({ operation_id: values[0], receipt: this.receipt }); return rows(); }
    throw new Error(`unexpected fake SQL: ${text.slice(0, 90)}`);
  }
}
export class FakeD3DataObjects implements D3DataObjects {
  readonly objects = new Map<string, Buffer>(); puts = 0; failAt: number | null = null; buckets = false;
  async ensureBuckets() { this.buckets = true; }
  async putImmutable(object: D3SeedObject) { this.puts++; if (this.failAt === this.puts) { this.failAt = null; throw new Error('private object-error-marker'); } const key = `${object.bucket}/${object.key}`; const previous = this.objects.get(key); if (previous && sha256(previous) !== object.sha256) throw new Error('object conflict'); if (!previous) this.objects.set(key, Buffer.from(object.body)); await this.read(object.bucket, object.key); }
  async read(bucket: string, key: string) { const value = this.objects.get(`${bucket}/${key}`); if (!value) throw new Error('missing object'); return Buffer.from(value); }
  async list() { return [...this.objects.keys()].map((value) => { const slash = value.indexOf('/'); return { bucket: value.slice(0, slash), key: value.slice(slash + 1) }; }); }
  close() {}
}
export function fakeD3DataClients(db: FakeD3DataDatabase, objects: FakeD3DataObjects): D3DataClients { return { objects, connect: async () => ({ client: db as unknown as PoolClient, close: async () => undefined }), close: async () => undefined }; }
export const fakeD3MigrationPlan = () => ({ manifestFingerprint: '6e5c624c235629f01bf5c0b3875232da1ab99633b1e9cd787f1422c46291304d', databaseFingerprint: digest('fake-schema'), applied: [], pending: [], unmanagedObjects: [], adoptionRequired: false, ledgerPresent: true });
