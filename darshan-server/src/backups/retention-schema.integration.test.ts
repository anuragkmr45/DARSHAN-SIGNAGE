import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URL = process.env.DATABASE_URL!;

describe('0052/0053 retention migration PostgreSQL integration', () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;
  let schemaCreated = false;

  beforeAll(async () => {
    expect(new URL(TEST_URL).pathname).toMatch(/_test$/);
    schemaName = `retention_0052_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: TEST_URL });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${schemaName}` });
  });

  afterAll(async () => {
    await pool?.end();
    if (adminPool && schemaName && schemaCreated) await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool?.end();
  });

  it('applies constraints and conservatively backfills verified, legacy, and failed runs', async () => {
    await pool.query(`
      CREATE TABLE backup_runs (
        id uuid PRIMARY KEY, coordination_key varchar(100) NOT NULL,
        attempt_id uuid,
        repository_id uuid, repository_kind varchar(32) NOT NULL,
        manifest_sha256 varchar(64), status varchar(20) NOT NULL,
        completed_at timestamptz, captured_at timestamptz, verified_at timestamptz,
        repository_manifest jsonb,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
      );
      CREATE TABLE backup_publications (
        id uuid PRIMARY KEY, backup_run_id uuid NOT NULL REFERENCES backup_runs(id),
        backup_attempt_id uuid NOT NULL,
        repository_id uuid NOT NULL, manifest_sha256 varchar(64) NOT NULL,
        status varchar(20) NOT NULL, verified_at timestamptz
      );
    `);
    const verifiedRun = randomUUID();
    const legacyRun = randomUUID();
    const failedRun = randomUUID();
    const repositoryId = randomUUID();
    const publicationId = randomUUID();
    const attemptId = randomUUID();
    const digest = 'a'.repeat(64);
    await pool.query(
      `INSERT INTO backup_runs
        (id, coordination_key, attempt_id, repository_id, repository_kind, manifest_sha256, status,
         completed_at, captured_at, verified_at, repository_manifest, created_at, updated_at)
       VALUES
        ($1, 'site-backup', $6, $4, 'LOCAL_FILESYSTEM', $5, 'COMPLETED', now() - interval '40 days', now() - interval '40 days' + interval '0.123456 seconds', now() - interval '40 days', '{"site":{"id":"site-a"}}', now(), now()),
        ($2, 'site-backup', NULL, $7, 'LOCAL_FILESYSTEM', NULL, 'COMPLETED', now() - interval '50 days', now() - interval '50 days', now() - interval '50 days', NULL, now(), now()),
        ($3, 'site-backup', NULL, $7, 'LOCAL_FILESYSTEM', NULL, 'FAILED', now() - interval '2 days', NULL, NULL, NULL, now(), now())`,
      [verifiedRun, legacyRun, failedRun, repositoryId, digest, attemptId, randomUUID()]
    );
    await pool.query(
      `INSERT INTO backup_publications
        (id, backup_run_id, backup_attempt_id, repository_id, manifest_sha256, status, verified_at)
       VALUES ($1, $2, $3, $4, $5, 'VERIFIED', now() - interval '40 days')`,
      [publicationId, verifiedRun, attemptId, repositoryId, digest]
    );

    const migration = readFileSync(
      new URL('../../drizzle/migrations/0052_backup_retention_foundation.sql', import.meta.url),
      'utf8'
    );
    await pool.query(migration);
    // Emulate rows produced by the original 0052 deployment before 0053
    // repaired coordination_key-as-site adoption.
    await pool.query(`DROP TRIGGER backup_execution_outcomes_immutable_trigger ON backup_execution_outcomes`);
    await pool.query(`UPDATE backup_execution_outcomes SET site_key = 'site-backup' WHERE backup_run_id = $1`, [verifiedRun]);
    await pool.query(`CREATE TRIGGER backup_execution_outcomes_immutable_trigger
      BEFORE UPDATE OR DELETE ON backup_execution_outcomes
      FOR EACH ROW EXECUTE FUNCTION backup_execution_outcomes_immutable()`);
    const runtimeMigration = readFileSync(
      new URL('../../drizzle/migrations/0053_backup_retention_runtime.sql', import.meta.url),
      'utf8'
    );
    await pool.query(runtimeMigration);

    const outcomes = await pool.query<{
      backup_run_id: string; site_key: string; repository_id: string | null; outcome: string;
      verification_provenance: string; publication_id: string | null;
    }>('SELECT backup_run_id, site_key, repository_id, outcome, verification_provenance, publication_id FROM backup_execution_outcomes ORDER BY backup_run_id');
    expect(outcomes.rows.find((row) => row.backup_run_id === verifiedRun)).toMatchObject({
      outcome: 'SUCCEEDED', verification_provenance: 'PUBLICATION_READ_BACK', publication_id: publicationId,
      site_key: 'site-a', repository_id: repositoryId,
    });
    expect(outcomes.rows.find((row) => row.backup_run_id === legacyRun)).toMatchObject({
      outcome: 'SUCCEEDED', verification_provenance: 'LEGACY_UNVERIFIED', publication_id: null,
      site_key: 'site-backup',
    });
    expect(outcomes.rows.find((row) => row.backup_run_id === failedRun)).toMatchObject({
      outcome: 'FAILED', verification_provenance: 'NONE', publication_id: null,
      site_key: 'site-backup',
    });

    const lifecycles = await pool.query<{ backup_run_id: string; state: string }>(
      'SELECT backup_run_id, state FROM backup_artifact_lifecycles ORDER BY backup_run_id'
    );
    expect(lifecycles.rows).toHaveLength(2);
    expect(lifecycles.rows.find((row) => row.backup_run_id === verifiedRun)?.state).toBe('AVAILABLE');
    expect(lifecycles.rows.find((row) => row.backup_run_id === legacyRun)?.state).toBe('UNCERTAIN');

    const ownerColumn = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'backup_retention_operations' AND column_name = 'owner_token'
       ) AS exists`
    );
    expect(ownerColumn.rows[0].exists).toBe(true);

    const restoreOperationId = randomUUID();
    const ownerToken = randomUUID();
    await pool.query(
      `INSERT INTO backup_restore_hold_projections
        (backup_run_id, restore_operation_id, site_key, repository_id, manifest_sha256,
         capture_generation, owner_token)
       VALUES ($1, $2, 'site-a', $3, $4, 1, $5)`,
      [verifiedRun, restoreOperationId, repositoryId, digest, ownerToken]
    );
    await expect(pool.query(
      `INSERT INTO backup_restore_hold_projections
        (backup_run_id, restore_operation_id, site_key, repository_id, manifest_sha256,
         capture_generation, owner_token)
       VALUES ($1, $2, 'wrong-site', $3, $4, 1, $5)`,
      [verifiedRun, randomUUID(), repositoryId, digest, randomUUID()]
    )).rejects.toMatchObject({ constraint: 'backup_restore_hold_projections_identity_fk' });

    await expect(pool.query(
      `UPDATE backup_execution_outcomes SET outcome = 'FAILED' WHERE backup_run_id = $1`,
      [verifiedRun]
    )).rejects.toThrow(/immutable/);
  });
});
