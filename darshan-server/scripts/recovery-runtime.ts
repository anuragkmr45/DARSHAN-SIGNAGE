#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { installRecoverySignalBoundary, RECOVERY_RUNTIME_FORMAT, validateRecoveryRuntime } from '../src/recovery/runtime-contract';

const RUNTIME_FAILURE_EXIT = 78;

export async function runRecoveryRuntime(argv = process.argv.slice(2)): Promise<number> {
  process.umask(0o077);
  try {
    await validateRecoveryRuntime(argv);
  } catch {
    process.stderr.write(`${RECOVERY_RUNTIME_FORMAT}: recovery runtime contract validation failed.\n`);
    return RUNTIME_FAILURE_EXIT;
  }
  const boundary = installRecoverySignalBoundary();
  try {
    const { runRecoveryCli } = await import('./recovery-cli.js');
    return await runRecoveryCli(argv, undefined, undefined, boundary.signal);
  } finally {
    boundary.dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await runRecoveryRuntime();
