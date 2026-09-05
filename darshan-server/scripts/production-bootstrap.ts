import 'dotenv/config';
import { program } from 'commander';
import { closeDatabase, getDatabase, initializeDatabase } from '../src/db/index.js';
import { bootstrapProductionDatabase, ProductionBootstrapError } from '../src/deployment/production-bootstrap.js';
import { readProtectedSecretFile, ProtectedSecretError } from '../src/deployment/protected-secret.js';
import { ensureProductionStorage } from '../src/deployment/production-storage.js';

program
  .name('darshan-production-bootstrap')
  .description('Initialize an empty, migrated DARSHAN production database')
  .requiredOption('-e, --email <email>', 'Initial SUPER_ADMIN email address')
  .option('--password-file <path>', 'Mode-0600 file containing the initial administrator password')
  .requiredOption('--release-id <release>', 'Release identifier for the bootstrap audit record')
  .option('--bootstrap-version <version>', 'Bootstrap contract version', '1')
  .option('--json', 'Emit machine-readable output only')
  .action(async (options) => {
    try {
      const password = options.passwordFile ? await readProtectedSecretFile(options.passwordFile) : undefined;
      await initializeDatabase();
      const result = await bootstrapProductionDatabase(getDatabase(), {
        email: options.email,
        password,
        releaseId: options.releaseId,
        bootstrapVersion: options.bootstrapVersion,
      });
      // Storage initialization is idempotent and deliberately happens through
      // the controlled bootstrap command, before API/worker traffic starts.
      // It is outside the PostgreSQL transaction because MinIO cannot join it;
      // a later rerun safely retries only this incomplete external step.
      if (result.status !== 'conflict') await ensureProductionStorage();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stdout.write(`${result.code}${result.reason ? `: ${result.reason}` : ''}\n`);
      }
      process.exitCode = result.status === 'conflict' ? 2 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ProductionBootstrapError
        ? error.code
        : error instanceof ProtectedSecretError
          ? 'BOOTSTRAP_INPUT_ERROR'
          : 'BOOTSTRAP_FAILED';
      process.stderr.write(`${JSON.stringify({ status: 'error', code, message })}\n`);
      process.exitCode = 1;
    } finally {
      await closeDatabase();
    }
  });

program.parseAsync(process.argv);
