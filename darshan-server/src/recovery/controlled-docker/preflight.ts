import type { BackupManifestV1 } from '../../backups/manifest';
import type { RecoveryCompatibilityDecision } from '../compatibility';
import { ControlledRecoveryError, canonicalDecimal, digest } from './contracts';
import type { ControlledRecoveryProfile } from './profile';

export interface CapacityObservation {
  protectedWorkspaceFreeBytes: string;
  targetDiskFreeBytes: string;
  freeInodes: string;
  availableMemoryBytes: string;
  fixedImageBytes: string;
  preservedOriginalBytes: string;
}

export interface CapacityRequirement {
  ciphertextBytes: string; plaintextBytes: string; protectedWorkspaceBytes: string;
  postgresBytes: string; objectBytes: string; targetDiskBytes: string;
  imageBytes: string; preservedOriginalBytes: string; requiredInodes: string; requiredMemoryBytes: string;
}

function decimal(value: bigint): string { return value.toString(10); }
function ceilMultiply(value: bigint, numerator: bigint, denominator: bigint): bigint {
  return (value * numerator + denominator - 1n) / denominator;
}

export function calculateCapacityRequirement(input: {
  profile: ControlledRecoveryProfile; manifest: BackupManifestV1;
  plaintextDatabaseBytes: string; plaintextObjectBytes: string; plaintextConfigurationBytes: string;
  expectedObjectCount: string; observation: CapacityObservation;
}): CapacityRequirement {
  const ciphertext = input.manifest.artifacts.reduce((sum, artifact) => sum + canonicalDecimal(artifact.ciphertextSizeBytes, 'ciphertextSizeBytes'), 0n);
  const database = canonicalDecimal(input.plaintextDatabaseBytes, 'plaintextDatabaseBytes');
  const objects = canonicalDecimal(input.plaintextObjectBytes, 'plaintextObjectBytes');
  const configuration = canonicalDecimal(input.plaintextConfigurationBytes, 'plaintextConfigurationBytes');
  const plaintext = database + objects + configuration;
  const numerator = canonicalDecimal(input.profile.capacity.pg_multiplier_numerator, 'pg multiplier numerator');
  const denominator = canonicalDecimal(input.profile.capacity.pg_multiplier_denominator, 'pg multiplier denominator');
  const postgres = ceilMultiply(database, numerator, denominator) + canonicalDecimal(input.profile.capacity.wal_headroom_bytes, 'WAL headroom');
  const objectTarget = objects + canonicalDecimal(input.profile.capacity.minio_headroom_bytes, 'MinIO headroom');
  const images = canonicalDecimal(input.observation.fixedImageBytes, 'fixedImageBytes');
  const originals = canonicalDecimal(input.observation.preservedOriginalBytes, 'preservedOriginalBytes');
  const workspace = ciphertext + plaintext + canonicalDecimal(input.profile.capacity.protected_workspace_headroom_bytes, 'workspace headroom');
  const target = postgres + objectTarget + images + originals + canonicalDecimal(input.profile.capacity.target_disk_headroom_bytes, 'target headroom');
  const objectCount = canonicalDecimal(input.expectedObjectCount, 'expectedObjectCount');
  return { ciphertextBytes: decimal(ciphertext), plaintextBytes: decimal(plaintext), protectedWorkspaceBytes: decimal(workspace),
    postgresBytes: decimal(postgres), objectBytes: decimal(objectTarget), targetDiskBytes: decimal(target), imageBytes: decimal(images),
    preservedOriginalBytes: decimal(originals), requiredInodes: decimal(objectCount + canonicalDecimal(input.profile.capacity.required_inodes, 'required inodes')),
    requiredMemoryBytes: input.profile.capacity.required_memory_bytes };
}

export function assertCapacity(requirement: CapacityRequirement, observation: CapacityObservation): void {
  const comparisons: Array<[string, string, string]> = [
    ['protected workspace', observation.protectedWorkspaceFreeBytes, requirement.protectedWorkspaceBytes],
    ['target disk', observation.targetDiskFreeBytes, requirement.targetDiskBytes],
    ['inodes', observation.freeInodes, requirement.requiredInodes],
    ['memory', observation.availableMemoryBytes, requirement.requiredMemoryBytes],
  ];
  for (const [label, available, required] of comparisons) {
    if (canonicalDecimal(available, label) < canonicalDecimal(required, label)) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_CAPACITY_INSUFFICIENT', `${label} capacity is below the fixed requirement.`);
    }
  }
}

export interface PreflightAdapter {
  verifyRepositoryMount(): Promise<{ siteId: string; repositoryId: string; mountIdentity: string }>;
  proveRecoveryKeyRecipient(keyFile: string): Promise<{ keyId: string }>;
  inspectFixedAssets(): Promise<{ profileAssetsSha256: string; toolsSha256: string; imagesSha256: string; configurationSha256: string }>;
  inspectCapacity(): Promise<CapacityObservation>;
}

export async function runControlledPreflight(input: {
  profile: ControlledRecoveryProfile; manifest: BackupManifestV1; compatibility: RecoveryCompatibilityDecision;
  keyFile: string; expectedProfileAssetsSha256: string; expectedToolsSha256: string; expectedImagesSha256: string;
  expectedConfigurationSha256: string; plaintextDatabaseBytes: string; plaintextObjectBytes: string;
  plaintextConfigurationBytes: string; expectedObjectCount: string; adapter: PreflightAdapter;
}): Promise<{ evidenceSha256: string; capacity: CapacityRequirement }> {
  const mount = await input.adapter.verifyRepositoryMount();
  if (mount.siteId !== input.profile.site_id || mount.repositoryId !== input.profile.repository.repository_id || !mount.mountIdentity) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPOSITORY_MISMATCH', 'Repository mount/site identity is not the fixed approved repository.');
  }
  if (!input.compatibility.fullyEligible || input.compatibility.targetReleaseId !== input.profile.release_id) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RELEASE_INCOMPATIBLE', 'Source schema/release is not eligible for this fixed target.');
  }
  const key = await input.adapter.proveRecoveryKeyRecipient(input.keyFile);
  if (key.keyId !== input.manifest.encryption.keyId) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_KEY_MISMATCH', 'Recovery private key does not prove the manifest recipient identity.');
  }
  const assets = await input.adapter.inspectFixedAssets();
  const expected = { profileAssetsSha256: input.expectedProfileAssetsSha256, toolsSha256: input.expectedToolsSha256,
    imagesSha256: input.expectedImagesSha256, configurationSha256: input.expectedConfigurationSha256 };
  if (digest(assets) !== digest(expected)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ASSET_MISMATCH', 'Fixed tools, images, or configuration differ from the installed profile.');
  const observation = await input.adapter.inspectCapacity();
  const capacity = calculateCapacityRequirement({ ...input, observation });
  assertCapacity(capacity, observation);
  return { evidenceSha256: digest({ mount, keyId: key.keyId, assets, capacity, observation }), capacity };
}

