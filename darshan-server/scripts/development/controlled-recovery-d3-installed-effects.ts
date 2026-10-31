import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3LiveObservation, D3OwnedResource, D3Stage, D3StageDriver, D3StageReceipt } from './controlled-recovery-d3-effects';

export interface D3MeasurementBoundary { begin(stage: D3Stage): Promise<{ monotonicMs: string }>; end(stage: D3Stage, started: { monotonicMs: string }): Promise<{ durationMs: string; peakMemoryBytes: string; hostSwapUsedBytes: string; evidenceSha256: string }> }
export interface D3InvariantBoundary { observe(stage: D3Stage): Promise<D3LiveObservation>; }
export interface D3FixedStageActions {
  seedCurrentSchema0057AndFixtures(): Promise<{ evidenceSha256: string }>;
  createBrokeredEncryptedV2Backup(): Promise<{ evidenceSha256: string }>;
  stopAndSealSourceApplication(): Promise<{ evidenceSha256: string }>;
  restoreWithControlledInterruptionAndResume(): Promise<{ evidenceSha256: string }>;
  validateRecoveredApi(): Promise<{ evidenceSha256: string }>;
  validateCmsPlaywrightSerial(): Promise<{ evidenceSha256: string }>;
  validateActualElectronPlayer(): Promise<{ evidenceSha256: string }>;
  drainRecoveredWorker(): Promise<{ evidenceSha256: string }>;
  promoteWithSeparateApprovalAndFreeze(): Promise<{ evidenceSha256: string }>;
  rollbackUnderWriteFreeze(): Promise<{ evidenceSha256: string }>;
  retainSecretFreeEvidence(): Promise<{ evidenceSha256: string }>;
  cleanupExactRetainedOwnership(): Promise<{ evidenceSha256: string; ownedResourceIdsSha256: string }>;
}

export class RealDevelopmentD3Effects implements D3StageDriver {
  constructor(private readonly actions: D3FixedStageActions, private readonly invariants: D3InvariantBoundary, private readonly measurements: D3MeasurementBoundary) {}
  observe(stage: D3Stage) { return this.invariants.observe(stage); }
  async execute(stage: D3Stage): Promise<D3StageReceipt> { const started = await this.measurements.begin(stage); const action = await this.action(stage); const measured = await this.measurements.end(stage, started);
    const live = await this.invariants.observe(stage); const sourceContentSealSha256 = stage === 'STOP_SOURCE_APPLICATION' ? live.mutableContentSha256 : undefined;
    return { stage, evidenceSha256: digest({ stage, action: action.evidenceSha256, live: live.liveInvariantSha256, measurement: measured.evidenceSha256 }),
      physicalSourceTargetSha256: live.physicalSourceTargetSha256, mutableContentSha256: live.mutableContentSha256, ...(sourceContentSealSha256 ? { sourceContentSealSha256 } : {}),
      liveInvariantSha256: live.liveInvariantSha256, measurementEvidenceSha256: measured.evidenceSha256, durationMs: measured.durationMs,
      peakMemoryBytes: measured.peakMemoryBytes, hostSwapUsedBytes: measured.hostSwapUsedBytes, retainedResources: [...live.retainedResources],
      ...('ownedResourceIdsSha256' in action ? { ownedResourceIdsSha256: action.ownedResourceIdsSha256 } : {}) };
  }
  private action(stage: D3Stage): Promise<{ evidenceSha256: string; ownedResourceIdsSha256?: string }> { const fixed: Record<D3Stage, () => Promise<{ evidenceSha256: string; ownedResourceIdsSha256?: string }>> = {
    SEED_REPRESENTATIVE_DATA: () => this.actions.seedCurrentSchema0057AndFixtures(), CREATE_ENCRYPTED_BACKUP: () => this.actions.createBrokeredEncryptedV2Backup(),
    STOP_SOURCE_APPLICATION: () => this.actions.stopAndSealSourceApplication(), PREPARE_WITH_ONE_INTERRUPTION: () => this.actions.restoreWithControlledInterruptionAndResume(),
    API_VALIDATION: () => this.actions.validateRecoveredApi(), CMS_BROWSER_SERIAL: () => this.actions.validateCmsPlaywrightSerial(), API_PLAYER: () => this.actions.validateActualElectronPlayer(),
    WORKER_DRAIN: () => this.actions.drainRecoveredWorker(), PROMOTE_SEPARATELY: () => this.actions.promoteWithSeparateApprovalAndFreeze(), ROLLBACK_UNDER_FREEZE: () => this.actions.rollbackUnderWriteFreeze(),
    RETAIN_EVIDENCE: () => this.actions.retainSecretFreeEvidence(), CLEANUP_EXACT_OWNED_RESOURCES: () => this.actions.cleanupExactRetainedOwnership(), }; return fixed[stage](); }
}

export function exactOwnedResourceIds(resources: readonly D3OwnedResource[]): string { if (!resources.length || resources.some(({ id }) => !/^[a-f0-9]{12,64}$/.test(id)))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CLEANUP_UNPROVEN', 'Exact D3 owned resource IDs are missing.'); return digest([...resources].map(({ role, id, labelsSha256 }) => ({ role, id, labelsSha256 })).sort((a, b) => a.role.localeCompare(b.role))); }
