import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RECOVERY_PLAN_FORMAT_V4, RECOVERY_TARGET_SET_DERIVATION_V2, RECOVERY_TARGET_TOPOLOGY_MODES,
  recoveryTargetSetIdV2, sha256RecoveryBytes, type RecoveryPlanV4 } from './contracts';
import { RecoveryError } from './errors';
import { parseRecoveryPlanFile } from './plan-file';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { verifyTargetAdmissionV2, verifyTargetDispositionV2, parseSignedTargetAuthorizationV2,
  targetAuthorizationV2BodySha256, type SignedRecoveryTargetAuthorizationV2,
  type TargetContractVerificationContextV2 } from './target-contracts-v2';
import { type TargetHelperJournalState } from './target-helper-journal';
import { encodeTargetHelperRequest, parseTargetHelperRequest, type TargetHelperRequest } from './target-helper-protocol';
import { encodeRecoveryTargetSpecificationV2, parseRecoveryTargetSpecificationV2,
  recoveryTargetLogicalIdentitySha256, recoveryTargetReleaseIdentitySha256,
  type RecoveryTargetSpecificationV2 } from './target-specification';
import { encodeSignedTargetOperationAttestation, parseSignedTargetOperationAttestation,
  targetOperationAttestationEnvelopeSha256, verifyTargetOperationAttestation,
  type SignedRecoveryTargetOperationAttestation } from './target-operation-attestation';
import { requireEffectEligibleInstalledIdentity, verifyTargetStorageContextV2ForLockedGateway,
  type RecoveryTargetInstalledIdentityAny, type VerifiedTargetStorageContextV2 } from './target-storage-authority';
import type { ProtectedTargetStorageEvidenceLoaderV2 } from './target-storage-evidence-v2';

export const RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT_V2 =
  'darshan-recovery-target-authorization-envelope-v2' as const;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const planIdentitySchema = z.object({
  format: z.literal(RECOVERY_PLAN_FORMAT_V4), planId: uuid, operationId: uuid, planSha256: digest,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/), sourceDescriptorSha256: digest,
  target: z.object({ targetId: z.literal(RELEASE_RECOVERY_TARGET.targetId), releaseId: z.literal(RELEASE_RECOVERY_TARGET.releaseId),
    terminalMigrationId: z.literal(RELEASE_RECOVERY_TARGET.terminalMigrationId),
    migrationManifestSha256: z.literal(RELEASE_RECOVERY_TARGET.migrationManifestSha256) }).strict(),
}).strict();
const preparationSchema = z.object({
  derivationVersion: z.literal(RECOVERY_TARGET_SET_DERIVATION_V2), targetSetId: digest,
  generation: z.number().int().positive().safe(), hostInstallationId: uuid,
  topologyMode: z.enum(RECOVERY_TARGET_TOPOLOGY_MODES), helperRoleSha256: digest,
  hostPolicyEnvelopeSha256: digest, engineProfileEnvelopeSha256: digest,
  storageInventoryEnvelopeSha256: digest, protectionInventoryEnvelopeSha256: digest,
  capacityEvidenceEnvelopeSha256: digest, targetSpecificationSha256: digest, operationAttestationSha256: digest,
}).strict();
const installationContextSchema = z.object({ specificationRootSha256: digest }).strict();
const outerSchema = z.object({
  format: z.literal(RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT_V2), request: z.unknown(), authorization: z.unknown(),
  targetSpecification: z.unknown(), operationAttestation: z.unknown(), plan: z.unknown(),
  planIdentity: planIdentitySchema, preparationIdentity: preparationSchema, installationContext: installationContextSchema,
}).strict();

export interface RecoveryTargetAuthorizationEnvelopeV2 {
  format: typeof RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT_V2;
  request: TargetHelperRequest;
  authorization: SignedRecoveryTargetAuthorizationV2;
  targetSpecification: RecoveryTargetSpecificationV2;
  operationAttestation: SignedRecoveryTargetOperationAttestation;
  plan: RecoveryPlanV4;
  planIdentity: z.infer<typeof planIdentitySchema>;
  preparationIdentity: z.infer<typeof preparationSchema>;
  installationContext: z.infer<typeof installationContextSchema>;
}

function planIdentity(plan: RecoveryPlanV4, planSha256: string): z.infer<typeof planIdentitySchema> {
  return planIdentitySchema.parse({ format: plan.format, planId: plan.planId, operationId: plan.operationId,
    planSha256, siteId: plan.source.siteId, sourceDescriptorSha256: plan.source.descriptorSha256, target: plan.target });
}

function normalize(value: RecoveryTargetAuthorizationEnvelopeV2): RecoveryTargetAuthorizationEnvelopeV2 {
  const plan = parseRecoveryPlanFile(canonicalJson(value.plan), value.planIdentity.planSha256);
  if (plan.format !== RECOVERY_PLAN_FORMAT_V4) throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Target envelope v2 requires plan v4.');
  return { format: RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT_V2,
    request: parseTargetHelperRequest(encodeTargetHelperRequest(value.request)),
    authorization: parseSignedTargetAuthorizationV2(canonicalJson(value.authorization)),
    targetSpecification: parseRecoveryTargetSpecificationV2(encodeRecoveryTargetSpecificationV2(value.targetSpecification)),
    operationAttestation: parseSignedTargetOperationAttestation(encodeSignedTargetOperationAttestation(value.operationAttestation)),
    plan, planIdentity: planIdentitySchema.parse(value.planIdentity),
    preparationIdentity: preparationSchema.parse(value.preparationIdentity),
    installationContext: installationContextSchema.parse(value.installationContext) };
}

export function encodeTargetAuthorizationEnvelopeV2(value: RecoveryTargetAuthorizationEnvelopeV2): Buffer {
  const normalized = normalize(value); assertIdentity(normalized); const bytes = canonicalJson(normalized);
  if (bytes.byteLength > 64 * 1024) throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target envelope v2 exceeds 64 KiB.');
  return bytes;
}

export function parseTargetAuthorizationEnvelopeV2(bytes: Uint8Array): RecoveryTargetAuthorizationEnvelopeV2 {
  try {
    const source = Buffer.from(bytes); const outer = outerSchema.parse(parseStrictJson(source, 64 * 1024));
    const plan = parseRecoveryPlanFile(canonicalJson(outer.plan), outer.planIdentity.planSha256);
    if (plan.format !== RECOVERY_PLAN_FORMAT_V4) throw new Error('plan is not v4');
    const value: RecoveryTargetAuthorizationEnvelopeV2 = { format: outer.format,
      request: parseTargetHelperRequest(canonicalJson(outer.request)),
      authorization: parseSignedTargetAuthorizationV2(canonicalJson(outer.authorization)),
      targetSpecification: parseRecoveryTargetSpecificationV2(canonicalJson(outer.targetSpecification)),
      operationAttestation: parseSignedTargetOperationAttestation(canonicalJson(outer.operationAttestation)),
      plan, planIdentity: outer.planIdentity, preparationIdentity: outer.preparationIdentity,
      installationContext: outer.installationContext };
    if (!encodeTargetAuthorizationEnvelopeV2(value).equals(source)) throw new Error('non-canonical envelope v2');
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target envelope v2 is invalid.', { cause });
  }
}

export function createTargetAuthorizationEnvelopeV2(input: {
  request: TargetHelperRequest; authorization: Uint8Array | SignedRecoveryTargetAuthorizationV2;
  targetSpecification: Uint8Array | RecoveryTargetSpecificationV2;
  operationAttestation: Uint8Array | SignedRecoveryTargetOperationAttestation;
  plan: RecoveryPlanV4; planSha256: string; specificationRootSha256: string;
}): RecoveryTargetAuthorizationEnvelopeV2 {
  const value: RecoveryTargetAuthorizationEnvelopeV2 = { format: RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT_V2,
    request: input.request,
    authorization: input.authorization instanceof Uint8Array
      ? parseSignedTargetAuthorizationV2(input.authorization) : input.authorization,
    targetSpecification: input.targetSpecification instanceof Uint8Array
      ? parseRecoveryTargetSpecificationV2(input.targetSpecification) : input.targetSpecification,
    operationAttestation: input.operationAttestation instanceof Uint8Array
      ? parseSignedTargetOperationAttestation(input.operationAttestation) : input.operationAttestation,
    plan: input.plan, planIdentity: planIdentity(input.plan, input.planSha256),
    preparationIdentity: input.plan.targetPreparation,
    installationContext: installationContextSchema.parse({ specificationRootSha256: input.specificationRootSha256 }) };
  assertIdentity(value); return value;
}

function attestationExpected(value: RecoveryTargetAuthorizationEnvelopeV2) {
  const preparation = value.preparationIdentity;
  return { operationId: value.plan.operationId, siteId: value.plan.source.siteId, generation: preparation.generation,
    hostInstallationId: preparation.hostInstallationId, targetSetId: preparation.targetSetId,
    targetSpecificationSha256: preparation.targetSpecificationSha256,
    targetLogicalIdentitySha256: recoveryTargetLogicalIdentitySha256(value.plan.target),
    targetReleaseIdentitySha256: recoveryTargetReleaseIdentitySha256(value.plan.target),
    hostPolicyEnvelopeSha256: preparation.hostPolicyEnvelopeSha256,
    engineProfileEnvelopeSha256: preparation.engineProfileEnvelopeSha256,
    storageInventoryEnvelopeSha256: preparation.storageInventoryEnvelopeSha256,
    protectionInventoryEnvelopeSha256: preparation.protectionInventoryEnvelopeSha256,
    capacityEvidenceEnvelopeSha256: preparation.capacityEvidenceEnvelopeSha256 };
}

function assertIdentity(value: RecoveryTargetAuthorizationEnvelopeV2): void {
  const request = value.request; const preparation = value.preparationIdentity;
  const expectedPlan = planIdentity(value.plan, value.planIdentity.planSha256);
  const expectedAttestation = attestationExpected(value); const attestation = value.operationAttestation.attestation;
  if (!canonicalJson(expectedPlan).equals(canonicalJson(value.planIdentity)) ||
      !canonicalJson(value.plan.targetPreparation).equals(canonicalJson(preparation)) ||
      request.operationId !== value.plan.operationId || request.siteId !== value.plan.source.siteId ||
      request.planSha256 !== value.planIdentity.planSha256 || request.hostInstallationId !== preparation.hostInstallationId ||
      request.targetSetId !== preparation.targetSetId || request.generation !== preparation.generation ||
      request.targetSpecificationSha256 !== preparation.targetSpecificationSha256 ||
      targetAuthorizationV2BodySha256(value.authorization) !== request.authorizationSha256 ||
      targetOperationAttestationEnvelopeSha256(value.operationAttestation) !== preparation.operationAttestationSha256 ||
      sha256RecoveryBytes(encodeRecoveryTargetSpecificationV2(value.targetSpecification)) !== preparation.targetSpecificationSha256 ||
      recoveryTargetSetIdV2({ operationId: value.plan.operationId, generation: preparation.generation,
        hostInstallationId: preparation.hostInstallationId,
        targetSpecificationSha256: preparation.targetSpecificationSha256 }) !== preparation.targetSetId ||
      Object.entries(expectedAttestation).some(([key, expected]) => attestation[key as keyof typeof attestation] !== expected) ||
      Object.entries(value.targetSpecification).some(([key, actual]) => key === 'format' ? false :
        expectedAttestation[key as keyof typeof expectedAttestation] !== undefined &&
        expectedAttestation[key as keyof typeof expectedAttestation] !== actual)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Target envelope v2 identity chain differs.');
  }
  const specification = value.targetSpecification;
  if (specification.operationId !== value.plan.operationId || specification.generation !== preparation.generation ||
      specification.hostInstallationId !== preparation.hostInstallationId || specification.topologyMode !== preparation.topologyMode ||
      specification.targetLogicalIdentitySha256 !== expectedAttestation.targetLogicalIdentitySha256 ||
      specification.targetReleaseIdentitySha256 !== expectedAttestation.targetReleaseIdentitySha256 ||
      specification.hostPolicyEnvelopeSha256 !== preparation.hostPolicyEnvelopeSha256 ||
      specification.engineProfileEnvelopeSha256 !== preparation.engineProfileEnvelopeSha256 ||
      specification.storageInventoryEnvelopeSha256 !== preparation.storageInventoryEnvelopeSha256 ||
      specification.protectionInventoryEnvelopeSha256 !== preparation.protectionInventoryEnvelopeSha256 ||
      specification.capacityEvidenceEnvelopeSha256 !== preparation.capacityEvidenceEnvelopeSha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Target specification v2 differs from the plan chain.');
  }
}

function verificationContext(value: RecoveryTargetAuthorizationEnvelopeV2, input: {
  keys: ReadonlyMap<string, string>; revokedKeyIds?: ReadonlySet<string>; now: Date;
}): TargetContractVerificationContextV2 {
  return { ...input, expected: { operationId: value.plan.operationId, siteId: value.plan.source.siteId,
    hostInstallationId: value.preparationIdentity.hostInstallationId, planSha256: value.planIdentity.planSha256,
    targetSetId: value.preparationIdentity.targetSetId, generation: value.preparationIdentity.generation,
    targetSpecificationSha256: value.preparationIdentity.targetSpecificationSha256,
    operationAttestationSha256: value.preparationIdentity.operationAttestationSha256 } };
}

export function verifyTargetAuthorizationEnvelopeV2Screen(value: RecoveryTargetAuthorizationEnvelopeV2, input: {
  keys: ReadonlyMap<string, string>; attestationKeys: ReadonlyMap<string, string>;
  revokedKeyIds?: ReadonlySet<string>; now: Date; installedIdentity: RecoveryTargetInstalledIdentityAny;
}): void {
  assertIdentity(value); const installed = requireEffectEligibleInstalledIdentity(input.installedIdentity);
  const preparation = value.preparationIdentity;
  if (value.plan.source.siteId !== installed.siteId || preparation.hostInstallationId !== installed.hostInstallationId ||
      preparation.helperRoleSha256 !== installed.helperRoleSha256 ||
      value.installationContext.specificationRootSha256 !== installed.specificationRootSha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Target envelope v2 differs from installed helper identity.');
  }
  verifyTargetOperationAttestation({ bytes: canonicalJson(value.operationAttestation), keys: input.attestationKeys,
    revokedKeyIds: input.revokedKeyIds, now: input.now });
  const bytes = canonicalJson(value.authorization); const operation = value.request.operation;
  if ('admission' in value.authorization) {
    if (operation === 'STOP_RETAIN' || operation === 'RETIRE') throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Disposition is required.');
    verifyTargetAdmissionV2(bytes, verificationContext(value, input), operation);
  } else {
    if (operation !== 'INSPECT' && operation !== value.authorization.decision.action) {
      throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Disposition v2 action differs.');
    }
    verifyTargetDispositionV2(bytes, verificationContext(value, input), operation === 'INSPECT' ? undefined : operation);
  }
}

function hasPreparedReceipt(state: Readonly<TargetHelperJournalState>, preparedReceiptSha256: string): boolean {
  return state.replay.some((entry) => entry.response.ok && entry.response.operation === 'PREPARE' &&
    entry.response.state === 'READY' && entry.response.pendingAction === null &&
    sha256RecoveryBytes(canonicalJson(entry.response)) === preparedReceiptSha256);
}

function exactDurableDisposition(state: Readonly<TargetHelperJournalState>, request: TargetHelperRequest): boolean {
  const requestSha256 = sha256RecoveryBytes(canonicalJson(request));
  if (state.pendingRequestId === request.requestId) {
    return state.pendingAction === request.operation && state.pendingRequestSha256 === requestSha256;
  }
  const replay = state.replay.find((entry) => entry.requestId === request.requestId);
  return replay !== undefined && replay.requestSha256 === requestSha256 &&
    replay.response.operation === request.operation && replay.response.authorizationSha256 === request.authorizationSha256;
}

function exactRejectedDisposition(state: Readonly<TargetHelperJournalState>,
  value: RecoveryTargetAuthorizationEnvelopeV2, expectedHelperSequence: number): boolean {
  const authorization = value.authorization;
  if ('admission' in authorization) return false;
  const decision = authorization.decision;
  return state.replay.some((entry) => {
    if (entry.response.ok || entry.response.operation !== decision.action ||
        entry.response.authorizationSha256 !== value.request.authorizationSha256) return false;
    const reconstructed: TargetHelperRequest = { ...value.request, requestId: entry.requestId,
      operation: decision.action, expectedHelperSequence };
    return entry.requestSha256 === sha256RecoveryBytes(canonicalJson(reconstructed)) &&
      entry.response.helperSequence === state.helperSequence;
  });
}

export async function verifyTargetAuthorizationEnvelopeV2Locked(value: RecoveryTargetAuthorizationEnvelopeV2, input: {
  keys: ReadonlyMap<string, string>; attestationKeys: ReadonlyMap<string, string>;
  revokedKeyIds?: ReadonlySet<string>; now: Date; installedIdentity: RecoveryTargetInstalledIdentityAny;
  evidenceLoader: ProtectedTargetStorageEvidenceLoaderV2; state?: Readonly<TargetHelperJournalState>; signal?: AbortSignal;
  recheckNow?: () => Date; deadline?: Date;
}): Promise<VerifiedTargetStorageContextV2> {
  verifyTargetAuthorizationEnvelopeV2Screen(value, input);
  if ('decision' in value.authorization) {
    const state = input.state; const decision = value.authorization.decision;
    const operation = value.request.operation;
    if (!state || (operation !== 'INSPECT' && value.request.expectedHelperSequence !== decision.expectedHelperSequence) ||
        !hasPreparedReceipt(state, decision.preparedReceiptSha256)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Disposition v2 lacks its exact prepared receipt, sequence, and request binding.');
    }
    const pristine = state.state === decision.expectedTargetState && state.pendingAction === null &&
      state.helperSequence === decision.expectedHelperSequence && state.lastReceiptSha256 === decision.preparedReceiptSha256;
    const durable = operation !== 'INSPECT' && exactDurableDisposition(state, value.request);
    const rejected = operation === 'INSPECT' && state.pendingAction === null &&
      exactRejectedDisposition(state, value, decision.expectedHelperSequence);
    if (!pristine && !durable && !rejected) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Disposition v2 is neither pristine nor an exact durable/rejected replay.');
    }
  }
  const preparation = value.preparationIdentity; const specification = value.targetSpecification;
  const storage = await verifyTargetStorageContextV2ForLockedGateway({ installedIdentity: input.installedIdentity,
    loader: input.evidenceLoader, capacityEvidenceEnvelopeSha256: preparation.capacityEvidenceEnvelopeSha256,
    expected: { siteId: value.plan.source.siteId, hostInstallationId: preparation.hostInstallationId,
      operationId: value.plan.operationId, generation: String(preparation.generation),
      targetReleaseIdentitySha256: specification.targetReleaseIdentitySha256,
      targetLogicalIdentitySha256: specification.targetLogicalIdentitySha256,
      topologyMode: specification.topologyMode,
      hostPolicyEnvelopeSha256: preparation.hostPolicyEnvelopeSha256,
      engineProfileEnvelopeSha256: preparation.engineProfileEnvelopeSha256,
      storageInventoryEnvelopeSha256: preparation.storageInventoryEnvelopeSha256,
      protectionInventoryEnvelopeSha256: preparation.protectionInventoryEnvelopeSha256 },
    now: input.now, signal: input.signal });
  const freshNow = (input.recheckNow ?? (() => input.now))();
  verifyTargetAuthorizationEnvelopeV2Screen(value, { ...input, now: freshNow });
  const freshTime = freshNow.getTime();
  for (const evidence of [storage.evidence.hostPolicy, storage.evidence.engineProfile,
    storage.evidence.storageInventory, storage.evidence.protectionInventory, storage.evidence.capacityEvidence]) {
    if (freshTime < Date.parse(evidence.validFrom) || freshTime >= Date.parse(evidence.expiresAt)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED',
        'Storage evidence v2 expired while the locked chain was loading.');
    }
  }
  input.signal?.throwIfAborted();
  if (input.deadline && freshTime >= input.deadline.getTime()) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED',
      'Target authorization deadline expired while the locked chain was loading.');
  }
  return storage;
}
