import { randomUUID } from 'node:crypto';
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDatabase, getDatabasePool, initializeDatabase, schema } from '@/db';
import {
  acquireBackupExecutionLock,
  claimBackupAttempt,
  deferBackupDelivery,
  getLatestSuccessfulBackupRun,
  reconcileBackupRuns,
  requestBackupRun,
  settleFailedBackupAttempt,
} from './coordination';
import { BackupPrerequisiteError, type BackupPrerequisiteCode } from './local-repository';
import { deleteBackupRun } from '@/utils/backup-runs';
import { createOffHostBackupManifest, uploadOffHostManifest } from '@/utils/off-host-backup';
import { parseOffHostBackupLocation } from '@/utils/off-host-backup-location';

const TEST_URL = process.env.DATABASE_URL!;

describe('backup coordination PostgreSQL/pg-boss integration', () => {
  let boss: PgBoss;

  beforeAll(async () => {
    expect(new URL(TEST_URL).pathname).toMatch(/_test$/);
    await initializeDatabase();
    boss = new PgBoss({ connectionString: TEST_URL, schema: 'pgboss_packet1_backup' });
    await boss.start();
    await boss.createQueue('backup');
  });

  beforeEach(async () => {
    await getDatabase().delete(schema.backupRuns);
    await boss.purgeQueue('backup').catch(() => undefined);
  });

  afterAll(async () => {
    await getDatabase().delete(schema.backupRuns);
    await boss.stop();
    await closeDatabase();
  });

  it('rolls back the run row when the real pg-boss enqueue cannot commit', async () => {
    await boss.deleteQueue('backup');
    const coordinationKey = `rollback:${randomUUID()}`;
    await expect(requestBackupRun(boss, {
      triggerType: 'MANUAL', repositoryKind: 'LEGACY_OFF_HOST', coordinationKey,
    })).rejects.toThrow();
    const rows = await getDatabase().select().from(schema.backupRuns)
      .where(eq(schema.backupRuns.coordination_key, coordinationKey));
    expect(rows).toHaveLength(0);
    await boss.createQueue('backup');
  });

  it('coalesces simultaneous requests into one database row and one job', async () => {
    const coordinationKey = `coalesce:${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 4 }, () => requestBackupRun(boss, {
      triggerType: 'MANUAL', repositoryKind: 'LEGACY_OFF_HOST', coordinationKey,
    })));
    expect(new Set(results.map((result) => result.run.id)).size).toBe(1);
    expect(results.filter((result) => !result.coalesced)).toHaveLength(1);
    const [run] = await getDatabase().select().from(schema.backupRuns)
      .where(eq(schema.backupRuns.coordination_key, coordinationKey));
    expect(run.queue_job_id).toBeTruthy();
    const job = await boss.getJobById('backup', run.queue_job_id!);
    expect(job?.data).toEqual({ runId: run.id, queueJobId: run.queue_job_id });
  });

  it('keeps a caller-owned request, repeated coalescing and real pg-boss delivery inside its rollback', async () => {
    const client = await getDatabasePool()!.connect(), coordinationKey = `external:${randomUUID()}`;
    try {
      await client.query('BEGIN');
      const first = await requestBackupRun(boss, { triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey }, { transaction: client });
      const second = await requestBackupRun(boss, { triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey }, { transaction: client });
      expect(second).toEqual({ run: first.run, coalesced: true });
      expect((await client.query('SELECT id FROM backup_runs WHERE id=$1', [first.run.id])).rows).toHaveLength(1);
      // The public wrapper must not commit/release this externally owned connection.
      await client.query('ROLLBACK');
      expect((await getDatabasePool()!.query('SELECT id FROM backup_runs WHERE id=$1', [first.run.id])).rows).toHaveLength(0);
      expect(await boss.getJobById('backup', first.run.queue_job_id!)).toBeNull();
    } finally { client.release(); }
  });

  it('fences a stale queue delivery and only claims the persisted job identity', async () => {
    const result = await requestBackupRun(boss, {
      triggerType: 'MANUAL', repositoryKind: 'LEGACY_OFF_HOST', coordinationKey: `fence:${randomUUID()}`,
    });
    await expect(claimBackupAttempt({ runId: result.run.id, queueJobId: randomUUID() })).resolves.toBeNull();
    const claimed = await claimBackupAttempt({ runId: result.run.id, queueJobId: result.run.queue_job_id! });
    expect(claimed?.attempt_id).toBeTruthy();
    await expect(claimBackupAttempt({ runId: result.run.id, queueJobId: result.run.queue_job_id! })).resolves.toBeNull();
  });

  it('keeps real claim leases near two minutes across opposite Node and database timezones', async () => {
    const originalTimezone = process.env.TZ;
    try {
      for (const timezone of [
        { node: 'Asia/Kolkata', database: 'UTC' },
        { node: 'UTC', database: 'Asia/Kolkata' },
      ]) {
        process.env.TZ = timezone.node;
        const queueJobId = randomUUID();
        const [run] = await getDatabase().insert(schema.backupRuns).values({
          trigger_type: 'MANUAL', status: 'PENDING', stage: 'QUEUED',
          coordination_key: `timezone:${timezone.node}:${timezone.database}:${randomUUID()}`,
          repository_kind: 'LOCAL_FILESYSTEM', queue_job_id: queueJobId,
        }).returning();
        const timezonePool = new Pool({
          connectionString: TEST_URL,
          options: `-c timezone=${timezone.database}`,
          max: 1,
        });
        try {
          await expect(claimBackupAttempt({ runId: run.id, queueJobId }, { pool: timezonePool })).resolves.toBeTruthy();
          const timing = await timezonePool.query<{ lease_seconds: string; deadline_seconds: string }>(
            `SELECT extract(epoch FROM (lease_expires_at - clock_timestamp()))::text AS lease_seconds,
                    extract(epoch FROM (deadline_at - clock_timestamp()))::text AS deadline_seconds
             FROM backup_runs WHERE id = $1`,
            [run.id]
          );
          const leaseSeconds = Number(timing.rows[0]?.lease_seconds);
          const deadlineSeconds = Number(timing.rows[0]?.deadline_seconds);
          expect(leaseSeconds).toBeGreaterThan(110);
          expect(leaseSeconds).toBeLessThanOrEqual(120);
          expect(deadlineSeconds).toBeGreaterThan(14_390);
          expect(deadlineSeconds).toBeLessThanOrEqual(14_400);
        } finally {
          await timezonePool.end();
        }
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('durably defers the current delivery while the execution lock is contended', async () => {
    const result = await requestBackupRun(boss, {
      triggerType: 'MANUAL', repositoryKind: 'LEGACY_OFF_HOST', coordinationKey: `lock:${randomUUID()}`,
    });
    const lockKey = `packet1-lock:${randomUUID()}`;
    const held = await acquireBackupExecutionLock(lockKey);
    expect(held).not.toBeNull();
    await expect(acquireBackupExecutionLock(lockKey)).resolves.toBeNull();
    await expect(deferBackupDelivery(boss, {
      runId: result.run.id,
      queueJobId: result.run.queue_job_id!,
    }, new Date(), 1_000)).resolves.toBe(true);
    const [deferred] = await getDatabase().select().from(schema.backupRuns)
      .where(eq(schema.backupRuns.id, result.run.id));
    expect(deferred.queue_job_id).not.toBe(result.run.queue_job_id);
    expect(await boss.getJobById('backup', deferred.queue_job_id!)).not.toBeNull();
    await held!.release();
  });

  it('unwinds an aborted publication and releases the execution lock', async () => {
    const lockKey = `publication:${randomUUID()}`;
    const lock = await acquireBackupExecutionLock(lockKey);
    expect(lock).not.toBeNull();
    const controller = new AbortController();
    const client = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => new Promise((_resolve, reject) => {
        options?.abortSignal?.addEventListener('abort', () => reject(new Error('publication aborted')), { once: true });
      }),
    } as unknown as Parameters<typeof uploadOffHostManifest>[0];
    const location = parseOffHostBackupLocation('s3://backup.test/site');
    const manifest = createOffHostBackupManifest({
      runId: randomUUID(), timestamp: '20261028', artifacts: [], location,
      endpoint: 'https://backup.test', intervalHours: 24, retentionDays: 30, releaseId: 'test',
    });
    try {
      const publication = uploadOffHostManifest(client, location, manifest, controller.signal);
      controller.abort();
      await expect(publication).rejects.toThrow('publication aborted');
    } finally {
      await lock!.release();
    }
    const replacement = await acquireBackupExecutionLock(lockKey);
    expect(replacement).not.toBeNull();
    await replacement!.release();
  });

  it('requeues missing PENDING and RETRY_WAIT jobs during restart reconciliation', async () => {
    const now = new Date();
    const ids = [randomUUID(), randomUUID()];
    await getDatabase().insert(schema.backupRuns).values([
      {
        id: ids[0], trigger_type: 'MANUAL', status: 'PENDING', stage: 'QUEUED',
        coordination_key: `pending:${randomUUID()}`, repository_kind: 'LEGACY_OFF_HOST',
        queue_job_id: null, created_at: new Date(now.getTime() - 120_000),
      },
      {
        id: ids[1], trigger_type: 'MANUAL', status: 'RETRY_WAIT', stage: 'RETRY_WAIT',
        coordination_key: `retry:${randomUUID()}`, repository_kind: 'LEGACY_OFF_HOST',
        queue_job_id: randomUUID(), retry_at: new Date(now.getTime() - 1_000),
      },
    ]);
    await expect(reconcileBackupRuns(boss, now)).resolves.toEqual({ retried: 0, requeued: 2 });
    const rows = await getDatabase().select().from(schema.backupRuns);
    for (const id of ids) {
      const run = rows.find((candidate) => candidate.id === id)!;
      expect(run.queue_job_id).toBeTruthy();
      expect(await boss.getJobById('backup', run.queue_job_id!)).not.toBeNull();
    }
  });

  it('leaves a live lease untouched, then recovers it exactly once after expiry', async () => {
    const now = new Date();
    const attemptId = randomUUID();
    const [run] = await getDatabase().insert(schema.backupRuns).values({
      trigger_type: 'MANUAL', status: 'RUNNING', stage: 'CAPTURING_DATABASE',
      coordination_key: `live-lease:${randomUUID()}`, repository_kind: 'LEGACY_OFF_HOST',
      attempt_id: attemptId, attempt_number: 1, queue_job_id: randomUUID(),
      heartbeat_at: now, lease_expires_at: new Date(now.getTime() + 30_000),
      deadline_at: new Date(now.getTime() + 3_600_000),
    }).returning();
    await expect(reconcileBackupRuns(boss, now)).resolves.toEqual({ retried: 0, requeued: 0 });
    expect((await getDatabase().select().from(schema.backupRuns).where(eq(schema.backupRuns.id, run.id)))[0]?.status).toBe('RUNNING');

    const expired = new Date(now.getTime() + 31_000);
    await expect(reconcileBackupRuns(boss, expired)).resolves.toEqual({ retried: 1, requeued: 0 });
    const [recovered] = await getDatabase().select().from(schema.backupRuns).where(eq(schema.backupRuns.id, run.id));
    expect(recovered.status).toBe('RETRY_WAIT');
    expect(recovered.attempt_id).toBeNull();
    expect(await boss.getJobById('backup', recovered.queue_job_id!)).not.toBeNull();
    await expect(reconcileBackupRuns(boss, new Date(expired.getTime() + 1_000))).resolves.toEqual({ retried: 0, requeued: 0 });
    await expect(reconcileBackupRuns(boss, recovered.retry_at!)).resolves.toEqual({ retried: 0, requeued: 0 });
  });

  it('settles every typed repository prerequisite as an actionable terminal failure', async () => {
    const codes: BackupPrerequisiteCode[] = [
      'BACKUP_REPOSITORY_MISSING', 'BACKUP_REPOSITORY_NOT_DIRECTORY', 'BACKUP_REPOSITORY_SYMLINK',
      'BACKUP_REPOSITORY_MOUNT_MISMATCH', 'BACKUP_REPOSITORY_OWNERSHIP_MISMATCH',
      'BACKUP_REPOSITORY_INSECURE_MODE', 'BACKUP_REPOSITORY_CAPACITY',
    ];
    for (const code of codes) {
      const attemptId = randomUUID();
      const [run] = await getDatabase().insert(schema.backupRuns).values({
        trigger_type: 'MANUAL', status: 'RUNNING', stage: 'PREPARING',
        coordination_key: `prerequisite:${code}:${randomUUID()}`, repository_kind: 'LOCAL_FILESYSTEM',
        attempt_id: attemptId, attempt_number: 1, lease_expires_at: new Date(Date.now() + 60_000),
        deadline_at: new Date(Date.now() + 3_600_000),
      }).returning();
      await expect(settleFailedBackupAttempt(boss, {
        runId: run.id, attemptId, attemptNumber: 1,
        error: new BackupPrerequisiteError(code, `failed: ${code}`),
      })).resolves.toBe('FAILED');
      const [failed] = await getDatabase().select().from(schema.backupRuns).where(eq(schema.backupRuns.id, run.id));
      expect(failed.error_code).toBe(code);
      expect(failed.retry_at).toBeNull();
    }
  });

  it('coalesces with a pre-migration active row using the stable global coordination key', async () => {
    const [legacy] = await getDatabase().insert(schema.backupRuns).values({
      trigger_type: 'MANUAL', status: 'PENDING', stage: 'QUEUED',
      coordination_key: 'site-backup', repository_kind: 'LEGACY_OFF_HOST', queue_job_id: null,
    }).returning();
    const result = await requestBackupRun(boss, {
      triggerType: 'MANUAL', repositoryKind: 'LOCAL_FILESYSTEM', coordinationKey: 'site-backup',
    });
    expect(result.coalesced).toBe(true);
    expect(result.run.id).toBe(legacy.id);
    expect(result.run.status).toBe('PENDING');
    expect(await getDatabase().select().from(schema.backupRuns)).toHaveLength(1);
  });

  it('cannot delete a retry-wait run while a claim races it', async () => {
    const queueJobId = randomUUID();
    const [run] = await getDatabase().insert(schema.backupRuns).values({
      trigger_type: 'MANUAL', status: 'RETRY_WAIT', stage: 'RETRY_WAIT',
      coordination_key: `delete-race:${randomUUID()}`, repository_kind: 'LEGACY_OFF_HOST',
      queue_job_id: queueJobId, retry_at: new Date(Date.now() - 1_000), files: [],
    }).returning();
    const [claim, removal] = await Promise.allSettled([
      claimBackupAttempt({ runId: run.id, queueJobId }),
      deleteBackupRun(run.id),
    ]);
    expect(claim.status).toBe('fulfilled');
    expect(claim.status === 'fulfilled' && claim.value?.status).toBe('RUNNING');
    expect(removal.status).toBe('rejected');
    const [preserved] = await getDatabase().select().from(schema.backupRuns).where(eq(schema.backupRuns.id, run.id));
    expect(preserved.status).toBe('RUNNING');
  });

  it('reports the latest successful capture independently of a newer failure', async () => {
    const capturedAt = new Date('2026-10-20T10:00:00.000Z');
    await getDatabase().insert(schema.backupRuns).values([
      {
        trigger_type: 'AUTOMATIC', status: 'COMPLETED', stage: 'COMPLETED',
        coordination_key: `success:${randomUUID()}`, repository_kind: 'LEGACY_OFF_HOST',
        captured_at: capturedAt, completed_at: capturedAt,
      },
      {
        trigger_type: 'MANUAL', status: 'FAILED', stage: 'FAILED',
        coordination_key: `failure:${randomUUID()}`, repository_kind: 'LEGACY_OFF_HOST',
        created_at: new Date('2026-10-21T10:00:00.000Z'), completed_at: new Date('2026-10-21T10:01:00.000Z'),
      },
    ]);
    expect((await getLatestSuccessfulBackupRun())?.captured_at).toEqual(capturedAt);
  });
});
