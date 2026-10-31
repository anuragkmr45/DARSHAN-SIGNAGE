import { randomUUID } from 'node:crypto';
import type PgBoss from 'pg-boss';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { backupRuns } from '../db/schema';
import type { BackupRepositoryKind } from './policy';

export const BACKUP_EXECUTION_DEADLINE_MS = 4 * 60 * 60 * 1000;
export const BACKUP_JOB_EXPIRATION_SECONDS = Math.ceil(BACKUP_EXECUTION_DEADLINE_MS / 1000) + 5 * 60;
export type BackupRequestTransaction = Pick<PoolClient, 'query'>;
export type BackupRequestInput = { triggerType: 'MANUAL' | 'AUTOMATIC'; triggeredBy?: string | null; repositoryKind: BackupRepositoryKind; coordinationKey: string; scheduleIdentity?: string | null };
export type TransactionalBackupRun = typeof backupRuns.$inferSelect;
function row<T extends QueryResultRow>(result: QueryResult<T>): T | null { return result.rows[0] ?? null; }
/** pg-boss uses only this checked-out transaction; never a second pool/connection. */
export async function enqueueTransactionalBackup(jobs: Pick<PgBoss, 'send'>, client: BackupRequestTransaction, runId: string, queueJobId: string, startAfter?: Date) {
  const inserted = await jobs.send('backup', { runId, queueJobId }, { id: queueJobId, db: { executeSql: async (text, values = []) => { const result = await client.query(text, values); return { rows: result.rows }; } }, retryLimit: 0, expireInSeconds: BACKUP_JOB_EXPIRATION_SECONDS, retentionDays: 30, ...(startAfter ? { startAfter } : {}) });
  if (inserted !== queueJobId) throw new Error('pg-boss did not atomically enqueue the backup job.');
}
/** Internal request body. The caller owns BEGIN/COMMIT/ROLLBACK/release. No app/global pool or job startup. */
export async function requestBackupRunInTransaction(jobs: Pick<PgBoss, 'send'>, input: BackupRequestInput, client: BackupRequestTransaction): Promise<{ run: TransactionalBackupRun; coalesced: boolean }> {
  const active = row<TransactionalBackupRun>(await client.query(
    `SELECT * FROM backup_runs
     WHERE coordination_key = $1 AND status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [input.coordinationKey]
  ));
  if (active) {
    return { run: active, coalesced: true };
  }

  if (input.triggerType === 'AUTOMATIC' && input.scheduleIdentity) {
    const scheduled = row<TransactionalBackupRun>(await client.query(
      `SELECT * FROM backup_runs
       WHERE coordination_key = $1 AND trigger_type = 'AUTOMATIC' AND schedule_identity = $2
       ORDER BY created_at DESC LIMIT 1`,
      [input.coordinationKey, input.scheduleIdentity]
    ));
    if (scheduled) {
      return { run: scheduled, coalesced: true };
    }
  }

  const runId = randomUUID();
  const queueJobId = randomUUID();
  const inserted = row<TransactionalBackupRun>(await client.query(
    `INSERT INTO backup_runs
      (id, trigger_type, status, triggered_by, repository_kind, coordination_key,
       schedule_identity, stage, queue_job_id)
     VALUES ($1, $2, 'PENDING', $3, $4, $5, $6, 'QUEUED', $7)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [runId, input.triggerType, input.triggeredBy ?? null, input.repositoryKind,
      input.coordinationKey, input.scheduleIdentity ?? null, queueJobId]
  ));

  if (!inserted) {
    const winner = row<TransactionalBackupRun>(await client.query(
      `SELECT * FROM backup_runs
       WHERE coordination_key = $1
         AND (status IN ('PENDING', 'RUNNING', 'RETRY_WAIT')
           OR ($2::text IS NOT NULL AND trigger_type = 'AUTOMATIC' AND schedule_identity = $2))
       ORDER BY created_at DESC LIMIT 1`,
      [input.coordinationKey, input.scheduleIdentity ?? null]
    ));
    if (!winner) throw new Error('Backup request lost its coordination race without an existing run.');
    return { run: winner, coalesced: true };
  }

  await enqueueTransactionalBackup(jobs, client, runId, queueJobId);
  return { run: inserted, coalesced: false };
}
