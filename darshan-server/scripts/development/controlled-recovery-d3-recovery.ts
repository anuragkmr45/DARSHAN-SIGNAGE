import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';

export interface D3PacketAssetEvidence { packetAActivationSha256: string; packetBAdapterSha256: string; packetBProfileSha256: string; packetCAdapterSha256: string; packetCProfileSha256: string; }
export function verifyD3PacketAssets(value: D3PacketAssetEvidence): string { if (Object.values(value).some((entry) => !/^[a-f0-9]{64}$/.test(entry) || /^0+$/.test(entry)))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PACKET_ASSET_UNENROLLED', 'Packet A/B/C development asset evidence is absent.'); return digest(value); }
export interface D3RecoveryBoundary { prepare(): Promise<{ phase: string; evidenceSha256: string }>; interruptOnce(phase: string): Promise<void>; resume(): Promise<{ phase: 'AWAITING_PROMOTION'; evidenceSha256: string }>;
  validateOriginalTargets(): Promise<{ beforeSha256: string; afterSha256: string }>; }
export class FixedD3Recovery {
  private interrupted = false;
  constructor(private readonly boundary: D3RecoveryBoundary) {}
  async prepareInterruptResume() { const prepared = await this.boundary.prepare(); if (!this.interrupted) { this.interrupted = true; await this.boundary.interruptOnce(prepared.phase); }
    const resumed = await this.boundary.resume(); const originals = await this.boundary.validateOriginalTargets(); if (originals.beforeSha256 !== originals.afterSha256)
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_ORIGINAL_TARGET_CHANGED', 'Original targets changed during D3 recovery.'); return { prepared, resumed, originals, evidenceSha256: digest({ prepared, resumed, originals }) }; }
}
