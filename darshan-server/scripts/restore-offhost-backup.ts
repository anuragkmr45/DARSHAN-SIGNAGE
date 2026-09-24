import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createHash, createSign } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, opendir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { program } from 'commander';
import { BACKUP_BUCKETS, isBackupObjectAllowed } from '../src/deployment/backup-contract.js';
import {
  createOffHostBackupPolicy,
  downloadVerifiedOffHostArtifact,
  getOffHostBackupClient,
  readOffHostManifest,
  verifyOffHostBackupManifest,
  type OffHostBackupArtifact,
} from '../src/utils/off-host-backup.js';

async function readProtectedFile(filePath: string, label: string) {
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o007) !== 0) {
    throw new Error(`${label} must be a regular file that is not readable by other users.`);
  }
  const value = (await readFile(filePath, 'utf8')).replace(/\r?\n$/, '');
  if (!value) throw new Error(`${label} is empty.`);
  return value;
}

function normalizedEndpoint(value: string) {
  const url = new URL(value);
  const port = url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');
  return `${url.protocol}//${url.hostname.toLowerCase()}:${port}${url.pathname.replace(/\/$/, '')}`;
}

async function resolvedAddresses(hostname: string) {
  return new Set((await lookup(hostname, { all: true })).map((entry) => entry.address));
}

async function assertIsolatedRecoveryTargets(input: {
  targetDatabaseUrl: string;
  targetS3Endpoint: string;
  productionDatabaseHost: string;
  productionDatabasePort: string;
  productionDatabaseName: string;
  productionS3Endpoint: string;
}) {
  const productionDatabaseHost = input.productionDatabaseHost.toLowerCase();
  const productionDatabasePort = input.productionDatabasePort || '5432';
  const productionDatabaseName = input.productionDatabaseName.replace(/^\//, '');
  if (!productionDatabaseHost || !productionDatabaseName || !/^\d{1,5}$/.test(productionDatabasePort)) {
    throw new Error('Signed production database identity is invalid.');
  }
  const targetDatabase = new URL(input.targetDatabaseUrl);
  const targetDatabaseName = decodeURIComponent(targetDatabase.pathname.slice(1));
  const productionAddresses = await resolvedAddresses(productionDatabaseHost);
  const targetAddresses = await resolvedAddresses(targetDatabase.hostname);
  const databaseAddressOverlap = [...targetAddresses].some((address) => productionAddresses.has(address));
  const databaseMatches =
    (productionDatabaseHost === targetDatabase.hostname.toLowerCase() || databaseAddressOverlap) &&
    productionDatabasePort === (targetDatabase.port || '5432') &&
    productionDatabaseName === targetDatabaseName;
  if (databaseMatches) throw new Error('Recovery target database resolves to the configured production database.');

  const productionObjectEndpoint = new URL(input.productionS3Endpoint);
  const targetObjectEndpoint = new URL(input.targetS3Endpoint);
  const productionObjectAddresses = await resolvedAddresses(productionObjectEndpoint.hostname);
  const targetObjectAddresses = await resolvedAddresses(targetObjectEndpoint.hostname);
  const objectAddressOverlap = [...targetObjectAddresses].some((address) => productionObjectAddresses.has(address));
  if (
    normalizedEndpoint(input.targetS3Endpoint) === normalizedEndpoint(input.productionS3Endpoint) ||
    (objectAddressOverlap &&
      (targetObjectEndpoint.port || '443') === (productionObjectEndpoint.port || '443') &&
      targetObjectEndpoint.pathname.replace(/\/$/, '') === productionObjectEndpoint.pathname.replace(/\/$/, ''))
  ) {
    throw new Error('Recovery target S3 endpoint resolves to the configured production object store.');
  }
}

function targetS3Client(input: { endpoint: string; region: string; accessKeyId: string; secretAccessKey: string }) {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Recovery target S3 endpoint must be a credential-free HTTPS URL.');
  }
  return new S3Client({
    endpoint: input.endpoint,
    region: input.region,
    forcePathStyle: true,
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
  });
}

async function ensureEmptyTargetBucket(client: S3Client, bucket: string) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } else {
      throw error;
    }
  }
  const objects = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
  if ((objects.Contents?.length ?? 0) > 0) {
    throw new Error(`Recovery target bucket ${bucket} is not empty. Restore requires a clean recovery target.`);
  }
}

function databaseConnection(urlValue: string) {
  const url = new URL(urlValue);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname || url.pathname === '/') {
    throw new Error('Recovery target database URL must be a PostgreSQL URL with a database name.');
  }
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    sslMode: url.searchParams.get('sslmode'),
    sslRootCert: url.searchParams.get('sslrootcert'),
  };
}

async function waitFor(child: ReturnType<typeof spawn>, label: string) {
  const code = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', resolveExit);
  });
  if (code !== 0) throw new Error(`${label} exited with code ${code ?? 'unknown'}.`);
}

async function restoreDatabase(archivePath: string, targetUrl: string) {
  const target = databaseConnection(targetUrl);
  const gzip = spawn('gzip', ['-dc', archivePath], { stdio: ['ignore', 'pipe', 'inherit'] });
  const psql = spawn('psql', [
    '--no-password',
    '--set', 'ON_ERROR_STOP=1',
    '--single-transaction',
    '-h', target.host,
    '-p', target.port,
    '-U', target.user,
    '-d', target.database,
  ], {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PGPASSWORD: target.password,
      ...(target.sslMode ? { PGSSLMODE: target.sslMode } : {}),
      ...(target.sslRootCert ? { PGSSLROOTCERT: target.sslRootCert } : {}),
    },
  });
  await Promise.all([pipeline(gzip.stdout!, psql.stdin!), waitFor(gzip, 'gzip'), waitFor(psql, 'psql')]);
}

async function assertEmptyTargetDatabase(targetUrl: string) {
  const target = databaseConnection(targetUrl);
  const psql = spawn('psql', [
    '--no-password',
    '-Atqc',
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'",
    '-h', target.host,
    '-p', target.port,
    '-U', target.user,
    '-d', target.database,
  ], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      PGPASSWORD: target.password,
      ...(target.sslMode ? { PGSSLMODE: target.sslMode } : {}),
      ...(target.sslRootCert ? { PGSSLROOTCERT: target.sslRootCert } : {}),
    },
  });
  const stdout: Buffer[] = [];
  psql.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  await waitFor(psql, 'psql target preflight');
  if (Number(Buffer.concat(stdout).toString('utf8').trim()) !== 0) {
    throw new Error('Recovery target database is not empty. Restore requires a clean recovery database.');
  }
}

function safeTarPath(entry: string) {
  const normalized = entry.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized) return null;
  if (normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Backup archive contains an unsafe path: ${entry}`);
  }
  return normalized;
}

async function runCommand(command: string, args: string[], label: string) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  const stdout: Buffer[] = [];
  child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  await waitFor(child, label);
  return Buffer.concat(stdout).toString('utf8');
}

function postgresEnvironment(targetUrl: string) {
  const target = databaseConnection(targetUrl);
  return {
    target,
    env: {
      ...process.env,
      PGPASSWORD: target.password,
      ...(target.sslMode ? { PGSSLMODE: target.sslMode } : {}),
      ...(target.sslRootCert ? { PGSSLROOTCERT: target.sslRootCert } : {}),
    },
  };
}

async function runTargetSql(targetUrl: string, sqlText: string, label: string) {
  const { target, env } = postgresEnvironment(targetUrl);
  const child = spawn('psql', [
    '--no-password',
    '--set', 'ON_ERROR_STOP=1',
    '-Atqc', sqlText,
    '-h', target.host,
    '-p', target.port,
    '-U', target.user,
    '-d', target.database,
  ], { stdio: ['ignore', 'pipe', 'inherit'], env });
  const stdout: Buffer[] = [];
  child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  await waitFor(child, label);
  return Buffer.concat(stdout).toString('utf8').trim();
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const directory = await opendir(root);
  for await (const entry of directory) {
    const filePath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(filePath));
    else if (entry.isFile()) files.push(filePath);
    else throw new Error(`Recovery archive contains a non-regular entry: ${filePath}`);
  }
  return files;
}

type PreparedRecoveryObject = {
  bucket: string;
  key: string;
  filePath: string;
  size: number;
  sha256: string;
};

async function hashFile(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareObjectStorageArchive(archivePath: string, workDir: string): Promise<PreparedRecoveryObject[]> {
  const listing = await runCommand('tar', ['-tzf', archivePath], 'tar list');
  for (const entry of listing.split(/\r?\n/)) {
    if (entry) safeTarPath(entry);
  }
  const typeListing = await runCommand('tar', ['-tvzf', archivePath], 'tar type list');
  let expandedBytes = 0n;
  for (const line of typeListing.split(/\r?\n/)) {
    if (line && line[0] !== '-' && line[0] !== 'd') {
      throw new Error('Recovery archive contains a link, device, socket, or other unsupported entry.');
    }
    if (line && line[0] === '-') {
      const fields = line.trim().split(/\s+/);
      if (!/^\d+$/.test(fields[2] ?? '')) throw new Error('Recovery archive size listing is invalid.');
      expandedBytes += BigInt(fields[2]);
    }
  }
  const filesystem = await statfs(workDir);
  const availableBytes = BigInt(filesystem.bavail) * BigInt(filesystem.bsize);
  const requiredBytes = expandedBytes + 1024n * 1024n * 1024n;
  if (availableBytes < requiredBytes) {
    throw new Error(`Recovery workspace has insufficient free space: available=${availableBytes} required=${requiredBytes}.`);
  }

  const extractionRoot = join(workDir, 'objects');
  await mkdir(extractionRoot, { recursive: true, mode: 0o700 });
  await runCommand('tar', ['-xzf', archivePath, '--no-same-owner', '--no-same-permissions', '-C', extractionRoot], 'tar extract');

  const prepared: PreparedRecoveryObject[] = [];
  for (const filePath of await walkFiles(extractionRoot)) {
    const backupRelativePath = relative(extractionRoot, filePath).split(sep);
    const [bucket, ...keyParts] = backupRelativePath;
    const key = keyParts.join('/');
    if (!bucket || keyParts.length === 0 || !isBackupObjectAllowed(bucket, key)) {
      throw new Error(`Recovery archive contains an unexpected object path: ${relative(extractionRoot, filePath)}`);
    }
    const details = await lstat(filePath);
    prepared.push({ bucket, key, filePath, size: details.size, sha256: await hashFile(filePath) });
  }
  return prepared.sort((left, right) => `${left.bucket}/${left.key}`.localeCompare(`${right.bucket}/${right.key}`));
}

async function restoreObjectStorage(objects: PreparedRecoveryObject[], target: S3Client) {
  const aggregate = createHash('sha256');
  let totalBytes = 0;
  for (const object of objects) {
    await target.send(new PutObjectCommand({
      Bucket: object.bucket,
      Key: object.key,
      Body: createReadStream(object.filePath),
      ContentLength: object.size,
      Metadata: { 'x-sha256': object.sha256 },
    }));
    const head = await target.send(new HeadObjectCommand({ Bucket: object.bucket, Key: object.key }));
    if (head.ContentLength !== object.size || head.Metadata?.['x-sha256'] !== object.sha256) {
      throw new Error(`Recovery target object ${object.bucket}/${object.key} failed size/hash verification.`);
    }
    totalBytes += object.size;
    aggregate.update(`${object.bucket}\0${object.key}\0${object.size}\0${object.sha256}\n`);
  }
  return { object_count: objects.length, total_bytes: totalBytes, inventory_sha256: aggregate.digest('hex') };
}

async function reconcileRestoredRuntimeState(targetUrl: string) {
  const schemaName = process.env.PG_BOSS_SCHEMA?.trim() || 'pgboss';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schemaName)) throw new Error('PG_BOSS_SCHEMA is not a safe PostgreSQL identifier.');
  const schemaLiteral = schemaName.replace(/'/g, "''");
  const schemaIdentifier = schemaName.replace(/"/g, '""');
  await runTargetSql(targetUrl, `
DO $recovery$
BEGIN
  IF to_regclass('public.backup_runs') IS NOT NULL THEN
    UPDATE backup_runs
       SET status = 'FAILED', completed_at = now(), updated_at = now(),
           error_message = 'Interrupted by disaster-recovery restore'
     WHERE status IN ('PENDING', 'RUNNING');
    UPDATE backup_runs SET files = '[]'::jsonb, updated_at = now() WHERE files IS NOT NULL;
  END IF;
  IF to_regclass('public.storage_objects') IS NOT NULL THEN
    DELETE FROM storage_objects WHERE bucket = 'archives' AND object_key LIKE 'backups/%';
  END IF;
  IF to_regclass('public.media_upload_sessions') IS NOT NULL THEN
    UPDATE media_upload_sessions
       SET state = 'EXPIRED', aborted_at = now(), updated_at = now(), failure_reason = 'RECOVERY_RECONCILIATION'
     WHERE state IN ('INITIALIZING', 'ACTIVE', 'FINALIZING');
  END IF;
  IF to_regclass('${schemaLiteral}.job') IS NOT NULL THEN
    UPDATE "${schemaIdentifier}".job
       SET state = 'retry', start_after = now(), started_on = NULL
     WHERE state = 'active';
  END IF;
END
$recovery$;
`, 'recovery state reconciliation');
}

async function verifyRestoredApplicationState(targetUrl: string) {
  const output = await runTargetSql(targetUrl, `
SELECT json_build_object(
  'users', (SELECT count(*) FROM users),
  'roles', (SELECT count(*) FROM roles),
  'storage_objects', (SELECT count(*) FROM storage_objects),
  'unfinished_backups', (SELECT count(*) FROM backup_runs WHERE status IN ('PENDING', 'RUNNING')),
  'unfinished_uploads', (SELECT count(*) FROM media_upload_sessions WHERE state IN ('INITIALIZING', 'ACTIVE', 'FINALIZING'))
)::text;
`, 'recovery application consistency');
  const result = JSON.parse(output) as Record<string, number>;
  if (result.unfinished_backups !== 0 || result.unfinished_uploads !== 0) {
    throw new Error('Recovery application consistency check found unfinished backup or upload state.');
  }
  return result;
}

function findArtifact(files: OffHostBackupArtifact[], expression: RegExp, label: string) {
  const matches = files.filter((file) => expression.test(basename(file.object_key)));
  if (matches.length !== 1) throw new Error(`Off-host manifest must contain exactly one ${label} archive.`);
  return matches[0];
}

program
  .name('darshan-restore-offhost-backup')
  .description('Restore a verified off-host backup only into explicitly named clean recovery targets')
  .requiredOption('--manifest-key <key>', 'Full object key of the off-host backup manifest')
  .requiredOption('--source-uri <uri>', 'Signed off-host S3 URI')
  .requiredOption('--source-endpoint <url>', 'Signed off-host HTTPS endpoint')
  .requiredOption('--source-region <region>', 'Signed off-host S3 region')
  .requiredOption('--source-access-key-file <path>', 'Protected file containing recovery-authority off-host read access key')
  .requiredOption('--source-secret-key-file <path>', 'Protected file containing recovery-authority off-host read secret key')
  .requiredOption('--expected-site <site>', 'Signed site identity for the evidence')
  .requiredOption('--expected-interval-hours <hours>', 'Signed backup interval', (value) => Number(value))
  .requiredOption('--expected-retention-days <days>', 'Signed backup retention', (value) => Number(value))
  .requiredOption('--production-database-host <host>', 'Signed production PostgreSQL host identity')
  .requiredOption('--production-database-port <port>', 'Signed production PostgreSQL port identity')
  .requiredOption('--production-database-name <name>', 'Signed production PostgreSQL database identity')
  .requiredOption('--production-s3-endpoint <url>', 'Signed production object-store endpoint identity')
  .requiredOption('--target-database-url-file <path>', 'Protected file containing a PostgreSQL URL for a clean recovery database')
  .requiredOption('--target-s3-endpoint <url>', 'HTTPS endpoint for a clean recovery S3/MinIO target')
  .requiredOption('--target-s3-region <region>', 'Region for the clean recovery S3/MinIO target')
  .requiredOption('--target-s3-access-key-file <path>', 'Protected file containing recovery S3 access key')
  .requiredOption('--target-s3-secret-key-file <path>', 'Protected file containing recovery S3 secret key')
  .requiredOption('--evidence-output <path>', 'New protected output file for restore-rehearsal evidence')
  .requiredOption('--attestation-private-key-file <path>', 'Protected recovery-authority RSA private key')
  .requiredOption('--target-id <id>', 'Approved non-production recovery target identity')
  .requiredOption('--confirm-run-id <id>', 'Must exactly match the manifest run ID')
  .action(async (options) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(options.targetId)) throw new Error('target-id must contain 3-128 safe characters.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.expectedSite)) throw new Error('expected-site is invalid.');
    const policy = createOffHostBackupPolicy({
      destination: options.sourceUri,
      endpoint: options.sourceEndpoint,
      region: options.sourceRegion,
      accessKeyId: await readProtectedFile(options.sourceAccessKeyFile, 'Recovery off-host access-key file'),
      secretAccessKey: await readProtectedFile(options.sourceSecretKeyFile, 'Recovery off-host secret-key file'),
      intervalHours: options.expectedIntervalHours,
      retentionDays: options.expectedRetentionDays,
    });
    const client = getOffHostBackupClient(policy);
    const manifest = await readOffHostManifest(client, policy.location, options.manifestKey);
    if (manifest.run_id !== options.confirmRunId) throw new Error('confirm-run-id does not match the selected off-host backup run.');
    if (
      manifest.off_host_uri !== policy.location.uri ||
      manifest.off_host_endpoint !== policy.endpoint ||
      manifest.backup_interval_hours !== policy.intervalHours ||
      manifest.retention_days !== policy.retentionDays
    ) {
      throw new Error('Backup manifest does not match the currently signed backup policy.');
    }
    await verifyOffHostBackupManifest(client, policy.location, manifest);

    const targetDatabaseUrl = await readProtectedFile(options.targetDatabaseUrlFile, 'Recovery target database URL file');
    await assertIsolatedRecoveryTargets({
      targetDatabaseUrl,
      targetS3Endpoint: options.targetS3Endpoint,
      productionDatabaseHost: options.productionDatabaseHost,
      productionDatabasePort: options.productionDatabasePort,
      productionDatabaseName: options.productionDatabaseName,
      productionS3Endpoint: options.productionS3Endpoint,
    });
    const attestationPrivateKey = await readProtectedFile(options.attestationPrivateKeyFile, 'Recovery attestation private key');
    const target = targetS3Client({
      endpoint: options.targetS3Endpoint,
      region: options.targetS3Region,
      accessKeyId: await readProtectedFile(options.targetS3AccessKeyFile, 'Recovery target S3 access-key file'),
      secretAccessKey: await readProtectedFile(options.targetS3SecretKeyFile, 'Recovery target S3 secret-key file'),
    });
    const workDir = await mkdtemp(join(tmpdir(), 'darshan-offhost-restore-'));
    try {
      const databaseArchive = findArtifact(manifest.files, /^darshan_postgres_.*\.sql\.gz$/, 'PostgreSQL');
      const objectArchive = findArtifact(manifest.files, /^darshan_minio_.*\.tar\.gz$/, 'object-storage');
      const databasePath = join(workDir, 'database.sql.gz');
      const objectPath = join(workDir, 'objects.tar.gz');
      await downloadVerifiedOffHostArtifact(client, policy.location, databaseArchive, databasePath);
      await downloadVerifiedOffHostArtifact(client, policy.location, objectArchive, objectPath);
      const preparedObjects = await prepareObjectStorageArchive(objectPath, workDir);
      await assertEmptyTargetDatabase(targetDatabaseUrl);
      for (const bucket of BACKUP_BUCKETS) await ensureEmptyTargetBucket(target, bucket);
      await restoreDatabase(databasePath, targetDatabaseUrl);
      const object_restore = await restoreObjectStorage(preparedObjects, target);
      await reconcileRestoredRuntimeState(targetDatabaseUrl);
      const application_checks = await verifyRestoredApplicationState(targetDatabaseUrl);

      const unsignedEvidence = {
        evidence_version: 2,
        restore_verified: true,
        verified_at: new Date().toISOString(),
        site_name: options.expectedSite,
        target_id: options.targetId,
        off_host_uri: manifest.off_host_uri,
        off_host_endpoint: manifest.off_host_endpoint,
        backup_interval_hours: manifest.backup_interval_hours,
        retention_days: manifest.retention_days,
        manifest_key: manifest.manifest_key,
        manifest_sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
        restored_from_run_id: manifest.run_id,
        object_restore,
        application_checks,
      };
      const signer = createSign('RSA-SHA256');
      signer.update(JSON.stringify(unsignedEvidence));
      signer.end();
      const evidence = {
        ...unsignedEvidence,
        attestation_algorithm: 'RSA-SHA256',
        attestation_signature: signer.sign(attestationPrivateKey, 'base64'),
      };
      await mkdir(dirname(resolve(options.evidenceOutput)), { recursive: true, mode: 0o700 });
      await writeFile(options.evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

await program.parseAsync(process.argv);
