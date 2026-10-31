import { ControlledRecoveryError, digest, type ControlledRecoveryState } from './contracts';
import { RECOVERY_RECONCILIATION_ACTIONS, reconcileRecoveredApplication, validateIsolatedRecoveredApplication,
  type Packet2PreparationAdapter, type Packet2PreparationPhase, type PreviousDeploymentReceipt, type PromotionBinding,
  type RecoveryAppValidationAdapter, type RecoveryOwnedTargetProof, type RecoveryPromotionAdapter,
  type RecoveryReconciliationAction, type RecoveryReconciliationAdapter, type RecoveryReconciliationReceipt,
  type RecoveryRollbackAdapter, acceptControlledRecovery, rollbackControlledRecovery } from './packet2';
import { ProtectedDeploymentAuthorityStore } from './protected-deployment-authority';
import { RecoveryOperationStore } from './recovery-operation-store';

export function createOperationStoreReportReader(store: RecoveryOperationStore) {
  return (operationId: string) => store.reportInputs(operationId);
}
export interface Packet2ReportAuthority {
  load(operationId: string): Promise<{ generation: string; remainingGates: string[] }>;
}
export async function readPacket2ReportState(store: RecoveryOperationStore, authority: Packet2ReportAuthority, operationId: string) {
  const [inputs, protectedAuthority] = await Promise.all([store.reportInputs(operationId), authority.load(operationId)]);
  if (!/^[0-9a-f-]{36}$/.test(protectedAuthority.generation) || protectedAuthority.remainingGates.some((gate) => !/^[A-Z][A-Z0-9_]{0,63}$/.test(gate)))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_REPORT_UNSAFE', 'Protected Packet 2 report authority is invalid.');
  return { ...inputs, generation: protectedAuthority.generation, unexecutedGates: protectedAuthority.remainingGates };
}

export interface TargetBoundReconciliationTransaction {
  execute(action: RecoveryReconciliationAction, input: { operationId: string; generation: string; recoveryReason: string; now: Date }): Promise<string>;
  scheduleFreshJob(name: string, input: { operationId: string; generation: string }): Promise<void>;
  insertExactReceipt(receipt: RecoveryReconciliationReceipt): Promise<'INSERTED' | 'EXACT_REPLAY'>;
}
export interface TargetBoundPacket2SqlClient {
  proveOwnedTargets(input: { operationId: string; siteId: string; generation: string }): Promise<RecoveryOwnedTargetProof>;
  loadReceipt(input: { operationId: string; generation: string }): Promise<RecoveryReconciliationReceipt | null>;
  transaction<T>(input: { operationId: string; generation: string; ownedTargetEvidenceSha256: string },
    work: (transaction: TargetBoundReconciliationTransaction) => Promise<T>): Promise<T>;
}

export class TransactionalRecoveryReconciliationAdapter implements RecoveryReconciliationAdapter {
  private transactionReceipt: RecoveryReconciliationReceipt | null = null;
  constructor(private readonly sql: TargetBoundPacket2SqlClient) {}
  proveOwnedTargets(input: { operationId: string; siteId: string; generation: string }) { return this.sql.proveOwnedTargets(input); }
  loadReceipt(input: { operationId: string; generation: string }) { return this.sql.loadReceipt(input); }
  async reconcileAtomically(input: { operationId: string; siteId: string; generation: string; target: RecoveryOwnedTargetProof;
    actions: readonly RecoveryReconciliationAction[]; recoveryReason: string; freshJobs: readonly string[]; now: Date }) {
    if (JSON.stringify(input.actions) !== JSON.stringify(RECOVERY_RECONCILIATION_ACTIONS)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_UNCERTAIN', 'Reconciliation action catalog differs.');
    return this.sql.transaction({ operationId: input.operationId, generation: input.generation, ownedTargetEvidenceSha256: input.target.ownershipEvidenceSha256 }, async (transaction) => {
      const actionCounts = {} as Record<RecoveryReconciliationAction, string>;
      for (const action of input.actions) { const count = await transaction.execute(action, input); if (!/^(0|[1-9][0-9]*)$/.test(count)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_UNCERTAIN', 'SQL action count is not canonical.'); actionCounts[action] = count; }
      for (const job of input.freshJobs) await transaction.scheduleFreshJob(job, input);
      const unsigned = { format: 'darshan-recovery-application-reconciliation-v1' as const, operationId: input.operationId,
        siteId: input.siteId, generation: input.generation, ownedTargetEvidenceSha256: input.target.ownershipEvidenceSha256,
        actionCounts, freshJobsScheduled: [...input.freshJobs], notificationsPreserved: true as const,
        durableExternalDeliveryQueue: 'ABSENT_IN_RELEASE_02_SOURCE' as const, completedAt: input.now.toISOString() };
      const receipt = { ...unsigned, receiptSha256: digest(unsigned) }; const inserted = await transaction.insertExactReceipt(receipt);
      if (!['INSERTED', 'EXACT_REPLAY'].includes(inserted)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_UNCERTAIN', 'Reconciliation receipt insertion is uncertain.');
      this.transactionReceipt = receipt; return actionCounts;
    });
  }
  async storeReceipt(receipt: RecoveryReconciliationReceipt) {
    const observed = await this.sql.loadReceipt({ operationId: receipt.operationId, generation: receipt.generation });
    if (!observed || digest(observed) !== digest(receipt) || (this.transactionReceipt && digest(this.transactionReceipt) !== digest(receipt))) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_UNCERTAIN', 'Exact reconciliation receipt was not committed with the SQL actions.');
    }
  }
}

export interface Packet2PhaseReceiptStore {
  load(input: { operationId: string; generation: string; phase: Packet2PreparationPhase }): Promise<{ evidenceSha256: string } | null>;
  store(input: { operationId: string; generation: string; phase: Packet2PreparationPhase; evidenceSha256: string }): Promise<void>;
}
export class OperationStorePacket2PhaseReceiptStore implements Packet2PhaseReceiptStore {
  constructor(private readonly operationStore: RecoveryOperationStore, private readonly sourceIdentitySha256: string, private readonly now = () => new Date()) {}
  async load(input: { operationId: string; phase: Packet2PreparationPhase }) { const value = await this.operationStore.readReceipt(input.operationId, input.phase); return value ? { evidenceSha256: value.evidence_sha256 } : null; }
  async store(input: { operationId: string; phase: Packet2PreparationPhase; evidenceSha256: string }) { await this.operationStore.recordReceipt({
    format: 'darshan-controlled-recovery-operation-receipt-v1', operation_id: input.operationId, phase: input.phase,
    source_identity_sha256: this.sourceIdentitySha256, evidence_sha256: input.evidenceSha256,
    aggregates: { completed: '1' }, timings_ms: {}, completed_at: this.now().toISOString(),
  }); }
}
export interface Packet2LiveTruthBoundary {
  observe(input: { operationId: string; generation: string; phase: Packet2PreparationPhase; evidenceSha256: string }): Promise<boolean>;
  provePresentTimeAuthority(input: { operationId: string; generation: string }): Promise<{ evidenceSha256: string }>;
}

export class DurablePacket2PreparationAdapter implements Packet2PreparationAdapter {
  constructor(private readonly input: { operationId: string; siteId: string; generation: string; databaseTargetId: string; objectTargetId: string;
    reconciliation: TransactionalRecoveryReconciliationAdapter; appValidation: RecoveryAppValidationAdapter;
    receipts: Packet2PhaseReceiptStore; liveTruth: Packet2LiveTruthBoundary }) {}
  async observe(phase: Packet2PreparationPhase) { const receipt = await this.input.receipts.load({ ...this.input, phase });
    return { confirmed: !!receipt && await this.input.liveTruth.observe({ ...this.input, phase, evidenceSha256: receipt.evidenceSha256 }), evidence: receipt }; }
  async reconcile() { const result = await reconcileRecoveredApplication({ operationId: this.input.operationId, siteId: this.input.siteId,
      generation: this.input.generation, expectedDatabaseTargetId: this.input.databaseTargetId, expectedObjectTargetId: this.input.objectTargetId,
      freshJobs: ['rebuild-present-authority', 'refresh-recovery-device-desired-state'], adapter: this.input.reconciliation });
    await this.input.receipts.store({ ...this.input, phase: 'APPLICATION_RECONCILED', evidenceSha256: result.receiptSha256 }); return { receiptSha256: result.receiptSha256 }; }
  async validateApp() { const result = await validateIsolatedRecoveredApplication({ adapter: this.input.appValidation,
      operationId: this.input.operationId, generation: this.input.generation });
    await this.input.receipts.store({ ...this.input, phase: 'APP_VALIDATED', evidenceSha256: result.reportSha256 }); return { reportSha256: result.reportSha256 }; }
  async markAwaitingPromotion() { const authority = await this.input.liveTruth.provePresentTimeAuthority(this.input);
    await this.input.receipts.store({ ...this.input, phase: 'AWAITING_PROMOTION', evidenceSha256: authority.evidenceSha256 }); return authority; }
}

export const PACKET2_LOCK_ORDER = ['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'] as const;
export interface FixedPromotionBoundary {
  withLocks<T>(order: typeof PACKET2_LOCK_ORDER, work: () => Promise<T>): Promise<T>;
  loadLatestPassingBinding(operationId: string): Promise<PromotionBinding>;
  capturePrevious(): Promise<{ receipt: PreviousDeploymentReceipt; pointerBytes: Uint8Array; overlayBytes: Uint8Array }>;
  fence(role: 'PREVIOUS' | 'RECOVERED'): Promise<void>; proveStopped(role: 'PREVIOUS' | 'RECOVERED'): Promise<boolean>;
  recheckPresentTimeAuthority(generation: string): Promise<boolean>; applyFixedOverlay(): Promise<void>;
  start(role: 'PREVIOUS' | 'RECOVERED'): Promise<void>; proveReady(role: 'PREVIOUS' | 'RECOVERED'): Promise<boolean>;
  restorePrevious(snapshot: { pointerBytes: Uint8Array; overlayBytes: Uint8Array; receipt: PreviousDeploymentReceipt }): Promise<void>;
  transition(state: ControlledRecoveryState, evidence: unknown): Promise<void>;
}

export class FixedRecoveryPromotionAdapter implements RecoveryPromotionAdapter {
  private captured: Awaited<ReturnType<FixedPromotionBoundary['capturePrevious']>> | null = null;
  constructor(private readonly operationId: string, private readonly binding: PromotionBinding,
    private readonly boundary: FixedPromotionBoundary, private readonly snapshots: ProtectedDeploymentAuthorityStore) {}
  withLocks<T>(order: typeof PACKET2_LOCK_ORDER, work: () => Promise<T>) { if (JSON.stringify(order) !== JSON.stringify(PACKET2_LOCK_ORDER)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_LOCK_ORDER_INVALID', 'Promotion lock order differs.'); return this.boundary.withLocks(order, work); }
  loadLatestPassingBinding(operationId: string) { return this.boundary.loadLatestPassingBinding(operationId); }
  async capturePreviousDeployment() { const existing = await this.snapshots.loadOptional(this.operationId);
    if (existing) { if (existing.binding_sha256 !== digest(this.binding)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PREVIOUS_DEPLOYMENT_CONFLICT', 'Existing previous-deployment snapshot belongs to a different promotion binding.');
      this.captured = { receipt: existing.receipt, pointerBytes: Buffer.from(existing.pointer_bytes_base64, 'base64'), overlayBytes: Buffer.from(existing.overlay_bytes_base64, 'base64') }; return existing.receipt; }
    this.captured = await this.boundary.capturePrevious(); return this.captured.receipt; }
  fencePreviousWriters() { return this.boundary.fence('PREVIOUS'); }
  provePreviousWritersStopped() { return this.boundary.proveStopped('PREVIOUS'); }
  recheckPresentTimeAuthority(generation: string) { return this.boundary.recheckPresentTimeAuthority(generation); }
  applyFixedApprovedOverlay() { return this.boundary.applyFixedOverlay(); }
  startRecoveredServices() { return this.boundary.start('RECOVERED'); }
  proveRecoveredServicesReady() { return this.boundary.proveReady('RECOVERED'); }
  async persistPreviousDeploymentReceipt(receipt: PreviousDeploymentReceipt) { if (!this.captured || digest(this.captured.receipt) !== digest(receipt)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PREVIOUS_DEPLOYMENT_CHANGED', 'Captured deployment changed.');
    await this.snapshots.persist({ operationId: this.operationId, binding: this.binding, pointerBytes: this.captured.pointerBytes, overlayBytes: this.captured.overlayBytes, receipt }); }
  transition(state: ControlledRecoveryState, evidence: unknown) { return this.boundary.transition(state, evidence); }
}

export class FixedRecoveryRollbackAdapter implements RecoveryRollbackAdapter {
  constructor(private readonly operationId: string, private readonly boundary: FixedPromotionBoundary, private readonly snapshots: ProtectedDeploymentAuthorityStore) {}
  fenceRecoveredWriters() { return this.boundary.fence('RECOVERED'); }
  proveRecoveredWritersStopped() { return this.boundary.proveStopped('RECOVERED'); }
  async restoreExactPreviousDeployment(previous: PreviousDeploymentReceipt) { const snapshot = await this.snapshots.load(this.operationId);
    if (digest(snapshot.receipt) !== digest(previous)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PREVIOUS_DEPLOYMENT_CHANGED', 'Rollback receipt differs from protected snapshot.');
    await this.boundary.restorePrevious({ pointerBytes: Buffer.from(snapshot.pointer_bytes_base64, 'base64'), overlayBytes: Buffer.from(snapshot.overlay_bytes_base64, 'base64'), receipt: snapshot.receipt }); }
  startPreviousServices() { return this.boundary.start('PREVIOUS'); }
  provePreviousServicesReady() { return this.boundary.proveReady('PREVIOUS'); }
  transition(state: ControlledRecoveryState, evidence: unknown) { return this.boundary.transition(state, evidence); }
}

export interface ProtectedWriteAuthority {
  withLocks<T>(order: typeof PACKET2_LOCK_ORDER, work: () => Promise<T>): Promise<T>;
  observe(operationId: string): Promise<{ writeFreeze: boolean; writesResumed: boolean; evidenceSha256: string }>;
}
export async function acceptFromProtectedAuthority(input: { operationId: string; reportSha256: string; authority: ProtectedWriteAuthority;
  approval: { authorize(): Promise<{ approvalId: string }> }; transition(state: ControlledRecoveryState, evidence: unknown): Promise<void> }) {
  return input.authority.withLocks(PACKET2_LOCK_ORDER, async () => { const observed = await input.authority.observe(input.operationId); if (!/^[a-f0-9]{64}$/.test(observed.evidenceSha256) || observed.writesResumed)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACCEPT_WRITE_FREEZE_LOST', 'Protected write authority does not prove the original freeze.');
    return acceptControlledRecovery({ operationId: input.operationId, reportSha256: input.reportSha256, writeFreeze: observed.writeFreeze,
      approval: input.approval, transition: input.transition }); });
}
export async function rollbackFromProtectedAuthority(input: { operationId: string; previous: PreviousDeploymentReceipt;
  authority: ProtectedWriteAuthority; adapter: RecoveryRollbackAdapter; postWriteDecision?: { preserveNewData: true; approvalId: string } }) {
  return input.authority.withLocks(PACKET2_LOCK_ORDER, async () => { const observed = await input.authority.observe(input.operationId); if (!/^[a-f0-9]{64}$/.test(observed.evidenceSha256)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_WRITE_AUTHORITY_INVALID', 'Protected write authority evidence is invalid.');
    return rollbackControlledRecovery({ writeFreeze: observed.writeFreeze, writesResumed: observed.writesResumed,
      postWriteDecision: input.postWriteDecision, previous: input.previous, adapter: input.adapter }); });
}
