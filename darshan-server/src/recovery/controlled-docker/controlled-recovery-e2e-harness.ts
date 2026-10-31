import { ControlledRecoveryError, digest } from './contracts';

export const PACKET_C_E2E_STAGES = [
  'READINESS', 'SEED_REPRESENTATIVE_DATA', 'CREATE_ENCRYPTED_BACKUP', 'STOP_SOURCE_APPLICATION',
  'PREPARE_WITH_ONE_INTERRUPTION', 'API_VALIDATION', 'CMS_BROWSER_SERIAL', 'API_PLAYER', 'WORKER_DRAIN',
  'PROMOTE_SEPARATELY', 'ROLLBACK_UNDER_FREEZE', 'RETAIN_EVIDENCE', 'CLEANUP_EXACT_OWNED_RESOURCES',
] as const;
export type PacketCE2EStage = typeof PACKET_C_E2E_STAGES[number];

export interface PacketCE2EReadinessObservation {
  availableRamBytes: string; requiredRamBytes: string; workspaceFreeBytes: string; requiredWorkspaceBytes: string;
  targetFreeBytes: string; requiredTargetBytes: string; swapInUseBytes: string; maximumSwapInUseBytes: string;
  firefoxUntouched: true; enrolledAssetsSha256: string;
}
export interface PacketCE2EActivation {
  mode: 'TINY_DISPOSABLE_PACKET_C'; nonProduction: true; siteId: string; profileSha256: string;
  packetAEnrolled: true; packetBEnrolled: true; packetCEnrolled: true;
}
export interface PacketCE2EHarnessBoundary {
  observeReadiness(): Promise<PacketCE2EReadinessObservation>;
  execute(stage: Exclude<PacketCE2EStage, 'READINESS'>): Promise<{ evidenceSha256: string; ownedResourceIdsSha256?: string }>;
  report(): Promise<{ evidenceSha256: string; completedStages: PacketCE2EStage[] }>;
}

function decimal(value: string, label: string): bigint { if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_READINESS_INVALID', `${label} is invalid.`); return BigInt(value); }
export function assertPacketCE2EReadiness(value: PacketCE2EReadinessObservation): void {
  if (!value.firefoxUntouched || !/^[a-f0-9]{64}$/.test(value.enrolledAssetsSha256) ||
      decimal(value.availableRamBytes, 'available RAM') < decimal(value.requiredRamBytes, 'required RAM') ||
      decimal(value.workspaceFreeBytes, 'workspace free') < decimal(value.requiredWorkspaceBytes, 'workspace required') ||
      decimal(value.targetFreeBytes, 'target free') < decimal(value.requiredTargetBytes, 'target required') ||
      decimal(value.swapInUseBytes, 'swap use') > decimal(value.maximumSwapInUseBytes, 'maximum swap use')) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_READINESS_FAILED', 'Tiny disposable Packet C readiness or pressure gate failed.');
  }
}

export async function packetCE2EReadiness(boundary: PacketCE2EHarnessBoundary) { const observation = await boundary.observeReadiness(); assertPacketCE2EReadiness(observation); return { ready: true as const, observationSha256: digest(observation) }; }

export async function runPacketCE2E(input: { activation: PacketCE2EActivation; confirmation: string; boundary: PacketCE2EHarnessBoundary }) {
  if (input.confirmation !== 'RUN_TINY_DISPOSABLE_PACKET_C' || input.activation.mode !== 'TINY_DISPOSABLE_PACKET_C' || !input.activation.nonProduction ||
      !input.activation.packetAEnrolled || !input.activation.packetBEnrolled || !input.activation.packetCEnrolled) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_NOT_ACTIVATED', 'Packet C E2E requires exact tiny-disposable enrollment and confirmation.');
  }
  const readiness = await packetCE2EReadiness(input.boundary); const evidence: Array<{ stage: PacketCE2EStage; evidenceSha256: string }> = [{ stage: 'READINESS', evidenceSha256: readiness.observationSha256 }];
  for (const stage of PACKET_C_E2E_STAGES.slice(1) as Exclude<PacketCE2EStage, 'READINESS'>[]) {
    const result = await input.boundary.execute(stage); if (!/^[a-f0-9]{64}$/.test(result.evidenceSha256)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_EVIDENCE_INVALID', 'E2E stage evidence is invalid.');
    if (stage === 'CLEANUP_EXACT_OWNED_RESOURCES' && !/^[a-f0-9]{64}$/.test(result.ownedResourceIdsSha256 ?? '')) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_CLEANUP_FOREIGN', 'Cleanup lacks exact owned-resource evidence.');
    evidence.push({ stage, evidenceSha256: result.evidenceSha256 });
  }
  return { completed: true as const, nonProduction: true as const, topologyAndRtoSatisfied: false as const, evidence, evidenceSha256: digest(evidence) };
}
