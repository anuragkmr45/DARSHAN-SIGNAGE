import type { ExactSourceIdentity, OperationIdentity, ControlledRecoveryMajorState } from './contracts';
import { ControlledRecoveryError, CONTROLLED_RECOVERY_MAJOR_STATES, digest } from './contracts';
import { ControlledRecoveryJournal } from './journal';
import type { ControlledRecoveryProfile } from './profile';
import type { RecoveryCompatibilityDecision } from '../compatibility';
import { buildControlledRecoveryPacket2Report, buildControlledRecoveryReport, type ControlledRecoveryReportV3, type ControlledRecoveryReportV4 } from './report';

export interface ControlledRecoveryRequest {
  operationId: string; backupRunId: string; manifestSha256: string; siteId: string;
  approvedReleaseId: 'release-01' | 'release-03'; recoveryKeyFile: string;
}

export interface PhaseResult { evidence: unknown; aggregates?: Record<string, string>; timingsMs?: Record<string, string> }
export type WorkflowFaultPoint = 'BEFORE_INTENT' | 'AFTER_INTENT' | 'BEFORE_RESULT' | 'AFTER_RESULT';

export interface ControlledRecoveryWorkflowAdapter {
  selectSource(input: { request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<ExactSourceIdentity>;
  assessCompatibility(input: { source: ExactSourceIdentity; request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<RecoveryCompatibilityDecision>;
  reobserveSource(input: { expected: ExactSourceIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<void>;
  observePhase(input: { phase: ControlledRecoveryMajorState; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<{ confirmed: boolean; evidence?: unknown }>;
  sourceHeld(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
  preflightPassed(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
  decryptedVerified(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
  targetsCreated(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
  databaseRestored(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
  objectsRestored(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
  dataValidated(input: { request: ControlledRecoveryRequest; identity: OperationIdentity; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<PhaseResult>;
}

const methods: Record<Exclude<ControlledRecoveryMajorState, 'PLANNED'>, keyof ControlledRecoveryWorkflowAdapter> = {
  SOURCE_HELD: 'sourceHeld', PREFLIGHT_PASSED: 'preflightPassed', DECRYPTED_VERIFIED: 'decryptedVerified',
  TARGETS_CREATED: 'targetsCreated', DATABASE_RESTORED: 'databaseRestored', OBJECTS_RESTORED: 'objectsRestored', DATA_VALIDATED: 'dataValidated',
};

function assertRequest(profile: ControlledRecoveryProfile, request: ControlledRecoveryRequest, identity?: OperationIdentity): void {
  if (request.siteId !== profile.site_id || request.approvedReleaseId !== profile.release_id ||
      !request.recoveryKeyFile.startsWith(`${profile.recovery_key_root}/`)) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_NOT_APPROVED', 'Site, release, or recovery-key location is outside the installed fixed profile.');
  }
  if (identity && (identity.operationId !== request.operationId || identity.siteId !== request.siteId ||
      identity.source.runId !== request.backupRunId || identity.source.manifestSha256 !== request.manifestSha256 ||
      identity.approvedReleaseId !== request.approvedReleaseId)) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_IDENTITY_CONFLICT', 'Resume inputs differ from the durable operation identity.');
  }
}

async function converge(input: { journal: ControlledRecoveryJournal; request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile;
  adapter: ControlledRecoveryWorkflowAdapter; signal?: AbortSignal;
  lock: import('./journal').ControlledRecoveryOperationLock;
  fault?: (point: WorkflowFaultPoint, phase: Exclude<ControlledRecoveryMajorState, 'PLANNED'>) => Promise<void> }): Promise<void> {
  const starting = await input.journal.read(input.lock);
  const currentIndex = starting.pendingPhase
    ? CONTROLLED_RECOVERY_MAJOR_STATES.indexOf(starting.pendingPhase as ControlledRecoveryMajorState) - 1
    : CONTROLLED_RECOVERY_MAJOR_STATES.indexOf(starting.state as ControlledRecoveryMajorState);
  if (starting.state === 'DATA_VALIDATED' && !starting.pendingPhase) return;
  if (currentIndex < 0 && starting.state !== 'FAILED_RETRYABLE' && starting.state !== 'OPERATOR_REVIEW') {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_STATE_TERMINAL', 'Operation is not resumable by Packet 1.');
  }
  for (const phase of CONTROLLED_RECOVERY_MAJOR_STATES.slice(Math.max(1, currentIndex + 1)) as Exclude<ControlledRecoveryMajorState, 'PLANNED'>[]) {
    input.signal?.throwIfAborted();
    const phaseSignal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(input.profile.limits.phase_timeout_ms)])
      : AbortSignal.timeout(input.profile.limits.phase_timeout_ms);
    await input.adapter.reobserveSource({ expected: input.journal.identity.source, profile: input.profile, signal: phaseSignal });
    const observed = await input.adapter.observePhase({ phase, identity: input.journal.identity, profile: input.profile, signal: phaseSignal });
    if (observed.confirmed) {
      await input.journal.record({ phase, outcome: 'OBSERVATION', effectTruth: 'CONFIRMED', code: `CONTROLLED_RECOVERY_${phase}_REOBSERVED`, evidence: observed.evidence }, input.lock);
      continue;
    }
    await input.fault?.('BEFORE_INTENT', phase);
    await input.journal.record({ phase, outcome: 'INTENT', effectTruth: 'PENDING', code: `CONTROLLED_RECOVERY_${phase}_INTENT` }, input.lock);
    await input.fault?.('AFTER_INTENT', phase);
    let result: PhaseResult; let after: { confirmed: boolean; evidence?: unknown };
    try {
      const method = input.adapter[methods[phase]] as (value: { request: ControlledRecoveryRequest; identity: OperationIdentity;
        profile: ControlledRecoveryProfile; signal?: AbortSignal }) => Promise<PhaseResult>;
      result = await method.call(input.adapter, { request: input.request,
        identity: input.journal.identity, profile: input.profile, signal: phaseSignal });
      after = await input.adapter.observePhase({ phase, identity: input.journal.identity, profile: input.profile, signal: phaseSignal });
      if (!after.confirmed) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS', 'Phase adapter returned without confirmed re-observed truth.');
    } catch (cause) {
      const classified = cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS', 'Phase failed without classified target truth.', { cause });
      const ambiguous = classified.code.includes('AMBIGUOUS') || classified.code.includes('UNCERTAIN');
      await input.journal.record({ phase: ambiguous ? 'OPERATOR_REVIEW' : 'FAILED_RETRYABLE', outcome: 'FAILURE',
        effectTruth: ambiguous ? 'AMBIGUOUS' : 'NONE', code: classified.code, evidence: { failedPhase: phase } }, input.lock);
      throw classified;
    }
    await input.fault?.('BEFORE_RESULT', phase);
    await input.journal.record({ phase, outcome: 'RESULT', effectTruth: 'CONFIRMED', code: `CONTROLLED_RECOVERY_${phase}_CONFIRMED`, evidence: { result: result.evidence, observation: after.evidence } }, input.lock);
    await input.fault?.('AFTER_RESULT', phase);
  }
}

export async function prepareControlledRecovery(input: { request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile;
  adapter: ControlledRecoveryWorkflowAdapter; signal?: AbortSignal;
  fault?: (point: WorkflowFaultPoint, phase: Exclude<ControlledRecoveryMajorState, 'PLANNED'>) => Promise<void> }): Promise<ControlledRecoveryJournal> {
  assertRequest(input.profile, input.request);
  const source = await input.adapter.selectSource({ request: input.request, profile: input.profile, signal: input.signal });
  if (source.siteId !== input.request.siteId || source.runId !== input.request.backupRunId || source.manifestSha256 !== input.request.manifestSha256) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SOURCE_MISMATCH', 'Selected trusted source differs from approved inputs.');
  }
  const compatibility = await input.adapter.assessCompatibility({ source, request: input.request, profile: input.profile, signal: input.signal });
  if (!compatibility.fullyEligible || compatibility.targetReleaseId !== input.profile.release_id ||
      compatibility.targetSchemaMigrationId !== input.profile.terminal_migration_id ||
      compatibility.classification === 'LEGACY_CLASSIFIED' ||
      (source.releaseId === input.profile.release_id && compatibility.classification !== 'COMPATIBLE_CURRENT') ||
      (source.releaseId !== input.profile.release_id && compatibility.classification !== 'COMPATIBLE_FORWARD')) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_RELEASE_INCOMPATIBLE', 'Selected source is not enrolled as compatible with the approved recovery target.');
  }
  const identity: OperationIdentity = { operationId: input.request.operationId, siteId: input.request.siteId,
    approvedReleaseId: input.request.approvedReleaseId, source };
  const journal = await ControlledRecoveryJournal.create(input.profile.journal_root, identity);
  await journal.withOperationLock((lock) => converge({ journal, ...input, lock })); return journal;
}

export async function resumeControlledRecovery(input: { request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile;
  adapter: ControlledRecoveryWorkflowAdapter; signal?: AbortSignal;
  fault?: (point: WorkflowFaultPoint, phase: Exclude<ControlledRecoveryMajorState, 'PLANNED'>) => Promise<void> }): Promise<ControlledRecoveryJournal> {
  const journal = await ControlledRecoveryJournal.open(input.profile.journal_root, input.request.operationId);
  assertRequest(input.profile, input.request, journal.identity);
  await journal.withOperationLock((lock) => converge({ journal, ...input, lock })); return journal;
}

export async function controlledRecoveryStatus(profile: ControlledRecoveryProfile, operationId: string) {
  return (await ControlledRecoveryJournal.open(profile.journal_root, operationId)).read();
}

export async function controlledRecoveryReport(input: { profile: ControlledRecoveryProfile; operationId: string;
  aggregates: Record<string, string>; timingsMs: Record<string, string>; generation?: string; unexecutedGates?: string[] }): Promise<ControlledRecoveryReportV3 | ControlledRecoveryReportV4> {
  const snapshot = await controlledRecoveryStatus(input.profile, input.operationId);
  return snapshot.state === 'DATA_VALIDATED'
    ? buildControlledRecoveryReport({ snapshot, aggregates: input.aggregates, timingsMs: input.timingsMs })
    : buildControlledRecoveryPacket2Report({ snapshot, aggregates: input.aggregates, timingsMs: input.timingsMs,
      generation: input.generation, unexecutedGates: input.unexecutedGates });
}

export const workflowEvidenceDigest = digest;

