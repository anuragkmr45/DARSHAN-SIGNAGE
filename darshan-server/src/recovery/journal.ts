import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  RECOVERY_JOURNAL_FORMAT,
  RECOVERY_JOURNAL_FORMAT_V1,
  RECOVERY_JOURNAL_FORMAT_V2,
  RECOVERY_JOURNAL_FORMAT_V3,
  RECOVERY_JOURNAL_FORMAT_V4,
  RECOVERY_PHASES,
  assertCanonicalTimestamp,
  canonicalRecoveryBytes,
  recoveryDigest,
  recoverySiteId,
  recoveryUuid,
  sha256RecoveryBytes,
  type RecoveryPhase,
} from './contracts';
import { parseStrictJson } from '../backups/backup-broker-protocol';
import { RecoveryError, type RecoveryErrorCode } from './errors';

const JOURNAL_FILE = 'journal.json';
const OPERATIONS_DIRECTORY = 'operations';
const SITE_LOCK = '.site.lock';
const OPERATION_LOCK = '.operation.lock';
const MAX_JOURNAL_BYTES = 256 * 1024;
const LEGACY_RECOVERY_PHASES = ['PLANNED', 'SOURCE_HELD', 'SOURCE_VERIFIED'] as const;

export interface RecoveryProcessIdentity {
  instanceId: string;
  pid: number;
}

export interface RecoveryJournalState {
  format: typeof RECOVERY_JOURNAL_FORMAT;
  operationId: string;
  siteId: string;
  planId: string;
  planSha256: string;
  sourceDescriptorSha256: string;
  ownerId: string;
  fenceToken: string;
  sequence: number;
  phase: RecoveryPhase;
  pendingPhase: RecoveryPhase | null;
  lastFailureCode: RecoveryErrorCode | null;
  failureDisposition: RecoveryFailureDisposition | null;
  lastReconciliationEvidenceSha256: string | null;
  holdDisposition: RecoveryHoldDisposition | null;
  targetBinding: RecoveryTargetBinding | null;
  targetReceiptSha256: string | null;
  targetHelperSequence: number | null;
  targetReconciliationEvidenceSha256: string | null;
  targetDisposition: RecoveryTargetDispositionReceipt | null;
  targetEffectStatus: RecoveryTargetEffectStatus;
  targetPreparationRequest: RecoveryTargetPreparationRequest | null;
  targetDispositionIntent: RecoveryTargetDispositionIntent | null;
  targetRejectedRequests: RecoveryTargetRejectedRequestEvidence[];
  importStarted: false;
  createdAt: string;
  updatedAt: string;
}

export type RecoveryTargetEffectStatus = 'NONE_PROVEN' | 'PREPARE_INTENT' | 'PREPARE_DISPATCH_UNKNOWN' |
  'PREPARE_REJECTED_DEFINITE' | 'READY_PROVEN' | 'DISPOSITION_INTENT' | 'DISPOSITION_DISPATCH_UNKNOWN' |
  'DISPOSITION_REJECTED_DEFINITE' | 'DISPOSED_PROVEN' |
  'RECONCILIATION_REQUIRED';

export interface RecoveryTargetPreparationRequest {
  requestId: string;
  requestSha256: string;
  admissionId: string;
  admissionSha256: string;
  authorizationSha256: string;
  expectedHelperSequence: number | null;
  status: 'INTENT_RECORDED' | 'DISPATCH_UNKNOWN' | 'REJECTED_DEFINITE' | 'COMPLETED';
  rejectionReceiptSha256: string | null;
  rejectionHelperSequence: number | null;
  rejectionState: string | null;
  rejectionCode: string | null;
}

export interface RecoveryTargetDispositionIntent {
  decisionId: string;
  decisionSha256: string;
  action: 'STOP_RETAIN' | 'RETIRE';
  expectedFinalState: 'STOPPED_RETAINED' | 'RETIRED';
  requestId: string;
  requestSha256: string;
  authorizationSha256: string;
  expectedHelperSequence: number;
  expectedTargetState: 'READY';
  preparedReceiptSha256: string;
  preDispositionInspectionReceiptSha256: string;
  preDispositionEvidenceSha256: string;
  status: 'INTENT_RECORDED' | 'DISPATCH_UNKNOWN' | 'REJECTED_DEFINITE' | 'COMPLETED';
  rejectionReceiptSha256: string | null;
  rejectionHelperSequence: number | null;
  rejectionState: string | null;
  rejectionCode: string | null;
}

export interface RecoveryTargetRejectedRequestEvidence {
  action: 'PREPARE' | 'STOP_RETAIN' | 'RETIRE';
  requestId: string;
  requestSha256: string;
  authorizationSha256: string;
  decisionId: string | null;
  rejectionReceiptSha256: string;
  rejectionHelperSequence: number;
  rejectionState: string;
  rejectionCode: string;
  noEffectInspectionReceiptSha256: string;
  noEffectEvidenceSha256: string;
  resolvedAt: string;
}

export interface RecoveryTargetBinding {
  targetSetId: string;
  generation: number;
  hostInstallationId: string;
  topologyMode: 'SINGLE_HOST' | 'SPLIT_HOST';
  targetSpecificationSha256: string;
}

export interface RecoveryTargetDispositionReceipt {
  action: 'STOP_RETAIN' | 'RETIRE';
  decisionSha256: string;
  receiptSha256: string;
  helperSequence: number;
  finalState: 'STOPPED_RETAINED' | 'RETIRED';
  reconciliationEvidenceSha256: string;
  confirmedAt: string;
}

export interface RecoveryHoldDisposition {
  decisionId: string;
  closedAs: 'ABORTED_PRE_IMPORT' | 'ABANDONED';
  action: 'RELEASE' | 'MARK_UNCERTAIN';
  status: 'PENDING' | 'CONFIRMED';
  reviewSha256: string;
  reviewEvidenceSha256: string;
  reviewedAt: string;
  observedStatus: 'ABSENT' | 'ACTIVE' | 'UNCERTAIN' | 'RELEASED' | null;
  observedEvidenceSha256: string | null;
  confirmedAt: string | null;
  failureCode: RecoveryErrorCode | null;
  priorDecisionSha256: string | null;
}

export type RecoveryFailureDisposition = 'DEFINITE_PRE_EFFECT' | 'AMBIGUOUS_EXTERNAL_EFFECT';

export type ScopedRecoveryMutation =
  | { kind: 'RECORD_PHASE_INTENT'; target: Exclude<RecoveryPhase, 'PLANNED'> }
  | { kind: 'COMPLETE_PHASE'; target: Exclude<RecoveryPhase, 'PLANNED'> }
  | { kind: 'RECORD_PHASE_FAILURE'; failureCode: RecoveryErrorCode; disposition: RecoveryFailureDisposition }
  | { kind: 'RESOLVE_AMBIGUOUS_PHASE'; target: Exclude<RecoveryPhase, 'PLANNED'>; evidenceSha256: string }
  | { kind: 'RECORD_HOLD_DISPOSITION'; disposition: RecoveryHoldDisposition }
  | { kind: 'UPDATE_HOLD_DISPOSITION'; decisionId: string; observedStatus: RecoveryHoldDisposition['observedStatus'];
      observedEvidenceSha256: string | null; confirmedAt: string | null; failureCode: RecoveryErrorCode | null }
  | { kind: 'COMPLETE_TARGETS_PREPARED'; receiptSha256: string; helperSequence: number; reconciliationEvidenceSha256: string }
  | { kind: 'RECORD_TARGET_PREPARATION_INTENT'; request: RecoveryTargetPreparationRequest }
  | { kind: 'MARK_TARGET_PREPARATION_DISPATCHED'; requestId: string; requestSha256: string }
  | { kind: 'RECORD_TARGET_PREPARATION_REJECTION'; requestId: string; requestSha256: string; receiptSha256: string;
      helperSequence: number; state: string; code: string }
  | { kind: 'RESOLVE_TARGET_PREPARATION_REJECTION'; helperSequence: number; inspectedState: 'ABSENT';
      inspectionReceiptSha256: string; evidenceSha256: string; resolvedAt: string }
  | { kind: 'RECORD_TARGET_DISPOSITION_INTENT'; intent: RecoveryTargetDispositionIntent }
  | { kind: 'MARK_TARGET_DISPOSITION_DISPATCHED'; requestId: string; requestSha256: string }
  | { kind: 'RECORD_TARGET_DISPOSITION_REJECTION'; requestId: string; requestSha256: string; receiptSha256: string;
      helperSequence: number; state: string; code: string }
  | { kind: 'RESOLVE_TARGET_DISPOSITION_REJECTION'; helperSequence: number; inspectedState: 'READY';
      inspectionReceiptSha256: string; evidenceSha256: string; resolvedAt: string }
  | { kind: 'RECORD_TARGET_DISPOSITION'; disposition: RecoveryTargetDispositionReceipt };

type RecoveryJournalV5OnlyField = 'targetBinding' | 'targetReceiptSha256' | 'targetHelperSequence' |
  'targetReconciliationEvidenceSha256' | 'targetDisposition' | 'targetEffectStatus' |
  'targetPreparationRequest' | 'targetDispositionIntent' | 'targetRejectedRequests' | 'importStarted';

interface RecoveryJournalStateV1 extends Omit<RecoveryJournalState, 'format' | 'failureDisposition' | 'lastReconciliationEvidenceSha256' | 'holdDisposition' | RecoveryJournalV5OnlyField> {
  format: typeof RECOVERY_JOURNAL_FORMAT_V1;
}

interface RecoveryJournalStateV2 extends Omit<RecoveryJournalState, 'format' | 'lastReconciliationEvidenceSha256' | 'holdDisposition' | RecoveryJournalV5OnlyField> {
  format: typeof RECOVERY_JOURNAL_FORMAT_V2;
}

interface RecoveryJournalStateV3 extends Omit<RecoveryJournalState, 'format' | 'holdDisposition' | RecoveryJournalV5OnlyField> {
  format: typeof RECOVERY_JOURNAL_FORMAT_V3;
}

interface RecoveryJournalStateV4 extends Omit<RecoveryJournalState, 'format' | 'targetBinding' | 'targetReceiptSha256' |
  'targetHelperSequence' | 'targetReconciliationEvidenceSha256' | 'targetDisposition' | 'importStarted'> {
  format: typeof RECOVERY_JOURNAL_FORMAT_V4;
}

interface RecoveryJournalEnvelope {
  state: RecoveryJournalState;
  stateSha256: string;
}

export interface RecoveryJournalGuard {
  expectedSequence: number;
  expectedOwnerId: string;
  expectedFenceToken: string;
  expectedSiteId: string;
  expectedPlanId: string;
  expectedPlanSha256: string;
}

export interface ScopedRecoveryOperation {
  readonly operationId: string;
  read(): Promise<RecoveryJournalState>;
  mutate(mutation: ScopedRecoveryMutation): Promise<RecoveryJournalState>;
  recordPhaseIntent(target: Exclude<RecoveryPhase, 'PLANNED'>): Promise<RecoveryJournalState>;
  completePhase(target: Exclude<RecoveryPhase, 'PLANNED'>): Promise<RecoveryJournalState>;
  recordPhaseFailure(failureCode: RecoveryErrorCode, disposition: RecoveryFailureDisposition): Promise<RecoveryJournalState>;
  resolveAmbiguousPhase(target: Exclude<RecoveryPhase, 'PLANNED'>, evidenceSha256: string): Promise<RecoveryJournalState>;
  recordHoldDisposition(disposition: RecoveryHoldDisposition): Promise<RecoveryJournalState>;
  updateHoldDisposition(input: Omit<Extract<ScopedRecoveryMutation, { kind: 'UPDATE_HOLD_DISPOSITION' }>, 'kind'>): Promise<RecoveryJournalState>;
  completeTargetsPrepared(input: Omit<Extract<ScopedRecoveryMutation, { kind: 'COMPLETE_TARGETS_PREPARED' }>, 'kind'>): Promise<RecoveryJournalState>;
  recordTargetPreparationIntent(request: RecoveryTargetPreparationRequest): Promise<RecoveryJournalState>;
  markTargetPreparationDispatched(requestId: string, requestSha256: string): Promise<RecoveryJournalState>;
  recordTargetPreparationRejection(input: Omit<Extract<ScopedRecoveryMutation, { kind: 'RECORD_TARGET_PREPARATION_REJECTION' }>, 'kind'>): Promise<RecoveryJournalState>;
  resolveTargetPreparationRejection(input: Omit<Extract<ScopedRecoveryMutation, { kind: 'RESOLVE_TARGET_PREPARATION_REJECTION' }>, 'kind'>): Promise<RecoveryJournalState>;
  recordTargetDispositionIntent(intent: RecoveryTargetDispositionIntent): Promise<RecoveryJournalState>;
  markTargetDispositionDispatched(requestId: string, requestSha256: string): Promise<RecoveryJournalState>;
  recordTargetDispositionRejection(input: Omit<Extract<ScopedRecoveryMutation, { kind: 'RECORD_TARGET_DISPOSITION_REJECTION' }>, 'kind'>): Promise<RecoveryJournalState>;
  resolveTargetDispositionRejection(input: Omit<Extract<ScopedRecoveryMutation, { kind: 'RESOLVE_TARGET_DISPOSITION_REJECTION' }>, 'kind'>): Promise<RecoveryJournalState>;
  recordTargetDisposition(disposition: RecoveryTargetDispositionReceipt): Promise<RecoveryJournalState>;
}

export type RecoveryJournalFaultStage =
  | 'after-temp-fsync-before-rename'
  | 'after-journal-read-before-stat'
  | 'after-lock-create-before-fstat'
  | 'after-lock-write-before-sync'
  | 'after-lock-sync-before-parent-fsync';

function safeRoot(root: string): string {
  if (!isAbsolute(root) || resolve(root) !== root || root.endsWith(sep)) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Recovery journal root must be a canonical absolute path without a trailing separator.');
  }
  return root;
}

function contained(root: string, ...segments: string[]): string {
  const path = resolve(root, ...segments);
  const suffix = relative(root, path);
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Recovery journal path escaped its root.');
  }
  return path;
}

async function assertDirectory(path: string, expectedDevice?: bigint): Promise<bigint> {
  let stat;
  try { stat = await fs.lstat(path, { bigint: true }); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new RecoveryError('RECOVERY_JOURNAL_MISSING', `Recovery journal directory is missing: ${path}`, { cause });
    throw cause;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || Number(stat.mode & 0o777n) !== 0o700 ||
      (expectedDevice !== undefined && stat.dev !== expectedDevice) || await fs.realpath(path) !== path) {
    throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', `Recovery journal directory is unsafe: ${path}`);
  }
  return stat.dev;
}

function assertNoSecrets(value: unknown): void {
  const forbidden = /(?:secret|password|private[_-]?key|credential|token|url|uri)/i;
  const visit = (item: unknown): void => {
    if (typeof item === 'string' && /(?:[a-z][a-z0-9+.-]*:\/\/|-----BEGIN .*PRIVATE KEY-----)/i.test(item)) {
      throw new RecoveryError('RECOVERY_SECRET_REJECTED', 'Recovery journal values must not contain URLs or private keys.');
    }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (forbidden.test(key) && key !== 'fenceToken') {
        throw new RecoveryError('RECOVERY_SECRET_REJECTED', `Recovery journal field ${key} is not permitted.`);
      }
      visit(child);
    }
  };
  visit(value);
}

function validateState(value: RecoveryJournalState): RecoveryJournalState {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'createdAt', 'failureDisposition', 'fenceToken', 'format', 'lastFailureCode', 'lastReconciliationEvidenceSha256', 'operationId', 'ownerId', 'pendingPhase',
        'phase', 'planId', 'planSha256', 'sequence', 'siteId', 'sourceDescriptorSha256', 'updatedAt', 'holdDisposition',
        'targetBinding', 'targetReceiptSha256', 'targetHelperSequence', 'targetReconciliationEvidenceSha256',
        'targetDisposition', 'targetEffectStatus', 'targetPreparationRequest', 'targetDispositionIntent', 'targetRejectedRequests', 'importStarted',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal state has missing or unknown fields.');
  if (value.format !== RECOVERY_JOURNAL_FORMAT) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal format is unsupported.');
  recoveryUuid(value.operationId, 'operationId'); recoveryUuid(value.planId, 'planId');
  recoveryUuid(value.ownerId, 'ownerId'); recoveryUuid(value.fenceToken, 'fenceToken');
  recoverySiteId(value.siteId); recoveryDigest(value.planSha256, 'planSha256');
  recoveryDigest(value.sourceDescriptorSha256, 'sourceDescriptorSha256');
  assertCanonicalTimestamp(value.createdAt, 'createdAt'); assertCanonicalTimestamp(value.updatedAt, 'updatedAt');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || !RECOVERY_PHASES.includes(value.phase) ||
      (value.pendingPhase !== null && !RECOVERY_PHASES.includes(value.pendingPhase))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal sequence or phase is invalid.');
  }
  if (value.lastFailureCode !== null && !/^RECOVERY_[A-Z0-9_]+$/.test(value.lastFailureCode)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal failure code is invalid.');
  }
  if ((value.lastFailureCode === null) !== (value.failureDisposition === null) ||
      (value.failureDisposition !== null && !['DEFINITE_PRE_EFFECT', 'AMBIGUOUS_EXTERNAL_EFFECT'].includes(value.failureDisposition)) ||
      (value.failureDisposition === 'DEFINITE_PRE_EFFECT' && value.pendingPhase !== null) ||
      (value.failureDisposition === 'AMBIGUOUS_EXTERNAL_EFFECT' && value.pendingPhase === null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal failure disposition is inconsistent with its pending phase.');
  }
  if (value.lastReconciliationEvidenceSha256 !== null) {
    recoveryDigest(value.lastReconciliationEvidenceSha256, 'lastReconciliationEvidenceSha256');
    if (value.failureDisposition === 'AMBIGUOUS_EXTERNAL_EFFECT' || value.phase === 'PLANNED') {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Reconciliation evidence is inconsistent with unresolved or uncompleted recovery state.');
    }
  }
  if (value.holdDisposition !== null) validateHoldDisposition(value.holdDisposition);
  if (value.importStarted !== false) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target foundation journals cannot mark import started.');
  if (value.targetBinding !== null) validateTargetBinding(value.targetBinding);
  if ((value.targetReceiptSha256 === null) !== (value.targetHelperSequence === null) ||
      (value.targetReceiptSha256 === null) !== (value.targetReconciliationEvidenceSha256 === null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target receipt, helper sequence, and reconciliation evidence must be recorded together.');
  }
  if (value.targetReceiptSha256 !== null) {
    recoveryDigest(value.targetReceiptSha256, 'targetReceiptSha256');
    recoveryDigest(value.targetReconciliationEvidenceSha256!, 'targetReconciliationEvidenceSha256');
    if (!Number.isSafeInteger(value.targetHelperSequence) || value.targetHelperSequence! < 0 || value.targetBinding === null ||
        value.phase !== 'TARGETS_PREPARED') throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target receipt is inconsistent with target lifecycle state.');
  }
  if (value.phase === 'TARGETS_PREPARED' && value.targetReceiptSha256 === null) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'TARGETS_PREPARED requires a matching durable target receipt.');
  }
  if (value.targetDisposition !== null) {
    validateTargetDisposition(value.targetDisposition);
    if (value.targetBinding === null || value.phase !== 'TARGETS_PREPARED') throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target disposition lacks a prepared target binding.');
  }
  if (!['NONE_PROVEN', 'PREPARE_INTENT', 'PREPARE_DISPATCH_UNKNOWN', 'PREPARE_REJECTED_DEFINITE', 'READY_PROVEN', 'DISPOSITION_INTENT',
    'DISPOSITION_DISPATCH_UNKNOWN', 'DISPOSITION_REJECTED_DEFINITE', 'DISPOSED_PROVEN', 'RECONCILIATION_REQUIRED'].includes(value.targetEffectStatus)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target effect status is invalid.');
  }
  if (value.targetPreparationRequest !== null) validateTargetPreparationRequest(value.targetPreparationRequest);
  if (value.targetDispositionIntent !== null) validateTargetDispositionIntent(value.targetDispositionIntent);
  if (!Array.isArray(value.targetRejectedRequests) || value.targetRejectedRequests.length > 128) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejected-request evidence exceeds its bound.');
  }
  const rejectedIds = new Set<string>();
  for (const rejected of value.targetRejectedRequests) {
    validateTargetRejectedRequest(rejected);
    if (rejectedIds.has(rejected.requestId)) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejected requestId is duplicated.');
    rejectedIds.add(rejected.requestId);
  }
  if (value.targetBinding === null && (value.targetEffectStatus !== 'NONE_PROVEN' || value.targetPreparationRequest !== null ||
      value.targetDispositionIntent !== null || value.targetDisposition !== null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'No-target journal contains target effect evidence.');
  }
  if (value.targetEffectStatus === 'NONE_PROVEN' && (value.targetPreparationRequest !== null || value.targetReceiptSha256 !== null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'No-effect proof conflicts with target preparation evidence.');
  }
  if (value.targetEffectStatus === 'PREPARE_INTENT' && value.targetPreparationRequest?.status !== 'INTENT_RECORDED' ||
      value.targetEffectStatus === 'PREPARE_DISPATCH_UNKNOWN' && value.targetPreparationRequest?.status !== 'DISPATCH_UNKNOWN' ||
      value.targetEffectStatus === 'PREPARE_REJECTED_DEFINITE' && value.targetPreparationRequest?.status !== 'REJECTED_DEFINITE' ||
      value.targetEffectStatus === 'READY_PROVEN' && (value.targetPreparationRequest?.status !== 'COMPLETED' || value.targetReceiptSha256 === null) ||
      value.targetEffectStatus === 'DISPOSITION_INTENT' && value.targetDispositionIntent?.status !== 'INTENT_RECORDED' ||
      value.targetEffectStatus === 'DISPOSITION_DISPATCH_UNKNOWN' && value.targetDispositionIntent?.status !== 'DISPATCH_UNKNOWN' ||
      value.targetEffectStatus === 'DISPOSITION_REJECTED_DEFINITE' && value.targetDispositionIntent?.status !== 'REJECTED_DEFINITE' ||
      value.targetEffectStatus === 'DISPOSED_PROVEN' && (value.targetDispositionIntent?.status !== 'COMPLETED' || value.targetDisposition === null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target effect status conflicts with its durable request evidence.');
  }
  assertNoSecrets(value);
  return value;
}

function validateTargetPreparationRequest(value: RecoveryTargetPreparationRequest): RecoveryTargetPreparationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'requestId', 'requestSha256', 'admissionId', 'admissionSha256', 'authorizationSha256', 'expectedHelperSequence', 'status',
        'rejectionReceiptSha256', 'rejectionHelperSequence', 'rejectionState', 'rejectionCode',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target preparation request has missing or unknown fields.');
  recoveryUuid(value.requestId, 'target requestId'); recoveryUuid(value.admissionId, 'target admissionId');
  recoveryDigest(value.requestSha256, 'target requestSha256'); recoveryDigest(value.admissionSha256, 'target admissionSha256');
  recoveryDigest(value.authorizationSha256, 'target authorizationSha256');
  if (value.expectedHelperSequence !== null && (!Number.isSafeInteger(value.expectedHelperSequence) || value.expectedHelperSequence < 0) ||
      !['INTENT_RECORDED', 'DISPATCH_UNKNOWN', 'REJECTED_DEFINITE', 'COMPLETED'].includes(value.status)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target preparation request is invalid.');
  }
  validateRejectionFields(value);
  return value;
}

function validateTargetDispositionIntent(value: RecoveryTargetDispositionIntent): RecoveryTargetDispositionIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'decisionId', 'decisionSha256', 'action', 'expectedFinalState', 'requestId', 'requestSha256', 'authorizationSha256',
        'expectedHelperSequence', 'expectedTargetState', 'preparedReceiptSha256',
        'preDispositionInspectionReceiptSha256', 'preDispositionEvidenceSha256',
        'status', 'rejectionReceiptSha256', 'rejectionHelperSequence', 'rejectionState', 'rejectionCode',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target disposition intent has missing or unknown fields.');
  recoveryUuid(value.decisionId, 'target decisionId'); recoveryUuid(value.requestId, 'target disposition requestId');
  recoveryDigest(value.decisionSha256, 'target decisionSha256'); recoveryDigest(value.requestSha256, 'target disposition requestSha256');
  recoveryDigest(value.authorizationSha256, 'target disposition authorizationSha256');
  recoveryDigest(value.preparedReceiptSha256, 'preparedReceiptSha256');
  recoveryDigest(value.preDispositionInspectionReceiptSha256, 'preDispositionInspectionReceiptSha256');
  recoveryDigest(value.preDispositionEvidenceSha256, 'preDispositionEvidenceSha256');
  if (!['STOP_RETAIN', 'RETIRE'].includes(value.action) ||
      (value.action === 'STOP_RETAIN' ? value.expectedFinalState !== 'STOPPED_RETAINED' : value.expectedFinalState !== 'RETIRED') ||
      value.expectedTargetState !== 'READY' ||
      !Number.isSafeInteger(value.expectedHelperSequence) ||
      value.expectedHelperSequence < 0 || !['INTENT_RECORDED', 'DISPATCH_UNKNOWN', 'REJECTED_DEFINITE', 'COMPLETED'].includes(value.status)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target disposition intent is invalid.');
  }
  validateRejectionFields(value);
  return value;
}

function validateRejectionFields(value: { status: string; rejectionReceiptSha256: string | null;
  rejectionHelperSequence: number | null; rejectionState: string | null; rejectionCode: string | null }): void {
  const present = value.rejectionReceiptSha256 !== null || value.rejectionHelperSequence !== null ||
    value.rejectionState !== null || value.rejectionCode !== null;
  if ((value.status === 'REJECTED_DEFINITE') !== present || present &&
      (value.rejectionReceiptSha256 === null || value.rejectionHelperSequence === null || value.rejectionState === null || value.rejectionCode === null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target request rejection evidence is inconsistent.');
  }
  if (value.rejectionReceiptSha256 !== null) recoveryDigest(value.rejectionReceiptSha256, 'target rejection receiptSha256');
  if (value.rejectionHelperSequence !== null && (!Number.isSafeInteger(value.rejectionHelperSequence) || value.rejectionHelperSequence < 0)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejection helper sequence is invalid.');
  }
  if (value.rejectionState !== null && !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.rejectionState) ||
      value.rejectionCode !== null && !/^TARGET_[A-Z0-9_]+$/.test(value.rejectionCode)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejection state or code is invalid.');
  }
}

function validateTargetRejectedRequest(value: RecoveryTargetRejectedRequestEvidence): RecoveryTargetRejectedRequestEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'action', 'requestId', 'requestSha256', 'authorizationSha256', 'decisionId', 'rejectionReceiptSha256',
        'rejectionHelperSequence', 'rejectionState', 'rejectionCode', 'noEffectInspectionReceiptSha256',
        'noEffectEvidenceSha256', 'resolvedAt',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejected-request evidence has missing or unknown fields.');
  if (!['PREPARE', 'STOP_RETAIN', 'RETIRE'].includes(value.action)) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejected action is invalid.');
  recoveryUuid(value.requestId, 'rejected target requestId'); if (value.decisionId !== null) recoveryUuid(value.decisionId, 'rejected target decisionId');
  recoveryDigest(value.requestSha256, 'rejected target requestSha256'); recoveryDigest(value.authorizationSha256, 'rejected target authorizationSha256');
  recoveryDigest(value.rejectionReceiptSha256, 'rejected target receiptSha256');
  recoveryDigest(value.noEffectInspectionReceiptSha256, 'target no-effect inspection receiptSha256');
  recoveryDigest(value.noEffectEvidenceSha256, 'target no-effect evidenceSha256'); assertCanonicalTimestamp(value.resolvedAt, 'target rejection resolvedAt');
  if (!Number.isSafeInteger(value.rejectionHelperSequence) || value.rejectionHelperSequence < 0 ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(value.rejectionState) || !/^TARGET_[A-Z0-9_]+$/.test(value.rejectionCode)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target rejected-request evidence is invalid.');
  }
  return value;
}

function validateTargetBinding(value: RecoveryTargetBinding): RecoveryTargetBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'targetSetId', 'generation', 'hostInstallationId', 'topologyMode', 'targetSpecificationSha256',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target binding has missing or unknown fields.');
  recoveryDigest(value.targetSetId, 'targetSetId'); recoveryUuid(value.hostInstallationId, 'hostInstallationId');
  recoveryDigest(value.targetSpecificationSha256, 'targetSpecificationSha256');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1 || !['SINGLE_HOST', 'SPLIT_HOST'].includes(value.topologyMode)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target binding is invalid.');
  }
  return value;
}

function validateTargetDisposition(value: RecoveryTargetDispositionReceipt): RecoveryTargetDispositionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'action', 'decisionSha256', 'receiptSha256', 'helperSequence', 'finalState', 'reconciliationEvidenceSha256', 'confirmedAt',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target disposition has missing or unknown fields.');
  recoveryDigest(value.decisionSha256, 'decisionSha256'); recoveryDigest(value.receiptSha256, 'receiptSha256');
  recoveryDigest(value.reconciliationEvidenceSha256, 'reconciliationEvidenceSha256'); assertCanonicalTimestamp(value.confirmedAt, 'confirmedAt');
  if (!Number.isSafeInteger(value.helperSequence) || value.helperSequence < 0 ||
      (value.action === 'STOP_RETAIN' ? value.finalState !== 'STOPPED_RETAINED' : value.action !== 'RETIRE' || value.finalState !== 'RETIRED')) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Target disposition is inconsistent.');
  }
  return value;
}

function validateHoldDisposition(value: RecoveryHoldDisposition): RecoveryHoldDisposition {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'action', 'closedAs', 'confirmedAt', 'decisionId', 'failureCode', 'observedEvidenceSha256', 'observedStatus',
        'priorDecisionSha256', 'reviewEvidenceSha256', 'reviewSha256', 'reviewedAt', 'status',
      ].sort())) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery hold disposition has missing or unknown fields.');
  if (recoveryUuid(value.decisionId, 'decisionId') !== value.decisionId) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery disposition decisionId must be canonical lowercase.');
  }
  recoveryDigest(value.reviewSha256, 'reviewSha256');
  recoveryDigest(value.reviewEvidenceSha256, 'reviewEvidenceSha256');
  assertCanonicalTimestamp(value.reviewedAt, 'reviewedAt');
  if (!['RELEASE', 'MARK_UNCERTAIN'].includes(value.action) ||
      !['ABORTED_PRE_IMPORT', 'ABANDONED'].includes(value.closedAs) ||
      (value.action === 'RELEASE') !== (value.closedAs === 'ABORTED_PRE_IMPORT') ||
      !['PENDING', 'CONFIRMED'].includes(value.status) ||
      (value.observedStatus !== null && !['ABSENT', 'ACTIVE', 'UNCERTAIN', 'RELEASED'].includes(value.observedStatus)) ||
      (value.failureCode !== null && !/^RECOVERY_[A-Z0-9_]+$/.test(value.failureCode))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery hold disposition is inconsistent.');
  }
  if (value.observedEvidenceSha256 !== null) recoveryDigest(value.observedEvidenceSha256, 'observedEvidenceSha256');
  if (value.priorDecisionSha256 !== null) recoveryDigest(value.priorDecisionSha256, 'priorDecisionSha256');
  if (value.confirmedAt !== null) assertCanonicalTimestamp(value.confirmedAt, 'confirmedAt');
  if ((value.observedStatus === null) !== (value.observedEvidenceSha256 === null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Observed hold truth and evidence must be recorded together.');
  }
  if (value.status === 'CONFIRMED' && (value.confirmedAt === null || value.observedEvidenceSha256 === null || value.failureCode !== null ||
      (value.action === 'RELEASE' ? value.observedStatus !== 'RELEASED' : value.observedStatus !== 'UNCERTAIN'))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Confirmed hold disposition lacks terminal evidence.');
  }
  if (value.status === 'PENDING' && value.confirmedAt !== null) throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Pending hold disposition cannot be confirmed.');
  return value;
}

function validateV2State(value: RecoveryJournalStateV2): RecoveryJournalStateV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'createdAt', 'failureDisposition', 'fenceToken', 'format', 'lastFailureCode', 'operationId', 'ownerId', 'pendingPhase',
        'phase', 'planId', 'planSha256', 'sequence', 'siteId', 'sourceDescriptorSha256', 'updatedAt',
      ].sort()) || value.format !== RECOVERY_JOURNAL_FORMAT_V2) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v2 state has missing or unknown fields.');
  }
  if (!LEGACY_RECOVERY_PHASES.includes(value.phase as typeof LEGACY_RECOVERY_PHASES[number]) ||
      (value.pendingPhase !== null && !LEGACY_RECOVERY_PHASES.includes(value.pendingPhase as typeof LEGACY_RECOVERY_PHASES[number]))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v2 phase is unsupported.');
  }
  const normalized = validateState({ ...value, format: RECOVERY_JOURNAL_FORMAT, lastReconciliationEvidenceSha256: null, holdDisposition: null,
    targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
    targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
    targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  return { ...normalized, format: RECOVERY_JOURNAL_FORMAT_V2 } as RecoveryJournalStateV2;
}

function validateV3State(value: RecoveryJournalStateV3): RecoveryJournalStateV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'createdAt', 'failureDisposition', 'fenceToken', 'format', 'lastFailureCode', 'lastReconciliationEvidenceSha256', 'operationId', 'ownerId', 'pendingPhase',
        'phase', 'planId', 'planSha256', 'sequence', 'siteId', 'sourceDescriptorSha256', 'updatedAt',
      ].sort()) || value.format !== RECOVERY_JOURNAL_FORMAT_V3) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v3 state has missing or unknown fields.');
  }
  if (!LEGACY_RECOVERY_PHASES.includes(value.phase as typeof LEGACY_RECOVERY_PHASES[number]) ||
      (value.pendingPhase !== null && !LEGACY_RECOVERY_PHASES.includes(value.pendingPhase as typeof LEGACY_RECOVERY_PHASES[number]))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v3 phase is unsupported.');
  }
  const normalized = validateState({ ...value, format: RECOVERY_JOURNAL_FORMAT, holdDisposition: null,
    targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
    targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
    targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  return { ...normalized, format: RECOVERY_JOURNAL_FORMAT_V3 } as RecoveryJournalStateV3;
}

function validateV4State(value: RecoveryJournalStateV4): RecoveryJournalStateV4 {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'createdAt', 'failureDisposition', 'fenceToken', 'format', 'lastFailureCode', 'lastReconciliationEvidenceSha256', 'operationId', 'ownerId', 'pendingPhase',
        'phase', 'planId', 'planSha256', 'sequence', 'siteId', 'sourceDescriptorSha256', 'updatedAt', 'holdDisposition',
      ].sort()) || value.format !== RECOVERY_JOURNAL_FORMAT_V4) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v4 state has missing or unknown fields.');
  }
  if (!LEGACY_RECOVERY_PHASES.includes(value.phase as typeof LEGACY_RECOVERY_PHASES[number]) ||
      (value.pendingPhase !== null && !LEGACY_RECOVERY_PHASES.includes(value.pendingPhase as typeof LEGACY_RECOVERY_PHASES[number]))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v4 phase is unsupported.');
  }
  const normalized = validateState({ ...value, format: RECOVERY_JOURNAL_FORMAT,
    targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
    targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
    targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  return { ...normalized, format: RECOVERY_JOURNAL_FORMAT_V4 } as RecoveryJournalStateV4;
}

function validateLegacyState(value: RecoveryJournalStateV1): RecoveryJournalStateV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
        'createdAt', 'fenceToken', 'format', 'lastFailureCode', 'operationId', 'ownerId', 'pendingPhase',
        'phase', 'planId', 'planSha256', 'sequence', 'siteId', 'sourceDescriptorSha256', 'updatedAt',
      ].sort()) || value.format !== RECOVERY_JOURNAL_FORMAT_V1) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v1 state has missing or unknown fields.');
  }
  recoveryUuid(value.operationId, 'operationId'); recoveryUuid(value.planId, 'planId');
  recoveryUuid(value.ownerId, 'ownerId'); recoveryUuid(value.fenceToken, 'fenceToken');
  recoverySiteId(value.siteId); recoveryDigest(value.planSha256, 'planSha256');
  recoveryDigest(value.sourceDescriptorSha256, 'sourceDescriptorSha256');
  assertCanonicalTimestamp(value.createdAt, 'createdAt'); assertCanonicalTimestamp(value.updatedAt, 'updatedAt');
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || !LEGACY_RECOVERY_PHASES.includes(value.phase as typeof LEGACY_RECOVERY_PHASES[number]) ||
      (value.pendingPhase !== null && !LEGACY_RECOVERY_PHASES.includes(value.pendingPhase as typeof LEGACY_RECOVERY_PHASES[number])) ||
      (value.lastFailureCode !== null && !/^RECOVERY_[A-Z0-9_]+$/.test(value.lastFailureCode)) ||
      (value.lastFailureCode !== null && value.pendingPhase !== null)) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal v1 state is invalid or has an ambiguous combination unsupported by v1.');
  }
  assertNoSecrets(value);
  return value;
}

async function readRegularFile(path: string, device: bigint, afterRead?: () => Promise<void>): Promise<Buffer> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== device || before.nlink !== 1n || Number(before.mode & 0o777n) !== 0o600 ||
        before.size < 1n || before.size > BigInt(MAX_JOURNAL_BYTES)) {
      throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Recovery journal file is not a protected single-link regular file.');
    }
    const expectedSize = Number(before.size); const chunks: Buffer[] = []; let offset = 0;
    while (offset <= expectedSize) {
      const chunk = Buffer.allocUnsafe(Math.min(16 * 1024, expectedSize + 1 - offset));
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > expectedSize) break;
    }
    await afterRead?.();
    const [after, pathAfter] = await Promise.all([handle.stat({ bigint: true }), fs.lstat(path, { bigint: true })]);
    if (offset !== expectedSize || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.nlink !== before.nlink || after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs ||
        pathAfter.isSymbolicLink() || pathAfter.dev !== before.dev || pathAfter.ino !== before.ino || pathAfter.nlink !== 1n) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal changed while it was read.');
    }
    return Buffer.concat(chunks, expectedSize);
  } finally { await handle.close(); }
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function atomicWrite(path: string, bytes: Uint8Array, device: bigint, fault?: () => Promise<void>): Promise<void> {
  const directory = resolve(path, '..');
  const temp = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.dev !== device || stat.nlink !== 1n) throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Recovery journal temporary file is unsafe.');
    await handle.writeFile(bytes); await handle.sync();
  } catch (error) {
    await handle.close(); await fs.unlink(temp).catch(() => undefined); throw error;
  }
  await handle.close();
  try { await fault?.(); await fs.rename(temp, path); await fsyncDirectory(directory); }
  catch (error) { await fs.unlink(temp).catch(() => undefined); throw error; }
}

function encode(state: RecoveryJournalState): Buffer {
  const validated = validateState(state);
  const stateBytes = canonicalRecoveryBytes(validated);
  return canonicalRecoveryBytes({ state: validated, stateSha256: sha256RecoveryBytes(stateBytes) } satisfies RecoveryJournalEnvelope);
}

function decode(bytes: Uint8Array): RecoveryJournalState {
  let value: unknown;
  try { value = parseStrictJson(bytes, MAX_JOURNAL_BYTES); }
  catch (cause) { throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal is truncated or malformed.', { cause }); }
  if (!canonicalRecoveryBytes(value).equals(Buffer.from(bytes))) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal must be canonical strict JSON with one trailing newline.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['state', 'stateSha256'].sort())) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal envelope is invalid.');
  }
  const envelope = value as { state: unknown; stateSha256: string };
  recoveryDigest(envelope.stateSha256, 'stateSha256');
  if (sha256RecoveryBytes(canonicalRecoveryBytes(envelope.state)) !== envelope.stateSha256) {
    throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal checksum does not match its state.');
  }
  const format = envelope.state && typeof envelope.state === 'object' && !Array.isArray(envelope.state)
    ? (envelope.state as { format?: unknown }).format : undefined;
  if (format === RECOVERY_JOURNAL_FORMAT) return validateState(envelope.state as RecoveryJournalState);
  if (format === RECOVERY_JOURNAL_FORMAT_V4) {
    const legacy = validateV4State(envelope.state as RecoveryJournalStateV4);
    return validateState({ ...legacy, format: RECOVERY_JOURNAL_FORMAT,
      targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
      targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
      targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  }
  if (format === RECOVERY_JOURNAL_FORMAT_V3) {
    const legacy = validateV3State(envelope.state as RecoveryJournalStateV3);
    return validateState({ ...legacy, format: RECOVERY_JOURNAL_FORMAT, holdDisposition: null,
      targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
      targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
      targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  }
  if (format === RECOVERY_JOURNAL_FORMAT_V2) {
    const legacy = validateV2State(envelope.state as RecoveryJournalStateV2);
    return validateState({ ...legacy, format: RECOVERY_JOURNAL_FORMAT, lastReconciliationEvidenceSha256: null, holdDisposition: null,
      targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
      targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
      targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  }
  if (format === RECOVERY_JOURNAL_FORMAT_V1) {
    const legacy = validateLegacyState(envelope.state as RecoveryJournalStateV1);
    return validateState({ ...legacy, format: RECOVERY_JOURNAL_FORMAT,
      failureDisposition: legacy.lastFailureCode === null ? null : 'DEFINITE_PRE_EFFECT', lastReconciliationEvidenceSha256: null, holdDisposition: null,
      targetBinding: null, targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
      targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
      targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false });
  }
  throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal format is unsupported.');
}

export class RecoveryJournal {
  private readonly root: string;
  private readonly now: () => Date;
  private readonly identity: RecoveryProcessIdentity;
  private readonly fault?: (stage: RecoveryJournalFaultStage) => Promise<void>;

  constructor(input: { root: string; now?: () => Date; identity?: RecoveryProcessIdentity;
    fault?: (stage: RecoveryJournalFaultStage) => Promise<void> }) {
    this.root = safeRoot(input.root);
    this.now = input.now ?? (() => new Date());
    this.identity = input.identity ?? { instanceId: randomUUID(), pid: process.pid };
    this.fault = input.fault;
    recoveryUuid(this.identity.instanceId, 'process instanceId');
    if (!Number.isSafeInteger(this.identity.pid) || this.identity.pid < 1) throw new RecoveryError('RECOVERY_ID_INVALID', 'Process pid is invalid.');
  }

  private operationDirectory(operationId: string): string {
    return contained(this.root, OPERATIONS_DIRECTORY, recoveryUuid(operationId, 'operationId'));
  }

  private async rootDevice(): Promise<bigint> { return assertDirectory(this.root); }

  private async acquireLock(path: string, device: bigint): Promise<() => Promise<void>> {
    const bytes = canonicalRecoveryBytes({ instanceId: this.identity.instanceId, pid: this.identity.pid });
    let handle;
    try { handle = await fs.open(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new RecoveryError('RECOVERY_LOCK_HELD', `Recovery lock is already held: ${basename(path)}`, { cause });
      throw cause;
    }
    let created: Awaited<ReturnType<typeof handle.stat>>;
    try {
      await this.fault?.('after-lock-create-before-fstat');
      created = await handle.stat({ bigint: true });
    } catch (error) {
      await handle.close().catch(() => undefined);
      // Without a proven inode identity the pathname is deliberately retained
      // fail-closed for operator recovery; unlinking it could remove a swap.
      throw error;
    }
    try {
      if (!created.isFile() || created.dev !== device || created.nlink !== 1n) throw new RecoveryError('RECOVERY_JOURNAL_UNSAFE', 'Recovery lock is unsafe.');
      await handle.writeFile(bytes); await this.fault?.('after-lock-write-before-sync'); await handle.sync();
      await this.fault?.('after-lock-sync-before-parent-fsync'); await fsyncDirectory(resolve(path, '..'));
    } catch (error) {
      await handle.close().catch(() => undefined);
      const current = await fs.lstat(path, { bigint: true }).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === 'ENOENT') return undefined; throw cause;
      });
      if (current?.isFile() && !current.isSymbolicLink() && current.dev === created.dev && current.ino === created.ino && current.nlink === 1n) {
        await fs.unlink(path); await fsyncDirectory(resolve(path, '..'));
      }
      throw error;
    }
    await handle.close();
    return async () => {
      const current = await readRegularFile(path, device);
      if (!current.equals(bytes)) throw new RecoveryError('RECOVERY_LOCK_STALE_FENCE', 'Recovery lock ownership changed before release.');
      await fs.unlink(path); await fsyncDirectory(resolve(path, '..'));
    };
  }

  private async withLocks<T>(operationId: string, callback: (directory: string, device: bigint) => Promise<T>): Promise<T> {
    const device = await this.rootDevice();
    const releaseSite = await this.acquireLock(contained(this.root, SITE_LOCK), device);
    let releaseOperation: (() => Promise<void>) | undefined;
    try {
      const operations = contained(this.root, OPERATIONS_DIRECTORY);
      await assertDirectory(operations, device);
      const directory = this.operationDirectory(operationId); await assertDirectory(directory, device);
      releaseOperation = await this.acquireLock(join(directory, OPERATION_LOCK), device);
      return await callback(directory, device);
    } finally {
      try { if (releaseOperation) await releaseOperation(); }
      finally { await releaseSite(); }
    }
  }

  async create(input: {
    operationId: string; siteId: string; planId: string; planSha256: string;
    sourceDescriptorSha256: string; ownerId: string; fenceToken: string;
    targetBinding?: RecoveryTargetBinding;
  }): Promise<RecoveryJournalState> {
    const device = await this.rootDevice();
    const releaseSite = await this.acquireLock(contained(this.root, SITE_LOCK), device);
    try {
      const operations = contained(this.root, OPERATIONS_DIRECTORY);
      try { await fs.mkdir(operations, { mode: 0o700 }); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
      await assertDirectory(operations, device);
      const directory = this.operationDirectory(input.operationId);
      try { await fs.mkdir(directory, { mode: 0o700 }); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new RecoveryError('RECOVERY_JOURNAL_EXISTS', 'Recovery operation already exists.', { cause });
        throw cause;
      }
      const directoryStat = await fs.lstat(directory, { bigint: true });
      const createdDirectory = { dev: directoryStat.dev, ino: directoryStat.ino };
      try {
        await fsyncDirectory(operations);
        const timestamp = this.now().toISOString();
        const state: RecoveryJournalState = {
        format: RECOVERY_JOURNAL_FORMAT, operationId: recoveryUuid(input.operationId, 'operationId'),
        siteId: recoverySiteId(input.siteId), planId: recoveryUuid(input.planId, 'planId'),
        planSha256: recoveryDigest(input.planSha256, 'planSha256'),
        sourceDescriptorSha256: recoveryDigest(input.sourceDescriptorSha256, 'sourceDescriptorSha256'),
        ownerId: recoveryUuid(input.ownerId, 'ownerId'), fenceToken: recoveryUuid(input.fenceToken, 'fenceToken'),
        sequence: 0, phase: 'PLANNED', pendingPhase: null, lastFailureCode: null, failureDisposition: null,
        lastReconciliationEvidenceSha256: null,
        holdDisposition: null,
        targetBinding: input.targetBinding === undefined ? null : validateTargetBinding(input.targetBinding),
        targetReceiptSha256: null, targetHelperSequence: null, targetReconciliationEvidenceSha256: null,
        targetDisposition: null, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
        targetDispositionIntent: null, targetRejectedRequests: [], importStarted: false,
        createdAt: timestamp, updatedAt: timestamp,
        };
        await atomicWrite(join(directory, JOURNAL_FILE), encode(state), device,
          this.fault ? () => this.fault!('after-temp-fsync-before-rename') : undefined);
        return state;
      } catch (error) {
        const current = await fs.lstat(directory, { bigint: true }).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === 'ENOENT') return undefined; throw cause;
        });
        if (current?.isDirectory() && !current.isSymbolicLink() && current.dev === createdDirectory.dev &&
            current.ino === createdDirectory.ino && (await fs.readdir(directory)).length === 0) {
          await fs.rmdir(directory); await fsyncDirectory(operations);
        }
        throw error;
      }
    } finally { await releaseSite(); }
  }

  async read(operationId: string): Promise<RecoveryJournalState> {
    const device = await this.rootDevice(); const directory = this.operationDirectory(operationId);
    await assertDirectory(contained(this.root, OPERATIONS_DIRECTORY), device); await assertDirectory(directory, device);
    const state = decode(await readRegularFile(join(directory, JOURNAL_FILE), device,
      this.fault ? () => this.fault!('after-journal-read-before-stat') : undefined));
    if (state.operationId !== recoveryUuid(operationId, 'operationId')) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal operation identity does not match its directory.');
    }
    return state;
  }

  private assertGuard(state: RecoveryJournalState, guard: RecoveryJournalGuard): void {
    if (state.sequence !== guard.expectedSequence || state.ownerId !== recoveryUuid(guard.expectedOwnerId, 'expectedOwnerId') ||
        state.fenceToken !== recoveryUuid(guard.expectedFenceToken, 'expectedFenceToken') ||
        state.siteId !== recoverySiteId(guard.expectedSiteId) || state.planId !== recoveryUuid(guard.expectedPlanId, 'expectedPlanId') ||
        state.planSha256 !== recoveryDigest(guard.expectedPlanSha256, 'expectedPlanSha256')) {
      throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'Recovery journal sequence, owner, fence, site, plan, or plan digest is stale.');
    }
  }

  private async readLocked(operationId: string, directory: string, device: bigint): Promise<RecoveryJournalState> {
    const state = decode(await readRegularFile(join(directory, JOURNAL_FILE), device,
      this.fault ? () => this.fault!('after-journal-read-before-stat') : undefined));
    if (state.operationId !== recoveryUuid(operationId, 'operationId')) {
      throw new RecoveryError('RECOVERY_JOURNAL_CORRUPT', 'Recovery journal operation identity does not match its directory.');
    }
    return state;
  }

  private async mutateLocked(input: {
    operationId: string; directory: string; device: bigint; guard: RecoveryJournalGuard;
    mutation: (state: Readonly<RecoveryJournalState>) => RecoveryJournalState;
  }): Promise<RecoveryJournalState> {
    const state = await this.readLocked(input.operationId, input.directory, input.device); this.assertGuard(state, input.guard);
    const candidate = input.mutation(state);
    const immutable = ['operationId', 'siteId', 'planId', 'planSha256', 'sourceDescriptorSha256', 'ownerId', 'fenceToken', 'createdAt', 'targetBinding', 'importStarted'] as const;
    if (immutable.some((field) => candidate[field] !== state[field]) || candidate.format !== RECOVERY_JOURNAL_FORMAT) {
      throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'Scoped recovery mutation cannot change its bound identity.');
    }
    const next = { ...candidate, sequence: state.sequence + 1, updatedAt: this.now().toISOString() };
    await atomicWrite(join(input.directory, JOURNAL_FILE), encode(next), input.device,
      this.fault ? () => this.fault!('after-temp-fsync-before-rename') : undefined);
    return next;
  }

  async withOperation<T>(operationId: string, guard: RecoveryJournalGuard,
    callback: (operation: ScopedRecoveryOperation) => Promise<T>): Promise<T> {
    return this.withLocks(operationId, async (directory, device) => {
      let lifecycle: 'OPEN' | 'CLOSING' | 'CLOSED' = 'OPEN';
      let currentGuard = { ...guard };
      let tail: Promise<void> = Promise.resolve();
      let firstTaskFailure: unknown; let hasTaskFailure = false;
      const schedule = <R>(task: () => Promise<R>): Promise<R> => {
        if (lifecycle !== 'OPEN') return Promise.reject(new RecoveryError('RECOVERY_STATE_INVALID', 'Scoped recovery operation is closing or closed.'));
        const accepted = tail.then(task);
        tail = accepted.then(() => undefined, (error: unknown) => {
          if (!hasTaskFailure) { hasTaskFailure = true; firstTaskFailure = error; }
        });
        return accepted;
      };
      const updateGuard = (state: RecoveryJournalState): RecoveryJournalState => {
        currentGuard = { ...currentGuard, expectedSequence: state.sequence }; return state;
      };
      const mutateState = async (mutation: (state: Readonly<RecoveryJournalState>) => RecoveryJournalState): Promise<RecoveryJournalState> => {
        return updateGuard(await this.mutateLocked({ operationId, directory, device, guard: currentGuard, mutation }));
      };
      const mutate = (mutation: ScopedRecoveryMutation): Promise<RecoveryJournalState> => schedule(async () => {
        if (mutation.kind === 'RECORD_HOLD_DISPOSITION') {
          const disposition = validateHoldDisposition(mutation.disposition);
          return mutateState((state) => {
            if (state.importStarted) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Import-started recovery cannot use pre-import disposition.');
            if (disposition.action === 'RELEASE' && state.targetBinding !== null &&
                state.targetEffectStatus !== 'NONE_PROVEN' &&
                !(state.targetEffectStatus === 'DISPOSED_PROVEN' && state.targetDisposition !== null)) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Any possible target effect requires a confirmed STOPPED_RETAINED or RETIRED disposition before source release.');
            }
            if (disposition.status !== 'PENDING' || disposition.confirmedAt !== null) {
              throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Disposition intent must begin pending.');
            }
            if (state.holdDisposition === null) {
              if (disposition.priorDecisionSha256 !== null) throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Initial disposition cannot cite a prior decision.');
              return { ...state, holdDisposition: disposition };
            }
            const priorSha256 = sha256RecoveryBytes(canonicalRecoveryBytes(state.holdDisposition));
            if (state.holdDisposition.status === 'CONFIRMED' && state.holdDisposition.action === 'MARK_UNCERTAIN' &&
                disposition.action === 'RELEASE' && disposition.priorDecisionSha256 === priorSha256) {
              return { ...state, holdDisposition: disposition };
            }
            throw new RecoveryError('RECOVERY_OPERATION_CLOSED', 'Recovery operation already has an irreversible disposition decision.');
          });
        }
        if (mutation.kind === 'RECORD_TARGET_PREPARATION_INTENT') {
          const request = validateTargetPreparationRequest(mutation.request);
          if (request.status !== 'INTENT_RECORDED') throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation intent must begin before dispatch.');
          return mutateState((state) => {
            if (state.holdDisposition !== null || state.importStarted || state.targetBinding === null ||
                state.phase !== 'SOURCE_VERIFIED' || state.pendingPhase !== null || state.targetEffectStatus !== 'NONE_PROVEN' ||
                state.targetPreparationRequest !== null) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation intent is not the next permitted transition.');
            }
            return { ...state, pendingPhase: 'TARGETS_PREPARED', targetPreparationRequest: request,
              targetEffectStatus: 'PREPARE_INTENT', lastFailureCode: null, failureDisposition: null };
          });
        }
        if (mutation.kind === 'MARK_TARGET_PREPARATION_DISPATCHED') {
          recoveryUuid(mutation.requestId, 'target requestId'); recoveryDigest(mutation.requestSha256, 'target requestSha256');
          return mutateState((state) => {
            const request = state.targetPreparationRequest;
            if (state.targetEffectStatus !== 'PREPARE_INTENT' || request?.status !== 'INTENT_RECORDED' ||
                request.requestId !== mutation.requestId || request.requestSha256 !== mutation.requestSha256) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation dispatch does not match its durable intent.');
            }
            return { ...state, targetEffectStatus: 'PREPARE_DISPATCH_UNKNOWN',
              targetPreparationRequest: { ...request, status: 'DISPATCH_UNKNOWN' } };
          });
        }
        if (mutation.kind === 'RECORD_TARGET_PREPARATION_REJECTION') {
          recoveryUuid(mutation.requestId, 'target requestId'); recoveryDigest(mutation.requestSha256, 'target requestSha256');
          recoveryDigest(mutation.receiptSha256, 'target rejection receiptSha256');
          const existing = await this.readLocked(operationId, directory, device); this.assertGuard(existing, currentGuard);
          if (existing.targetEffectStatus === 'PREPARE_REJECTED_DEFINITE' && existing.targetPreparationRequest?.status === 'REJECTED_DEFINITE') {
            const request = existing.targetPreparationRequest;
            if (request.requestId === mutation.requestId && request.requestSha256 === mutation.requestSha256 &&
                request.rejectionReceiptSha256 === mutation.receiptSha256 && request.rejectionHelperSequence === mutation.helperSequence &&
                request.rejectionState === mutation.state && request.rejectionCode === mutation.code) return existing;
            throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'A different target preparation rejection cannot replace retained evidence.');
          }
          return mutateState((state) => {
            const request = state.targetPreparationRequest;
            if (state.targetEffectStatus !== 'PREPARE_DISPATCH_UNKNOWN' || request?.status !== 'DISPATCH_UNKNOWN' ||
                request.requestId !== mutation.requestId || request.requestSha256 !== mutation.requestSha256 ||
                !Number.isSafeInteger(mutation.helperSequence) || mutation.helperSequence < 0 ||
                !/^[A-Z][A-Z0-9_]{1,63}$/.test(mutation.state) || !/^TARGET_[A-Z0-9_]+$/.test(mutation.code)) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Definite target preparation rejection does not match its dispatched request.');
            }
            return { ...state, targetEffectStatus: 'PREPARE_REJECTED_DEFINITE',
              targetPreparationRequest: { ...request, status: 'REJECTED_DEFINITE',
                rejectionReceiptSha256: mutation.receiptSha256, rejectionHelperSequence: mutation.helperSequence,
                rejectionState: mutation.state, rejectionCode: mutation.code },
              pendingPhase: null, lastFailureCode: 'RECOVERY_TARGET_NOT_READY', failureDisposition: 'DEFINITE_PRE_EFFECT' };
          });
        }
        if (mutation.kind === 'RESOLVE_TARGET_PREPARATION_REJECTION') {
          recoveryDigest(mutation.inspectionReceiptSha256, 'target no-effect inspection receiptSha256');
          recoveryDigest(mutation.evidenceSha256, 'target no-effect evidenceSha256'); assertCanonicalTimestamp(mutation.resolvedAt, 'resolvedAt');
          return mutateState((state) => {
            const request = state.targetPreparationRequest;
            if (state.targetEffectStatus !== 'PREPARE_REJECTED_DEFINITE' || request?.status !== 'REJECTED_DEFINITE' ||
                mutation.inspectedState !== 'ABSENT' || mutation.helperSequence !== request.rejectionHelperSequence) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target preparation rejection lacks exact same-sequence no-effect proof.');
            }
            const rejected: RecoveryTargetRejectedRequestEvidence = { action: 'PREPARE', requestId: request.requestId,
              requestSha256: request.requestSha256, authorizationSha256: request.authorizationSha256, decisionId: null,
              rejectionReceiptSha256: request.rejectionReceiptSha256!, rejectionHelperSequence: request.rejectionHelperSequence!,
              rejectionState: request.rejectionState!, rejectionCode: request.rejectionCode!,
              noEffectInspectionReceiptSha256: mutation.inspectionReceiptSha256, noEffectEvidenceSha256: mutation.evidenceSha256,
              resolvedAt: mutation.resolvedAt };
            validateTargetRejectedRequest(rejected);
            return { ...state, targetEffectStatus: 'NONE_PROVEN', targetPreparationRequest: null,
              targetRejectedRequests: [...state.targetRejectedRequests, rejected].slice(-128) };
          });
        }
        if (mutation.kind === 'COMPLETE_TARGETS_PREPARED') {
          const receiptSha256 = recoveryDigest(mutation.receiptSha256, 'targetReceiptSha256');
          const reconciliationEvidenceSha256 = recoveryDigest(mutation.reconciliationEvidenceSha256, 'targetReconciliationEvidenceSha256');
          if (!Number.isSafeInteger(mutation.helperSequence) || mutation.helperSequence < 0) {
            throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target helper sequence is invalid.');
          }
          return mutateState((state) => {
            if (state.holdDisposition !== null || state.importStarted || state.targetBinding === null ||
                state.phase !== 'SOURCE_VERIFIED' || state.pendingPhase !== 'TARGETS_PREPARED' ||
                state.targetEffectStatus !== 'PREPARE_DISPATCH_UNKNOWN' || state.targetPreparationRequest?.status !== 'DISPATCH_UNKNOWN') {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target readiness receipt has no matching source-verified target intent.');
            }
            return { ...state, phase: 'TARGETS_PREPARED', pendingPhase: null, lastFailureCode: null, failureDisposition: null,
              targetReceiptSha256: receiptSha256, targetHelperSequence: mutation.helperSequence,
              targetReconciliationEvidenceSha256: reconciliationEvidenceSha256, targetEffectStatus: 'READY_PROVEN',
              targetPreparationRequest: { ...state.targetPreparationRequest, status: 'COMPLETED' } };
          });
        }
        if (mutation.kind === 'RECORD_TARGET_DISPOSITION_INTENT') {
          const intent = validateTargetDispositionIntent(mutation.intent);
          if (intent.status !== 'INTENT_RECORDED') throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target disposition intent must begin before dispatch.');
          return mutateState((state) => {
            if (state.importStarted || state.phase !== 'TARGETS_PREPARED' || state.targetEffectStatus !== 'READY_PROVEN' ||
                state.targetDisposition !== null || state.targetDispositionIntent !== null ||
                state.targetRejectedRequests.some((rejected) => rejected.decisionId === intent.decisionId) ||
                intent.expectedHelperSequence !== state.targetHelperSequence ||
                intent.preparedReceiptSha256 !== state.targetReceiptSha256 || intent.expectedTargetState !== 'READY') {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target disposition intent does not match the exact prepared target.');
            }
            return { ...state, targetDispositionIntent: intent, targetEffectStatus: 'DISPOSITION_INTENT' };
          });
        }
        if (mutation.kind === 'MARK_TARGET_DISPOSITION_DISPATCHED') {
          recoveryUuid(mutation.requestId, 'target disposition requestId'); recoveryDigest(mutation.requestSha256, 'target disposition requestSha256');
          return mutateState((state) => {
            const intent = state.targetDispositionIntent;
            if (state.targetEffectStatus !== 'DISPOSITION_INTENT' || intent?.status !== 'INTENT_RECORDED' ||
                intent.requestId !== mutation.requestId || intent.requestSha256 !== mutation.requestSha256) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target disposition dispatch does not match its durable intent.');
            }
            return { ...state, targetEffectStatus: 'DISPOSITION_DISPATCH_UNKNOWN',
              targetDispositionIntent: { ...intent, status: 'DISPATCH_UNKNOWN' } };
          });
        }
        if (mutation.kind === 'RECORD_TARGET_DISPOSITION_REJECTION') {
          recoveryUuid(mutation.requestId, 'target disposition requestId'); recoveryDigest(mutation.requestSha256, 'target disposition requestSha256');
          recoveryDigest(mutation.receiptSha256, 'target disposition rejection receiptSha256');
          const existing = await this.readLocked(operationId, directory, device); this.assertGuard(existing, currentGuard);
          if (existing.targetEffectStatus === 'DISPOSITION_REJECTED_DEFINITE' && existing.targetDispositionIntent?.status === 'REJECTED_DEFINITE') {
            const intent = existing.targetDispositionIntent;
            if (intent.requestId === mutation.requestId && intent.requestSha256 === mutation.requestSha256 &&
                intent.rejectionReceiptSha256 === mutation.receiptSha256 && intent.rejectionHelperSequence === mutation.helperSequence &&
                intent.rejectionState === mutation.state && intent.rejectionCode === mutation.code) return existing;
            throw new RecoveryError('RECOVERY_JOURNAL_CONFLICT', 'A different target disposition rejection cannot replace retained evidence.');
          }
          return mutateState((state) => {
            const intent = state.targetDispositionIntent;
            if (state.targetEffectStatus !== 'DISPOSITION_DISPATCH_UNKNOWN' || intent?.status !== 'DISPATCH_UNKNOWN' ||
                intent.requestId !== mutation.requestId || intent.requestSha256 !== mutation.requestSha256 ||
                !Number.isSafeInteger(mutation.helperSequence) || mutation.helperSequence < 0 ||
                !/^[A-Z][A-Z0-9_]{1,63}$/.test(mutation.state) || !/^TARGET_[A-Z0-9_]+$/.test(mutation.code)) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Definite target disposition rejection does not match its dispatched request.');
            }
            return { ...state, targetEffectStatus: 'DISPOSITION_REJECTED_DEFINITE',
              targetDispositionIntent: { ...intent, status: 'REJECTED_DEFINITE',
                rejectionReceiptSha256: mutation.receiptSha256, rejectionHelperSequence: mutation.helperSequence,
                rejectionState: mutation.state, rejectionCode: mutation.code } };
          });
        }
        if (mutation.kind === 'RESOLVE_TARGET_DISPOSITION_REJECTION') {
          recoveryDigest(mutation.inspectionReceiptSha256, 'target disposition no-effect inspection receiptSha256');
          recoveryDigest(mutation.evidenceSha256, 'target disposition no-effect evidenceSha256'); assertCanonicalTimestamp(mutation.resolvedAt, 'resolvedAt');
          return mutateState((state) => {
            const intent = state.targetDispositionIntent;
            if (state.targetEffectStatus !== 'DISPOSITION_REJECTED_DEFINITE' || intent?.status !== 'REJECTED_DEFINITE' ||
                mutation.inspectedState !== 'READY' || mutation.helperSequence !== intent.rejectionHelperSequence) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target disposition rejection lacks exact same-sequence READY proof.');
            }
            const rejected: RecoveryTargetRejectedRequestEvidence = { action: intent.action, requestId: intent.requestId,
              requestSha256: intent.requestSha256, authorizationSha256: intent.authorizationSha256,
              decisionId: intent.decisionId, rejectionReceiptSha256: intent.rejectionReceiptSha256!,
              rejectionHelperSequence: intent.rejectionHelperSequence!, rejectionState: intent.rejectionState!,
              rejectionCode: intent.rejectionCode!, noEffectInspectionReceiptSha256: mutation.inspectionReceiptSha256,
              noEffectEvidenceSha256: mutation.evidenceSha256, resolvedAt: mutation.resolvedAt };
            validateTargetRejectedRequest(rejected);
            return { ...state, targetEffectStatus: 'READY_PROVEN', targetDispositionIntent: null,
              targetHelperSequence: mutation.helperSequence,
              targetReconciliationEvidenceSha256: mutation.evidenceSha256,
              targetRejectedRequests: [...state.targetRejectedRequests, rejected].slice(-128) };
          });
        }
        if (mutation.kind === 'RECORD_TARGET_DISPOSITION') {
          const disposition = validateTargetDisposition(mutation.disposition);
          return mutateState((state) => {
            const intent = state.targetDispositionIntent;
            if (state.importStarted) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Import-started recovery rejects pre-import target disposition.');
            if (state.phase !== 'TARGETS_PREPARED' || state.targetBinding === null || state.targetDisposition !== null ||
                state.targetEffectStatus !== 'DISPOSITION_DISPATCH_UNKNOWN' || intent?.status !== 'DISPATCH_UNKNOWN' ||
                intent.action !== disposition.action || intent.decisionSha256 !== disposition.decisionSha256 ||
                intent.expectedFinalState !== disposition.finalState ||
                disposition.helperSequence < intent.expectedHelperSequence) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Target disposition does not follow the exact prepared target lifecycle.');
            }
            return { ...state, targetDisposition: disposition, targetEffectStatus: 'DISPOSED_PROVEN',
              targetDispositionIntent: { ...intent, status: 'COMPLETED' } };
          });
        }
        if (mutation.kind === 'UPDATE_HOLD_DISPOSITION') {
          recoveryUuid(mutation.decisionId, 'decisionId');
          if (mutation.observedEvidenceSha256 !== null) recoveryDigest(mutation.observedEvidenceSha256, 'observedEvidenceSha256');
          if (mutation.confirmedAt !== null) assertCanonicalTimestamp(mutation.confirmedAt, 'confirmedAt');
          return mutateState((state) => {
            const current = state.holdDisposition;
            if (!current || current.decisionId !== mutation.decisionId || current.status !== 'PENDING') {
              throw new RecoveryError('RECOVERY_REVIEW_CONFLICT', 'Disposition update does not match the pending reviewed decision.');
            }
            const updated: RecoveryHoldDisposition = { ...current,
              status: mutation.confirmedAt === null ? 'PENDING' : 'CONFIRMED',
              observedStatus: mutation.observedStatus, observedEvidenceSha256: mutation.observedEvidenceSha256,
              confirmedAt: mutation.confirmedAt, failureCode: mutation.failureCode };
            validateHoldDisposition(updated); return { ...state, holdDisposition: updated };
          });
        }
        const rejectClosed = (state: Readonly<RecoveryJournalState>): void => {
          if (state.holdDisposition !== null) throw new RecoveryError('RECOVERY_OPERATION_CLOSED', 'Recovery operation is irreversibly closed.');
        };
        if (mutation.kind === 'RECORD_PHASE_INTENT') return mutateState((state) => {
          rejectClosed(state);
          const expected = state.phase === 'PLANNED' ? 'SOURCE_HELD' : state.phase === 'SOURCE_HELD' ? 'SOURCE_VERIFIED' : null;
          if (state.pendingPhase !== null || mutation.target !== expected) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Recovery phase intent is not the next permitted transition.');
          return { ...state, pendingPhase: mutation.target, lastFailureCode: null, failureDisposition: null };
        });
        if (mutation.kind === 'COMPLETE_PHASE') return mutateState((state) => {
          rejectClosed(state);
          if (mutation.target === 'TARGETS_PREPARED') throw new RecoveryError('RECOVERY_STATE_INVALID', 'Targets require a matching READY receipt completion.');
          if (state.pendingPhase !== mutation.target) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Recovery phase completion has no matching durable intent.');
          if (state.failureDisposition === 'AMBIGUOUS_EXTERNAL_EFFECT') {
            throw new RecoveryError('RECOVERY_STATE_INVALID', 'Ambiguous external effect requires explicit evidence-bound reconciliation.');
          }
          return { ...state, phase: mutation.target, pendingPhase: null, lastFailureCode: null, failureDisposition: null };
        });
        if (mutation.kind === 'RESOLVE_AMBIGUOUS_PHASE') {
          const evidenceSha256 = recoveryDigest(mutation.evidenceSha256, 'reconciliation evidenceSha256');
          return mutateState((state) => {
            rejectClosed(state);
            if (state.pendingPhase !== mutation.target || state.failureDisposition !== 'AMBIGUOUS_EXTERNAL_EFFECT' || state.lastFailureCode === null) {
              throw new RecoveryError('RECOVERY_STATE_INVALID', 'Recovery ambiguity resolution has no matching pending ambiguous phase.');
            }
            return { ...state, phase: mutation.target, pendingPhase: null, lastFailureCode: null, failureDisposition: null,
              lastReconciliationEvidenceSha256: evidenceSha256 };
          });
        }
        if (!/^RECOVERY_[A-Z0-9_]+$/.test(mutation.failureCode)) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Failure code must be a stable RECOVERY_* code.');
        if (!['DEFINITE_PRE_EFFECT', 'AMBIGUOUS_EXTERNAL_EFFECT'].includes(mutation.disposition)) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Failure disposition is invalid.');
        return mutateState((state) => {
          rejectClosed(state);
          if (mutation.disposition === 'AMBIGUOUS_EXTERNAL_EFFECT' && state.pendingPhase === null) {
            throw new RecoveryError('RECOVERY_STATE_INVALID', 'Ambiguous external effect requires a durable pending phase intent.');
          }
          return { ...state, pendingPhase: mutation.disposition === 'DEFINITE_PRE_EFFECT' ? null : state.pendingPhase,
            lastFailureCode: mutation.failureCode, failureDisposition: mutation.disposition,
            lastReconciliationEvidenceSha256: mutation.disposition === 'AMBIGUOUS_EXTERNAL_EFFECT'
              ? null : state.lastReconciliationEvidenceSha256 };
        });
      });
      const scope: ScopedRecoveryOperation = {
        operationId: recoveryUuid(operationId, 'operationId'),
        read: () => schedule(async () => { const state = await this.readLocked(operationId, directory, device); this.assertGuard(state, currentGuard); return state; }),
        mutate,
        recordPhaseIntent: (target) => mutate({ kind: 'RECORD_PHASE_INTENT', target }),
        completePhase: (target) => mutate({ kind: 'COMPLETE_PHASE', target }),
        recordPhaseFailure: (failureCode, disposition) => mutate({ kind: 'RECORD_PHASE_FAILURE', failureCode, disposition }),
        resolveAmbiguousPhase: (target, evidenceSha256) => mutate({ kind: 'RESOLVE_AMBIGUOUS_PHASE', target, evidenceSha256 }),
        recordHoldDisposition: (disposition) => mutate({ kind: 'RECORD_HOLD_DISPOSITION', disposition }),
        updateHoldDisposition: (input) => mutate({ kind: 'UPDATE_HOLD_DISPOSITION', ...input }),
        completeTargetsPrepared: (input) => mutate({ kind: 'COMPLETE_TARGETS_PREPARED', ...input }),
        recordTargetPreparationIntent: (request) => mutate({ kind: 'RECORD_TARGET_PREPARATION_INTENT', request }),
        markTargetPreparationDispatched: (requestId, requestSha256) => mutate({ kind: 'MARK_TARGET_PREPARATION_DISPATCHED', requestId, requestSha256 }),
        recordTargetPreparationRejection: (input) => mutate({ kind: 'RECORD_TARGET_PREPARATION_REJECTION', ...input }),
        resolveTargetPreparationRejection: (input) => mutate({ kind: 'RESOLVE_TARGET_PREPARATION_REJECTION', ...input }),
        recordTargetDispositionIntent: (intent) => mutate({ kind: 'RECORD_TARGET_DISPOSITION_INTENT', intent }),
        markTargetDispositionDispatched: (requestId, requestSha256) => mutate({ kind: 'MARK_TARGET_DISPOSITION_DISPATCHED', requestId, requestSha256 }),
        recordTargetDispositionRejection: (input) => mutate({ kind: 'RECORD_TARGET_DISPOSITION_REJECTION', ...input }),
        resolveTargetDispositionRejection: (input) => mutate({ kind: 'RESOLVE_TARGET_DISPOSITION_REJECTION', ...input }),
        recordTargetDisposition: (disposition) => mutate({ kind: 'RECORD_TARGET_DISPOSITION', disposition }),
      };
      const initial = await this.readLocked(operationId, directory, device); this.assertGuard(initial, currentGuard);
      currentGuard = { expectedSequence: initial.sequence, expectedOwnerId: initial.ownerId, expectedFenceToken: initial.fenceToken,
        expectedSiteId: initial.siteId, expectedPlanId: initial.planId, expectedPlanSha256: initial.planSha256 };
      let callbackResult: T | undefined; let callbackFailure: unknown; let hasCallbackFailure = false;
      try { callbackResult = await callback(scope); }
      catch (error) { hasCallbackFailure = true; callbackFailure = error; }
      lifecycle = 'CLOSING';
      await tail;
      lifecycle = 'CLOSED';
      if (hasTaskFailure) throw firstTaskFailure;
      if (hasCallbackFailure) throw callbackFailure;
      return callbackResult as T;
    });
  }

  async recordPhaseIntent(operationId: string, target: Exclude<RecoveryPhase, 'PLANNED'>, guard: RecoveryJournalGuard): Promise<RecoveryJournalState> {
    return this.withOperation(operationId, guard, (operation) => operation.recordPhaseIntent(target));
  }

  async completePhase(operationId: string, target: Exclude<RecoveryPhase, 'PLANNED'>, guard: RecoveryJournalGuard): Promise<RecoveryJournalState> {
    return this.withOperation(operationId, guard, (operation) => operation.completePhase(target));
  }

  async recordPhaseFailure(operationId: string, failureCode: RecoveryErrorCode, guard: RecoveryJournalGuard): Promise<RecoveryJournalState> {
    if (!/^RECOVERY_[A-Z0-9_]+$/.test(failureCode)) throw new RecoveryError('RECOVERY_STATE_INVALID', 'Failure code must be a stable RECOVERY_* code.');
    return this.withOperation(operationId, guard,
      (operation) => operation.recordPhaseFailure(failureCode, 'DEFINITE_PRE_EFFECT'));
  }

  async recordPhaseUncertainty(operationId: string, failureCode: RecoveryErrorCode, guard: RecoveryJournalGuard): Promise<RecoveryJournalState> {
    return this.withOperation(operationId, guard,
      (operation) => operation.recordPhaseFailure(failureCode, 'AMBIGUOUS_EXTERNAL_EFFECT'));
  }

  async resolveAmbiguousPhase(operationId: string, target: Exclude<RecoveryPhase, 'PLANNED'>,
    evidenceSha256: string, guard: RecoveryJournalGuard): Promise<RecoveryJournalState> {
    return this.withOperation(operationId, guard,
      (operation) => operation.resolveAmbiguousPhase(target, evidenceSha256));
  }
}
