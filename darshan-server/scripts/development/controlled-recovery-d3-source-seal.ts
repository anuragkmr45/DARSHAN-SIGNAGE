import { createHash } from 'node:crypto';
import { z } from 'zod';
import { D3_BACKUP_QUEUE_PARTITION, inspectD3BackupQueue, inspectD3ControlSchema } from './controlled-recovery-d3-reservation-control';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { isBackupObjectAllowed } from '../../src/deployment/backup-contract';
import type { MigrationManifestEntry } from '../../src/deployment/migration-manifest';

export interface D3DataSql { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>; }
export interface D3SealedObject { bucket: string; key: string; bytes: number; sha256: string; }
export const D3_DATA_OPERATIONAL_EXCLUSIONS = Object.freeze([
  'darshan_d3.source_seed_receipts', 'public.backup_runs', 'public.backup_captures', 'public.backup_publications', 'public.backup_execution_outcomes',
  'public.backup_artifact_lifecycles', 'public.backup_retention_operations', 'public.backup_retention_request_idempotency', 'public.backup_retention_artifact_progress',
  'public.backup_restore_hold_projections', 'public.backup_retention_tombstones', 'public.maintenance_site_state', 'public.maintenance_operations',
  'public.darshan_deployment_runs', 'public.controlled_recovery_report_projections', 'public.worker_runtime_heartbeats',
] as const);
const failed = (code = 'CONTROLLED_RECOVERY_D3_SOURCE_SEAL_UNVERIFIED') => new ControlledRecoveryError(code, 'The fixed physical identity, complete business content or writer boundary is unverified.');
const identifier = (value: string) => { if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw failed(); return `"${value}"`; };
export function normalizeD3FoundationSchemaLabel(value: string) { if (value === '0057_controlled_recovery_report_projection') return `${value}.sql`; return value; }
export function verifyD3MigrationLedger(manifest: readonly MigrationManifestEntry[], rows: readonly Record<string, unknown>[], releaseId = 'release-03') {
  if (!manifest.length || manifest.at(-1)?.id !== '0057_controlled_recovery_report_projection.sql' || rows.length !== manifest.length) throw failed('CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH');
  const ledger = rows.map((row, index) => { const entry = manifest[index]!;
    // Production migration 0038 records baseline provenance separately from applied success.
    const completed = row.applied_method === 'BASELINED' && row.execution_state === 'BASELINED' || row.applied_method === 'APPLIED' && row.execution_state === 'SUCCEEDED';
    if (row.migration_id !== entry.id || row.checksum_sha256 !== entry.checksum || row.release_id !== releaseId || !completed || row.approval_ticket !== null) throw failed('CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH'); return { id: entry.id, checksum: entry.checksum, releaseId, method: row.applied_method, executionState: row.execution_state, approvalTicket: row.approval_ticket }; });
  return { terminal: manifest.at(-1)!.id, fingerprint: digest(ledger), ledger };
}
export async function assertD3ExclusiveSqlWriter(sql: D3DataSql, expectedApplication: string) {
  const result = await sql.query("SELECT pid, usename, application_name, state, backend_type, pid = pg_backend_pid() AS own FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend' ORDER BY pid");
  if (result.rows.length !== 1 || result.rows[0]?.own !== true || result.rows[0]?.application_name !== expectedApplication || result.rows[0]?.usename !== 'darshan') throw failed('CONTROLLED_RECOVERY_D3_SOURCE_OTHER_WRITER');
}
export interface D3SourceSeal { format: 'darshan-d3-source-seal-v1'; physicalIdentitySha256: string; businessContentSha256: string; migrationFingerprint: string;
  configurationSha256: string; schemaCatalogSha256: string; objectInventory: D3SealedObject[]; tables: Array<{ table: string; rows: number; sha256: string }>; operationalTables: Array<{ table: string; rows: number; sha256: string }>; sealSha256: string; }
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const table = z.object({ table: z.string().regex(/^(public|pgboss|darshan_d3)\.[a-z_][a-z0-9_]*$/), rows: z.number().int().min(0).max(10000), sha256: sha }).strict();
export const d3SourceSealSchema = z.object({ format: z.literal('darshan-d3-source-seal-v1'), physicalIdentitySha256: sha, businessContentSha256: sha, migrationFingerprint: sha, configurationSha256: sha, schemaCatalogSha256: sha,
  objectInventory: z.array(z.object({ bucket: z.string(), key: z.string(), bytes: z.number().int().positive().max(33554432), sha256: sha }).strict()).max(32), tables: z.array(table).max(256), operationalTables: z.array(table).max(64), sealSha256: sha }).strict();
/** Full row bytes, not counts, determine content. Partition rows are read once through their parent table. */
export async function observeD3SourceSeal(sql: D3DataSql, input: { physicalIdentity: unknown; configurationSha256: string; migrationFingerprint: string; objects: readonly D3SealedObject[]; maximumBytes?: number }): Promise<D3SourceSeal> {
  const objectInventory = [...input.objects].sort((a, b) => `${a.bucket}/${a.key}`.localeCompare(`${b.bucket}/${b.key}`));
  if (new Set(objectInventory.map(({ bucket, key }) => `${bucket}/${key}`)).size !== objectInventory.length || objectInventory.some(({ bucket, key, bytes, sha256 }) => !isBackupObjectAllowed(bucket, key) || !Number.isSafeInteger(bytes) || bytes < 1 || !/^[a-f0-9]{64}$/.test(sha256))) throw failed();
  // Only this validated development schema and its exact owned backup queue are operational.
  // All other pg-boss rows/catalog (including the representative stale fixture) stay sealed.
  const control = await inspectD3ControlSchema(sql);
  const backup = control.present ? await inspectD3BackupQueue(sql) : null;
  const backupQueue = backup?.present === true;
  if (backup?.binding) { const identity = input.physicalIdentity as Record<string, unknown>; const binding = backup.binding;
    if (!identity || typeof identity !== 'object' || binding.operationId !== identity.operationId || binding.siteId !== identity.siteId || binding.repositoryId !== identity.repositoryId || binding.sourceProfileSha256 !== identity.sourceProfileSha256 || binding.layoutSha256 !== identity.layoutSha256 || binding.resourcesSha256 !== digest(identity.resources) || binding.physicalIdentitySha256 !== digest(input.physicalIdentity) || binding.configurationSha256 !== input.configurationSha256 || binding.migrationFingerprint !== input.migrationFingerprint) throw failed(); }
  const catalog = await sql.query("SELECT n.nspname AS schema, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid) ORDER BY n.nspname COLLATE \"C\", c.relname COLLATE \"C\"");
  const tables: D3SourceSeal['tables'] = []; const operationalTables: D3SourceSeal['operationalTables'] = []; let total = 0;
  if (catalog.rows.length > 256) throw failed();
  for (const row of catalog.rows) { const schema = String(row.schema); const name = String(row.name); if (schema === 'darshan_d3_control' && control.present && name === 'operation_backup_bindings') continue;
    if (!['public', 'pgboss', 'darshan_d3'].includes(schema) || schema === 'darshan_d3' && name !== 'source_seed_receipts') throw failed(); const table = `${schema}.${name}`;
    if (table === 'public.darshan_schema_migrations') continue; // Complete immutable ledger identity is supplied separately; execution timestamps are operational metadata.
    const result = await sql.query(`SELECT to_jsonb(t)::text AS row FROM ${identifier(schema)}.${identifier(name)} t${backupQueue && schema === 'pgboss' && ['job', 'archive', 'queue', 'schedule', 'subscription'].includes(name) ? " WHERE name <> 'backup'" : ''} ORDER BY to_jsonb(t)::text COLLATE "C" LIMIT 10001`); if (result.rows.length > 10000) throw failed();
    const hash = createHash('sha256'); for (const value of result.rows) { if (typeof value.row !== 'string') throw failed(); const bytes = Buffer.from(value.row); total += bytes.length; if (total > (input.maximumBytes ?? 33554432)) throw failed(); hash.update(`${bytes.length}:`); hash.update(bytes); }
    const evidence = { table, rows: result.rows.length, sha256: hash.digest('hex') }; if ((D3_DATA_OPERATIONAL_EXCLUSIONS as readonly string[]).includes(table)) operationalTables.push(evidence); else tables.push(evidence);
  }
  if (!tables.some(({ table }) => table === 'public.users') || !tables.some(({ table }) => table === 'public.media')) throw failed();
  const definitions = await sql.query("SELECT to_jsonb(d)::text AS definition FROM (SELECT table_schema, table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema IN ('public','pgboss','darshan_d3')) d ORDER BY to_jsonb(d)::text COLLATE \"C\"");
  const constraints = await sql.query("SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid,true) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgboss','darshan_d3') ORDER BY n.nspname,c.relname,con.conname");
  const indexes = await sql.query("SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','pgboss','darshan_d3') ORDER BY schemaname,tablename,indexname");
  const functions = await sql.query("SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','pgboss','darshan_d3') AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)");
  const triggers = await sql.query(`SELECT n.nspname AS schema,c.relname AS relation,CASE WHEN t.tgisinternal THEN fk.conname ELSE t.tgname END AS name,CASE WHEN t.tgisinternal THEN NULL ELSE pg_get_triggerdef(t.oid,true) END AS definition,t.tgenabled AS enabled,t.tgisinternal AS internal,t.tgtype AS type,t.tgdeferrable AS deferrable,t.tginitdeferred AS initially_deferred,pn.nspname AS function_schema,p.proname AS function_name,fk.conname AS constraint_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace LEFT JOIN pg_constraint fk ON fk.oid=t.tgconstraint WHERE n.nspname IN ('public','pgboss','darshan_d3') AND (NOT t.tgisinternal OR fk.contype='f') ${backupQueue ? `AND (fk.conrelid IS NULL OR fk.conrelid <> 'pgboss.${D3_BACKUP_QUEUE_PARTITION}'::regclass)` : ''} ORDER BY n.nspname,c.relname,CASE WHEN t.tgisinternal THEN fk.conname ELSE t.tgname END,t.tgisinternal,pn.nspname,p.proname,t.tgtype`);
  const enums = await sql.query("SELECT n.nspname AS schema,t.typname AS name,array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','pgboss','darshan_d3') GROUP BY n.nspname,t.typname ORDER BY n.nspname COLLATE \"C\",t.typname COLLATE \"C\"");
  const policies = await sql.query("SELECT * FROM pg_policies WHERE schemaname IN ('public','pgboss','darshan_d3') ORDER BY schemaname,tablename,policyname");
  const relations = await sql.query("SELECT n.nspname AS schema,c.relname AS name,c.relkind::text AS kind,c.relrowsecurity,c.relforcerowsecurity,pg_get_partkeydef(c.oid) AS partition_key,pg_get_expr(c.relpartbound,c.oid) AS partition_bound,CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) ELSE NULL END AS view_definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgboss','darshan_d3') AND c.relkind IN ('r','p','v','m') ORDER BY n.nspname,c.relname");
  if (backupQueue) {
    const partition = D3_BACKUP_QUEUE_PARTITION;
    definitions.rows = definitions.rows.filter((row) => { const value = JSON.parse(String(row.definition)); return value.table_schema !== 'pgboss' || value.table_name !== partition; });
    constraints.rows = constraints.rows.filter((row) => row.schema !== 'pgboss' || row.table !== partition);
    indexes.rows = indexes.rows.filter((row) => row.schemaname !== 'pgboss' || row.tablename !== partition);
    policies.rows = policies.rows.filter((row) => row.schemaname !== 'pgboss' || row.tablename !== partition);
    relations.rows = relations.rows.filter((row) => row.schema !== 'pgboss' || row.name !== partition);
  }
  const schemaEvidence = { definitions: definitions.rows, constraints: constraints.rows, indexes: indexes.rows, functions: functions.rows, triggers: triggers.rows, enums: enums.rows, policies: policies.rows, relations: relations.rows };
  if (Object.values(schemaEvidence).some((rows) => rows.length > 16384) || Buffer.byteLength(JSON.stringify(schemaEvidence)) > 8388608) throw failed();
  const schemaCatalogSha256 = digest(schemaEvidence);
  const physicalIdentitySha256 = digest(input.physicalIdentity); const configurationSha256 = input.configurationSha256; const migrationFingerprint = input.migrationFingerprint;
  const businessContentSha256 = digest({ tables, objectInventory, configurationSha256, migrationFingerprint, schemaCatalogSha256 }); const sealed = { format: 'darshan-d3-source-seal-v1' as const, physicalIdentitySha256, businessContentSha256, migrationFingerprint, configurationSha256, schemaCatalogSha256, objectInventory, tables, operationalTables };
  if (backup?.binding && backup.binding.businessContentSha256 !== businessContentSha256) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTENT_CHANGED');
  return { ...sealed, sealSha256: digest({ physicalIdentitySha256, businessContentSha256, migrationFingerprint, configurationSha256 }) };
}
export function assertD3SourceSealUnchanged(retained: D3SourceSeal, observed: D3SourceSeal) {
  if (retained.physicalIdentitySha256 !== observed.physicalIdentitySha256 || retained.businessContentSha256 !== observed.businessContentSha256 || retained.migrationFingerprint !== observed.migrationFingerprint || retained.configurationSha256 !== observed.configurationSha256) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CONTENT_CHANGED');
}
