import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { createControlledRecoveryWorkflowAdapter, type Packet1DeploymentDependencies } from '../../src/recovery/controlled-docker/deployment-adapter';
import { preparePacket2Application, promoteControlledRecovery, type Packet2PreparationAdapter } from '../../src/recovery/controlled-docker/packet2';
import { rollbackFromProtectedAuthority } from '../../src/recovery/controlled-docker/packet2-deployment-adapter';
import { controlledRecoveryStatus, prepareControlledRecovery, resumeControlledRecovery, type ControlledRecoveryRequest } from '../../src/recovery/controlled-docker/workflow';
import type { ControlledRecoveryProfile } from '../../src/recovery/controlled-docker/profile';
import type { ControlledRecoveryJournal } from '../../src/recovery/controlled-docker/journal';
import { FixedD3Backup, requestFromD3Publication, type D3BackupBoundary, type D3PublicationStore, type D3PublicationVerifier } from './controlled-recovery-d3-backup';
import { assertVerifiedD3AgeIdentity, type VerifiedD3AgeIdentity } from './controlled-recovery-d3-age-identity';
import { assertD3OperationBinding, deriveD3OperationAuthority, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { runD3CmsLive, type D3CmsBoundary } from './controlled-recovery-d3-cms';
import { buildD3FixtureInventory } from './controlled-recovery-d3-fixtures';
import { runD3Player, type D3PlayerBoundary } from './controlled-recovery-d3-player';
import { seedD3CurrentSchema, type D3SeedSqlBoundary } from './controlled-recovery-d3-seed';
import type { D3FixedStageActions } from './controlled-recovery-d3-installed-effects';
import { RealDevelopmentD3Effects, type D3InvariantBoundary, type D3MeasurementBoundary } from './controlled-recovery-d3-installed-effects';
import { DevelopmentD3FileJournal, DevelopmentD3HarnessBoundary, StageAwareD3Readiness, type D3ReadinessObserver } from './controlled-recovery-d3-effects';
import type { DevelopmentD2Activation } from './controlled-recovery-d2';
import type { D3ContainerToolRunner } from './controlled-recovery-d4-tools';

export interface DevelopmentD3SystemBoundaries {
  seedSql: D3SeedSqlBoundary; backup: D3BackupBoundary; containerTools: D3ContainerToolRunner; publications: D3PublicationStore; publicationVerifier: D3PublicationVerifier;
  source: { currentContentSha256(): Promise<string>; stopAndSeal(): Promise<{ contentSha256: string; evidenceSha256: string }> };
  recoveredApi: { validateFixedCatalog(): Promise<{ evidenceSha256: string }> };
  cms: D3CmsBoundary; player: D3PlayerBoundary;
  worker: { drainAndProveIdle(): Promise<{ evidenceSha256: string }> };
  evidence: { retain(): Promise<{ evidenceSha256: string }> };
  cleanup: { removeExactOwned(): Promise<{ evidenceSha256: string; ownedResourceIdsSha256: string }> };
}

export interface DevelopmentD3WorkflowAuthority {
  operation: D3OperationAuthority; ageIdentity: VerifiedD3AgeIdentity;
  operationId: string; siteId: string; recoveryKeyFile: string; profile: ControlledRecoveryProfile; packet1: Packet1DeploymentDependencies;
  packet2: Packet2PreparationAdapter;
  promotion: Parameters<typeof promoteControlledRecovery>[0];
  rollback: Parameters<typeof rollbackFromProtectedAuthority>[0];
  playwrightSha256: string; electronSha256: string;
}

/** Concrete stage actions: success can only come from the exported Packet A/B/C workflows or fixed low-level system boundaries. */
export class DevelopmentD3FixedEffects implements D3FixedStageActions {
  private readonly packet1;
  private packet2Journal: ControlledRecoveryJournal | null = null;
  constructor(private readonly authority: DevelopmentD3WorkflowAuthority, private readonly system: DevelopmentD3SystemBoundaries) {
    assertD3OperationBinding(authority.operation, authority); assertVerifiedD3AgeIdentity(authority.ageIdentity, authority.operation);
    if (authority.recoveryKeyFile !== authority.operation.keyPath) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_OPERATION_AUTHORITY_MISMATCH', 'D3 retained recovery key path differs.');
    this.packet1 = createControlledRecoveryWorkflowAdapter(authority.packet1);
  }
  async seedCurrentSchema0057AndFixtures() { const fixtures = await buildD3FixtureInventory(); const seeded = await seedD3CurrentSchema(this.system.seedSql, fixtures);
    return { evidenceSha256: digest({ fixtures: fixtures.aggregateSha256, seeded }) }; }
  async createBrokeredEncryptedV2Backup() { const content = await this.system.source.currentContentSha256();
    const result = await new FixedD3Backup(this.system.backup, this.system.publications, this.authority.operation, this.authority.ageIdentity, this.system.publicationVerifier).execute({ operationId: this.authority.operationId, siteId: this.authority.siteId, releaseId: 'release-03', sourceSealSha256: content });
    return { evidenceSha256: digest(result) }; }
  async stopAndSealSourceApplication() { const stopped = await this.system.source.stopAndSeal(); if (!/^[a-f0-9]{64}$/.test(stopped.contentSha256) || !/^[a-f0-9]{64}$/.test(stopped.evidenceSha256))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_SEAL_INVALID', 'Source stop/seal evidence is invalid.'); return { evidenceSha256: stopped.evidenceSha256 }; }
  async restoreWithControlledInterruptionAndResume() { const request: ControlledRecoveryRequest = await requestFromD3Publication({ store: this.system.publications, operationId: this.authority.operationId,
      authority: this.authority.operation, identity: this.authority.ageIdentity, verifier: this.system.publicationVerifier,
      siteId: this.authority.siteId, releaseId: 'release-03', recoveryKeyFile: this.authority.recoveryKeyFile });
    let exists = true; try { await controlledRecoveryStatus(this.authority.profile, request.operationId); } catch { exists = false; }
    if (!exists) { try { await prepareControlledRecovery({ request, profile: this.authority.profile, adapter: this.packet1,
          fault: async (point, phase) => { if (point === 'AFTER_RESULT' && phase === 'TARGETS_CREATED') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_INJECTED_INTERRUPTION', 'One fixed D3 interruption.'); } }); }
      catch (cause) { if (!(cause instanceof ControlledRecoveryError) || cause.code !== 'CONTROLLED_RECOVERY_D3_INJECTED_INTERRUPTION') throw cause; } }
    this.packet2Journal = await resumeControlledRecovery({ request, profile: this.authority.profile, adapter: this.packet1 });
    await preparePacket2Application({ journal: this.packet2Journal, adapter: this.authority.packet2 });
    return { evidenceSha256: digest({ packet1: await this.packet2Journal.read(), packet2: 'AWAITING_PROMOTION' }) }; }
  validateRecoveredApi() { return this.system.recoveredApi.validateFixedCatalog(); }
  async validateCmsPlaywrightSerial() { const result = await runD3CmsLive(this.system.cms, this.authority.playwrightSha256); return { evidenceSha256: digest(result) }; }
  async validateActualElectronPlayer() { const result = await runD3Player(this.system.player, this.authority.electronSha256); return { evidenceSha256: digest(result) }; }
  drainRecoveredWorker() { return this.system.worker.drainAndProveIdle(); }
  async promoteWithSeparateApprovalAndFreeze() { const result = await promoteControlledRecovery(this.authority.promotion); return { evidenceSha256: digest(result) }; }
  async rollbackUnderWriteFreeze() { await rollbackFromProtectedAuthority(this.authority.rollback); return { evidenceSha256: digest({ operationId: this.authority.rollback.operationId, state: 'ROLLED_BACK' }) }; }
  retainSecretFreeEvidence() { return this.system.evidence.retain(); }
  cleanupExactRetainedOwnership() { return this.system.cleanup.removeExactOwned(); }
}

export function createDevelopmentD3FixedEffects(authority: DevelopmentD3WorkflowAuthority, system: DevelopmentD3SystemBoundaries): D3FixedStageActions {
  return new DevelopmentD3FixedEffects(authority, system);
}

export function createDevelopmentD3Boundary(input: { activation: DevelopmentD2Activation; authority: DevelopmentD3WorkflowAuthority; system: DevelopmentD3SystemBoundaries;
  readiness: D3ReadinessObserver; invariants: D3InvariantBoundary; measurements: D3MeasurementBoundary }) {
  if (digest(deriveD3OperationAuthority(input.activation)) !== digest(input.authority.operation)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_OPERATION_AUTHORITY_MISMATCH', 'Composition authority differs from D2.');
  const actions = createDevelopmentD3FixedEffects(input.authority, input.system); const driver = new RealDevelopmentD3Effects(actions, input.invariants, input.measurements);
  return new DevelopmentD3HarnessBoundary(new StageAwareD3Readiness(input.readiness), driver, new DevelopmentD3FileJournal(input.activation));
}
