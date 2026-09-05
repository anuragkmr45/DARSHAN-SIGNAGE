import 'dotenv/config';
import { program } from 'commander';
import { closeDatabase, getDatabase, initializeDatabase } from '../src/db/index.js';
import {
  adoptProductionBootstrapState,
  ProductionBootstrapError,
} from '../src/deployment/production-bootstrap.js';

program
  .name('darshan-production-bootstrap-adopt')
  .description('Record an existing active SUPER_ADMIN after reviewed legacy migration adoption')
  .requiredOption('-e, --email <email>', 'Existing active SUPER_ADMIN email address')
  .requiredOption('--release-id <release>', 'Release identifier for the bootstrap state')
  .requiredOption('--ticket <ticket>', 'Approved migration-adoption ticket')
  .option('--bootstrap-version <version>', 'Bootstrap contract version', 'adopted-v1')
  .option('--json', 'Emit machine-readable output only')
  .action(async (options) => {
    try {
      const ticket = String(options.ticket ?? '').trim();
      if (!ticket || ticket.length > 128 || /[\r\n\0]/.test(ticket)) {
        throw new ProductionBootstrapError('BOOTSTRAP_ADOPTION_TICKET_REQUIRED', 'A single-line adoption ticket of at most 128 characters is required.');
      }
      await initializeDatabase();
      const result = await adoptProductionBootstrapState(getDatabase(), {
        email: options.email,
        releaseId: options.releaseId,
        bootstrapVersion: options.bootstrapVersion,
        ticket,
      });
      const output = { ...result, ticket };
      if (options.json) {
        process.stdout.write(`${JSON.stringify(output)}\n`);
      } else {
        process.stdout.write(`${result.code}${result.reason ? `: ${result.reason}` : ''}\n`);
      }
      process.exitCode = result.status === 'conflict' ? 2 : 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ProductionBootstrapError ? error.code : 'BOOTSTRAP_ADOPTION_FAILED';
      process.stderr.write(`${JSON.stringify({ status: 'error', code, message })}\n`);
      process.exitCode = 1;
    } finally {
      await closeDatabase();
    }
  });

program.parseAsync(process.argv);
