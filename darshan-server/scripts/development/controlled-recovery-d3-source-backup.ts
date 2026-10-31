import { z } from 'zod';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { D3_SOURCE_COMMANDS, D3_SOURCE_STAGES } from './controlled-recovery-d3-source-profile';
import { DurableD3SourceState, type D3SourceStageReceipt } from './controlled-recovery-d3-source-state';
import { validateD3SourceLayout, type D3SourceLayoutBoundary, type FixedD3SourceServices } from './controlled-recovery-d3-source-services';

export type D3SourceBackupCommand = typeof D3_SOURCE_COMMANDS[number];
export function parseD3SourceBackupCommand(argv: readonly string[]): D3SourceBackupCommand {
  if (argv.length !== 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_INVALID', 'Exactly one fixed source command is required.');
  const value = z.enum(D3_SOURCE_COMMANDS).safeParse(argv[0]); if (!value.success) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_COMMAND_INVALID', 'The source command is not enrolled.'); return value.data;
}
export const D3_SOURCE_NEXT_BOUNDARIES = Object.freeze(['retainedSecretsCaAndTlsMaterialization', 'ownedVolumeTlsAndCredentialMaterialization', 'sourceDockerDirectExecutor',
  'realAuthenticatedTlsProbes', 'currentMigrationLedgerAndSeed', 'representativeObjectsAndSourceSeal', 'productionFiveRoleCapsule', 'transactionalOperationBackupReservation',
  'containerCapturePackageAndBrokeredEncryption', 'verifiedAttemptPublicationSettlement'] as const);
type Services = Pick<FixedD3SourceServices, 'prepare' | 'converge' | 'observe' | 'stop'>;
export interface D3SourceBackupDependencies { state: DurableD3SourceState; layout: D3SourceLayoutBoundary; services: Services; prepareAdmission?(signal?: AbortSignal): Promise<readonly string[]>; }
function unavailable() { return new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_BACKUP_DEPENDENCIES_NOT_ENROLLED', 'Source data, capsule, broker, capture and publication providers remain unenrolled.'); }

/** This first subpacket can prepare/observe/stop enrolled source services. It cannot claim source schema, seed, backup or publication success. */
export class D3SourceBackupController {
  constructor(private readonly dependencies: D3SourceBackupDependencies) {}
  private checkSignal(signal?: AbortSignal) { if (signal?.aborted) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED', 'The fixed source operation was cancelled before its next effect.'); }
  private async layout(stages: readonly D3SourceStageReceipt[]) {
    const layout = validateD3SourceLayout(await this.dependencies.layout.verify());
    if (stages[0] && stages[0].evidenceSha256 !== digest(layout)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_CHANGED', 'Retained source layout no longer matches its durable receipt.'); return layout;
  }
  private async verifyBase() {
    const stages = await this.dependencies.state.stages(); if (!stages.length) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_NOT_PREPARED', 'The source layout is not prepared.');
    await this.layout(stages); const truth = await this.dependencies.services.observe();
    if (stages[1] && digest(stages[1].resources) !== digest(truth.retained)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED', 'Source service IDs differ from the retained stage.');
    return { stages, truth };
  }
  private async prepare(signal?: AbortSignal) {
    const stages = await this.dependencies.state.stages(); if (await this.dependencies.state.stopReceipt()) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_STOPPED', 'A stopped source operation is immutable and cannot restart automatically.');
    if (stages.length > 2) throw unavailable();
    const reconciledRoles = await this.dependencies.prepareAdmission?.(signal) ?? []; this.checkSignal(signal);
    if (!stages.length) { this.checkSignal(signal); const layout = validateD3SourceLayout(await this.dependencies.layout.prepare(signal)); this.checkSignal(signal); await this.dependencies.state.appendStage('LAYOUT_READY', digest(layout), []); }
    else await this.layout(stages);
    const result = await this.dependencies.services.prepare(signal); const current = await this.dependencies.state.stages();
    if (!current[1]) await this.dependencies.state.appendStage('SERVICES_READY', result.evidenceSha256, result.resources);
    else if (digest(current[1].resources) !== digest(result.resources)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED', 'Reobserved source services differ.');
    return { status: 'SOURCE_SERVICES_PREPARED' as const, stage: 'SERVICES_READY' as const, nextStage: 'SCHEMA_READY' as const, reconciledRoles, backupCreated: false as const, wholeRunEnabled: false as const };
  }
  private async status() {
    const stages = await this.dependencies.state.stages(); const stop = await this.dependencies.state.stopReceipt();
    if (!stages.length) { const truth = await this.dependencies.services.observe(); if (truth.status !== 'EMPTY') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_OWNERSHIP_CHANGED', 'Source resources exist without a completed layout.');
      return { status: 'EMPTY' as const, stage: null, verifiedThrough: null, backupCreated: false as const, wholeRunEnabled: false as const }; }
    const { truth } = await this.verifyBase();
    if (stop) { if (truth.status !== 'STOPPED' || stop.resourcesSha256 !== digest(truth.retained)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_STOP_UNVERIFIED', 'Stopped source truth differs.');
      return { status: 'INTERRUPTED_SOURCE_STOPPED' as const, stage: stages.at(-1)!.stage, verifiedThrough: 'SERVICES_READY' as const, backupCreated: false as const, wholeRunEnabled: false as const }; }
    if (stages.length > 2) return { status: 'BLOCKED_UNVERIFIED_LATER_STAGES' as const, stage: stages.at(-1)!.stage, verifiedThrough: null, missingRequirements: D3_SOURCE_NEXT_BOUNDARIES, backupCreated: false as const, wholeRunEnabled: false as const };
    if (truth.status === 'MIXED') return { status: 'SOURCE_STOP_INCOMPLETE' as const, stage: stages.at(-1)!.stage, verifiedThrough: null, nextCommand: 'stop' as const, backupCreated: false as const, wholeRunEnabled: false as const };
    if (stages[1]) await this.dependencies.services.converge();
    return { status: stages[1] ? 'SOURCE_SERVICES_VERIFIED' as const : 'INTERRUPTED_LAYOUT_READY' as const, stage: stages.at(-1)!.stage, verifiedThrough: stages.at(-1)!.stage,
      nextStage: D3_SOURCE_STAGES[stages.length], backupCreated: false as const, wholeRunEnabled: false as const };
  }
  private async capture() { const { stages } = await this.verifyBase(); if (stages.length < 2) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_NOT_PREPARED', 'Source services are not prepared.'); await this.dependencies.services.converge(); throw unavailable(); }
  private async resume(signal?: AbortSignal) { const { stages } = await this.verifyBase(); if (await this.dependencies.state.stopReceipt()) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_STOPPED', 'Stopped source state cannot resume automatically.');
    if (stages.length < 2) await this.prepare(signal); else await this.dependencies.services.converge(signal); throw unavailable(); }
  private async stop() { await this.verifyBase(); const stopped = await this.dependencies.services.stop();
    await this.dependencies.state.recordStopped(stopped.resources, stopped.evidenceSha256);
    return { status: 'SOURCE_STOPPED' as const, completedBackup: false as const, wholeRunEnabled: false as const };
  }
  async execute(command: D3SourceBackupCommand, signal?: AbortSignal) {
    const checked = parseD3SourceBackupCommand([command]);
    try {
      if (checked === 'status') { if (await this.dependencies.state.commandInProgress()) return { status: 'SOURCE_COMMAND_IN_PROGRESS' as const, verifiedThrough: null, backupCreated: false as const, wholeRunEnabled: false as const }; return await this.status(); }
      return await this.dependencies.state.withCommandLock(checked, async () => { if (checked === 'prepare') return this.prepare(signal); if (checked === 'capture') return this.capture(); if (checked === 'resume') return this.resume(signal); return this.stop(); });
    }
    catch (cause) { if (cause instanceof ControlledRecoveryError) throw cause; throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_BOUNDARY_FAILED', 'An unenrolled or failed source boundary prevented verification.'); }
  }
}

/** Deliberately no installed driver/CLI effect path in this static subpacket. */
export async function loadInstalledD3SourceBackup(): Promise<never> { throw unavailable(); }
