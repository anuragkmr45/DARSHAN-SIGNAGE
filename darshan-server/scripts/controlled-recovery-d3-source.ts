#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { canonicalJson } from '../src/backups/backup-broker-protocol';
import { ControlledRecoveryError } from '../src/recovery/controlled-docker/contracts';
import { loadInstalledD3SourceProviders, parseD3SourceLiveCommand, type InstalledD3SourceProviders } from './development/controlled-recovery-d3-source-installed';
import { d3SourceFailureDetails } from './development/controlled-recovery-d3-source-process';

export async function runD3SourceCli(argv = process.argv.slice(2), load: () => Promise<Pick<InstalledD3SourceProviders, 'execute'>> = loadInstalledD3SourceProviders,
  output = { stdout: (value: string) => process.stdout.write(value), stderr: (value: string) => process.stderr.write(value) }): Promise<number> {
  const abort = new AbortController(); const cancel = () => abort.abort();
  try { const command = parseD3SourceLiveCommand(argv); process.once('SIGINT', cancel); process.once('SIGTERM', cancel); const report = await (await load()).execute(command, abort.signal); output.stdout(canonicalJson(report).toString('utf8')); return report.status === 'BLOCKED' ? 5 : 0; }
  catch (cause) { const code = cause instanceof ControlledRecoveryError ? cause.code : 'CONTROLLED_RECOVERY_D3_SOURCE_PROVIDER_FAILED'; output.stderr(canonicalJson({ format: 'darshan-d3-source-provider-report-v1', status: 'BLOCKED', codes: [code], nextAction: 'REVIEW_RETAINED_RESOURCES', captureEnabled: false, wholeRunEnabled: false, ...d3SourceFailureDetails(cause) }).toString('utf8')); return code.includes('COMMAND_INVALID') ? 3 : 5; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runD3SourceCli();
