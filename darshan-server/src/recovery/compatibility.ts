import type { SignedConfigurationCapsulePolicy } from '../backups/configuration-capsule-policy';
import type { BackupManifestV1 } from '../backups/manifest';
import { backupSchemaFingerprint, type MigrationManifestEntry } from '../deployment/migration-manifest';
import { recoveryDigest, type RecoverySourceKind } from './contracts';
import { RecoveryError } from './errors';
import { RECOVERY_COMPATIBILITY_REGISTRY_DOCUMENT } from './recovery-compatibility-registry';

const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MIGRATION_PATTERN = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_.-]*\.sql$/;

export interface RecoveryCompatibilityRegistryEntry {
  releaseId: string;
  sourceKind: Exclude<RecoverySourceKind, 'LEGACY_OFF_HOST'>;
  manifestVersions: Array<1 | 2>;
  compatibilityGeneration: number;
  terminalMigrationId: string;
  ledgerFingerprintSha256: string;
}

export interface RecoveryCompatibilityDecision {
  classification: 'COMPATIBLE_CURRENT' | 'COMPATIBLE_FORWARD' | 'LEGACY_CLASSIFIED';
  targetReleaseId: string;
  targetSchemaMigrationId: string;
  sourceLedgerLength: number;
  pendingMigrationIds: string[];
  fullyEligible: boolean;
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RecoveryError('RECOVERY_SOURCE_FORMAT_UNSUPPORTED', `${label} must be an object.`);
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...keys].sort())) {
    throw new RecoveryError('RECOVERY_SOURCE_FORMAT_UNSUPPORTED', `${label} has missing or unknown fields.`);
  }
  return record;
}

export function parseRecoveryCompatibilityRegistry(value: unknown): RecoveryCompatibilityRegistryEntry[] {
  const root = exactObject(value, ['format', 'releases'], 'compatibility registry');
  if (root.format !== 'darshan-recovery-compatibility-registry-v1' || !Array.isArray(root.releases)) {
    throw new RecoveryError('RECOVERY_SOURCE_FORMAT_UNSUPPORTED', 'Compatibility registry format is unsupported.');
  }
  const seen = new Set<string>();
  return root.releases.map((item, index) => {
    const entry = exactObject(item, [
      'release_id', 'source_kind', 'manifest_versions', 'compatibility_generation',
      'terminal_migration_id', 'ledger_fingerprint_sha256',
    ], `compatibility registry release ${index}`);
    if (typeof entry.release_id !== 'string' || !RELEASE_PATTERN.test(entry.release_id) ||
        (entry.source_kind !== 'LOCAL_FILESYSTEM_V2' && entry.source_kind !== 'LOCAL_FILESYSTEM_V1_HELPER') ||
        !Array.isArray(entry.manifest_versions) || entry.manifest_versions.length < 1 ||
        entry.manifest_versions.some((version) => version !== 1 && version !== 2) ||
        !Number.isSafeInteger(entry.compatibility_generation) || Number(entry.compatibility_generation) < 1 ||
        typeof entry.terminal_migration_id !== 'string' || !MIGRATION_PATTERN.test(entry.terminal_migration_id)) {
      throw new RecoveryError('RECOVERY_SOURCE_FORMAT_UNSUPPORTED', 'Compatibility registry release entry is invalid.');
    }
    recoveryDigest(String(entry.ledger_fingerprint_sha256), 'ledger_fingerprint_sha256');
    const key = `${entry.release_id}:${entry.source_kind}`;
    if (seen.has(key)) throw new RecoveryError('RECOVERY_SOURCE_FORMAT_UNSUPPORTED', 'Compatibility registry contains a duplicate release/source kind.');
    seen.add(key);
    return {
      releaseId: entry.release_id,
      sourceKind: entry.source_kind,
      manifestVersions: [...entry.manifest_versions] as Array<1 | 2>,
      compatibilityGeneration: Number(entry.compatibility_generation),
      terminalMigrationId: entry.terminal_migration_id,
      ledgerFingerprintSha256: String(entry.ledger_fingerprint_sha256),
    };
  });
}

export const RELEASE_RECOVERY_COMPATIBILITY_REGISTRY = Object.freeze(
  parseRecoveryCompatibilityRegistry(RECOVERY_COMPATIBILITY_REGISTRY_DOCUMENT),
);

function normalizeManifestMigrationId(value: string): string {
  return value.endsWith('.sql') ? value : `${value}.sql`;
}

export function assessRecoveryCompatibility(input: {
  sourceKind: RecoverySourceKind;
  sourceManifest?: BackupManifestV1;
  sourcePolicy?: SignedConfigurationCapsulePolicy;
  legacyReleaseId?: string;
  targetReleaseId: string;
  targetManifest: readonly MigrationManifestEntry[];
  registry?: readonly RecoveryCompatibilityRegistryEntry[];
}): RecoveryCompatibilityDecision {
  const targetLast = input.targetManifest.at(-1)?.id;
  if (!targetLast) throw new RecoveryError('RECOVERY_SOURCE_SCHEMA_MISSING', 'Target migration manifest is empty.');
  if (input.sourceKind === 'LEGACY_OFF_HOST') {
    return { classification: 'LEGACY_CLASSIFIED', targetReleaseId: input.targetReleaseId,
      targetSchemaMigrationId: targetLast, sourceLedgerLength: 0, pendingMigrationIds: [], fullyEligible: false };
  }
  const manifest = input.sourceManifest;
  if (!manifest || manifest.version !== (input.sourceKind === 'LOCAL_FILESYSTEM_V2' ? 2 : 1)) {
    throw new RecoveryError('RECOVERY_SOURCE_FORMAT_UNSUPPORTED', 'Source manifest version does not match its recovery source kind.');
  }
  if (input.sourceKind === 'LOCAL_FILESYSTEM_V2') {
    const policy = input.sourcePolicy;
    if (!policy || manifest.release.id !== policy.policy.release_generation ||
        manifest.configurationPolicy?.capsuleGeneration !== policy.policy.generation) {
      throw new RecoveryError('RECOVERY_SOURCE_RELEASE_UNSUPPORTED', 'Source manifest and trusted capsule policy release/generation identities differ.');
    }
  }
  const registry = input.registry ?? RELEASE_RECOVERY_COMPATIBILITY_REGISTRY;
  const registered = registry.find((entry) => entry.releaseId === manifest.release.id && entry.sourceKind === input.sourceKind);
  if (!registered || !registered.manifestVersions.includes(manifest.version)) {
    throw new RecoveryError('RECOVERY_SOURCE_RELEASE_UNSUPPORTED', 'Source release and manifest contract are not registered for recovery.');
  }
  if (input.sourcePolicy && input.sourcePolicy.policy.compatibility_generation !== registered.compatibilityGeneration) {
    throw new RecoveryError('RECOVERY_SOURCE_RELEASE_UNSUPPORTED', 'Source capsule compatibility generation is not registered.');
  }
  const sourceMigrationId = normalizeManifestMigrationId(manifest.schema.migrationId);
  if (sourceMigrationId !== registered.terminalMigrationId) {
    throw new RecoveryError('RECOVERY_SOURCE_SCHEMA_CHANGED', 'Source manifest terminal migration differs from its release registry.');
  }
  const sourceIndex = input.targetManifest.findIndex((entry) => entry.id === sourceMigrationId);
  if (sourceIndex < 0) {
    const code = sourceMigrationId > targetLast ? 'RECOVERY_SOURCE_SCHEMA_FUTURE' : 'RECOVERY_SOURCE_SCHEMA_MISSING';
    throw new RecoveryError(code, 'Source terminal migration is not present in the target release ledger.');
  }
  const sourceLedger = input.targetManifest.slice(0, sourceIndex + 1);
  const targetFingerprint = backupSchemaFingerprint(sourceLedger);
  if (targetFingerprint !== manifest.schema.fingerprintSha256 || targetFingerprint !== registered.ledgerFingerprintSha256) {
    throw new RecoveryError('RECOVERY_SOURCE_SCHEMA_CHANGED', 'Source ledger is not a contiguous checksum-identical prefix of the target release ledger.');
  }
  const pendingMigrationIds = input.targetManifest.slice(sourceIndex + 1).map((entry) => entry.id);
  return {
    classification: pendingMigrationIds.length === 0 ? 'COMPATIBLE_CURRENT' : 'COMPATIBLE_FORWARD',
    targetReleaseId: input.targetReleaseId, targetSchemaMigrationId: targetLast,
    sourceLedgerLength: sourceLedger.length, pendingMigrationIds, fullyEligible: true,
  };
}
