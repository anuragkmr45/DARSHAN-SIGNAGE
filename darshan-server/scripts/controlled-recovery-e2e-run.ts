#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { ControlledRecoveryError } from '../src/recovery/controlled-docker/contracts';
import { runPacketCE2E, type PacketCE2EHarnessBoundary } from '../src/recovery/controlled-docker/controlled-recovery-e2e-harness';
import { loadCheckedInD3Boundary } from './development/controlled-recovery-d3-controller';

export interface DevelopmentD2RunRuntime { boundary: PacketCE2EHarnessBoundary; profileSha256: string; }
export interface DevelopmentD2RunDependencies { loadBoundary(): Promise<DevelopmentD2RunRuntime>; }
const installed: DevelopmentD2RunDependencies = { loadBoundary: loadCheckedInD3Boundary };
export async function runDevelopmentD2Cli(argv = process.argv.slice(2), dependencies = installed,
  output = { stdout: (value: string) => process.stdout.write(value), stderr: (value: string) => process.stderr.write(value) }): Promise<number> {
  try { if (argv.length !== 3 || argv[0] !== 'run' || argv[1] !== '--confirm' || argv[2] !== 'RUN_TINY_DISPOSABLE_PACKET_C')
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Usage: controlled-recovery-e2e-run run --confirm RUN_TINY_DISPOSABLE_PACKET_C');
    const runtime = await dependencies.loadBoundary();
    if (!/^[a-f0-9]{64}$/.test(runtime.profileSha256) || /^0+$/.test(runtime.profileSha256))
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PACKET_ASSET_UNENROLLED', 'Verified Packet A/B/C development evidence is required.');
    const result = await runPacketCE2E({ activation: { mode: 'TINY_DISPOSABLE_PACKET_C', nonProduction: true,
      siteId: 'tiny-d1-development', profileSha256: runtime.profileSha256, packetAEnrolled: true, packetBEnrolled: true, packetCEnrolled: true },
      confirmation: argv[2], boundary: runtime.boundary });
    output.stdout(`${canonicalJson({ format: 'darshan-controlled-recovery-development-d2-run-v1', status: 'SUCCESS', result }).toString('utf8')}\n`); return 0;
  } catch (cause) { const error = cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_D2_FAILED', 'D2 failed safely.', { cause });
    output.stderr(`${canonicalJson({ format: 'darshan-controlled-recovery-development-d2-run-v1', status: 'ERROR', code: error.code }).toString('utf8')}\n`); return error.code.includes('INPUT') ? 3 : 5; }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runDevelopmentD2Cli();
