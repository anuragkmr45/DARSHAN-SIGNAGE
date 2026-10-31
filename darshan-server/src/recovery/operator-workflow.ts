import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { BackupBrokerResponse } from '../backups/backup-broker-protocol';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { BackupBrokerClient, BackupBrokerClientError, type BackupBrokerClientRequest } from '../backups/backup-broker-client';
import { readBackupBrokerJournalSnapshot } from '../backups/backup-broker-journal';
import { assessRecoveryCompatibility } from './compatibility';
import { RECOVERY_PLAN_FORMAT_V3, RECOVERY_PLAN_FORMAT_V4, canonicalRecoveryBytes, sha256RecoveryBytes,
  type RecoveryPlanV2, type RecoveryPlanV3, type RecoveryPlanV4 } from './contracts';
import { findExactRecoveryPublication } from './discovery';
import { RecoveryError, type RecoveryErrorCode } from './errors';
import { RecoveryJournal, type RecoveryJournalGuard, type RecoveryJournalState, type ScopedRecoveryOperation } from './journal';
import { loadRecoveryOperatorConfig, loadRecoveryPublicKeyring,
  RECOVERY_OPERATOR_CONFIG_FORMAT_V2, RECOVERY_OPERATOR_CONFIG_FORMAT_V3,
  type RecoveryOperatorConfigV2 } from './operator-inputs';
import { readRecoveryPlanFile } from './plan-file';
import { loadRecoveryHoldDispositionReview, type RecoveryHoldDispositionReview } from './hold-disposition-review';
import { loadReleaseRecoveryTarget } from './release-target';
import { openRecoveryRepositoryReadonly, selectTrustedRecoverySource } from './repository-source';

type HoldOperation = 'INSPECT_RESTORE_HOLD' | 'ACQUIRE_RESTORE_HOLD' | 'RELEASE_RESTORE_HOLD' | 'MARK_RESTORE_HOLD_UNCERTAIN';

export interface RecoveryHoldRequest {
  operation: HoldOperation;
  request_id: string;
  deadline: string;
  run_id: string;
  attempt_id: string;
  capture_id: string;
  capture_generation: number;
  manifest_sha256: string;
  operation_id: string;
  owner_token: string;
  fence_token: string;
}

export interface RecoveryBrokerTransport {
  request(request: RecoveryHoldRequest, signal?: AbortSignal): Promise<BackupBrokerResponse>;
}

export interface RecoverySourceVerifier {
  verify(config: RecoveryOperatorConfigV2, plan: RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4, signal?: AbortSignal): Promise<void>;
}

export interface RecoveryWorkflowDependencies {
  loadConfig(path: string, signal?: AbortSignal): Promise<RecoveryOperatorConfigV2>;
  readPlan(input: { path: string; expectedSha256: string; signal?: AbortSignal }): Promise<RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4>;
  readReview(input: { path: string; expectedSha256: string; signal?: AbortSignal }): Promise<{ review: RecoveryHoldDispositionReview; reviewSha256: string }>;
  sourceVerifier: RecoverySourceVerifier;
  journal(config: RecoveryOperatorConfigV2): RecoveryJournal;
  broker(config: RecoveryOperatorConfigV2): RecoveryBrokerTransport;
  uuid(): string;
  now(): Date;
  targetController?: {
    prepare(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, signal?: AbortSignal): Promise<void>;
    inspect(plan: RecoveryPlanV3 | RecoveryPlanV4, planSha256: string, signal?: AbortSignal): Promise<'READY' | 'STOPPED_RETAINED' | 'RETIRED' | 'ABSENT' | 'UNKNOWN'>;
  };
}

export interface RecoveryWorkflowInput {
  configFile: string;
  planFile: string;
  planSha256: string;
  signal?: AbortSignal;
}

export interface RecoveryDispositionInput extends RecoveryWorkflowInput {
  reviewFile: string;
  reviewSha256: string;
  confirmOperationId: string;
}

export interface RecoveryWorkflowResult {
  operationId: string;
  phase: RecoveryJournalState['phase'];
  pendingPhase: RecoveryJournalState['pendingPhase'];
  failureCode: RecoveryErrorCode | null;
  brokerTruth: 'UNKNOWN' | 'ABSENT' | 'ACTIVE' | 'UNCERTAIN' | 'RELEASED';
  nextAction: 'HOLD' | 'VERIFY_SOURCE' | 'PREPARE_TARGETS' | 'RESUME' | 'NONE' | 'OPERATOR_REVIEW';
  targetLifecycle: 'NOT_APPLICABLE' | 'NOT_PREPARED' | 'READY' | 'STOPPED_RETAINED' | 'RETIRED' | 'UNKNOWN';
  targetHelperSequence: number | null;
  closure: null | { decisionId: string; closedAs: 'ABORTED_PRE_IMPORT' | 'ABANDONED';
    action: 'RELEASE' | 'MARK_UNCERTAIN'; status: 'PENDING' | 'CONFIRMED'; failureCode: RecoveryErrorCode | null };
}

async function loadV2Config(path: string, signal?: AbortSignal): Promise<RecoveryOperatorConfigV2> {
  const config = await loadRecoveryOperatorConfig(path, { signal });
  if (config.format !== RECOVERY_OPERATOR_CONFIG_FORMAT_V2 && config.format !== RECOVERY_OPERATOR_CONFIG_FORMAT_V3) {
    throw new RecoveryError('RECOVERY_INPUT_INVALID', 'This recovery command requires operator config v2 or v3.');
  }
  return config;
}

function mapSnapshotError(cause: unknown): RecoveryError {
  if (cause instanceof RecoveryError && cause.code === 'RECOVERY_CANCELLED') return cause;
  const code = (cause as { code?: string }).code;
  if (code === 'BROKER_JOURNAL_SNAPSHOT_MISSING') return new RecoveryError('RECOVERY_JOURNAL_SNAPSHOT_MISSING', 'Broker journal snapshot is missing.', { cause });
  if (code === 'BROKER_JOURNAL_SNAPSHOT_CORRUPT') return new RecoveryError('RECOVERY_JOURNAL_SNAPSHOT_CORRUPT', 'Broker journal snapshot is corrupt.', { cause });
  return new RecoveryError('RECOVERY_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal snapshot failed read-only safety checks.', { cause });
}

export const defaultRecoverySourceVerifier: RecoverySourceVerifier = {
  async verify(config, plan, signal) {
    signal?.throwIfAborted();
    if (plan.source.siteId !== config.site_id || plan.source.repositoryId !== config.repository.repository_id) {
      throw new RecoveryError('RECOVERY_SOURCE_IDENTITY_MISMATCH', 'Plan source does not match operator repository identity.');
    }
    const [{ keys: policyTrustKeys }, { keys: manifestVerificationKeys }] = await Promise.all([
      loadRecoveryPublicKeyring(config.trust.policy_keyring_file, { signal }),
      loadRecoveryPublicKeyring(config.trust.manifest_keyring_file, { signal }),
    ]);
    const opened = await openRecoveryRepositoryReadonly({
      root: config.repository.root, expectedDeviceId: config.repository.device_id,
      ownerUid: config.repository.owner_uid, ownerGid: config.repository.owner_gid,
      expectedSiteId: config.site_id, expectedRepositoryId: config.repository.repository_id,
      signal,
    });
    let initial;
    try { initial = await readBackupBrokerJournalSnapshot({ repository: opened.repository, signal }); }
    catch (cause) { throw mapSnapshotError(cause); }
    const publication = findExactRecoveryPublication({ state: initial, siteId: config.site_id,
      repositoryId: config.repository.repository_id, runId: plan.source.runId,
      manifestSha256: plan.source.manifestSha256 });
    const trusted = await selectTrustedRecoverySource({ repository: opened.repository,
      repositoryDescriptor: opened.descriptor, runId: plan.source.runId, manifestSha256: plan.source.manifestSha256,
      publication, policyTrustKeys, manifestVerificationKeys, signal });
    signal?.throwIfAborted();
    const target = await loadReleaseRecoveryTarget({ targetId: config.target.target_id,
      releaseId: config.target.release_id, migrationsDirectory: config.target.migrations_directory });
    const compatibility = assessRecoveryCompatibility({ sourceKind: trusted.descriptor.kind,
      sourceManifest: trusted.manifest, sourcePolicy: trusted.policy, targetReleaseId: target.metadata.releaseId,
      targetManifest: target.manifest });
    let final;
    try { final = await readBackupBrokerJournalSnapshot({ repository: opened.repository, signal }); }
    catch (cause) { throw mapSnapshotError(cause); }
    const finalPublication = findExactRecoveryPublication({ state: final, siteId: config.site_id,
      repositoryId: config.repository.repository_id, runId: plan.source.runId,
      manifestSha256: plan.source.manifestSha256 });
    if (!canonicalJson(publication).equals(canonicalJson(finalPublication)) ||
        !canonicalJson(trusted.descriptor).equals(canonicalJson(plan.source)) ||
        !canonicalJson(target.metadata).equals(canonicalJson(plan.target)) ||
        compatibility.classification !== plan.compatibility.classification ||
        compatibility.targetReleaseId !== plan.compatibility.targetReleaseId ||
        compatibility.targetSchemaMigrationId !== plan.compatibility.targetSchemaMigrationId ||
        !canonicalJson(compatibility.pendingMigrationIds).equals(canonicalJson(plan.compatibility.pendingMigrationIds))) {
      throw new RecoveryError('RECOVERY_SOURCE_CHANGED', 'Source, compatibility, or target evidence differs from the accepted plan.');
    }
  },
};

function defaultDependencies(): RecoveryWorkflowDependencies {
  return {
    loadConfig: loadV2Config,
    readPlan: readRecoveryPlanFile,
    readReview: loadRecoveryHoldDispositionReview,
    sourceVerifier: defaultRecoverySourceVerifier,
    journal: (config) => new RecoveryJournal({ root: config.journal.root }),
    broker: (config) => {
      const client = new BackupBrokerClient({ socketPath: config.broker.socket_path,
        helperVersion: config.broker.helper_version, policySha256: config.broker.policy_sha256,
        siteId: config.site_id, repositoryId: config.repository.repository_id,
        controlTimeoutMs: config.broker.control_timeout_ms });
      return { request: async (request, signal) => {
        signal?.throwIfAborted();
        await assertProtectedBrokerSocket(config.broker.socket_path);
        return client.request(request as BackupBrokerClientRequest, signal);
      } };
    },
    uuid: randomUUID,
    now: () => new Date(),
  };
}

async function assertProtectedBrokerSocket(path: string): Promise<void> {
  try {
    const parent = dirname(path);
    const [socket, socketReal, directory, directoryReal] = await Promise.all([
      fs.lstat(path, { bigint: true }), fs.realpath(path), fs.lstat(parent, { bigint: true }), fs.realpath(parent),
    ]);
    if (socket.isSymbolicLink() || !socket.isSocket() || Number(socket.mode & 0o777n) !== 0o660 || socketReal !== path ||
        directory.isSymbolicLink() || !directory.isDirectory() || directoryReal !== parent ||
        Number(directory.mode & 0o002n) !== 0) throw new Error('unprotected broker socket identity');
  } catch (cause) {
    throw new RecoveryError('RECOVERY_BROKER_REQUEST_FAILED', 'Broker socket is missing, noncanonical, or not protected.', { cause });
  }
}

function guard(state: RecoveryJournalState): RecoveryJournalGuard {
  return { expectedSequence: state.sequence, expectedOwnerId: state.ownerId, expectedFenceToken: state.fenceToken,
    expectedSiteId: state.siteId, expectedPlanId: state.planId, expectedPlanSha256: state.planSha256 };
}

function assertBinding(state: RecoveryJournalState, config: RecoveryOperatorConfigV2, plan: RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4, planSha256: string): void {
  if (state.operationId !== plan.operationId || state.siteId !== config.site_id || state.planId !== plan.planId ||
      state.planSha256 !== planSha256 || state.sourceDescriptorSha256 !== plan.source.descriptorSha256) {
    throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'Recovery journal identity does not match the accepted plan.');
  }
}

function requestFor(input: { operation: HoldOperation; state: RecoveryJournalState; plan: RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4;
  config: RecoveryOperatorConfigV2; uuid: () => string; now: () => Date }): RecoveryHoldRequest {
  const now = input.now();
  // Broker control reads have a strict <=60s admission bound. Leave one
  // second for transport/clock skew while retaining the configured longer
  // mutation deadline for ACQUIRE.
  const timeoutMs = input.operation === 'INSPECT_RESTORE_HOLD'
    ? Math.min(input.config.broker.control_timeout_ms, 59_000) : input.config.broker.control_timeout_ms;
  return { operation: input.operation, request_id: input.uuid(),
    deadline: new Date(now.getTime() + timeoutMs).toISOString(),
    run_id: input.plan.source.runId, attempt_id: input.plan.source.attemptId,
    capture_id: input.plan.source.captureId, capture_generation: input.plan.source.captureGeneration,
    manifest_sha256: input.plan.source.manifestSha256, operation_id: input.plan.operationId,
    owner_token: input.state.ownerId, fence_token: input.state.fenceToken };
}

function isAmbiguousMutationFailure(cause: unknown): boolean {
  return cause instanceof BackupBrokerClientError && cause.dispatched && !cause.authoritativeResponse &&
    ['BROKER_TIMEOUT', 'BROKER_CONNECTION_CLOSED', 'BROKER_CONNECTION_FAILED', 'BROKER_ABORTED',
      'BROKER_RESPONSE_TOO_LARGE', 'BROKER_RESPONSE_INVALID', 'BROKER_RESPONSE_IDENTITY_MISMATCH'].includes(cause.code);
}

function brokerFailure(cause: unknown, ambiguous: boolean): RecoveryError {
  return new RecoveryError(ambiguous ? 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' : 'RECOVERY_BROKER_REQUEST_FAILED',
    ambiguous ? 'Broker mutation outcome is ambiguous and requires exact reconciliation.' : 'Broker request failed before a valid external effect was established.', { cause });
}

function brokerCancellation(cause: unknown): RecoveryError | undefined {
  return cause instanceof BackupBrokerClientError && cause.code === 'BROKER_ABORTED'
    ? new RecoveryError('RECOVERY_CANCELLED', 'Recovery broker request was cancelled.', { cause }) : undefined;
}

async function inspectExact(input: { broker: RecoveryBrokerTransport; state: RecoveryJournalState; plan: RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4;
  config: RecoveryOperatorConfigV2; dependencies: RecoveryWorkflowDependencies; signal?: AbortSignal }) {
  const request = requestFor({ operation: 'INSPECT_RESTORE_HOLD', state: input.state, plan: input.plan,
    config: input.config, uuid: input.dependencies.uuid, now: input.dependencies.now });
  let response: BackupBrokerResponse;
  try { response = await input.broker.request(request, input.signal); }
  catch (cause) { throw brokerCancellation(cause) ?? brokerFailure(cause, false); }
  if (response.operation !== 'INSPECT_RESTORE_HOLD' || response.operation_id !== input.plan.operationId ||
      response.manifest_sha256 !== input.plan.source.manifestSha256) {
    throw new RecoveryError('RECOVERY_BROKER_REQUEST_FAILED', 'Broker inspection evidence did not match the exact lifecycle identity.');
  }
  return { request, response };
}

function evidenceDigest(input: { planSha256: string; request: RecoveryHoldRequest; response: BackupBrokerResponse }): string {
  return sha256RecoveryBytes(canonicalJson({ format: 'darshan-recovery-reconciliation-evidence-v1',
    plan_sha256: input.planSha256, request: input.request, response: input.response }));
}

async function acquire(input: { operation: ScopedRecoveryOperation; state: RecoveryJournalState; broker: RecoveryBrokerTransport;
  plan: RecoveryPlanV2 | RecoveryPlanV3 | RecoveryPlanV4; planSha256: string; config: RecoveryOperatorConfigV2; dependencies: RecoveryWorkflowDependencies;
  intentPresent?: boolean; signal?: AbortSignal }): Promise<RecoveryJournalState> {
  let state = input.state;
  if (!input.intentPresent) state = await input.operation.recordPhaseIntent('SOURCE_HELD');
  const request = requestFor({ operation: 'ACQUIRE_RESTORE_HOLD', state, plan: input.plan, config: input.config,
    uuid: input.dependencies.uuid, now: input.dependencies.now });
  let response: BackupBrokerResponse;
  try {
    response = await input.broker.request(request, input.signal);
  } catch (cause) {
    const ambiguous = isAmbiguousMutationFailure(cause);
    const error = !ambiguous ? brokerCancellation(cause) ?? brokerFailure(cause, false) : brokerFailure(cause, true);
    await input.operation.recordPhaseFailure(error.code,
      ambiguous ? 'AMBIGUOUS_EXTERNAL_EFFECT' : 'DEFINITE_PRE_EFFECT');
    throw error;
  }
  if (response.operation !== 'ACQUIRE_RESTORE_HOLD' || response.operation_id !== input.plan.operationId || response.status !== 'ACTIVE') {
    const error = new RecoveryError('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'Broker hold response did not establish trustworthy exact outcome evidence.');
    await input.operation.recordPhaseFailure(error.code, 'AMBIGUOUS_EXTERNAL_EFFECT');
    throw error;
  }
  try { return await input.operation.completePhase('SOURCE_HELD'); }
  catch (cause) {
    // ACTIVE is externally conclusive, but the local completion boundary is
    // not. Keep the intent for evidence-bound resume and never release here.
    await input.operation.recordPhaseFailure('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'AMBIGUOUS_EXTERNAL_EFFECT');
    throw new RecoveryError('RECOVERY_BROKER_EFFECT_AMBIGUOUS',
      'Broker hold is active but local phase completion requires reconciliation.', { cause });
  }
}

function result(state: RecoveryJournalState, brokerTruth: RecoveryWorkflowResult['brokerTruth'] = 'UNKNOWN',
  inspectedTargetTruth?: 'READY' | 'STOPPED_RETAINED' | 'RETIRED' | 'ABSENT' | 'UNKNOWN'): RecoveryWorkflowResult {
  const closure = state.holdDisposition === null ? null : { decisionId: state.holdDisposition.decisionId,
    closedAs: state.holdDisposition.closedAs, action: state.holdDisposition.action,
    status: state.holdDisposition.status, failureCode: state.holdDisposition.failureCode };
  const terminalLocalHold = state.lastFailureCode === 'RECOVERY_HOLD_RELEASED' ||
    state.lastFailureCode === 'RECOVERY_HOLD_UNCERTAIN';
  const truthConflict = brokerTruth !== 'UNKNOWN' && (state.phase === 'PLANNED'
    ? brokerTruth !== 'ABSENT' && !(brokerTruth === 'ACTIVE' && state.pendingPhase === 'SOURCE_HELD')
    : brokerTruth !== 'ACTIVE');
  const dispositionTruthConflict = state.holdDisposition?.status === 'CONFIRMED' && brokerTruth !== 'UNKNOWN' &&
    brokerTruth !== (state.holdDisposition.action === 'RELEASE' ? 'RELEASED' : 'UNCERTAIN');
  const nextAction: RecoveryWorkflowResult['nextAction'] = state.holdDisposition?.status === 'PENDING' || dispositionTruthConflict ||
      (state.holdDisposition === null && (terminalLocalHold || truthConflict ||
      brokerTruth === 'RELEASED' || brokerTruth === 'UNCERTAIN'
    )) ? 'OPERATOR_REVIEW' : state.holdDisposition?.status === 'CONFIRMED' ? 'NONE'
      : state.pendingPhase !== null || state.lastFailureCode !== null ? 'RESUME'
      : state.phase === 'PLANNED' ? 'HOLD' : state.phase === 'SOURCE_HELD' ? 'VERIFY_SOURCE'
        : state.phase === 'SOURCE_VERIFIED' && state.targetBinding !== null ? 'PREPARE_TARGETS' : 'NONE';
  const targetLifecycle: RecoveryWorkflowResult['targetLifecycle'] = state.targetBinding === null ? 'NOT_APPLICABLE'
    : inspectedTargetTruth === 'ABSENT' ? 'NOT_PREPARED' : inspectedTargetTruth ??
      state.targetDisposition?.finalState ?? (state.phase === 'TARGETS_PREPARED' ? 'READY' : 'NOT_PREPARED');
  return { operationId: state.operationId, phase: state.phase, pendingPhase: state.pendingPhase,
    failureCode: state.lastFailureCode, brokerTruth, nextAction, closure,
    targetLifecycle, targetHelperSequence: state.targetDisposition?.helperSequence ?? state.targetHelperSequence };
}

async function loadContext(input: RecoveryWorkflowInput, dependencies: RecoveryWorkflowDependencies) {
  input.signal?.throwIfAborted();
  const plan = await dependencies.readPlan({ path: input.planFile, expectedSha256: input.planSha256,
    ...(input.signal ? { signal: input.signal } : {}) });
  const config = await dependencies.loadConfig(input.configFile, input.signal);
  if (config.site_id !== plan.source.siteId || config.repository.repository_id !== plan.source.repositoryId) {
    throw new RecoveryError('RECOVERY_SOURCE_IDENTITY_MISMATCH', 'Operator config and accepted plan identify different sources.');
  }
  return { plan, config, journal: dependencies.journal(config), broker: dependencies.broker(config) };
}

export class RecoveryOperatorWorkflow {
  private readonly dependencies: RecoveryWorkflowDependencies;
  constructor(dependencies: Partial<RecoveryWorkflowDependencies> = {}) {
    const defaults = defaultDependencies();
    this.dependencies = { ...defaults, ...dependencies,
      sourceVerifier: dependencies.sourceVerifier ?? defaults.sourceVerifier };
  }

  async hold(input: RecoveryWorkflowInput): Promise<RecoveryWorkflowResult> {
    const context = await loadContext(input, this.dependencies);
    await this.dependencies.sourceVerifier.verify(context.config, context.plan, input.signal);
    input.signal?.throwIfAborted();
    const created = await context.journal.create({ operationId: context.plan.operationId, siteId: context.config.site_id,
      planId: context.plan.planId, planSha256: input.planSha256,
      sourceDescriptorSha256: context.plan.source.descriptorSha256,
      ownerId: this.dependencies.uuid(), fenceToken: this.dependencies.uuid(),
      ...(context.plan.format === RECOVERY_PLAN_FORMAT_V3 || context.plan.format === RECOVERY_PLAN_FORMAT_V4 ? { targetBinding: {
        targetSetId: context.plan.targetPreparation.targetSetId, generation: context.plan.targetPreparation.generation,
        hostInstallationId: context.plan.targetPreparation.hostInstallationId, topologyMode: context.plan.targetPreparation.topologyMode,
        targetSpecificationSha256: context.plan.targetPreparation.targetSpecificationSha256,
      } } : {}) });
    const state = await context.journal.withOperation(created.operationId, guard(created), (operation) =>
      acquire({ operation, state: created, broker: context.broker, plan: context.plan, planSha256: input.planSha256,
        config: context.config, dependencies: this.dependencies, signal: input.signal }));
    return result(state, 'ACTIVE');
  }

  async verifySource(input: RecoveryWorkflowInput): Promise<RecoveryWorkflowResult> {
    const context = await loadContext(input, this.dependencies); const current = await context.journal.read(context.plan.operationId);
    assertBinding(current, context.config, context.plan, input.planSha256);
    if (current.holdDisposition !== null) throw new RecoveryError('RECOVERY_OPERATION_CLOSED', 'Closed recovery operation cannot verify or resume.');
    if (current.phase !== 'SOURCE_HELD' || current.pendingPhase !== null) {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'Source verification requires one durable completed source hold.');
    }
    const state = await context.journal.withOperation(current.operationId, guard(current), async (operation) => {
      try {
        const before = await inspectExact({ broker: context.broker, state: current, plan: context.plan,
          config: context.config, dependencies: this.dependencies, signal: input.signal });
        if (before.response.status !== 'ACTIVE') throw holdStatusError(before.response.status);
        await this.dependencies.sourceVerifier.verify(context.config, context.plan, input.signal);
        const after = await inspectExact({ broker: context.broker, state: current, plan: context.plan,
          config: context.config, dependencies: this.dependencies, signal: input.signal });
        if (after.response.status !== 'ACTIVE') throw holdStatusError(after.response.status);
        await operation.recordPhaseIntent('SOURCE_VERIFIED');
        return operation.completePhase('SOURCE_VERIFIED');
      } catch (cause) {
        const error = asRecoveryError(cause);
        await operation.recordPhaseFailure(error.code, 'DEFINITE_PRE_EFFECT');
        throw error;
      }
    });
    return result(state, 'ACTIVE');
  }

  async resume(input: RecoveryWorkflowInput): Promise<RecoveryWorkflowResult> {
    const context = await loadContext(input, this.dependencies); const current = await context.journal.read(context.plan.operationId);
    assertBinding(current, context.config, context.plan, input.planSha256);
    if (current.holdDisposition !== null) throw new RecoveryError('RECOVERY_OPERATION_CLOSED', 'Closed recovery operation cannot verify or resume.');
    if (current.phase === 'SOURCE_VERIFIED' && (current.pendingPhase === null || current.pendingPhase === 'TARGETS_PREPARED')) {
      if (context.plan.format !== RECOVERY_PLAN_FORMAT_V3 && context.plan.format !== RECOVERY_PLAN_FORMAT_V4) return result(current, 'UNKNOWN');
      if (!this.dependencies.targetController) throw new RecoveryError('RECOVERY_TARGET_UNSUPPORTED', 'Target-capable plan resume requires the reviewed target-helper controller.');
      const targetPlan = context.plan;
      await this.dependencies.targetController.prepare(targetPlan, input.planSha256, input.signal);
      const reloaded = await context.journal.read(context.plan.operationId);
      assertBinding(reloaded, context.config, context.plan, input.planSha256);
      const authoritative = await context.journal.withOperation(reloaded.operationId, guard(reloaded), async (operation) => {
        const state = await operation.read(); assertBinding(state, context.config, context.plan, input.planSha256);
        const target = targetPlan.targetPreparation; const binding = state.targetBinding;
        if (state.phase !== 'TARGETS_PREPARED' || state.pendingPhase !== null || state.targetEffectStatus !== 'READY_PROVEN' ||
            state.targetReceiptSha256 === null || state.targetHelperSequence === null ||
            state.targetPreparationRequest?.status !== 'COMPLETED' || binding === null || binding.targetSetId !== target.targetSetId ||
            binding.generation !== target.generation || binding.hostInstallationId !== target.hostInstallationId ||
            binding.topologyMode !== target.topologyMode || binding.targetSpecificationSha256 !== target.targetSpecificationSha256) {
          throw new RecoveryError('RECOVERY_TARGET_RECEIPT_MISMATCH', 'Target controller did not produce exact durable TARGETS_PREPARED evidence.');
        }
        const brokerTruth = await inspectExact({ broker: context.broker, state, plan: context.plan,
          config: context.config, dependencies: this.dependencies, signal: input.signal });
        if (brokerTruth.response.status !== 'ACTIVE') throw holdStatusError(brokerTruth.response.status);
        const targetTruth = await this.dependencies.targetController!.inspect(targetPlan, input.planSha256, input.signal);
        if (targetTruth !== 'READY') throw new RecoveryError('RECOVERY_TARGET_RECEIPT_MISMATCH', 'Exact helper truth does not match durable READY evidence.');
        return state;
      });
      return result(authoritative, 'ACTIVE', 'READY');
    }
    const state = await context.journal.withOperation(current.operationId, guard(current), async (operation) => {
      let state = await operation.read();
      if (state.lastFailureCode === 'RECOVERY_HOLD_RELEASED') throw holdStatusError('RELEASED');
      if (state.lastFailureCode === 'RECOVERY_HOLD_UNCERTAIN') throw holdStatusError('UNCERTAIN');
      if (state.phase === 'PLANNED') {
        let inspected: Awaited<ReturnType<typeof inspectExact>>;
        try { inspected = await inspectExact({ broker: context.broker, state, plan: context.plan,
          config: context.config, dependencies: this.dependencies, signal: input.signal }); }
        catch (cause) {
          const error = asRecoveryError(cause);
          // Inspection is read-only. A failed observation cannot disprove or
          // clear a previously durable hold intent/ambiguity; a later exact
          // inspection must reconcile it.
          if (state.pendingPhase === null) await operation.recordPhaseFailure(error.code, 'DEFINITE_PRE_EFFECT');
          throw error;
        }
        if (inspected.response.status === 'ACTIVE') {
          if (state.pendingPhase !== 'SOURCE_HELD') {
            throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'Active hold has no matching local phase intent.');
          }
          if (state.failureDisposition !== 'AMBIGUOUS_EXTERNAL_EFFECT') {
            state = await operation.recordPhaseFailure('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'AMBIGUOUS_EXTERNAL_EFFECT');
          }
          state = await operation.resolveAmbiguousPhase('SOURCE_HELD', evidenceDigest({ planSha256: input.planSha256,
            request: inspected.request, response: inspected.response }));
        } else if (inspected.response.status === 'ABSENT') {
          if (state.pendingPhase !== null) state = await operation.recordPhaseFailure('RECOVERY_BROKER_REQUEST_FAILED', 'DEFINITE_PRE_EFFECT');
          await this.dependencies.sourceVerifier.verify(context.config, context.plan, input.signal);
          state = await acquire({ operation, state, broker: context.broker, plan: context.plan, planSha256: input.planSha256,
            config: context.config, dependencies: this.dependencies, signal: input.signal });
        } else {
          const error = holdStatusError(inspected.response.status);
          await operation.recordPhaseFailure(error.code, 'DEFINITE_PRE_EFFECT'); throw error;
        }
      }
      if (state.phase === 'SOURCE_HELD') {
        try {
          const before = await inspectExact({ broker: context.broker, state, plan: context.plan,
            config: context.config, dependencies: this.dependencies, signal: input.signal });
          if (before.response.status !== 'ACTIVE') throw holdStatusError(before.response.status);
          await this.dependencies.sourceVerifier.verify(context.config, context.plan, input.signal);
          const after = await inspectExact({ broker: context.broker, state, plan: context.plan,
            config: context.config, dependencies: this.dependencies, signal: input.signal });
          if (after.response.status !== 'ACTIVE') throw holdStatusError(after.response.status);
          if (state.pendingPhase === 'SOURCE_VERIFIED') {
            state = state.failureDisposition === 'AMBIGUOUS_EXTERNAL_EFFECT'
              ? await operation.resolveAmbiguousPhase('SOURCE_VERIFIED', evidenceDigest({ planSha256: input.planSha256,
                request: after.request, response: after.response }))
              : await operation.completePhase('SOURCE_VERIFIED');
          } else {
            state = await operation.recordPhaseIntent('SOURCE_VERIFIED');
            state = await operation.completePhase('SOURCE_VERIFIED');
          }
        } catch (cause) {
          const error = asRecoveryError(cause);
          const latest = await operation.read();
          if (latest.lastFailureCode !== error.code || latest.failureDisposition !== 'DEFINITE_PRE_EFFECT') {
            await operation.recordPhaseFailure(error.code, 'DEFINITE_PRE_EFFECT');
          }
          throw error;
        }
      }
      return state;
    });
    return result(state, state.phase === 'PLANNED' ? 'UNKNOWN' : 'ACTIVE');
  }

  async status(input: RecoveryWorkflowInput & { offline?: boolean }): Promise<RecoveryWorkflowResult> {
    const context = await loadContext(input, this.dependencies); const state = await context.journal.read(context.plan.operationId);
    assertBinding(state, context.config, context.plan, input.planSha256);
    if (input.offline) return result(state, 'UNKNOWN', state.targetBinding === null ? undefined : 'UNKNOWN');
    const inspected = await inspectExact({ broker: context.broker, state, plan: context.plan,
      config: context.config, dependencies: this.dependencies, signal: input.signal });
    if (state.holdDisposition?.status === 'CONFIRMED' && inspected.response.status !==
        (state.holdDisposition.action === 'RELEASE' ? 'RELEASED' : 'UNCERTAIN')) {
      throw new RecoveryError('RECOVERY_DISPOSITION_TRUTH_CONFLICT', 'Confirmed closure contradicts exact broker truth.');
    }
    let targetTruth: 'READY' | 'STOPPED_RETAINED' | 'RETIRED' | 'ABSENT' | 'UNKNOWN' | undefined;
    if ((context.plan.format === RECOVERY_PLAN_FORMAT_V3 || context.plan.format === RECOVERY_PLAN_FORMAT_V4) && this.dependencies.targetController) {
      targetTruth = await this.dependencies.targetController.inspect(context.plan, input.planSha256, input.signal);
      if (state.phase === 'TARGETS_PREPARED' && targetTruth !== 'READY' &&
          targetTruth !== state.targetDisposition?.finalState) {
        throw new RecoveryError('RECOVERY_TARGET_RECEIPT_MISMATCH', 'Online target inspection contradicts the durable target receipt.');
      }
    }
    return result(state, inspected.response.status, targetTruth ?? (state.targetBinding === null ? undefined : 'UNKNOWN'));
  }

  async release(input: RecoveryDispositionInput): Promise<RecoveryWorkflowResult> {
    return this.dispose(input, 'RELEASE');
  }

  async abandon(input: RecoveryDispositionInput): Promise<RecoveryWorkflowResult> {
    return this.dispose(input, 'MARK_UNCERTAIN');
  }

  private async dispose(input: RecoveryDispositionInput, action: 'RELEASE' | 'MARK_UNCERTAIN'): Promise<RecoveryWorkflowResult> {
    const [context, reviewed] = await Promise.all([
      loadContext(input, this.dependencies),
      this.dependencies.readReview({ path: input.reviewFile, expectedSha256: input.reviewSha256,
        ...(input.signal ? { signal: input.signal } : {}) }),
    ]);
    const current = await context.journal.read(context.plan.operationId);
    assertBinding(current, context.config, context.plan, input.planSha256);
    const review = reviewed.review;
    if (input.confirmOperationId !== context.plan.operationId || review.operationId !== context.plan.operationId ||
        review.operationId !== input.confirmOperationId || review.action !== action || review.planSha256 !== input.planSha256 ||
        review.sourceDescriptorSha256 !== context.plan.source.descriptorSha256) {
      throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Review and explicit confirmation do not bind the exact recovery operation.');
    }
    const matching = current.holdDisposition?.decisionId === review.decisionId &&
      current.holdDisposition.reviewSha256 === reviewed.reviewSha256 && current.holdDisposition.action === action;
    if (!matching && current.sequence !== review.expectedJournalSequence) {
      throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Review expected journal sequence is stale.');
    }
    if (!matching && current.holdDisposition !== null) {
      if (!(current.holdDisposition.status === 'CONFIRMED' && current.holdDisposition.action === 'MARK_UNCERTAIN' &&
          action === 'RELEASE' && current.holdDisposition.observedStatus === 'UNCERTAIN')) {
        throw new RecoveryError('RECOVERY_OPERATION_CLOSED', 'A different irreversible disposition already closed this operation.');
      }
      if (review.expectedHoldStatus !== 'UNCERTAIN') throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Superseding release must review exact UNCERTAIN truth.');
    }
    if (!matching && current.phase === 'PLANNED' && current.pendingPhase !== 'SOURCE_HELD') {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'A plain planned operation has no durable hold intent to disposition.');
    }
    let state: RecoveryJournalState;
    try { state = await context.journal.withOperation(current.operationId, guard(current), async (operation) => {
      let state = await operation.read();
      const assertTargetReleaseTruth = async (): Promise<void> => {
        if (action !== 'RELEASE' || (context.plan.format !== RECOVERY_PLAN_FORMAT_V3 && context.plan.format !== RECOVERY_PLAN_FORMAT_V4)) return;
        if (!this.dependencies.targetController) {
          throw new RecoveryError('RECOVERY_TARGET_UNSUPPORTED', 'Plan v3 release requires exact target-helper inspection.');
        }
        const targetTruth = await this.dependencies.targetController.inspect(context.plan, input.planSha256, input.signal);
        const exactNoEffect = state.targetEffectStatus === 'NONE_PROVEN' && targetTruth === 'ABSENT';
        const exactDisposed = state.targetEffectStatus === 'DISPOSED_PROVEN' && state.targetDisposition !== null &&
          targetTruth === state.targetDisposition.finalState;
        if (!exactNoEffect && !exactDisposed) {
          throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Source release is blocked until exact target no-effect or disposed truth is proven.');
        }
      };
      await assertTargetReleaseTruth();
      let before = await inspectExact({ broker: context.broker, state, plan: context.plan,
        config: context.config, dependencies: this.dependencies, signal: input.signal });
      const desired = action === 'RELEASE' ? 'RELEASED' : 'UNCERTAIN';
      if (matching && state.holdDisposition?.status === 'CONFIRMED') {
        if (state.holdDisposition.decisionId !== review.decisionId || before.response.status !== desired) {
          throw new RecoveryError('RECOVERY_DISPOSITION_TRUTH_CONFLICT', 'Confirmed decision no longer matches exact broker truth.');
        }
        return state;
      }
      if (!matching) {
        if (before.response.status !== review.expectedHoldStatus) {
          throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Exact hold status differs from the reviewed expected status.');
        }
        const priorDecisionSha256 = state.holdDisposition === null ? null
          : sha256RecoveryBytes(canonicalRecoveryBytes(state.holdDisposition));
        state = await operation.recordHoldDisposition({ decisionId: review.decisionId, closedAs: review.closedAs,
          action: review.action, status: 'PENDING', reviewSha256: reviewed.reviewSha256, reviewedAt: review.reviewedAt,
          reviewEvidenceSha256: review.retainedReviewEvidenceSha256,
          observedStatus: before.response.status, observedEvidenceSha256: evidenceDigest({ planSha256: input.planSha256,
            request: before.request, response: before.response }), confirmedAt: null, failureCode: null, priorDecisionSha256 });
      }
      if (before.response.status !== desired) {
        await assertTargetReleaseTruth();
        const mutation = requestFor({ operation: action === 'RELEASE' ? 'RELEASE_RESTORE_HOLD' : 'MARK_RESTORE_HOLD_UNCERTAIN',
          state, plan: context.plan, config: context.config, uuid: this.dependencies.uuid, now: this.dependencies.now });
        try {
          const acknowledged = await context.broker.request(mutation, input.signal);
          if (acknowledged.operation !== mutation.operation || acknowledged.operation_id !== context.plan.operationId) {
            throw new RecoveryError('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'Disposition acknowledgement identity was not authoritative.');
          }
        } catch {
          // Any unsuccessful acknowledgement may have persisted. Exact inspect
          // below is the only authority; the operation remains closed/pending.
        }
      }
      try { before = await inspectExact({ broker: context.broker, state, plan: context.plan,
        config: context.config, dependencies: this.dependencies, signal: input.signal }); }
      catch (cause) {
        await operation.updateHoldDisposition({ decisionId: review.decisionId, observedStatus: null,
          observedEvidenceSha256: null, confirmedAt: null, failureCode: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
        throw new RecoveryError('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'Disposition is closed and pending exact reconciliation.', { cause });
      }
      const evidenceSha256 = evidenceDigest({ planSha256: input.planSha256, request: before.request, response: before.response });
      if (before.response.status !== desired) {
        await operation.updateHoldDisposition({ decisionId: review.decisionId, observedStatus: before.response.status,
          observedEvidenceSha256: evidenceSha256, confirmedAt: null, failureCode: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
        throw new RecoveryError('RECOVERY_BROKER_EFFECT_AMBIGUOUS', 'Disposition remains pending because exact terminal truth was not established.');
      }
      return operation.updateHoldDisposition({ decisionId: review.decisionId, observedStatus: desired,
        observedEvidenceSha256: evidenceSha256, confirmedAt: this.dependencies.now().toISOString(), failureCode: null });
    }); } catch (cause) {
      if (!(cause instanceof RecoveryError) || cause.code !== 'RECOVERY_JOURNAL_CONFLICT') throw cause;
      const reloaded = await context.journal.read(context.plan.operationId);
      assertBinding(reloaded, context.config, context.plan, input.planSha256);
      if (reloaded.holdDisposition?.status !== 'CONFIRMED' ||
          reloaded.holdDisposition.decisionId !== review.decisionId ||
          reloaded.holdDisposition.reviewSha256 !== reviewed.reviewSha256 ||
          reloaded.holdDisposition.action !== action) throw cause;
      const inspected = await inspectExact({ broker: context.broker, state: reloaded, plan: context.plan,
        config: context.config, dependencies: this.dependencies, signal: input.signal });
      const desired = action === 'RELEASE' ? 'RELEASED' : 'UNCERTAIN';
      if (inspected.response.status !== desired) {
        throw new RecoveryError('RECOVERY_DISPOSITION_TRUTH_CONFLICT', 'Concurrent confirmed decision contradicts exact broker truth.');
      }
      state = reloaded;
    }
    return result(state, state.holdDisposition?.observedStatus ?? 'UNKNOWN');
  }
}

function holdStatusError(status: 'ABSENT' | 'ACTIVE' | 'UNCERTAIN' | 'RELEASED'): RecoveryError {
  if (status === 'RELEASED') return new RecoveryError('RECOVERY_HOLD_RELEASED', 'Exact recovery hold was released and will not be reacquired.');
  if (status === 'UNCERTAIN') return new RecoveryError('RECOVERY_HOLD_UNCERTAIN', 'Exact recovery hold is uncertain and requires operator review.');
  return new RecoveryError('RECOVERY_HOLD_NOT_ACTIVE', 'Exact recovery hold is not active.');
}

function asRecoveryError(cause: unknown): RecoveryError {
  if (cause instanceof RecoveryError) return cause;
  return brokerFailure(cause, false);
}

const defaultWorkflow = new RecoveryOperatorWorkflow();
export const runRecoveryHold = (input: RecoveryWorkflowInput) => defaultWorkflow.hold(input);
export const runRecoverySourceVerification = (input: RecoveryWorkflowInput) => defaultWorkflow.verifySource(input);
export const runRecoveryResume = (input: RecoveryWorkflowInput) => defaultWorkflow.resume(input);
export const runRecoveryStatus = (input: RecoveryWorkflowInput & { offline?: boolean }) => defaultWorkflow.status(input);
export const runRecoveryRelease = (input: RecoveryDispositionInput) => defaultWorkflow.release(input);
export const runRecoveryAbandon = (input: RecoveryDispositionInput) => defaultWorkflow.abandon(input);
