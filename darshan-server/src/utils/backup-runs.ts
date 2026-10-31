import { spawn } from 'child_process';
import { promises as fs, createReadStream, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve, sep } from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { getDatabase, getDatabasePool, schema, type Database } from '@/db';
import { getS3Client, putFile } from '@/s3';
import { AppError } from '@/utils/app-error';
import { getResolvedPgDumpPath, getResolvedTarPath } from '@/utils/runtime-dependencies';
import { config as appConfig } from '@/config';
import {
  createOffHostBackupManifest,
  createOffHostBackupPolicy,
  getOffHostBackupClient,
  uploadOffHostFile,
  uploadOffHostManifest,
  verifyOffHostBackupManifest,
  type OffHostBackupManifest,
} from '@/utils/off-host-backup';
import { offHostBackupObjectKey } from '@/utils/off-host-backup-location';
import { BACKUP_OBJECT_SOURCES, isBackupObjectAllowed, type BackupObjectSource } from '@/deployment/backup-contract';
import { transitionBackupStage } from '@/backups/coordination';
import { openLocalRepository } from '@/backups/local-repository';
import { attachAbortTermination } from '@/backups/abortable-process';
import { runConsistentCapture } from '@/backups/consistent-capture';
import { requestConfigurationCapsule, type ConfigurationCapsuleContractEntry } from '@/backups/configuration-capsule';
import { runLocalEncryptedBackup } from '@/backups/local-backup-orchestrator';
import { runBrokeredEncryptedBackup, type BrokerWorkerSpool } from '@/backups/brokered-backup-orchestrator';
import type { BackupBrokerWorkerAdapter } from '@/backups/backup-broker-worker-adapter';
import type { BackupManifestSigner, BackupManifestVerifier } from '@/backups/manifest';
import { BackupError } from '@/backups/errors';
import { MaintenanceCoordinator } from '@/maintenance';
import { backupSchemaFingerprint } from '@/deployment/migration-ledger';

const ARCHIVE_BUCKET = 'archives';
const POSTGRES_BACKUP_CONTAINER = process.env.POSTGRES_BACKUP_CONTAINER?.trim() || 'darshan-postgres';
export type BackupRunRecord = typeof schema.backupRuns.$inferSelect;

async function ensureTempDir() {
  return fs.mkdtemp(join(tmpdir(), 'darshan-backup-'));
}

function formatBackupTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.replace(/\s+/g, ' ').trim();
  }

  return String(error).replace(/\s+/g, ' ').trim();
}

function isCommandNotFound(error: unknown) {
  return (
    error instanceof Error &&
    ((error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error.message.toLowerCase().includes('not found') ||
      error.message.toLowerCase().includes('is not available'))
  );
}

function parseDatabaseUrl() {
  const databaseUrl = appConfig.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required for PostgreSQL backups.');
  }

  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('DATABASE_URL must include a database name for PostgreSQL backups.');
  }

  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port || '5432',
    database,
  };
}

function resolveBackupPath(rootDir: string, objectKey: string) {
  const rootPath = resolve(rootDir);
  const targetPath = resolve(rootDir, objectKey);
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`Unsafe backup object key encountered: ${objectKey}`);
  }

  return targetPath;
}

async function runCommandToFile(params: {
  command: string;
  args: string[];
  outputPath: string;
  env?: NodeJS.ProcessEnv;
  label: string;
  signal: AbortSignal;
  gzip?: boolean;
}) {
  params.signal.throwIfAborted();
  const child = spawn(params.command, params.args, {
    env: params.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const termination = attachAbortTermination(child, params.signal);

  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });

  try {
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      child.once('spawn', () => resolveSpawn());
      child.once('error', (error) => rejectSpawn(error));
    });
  } catch (error) {
    termination.dispose();
    await termination.wait();
    const message = isCommandNotFound(error)
      ? `${params.label} is not available on this machine.`
      : `${params.label} failed to start: ${normalizeErrorMessage(error)}`;
    throw Object.assign(new Error(message), {
      cause: error,
      code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
    });
  }

  try {
    const output = createWriteStream(params.outputPath, { mode: 0o600 });
    const outputPipeline = params.gzip
      ? pipeline(child.stdout as NodeJS.ReadableStream, createGzip(), output, { signal: params.signal })
      : pipeline(child.stdout as NodeJS.ReadableStream, output, { signal: params.signal });
    await Promise.all([
      outputPipeline,
      new Promise<void>((resolveExit, rejectExit) => {
        child.once('close', (code) => {
          if (code === 0) resolveExit();
          else rejectExit(params.signal.aborted
            ? params.signal.reason
            : new Error(stderr.trim() || `${params.label} exited with code ${code}`));
        });
        child.once('error', rejectExit);
      }),
    ]);
  } finally {
    await termination.wait();
    termination.dispose();
  }
}

async function createPostgresCapture(backupDir: string, signal: AbortSignal) {
  const connection = parseDatabaseUrl();
  const timestamp = formatBackupTimestamp();
  const outputPath = join(backupDir, `darshan_postgres_${timestamp}.sql`);
  const pgDumpCommand = getResolvedPgDumpPath();
  const baseArgs = [
    '-h',
    connection.host,
    '-p',
    connection.port,
    '-U',
    connection.user,
    '-d',
    connection.database,
    '--verbose',
  ];
  const pgDumpEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PGPASSWORD: connection.password,
    ...(appConfig.DATABASE_TLS_ENABLED
      ? {
          PGSSLMODE: 'verify-full',
          PGSSLROOTCERT: appConfig.DATABASE_CA_CERT_PATH,
        }
      : {}),
  };

  if (pgDumpCommand) {
    try {
      await runCommandToFile({
        command: pgDumpCommand,
        args: baseArgs,
        outputPath,
        env: pgDumpEnv,
        label: 'pg_dump',
        signal,
      });
      return outputPath;
    } catch (error) {
      if (!isCommandNotFound(error)) {
        throw new Error(`PostgreSQL backup failed: ${normalizeErrorMessage(error)}`);
      }
    }
  }

  try {
    await runCommandToFile({
      command: 'docker',
      args: [
        'exec',
        '-i',
        '-e',
        `PGPASSWORD=${connection.password}`,
        POSTGRES_BACKUP_CONTAINER,
        'pg_dump',
        '-U',
        connection.user,
        '-d',
        connection.database,
        '--verbose',
      ],
      outputPath,
      env: pgDumpEnv,
      label: `docker exec ${POSTGRES_BACKUP_CONTAINER} pg_dump`,
      signal,
    });
    return outputPath;
  } catch (error) {
    throw new Error(
      `PostgreSQL backup failed: pg_dump is not installed or could not be executed from PG_DUMP_PATH/PATH, and docker fallback via "${POSTGRES_BACKUP_CONTAINER}" could not run. ${normalizeErrorMessage(error)}`
    );
  }
}

async function downloadBucketObjects(source: BackupObjectSource, destinationDir: string, signal: AbortSignal) {
  const client = getS3Client();
  let continuationToken: string | undefined;

  do {
    signal.throwIfAborted();
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: source.bucket,
        Prefix: source.prefix,
        ContinuationToken: continuationToken,
      }),
      { abortSignal: signal }
    );

    for (const object of response.Contents ?? []) {
      if (!object.Key) continue;

      if (object.Key.endsWith('/')) {
        const directoryKey = object.Key.slice(0, -1);
        if (!isBackupObjectAllowed(source.bucket, directoryKey)) {
          throw new Error(`Object key is outside the versioned backup contract: ${source.bucket}/${JSON.stringify(object.Key)}`);
        }
        await fs.mkdir(resolveBackupPath(destinationDir, directoryKey), { recursive: true, mode: 0o700 });
        continue;
      }
      if (!isBackupObjectAllowed(source.bucket, object.Key)) {
        throw new Error(`Object key is outside the versioned backup contract: ${source.bucket}/${JSON.stringify(object.Key)}`);
      }

      const targetPath = resolveBackupPath(destinationDir, object.Key);
      await fs.mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });

      const objectResponse = await client.send(
        new GetObjectCommand({
          Bucket: source.bucket,
          Key: object.Key,
        }),
        { abortSignal: signal }
      );

      if (!objectResponse.Body) {
        throw new Error(`Received empty body while backing up ${source.bucket}/${object.Key}`);
      }

      await pipeline(objectResponse.Body as NodeJS.ReadableStream, createWriteStream(targetPath, { mode: 0o600 }), { signal });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function estimateObjectStorageBackupBytes(signal: AbortSignal) {
  const client = getS3Client();
  let total = 0;
  for (const source of BACKUP_OBJECT_SOURCES) {
    let continuationToken: string | undefined;
    do {
      signal.throwIfAborted();
      const response = await client.send(new ListObjectsV2Command({
        Bucket: source.bucket,
        Prefix: source.prefix,
        ContinuationToken: continuationToken,
      }), { abortSignal: signal });
      for (const object of response.Contents ?? []) {
        const size = object.Size ?? 0;
        if (!Number.isSafeInteger(size) || size < 0 || total > Number.MAX_SAFE_INTEGER - size) {
          throw new Error('Object storage backup size cannot be safely estimated.');
        }
        total += size;
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
  }
  return total;
}

async function estimatePostgresBackupBytes() {
  const db = getDatabase();
  const result = await db.execute(sql`SELECT pg_database_size(current_database())::text AS bytes`);
  const row = (result as { rows?: Array<{ bytes?: unknown }> }).rows?.[0];
  const value = Number(row?.bytes);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('PostgreSQL backup size cannot be safely estimated.');
  }
  return value;
}

/**
 * Object backup creation mirrors source objects and then writes a compressed
 * tar. Reserve both possible representations plus the database dump before
 * doing any write; this turns an otherwise partial disk-full archive into a
 * deterministic failed run with a usable error message.
 */
export function calculateBackupWorkspaceRequiredBytes(objectBytes: number, databaseBytes: number, configurationBytes = 0) {
  if (!Number.isSafeInteger(objectBytes) || objectBytes < 0 || !Number.isSafeInteger(databaseBytes) || databaseBytes < 0 ||
      !Number.isSafeInteger(configurationBytes) || configurationBytes < 0) {
    throw new Error('Backup workspace inputs must be safe non-negative byte counts.');
  }
  // The local flow deliberately builds all three plaintext packages before it
  // encrypts them. At peak, raw capture + all packages + the current age
  // ciphertext coexist. Reserve 2x the total plus one largest component for
  // ciphertext, with one GiB for age/tar metadata and estimation drift.
  const total = objectBytes + databaseBytes + configurationBytes;
  const required = total * 2 + Math.max(objectBytes, databaseBytes, configurationBytes) + 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(required)) throw new Error('Backup workspace requirement exceeds supported byte precision.');
  return required;
}

async function assertBackupWorkspaceCapacity(backupDir: string, signal: AbortSignal, configurationBytes = 0) {
  const [objectBytes, databaseBytes, fileSystem] = await Promise.all([
    estimateObjectStorageBackupBytes(signal),
    estimatePostgresBackupBytes(),
    fs.statfs(backupDir),
  ]);
  const available = Number(fileSystem.bavail) * Number(fileSystem.bsize);
  // Each raw capture can coexist with its package. One GiB covers metadata,
  // temporary files, and small changes between the estimate and the barrier.
  const required = calculateBackupWorkspaceRequiredBytes(objectBytes, databaseBytes, configurationBytes);
  if (!Number.isSafeInteger(available) || !Number.isSafeInteger(required) || available < required) {
    throw new Error(
      `Insufficient free space for a safe backup workspace: requires at least ${required} bytes, but only ${available} bytes are available on the temporary filesystem.`
    );
  }
}

async function runAbortableCommand(command: string, args: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const child = spawn(command, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const termination = attachAbortTermination(child, signal);
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-64 * 1024); });
  try {
    await new Promise<void>((resolveCommand, rejectCommand) => {
      child.once('error', rejectCommand);
      child.once('close', (code) => {
        if (code === 0) resolveCommand();
        else rejectCommand(signal.aborted ? signal.reason : new Error(stderr.trim() || `Command exited with code ${code}`));
      });
    });
  } finally {
    await termination.wait();
    termination.dispose();
  }
}

async function createObjectStorageCapture(backupDir: string, signal: AbortSignal) {
  const mirrorRoot = join(backupDir, 'minio-export');

  await fs.mkdir(mirrorRoot, { recursive: true, mode: 0o700 });

  for (const source of BACKUP_OBJECT_SOURCES) {
    signal.throwIfAborted();
    const bucketDir = join(mirrorRoot, source.bucket);
    await fs.mkdir(bucketDir, { recursive: true, mode: 0o700 });
    await downloadBucketObjects(source, bucketDir, signal);
  }

  return mirrorRoot;
}

async function packagePostgresCapture(inputPath: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const outputPath = `${inputPath}.gz`;
  await pipeline(createReadStream(inputPath), createGzip(), createWriteStream(outputPath, { mode: 0o600 }), { signal });
  await fs.rm(inputPath, { force: true });
  return outputPath;
}

async function packageObjectStorageCapture(backupDir: string, mirrorRoot: string, signal: AbortSignal) {
  const timestamp = formatBackupTimestamp();
  const outputPath = join(backupDir, `darshan_minio_${timestamp}.tar.gz`);
  const tarCommand = getResolvedTarPath();

  if (!tarCommand) {
    throw new Error('Object storage backup failed: tar is not available. Install tar or set TAR_PATH to the executable.');
  }

  try {
    await runAbortableCommand(tarCommand, ['-czf', outputPath, '-C', mirrorRoot, '.'], signal);
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw new Error('Object storage backup failed: tar is not available. Install tar or set TAR_PATH to the executable.');
    }

    throw new Error(`Object storage backup failed: ${normalizeErrorMessage(error)}`);
  }

  await fs.rm(mirrorRoot, { recursive: true, force: true });
  return outputPath;
}

export async function markBackupRunCompleted(
  runId: string,
  attemptId: string,
  files: Array<{
    bucket: string;
    object_key: string;
    name: string;
    size: number;
    content_type: string;
    storage_object_id: string;
  }>,
  offHostManifest?: OffHostBackupManifest,
  dependencies: { db?: Database } = {}
) {
  const db = dependencies.db ?? getDatabase();
  return db.transaction(async (tx) => {
    // PostgreSQL may evaluate an UPDATE predicate before waiting for its row
    // lock and keep that stale truth value when the blocker made no row change.
    // Lock first, then execute a fresh database-clock authority statement.
    await tx.execute(sql`SELECT id FROM ${schema.backupRuns} WHERE ${schema.backupRuns.id} = ${runId} FOR UPDATE`);
    const updated = await tx.update(schema.backupRuns).set({
      status: 'COMPLETED',
      stage: 'COMPLETED',
      completed_at: sql`clock_timestamp()`,
      captured_at: sql`(
        select ${schema.backupCaptures.sealed_at}
        from ${schema.backupCaptures}
        where ${schema.backupCaptures.backup_run_id} = ${runId}
          and ${schema.backupCaptures.backup_attempt_id} = ${attemptId}
          and ${schema.backupCaptures.status} = 'SEALED'
        order by ${schema.backupCaptures.sealed_at} desc
        limit 1
      )`,
      verified_at: sql`clock_timestamp()`,
      lease_expires_at: null,
      updated_at: sql`clock_timestamp()`,
      files,
      off_host_manifest: offHostManifest ?? null,
      error_message: null,
    }).where(and(
      eq(schema.backupRuns.id, runId),
      eq(schema.backupRuns.attempt_id, attemptId),
      eq(schema.backupRuns.status, 'RUNNING'),
      isNull(schema.backupRuns.cancellation_requested_at),
      sql`${schema.backupRuns.lease_expires_at} > clock_timestamp()`,
      sql`${schema.backupRuns.deadline_at} > clock_timestamp()`,
      sql`exists (
        select 1 from ${schema.backupCaptures}
        where ${schema.backupCaptures.backup_run_id} = ${runId}
          and ${schema.backupCaptures.backup_attempt_id} = ${attemptId}
          and ${schema.backupCaptures.status} = 'SEALED'
      )`
    )).returning({ id: schema.backupRuns.id });
    return updated.length > 0;
  });
}

export async function getLatestBackupRun() {
  const db = getDatabase();
  const [row] = await db
    .select()
    .from(schema.backupRuns)
    .orderBy(desc(schema.backupRuns.created_at))
    .limit(1);
  return row ?? null;
}

/** @deprecated Hard deletion is permanently disabled; use durable retention admission. */
export async function deleteBackupRun(runId: string) {
  throw new AppError({ statusCode: 409, code: 'BACKUP_HARD_DELETE_DISABLED',
    message: 'Backup history and artifacts cannot be hard-deleted.', details: { backup_run_id: runId } });
}

export type LocalBackupRuntimeDependencies = {
  protocol: 'V1_HELPER';
  createManifestAuthority(signal: AbortSignal): {
    signer: BackupManifestSigner;
    verifier: BackupManifestVerifier;
  };
  configurationContract: readonly ConfigurationCapsuleContractEntry[];
} | {
  protocol: 'V2_BROKER';
  broker: BackupBrokerWorkerAdapter;
  spool: BrokerWorkerSpool;
};

async function readBackupSchemaIdentity() {
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  const result = await pool.query<{ migration_id: string; checksum_sha256: string }>(
    `SELECT migration_id, checksum_sha256 FROM darshan_schema_migrations ORDER BY migration_id ASC`
  );
  if (result.rows.length === 0) throw new Error('Backup schema identity is unavailable because the migration ledger is empty.');
  return {
    migrationId: result.rows[result.rows.length - 1].migration_id,
    fingerprintSha256: backupSchemaFingerprint(result.rows.map((entry) => ({
      id: entry.migration_id,
      checksum: entry.checksum_sha256,
    }))),
  };
}

export async function runFullBackup(
  runId: string,
  attemptId: string,
  deadlineAt: Date,
  signal: AbortSignal,
  localRuntime?: LocalBackupRuntimeDependencies,
) {
  const db = getDatabase();
  let backupDir: string | null = null;

  try {
    signal.throwIfAborted();
    if (appConfig.NODE_ENV === 'production' && appConfig.BACKUP_REPOSITORY_KIND === 'LOCAL_FILESYSTEM') {
      if (!localRuntime) {
        throw new BackupError('BACKUP_MANIFEST_SIGNATURE_REQUIRED', 'LOCAL_FILESYSTEM production runtime is not configured.');
      }
      const pool = getDatabasePool();
      if (!pool) throw new Error('Database pool is not initialized.');
      const coordinator = new MaintenanceCoordinator(pool);
      const tarExecutable = getResolvedTarPath();
      if (!tarExecutable) throw new Error('Object storage backup failed: tar is not available. Install tar or set TAR_PATH to the executable.');
      const schemaIdentity = await readBackupSchemaIdentity();
      if (localRuntime.protocol === 'V2_BROKER') {
        await assertBackupWorkspaceCapacity(localRuntime.spool.root, signal);
        await runBrokeredEncryptedBackup({ runId, attemptId, deadlineAt, siteId: appConfig.BACKUP_SITE_ID!,
          releaseId: appConfig.DARSHAN_RELEASE_ID, schema: schemaIdentity,
          encryption: { recipient: appConfig.BACKUP_ENCRYPTION_RECIPIENT!, keyId: appConfig.BACKUP_ENCRYPTION_KEY_ID!,
            executablePath: appConfig.AGE_PATH, executableSha256: appConfig.AGE_SHA256!.toLowerCase(), version: appConfig.AGE_VERSION! },
          tarExecutablePath: tarExecutable, signal }, {
          coordinator, broker: localRuntime.broker, spool: localRuntime.spool, pool,
          transitionStage: async (stage) => { if (!await transitionBackupStage(runId, attemptId, stage)) throw new Error('Backup attempt lease is no longer valid.'); },
          captureDatabase: async (destinationRoot, captureSignal) => {
            if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_DATABASE')) throw new Error('Backup attempt lease is no longer valid.');
            await createPostgresCapture(destinationRoot, captureSignal);
          },
          captureObjects: async (destinationRoot, captureSignal) => {
            if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_OBJECTS')) throw new Error('Backup attempt lease is no longer valid.');
            await createObjectStorageCapture(destinationRoot, captureSignal);
          },
          readSealedCapture: async (identity) => {
            const result = await pool.query<{ id: string; generation: string; started_at: Date; sealed_at: Date; staging_inventory_digest: string }>(
              `SELECT id, generation::text, started_at, sealed_at, staging_inventory_digest FROM backup_captures
               WHERE id = $1 AND backup_run_id = $2 AND backup_attempt_id = $3 AND status = 'SEALED'`,
              [identity.captureId, identity.backupRunId, identity.backupAttemptId]);
            const capture = result.rows[0];
            if (!capture?.sealed_at || !capture.staging_inventory_digest) throw new Error('Sealed capture evidence is unavailable.');
            return { id: capture.id, generation: Number(capture.generation), startedAt: capture.started_at,
              sealedAt: capture.sealed_at, stagingInventorySha256: capture.staging_inventory_digest };
          },
        });
        return;
      }
      const repository = await openLocalRepository({
        root: appConfig.BACKUP_REPOSITORY_ROOT!,
        expectedDeviceId: appConfig.BACKUP_REPOSITORY_DEVICE_ID!,
        ownerUid: appConfig.BACKUP_REPOSITORY_OWNER_UID!,
        ownerGid: appConfig.BACKUP_REPOSITORY_OWNER_GID!,
        minimumFreeBytes: appConfig.BACKUP_REPOSITORY_MIN_FREE_BYTES!,
        expectedSiteId: appConfig.BACKUP_SITE_ID!,
        expectedRepositoryId: appConfig.BACKUP_REPOSITORY_ID!,
      });
      // The repository itself is the protected workspace. Capacity validation
      // happens before mutation admission closes and never redirects to /tmp.
      const configurationBytes = localRuntime.configurationContract.reduce((total, entry) => total + entry.maxBytes, 0n);
      if (configurationBytes > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new BackupError('BACKUP_CAPACITY_EXHAUSTED', 'Configuration capsule capacity contract exceeds safe byte accounting.');
      }
      await assertBackupWorkspaceCapacity(repository.root, signal, Number(configurationBytes));
      const manifestAuthority = localRuntime.createManifestAuthority(signal);
      await runLocalEncryptedBackup({
        repository,
        runId,
        attemptId,
        siteId: appConfig.BACKUP_SITE_ID!,
        releaseId: appConfig.DARSHAN_RELEASE_ID,
        schema: schemaIdentity,
        encryption: {
          recipient: appConfig.BACKUP_ENCRYPTION_RECIPIENT!,
          keyId: appConfig.BACKUP_ENCRYPTION_KEY_ID!,
          executablePath: appConfig.AGE_PATH,
          executableSha256: appConfig.AGE_SHA256!.toLowerCase(),
          version: appConfig.AGE_VERSION!,
        },
        tarExecutablePath: tarExecutable,
        signal,
      }, {
        coordinator,
        signer: manifestAuthority.signer,
        verifier: manifestAuthority.verifier,
        pool,
        transitionStage: async (stage) => {
          if (!await transitionBackupStage(runId, attemptId, stage)) {
            throw new Error('Backup attempt lease is no longer valid.');
          }
        },
        captureDatabase: async (destinationRoot, captureSignal) => {
          if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_DATABASE')) throw new Error('Backup attempt lease is no longer valid.');
          await createPostgresCapture(destinationRoot, captureSignal);
        },
        captureObjects: async (destinationRoot, captureSignal) => {
          if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_OBJECTS')) throw new Error('Backup attempt lease is no longer valid.');
          await createObjectStorageCapture(destinationRoot, captureSignal);
        },
        captureConfiguration: async ({ destinationRoot, siteId, runId: captureRunId, attemptId: captureAttemptId, signal: captureSignal }) => {
          if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_CONFIGURATION')) throw new Error('Backup attempt lease is no longer valid.');
          const result = await requestConfigurationCapsule({
            helperPath: appConfig.BACKUP_CAPSULE_HELPER_PATH!,
            expectedHelperVersion: appConfig.BACKUP_CAPSULE_HELPER_VERSION!,
            expectedHelperSha256: appConfig.BACKUP_CAPSULE_HELPER_SHA256!.toLowerCase(),
            siteId,
            runId: captureRunId,
            attemptId: captureAttemptId,
            destinationRoot,
            allowedDestinationRoot: repository.root,
            contract: localRuntime.configurationContract,
            signal: captureSignal,
          });
          return result.receipt;
        },
        readSealedCapture: async (identity) => {
          const result = await pool.query<{
            id: string; generation: string; started_at: Date; sealed_at: Date; staging_inventory_digest: string;
          }>(
            `SELECT id, generation::text, started_at, sealed_at, staging_inventory_digest
             FROM backup_captures
             WHERE id = $1 AND backup_run_id = $2 AND backup_attempt_id = $3 AND status = 'SEALED'`,
            [identity.captureId, identity.backupRunId, identity.backupAttemptId]
          );
          const capture = result.rows[0];
          if (!capture?.sealed_at || !capture.staging_inventory_digest) throw new Error('Sealed capture evidence is unavailable.');
          return {
            id: capture.id,
            generation: Number(capture.generation),
            startedAt: capture.started_at,
            sealedAt: capture.sealed_at,
            stagingInventorySha256: capture.staging_inventory_digest,
          };
        },
      });
      return;
    }
    backupDir = await ensureTempDir();
    // Capacity checks happen before admission closes. They are conservative
    // read-only estimates and must not consume the five-minute CMS pause.
    await assertBackupWorkspaceCapacity(backupDir, signal);
    const pool = getDatabasePool();
    if (!pool) throw new Error('Database pool is not initialized.');
    const coordinator = new MaintenanceCoordinator(pool);
    let postgresCapturePath = '';
    let objectCaptureRoot = '';
    await runConsistentCapture({
      coordinator,
      siteKey: appConfig.BACKUP_SITE_ID ?? 'local',
      backupRunId: runId,
      backupAttemptId: attemptId,
      stagingRoot: backupDir,
      signal,
      copyIntoStaging: async () => {
        if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_DATABASE')) {
          throw new Error('Backup attempt lease is no longer valid.');
        }
        postgresCapturePath = await createPostgresCapture(backupDir!, signal);
        if (!await transitionBackupStage(runId, attemptId, 'CAPTURING_OBJECTS')) {
          throw new Error('Backup attempt lease is no longer valid.');
        }
        objectCaptureRoot = await createObjectStorageCapture(backupDir!, signal);
      },
    });

    // Compression is intentionally outside the capture barrier. The sealed
    // digest still describes the raw staged database/object bytes.
    if (!postgresCapturePath || !objectCaptureRoot) {
      throw new Error('Consistent capture did not produce every required staging component.');
    }
    if (!await transitionBackupStage(runId, attemptId, 'PACKAGING')) {
      throw new Error('Backup attempt lease is no longer valid.');
    }
    await packagePostgresCapture(postgresCapturePath, signal);
    await packageObjectStorageCapture(backupDir, objectCaptureRoot, signal);

    const entries = await fs.readdir(backupDir);
    const files = [] as Array<{
      bucket: string;
      object_key: string;
      name: string;
      size: number;
      content_type: string;
      storage_object_id: string;
    }>;
    // Development and QA retain the existing local-archive behavior. A
    // production run is not marked complete until a verified independent copy
    // and its checksum manifest exist at the signed off-host destination.
    const offHostEnabled = appConfig.NODE_ENV === 'production' && appConfig.BACKUP_REPOSITORY_KIND === 'LEGACY_OFF_HOST';
    const offHostPolicy = offHostEnabled ? createOffHostBackupPolicy({
      destination: appConfig.BACKUP_OFFHOST_DESTINATION ?? '',
      endpoint: appConfig.BACKUP_OFFHOST_ENDPOINT ?? '',
      region: appConfig.BACKUP_OFFHOST_REGION ?? '',
      accessKeyId: appConfig.BACKUP_OFFHOST_ACCESS_KEY ?? '',
      secretAccessKey: appConfig.BACKUP_OFFHOST_SECRET_KEY ?? '',
      intervalHours: appConfig.BACKUP_INTERVAL_HOURS ?? 0,
      retentionDays: appConfig.BACKUP_RETENTION_DAYS ?? 0,
    }) : null;
    const offHostClient = offHostPolicy ? getOffHostBackupClient(offHostPolicy) : null;
    const offHostTimestamp = formatBackupTimestamp();
    const offHostArtifacts = [] as OffHostBackupManifest['files'];

    if (!await transitionBackupStage(runId, attemptId, 'PUBLISHING')) {
      throw new Error('Backup attempt lease is no longer valid.');
    }
    for (const entry of entries) {
      signal.throwIfAborted();
      const filePath = join(backupDir, entry);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;

      const objectKey = `backups/${runId}/${basename(filePath)}`;
      const upload = await putFile(ARCHIVE_BUCKET, objectKey, filePath, 'application/gzip', { signal });
      signal.throwIfAborted();
      const [storageObject] = await db
        .insert(schema.storageObjects)
        .values({
          bucket: ARCHIVE_BUCKET,
          object_key: objectKey,
          content_type: 'application/gzip',
          size: stat.size,
          sha256: upload.sha256,
        })
        .returning();

      files.push({
        bucket: ARCHIVE_BUCKET,
        object_key: objectKey,
        name: basename(filePath),
        size: stat.size,
        content_type: 'application/gzip',
        storage_object_id: storageObject.id,
      });

      if (offHostClient && offHostPolicy) {
        const remoteKey = offHostBackupObjectKey(
          offHostPolicy.location,
          `runs/${offHostTimestamp}-${runId}/${basename(filePath)}`
        );
        offHostArtifacts.push(
          await uploadOffHostFile(offHostClient, {
            bucket: offHostPolicy.location.bucket,
            key: remoteKey,
            filePath,
            contentType: 'application/gzip',
            signal,
          })
        );
      }
    }

    let offHostManifest: OffHostBackupManifest | undefined;
    if (offHostClient && offHostPolicy) {
      signal.throwIfAborted();
      if (offHostArtifacts.length === 0) {
        throw new Error('Backup did not produce any archives for the required off-host destination.');
      }

      offHostManifest = createOffHostBackupManifest({
        runId,
        timestamp: offHostTimestamp,
        artifacts: offHostArtifacts,
        location: offHostPolicy.location,
        endpoint: offHostPolicy.endpoint,
        intervalHours: offHostPolicy.intervalHours,
        retentionDays: offHostPolicy.retentionDays,
        releaseId: appConfig.DARSHAN_RELEASE_ID,
      });
      await uploadOffHostManifest(offHostClient, offHostPolicy.location, offHostManifest, signal);
      await verifyOffHostBackupManifest(offHostClient, offHostPolicy.location, offHostManifest, signal);
      signal.throwIfAborted();
    }

    if (!await markBackupRunCompleted(runId, attemptId, files, offHostManifest)) {
      throw new Error('Backup attempt expired or was superseded before completion.');
    }
  } finally {
    if (backupDir) await fs.rm(backupDir, { recursive: true, force: true });
  }
}
