import { randomUUID } from 'node:crypto';
import {
  RECOVERY_PLAN_FORMAT,
  RECOVERY_PLAN_FORMAT_V2,
  RECOVERY_PLAN_FORMAT_V3,
  RECOVERY_PLAN_FORMAT_V4,
  RECOVERY_TARGET_SET_DERIVATION_V2,
  assertCanonicalTimestamp,
  canonicalRecoveryBytes,
  recoveryDigest,
  recoverySiteId,
  recoverySourceDescriptorV2Digest,
  recoveryTargetSetId,
  recoveryTargetSetIdV2,
  recoveryUuid,
  sha256RecoveryBytes,
  type RecoveryPlan,
  type RecoveryPlanV2,
  type RecoveryPlanV3,
  type RecoveryPlanV4,
  type RecoveryTargetPreparationIdentity,
  type RecoverySourceDescriptor,
  type RecoverySourceDescriptorV2,
} from './contracts';
import type { RecoveryCompatibilityDecision } from './compatibility';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { assertRecoveryTargetSpecification, parseRecoveryTargetSpecification,
  buildRecoveryTargetSpecificationV2, encodeRecoveryTargetSpecificationV2, parseRecoveryTargetSpecificationV2,
  recoveryTargetLogicalIdentitySha256, recoveryTargetReleaseIdentitySha256,
  type RecoveryTargetSpecification, type RecoveryTargetSpecificationV2 } from './target-specification';
import { encodeSignedTargetOperationAttestation, parseSignedTargetOperationAttestation,
  targetOperationAttestationEnvelopeSha256,
  type SignedRecoveryTargetOperationAttestation } from './target-operation-attestation';

export function buildRecoveryPlan(input: {
  source: RecoverySourceDescriptor;
  compatibility: RecoveryCompatibilityDecision;
  operationId?: string;
  planId?: string;
  createdAt?: Date;
}): { plan: RecoveryPlan; bytes: Buffer; sha256: string } {
  const source: RecoverySourceDescriptor = {
    ...input.source,
    siteId: recoverySiteId(input.source.siteId),
    repositoryId: input.source.repositoryId === null ? null : recoveryUuid(input.source.repositoryId, 'repositoryId'),
    runId: recoveryUuid(input.source.runId, 'runId'),
    manifestSha256: recoveryDigest(input.source.manifestSha256, 'manifestSha256'),
    schemaFingerprintSha256: recoveryDigest(input.source.schemaFingerprintSha256, 'schemaFingerprintSha256'),
    descriptorSha256: recoveryDigest(input.source.descriptorSha256, 'descriptorSha256'),
    fullyEligible: input.compatibility.fullyEligible && input.source.fullyEligible,
  };
  const plan: RecoveryPlan = {
    format: RECOVERY_PLAN_FORMAT,
    planId: recoveryUuid(input.planId ?? randomUUID(), 'planId'),
    operationId: recoveryUuid(input.operationId ?? randomUUID(), 'operationId'),
    createdAt: assertCanonicalTimestamp((input.createdAt ?? new Date()).toISOString(), 'createdAt'),
    source,
    compatibility: {
      classification: input.compatibility.classification,
      targetReleaseId: input.compatibility.targetReleaseId,
      targetSchemaMigrationId: input.compatibility.targetSchemaMigrationId,
      pendingMigrationIds: [...input.compatibility.pendingMigrationIds],
    },
  };
  const bytes = canonicalRecoveryBytes(plan);
  return { plan, bytes, sha256: sha256RecoveryBytes(bytes) };
}

export function buildRecoveryPlanV2(input: {
  source: RecoverySourceDescriptorV2;
  compatibility: RecoveryCompatibilityDecision;
  target: RecoveryPlanV2['target'];
  operationId?: string;
  planId?: string;
  createdAt?: Date;
}): { plan: RecoveryPlanV2; bytes: Buffer; sha256: string } {
  if (!input.source.fullyEligible || !input.compatibility.fullyEligible || input.compatibility.classification === 'LEGACY_CLASSIFIED') {
    throw new Error('Recovery plan v2 requires a fully eligible non-legacy source.');
  }
  if (input.target.targetId !== RELEASE_RECOVERY_TARGET.targetId || input.target.releaseId !== RELEASE_RECOVERY_TARGET.releaseId ||
      input.target.terminalMigrationId !== RELEASE_RECOVERY_TARGET.terminalMigrationId ||
      input.target.migrationManifestSha256 !== RELEASE_RECOVERY_TARGET.migrationManifestSha256) {
    throw new Error('Recovery plan v2 target must exactly match release-owned recovery metadata.');
  }
  if (input.compatibility.targetReleaseId !== input.target.releaseId ||
      input.compatibility.targetSchemaMigrationId !== input.target.terminalMigrationId) {
    throw new Error('Recovery compatibility target differs from release-owned recovery metadata.');
  }
  const source: RecoverySourceDescriptorV2 = {
    ...input.source,
    siteId: recoverySiteId(input.source.siteId), repositoryId: recoveryUuid(input.source.repositoryId, 'repositoryId'),
    runId: recoveryUuid(input.source.runId, 'runId'), attemptId: recoveryUuid(input.source.attemptId, 'attemptId'),
    captureId: recoveryUuid(input.source.captureId, 'captureId'),
    manifestSha256: recoveryDigest(input.source.manifestSha256, 'manifestSha256'),
    schemaFingerprintSha256: recoveryDigest(input.source.schemaFingerprintSha256, 'schemaFingerprintSha256'),
    repositoryDescriptorSha256: recoveryDigest(input.source.repositoryDescriptorSha256, 'repositoryDescriptorSha256'),
    descriptorSha256: recoveryDigest(input.source.descriptorSha256, 'descriptorSha256'), fullyEligible: true,
  };
  if (recoverySourceDescriptorV2Digest(source) !== source.descriptorSha256) {
    throw new Error('Recovery source descriptor digest does not match its v2 identity tuple.');
  }
  if (!Number.isSafeInteger(source.captureGeneration) || source.captureGeneration < 1) {
    throw new Error('captureGeneration must be a positive safe integer.');
  }
  const target = { ...input.target, migrationManifestSha256: recoveryDigest(input.target.migrationManifestSha256, 'migrationManifestSha256') };
  const plan: RecoveryPlanV2 = {
    format: RECOVERY_PLAN_FORMAT_V2,
    planId: recoveryUuid(input.planId ?? randomUUID(), 'planId'),
    operationId: recoveryUuid(input.operationId ?? randomUUID(), 'operationId'),
    createdAt: assertCanonicalTimestamp((input.createdAt ?? new Date()).toISOString(), 'createdAt'),
    source,
    target,
    compatibility: {
      classification: input.compatibility.classification,
      targetReleaseId: input.compatibility.targetReleaseId,
      targetSchemaMigrationId: input.compatibility.targetSchemaMigrationId,
      pendingMigrationIds: [...input.compatibility.pendingMigrationIds],
    },
  };
  const bytes = canonicalRecoveryBytes(plan);
  return { plan, bytes, sha256: sha256RecoveryBytes(bytes) };
}

export function buildRecoveryPlanV3(input: {
  source: RecoverySourceDescriptorV2;
  compatibility: RecoveryCompatibilityDecision;
  target: RecoveryPlanV2['target'];
  targetPreparation: Omit<RecoveryTargetPreparationIdentity, 'targetSpecificationSha256'>;
  targetSpecification: RecoveryTargetSpecification | Uint8Array;
  operationId?: string;
  planId?: string;
  createdAt?: Date;
}): { plan: RecoveryPlanV3; bytes: Buffer; sha256: string } {
  const specification = input.targetSpecification instanceof Uint8Array
    ? parseRecoveryTargetSpecification(input.targetSpecification) : input.targetSpecification;
  const operationId = recoveryUuid(input.operationId ?? specification.operationId, 'operationId');
  const specificationBytes = assertRecoveryTargetSpecification({ specification, operationId,
    target: input.target, targetPreparation: input.targetPreparation });
  const base = buildRecoveryPlanV2({ ...input, operationId });
  const targetPreparation: RecoveryTargetPreparationIdentity = {
    generation: input.targetPreparation.generation,
    hostInstallationId: recoveryUuid(input.targetPreparation.hostInstallationId, 'hostInstallationId'),
    topologyMode: input.targetPreparation.topologyMode,
    hostPolicySha256: recoveryDigest(input.targetPreparation.hostPolicySha256, 'hostPolicySha256'),
    helperRoleSha256: recoveryDigest(input.targetPreparation.helperRoleSha256, 'helperRoleSha256'),
    engineProfileSha256: recoveryDigest(input.targetPreparation.engineProfileSha256, 'engineProfileSha256'),
    protectionInventorySha256: recoveryDigest(input.targetPreparation.protectionInventorySha256, 'protectionInventorySha256'),
    capacityEvidenceSha256: recoveryDigest(input.targetPreparation.capacityEvidenceSha256, 'capacityEvidenceSha256'),
    storageInventorySha256: recoveryDigest(input.targetPreparation.storageInventorySha256, 'storageInventorySha256'),
    targetSpecificationSha256: sha256RecoveryBytes(specificationBytes),
  };
  const targetSetId = recoveryTargetSetId(targetPreparation);
  const plan: RecoveryPlanV3 = {
    ...base.plan,
    format: RECOVERY_PLAN_FORMAT_V3,
    targetPreparation: { targetSetId, ...targetPreparation },
  };
  const bytes = canonicalRecoveryBytes(plan);
  return { plan, bytes, sha256: sha256RecoveryBytes(bytes) };
}

export function buildRecoveryPlanV4(input: {
  source: RecoverySourceDescriptorV2;
  compatibility: RecoveryCompatibilityDecision;
  target: RecoveryPlanV2['target'];
  targetPreparation: {
    generation: number;
    hostInstallationId: string;
    topologyMode: RecoveryTargetPreparationIdentity['topologyMode'];
    helperRoleSha256: string;
    hostPolicyEnvelopeSha256: string;
    engineProfileEnvelopeSha256: string;
    storageInventoryEnvelopeSha256: string;
    protectionInventoryEnvelopeSha256: string;
    capacityEvidenceEnvelopeSha256: string;
  };
  targetSpecification: RecoveryTargetSpecificationV2 | Uint8Array;
  operationAttestation: SignedRecoveryTargetOperationAttestation | Uint8Array;
  operationId?: string;
  planId?: string;
  createdAt?: Date;
}): { plan: RecoveryPlanV4; bytes: Buffer; sha256: string } {
  const specification = input.targetSpecification instanceof Uint8Array
    ? parseRecoveryTargetSpecificationV2(input.targetSpecification) : input.targetSpecification;
  const specificationBytes = encodeRecoveryTargetSpecificationV2(specification);
  const operationId = recoveryUuid(input.operationId ?? specification.operationId, 'operationId');
  const expectedSpecification = buildRecoveryTargetSpecificationV2({ operationId,
    generation: input.targetPreparation.generation, hostInstallationId: input.targetPreparation.hostInstallationId,
    topologyMode: input.targetPreparation.topologyMode, target: input.target,
    hostPolicyEnvelopeSha256: input.targetPreparation.hostPolicyEnvelopeSha256,
    engineProfileEnvelopeSha256: input.targetPreparation.engineProfileEnvelopeSha256,
    storageInventoryEnvelopeSha256: input.targetPreparation.storageInventoryEnvelopeSha256,
    protectionInventoryEnvelopeSha256: input.targetPreparation.protectionInventoryEnvelopeSha256,
    capacityEvidenceEnvelopeSha256: input.targetPreparation.capacityEvidenceEnvelopeSha256 });
  if (!encodeRecoveryTargetSpecificationV2(expectedSpecification).equals(specificationBytes)) {
    throw new Error('Recovery target specification v2 differs from the exact preparation chain.');
  }
  const targetSpecificationSha256 = sha256RecoveryBytes(specificationBytes);
  const targetSetId = recoveryTargetSetIdV2({ operationId, generation: input.targetPreparation.generation,
    hostInstallationId: input.targetPreparation.hostInstallationId, targetSpecificationSha256 });
  const signedAttestation = input.operationAttestation instanceof Uint8Array
    ? parseSignedTargetOperationAttestation(input.operationAttestation) : input.operationAttestation;
  const attestation = signedAttestation.attestation;
  const exact = {
    operationId, siteId: input.source.siteId, generation: input.targetPreparation.generation,
    hostInstallationId: recoveryUuid(input.targetPreparation.hostInstallationId, 'hostInstallationId'), targetSetId,
    targetSpecificationSha256, targetLogicalIdentitySha256: recoveryTargetLogicalIdentitySha256(input.target),
    targetReleaseIdentitySha256: recoveryTargetReleaseIdentitySha256(input.target),
    hostPolicyEnvelopeSha256: input.targetPreparation.hostPolicyEnvelopeSha256,
    engineProfileEnvelopeSha256: input.targetPreparation.engineProfileEnvelopeSha256,
    storageInventoryEnvelopeSha256: input.targetPreparation.storageInventoryEnvelopeSha256,
    protectionInventoryEnvelopeSha256: input.targetPreparation.protectionInventoryEnvelopeSha256,
    capacityEvidenceEnvelopeSha256: input.targetPreparation.capacityEvidenceEnvelopeSha256,
  };
  if (Object.entries(exact).some(([key, value]) => attestation[key as keyof typeof attestation] !== value)) {
    throw new Error('Recovery target operation attestation differs from the exact acyclic chain.');
  }
  const base = buildRecoveryPlanV2({ ...input, operationId });
  const plan: RecoveryPlanV4 = { ...base.plan, format: RECOVERY_PLAN_FORMAT_V4, targetPreparation: {
    derivationVersion: RECOVERY_TARGET_SET_DERIVATION_V2, targetSetId,
    generation: input.targetPreparation.generation,
    hostInstallationId: exact.hostInstallationId,
    topologyMode: input.targetPreparation.topologyMode,
    helperRoleSha256: recoveryDigest(input.targetPreparation.helperRoleSha256, 'helperRoleSha256'),
    hostPolicyEnvelopeSha256: recoveryDigest(input.targetPreparation.hostPolicyEnvelopeSha256, 'hostPolicyEnvelopeSha256'),
    engineProfileEnvelopeSha256: recoveryDigest(input.targetPreparation.engineProfileEnvelopeSha256, 'engineProfileEnvelopeSha256'),
    storageInventoryEnvelopeSha256: recoveryDigest(input.targetPreparation.storageInventoryEnvelopeSha256, 'storageInventoryEnvelopeSha256'),
    protectionInventoryEnvelopeSha256: recoveryDigest(input.targetPreparation.protectionInventoryEnvelopeSha256, 'protectionInventoryEnvelopeSha256'),
    capacityEvidenceEnvelopeSha256: recoveryDigest(input.targetPreparation.capacityEvidenceEnvelopeSha256, 'capacityEvidenceEnvelopeSha256'),
    targetSpecificationSha256,
    operationAttestationSha256: targetOperationAttestationEnvelopeSha256(encodeSignedTargetOperationAttestation(signedAttestation)),
  } };
  const bytes = canonicalRecoveryBytes(plan);
  return { plan, bytes, sha256: sha256RecoveryBytes(bytes) };
}
