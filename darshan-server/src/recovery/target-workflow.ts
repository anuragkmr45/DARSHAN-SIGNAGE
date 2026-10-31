import { canonicalJson } from '../backups/backup-broker-protocol';
import { RECOVERY_PLAN_FORMAT_V4, sha256RecoveryBytes,
  type RecoveryPlanV3, type RecoveryPlanV4 } from './contracts';
import { RecoveryError } from './errors';
import { type RecoveryJournal, type RecoveryJournalGuard, type RecoveryJournalState,
  type ScopedRecoveryOperation } from './journal';
import { RecoveryTargetClient, RecoveryTargetRejectedError } from './target-client';
import { verifyTargetAdmissionV2, verifyTargetDispositionV2,
  type TargetContractVerificationContextV2 } from './target-contracts-v2';
import { verifyTargetAdmission, verifyTargetDisposition } from './target-contracts';

type RecoveryTargetPlan = RecoveryPlanV3 | RecoveryPlanV4;

export interface RecoveryTargetWorkflowResult {
  operationId: string;
  lifecycle: 'NOT_PREPARED' | 'READY' | 'STOPPED_RETAINED' | 'RETIRED' | 'UNKNOWN';
  helperSequence: number | null;
  receiptSha256: string | null;
  nextAction: 'PREPARE_TARGETS' | 'RESUME' | 'STOP_RETAIN_OR_RETIRE' | 'NONE' | 'OPERATOR_REVIEW';
}

function guard(state: RecoveryJournalState): RecoveryJournalGuard {
  return { expectedSequence: state.sequence, expectedOwnerId: state.ownerId, expectedFenceToken: state.fenceToken,
    expectedSiteId: state.siteId, expectedPlanId: state.planId, expectedPlanSha256: state.planSha256 };
}

function expectedContextV2(plan: RecoveryPlanV4, planSha256: string,
  keys: ReadonlyMap<string, string>, revokedKeyIds?: ReadonlySet<string>, now?: Date): TargetContractVerificationContextV2 {
  return { keys, revokedKeyIds, now, expected: { operationId: plan.operationId, siteId: plan.source.siteId,
    hostInstallationId: plan.targetPreparation.hostInstallationId, planSha256,
    targetSetId: plan.targetPreparation.targetSetId, generation: plan.targetPreparation.generation,
    targetSpecificationSha256: plan.targetPreparation.targetSpecificationSha256,
    operationAttestationSha256: plan.targetPreparation.operationAttestationSha256 } };
}

function verifyAdmissionForPlan(plan: RecoveryTargetPlan, planSha256: string, bytes: Uint8Array,
  keys: ReadonlyMap<string, string>, revokedKeyIds: ReadonlySet<string> | undefined, now: Date,
  action: 'PREPARE' | 'INSPECT') {
  return plan.format === RECOVERY_PLAN_FORMAT_V4
    ? verifyTargetAdmissionV2(bytes, expectedContextV2(plan, planSha256, keys, revokedKeyIds, now), action)
    : verifyTargetAdmission(bytes, { keys, revokedKeyIds, now, expected: { operationId: plan.operationId,
      siteId: plan.source.siteId, hostInstallationId: plan.targetPreparation.hostInstallationId, planSha256,
      targetSetId: plan.targetPreparation.targetSetId, generation: plan.targetPreparation.generation,
      targetSpecificationSha256: plan.targetPreparation.targetSpecificationSha256 } }, action);
}

function authorizationBodySha256(value: ReturnType<typeof verifyAdmissionForPlan> |
  ReturnType<typeof verifyTargetDisposition> | ReturnType<typeof verifyTargetDispositionV2>): string {
  return sha256RecoveryBytes(canonicalJson('admission' in value ? value.admission : value.decision));
}

function result(state: RecoveryJournalState, offline = false): RecoveryTargetWorkflowResult {
  const lifecycle = offline ? 'UNKNOWN' : state.targetDisposition?.finalState ??
    (state.phase === 'TARGETS_PREPARED' ? 'READY' : 'NOT_PREPARED');
  return { operationId: state.operationId, lifecycle, helperSequence: state.targetDisposition?.helperSequence ?? state.targetHelperSequence,
    receiptSha256: state.targetDisposition?.receiptSha256 ?? state.targetReceiptSha256,
    nextAction: state.lastFailureCode !== null || state.pendingPhase !== null ? 'RESUME'
      : state.phase === 'SOURCE_VERIFIED' ? 'PREPARE_TARGETS'
        : state.phase === 'TARGETS_PREPARED' && state.targetDisposition === null ? 'STOP_RETAIN_OR_RETIRE' : 'NONE' };
}

export class RecoveryTargetWorkflow {
  constructor(private readonly options: {
    journal: RecoveryJournal;
    client: RecoveryTargetClient;
    inspectSourceHoldActive(signal?: AbortSignal): Promise<boolean>;
    admissionKeys: ReadonlyMap<string, string>;
    revokedAdmissionKeyIds?: ReadonlySet<string>;
    now?: () => Date;
  }) {}

  async prepare(input: { plan: RecoveryTargetPlan; planSha256: string; admissionBytes: Uint8Array; signal?: AbortSignal }): Promise<RecoveryTargetWorkflowResult> {
    const admission = verifyAdmissionForPlan(input.plan, input.planSha256, input.admissionBytes, this.options.admissionKeys,
      this.options.revokedAdmissionKeyIds, (this.options.now ?? (() => new Date()))(), 'PREPARE');
    const admissionSha256 = sha256RecoveryBytes(input.admissionBytes);
    const authorizationSha256 = authorizationBodySha256(admission);
    const current = await this.options.journal.read(input.plan.operationId); this.assertBinding(current, input.plan, input.planSha256);
    if (current.phase === 'TARGETS_PREPARED' && current.pendingPhase === null) return result(current);
    if (current.phase !== 'SOURCE_VERIFIED' || (current.pendingPhase !== null && current.pendingPhase !== 'TARGETS_PREPARED') ||
        current.importStarted || current.holdDisposition !== null) {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation requires exact SOURCE_VERIFIED with an open pre-import operation.');
    }
    const state = await this.options.journal.withOperation(current.operationId, guard(current), async (operation) => {
      let state = await operation.read();
      if (!await this.options.inspectSourceHoldActive(input.signal)) throw new RecoveryError('RECOVERY_HOLD_NOT_ACTIVE', 'Source hold is not active before target preparation.');
      let request;
      if (state.targetPreparationRequest === null) {
        const latestRejectedPreparation = [...state.targetRejectedRequests].reverse()
          .find((rejected) => rejected.action === 'PREPARE');
        request = this.options.client.buildRequest({ operation: 'PREPARE', plan: input.plan, planSha256: input.planSha256,
          authorizationSha256, expectedHelperSequence: state.targetHelperSequence ?? latestRejectedPreparation?.rejectionHelperSequence ?? null });
        const requestSha256 = sha256RecoveryBytes(canonicalJson(request));
        state = await operation.recordTargetPreparationIntent({ requestId: request.requestId, requestSha256,
          admissionId: admission.admission.admissionId, admissionSha256, authorizationSha256,
          expectedHelperSequence: request.expectedHelperSequence, status: 'INTENT_RECORDED',
          rejectionReceiptSha256: null, rejectionHelperSequence: null, rejectionState: null, rejectionCode: null });
      } else {
        const retained = state.targetPreparationRequest;
        if (retained.admissionId !== admission.admission.admissionId || retained.admissionSha256 !== admissionSha256 ||
            retained.authorizationSha256 !== authorizationSha256) {
          throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Resume admission differs from the durable target request intent.');
        }
        request = this.options.client.buildRequest({ operation: 'PREPARE', plan: input.plan, planSha256: input.planSha256,
          authorizationSha256: retained.authorizationSha256, expectedHelperSequence: retained.expectedHelperSequence,
          requestId: retained.requestId });
        if (sha256RecoveryBytes(canonicalJson(request)) !== retained.requestSha256) {
          throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Reconstructed target request differs from durable intent.');
        }
        if (retained.status === 'REJECTED_DEFINITE') {
          await this.resolveRetainedPreparationRejection(operation, state, input, authorizationSha256);
          throw new RecoveryError('RECOVERY_TARGET_NOT_READY', 'Retained target preparation rejection was resolved without redispatch; retry with fresh authorization.');
        }
      }
      if (state.targetPreparationRequest?.status === 'INTENT_RECORDED') {
        state = await operation.markTargetPreparationDispatched(request.requestId, sha256RecoveryBytes(canonicalJson(request)));
      }
      let prepared;
      try { prepared = await this.options.client.send(request, input.signal); }
      catch (cause) {
        if (cause instanceof RecoveryTargetRejectedError && cause.definitePreEffect && !cause.result.response.ok) {
          const rejected = cause.result.response;
          state = await operation.recordTargetPreparationRejection({ requestId: request.requestId,
            requestSha256: sha256RecoveryBytes(canonicalJson(request)), receiptSha256: cause.result.receiptSha256,
            helperSequence: rejected.helperSequence, state: rejected.state, code: rejected.error.code });
          await this.resolveRetainedPreparationRejection(operation, state, input, authorizationSha256);
          throw cause;
        }
        await operation.recordPhaseFailure(cause instanceof RecoveryError ? cause.code : 'RECOVERY_TARGET_EFFECT_AMBIGUOUS',
          'AMBIGUOUS_EXTERNAL_EFFECT');
        throw cause;
      }
      if (!prepared.response.ok || prepared.response.state !== 'READY' || prepared.response.pendingAction !== null) {
        await operation.recordPhaseFailure('RECOVERY_TARGET_NOT_READY', 'AMBIGUOUS_EXTERNAL_EFFECT');
        throw new RecoveryError('RECOVERY_TARGET_NOT_READY', 'Target helper did not prove exact READY state.');
      }
      if (!await this.options.inspectSourceHoldActive(input.signal)) {
        await operation.recordPhaseFailure('RECOVERY_HOLD_NOT_ACTIVE', 'AMBIGUOUS_EXTERNAL_EFFECT');
        throw new RecoveryError('RECOVERY_HOLD_NOT_ACTIVE', 'Source hold changed before target readiness was committed.');
      }
      return operation.completeTargetsPrepared({ receiptSha256: prepared.receiptSha256,
        helperSequence: prepared.response.helperSequence,
        reconciliationEvidenceSha256: prepared.response.reconciliationEvidenceSha256! });
    });
    return result(state);
  }

  async status(input: { plan: RecoveryTargetPlan; planSha256: string; admissionBytes?: Uint8Array; offline?: boolean; signal?: AbortSignal }): Promise<RecoveryTargetWorkflowResult> {
    const state = await this.options.journal.read(input.plan.operationId); this.assertBinding(state, input.plan, input.planSha256);
    if (input.offline) return result(state, true);
    if (!input.admissionBytes) throw new RecoveryError('RECOVERY_TARGET_AUTH_INVALID', 'Online target status requires signed INSPECT admission.');
    const admission = verifyAdmissionForPlan(input.plan, input.planSha256, input.admissionBytes, this.options.admissionKeys,
      this.options.revokedAdmissionKeyIds, (this.options.now ?? (() => new Date()))(), 'INSPECT');
    const inspected = await this.options.client.request({ operation: 'INSPECT', plan: input.plan, planSha256: input.planSha256,
      authorizationSha256: authorizationBodySha256(admission), expectedHelperSequence: null, signal: input.signal });
    if (!inspected.response.ok) throw new RecoveryError('RECOVERY_TARGET_NOT_READY', 'Target inspection failed.');
    const lifecycle = inspected.response.state === 'READY' || inspected.response.state === 'STOPPED_RETAINED' || inspected.response.state === 'RETIRED'
      ? inspected.response.state : inspected.response.state === 'ABSENT' ? 'NOT_PREPARED' : 'UNKNOWN';
    return { operationId: state.operationId, lifecycle, helperSequence: inspected.response.helperSequence,
      receiptSha256: inspected.receiptSha256, nextAction: lifecycle === 'READY' ? 'STOP_RETAIN_OR_RETIRE'
        : lifecycle === 'UNKNOWN' ? 'OPERATOR_REVIEW' : 'NONE' };
  }

  async dispose(input: { plan: RecoveryTargetPlan; planSha256: string; decisionBytes: Uint8Array; signal?: AbortSignal }): Promise<RecoveryTargetWorkflowResult> {
    const now = (this.options.now ?? (() => new Date()))();
    const signed = input.plan.format === RECOVERY_PLAN_FORMAT_V4
      ? verifyTargetDispositionV2(input.decisionBytes, expectedContextV2(input.plan, input.planSha256,
        this.options.admissionKeys, this.options.revokedAdmissionKeyIds, now))
      : verifyTargetDisposition(input.decisionBytes, { keys: this.options.admissionKeys,
        revokedKeyIds: this.options.revokedAdmissionKeyIds, now, expected: { operationId: input.plan.operationId,
          siteId: input.plan.source.siteId, hostInstallationId: input.plan.targetPreparation.hostInstallationId,
          planSha256: input.planSha256, targetSetId: input.plan.targetPreparation.targetSetId,
          generation: input.plan.targetPreparation.generation,
          targetSpecificationSha256: input.plan.targetPreparation.targetSpecificationSha256 } });
    const current = await this.options.journal.read(input.plan.operationId); this.assertBinding(current, input.plan, input.planSha256);
    const decisionSha256 = sha256RecoveryBytes(canonicalJson(signed.decision));
    if (current.importStarted) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Import-started recovery rejects pre-import target disposition.');
    if (current.targetDisposition !== null) {
      if (current.targetDisposition.action === signed.decision.action && current.targetDisposition.decisionSha256 === decisionSha256) {
        return result(current);
      }
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'A different target disposition is already durable.');
    }
    if (current.phase !== 'TARGETS_PREPARED') {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target disposition requires one exact prepared target set.');
    }
    const state = await this.options.journal.withOperation(current.operationId, guard(current), async (operation) => {
      let state = await operation.read(); const authorizationSha256 = authorizationBodySha256(signed);
      let request;
      if (state.targetDispositionIntent === null) {
        if (signed.decision.expectedTargetState !== 'READY' || signed.decision.preparedReceiptSha256 !== state.targetReceiptSha256 ||
            signed.decision.expectedHelperSequence !== state.targetHelperSequence) {
          throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Disposition decision does not bind the exact prepared receipt and sequence.');
        }
        const inspectRequest = this.options.client.buildRequest({ operation: 'INSPECT', plan: input.plan,
          planSha256: input.planSha256, authorizationSha256, expectedHelperSequence: null });
        const inspected = await this.options.client.send(inspectRequest, input.signal);
        if (!inspected.response.ok || inspected.response.state !== signed.decision.expectedTargetState ||
            inspected.response.pendingAction !== null || inspected.response.helperSequence !== signed.decision.expectedHelperSequence ||
            inspected.response.reconciliationEvidenceSha256 === null) {
          throw new RecoveryError('RECOVERY_TARGET_RECEIPT_MISMATCH', 'Fresh disposition inspection does not match the signed prepared state and sequence.');
        }
        request = this.options.client.buildRequest({ operation: signed.decision.action, plan: input.plan,
          planSha256: input.planSha256, authorizationSha256,
          expectedHelperSequence: signed.decision.expectedHelperSequence });
        const requestSha256 = sha256RecoveryBytes(canonicalJson(request));
        state = await operation.recordTargetDispositionIntent({ decisionId: signed.decision.decisionId,
          decisionSha256, action: signed.decision.action,
          expectedFinalState: signed.decision.action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED',
          requestId: request.requestId, requestSha256,
          authorizationSha256, expectedHelperSequence: signed.decision.expectedHelperSequence,
          expectedTargetState: signed.decision.expectedTargetState,
          preparedReceiptSha256: signed.decision.preparedReceiptSha256,
          preDispositionInspectionReceiptSha256: inspected.receiptSha256,
          preDispositionEvidenceSha256: inspected.response.reconciliationEvidenceSha256,
          status: 'INTENT_RECORDED',
          rejectionReceiptSha256: null, rejectionHelperSequence: null, rejectionState: null, rejectionCode: null });
      } else {
        const retained = state.targetDispositionIntent;
        if (retained.decisionId !== signed.decision.decisionId || retained.decisionSha256 !== decisionSha256 ||
            retained.action !== signed.decision.action || retained.authorizationSha256 !== authorizationSha256 ||
            retained.expectedHelperSequence !== signed.decision.expectedHelperSequence) {
          throw new RecoveryError('RECOVERY_TARGET_AUTH_BINDING_MISMATCH', 'Disposition retry differs from its durable intent.');
        }
        request = this.options.client.buildRequest({ operation: retained.action, plan: input.plan,
          planSha256: input.planSha256, authorizationSha256: retained.authorizationSha256,
          expectedHelperSequence: retained.expectedHelperSequence, requestId: retained.requestId });
        if (sha256RecoveryBytes(canonicalJson(request)) !== retained.requestSha256) {
          throw new RecoveryError('RECOVERY_TARGET_REQUEST_CONFLICT', 'Reconstructed disposition request differs from durable intent.');
        }
        if (retained.status === 'REJECTED_DEFINITE') {
          await this.resolveRetainedDispositionRejection(operation, state, input, authorizationSha256);
          throw new RecoveryError('RECOVERY_TARGET_NOT_READY', 'Retained target disposition rejection was resolved without redispatch; retry with a fresh signed decision.');
        }
      }
      if (state.targetDispositionIntent?.status === 'INTENT_RECORDED') {
        state = await operation.markTargetDispositionDispatched(request.requestId, sha256RecoveryBytes(canonicalJson(request)));
      }
      let disposed;
      try { disposed = await this.options.client.send(request, input.signal); }
      catch (cause) {
        if (cause instanceof RecoveryTargetRejectedError && cause.definitePreEffect && !cause.result.response.ok) {
          const rejected = cause.result.response;
          state = await operation.recordTargetDispositionRejection({ requestId: request.requestId,
            requestSha256: sha256RecoveryBytes(canonicalJson(request)), receiptSha256: cause.result.receiptSha256,
            helperSequence: rejected.helperSequence, state: rejected.state, code: rejected.error.code });
          await this.resolveRetainedDispositionRejection(operation, state, input, authorizationSha256);
          throw cause;
        }
        throw cause;
      }
      const finalState = signed.decision.action === 'STOP_RETAIN' ? 'STOPPED_RETAINED' : 'RETIRED';
      if (!disposed.response.ok || disposed.response.state !== finalState || disposed.response.pendingAction !== null) {
        throw new RecoveryError('RECOVERY_TARGET_RECEIPT_MISMATCH', 'Target disposition receipt did not prove the authorized final state.');
      }
      return operation.recordTargetDisposition({ action: signed.decision.action,
        decisionSha256, receiptSha256: disposed.receiptSha256,
        helperSequence: disposed.response.helperSequence, finalState,
        reconciliationEvidenceSha256: disposed.response.reconciliationEvidenceSha256!,
        confirmedAt: (this.options.now ?? (() => new Date()))().toISOString() });
    });
    return result(state);
  }

  private async resolveRetainedPreparationRejection(operation: ScopedRecoveryOperation, state: RecoveryJournalState,
    input: { plan: RecoveryTargetPlan; planSha256: string; admissionBytes: Uint8Array; signal?: AbortSignal },
    authorizationSha256: string): Promise<void> {
    const retained = state.targetPreparationRequest;
    if (state.targetEffectStatus !== 'PREPARE_REJECTED_DEFINITE' || retained?.status !== 'REJECTED_DEFINITE' ||
        retained.rejectionHelperSequence === null) {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'No exact retained preparation rejection is available for read-only resolution.');
    }
    verifyAdmissionForPlan(input.plan, input.planSha256, input.admissionBytes, this.options.admissionKeys,
      this.options.revokedAdmissionKeyIds, (this.options.now ?? (() => new Date()))(), 'INSPECT');
    const inspectRequest = this.options.client.buildRequest({ operation: 'INSPECT', plan: input.plan,
      planSha256: input.planSha256, authorizationSha256, expectedHelperSequence: null });
    const inspected = await this.options.client.send(inspectRequest, input.signal);
    if (!inspected.response.ok || inspected.response.state !== 'ABSENT' || inspected.response.pendingAction !== null ||
        inspected.response.helperSequence !== retained.rejectionHelperSequence ||
        inspected.response.reconciliationEvidenceSha256 === null) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Retained preparation rejection lacks exact unchanged no-effect proof.');
    }
    await operation.resolveTargetPreparationRejection({ helperSequence: inspected.response.helperSequence,
      inspectedState: 'ABSENT', inspectionReceiptSha256: inspected.receiptSha256,
      evidenceSha256: inspected.response.reconciliationEvidenceSha256,
      resolvedAt: (this.options.now ?? (() => new Date()))().toISOString() });
  }

  private async resolveRetainedDispositionRejection(operation: ScopedRecoveryOperation, state: RecoveryJournalState,
    input: { plan: RecoveryTargetPlan; planSha256: string; decisionBytes: Uint8Array; signal?: AbortSignal },
    authorizationSha256: string): Promise<void> {
    const retained = state.targetDispositionIntent;
    if (state.targetEffectStatus !== 'DISPOSITION_REJECTED_DEFINITE' || retained?.status !== 'REJECTED_DEFINITE' ||
        retained.rejectionHelperSequence === null) {
      throw new RecoveryError('RECOVERY_STATE_INVALID', 'No exact retained disposition rejection is available for read-only resolution.');
    }
    const inspectRequest = this.options.client.buildRequest({ operation: 'INSPECT', plan: input.plan,
      planSha256: input.planSha256, authorizationSha256, expectedHelperSequence: null });
    const inspected = await this.options.client.send(inspectRequest, input.signal);
    if (!inspected.response.ok || inspected.response.state !== 'READY' || inspected.response.pendingAction !== null ||
        inspected.response.helperSequence !== retained.rejectionHelperSequence ||
        inspected.response.reconciliationEvidenceSha256 === null) {
      throw new RecoveryError('RECOVERY_TARGET_EFFECT_AMBIGUOUS', 'Retained disposition rejection lacks exact unchanged READY proof.');
    }
    await operation.resolveTargetDispositionRejection({ helperSequence: inspected.response.helperSequence,
      inspectedState: 'READY', inspectionReceiptSha256: inspected.receiptSha256,
      evidenceSha256: inspected.response.reconciliationEvidenceSha256,
      resolvedAt: (this.options.now ?? (() => new Date()))().toISOString() });
  }

  private assertBinding(state: RecoveryJournalState, plan: RecoveryTargetPlan, planSha256: string): void {
    const target = plan.targetPreparation;
    if (state.operationId !== plan.operationId || state.planId !== plan.planId || state.planSha256 !== planSha256 ||
        state.siteId !== plan.source.siteId || state.targetBinding === null || state.targetBinding.targetSetId !== target.targetSetId ||
        state.targetBinding.generation !== target.generation || state.targetBinding.hostInstallationId !== target.hostInstallationId ||
        state.targetBinding.topologyMode !== target.topologyMode || state.targetBinding.targetSpecificationSha256 !== target.targetSpecificationSha256) {
      throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'Recovery journal target binding does not match the exact plan v3 target identity.');
    }
  }
}
