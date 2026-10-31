import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupBrokerClientError } from '../backups/backup-broker-client';
import type { BackupBrokerResponse } from '../backups/backup-broker-protocol';
import { recoverySourceDescriptorV2Digest, recoveryTargetSetId, type RecoveryPlanV2, type RecoveryPlanV3 } from './contracts';
import { RecoveryError } from './errors';
import type { RecoveryHoldDispositionReview } from './hold-disposition-review';
import { RecoveryJournal, type RecoveryJournalGuard, type ScopedRecoveryOperation } from './journal';
import { RECOVERY_OPERATOR_CONFIG_FORMAT_V2, type RecoveryOperatorConfigV2 } from './operator-inputs';
import { RecoveryOperatorWorkflow, type RecoveryBrokerTransport, type RecoveryHoldRequest } from './operator-workflow';
import { RELEASE_RECOVERY_TARGET } from './release-target';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'recovery-workflow-')); roots.push(root); await fs.chmod(root, 0o700);
  const operationId = randomUUID(); const planId = randomUUID(); const repositoryId = randomUUID();
  const sourceIdentity = { kind: 'LOCAL_FILESYSTEM_V2' as const, siteId: 'site-a', repositoryId,
    runId: randomUUID(), attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 7,
    manifestSha256: 'a'.repeat(64), releaseId: 'release-01', schemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId,
    schemaFingerprintSha256: RELEASE_RECOVERY_TARGET.migrationManifestSha256,
    repositoryDescriptorSha256: 'c'.repeat(64) };
  const plan: RecoveryPlanV2 = { format: 'darshan-recovery-plan-v2', planId, operationId,
    createdAt: '2026-10-29T00:00:00.000Z', source: { ...sourceIdentity,
      descriptorSha256: recoverySourceDescriptorV2Digest(sourceIdentity), fullyEligible: true },
    target: { ...RELEASE_RECOVERY_TARGET }, compatibility: { classification: 'COMPATIBLE_CURRENT',
      targetReleaseId: 'release-01', targetSchemaMigrationId: RELEASE_RECOVERY_TARGET.terminalMigrationId,
      pendingMigrationIds: [] } };
  const config: RecoveryOperatorConfigV2 = { format: RECOVERY_OPERATOR_CONFIG_FORMAT_V2, site_id: 'site-a',
    repository: { root: '/repository', device_id: '1', owner_uid: 1, owner_gid: 1, repository_id: repositoryId },
    trust: { policy_keyring_file: '/policy', manifest_keyring_file: '/manifest' },
    target: { target_id: 'darshan-server-release-01', release_id: 'release-01', migrations_directory: '/migrations' },
    broker: { socket_path: '/run/darshan/backup-broker.sock', helper_version: 'test', policy_sha256: 'd'.repeat(64), control_timeout_ms: 10_000 },
    journal: { root } };
  return { root, plan, config, planSha256: 'b'.repeat(64) };
}

function planV3(value: Awaited<ReturnType<typeof fixture>>): RecoveryPlanV3 {
  const identity = { generation: 1, hostInstallationId: randomUUID(), topologyMode: 'SINGLE_HOST' as const,
    hostPolicySha256: '1'.repeat(64), helperRoleSha256: '2'.repeat(64), engineProfileSha256: '3'.repeat(64),
    protectionInventorySha256: '4'.repeat(64), capacityEvidenceSha256: '5'.repeat(64),
    storageInventorySha256: '6'.repeat(64), targetSpecificationSha256: '7'.repeat(64) };
  return { ...value.plan, format: 'darshan-recovery-plan-v3',
    compatibility: { ...value.plan.compatibility, sourceLedgerLength: 55, fullyEligible: true },
    targetPreparation: { ...identity, targetSetId: recoveryTargetSetId(identity) } };
}

class Broker implements RecoveryBrokerTransport {
  status: 'ABSENT' | 'ACTIVE' | 'UNCERTAIN' | 'RELEASED' = 'ABSENT';
  requests: RecoveryHoldRequest[] = [];
  acquireFailure?: (request: RecoveryHoldRequest) => Error;
  inspectFailure?: Error;
  async request(request: RecoveryHoldRequest): Promise<BackupBrokerResponse> {
    this.requests.push(request);
    if (request.operation === 'INSPECT_RESTORE_HOLD') {
      if (this.inspectFailure) throw this.inspectFailure;
      return { protocol_version: 2, request_id: request.request_id, helper_version: 'test', policy_sha256: 'd'.repeat(64),
        operation: request.operation, operation_id: request.operation_id, manifest_sha256: request.manifest_sha256,
        status: this.status };
    }
    if (this.acquireFailure) throw this.acquireFailure(request);
    this.status = request.operation === 'RELEASE_RESTORE_HOLD' ? 'RELEASED'
      : request.operation === 'MARK_RESTORE_HOLD_UNCERTAIN' ? 'UNCERTAIN' : 'ACTIVE';
    return { protocol_version: 2, request_id: request.request_id, helper_version: 'test', policy_sha256: 'd'.repeat(64),
      operation: request.operation, operation_id: request.operation_id, status: this.status as 'ACTIVE' | 'RELEASED' | 'UNCERTAIN' };
  }
}

function dispositionWorkflow(value: Awaited<ReturnType<typeof fixture>>, broker: Broker,
  review: RecoveryHoldDispositionReview, reviewSha256 = 'e'.repeat(64)) {
  const journal = new RecoveryJournal({ root: value.root });
  return { journal, workflow: new RecoveryOperatorWorkflow({
    loadConfig: async () => value.config, readPlan: async () => value.plan,
    readReview: async () => ({ review, reviewSha256 }), sourceVerifier: { verify: async () => undefined },
    journal: () => journal, broker: () => broker,
  }) };
}

function dispositionReview(value: Awaited<ReturnType<typeof fixture>>, input: {
  action: 'RELEASE' | 'MARK_UNCERTAIN'; sequence: number; expectedHoldStatus?: 'ACTIVE' | 'UNCERTAIN';
}): RecoveryHoldDispositionReview {
  return { format: 'darshan-recovery-hold-disposition-review-v1', decisionId: randomUUID(),
    operationId: value.plan.operationId, action: input.action,
    closedAs: input.action === 'RELEASE' ? 'ABORTED_PRE_IMPORT' : 'ABANDONED',
    planSha256: value.planSha256, sourceDescriptorSha256: value.plan.source.descriptorSha256,
    expectedJournalSequence: input.sequence, expectedHoldStatus: input.expectedHoldStatus ?? 'ACTIVE',
    reviewedAt: '2026-10-29T04:00:00.000Z', retainedReviewEvidenceSha256: 'f'.repeat(64) };
}

function workflow(value: Awaited<ReturnType<typeof fixture>>, broker: Broker, verify = vi.fn().mockResolvedValue(undefined)) {
  const journal = new RecoveryJournal({ root: value.root });
  return { journal, verify, workflow: new RecoveryOperatorWorkflow({
    loadConfig: async () => value.config, readPlan: async () => value.plan,
    sourceVerifier: { verify }, journal: () => journal, broker: () => broker,
  }) };
}

class OneShotCompletionFailureJournal extends RecoveryJournal {
  private failCompletion = true;
  override withOperation<T>(operationId: string, operationGuard: RecoveryJournalGuard,
    callback: (operation: ScopedRecoveryOperation) => Promise<T>): Promise<T> {
    return super.withOperation(operationId, operationGuard, (operation) => callback({ ...operation,
      completePhase: async (target) => {
        if (target === 'SOURCE_HELD' && this.failCompletion) {
          this.failCompletion = false;
          throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'injected completion boundary');
        }
        return operation.completePhase(target);
      },
    }));
  }
}

class OneShotDispositionConfirmationFailureJournal extends RecoveryJournal {
  private failConfirmation = true;
  override withOperation<T>(operationId: string, operationGuard: RecoveryJournalGuard,
    callback: (operation: ScopedRecoveryOperation) => Promise<T>): Promise<T> {
    return super.withOperation(operationId, operationGuard, (operation) => callback({ ...operation,
      updateHoldDisposition: async (update) => {
        if (update.confirmedAt !== null && this.failConfirmation) {
          this.failConfirmation = false;
          throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'injected disposition confirmation boundary');
        }
        return operation.updateHoldDisposition(update);
      },
    }));
  }
}

class DeterministicStaleGuardJournal extends RecoveryJournal {
  private scopes = 0;
  private signalSecond!: () => void;
  private signalFirstDone!: () => void;
  readonly secondArrived = new Promise<void>((resolve) => { this.signalSecond = resolve; });
  private readonly firstDone = new Promise<void>((resolve) => { this.signalFirstDone = resolve; });
  override async withOperation<T>(operationId: string, operationGuard: RecoveryJournalGuard,
    callback: (operation: ScopedRecoveryOperation) => Promise<T>): Promise<T> {
    this.scopes += 1;
    if (this.scopes === 2) {
      this.signalSecond(); await this.firstDone;
      return super.withOperation(operationId, operationGuard, callback);
    }
    try { return await super.withOperation(operationId, operationGuard, callback); }
    finally { this.signalFirstDone(); }
  }
}

const input = (value: Awaited<ReturnType<typeof fixture>>) => ({ configFile: '/config', planFile: '/plan', planSha256: value.planSha256 });

describe('recovery hold and source-verification workflow', () => {
  it('holds then verifies between two exact active inspections without automatic release', async () => {
    const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).resolves.toMatchObject({ phase: 'SOURCE_HELD', brokerTruth: 'ACTIVE' });
    await expect(created.workflow.verifySource(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED', nextAction: 'NONE' });
    expect(broker.requests.map((request) => request.operation)).toEqual([
      'ACQUIRE_RESTORE_HOLD', 'INSPECT_RESTORE_HOLD', 'INSPECT_RESTORE_HOLD',
    ]);
    expect(broker.status).toBe('ACTIVE'); expect(created.verify).toHaveBeenCalledTimes(2);
  });

  it('records a pre-dispatch acquire failure as definite and clears pending intent', async () => {
    const value = await fixture(); const broker = new Broker();
    broker.acquireFailure = () => new BackupBrokerClientError('BROKER_CONNECTION_FAILED', 'before connect', true, false);
    const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_REQUEST_FAILED' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ phase: 'PLANNED', pendingPhase: null,
      failureDisposition: 'DEFINITE_PRE_EFFECT', lastFailureCode: 'RECOVERY_BROKER_REQUEST_FAILED' });
  });

  it('records a pre-dispatch acquire abort as definite cancellation with no ambiguous effect', async () => {
    const value = await fixture(); const broker = new Broker();
    broker.acquireFailure = () => new BackupBrokerClientError('BROKER_ABORTED', 'before dispatch', true, false);
    const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_CANCELLED' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ phase: 'PLANNED', pendingPhase: null,
      failureDisposition: 'DEFINITE_PRE_EFFECT', lastFailureCode: 'RECOVERY_CANCELLED' });
  });

  it('maps read-only inspection abort to cancellation without mutation ambiguity', async () => {
    const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
    await created.workflow.hold(input(value));
    broker.inspectFailure = new BackupBrokerClientError('BROKER_ABORTED', 'inspection abort', true, true);
    await expect(created.workflow.status(input(value))).rejects.toMatchObject({ code: 'RECOVERY_CANCELLED' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({
      phase: 'SOURCE_HELD', pendingPhase: null, lastFailureCode: null,
    });
  });

  it('cancels before dispatch without creating a journal or broker request', async () => {
    const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
    const controller = new AbortController(); controller.abort(new RecoveryError('RECOVERY_CANCELLED', 'cancelled'));
    await expect(created.workflow.hold({ ...input(value), signal: controller.signal })).rejects.toMatchObject({ code: 'RECOVERY_CANCELLED' });
    expect(broker.requests).toEqual([]);
    await expect(created.journal.read(value.plan.operationId)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_MISSING' });
  });

  it('preserves durable hold intent as ambiguous when cancellation follows broker dispatch', async () => {
    const value = await fixture(); const controller = new AbortController(); const broker = new Broker();
    broker.request = async (request, signal) => {
      broker.requests.push(request); controller.abort(new RecoveryError('RECOVERY_CANCELLED', 'cancelled'));
      signal?.throwIfAborted();
      throw new Error('unreachable');
    };
    const created = workflow(value, broker);
    // Model the transport's dispatched cancellation classification.
    broker.acquireFailure = undefined;
    broker.request = async (request, signal) => {
      broker.requests.push(request); controller.abort();
      if (signal?.aborted) throw new BackupBrokerClientError('BROKER_ABORTED', 'cancelled', true, true);
      throw new Error('unreachable');
    };
    await expect(created.workflow.hold({ ...input(value), signal: controller.signal })).rejects.toMatchObject({
      code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS',
    });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({
      pendingPhase: 'SOURCE_HELD', failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT',
    });
  });

  it('treats a parsed authoritative broker ERROR as definite even when its code resembles a transport timeout', async () => {
    const value = await fixture(); const broker = new Broker();
    broker.acquireFailure = () => new BackupBrokerClientError('BROKER_TIMEOUT', 'authoritative rejection', true, true, true);
    const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_REQUEST_FAILED' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: null,
      failureDisposition: 'DEFINITE_PRE_EFFECT' });
  });

  it.each(['BROKER_RESPONSE_TOO_LARGE', 'BROKER_RESPONSE_INVALID', 'BROKER_RESPONSE_IDENTITY_MISMATCH', 'BROKER_ABORTED'])(
    'preserves dispatched untrusted %s outcome as ambiguous', async (code) => {
      const value = await fixture(); const broker = new Broker();
      broker.acquireFailure = () => new BackupBrokerClientError(code, 'untrusted response', false, true);
      const created = workflow(value, broker);
      await expect(created.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
      await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: 'SOURCE_HELD',
        failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT' });
    });

  it('preserves a valid but wrong acquire response as ambiguous', async () => {
    const value = await fixture(); const broker = new Broker();
    broker.request = async (request) => {
      broker.requests.push(request);
      return { protocol_version: 2, request_id: request.request_id, helper_version: 'test', policy_sha256: 'd'.repeat(64),
        operation: 'INSPECT_RESTORE_HOLD', operation_id: request.operation_id, manifest_sha256: request.manifest_sha256,
        status: 'ABSENT' };
    };
    const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT' });
  });

  it('preserves an ambiguous pending hold after a lost reply and resumes by exact evidence without acquiring twice', async () => {
    const value = await fixture(); const broker = new Broker(); let first = true;
    broker.acquireFailure = () => { broker.status = 'ACTIVE'; first = false;
      return new BackupBrokerClientError('BROKER_CONNECTION_CLOSED', 'lost response', true, true); };
    const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
    expect(first).toBe(false);
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT' });
    broker.acquireFailure = undefined;
    await expect(created.workflow.resume(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED', brokerTruth: 'ACTIVE' });
    expect(broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
    expect((await created.journal.read(value.plan.operationId)).lastReconciliationEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves pending hold ambiguity across failed read-only resume inspection and resolves after restart', async () => {
    const value = await fixture(); const broker = new Broker();
    broker.acquireFailure = () => { broker.status = 'ACTIVE';
      return new BackupBrokerClientError('BROKER_CONNECTION_CLOSED', 'lost acquire response', true, true); };
    const first = workflow(value, broker);
    await expect(first.workflow.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
    broker.acquireFailure = undefined;
    broker.inspectFailure = new BackupBrokerClientError('BROKER_TIMEOUT', 'read-only inspection timed out', true, true);
    await expect(first.workflow.resume(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_REQUEST_FAILED' });
    await expect(first.journal.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT', lastFailureCode: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });

    broker.inspectFailure = undefined;
    const restarted = workflow(value, broker, first.verify);
    await expect(restarted.workflow.resume(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED' });
    expect(broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
    expect((await restarted.journal.read(value.plan.operationId)).lastReconciliationEvidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reconciles an ACTIVE reply received before local completion without acquiring twice', async () => {
    const value = await fixture(); const broker = new Broker();
    const failing = new OneShotCompletionFailureJournal({ root: value.root }); const verify = vi.fn().mockResolvedValue(undefined);
    const first = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => value.plan,
      sourceVerifier: { verify }, journal: () => failing, broker: () => broker });
    await expect(first.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
    await expect(failing.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT' });
    const resumed = workflow(value, broker, verify);
    await expect(resumed.workflow.resume(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED' });
    expect(broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
  });

  it('preserves safe ambiguous state when real journal queue propagation masks the ACTIVE completion wrapper', async () => {
    const value = await fixture(); const broker = new Broker(); let writes = 0;
    const faulting = new RecoveryJournal({ root: value.root, fault: async (stage) => {
      if (stage === 'after-temp-fsync-before-rename' && ++writes === 3) {
        throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'injected real completion write failure');
      }
    } });
    const verify = vi.fn().mockResolvedValue(undefined);
    const first = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => value.plan,
      sourceVerifier: { verify }, journal: () => faulting, broker: () => broker });
    // RecoveryJournal.withOperation deliberately propagates the first accepted
    // task failure after draining, so the lower-level journal error masks the
    // workflow wrapper code. The durable state remains fail-safe and resumable.
    await expect(first.hold(input(value))).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_UNSAFE' });
    await expect(faulting.read(value.plan.operationId)).resolves.toMatchObject({ pendingPhase: 'SOURCE_HELD',
      failureDisposition: 'AMBIGUOUS_EXTERNAL_EFFECT', lastFailureCode: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });

    const restarted = workflow(value, broker, verify);
    await expect(restarted.workflow.resume(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED' });
    expect(broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
  });

  it('retries an inspected ABSENT pending hold with immutable lifecycle identity and a fresh request id', async () => {
    const value = await fixture(); const broker = new Broker();
    broker.acquireFailure = () => new BackupBrokerClientError('BROKER_CONNECTION_CLOSED', 'lost before broker persistence', true, true);
    const created = workflow(value, broker);
    await expect(created.workflow.hold(input(value))).rejects.toBeDefined();
    const first = broker.requests.find((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')!;
    broker.acquireFailure = undefined; broker.status = 'ABSENT';
    await expect(created.workflow.resume(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED' });
    const acquires = broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD');
    expect(acquires).toHaveLength(2); expect(acquires[1].request_id).not.toBe(first.request_id);
    expect({ ...acquires[1], request_id: first.request_id, deadline: first.deadline }).toEqual(first);
  });

  it('never reacquires a released or uncertain exact operation', async () => {
    for (const status of ['RELEASED', 'UNCERTAIN'] as const) {
      const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
      broker.acquireFailure = () => new BackupBrokerClientError('BROKER_CONNECTION_FAILED', 'before connect', true, false);
      await expect(created.workflow.hold(input(value))).rejects.toBeDefined();
      broker.acquireFailure = undefined; broker.status = status;
      await expect(created.workflow.resume(input(value))).rejects.toMatchObject({
        code: status === 'RELEASED' ? 'RECOVERY_HOLD_RELEASED' : 'RECOVERY_HOLD_UNCERTAIN',
      });
      broker.status = 'ABSENT';
      await expect(created.workflow.resume(input(value))).rejects.toMatchObject({
        code: status === 'RELEASED' ? 'RECOVERY_HOLD_RELEASED' : 'RECOVERY_HOLD_UNCERTAIN',
      });
      await expect(created.workflow.status({ ...input(value), offline: true })).resolves.toMatchObject({
        brokerTruth: 'UNKNOWN', nextAction: 'OPERATOR_REVIEW',
      });
      await expect(created.workflow.status(input(value))).resolves.toMatchObject({
        brokerTruth: 'ABSENT', nextAction: 'OPERATOR_REVIEW',
      });
      expect(broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
    }
  });

  it('keeps status offline broker-free and redacts lifecycle owner/fence from results', async () => {
    const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
    await created.workflow.hold(input(value)); const count = broker.requests.length;
    const status = await created.workflow.status({ ...input(value), offline: true });
    expect(broker.requests).toHaveLength(count); expect(status).toMatchObject({ phase: 'SOURCE_HELD', brokerTruth: 'UNKNOWN' });
    expect(JSON.stringify(status)).not.toContain((await created.journal.read(value.plan.operationId)).ownerId);
    await expect(created.workflow.status(input(value))).resolves.toMatchObject({ brokerTruth: 'ACTIVE' });
    broker.status = 'ABSENT';
    await expect(created.workflow.status(input(value))).resolves.toMatchObject({ brokerTruth: 'ABSENT', nextAction: 'OPERATOR_REVIEW' });
  });

  it('completes a purely local pending SOURCE_VERIFIED retry without manufacturing external ambiguity', async () => {
    const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
    await created.workflow.hold(input(value)); const held = await created.journal.read(value.plan.operationId);
    await created.journal.withOperation(held.operationId, { expectedSequence: held.sequence, expectedOwnerId: held.ownerId,
      expectedFenceToken: held.fenceToken, expectedSiteId: held.siteId, expectedPlanId: held.planId,
      expectedPlanSha256: held.planSha256 }, (operation) => operation.recordPhaseIntent('SOURCE_VERIFIED'));
    await expect(created.workflow.resume(input(value))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({
      failureDisposition: null, lastFailureCode: null, lastReconciliationEvidenceSha256: null,
    });
  });

  it('records changed-source verification failure while leaving the exact hold active', async () => {
    const value = await fixture(); const broker = new Broker(); const created = workflow(value, broker);
    await created.workflow.hold(input(value));
    created.verify.mockRejectedValueOnce(new RecoveryError('RECOVERY_SOURCE_CHANGED', 'changed'));
    await expect(created.workflow.verifySource(input(value))).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_CHANGED' });
    expect(broker.status).toBe('ACTIVE');
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({ phase: 'SOURCE_HELD', pendingPhase: null,
      failureDisposition: 'DEFINITE_PRE_EFFECT' });
  });

  it('fails safely when exact ACTIVE truth is lost at either verification inspection boundary', async () => {
    const beforeValue = await fixture(); const beforeBroker = new Broker(); const before = workflow(beforeValue, beforeBroker);
    await before.workflow.hold(input(beforeValue)); beforeBroker.status = 'ABSENT';
    await expect(before.workflow.verifySource(input(beforeValue))).rejects.toMatchObject({ code: 'RECOVERY_HOLD_NOT_ACTIVE' });
    expect(before.verify).toHaveBeenCalledTimes(1);

    const afterValue = await fixture(); const afterBroker = new Broker(); let verifications = 0;
    const verify = vi.fn(async () => { verifications += 1; if (verifications === 2) afterBroker.status = 'RELEASED'; });
    const after = workflow(afterValue, afterBroker, verify); await after.workflow.hold(input(afterValue));
    await expect(after.workflow.verifySource(input(afterValue))).rejects.toMatchObject({ code: 'RECOVERY_HOLD_RELEASED' });
    expect(afterBroker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
  });

  it('bounds INSPECT deadlines to 59 seconds while retaining the configured ACQUIRE mutation deadline', async () => {
    const value = await fixture(); value.config.broker.control_timeout_ms = 240_000;
    const broker = new Broker(); const created = workflow(value, broker); const started = Date.now();
    await created.workflow.hold(input(value));
    await created.workflow.verifySource(input(value));
    await created.workflow.status(input(value));
    const acquireDeadline = Date.parse(broker.requests.find((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')!.deadline);
    expect(acquireDeadline - started).toBeGreaterThan(230_000);
    const inspectDeadlines = broker.requests.filter((request) => request.operation === 'INSPECT_RESTORE_HOLD')
      .map((request) => Date.parse(request.deadline) - started);
    expect(inspectDeadlines).toHaveLength(3);
    expect(inspectDeadlines.every((deadline) => deadline > 0 && deadline <= 59_500)).toBe(true);

    const resumedValue = await fixture(); resumedValue.config.broker.control_timeout_ms = 240_000;
    const resumedBroker = new Broker(); resumedBroker.acquireFailure = () => { resumedBroker.status = 'ACTIVE';
      return new BackupBrokerClientError('BROKER_CONNECTION_CLOSED', 'lost reply', true, true); };
    const resumed = workflow(resumedValue, resumedBroker);
    await expect(resumed.workflow.hold(input(resumedValue))).rejects.toBeDefined();
    resumedBroker.acquireFailure = undefined;
    await expect(resumed.workflow.resume(input(resumedValue))).resolves.toMatchObject({ phase: 'SOURCE_VERIFIED' });
    const resumeInspect = resumedBroker.requests.find((request) => request.operation === 'INSPECT_RESTORE_HOLD')!;
    expect(Date.parse(resumeInspect.deadline) - Date.now()).toBeLessThanOrEqual(59_000);
  });

  it.each([
    ['RELEASE', 'release', 'RELEASED', 'ABORTED_PRE_IMPORT'],
    ['MARK_UNCERTAIN', 'abandon', 'UNCERTAIN', 'ABANDONED'],
  ] as const)('durably closes before %s and confirms only exact terminal truth', async (action, command, terminal, closedAs) => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value));
    const review = dispositionReview(value, { action, sequence: (await held.journal.read(value.plan.operationId)).sequence });
    let sawPending = false;
    const original = broker.request.bind(broker);
    broker.request = async (request) => {
      if (request.operation === (action === 'RELEASE' ? 'RELEASE_RESTORE_HOLD' : 'MARK_RESTORE_HOLD_UNCERTAIN')) {
        sawPending = (await held.journal.read(value.plan.operationId)).holdDisposition?.status === 'PENDING';
      }
      return original(request);
    };
    const created = dispositionWorkflow(value, broker, review);
    const dispositionInput = { ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId };
    const result = command === 'release' ? await created.workflow.release(dispositionInput)
      : await created.workflow.abandon(dispositionInput);
    expect(sawPending).toBe(true);
    expect(result).toMatchObject({ brokerTruth: terminal, nextAction: 'NONE',
      closure: { action, closedAs, status: 'CONFIRMED' } });
    await expect(created.workflow.status(input(value))).resolves.toMatchObject({ brokerTruth: terminal, nextAction: 'NONE' });
    broker.status = 'ACTIVE';
    await expect(created.workflow.status(input(value))).rejects.toMatchObject({ code: 'RECOVERY_DISPOSITION_TRUTH_CONFLICT' });
    broker.status = terminal;
    await expect(created.workflow.resume(input(value))).rejects.toMatchObject({ code: 'RECOVERY_OPERATION_CLOSED' });
    expect(broker.requests.filter((request) => request.operation === 'ACQUIRE_RESTORE_HOLD')).toHaveLength(1);
  });

  it('reconciles a lost release acknowledgement without issuing a second mutation', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value));
    const review = dispositionReview(value, { action: 'RELEASE', sequence: (await held.journal.read(value.plan.operationId)).sequence });
    const created = dispositionWorkflow(value, broker, review); const original = broker.request.bind(broker); let lost = true; let releaseAttempts = 0;
    broker.request = async (request) => {
      if (request.operation === 'RELEASE_RESTORE_HOLD' && lost) {
        releaseAttempts += 1;
        lost = false; broker.status = 'RELEASED';
        throw new BackupBrokerClientError('BROKER_CONNECTION_CLOSED', 'lost acknowledgement', true, true);
      }
      return original(request);
    };
    const dispositionInput = { ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId };
    await expect(created.workflow.release(dispositionInput)).resolves.toMatchObject({ closure: { status: 'CONFIRMED' } });
    await expect(created.workflow.release(dispositionInput)).resolves.toMatchObject({ closure: { status: 'CONFIRMED' } });
    expect(releaseAttempts).toBe(1);
  });

  it('reconciles exact terminal truth after broker success and a local confirmation fault', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value));
    const review = dispositionReview(value, { action: 'RELEASE', sequence: (await held.journal.read(value.plan.operationId)).sequence });
    const faulting = new OneShotDispositionConfirmationFailureJournal({ root: value.root });
    const first = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => value.plan,
      readReview: async () => ({ review, reviewSha256: 'e'.repeat(64) }), sourceVerifier: { verify: async () => undefined },
      journal: () => faulting, broker: () => broker });
    const dispositionInput = { ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId };
    await expect(first.release(dispositionInput)).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_UNSAFE' });
    await expect(faulting.read(value.plan.operationId)).resolves.toMatchObject({
      holdDisposition: { status: 'PENDING', action: 'RELEASE' } });
    const restarted = dispositionWorkflow(value, broker, review);
    await expect(restarted.workflow.release(dispositionInput)).resolves.toMatchObject({
      brokerTruth: 'RELEASED', closure: { status: 'CONFIRMED' } });
    expect(broker.requests.filter((request) => request.operation === 'RELEASE_RESTORE_HOLD')).toHaveLength(1);
  });

  it('never treats ABSENT after a disposition acknowledgement as terminal proof', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value));
    const review = dispositionReview(value, { action: 'RELEASE', sequence: (await held.journal.read(value.plan.operationId)).sequence });
    const created = dispositionWorkflow(value, broker, review); const original = broker.request.bind(broker);
    broker.request = async (request) => {
      if (request.operation === 'RELEASE_RESTORE_HOLD') {
        broker.requests.push(request); broker.status = 'ABSENT';
        return { protocol_version: 2, request_id: request.request_id, helper_version: 'test', policy_sha256: 'd'.repeat(64),
          operation: request.operation, operation_id: request.operation_id, status: 'RELEASED' };
      }
      return original(request);
    };
    await expect(created.workflow.release({ ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId })).rejects.toMatchObject({ code: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' });
    await expect(created.journal.read(value.plan.operationId)).resolves.toMatchObject({
      holdDisposition: { status: 'PENDING', observedStatus: 'ABSENT', failureCode: 'RECOVERY_BROKER_EFFECT_AMBIGUOUS' } });
  });

  it('reconciles an authoritative broker error because disposition persistence may precede ERROR', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value));
    const review = dispositionReview(value, { action: 'MARK_UNCERTAIN', sequence: (await held.journal.read(value.plan.operationId)).sequence });
    const created = dispositionWorkflow(value, broker, review); const original = broker.request.bind(broker);
    broker.request = async (request) => {
      if (request.operation === 'MARK_RESTORE_HOLD_UNCERTAIN') {
        broker.status = 'UNCERTAIN';
        throw new BackupBrokerClientError('BROKER_TIMEOUT', 'authoritative error after persistence', true, true, true);
      }
      return original(request);
    };
    await expect(created.workflow.abandon({ ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId })).resolves.toMatchObject({ brokerTruth: 'UNCERTAIN',
        closure: { status: 'CONFIRMED', action: 'MARK_UNCERTAIN' } });
  });

  it('rejects plain planned closure and explicit confirmation mismatch', async () => {
    const value = await fixture(); const broker = new Broker(); const journal = new RecoveryJournal({ root: value.root });
    await journal.create({ operationId: value.plan.operationId, siteId: value.config.site_id, planId: value.plan.planId,
      planSha256: value.planSha256, sourceDescriptorSha256: value.plan.source.descriptorSha256,
      ownerId: randomUUID(), fenceToken: randomUUID() });
    const review = dispositionReview(value, { action: 'RELEASE', sequence: 0 });
    const created = dispositionWorkflow(value, broker, review);
    await expect(created.workflow.release({ ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: randomUUID() })).rejects.toMatchObject({ code: 'RECOVERY_REVIEW_CONFLICT' });
    await expect(created.workflow.release({ ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId })).rejects.toMatchObject({ code: 'RECOVERY_STATE_INVALID' });
    expect(broker.requests).toHaveLength(0);
  });

  it('allows a separately reviewed release to supersede confirmed abandonment without reopening', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value));
    const abandonReview = dispositionReview(value, { action: 'MARK_UNCERTAIN',
      sequence: (await held.journal.read(value.plan.operationId)).sequence });
    const abandoned = dispositionWorkflow(value, broker, abandonReview);
    await abandoned.workflow.abandon({ ...input(value), reviewFile: '/review-a', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId });
    const abandonedState = await abandoned.journal.read(value.plan.operationId);
    const releaseReview = dispositionReview(value, { action: 'RELEASE', sequence: abandonedState.sequence,
      expectedHoldStatus: 'UNCERTAIN' });
    const released = dispositionWorkflow(value, broker, releaseReview, '9'.repeat(64));
    await expect(released.workflow.release({ ...input(value), reviewFile: '/review-b', reviewSha256: '9'.repeat(64),
      confirmOperationId: value.plan.operationId })).resolves.toMatchObject({ brokerTruth: 'RELEASED', nextAction: 'NONE',
        closure: { action: 'RELEASE', status: 'CONFIRMED' } });
    const final = await released.journal.read(value.plan.operationId);
    expect(final.holdDisposition?.priorDecisionSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(released.workflow.resume(input(value))).rejects.toMatchObject({ code: 'RECOVERY_OPERATION_CLOSED' });
  });

  it('serializes concurrent conflicting disposition commands and permits only one durable decision', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value)); const sequence = (await held.journal.read(value.plan.operationId)).sequence;
    const releaseReview = dispositionReview(value, { action: 'RELEASE', sequence });
    const abandonReview = dispositionReview(value, { action: 'MARK_UNCERTAIN', sequence });
    const journal = new RecoveryJournal({ root: value.root });
    const concurrent = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => value.plan,
      readReview: async ({ path }) => path === '/release'
        ? { review: releaseReview, reviewSha256: 'e'.repeat(64) }
        : { review: abandonReview, reviewSha256: 'f'.repeat(64) },
      sourceVerifier: { verify: async () => undefined }, journal: () => journal, broker: () => broker });
    let entered!: () => void; let proceed!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { proceed = resolve; }); const original = broker.request.bind(broker); let block = true;
    broker.request = async (request) => {
      if (block && request.operation === 'INSPECT_RESTORE_HOLD') { block = false; entered(); await gate; }
      return original(request);
    };
    const releasing = concurrent.release({ ...input(value), reviewFile: '/release', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId });
    await started;
    await expect(concurrent.abandon({ ...input(value), reviewFile: '/abandon', reviewSha256: 'f'.repeat(64),
      confirmOperationId: value.plan.operationId })).rejects.toMatchObject({ code: 'RECOVERY_LOCK_HELD' });
    proceed(); await expect(releasing).resolves.toMatchObject({ closure: { action: 'RELEASE', status: 'CONFIRMED' } });
    expect((await journal.read(value.plan.operationId)).holdDisposition).toMatchObject({ decisionId: releaseReview.decisionId });
    expect(broker.requests.filter((request) => request.operation === 'MARK_RESTORE_HOLD_UNCERTAIN')).toHaveLength(0);
  });

  it('converges concurrent identical reviewed release after a stale scoped guard with one mutation', async () => {
    const value = await fixture(); const broker = new Broker(); const held = workflow(value, broker);
    await held.workflow.hold(input(value)); const sequence = (await held.journal.read(value.plan.operationId)).sequence;
    const review = dispositionReview(value, { action: 'RELEASE', sequence });
    const journal = new DeterministicStaleGuardJournal({ root: value.root }); const original = broker.request.bind(broker);
    let waitForSecond = true;
    broker.request = async (request) => {
      if (waitForSecond && request.operation === 'INSPECT_RESTORE_HOLD') {
        waitForSecond = false; await journal.secondArrived;
      }
      return original(request);
    };
    const concurrent = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => value.plan,
      readReview: async () => ({ review, reviewSha256: 'e'.repeat(64) }), sourceVerifier: { verify: async () => undefined },
      journal: () => journal, broker: () => broker });
    const dispositionInput = { ...input(value), reviewFile: '/release', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId };
    const [first, second] = await Promise.all([concurrent.release(dispositionInput), concurrent.release(dispositionInput)]);
    expect(first).toMatchObject({ brokerTruth: 'RELEASED', nextAction: 'NONE', closure: { status: 'CONFIRMED' } });
    expect(second).toMatchObject({ brokerTruth: 'RELEASED', nextAction: 'NONE', closure: { status: 'CONFIRMED' } });
    expect(broker.requests.filter((request) => request.operation === 'RELEASE_RESTORE_HOLD')).toHaveLength(1);
  });

  it('ignores a foreign controller return and builds successful resume only from exact durable journal truth', async () => {
    const value = await fixture(); const plan = planV3(value); const broker = new Broker(); const journal = new RecoveryJournal({ root: value.root });
    const targetController = {
      prepare: async () => {
        const current = await journal.read(plan.operationId); const requestId = randomUUID(); const requestSha256 = '8'.repeat(64);
        await journal.withOperation(current.operationId, { expectedSequence: current.sequence, expectedOwnerId: current.ownerId,
          expectedFenceToken: current.fenceToken, expectedSiteId: current.siteId, expectedPlanId: current.planId,
          expectedPlanSha256: current.planSha256 }, async (operation) => {
          await operation.recordTargetPreparationIntent({ requestId, requestSha256, admissionId: randomUUID(),
            admissionSha256: '9'.repeat(64), authorizationSha256: '9'.repeat(64), expectedHelperSequence: null,
            status: 'INTENT_RECORDED', rejectionReceiptSha256: null, rejectionHelperSequence: null,
            rejectionState: null, rejectionCode: null });
          await operation.markTargetPreparationDispatched(requestId, requestSha256);
          return operation.completeTargetsPrepared({ receiptSha256: 'a'.repeat(64), helperSequence: 2,
            reconciliationEvidenceSha256: 'b'.repeat(64) });
        });
        return { operationId: randomUUID(), planSha256: 'f'.repeat(64), targetSetId: 'e'.repeat(64), phase: 'BOGUS' } as never;
      },
      inspect: async () => 'READY' as const,
    };
    const created = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => plan,
      sourceVerifier: { verify: async () => undefined }, journal: () => journal, broker: () => broker, targetController });
    await created.hold(input(value)); await created.verifySource(input(value));
    await expect(created.resume(input(value))).resolves.toMatchObject({ phase: 'TARGETS_PREPARED',
      targetLifecycle: 'READY', targetHelperSequence: 2, brokerTruth: 'ACTIVE' });
  });

  it.each(['foreign-operation', 'foreign-plan', 'foreign-target', 'malformed'])(
    'rejects %s controller output when the authoritative journal is unchanged', async (variant) => {
      const value = await fixture(); const plan = planV3(value); const broker = new Broker(); const journal = new RecoveryJournal({ root: value.root });
      const controllerOutput = variant === 'foreign-operation' ? { operationId: randomUUID(), planSha256: value.planSha256,
        targetSetId: plan.targetPreparation.targetSetId }
        : variant === 'foreign-plan' ? { operationId: plan.operationId, planSha256: 'f'.repeat(64),
          targetSetId: plan.targetPreparation.targetSetId }
          : variant === 'foreign-target' ? { operationId: plan.operationId, planSha256: value.planSha256,
            targetSetId: 'e'.repeat(64) } : { malformed: true };
      const targetController = { prepare: (async () => controllerOutput) as never, inspect: async () => 'READY' as const };
      const created = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => plan,
        sourceVerifier: { verify: async () => undefined }, journal: () => journal, broker: () => broker, targetController });
      await created.hold(input(value)); await created.verifySource(input(value));
      await expect(created.resume(input(value))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_RECEIPT_MISMATCH' });
    },
  );

  it('rejects controller completion that leaves only dispatch intent without a durable receipt', async () => {
    const value = await fixture(); const plan = planV3(value); const broker = new Broker(); const journal = new RecoveryJournal({ root: value.root });
    const targetController = { prepare: async () => {
      const current = await journal.read(plan.operationId); const requestId = randomUUID();
      await journal.withOperation(current.operationId, { expectedSequence: current.sequence, expectedOwnerId: current.ownerId,
        expectedFenceToken: current.fenceToken, expectedSiteId: current.siteId, expectedPlanId: current.planId,
        expectedPlanSha256: current.planSha256 }, async (operation) => {
        await operation.recordTargetPreparationIntent({ requestId, requestSha256: '8'.repeat(64), admissionId: randomUUID(),
          admissionSha256: '9'.repeat(64), authorizationSha256: '9'.repeat(64), expectedHelperSequence: null,
          status: 'INTENT_RECORDED', rejectionReceiptSha256: null, rejectionHelperSequence: null,
          rejectionState: null, rejectionCode: null });
        await operation.markTargetPreparationDispatched(requestId, '8'.repeat(64));
      });
    }, inspect: async () => 'READY' as const };
    const created = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => plan,
      sourceVerifier: { verify: async () => undefined }, journal: () => journal, broker: () => broker, targetController });
    await created.hold(input(value)); await created.verifySource(input(value));
    await expect(created.resume(input(value))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_RECEIPT_MISMATCH' });
  });

  it('propagates controller failure without manufacturing target success', async () => {
    const value = await fixture(); const plan = planV3(value); const broker = new Broker(); const journal = new RecoveryJournal({ root: value.root });
    const targetController = { prepare: async () => { throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'injected'); },
      inspect: async () => 'UNKNOWN' as const };
    const created = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => plan,
      sourceVerifier: { verify: async () => undefined }, journal: () => journal, broker: () => broker, targetController });
    await created.hold(input(value)); await created.verifySource(input(value));
    await expect(created.resume(input(value))).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect(await journal.read(plan.operationId)).toMatchObject({ phase: 'SOURCE_VERIFIED', targetReceiptSha256: null });
  });

  it('requires exact target inspection before v3 source release even when local state claims no effect', async () => {
    const value = await fixture(); const broker = new Broker(); broker.status = 'ACTIVE';
    const identity = { generation: 1, hostInstallationId: randomUUID(), topologyMode: 'SINGLE_HOST' as const,
      hostPolicySha256: '1'.repeat(64), helperRoleSha256: '2'.repeat(64), engineProfileSha256: '3'.repeat(64),
      protectionInventorySha256: '4'.repeat(64), capacityEvidenceSha256: '5'.repeat(64),
      storageInventorySha256: '6'.repeat(64), targetSpecificationSha256: '7'.repeat(64) };
    const plan: RecoveryPlanV3 = { ...value.plan, format: 'darshan-recovery-plan-v3',
      targetPreparation: { ...identity, targetSetId: recoveryTargetSetId(identity) } };
    const journal = new RecoveryJournal({ root: value.root });
    let state = await journal.create({ operationId: plan.operationId, siteId: 'site-a', planId: plan.planId,
      planSha256: value.planSha256, sourceDescriptorSha256: plan.source.descriptorSha256,
      ownerId: randomUUID(), fenceToken: randomUUID(), targetBinding: { targetSetId: plan.targetPreparation.targetSetId,
        generation: 1, hostInstallationId: identity.hostInstallationId, topologyMode: 'SINGLE_HOST',
        targetSpecificationSha256: identity.targetSpecificationSha256 } });
    state = await journal.withOperation(state.operationId, { expectedSequence: state.sequence, expectedOwnerId: state.ownerId,
      expectedFenceToken: state.fenceToken, expectedSiteId: state.siteId, expectedPlanId: state.planId,
      expectedPlanSha256: state.planSha256 }, async (operation) => {
      await operation.recordPhaseIntent('SOURCE_HELD'); return operation.completePhase('SOURCE_HELD');
    });
    const review = dispositionReview(value, { action: 'RELEASE', sequence: state.sequence });
    let targetTruth: 'READY' | 'ABSENT' = 'READY'; let inspectionSequence: Array<'READY' | 'ABSENT'> = [];
    const workflowV3 = new RecoveryOperatorWorkflow({ loadConfig: async () => value.config, readPlan: async () => plan,
      readReview: async () => ({ review, reviewSha256: 'e'.repeat(64) }), sourceVerifier: { verify: async () => undefined },
      journal: () => journal, broker: () => broker, targetController: {
        prepare: async () => { throw new Error('not used'); }, inspect: async () => inspectionSequence.shift() ?? targetTruth,
      } });
    const dispositionInput = { ...input(value), reviewFile: '/review', reviewSha256: 'e'.repeat(64),
      confirmOperationId: value.plan.operationId };
    await expect(workflowV3.release(dispositionInput)).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect(broker.requests.filter((request) => request.operation === 'RELEASE_RESTORE_HOLD')).toHaveLength(0);
    inspectionSequence = ['ABSENT', 'READY'];
    await expect(workflowV3.release(dispositionInput)).rejects.toMatchObject({ code: 'RECOVERY_TARGET_EFFECT_AMBIGUOUS' });
    expect(broker.requests.filter((request) => request.operation === 'RELEASE_RESTORE_HOLD')).toHaveLength(0);
    targetTruth = 'ABSENT';
    await expect(workflowV3.release(dispositionInput)).resolves.toMatchObject({ brokerTruth: 'RELEASED' });
  });
});
