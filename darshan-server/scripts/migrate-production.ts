import 'dotenv/config';
import { Pool } from 'pg';
import { program } from 'commander';
import { createDatabasePoolConfig } from '../src/db/index.js';
import {
  MigrationLedgerError,
  adoptDatabaseMigrations,
  applyDatabaseMigrations,
  loadMigrationManifest,
  planDatabaseMigrations,
} from '../src/deployment/migration-ledger.js';
import { config as appConfig } from '../src/config/index.js';

function emit(value: unknown, json?: boolean) {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function withMigrationCommand(action: (client: import('pg').PoolClient) => Promise<unknown>, json?: boolean) {
  return async () => {
    const pool = new Pool(createDatabasePoolConfig({
      connectionString: appConfig.DATABASE_URL,
      tlsEnabled: appConfig.DATABASE_TLS_ENABLED,
      caCertPath: appConfig.DATABASE_CA_CERT_PATH,
    }));
    const client = await pool.connect();
    try {
      emit(await action(client), json);
    } catch (error) {
      const code = error instanceof MigrationLedgerError ? error.code : 'MIGRATION_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ status: 'error', code, message })}\n`);
      process.exitCode = code === 'MIGRATION_ADOPTION_REQUIRED' || code === 'MIGRATION_ADOPTION_REJECTED' ? 2 : 1;
    } finally {
      client.release();
      await pool.end();
    }
  };
}

program.name('darshan-migrate').description('Checksum-verified DARSHAN production migration runner').version('1.0.0');

function addStatusCommand(name: string, description: string) {
  program
    .command(name)
    .description(description)
    .option('--json', 'Emit compact machine-readable JSON')
    .action((options) => withMigrationCommand(async (client) => planDatabaseMigrations(client, await loadMigrationManifest()), options.json)());
}

addStatusCommand('status', 'Inspect migration ledger and pending migrations without changing application schema');

program
  .command('plan')
  .description('Inspect pending migrations without changing application schema')
  .option('--json', 'Emit compact machine-readable JSON')
  .action((options) => withMigrationCommand(async (client) => planDatabaseMigrations(client, await loadMigrationManifest()), options.json)());

program
  .command('apply')
  .description('Apply verified migrations to an empty or already-managed database')
  .requiredOption('--release-id <id>', 'Immutable release identifier')
  .option('--json', 'Emit compact machine-readable JSON')
  .action((options) => withMigrationCommand(
    async (client) => applyDatabaseMigrations(client, await loadMigrationManifest(), options.releaseId),
    options.json
  )());

program
  .command('adopt')
  .description('Record a reviewed legacy schema; does not run SQL migrations')
  .requiredOption('--release-id <id>', 'Immutable release identifier')
  .requiredOption('--ticket <ticket>', 'Approved change ticket')
  .requiredOption('--manifest-fingerprint <sha256>', 'Fingerprint from migration plan')
  .requiredOption('--database-fingerprint <sha256>', 'Fingerprint from migration plan')
  .option('--json', 'Emit compact machine-readable JSON')
  .action((options) => withMigrationCommand(
    async (client) => adoptDatabaseMigrations(client, await loadMigrationManifest(), {
      releaseId: options.releaseId,
      ticket: options.ticket,
      manifestFingerprint: options.manifestFingerprint,
      databaseFingerprint: options.databaseFingerprint,
    }),
    options.json
  )());

await program.parseAsync(process.argv);
