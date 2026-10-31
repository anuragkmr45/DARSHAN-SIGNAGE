import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  completeVerifiedBackupPublication,
  prepareBackupPublication,
  reconcileVerifiedBackupPublication,
  recordBackupPublicationOutcome,
} from './publication-store.js';
import { projectTerminalBackupExecutionOutcomes } from './retention-store.js';

const TEST_URL = process.env.DATABASE_URL!;

describe('local backup publication store PostgreSQL integration', () => {
  let pool: Pool;

  beforeAll(() => {
    expect(new URL(TEST_URL).pathname).toMatch(/_test(?:_|$)/);
    pool = new Pool({ connectionString: TEST_URL, max: 4 });
  });

  afterAll(async () => {
    // Terminal publication/outcome rows are intentionally immutable retention
    // history. The dedicated integration runner resets the *_test database at
    // suite startup; per-test UUIDs keep the cases isolated without bypassing
    // or disabling those production constraints during cleanup.
    await pool.end();
  });

  async function sealedAttempt() {
    const runId = randomUUID();
    const attemptId = randomUUID();
    const captureId = randomUUID();
    const siteKey = `publication-${randomUUID()}`;
    await pool.query(
      `INSERT INTO backup_runs
         (id, trigger_type, status, stage, repository_kind, coordination_key,
          attempt_id, attempt_number, lease_expires_at, deadline_at)
       VALUES ($1, 'MANUAL', 'RUNNING', 'PACKAGING', 'LOCAL_FILESYSTEM', $2,
         $3, 1, clock_timestamp() + interval '2 minutes',
         clock_timestamp() + interval '4 hours')`,
      [runId, siteKey, attemptId]
    );
    await pool.query(
      `INSERT INTO maintenance_site_state (site_key, admission_open, generation)
       VALUES ($1, true, 1)`,
      [siteKey]
    );
    await pool.query(
      `INSERT INTO backup_captures
         (id, site_key, generation, backup_run_id, backup_attempt_id,
          capture_owner, status, started_at, deadline_at,
          staging_inventory_digest, sealed_at, reopened_at)
       SELECT $1, $2, 1, $3, $4, 'publication-test', 'SEALED',
         fixture.sealed_at - interval '9 seconds',
         fixture.sealed_at + interval '291 seconds', $5,
         fixture.sealed_at, fixture.sealed_at
       FROM (
         SELECT date_trunc('second', clock_timestamp()) - interval '1 second' + interval '0.123456 seconds' AS sealed_at
       ) AS fixture`,
      [captureId, siteKey, runId, attemptId, 'a'.repeat(64)]
    );
    return { runId, attemptId, captureId, siteKey, repositoryId: randomUUID(), manifestSha256: 'b'.repeat(64) };
  }

  async function publish(attempt: Awaited<ReturnType<typeof sealedAttempt>>) {
    const publication = await prepareBackupPublication({
      ...attempt,
      incompleteRelativePath: `incomplete/${attempt.runId}.${attempt.attemptId}`,
      publishedRelativePath: `runs/${attempt.runId}`,
      pool,
    });
    return recordBackupPublicationOutcome({
      publicationId: publication.id,
      manifestSha256: attempt.manifestSha256,
      outcome: 'PUBLISHED',
      pool,
    });
  }

  it('completes only the exact current sealed and read-back-verified publication', async () => {
    const attempt = await sealedAttempt();
    const publication = await publish(attempt);
    await expect(completeVerifiedBackupPublication({
      publicationId: publication.id,
      ...attempt,
      repositoryManifest: { version: 1, site: { id: attempt.siteKey } },
      pool,
    })).resolves.toBe(true);

    const run = await pool.query(
      `SELECT status, repository_id, manifest_sha256, files, off_host_manifest,
              captured_at, verified_at
       FROM backup_runs WHERE id = $1`,
      [attempt.runId]
    );
    expect(run.rows[0]).toMatchObject({
      status: 'COMPLETED',
      repository_id: attempt.repositoryId,
      manifest_sha256: attempt.manifestSha256,
      files: null,
      off_host_manifest: null,
    });
    expect(run.rows[0].captured_at).toBeTruthy();
    expect(run.rows[0].verified_at).toBeTruthy();

    const precision = await pool.query<{
      capture_us: string; outcome_capture_us: string; publication_verified_us: string;
      outcome_verified_us: string; run_completed_us: string; outcome_completed_us: string;
    }>(
      `SELECT to_char(capture.sealed_at, 'YYYY-MM-DD HH24:MI:SS.US') AS capture_us,
              to_char(outcome.captured_at, 'YYYY-MM-DD HH24:MI:SS.US') AS outcome_capture_us,
              to_char(publication.verified_at, 'YYYY-MM-DD HH24:MI:SS.US') AS publication_verified_us,
              to_char(outcome.verified_good_at, 'YYYY-MM-DD HH24:MI:SS.US') AS outcome_verified_us,
              to_char(run.completed_at, 'YYYY-MM-DD HH24:MI:SS.US') AS run_completed_us,
              to_char(outcome.completed_at, 'YYYY-MM-DD HH24:MI:SS.US') AS outcome_completed_us
         FROM backup_runs AS run
         JOIN backup_captures AS capture ON capture.backup_run_id = run.id
         JOIN backup_publications AS publication ON publication.backup_run_id = run.id
         JOIN backup_execution_outcomes AS outcome ON outcome.backup_run_id = run.id
        WHERE run.id = $1`,
      [attempt.runId]
    );
    expect(precision.rows[0].capture_us.endsWith('123456')).toBe(true);
    expect(precision.rows[0].outcome_capture_us).toBe(precision.rows[0].capture_us);
    expect(precision.rows[0].outcome_verified_us).toBe(precision.rows[0].publication_verified_us);
    expect(precision.rows[0].outcome_completed_us).toBe(precision.rows[0].run_completed_us);
    await expect(projectTerminalBackupExecutionOutcomes({ siteKey: attempt.siteKey,
      repositoryId: attempt.repositoryId, pool })).resolves.toMatchObject({ exactReplays: 1 });
  });

  it('tolerates preexisting non-eligible site-backup terminal projections without promoting them', async () => {
    const failedRunId = randomUUID();
    const cancelledRunId = randomUUID();
    const legacyRunId = randomUUID();
    const historicalRepository = randomUUID();
    await pool.query(
      `INSERT INTO backup_runs
         (id, trigger_type, status, stage, repository_kind, coordination_key,
          repository_id, completed_at, captured_at, manifest_sha256, error_code, error_message)
       VALUES
         ($1, 'AUTOMATIC', 'FAILED', 'FAILED', 'LOCAL_FILESYSTEM', 'site-backup',
          $4, clock_timestamp(), NULL, NULL, 'BACKUP_TEST_FAILURE', 'terminal fixture'),
         ($2, 'AUTOMATIC', 'CANCELLED', 'CANCELLED', 'LOCAL_FILESYSTEM', 'site-backup',
          NULL, clock_timestamp(), NULL, NULL, 'BACKUP_CANCELLED', 'terminal fixture'),
         ($3, 'AUTOMATIC', 'COMPLETED', 'COMPLETED', 'LOCAL_FILESYSTEM', 'site-backup',
          $4, clock_timestamp(), clock_timestamp() - interval '60 days', $5, NULL, NULL)`,
      [failedRunId, cancelledRunId, legacyRunId, historicalRepository, 'c'.repeat(64)]
    );
    await pool.query(
      `INSERT INTO backup_execution_outcomes
         (backup_run_id, site_key, repository_id, outcome, completed_at,
          captured_at, verification_provenance, manifest_sha256)
       SELECT id, 'site-backup', repository_id,
              CASE WHEN status = 'COMPLETED' THEN 'SUCCEEDED' ELSE status END,
              completed_at, captured_at,
              CASE WHEN status = 'COMPLETED' THEN 'LEGACY_UNVERIFIED' ELSE 'NONE' END,
              CASE WHEN status = 'COMPLETED' THEN manifest_sha256 ELSE NULL END
         FROM backup_runs WHERE id = ANY($1::uuid[])`,
      [[failedRunId, cancelledRunId, legacyRunId]]
    );
    await pool.query(`INSERT INTO backup_artifact_lifecycles (backup_run_id, state)
      SELECT unnest($1::uuid[]), 'UNCERTAIN'`, [[failedRunId, cancelledRunId, legacyRunId]]);
    await expect(projectTerminalBackupExecutionOutcomes({ siteKey: `current-${randomUUID()}`,
      repositoryId: randomUUID(), pool })).resolves.toBeTruthy();
    const retained = await pool.query<{ backup_run_id: string; site_key: string; repository_id: string | null; state: string; verification_provenance: string }>(
      `SELECT outcome.backup_run_id, outcome.site_key, outcome.repository_id, outcome.verification_provenance, lifecycle.state
         FROM backup_execution_outcomes AS outcome
         JOIN backup_artifact_lifecycles AS lifecycle USING (backup_run_id)
        WHERE outcome.backup_run_id = ANY($1::uuid[])
        ORDER BY outcome.backup_run_id`, [[failedRunId, cancelledRunId, legacyRunId]]);
    expect(retained.rows).toHaveLength(3);
    expect(retained.rows).toEqual(expect.arrayContaining([
      { backup_run_id: failedRunId, site_key: 'site-backup', repository_id: historicalRepository, state: 'UNCERTAIN', verification_provenance: 'NONE' },
      { backup_run_id: cancelledRunId, site_key: 'site-backup', repository_id: null, state: 'UNCERTAIN', verification_provenance: 'NONE' },
      { backup_run_id: legacyRunId, site_key: 'site-backup', repository_id: historicalRepository, state: 'UNCERTAIN', verification_provenance: 'LEGACY_UNVERIFIED' },
    ]));
  });

  it('reconciles a pre-deadline rename after its worker lease expires', async () => {
    const attempt = await sealedAttempt();
    const publication = await publish(attempt);
    await pool.query(
      `UPDATE backup_runs SET lease_expires_at = clock_timestamp() - interval '1 second'
       WHERE id = $1`,
      [attempt.runId]
    );

    await expect(reconcileVerifiedBackupPublication({
      publicationId: publication.id,
      ...attempt,
      repositoryManifest: { version: 1, site: { id: attempt.siteKey } },
      pool,
    })).resolves.toBe(true);
  });

  it('never adopts a published directory after another attempt takes authority', async () => {
    const attempt = await sealedAttempt();
    const publication = await publish(attempt);
    await pool.query(
      `UPDATE backup_runs SET attempt_id = $2,
          lease_expires_at = clock_timestamp() + interval '2 minutes'
       WHERE id = $1`,
      [attempt.runId, randomUUID()]
    );

    await expect(reconcileVerifiedBackupPublication({
      publicationId: publication.id,
      ...attempt,
      repositoryManifest: { version: 1 },
      pool,
    })).rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_STALE_ATTEMPT' });
  });

  it('rechecks the lease clock after waiting for the authority row lock', async () => {
    const attempt = await sealedAttempt();
    await pool.query(
      `UPDATE backup_runs
          SET lease_expires_at = clock_timestamp() + interval '300 milliseconds'
        WHERE id = $1`,
      [attempt.runId]
    );
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [attempt.runId]);
      const preparing = prepareBackupPublication({
        ...attempt,
        incompleteRelativePath: `incomplete/${attempt.runId}.${attempt.attemptId}`,
        publishedRelativePath: `runs/${attempt.runId}`,
        pool,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await blocker.query('COMMIT');
      await expect(preparing).rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_AUTHORITY_EXPIRED' });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });

  it('rechecks the lease clock after completion waits for the authority row lock', async () => {
    const attempt = await sealedAttempt();
    const publication = await publish(attempt);
    await pool.query(
      `UPDATE backup_runs
          SET lease_expires_at = clock_timestamp() + interval '300 milliseconds'
        WHERE id = $1`,
      [attempt.runId]
    );
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM backup_runs WHERE id = $1 FOR UPDATE', [attempt.runId]);
      const completing = completeVerifiedBackupPublication({
        publicationId: publication.id,
        ...attempt,
        repositoryManifest: { version: 1 },
        pool,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await blocker.query('COMMIT');
      await expect(completing).rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_AUTHORITY_EXPIRED' });
    } finally {
      await blocker.query('ROLLBACK').catch(() => undefined);
      blocker.release();
    }
  });
});
