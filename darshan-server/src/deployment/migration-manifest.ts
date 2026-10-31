import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const IDENTIFIER_PATTERN = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;
const BASELINE_METADATA_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;
const FIRST_POST_BASELINE_MIGRATION_SEQUENCE = 35;

export type MigrationManifestEntry = {
  id: string;
  checksum: string;
  sql: string;
};

export type ProductionBaseline = {
  id: string;
  sql: string;
  checksum: string;
  migrationIds: string[];
  legacyAdoptionCutoff: string;
};

export type MigrationLedgerErrorCode =
  | 'MIGRATION_MANIFEST_INVALID'
  | 'MIGRATION_LEDGER_MISMATCH'
  | 'MIGRATION_ADOPTION_REQUIRED'
  | 'MIGRATION_ADOPTION_REJECTED'
  | 'MIGRATION_RELEASE_REQUIRED'
  | 'MIGRATION_BASELINE_INVALID'
  | 'MIGRATION_LOCK_TIMEOUT';

export class MigrationLedgerError extends Error {
  constructor(
    public readonly code: MigrationLedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MigrationLedgerError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
        `Duplicate future migration sequence ${String(sequence).padStart(4, '0')} in ${existing} and ${name}.`,
      );
    }
    seen.set(sequence, name);
  }
}

export async function loadMigrationManifest(
  migrationsDirectory = path.resolve(process.cwd(), 'drizzle', 'migrations'),
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

  return Promise.all(names.map(async (id) => {
    const sql = await readFile(path.join(migrationsDirectory, id), 'utf8');
    if (!sql.trim()) throw new MigrationLedgerError('MIGRATION_MANIFEST_INVALID', `Migration ${id} is empty.`);
    return { id, sql, checksum: sha256(sql) };
  }));
}

export function manifestFingerprint(manifest: readonly MigrationManifestEntry[]): string {
  return sha256(manifest.map((entry) => `${entry.id}:${entry.checksum}`).join('\n'));
}

/** Pure immutable schema identity shared by capture and recovery. */
export function backupSchemaFingerprint(
  ledger: readonly Pick<MigrationManifestEntry, 'id' | 'checksum'>[],
): string {
  const fingerprint = createHash('sha256');
  for (const entry of ledger) fingerprint.update(`${entry.id.length}:${entry.id}:${entry.checksum};`);
  return fingerprint.digest('hex');
}

export async function loadProductionBaseline(
  baselinesDirectory = path.resolve(process.cwd(), 'drizzle', 'baselines'),
  manifest?: MigrationManifestEntry[],
): Promise<ProductionBaseline> {
  let files;
  try { files = await readdir(baselinesDirectory, { withFileTypes: true }); }
  catch (error) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Unable to read production baselines in ${baselinesDirectory}: ${String(error)}`);
  }
  const metadataFiles = files.filter((entry) => entry.isFile() && BASELINE_METADATA_PATTERN.test(entry.name))
    .map((entry) => entry.name).sort();
  const metadataFile = metadataFiles.at(-1);
  if (!metadataFile) throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `No production baseline metadata exists in ${baselinesDirectory}.`);
  let raw: { id?: unknown; sqlFile?: unknown; sqlSha256?: unknown; migrationFingerprint?: unknown;
    migrationIds?: unknown; legacyAdoptionCutoff?: unknown };
  try { raw = JSON.parse(await readFile(path.join(baselinesDirectory, metadataFile), 'utf8')) as typeof raw; }
  catch (error) {
    throw new MigrationLedgerError('MIGRATION_BASELINE_INVALID', `Unable to parse baseline metadata ${metadataFile}: ${String(error)}`);
  }
  if (typeof raw.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.id) ||
      typeof raw.sqlFile !== 'string' || !/^[A-Za-z0-9._-]+\.sql$/.test(raw.sqlFile) ||
      typeof raw.sqlSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sqlSha256) ||
      typeof raw.migrationFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(raw.migrationFingerprint) ||
      !Array.isArray(raw.migrationIds) || raw.migrationIds.some((id) => typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id)) ||
      typeof raw.legacyAdoptionCutoff !== 'string' || !IDENTIFIER_PATTERN.test(raw.legacyAdoptionCutoff)) {
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
  return { id: raw.id, sql, checksum: raw.sqlSha256, migrationIds: raw.migrationIds,
    legacyAdoptionCutoff: raw.legacyAdoptionCutoff };
}
