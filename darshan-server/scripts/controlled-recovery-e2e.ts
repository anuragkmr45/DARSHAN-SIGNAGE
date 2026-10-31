#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { ControlledRecoveryError } from '../src/recovery/controlled-docker/contracts';
import { packetCE2EReadiness, runPacketCE2E, type PacketCE2EActivation, type PacketCE2EHarnessBoundary } from '../src/recovery/controlled-docker/controlled-recovery-e2e-harness';

export interface PacketCE2ECliDependencies {
  boundary: PacketCE2EHarnessBoundary;
  loadRunActivation?(): Promise<PacketCE2EActivation>;
}
const unavailable: PacketCE2EHarnessBoundary = { observeReadiness: async () => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PACKET_C_ASSETS_NOT_ENROLLED', 'Packet C readiness assets are not enrolled.'); },
  execute: async () => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_NOT_ACTIVATED', 'Packet C E2E is not activated.'); },
  report: async () => ({ evidenceSha256: '0'.repeat(64), completedStages: [] }) };

export async function runControlledRecoveryE2ECli(argv = process.argv.slice(2), dependencies: PacketCE2ECliDependencies = { boundary: unavailable },
  output = { stdout: (value: string) => process.stdout.write(value), stderr: (value: string) => process.stderr.write(value) }): Promise<number> {
  try {
    const command = argv[0]; if (!['readiness', 'report', 'run'].includes(command ?? '') || (command !== 'run' && argv.length !== 1) ||
      (command === 'run' && (argv.length !== 3 || argv[1] !== '--confirm'))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Usage: controlled-recovery-e2e readiness|report|run --confirm RUN_TINY_DISPOSABLE_PACKET_C');
    const data = command === 'readiness' ? await packetCE2EReadiness(dependencies.boundary) : command === 'report' ? await dependencies.boundary.report()
      : await runPacketCE2E({ activation: dependencies.loadRunActivation ? await dependencies.loadRunActivation() : (() => { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_PACKET_C_ASSETS_NOT_ENROLLED', 'Packet C activation is not enrolled.'); })(), confirmation: argv[2], boundary: dependencies.boundary });
    output.stdout(`${canonicalJson({ format: 'darshan-controlled-recovery-e2e-v1', command, status: 'SUCCESS', data }).toString('utf8')}\n`); return 0;
  } catch (cause) { const error = cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_E2E_FAILED', 'E2E command failed safely.', { cause });
    output.stderr(`${canonicalJson({ format: 'darshan-controlled-recovery-e2e-v1', status: 'ERROR', code: error.code }).toString('utf8')}\n`); return error.code.includes('INPUT') ? 3 : 5; }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runControlledRecoveryE2ECli();
