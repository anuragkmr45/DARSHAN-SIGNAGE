import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema, type Database } from '@/db';
import { MaintenanceCoordinator } from './coordinator';
import { MaintenanceOperationScope } from './operation-scope';
import { MaintenanceStore, type CaptureIdentity } from './store';
import { MaintenanceWatchdog } from './watchdog';
import { markBackupRunCompleted } from '@/utils/backup-runs';

const TEST_URL = process.env.DATABASE_URL!;
const SITE = 'packet-2-test-site';

describe('maintenance capture coordinator PostgreSQL integration', () => {
  let pool: Pool;
  let independentPool: Pool;
  let coordinator: MaintenanceCoordinator;
  let store: MaintenanceStore;
  let db: Database;

  beforeAll(() => {
    expect(new URL(TEST_URL).pathname).toMatch(/_test(?:_|$)/);
    pool = new Pool({ connectionString: TEST_URL, max: 8 });
    independentPool = new Pool({ connectionString: TEST_URL, max: 8 });
    db = drizzle(pool, { schema });
    coordinator = new MaintenanceCoordinator(pool);
    store = coordinator.store;
  });

  async function cleanupFixture(): Promise<void> {
    await pool.query('DELETE FROM maintenance_operations');
    await pool.query('UPDATE maintenance_site_state SET current_capture_id = NULL');
    await pool.query('DELETE FROM backup_captures');
    await pool.query('DELETE FROM maintenance_site_state');
    await pool.query('DELETE FROM backup_runs');
  }

  beforeEach(cleanupFixture);

  afterAll(async () => {
    await cleanupFixture();
    await independentPool.end();
    await pool.end();
  });

  async function currentAttempt(overallDeadlineMs = 4 * 60 * 60 * 1000): Promise<{ runId: string; attemptId: string }> {
    const runId = randomUUID();
    const attemptId = randomUUID();
    await pool.query(
      `INSERT INTO backup_runs
        (id, trigger_type, status, stage, repository_kind, coordination_key,
         attempt_id, attempt_number, lease_expires_at, deadline_at)
       VALUES ($1, 'MANUAL', 'RUNNING', 'PREPARING', 'LOCAL_FILESYSTEM', $2,
         $3, 1, clock_timestamp() + interval '2 minutes',
         clock_timestamp() + ($4 * interval '1 millisecond'))`,
      [runId, `packet2:${randomUUID()}`, attemptId, overallDeadlineMs]
    );
    return { runId, attemptId };
  }

  async function begin(owner = `worker:${randomUUID()}`): Promise<CaptureIdentity> {
    const attempt = await currentAttempt();
    return coordinator.beginCapture({
      siteKey: SITE,
      backupRunId: attempt.runId,
      backupAttemptId: attempt.attemptId,
      owner,
    });
  }

  async function setCaptureDeadlineRemaining(captureId: string, remainingMs: number): Promise<void> {
    // The production trigger correctly makes start/deadline immutable. This
    // isolated superuser fixture disables it only long enough to age both
    // columns together while preserving the exact-300-second constraint.
    await pool.query('ALTER TABLE backup_captures DISABLE TRIGGER backup_captures_authority_immutable');
    try {
      await pool.query(
        `UPDATE backup_captures
         SET started_at = fixture_clock.now - interval '300 seconds' + ($2 * interval '1 millisecond'),
             deadline_at = fixture_clock.now + ($2 * interval '1 millisecond')
         FROM (SELECT clock_timestamp() AS now) AS fixture_clock
         WHERE id = $1`,
        [captureId, remainingMs]
      );
    } finally {
      await pool.query('ALTER TABLE backup_captures ENABLE TRIGGER backup_captures_authority_immutable');
    }
  }

  async function forceCapturePastDeadline(captureId: string): Promise<void> {
    await setCaptureDeadlineRemaining(captureId, -1_000);
  }

  it('linearizes an admission-vs-close race across independent connections', async () => {
    const attempt = await currentAttempt();
    const otherCoordinator = new MaintenanceCoordinator(independentPool);
    const [admission, capture] = await Promise.allSettled([
      otherCoordinator.admit({ siteKey: SITE, operationKind: 'race-mutation' }),
      coordinator.beginCapture({
        siteKey: SITE,
        backupRunId: attempt.runId,
        backupAttemptId: attempt.attemptId,
        owner: 'capture-racer',
      }),
    ]);

    expect(capture.status).toBe('fulfilled');
    const state = await store.getSite(SITE);
    expect(state?.admission_open).toBe(false);
    if (admission.status === 'fulfilled') {
      expect(admission.value.generation).toBeLessThan(Number(state!.generation));
      await otherCoordinator.complete(admission.value);
    } else {
      expect(admission.reason).toMatchObject({ code: 'MAINTENANCE_ADMISSION_CLOSED', retryable: true });
    }
    await expect(otherCoordinator.admit({ siteKey: SITE, operationKind: 'post-close' }))
      .rejects.toMatchObject({ code: 'MAINTENANCE_ADMISSION_CLOSED', retryable: true });
  });

  it('drains an admitted operation through completion before entering COPYING', async () => {
    const permit = await coordinator.admit({ siteKey: SITE, operationKind: 'object-finalizer' });
    const capture = await begin();
    await expect(coordinator.enterCopying(capture)).rejects.toMatchObject({
      code: 'MAINTENANCE_CAPTURE_NOT_DRAINED',
      retryable: true,
    });
    await coordinator.complete(permit);
    await expect(coordinator.enterCopying(capture)).resolves.toMatchObject({ capture_status: 'COPYING' });
  });

  it('reopens an ordinary failed capture without stealing Packet 1 failure settlement', async () => {
    const capture = await begin('ordinary-failure');
    await coordinator.enterCopying(capture);
    await coordinator.abort(capture);
    expect(await store.getSite(SITE)).toMatchObject({ admission_open: true, capture_status: 'ABORTED' });
    const run = await pool.query<{ status: string; attempt_id: string }>(
      'SELECT status, attempt_id FROM backup_runs WHERE id = $1',
      [capture.backupRunId]
    );
    expect(run.rows[0]).toMatchObject({ status: 'RUNNING', attempt_id: capture.backupAttemptId });
    await expect(coordinator.seal(capture, 'f'.repeat(64))).rejects.toMatchObject({
      code: 'MAINTENANCE_CAPTURE_FENCED',
    });
  });

  it('never guesses an expired operation lease and requires explicit uncertain reconciliation', async () => {
    const permit = await coordinator.admit({ siteKey: SITE, operationKind: 'upload', leaseSeconds: 1 });
    await pool.query(
      `UPDATE maintenance_operations SET lease_expires_at = clock_timestamp() - interval '1 second'
       WHERE id = $1`,
      [permit.operationId]
    );
    const capture = await begin();
    await expect(coordinator.enterCopying(capture)).rejects.toMatchObject({ code: 'MAINTENANCE_CAPTURE_NOT_DRAINED' });
    expect(await store.getOperation(permit.operationId)).toMatchObject({ status: 'UNCERTAIN', resolution: null });
    await store.resolveUncertainOperation({
      operationId: permit.operationId,
      resolution: 'CONFIRMED_ABORTED',
      note: 'Verified the upload transaction and object write both rolled back.',
    });
    await expect(coordinator.enterCopying(capture)).resolves.toMatchObject({ capture_status: 'COPYING' });
  });

  it('uses the database clock for an exact, nonrenewable 300-second capture deadline', async () => {
    const browserClockSkew = new Date('2099-01-01T00:00:00.000Z');
    expect(browserClockSkew.getUTCFullYear()).toBe(2099);
    const capture = await begin();
    const state = await store.getSite(SITE);
    const interval = await pool.query<{ seconds: string; near_database_now: boolean }>(
      `SELECT extract(epoch FROM (deadline_at - started_at))::text AS seconds,
              abs(extract(epoch FROM (started_at - clock_timestamp()))) < 5 AS near_database_now
       FROM backup_captures WHERE id = $1`,
      [capture.captureId]
    );
    expect(interval.rows[0]).toEqual({ seconds: '300.000000', near_database_now: true });

    const originalDeadline = state!.capture_deadline_at;
    await coordinator.enterCopying(capture);
    expect((await store.getSite(SITE))?.capture_deadline_at).toEqual(originalDeadline);
    await expect(pool.query(
      `UPDATE backup_captures SET deadline_at = deadline_at + interval '1 second' WHERE id = $1`,
      [capture.captureId]
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a backup attempt whose Packet 1 lease or overall deadline is already expired', async () => {
    const attempt = await currentAttempt();
    await pool.query(
      `UPDATE backup_runs SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE id = $1`,
      [attempt.runId]
    );
    await expect(coordinator.beginCapture({
      siteKey: SITE,
      backupRunId: attempt.runId,
      backupAttemptId: attempt.attemptId,
      owner: 'expired-attempt',
    })).rejects.toMatchObject({ code: 'MAINTENANCE_CAPTURE_ATTEMPT_MISMATCH' });
    expect(await store.getSite(SITE)).toBeNull();
  });

  it('fences legacy timestamp-without-zone RUNNING and RETRY_WAIT authority during upgrade', async () => {
    const schemaName = `packet2_upgrade_${randomUUID().replaceAll('-', '')}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}", public`);
      await client.query(`
        CREATE TABLE backup_runs (
          id uuid PRIMARY KEY,
          status varchar(20) NOT NULL,
          stage varchar(32) NOT NULL,
          attempt_id uuid,
          heartbeat_at timestamp,
          lease_expires_at timestamp,
          deadline_at timestamp,
          retry_at timestamp,
          cancellation_requested_at timestamp,
          captured_at timestamp,
          verified_at timestamp,
          queue_job_id uuid,
          error_code varchar(100),
          error_message text,
          started_at timestamp,
          completed_at timestamp,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);
      const runningId = randomUUID();
      const retryId = randomUUID();
      await client.query(
        `INSERT INTO backup_runs
          (id, status, stage, attempt_id, heartbeat_at, lease_expires_at, deadline_at, retry_at, queue_job_id)
         VALUES
          ($1, 'RUNNING', 'COPYING', $2, timestamp '2099-01-01 12:00:00',
           timestamp '2099-01-01 12:02:00', timestamp '2099-01-01 16:00:00', NULL, $3),
          ($4, 'RETRY_WAIT', 'RETRY_WAIT', NULL, NULL, NULL, NULL,
           timestamp '2099-01-01 12:05:00', $5)`,
        [runningId, randomUUID(), randomUUID(), retryId, randomUUID()]
      );
      const migration = readFileSync(new URL('../../drizzle/migrations/0050_maintenance_capture_barrier.sql', import.meta.url), 'utf8');
      const guard = migration.slice(0, migration.indexOf('CREATE TABLE "maintenance_site_state"'));
      await client.query(guard);

      const rows = await client.query<{
        id: string; status: string; stage: string; attempt_id: string | null;
        retry_at: Date | null; queue_job_id: string | null; error_code: string | null;
      }>('SELECT id, status, stage, attempt_id, retry_at, queue_job_id, error_code FROM backup_runs ORDER BY id');
      expect(rows.rows).toHaveLength(2);
      for (const row of rows.rows) {
        expect(row).toMatchObject({
          status: 'RETRY_WAIT',
          stage: 'RETRY_WAIT',
          attempt_id: null,
          retry_at: null,
          queue_job_id: null,
          error_code: 'BACKUP_AUTHORITY_TIMEZONE_MIGRATED',
        });
      }
      const types = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'backup_runs'
           AND column_name IN ('lease_expires_at', 'deadline_at', 'retry_at')`,
        [schemaName]
      );
      expect(types.rows.every((row) => row.data_type === 'timestamp with time zone')).toBe(true);
    } finally {
      await client.query('SET search_path TO public').catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
      client.release();
    }
  });

  it('rechecks begin authority after waiting on the backup-run row lock', async () => {
    const attempt = await currentAttempt(300);
    const blocker = await pool.connect();
    const otherCoordinator = new MaintenanceCoordinator(independentPool);
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [attempt.runId]);
      const beginning = otherCoordinator.beginCapture({
        siteKey: SITE,
        backupRunId: attempt.runId,
        backupAttemptId: attempt.attemptId,
        owner: 'lock-wait-begin',
      });
      const rejected = expect(beginning).rejects.toMatchObject({ code: 'MAINTENANCE_CAPTURE_ATTEMPT_MISMATCH' });
      await new Promise((resolve) => setTimeout(resolve, 800));
      await blocker.query('COMMIT');
      await rejected;
      expect(await store.getSite(SITE)).toBeNull();
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('rechecks seal authority after lock wait and conditionally fences the final write', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    await setCaptureDeadlineRemaining(capture.captureId, 300);
    const blocker = await pool.connect();
    const otherCoordinator = new MaintenanceCoordinator(independentPool);
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [capture.backupRunId]);
      const sealing = otherCoordinator.seal(capture, 'e'.repeat(64));
      const rejected = expect(sealing).rejects.toMatchObject({ code: 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED' });
      await new Promise((resolve) => setTimeout(resolve, 800));
      await blocker.query('COMMIT');
      await rejected;
      expect(await store.getCapture(capture.captureId)).toMatchObject({
        status: 'COPYING',
        staging_inventory_digest: null,
      });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('lets watchdog expiry reopen admission while seal waits on a busy attempt row', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    await setCaptureDeadlineRemaining(capture.captureId, 300);
    const blocker = await pool.connect();
    const otherCoordinator = new MaintenanceCoordinator(independentPool);
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [capture.backupRunId]);
      const sealing = otherCoordinator.seal(capture, 'd'.repeat(64));
      await new Promise((resolve) => setTimeout(resolve, 50));
      await forceCapturePastDeadline(capture.captureId);
      const watchdog = new MaintenanceWatchdog(store, 100);
      await expect(watchdog.tick()).resolves.toBeUndefined();
      expect(await store.getSite(SITE)).toMatchObject({ admission_open: true, capture_status: 'EXPIRED' });
      await expect(coordinator.admit({ siteKey: SITE, operationKind: 'deadline-reopened' })).resolves.toBeDefined();
      await blocker.query('COMMIT');
      await expect(sealing).rejects.toMatchObject({ code: 'MAINTENANCE_CAPTURE_FENCED' });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('watchdog expiry reopens admission and permanently fences stale capture work', async () => {
    const capture = await begin();
    await forceCapturePastDeadline(capture.captureId);
    const watchdog = new MaintenanceWatchdog(store, 100);
    await watchdog.tick();
    expect(await store.getSite(SITE)).toMatchObject({ admission_open: true, capture_status: 'EXPIRED' });
    await expect(coordinator.enterCopying(capture)).rejects.toMatchObject({
      code: 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED',
    });
    await expect(coordinator.admit({ siteKey: SITE, operationKind: 'after-expiry' })).resolves.toBeDefined();
  });

  it('commits expiry fencing when stale worker work first observes the deadline', async () => {
    const capture = await begin();
    await forceCapturePastDeadline(capture.captureId);
    await expect(coordinator.enterCopying(capture)).rejects.toMatchObject({
      code: 'MAINTENANCE_CAPTURE_DEADLINE_EXPIRED',
    });
    expect(await store.getSite(SITE)).toMatchObject({ admission_open: true, capture_status: 'EXPIRED' });
    const run = await pool.query('SELECT status, attempt_id FROM backup_runs WHERE id = $1', [capture.backupRunId]);
    expect(run.rows[0]).toMatchObject({ status: 'RETRY_WAIT', attempt_id: null });
  });

  it('admission lazily expires a dead barrier even if the watchdog did not run', async () => {
    const capture = await begin();
    await forceCapturePastDeadline(capture.captureId);
    await expect(coordinator.admit({ siteKey: SITE, operationKind: 'lazy-expiry' })).resolves.toBeDefined();
    expect(await store.getSite(SITE)).toMatchObject({ admission_open: true, capture_status: 'EXPIRED' });
  });

  it('rejects a stale operation owner without releasing its successor', async () => {
    const permit = await coordinator.admit({ siteKey: SITE, operationKind: 'owned-write' });
    const successorOwner = randomUUID();
    await pool.query('UPDATE maintenance_operations SET owner_token = $2 WHERE id = $1', [permit.operationId, successorOwner]);
    await expect(coordinator.complete(permit)).rejects.toMatchObject({ code: 'MAINTENANCE_OPERATION_NOT_OWNER' });
    expect(await store.getOperation(permit.operationId)).toMatchObject({
      owner_token: successorOwner,
      status: 'ACTIVE',
    });
  });

  it('linearizes seal before emergency on the site row', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    await coordinator.seal(capture, 'a'.repeat(64));
    const result = await db.transaction((tx) => coordinator.preemptForEmergency(tx, SITE));
    expect(result.preempted).toBe(false);
    expect(await store.getSite(SITE)).toMatchObject({
      admission_open: true,
      capture_status: 'SEALED',
      staging_inventory_digest: 'a'.repeat(64),
    });
  });

  it('records capture freshness from the seal instead of delayed publication completion', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    await coordinator.seal(capture, '7'.repeat(64));
    const sealed = await store.getCapture(capture.captureId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(markBackupRunCompleted(
      capture.backupRunId,
      capture.backupAttemptId,
      [],
      undefined,
      { db }
    )).resolves.toBe(true);
    const completed = await pool.query<{ captured_at: Date; completed_at: Date }>(
      'SELECT captured_at, completed_at FROM backup_runs WHERE id = $1',
      [capture.backupRunId]
    );
    expect(completed.rows[0]?.captured_at).toEqual(sealed?.sealed_at);
    expect(new Date(completed.rows[0]!.completed_at).getTime())
      .toBeGreaterThan(new Date(completed.rows[0]!.captured_at).getTime());
  });

  it('rechecks completion authority with the database clock after a row-lock wait', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    await coordinator.seal(capture, '8'.repeat(64));
    await pool.query(
      `UPDATE backup_runs SET lease_expires_at = clock_timestamp() + interval '300 milliseconds',
         deadline_at = clock_timestamp() + interval '300 milliseconds'
       WHERE id = $1`,
      [capture.backupRunId]
    );
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [capture.backupRunId]);
      const completion = markBackupRunCompleted(
        capture.backupRunId,
        capture.backupAttemptId,
        [],
        undefined,
        { db }
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await blocker.query('COMMIT');
      await expect(completion).resolves.toBe(false);
      const run = await pool.query<{ status: string }>('SELECT status FROM backup_runs WHERE id = $1', [capture.backupRunId]);
      expect(run.rows[0]?.status).toBe('RUNNING');
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('preserves immutable SEALED history when a later capture becomes current', async () => {
    const firstCapture = await begin('first-worker');
    await coordinator.enterCopying(firstCapture);
    await coordinator.seal(firstCapture, 'd'.repeat(64));
    const secondCapture = await begin('second-worker');
    expect(secondCapture.captureId).not.toBe(firstCapture.captureId);
    expect(await store.getCapture(firstCapture.captureId)).toMatchObject({
      status: 'SEALED',
      staging_inventory_digest: 'd'.repeat(64),
      capture_owner: 'first-worker',
    });
    expect(await store.getSite(SITE)).toMatchObject({
      current_capture_id: secondCapture.captureId,
      capture_status: 'DRAINING',
    });
  });

  it('enforces legal capture transitions and freezes terminal evidence in PostgreSQL', async () => {
    const illegal = await begin('illegal-transition-worker');
    await expect(pool.query(
      `UPDATE backup_captures SET status = 'SEALED', staging_inventory_digest = $2,
         sealed_at = clock_timestamp(), reopened_at = clock_timestamp()
       WHERE id = $1`,
      [illegal.captureId, '1'.repeat(64)]
    )).rejects.toMatchObject({ code: '23514' });
    expect(await store.getCapture(illegal.captureId)).toMatchObject({ status: 'DRAINING' });

    await coordinator.enterCopying(illegal);
    await coordinator.seal(illegal, '2'.repeat(64));
    await expect(pool.query(
      `UPDATE backup_captures SET staging_inventory_digest = $2 WHERE id = $1`,
      [illegal.captureId, '3'.repeat(64)]
    )).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(
      `UPDATE backup_captures SET status = 'PREEMPTED', staging_inventory_digest = NULL,
         sealed_at = NULL WHERE id = $1`,
      [illegal.captureId]
    )).rejects.toMatchObject({ code: '23514' });
    expect(await store.getCapture(illegal.captureId)).toMatchObject({
      status: 'SEALED',
      staging_inventory_digest: '2'.repeat(64),
    });
  });

  it('linearizes emergency before seal and fences publication immediately', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    const result = await db.transaction((tx) => coordinator.preemptForEmergency(tx, SITE));
    expect(result.preempted).toBe(true);
    await expect(coordinator.seal(capture, 'b'.repeat(64))).rejects.toMatchObject({
      code: 'MAINTENANCE_CAPTURE_FENCED',
    });
    const run = await pool.query('SELECT status, attempt_id, cancellation_requested_at FROM backup_runs WHERE id = $1', [capture.backupRunId]);
    expect(run.rows[0]).toMatchObject({ status: 'RETRY_WAIT', attempt_id: null, cancellation_requested_at: null });
  });

  it('preempts immediately even when backup-run bookkeeping is row-locked', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [capture.backupRunId]);
      await expect(db.transaction((tx) => coordinator.preemptForEmergency(tx, SITE)))
        .resolves.toMatchObject({ preempted: true, captureId: capture.captureId });
      expect(await store.getSite(SITE)).toMatchObject({ admission_open: true, capture_status: 'PREEMPTED' });
      const run = await blocker.query<{ status: string; attempt_id: string }>(
        'SELECT status, attempt_id FROM backup_runs WHERE id = $1',
        [capture.backupRunId]
      );
      expect(run.rows[0]).toMatchObject({ status: 'RUNNING', attempt_id: capture.backupAttemptId });
      await blocker.query('COMMIT');
      await expect(coordinator.seal(capture, 'e'.repeat(64))).rejects.toMatchObject({
        code: 'MAINTENANCE_CAPTURE_FENCED',
      });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('allows exactly one legal winner in a concurrent seal-versus-emergency race', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    const otherCoordinator = new MaintenanceCoordinator(independentPool);

    const [sealResult, emergencyResult] = await Promise.allSettled([
      coordinator.seal(capture, 'c'.repeat(64)),
      db.transaction((tx) => otherCoordinator.preemptForEmergency(tx, SITE)),
    ]);

    const stored = await store.getCapture(capture.captureId);
    const run = await pool.query<{ status: string; attempt_id: string | null }>(
      'SELECT status, attempt_id FROM backup_runs WHERE id = $1',
      [capture.backupRunId]
    );
    if (stored?.status === 'SEALED') {
      expect(sealResult.status).toBe('fulfilled');
      expect(emergencyResult).toMatchObject({
        status: 'fulfilled',
        value: { preempted: false },
      });
      expect(run.rows[0]).toMatchObject({ status: 'RUNNING', attempt_id: capture.backupAttemptId });
    } else {
      expect(stored?.status).toBe('PREEMPTED');
      expect(emergencyResult).toMatchObject({
        status: 'fulfilled',
        value: { preempted: true },
      });
      expect(sealResult).toMatchObject({
        status: 'rejected',
        reason: { code: 'MAINTENANCE_CAPTURE_FENCED' },
      });
      // Emergency authority is committed even if seal already owns the run
      // row. In that legal interleaving the fenced worker settles RUNNING on
      // its failure path; otherwise preemption can write RETRY_WAIT directly.
      expect(
        (run.rows[0]?.status === 'RUNNING' && run.rows[0]?.attempt_id === capture.backupAttemptId)
        || (run.rows[0]?.status === 'RETRY_WAIT' && run.rows[0]?.attempt_id === null)
      ).toBe(true);
    }
  });

  it('rejects a new production capture while a committed emergency is active', async () => {
    const emergencyId = randomUUID();
    const attempt = await currentAttempt();
    await pool.query(
      `INSERT INTO emergencies
        (id, message, priority, target_all, is_active, expires_at)
       VALUES ($1, 'Active capture barrier emergency', 'HIGH', true, true,
         clock_timestamp() + interval '5 minutes')`,
      [emergencyId]
    );
    try {
      await expect(coordinator.beginCapture({
        siteKey: SITE,
        backupRunId: attempt.runId,
        backupAttemptId: attempt.attemptId,
        owner: 'emergency-blocked-worker',
      })).rejects.toMatchObject({
        code: 'MAINTENANCE_CAPTURE_EMERGENCY_ACTIVE',
        retryable: true,
        details: { emergencyId },
      });
      expect(await store.getSite(SITE)).toBeNull();
    } finally {
      await pool.query(
        `UPDATE emergencies SET is_active = false, updated_at = clock_timestamp()
         WHERE id = $1`,
        [emergencyId]
      );
    }
  });

  it('rolls emergency preemption back with an invalid or unauthorized caller transaction', async () => {
    const capture = await begin();
    await expect(db.transaction(async (tx) => {
      await coordinator.preemptForEmergency(tx, SITE);
      throw new Error('EMERGENCY_CALLER_UNAUTHORIZED');
    })).rejects.toThrow('EMERGENCY_CALLER_UNAUTHORIZED');
    expect(await store.getSite(SITE)).toMatchObject({ admission_open: false, capture_status: 'DRAINING' });
    const run = await pool.query('SELECT cancellation_requested_at FROM backup_runs WHERE id = $1', [capture.backupRunId]);
    expect(run.rows[0]?.cancellation_requested_at).toBeNull();
  });

  it('reuses one owned permit for a nested lexical operation scope', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    let outerId = '';
    let innerId = '';
    await scope.run({ siteKey: SITE, operationKind: 'outer-mutation' }, async (outer) => {
      outerId = outer.operationId;
      await scope.run({ siteKey: SITE, operationKind: 'inner-finalizer' }, async (inner) => {
        innerId = inner.operationId;
      });
      expect(await store.getOperation(outer.operationId)).toMatchObject({ status: 'ACTIVE' });
    });
    expect(innerId).toBe(outerId);
    expect(await store.getOperation(outerId)).toMatchObject({ status: 'COMPLETED' });
    const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM maintenance_operations');
    expect(count.rows[0]?.count).toBe('1');
  });

  it('reuses an outer permit across scope instances when capture closes before the inner call', async () => {
    const outerScope = new MaintenanceOperationScope(coordinator);
    const innerScope = new MaintenanceOperationScope(new MaintenanceCoordinator(independentPool));
    let capture!: CaptureIdentity;
    let outerId = '';
    let innerId = '';

    await outerScope.run({ siteKey: SITE, operationKind: 'http:POST:/media' }, async (outer) => {
      outerId = outer.operationId;
      capture = await begin('close-between-nested-scopes');
      expect(await store.getSite(SITE)).toMatchObject({ admission_open: false });

      await innerScope.run(
        { siteKey: SITE, operationKind: 'worker:webpage:verify-capture' },
        async (inner) => { innerId = inner.operationId; }
      );
      expect(await store.getOperation(outerId)).toMatchObject({ status: 'ACTIVE' });
    });

    expect(innerId).toBe(outerId);
    expect(await store.getOperation(outerId)).toMatchObject({ status: 'COMPLETED' });
    const count = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM maintenance_operations');
    expect(count.rows[0]?.count).toBe('1');
    await coordinator.abort(capture);
  });

  it('never lets detached continuations reuse a settled lexical permit', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    let releaseDetached!: () => void;
    const detachedGate = new Promise<void>((resolve) => { releaseDetached = resolve; });
    let detached!: Promise<void>;
    let outerOperationId = '';
    await scope.run({ siteKey: SITE, operationKind: 'outer-request' }, async (permit) => {
      outerOperationId = permit.operationId;
      detached = (async () => {
        await detachedGate;
        await scope.run({ siteKey: SITE, operationKind: 'detached-write' }, async () => undefined);
      })();
    });
    expect(await store.getOperation(outerOperationId)).toMatchObject({ status: 'COMPLETED' });

    const capture = await begin('detached-test-capture');
    releaseDetached();
    await expect(detached).rejects.toMatchObject({ code: 'MAINTENANCE_ADMISSION_CLOSED' });
    await coordinator.abort(capture);
  });

  it('isolates newly admitted permits across parallel sibling async branches', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    const childSite = `${SITE}-child`;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let firstAdmitted!: () => void;
    let secondAdmitted!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstReady = new Promise<void>((resolve) => { firstAdmitted = resolve; });
    const secondReady = new Promise<void>((resolve) => { secondAdmitted = resolve; });
    let parentId = '';
    let firstId = '';
    let secondId = '';

    await scope.run({ siteKey: SITE, operationKind: 'parent-A' }, async (parent) => {
      parentId = parent.operationId;
      const firstChild = scope.run({ siteKey: childSite, operationKind: 'child-B-1' }, async (permit) => {
        firstId = permit.operationId;
        firstAdmitted();
        await firstGate;
      });
      await firstReady;

      // This call originates from the parent-A context after child 1 has
      // admitted B. It must not see child 1's branch-local B permit.
      const secondChild = scope.run({ siteKey: childSite, operationKind: 'child-B-2' }, async (permit) => {
        secondId = permit.operationId;
        secondAdmitted();
        await secondGate;
      });
      await secondReady;
      expect(secondId).not.toBe(firstId);
      expect(await store.getOperation(firstId)).toMatchObject({ status: 'ACTIVE' });
      expect(await store.getOperation(secondId)).toMatchObject({ status: 'ACTIVE' });

      releaseFirst();
      await firstChild;
      expect(await store.getOperation(firstId)).toMatchObject({ status: 'COMPLETED' });
      expect(await store.getOperation(secondId)).toMatchObject({ status: 'ACTIVE' });
      expect(await store.getOperation(parentId)).toMatchObject({ status: 'ACTIVE' });

      releaseSecond();
      await secondChild;
      expect(await store.getOperation(secondId)).toMatchObject({ status: 'COMPLETED' });
      expect(await store.getOperation(parentId)).toMatchObject({ status: 'ACTIVE' });
    });
    expect(await store.getOperation(parentId)).toMatchObject({ status: 'COMPLETED' });
  });

  it('releases a known rejected operation scope instead of poisoning future drains', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    let operationId = '';
    await expect(scope.run({ siteKey: SITE, operationKind: 'failure-boundary' }, async (permit) => {
      operationId = permit.operationId;
      throw new Error('object completion outcome unknown');
    })).rejects.toThrow('object completion outcome unknown');
    expect(await store.getOperation(operationId)).toMatchObject({ status: 'COMPLETED', resolution: null });
  });

  it('keeps only explicitly ambiguous work UNCERTAIN and blocks capture', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    let operationId = '';
    await scope.run({ siteKey: SITE, operationKind: 'ambiguous-object-write' }, async (permit) => {
      operationId = permit.operationId;
      permit.markOutcomeUncertain();
    });
    expect(await store.getOperation(operationId)).toMatchObject({ status: 'UNCERTAIN' });
    const capture = await begin();
    await expect(coordinator.enterCopying(capture)).rejects.toMatchObject({ code: 'MAINTENANCE_CAPTURE_NOT_DRAINED' });
  });

  it('heartbeats a long admitted scope before one third of its lease', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    let operationId = '';
    await scope.run({ siteKey: SITE, operationKind: 'long-upload', leaseSeconds: 1 }, async (permit) => {
      operationId = permit.operationId;
      await new Promise((resolve) => setTimeout(resolve, 1_250));
      expect(permit.signal.aborted).toBe(false);
    });
    expect(await store.getOperation(operationId)).toMatchObject({ status: 'COMPLETED' });
  });

  it('aborts the scope signal and leaves UNCERTAIN when heartbeat ownership is lost', async () => {
    const scope = new MaintenanceOperationScope(coordinator);
    let operationId = '';
    await expect(scope.run({ siteKey: SITE, operationKind: 'lost-upload', leaseSeconds: 1 }, async (permit) => {
      operationId = permit.operationId;
      await pool.query(
        `UPDATE maintenance_operations SET lease_expires_at = clock_timestamp() - interval '1 second'
         WHERE id = $1`,
        [permit.operationId]
      );
      await new Promise<void>((resolve) => permit.signal.addEventListener('abort', () => resolve(), { once: true }));
    })).rejects.toMatchObject({ code: 'MAINTENANCE_OPERATION_NOT_OWNER' });
    expect(await store.getOperation(operationId)).toMatchObject({ status: 'UNCERTAIN' });
  });

  it('rejects sealing when the Packet 1 attempt identity was replaced', async () => {
    const capture = await begin();
    await coordinator.enterCopying(capture);
    await pool.query(
      `UPDATE backup_runs SET attempt_id = $2, attempt_number = attempt_number + 1 WHERE id = $1`,
      [capture.backupRunId, randomUUID()]
    );
    await expect(coordinator.seal(capture, 'c'.repeat(64))).rejects.toMatchObject({
      code: 'MAINTENANCE_CAPTURE_ATTEMPT_MISMATCH',
    });
    expect(await store.getSite(SITE)).toMatchObject({ admission_open: false, capture_status: 'COPYING' });
  });
});
