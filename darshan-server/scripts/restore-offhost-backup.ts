import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, opendir, readFile, rm, writeFile } from 'node:fs/promises';
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
import {
  downloadVerifiedOffHostArtifact,
  getOffHostBackupClient,
  getOffHostBackupPolicy,
  readOffHostManifest,
  verifyOffHostBackupManifest,
  type OffHostBackupArtifact,
} from '../src/utils/off-host-backup.js';

const MINIO_BACKUP_BUCKETS = new Set([
  'media-source',
  'media-ready',
  'media-thumbnails',
  'device-screenshots',
  'logs-audit',
  'logs-system',
  'logs-heartbeats',
  'logs-proof-of-play',
]);

async function readProtectedFile(filePath: string, label: string) {
  const details = await lstat(filePath);
  if (!details.isFile() || details.isSymbolicLink() || (details.mode & 0o007) !== 0) {
    throw new Error(`${label} must be a regular file that is not readable by other users.`);
  }
  const value = (await readFile(filePath, 'utf8')).replace(/\r?\n$/, '');
  if (!value) throw new Error(`${label} is empty.`);
  return value;
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

async function restoreObjectStorage(archivePath: string, target: S3Client, workDir: string) {
  const listing = await runCommand('tar', ['-tzf', archivePath], 'tar list');
  for (const entry of listing.split(/\r?\n/)) {
    if (entry) safeTarPath(entry);
  }

  const extractionRoot = join(workDir, 'objects');
  await mkdir(extractionRoot, { recursive: true, mode: 0o700 });
  await runCommand('tar', ['-xzf', archivePath, '--no-same-owner', '--no-same-permissions', '-C', extractionRoot], 'tar extract');

  for (const filePath of await walkFiles(extractionRoot)) {
    const backupRelativePath = relative(extractionRoot, filePath).split(sep);
    const [bucket, ...keyParts] = backupRelativePath;
    if (!bucket || !MINIO_BACKUP_BUCKETS.has(bucket) || keyParts.length === 0 || keyParts.some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Recovery archive contains an unexpected object path: ${relative(extractionRoot, filePath)}`);
    }
    const key = keyParts.join('/');
    const details = await lstat(filePath);
    await target.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: details.size,
    }));
    const head = await target.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== details.size) throw new Error(`Recovery target object ${bucket}/${key} has an unexpected size.`);
  }
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
  .requiredOption('--target-database-url-file <path>', 'Protected file containing a PostgreSQL URL for a clean recovery database')
  .requiredOption('--target-s3-endpoint <url>', 'HTTPS endpoint for a clean recovery S3/MinIO target')
  .requiredOption('--target-s3-region <region>', 'Region for the clean recovery S3/MinIO target')
  .requiredOption('--target-s3-access-key-file <path>', 'Protected file containing recovery S3 access key')
  .requiredOption('--target-s3-secret-key-file <path>', 'Protected file containing recovery S3 secret key')
  .requiredOption('--evidence-output <path>', 'New protected output file for restore-rehearsal evidence')
  .requiredOption('--confirm-run-id <id>', 'Must exactly match the manifest run ID')
  .action(async (options) => {
    const policy = getOffHostBackupPolicy();
    const client = getOffHostBackupClient();
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
      await assertEmptyTargetDatabase(targetDatabaseUrl);
      for (const bucket of MINIO_BACKUP_BUCKETS) await ensureEmptyTargetBucket(target, bucket);
      await restoreDatabase(databasePath, targetDatabaseUrl);
      await restoreObjectStorage(objectPath, target, workDir);

      const evidence = {
        restore_verified: true,
        verified_at: new Date().toISOString(),
        off_host_uri: manifest.off_host_uri,
        off_host_endpoint: manifest.off_host_endpoint,
        backup_interval_hours: manifest.backup_interval_hours,
        retention_days: manifest.retention_days,
        manifest_key: manifest.manifest_key,
        restored_from_run_id: manifest.run_id,
      };
      await mkdir(dirname(resolve(options.evidenceOutput)), { recursive: true, mode: 0o700 });
      await writeFile(options.evidenceOutput, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

await program.parseAsync(process.argv);
