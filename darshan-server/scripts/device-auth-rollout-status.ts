import 'dotenv/config';
import { program } from 'commander';
import { closeDatabase, initializeDatabase } from '../src/db/index.js';
import { getDeviceAuthRolloutStatus } from '../src/deployment/device-auth-rollout.js';

function parseIsoInstant(value: string, label: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be an ISO-8601 timestamp`);
  return parsed;
}

program
  .name('darshan-device-auth-rollout-status')
  .description('Evaluate evidence required before a production fleet can switch to signature-only device authentication')
  .requiredOption('--since <iso-timestamp>', 'Timestamp immediately after the backend restart that began the rollout window')
  .option('--legacy-free-days <days>', 'Required consecutive days without legacy auth', '7')
  .option('--json', 'Emit machine-readable output only')
  .action(async (options) => {
    try {
      const since = parseIsoInstant(options.since, '--since');
      const days = Number(options.legacyFreeDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        throw new Error('--legacy-free-days must be an integer from 1 to 365');
      }
      await initializeDatabase();
      const result = await getDeviceAuthRolloutStatus({ since, legacyFreeDays: days });
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else if (result.readyForSignatureOnly) {
        process.stdout.write(`READY: ${result.activeScreenCount} active screen(s) have signed HTTP/socket evidence after ${result.since} and no legacy authentication in the last ${days} day(s).\n`);
      } else if (result.activeScreenCount === 0) {
        process.stdout.write('NOT_READY: no active screens were found, so there is no player evidence for signature-only promotion. Use --json for details.\n');
      } else {
        process.stdout.write(`NOT_READY: ${result.blockers.length}/${result.activeScreenCount} active screen(s) block signature-only promotion. Use --json for details.\n`);
      }
      process.exitCode = result.readyForSignatureOnly ? 0 : 2;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ status: 'error', code: 'DEVICE_AUTH_ROLLOUT_STATUS_FAILED', message })}\n`);
      process.exitCode = 1;
    } finally {
      await closeDatabase();
    }
  });

program.parseAsync(process.argv);
