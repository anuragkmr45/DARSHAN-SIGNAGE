import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { readFileSync } from 'node:fs';
import { Pool, type PoolConfig } from 'pg';
import { config as appConfig } from '@/config';
import { assertTestRuntimeDatabase } from './test-database-safety.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

let db: Database | null = null;
let pool: Pool | null = null;
const databaseShutdownHooks = new Map<string, () => Promise<void> | void>();

/**
 * Builds the only PostgreSQL pool configuration used by production runtime
 * code.  TLS is explicit instead of relying on URL query strings or ambient
 * libpq variables, so a supplied CA always verifies the database identity.
 */
export function createDatabasePoolConfig(input: {
  connectionString: string;
  tlsEnabled: boolean;
  caCertPath?: string;
}): PoolConfig {
  if (!input.tlsEnabled) return { connectionString: input.connectionString };
  if (!input.caCertPath) {
    throw new Error('DATABASE_CA_CERT_PATH is required when DATABASE_TLS_ENABLED=true');
  }

  let ca: Buffer;
  try {
    ca = readFileSync(input.caCertPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read DATABASE_CA_CERT_PATH ${input.caCertPath}: ${detail}`);
  }

  return {
    connectionString: input.connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
  };
}

export async function initializeDatabase(): Promise<void> {
  if (db) return;

  const connectionString = appConfig.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  assertTestRuntimeDatabase(appConfig.NODE_ENV, connectionString);

  pool = new Pool(createDatabasePoolConfig({
    connectionString,
    tlsEnabled: appConfig.DATABASE_TLS_ENABLED,
    caCertPath: appConfig.DATABASE_CA_CERT_PATH,
  }));

  db = drizzle(pool, { schema });
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function getDatabasePool() {
  return pool;
}

/**
 * Register a process-local background task that must stop using the current
 * pool before it is closed. Hooks are keyed so module reloading and repeated
 * server creation replace stale registrations instead of accumulating them.
 */
export function registerDatabaseShutdownHook(name: string, hook: () => Promise<void> | void): void {
  if (!name.trim()) {
    throw new Error('Database shutdown hook name is required');
  }
  databaseShutdownHooks.set(name, hook);
}

export { schema };

export async function closeDatabase() {
  try {
    for (const hook of databaseShutdownHooks.values()) {
      await hook();
    }
  } finally {
    await pool?.end();
    pool = null;
    db = null;
  }
}
