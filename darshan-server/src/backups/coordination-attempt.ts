import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { backupRuns } from '../db/schema';
import { BACKUP_EXECUTION_DEADLINE_MS } from './coordination-transaction';
export const BACKUP_ATTEMPT_LEASE_MS = 2 * 60 * 1000;
export type BackupAttemptPool = Pick<Pool, 'query' | 'connect'>;
type BackupRun = typeof backupRuns.$inferSelect;
const BACKUP_LEASE_MS = BACKUP_ATTEMPT_LEASE_MS;

export async function claimBackupAttemptWithPool(input: {
  runId: string;
  queueJobId: string;
  now?: Date;
}, dependencies: { pool: BackupAttemptPool }): Promise<BackupRun | null> {
  const now = input.now ?? new Date();
  const attemptId = randomUUID();
  const pool = dependencies.pool;
  if (!pool) throw new Error('Database pool is not initialized.');
  const result = await pool.query<BackupRun>(
    // queue_job_id fences delayed/stale deliveries; the lease fences a still-running callback.
    `UPDATE backup_runs
     SET status = 'RUNNING', stage = 'PREPARING', attempt_id = $3,
         attempt_number = attempt_number + 1, started_at = COALESCE(started_at, now()),
         heartbeat_at = $4, lease_expires_at = $5, deadline_at = $6,
         retry_at = NULL, error_message = NULL, error_code = NULL, updated_at = now()
     WHERE id = $1 AND queue_job_id = $2
       AND status IN ('PENDING', 'RETRY_WAIT')
       AND (retry_at IS NULL OR retry_at <= $4)
       AND (lease_expires_at IS NULL OR lease_expires_at <= $4)
     RETURNING *`,
    [input.runId, input.queueJobId, attemptId, now,
      new Date(now.getTime() + BACKUP_LEASE_MS), new Date(now.getTime() + BACKUP_EXECUTION_DEADLINE_MS)]
  );
  return result.rows[0] ?? null;
}

export async function heartbeatBackupAttemptWithPool(runId: string, attemptId: string, now = new Date(), dependencies: { pool: BackupAttemptPool }): Promise<boolean> {
  const pool = dependencies.pool;
  if (!pool) throw new Error('Database pool is not initialized.');
  const result = await pool.query(
    `UPDATE backup_runs
     SET heartbeat_at = $3, lease_expires_at = LEAST(deadline_at, $4), updated_at = now()
     WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING'
       AND cancellation_requested_at IS NULL AND lease_expires_at > $3
       AND deadline_at > $3 RETURNING id`,
    [runId, attemptId, now, new Date(now.getTime() + BACKUP_LEASE_MS)]
  );
  return Boolean(result.rowCount);
}

export async function transitionBackupStageWithPool(runId: string, attemptId: string, stage: string, now = new Date(), dependencies: { pool: BackupAttemptPool }): Promise<boolean> {
  const pool = dependencies.pool;
  if (!pool) throw new Error('Database pool is not initialized.');
  const result = await pool.query(
    `UPDATE backup_runs SET stage = $3, updated_at = now()
     WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING'
       AND cancellation_requested_at IS NULL AND lease_expires_at > $4
       AND deadline_at > $4 RETURNING id`,
    [runId, attemptId, stage, now]
  );
  return Boolean(result.rowCount);
}
