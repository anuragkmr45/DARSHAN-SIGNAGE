import { createHash, createVerify, randomBytes, randomUUID } from 'node:crypto';
import { ControlledRecoveryError, RECOVERY_PAIRING_REVIEW_REQUIRED, digest, type ControlledRecoveryState } from './contracts';
import { ControlledRecoveryJournal } from './journal';

export type RecoveryGeneration = string;
export type PairingReviewDecision = 'APPROVED' | 'REJECTED';

export type Packet2PreparationPhase = 'APPLICATION_RECONCILED' | 'APP_VALIDATED' | 'AWAITING_PROMOTION';
export interface Packet2PreparationAdapter {
  observe(phase: Packet2PreparationPhase): Promise<{ confirmed: boolean; evidence?: unknown }>;
  reconcile(): Promise<unknown>;
  validateApp(): Promise<unknown>;
  markAwaitingPromotion(): Promise<unknown>;
}

export async function preparePacket2Application(input: {
  journal: ControlledRecoveryJournal;
  adapter: Packet2PreparationAdapter;
  fault?: (point: 'BEFORE_INTENT' | 'AFTER_INTENT' | 'BEFORE_RESULT' | 'AFTER_RESULT', phase: Packet2PreparationPhase) => Promise<void>;
}): Promise<void> {
  await input.journal.withOperationLock(async (lock) => {
    const starting = await input.journal.read(lock);
    const allowedStart = ['DATA_VALIDATED', 'APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION', 'FAILED_RETRYABLE', 'OPERATOR_REVIEW'];
    if (!allowedStart.includes(starting.state)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_STATE_INVALID', 'Packet 2 preparation requires Packet 1 DATA_VALIDATED truth.');
    for (const phase of ['APPLICATION_RECONCILED', 'APP_VALIDATED', 'AWAITING_PROMOTION'] as const) {
      const observed = await input.adapter.observe(phase);
      if (observed.confirmed) {
        if ((await input.journal.read(lock)).state !== phase) await input.journal.record({ phase, outcome: 'OBSERVATION', effectTruth: 'CONFIRMED', code: `CONTROLLED_RECOVERY_${phase}_REOBSERVED`, evidence: observed.evidence }, lock);
        continue;
      }
      await input.fault?.('BEFORE_INTENT', phase);
      await input.journal.record({ phase, outcome: 'INTENT', effectTruth: 'PENDING', code: `CONTROLLED_RECOVERY_${phase}_INTENT` }, lock);
      await input.fault?.('AFTER_INTENT', phase);
      let evidence: unknown;
      try {
        evidence = phase === 'APPLICATION_RECONCILED' ? await input.adapter.reconcile()
          : phase === 'APP_VALIDATED' ? await input.adapter.validateApp()
            : await input.adapter.markAwaitingPromotion();
        const after = await input.adapter.observe(phase);
        if (!after.confirmed) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS', `Packet 2 phase ${phase} was not re-observed.`);
      } catch (cause) {
        const error = cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS', 'Packet 2 effect truth is uncertain.', { cause });
        await input.journal.record({ phase: error.code.includes('AMBIGUOUS') ? 'OPERATOR_REVIEW' : 'FAILED_RETRYABLE', outcome: 'FAILURE',
          effectTruth: error.code.includes('AMBIGUOUS') ? 'AMBIGUOUS' : 'NONE', code: error.code, evidence: { phase } }, lock);
        throw error;
      }
      await input.fault?.('BEFORE_RESULT', phase);
      await input.journal.record({ phase, outcome: 'RESULT', effectTruth: 'CONFIRMED', code: `CONTROLLED_RECOVERY_${phase}_CONFIRMED`, evidence }, lock);
      await input.fault?.('AFTER_RESULT', phase);
    }
  });
}

export interface RecoveryOwnedTargetProof {
  operationId: string;
  siteId: string;
  generation: RecoveryGeneration;
  databaseTargetId: string;
  objectTargetId: string;
  ownershipEvidenceSha256: string;
}

export const RECOVERY_RECONCILIATION_ACTIONS = [
  'DELETE_HUMAN_SESSIONS',
  'EXPIRE_UNUSED_PAIRING_CODES',
  'QUARANTINE_ACTIVE_CERTIFICATES',
  'CANCEL_NONTERMINAL_DEVICE_COMMANDS_AND_APPEND_HISTORY',
  'SUPPRESS_PENDING_COMMAND_OUTBOX',
  'SUPPRESS_PENDING_EMERGENCY_TRANSITION_OUTBOX',
  'CANCEL_RECOVERED_NONTERMINAL_PG_BOSS_WORK',
  'RECONCILE_BACKUP_ATTEMPTS_AND_CAPTURE_BARRIERS',
  'RECONCILE_UPLOADS_AND_MEDIA_STAGING',
  'REMOVE_RECURSIVE_BACKUP_ARCHIVE_REFERENCES',
  'REBUILD_PRESENT_TIME_SCHEDULE_DEFAULT_AUTHORITY',
  'RETAIN_ONLY_REVIEWED_UNEXPIRED_EMERGENCIES',
] as const;
export type RecoveryReconciliationAction = typeof RECOVERY_RECONCILIATION_ACTIONS[number];

/** Only fresh, generation-keyed, idempotent jobs may be scheduled. */
export const RECOVERY_FRESH_JOB_ALLOWLIST = [
  'rebuild-present-authority',
  'refresh-recovery-device-desired-state',
] as const;

export interface RecoveryReconciliationReceipt {
  format: 'darshan-recovery-application-reconciliation-v1';
  operationId: string;
  siteId: string;
  generation: RecoveryGeneration;
  ownedTargetEvidenceSha256: string;
  actionCounts: Record<RecoveryReconciliationAction, string>;
  freshJobsScheduled: string[];
  notificationsPreserved: true;
  durableExternalDeliveryQueue: 'ABSENT_IN_RELEASE_02_SOURCE';
  completedAt: string;
  receiptSha256: string;
}

export interface RecoveryReconciliationAdapter {
  proveOwnedTargets(input: { operationId: string; siteId: string; generation: RecoveryGeneration }): Promise<RecoveryOwnedTargetProof>;
  loadReceipt(input: { operationId: string; generation: RecoveryGeneration }): Promise<RecoveryReconciliationReceipt | null>;
  reconcileAtomically(input: {
    operationId: string;
    siteId: string;
    generation: RecoveryGeneration;
    target: RecoveryOwnedTargetProof;
    actions: readonly RecoveryReconciliationAction[];
    recoveryReason: string;
    freshJobs: readonly string[];
    now: Date;
  }): Promise<Record<RecoveryReconciliationAction, string>>;
  storeReceipt(receipt: RecoveryReconciliationReceipt): Promise<void>;
}

function assertUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', `${label} must be a UUID.`);
  }
}

function assertDigest(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', `${label} must be a SHA-256 digest.`);
}

function assertCanonicalCounts(counts: Record<string, string>): void {
  if (Object.keys(counts).length !== RECOVERY_RECONCILIATION_ACTIONS.length ||
      RECOVERY_RECONCILIATION_ACTIONS.some((action) => !/^(0|[1-9][0-9]*)$/.test(counts[action] ?? ''))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RECONCILIATION_UNCERTAIN', 'Reconciliation did not return a canonical count for every required action.');
  }
}

export async function reconcileRecoveredApplication(input: {
  operationId: string;
  siteId: string;
  generation: RecoveryGeneration;
  expectedDatabaseTargetId: string;
  expectedObjectTargetId: string;
  freshJobs?: readonly string[];
  now?: Date;
  adapter: RecoveryReconciliationAdapter;
}): Promise<RecoveryReconciliationReceipt> {
  assertUuid(input.operationId, 'operationId');
  assertUuid(input.generation, 'generation');
  const existing = await input.adapter.loadReceipt({ operationId: input.operationId, generation: input.generation });
  if (existing) return existing;
  const target = await input.adapter.proveOwnedTargets(input);
  if (target.operationId !== input.operationId || target.siteId !== input.siteId || target.generation !== input.generation ||
      target.databaseTargetId !== input.expectedDatabaseTargetId || target.objectTargetId !== input.expectedObjectTargetId) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_TARGET_FOREIGN', 'Application reconciliation is permitted only on the exact proven recovery targets.');
  }
  assertDigest(target.ownershipEvidenceSha256, 'ownershipEvidenceSha256');
  const freshJobs = [...(input.freshJobs ?? [])];
  if (new Set(freshJobs).size !== freshJobs.length || freshJobs.some((job) => !RECOVERY_FRESH_JOB_ALLOWLIST.includes(job as typeof RECOVERY_FRESH_JOB_ALLOWLIST[number]))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_JOB_NOT_ALLOWLISTED', 'Recovered jobs are cancelled by default; only fixed fresh idempotent jobs are allowed.');
  }
  const now = input.now ?? new Date();
  const actionCounts = await input.adapter.reconcileAtomically({ operationId: input.operationId, siteId: input.siteId,
    generation: input.generation, target, actions: RECOVERY_RECONCILIATION_ACTIONS,
    recoveryReason: `RECOVERY_GENERATION:${input.generation}`, freshJobs, now });
  assertCanonicalCounts(actionCounts);
  const unsigned = { format: 'darshan-recovery-application-reconciliation-v1' as const, operationId: input.operationId,
    siteId: input.siteId, generation: input.generation, ownedTargetEvidenceSha256: target.ownershipEvidenceSha256,
    actionCounts, freshJobsScheduled: freshJobs, notificationsPreserved: true as const,
    durableExternalDeliveryQueue: 'ABSENT_IN_RELEASE_02_SOURCE' as const, completedAt: now.toISOString() };
  const receipt = { ...unsigned, receiptSha256: digest(unsigned) };
  await input.adapter.storeReceipt(receipt);
  return receipt;
}

export interface RecoveryPairingReviewRecord {
  generation: RecoveryGeneration;
  screenId: string;
  certificateId: string;
  status: 'PENDING' | PairingReviewDecision;
  actorId: string | null;
  reason: string | null;
  reviewedAt: string | null;
}

export interface RecoveryPairingReviewStore {
  getExact(input: { generation: string; screenId: string; certificateId: string }): Promise<RecoveryPairingReviewRecord | null>;
  decideExact(input: { generation: string; screenId: string; certificateId: string; decision: PairingReviewDecision;
    actorId: string; reason: string; reviewedAt: Date }): Promise<RecoveryPairingReviewRecord>;
}

export async function assertRecoveryPairingApproved(store: RecoveryPairingReviewStore, input: {
  generation: string; screenId: string; certificateId: string;
}): Promise<void> {
  const review = await store.getExact(input);
  if (!review || review.status !== 'APPROVED') {
    throw new ControlledRecoveryError(RECOVERY_PAIRING_REVIEW_REQUIRED, 'Recovered device pairing requires exact certificate review.');
  }
}

export async function reviewRecoveryPairing(input: {
  generation: string; screenId: string; certificateId: string; decision: 'approve' | 'reject'; reason: string;
  authorizer: { authorize(action: 'CONTROLLED_RECOVERY_PAIRING_REVIEW'): Promise<{ actorId: string }> };
  store: RecoveryPairingReviewStore; now?: Date;
}): Promise<RecoveryPairingReviewRecord> {
  assertUuid(input.generation, 'generation'); assertUuid(input.screenId, 'screenId'); assertUuid(input.certificateId, 'certificateId');
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 1000) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Pairing review reason is required and bounded.');
  const { actorId } = await input.authorizer.authorize('CONTROLLED_RECOVERY_PAIRING_REVIEW');
  assertUuid(actorId, 'actorId');
  return input.store.decideExact({ generation: input.generation, screenId: input.screenId, certificateId: input.certificateId,
    decision: input.decision === 'approve' ? 'APPROVED' : 'REJECTED', actorId, reason, reviewedAt: input.now ?? new Date() });
}

export const RECOVERY_GENERATION_PROOF_PREFIX = 'DARSHAN_RECOVERY_GENERATION_PROOF_V1';
export interface RecoveryGenerationChallenge {
  id: string; siteId: string; generation: string; screenId: string; certificateId: string;
  clientNonce: string; serverChallenge: string; expiresAt: string; consumedAt: string | null;
}

export function recoveryGenerationProofPayload(value: Omit<RecoveryGenerationChallenge, 'id' | 'consumedAt'>): string {
  return [RECOVERY_GENERATION_PROOF_PREFIX, value.siteId, value.generation, value.screenId, value.certificateId,
    value.clientNonce, value.serverChallenge, value.expiresAt].join('\n');
}

export interface RecoveryGenerationChallengeStore {
  create(challenge: RecoveryGenerationChallenge): Promise<void>;
  consumeExact(input: { id: string; siteId: string; generation: string; screenId: string; certificateId: string;
    clientNonce: string; serverChallenge: string; now: Date; receiptSha256: string }): Promise<'CONSUMED' | 'MISSING' | 'REPLAYED' | 'EXPIRED' | 'MISMATCH'>;
}

export async function issueRecoveryGenerationChallenge(input: {
  siteId: string; generation: string; screenId: string; certificateId: string; clientNonce: string;
  store: RecoveryGenerationChallengeStore; now?: Date; ttlMs?: number; random?: () => string; id?: () => string;
}): Promise<RecoveryGenerationChallenge> {
  assertUuid(input.generation, 'generation'); assertUuid(input.screenId, 'screenId'); assertUuid(input.certificateId, 'certificateId');
  if (!/^[A-Za-z0-9_-]{22,172}$/.test(input.clientNonce)) throw new ControlledRecoveryError('RECOVERY_GENERATION_PROOF_INVALID', 'Client nonce is invalid.');
  const now = input.now ?? new Date(); const ttlMs = input.ttlMs ?? 60_000;
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 5_000 || ttlMs > 300_000) throw new ControlledRecoveryError('RECOVERY_GENERATION_PROOF_INVALID', 'Challenge TTL is outside the fixed bound.');
  const challenge: RecoveryGenerationChallenge = { id: (input.id ?? randomUUID)(), siteId: input.siteId,
    generation: input.generation, screenId: input.screenId, certificateId: input.certificateId,
    clientNonce: input.clientNonce, serverChallenge: (input.random ?? (() => randomBytes(32).toString('base64url')))(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(), consumedAt: null };
  await input.store.create(challenge); return challenge;
}

export async function acceptRecoveryGenerationProof(input: {
  challenge: RecoveryGenerationChallenge; signatureBase64: string; publicKeyPem: string; now?: Date;
  store: RecoveryGenerationChallengeStore;
  acceptAtomically(value: { generation: string; screenId: string; certificateId: string; receiptSha256: string }): Promise<void>;
}): Promise<{ generation: string; receiptSha256: string }> {
  const payload = recoveryGenerationProofPayload(input.challenge);
  let verified = false;
  try { const verifier = createVerify('RSA-SHA256'); verifier.update(payload); verifier.end(); verified = verifier.verify(input.publicKeyPem, input.signatureBase64, 'base64'); } catch { verified = false; }
  if (!verified) throw new ControlledRecoveryError('RECOVERY_GENERATION_PROOF_INVALID', 'Recovery generation proof signature is invalid.');
  const now = input.now ?? new Date();
  const receiptSha256 = createHash('sha256').update(`${payload}\n${input.signatureBase64}`).digest('hex');
  const status = await input.store.consumeExact({ ...input.challenge, now, receiptSha256 });
  const codes = { MISSING: 'RECOVERY_GENERATION_CHALLENGE_MISSING', REPLAYED: 'RECOVERY_GENERATION_CHALLENGE_REPLAYED',
    EXPIRED: 'RECOVERY_GENERATION_CHALLENGE_EXPIRED', MISMATCH: 'RECOVERY_GENERATION_CHALLENGE_MISMATCH' } as const;
  if (status !== 'CONSUMED') throw new ControlledRecoveryError(codes[status], 'Recovery generation challenge was not accepted.');
  // Implementations must perform this in the same database transaction as
  // challenge consumption: persist generation, cancel old-generation in-flight
  // commands, and reset version authority while retaining certificate/cache.
  await input.acceptAtomically({ generation: input.challenge.generation, screenId: input.challenge.screenId,
    certificateId: input.challenge.certificateId, receiptSha256 });
  return { generation: input.challenge.generation, receiptSha256 };
}

export const RECOVERY_APP_VALIDATION_CASES = [
  'LOGIN_SESSION_REJECTION', 'PERMISSION_ENFORCEMENT', 'MEDIA_READ', 'PDF_SELECTED_PAGE', 'VIDEO_LOOP',
  'LAYOUT_PRESENTATION', 'CURRENT_SCHEDULE', 'DEFAULT_MEDIA', 'REVIEWED_UNEXPIRED_EMERGENCY',
  'CHAT_ATTACHMENT_AUTHORIZATION', 'PROOF_OF_PLAY', 'SCREENSHOT_WRITE_READBACK', 'OFFLINE_WEBPAGE_FIXTURE',
] as const;
export type RecoveryAppValidationCase = typeof RECOVERY_APP_VALIDATION_CASES[number];

export interface RecoveryAppValidationAdapter {
  proveIsolation(): Promise<{ egressBlocked: boolean; productionCredentialsAbsent: boolean; targetsEvidenceSha256: string }>;
  runCase(test: RecoveryAppValidationCase): Promise<{ passed: boolean; evidenceSha256: string }>;
  stopIsolatedApplication(): Promise<void>;
}

export async function validateIsolatedRecoveredApplication(input: {
  adapter: RecoveryAppValidationAdapter; operationId: string; generation: string; now?: Date;
}): Promise<{ passed: true; caseEvidence: Record<RecoveryAppValidationCase, string>; completedAt: string; reportSha256: string }> {
  const isolation = await input.adapter.proveIsolation();
  if (!isolation.egressBlocked || !isolation.productionCredentialsAbsent) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_APP_NOT_ISOLATED', 'Application validation isolation is not proven.');
  assertDigest(isolation.targetsEvidenceSha256, 'targetsEvidenceSha256');
  const caseEvidence = {} as Record<RecoveryAppValidationCase, string>;
  try {
    for (const test of RECOVERY_APP_VALIDATION_CASES) {
      const result = await input.adapter.runCase(test);
      if (!result.passed) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_APP_VALIDATION_FAILED', `Required isolated application case failed: ${test}.`);
      assertDigest(result.evidenceSha256, `${test} evidence`); caseEvidence[test] = result.evidenceSha256;
    }
  } finally { await input.adapter.stopIsolatedApplication(); }
  const completedAt = (input.now ?? new Date()).toISOString();
  const unsigned = { passed: true as const, operationId: input.operationId, generation: input.generation,
    targetsEvidenceSha256: isolation.targetsEvidenceSha256, caseEvidence, completedAt };
  return { passed: true, caseEvidence, completedAt, reportSha256: digest(unsigned) };
}

export interface PromotionBinding {
  operationId: string; reportSha256: string; sourceIdentitySha256: string; targetIdentitySha256: string;
  profileSha256: string; configurationSha256: string;
}
export interface PreviousDeploymentReceipt {
  pointerSha256: string; overlaySha256: string; containerSetSha256: string; originalTargetSetSha256: string;
}
export interface RecoveryPromotionAdapter {
  withLocks<T>(order: readonly ['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'], work: () => Promise<T>): Promise<T>;
  loadLatestPassingBinding(operationId: string): Promise<PromotionBinding>;
  capturePreviousDeployment(): Promise<PreviousDeploymentReceipt>;
  fencePreviousWriters(): Promise<void>;
  provePreviousWritersStopped(): Promise<boolean>;
  recheckPresentTimeAuthority(generation: string): Promise<boolean>;
  applyFixedApprovedOverlay(): Promise<void>;
  startRecoveredServices(): Promise<void>;
  proveRecoveredServicesReady(): Promise<boolean>;
  persistPreviousDeploymentReceipt(receipt: PreviousDeploymentReceipt): Promise<void>;
  transition(state: ControlledRecoveryState, evidence: unknown): Promise<void>;
}

function assertExactBinding(expected: PromotionBinding, actual: PromotionBinding): void {
  if (digest(expected) !== digest(actual)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PROMOTION_BINDING_CHANGED', 'Promotion inputs differ from the latest passing bound report.');
  Object.entries(expected).filter(([key]) => key.endsWith('Sha256')).forEach(([key, value]) => assertDigest(value, key));
}

export async function promoteControlledRecovery(input: {
  binding: PromotionBinding; confirmOperationId: string; confirmReportSha256: string; approval: { authorize(): Promise<{ actorId: string; approvalId: string }> };
  generation: string; adapter: RecoveryPromotionAdapter;
}): Promise<{ state: 'PROMOTED_PENDING_ACCEPTANCE'; approvalId: string; previous: PreviousDeploymentReceipt }> {
  if (input.confirmOperationId !== input.binding.operationId || input.confirmReportSha256 !== input.binding.reportSha256) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PROMOTION_CONFIRMATION_MISMATCH', 'Exact operation and report confirmation are required.');
  }
  const approved = await input.approval.authorize();
  return input.adapter.withLocks(['SITE', 'OPERATION', 'DEPLOYMENT_ROLE', 'PROMOTION'], async () => {
    assertExactBinding(input.binding, await input.adapter.loadLatestPassingBinding(input.binding.operationId));
    const previous = await input.adapter.capturePreviousDeployment();
    for (const [key, value] of Object.entries(previous)) assertDigest(value, key);
    await input.adapter.persistPreviousDeploymentReceipt(previous);
    await input.adapter.fencePreviousWriters();
    if (!(await input.adapter.provePreviousWritersStopped())) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PROMOTION_FENCE_UNPROVEN', 'Previous API, worker, sockets, dispatch and fanout are not proven stopped.');
    if (!(await input.adapter.recheckPresentTimeAuthority(input.generation))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PROMOTION_AUTHORITY_STALE', 'Schedule/default/emergency authority changed while awaiting promotion.');
    try {
      await input.adapter.applyFixedApprovedOverlay(); await input.adapter.startRecoveredServices();
      if (!(await input.adapter.proveRecoveredServicesReady())) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PROMOTION_READY_UNPROVEN', 'Recovered services did not prove readiness.');
    } catch (cause) {
      await input.adapter.transition('OPERATOR_REVIEW', { code: 'CONTROLLED_RECOVERY_PROMOTION_UNCERTAIN' });
      throw cause;
    }
    await input.adapter.transition('PROMOTED_PENDING_ACCEPTANCE', { approvalId: approved.approvalId, previous: digest(previous), writeFreeze: true });
    return { state: 'PROMOTED_PENDING_ACCEPTANCE' as const, approvalId: approved.approvalId, previous };
  });
}

export interface RecoveryRollbackAdapter {
  fenceRecoveredWriters(): Promise<void>; proveRecoveredWritersStopped(): Promise<boolean>;
  restoreExactPreviousDeployment(previous: PreviousDeploymentReceipt): Promise<void>;
  startPreviousServices(): Promise<void>; provePreviousServicesReady(): Promise<boolean>;
  transition(state: ControlledRecoveryState, evidence: unknown): Promise<void>;
}

export async function acceptControlledRecovery(input: {
  operationId: string; reportSha256: string; writeFreeze: boolean;
  approval: { authorize(): Promise<{ approvalId: string }> };
  transition(state: ControlledRecoveryState, evidence: unknown): Promise<void>;
}): Promise<void> {
  if (!input.writeFreeze) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACCEPT_WRITE_FREEZE_LOST', 'Acceptance requires the original cutover write freeze.');
  const approved = await input.approval.authorize();
  await input.transition('ACCEPTED', { operationId: input.operationId, reportSha256: input.reportSha256, approvalId: approved.approvalId });
}

export async function rollbackControlledRecovery(input: {
  writeFreeze: boolean; writesResumed: boolean; postWriteDecision?: { preserveNewData: true; approvalId: string };
  previous: PreviousDeploymentReceipt; adapter: RecoveryRollbackAdapter;
}): Promise<void> {
  if (!input.writeFreeze || input.writesResumed) {
    if (!input.postWriteDecision?.preserveNewData) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ROLLBACK_POST_WRITE_DECISION_REQUIRED', 'Lossless rollback cannot be claimed after writes resume; preserve new data and authorize an explicit divergence decision.');
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ROLLBACK_POST_WRITE_NOT_AUTOMATED', 'Post-write rollback is retained for an explicit preservation workflow, not automatic pointer reversal.');
  }
  await input.adapter.fenceRecoveredWriters();
  if (!(await input.adapter.proveRecoveredWritersStopped())) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ROLLBACK_FENCE_UNPROVEN', 'Recovered writers are not proven stopped.');
  await input.adapter.restoreExactPreviousDeployment(input.previous); await input.adapter.startPreviousServices();
  if (!(await input.adapter.provePreviousServicesReady())) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ROLLBACK_READY_UNPROVEN', 'Previous services did not prove readiness against untouched original targets.');
  await input.adapter.transition('ROLLED_BACK', { previous: digest(input.previous), writeFreeze: true });
}
