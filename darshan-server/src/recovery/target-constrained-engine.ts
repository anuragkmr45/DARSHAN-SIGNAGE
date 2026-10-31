import { createHash } from 'node:crypto';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { sha256RecoveryBytes } from './contracts';
import { RecoveryError } from './errors';
import { encodeTargetAuthorizationEnvelopeV2, parseTargetAuthorizationEnvelopeV2 } from './target-authorization-envelope-v2';
import { validateTargetDockerEffectiveInspectV1, type TargetDockerExpectedIdentityV1 } from './target-docker-inspect';
import { parseTargetDockerExecutionProfileV1,
  targetDockerExecutionProfileV1Sha256, verifyTargetEngineEnrollmentV1,
  type TargetDockerExecutionProfileV1 } from './target-docker-profile';
import { encodeTargetEngineEnrollmentV1, parseProtectedDockerInventoryV1, parseTargetEngineEnrollmentV1,
  parseTargetLifecycleObservationV1, parseTargetLifecycleResultV1, parseTargetResourceAdmissionV1,
  protectedDockerInventoryV1Sha256, targetLifecycleCommandV1Sha256, targetLifecycleObservationV1Sha256,
  targetLifecycleResultV1Sha256, targetResourceAdmissionV1Sha256,
  type ProtectedDockerInventoryV1, type TargetAuthorityHandle, type TargetEngineEnrollmentV1,
  type TargetLifecycleActionV1, type TargetLifecycleBindingV1, type TargetLifecycleCommandV1,
  type TargetLifecycleObservationV1, type TargetLifecycleStepV1, type TargetResourceAdmissionV1 } from './target-engine-contracts';
import { TargetEngineEffectError, type RecoveryTargetEngineAdapter, type TargetEngineObservation } from './target-helper-service';
import type { TargetHelperIdentity } from './target-helper-journal';
import { type TargetLifecycleState } from './target-helper-protocol';
import { TargetEngineJournal, type ScopedTargetEngineJournal,
  type TargetEngineJournalIdentityV1, type TargetEngineJournalRecordV1 } from './target-engine-journal';
import { type TargetLifecycleResourceAuthority } from './target-resource-authority';
import type { RecoveryTargetEngineCallContext, VerifiedTargetStorageContext,
  VerifiedTargetStorageContextV2 } from './target-storage-authority';
import type { SignedTargetStorageEvidenceV2 } from './target-storage-contracts-v2';

const ZERO_DIGEST = '0'.repeat(64);
const PREPARE_STEPS = ['ADMIT_EXISTING_RESOURCES', 'ENSURE_INTERNAL_NETWORK', 'CREATE_POSTGRES', 'CREATE_MINIO',
  'START_POSTGRES', 'START_MINIO', 'VERIFY_READY'] as const;
const STOP_STEPS = ['STOP_MINIO', 'STOP_POSTGRES', 'VERIFY_STOPPED_RETAINED'] as const;

export interface ConstrainedTargetEngineOptions {
  journal: TargetEngineJournal;
  authority: TargetLifecycleResourceAuthority;
  authorityHandle: TargetAuthorityHandle;
  profileHandle: TargetAuthorityHandle;
  inventoryHandle: TargetAuthorityHandle;
  targetHandle: TargetAuthorityHandle;
  enrollment: TargetEngineEnrollmentV1;
  engineProfileEnvelope: SignedTargetStorageEvidenceV2;
  protectionInventoryEnvelope: SignedTargetStorageEvidenceV2;
  expectedDockerIdentity: TargetDockerExpectedIdentityV1;
  now?: () => Date;
}

interface LoadedAuthority {
  profile: TargetDockerExecutionProfileV1;
  inventory: ProtectedDockerInventoryV1;
  admission: TargetResourceAdmissionV1;
  binding: TargetLifecycleBindingV1;
  journalIdentity: TargetEngineJournalIdentityV1;
}

function isV2Storage(storage: VerifiedTargetStorageContext | VerifiedTargetStorageContextV2):
  storage is VerifiedTargetStorageContextV2 {
  return storage.evidence.capacityEvidence.format === 'darshan-recovery-capacity-evidence-v2';
}

function v2Storage(context: RecoveryTargetEngineCallContext): VerifiedTargetStorageContextV2 {
  const storage = context.storage;
  if (!storage || !isV2Storage(storage)) {
    throw new TargetEngineEffectError('Exact storage context v2 is required.', 'DEFINITE');
  }
  return storage;
}

function commandId(binding: TargetLifecycleBindingV1, action: TargetLifecycleActionV1,
  step: TargetLifecycleStepV1): string {
  const value = createHash('sha256').update(canonicalJson({ binding, action, step })).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

function pendingIntent(records: readonly TargetEngineJournalRecordV1[]): TargetEngineJournalRecordV1 | undefined {
  const record = records.at(-1); return record?.body.phase === 'INTENT' ? record : undefined;
}

function terminal(records: readonly TargetEngineJournalRecordV1[]): 'READY' | 'STOPPED_RETAINED' | undefined {
  return [...records].reverse().find((record) => record.body.phase === 'RECEIPT' && record.body.terminalState !== null)
    ?.body.terminalState ?? undefined;
}

function configurationSha256(value: unknown): string { return sha256RecoveryBytes(canonicalJson(value)); }

function lifecycleIdentitySha256(observation: TargetLifecycleObservationV1): string {
  return sha256RecoveryBytes(canonicalJson({ network: observation.network.identitySha256,
    postgres: observation.postgres.identitySha256, minio: observation.minio.identitySha256 }));
}

function exactOwnedObservation(input: { observation: TargetLifecycleObservationV1; loaded: LoadedAuthority }): void {
  const { observation, loaded } = input; const profile = loaded.profile;
  if (observation.targetHandle !== loaded.journalIdentity.targetHandle ||
      !canonicalJson(observation.binding).equals(canonicalJson(loaded.binding)) ||
      observation.resourceAdmissionSha256 !== targetResourceAdmissionV1Sha256(loaded.admission) ||
      observation.network.authorityHandle !== profile.network.networkAuthorityHandle ||
      observation.postgres.authorityHandle !== profile.containers[0].containerAuthorityHandle ||
      observation.minio.authorityHandle !== profile.containers[1].containerAuthorityHandle) {
    throw new TargetEngineEffectError('Lifecycle observation identity differs.', 'AMBIGUOUS');
  }
  for (const [resource, expected] of [[observation.network, configurationSha256(profile.network)],
    [observation.postgres, configurationSha256(profile.containers[0])],
    [observation.minio, configurationSha256(profile.containers[1])]] as const) {
    if (resource.state === 'FOREIGN' || resource.state === 'INCOMPLETE' ||
        resource.state !== 'ABSENT' && resource.configurationSha256 !== expected ||
        resource.state === 'ABSENT' && resource.configurationSha256 !== null) {
      throw new TargetEngineEffectError('Lifecycle observation is incomplete, foreign, or configuration-mismatched.', 'AMBIGUOUS');
    }
  }
  if (!observation.complete) throw new TargetEngineEffectError('Lifecycle observation is incomplete.', 'AMBIGUOUS');
}

function observedState(observation: TargetLifecycleObservationV1): TargetLifecycleState {
  const states = [observation.network.state, observation.postgres.state, observation.minio.state];
  if (observation.absenceReliable && states.every((state) => state === 'ABSENT')) return 'ABSENT';
  if (observation.network.state === 'CREATED' && observation.postgres.state === 'RUNNING_HEALTHY' &&
      observation.minio.state === 'RUNNING_HEALTHY') return 'READY';
  if (observation.network.state === 'CREATED' && observation.postgres.state === 'STOPPED' &&
      observation.minio.state === 'STOPPED') return 'STOPPED_RETAINED';
  return 'RECONCILIATION_REQUIRED';
}

function pendingObservedState(operation: TargetLifecycleActionV1 | 'RETIRE',
  observation: TargetLifecycleObservationV1): TargetLifecycleState {
  const terminalState = observedState(observation);
  if (terminalState !== 'RECONCILIATION_REQUIRED') return terminalState;
  if (operation === 'PREPARE') {
    return observation.postgres.state === 'RUNNING_HEALTHY' || observation.minio.state === 'RUNNING_HEALTHY'
      ? 'STARTING' : 'ALLOCATING';
  }
  if (operation === 'STOP_RETAIN') return 'STOPPING';
  return 'RECONCILIATION_REQUIRED';
}

function stepSatisfied(step: TargetLifecycleStepV1, observation: TargetLifecycleObservationV1): boolean {
  const network = observation.network.state; const postgres = observation.postgres.state; const minio = observation.minio.state;
  if (step === 'ADMIT_EXISTING_RESOURCES') return observation.complete;
  if (step === 'ENSURE_INTERNAL_NETWORK') return network === 'CREATED';
  if (step === 'CREATE_POSTGRES') return network === 'CREATED' && ['CREATED', 'STOPPED', 'RUNNING_HEALTHY'].includes(postgres);
  if (step === 'CREATE_MINIO') return network === 'CREATED' && ['CREATED', 'STOPPED', 'RUNNING_HEALTHY'].includes(postgres) &&
    ['CREATED', 'STOPPED', 'RUNNING_HEALTHY'].includes(minio);
  if (step === 'START_POSTGRES') return postgres === 'RUNNING_HEALTHY';
  if (step === 'START_MINIO' || step === 'VERIFY_READY') return postgres === 'RUNNING_HEALTHY' && minio === 'RUNNING_HEALTHY';
  if (step === 'STOP_MINIO') return minio === 'STOPPED' && ['RUNNING_HEALTHY', 'STOPPED'].includes(postgres);
  return step === 'STOP_POSTGRES' || step === 'VERIFY_STOPPED_RETAINED'
    ? postgres === 'STOPPED' && minio === 'STOPPED' : false;
}

function stepReliablyNotApplied(step: TargetLifecycleStepV1, observation: TargetLifecycleObservationV1): boolean {
  const network = observation.network.state; const postgres = observation.postgres.state; const minio = observation.minio.state;
  if (step === 'ENSURE_INTERNAL_NETWORK') return observation.absenceReliable && network === 'ABSENT';
  if (step === 'CREATE_POSTGRES') return network === 'CREATED' && postgres === 'ABSENT';
  if (step === 'CREATE_MINIO') return network === 'CREATED' &&
    ['CREATED', 'STOPPED', 'RUNNING_HEALTHY'].includes(postgres) && minio === 'ABSENT';
  if (step === 'START_POSTGRES') return ['CREATED', 'STOPPED'].includes(postgres);
  if (step === 'START_MINIO') return postgres === 'RUNNING_HEALTHY' && ['CREATED', 'STOPPED'].includes(minio);
  if (step === 'STOP_MINIO') return minio === 'RUNNING_HEALTHY';
  if (step === 'STOP_POSTGRES') return minio === 'STOPPED' && postgres === 'RUNNING_HEALTHY';
  return false;
}

export class ConstrainedRecoveryTargetEngine implements RecoveryTargetEngineAdapter {
  private readonly enrollment: TargetEngineEnrollmentV1; private readonly now: () => Date;
  constructor(private readonly options: ConstrainedTargetEngineOptions) {
    this.enrollment = parseTargetEngineEnrollmentV1(encodeTargetEngineEnrollmentV1(options.enrollment));
    this.now = options.now ?? (() => new Date());
    if (this.enrollment.authorityHandle !== options.authorityHandle ||
        options.expectedDockerIdentity.targetHandle !== options.targetHandle) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Constrained engine constructor identities differ.');
    }
  }

  private fresh(context: RecoveryTargetEngineCallContext): ReturnType<typeof parseTargetAuthorizationEnvelopeV2> {
    context.signal.throwIfAborted();
    if (this.now().getTime() >= context.deadline.getTime()) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_EXPIRED', 'Constrained target action deadline expired.');
    }
    context.assertFresh?.();
    const outer = parseTargetAuthorizationEnvelopeV2(context.requestBody);
    if (!canonicalJson(outer.request).equals(canonicalJson(context.request)) ||
        !encodeTargetAuthorizationEnvelopeV2(outer).equals(Buffer.from(context.requestBody)) ||
        outer.request.authorizationSha256 !== context.authorizationSha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Constrained engine context differs from exact outer v2 request.');
    }
    return outer;
  }

  private binding(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): TargetLifecycleBindingV1 {
    const outer = this.fresh(context); const storage = v2Storage(context);
    const requestIdentity: TargetHelperIdentity = { operationId: context.request.operationId, siteId: context.request.siteId,
      hostInstallationId: context.request.hostInstallationId, planSha256: context.request.planSha256,
      targetSetId: context.request.targetSetId, generation: context.request.generation,
      targetSpecificationSha256: context.request.targetSpecificationSha256 };
    if (!canonicalJson(identity).equals(canonicalJson(requestIdentity)) ||
        outer.request.operationId !== identity.operationId || outer.request.siteId !== identity.siteId ||
        outer.request.hostInstallationId !== identity.hostInstallationId || outer.request.planSha256 !== identity.planSha256 ||
        outer.request.targetSetId !== identity.targetSetId || outer.request.generation !== identity.generation ||
        outer.request.targetSpecificationSha256 !== identity.targetSpecificationSha256 ||
        storage.installedIdentity.siteId !== identity.siteId ||
        storage.installedIdentity.hostInstallationId !== identity.hostInstallationId ||
        storage.evidence.capacityEvidence.operationId !== identity.operationId ||
        storage.evidence.capacityEvidence.siteId !== identity.siteId ||
        storage.evidence.capacityEvidence.hostInstallationId !== identity.hostInstallationId ||
        storage.evidence.capacityEvidence.generation !== String(identity.generation)) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Caller identity differs from the signed request, outer envelope, installed identity, or verified storage evidence.');
    }
    const binding = { ...requestIdentity, outerEnvelopeSha256: sha256RecoveryBytes(context.requestBody),
      authorizationSha256: context.authorizationSha256,
      enrollmentSha256: sha256RecoveryBytes(encodeTargetEngineEnrollmentV1(this.enrollment)),
      executionProfileSha256: this.enrollment.executionProfileSha256,
      protectedInventorySha256: this.enrollment.protectedDockerInventorySha256 };
    if (outer.preparationIdentity.engineProfileEnvelopeSha256 !== this.enrollment.engineProfileEnvelopeSha256 ||
        outer.preparationIdentity.protectionInventoryEnvelopeSha256 !== this.enrollment.protectionInventoryEnvelopeSha256 ||
        storage.evidence.envelopeSha256.ENGINE_PROFILE !== this.enrollment.engineProfileEnvelopeSha256 ||
        storage.evidence.envelopeSha256.PROTECTION_INVENTORY !== this.enrollment.protectionInventoryEnvelopeSha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Constrained engine evidence identity differs.');
    }
    return binding;
  }

  private async load(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<LoadedAuthority> {
    const binding = this.binding(identity, context); const profileBytes = await this.options.authority
      .readExecutionProfile(this.options.profileHandle, context.signal); this.fresh(context);
    const inventoryBytes = await this.options.authority.readProtectedInventory(this.options.inventoryHandle, context.signal); this.fresh(context);
    const profile = parseTargetDockerExecutionProfileV1(profileBytes); const inventory = parseProtectedDockerInventoryV1(inventoryBytes);
    verifyTargetEngineEnrollmentV1({ enrollment: this.enrollment, profile,
      engineProfileEnvelope: this.options.engineProfileEnvelope, protectedInventory: inventory,
      protectionInventoryEnvelope: this.options.protectionInventoryEnvelope });
    if (targetDockerExecutionProfileV1Sha256(profile) !== binding.executionProfileSha256 ||
        protectedDockerInventoryV1Sha256(inventory) !== binding.protectedInventorySha256) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Constrained engine enrollment records changed.');
    }
    const admissionBytes = await this.options.authority.admitExistingResources(this.options.targetHandle, context.signal); this.fresh(context);
    const admission = parseTargetResourceAdmissionV1(admissionBytes); this.verifyAdmission(admission, profile, binding, v2Storage(context));
    const stableBinding = { operationId: binding.operationId, siteId: binding.siteId,
      hostInstallationId: binding.hostInstallationId, planSha256: binding.planSha256,
      targetSetId: binding.targetSetId, generation: binding.generation,
      targetSpecificationSha256: binding.targetSpecificationSha256, enrollmentSha256: binding.enrollmentSha256,
      executionProfileSha256: binding.executionProfileSha256,
      protectedInventorySha256: binding.protectedInventorySha256 };
    return { profile, inventory, admission, binding,
      journalIdentity: { targetHandle: this.options.targetHandle, binding: stableBinding } };
  }

  private verifyAdmission(admission: TargetResourceAdmissionV1, profile: TargetDockerExecutionProfileV1,
    binding: TargetLifecycleBindingV1, storage: VerifiedTargetStorageContextV2): void {
    const data = profile.containers.map((container) => container.binds[0]);
    const credentials = [profile.containers[0].credentials[0], profile.containers[1].credentials[0],
      profile.containers[1].credentials[1]];
    if (admission.targetHandle !== this.options.targetHandle || !canonicalJson(admission.binding).equals(canonicalJson(binding)) ||
        admission.allocation.allocationLedgerHeadSha256 !== storage.evidence.capacityEvidence.allocationLedgerHeadSha256 ||
        admission.data.some((entry, index) => entry.authorityHandle !== data[index]!.sourceAuthorityHandle ||
          entry.identitySha256 !== data[index]!.sourceIdentitySha256) ||
        admission.credentials.some((entry, index) => entry.authorityHandle !== credentials[index]!.credentialAuthorityHandle ||
          entry.identitySha256 !== credentials[index]!.credentialIdentitySha256)) {
      throw new TargetEngineEffectError('Existing target resources are not exactly admitted.', 'AMBIGUOUS');
    }
  }

  private async observe(loaded: LoadedAuthority, context: RecoveryTargetEngineCallContext,
    expectedLifecycleIdentitySha256?: string): Promise<TargetLifecycleObservationV1> {
    const bytes = await this.options.authority.observeLifecycle(this.options.targetHandle, context.signal); this.fresh(context);
    const observation = parseTargetLifecycleObservationV1(bytes); exactOwnedObservation({ observation, loaded });
    if (expectedLifecycleIdentitySha256 !== undefined &&
        lifecycleIdentitySha256(observation) !== expectedLifecycleIdentitySha256) {
      throw new TargetEngineEffectError('Lifecycle resource identity was replaced under an enrolled handle.', 'AMBIGUOUS');
    }
    return observation;
  }

  private command(loaded: LoadedAuthority, action: TargetLifecycleActionV1, step: TargetLifecycleStepV1,
    priorObservationSha256: string): TargetLifecycleCommandV1 {
    return { format: 'darshan-recovery-target-lifecycle-command-v1', commandId: commandId(loaded.binding, action, step),
      action, step, authorityHandle: this.options.authorityHandle, targetHandle: this.options.targetHandle,
      binding: loaded.binding, expectedObservationSha256: priorObservationSha256,
      resourceAdmissionSha256: targetResourceAdmissionV1Sha256(loaded.admission) };
  }

  private async inspectReady(loaded: LoadedAuthority, context: RecoveryTargetEngineCallContext): Promise<void> {
    const raw = await this.options.authority.inspectTarget(this.options.targetHandle, context.signal); this.fresh(context);
    validateTargetDockerEffectiveInspectV1({ raw, profile: loaded.profile, protectedInventory: loaded.inventory,
      expected: this.options.expectedDockerIdentity });
  }

  private async appendReceipt(journal: ScopedTargetEngineJournal, input: { action: TargetLifecycleActionV1;
    step: TargetLifecycleStepV1; requestId: string; commandSha256: string | null; admissionSha256: string;
    resultSha256: string; observation: TargetLifecycleObservationV1; terminalState: 'READY' | 'STOPPED_RETAINED' | null },
  context: RecoveryTargetEngineCallContext): Promise<void> {
    this.fresh(context);
    await journal.append({ binding: input.observation.binding, phase: 'RECEIPT', action: input.action, step: input.step, requestId: input.requestId,
      commandSha256: input.commandSha256, resourceAdmissionSha256: input.admissionSha256,
      resultSha256: input.resultSha256, observationSha256: targetLifecycleObservationV1Sha256(input.observation),
      lifecycleIdentitySha256: lifecycleIdentitySha256(input.observation),
      terminalState: input.terminalState }); this.fresh(context);
  }

  private async runStep(journal: ScopedTargetEngineJournal, loaded: LoadedAuthority,
    action: TargetLifecycleActionV1, step: TargetLifecycleStepV1, context: RecoveryTargetEngineCallContext): Promise<TargetLifecycleObservationV1> {
    const admissionSha256 = targetResourceAdmissionV1Sha256(loaded.admission); const pending = pendingIntent(journal.records);
    const retainedLifecycleIdentity = journal.records.find((record) => record.body.phase === 'RECEIPT')
      ?.body.lifecycleIdentitySha256 ?? undefined;
    const reconcilingPendingIntent = pending !== undefined;
    const priorObservationSha256 = [...journal.records].reverse().find((record) => record.body.phase === 'RECEIPT')
      ?.body.observationSha256 ?? ZERO_DIGEST;
    const command = step === 'ADMIT_EXISTING_RESOURCES' ? undefined : this.command(loaded, action, step, priorObservationSha256);
    const commandSha256 = command ? targetLifecycleCommandV1Sha256(command) : null;
    if (!pending) {
      await journal.append({ binding: loaded.binding, phase: 'INTENT', action, step, requestId: context.request.requestId, commandSha256,
        resourceAdmissionSha256: admissionSha256, resultSha256: null, observationSha256: null,
        lifecycleIdentitySha256: null, terminalState: null });
      this.fresh(context);
    } else if (pending.body.action !== action || pending.body.step !== step || pending.body.requestId !== context.request.requestId ||
        pending.body.commandSha256 !== commandSha256 || pending.body.resourceAdmissionSha256 !== admissionSha256) {
      throw new TargetEngineEffectError('A conflicting constrained-engine intent is pending.', 'AMBIGUOUS');
    }
    let observation = await this.observe(loaded, context, retainedLifecycleIdentity);
    if (stepSatisfied(step, observation)) {
      if (step === 'VERIFY_READY') await this.inspectReady(loaded, context);
      await this.appendReceipt(journal, { action, step, requestId: context.request.requestId, commandSha256,
        admissionSha256, resultSha256: sha256RecoveryBytes(canonicalJson({ adopted: true, step })), observation,
        terminalState: step === 'VERIFY_READY' ? 'READY' : step === 'VERIFY_STOPPED_RETAINED' ? 'STOPPED_RETAINED' : null }, context);
      return observation;
    }
    if (reconcilingPendingIntent && observedState(observation) === 'RECONCILIATION_REQUIRED' &&
        !stepReliablyNotApplied(step, observation)) {
      throw new TargetEngineEffectError('Pending constrained-engine effect remains ambiguous.', 'AMBIGUOUS');
    }
    if (!command) {
      await this.appendReceipt(journal, { action, step, requestId: context.request.requestId, commandSha256: null,
        admissionSha256, resultSha256: admissionSha256, observation, terminalState: null }, context); return observation;
    }
    this.fresh(context); // immediately before the only effect-capable fake authority call
    const resultBytes = await this.options.authority.executeLifecycleCommand(command, context.signal); this.fresh(context);
    const result = parseTargetLifecycleResultV1(resultBytes);
    if (result.commandSha256 !== targetLifecycleCommandV1Sha256(command)) {
      throw new TargetEngineEffectError('Lifecycle result does not bind its exact fixed command.', 'AMBIGUOUS');
    }
    if (result.outcome === 'UNKNOWN' || result.sanitizedCode === 'INCOMPLETE' || result.sanitizedCode === 'FOREIGN' ||
        result.sanitizedCode === 'CONFIG_MISMATCH') {
      throw new TargetEngineEffectError('Lifecycle command result is ambiguous.', 'AMBIGUOUS');
    }
    if (result.outcome === 'NOT_APPLIED') {
      const possiblePriorEffect = journal.records.some((record) => record.body.phase === 'RECEIPT' &&
        record.body.step !== 'ADMIT_EXISTING_RESOURCES');
      throw new TargetEngineEffectError('Lifecycle command was rejected before effect.', possiblePriorEffect ? 'AMBIGUOUS' : 'DEFINITE');
    }
    observation = await this.observe(loaded, context, retainedLifecycleIdentity);
    if (!stepSatisfied(step, observation)) throw new TargetEngineEffectError('Lifecycle effect lacks authoritative observation.', 'AMBIGUOUS');
    if (step === 'VERIFY_READY') await this.inspectReady(loaded, context);
    await this.appendReceipt(journal, { action, step, requestId: context.request.requestId, commandSha256,
      admissionSha256, resultSha256: targetLifecycleResultV1Sha256(result), observation,
      terminalState: step === 'VERIFY_READY' ? 'READY' : step === 'VERIFY_STOPPED_RETAINED' ? 'STOPPED_RETAINED' : null }, context);
    return observation;
  }

  private async execute(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext,
    action: TargetLifecycleActionV1): Promise<TargetEngineObservation> {
    this.fresh(context);
    if (context.request.operation !== action) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Constrained target action differs from the exact authorized helper operation.');
    }
    const result: TargetEngineObservation = await this.options.authority.withLifecycleAuthority(
      this.options.targetHandle, context.signal, async () => {
      this.fresh(context); const loaded = await this.load(identity, context); this.fresh(context);
      const observation: TargetEngineObservation = await this.options.journal.withTarget(loaded.journalIdentity, async (journal) => {
        this.fresh(context); const steps = action === 'PREPARE' ? PREPARE_STEPS : STOP_STEPS;
        const currentTerminal = terminal(journal.records);
        if (action === 'PREPARE' && currentTerminal === 'READY' || action === 'STOP_RETAIN' && currentTerminal === 'STOPPED_RETAINED') {
          const retainedIdentity = journal.records.find((record) => record.body.phase === 'RECEIPT')
            ?.body.lifecycleIdentitySha256 ?? undefined;
          const observation = await this.observe(loaded, context, retainedIdentity);
          if (observedState(observation) !== currentTerminal) throw new TargetEngineEffectError('Durable terminal receipt differs from authority truth.', 'AMBIGUOUS');
          if (currentTerminal === 'READY') await this.inspectReady(loaded, context);
          return { state: currentTerminal, evidenceSha256: targetLifecycleObservationV1Sha256(observation) };
        }
        if (action === 'STOP_RETAIN' && currentTerminal !== 'READY') {
          throw new TargetEngineEffectError('STOP_RETAIN requires the exact durable READY receipt.',
            journal.records.length === 0 ? 'DEFINITE' : 'AMBIGUOUS');
        }
        let observation: TargetLifecycleObservationV1 | undefined;
        for (const step of steps) {
          const completed = journal.records.some((record) => record.body.phase === 'RECEIPT' && record.body.action === action && record.body.step === step);
          if (!completed) observation = await this.runStep(journal, loaded, action, step, context);
        }
        if (!observation) {
          const retainedIdentity = journal.records.find((record) => record.body.phase === 'RECEIPT')
            ?.body.lifecycleIdentitySha256 ?? undefined;
          observation = await this.observe(loaded, context, retainedIdentity);
        }
        const expected = action === 'PREPARE' ? 'READY' : 'STOPPED_RETAINED';
        if (observedState(observation) !== expected || terminal(journal.records) !== expected) {
          throw new TargetEngineEffectError('Constrained engine did not reach its exact durable terminal.', 'AMBIGUOUS');
        }
        return { state: expected, evidenceSha256: targetLifecycleObservationV1Sha256(observation) };
      });
      this.fresh(context); return observation;
    });
    this.fresh(context); return result;
  }

  async prepare(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation> {
    return this.execute(identity, context, 'PREPARE');
  }

  async stopRetain(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation> {
    return this.execute(identity, context, 'STOP_RETAIN');
  }

  async retire(_identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation> {
    this.fresh(context);
    if (context.request.operation !== 'RETIRE') {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Constrained target action differs from the exact authorized helper operation.');
    }
    throw new TargetEngineEffectError('RETIRE is not installed; retained resources cannot be removed or quarantined.', 'DEFINITE');
  }

  private async inspectForOperation(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext,
    operation: 'INSPECT' | TargetLifecycleActionV1 | 'RETIRE'): Promise<TargetEngineObservation> {
    this.fresh(context);
    if (context.request.operation !== operation) {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Constrained target action differs from the exact authorized helper operation.');
    }
    const result: TargetEngineObservation = await this.options.authority.withLifecycleAuthority(
      this.options.targetHandle, context.signal, async () => {
      this.fresh(context); const loaded = await this.load(identity, context); this.fresh(context);
      const records = await this.options.journal.read(loaded.journalIdentity); this.fresh(context);
      const retainedIdentity = records.find((record) => record.body.phase === 'RECEIPT')
        ?.body.lifecycleIdentitySha256 ?? undefined;
      const observation = await this.observe(loaded, context, retainedIdentity); const state = observedState(observation);
      const durable = terminal(records);
        if (state === 'READY') await this.inspectReady(loaded, context);
        if (durable === state && (state === 'READY' || state === 'STOPPED_RETAINED')) {
          return { state, evidenceSha256: targetLifecycleObservationV1Sha256(observation) };
        }
        if (state === 'ABSENT' && records.length === 0) {
          return { state: 'ABSENT', evidenceSha256: targetLifecycleObservationV1Sha256(observation) };
        }
        return { state: operation === 'INSPECT' ? 'RECONCILIATION_REQUIRED' : pendingObservedState(operation, observation),
          evidenceSha256: targetLifecycleObservationV1Sha256(observation) };
    });
    this.fresh(context); return result;
  }

  async inspect(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext): Promise<TargetEngineObservation> {
    if (context.request.operation !== 'INSPECT') {
      throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH',
        'Standalone constrained inspection requires an exact INSPECT authorization.');
    }
    return this.inspectForOperation(identity, context, 'INSPECT');
  }

  async inspectPending(identity: TargetHelperIdentity, context: RecoveryTargetEngineCallContext,
    operation: 'PREPARE' | 'STOP_RETAIN' | 'RETIRE'): Promise<TargetEngineObservation> {
    return operation === 'PREPARE' || operation === 'STOP_RETAIN'
      ? this.execute(identity, context, operation) : this.inspectForOperation(identity, context, operation);
  }
}

/** Explicit alias used by tests; no production factory or selector installs it. */
export const TestOnlyConstrainedRecoveryTargetEngine = ConstrainedRecoveryTargetEngine;

