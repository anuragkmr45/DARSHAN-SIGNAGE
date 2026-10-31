import { backupSchemaFingerprint, loadMigrationManifest, type MigrationManifestEntry } from '../deployment/migration-manifest';
import { RecoveryError } from './errors';

export const RELEASE_RECOVERY_TARGET = Object.freeze({
  targetId: 'darshan-server-release-01',
  releaseId: 'release-01',
  terminalMigrationId: '0055_backup_deletion_idempotency_bindings.sql',
  migrationManifestSha256: 'fb7b1204029c2a4a3fac754845fff3723732ae8b0de6df54a5460c41b9a3f167',
});

/**
 * Explicit Packet 2 target. RELEASE_RECOVERY_TARGET remains the immutable
 * release-01/0055 native/runtime pin and is deliberately not widened.
 */
export const CONTROLLED_RECOVERY_PACKET2_TARGET = Object.freeze({
  targetId: 'darshan-server-release-02-controlled',
  releaseId: 'release-02',
  terminalMigrationId: '0056_recovery_runtime_authority.sql',
  migrationManifestSha256: '69b84a7d0bdebf17df6bec95f907791d586cc9558ec33fb18b79eb41b6e62a2b',
});

/** Packet 3 API/report-projection schema; prior release targets remain immutable prefixes. */
export const CONTROLLED_RECOVERY_PACKET3_TARGET = Object.freeze({
  targetId: 'darshan-server-release-03-controlled',
  releaseId: 'release-03',
  terminalMigrationId: '0057_controlled_recovery_report_projection.sql',
  migrationManifestSha256: '05561d3b1c8cac7fa57f6d47503835d23c2b88f7886203ab9c8207238762c438',
});

export const APPROVED_RECOVERY_TARGETS = Object.freeze([
  RELEASE_RECOVERY_TARGET,
  CONTROLLED_RECOVERY_PACKET2_TARGET,
  CONTROLLED_RECOVERY_PACKET3_TARGET,
]);

export async function loadApprovedRecoveryTarget(input: {
  targetId: string;
  releaseId: string;
  migrationsDirectory: string;
}): Promise<{ metadata: (typeof APPROVED_RECOVERY_TARGETS)[number]; manifest: MigrationManifestEntry[] }> {
  const metadata = APPROVED_RECOVERY_TARGETS.find(
    (entry) => entry.targetId === input.targetId && entry.releaseId === input.releaseId,
  );
  if (!metadata) throw new RecoveryError('RECOVERY_TARGET_UNSUPPORTED', 'Requested recovery target is not in the reviewed release catalog.');
  let full: MigrationManifestEntry[];
  try { full = await loadMigrationManifest(input.migrationsDirectory); }
  catch (cause) { throw new RecoveryError('RECOVERY_TARGET_CHANGED', 'Release migration assets are missing or invalid.', { cause }); }
  const terminal = full.findIndex((entry) => entry.id === metadata.terminalMigrationId);
  const manifest = terminal < 0 ? [] : full.slice(0, terminal + 1);
  if (manifest.at(-1)?.id !== metadata.terminalMigrationId ||
      backupSchemaFingerprint(manifest) !== metadata.migrationManifestSha256) {
    throw new RecoveryError('RECOVERY_TARGET_CHANGED', 'Release migration assets differ from reviewed recovery target metadata.');
  }
  return { metadata, manifest };
}

export async function loadReleaseRecoveryTarget(input: {
  targetId: string;
  releaseId: string;
  migrationsDirectory: string;
}): Promise<{ metadata: typeof RELEASE_RECOVERY_TARGET; manifest: MigrationManifestEntry[] }> {
  if (input.targetId !== RELEASE_RECOVERY_TARGET.targetId || input.releaseId !== RELEASE_RECOVERY_TARGET.releaseId) {
    throw new RecoveryError('RECOVERY_TARGET_UNSUPPORTED', 'Requested recovery target is not owned by this release.');
  }
  let fullManifest: MigrationManifestEntry[];
  try { fullManifest = await loadMigrationManifest(input.migrationsDirectory); }
  catch (cause) { throw new RecoveryError('RECOVERY_TARGET_CHANGED', 'Release migration assets are missing or invalid.', { cause }); }
  const terminal = fullManifest.findIndex((entry) => entry.id === RELEASE_RECOVERY_TARGET.terminalMigrationId);
  const manifest = terminal < 0 ? [] : fullManifest.slice(0, terminal + 1);
  if (manifest.at(-1)?.id !== RELEASE_RECOVERY_TARGET.terminalMigrationId ||
      backupSchemaFingerprint(manifest) !== RELEASE_RECOVERY_TARGET.migrationManifestSha256) {
    throw new RecoveryError('RECOVERY_TARGET_CHANGED', 'Release migration assets differ from reviewed recovery target metadata.');
  }
  return { metadata: RELEASE_RECOVERY_TARGET, manifest };
}
