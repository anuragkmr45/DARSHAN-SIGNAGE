import { describe, expect, it, vi } from 'vitest';
import type PgBoss from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import {
  backupRetryDelayMs, claimBackupAttempt, classifyBackupFailure,
  BACKUP_JOB_EXPIRATION_SECONDS, requestBackupRun, type BackupRun,
  acquireBackupExecutionLock, heartbeatBackupAttempt, transitionBackupStage, settleFailedBackupAttempt,
} from './coordination';
import { BackupPrerequisiteError } from './local-repository';
import { BackupError } from './errors';
import { calculateBackupWorkspaceRequiredBytes } from '@/utils/backup-runs';

describe('backup coordination policy', () => {
  it('uses 5, 15, and 60 minute retry delays, then remains hourly', () => {
    expect([1, 2, 3, 4, 20].map(backupRetryDelayMs)).toEqual([
      5 * 60_000,
      15 * 60_000,
      60 * 60_000,
      60 * 60_000,
      60 * 60_000,
    ]);
  });

  it('does not retry configuration and capacity prerequisites', () => {
    expect(classifyBackupFailure(new Error('Insufficient free space')).transient).toBe(false);
    expect(classifyBackupFailure(new Error('pg_dump is not installed')).transient).toBe(false);
    expect(classifyBackupFailure(new Error('connection reset')).transient).toBe(true);
    expect(classifyBackupFailure(Object.assign(new Error('input/output error'), { code: 'EIO' })).transient).toBe(true);
    expect(classifyBackupFailure(
      new BackupPrerequisiteError('BACKUP_REPOSITORY_MOUNT_MISMATCH', 'wrong mount')
    )).toEqual({ transient: false, code: 'BACKUP_REPOSITORY_MOUNT_MISMATCH', message: 'wrong mount' });
    expect(classifyBackupFailure(
      new BackupError('BACKUP_ENCRYPTION_FAILED', 'age failed')
    )).toEqual({ transient: true, code: 'BACKUP_ENCRYPTION_FAILED', message: 'age failed' });
    expect(classifyBackupFailure(
      new BackupError('BACKUP_MANIFEST_SIGNATURE_REQUIRED', 'signer unavailable')
    )).toEqual({ transient: false, code: 'BACKUP_MANIFEST_SIGNATURE_REQUIRED', message: 'signer unavailable' });
  });

  it('sets an explicit queue expiration beyond the execution deadline', () => {
    expect(BACKUP_JOB_EXPIRATION_SECONDS).toBe(4 * 60 * 60 + 5 * 60);
  });

  it('reserves raw capture, every package, and the largest in-flight ciphertext', () => {
    expect(calculateBackupWorkspaceRequiredBytes(100, 50, 25)).toBe(1024 * 1024 * 1024 + 450);
  });

  it('rolls back the run when transactional enqueue fails', async () => {
    const commands: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        commands.push(text.trim().split(/\s+/)[0]);
        if (text.includes('SELECT * FROM backup_runs')) return { rows: [], rowCount: 0 };
        if (text.includes('INSERT INTO backup_runs')) return { rows: [{ id: 'run-1' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    const jobs = { send: vi.fn(async () => { throw new Error('queue unavailable'); }) } as unknown as PgBoss;
    await expect(requestBackupRun(jobs, {
      triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey: 'site:a',
    }, { pool })).rejects.toThrow('queue unavailable');
    expect(commands).toContain('ROLLBACK');
    expect(commands).not.toContain('COMMIT');
  });

  it('coalesces an active run and fences a stale queue delivery', async () => {
    const active = { id: 'active-run', status: 'RUNNING' } as BackupRun;
    const client = {
      query: vi.fn(async (text: string) => text.includes('SELECT * FROM backup_runs')
        ? { rows: [active], rowCount: 1 } : { rows: [], rowCount: 0 }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Pool;
    const jobs = { send: vi.fn() } as unknown as PgBoss;
    await expect(requestBackupRun(jobs, {
      triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey: 'site:a',
    }, { pool })).resolves.toEqual({ run: active, coalesced: true });
    expect(jobs.send).not.toHaveBeenCalled();
    await expect(claimBackupAttempt({ runId: 'active-run', queueJobId: 'stale-job' }, { pool })).resolves.toBeNull();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('queue_job_id = $2'), expect.arrayContaining(['active-run', 'stale-job']));
  });

  it('leaves caller-owned transaction lifecycle to its caller and rejects ambiguous dependencies', async () => {
    const active = { id: 'external-run', status: 'PENDING' } as BackupRun;
    const client = { query: vi.fn(async () => ({ rows: [active] })), release: vi.fn() } as unknown as PoolClient;
    const jobs = { send: vi.fn() } as unknown as PgBoss;
    await expect(requestBackupRun(jobs, { triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey: 'site:a' }, { transaction: client })).resolves.toEqual({ run: active, coalesced: true });
    expect(client.query).toHaveBeenCalledTimes(1); expect(client.release).not.toHaveBeenCalled(); expect(jobs.send).not.toHaveBeenCalled();
    await expect(requestBackupRun(jobs, { triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey: 'site:a' }, { pool: {} as Pool, transaction: client })).rejects.toThrow('either');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit-pool lock, heartbeat, stage and failure settlement fenced without global pool fallback', async () => {
    const client = { query: vi.fn(async (text: string) => ({ rows: text.includes('pg_try_advisory_lock') ? [{ locked: true }] : [], rowCount: 0 })), release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Pool;
    const lock = await acquireBackupExecutionLock('site:a', { pool }); await lock!.release(); await lock!.release(); expect(client.release).toHaveBeenCalledTimes(1);
    const now = new Date('2026-10-31T00:00:00Z'); expect(await heartbeatBackupAttempt('run', 'attempt', now, { pool })).toBe(false); expect(await transitionBackupStage('run', 'attempt', 'DUMPING', now, { pool })).toBe(false);
    for (const [text, parameters] of vi.mocked(pool.query).mock.calls) { expect(text).toContain('attempt_id = $2'); expect(text).toContain('cancellation_requested_at IS NULL'); expect(text).toContain('lease_expires_at >'); expect(text).toContain('deadline_at >'); expect(parameters).toEqual(expect.arrayContaining(['run', 'attempt', now])); }
    const jobs = { send: vi.fn() } as unknown as PgBoss; await expect(settleFailedBackupAttempt(jobs, { runId: 'run', attemptId: 'stale-attempt', attemptNumber: 1, error: new Error('connection reset') }, { pool })).resolves.toBe('STALE');
    expect(client.query).toHaveBeenCalledWith('COMMIT'); expect(jobs.send).not.toHaveBeenCalled(); expect(client.release).toHaveBeenCalledTimes(2);
  });
});
