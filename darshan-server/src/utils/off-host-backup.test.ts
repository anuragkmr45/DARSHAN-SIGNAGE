import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOffHostBackupManifest,
  downloadVerifiedOffHostArtifact,
  readOffHostManifest,
  uploadOffHostFile,
  verifyOffHostBackupManifest,
  type S3CommandClient,
} from './off-host-backup';
import { parseOffHostBackupLocation } from './off-host-backup-location';

type StoredObject = { body: Buffer; metadata: Record<string, string>; contentType?: string };

class InMemoryS3Client implements S3CommandClient {
  readonly objects = new Map<string, StoredObject>();
  private readonly multipartUploads = new Map<string, { id: string; metadata: Record<string, string>; contentType?: string; parts: Map<number, Buffer> }>();

  async send(command: any): Promise<any> {
    const input = command.input as Record<string, any>;
    const name = command.constructor.name;
    const id = `${input.Bucket}/${input.Key}`;
    if (name === 'PutObjectCommand') {
      const chunks: Buffer[] = [];
      for await (const chunk of input.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      this.objects.set(id, { body: Buffer.concat(chunks), metadata: input.Metadata ?? {}, contentType: input.ContentType });
      return {};
    }
    if (name === 'HeadObjectCommand') {
      const object = this.objects.get(id);
      if (!object) throw new Error(`missing ${id}`);
      return { ContentLength: object.body.length, Metadata: object.metadata };
    }
    if (name === 'GetObjectCommand') {
      const object = this.objects.get(id);
      if (!object) throw new Error(`missing ${id}`);
      return {
        Body: Readable.from([object.body]),
        ContentLength: object.body.length,
        Metadata: object.metadata,
      };
    }
    if (name === 'CreateMultipartUploadCommand') {
      const uploadId = `upload-${this.multipartUploads.size + 1}`;
      this.multipartUploads.set(uploadId, {
        id,
        metadata: input.Metadata ?? {},
        contentType: input.ContentType,
        parts: new Map(),
      });
      return { UploadId: uploadId };
    }
    if (name === 'UploadPartCommand') {
      const upload = this.multipartUploads.get(input.UploadId);
      if (!upload) throw new Error(`missing upload ${input.UploadId}`);
      const chunks: Buffer[] = [];
      for await (const chunk of input.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      upload.parts.set(input.PartNumber, Buffer.concat(chunks));
      return { ETag: `etag-${input.PartNumber}`, ChecksumSHA256: input.ChecksumSHA256 };
    }
    if (name === 'CompleteMultipartUploadCommand') {
      const upload = this.multipartUploads.get(input.UploadId);
      if (!upload) throw new Error(`missing upload ${input.UploadId}`);
      const body = Buffer.concat([...upload.parts.entries()].sort(([left], [right]) => left - right).map(([, part]) => part));
      this.objects.set(upload.id, { body, metadata: upload.metadata, contentType: upload.contentType });
      this.multipartUploads.delete(input.UploadId);
      return {};
    }
    if (name === 'AbortMultipartUploadCommand') {
      this.multipartUploads.delete(input.UploadId);
      return {};
    }
    throw new Error(`Unexpected S3 command in single-part test: ${name}`);
  }
}

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('off-host S3 backup storage', () => {
  it('streams a file, writes a checksum manifest, and verifies the remote copy', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'darshan-offhost-test-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'database.sql.gz');
    const contents = Buffer.from('safe streamed backup payload');
    writeFileSync(filePath, contents);
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const artifact = await uploadOffHostFile(client, {
      bucket: location.bucket,
      key: 'darshan/site-a/runs/20260904-run/database.sql.gz',
      filePath,
      contentType: 'application/gzip',
    });

    expect(artifact.sha256).toBe(createHash('sha256').update(contents).digest('hex'));
    expect(client.objects.get(`${location.bucket}/${artifact.object_key}`)?.body).toEqual(contents);
    const restoredPath = path.join(directory, 'restored.sql.gz');
    await downloadVerifiedOffHostArtifact(client, location, artifact, restoredPath);
    expect(Buffer.from(await (await import('node:fs/promises')).readFile(restoredPath))).toEqual(contents);

    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [artifact],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });
    const manifestBody = Buffer.from(`${JSON.stringify(manifest)}\n`);
    client.objects.set(`${location.bucket}/${manifest.manifest_key}`, {
      body: manifestBody,
      metadata: { 'x-sha256': createHash('sha256').update(manifestBody).digest('hex') },
      contentType: 'application/json',
    });

    const loaded = await readOffHostManifest(client, location, manifest.manifest_key);
    await expect(verifyOffHostBackupManifest(client, location, loaded)).resolves.toBeUndefined();
  });

  it('rejects a manifest whose artifact changed after upload', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const payload = Buffer.from('first payload');
    const key = 'darshan/site-a/runs/20260904-run/database.sql.gz';
    client.objects.set(`${location.bucket}/${key}`, {
      body: Buffer.from('tampered payload'),
      metadata: { 'x-sha256': createHash('sha256').update(payload).digest('hex') },
    });
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [{ name: 'database.sql.gz', object_key: key, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex'), content_type: 'application/gzip' }],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });

    await expect(verifyOffHostBackupManifest(client, location, manifest)).rejects.toThrow(/unexpected size/);
  });

  it('rejects a manifest that points at artifacts from another backup run', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const payload = Buffer.from('valid object bytes');
    const foreignRunKey = 'darshan/site-a/runs/20260904-other-run/database.sql.gz';
    client.objects.set(`${location.bucket}/${foreignRunKey}`, {
      body: payload,
      metadata: { 'x-sha256': createHash('sha256').update(payload).digest('hex') },
    });
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [
        {
          name: 'database.sql.gz',
          object_key: foreignRunKey,
          size: payload.length,
          sha256: createHash('sha256').update(payload).digest('hex'),
          content_type: 'application/gzip',
        },
      ],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });

    await expect(verifyOffHostBackupManifest(client, location, manifest)).rejects.toThrow(/invalid backup artifact/);
  });

  it('rejects duplicate artifact keys in a manifest', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const payload = Buffer.from('duplicate object bytes');
    const key = 'darshan/site-a/runs/20260904-run/database.sql.gz';
    const artifact = {
      name: 'database.sql.gz',
      object_key: key,
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
      content_type: 'application/gzip',
    };
    client.objects.set(`${location.bucket}/${key}`, {
      body: payload,
      metadata: { 'x-sha256': artifact.sha256 },
    });
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [artifact, artifact],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });

    await expect(verifyOffHostBackupManifest(client, location, manifest)).rejects.toThrow(/invalid backup artifact/);
  });

  it('rejects an empty or generic manifest with no backup artifacts', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });

    await expect(verifyOffHostBackupManifest(client, location, manifest)).rejects.toThrow(/at least one backup artifact/);
  });

  it('rejects artifact names that do not match their object key basename', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const payload = Buffer.from('valid object bytes');
    const key = 'darshan/site-a/runs/20260904-run/database.sql.gz';
    const artifact = {
      name: 'wrong-name.sql.gz',
      object_key: key,
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex'),
      content_type: 'application/gzip',
    };
    client.objects.set(`${location.bucket}/${key}`, {
      body: payload,
      metadata: { 'x-sha256': artifact.sha256 },
    });
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [artifact],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });

    await expect(verifyOffHostBackupManifest(client, location, manifest)).rejects.toThrow(/invalid backup artifact/);
  });

  it('rejects a fetched manifest whose body does not match its checksum metadata', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });
    const manifestBody = Buffer.from(`${JSON.stringify(manifest)}\n`);
    client.objects.set(`${location.bucket}/${manifest.manifest_key}`, {
      body: manifestBody,
      metadata: { 'x-sha256': '0'.repeat(64) },
      contentType: 'application/json',
    });

    await expect(readOffHostManifest(client, location, manifest.manifest_key)).rejects.toThrow(/SHA-256 metadata/);
  });

  it('rejects a fetched manifest whose embedded key does not match the requested object', async () => {
    const client = new InMemoryS3Client();
    const location = parseOffHostBackupLocation('s3://backups.example.test/darshan/site-a');
    const manifest = createOffHostBackupManifest({
      runId: 'run',
      timestamp: '20260904',
      artifacts: [],
      location,
      endpoint: 'https://s3.backups.example.test',
      intervalHours: 24,
      retentionDays: 30,
    });
    const tampered = { ...manifest, manifest_key: 'darshan/site-a/runs/20260904-other/manifest.json' };
    const manifestBody = Buffer.from(`${JSON.stringify(tampered)}\n`);
    client.objects.set(`${location.bucket}/${manifest.manifest_key}`, {
      body: manifestBody,
      metadata: { 'x-sha256': createHash('sha256').update(manifestBody).digest('hex') },
      contentType: 'application/json',
    });

    await expect(readOffHostManifest(client, location, manifest.manifest_key)).rejects.toThrow(/invalid shape/);
  });

  it('uses bounded multipart uploads for archives at or above the S3 multipart minimum', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'darshan-offhost-test-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'large.tar.gz');
    const contents = Buffer.alloc(5 * 1024 * 1024, 7);
    writeFileSync(filePath, contents);
    const client = new InMemoryS3Client();
    const artifact = await uploadOffHostFile(client, {
      bucket: 'backups.example.test',
      key: 'darshan/site-a/runs/20260904_run/large.tar.gz',
      filePath,
      contentType: 'application/gzip',
    });

    expect(artifact.size).toBe(contents.length);
    expect(
      createHash('sha256').update(client.objects.get(`backups.example.test/${artifact.object_key}`)?.body ?? Buffer.alloc(0)).digest('hex')
    ).toBe(createHash('sha256').update(contents).digest('hex'));
  });
});
