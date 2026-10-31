import { createHash } from 'node:crypto';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { RecoveryError } from './errors';

export const RECOVERY_JOURNAL_FORMAT_V1 = 'darshan-recovery-operation-v1' as const;
export const RECOVERY_JOURNAL_FORMAT_V2 = 'darshan-recovery-operation-v2' as const;
export const RECOVERY_JOURNAL_FORMAT_V3 = 'darshan-recovery-operation-v3' as const;
export const RECOVERY_JOURNAL_FORMAT_V4 = 'darshan-recovery-operation-v4' as const;
export const RECOVERY_JOURNAL_FORMAT = 'darshan-recovery-operation-v5' as const;
export const RECOVERY_PLAN_FORMAT = 'darshan-recovery-plan-v1' as const;
export const RECOVERY_PLAN_FORMAT_V2 = 'darshan-recovery-plan-v2' as const;
export const RECOVERY_PLAN_FORMAT_V3 = 'darshan-recovery-plan-v3' as const;
export const RECOVERY_PLAN_FORMAT_V4 = 'darshan-recovery-plan-v4' as const;

export const RECOVERY_SOURCE_KINDS = [
  'LOCAL_FILESYSTEM_V2',
  'LOCAL_FILESYSTEM_V1_HELPER',
  'LEGACY_OFF_HOST',
] as const;
export type RecoverySourceKind = typeof RECOVERY_SOURCE_KINDS[number];

export const RECOVERY_PHASES = ['PLANNED', 'SOURCE_HELD', 'SOURCE_VERIFIED', 'TARGETS_PREPARED'] as const;
export type RecoveryPhase = typeof RECOVERY_PHASES[number];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SITE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function recoveryUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new RecoveryError('RECOVERY_ID_INVALID', `${label} must be an RFC 4122 UUID.`);
  return value.toLowerCase();
}

export function recoveryDigest(value: string, label: string): string {
  if (!SHA256_PATTERN.test(value)) throw new RecoveryError('RECOVERY_DIGEST_INVALID', `${label} must be a lowercase SHA-256 digest.`);
  return value;
}

export function recoverySiteId(value: string): string {
  if (!SITE_PATTERN.test(value)) throw new RecoveryError('RECOVERY_ID_INVALID', 'siteId must be a canonical site identifier.');
  return value;
}

export interface RecoverySourceDescriptor {
  kind: RecoverySourceKind;
  siteId: string;
  repositoryId: string | null;
  runId: string;
  manifestSha256: string;
  releaseId: string;
  schemaMigrationId: string;
  schemaFingerprintSha256: string;
  descriptorSha256: string;
  fullyEligible: boolean;
}

export interface RecoverySourceDescriptorV2 extends RecoverySourceDescriptor {
  kind: 'LOCAL_FILESYSTEM_V2';
  repositoryId: string;
  attemptId: string;
  captureId: string;
  captureGeneration: number;
  repositoryDescriptorSha256: string;
}

export type RecoverySourceDescriptorV2Identity = Omit<RecoverySourceDescriptorV2, 'descriptorSha256' | 'fullyEligible'>;

export function recoverySourceDescriptorV2Identity(
  source: RecoverySourceDescriptorV2Identity,
): RecoverySourceDescriptorV2Identity {
  return {
    kind: source.kind, siteId: source.siteId, repositoryId: source.repositoryId, runId: source.runId,
    attemptId: source.attemptId, captureId: source.captureId, captureGeneration: source.captureGeneration,
    manifestSha256: source.manifestSha256, releaseId: source.releaseId, schemaMigrationId: source.schemaMigrationId,
    schemaFingerprintSha256: source.schemaFingerprintSha256,
    repositoryDescriptorSha256: source.repositoryDescriptorSha256,
  };
}

export function recoverySourceDescriptorV2Digest(source: RecoverySourceDescriptorV2Identity): string {
  return sha256RecoveryBytes(canonicalRecoveryBytes(recoverySourceDescriptorV2Identity(source)));
}

export interface RecoveryPlan {
  format: typeof RECOVERY_PLAN_FORMAT;
  planId: string;
  operationId: string;
  createdAt: string;
  source: RecoverySourceDescriptor;
  compatibility: {
    classification: 'COMPATIBLE_CURRENT' | 'COMPATIBLE_FORWARD' | 'LEGACY_CLASSIFIED';
    targetReleaseId: string;
    targetSchemaMigrationId: string;
    pendingMigrationIds: string[];
  };
}

export interface RecoveryPlanV2 {
  format: typeof RECOVERY_PLAN_FORMAT_V2;
  planId: string;
  operationId: string;
  createdAt: string;
  source: RecoverySourceDescriptorV2;
  target: {
    targetId: string;
    releaseId: string;
    terminalMigrationId: string;
    migrationManifestSha256: string;
  };
  compatibility: {
    classification: 'COMPATIBLE_CURRENT' | 'COMPATIBLE_FORWARD';
    targetReleaseId: string;
    targetSchemaMigrationId: string;
    pendingMigrationIds: string[];
  };
}

export const RECOVERY_TARGET_TOPOLOGY_MODES = ['SINGLE_HOST', 'SPLIT_HOST'] as const;
export type RecoveryTargetTopologyMode = typeof RECOVERY_TARGET_TOPOLOGY_MODES[number];

/**
 * Every value is retained review evidence. No path, URL, credential or secret
 * is admitted to the recovery plan.
 */
export interface RecoveryTargetPreparationIdentity {
  generation: number;
  hostInstallationId: string;
  topologyMode: RecoveryTargetTopologyMode;
  hostPolicySha256: string;
  helperRoleSha256: string;
  engineProfileSha256: string;
  protectionInventorySha256: string;
  capacityEvidenceSha256: string;
  storageInventorySha256: string;
  targetSpecificationSha256: string;
}

export interface RecoveryTargetPreparation extends RecoveryTargetPreparationIdentity {
  targetSetId: string;
}

export interface RecoveryPlanV3 extends Omit<RecoveryPlanV2, 'format'> {
  format: typeof RECOVERY_PLAN_FORMAT_V3;
  targetPreparation: RecoveryTargetPreparation;
}

export const RECOVERY_TARGET_SET_DERIVATION_V2 = 'darshan-recovery-target-set-id-v2' as const;

export interface RecoveryTargetPreparationV2 {
  derivationVersion: typeof RECOVERY_TARGET_SET_DERIVATION_V2;
  targetSetId: string;
  generation: number;
  hostInstallationId: string;
  topologyMode: RecoveryTargetTopologyMode;
  helperRoleSha256: string;
  hostPolicyEnvelopeSha256: string;
  engineProfileEnvelopeSha256: string;
  storageInventoryEnvelopeSha256: string;
  protectionInventoryEnvelopeSha256: string;
  capacityEvidenceEnvelopeSha256: string;
  targetSpecificationSha256: string;
  operationAttestationSha256: string;
}

export interface RecoveryPlanV4 extends Omit<RecoveryPlanV2, 'format'> {
  format: typeof RECOVERY_PLAN_FORMAT_V4;
  targetPreparation: RecoveryTargetPreparationV2;
}

const TARGET_SET_ID_DOMAIN = Buffer.from('darshan-recovery-target-set-id-v1\0', 'utf8');

export function recoveryTargetSetId(identity: RecoveryTargetPreparationIdentity): string {
  const canonical: RecoveryTargetPreparationIdentity = {
    generation: identity.generation,
    hostInstallationId: recoveryUuid(identity.hostInstallationId, 'hostInstallationId'),
    topologyMode: identity.topologyMode,
    hostPolicySha256: recoveryDigest(identity.hostPolicySha256, 'hostPolicySha256'),
    helperRoleSha256: recoveryDigest(identity.helperRoleSha256, 'helperRoleSha256'),
    engineProfileSha256: recoveryDigest(identity.engineProfileSha256, 'engineProfileSha256'),
    protectionInventorySha256: recoveryDigest(identity.protectionInventorySha256, 'protectionInventorySha256'),
    capacityEvidenceSha256: recoveryDigest(identity.capacityEvidenceSha256, 'capacityEvidenceSha256'),
    storageInventorySha256: recoveryDigest(identity.storageInventorySha256, 'storageInventorySha256'),
    targetSpecificationSha256: recoveryDigest(identity.targetSpecificationSha256, 'targetSpecificationSha256'),
  };
  if (!Number.isSafeInteger(canonical.generation) || canonical.generation < 1 ||
      !RECOVERY_TARGET_TOPOLOGY_MODES.includes(canonical.topologyMode)) {
    throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation generation or topology mode is invalid.');
  }
  return sha256RecoveryBytes(Buffer.concat([TARGET_SET_ID_DOMAIN, canonicalRecoveryBytes(canonical)]));
}

const TARGET_SET_ID_V2_DOMAIN = Buffer.from('darshan-recovery-target-set-id-v2\0', 'utf8');

/**
 * The v2 target-set identity has one deliberately acyclic input edge: the
 * canonical v2 specification digest plus the operation/generation/host tuple.
 * The operation attestation and plan are downstream and must never be added.
 */
export function recoveryTargetSetIdV2(input: {
  targetSpecificationSha256: string;
  operationId: string;
  generation: number;
  hostInstallationId: string;
}): string {
  const canonical = {
    targetSpecificationSha256: recoveryDigest(input.targetSpecificationSha256, 'targetSpecificationSha256'),
    operationId: recoveryUuid(input.operationId, 'operationId'),
    generation: input.generation,
    hostInstallationId: recoveryUuid(input.hostInstallationId, 'hostInstallationId'),
  };
  if (!Number.isSafeInteger(canonical.generation) || canonical.generation < 1) {
    throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation generation is invalid.');
  }
  return sha256RecoveryBytes(Buffer.concat([TARGET_SET_ID_V2_DOMAIN, canonicalRecoveryBytes(canonical)]));
}

export function canonicalRecoveryBytes(value: unknown): Buffer {
  return canonicalJson(value);
}

export function sha256RecoveryBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function assertCanonicalTimestamp(value: string, label: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new RecoveryError('RECOVERY_STATE_INVALID', `${label} must be a canonical UTC timestamp.`);
  }
  return value;
}
