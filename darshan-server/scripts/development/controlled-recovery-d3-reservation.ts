import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { requestBackupRunInTransaction, type TransactionalBackupRun } from '../../src/backups/coordination-transaction';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { assertD3OperationBinding, D3_ROOT, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile } from './controlled-recovery-d3-protected-files';
import { d3ReservationAuthoritySchema, validateD3ReservationBinding, type D3ReservationAuthority, type D3ReservationBinding } from './controlled-recovery-d3-reservation-contract';
import { D3_CONTROL_DDL, D3_CONTROL_DDL_SHA256, inspectD3BackupQueue, inspectD3ControlSchema, type D3ControlSql } from './controlled-recovery-d3-reservation-control';
import { d3ReservationProfileSchema, type D3ReservationProfile } from './controlled-recovery-d3-reservation-profile';
import type { D3ReservationInputs, D3ReservationPrerequisiteReader } from './controlled-recovery-d3-reservation-prerequisites';
import { checkoutD3DataSession, d3DataPoolConfig, type D3DataSession } from './controlled-recovery-d3-source-data-clients';
import { assertD3ExclusiveSqlWriter, assertD3SourceSealUnchanged, observeD3SourceSeal, verifyD3MigrationLedger } from './controlled-recovery-d3-source-seal';
import { d3SourceBackupProfileSchema, type D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import type { D3SourceLayoutBoundary } from './controlled-recovery-d3-source-services';

const failed = (code = 'CONTROLLED_RECOVERY_D3_RESERVATION_UNVERIFIED') => new ControlledRecoveryError(code, 'The fixed reservation authority, transaction, immutable binding, run or delivery is unverified.');
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_CANCELLED'); };
const safe = (cause: unknown) => cause instanceof ControlledRecoveryError ? cause : failed();
export interface D3ReservationDependencies { profile: D3ReservationProfile; profileSha256: string; prerequisites: D3ReservationPrerequisiteReader;
  session(signal?: AbortSignal): Promise<D3DataSession>; admit(): Promise<void>; withOperationLock<T>(action: () => Promise<T>): Promise<T>; now?: () => Date; sourceApplicationName?: 'darshan-d3-source-data'; allowVerifiedCompleted?: boolean; }

/** Creates only an explicit, certificate/pin verified source SQL pool; no S3, app config or ordinary jobs. */
export function d3ReservationSessionFactory(authority: D3OperationAuthority, source: D3SourceBackupProfile, layout: Pick<D3SourceLayoutBoundary, 'verify'>, profile: D3ReservationProfile) {
  profile = d3ReservationProfileSchema.parse(profile); source = d3SourceBackupProfileSchema.parse(source); authority = Object.freeze({ ...authority }); assertD3OperationBinding(authority, authority);
  if (authority.root !== D3_ROOT || authority.ownerUid !== process.getuid?.() || authority.ownerGid !== process.getgid?.()) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_WIRING_INVALID');
  return async (signal?: AbortSignal): Promise<D3DataSession> => {
    cancelled(signal); const verified = await layout.verify();
    const read = async (relative: string) => { const file = await openD3ProtectedFile(authority, `${authority.root}/source/${relative}`, 65536); try { return await file.readFile(); } finally { await file.close(); } };
    const ca = await read('tls/ca/ca.crt'), password = (await read('secrets/postgres-password')).toString('utf8').trim();
    const pool = new Pool({ ...d3DataPoolConfig({ profile: source, ca, password, certificateSha256: verified.certificates.postgres }), application_name: profile.application_name, query_timeout: profile.statement_timeout_ms, statement_timeout: profile.statement_timeout_ms });
    pool.on('error', () => undefined); let ending: Promise<void> | null = null; const end = () => ending ??= pool.end();
    try { return await checkoutD3DataSession(pool, end, signal); } catch (cause) { await end().catch(() => undefined); throw safe(cause); }
  };
}
function sameAuthority(binding: D3ReservationBinding, authority: D3ReservationAuthority) { const retained = d3ReservationAuthoritySchema.parse(Object.fromEntries(Object.entries(binding).filter(([key]) => key !== 'runId' && key !== 'bindingSha256'))); if (digest(retained) !== digest(authority)) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_BINDING_CHANGED'); }
async function readBinding(sql: D3ControlSql, authority: D3ReservationAuthority): Promise<D3ReservationBinding | null> {
  const rows = (await sql.query('SELECT operation_id,site_id,repository_id,backup_run_id,binding,binding_sha256 FROM darshan_d3_control.operation_backup_bindings ORDER BY operation_id LIMIT 2')).rows;
  if (rows.length > 1) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_BINDING_CHANGED'); if (!rows.length) return null;
  const row = rows[0]!, binding = validateD3ReservationBinding(row.binding); sameAuthority(binding, authority);
  if (row.operation_id !== binding.operationId || row.site_id !== binding.siteId || row.repository_id !== binding.repositoryId || row.backup_run_id !== binding.runId || row.binding_sha256 !== binding.bindingSha256) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_BINDING_CHANGED'); return binding;
}
export function assertD3ReservedRun(run: TransactionalBackupRun, binding: D3ReservationBinding, now: Date, allowCompleted = false) {
  if (run.id !== binding.runId || run.coordination_key !== `d3:${binding.siteId}` || run.trigger_type !== 'MANUAL' || run.triggered_by !== null || run.repository_kind !== 'LOCAL_FILESYSTEM' || run.schedule_identity !== null || run.repository_id !== null && run.repository_id !== binding.repositoryId || !run.queue_job_id || run.cancellation_requested_at !== null) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_CHANGED');
  if (allowCompleted && run.status === 'COMPLETED') { if (!run.attempt_id || run.lease_expires_at !== null || run.repository_id !== binding.repositoryId) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_CHANGED'); return; }
  if (!['PENDING', 'RETRY_WAIT', 'RUNNING'].includes(run.status)) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_TERMINAL');
  const future = (value: Date | null) => value !== null && Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() > now.getTime();
  if (!Number.isFinite(now.getTime()) || run.status === 'RUNNING' && (!run.attempt_id || !future(run.lease_expires_at) || !future(run.deadline_at))) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_FENCE_EXPIRED');
  if (run.status !== 'RUNNING' && (run.attempt_id !== null || run.lease_expires_at !== null)) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_CHANGED');
}
async function verifyDelivery(sql: D3ControlSql, run: TransactionalBackupRun) {
  const rows = (await sql.query("SELECT id,name,data,state FROM pgboss.job WHERE name='backup' AND id=$1 UNION ALL SELECT id,name,data,state FROM pgboss.archive WHERE name='backup' AND id=$1 LIMIT 2", [run.queue_job_id])).rows;
  if (rows.length !== 1 || rows[0]!.id !== run.queue_job_id || rows[0]!.name !== 'backup' || digest(rows[0]!.data) !== digest({ runId: run.id, queueJobId: run.queue_job_id }) || rows[0]!.state !== (run.status === 'RUNNING' ? 'active' : run.status === 'COMPLETED' ? 'completed' : 'created')) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_DELIVERY_CHANGED');
}
async function observeSource(sql: D3ControlSql, input: D3ReservationInputs, application = 'darshan-d3-reservation') {
  const a = input.authority;
  await assertD3ExclusiveSqlWriter(sql, application);
  const identity = (await sql.query("SELECT system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid, current_database() AS database, current_user AS user, current_setting('server_version_num')::integer AS version, ssl FROM pg_control_system(), pg_stat_ssl WHERE pid=pg_backend_pid()")).rows;
  const row = identity[0]; if (identity.length !== 1 || !row || !/^\d+$/.test(String(row.system_identifier)) || !/^\d+$/.test(String(row.database_oid)) || row.database !== 'darshan' || row.user !== 'darshan' || row.ssl !== true || Number(row.version) < 160000 || Number(row.version) >= 170000) throw failed();
  const physicalIdentity = { operationId: a.operationId, siteId: a.siteId, repositoryId: a.repositoryId, sourceProfileSha256: a.sourceProfileSha256, resources: input.resources, layoutSha256: a.layoutSha256, database: row };
  const ledger = verifyD3MigrationLedger(input.manifest, (await sql.query('SELECT migration_id, checksum_sha256, release_id, applied_method, execution_state, approval_ticket FROM public.darshan_schema_migrations ORDER BY migration_id')).rows);
  const receipts = (await sql.query('SELECT receipt FROM darshan_d3.source_seed_receipts WHERE operation_id=$1', [a.operationId])).rows;
  if (digest(physicalIdentity) !== a.physicalIdentitySha256 || ledger.fingerprint !== a.migrationFingerprint || receipts.length !== 1 || digest(receipts[0]!.receipt) !== a.sqlSeedReceiptSha256) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_SOURCE_CHANGED');
  const observed = await observeD3SourceSeal(sql, { physicalIdentity, configurationSha256: a.configurationSha256, migrationFingerprint: ledger.fingerprint, objects: input.seal.objectInventory });
  assertD3SourceSealUnchanged(input.seal, observed);
}

/** Real pg-boss SQL, using the same checked-out transaction; never start(), work(), migrate() or app jobs. */
function transactionBoss(sql: D3ControlSql) { return new PgBoss({ schema: 'pgboss', db: { executeSql: async (text, values = []) => ({ rows: (await sql.query(text, values)).rows }) }, migrate: false, schedule: false, supervise: false }); }

export class FixedD3BackupReservation {
  private readonly profile: D3ReservationProfile;
  constructor(private readonly d: D3ReservationDependencies) { const p = d3ReservationProfileSchema.parse(d.profile); if (digest(p) !== d.profileSha256 || !d.prerequisites || ['session', 'admit', 'withOperationLock'].some((key) => typeof d[key as keyof D3ReservationDependencies] !== 'function')) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_WIRING_INVALID'); this.profile = Object.freeze(p); }
  private async inputs(signal?: AbortSignal) { try { cancelled(signal); const input = await this.d.prerequisites.read(signal), a = d3ReservationAuthoritySchema.parse(input.authority); if (a.reservationProfileSha256 !== this.d.profileSha256 || a.controlDdlSha256 !== D3_CONTROL_DDL_SHA256 || a.sourceSealSha256 !== input.seal.sealSha256 || a.physicalIdentitySha256 !== input.seal.physicalIdentitySha256 || a.businessContentSha256 !== input.seal.businessContentSha256 || digest(input.resources) !== a.resourcesSha256) throw failed(); return input; } catch (cause) { throw safe(cause); } }
  private async transaction<T>(readOnly: boolean, signal: AbortSignal | undefined, action: (sql: D3DataSession['client']) => Promise<T>) {
    const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, this.profile.transaction_timeout_ms); let session: D3DataSession | null = null, begun = false, committing = false, result!: T, failure: unknown;
    try { cancelled(controller.signal); session = await this.d.session(controller.signal); cancelled(controller.signal); await session.client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN'); begun = true;
      await session.client.query("SET LOCAL statement_timeout='10000ms'; SET LOCAL lock_timeout='1000ms'"); result = await action(session.client); cancelled(controller.signal); committing = true; await session.client.query('COMMIT'); begun = false;
    } catch (cause) { failure = committing && !readOnly ? failed('CONTROLLED_RECOVERY_D3_RESERVATION_COMMIT_UNCERTAIN') : safe(cause); if (begun && session) { try { await session.client.query('ROLLBACK'); } catch { failure = failed('CONTROLLED_RECOVERY_D3_RESERVATION_SETTLEMENT_UNCERTAIN'); } } }
    finally { try { await session?.close(); } catch (cause) { if (cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED') failure ??= failed('CONTROLLED_RECOVERY_D3_RESERVATION_CANCELLED'); else failure = failed('CONTROLLED_RECOVERY_D3_RESERVATION_SETTLEMENT_UNCERTAIN'); } clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    if (failure) throw failure; return result;
  }
  async reserve(signal?: AbortSignal) {
    const before = await this.inputs(signal); await this.d.admit();
    return this.d.withOperationLock(async () => { const input = await this.inputs(signal); if (digest(input.authority) !== digest(before.authority)) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_BINDING_CHANGED'); await this.d.admit();
      return this.transaction(false, signal, async (sql) => {
        for (const lock of [`darshan-d3:site:${input.authority.siteId}`, `darshan-d3:operation:${input.authority.operationId}`]) { const rows = (await sql.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked', [lock])).rows; if (rows.length !== 1 || rows[0]!.locked !== true) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_BUSY'); }
        await observeSource(sql, input, this.d.sourceApplicationName ?? 'darshan-d3-reservation'); cancelled(signal);
        let control = await inspectD3ControlSchema(sql); if (!control.present) { await sql.query(D3_CONTROL_DDL); control = await inspectD3ControlSchema(sql); if (!control.present) throw failed(); }
        const prior = await readBinding(sql, input.authority);
        if (prior) { const run = (await sql.query('SELECT * FROM backup_runs WHERE id=$1 FOR UPDATE', [prior.runId])).rows[0] as TransactionalBackupRun | undefined; if (!run) throw failed(); assertD3ReservedRun(run, prior, this.d.now?.() ?? new Date()); }
        const jobs = transactionBoss(sql); await jobs.createQueue('backup', { name: 'backup', policy: 'standard', retryLimit: 0, retryDelay: 0, retryBackoff: false, expireInSeconds: 14700, retentionMinutes: 43200 });
        await inspectD3BackupQueue(sql); cancelled(signal);
        const requested = await requestBackupRunInTransaction(jobs, { triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey: `d3:${input.authority.siteId}` }, sql);
        if (!prior && requested.coalesced || prior && requested.run.id !== prior.runId) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_CHANGED');
        const unsigned = { ...input.authority, runId: requested.run.id }, binding = prior ?? validateD3ReservationBinding({ ...unsigned, bindingSha256: digest(unsigned) });
        if (!prior) await sql.query('INSERT INTO darshan_d3_control.operation_backup_bindings (operation_id,site_id,repository_id,backup_run_id,binding,binding_sha256) VALUES ($1,$2,$3,$4,$5::jsonb,$6)', [binding.operationId, binding.siteId, binding.repositoryId, binding.runId, JSON.stringify(binding), binding.bindingSha256]);
        const retained = await readBinding(sql, input.authority); if (!retained || digest(retained) !== digest(binding)) throw failed(); assertD3ReservedRun(requested.run, binding, this.d.now?.() ?? new Date()); await verifyDelivery(sql, requested.run); await inspectD3BackupQueue(sql);
        await observeSource(sql, input, this.d.sourceApplicationName ?? 'darshan-d3-reservation'); cancelled(signal); return this.report(binding, requested.run, requested.coalesced);
      });
    });
  }
  /** No admission/mutation lock, DDL, repair, queue creation or enqueue. All SQL is READ ONLY. */
  async status(signal?: AbortSignal) { const input = await this.inputs(signal); return this.transaction(true, signal, async (sql) => { await observeSource(sql, input, this.d.sourceApplicationName ?? 'darshan-d3-reservation'); const control = await inspectD3ControlSchema(sql); if (!control.present) return { status: 'NOT_RESERVED' as const, reservationEnabled: false, captureEnabled: false, brokerEnabled: false, wholeRunEnabled: false, nextAction: 'REVIEW_RESERVATION_ACTIVATION' };
    const binding = await readBinding(sql, input.authority); if (!binding) { await inspectD3BackupQueue(sql); return { status: 'NOT_RESERVED' as const, reservationEnabled: false, captureEnabled: false, brokerEnabled: false, wholeRunEnabled: false, nextAction: 'REVIEW_RESERVATION_ACTIVATION' }; }
    const rows = (await sql.query('SELECT * FROM backup_runs WHERE id=$1', [binding.runId])).rows; if (rows.length !== 1) throw failed(); const run = rows[0] as TransactionalBackupRun; assertD3ReservedRun(run, binding, this.d.now?.() ?? new Date(), this.d.allowVerifiedCompleted); if (run.status === 'COMPLETED') { const rows = (await sql.query("SELECT id FROM backup_publications WHERE backup_run_id=$1 AND backup_attempt_id=$2 AND status='VERIFIED' AND manifest_sha256=$3", [run.id, run.attempt_id, (run as unknown as { manifest_sha256: string }).manifest_sha256])).rows; if (rows.length !== 1) throw failed('CONTROLLED_RECOVERY_D3_RESERVATION_RUN_CHANGED'); } await verifyDelivery(sql, run); await inspectD3BackupQueue(sql); return this.report(binding, run, true); }); }
  private report(binding: D3ReservationBinding, run: TransactionalBackupRun, coalesced: boolean) { return { format: 'darshan-d3-reservation-report-v1', status: 'RESERVED' as const, operationId: binding.operationId, siteId: binding.siteId, repositoryId: binding.repositoryId, runId: binding.runId, queueJobId: run.queue_job_id, runStatus: run.status, bindingSha256: binding.bindingSha256, coalesced, reservationEnabled: false, captureEnabled: false, brokerEnabled: false, wholeRunEnabled: false, nextAction: 'REVIEW_CAPTURE_AND_BROKER_BOUNDARIES' }; }
}
