import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config as appConfig } from '@/config';
import {
  MigrationLedgerError,
  adoptDatabaseMigrations,
  applyDatabaseMigrations,
  loadMigrationManifest,
  loadProductionBaseline,
  planDatabaseMigrations,
  type MigrationManifestEntry,
} from './migration-ledger';

const suite = appConfig.NODE_ENV === 'production' ? describe.skip : describe;

suite('production migration ledger', () => {
  let adminPool: Pool;
  let scopedPool: Pool;
  let schemaName: string;

  beforeEach(async () => {
    schemaName = `migration_ledger_test_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: appConfig.DATABASE_URL });
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    scopedPool = new Pool({ connectionString: appConfig.DATABASE_URL, options: `-c search_path=${schemaName}` });
  });

  afterEach(async () => {
    await scopedPool?.end();
    if (adminPool && schemaName) await adminPool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await adminPool?.end();
  });

  async function client(): Promise<PoolClient> {
    return scopedPool.connect();
  }

  async function createLegacyAdoptionPrerequisites(connection: PoolClient) {
    await connection.query(`
      CREATE TYPE command_type AS ENUM ('SET_ACTIVE_DISPLAY');
      CREATE TABLE roles (id uuid PRIMARY KEY, name varchar(64) NOT NULL);
      CREATE TABLE users (id uuid PRIMARY KEY, email varchar(255) NOT NULL);
      CREATE TABLE screens (id uuid PRIMARY KEY);
    `);
  }

  const minimalManifest: MigrationManifestEntry[] = [
    { id: '0000_test.sql', checksum: 'a'.repeat(64), sql: 'CREATE TABLE managed_table (id integer PRIMARY KEY);' },
  ];

  it('keeps planning read-only and requires a reviewed adoption for legacy objects', async () => {
    const connection = await client();
    try {
      await connection.query('CREATE TABLE legacy_table (id integer PRIMARY KEY)');
      const plan = await planDatabaseMigrations(connection, minimalManifest);
      expect(plan).toMatchObject({ adoptionRequired: true, pending: ['0000_test.sql'], unmanagedObjects: ['legacy_table'] });
      const ledger = await connection.query(`SELECT to_regclass(format('%I.%I', current_schema(), 'darshan_schema_migrations'::text)) AS name`);
      expect(ledger.rows[0].name).toBeNull();
    } finally {
      connection.release();
    }
  });

  it('adopts only an unchanged reviewed legacy database and records the approval metadata', async () => {
    const connection = await client();
    try {
      await connection.query('CREATE TABLE legacy_table (id integer PRIMARY KEY)');
      await createLegacyAdoptionPrerequisites(connection);
      await connection.query(`
        INSERT INTO screens (id) VALUES
          ('00000000-0000-0000-0000-000000000101'),
          ('00000000-0000-0000-0000-000000000102')
      `);
      const manifest = await loadMigrationManifest();
      const reviewed = await planDatabaseMigrations(connection, manifest);
      await expect(adoptDatabaseMigrations(connection, manifest, {
        releaseId: '2026.09.04-r1',
        ticket: 'CHG-500',
        manifestFingerprint: reviewed.manifestFingerprint,
        databaseFingerprint: 'not-the-reviewed-database',
      })).rejects.toMatchObject({ code: 'MIGRATION_ADOPTION_REJECTED' });

      const adopted = await adoptDatabaseMigrations(connection, manifest, {
        releaseId: '2026.09.04-r1',
        ticket: 'CHG-500',
        manifestFingerprint: reviewed.manifestFingerprint,
        databaseFingerprint: reviewed.databaseFingerprint,
      });
      expect(adopted).toMatchObject({ adoptionRequired: false, pending: [
        '0035_production_bootstrap_state.sql',
        '0036_schema_migration_ledger.sql',
        '0037_worker_runtime_heartbeat.sql',
        '0038_schema_migration_execution_metadata.sql',
        '0039_repair_chat_dm_tombstone_unique_index.sql',
        '0040_device_auth_rollout_observations.sql',
        '0041_off_host_backup_manifest.sql',
      ] });
      expect(adopted.applied).toHaveLength(36);
      expect(adopted.applied.at(-1)).toMatchObject({ migration_id: '0034_display_authority.sql', applied_method: 'ADOPTED', approval_ticket: 'CHG-500' });
      const displayStates = await connection.query<{ screen_id: string; placement: string }>(
        'SELECT screen_id, placement FROM screen_display_states ORDER BY screen_id'
      );
      expect(displayStates.rows).toEqual([
        { screen_id: '00000000-0000-0000-0000-000000000101', placement: 'LEGACY_UNVERIFIED' },
        { screen_id: '00000000-0000-0000-0000-000000000102', placement: 'LEGACY_UNVERIFIED' },
      ]);
      const timeout = await connection.query<{ lock_timeout: string }>('SHOW lock_timeout');
      expect(timeout.rows[0]?.lock_timeout).toBe('0');
    } finally {
      connection.release();
    }
  });

  it('rejects duplicate normalized identities before legacy adoption mutates display state', async () => {
    const connection = await client();
    try {
      await createLegacyAdoptionPrerequisites(connection);
      await connection.query(`
        INSERT INTO users (id, email) VALUES
          ('00000000-0000-0000-0000-000000000001', 'Admin@example.local'),
          ('00000000-0000-0000-0000-000000000002', ' admin@example.local ')
      `);
      const manifest = await loadMigrationManifest();
      const reviewed = await planDatabaseMigrations(connection, manifest);
      await expect(adoptDatabaseMigrations(connection, manifest, {
        releaseId: '2026.09.04-r1',
        ticket: 'CHG-501',
        manifestFingerprint: reviewed.manifestFingerprint,
        databaseFingerprint: reviewed.databaseFingerprint,
      })).rejects.toMatchObject({ code: 'MIGRATION_ADOPTION_REJECTED' });
      const displayState = await connection.query(`SELECT to_regclass('screen_display_states') AS name`);
      expect(displayState.rows[0]?.name).toBeNull();
    } finally {
      connection.release();
    }
  });

  it('rejects rewritten migration history', async () => {
    const connection = await client();
    try {
      await connection.query(`
        CREATE TABLE darshan_schema_migrations (
          migration_id varchar(255) PRIMARY KEY, checksum_sha256 varchar(64) NOT NULL,
          release_id varchar(128) NOT NULL, applied_method varchar(16) NOT NULL, approval_ticket varchar(128),
          applied_at timestamp NOT NULL DEFAULT now()
        )
      `);
      await connection.query(
        `INSERT INTO darshan_schema_migrations (migration_id, checksum_sha256, release_id, applied_method) VALUES ($1, $2, $3, 'APPLIED')`,
        ['0000_test.sql', 'b'.repeat(64), '2026.09.04-r1']
      );
      await expect(planDatabaseMigrations(connection, minimalManifest)).rejects.toBeInstanceOf(MigrationLedgerError);
      await expect(planDatabaseMigrations(connection, minimalManifest)).rejects.toMatchObject({ code: 'MIGRATION_LEDGER_MISMATCH' });
    } finally {
      connection.release();
    }
  });

  it('rejects a ledger with a gap instead of applying an older migration later', async () => {
    const connection = await client();
    try {
      await connection.query(`
        CREATE TABLE darshan_schema_migrations (
          migration_id varchar(255) PRIMARY KEY, checksum_sha256 varchar(64) NOT NULL,
          release_id varchar(128) NOT NULL, applied_method varchar(16) NOT NULL, approval_ticket varchar(128),
          applied_at timestamp NOT NULL DEFAULT now()
        )
      `);
      const manifest: MigrationManifestEntry[] = [
        { id: '0000_first.sql', checksum: 'a'.repeat(64), sql: 'SELECT 1;' },
        { id: '0001_second.sql', checksum: 'b'.repeat(64), sql: 'SELECT 1;' },
      ];
      await connection.query(
        `INSERT INTO darshan_schema_migrations (migration_id, checksum_sha256, release_id, applied_method) VALUES ($1, $2, $3, 'APPLIED')`,
        ['0001_second.sql', 'b'.repeat(64), '2026.09.04-r1']
      );
      await expect(planDatabaseMigrations(connection, manifest)).rejects.toMatchObject({ code: 'MIGRATION_LEDGER_MISMATCH' });
    } finally {
      connection.release();
    }
  });

  it('validates the source-derived baseline and rejects a modified artifact', async () => {
    const manifest = await loadMigrationManifest();
    const baseline = await loadProductionBaseline(undefined, manifest);
    expect(baseline.migrationIds.length).toBeLessThan(manifest.length);
    expect(manifest.some((migration) => migration.id === '0037_worker_runtime_heartbeat.sql')).toBe(true);
    await expect(loadProductionBaseline('/does-not-exist', manifest)).rejects.toMatchObject({ code: 'MIGRATION_BASELINE_INVALID' });
  });

  it('rejects duplicate post-baseline migration sequence numbers', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'darshan-duplicate-migrations-'));
    try {
      await writeFile(path.join(temporaryDirectory, '0035_first.sql'), 'SELECT 1;');
      await writeFile(path.join(temporaryDirectory, '0035_second.sql'), 'SELECT 2;');

      await expect(loadMigrationManifest(temporaryDirectory)).rejects.toMatchObject({
        code: 'MIGRATION_MANIFEST_INVALID',
        message: expect.stringContaining('Duplicate future migration sequence 0035'),
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('applies the production baseline once and is idempotent afterwards', async () => {
    const databaseName = `darshan_baseline_test_${randomUUID().replace(/-/g, '')}`;
    const databaseUrl = new URL(appConfig.DATABASE_URL);
    databaseUrl.pathname = `/${databaseName}`;
    databaseUrl.search = '';
    const databaseAdmin = new Pool({ connectionString: appConfig.DATABASE_URL });
    const databasePool = new Pool({ connectionString: databaseUrl.toString() });
    let connection: PoolClient | undefined;
    try {
      await databaseAdmin.query(`CREATE DATABASE "${databaseName}"`);
      connection = await databasePool.connect();
      const manifest = await loadMigrationManifest();
      const applied = await applyDatabaseMigrations(connection, manifest, '2026.09.04-r1');
      expect(applied).toMatchObject({ adoptionRequired: false, pending: [] });
      expect(applied.applied).toHaveLength(manifest.length);
      const tables = await connection.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual(expect.arrayContaining([
        'users', 'roles', 'screens', 'screen_display_states', 'production_bootstrap_states', 'darshan_schema_migrations',
      ]));
      const dmIndex = await connection.query<{ predicate: string | null }>(`
        SELECT pg_get_expr(indexes.indpred, indexes.indrelid) AS predicate
        FROM pg_index AS indexes
        WHERE indexes.indexrelid = 'chat_conversations_dm_pair_key_active_idx'::regclass
      `);
      expect(dmIndex.rows[0]?.predicate).toContain("state <> 'DELETED'");

      const rerun = await applyDatabaseMigrations(connection, manifest, '2026.09.04-r1');
      expect(rerun).toMatchObject({ pending: [] });
      expect(rerun.applied).toHaveLength(manifest.length);
      const timeout = await connection.query<{ lock_timeout: string }>('SHOW lock_timeout');
      expect(timeout.rows[0]?.lock_timeout).toBe('0');
    } finally {
      connection?.release();
      await databasePool.end();
      await databaseAdmin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await databaseAdmin.end();
    }
  }, 30_000);

  it('rolls back a failed migration without recording a false success', async () => {
    const connection = await client();
    try {
      await connection.query(`
        CREATE TABLE darshan_schema_migrations (
          migration_id varchar(255) PRIMARY KEY NOT NULL,
          checksum_sha256 varchar(64) NOT NULL,
          release_id varchar(128) NOT NULL,
          applied_method varchar(16) NOT NULL DEFAULT 'APPLIED',
          approval_ticket varchar(128),
          execution_state varchar(16) NOT NULL DEFAULT 'SUCCEEDED',
          duration_ms integer NOT NULL DEFAULT 0,
          applied_at timestamp NOT NULL DEFAULT now()
        )
      `);
      const manifest: MigrationManifestEntry[] = [
        { id: '0000_first.sql', checksum: 'a'.repeat(64), sql: 'CREATE TABLE first_success (id integer PRIMARY KEY);' },
        {
          id: '0001_second.sql',
          checksum: 'b'.repeat(64),
          sql: 'CREATE TABLE second_should_rollback (id integer PRIMARY KEY); SELECT * FROM missing_table;',
        },
      ];

      await expect(applyDatabaseMigrations(connection, manifest, '2026.09.04-r1')).rejects.toBeTruthy();

      const tables = await connection.query<{ first_exists: string | null; second_exists: string | null }>(`
        SELECT to_regclass('first_success')::text AS first_exists,
               to_regclass('second_should_rollback')::text AS second_exists
      `);
      expect(tables.rows[0]).toEqual({ first_exists: 'first_success', second_exists: null });
      const ledger = await connection.query<{ migration_id: string }>(
        'SELECT migration_id FROM darshan_schema_migrations ORDER BY migration_id'
      );
      expect(ledger.rows).toEqual([{ migration_id: '0000_first.sql' }]);
      const plan = await planDatabaseMigrations(connection, manifest);
      expect(plan.pending).toEqual(['0001_second.sql']);
    } finally {
      connection.release();
    }
  });

  it('fails fast instead of hanging when another migration process owns the advisory lock', async () => {
    const holder = await client();
    const blocked = await client();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtext($1))', ['darshan:production-migration-ledger']);

      await expect(applyDatabaseMigrations(
        blocked,
        minimalManifest,
        '2026.09.04-r1',
        { timeoutMs: 50, pollIntervalMs: 10 }
      )).rejects.toMatchObject({
        code: 'MIGRATION_LOCK_TIMEOUT',
      });

      const ledger = await blocked.query(`SELECT to_regclass(format('%I.%I', current_schema(), 'darshan_schema_migrations'::text)) AS name`);
      expect(ledger.rows[0].name).toBeNull();
      const timeout = await blocked.query<{ lock_timeout: string }>('SHOW lock_timeout');
      expect(timeout.rows[0]?.lock_timeout).toBe('0');
    } finally {
      await holder.query('SELECT pg_advisory_unlock(hashtext($1))', ['darshan:production-migration-ledger']).catch(() => {});
      holder.release();
      blocked.release();
    }
  });
});
