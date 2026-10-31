import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '@/db';
import { acquireBackupExecutionLock, type BackupExecutionLock } from './coordination';
import type {
  BackupBrokerWorkerAdapter,
  BrokerDeletionResult,
  BrokerLifecycleIdentity,
} from './backup-broker-worker-adapter';
import { planBackupRetention, type BackupRetentionPolicy, type RetentionDecision } from './retention-policy';
import {
  listBackupRetentionInventory,
  projectTerminalBackupExecutionOutcomes,
} from './retention-store';

const DEFAULT_MAX_CANDIDATES = 25;
const RETRY_DELAY_MS = 60 * 60 * 1000;
export const BACKUP_RETENTION_PASS_BUDGET_MS = 4 * 60 * 60 * 1_000;
export const BACKUP_RETENTION_JOB_GRACE_MS = 5 * 60 * 1_000;

type RetentionBroker = Pick<BackupBrokerWorkerAdapter,
  'inspectRetentionTruth' | 'claimRunDeletion' | 'executeRunDeletion' | 'reconcileRunDeletion'>;

interface RuntimeCandidate {
  backup_run_id: string;
  attempt_id: string;
  capture_id: string;
  capture_generation: string;
  manifest_sha256: string;
  lifecycle_state: 'AVAILABLE' | 'DELETE_REQUESTED' | 'DELETING' | 'PARTIALLY_DELETED' | 'DELETED' | 'UNCERTAIN' | 'QUARANTINED';
  state_version: number;
}

interface RuntimeOperation extends RuntimeCandidate {
  operation_id: string;
  operation_status: 'PREPARED' | 'RUNNING' | 'RETRY_WAIT' | 'PARTIAL' | 'UNCERTAIN';
  owner_token: string;
  fence_token: string;
}

export interface BackupRetentionPassSummary {
  checked: number;
  eligible: number;
  protected: Record<string, number>;
  claimed: number;
  deleted: number;
  partial: number;
  uncertain: number;
  failed: number;
  bytesDeleted: string;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  budgetExhausted: boolean;
  skipped: boolean;
  projection: { projectedVerified: number; projectedTerminal: number; exactReplays: number };
}

function poolOrThrow(pool?: Pool): Pool {
  const selected = pool ?? getDatabasePool();
  if (!selected) throw new Error('Database pool is not initialized.');
  return selected;
}

async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function lifecycleIdentity(candidate: RuntimeCandidate, operation: {
  operationId: string; ownerToken: string; fenceToken: string;
}): BrokerLifecycleIdentity {
  const generation = Number(candidate.capture_generation);
  if (!Number.isSafeInteger(generation) || generation <= 0) throw new Error('Retention capture generation is invalid.');
  return {
    runId: candidate.backup_run_id,
    attemptId: candidate.attempt_id,
    captureId: candidate.capture_id,
    captureGeneration: generation,
    manifestSha256: candidate.manifest_sha256,
    operationId: operation.operationId,
    ownerToken: operation.ownerToken,
    fenceToken: operation.fenceToken,
  };
}

async function loadCandidate(pool: Pick<Pool, 'query'>, backupRunId: string): Promise<RuntimeCandidate | null> {
  const result = await pool.query<RuntimeCandidate>(
    `SELECT outcome.backup_run_id, run.attempt_id, publication.capture_id,
            capture.generation::text AS capture_generation, outcome.manifest_sha256,
            lifecycle.state AS lifecycle_state, lifecycle.state_version
       FROM backup_execution_outcomes AS outcome
       JOIN backup_artifact_lifecycles AS lifecycle ON lifecycle.backup_run_id = outcome.backup_run_id
       JOIN backup_runs AS run ON run.id = outcome.backup_run_id
       JOIN backup_publications AS publication ON publication.id = outcome.publication_id
       JOIN backup_captures AS capture ON capture.id = publication.capture_id
      WHERE outcome.backup_run_id = $1
        AND outcome.verification_provenance = 'PUBLICATION_READ_BACK'
        AND publication.status = 'VERIFIED' AND capture.status = 'SEALED'
        AND run.attempt_id = publication.backup_attempt_id
        AND capture.backup_attempt_id = run.attempt_id
        AND outcome.repository_id = publication.repository_id
        AND outcome.manifest_sha256 = publication.manifest_sha256`,
    [backupRunId]
  );
  return result.rows[0] ?? null;
}

async function loadUnresolvedOperations(
  pool: Pool,
  siteKey: string,
  repositoryId: string,
  limit: number,
  backupRunId?: string
): Promise<RuntimeOperation[]> {
  const result = await pool.query<RuntimeOperation>(
    `SELECT operation.id AS operation_id, operation.status AS operation_status,
            operation.owner_token, operation.fence_token,
            outcome.backup_run_id, run.attempt_id, publication.capture_id,
            capture.generation::text AS capture_generation, outcome.manifest_sha256,
            lifecycle.state AS lifecycle_state, lifecycle.state_version
       FROM backup_retention_operations AS operation
       JOIN backup_execution_outcomes AS outcome ON outcome.backup_run_id = operation.backup_run_id
       JOIN backup_artifact_lifecycles AS lifecycle ON lifecycle.backup_run_id = outcome.backup_run_id
       JOIN backup_runs AS run ON run.id = outcome.backup_run_id
       JOIN backup_publications AS publication ON publication.id = outcome.publication_id
       JOIN backup_captures AS capture ON capture.id = publication.capture_id
      WHERE outcome.site_key = $1 AND outcome.repository_id = $2
        AND ($4::uuid IS NULL OR outcome.backup_run_id = $4::uuid)
        AND operation.status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')
        AND (operation.retry_at IS NULL OR operation.retry_at <= clock_timestamp())
      ORDER BY operation.requested_at, operation.id LIMIT $3`,
    [siteKey, repositoryId, limit, backupRunId ?? null]
  );
  return result.rows;
}

async function prepareSqlClaim(input: {
  pool: Pool; siteKey: string; repositoryId: string; backupRunId: string;
  policy: BackupRetentionPolicy;
  operationKind: 'AUTOMATIC_RETENTION' | 'MANUAL_DELETE';
  operationId: string; ownerToken: string; fenceToken: string;
}): Promise<RuntimeOperation | null> {
  return transaction(input.pool, async (client) => {
    const lifecycle = await client.query<{ state: RuntimeCandidate['lifecycle_state']; state_version: number }>(
      `SELECT state, state_version FROM backup_artifact_lifecycles WHERE backup_run_id = $1 FOR UPDATE`,
      [input.backupRunId]
    );
    if (!lifecycle.rows[0] || lifecycle.rows[0].state !== 'AVAILABLE') return null;
    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const inventory = await listBackupRetentionInventory({ siteKey: input.siteKey, repositoryId: input.repositoryId, pool: client as unknown as Pool });
    const decision = planBackupRetention({ now: clock.rows[0].now, backups: inventory, policy: input.policy })
      .find((item) => item.backupId === input.backupRunId);
    if (!decision?.eligible) return null;
    const operation = await client.query<{ id: string }>(
      `INSERT INTO backup_retention_operations
         (id, backup_run_id, operation_kind, status, owner_token, fence_token, expected_lifecycle_version)
       VALUES ($1, $2, $3, 'PREPARED', $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING id`,
      [input.operationId, input.backupRunId, input.operationKind, input.ownerToken, input.fenceToken, lifecycle.rows[0].state_version]
    );
    if (!operation.rowCount) return null;
    const changed = await client.query(
      `UPDATE backup_artifact_lifecycles
          SET state = 'DELETE_REQUESTED', state_version = state_version + 1,
              last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state = 'AVAILABLE' AND state_version = $2 RETURNING state_version`,
      [input.backupRunId, lifecycle.rows[0].state_version]
    );
    if (!changed.rowCount) throw new Error('Retention lifecycle changed while preparing deletion intent.');
    const candidate = await loadCandidate(client as unknown as Pool, input.backupRunId);
    if (!candidate) throw new Error('Retention candidate identity disappeared while preparing deletion intent.');
    return { ...candidate, operation_id: input.operationId, operation_status: 'PREPARED', owner_token: input.ownerToken, fence_token: input.fenceToken };
  });
}

async function mirrorProgress(pool: Pool, operationId: string, response: BrokerDeletionResult): Promise<bigint> {
  let deletedBytes = 0n;
  await transaction(pool, async (client) => {
    for (const artifact of response.artifacts) {
      if (artifact.status === 'DELETED' && artifact.expected_size_bytes) deletedBytes += BigInt(artifact.expected_size_bytes);
      await client.query(
        `INSERT INTO backup_retention_artifact_progress
           (operation_id, artifact_key, artifact_kind, expected_sha256, expected_size_bytes,
            status, attempt_count, deleted_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,CASE WHEN $6 = 'DELETED' THEN clock_timestamp() ELSE NULL END,clock_timestamp())
         ON CONFLICT (operation_id, artifact_key) DO UPDATE
           SET status = EXCLUDED.status,
               attempt_count = backup_retention_artifact_progress.attempt_count + 1,
               deleted_at = CASE WHEN EXCLUDED.status = 'DELETED'
                                 THEN COALESCE(backup_retention_artifact_progress.deleted_at, clock_timestamp()) ELSE NULL END,
               error_code = NULL, error_message = NULL, updated_at = clock_timestamp()`,
        [operationId, artifact.artifact_key, artifact.artifact_kind, artifact.expected_sha256 ?? null,
          artifact.expected_size_bytes ?? null, artifact.status]
      );
    }
  });
  return deletedBytes;
}

async function settleDeleted(pool: Pool, operation: RuntimeOperation, response: BrokerDeletionResult, siteKey: string, repositoryId: string): Promise<void> {
  await transaction(pool, async (client) => {
    const completed = await client.query(
      `UPDATE backup_retention_operations
          SET status = 'SUCCEEDED', completed_at = clock_timestamp(), retry_at = NULL,
              error_code = NULL, error_message = NULL, updated_at = clock_timestamp()
        WHERE id = $1 AND fence_token = $2
          AND status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN') RETURNING id`,
      [operation.operation_id, operation.fence_token]
    );
    if (!completed.rowCount) throw new Error('Retention operation fence was lost before deletion completion.');
    const lifecycle = await client.query(
      `UPDATE backup_artifact_lifecycles
          SET state = 'DELETED', state_version = state_version + 1,
              last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state IN ('DELETE_REQUESTED','DELETING','PARTIALLY_DELETED','UNCERTAIN') RETURNING backup_run_id`,
      [operation.backup_run_id]
    );
    if (!lifecycle.rowCount) throw new Error('Retention lifecycle cannot mirror broker DELETED truth.');
    await client.query(
      `INSERT INTO backup_retention_tombstones
         (backup_run_id, operation_id, site_key, repository_id, manifest_sha256,
          disposition, artifact_summary, reason_code)
       VALUES ($1,$2,$3,$4,$5,'DELETED',$6::jsonb,'BACKUP_RETENTION_POLICY_EXPIRED')
       ON CONFLICT (backup_run_id) DO UPDATE
         SET disposition = 'DELETED', artifact_summary = EXCLUDED.artifact_summary,
             reason_code = EXCLUDED.reason_code, updated_at = clock_timestamp()
       WHERE backup_retention_tombstones.operation_id = EXCLUDED.operation_id`,
      [operation.backup_run_id, operation.operation_id, siteKey, repositoryId, operation.manifest_sha256,
        JSON.stringify({ deleted_entries: response.deleted_entries, total_entries: response.total_entries })]
    );
  });
}

async function mirrorAuthoritativeDeletedTruth(input: {
  pool: Pool; candidate: RuntimeCandidate; operationId: string; siteKey: string; repositoryId: string;
}): Promise<boolean> {
  return transaction(input.pool, async (client) => {
    const lifecycle = await client.query<{ state: string; state_version: number }>(
      `SELECT state, state_version FROM backup_artifact_lifecycles WHERE backup_run_id = $1 FOR UPDATE`,
      [input.candidate.backup_run_id]
    );
    if (!lifecycle.rows[0] || lifecycle.rows[0].state === 'DELETED') return Boolean(lifecycle.rows[0]);
    const operation = await client.query(
      `INSERT INTO backup_retention_operations
         (id, backup_run_id, operation_kind, status, owner_token, fence_token,
          expected_lifecycle_version, started_at, completed_at)
       VALUES ($1,$2,'AUTOMATIC_RETENTION','SUCCEEDED',$3,$4,$5,clock_timestamp(),clock_timestamp())
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [input.operationId, input.candidate.backup_run_id, randomUUID(), randomUUID(), lifecycle.rows[0].state_version]
    );
    if (!operation.rowCount) {
      const exact = await client.query(`SELECT 1 FROM backup_retention_operations WHERE id = $1 AND backup_run_id = $2 AND status = 'SUCCEEDED'`,
        [input.operationId, input.candidate.backup_run_id]);
      if (!exact.rowCount) throw new Error('Repository tombstone operation identity conflicts with SQL history.');
    }
    await client.query(
      `UPDATE backup_artifact_lifecycles SET state = 'DELETED', state_version = state_version + 1,
          last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state <> 'DELETED'`, [input.candidate.backup_run_id]);
    await client.query(
      `INSERT INTO backup_retention_tombstones
         (backup_run_id, operation_id, site_key, repository_id, manifest_sha256,
          disposition, artifact_summary, reason_code)
       VALUES ($1,$2,$3,$4,$5,'DELETED','{"source":"BROKER_REPOSITORY_TOMBSTONE"}'::jsonb,'BROKER_REPOSITORY_TOMBSTONE')
       ON CONFLICT (backup_run_id) DO NOTHING`,
      [input.candidate.backup_run_id, input.operationId, input.siteKey, input.repositoryId, input.candidate.manifest_sha256]
    );
    return true;
  });
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code.slice(0, 100) : 'BACKUP_RETENTION_BROKER_UNCERTAIN';
}

async function settleUncertain(pool: Pool, operation: RuntimeOperation, error: unknown): Promise<void> {
  const code = errorCode(error);
  const message = error instanceof Error ? error.message.slice(0, 1_000) : 'Broker retention outcome is uncertain.';
  await transaction(pool, async (client) => {
    const progress = await client.query<{ deleted: string }>(
      `SELECT count(*) FILTER (WHERE status = 'DELETED')::text AS deleted
         FROM backup_retention_artifact_progress WHERE operation_id = $1`, [operation.operation_id]);
    const partial = Number(progress.rows[0]?.deleted ?? 0) > 0;
    await client.query(
      `UPDATE backup_retention_operations
          SET status = $3, retry_at = clock_timestamp() + ($4 * interval '1 millisecond'),
              error_code = $5, error_message = $6, updated_at = clock_timestamp()
        WHERE id = $1 AND fence_token = $2
          AND status IN ('PREPARED','RUNNING','RETRY_WAIT','PARTIAL','UNCERTAIN')`,
      [operation.operation_id, operation.fence_token, partial ? 'PARTIAL' : 'UNCERTAIN', RETRY_DELAY_MS, code, message]
    );
    await client.query(
      `UPDATE backup_artifact_lifecycles
          SET state = $2, state_version = state_version + 1,
              last_error_code = $3, last_error_message = $4, updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state <> 'DELETED'`,
      [operation.backup_run_id, partial ? 'PARTIALLY_DELETED' : 'UNCERTAIN', code, message]
    );
  });
}

async function stillEligibleImmediatelyBeforeClaim(input: {
  pool: Pool; siteKey: string; repositoryId: string; backupRunId: string;
  policy: BackupRetentionPolicy;
}): Promise<boolean> {
  const clock = await input.pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const inventory = await listBackupRetentionInventory({ siteKey: input.siteKey, repositoryId: input.repositoryId, pool: input.pool });
  const normalized = inventory.map((backup) => backup.id === input.backupRunId
    ? { ...backup, lifecycleState: 'AVAILABLE' as const, hasActiveRetentionOperation: false }
    : backup);
  return planBackupRetention({ now: clock.rows[0].now, backups: normalized, policy: input.policy })
    .find((decision) => decision.backupId === input.backupRunId)?.eligible === true;
}

async function abandonUnclaimedOperation(pool: Pool, operation: RuntimeOperation, code: string, message: string): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query(
      `UPDATE backup_retention_operations SET status = 'FAILED', retry_at = NULL,
          error_code = $3, error_message = $4, updated_at = clock_timestamp()
        WHERE id = $1 AND fence_token = $2 AND status IN ('PREPARED','RETRY_WAIT','UNCERTAIN')`,
      [operation.operation_id, operation.fence_token, code, message]
    );
    await client.query(
      `UPDATE backup_artifact_lifecycles SET state = 'AVAILABLE', state_version = state_version + 1,
          last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state IN ('DELETE_REQUESTED','UNCERTAIN')`,
      [operation.backup_run_id]
    );
  });
}

async function executeOperation(input: {
  pool: Pool; broker: RetentionBroker; operation: RuntimeOperation; siteKey: string; repositoryId: string;
  policy: BackupRetentionPolicy;
  signal?: AbortSignal;
}): Promise<{ disposition: 'DELETED' | 'PARTIAL' | 'UNCERTAIN' | 'FAILED'; bytes: bigint }> {
  const identity = lifecycleIdentity(input.operation, { operationId: input.operation.operation_id,
    ownerToken: input.operation.owner_token, fenceToken: input.operation.fence_token });
  try {
    const truth = await input.broker.inspectRetentionTruth(identity, input.signal);
    if (truth.active_holds > 0 || truth.uncertain_holds > 0) {
      if (truth.status === 'AVAILABLE' && input.operation.operation_status === 'PREPARED') {
        await transaction(input.pool, async (client) => {
          await client.query(`UPDATE backup_retention_operations SET status = 'FAILED', error_code = 'BACKUP_RETENTION_RESTORE_HOLD',
            error_message = 'Repository restore hold appeared before deletion claim.', updated_at = clock_timestamp()
            WHERE id = $1 AND fence_token = $2 AND status = 'PREPARED'`, [input.operation.operation_id, input.operation.fence_token]);
          await client.query(`UPDATE backup_artifact_lifecycles SET state = 'AVAILABLE', state_version = state_version + 1,
            last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
            WHERE backup_run_id = $1 AND state = 'DELETE_REQUESTED'`, [input.operation.backup_run_id]);
        });
        return { disposition: 'FAILED', bytes: 0n };
      }
      throw Object.assign(new Error('Repository restore hold protects the deletion candidate.'), { code: 'BACKUP_RETENTION_RESTORE_HOLD' });
    }
    if (truth.status === 'DELETED') {
      const result = await input.broker.reconcileRunDeletion(identity, input.signal);
      const bytes = await mirrorProgress(input.pool, input.operation.operation_id, result);
      await settleDeleted(input.pool, input.operation, result, input.siteKey, input.repositoryId);
      return { disposition: 'DELETED', bytes };
    }
    let result: BrokerDeletionResult;
    if (truth.status === 'AVAILABLE') {
      if (!await stillEligibleImmediatelyBeforeClaim({ pool: input.pool, siteKey: input.siteKey,
        repositoryId: input.repositoryId, backupRunId: input.operation.backup_run_id, policy: input.policy })) {
        await abandonUnclaimedOperation(input.pool, input.operation, 'BACKUP_RETENTION_POLICY_CHANGED',
          'Retention policy changed before repository deletion claim.');
        return { disposition: 'FAILED', bytes: 0n };
      }
      result = await input.broker.claimRunDeletion(identity, input.signal);
      await mirrorProgress(input.pool, input.operation.operation_id, result);
    } else {
      if (truth.deletion_operation_id !== input.operation.operation_id) {
        throw Object.assign(new Error('Repository deletion belongs to another durable operation.'), { code: 'BROKER_LIFECYCLE_FENCE_CONFLICT' });
      }
      result = await input.broker.reconcileRunDeletion(identity, input.signal);
    }
    await input.pool.query(
      `UPDATE backup_retention_operations SET status = 'RUNNING', started_at = COALESCE(started_at, clock_timestamp()),
          retry_at = NULL, updated_at = clock_timestamp() WHERE id = $1 AND fence_token = $2
          AND status IN ('PREPARED','RETRY_WAIT','PARTIAL','UNCERTAIN')`,
      [input.operation.operation_id, input.operation.fence_token]
    );
    await input.pool.query(
      `UPDATE backup_artifact_lifecycles SET state = 'DELETING', state_version = state_version + 1,
          last_error_code = NULL, last_error_message = NULL, updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state IN ('DELETE_REQUESTED','PARTIALLY_DELETED','UNCERTAIN')`,
      [input.operation.backup_run_id]
    );
    if (result.status !== 'DELETED') result = await input.broker.executeRunDeletion(identity, input.signal);
    const bytes = await mirrorProgress(input.pool, input.operation.operation_id, result);
    if (result.status !== 'DELETED') throw Object.assign(new Error('Broker deletion did not reach terminal DELETED truth.'), { code: 'BROKER_DELETE_INCOMPLETE' });
    await settleDeleted(input.pool, input.operation, result, input.siteKey, input.repositoryId);
    return { disposition: 'DELETED', bytes };
  } catch (error) {
    if (errorCode(error) === 'BROKER_DELETE_BLOCKED_BY_HOLD') {
      await abandonUnclaimedOperation(input.pool, input.operation, 'BACKUP_RETENTION_RESTORE_HOLD',
        'Repository restore hold appeared before deletion claim.');
      return { disposition: 'FAILED', bytes: 0n };
    }
    try {
      const reconciled = await input.broker.reconcileRunDeletion(identity, input.signal);
      const bytes = await mirrorProgress(input.pool, input.operation.operation_id, reconciled);
      if (reconciled.status === 'DELETED') {
        await settleDeleted(input.pool, input.operation, reconciled, input.siteKey, input.repositoryId);
        return { disposition: 'DELETED', bytes };
      }
    } catch {
      // The original error remains the stable failure evidence.
    }
    await settleUncertain(input.pool, input.operation, error);
    const partial = await input.pool.query(`SELECT 1 FROM backup_retention_artifact_progress WHERE operation_id = $1 AND status = 'DELETED' LIMIT 1`, [input.operation.operation_id]);
    return { disposition: partial.rowCount ? 'PARTIAL' : 'UNCERTAIN', bytes: 0n };
  }
}

function countProtections(summary: BackupRetentionPassSummary, decisions: readonly RetentionDecision[]): void {
  for (const decision of decisions) {
    if (decision.eligible) summary.eligible += 1;
    for (const code of decision.protectionCodes) summary.protected[code] = (summary.protected[code] ?? 0) + 1;
  }
}

/** Shared automatic/manual foundation. Caller eligibility is never accepted. */
export async function runBackupRetentionPass(input: {
  siteKey: string;
  repositoryId: string;
  broker: RetentionBroker;
  policy: BackupRetentionPolicy;
  mode?: Readonly<{ kind: 'AUTOMATIC_RETENTION' }> | Readonly<{ kind: 'MANUAL_DELETE'; backupRunId: string }>;
  maxCandidates?: number;
  budgetMs?: number;
  now?: () => number;
  signal?: AbortSignal;
  pool?: Pool;
  acquireLock?: (key: string) => Promise<BackupExecutionLock | null>;
}): Promise<BackupRetentionPassSummary> {
  const pool = poolOrThrow(input.pool);
  const maximum = Math.max(1, Math.min(input.maxCandidates ?? DEFAULT_MAX_CANDIDATES, 100));
  const budgetMs = input.budgetMs ?? BACKUP_RETENTION_PASS_BUDGET_MS;
  if (!Number.isSafeInteger(budgetMs) || budgetMs <= 0 || budgetMs > BACKUP_RETENTION_PASS_BUDGET_MS) {
    throw new Error('Backup retention pass budget is outside the supported bound.');
  }
  const monotonicNow = input.now ?? Date.now;
  const absoluteDeadline = monotonicNow() + budgetMs;
  const budgetSignal = AbortSignal.timeout(budgetMs);
  const passSignal = input.signal ? AbortSignal.any([input.signal, budgetSignal]) : budgetSignal;
  const budgetExpired = () => passSignal.aborted || monotonicNow() >= absoluteDeadline;
  const emptyProjection = { projectedVerified: 0, projectedTerminal: 0, exactReplays: 0 };
  const summary: BackupRetentionPassSummary = { checked: 0, eligible: 0, protected: {}, claimed: 0, deleted: 0,
    partial: 0, uncertain: 0, failed: 0, bytesDeleted: '0', lastCheckAt: null, lastSuccessAt: null,
    lastFailureAt: null, budgetExhausted: false, skipped: false, projection: emptyProjection };
  const lock = await (input.acquireLock ?? acquireBackupExecutionLock)(`site:${input.siteKey}`);
  if (!lock) return { ...summary, skipped: true };
  let bytesDeleted = 0n;
  try {
    summary.projection = await projectTerminalBackupExecutionOutcomes({ siteKey: input.siteKey, repositoryId: input.repositoryId, pool });
    const unresolved = await loadUnresolvedOperations(
      pool,
      input.siteKey,
      input.repositoryId,
      maximum,
      input.mode?.kind === 'MANUAL_DELETE' ? input.mode.backupRunId : undefined
    );
    for (const operation of unresolved) {
      if (budgetExpired()) break;
      const result = await executeOperation({ pool, broker: input.broker, operation, siteKey: input.siteKey,
        repositoryId: input.repositoryId, policy: input.policy, signal: passSignal });
      if (result.disposition === 'DELETED') summary.deleted += 1;
      else if (result.disposition === 'PARTIAL') summary.partial += 1;
      else if (result.disposition === 'UNCERTAIN') summary.uncertain += 1;
      else summary.failed += 1;
      bytesDeleted += result.bytes;
    }
    if (budgetExpired()) {
      summary.budgetExhausted = true;
      summary.bytesDeleted = bytesDeleted.toString();
      const completed = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
      summary.lastCheckAt = completed.rows[0].now.toISOString();
      summary.lastFailureAt = summary.lastCheckAt;
      return summary;
    }
    const clock = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const inventory = await listBackupRetentionInventory({ siteKey: input.siteKey, repositoryId: input.repositoryId, pool });
    const decisions = planBackupRetention({ now: clock.rows[0].now, backups: inventory, policy: input.policy });
    summary.checked = decisions.length;
    countProtections(summary, decisions);
    // Manual delivery is a resume signal for the durable operation admitted by
    // the API. It never scans or creates work for another run.
    const selected = input.mode?.kind === 'MANUAL_DELETE'
      ? []
      : decisions.filter((candidate) => candidate.eligible);
    for (const decision of selected.slice(0, Math.max(0, maximum - unresolved.length))) {
      if (budgetExpired()) { summary.budgetExhausted = true; break; }
      const candidate = await loadCandidate(pool, decision.backupId);
      if (!candidate) { summary.uncertain += 1; continue; }
      const tokens = { operationId: randomUUID(), ownerToken: randomUUID(), fenceToken: randomUUID() };
      const identity = lifecycleIdentity(candidate, tokens);
      try {
        const truth = await input.broker.inspectRetentionTruth(identity, passSignal);
        if (truth.status === 'DELETED' && truth.deletion_operation_id) {
          if (await mirrorAuthoritativeDeletedTruth({ pool, candidate, operationId: truth.deletion_operation_id,
            siteKey: input.siteKey, repositoryId: input.repositoryId })) summary.deleted += 1;
          continue;
        }
        if (truth.status !== 'AVAILABLE' || truth.active_holds > 0 || truth.uncertain_holds > 0) {
          summary.protected[truth.active_holds > 0 ? 'BACKUP_RETENTION_RESTORE_HOLD'
            : truth.uncertain_holds > 0 ? 'BACKUP_RETENTION_RESTORE_HOLD_UNCERTAIN'
            : 'BACKUP_RETENTION_REPOSITORY_STATE'] = (summary.protected[truth.active_holds > 0 ? 'BACKUP_RETENTION_RESTORE_HOLD'
              : truth.uncertain_holds > 0 ? 'BACKUP_RETENTION_RESTORE_HOLD_UNCERTAIN' : 'BACKUP_RETENTION_REPOSITORY_STATE'] ?? 0) + 1;
          continue;
        }
      } catch {
        summary.uncertain += 1;
        continue;
      }
      const operation = await prepareSqlClaim({ pool, siteKey: input.siteKey, repositoryId: input.repositoryId,
        backupRunId: decision.backupId, policy: input.policy,
        operationKind: input.mode?.kind ?? 'AUTOMATIC_RETENTION', ...tokens });
      if (!operation) continue;
      summary.claimed += 1;
      const result = await executeOperation({ pool, broker: input.broker, operation, siteKey: input.siteKey,
        repositoryId: input.repositoryId, policy: input.policy, signal: passSignal });
      if (result.disposition === 'DELETED') summary.deleted += 1;
      else if (result.disposition === 'PARTIAL') summary.partial += 1;
      else if (result.disposition === 'UNCERTAIN') summary.uncertain += 1;
      else summary.failed += 1;
      bytesDeleted += result.bytes;
    }
    summary.bytesDeleted = bytesDeleted.toString();
    summary.budgetExhausted ||= budgetExpired();
    const completed = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    summary.lastCheckAt = completed.rows[0].now.toISOString();
    if (summary.partial > 0 || summary.uncertain > 0 || summary.failed > 0 || summary.budgetExhausted) summary.lastFailureAt = summary.lastCheckAt;
    else summary.lastSuccessAt = summary.lastCheckAt;
    return summary;
  } finally {
    await lock.release();
  }
}
