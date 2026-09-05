import { Pool } from 'pg';
import { program } from 'commander';
import { applyDatabaseMigrations, loadMigrationManifest } from '../src/deployment/migration-ledger.js';
import { assertDedicatedTestDatabase, parseDatabaseName } from '../src/db/test-database-safety.js';

const releaseId = 'test-suite';
const resettableTestDatabase = /^darshan(?:_[a-z0-9]+)*_test(?:_[a-z0-9]+)*$/i;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) {
    throw new Error('TEST_DATABASE_URL is required and must point to a dedicated DARSHAN *_test database.');
  }
  const databaseName = assertDedicatedTestDatabase(value, 'Test database reset');
  if (!resettableTestDatabase.test(databaseName)) {
    throw new Error(`Test database reset only permits DARSHAN-owned *_test names; received "${databaseName}".`);
  }
  return value;
}

function resolveAdminUrl(testDatabaseUrl: string): string {
  const configured = process.env.TEST_DATABASE_ADMIN_URL?.trim();
  if (configured) {
    const configuredName = parseDatabaseName(configured);
    if (configuredName === parseDatabaseName(testDatabaseUrl)) {
      throw new Error('TEST_DATABASE_ADMIN_URL must connect to an administrative database, not the test database being reset.');
    }
    return configured;
  }

  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  return adminUrl.toString();
}

async function resetTestDatabase(): Promise<void> {
  const testDatabaseUrl = requireTestDatabaseUrl();
  const databaseName = parseDatabaseName(testDatabaseUrl);
  const adminPool = new Pool({ connectionString: resolveAdminUrl(testDatabaseUrl) });
  const testPool = new Pool({ connectionString: testDatabaseUrl });

  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

    const client = await testPool.connect();
    try {
      const manifest = await loadMigrationManifest();
      const result = await applyDatabaseMigrations(client, manifest, releaseId);
      if (result.pending.length !== 0 || result.adoptionRequired) {
        throw new Error('Fresh test database did not reach the current managed migration state.');
      }
      process.stdout.write(`${JSON.stringify({ status: 'ready', database: databaseName, migrationCount: result.applied.length })}\n`);
    } finally {
      client.release();
    }
  } finally {
    await testPool.end();
    await adminPool.end();
  }
}

program
  .name('darshan-test-database')
  .description('Reset a dedicated DARSHAN integration-test database and apply the checked migration baseline.')
  .command('reset')
  .description('Drop and recreate the explicit dedicated test database')
  .action(async () => {
    try {
      await resetTestDatabase();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${JSON.stringify({ status: 'error', message })}\n`);
      process.exitCode = 1;
    }
  });

await program.parseAsync(process.argv);
