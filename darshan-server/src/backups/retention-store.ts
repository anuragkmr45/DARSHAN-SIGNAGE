import type { Pool, PoolClient } from 'pg';
import { getDatabasePool } from '@/db';
import { BackupError } from './errors';
import {
  assertBackupArtifactLifecycleTransition,
  assertBackupRetentionOperationTransition,
  createBackupRetentionPolicy,
  planBackupRetention,
  type BackupArtifactLifecycleState,
  type BackupRetentionOperationState,
  type BackupRetentionPolicy,
  type RetentionBackup,
  type RetentionDecision,
} from './retention-policy';

interface RetentionInventoryRow {
  backup_run_id: string;
  site_key: string;
  repository_id: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  captured_at: Date | null;
  lifecycle_state: BackupArtifactLifecycleState;
  verification_provenance: 'PUBLICATION_READ_BACK' | 'LEGACY_UNVERIFIED' | 'NONE';
  publication_id: string | null;
  manifest_sha256: string | null;
  verified_good_at: Date | null;
  has_active_retention_operation: boolean;
  restore_hold: 'NONE' | 'ACTIVE' | 'UNCERTAIN';
}

export interface BackupArtifactLifecycleRecord {
  backup_run_id: string;
  state: BackupArtifactLifecycleState;
  state_version: number;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: Date;
}

export interface BackupRetentionOperationRecord {
  id: string;
  backup_run_id: string;
  status: BackupRetentionOperationState;
  owner_token: string;
  fence_token: string;
  expected_lifecycle_version: number;
  started_at: Date | null;
  completed_at: Date | null;
  retry_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  updated_at: Date;
}

export interface BackupRetentionProjectionSummary {
  projectedVerified: number;
  projectedTerminal: number;
  exactReplays: number;
}

function requirePool(pool?: Pool): Pool {
  const selected = pool ?? getDatabasePool();
  if (!selected) throw new Error('Database pool is not initialized.');
  return selected;
}

async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
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

/**
 * Crash-gap reconciliation for terminal LOCAL_FILESYSTEM executions. Verified
 * good evidence comes only from an exact VERIFIED publication and SEALED
 * capture; backup_runs.verified_at is intentionally never read.
 */
export async function projectTerminalBackupExecutionOutcomes(input: {
  siteKey: string;
  repositoryId: string;
  pool?: Pool;
}): Promise<BackupRetentionProjectionSummary> {
  return withTransaction(requirePool(input.pool), async (client) => {
    await client.query(
      `SELECT run.id
         FROM backup_runs AS run
        WHERE run.repository_kind = 'LOCAL_FILESYSTEM'
          AND run.status IN ('COMPLETED','FAILED','CANCELLED')
        ORDER BY run.created_at, run.id
        FOR UPDATE OF run`
    );
    const exactCandidates = `
      SELECT run.id AS backup_run_id, run.completed_at, capture.sealed_at AS captured_at,
             publication.id AS publication_id, publication.verified_at,
             publication.manifest_sha256
        FROM backup_runs AS run
        JOIN backup_publications AS publication
          ON publication.backup_run_id = run.id
         AND publication.backup_attempt_id = run.attempt_id
         AND publication.repository_id = $2
         AND publication.status = 'VERIFIED'
         AND publication.verified_at IS NOT NULL
         AND publication.manifest_sha256 = run.manifest_sha256
        JOIN backup_captures AS capture
          ON capture.id = publication.capture_id
         AND capture.backup_run_id = run.id
         AND capture.backup_attempt_id = run.attempt_id
         AND capture.status = 'SEALED'
         AND capture.sealed_at = run.captured_at
       WHERE run.repository_kind = 'LOCAL_FILESYSTEM'
         AND run.status = 'COMPLETED'
         AND run.completed_at IS NOT NULL
         AND run.repository_id = $2
         AND run.repository_manifest->'site'->>'id' = $1`;
    const verified = await client.query(
      `WITH exact AS (${exactCandidates})
       INSERT INTO backup_execution_outcomes
         (backup_run_id, site_key, repository_id, outcome, completed_at, captured_at,
          verification_provenance, publication_id, verified_good_at, manifest_sha256)
       SELECT exact.backup_run_id, $1, $2, 'SUCCEEDED', exact.completed_at,
              exact.captured_at, 'PUBLICATION_READ_BACK', exact.publication_id,
              exact.verified_at, exact.manifest_sha256
         FROM exact
       ON CONFLICT (backup_run_id) DO NOTHING
       RETURNING backup_run_id`,
      [input.siteKey, input.repositoryId]
    );
    const conflict = await client.query<{ backup_run_id: string }>(
      `WITH exact AS (${exactCandidates})
       SELECT exact.backup_run_id
         FROM exact
         JOIN backup_execution_outcomes AS outcome ON outcome.backup_run_id = exact.backup_run_id
        WHERE outcome.site_key <> $1
           OR outcome.repository_id IS DISTINCT FROM $2::uuid
           OR outcome.outcome <> 'SUCCEEDED'
           OR outcome.completed_at <> exact.completed_at
           OR outcome.captured_at IS DISTINCT FROM exact.captured_at
           OR outcome.verification_provenance <> 'PUBLICATION_READ_BACK'
           OR outcome.publication_id IS DISTINCT FROM exact.publication_id
           OR outcome.verified_good_at IS DISTINCT FROM exact.verified_at
           OR outcome.manifest_sha256 IS DISTINCT FROM exact.manifest_sha256
        LIMIT 1`,
      [input.siteKey, input.repositoryId]
    );
    if (conflict.rows[0]) {
      throw new BackupError('BACKUP_RETENTION_STATE_CONFLICT', 'Immutable verified outcome conflicts with exact database publication evidence.', {
        backupRunId: conflict.rows[0].backup_run_id,
      });
    }
    await client.query(
      `WITH exact AS (${exactCandidates})
       INSERT INTO backup_artifact_lifecycles (backup_run_id, state)
       SELECT exact.backup_run_id, 'AVAILABLE' FROM exact
       ON CONFLICT (backup_run_id) DO NOTHING`,
      [input.siteKey, input.repositoryId]
    );

    const terminal = await client.query(
      `WITH noneligible AS (
         SELECT run.id AS backup_run_id,
                CASE WHEN run.status = 'COMPLETED' THEN 'SUCCEEDED'
                     WHEN run.status = 'CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END AS outcome,
                COALESCE(run.completed_at, run.updated_at, run.created_at) AS completed_at,
                run.captured_at, run.repository_id, run.manifest_sha256
           FROM backup_runs AS run
          WHERE run.repository_kind = 'LOCAL_FILESYSTEM'
            AND run.status IN ('COMPLETED','FAILED','CANCELLED')
            AND NOT EXISTS (SELECT 1 FROM (${exactCandidates}) AS exact WHERE exact.backup_run_id = run.id)
       )
       INSERT INTO backup_execution_outcomes
         (backup_run_id, site_key, repository_id, outcome, completed_at, captured_at,
          verification_provenance, publication_id, verified_good_at, manifest_sha256)
       SELECT backup_run_id, $1, repository_id, outcome, completed_at, captured_at,
              CASE WHEN outcome = 'SUCCEEDED' THEN 'LEGACY_UNVERIFIED' ELSE 'NONE' END,
              NULL, NULL, CASE WHEN outcome = 'SUCCEEDED' THEN manifest_sha256 ELSE NULL END
         FROM noneligible
       ON CONFLICT (backup_run_id) DO NOTHING
       RETURNING backup_run_id`,
      [input.siteKey, input.repositoryId]
    );
    await client.query(
      `INSERT INTO backup_artifact_lifecycles (backup_run_id, state)
       SELECT outcome.backup_run_id, 'UNCERTAIN'
         FROM backup_execution_outcomes AS outcome
         JOIN backup_runs AS run ON run.id = outcome.backup_run_id
        WHERE run.repository_kind = 'LOCAL_FILESYSTEM'
          AND outcome.verification_provenance IN ('NONE','LEGACY_UNVERIFIED')
       ON CONFLICT (backup_run_id) DO NOTHING`
    );
    const exactCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (${exactCandidates}) AS exact`,
      [input.siteKey, input.repositoryId]
    );
    const projectedVerified = verified.rowCount ?? 0;
    const projectedTerminal = terminal.rowCount ?? 0;
    const exactReplays = Math.max(0, Number(exactCount.rows[0]?.count ?? 0) - projectedVerified);
    return { projectedVerified, projectedTerminal, exactReplays };
  });
}

function mapExecutionOutcome(outcome: RetentionInventoryRow['outcome']): RetentionBackup['executionOutcome'] {
  if (outcome === 'SUCCEEDED') return 'SUCCEEDED';
  if (outcome === 'CANCELLED') return 'CANCELLED';
  return 'FAILED';
}

function mapInventoryRow(row: RetentionInventoryRow): RetentionBackup {
  const verification = row.verification_provenance === 'PUBLICATION_READ_BACK' &&
      row.publication_id && row.manifest_sha256 && row.verified_good_at
    ? {
        kind: 'PUBLICATION_READ_BACK' as const,
        publicationId: row.publication_id,
        manifestSha256: row.manifest_sha256,
        verifiedAt: row.verified_good_at,
      }
    : row.verification_provenance === 'LEGACY_UNVERIFIED'
      ? { kind: 'LEGACY_UNVERIFIED' as const }
      : null;
  return {
    id: row.backup_run_id,
    siteKey: row.site_key,
    repositoryId: row.repository_id,
    capturedAt: row.captured_at,
    executionOutcome: mapExecutionOutcome(row.outcome),
    lifecycleState: row.lifecycle_state,
    verification,
    hasActiveRetentionOperation: row.has_active_retention_operation,
    restoreHold: row.restore_hold,
  };
}

/** Reads only durable projection/evidence rows; it never infers proof from backup_runs.verified_at. */
export async function listBackupRetentionInventory(input: {
  siteKey: string;
  repositoryId: string;
  pool?: Pool;
}): Promise<RetentionBackup[]> {
  const result = await requirePool(input.pool).query<RetentionInventoryRow>(
    `SELECT outcome.backup_run_id, outcome.site_key, outcome.repository_id,
            outcome.outcome, lifecycle.state AS lifecycle_state,
            outcome.captured_at,
            outcome.verification_provenance, outcome.publication_id,
            outcome.manifest_sha256, outcome.verified_good_at,
            EXISTS (
              SELECT 1 FROM backup_retention_operations AS operation
               WHERE operation.backup_run_id = outcome.backup_run_id
                 AND operation.status IN ('PREPARED', 'RUNNING', 'RETRY_WAIT', 'PARTIAL', 'UNCERTAIN')
            ) AS has_active_retention_operation,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM backup_restore_hold_projections AS hold
                 WHERE hold.backup_run_id = outcome.backup_run_id AND hold.status = 'UNCERTAIN'
              ) THEN 'UNCERTAIN'
              WHEN EXISTS (
                SELECT 1 FROM backup_restore_hold_projections AS hold
                 WHERE hold.backup_run_id = outcome.backup_run_id AND hold.status = 'ACTIVE'
              ) THEN 'ACTIVE'
              ELSE 'NONE'
            END AS restore_hold
       FROM backup_execution_outcomes AS outcome
       JOIN backup_artifact_lifecycles AS lifecycle
         ON lifecycle.backup_run_id = outcome.backup_run_id
      WHERE outcome.site_key = $1 AND outcome.repository_id = $2
      ORDER BY outcome.captured_at DESC NULLS LAST, outcome.backup_run_id ASC`,
    [input.siteKey, input.repositoryId]
  );
  return result.rows.map(mapInventoryRow);
}

export async function selectBackupRetentionCandidates(input: {
  siteKey: string;
  repositoryId: string;
  now: Date;
  policy?: BackupRetentionPolicy;
  pool?: Pool;
}): Promise<RetentionDecision[]> {
  const backups = await listBackupRetentionInventory(input);
  return planBackupRetention({
    now: input.now,
    backups,
    policy: input.policy ?? createBackupRetentionPolicy(),
  });
}

/** Compare-and-swap lifecycle transition. A repeated identical request is idempotent. */
export async function transitionBackupArtifactLifecycle(input: {
  backupRunId: string;
  expectedState: BackupArtifactLifecycleState;
  expectedVersion: number;
  nextState: BackupArtifactLifecycleState;
  errorCode?: string | null;
  errorMessage?: string | null;
  pool?: Pool;
}): Promise<BackupArtifactLifecycleRecord> {
  assertBackupArtifactLifecycleTransition(input.expectedState, input.nextState);
  const pool = requirePool(input.pool);
  if (input.expectedState === input.nextState) {
    const existing = await pool.query<BackupArtifactLifecycleRecord>(
      `SELECT backup_run_id, state, state_version, last_error_code, last_error_message, updated_at
         FROM backup_artifact_lifecycles
        WHERE backup_run_id = $1 AND state = $2 AND state_version = $3`,
      [input.backupRunId, input.expectedState, input.expectedVersion]
    );
    if (existing.rows[0]) return existing.rows[0];
  } else {
    const updated = await pool.query<BackupArtifactLifecycleRecord>(
      `UPDATE backup_artifact_lifecycles
          SET state = $4, state_version = state_version + 1,
              last_error_code = $5, last_error_message = $6,
              updated_at = clock_timestamp()
        WHERE backup_run_id = $1 AND state = $2 AND state_version = $3
        RETURNING backup_run_id, state, state_version, last_error_code, last_error_message, updated_at`,
      [input.backupRunId, input.expectedState, input.expectedVersion, input.nextState,
        input.errorCode ?? null, input.errorMessage?.slice(0, 1_000) ?? null]
    );
    if (updated.rows[0]) return updated.rows[0];
  }
  throw new BackupError(
    'BACKUP_RETENTION_STATE_CONFLICT',
    'Backup artifact lifecycle changed before the conditional transition completed.',
    { backupRunId: input.backupRunId, expectedState: input.expectedState, expectedVersion: input.expectedVersion }
  );
}

/** Fence-token checked operation transition. A stale deletion attempt cannot settle a replacement. */
export async function transitionBackupRetentionOperation(input: {
  operationId: string;
  fenceToken: string;
  expectedState: BackupRetentionOperationState;
  nextState: BackupRetentionOperationState;
  retryAt?: Date | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  pool?: Pool;
}): Promise<BackupRetentionOperationRecord> {
  assertBackupRetentionOperationTransition(input.expectedState, input.nextState);
  const pool = requirePool(input.pool);
  if (input.expectedState === input.nextState) {
    const existing = await pool.query<BackupRetentionOperationRecord>(
      `SELECT id, backup_run_id, status, owner_token, fence_token, expected_lifecycle_version,
              started_at, completed_at, retry_at, error_code, error_message, updated_at
         FROM backup_retention_operations
        WHERE id = $1 AND fence_token = $2 AND status = $3`,
      [input.operationId, input.fenceToken, input.expectedState]
    );
    if (existing.rows[0]) return existing.rows[0];
  } else {
    const updated = await pool.query<BackupRetentionOperationRecord>(
      `UPDATE backup_retention_operations
          SET status = $4,
              started_at = CASE WHEN $4 = 'RUNNING' THEN COALESCE(started_at, clock_timestamp()) ELSE started_at END,
              completed_at = CASE WHEN $4 = 'SUCCEEDED' THEN clock_timestamp() ELSE completed_at END,
              retry_at = $5, error_code = $6, error_message = $7,
              updated_at = clock_timestamp()
        WHERE id = $1 AND fence_token = $2 AND status = $3
        RETURNING id, backup_run_id, status, owner_token, fence_token, expected_lifecycle_version,
                  started_at, completed_at, retry_at, error_code, error_message, updated_at`,
      [input.operationId, input.fenceToken, input.expectedState, input.nextState,
        input.retryAt ?? null, input.errorCode ?? null, input.errorMessage?.slice(0, 1_000) ?? null]
    );
    if (updated.rows[0]) return updated.rows[0];
  }
  throw new BackupError(
    'BACKUP_RETENTION_FENCE_REJECTED',
    'Backup retention operation fence or expected state no longer matches.',
    { operationId: input.operationId, expectedState: input.expectedState }
  );
}
