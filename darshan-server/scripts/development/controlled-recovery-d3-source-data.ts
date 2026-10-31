import { randomBytes } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import argon2 from 'argon2';
import PgBoss from 'pg-boss';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { loadMigrationManifest, manifestFingerprint, type MigrationManifestEntry } from '../../src/deployment/migration-manifest';
import { applyDatabaseMigrations, planDatabaseMigrations } from '../../src/deployment/migration-ledger';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { assertD3OperationBinding, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks } from './controlled-recovery-d3-protected-files';
import type { DurableD3SourceState } from './controlled-recovery-d3-source-state';
import type { D3SourceLayoutReceipt } from './controlled-recovery-d3-source-services';
import { buildD3DataFixtures, d3SeedId, d3SeedInsert, D3_SEED_END_TIME, D3_SEED_STALE_TIME, D3_SEED_TIME, type D3SeedObject } from './controlled-recovery-d3-source-data-fixtures';
import { type D3DataClients } from './controlled-recovery-d3-source-data-clients';
import { d3SourceDataProfileSchema, type D3SourceDataProfile } from './controlled-recovery-d3-source-data-profile';
import { assertD3ExclusiveSqlWriter, assertD3SourceSealUnchanged, d3SourceSealSchema, normalizeD3FoundationSchemaLabel, observeD3SourceSeal, verifyD3MigrationLedger, type D3DataSql, type D3SealedObject, type D3SourceSeal } from './controlled-recovery-d3-source-seal';

const failed = (code = 'CONTROLLED_RECOVERY_D3_SOURCE_DATA_UNVERIFIED') => new ControlledRecoveryError(code, 'The fixed migration, representative source data, immutable objects, writer lease or content seal is unverified.');
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const envelopeSchema = z.object({ format: z.literal('darshan-d3-source-data-receipt-v1'), operationId: z.string().uuid(), siteId: z.string(), repositoryId: z.string().uuid(),
  sourceProfileSha256: sha, dataProfileSha256: sha, kind: z.enum(['intent', 'schema', 'seal']), payload: z.record(z.unknown()), receiptSha256: sha }).strict();
const payloadSchemas = { intent: z.object({ seedPlanSha256: sha, layoutSha256: sha, resourcesSha256: sha, manifestSha256: sha }).strict(),
  schema: z.object({ manifestSha256: sha, databaseFingerprint: sha, migrationFingerprint: sha, terminal: z.literal('0057_controlled_recovery_report_projection.sql') }).strict(), seal: z.object({ intentSha256: sha, sqlReceiptSha256: sha, seal: d3SourceSealSchema }).strict() };
export type D3DataReceipt = z.infer<typeof envelopeSchema>;
/** Status never repairs exclusive-link commit windows or creates directories. */
export class DurableD3SourceData {
  constructor(readonly authority: D3OperationAuthority, readonly sourceProfileSha256: string, readonly dataProfileSha256: string, private readonly readOnly = false) {}
  readOnlyView() { return new DurableD3SourceData(this.authority, this.sourceProfileSha256, this.dataProfileSha256, true); }
  private get root() { return `${this.authority.root}/source/data`; }
  private get binding() { return { operationId: this.authority.operationId, siteId: this.authority.siteId, repositoryId: this.authority.repositoryId, sourceProfileSha256: this.sourceProfileSha256, dataProfileSha256: this.dataProfileSha256 }; }
  async read(kind: D3DataReceipt['kind']): Promise<D3DataReceipt | null> {
    const path = `${this.root}/${kind}.json`; let file;
    try { await protectD3Directory(this.authority, this.root); if (!this.readOnly) for (const name of ['intent', 'schema', 'seal']) await recoverD3PublishedLinks(this.authority, `${this.root}/${name}.json`);
      const entries = await readdir(this.root, { withFileTypes: true }); if (entries.some((entry) => entry.name === 'private' ? !entry.isDirectory() : !entry.isFile() || !['intent.json', 'schema.json', 'seal.json'].includes(entry.name))) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_PENDING');
      file = await openD3ProtectedFile(this.authority, path, 262144); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw failed(); }
    try { const bytes = await file.readFile(); const record = envelopeSchema.parse(parseStrictJson(bytes, 262144)); const { receiptSha256, ...unsigned } = record;
      payloadSchemas[kind].parse(record.payload); if (!canonicalJson(record).equals(bytes) || receiptSha256 !== digest(unsigned) || kind !== record.kind || Object.entries(this.binding).some(([key, value]) => record[key as keyof D3DataReceipt] !== value)) throw failed(); return record;
    } catch { throw failed(); } finally { await file.close(); }
  }
  async publish(kind: D3DataReceipt['kind'], payload: Record<string, unknown>) {
    if (this.readOnly) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_READ_ONLY'); payloadSchemas[kind].parse(payload); const unsigned = { format: 'darshan-d3-source-data-receipt-v1' as const, ...this.binding, kind, payload }; const record = envelopeSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) });
    const previous = await this.read(kind); if (previous) { if (digest(previous) !== digest(record)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT'); return previous; }
    try { await publishD3ProtectedBytes(this.authority, `${this.root}/${kind}.json`, canonicalJson(record)); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await this.read(kind)) !== digest(record)) throw failed(); } return record;
  }
  async fixtureInputs() {
    const privateRoot = `${this.root}/private`; await protectD3Directory(this.authority, privateRoot, !this.readOnly); const previous = await this.read('intent'); if (this.readOnly && !previous) throw failed();
    if (!this.readOnly) for (const name of ['admin-password', 'operator-password']) await recoverD3PublishedLinks(this.authority, `${privateRoot}/${name}`);
    const names = await readdir(privateRoot); if (names.some((name) => !['admin-password', 'operator-password'].includes(name))) throw failed();
    const password = async (name: string) => { const path = `${privateRoot}/${name}-password`; let file;
      try { file = await openD3ProtectedFile(this.authority, path, 128); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' || previous || this.readOnly) throw failed(); await publishD3ProtectedBytes(this.authority, path, Buffer.from(randomBytes(32).toString('hex') + '\n')); file = await openD3ProtectedFile(this.authority, path, 128); }
      try { const bytes = await file.readFile(); if (!/^[a-f0-9]{64}\n$/.test(bytes.toString('ascii'))) throw failed(); return argon2.hash(bytes.subarray(0, -1), { type: argon2.argon2id, salt: Buffer.from(digest({ operationId: this.authority.operationId, role: name }), 'hex').subarray(0, 16), memoryCost: 8192, timeCost: 2, parallelism: 1 }); } finally { await file.close(); } };
    const adminPasswordHash = await password('admin'); const operatorPasswordHash = await password('operator'); const file = await openD3ProtectedFile(this.authority, `${this.authority.root}/source/tls/postgres/server.crt`, 65536);
    try { return { adminPasswordHash, operatorPasswordHash, revokedCertificatePem: (await file.readFile()).toString('utf8') }; } finally { await file.close(); }
  }
}
export interface D3SourceDataDependencies {
  authority: D3OperationAuthority; profile: D3SourceDataProfile; profileSha256: string; sourceProfileSha256: string; state: DurableD3SourceState; store: DurableD3SourceData;
  observeServices(): Promise<{ resources: unknown[]; layout: D3SourceLayoutReceipt }>;
  admit(phase: string): Promise<void>; clients(): Promise<D3DataClients>;
  fixtureInputs(): ReturnType<DurableD3SourceData['fixtureInputs']>;
  readOnlyFixtureInputs(): ReturnType<DurableD3SourceData['fixtureInputs']>;
}
function cancelled(signal?: AbortSignal) { if (signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); }
export function verifyD3DataManifest(profile: D3SourceDataProfile, manifest: MigrationManifestEntry[]) {
  if (manifest.length !== profile.migration_count || manifestFingerprint(manifest) !== profile.manifest_sha256 || manifest.at(-1)?.id !== profile.terminal_migration) throw failed('CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH');
  // Legacy foundation filename sequences intentionally overlap. Post-baseline sequence 0035..0057 is contiguous.
  const post = manifest.filter(({ id }) => Number(id.slice(0, 4)) >= 35); if (post.length !== 23 || post.some(({ id }, index) => Number(id.slice(0, 4)) !== index + 35)) throw failed('CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH');
}
export function d3PgBossConstructionTransactionBody() { const plans = PgBoss.getConstructionPlans('pgboss');
  if (sha256(Buffer.from(plans)) !== '7b9593e6817ca69beb70db10424517c5bfb3086d3c0749858fdb75259466269d' || !/^\s*BEGIN;/.test(plans) || !/COMMIT;\s*$/.test(plans) || (plans.match(/\bCOMMIT\b/g) ?? []).length !== 1) throw failed();
  // The library supplies a transaction wrapper. Remove only that exact verified outer wrapper; retain function BEGIN/END blocks.
  return plans.replace(/^\s*BEGIN;\s*/, '').replace(/\s*COMMIT;\s*$/, ''); }
export async function verifyD3DataObjects(clients: D3DataClients, sql: D3DataSql, expected?: readonly D3SeedObject[], signal?: AbortSignal) {
  const listed = await clients.objects.list(signal); const refs = await sql.query('SELECT bucket, object_key AS key, size AS bytes, sha256 FROM public.storage_objects ORDER BY bucket COLLATE "C", object_key COLLATE "C"');
  if (listed.length !== refs.rows.length || expected && expected.length !== listed.length) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_OBJECT_CONFLICT');
  const inventory: D3SealedObject[] = []; for (const reference of refs.rows) { cancelled(signal); const bucket = String(reference.bucket); const key = String(reference.key); if (!listed.some((value) => value.bucket === bucket && value.key === key)) throw failed(); const bytes = await clients.objects.read(bucket, key, signal); const object = { bucket, key, bytes: bytes.length, sha256: sha256(bytes) };
    if (reference.bytes !== object.bytes || reference.sha256 !== object.sha256 || expected && !expected.some((value) => value.bucket === bucket && value.key === key && value.bytes === object.bytes && value.sha256 === object.sha256)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_OBJECT_CONFLICT'); inventory.push(object); }
  const media = await sql.query('SELECT m.source_bucket AS bucket, m.source_object_key AS key, m.source_size AS bytes, m.source_object_id, s.id AS registered_id FROM public.media m LEFT JOIN public.storage_objects s ON s.id=m.source_object_id AND s.bucket=m.source_bucket AND s.object_key=m.source_object_key');
  if (media.rows.some((row) => row.source_object_id !== row.registered_id || !inventory.some((value) => value.bucket === row.bucket && value.key === row.key && value.bytes === row.bytes))) throw failed(); return inventory;
}
async function physical(sql: D3DataSql, authority: D3OperationAuthority, truth: { resources: unknown[]; layout: D3SourceLayoutReceipt }, sourceProfileSha256: string) {
  const value = await sql.query("SELECT system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid, current_database() AS database, current_user AS user, current_setting('server_version_num')::integer AS version, ssl FROM pg_control_system(), pg_stat_ssl WHERE pid=pg_backend_pid()");
  const row = value.rows[0]; if (value.rows.length !== 1 || !row || !/^\d+$/.test(String(row.system_identifier)) || !/^\d+$/.test(String(row.database_oid)) || row.database !== 'darshan' || row.user !== 'darshan' || row.ssl !== true || Number(row.version) < 160000 || Number(row.version) >= 170000) throw failed();
  return { operationId: authority.operationId, siteId: authority.siteId, repositoryId: authority.repositoryId, sourceProfileSha256, resources: truth.resources, layoutSha256: digest(truth.layout), database: row };
}
async function ledger(sql: D3DataSql, manifest: MigrationManifestEntry[]) { return verifyD3MigrationLedger(manifest, (await sql.query('SELECT migration_id, checksum_sha256, release_id, applied_method, execution_state, approval_ticket FROM public.darshan_schema_migrations ORDER BY migration_id')).rows); }
const receiptSql = 'SELECT receipt FROM darshan_d3.source_seed_receipts WHERE operation_id=$1';
async function sqlReceipt(sql: D3DataSql, operationId: string) { const present = await sql.query("SELECT to_regclass('darshan_d3.source_seed_receipts') IS NOT NULL AS present"); if (!present.rows[0]?.present) return null; const result = await sql.query(receiptSql, [operationId]); if (result.rows.length > 1) throw failed(); return result.rows[0]?.receipt as Record<string, unknown> | undefined ?? null; }
async function seedRoleIdentity(sql: D3DataSql) { const roles = await sql.query("SELECT oid::text AS role_oid,rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=pg_roles.oid OR member=pg_roles.oid) AS membership FROM pg_roles WHERE rolname='darshan_d3_seed'");
  const role = roles.rows[0]; if (roles.rows.length !== 1 || !role || !/^\d+$/.test(String(role.role_oid)) || role.rolname !== 'darshan_d3_seed' || Object.entries(role).some(([key, value]) => !['role_oid', 'rolname'].includes(key) && value !== false)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_WRITER_NOT_REVOKED'); return digest(role); }
async function assertSeedRoleRevoked(sql: D3DataSql) { const identity = await seedRoleIdentity(sql);
  const grants = await sql.query("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgboss','darshan_d3') AND c.relkind IN ('r','p') AND (has_table_privilege('darshan_d3_seed',c.oid,'INSERT') OR has_table_privilege('darshan_d3_seed',c.oid,'UPDATE') OR has_table_privilege('darshan_d3_seed',c.oid,'DELETE') OR has_table_privilege('darshan_d3_seed',c.oid,'TRUNCATE'))"); if (grants.rows.length) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_WRITER_NOT_REVOKED'); return identity; }
async function revokeSeedRole(sql: D3DataSql, expectedIdentity: string) { if (await seedRoleIdentity(sql) !== expectedIdentity) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT'); await sql.query('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public, pgboss, darshan_d3 FROM darshan_d3_seed'); await sql.query('REVOKE ALL PRIVILEGES ON SCHEMA public, pgboss, darshan_d3 FROM darshan_d3_seed'); await assertSeedRoleRevoked(sql); }

/** Migration runner and fixture DML are real. Injected clients are used only by deterministic tests. */
export class FixedD3SourceData {
  constructor(private readonly d: D3SourceDataDependencies) {}
  assertSeedEnrolled() { if (!this.d.profile.providers_enabled || !this.d.profile.live_seed_enabled) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_NOT_ADMITTED'); }
  private assertWiring() { const d = this.d; assertD3OperationBinding(d.authority, d.authority); d3SourceDataProfileSchema.parse(d.profile);
    if (digest(d.profile) !== d.profileSha256 || d.profile.source_profile_sha256 !== d.sourceProfileSha256 || d.sourceProfileSha256 !== d.state.profileSha256 || d.store.sourceProfileSha256 !== d.sourceProfileSha256 || d.store.dataProfileSha256 !== d.profileSha256 || digest(d.authority) !== digest(d.state.authority) || digest(d.authority) !== digest(d.store.authority) || ['observeServices', 'admit', 'clients', 'fixtureInputs', 'readOnlyFixtureInputs'].some((key) => typeof d[key as keyof D3SourceDataDependencies] !== 'function')) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_WIRING_INVALID'); }
  private async manifest() { if (process.cwd() !== '/home/hexmon/Desktop/DARSHAN-SIGNAGE/darshan-server') throw failed('CONTROLLED_RECOVERY_D3_SCHEMA_MISMATCH'); const manifest = await loadMigrationManifest(this.d.profile.migrations_directory); verifyD3DataManifest(this.d.profile, manifest); if (normalizeD3FoundationSchemaLabel(this.d.authority.schemaId) !== manifest.at(-1)?.id) throw failed(); return manifest; }
  private async observe(manifest: MigrationManifestEntry[], expected?: readonly D3SeedObject[], signal?: AbortSignal) {
    const d = this.d; const truth = await d.observeServices(); const clients = await d.clients(); const session = await clients.connect(signal).catch(async (cause) => { await clients.close(); throw cause instanceof ControlledRecoveryError ? cause : failed(); });
    try { await session.client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); await assertD3ExclusiveSqlWriter(session.client, d.profile.application_name); const writerRoleIdentitySha256 = await assertSeedRoleRevoked(session.client); const migrations = await ledger(session.client, manifest); const plan = await planDatabaseMigrations(session.client, manifest); if (plan.pending.length || plan.adoptionRequired || plan.manifestFingerprint !== d.profile.manifest_sha256) throw failed();
      const receipt = await sqlReceipt(session.client, d.authority.operationId); if (!receipt) throw failed(); const objects = await verifyD3DataObjects(clients, session.client, expected, signal);
      const seal = await observeD3SourceSeal(session.client, { physicalIdentity: await physical(session.client, d.authority, truth, d.sourceProfileSha256), configurationSha256: digest({ sourceProfileSha256: d.sourceProfileSha256, dataProfileSha256: d.profileSha256, layoutSha256: digest(truth.layout) }), migrationFingerprint: migrations.fingerprint, objects });
      await assertD3ExclusiveSqlWriter(session.client, d.profile.application_name); cancelled(signal); await session.client.query('COMMIT'); return { seal, migrations, databaseFingerprint: plan.databaseFingerprint, receipt, writerRoleIdentitySha256 };
    } catch (cause) { await session.client.query('ROLLBACK').catch(() => undefined); throw cause; } finally { try { await session.close(); } finally { await clients.close(); } }
  }
  async status(signal?: AbortSignal) { this.assertWiring(); cancelled(signal); const d = this.d; const stages = await d.state.readOnlyView().stages(); if (stages.length < 3 || stages.length > 5 || stages.length === 5 && stages[4]?.stage !== 'CAPSULE_READY' || await d.state.readOnlyView().stopReceipt()) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED'); const store = d.store.readOnlyView(); const retained = await store.read('seal'); if (!retained) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_PENDING');
    const intent = await store.read('intent'); if (!intent || intent.receiptSha256 !== retained.payload.intentSha256) throw failed(); const fixtures = await buildD3DataFixtures(d.authority, await d.readOnlyFixtureInputs()); if (fixtures.planSha256 !== intent.payload.seedPlanSha256) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT'); const manifest = await this.manifest(); const observed = await this.observe(manifest, fixtures.objects, signal); if (retained.payload.sqlReceiptSha256 !== digest(observed.receipt)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT'); assertD3SourceSealUnchanged(retained.payload.seal as unknown as D3SourceSeal, observed.seal); this.assertReceipt(observed.receipt, retained.payload.intentSha256 as string, observed.seal, observed.writerRoleIdentitySha256); const schema = await store.read('schema'); if (!schema || schema.payload.databaseFingerprint !== observed.databaseFingerprint || schema.payload.migrationFingerprint !== observed.migrations.fingerprint || stages[2]?.evidenceSha256 !== schema.receiptSha256 || stages[3]?.evidenceSha256 !== retained.receiptSha256) throw failed();
    return this.report('data-status', observed.seal, 'VERIFIED'); }
  private assertReceipt(receipt: Record<string, unknown>, intentSha256: string, seal: D3SourceSeal, writerRoleIdentitySha256: string) { const d = this.d; const expected = { format: 'darshan-d3-sql-seed-v1', operationId: d.authority.operationId, siteId: d.authority.siteId, repositoryId: d.authority.repositoryId, sourceProfileSha256: d.sourceProfileSha256, dataProfileSha256: d.profileSha256, intentSha256, physicalIdentitySha256: seal.physicalIdentitySha256, businessContentSha256: seal.businessContentSha256, migrationFingerprint: seal.migrationFingerprint, configurationSha256: seal.configurationSha256, writerRoleIdentitySha256 };
    if (digest(receipt) !== digest(expected)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT'); }
  private report(command: string, seal: D3SourceSeal, status: string) { return { format: 'darshan-d3-source-data-report-v1', command, status, physicalIdentitySha256: seal.physicalIdentitySha256, businessContentSha256: seal.businessContentSha256, migrationFingerprint: seal.migrationFingerprint, objects: seal.objectInventory.length, tables: seal.tables.length, fixtureDerivativesAreConversionEvidence: false, writerRevoked: true, capsuleEnabled: false, captureEnabled: false, wholeRunEnabled: false, nextAction: 'REVIEW_CAPSULE_BOUNDARY' }; }
  async seed(signal?: AbortSignal) {
    const d = this.d; this.assertSeedEnrolled(); this.assertWiring();
    await d.state.assertCurrentCommand(); await d.admit('DATA_SEED_ENTRY'); cancelled(signal); const stages = await d.state.stages(); if (stages.length < 2 || stages.length > 4 || await d.state.stopReceipt()) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_STAGE_REQUIRED');
    const truth = await d.observeServices(); const manifest = await this.manifest(); const fixtures = await buildD3DataFixtures(d.authority, await d.fixtureInputs()); const intent = await d.store.publish('intent', { seedPlanSha256: fixtures.planSha256, layoutSha256: digest(truth.layout), resourcesSha256: digest(truth.resources), manifestSha256: manifestFingerprint(manifest) });
    const retainedHostSeal = await d.store.read('seal'); const clients = await d.clients(); const session = await clients.connect(signal).catch(async (cause) => { await clients.close(); throw cause instanceof ControlledRecoveryError ? cause : failed(); }); let committed = false; let writerRoleIdentitySha256 = '';
    try { const lease = await session.client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [`darshan-d3-source-data:${d.authority.operationId}`]); if (lease.rows[0]?.acquired !== true) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_LEASE_BUSY'); await assertD3ExclusiveSqlWriter(session.client, d.profile.application_name); await physical(session.client, d.authority, truth, d.sourceProfileSha256); await d.admit('DATA_MIGRATIONS'); cancelled(signal);
      const plan = await applyDatabaseMigrations(session.client, manifest, 'release-03', { timeoutMs: 1000, pollIntervalMs: 50 }); if (plan.pending.length || plan.adoptionRequired || plan.manifestFingerprint !== d.profile.manifest_sha256) throw failed(); const migrations = await ledger(session.client, manifest);
      const schema = await d.store.publish('schema', { manifestSha256: plan.manifestFingerprint, databaseFingerprint: plan.databaseFingerprint, migrationFingerprint: migrations.fingerprint, terminal: migrations.terminal });
      await d.state.appendStage('SCHEMA_READY', schema.receiptSha256, (await d.state.resources()).resources);
      const retainedSql = await sqlReceipt(session.client, d.authority.operationId);
      if (retainedHostSeal && (!retainedSql || retainedHostSeal.payload.sqlReceiptSha256 !== digest(retainedSql))) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT');
      if (!retainedSql) {
        await d.admit('DATA_OBJECTS'); cancelled(signal); await clients.objects.ensureBuckets(signal); for (const object of fixtures.objects) { cancelled(signal); await clients.objects.putImmutable(object, signal); }
        await d.admit('DATA_TRANSACTION'); cancelled(signal); await assertD3ExclusiveSqlWriter(session.client, d.profile.application_name); await session.client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        try { const conflicts = await session.client.query("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('pgboss','darshan_d3')) OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname='darshan_d3_seed') AS conflict"); if (conflicts.rows[0]?.conflict !== false) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT');
          // Reject any preexisting business rows; migration/bootstrap metadata is the only admitted prefix.
          const before = await observeD3SourceSeal(session.client, { physicalIdentity: {}, configurationSha256: digest({}), migrationFingerprint: migrations.fingerprint, objects: [] }); if (before.tables.some((table) => table.rows !== 0)) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CONFLICT');
          await session.client.query(d3PgBossConstructionTransactionBody()); await session.client.query("SELECT pgboss.create_queue('d3-source-fixture', '{}'::json)"); await session.client.query('UPDATE pgboss.queue SET created_on=$1,updated_on=$1', [D3_SEED_TIME]);
          await session.client.query('CREATE SCHEMA darshan_d3'); await session.client.query('CREATE TABLE darshan_d3.source_seed_receipts (operation_id uuid PRIMARY KEY, receipt jsonb NOT NULL)');
          await session.client.query('CREATE ROLE darshan_d3_seed NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS');
          await session.client.query('GRANT USAGE ON SCHEMA public, pgboss, darshan_d3 TO darshan_d3_seed'); const names = [...new Set(fixtures.rows.map(({ table }) => table))]; await session.client.query(`GRANT SELECT, INSERT ON ${names.map((table) => `public."${table}"`).join(',')},pgboss.job,darshan_d3.source_seed_receipts TO darshan_d3_seed`);
          await session.client.query('SET LOCAL ROLE darshan_d3_seed'); for (const row of fixtures.rows) { cancelled(signal); const insert = d3SeedInsert(row); await session.client.query(insert.text, insert.parameters); }
          await session.client.query("INSERT INTO pgboss.job (id,name,data,state,start_after,started_on,created_on,keep_until,retry_count) VALUES ($1,'d3-source-fixture',$2,'active',$3,$3,$3,$4,1)", [d3SeedId(d.authority.operationId, 'pgboss-job'), JSON.stringify({ fixture: 'D3 stale work', screenId: fixtures.ids.screen }), D3_SEED_STALE_TIME, D3_SEED_END_TIME]);
          await session.client.query('RESET ROLE'); const objects = await verifyD3DataObjects(clients, session.client, fixtures.objects, signal); const seal = await observeD3SourceSeal(session.client, { physicalIdentity: await physical(session.client, d.authority, truth, d.sourceProfileSha256), configurationSha256: digest({ sourceProfileSha256: d.sourceProfileSha256, dataProfileSha256: d.profileSha256, layoutSha256: digest(truth.layout) }), migrationFingerprint: migrations.fingerprint, objects });
          writerRoleIdentitySha256 = await seedRoleIdentity(session.client); const receipt = { format: 'darshan-d3-sql-seed-v1', operationId: d.authority.operationId, siteId: d.authority.siteId, repositoryId: d.authority.repositoryId, sourceProfileSha256: d.sourceProfileSha256, dataProfileSha256: d.profileSha256, intentSha256: intent.receiptSha256, physicalIdentitySha256: seal.physicalIdentitySha256, businessContentSha256: seal.businessContentSha256, migrationFingerprint: seal.migrationFingerprint, configurationSha256: seal.configurationSha256, writerRoleIdentitySha256 };
          await session.client.query('SET LOCAL ROLE darshan_d3_seed'); await session.client.query('INSERT INTO darshan_d3.source_seed_receipts (operation_id,receipt) VALUES ($1,$2)', [d.authority.operationId, JSON.stringify(receipt)]); await session.client.query('RESET ROLE'); await assertD3ExclusiveSqlWriter(session.client, d.profile.application_name); cancelled(signal); await session.client.query('COMMIT'); committed = true;
        } catch (cause) { await session.client.query('ROLLBACK').catch(() => undefined); throw cause; }
      } else { const objects = await verifyD3DataObjects(clients, session.client, fixtures.objects, signal); const seal = await observeD3SourceSeal(session.client, { physicalIdentity: await physical(session.client, d.authority, truth, d.sourceProfileSha256), configurationSha256: digest({ sourceProfileSha256: d.sourceProfileSha256, dataProfileSha256: d.profileSha256, layoutSha256: digest(truth.layout) }), migrationFingerprint: migrations.fingerprint, objects }); writerRoleIdentitySha256 = await seedRoleIdentity(session.client); this.assertReceipt(retainedSql, intent.receiptSha256, seal, writerRoleIdentitySha256); committed = true; }
      // A commit-window retry first verifies the exact SQL receipt and content, then re-revokes this owned NOLOGIN writer.
      if (committed) await revokeSeedRole(session.client, writerRoleIdentitySha256);
    } catch (cause) { if (signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); if (cause instanceof ControlledRecoveryError) throw cause; throw failed(); }
    finally { try { await session.close(); } finally { await clients.close(); } }
    await d.admit('DATA_SEAL_REOBSERVE'); cancelled(signal); const observed = await this.observe(manifest, fixtures.objects, signal); this.assertReceipt(observed.receipt, intent.receiptSha256, observed.seal, observed.writerRoleIdentitySha256);
    let receipt = await d.store.read('seal'); if (receipt) { if (receipt.payload.intentSha256 !== intent.receiptSha256 || receipt.payload.sqlReceiptSha256 !== digest(observed.receipt)) throw failed(); assertD3SourceSealUnchanged(receipt.payload.seal as unknown as D3SourceSeal, observed.seal); }
    else receipt = await d.store.publish('seal', { intentSha256: intent.receiptSha256, sqlReceiptSha256: digest(observed.receipt), seal: observed.seal }); await d.state.appendStage('SEEDED_AND_SEALED', receipt.receiptSha256, (await d.state.resources()).resources); return this.report('seed', observed.seal, 'VERIFIED');
  }
}
