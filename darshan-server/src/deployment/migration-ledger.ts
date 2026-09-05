import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient, QueryResultRow } from 'pg';
import {
  BoundedAdvisoryLockError,
  acquireSessionAdvisoryLock,
  releaseSessionAdvisoryLock,
  type BoundedAdvisoryLockOptions,
} from './bounded-advisory-lock';

const LEDGER_TABLE = 'darshan_schema_migrations';
const DRIZZLE_TABLE = '__drizzle_migrations';
const LOCK_NAME = 'darshan:production-migration-ledger';
const IDENTIFIER_PATTERN = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;
const BASELINE_METADATA_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MINIMUM_POSTGRES_VERSION_NUM = 150000;
const FIRST_POST_BASELINE_MIGRATION_SEQUENCE = 35;

export type MigrationManifestEntry = {
  id: string;
  checksum: string;
  sql: string;
};

type LedgerEntry = {
  migration_id: string;
  checksum_sha256: string;
  release_id: string;
  applied_method: 'APPLIED' | 'ADOPTED' | 'BASELINED';
  approval_ticket: string | null;
  applied_at: Date;
};

export type MigrationPlan = {
  manifestFingerprint: string;
  databaseFingerprint: string;
  applied: Array<Pick<LedgerEntry, 'migration_id' | 'checksum_sha256' | 'release_id' | 'applied_method' | 'approval_ticket' | 'applied_at'>>;
  pending: string[];
  unmanagedObjects: string[];
  adoptionRequired: boolean;
  ledgerPresent: boolean;
};

type ProductionBaseline = {
  id: string;
  sql: string;
  checksum: string;
  migrationIds: string[];
  legacyAdoptionCutoff: string;
};

export class MigrationLedgerError extends Error {
  constructor(
    public readonly code:
      | 'MIGRATION_MANIFEST_INVALID'
      | 'MIGRATION_LEDGER_MISMATCH'
      | 'MIGRATION_ADOPTION_REQUIRED'
      | 'MIGRATION_ADOPTION_REJECTED'
      | 'MIGRATION_RELEASE_REQUIRED'
      | 'MIGRATION_BASELINE_INVALID'
      | 'MIGRATION_LOCK_TIMEOUT',
    message: string
  ) {
    super(message);
    this.name = 'MigrationLedgerError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateReleaseId(value: string): string {
  const releaseId = value.trim();
  if (!RELEASE_PATTERN.test(releaseId)) {
    throw new MigrationLedgerError(
      'MIGRATION_RELEASE_REQUIRED',
      'A release identifier of up to 128 letters, numbers, dots, underscores, or hyphens is required.'
    );
  }
  return releaseId;
}

function validateTicket(value: string): string {
  const ticket = value.trim();
  if (!ticket || ticket.length > 128 || /[\r\n\0]/.test(ticket)) {
    throw new MigrationLedgerError('MIGRATION_ADOPTION_REJECTED', 'A single-line approval ticket of at most 128 characters is required.');
  }
  return ticket;
}

function validateNoDuplicateFutureMigrationSequences(names: string[]): void {
  const seen = new Map<number, string>();
  for (const name of names) {
    const sequence = Number(name.slice(0, 4));
    if (sequence < FIRST_POST_BASELINE_MIGRATION_SEQUENCE) continue;
    const existing = seen.get(sequence);
    if (existing) {
      throw new MigrationLedgerError(
        'MIGRATION_MANIFEST_INVALID',
        `Duplicate future migration sequence ${String(sequence).padStart(4, '0')} in ${existing} and ${name}.`
      );
    }
    seen.set(sequence, name);
  }
}

export async function loadMigrationManifest(
  migrationsDirectory = path.resolve(process.cwd(), 'drizzle', 'migrations')
): Promise<MigrationManifestEntry[]> {
  const files = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (names.length === 0) {
    throw new MigrationLedgerError('MIGRATION_MANIFEST_INVALID', `No SQL migrations exist in ${migrationsDirectory}.`);
  }
  if (names.some((name) => !IDENTIFIER_PATTERN.test(name))) {
    throw new MigrationLedgerError('MIGRATION_MANIFEST_INVALID', 'Migration file names must use the NNNN_descriptive-name.sql format.');
  }
  validateNoDuplicateFutureMigrationSequences(names);

  return Promise.all(
    names.map(async (id) => {
      const sql = await readFile(path.join(migrationsDirectory, id), 'utf8');
      if (!sql.trim()) throw new MigrationLedgerError('MIGRATION_MANIFEST_INVALID', `Migration ${id} is empty.`);
      return { id, sql, checksum: sha256(sql) };
    })
  );
}

export function manifestFingerprint(manifest: MigrationManifestEntry[]): string {
  return sha256(manifest.map((entry) => `${entry.id}:${entry.checksum}`).join('\n'));
}

/**
 * A baseline is a versioned, source-derived schema snapshot for a fresh
 * production database. Historical SQL before its cutoff was not a complete
 * fresh-install contract, so it is recorded in the ledger rather than replayed
 * on a new system. Subsequent migrations still run normally.
 */
export async function loadProductionBaseline(
  baselinesDirectory = path.resolve(process.cwd(), 'drizzle', 'baselines'),
  manifest?: MigrationManifestEntry[]
): Promise<ProductionBaseline> {
  let files;
  try {
    files = await readdir(baselinesDirectory, { withFileTypes: true });
  } catch (error) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Unable to read production baselines in ${baselinesDirectory}: ${String(error)}`);
  }
  const metadataFiles = files
    .filter((entry) => entry.isFile() && BASELINE_METADATA_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const metadataFile = metadataFiles.at(-1);
  if (!metadataFile) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `No production baseline metadata exists in ${baselinesDirectory}.`);
  }
  let raw: {
    id?: unknown; sqlFile?: unknown; sqlSha256?: unknown; migrationFingerprint?: unknown;
    migrationIds?: unknown; legacyAdoptionCutoff?: unknown;
  };
  try {
    raw = JSON.parse(await readFile(path.join(baselinesDirectory, metadataFile), 'utf8'));
  } catch (error) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Unable to parse baseline metadata ${metadataFile}: ${String(error)}`);
  }
  if (
    typeof raw.id !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.id) ||
    typeof raw.sqlFile !== 'string' ||
    !/^[A-Za-z0-9._-]+\.sql$/.test(raw.sqlFile) ||
    typeof raw.sqlSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.sqlSha256) ||
    typeof raw.migrationFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.migrationFingerprint) ||
    !Array.isArray(raw.migrationIds) ||
    raw.migrationIds.some((id) => typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)) ||
    typeof raw.legacyAdoptionCutoff !== 'string' ||
    !IDENTIFIER_PATTERN.test(raw.legacyAdoptionCutoff)
  ) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline metadata ${metadataFile} has an invalid shape.`);
  }
  if (new Set(raw.migrationIds).size !== raw.migrationIds.length || raw.migrationIds.length === 0) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline metadata ${metadataFile} contains duplicate or empty migration IDs.`);
  }
  if (!raw.migrationIds.includes(raw.legacyAdoptionCutoff)) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline metadata ${metadataFile} has an invalid legacy adoption cutoff.`);
  }
  const sql = await readFile(path.join(baselinesDirectory, raw.sqlFile), 'utf8');
  if (!sql.trim() || sha256(sql) !== raw.sqlSha256) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline SQL checksum does not match ${metadataFile}.`);
  }
  if (manifest) {
    const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));
    const baselineEntries = raw.migrationIds.map((id) => manifestById.get(id));
    if (baselineEntries.some((entry) => !entry)) {
      throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline ${raw.id} references a migration absent from this release.`);
    }
    if (manifestFingerprint(baselineEntries as MigrationManifestEntry[]) !== raw.migrationFingerprint) {
      throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline ${raw.id} no longer matches the checksummed migration history.`);
    }
  }
  return {
    id: raw.id,
    sql,
    checksum: raw.sqlSha256,
    migrationIds: raw.migrationIds,
    legacyAdoptionCutoff: raw.legacyAdoptionCutoff,
  };
}

async function ensureLedger(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${LEDGER_TABLE}" (
      "migration_id" varchar(255) PRIMARY KEY NOT NULL,
      "checksum_sha256" varchar(64) NOT NULL,
      "release_id" varchar(128) NOT NULL,
      "applied_method" varchar(16) NOT NULL DEFAULT 'APPLIED',
      "approval_ticket" varchar(128),
      "execution_state" varchar(16) NOT NULL DEFAULT 'SUCCEEDED',
      "duration_ms" integer NOT NULL DEFAULT 0,
      "applied_at" timestamp NOT NULL DEFAULT now()
    )
  `);
}

async function ledgerExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT to_regclass(format('%I.%I', current_schema(), $1::text)) IS NOT NULL AS exists`,
    [LEDGER_TABLE]
  );
  return result.rows[0]?.exists === true;
}

async function requireSupportedPostgresVersion(client: PoolClient): Promise<void> {
  const result = await client.query<{ server_version_num: string }>('SHOW server_version_num');
  const version = Number(result.rows[0]?.server_version_num);
  if (!Number.isSafeInteger(version) || version < MINIMUM_POSTGRES_VERSION_NUM) {
    throw new MigrationLedgerError(
      'MIGRATION_MANIFEST_INVALID',
      `PostgreSQL ${MINIMUM_POSTGRES_VERSION_NUM / 10000} or later is required for this production migration runner.`
    );
  }
}

async function readLedger(client: PoolClient): Promise<LedgerEntry[]> {
  const result = await client.query<LedgerEntry>(`
    SELECT migration_id, checksum_sha256, release_id, applied_method, approval_ticket, applied_at
    FROM "${LEDGER_TABLE}"
    ORDER BY migration_id ASC
  `);
  return result.rows;
}

async function ledgerHasExecutionMetadata(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = 'execution_state'
    ) AS exists
  `, [LEDGER_TABLE]);
  return result.rows[0]?.exists === true;
}

async function recordMigration(
  client: PoolClient,
  input: { id: string; checksum: string; releaseId: string; method: 'APPLIED' | 'ADOPTED'; ticket?: string; durationMs: number }
): Promise<void> {
  if (await ledgerHasExecutionMetadata(client)) {
    await client.query(
      `INSERT INTO "${LEDGER_TABLE}" (migration_id, checksum_sha256, release_id, applied_method, approval_ticket, execution_state, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.id, input.checksum, input.releaseId, input.method, input.ticket ?? null,
        input.method === 'ADOPTED' ? 'ADOPTED' : 'SUCCEEDED', input.durationMs]
    );
    return;
  }
  await client.query(
    `INSERT INTO "${LEDGER_TABLE}" (migration_id, checksum_sha256, release_id, applied_method, approval_ticket) VALUES ($1, $2, $3, $4, $5)`,
    [input.id, input.checksum, input.releaseId, input.method, input.ticket ?? null]
  );
}

async function listUnmanagedObjects(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN ($1, $2)
    ORDER BY table_name ASC
  `, [LEDGER_TABLE, DRIZZLE_TABLE]);
  return result.rows.map((row) => row.table_name);
}

async function databaseFingerprint(client: PoolClient): Promise<string> {
  // A PoolClient represents one connection. Keep these probes sequential so
  // the runner stays compatible with pg clients that reject concurrent work on
  // a pinned connection.
  const columns = await client.query<QueryResultRow>(`
      SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name NOT IN ($1, $2)
      ORDER BY table_name, ordinal_position
    `, [LEDGER_TABLE, DRIZZLE_TABLE]);
  const constraints = await client.query<QueryResultRow>(`
      SELECT rel.relname AS table_name, con.conname AS constraint_name, pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      INNER JOIN pg_class rel ON rel.oid = con.conrelid
      INNER JOIN pg_namespace ns ON ns.oid = rel.relnamespace
      WHERE ns.nspname = current_schema()
        AND rel.relname NOT IN ($1, $2)
      ORDER BY rel.relname, con.conname
    `, [LEDGER_TABLE, DRIZZLE_TABLE]);
  const indexes = await client.query<QueryResultRow>(`
      SELECT tablename AS table_name, indexname AS index_name, indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename NOT IN ($1, $2)
      ORDER BY tablename, indexname
    `, [LEDGER_TABLE, DRIZZLE_TABLE]);
  return sha256(JSON.stringify({ columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows }));
}

/**
 * Adoption is intentionally narrower than a fresh install. A production site
 * may predate the ledger, but it must still prove the minimum schema/data
 * invariants before this runner can reconcile the only historical migration
 * whose rollout included mandatory data backfill (display authority).
 */
async function verifyLegacyAdoptionInvariants(client: PoolClient): Promise<void> {
  const tables = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('users', 'roles', 'screens')
    ORDER BY table_name
  `);
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missing = ['users', 'roles', 'screens'].filter((table) => !found.has(table));
  if (missing.length > 0) {
    throw new MigrationLedgerError(
      'MIGRATION_ADOPTION_REJECTED',
      `Legacy adoption requires the established application schema; missing table(s): ${missing.join(', ')}.`
    );
  }

  const duplicateUsers = await client.query<{ normalized_email: string }>(`
    SELECT lower(btrim(email)) AS normalized_email
    FROM users
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
    LIMIT 1
  `);
  if (duplicateUsers.rows[0]?.normalized_email) {
    throw new MigrationLedgerError(
      'MIGRATION_ADOPTION_REJECTED',
      'Legacy adoption found case-insensitive duplicate user email addresses; resolve them before any mutation.'
    );
  }

  const duplicateRoles = await client.query<{ normalized_name: string }>(`
    SELECT upper(btrim(name)) AS normalized_name
    FROM roles
    GROUP BY upper(btrim(name))
    HAVING count(*) > 1
    LIMIT 1
  `);
  if (duplicateRoles.rows[0]?.normalized_name) {
    throw new MigrationLedgerError(
      'MIGRATION_ADOPTION_REJECTED',
      'Legacy adoption found duplicate role names after normalization; resolve them before any mutation.'
    );
  }
}

function validateLedger(manifest: MigrationManifestEntry[], ledger: LedgerEntry[]): void {
  const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));
  for (const entry of ledger) {
    const local = manifestById.get(entry.migration_id);
    if (!local) {
      throw new MigrationLedgerError(
        'MIGRATION_LEDGER_MISMATCH',
        `Database records ${entry.migration_id}, which is absent from this release's migration manifest.`
      );
    }
    if (local.checksum !== entry.checksum_sha256) {
      throw new MigrationLedgerError(
        'MIGRATION_LEDGER_MISMATCH',
        `Checksum mismatch for ${entry.migration_id}; migration history may have been rewritten or the wrong release is being deployed.`
      );
    }
  }

  const manifestIndex = new Map(manifest.map((entry, index) => [entry.id, index]));
  for (const [index, entry] of ledger.entries()) {
    if (manifestIndex.get(entry.migration_id) !== index) {
      throw new MigrationLedgerError(
        'MIGRATION_LEDGER_MISMATCH',
        'Migration ledger is not a contiguous prefix of the reviewed manifest; applying out of order is forbidden.'
      );
    }
  }
}

async function buildPlan(
  client: PoolClient,
  manifest: MigrationManifestEntry[],
  options: { createLedger?: boolean } = {}
): Promise<MigrationPlan> {
  let hasLedger = await ledgerExists(client);
  if (!hasLedger && options.createLedger) {
    await ensureLedger(client);
    hasLedger = true;
  }
  const ledger = hasLedger ? await readLedger(client) : [];
  validateLedger(manifest, ledger);
  const appliedIds = new Set(ledger.map((entry) => entry.migration_id));
  const unmanagedObjects = ledger.length === 0 ? await listUnmanagedObjects(client) : [];
  return {
    manifestFingerprint: manifestFingerprint(manifest),
    databaseFingerprint: await databaseFingerprint(client),
    applied: ledger,
    pending: manifest.filter((entry) => !appliedIds.has(entry.id)).map((entry) => entry.id),
    unmanagedObjects,
    adoptionRequired: ledger.length === 0 && unmanagedObjects.length > 0,
    ledgerPresent: hasLedger,
  };
}

export async function planDatabaseMigrations(client: PoolClient, manifest: MigrationManifestEntry[]): Promise<MigrationPlan> {
  return buildPlan(client, manifest);
}

export async function applyDatabaseMigrations(
  client: PoolClient,
  manifest: MigrationManifestEntry[],
  releaseIdInput: string,
  lockOptions: BoundedAdvisoryLockOptions = {}
): Promise<MigrationPlan> {
  const releaseId = validateReleaseId(releaseIdInput);
  await requireSupportedPostgresVersion(client);
  await client.query("SET lock_timeout = '30s'");
  try {
    try {
      await acquireSessionAdvisoryLock(client, LOCK_NAME, lockOptions);
    } catch (error) {
      if (error instanceof BoundedAdvisoryLockError) {
        throw new MigrationLedgerError('MIGRATION_LOCK_TIMEOUT', error.message);
      }
      throw error;
    }
    let plan = await buildPlan(client, manifest);
    if (plan.adoptionRequired) {
      throw new MigrationLedgerError(
        'MIGRATION_ADOPTION_REQUIRED',
        `Database contains untracked application objects (${plan.unmanagedObjects.join(', ')}). Run migration:plan, review it, then use the explicit adoption workflow.`
      );
    }
    if (!plan.ledgerPresent) {
      const baseline = await loadProductionBaseline(undefined, manifest);
      const schemaResult = await client.query<{ schema_name: string }>('SELECT current_schema() AS schema_name');
      if (schemaResult.rows[0]?.schema_name !== 'public') {
        throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', 'The production baseline can only be applied to the public schema.');
      }
      await client.query('BEGIN');
      try {
        await client.query(baseline.sql);
        // pg_dump deliberately clears search_path. Restore the supported
        // production schema before checking the ledger or running later
        // incremental migrations on this same connection.
        await client.query('SET search_path TO public');
        if (!(await ledgerExists(client))) {
          throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Baseline ${baseline.id} did not create the migration ledger.`);
        }
        const manifestById = new Map(manifest.map((entry) => [entry.id, entry]));
        for (const id of baseline.migrationIds) {
          const migration = manifestById.get(id)!;
          await client.query(
            `INSERT INTO "${LEDGER_TABLE}" (migration_id, checksum_sha256, release_id, applied_method) VALUES ($1, $2, $3, 'BASELINED')`,
            [migration.id, migration.checksum, releaseId]
          );
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
      plan = await buildPlan(client, manifest);
    }
    const pending = new Map(manifest.map((entry) => [entry.id, entry]));
    for (const id of plan.pending) {
      const migration = pending.get(id)!;
      await client.query('BEGIN');
      try {
        const migrationStartedAt = Date.now();
        await client.query(migration.sql);
        await recordMigration(client, {
          id: migration.id,
          checksum: migration.checksum,
          releaseId,
          method: 'APPLIED',
          durationMs: Date.now() - migrationStartedAt,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    }
    return buildPlan(client, manifest);
  } finally {
    await releaseSessionAdvisoryLock(client, LOCK_NAME).catch(() => {});
    await client.query('RESET lock_timeout').catch(() => {});
  }
}

/**
 * Register a reviewed legacy database without changing its schema. The caller
 * must provide fingerprints from a freshly reviewed plan so adoption cannot
 * race a schema change or silently accept a different release manifest.
 */
export async function adoptDatabaseMigrations(
  client: PoolClient,
  manifest: MigrationManifestEntry[],
  input: { releaseId: string; ticket: string; manifestFingerprint: string; databaseFingerprint: string },
  lockOptions: BoundedAdvisoryLockOptions = {}
): Promise<MigrationPlan> {
  const releaseId = validateReleaseId(input.releaseId);
  const ticket = validateTicket(input.ticket);
  await requireSupportedPostgresVersion(client);
  await client.query("SET lock_timeout = '30s'");
  try {
    try {
      await acquireSessionAdvisoryLock(client, LOCK_NAME, lockOptions);
    } catch (error) {
      if (error instanceof BoundedAdvisoryLockError) {
        throw new MigrationLedgerError('MIGRATION_LOCK_TIMEOUT', error.message);
      }
      throw error;
    }
    const plan = await buildPlan(client, manifest);
    if (!plan.adoptionRequired) {
      throw new MigrationLedgerError('MIGRATION_ADOPTION_REJECTED', 'Adoption is allowed only for a non-empty database with no migration ledger.');
    }
    if (plan.manifestFingerprint !== input.manifestFingerprint || plan.databaseFingerprint !== input.databaseFingerprint) {
      throw new MigrationLedgerError(
        'MIGRATION_ADOPTION_REJECTED',
        'Manifest or database fingerprint changed since the reviewed plan; generate and review a new migration plan.'
      );
    }
    const baseline = await loadProductionBaseline(undefined, manifest);
    const cutoffIndex = baseline.migrationIds.indexOf(baseline.legacyAdoptionCutoff);
    const legacyMigrationIds = baseline.migrationIds.slice(0, cutoffIndex + 1);
    const displayAuthorityMigration = manifest.find((migration) => migration.id === '0034_display_authority.sql');
    if (!displayAuthorityMigration) {
      throw new MigrationLedgerError('MIGRATION_MANIFEST_INVALID', 'The required display-authority reconciliation migration is absent.');
    }
    await verifyLegacyAdoptionInvariants(client);
    await client.query('BEGIN');
    try {
      // This migration is idempotent and backfills a state row for every
      // existing screen. It must run before 0034 is recorded as adopted.
      await client.query(displayAuthorityMigration.sql);
      await ensureLedger(client);
      const manifestById = new Map(manifest.map((migration) => [migration.id, migration]));
      for (const migrationId of legacyMigrationIds) {
        const migration = manifestById.get(migrationId)!;
        await recordMigration(client, {
          id: migration.id,
          checksum: migration.checksum,
          releaseId,
          method: 'ADOPTED',
          ticket,
          durationMs: 0,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
    return buildPlan(client, manifest);
  } finally {
    await releaseSessionAdvisoryLock(client, LOCK_NAME).catch(() => {});
    await client.query('RESET lock_timeout').catch(() => {});
  }
}
