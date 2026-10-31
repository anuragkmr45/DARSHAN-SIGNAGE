#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { ControlledRecoveryError } from '../src/recovery/controlled-docker/contracts';
import { loadDevelopmentReadinessActivation, observeDevelopmentReadiness, type DevelopmentReadinessActivation, type DevelopmentReadinessReport, type DevelopmentReadinessSystem } from './development/controlled-recovery-readiness';

export interface DevelopmentReadinessCliDependencies {
  loadActivation(): Promise<DevelopmentReadinessActivation>;
  observe(activation: DevelopmentReadinessActivation, system?: DevelopmentReadinessSystem): Promise<DevelopmentReadinessReport>;
}
const installed: DevelopmentReadinessCliDependencies = { loadActivation: loadDevelopmentReadinessActivation, observe: observeDevelopmentReadiness };
export async function runDevelopmentReadinessCli(argv = process.argv.slice(2), dependencies = installed,
  output = { stdout: (value: string) => process.stdout.write(value), stderr: (value: string) => process.stderr.write(value) }): Promise<number> {
  try { const command = argv[0];
    if (command === 'run') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_RUN_UNAVAILABLE', 'Packet D1 is read-only; run is unavailable.');
    if (!['readiness', 'report'].includes(command ?? '') || argv.length !== 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Usage: controlled-recovery-e2e-readiness readiness|report');
    const report = await dependencies.observe(await dependencies.loadActivation());
    output.stdout(`${canonicalJson({ format: 'darshan-controlled-recovery-development-readiness-cli-v1', command, report }).toString('utf8')}\n`);
    return command === 'readiness' && report.status !== 'READY' ? 5 : 0;
  } catch (cause) { const error = cause instanceof ControlledRecoveryError ? cause : new ControlledRecoveryError('CONTROLLED_RECOVERY_D1_FAILED', 'Packet D1 readiness failed safely.', { cause });
    output.stderr(`${canonicalJson({ format: 'darshan-controlled-recovery-development-readiness-cli-v1', status: 'ERROR', code: error.code }).toString('utf8')}\n`); return error.code.includes('INPUT') ? 3 : 5; }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runDevelopmentReadinessCli();
