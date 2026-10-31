import { randomUUID } from 'node:crypto';
import { BACKUP_ATTEMPT_LEASE_MS, claimBackupAttemptWithPool, heartbeatBackupAttemptWithPool, transitionBackupStageWithPool } from './coordination-attempt';
import { BACKUP_EXECUTION_DEADLINE_MS, enqueueTransactionalBackup, requestBackupRunInTransaction, type BackupRequestInput, type BackupRequestTransaction } from './coordination-transaction';
export { BACKUP_EXECUTION_DEADLINE_MS, BACKUP_JOB_EXPIRATION_SECONDS } from './coordination-transaction';
import type PgBoss from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import { getDatabase, getDatabasePool, schema } from '@/db';
import { and, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { BackupPrerequisiteError } from './local-repository';
import { RepositorySafetyError } from './local-repository';
import { BackupError } from './errors';
import { ConfigurationCapsuleError } from './configuration-capsule';
import { BackupPublicationAuthorityError } from './publication-store';

export const BACKUP_LEASE_MS = BACKUP_ATTEMPT_LEASE_MS;
export const BACKUP_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000] as const;

export type BackupTriggerType = 'MANUAL' | 'AUTOMATIC';
export type BackupRun = typeof schema.backupRuns.$inferSelect;

export interface BackupQueuePayload {
  runId: string;
  queueJobId: string;
}

type BackupPool = Pick<Pool, 'connect' | 'query'>;


export interface BackupExecutionLock {
  release(): Promise<void>;
}

export async function acquireBackupExecutionLock(lockKey: string, dependencies: { pool?: BackupPool } = {}): Promise<BackupExecutionLock | null> {
  const pool = dependencies.pool ?? getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked',
      [lockKey]
    );
    if (!result.rows[0]?.locked) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } finally {
        client.release();
      }
    },
  };
}

async function enqueueBackup(jobs: PgBoss, client: PoolClient, runId: string, queueJobId: string, startAfter?: Date) { return enqueueTransactionalBackup(jobs, client, runId, queueJobId, startAfter); }

export async function deferBackupDelivery(
  jobs: PgBoss,
  payload: BackupQueuePayload,
  now = new Date(),
  delayMs = 60_000
): Promise<boolean> {
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const newJobId = randomUUID();
    const startAfter = new Date(now.getTime() + delayMs);
    const updated = await client.query(
      `UPDATE backup_runs SET queue_job_id = $3, retry_at = $4, updated_at = $2
       WHERE id = $1 AND queue_job_id = $5 AND status IN ('PENDING', 'RETRY_WAIT')
       RETURNING id`,
      [payload.runId, now, newJobId, startAfter, payload.queueJobId]
    );
    if (!updated.rowCount) {
      await client.query('COMMIT');
      return false;
    }
    await enqueueBackup(jobs, client, payload.runId, newJobId, startAfter);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function requestBackupRun(jobs: PgBoss, input: BackupRequestInput, dependencies: { pool?: BackupPool; transaction?: BackupRequestTransaction } = {}): Promise<{ run: BackupRun; coalesced: boolean }> {
  if (dependencies.transaction) {
    if (dependencies.pool) throw new Error('A backup request accepts either a caller-owned transaction or a pool.');
    return requestBackupRunInTransaction(jobs, input, dependencies.transaction);
  }
  const pool = dependencies.pool ?? getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await requestBackupRunInTransaction(jobs, input, client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function claimBackupAttempt(input: { runId: string; queueJobId: string; now?: Date }, dependencies: { pool?: BackupPool } = {}): Promise<BackupRun | null> {
  const pool = dependencies.pool ?? getDatabasePool(); if (!pool) throw new Error('Database pool is not initialized.'); return claimBackupAttemptWithPool(input, { pool });
}
export async function heartbeatBackupAttempt(runId: string, attemptId: string, now = new Date(), dependencies: { pool?: BackupPool } = {}): Promise<boolean> {
  const pool = dependencies.pool ?? getDatabasePool(); if (!pool) throw new Error('Database pool is not initialized.'); return heartbeatBackupAttemptWithPool(runId, attemptId, now, { pool });
}
export async function transitionBackupStage(runId: string, attemptId: string, stage: string, now = new Date(), dependencies: { pool?: BackupPool } = {}): Promise<boolean> {
  const pool = dependencies.pool ?? getDatabasePool(); if (!pool) throw new Error('Database pool is not initialized.'); return transitionBackupStageWithPool(runId, attemptId, stage, now, { pool });
}

export function backupRetryDelayMs(attemptNumber: number): number {
  return BACKUP_RETRY_DELAYS_MS[Math.min(Math.max(attemptNumber - 1, 0), BACKUP_RETRY_DELAYS_MS.length - 1)];
}

export function classifyBackupFailure(error: unknown): { transient: boolean; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error || 'Backup failed');
  if (error instanceof BackupError) {
    return { transient: error.retryable, code: error.code, message };
  }
  if (error instanceof BackupPrerequisiteError) {
    return { transient: false, code: error.code, message };
  }
  if (error instanceof ConfigurationCapsuleError) {
    return { transient: false, code: error.code, message };
  }
  if (error instanceof RepositorySafetyError) {
    return { transient: false, code: error.code, message };
  }
  if (error instanceof BackupPublicationAuthorityError) {
    return { transient: false, code: error.code, message };
  }
  const lower = message.toLowerCase();
  if (/insufficient free space|not configured|is required|not installed|not available|permission denied|eacces|missing mount/.test(lower)) {
    return { transient: false, code: 'BACKUP_PREREQUISITE_FAILED', message };
  }
  return { transient: true, code: 'BACKUP_TRANSIENT_FAILURE', message };
}

export async function settleFailedBackupAttempt(jobs: PgBoss, input: {
  runId: string;
  attemptId: string;
  attemptNumber: number;
  error: unknown;
  now?: Date;
}, dependencies: { pool?: BackupPool } = {}): Promise<'RETRY_WAIT' | 'FAILED' | 'CANCELLED' | 'STALE'> {
  const failure = classifyBackupFailure(input.error);
  const now = input.now ?? new Date();
  const pool = dependencies.pool ?? getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cancelled = await client.query(
      `UPDATE backup_runs SET status = 'CANCELLED', stage = 'CANCELLED', completed_at = $3,
         lease_expires_at = NULL, heartbeat_at = $4, error_code = 'BACKUP_CANCELLED',
         error_message = 'Backup cancellation was requested', updated_at = $3
       WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING'
         AND cancellation_requested_at IS NOT NULL RETURNING id`,
      [input.runId, input.attemptId, now, now]
    );
    if (cancelled.rowCount) {
      await client.query('COMMIT');
      return 'CANCELLED';
    }
    if (!failure.transient) {
      const failed = await client.query(
        `UPDATE backup_runs SET status = 'FAILED', stage = 'FAILED', completed_at = $3,
           lease_expires_at = NULL, heartbeat_at = $4, error_code = $5,
           error_message = $6, updated_at = $3
         WHERE id = $1 AND attempt_id = $2 AND status = 'RUNNING'
         RETURNING id`,
        [input.runId, input.attemptId, now, now, failure.code, failure.message.slice(0, 1000)]
      );
      await client.query('COMMIT');
      return failed.rowCount ? 'FAILED' : 'STALE';
    }

    const retryAt = new Date(now.getTime() + backupRetryDelayMs(input.attemptNumber));
    const queueJobId = randomUUID();
    const retrying = await client.query(
      `UPDATE backup_runs SET status = 'RETRY_WAIT', stage = 'RETRY_WAIT', retry_at = $3,
         attempt_id = NULL, lease_expires_at = NULL, queue_job_id = $4,
         error_code = $5, error_message = $6, updated_at = $2
       WHERE id = $1 AND attempt_id = $7 AND status = 'RUNNING'
         AND cancellation_requested_at IS NULL
       RETURNING id`,
      [input.runId, now, retryAt, queueJobId, failure.code, failure.message.slice(0, 1000), input.attemptId]
    );
    if (!retrying.rowCount) {
      await client.query('COMMIT');
      return 'STALE';
    }
    await enqueueBackup(jobs, client, input.runId, queueJobId, retryAt);
    await client.query('COMMIT');
    return 'RETRY_WAIT';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reconcileBackupRuns(
  jobs: PgBoss,
  now = new Date(),
  dependencies: {
    inspectPublication?: (run: BackupRun) => Promise<'ADOPTED' | 'PRESERVE' | 'ABSENT'>;
  } = {},
): Promise<{ retried: number; requeued: number }> {
  const db = getDatabase();
  const stranded = await db.select().from(schema.backupRuns).where(or(
    and(eq(schema.backupRuns.status, 'RUNNING'), or(
      isNull(schema.backupRuns.attempt_id),
      isNull(schema.backupRuns.lease_expires_at),
      lte(schema.backupRuns.lease_expires_at, now)
    )),
    and(eq(schema.backupRuns.status, 'PENDING'), lte(schema.backupRuns.created_at, new Date(now.getTime() - 60_000))),
    and(eq(schema.backupRuns.status, 'RETRY_WAIT'), or(
      isNull(schema.backupRuns.retry_at),
      lte(schema.backupRuns.retry_at, now)
    ))
  ));
  let retried = 0;
  let requeued = 0;
  for (const run of stranded) {
    if (run.status === 'RUNNING' && run.attempt_id && run.lease_expires_at) {
      const pool = getDatabasePool();
      if (!pool) throw new Error('Database pool is not initialized.');
      const publication = await pool.query<{ id: string }>(
        `SELECT id FROM backup_publications
         WHERE backup_run_id = $1 AND backup_attempt_id = $2
           AND status IN ('PREPARED', 'PUBLISHED', 'UNCERTAIN')
         LIMIT 1`,
        [run.id, run.attempt_id]
      );
      if (publication.rows[0]) {
        // The filesystem rename may have committed while the worker died.
        // Never replace this attempt until repository reconciliation has
        // inspected its intent/receipt and conditional completion authority.
        const decision = dependencies.inspectPublication
          ? await dependencies.inspectPublication(run)
          : 'PRESERVE';
        if (decision !== 'ABSENT') continue;
      }
      const outcome = await settleFailedBackupAttempt(jobs, {
        runId: run.id,
        attemptId: run.attempt_id,
        attemptNumber: run.attempt_number,
        error: new Error('Backup attempt lease expired before completion'),
        now,
      });
      if (outcome === 'RETRY_WAIT') retried += 1;
      continue;
    }
    if (run.status === 'PENDING' || run.status === 'RETRY_WAIT' || run.status === 'RUNNING') {
      const queued = run.queue_job_id
        ? await jobs.getJobById<BackupQueuePayload>('backup', run.queue_job_id, { includeArchive: true })
        : null;
      if (queued && ['created', 'retry', 'active'].includes(queued.state)) continue;
      const pool = getDatabasePool();
      if (!pool) throw new Error('Database pool is not initialized.');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const newJobId = randomUUID();
        const retryAt = run.status === 'RUNNING'
          ? new Date(now.getTime() + backupRetryDelayMs(Math.max(1, run.attempt_number)))
          : run.retry_at && run.retry_at > now ? run.retry_at : now;
        const updated = await client.query(
          `UPDATE backup_runs SET status = $3, stage = $4, queue_job_id = $5,
             attempt_id = NULL, lease_expires_at = NULL, retry_at = $6,
             error_code = CASE WHEN status = 'RUNNING' THEN 'BACKUP_STRANDED_ATTEMPT' ELSE error_code END,
             error_message = CASE WHEN status = 'RUNNING' THEN 'Reconciled a legacy or lease-less running backup' ELSE error_message END,
             updated_at = $2
           WHERE id = $1 AND status = $7
             AND (queue_job_id = $8 OR (queue_job_id IS NULL AND $8::uuid IS NULL))
           RETURNING id`,
          [run.id, now, run.status === 'RUNNING' ? 'RETRY_WAIT' : run.status,
            run.status === 'RUNNING' ? 'RETRY_WAIT' : run.stage, newJobId, retryAt,
            run.status, run.queue_job_id]
        );
        if (updated.rowCount) {
          await enqueueBackup(jobs, client, run.id, newJobId, retryAt > now ? retryAt : undefined);
          if (run.status === 'RUNNING') retried += 1;
          else requeued += 1;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
  }
  return { retried, requeued };
}

export async function getLatestSuccessfulBackupRun(): Promise<BackupRun | null> {
  const [run] = await getDatabase().select().from(schema.backupRuns)
    .where(eq(schema.backupRuns.status, 'COMPLETED'))
    .orderBy(desc(schema.backupRuns.captured_at), desc(schema.backupRuns.completed_at)).limit(1);
  return run ?? null;
}
