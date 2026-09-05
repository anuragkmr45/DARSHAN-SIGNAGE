import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config as appConfig } from '@/config';
import { offHostBackupObjectKey, parseOffHostBackupLocation, type OffHostBackupLocation } from './off-host-backup-location';

const MULTIPART_PART_BYTES = 64 * 1024 * 1024;
const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;

export type S3CommandClient = Pick<S3Client, 'send'>;

export type OffHostBackupArtifact = {
  name: string;
  size: number;
  sha256: string;
  content_type: string;
  object_key: string;
};

export type OffHostBackupManifest = {
  version: 1;
  run_id: string;
  created_at: string;
  release_id: string;
  off_host_uri: string;
  off_host_endpoint: string;
  backup_interval_hours: number;
  retention_days: number;
  manifest_key: string;
  files: OffHostBackupArtifact[];
};

type UploadFileInput = {
  bucket: string;
  key: string;
  filePath: string;
  contentType: string;
};

function readableBody(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    return Readable.from(body as AsyncIterable<Uint8Array>);
  }
  throw new Error('Off-host S3 response did not include a readable object body.');
}

function assertConfiguredBackupPolicy() {
  const {
    BACKUP_OFFHOST_DESTINATION: destination,
    BACKUP_OFFHOST_ENDPOINT: endpoint,
    BACKUP_OFFHOST_REGION: region,
    BACKUP_OFFHOST_ACCESS_KEY: accessKeyId,
    BACKUP_OFFHOST_SECRET_KEY: secretAccessKey,
    BACKUP_INTERVAL_HOURS: intervalHours,
    BACKUP_RETENTION_DAYS: retentionDays,
  } = appConfig;
  if (!destination || !endpoint || !region || !accessKeyId || !secretAccessKey || !intervalHours || !retentionDays) {
    throw new Error('Off-host backup is not fully configured. Production requires an S3 destination, endpoint, credentials, interval, and retention.');
  }
  return {
    location: parseOffHostBackupLocation(destination),
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    intervalHours,
    retentionDays,
  };
}

export function getOffHostBackupClient(): S3Client {
  const policy = assertConfiguredBackupPolicy();
  return new S3Client({
    endpoint: policy.endpoint,
    region: policy.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: policy.accessKeyId,
      secretAccessKey: policy.secretAccessKey,
    },
  });
}

export function getOffHostBackupLocation(): OffHostBackupLocation {
  return assertConfiguredBackupPolicy().location;
}

export function getOffHostBackupPolicy() {
  const policy = assertConfiguredBackupPolicy();
  return {
    location: policy.location,
    endpoint: policy.endpoint,
    intervalHours: policy.intervalHours,
    retentionDays: policy.retentionDays,
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function base64Sha256(hexDigest: string) {
  return Buffer.from(hexDigest, 'hex').toString('base64');
}

function metadataSha256(metadata: Record<string, string> | undefined) {
  return metadata?.['x-sha256'] ?? metadata?.['X-Sha256'];
}

async function verifyUploadedObject(client: S3CommandClient, input: { bucket: string; key: string; size: number; sha256: string }) {
  const response = await client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
  if (response.ContentLength !== input.size) {
    throw new Error(`Off-host object ${input.key} has an unexpected size after upload.`);
  }
  const remoteHash = metadataSha256(response.Metadata);
  if (remoteHash !== input.sha256) {
    throw new Error(`Off-host object ${input.key} is missing its expected SHA-256 metadata after upload.`);
  }
}

/** Upload a file in bounded parts, never materializing the archive in the Node heap. */
export async function uploadOffHostFile(client: S3CommandClient, input: UploadFileInput): Promise<OffHostBackupArtifact> {
  const details = await stat(input.filePath);
  if (!details.isFile() || details.size < 0) throw new Error(`Backup artifact is not a regular file: ${input.filePath}`);
  const sha256 = await sha256File(input.filePath);
  const metadata = { 'x-sha256': sha256 };

  if (details.size < MIN_MULTIPART_PART_BYTES) {
    await client.send(new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentLength: details.size,
      ContentType: input.contentType,
      Metadata: metadata,
      ChecksumSHA256: base64Sha256(sha256),
    }));
  } else {
    const create = await client.send(new CreateMultipartUploadCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      Metadata: metadata,
      ChecksumAlgorithm: 'SHA256',
    }));
    if (!create.UploadId) throw new Error(`Off-host S3 did not return an upload ID for ${input.key}.`);

    try {
      const parts: Array<{ ETag: string; PartNumber: number; ChecksumSHA256?: string }> = [];
      for (let offset = 0, partNumber = 1; offset < details.size; offset += MULTIPART_PART_BYTES, partNumber += 1) {
        const end = Math.min(offset + MULTIPART_PART_BYTES, details.size) - 1;
        const partHash = createHash('sha256');
        for await (const chunk of createReadStream(input.filePath, { start: offset, end })) partHash.update(chunk);
        const partDigest = partHash.digest('hex');
        const uploaded = await client.send(new UploadPartCommand({
          Bucket: input.bucket,
          Key: input.key,
          UploadId: create.UploadId,
          PartNumber: partNumber,
          Body: createReadStream(input.filePath, { start: offset, end }),
          ContentLength: end - offset + 1,
          ChecksumSHA256: base64Sha256(partDigest),
        }));
        if (!uploaded.ETag) throw new Error(`Off-host S3 did not return an ETag for ${input.key} part ${partNumber}.`);
        parts.push({ ETag: uploaded.ETag, PartNumber: partNumber, ChecksumSHA256: uploaded.ChecksumSHA256 });
      }
      await client.send(new CompleteMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: create.UploadId,
        MultipartUpload: { Parts: parts },
      }));
    } catch (error) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: input.bucket, Key: input.key, UploadId: create.UploadId })).catch(() => undefined);
      throw error;
    }
  }

  await verifyUploadedObject(client, { bucket: input.bucket, key: input.key, size: details.size, sha256 });
  return {
    name: input.key.split('/').at(-1) ?? input.key,
    object_key: input.key,
    size: details.size,
    sha256,
    content_type: input.contentType,
  };
}

export function createOffHostBackupManifest(input: {
  runId: string;
  timestamp: string;
  artifacts: OffHostBackupArtifact[];
  location: OffHostBackupLocation;
  endpoint: string;
  intervalHours: number;
  retentionDays: number;
}): OffHostBackupManifest {
  const manifestKey = offHostBackupObjectKey(input.location, `runs/${input.timestamp}-${input.runId}/manifest.json`);
  return {
    version: 1,
    run_id: input.runId,
    created_at: new Date().toISOString(),
    release_id: appConfig.DARSHAN_RELEASE_ID,
    off_host_uri: input.location.uri,
    off_host_endpoint: input.endpoint,
    backup_interval_hours: input.intervalHours,
    retention_days: input.retentionDays,
    manifest_key: manifestKey,
    files: [...input.artifacts].sort((left, right) => left.object_key.localeCompare(right.object_key)),
  };
}

export async function uploadOffHostManifest(client: S3CommandClient, manifest: OffHostBackupManifest): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const sha256 = createHash('sha256').update(body).digest('hex');
  await client.send(new PutObjectCommand({
    Bucket: getOffHostBackupLocation().bucket,
    Key: manifest.manifest_key,
    Body: body,
    ContentLength: body.length,
    ContentType: 'application/json',
    Metadata: { 'x-sha256': sha256 },
    ChecksumSHA256: base64Sha256(sha256),
  }));
  await verifyUploadedObject(client, {
    bucket: getOffHostBackupLocation().bucket,
    key: manifest.manifest_key,
    size: body.length,
    sha256,
  });
}

export async function readOffHostManifest(client: S3CommandClient, location: OffHostBackupLocation, key: string): Promise<OffHostBackupManifest> {
  const response = await client.send(new GetObjectCommand({ Bucket: location.bucket, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of readableBody(response.Body)) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  if (response.ContentLength != null && response.ContentLength !== body.length) {
    throw new Error(`Off-host manifest ${key} has an unexpected size.`);
  }
  const digest = createHash('sha256').update(body).digest('hex');
  const remoteHash = metadataSha256(response.Metadata);
  if (remoteHash !== digest) {
    throw new Error(`Off-host manifest ${key} is missing its expected SHA-256 metadata.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error(`Off-host manifest ${key} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(`Off-host manifest ${key} has an invalid shape.`);
  const manifest = parsed as Partial<OffHostBackupManifest>;
  const intervalHours = manifest.backup_interval_hours;
  const retentionDays = manifest.retention_days;
  if (
    manifest.version !== 1 ||
    typeof manifest.run_id !== 'string' ||
    manifest.run_id.trim().length === 0 ||
    typeof manifest.created_at !== 'string' ||
    Number.isNaN(new Date(manifest.created_at).getTime()) ||
    typeof manifest.release_id !== 'string' ||
    manifest.release_id.trim().length === 0 ||
    typeof manifest.off_host_uri !== 'string' ||
    typeof manifest.off_host_endpoint !== 'string' ||
    typeof intervalHours !== 'number' ||
    !Number.isSafeInteger(intervalHours) ||
    intervalHours < 1 ||
    typeof retentionDays !== 'number' ||
    !Number.isSafeInteger(retentionDays) ||
    retentionDays < 1 ||
    typeof manifest.manifest_key !== 'string' ||
    manifest.manifest_key !== key ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error(`Off-host manifest ${key} has an invalid shape.`);
  }
  return manifest as OffHostBackupManifest;
}

function manifestRunPrefix(location: OffHostBackupLocation, manifestKey: string) {
  const runsPrefix = `${location.prefix}/runs/`;
  if (!manifestKey.startsWith(runsPrefix) || !manifestKey.endsWith('/manifest.json')) {
    throw new Error('Off-host manifest key is outside the configured backup runs prefix.');
  }
  const runDirectory = manifestKey.slice(0, -'/manifest.json'.length);
  if (runDirectory === runsPrefix.slice(0, -1) || runDirectory.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Off-host manifest key is outside the configured backup runs prefix.');
  }
  return `${runDirectory}/`;
}

export async function verifyOffHostBackupManifest(client: S3CommandClient, location: OffHostBackupLocation, manifest: OffHostBackupManifest): Promise<void> {
  if (manifest.off_host_uri !== location.uri) {
    throw new Error('Off-host manifest destination does not match the configured destination.');
  }
  if (manifest.files.length === 0) {
    throw new Error('Off-host manifest must contain at least one backup artifact.');
  }
  const runPrefix = manifestRunPrefix(location, manifest.manifest_key);
  const artifactKeys = new Set<string>();
  for (const file of manifest.files) {
    const objectName = typeof file?.object_key === 'string' ? file.object_key.split('/').at(-1) : undefined;
    if (
      !file ||
      typeof file.name !== 'string' ||
      file.name.trim().length === 0 ||
      file.name !== objectName ||
      typeof file.object_key !== 'string' ||
      !file.object_key.startsWith(runPrefix) ||
      file.object_key === manifest.manifest_key ||
      artifactKeys.has(file.object_key) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      typeof file.content_type !== 'string' ||
      file.content_type.trim().length === 0
    ) {
      throw new Error('Off-host manifest contains an invalid backup artifact.');
    }
    artifactKeys.add(file.object_key);
    await verifyUploadedObject(client, { bucket: location.bucket, key: file.object_key, size: file.size, sha256: file.sha256 });
  }
}

/** Download one already-manifested object while checking its bytes on disk. */
export async function downloadVerifiedOffHostArtifact(
  client: S3CommandClient,
  location: OffHostBackupLocation,
  artifact: OffHostBackupArtifact,
  destinationPath: string
): Promise<void> {
  await verifyUploadedObject(client, {
    bucket: location.bucket,
    key: artifact.object_key,
    size: artifact.size,
    sha256: artifact.sha256,
  });
  const response = await client.send(new GetObjectCommand({ Bucket: location.bucket, Key: artifact.object_key }));
  const hash = createHash('sha256');
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(readableBody(response.Body), hashingStream, createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }));
  const downloaded = await stat(destinationPath);
  if (downloaded.size !== artifact.size || hash.digest('hex') !== artifact.sha256) {
    throw new Error(`Downloaded off-host artifact ${artifact.object_key} does not match its manifest checksum.`);
  }
}

/** Keep retention entirely on the independently operated repository. */
export async function pruneOffHostBackups(client: S3CommandClient, location: OffHostBackupLocation, retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const prefix = `${location.prefix}/runs/`;
  let continuationToken: string | undefined;
  let deleted = 0;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: location.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const stale = (response.Contents ?? [])
      .filter((object) => object.Key && object.LastModified && object.LastModified.getTime() < cutoff)
      .map((object) => ({ Key: object.Key! }));
    for (let index = 0; index < stale.length; index += 1000) {
      const batch = stale.slice(index, index + 1000);
      const result = await client.send(new DeleteObjectsCommand({ Bucket: location.bucket, Delete: { Objects: batch, Quiet: true } }));
      if (result.Errors?.length) throw new Error(`Off-host retention failed to delete ${result.Errors.length} backup object(s).`);
      deleted += batch.length;
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}
