import { promisify } from 'util';
import { execFile, spawn } from 'child_process';
import { promises as fs, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve, sep } from 'path';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index.js';
import { deleteObject, getPresignedUrl, getS3Client, putFile } from '../s3/index.js';
import { AppError } from './app-error.js';
import { getResolvedPgDumpPath, getResolvedTarPath } from './runtime-dependencies.js';
import { config as appConfig } from '../config/index.js';
import { createOffHostBackupManifest, createOffHostBackupPolicy, getOffHostBackupClient, uploadOffHostFile, uploadOffHostManifest, verifyOffHostBackupManifest, } from './off-host-backup.js';
import { offHostBackupObjectKey } from './off-host-backup-location.js';
import { BACKUP_OBJECT_SOURCES, isBackupObjectAllowed } from '../deployment/backup-contract.js';
const execFileAsync = promisify(execFile);
const ARCHIVE_BUCKET = 'archives';
const POSTGRES_BACKUP_CONTAINER = process.env.POSTGRES_BACKUP_CONTAINER?.trim() || 'darshan-postgres';
async function ensureTempDir() {
    return fs.mkdtemp(join(tmpdir(), 'darshan-backup-'));
}
function formatBackupTimestamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join('') + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function normalizeErrorMessage(error) {
    if (error instanceof Error) {
        return error.message.replace(/\s+/g, ' ').trim();
    }
    return String(error).replace(/\s+/g, ' ').trim();
}
function isCommandNotFound(error) {
    return (error instanceof Error &&
        (error.code === 'ENOENT' ||
            error.message.toLowerCase().includes('not found') ||
            error.message.toLowerCase().includes('is not available')));
}
function isObjectRecord(value) {
    return typeof value === 'object' && value !== null;
}
function getObjectString(value, key) {
    const candidate = value[key];
    return typeof candidate === 'string' ? candidate : undefined;
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
function resolveBackupPath(rootDir, objectKey) {
    const rootPath = resolve(rootDir);
    const targetPath = resolve(rootDir, objectKey);
    if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) {
        throw new Error(`Unsafe backup object key encountered: ${objectKey}`);
    }
    return targetPath;
}
async function runCommandToGzipFile(params) {
    const child = spawn(params.command, params.args, {
        env: params.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk) => {
        stderr += chunk;
    });
    try {
        await new Promise((resolveSpawn, rejectSpawn) => {
            child.once('spawn', () => resolveSpawn());
            child.once('error', (error) => rejectSpawn(error));
        });
    }
    catch (error) {
        const message = isCommandNotFound(error)
            ? `${params.label} is not available on this machine.`
            : `${params.label} failed to start: ${normalizeErrorMessage(error)}`;
        throw Object.assign(new Error(message), {
            cause: error,
            code: error instanceof Error ? error.code : undefined,
        });
    }
    await Promise.all([
        pipeline(child.stdout, createGzip(), createWriteStream(params.outputPath)),
        new Promise((resolveExit, rejectExit) => {
            child.once('close', (code) => {
                if (code === 0) {
                    resolveExit();
                    return;
                }
                rejectExit(new Error(stderr.trim() || `${params.label} exited with code ${code}`));
            });
            child.once('error', (error) => {
                rejectExit(error);
            });
        }),
    ]);
}
async function createPostgresArchive(backupDir) {
    const connection = parseDatabaseUrl();
    const timestamp = formatBackupTimestamp();
    const outputPath = join(backupDir, `darshan_postgres_${timestamp}.sql.gz`);
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
    const pgDumpEnv = {
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
            await runCommandToGzipFile({
                command: pgDumpCommand,
                args: baseArgs,
                outputPath,
                env: pgDumpEnv,
                label: 'pg_dump',
            });
            return outputPath;
        }
        catch (error) {
            if (!isCommandNotFound(error)) {
                throw new Error(`PostgreSQL backup failed: ${normalizeErrorMessage(error)}`);
            }
        }
    }
    try {
        await runCommandToGzipFile({
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
        });
        return outputPath;
    }
    catch (error) {
        throw new Error(`PostgreSQL backup failed: pg_dump is not installed or could not be executed from PG_DUMP_PATH/PATH, and docker fallback via "${POSTGRES_BACKUP_CONTAINER}" could not run. ${normalizeErrorMessage(error)}`);
    }
}
async function downloadBucketObjects(source, destinationDir) {
    const client = getS3Client();
    let continuationToken;
    do {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: source.bucket,
            Prefix: source.prefix,
            ContinuationToken: continuationToken,
        }));
        for (const object of response.Contents ?? []) {
            if (!object.Key)
                continue;
            if (object.Key.endsWith('/')) {
                const directoryKey = object.Key.slice(0, -1);
                if (!isBackupObjectAllowed(source.bucket, directoryKey)) {
                    throw new Error(`Object key is outside the versioned backup contract: ${source.bucket}/${JSON.stringify(object.Key)}`);
                }
                await fs.mkdir(resolveBackupPath(destinationDir, directoryKey), { recursive: true });
                continue;
            }
            if (!isBackupObjectAllowed(source.bucket, object.Key)) {
                throw new Error(`Object key is outside the versioned backup contract: ${source.bucket}/${JSON.stringify(object.Key)}`);
            }
            const targetPath = resolveBackupPath(destinationDir, object.Key);
            await fs.mkdir(dirname(targetPath), { recursive: true });
            const objectResponse = await client.send(new GetObjectCommand({
                Bucket: source.bucket,
                Key: object.Key,
            }));
            if (!objectResponse.Body) {
                throw new Error(`Received empty body while backing up ${source.bucket}/${object.Key}`);
            }
            await pipeline(objectResponse.Body, createWriteStream(targetPath));
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
}
async function estimateObjectStorageBackupBytes() {
    const client = getS3Client();
    let total = 0;
    for (const source of BACKUP_OBJECT_SOURCES) {
        let continuationToken;
        do {
            const response = await client.send(new ListObjectsV2Command({
                Bucket: source.bucket,
                Prefix: source.prefix,
                ContinuationToken: continuationToken,
            }));
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
    const result = await db.execute(sql `SELECT pg_database_size(current_database())::text AS bytes`);
    const row = result.rows?.[0];
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
export function calculateBackupWorkspaceRequiredBytes(objectBytes, databaseBytes) {
    if (!Number.isSafeInteger(objectBytes) || objectBytes < 0 || !Number.isSafeInteger(databaseBytes) || databaseBytes < 0) {
        throw new Error('Backup workspace inputs must be safe non-negative byte counts.');
    }
    const required = objectBytes * 2 + databaseBytes + 1024 * 1024 * 1024;
    if (!Number.isSafeInteger(required))
        throw new Error('Backup workspace requirement exceeds supported byte precision.');
    return required;
}
async function assertBackupWorkspaceCapacity(backupDir) {
    const [objectBytes, databaseBytes, fileSystem] = await Promise.all([
        estimateObjectStorageBackupBytes(),
        estimatePostgresBackupBytes(),
        fs.statfs(backupDir),
    ]);
    const available = Number(fileSystem.bavail) * Number(fileSystem.bsize);
    // The object mirror plus its archive can each approach the original object
    // byte count; a plain SQL dump can approach database size. One GiB covers
    // gzip/tar metadata, temp files, and small changes during the backup.
    const required = calculateBackupWorkspaceRequiredBytes(objectBytes, databaseBytes);
    if (!Number.isSafeInteger(available) || !Number.isSafeInteger(required) || available < required) {
        throw new Error(`Insufficient free space for a safe backup workspace: requires at least ${required} bytes, but only ${available} bytes are available on the temporary filesystem.`);
    }
}
async function createObjectStorageArchive(backupDir) {
    const timestamp = formatBackupTimestamp();
    const mirrorRoot = join(backupDir, 'minio-export');
    const outputPath = join(backupDir, `darshan_minio_${timestamp}.tar.gz`);
    const tarCommand = getResolvedTarPath();
    await fs.mkdir(mirrorRoot, { recursive: true });
    for (const source of BACKUP_OBJECT_SOURCES) {
        const bucketDir = join(mirrorRoot, source.bucket);
        await fs.mkdir(bucketDir, { recursive: true });
        await downloadBucketObjects(source, bucketDir);
    }
    if (!tarCommand) {
        throw new Error('Object storage backup failed: tar is not available. Install tar or set TAR_PATH to the executable.');
    }
    try {
        await execFileAsync(tarCommand, ['-czf', outputPath, '-C', mirrorRoot, '.']);
    }
    catch (error) {
        if (isCommandNotFound(error)) {
            throw new Error('Object storage backup failed: tar is not available. Install tar or set TAR_PATH to the executable.');
        }
        throw new Error(`Object storage backup failed: ${normalizeErrorMessage(error)}`);
    }
    return outputPath;
}
export async function createBackupRun(triggerType, triggeredBy) {
    const db = getDatabase();
    const [run] = await db
        .insert(schema.backupRuns)
        .values({
        trigger_type: triggerType,
        status: 'PENDING',
        triggered_by: triggeredBy ?? null,
    })
        .returning();
    return run;
}
export async function markBackupRunRunning(runId) {
    const db = getDatabase();
    await db
        .update(schema.backupRuns)
        .set({
        status: 'RUNNING',
        started_at: new Date(),
        updated_at: new Date(),
        error_message: null,
    })
        .where(eq(schema.backupRuns.id, runId));
}
export async function markBackupRunCompleted(runId, files, offHostManifest) {
    const db = getDatabase();
    await db
        .update(schema.backupRuns)
        .set({
        status: 'COMPLETED',
        completed_at: new Date(),
        updated_at: new Date(),
        files,
        off_host_manifest: offHostManifest ?? null,
        error_message: null,
    })
        .where(eq(schema.backupRuns.id, runId));
}
export async function markBackupRunFailed(runId, message) {
    const db = getDatabase();
    await db
        .update(schema.backupRuns)
        .set({
        status: 'FAILED',
        completed_at: new Date(),
        updated_at: new Date(),
        error_message: message.slice(0, 1000),
    })
        .where(eq(schema.backupRuns.id, runId));
}
export async function listBackupRuns(limit = 20) {
    const db = getDatabase();
    const rows = await db
        .select()
        .from(schema.backupRuns)
        .orderBy(desc(schema.backupRuns.created_at))
        .limit(limit);
    return Promise.all(rows.map(async (row) => ({
        ...row,
        downloads: await Promise.all((row.files ?? []).map(async (file) => ({
            ...file,
            url: await getPresignedUrl(file.bucket, file.object_key),
        }))),
    })));
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
function isStorageMissingError(error) {
    if (!isObjectRecord(error))
        return false;
    const metadata = isObjectRecord(error.$metadata) ? error.$metadata : undefined;
    return (getObjectString(error, 'name') === 'NoSuchKey' ||
        getObjectString(error, 'name') === 'NotFound' ||
        getObjectString(error, 'Code') === 'NoSuchKey' ||
        getObjectString(error, 'code') === 'NoSuchKey' ||
        metadata?.httpStatusCode === 404);
}
export async function deleteBackupRun(runId) {
    const db = getDatabase();
    const [run] = await db.select().from(schema.backupRuns).where(eq(schema.backupRuns.id, runId)).limit(1);
    if (!run) {
        throw AppError.notFound('Backup run not found');
    }
    if (run.status === 'PENDING' || run.status === 'RUNNING') {
        throw AppError.conflict('In-progress backups cannot be deleted');
    }
    const files = run.files ?? [];
    for (const file of files) {
        try {
            await deleteObject(file.bucket, file.object_key);
        }
        catch (error) {
            if (!isStorageMissingError(error)) {
                throw error;
            }
        }
    }
    const storageObjectIds = Array.from(new Set(files.map((file) => file.storage_object_id).filter((value) => Boolean(value))));
    if (storageObjectIds.length > 0) {
        await db.delete(schema.storageObjects).where(inArray(schema.storageObjects.id, storageObjectIds));
    }
    await db.delete(schema.backupRuns).where(eq(schema.backupRuns.id, runId));
    return {
        id: run.id,
        deleted: true,
    };
}
export async function runFullBackup(runId) {
    const db = getDatabase();
    const backupDir = await ensureTempDir();
    try {
        await markBackupRunRunning(runId);
        await assertBackupWorkspaceCapacity(backupDir);
        await createPostgresArchive(backupDir);
        await createObjectStorageArchive(backupDir);
        const entries = await fs.readdir(backupDir);
        const files = [];
        // Development and QA retain the existing local-archive behavior. A
        // production run is not marked complete until a verified independent copy
        // and its checksum manifest exist at the signed off-host destination.
        const offHostEnabled = appConfig.NODE_ENV === 'production';
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
        const offHostArtifacts = [];
        for (const entry of entries) {
            const filePath = join(backupDir, entry);
            const stat = await fs.stat(filePath);
            if (!stat.isFile())
                continue;
            const objectKey = `backups/${runId}/${basename(filePath)}`;
            const upload = await putFile(ARCHIVE_BUCKET, objectKey, filePath, 'application/gzip');
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
                const remoteKey = offHostBackupObjectKey(offHostPolicy.location, `runs/${offHostTimestamp}-${runId}/${basename(filePath)}`);
                offHostArtifacts.push(await uploadOffHostFile(offHostClient, {
                    bucket: offHostPolicy.location.bucket,
                    key: remoteKey,
                    filePath,
                    contentType: 'application/gzip',
                }));
            }
        }
        let offHostManifest;
        if (offHostClient && offHostPolicy) {
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
            await uploadOffHostManifest(offHostClient, offHostPolicy.location, offHostManifest);
            await verifyOffHostBackupManifest(offHostClient, offHostPolicy.location, offHostManifest);
        }
        await markBackupRunCompleted(runId, files, offHostManifest);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Backup failed';
        await markBackupRunFailed(runId, message);
        throw error;
    }
    finally {
        await fs.rm(backupDir, { recursive: true, force: true });
    }
}
