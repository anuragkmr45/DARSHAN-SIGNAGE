import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { sql } from 'drizzle-orm';
import { config as appConfig } from '@/config';
import { getDatabase, getDatabasePool } from '@/db';
import { loadMigrationManifest } from '@/deployment/migration-ledger';
import { PRODUCTION_BUCKETS } from '@/deployment/storage-buckets';
import { ValkeyCommandClient } from '@/realtime/valkey-resp-client';
import { getS3Client } from '@/s3';
import { getCurrentWorkerHeartbeat } from '@/runtime/worker-heartbeat';

export type ReadinessState = 'ok' | 'failed' | 'not_required';
export type ReadinessReport = {
  ready: boolean;
  timestamp: string;
  checks: Record<'database' | 'migrations' | 'bootstrap' | 'minio' | 'valkey' | 'worker', ReadinessState>;
};

function failed<T>(operation: Promise<T>): Promise<ReadinessState> {
  return operation.then(() => 'ok' as const).catch(() => 'failed' as const);
}

async function verifyMigrationLedger() {
  const manifest = await loadMigrationManifest();
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized');
  const rows = await pool.query<{ migration_id: string; checksum_sha256: string }>(
    'SELECT migration_id, checksum_sha256 FROM darshan_schema_migrations'
  );
  if (rows.rows.length !== manifest.length) throw new Error('Migration ledger is incomplete');
  const applied = new Map(rows.rows.map((row) => [row.migration_id, row.checksum_sha256]));
  if (manifest.some((migration) => applied.get(migration.id) !== migration.checksum)) {
    throw new Error('Migration ledger checksum mismatch');
  }
}

async function verifyBootstrap() {
  const result = await getDatabase().execute(sql`
    SELECT 1
    FROM production_bootstrap_states bootstrap
    INNER JOIN users administrator ON administrator.id = bootstrap.admin_user_id
    INNER JOIN roles role ON role.id = administrator.role_id
    WHERE bootstrap.id = 'production'
      AND administrator.is_active = true
      AND role.name = 'SUPER_ADMIN'
  `);
  const rows = (result as { rows?: unknown[] }).rows ?? [];
  if (rows.length !== 1) throw new Error('Production bootstrap state is invalid');
}

async function verifyMinio() {
  const s3 = getS3Client();
  await Promise.all(
    PRODUCTION_BUCKETS.map((bucket) =>
      s3.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(2_000) })
    )
  );
}

async function verifyValkey(): Promise<ReadinessState> {
  if (appConfig.REALTIME_BUS_PROVIDER !== 'valkey' && appConfig.LOGIN_THROTTLE_PROVIDER !== 'valkey') {
    return 'not_required';
  }
  let client: ValkeyCommandClient | null = null;
  try {
    client = new ValkeyCommandClient({
      url: appConfig.VALKEY_URL,
      tlsEnabled: appConfig.VALKEY_TLS_ENABLED,
      caCertPath: appConfig.VALKEY_CA_CERT_PATH,
      commandTimeoutMs: Math.min(appConfig.REALTIME_VALKEY_PUBLISH_TIMEOUT_MS, 2_000),
    });
    if ((await client.command(['PING'])) !== 'PONG') throw new Error('Unexpected Valkey PING response');
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    await client?.close();
  }
}

async function verifyWorker() {
  const heartbeat = await getCurrentWorkerHeartbeat();
  if (!heartbeat || heartbeat.release_id !== appConfig.DARSHAN_RELEASE_ID) throw new Error('Worker heartbeat is absent or from another release');
  if (Date.now() - heartbeat.observed_at.getTime() > appConfig.WORKER_HEARTBEAT_STALE_MS) {
    throw new Error('Worker heartbeat is stale');
  }
}

export async function collectReadiness(): Promise<ReadinessReport> {
  const [database, migrations, bootstrap, minio, valkey, worker] = await Promise.all([
    failed(getDatabase().execute(sql`SELECT 1`)),
    failed(verifyMigrationLedger()),
    failed(verifyBootstrap()),
    failed(verifyMinio()),
    verifyValkey(),
    failed(verifyWorker()),
  ]);
  const checks = { database, migrations, bootstrap, minio, valkey, worker };
  return {
    ready: Object.values(checks).every((state) => state === 'ok' || state === 'not_required'),
    timestamp: new Date().toISOString(),
    checks,
  };
}
