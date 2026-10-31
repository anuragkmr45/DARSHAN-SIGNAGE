import { join } from 'node:path';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { RECOVERY_PLAN_FORMAT_V4, sha256RecoveryBytes, type RecoveryPlanV3, type RecoveryPlanV4 } from './contracts';
import { RecoveryError } from './errors';
import type { RecoveryJournal } from './journal';
import { loadRecoveryPublicKeyring, readProtectedOperatorFile,
  type RecoveryOperatorConfigV3 } from './operator-inputs';
import { parseRecoveryPlanFile } from './plan-file';
import { RecoveryTargetClient, type RecoveryTargetTransport } from './target-client';
import { createTargetAuthorizationEnvelope, encodeTargetAuthorizationEnvelope } from './target-authorization-envelope';
import { createTargetAuthorizationEnvelopeV2, encodeTargetAuthorizationEnvelopeV2 } from './target-authorization-envelope-v2';
import { MAX_TARGET_CONTRACT_BYTES } from './target-contracts';
import { parseSignedTargetAuthorizationV2 } from './target-contracts-v2';
import { parseTargetHelperRequest } from './target-helper-protocol';
import { TargetUnixClient } from './target-unix-client';
import { RECOVERY_TARGET_SPECIFICATION_MAX_BYTES, parseRecoveryTargetSpecificationV2,
  recoveryTargetLogicalIdentitySha256, recoveryTargetReleaseIdentitySha256 } from './target-specification';
import { parseSignedTargetOperationAttestation,
  targetOperationAttestationEnvelopeSha256 } from './target-operation-attestation';
import { RecoveryTargetWorkflow } from './target-workflow';

type TargetControllerAction = 'prepare' | 'inspect' | 'disposition';

function fixedInputPath(root: string, operationId: string, suffix: string): string {
  if (!/^[0-9a-f-]{36}$/.test(operationId)) throw new RecoveryError('RECOVERY_ID_INVALID', 'Target controller operation ID is invalid.');
  return join(root, `${operationId}.${suffix}.json`);
}

export function createDefaultTargetUnixTransport(config: RecoveryOperatorConfigV3): RecoveryTargetTransport {
  return new TargetUnixClient({ socketPath: config.target_gateway.relay_socket_path,
    actionDeadlineMs: config.target_gateway.action_deadline_ms,
    socketAuthority: { uid: 0, gid: process.getgid?.() ?? -1 } });
}

class AuthorizationEnvelopeTransport implements RecoveryTargetTransport {
  constructor(private readonly transport: RecoveryTargetTransport, private readonly binding: {
    plan: RecoveryPlanV3 | RecoveryPlanV4;
    planSha256: string;
    authorizationBytes: Buffer;
    specificationBytes: Buffer;
    specificationRootSha256: string;
    operationAttestationBytes?: Buffer;
  }) {}

  request(bytes: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    const request = parseTargetHelperRequest(bytes);
    if (this.binding.plan.format === RECOVERY_PLAN_FORMAT_V4) {
      if (!this.binding.operationAttestationBytes) {
        throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE', 'Plan v4 lacks its protected operation attestation.');
      }
      const envelope = createTargetAuthorizationEnvelopeV2({ request, plan: this.binding.plan,
        planSha256: this.binding.planSha256, authorization: this.binding.authorizationBytes,
        targetSpecification: this.binding.specificationBytes,
        operationAttestation: this.binding.operationAttestationBytes,
        specificationRootSha256: this.binding.specificationRootSha256 });
      return this.transport.request(encodeTargetAuthorizationEnvelopeV2(envelope), signal);
    }
    const envelope = createTargetAuthorizationEnvelope({ request, plan: this.binding.plan,
      planSha256: this.binding.planSha256, authorization: this.binding.authorizationBytes,
      targetSpecification: this.binding.specificationBytes, specificationRootSha256: this.binding.specificationRootSha256 });
    return this.transport.request(encodeTargetAuthorizationEnvelope(envelope), signal);
  }
}

export interface ProductionTargetControllerDependencies {
  journal: RecoveryJournal;
  inspectSourceHoldActive(signal?: AbortSignal): Promise<boolean>;
  revokedAuthorizationKeyIds?: ReadonlySet<string>;
  now?: () => Date;
  transport?: RecoveryTargetTransport;
}

/**
 * Production seam only. It resolves fixed operation-derived public inputs from
 * config-v3 roots and never accepts a caller-supplied socket, host, image,
 * mount, SSH target, engine option, or credential.
 */
export class ProductionRecoveryTargetController {
  constructor(private readonly config: RecoveryOperatorConfigV3,
    private readonly dependencies: ProductionTargetControllerDependencies) {}

  private async inputs(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, action: TargetControllerAction, signal?: AbortSignal) {
    const validatedPlan = parseRecoveryPlanFile(canonicalJson(plan), planSha256);
    if (validatedPlan.source.siteId !== this.config.site_id) {
      throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_MISMATCH',
        'Target controller plan is not exact and config-bound.');
    }
    if (validatedPlan.format !== RECOVERY_PLAN_FORMAT_V4) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_INELIGIBLE',
        'Historical plan v3 remains readable but cannot reach target inspection or effect.');
    }
    const specificationPath = fixedInputPath(this.config.target_gateway.specification_root, plan.operationId, 'target-specification');
    const authorizationPath = fixedInputPath(this.config.target_gateway.authorization_root, plan.operationId, action);
    const attestationPath = fixedInputPath(this.config.target_gateway.authorization_root, plan.operationId, 'target-operation-attestation');
    const [specificationBytes, authorizationBytes, operationAttestationBytes, keyring] = await Promise.all([
      readProtectedOperatorFile({ path: specificationPath, maximumBytes: RECOVERY_TARGET_SPECIFICATION_MAX_BYTES,
        expectedUid: process.getuid?.() ?? -1, expectedGid: process.getgid?.() ?? -1, signal }),
      readProtectedOperatorFile({ path: authorizationPath, maximumBytes: MAX_TARGET_CONTRACT_BYTES,
        expectedUid: process.getuid?.() ?? -1, expectedGid: process.getgid?.() ?? -1, signal }),
      readProtectedOperatorFile({ path: attestationPath, maximumBytes: MAX_TARGET_CONTRACT_BYTES,
        expectedUid: process.getuid?.() ?? -1, expectedGid: process.getgid?.() ?? -1, signal }),
      loadRecoveryPublicKeyring(this.config.target_gateway.authorization_keyring_file, { signal }),
    ]);
    const specification = parseRecoveryTargetSpecificationV2(specificationBytes);
    const preparation = validatedPlan.targetPreparation;
    if (sha256RecoveryBytes(specificationBytes) !== preparation.targetSpecificationSha256 ||
        specification.operationId !== validatedPlan.operationId || specification.generation !== preparation.generation ||
        specification.hostInstallationId !== preparation.hostInstallationId || specification.topologyMode !== preparation.topologyMode ||
        specification.hostPolicyEnvelopeSha256 !== preparation.hostPolicyEnvelopeSha256 ||
        specification.engineProfileEnvelopeSha256 !== preparation.engineProfileEnvelopeSha256 ||
        specification.storageInventoryEnvelopeSha256 !== preparation.storageInventoryEnvelopeSha256 ||
        specification.protectionInventoryEnvelopeSha256 !== preparation.protectionInventoryEnvelopeSha256 ||
        specification.capacityEvidenceEnvelopeSha256 !== preparation.capacityEvidenceEnvelopeSha256) {
      throw new RecoveryError('RECOVERY_TARGET_SPECIFICATION_MISMATCH', 'Target specification v2 differs from plan v4.');
    }
    parseSignedTargetAuthorizationV2(authorizationBytes);
    const signedAttestation = parseSignedTargetOperationAttestation(operationAttestationBytes);
    const attestation = signedAttestation.attestation;
    const exactAttestation = { operationId: validatedPlan.operationId, siteId: validatedPlan.source.siteId,
      generation: preparation.generation, hostInstallationId: preparation.hostInstallationId,
      targetSetId: preparation.targetSetId, targetSpecificationSha256: preparation.targetSpecificationSha256,
      targetLogicalIdentitySha256: recoveryTargetLogicalIdentitySha256(validatedPlan.target),
      targetReleaseIdentitySha256: recoveryTargetReleaseIdentitySha256(validatedPlan.target),
      hostPolicyEnvelopeSha256: preparation.hostPolicyEnvelopeSha256,
      engineProfileEnvelopeSha256: preparation.engineProfileEnvelopeSha256,
      storageInventoryEnvelopeSha256: preparation.storageInventoryEnvelopeSha256,
      protectionInventoryEnvelopeSha256: preparation.protectionInventoryEnvelopeSha256,
      capacityEvidenceEnvelopeSha256: preparation.capacityEvidenceEnvelopeSha256 };
    if (targetOperationAttestationEnvelopeSha256(signedAttestation) !== preparation.operationAttestationSha256 ||
        Object.entries(exactAttestation).some(([key, expected]) =>
          attestation[key as keyof typeof attestation] !== expected)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Protected operation attestation differs from plan v4 and specification v2.');
    }
    return { specificationBytes, authorizationBytes, operationAttestationBytes, keys: keyring.keys };
  }

  private workflow(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, inputs: Awaited<ReturnType<ProductionRecoveryTargetController['inputs']>>) {
    const transport = new AuthorizationEnvelopeTransport(this.dependencies.transport ?? createDefaultTargetUnixTransport(this.config), {
      plan, planSha256, authorizationBytes: inputs.authorizationBytes, specificationBytes: inputs.specificationBytes,
      operationAttestationBytes: inputs.operationAttestationBytes,
      specificationRootSha256: sha256RecoveryBytes(Buffer.concat([
        Buffer.from('darshan-recovery-target-specification-root-v1\0'),
        Buffer.from(this.config.target_gateway.specification_root),
      ])),
    });
    return new RecoveryTargetWorkflow({ journal: this.dependencies.journal, client: new RecoveryTargetClient({ transport }),
      inspectSourceHoldActive: this.dependencies.inspectSourceHoldActive, admissionKeys: inputs.keys,
      revokedAdmissionKeyIds: this.dependencies.revokedAuthorizationKeyIds, now: this.dependencies.now });
  }

  async prepare(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, signal?: AbortSignal): Promise<void> {
    const inputs = await this.inputs(plan, planSha256, 'prepare', signal);
    await this.workflow(plan, planSha256, inputs).prepare({ plan, planSha256, admissionBytes: inputs.authorizationBytes, signal });
  }

  async inspect(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, signal?: AbortSignal): Promise<'READY' | 'STOPPED_RETAINED' | 'RETIRED' | 'ABSENT' | 'UNKNOWN'> {
    const inputs = await this.inputs(plan, planSha256, 'inspect', signal);
    const result = await this.workflow(plan, planSha256, inputs).status({ plan, planSha256,
      admissionBytes: inputs.authorizationBytes, signal });
    return result.lifecycle === 'NOT_PREPARED' ? 'ABSENT' : result.lifecycle;
  }

  async dispose(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, signal?: AbortSignal): Promise<void> {
    const inputs = await this.inputs(plan, planSha256, 'disposition', signal);
    await this.workflow(plan, planSha256, inputs).dispose({ plan, planSha256,
      decisionBytes: inputs.authorizationBytes, signal });
  }
}

export function createProductionRecoveryTargetController(config: RecoveryOperatorConfigV3,
  dependencies?: ProductionTargetControllerDependencies): ProductionRecoveryTargetController {
  if (!dependencies) {
    throw new RecoveryError('RECOVERY_TARGET_UNSUPPORTED',
      'Production target controller is not installed: journal and exact source-hold inspection dependencies are required.');
  }
  return new ProductionRecoveryTargetController(config, dependencies);
}
