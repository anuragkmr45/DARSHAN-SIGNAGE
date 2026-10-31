import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import {
  RECOVERY_TARGET_TOPOLOGY_MODES,
  recoveryDigest,
  recoveryTargetSetId,
  recoveryUuid,
  sha256RecoveryBytes,
  type RecoveryPlanV2,
  type RecoveryTargetPreparationIdentity,
} from './contracts';
import { RecoveryError } from './errors';

export const RECOVERY_TARGET_SPECIFICATION_FORMAT = 'darshan-recovery-target-specification-v1' as const;
export const RECOVERY_TARGET_SPECIFICATION_FORMAT_V2 = 'darshan-recovery-target-specification-v2' as const;
export const RECOVERY_TARGET_SPECIFICATION_MAX_BYTES = 64 * 1024;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const specificationSchema = z.object({
  format: z.literal(RECOVERY_TARGET_SPECIFICATION_FORMAT),
  operationId: uuid,
  generation: z.number().int().positive().safe(),
  hostInstallationId: uuid,
  topologyMode: z.enum(RECOVERY_TARGET_TOPOLOGY_MODES),
  hostPolicySha256: digest,
  helperRoleSha256: digest,
  engineProfileSha256: digest,
  protectionInventorySha256: digest,
  capacityEvidenceSha256: digest,
  storageInventorySha256: digest,
  targetLogicalIdentitySha256: digest,
  targetReleaseIdentitySha256: digest,
}).strict();

const specificationV2Schema = z.object({
  format: z.literal(RECOVERY_TARGET_SPECIFICATION_FORMAT_V2),
  operationId: uuid,
  generation: z.number().int().positive().safe(),
  hostInstallationId: uuid,
  topologyMode: z.enum(RECOVERY_TARGET_TOPOLOGY_MODES),
  targetLogicalIdentitySha256: digest,
  targetReleaseIdentitySha256: digest,
  hostPolicyEnvelopeSha256: digest,
  engineProfileEnvelopeSha256: digest,
  storageInventoryEnvelopeSha256: digest,
  protectionInventoryEnvelopeSha256: digest,
  capacityEvidenceEnvelopeSha256: digest,
}).strict();

export type RecoveryTargetSpecification = z.infer<typeof specificationSchema>;
export type RecoveryTargetSpecificationV2 = z.infer<typeof specificationV2Schema>;

const TARGET_LOGICAL_IDENTITY_DOMAIN = Buffer.from('darshan-recovery-target-logical-identity-v1\0', 'utf8');
const TARGET_RELEASE_IDENTITY_DOMAIN = Buffer.from('darshan-recovery-target-release-identity-v1\0', 'utf8');

export function recoveryTargetLogicalIdentitySha256(target: RecoveryPlanV2['target']): string {
  return sha256RecoveryBytes(Buffer.concat([TARGET_LOGICAL_IDENTITY_DOMAIN, canonicalJson({ targetId: target.targetId })]));
}

export function recoveryTargetReleaseIdentitySha256(target: RecoveryPlanV2['target']): string {
  return sha256RecoveryBytes(Buffer.concat([TARGET_RELEASE_IDENTITY_DOMAIN, canonicalJson({
    releaseId: target.releaseId,
    terminalMigrationId: target.terminalMigrationId,
    migrationManifestSha256: recoveryDigest(target.migrationManifestSha256, 'migrationManifestSha256'),
  })]));
}

export function encodeRecoveryTargetSpecification(value: RecoveryTargetSpecification): Buffer {
  const bytes = canonicalJson(specificationSchema.parse(value));
  if (bytes.byteLength > RECOVERY_TARGET_SPECIFICATION_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_INVALID', 'Target specification exceeds its reviewed bound.');
  }
  return bytes;
}

export function parseRecoveryTargetSpecification(bytes: Uint8Array): RecoveryTargetSpecification {
  try {
    const buffer = Buffer.from(bytes);
    const value = specificationSchema.parse(parseStrictJson(buffer, RECOVERY_TARGET_SPECIFICATION_MAX_BYTES));
    if (!encodeRecoveryTargetSpecification(value).equals(buffer)) throw new Error('non-canonical target specification');
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_INVALID',
      'Target specification is not strict canonical bounded JSON.', { cause });
  }
}

export function targetSpecificationSha256(value: RecoveryTargetSpecification | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? encodeRecoveryTargetSpecification(parseRecoveryTargetSpecification(value))
    : encodeRecoveryTargetSpecification(value);
  return sha256RecoveryBytes(bytes);
}

export function encodeRecoveryTargetSpecificationV2(value: RecoveryTargetSpecificationV2): Buffer {
  const bytes = canonicalJson(specificationV2Schema.parse(value));
  if (bytes.byteLength > RECOVERY_TARGET_SPECIFICATION_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_INVALID', 'Target specification v2 exceeds its reviewed bound.');
  }
  return bytes;
}

export function parseRecoveryTargetSpecificationV2(bytes: Uint8Array): RecoveryTargetSpecificationV2 {
  try {
    const buffer = Buffer.from(bytes);
    const value = specificationV2Schema.parse(parseStrictJson(buffer, RECOVERY_TARGET_SPECIFICATION_MAX_BYTES));
    if (!encodeRecoveryTargetSpecificationV2(value).equals(buffer)) throw new Error('non-canonical target specification v2');
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_INVALID',
      'Target specification v2 is not strict canonical bounded JSON.', { cause });
  }
}

export function targetSpecificationV2Sha256(value: RecoveryTargetSpecificationV2 | Uint8Array): string {
  const bytes = value instanceof Uint8Array
    ? encodeRecoveryTargetSpecificationV2(parseRecoveryTargetSpecificationV2(value))
    : encodeRecoveryTargetSpecificationV2(value);
  return sha256RecoveryBytes(bytes);
}

export function buildRecoveryTargetSpecificationV2(input: {
  operationId: string;
  generation: number;
  hostInstallationId: string;
  topologyMode: RecoveryTargetPreparationIdentity['topologyMode'];
  target: RecoveryPlanV2['target'];
  hostPolicyEnvelopeSha256: string;
  engineProfileEnvelopeSha256: string;
  storageInventoryEnvelopeSha256: string;
  protectionInventoryEnvelopeSha256: string;
  capacityEvidenceEnvelopeSha256: string;
}): RecoveryTargetSpecificationV2 {
  return specificationV2Schema.parse({
    format: RECOVERY_TARGET_SPECIFICATION_FORMAT_V2,
    operationId: recoveryUuid(input.operationId, 'operationId'),
    generation: input.generation,
    hostInstallationId: recoveryUuid(input.hostInstallationId, 'hostInstallationId'),
    topologyMode: input.topologyMode,
    targetLogicalIdentitySha256: recoveryTargetLogicalIdentitySha256(input.target),
    targetReleaseIdentitySha256: recoveryTargetReleaseIdentitySha256(input.target),
    hostPolicyEnvelopeSha256: recoveryDigest(input.hostPolicyEnvelopeSha256, 'hostPolicyEnvelopeSha256'),
    engineProfileEnvelopeSha256: recoveryDigest(input.engineProfileEnvelopeSha256, 'engineProfileEnvelopeSha256'),
    storageInventoryEnvelopeSha256: recoveryDigest(input.storageInventoryEnvelopeSha256, 'storageInventoryEnvelopeSha256'),
    protectionInventoryEnvelopeSha256: recoveryDigest(input.protectionInventoryEnvelopeSha256, 'protectionInventoryEnvelopeSha256'),
    capacityEvidenceEnvelopeSha256: recoveryDigest(input.capacityEvidenceEnvelopeSha256, 'capacityEvidenceEnvelopeSha256'),
  });
}

export function buildRecoveryTargetSpecification(input: {
  operationId: string;
  target: RecoveryPlanV2['target'];
  targetPreparation: Omit<RecoveryTargetPreparationIdentity, 'targetSpecificationSha256'>;
}): RecoveryTargetSpecification {
  return specificationSchema.parse({
    format: RECOVERY_TARGET_SPECIFICATION_FORMAT,
    operationId: recoveryUuid(input.operationId, 'operationId'),
    generation: input.targetPreparation.generation,
    hostInstallationId: recoveryUuid(input.targetPreparation.hostInstallationId, 'hostInstallationId'),
    topologyMode: input.targetPreparation.topologyMode,
    hostPolicySha256: recoveryDigest(input.targetPreparation.hostPolicySha256, 'hostPolicySha256'),
    helperRoleSha256: recoveryDigest(input.targetPreparation.helperRoleSha256, 'helperRoleSha256'),
    engineProfileSha256: recoveryDigest(input.targetPreparation.engineProfileSha256, 'engineProfileSha256'),
    protectionInventorySha256: recoveryDigest(input.targetPreparation.protectionInventorySha256, 'protectionInventorySha256'),
    capacityEvidenceSha256: recoveryDigest(input.targetPreparation.capacityEvidenceSha256, 'capacityEvidenceSha256'),
    storageInventorySha256: recoveryDigest(input.targetPreparation.storageInventorySha256, 'storageInventorySha256'),
    targetLogicalIdentitySha256: recoveryTargetLogicalIdentitySha256(input.target),
    targetReleaseIdentitySha256: recoveryTargetReleaseIdentitySha256(input.target),
  });
}

export function assertRecoveryTargetSpecification(input: {
  specification: RecoveryTargetSpecification;
  operationId: string;
  target: RecoveryPlanV2['target'];
  targetPreparation: Omit<RecoveryTargetPreparationIdentity, 'targetSpecificationSha256'>;
}): Buffer {
  const expected = buildRecoveryTargetSpecification(input);
  const actualBytes = encodeRecoveryTargetSpecification(input.specification);
  if (!actualBytes.equals(encodeRecoveryTargetSpecification(expected))) {
    throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_MISMATCH',
      'Target specification does not match the exact operation, target release, host, policy, or preparation evidence.');
  }
  return actualBytes;
}

export function assertTargetSpecificationMatchesPreparation(input: {
  specification: RecoveryTargetSpecification;
  operationId: string;
  target: RecoveryPlanV2['target'];
  preparation: RecoveryTargetPreparationIdentity & { targetSetId?: string };
}): void {
  const { targetSpecificationSha256: expectedSha256, targetSetId, ...preparation } = input.preparation;
  const bytes = assertRecoveryTargetSpecification({ specification: input.specification,
    operationId: input.operationId, target: input.target, targetPreparation: preparation });
  if (sha256RecoveryBytes(bytes) !== expectedSha256 ||
      (targetSetId !== undefined && recoveryTargetSetId(input.preparation) !== targetSetId)) {
    throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_MISMATCH',
      'Target specification digest or target-set binding differs from the plan preparation identity.');
  }
}
