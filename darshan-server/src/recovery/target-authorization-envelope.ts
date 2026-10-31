import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../backups/backup-broker-protocol';
import { RECOVERY_PLAN_FORMAT_V3, RECOVERY_TARGET_TOPOLOGY_MODES, sha256RecoveryBytes,
  type RecoveryPlanV3 } from './contracts';
import { RecoveryError } from './errors';
import { parseRecoveryPlanFile } from './plan-file';
import { RELEASE_RECOVERY_TARGET } from './release-target';
import { parseSignedTargetAuthorization, targetAuthorizationBodySha256, verifyTargetAdmission,
  verifyTargetDisposition, type SignedRecoveryTargetAuthorization,
  type RecoveryTargetDispositionDecision, type TargetContractVerificationContext } from './target-contracts';
import { type TargetHelperJournalState } from './target-helper-journal';
import { encodeTargetHelperRequest, parseTargetHelperRequest, type TargetHelperRequest } from './target-helper-protocol';
import { RecoveryTargetHelperService, type RecoveryTargetAuthorizationFreshness } from './target-helper-service';
import { assertTargetSpecificationMatchesPreparation, encodeRecoveryTargetSpecification,
  parseRecoveryTargetSpecification, type RecoveryTargetSpecification } from './target-specification';
import { parseTargetAuthorizationEnvelopeV2, verifyTargetAuthorizationEnvelopeV2Locked,
  verifyTargetAuthorizationEnvelopeV2Screen } from './target-authorization-envelope-v2';
import type { RecoveryTargetInstalledIdentityAny, VerifiedTargetStorageContextV2 } from './target-storage-authority';
import type { ProtectedTargetStorageEvidenceLoaderV2 } from './target-storage-evidence-v2';

export const RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT =
  'darshan-recovery-target-authorization-envelope-v1' as const;
export const RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_MAX_BYTES = 64 * 1024;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const planIdentitySchema = z.object({
  format: z.literal(RECOVERY_PLAN_FORMAT_V3),
  planId: uuid,
  operationId: uuid,
  planSha256: digest,
  siteId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/),
  sourceDescriptorSha256: digest,
  target: z.object({
    targetId: z.literal(RELEASE_RECOVERY_TARGET.targetId),
    releaseId: z.literal(RELEASE_RECOVERY_TARGET.releaseId),
    terminalMigrationId: z.literal(RELEASE_RECOVERY_TARGET.terminalMigrationId),
    migrationManifestSha256: z.literal(RELEASE_RECOVERY_TARGET.migrationManifestSha256),
  }).strict(),
}).strict();
const preparationIdentitySchema = z.object({
  targetSetId: digest,
  generation: z.number().int().positive().safe(),
  hostInstallationId: uuid,
  topologyMode: z.enum(RECOVERY_TARGET_TOPOLOGY_MODES),
  hostPolicySha256: digest,
  helperRoleSha256: digest,
  engineProfileSha256: digest,
  protectionInventorySha256: digest,
  capacityEvidenceSha256: digest,
  storageInventorySha256: digest,
  targetSpecificationSha256: digest,
}).strict();
const installationContextSchema = z.object({ specificationRootSha256: digest }).strict();
const outerSchema = z.object({
  format: z.literal(RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT),
  request: z.unknown(),
  authorization: z.unknown(),
  targetSpecification: z.unknown(),
  plan: z.unknown(),
  planIdentity: planIdentitySchema,
  preparationIdentity: preparationIdentitySchema,
  installationContext: installationContextSchema,
}).strict();

export type RecoveryTargetPlanPublicIdentity = z.infer<typeof planIdentitySchema>;
export type RecoveryTargetPreparationPublicIdentity = z.infer<typeof preparationIdentitySchema>;
export interface RecoveryTargetAuthorizationEnvelope {
  format: typeof RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT;
  request: TargetHelperRequest;
  authorization: SignedRecoveryTargetAuthorization;
  targetSpecification: RecoveryTargetSpecification;
  plan: RecoveryPlanV3;
  planIdentity: RecoveryTargetPlanPublicIdentity;
  preparationIdentity: RecoveryTargetPreparationPublicIdentity;
  installationContext: z.infer<typeof installationContextSchema>;
}

export interface RecoveryTargetInstalledIdentity {
  siteId: string;
  hostInstallationId: string;
  hostPolicySha256: string;
  helperRoleSha256: string;
  engineProfileSha256: string;
  specificationRootSha256: string;
}

export function targetPlanPublicIdentity(plan: RecoveryPlanV3, planSha256: string): RecoveryTargetPlanPublicIdentity {
  return planIdentitySchema.parse({ format: plan.format, planId: plan.planId, operationId: plan.operationId,
    planSha256, siteId: plan.source.siteId, sourceDescriptorSha256: plan.source.descriptorSha256, target: plan.target });
}

export function encodeTargetAuthorizationEnvelope(value: RecoveryTargetAuthorizationEnvelope): Buffer {
  const normalized: RecoveryTargetAuthorizationEnvelope = {
    format: RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT,
    request: parseTargetHelperRequest(encodeTargetHelperRequest(value.request)),
    authorization: parseSignedTargetAuthorization(canonicalJson(value.authorization)),
    targetSpecification: parseRecoveryTargetSpecification(encodeRecoveryTargetSpecification(value.targetSpecification)),
    plan: parseRecoveryPlanFile(canonicalJson(value.plan), value.planIdentity.planSha256) as RecoveryPlanV3,
    planIdentity: planIdentitySchema.parse(value.planIdentity),
    preparationIdentity: preparationIdentitySchema.parse(value.preparationIdentity),
    installationContext: installationContextSchema.parse(value.installationContext),
  };
  const bytes = canonicalJson(normalized);
  if (bytes.byteLength > RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_MAX_BYTES) {
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID', 'Target authorization envelope exceeds 64 KiB.');
  }
  return bytes;
}

export function parseTargetAuthorizationEnvelope(bytes: Uint8Array): RecoveryTargetAuthorizationEnvelope {
  try {
    const buffer = Buffer.from(bytes);
    const outer = outerSchema.parse(parseStrictJson(buffer, RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_MAX_BYTES));
    const value: RecoveryTargetAuthorizationEnvelope = {
      format: outer.format,
      request: parseTargetHelperRequest(canonicalJson(outer.request)),
      authorization: parseSignedTargetAuthorization(canonicalJson(outer.authorization)),
      targetSpecification: parseRecoveryTargetSpecification(canonicalJson(outer.targetSpecification)),
      plan: parseRecoveryPlanFile(canonicalJson(outer.plan), outer.planIdentity.planSha256) as RecoveryPlanV3,
      planIdentity: outer.planIdentity,
      preparationIdentity: outer.preparationIdentity,
      installationContext: outer.installationContext,
    };
    if (!encodeTargetAuthorizationEnvelope(value).equals(buffer)) throw new Error('non-canonical authorization envelope');
    assertEnvelopeIdentity(value);
    return value;
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    throw new RecoveryError('RECOVERY_TARGET_PROTOCOL_INVALID',
      'Target authorization envelope is not strict canonical bounded JSON.', { cause });
  }
}

export function createTargetAuthorizationEnvelope(input: {
  request: TargetHelperRequest;
  authorization: Uint8Array | SignedRecoveryTargetAuthorization;
  targetSpecification: Uint8Array | RecoveryTargetSpecification;
  plan: RecoveryPlanV3;
  planSha256: string;
  specificationRootSha256: string;
}): RecoveryTargetAuthorizationEnvelope {
  const value: RecoveryTargetAuthorizationEnvelope = {
    format: RECOVERY_TARGET_AUTHORIZATION_ENVELOPE_FORMAT,
    request: input.request,
    authorization: input.authorization instanceof Uint8Array
      ? parseSignedTargetAuthorization(input.authorization) : input.authorization,
    targetSpecification: input.targetSpecification instanceof Uint8Array
      ? parseRecoveryTargetSpecification(input.targetSpecification) : input.targetSpecification,
    plan: input.plan,
    planIdentity: targetPlanPublicIdentity(input.plan, input.planSha256),
    preparationIdentity: input.plan.targetPreparation,
    installationContext: installationContextSchema.parse({ specificationRootSha256: input.specificationRootSha256 }),
  };
  assertEnvelopeIdentity(value);
  return value;
}

function assertEnvelopeIdentity(value: RecoveryTargetAuthorizationEnvelope): void {
  const request = value.request; const plan = value.planIdentity; const preparation = value.preparationIdentity;
  const expectedPlanIdentity = targetPlanPublicIdentity(value.plan, plan.planSha256);
  if (request.operationId !== plan.operationId || request.siteId !== plan.siteId || request.planSha256 !== plan.planSha256 ||
      request.targetSetId !== preparation.targetSetId || request.generation !== preparation.generation ||
      request.hostInstallationId !== preparation.hostInstallationId ||
      request.targetSpecificationSha256 !== preparation.targetSpecificationSha256 ||
      value.targetSpecification.operationId !== request.operationId ||
      !canonicalJson(expectedPlanIdentity).equals(canonicalJson(plan)) ||
      !canonicalJson(value.plan.targetPreparation).equals(canonicalJson(preparation)) ||
      targetAuthorizationBodySha256(value.authorization) !== request.authorizationSha256) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Target envelope request, authorization, specification, plan, or preparation identity differs.');
  }
  assertTargetSpecificationMatchesPreparation({ specification: value.targetSpecification,
    operationId: plan.operationId, target: plan.target, preparation });
}

function verificationContext(value: RecoveryTargetAuthorizationEnvelope, input: {
  keys: ReadonlyMap<string, string>; revokedKeyIds?: ReadonlySet<string>; now: Date;
}): TargetContractVerificationContext {
  return { keys: input.keys, revokedKeyIds: input.revokedKeyIds, now: input.now, expected: {
    operationId: value.planIdentity.operationId, siteId: value.planIdentity.siteId,
    hostInstallationId: value.preparationIdentity.hostInstallationId,
    planSha256: value.planIdentity.planSha256, targetSetId: value.preparationIdentity.targetSetId,
    generation: value.preparationIdentity.generation,
    targetSpecificationSha256: value.preparationIdentity.targetSpecificationSha256,
  } };
}

function hasPreparedReceiptEvidence(state: Readonly<TargetHelperJournalState>,
  decision: RecoveryTargetDispositionDecision): boolean {
  return state.replay.some((entry) => entry.response.ok && entry.response.operation === 'PREPARE' &&
    entry.response.state === 'READY' && entry.response.pendingAction === null &&
    sha256RecoveryBytes(canonicalJson(entry.response)) === decision.preparedReceiptSha256);
}

function exactDurableDispositionRequest(state: Readonly<TargetHelperJournalState>,
  request: TargetHelperRequest): boolean {
  const requestSha256 = sha256RecoveryBytes(canonicalJson(request));
  if (state.pendingRequestId === request.requestId) {
    return state.pendingAction === request.operation && state.pendingRequestSha256 === requestSha256;
  }
  const replay = state.replay.find((entry) => entry.requestId === request.requestId);
  return replay !== undefined && replay.requestSha256 === requestSha256 &&
    replay.response.operation === request.operation && replay.response.authorizationSha256 === request.authorizationSha256;
}

function exactRejectedDispositionEvidence(state: Readonly<TargetHelperJournalState>,
  value: RecoveryTargetAuthorizationEnvelope, action: 'STOP_RETAIN' | 'RETIRE', expectedHelperSequence: number): boolean {
  return state.replay.some((entry) => {
    if (entry.response.ok || entry.response.operation !== action ||
        entry.response.authorizationSha256 !== value.request.authorizationSha256) return false;
    const reconstructed: TargetHelperRequest = { ...value.request, requestId: entry.requestId, operation: action,
      expectedHelperSequence };
    return entry.requestSha256 === sha256RecoveryBytes(canonicalJson(reconstructed)) &&
      entry.response.helperSequence === state.helperSequence;
  });
}

function verifyAuthorization(value: RecoveryTargetAuthorizationEnvelope, input: {
  keys: ReadonlyMap<string, string>; revokedKeyIds?: ReadonlySet<string>; now: Date;
  state?: Readonly<TargetHelperJournalState>;
  locked?: boolean;
  installedIdentity?: RecoveryTargetInstalledIdentity;
}): void {
  assertEnvelopeIdentity(value);
  const installed = input.installedIdentity;
  if (installed && (value.planIdentity.siteId !== installed.siteId ||
      value.preparationIdentity.hostInstallationId !== installed.hostInstallationId ||
      value.preparationIdentity.hostPolicySha256 !== installed.hostPolicySha256 ||
      value.preparationIdentity.helperRoleSha256 !== installed.helperRoleSha256 ||
      value.preparationIdentity.engineProfileSha256 !== installed.engineProfileSha256 ||
      value.targetSpecification.hostInstallationId !== installed.hostInstallationId ||
      value.targetSpecification.hostPolicySha256 !== installed.hostPolicySha256 ||
      value.targetSpecification.helperRoleSha256 !== installed.helperRoleSha256 ||
      value.targetSpecification.engineProfileSha256 !== installed.engineProfileSha256 ||
      value.installationContext.specificationRootSha256 !== installed.specificationRootSha256)) {
    throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
      'Target authorization does not match the fixed installed helper identity.');
  }
  const bytes = canonicalJson(value.authorization); const operation = value.request.operation;
  if ('admission' in value.authorization) {
    if (operation === 'STOP_RETAIN' || operation === 'RETIRE') {
      throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Target mutation requires a disposition authorization.');
    }
    verifyTargetAdmission(bytes, verificationContext(value, input), operation);
  } else {
    if (operation !== 'INSPECT' && operation !== value.authorization.decision.action) {
      throw new RecoveryError('RECOVERY_TARGET_ACTION_NOT_ALLOWED', 'Disposition permits only its exact INSPECT evidence and mutation.');
    }
    const signed = verifyTargetDisposition(bytes, verificationContext(value, input),
      operation === 'INSPECT' ? undefined : operation);
    if (input.locked) {
      const state = input.state; const decision = signed.decision;
      if (!state || (operation !== 'INSPECT' && value.request.expectedHelperSequence !== decision.expectedHelperSequence) ||
          !hasPreparedReceiptEvidence(state, decision)) {
        throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
          'Disposition lacks its exact original prepared receipt, sequence, and request binding.');
      }
      const pristine = state.state === decision.expectedTargetState && state.pendingAction === null &&
        state.helperSequence === decision.expectedHelperSequence && state.lastReceiptSha256 === decision.preparedReceiptSha256;
      const exactDurable = operation !== 'INSPECT' && exactDurableDispositionRequest(state, value.request);
      const rejectedResolution = operation === 'INSPECT' && state.pendingAction === null &&
        exactRejectedDispositionEvidence(state, value, decision.action, decision.expectedHelperSequence);
      if (!pristine && !exactDurable && !rejectedResolution) {
        throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
          'Disposition is neither a pristine new mutation nor an exact durable replay/reconciliation request.');
      }
    }
  }
}

/** Public-key-only production gateway. Signing and private-key loading are deliberately absent. */
export class RecoveryTargetAuthorizationGateway {
  constructor(private readonly options: {
    service: RecoveryTargetHelperService;
    keys: ReadonlyMap<string, string>;
    revokedKeyIds?: ReadonlySet<string>;
    now?: () => Date;
    installedIdentity?: RecoveryTargetInstalledIdentity | RecoveryTargetInstalledIdentityAny;
    evidenceLoaderV2?: ProtectedTargetStorageEvidenceLoaderV2;
    attestationKeys?: ReadonlyMap<string, string>;
  }) {}

  async handle(bytes: Uint8Array, execution?: { deadline?: Date; signal?: AbortSignal }): Promise<Buffer> {
    const outer = parseStrictJson(Buffer.from(bytes), 256 * 1024) as { format?: unknown };
    if (outer?.format === 'darshan-recovery-target-authorization-envelope-v2') {
      if (!this.options.installedIdentity || !('format' in this.options.installedIdentity) ||
          !this.options.evidenceLoaderV2 || !this.options.attestationKeys) {
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
          'Target envelope v2 requires installed identity v2, attestation trust, and protected evidence loading.');
      }
      const envelope = parseTargetAuthorizationEnvelopeV2(bytes); const now = this.options.now ?? (() => new Date());
      let verifiedStorage: VerifiedTargetStorageContextV2 | undefined;
      const beforeDispatch = (_request: TargetHelperRequest, _state: Readonly<TargetHelperJournalState> | undefined,
        freshness: RecoveryTargetAuthorizationFreshness): VerifiedTargetStorageContextV2 => {
        const freshNow = now(); freshness.signal.throwIfAborted();
        if (freshNow.getTime() >= freshness.deadline.getTime()) {
          throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Target authorization expired before dispatch.');
        }
        verifyTargetAuthorizationEnvelopeV2Screen(envelope, { keys: this.options.keys,
          attestationKeys: this.options.attestationKeys!, revokedKeyIds: this.options.revokedKeyIds,
          now: freshNow, installedIdentity: this.options.installedIdentity as RecoveryTargetInstalledIdentityAny });
        if (!verifiedStorage) {
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Locked v2 storage context is absent before dispatch.');
        }
        for (const evidence of [verifiedStorage.evidence.hostPolicy, verifiedStorage.evidence.engineProfile,
          verifiedStorage.evidence.storageInventory, verifiedStorage.evidence.protectionInventory,
          verifiedStorage.evidence.capacityEvidence]) {
          if (freshNow.getTime() < Date.parse(evidence.validFrom) || freshNow.getTime() >= Date.parse(evidence.expiresAt)) {
            throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Storage evidence v2 expired before dispatch.');
          }
        }
        return verifiedStorage;
      };
      const assertFresh = (freshness: RecoveryTargetAuthorizationFreshness): void => {
        const freshNow = now(); freshness.signal.throwIfAborted();
        if (freshNow.getTime() >= freshness.deadline.getTime()) {
          throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Target authorization expired during target execution.');
        }
        verifyTargetAuthorizationEnvelopeV2Screen(envelope, { keys: this.options.keys,
          attestationKeys: this.options.attestationKeys!, revokedKeyIds: this.options.revokedKeyIds,
          now: freshNow, installedIdentity: this.options.installedIdentity as RecoveryTargetInstalledIdentityAny });
        if (!verifiedStorage) {
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Locked v2 storage context is absent during execution.');
        }
        for (const evidence of [verifiedStorage.evidence.hostPolicy, verifiedStorage.evidence.engineProfile,
          verifiedStorage.evidence.storageInventory, verifiedStorage.evidence.protectionInventory,
          verifiedStorage.evidence.capacityEvidence]) {
          if (freshNow.getTime() < Date.parse(evidence.validFrom) || freshNow.getTime() >= Date.parse(evidence.expiresAt)) {
            throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Storage evidence v2 expired during target execution.');
          }
        }
      };
      return this.options.service.handle(encodeTargetHelperRequest(envelope.request), {
        screen: (_request, freshness) => {
          const freshNow = now(); freshness.signal.throwIfAborted();
          if (freshNow.getTime() >= freshness.deadline.getTime()) {
            throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Target authorization deadline expired before screening.');
          }
          verifyTargetAuthorizationEnvelopeV2Screen(envelope, { keys: this.options.keys,
            attestationKeys: this.options.attestationKeys!, revokedKeyIds: this.options.revokedKeyIds,
            now: freshNow, installedIdentity: this.options.installedIdentity as RecoveryTargetInstalledIdentityAny });
        },
        locked: async (_request, state, freshness) => {
          verifiedStorage = await verifyTargetAuthorizationEnvelopeV2Locked(envelope, { keys: this.options.keys,
            attestationKeys: this.options.attestationKeys!, revokedKeyIds: this.options.revokedKeyIds,
            now: now(), recheckNow: now, deadline: freshness.deadline,
            installedIdentity: this.options.installedIdentity as RecoveryTargetInstalledIdentityAny,
            evidenceLoader: this.options.evidenceLoaderV2!, state, signal: freshness.signal });
          return verifiedStorage;
        },
        beforeDispatch,
        assertFresh,
      }, { requestBody: bytes, deadline: execution?.deadline, signal: execution?.signal });
    }
    const envelope = parseTargetAuthorizationEnvelope(bytes);
    const now = this.options.now ?? (() => new Date());
    return this.options.service.handle(encodeTargetHelperRequest(envelope.request), {
      screen: () => {
        if (this.options.installedIdentity && 'format' in this.options.installedIdentity) {
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
            'Historical plan v3 and authorization envelope v1 are readable but cannot reach installed target inspection or effect.');
        }
        verifyAuthorization(envelope, { keys: this.options.keys,
          revokedKeyIds: this.options.revokedKeyIds, now: now(), installedIdentity: this.options.installedIdentity });
      },
      locked: (_request, state) => verifyAuthorization(envelope, { keys: this.options.keys,
        revokedKeyIds: this.options.revokedKeyIds, now: now(), state, locked: true,
        installedIdentity: this.options.installedIdentity }),
    }, { requestBody: bytes, deadline: execution?.deadline, signal: execution?.signal });
  }
}

export function targetAuthorizationEnvelopeSha256(value: RecoveryTargetAuthorizationEnvelope): string {
  return sha256RecoveryBytes(encodeTargetAuthorizationEnvelope(value));
}
