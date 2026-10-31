import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { S3Client, CreateBucketCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'node:https';
import tls from 'node:tls';
import type net from 'node:net';
import { ControlledRecoveryError, sha256 } from '../../src/recovery/controlled-docker/contracts';
import { BACKUP_OBJECT_SOURCES, isBackupObjectAllowed } from '../../src/deployment/backup-contract';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile } from './controlled-recovery-d3-protected-files';
import type { D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import type { D3SourceLayoutBoundary } from './controlled-recovery-d3-source-services';
import type { D3SeedObject } from './controlled-recovery-d3-source-data-fixtures';

const failed = (code = 'CONTROLLED_RECOVERY_D3_SOURCE_DATA_CLIENT_UNVERIFIED') => new ControlledRecoveryError(code, 'The retained certificate-bound source data client or immutable object differs.');
export interface D3DataObjects { ensureBuckets(signal?: AbortSignal): Promise<void>; putImmutable(object: D3SeedObject, signal?: AbortSignal): Promise<void>; read(bucket: string, key: string, signal?: AbortSignal): Promise<Buffer>; list(signal?: AbortSignal): Promise<Array<{ bucket: string; key: string }>>; close(): void; }
export interface D3DataSession { client: PoolClient; close(): Promise<void>; }
export interface D3DataClients { connect(signal?: AbortSignal): Promise<D3DataSession>; objects: D3DataObjects; close(): Promise<void>; }
const settlementUncertain = () => failed('CONTROLLED_RECOVERY_D3_SOURCE_DATA_CLIENT_SETTLEMENT_UNCERTAIN');
function boundedSettlement(action: Promise<unknown>): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(settlementUncertain()), 10000);
  action.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); reject(settlementUncertain()); }); }); }
/** Register in pg-pool's checkout callback, before it can deliver any queued socket error. */
export async function checkoutD3DataSession(pool: Pick<Pool, 'connect'>, endPool: () => Promise<void>, signal?: AbortSignal): Promise<D3DataSession> {
  if (signal?.aborted) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED');
  let unexpectedFailure = false; let aborted = false; let ending = false; let ended = false; let released = false; let closing: Promise<void> | null = null;
  let resolveEnd!: () => void; const terminal = new Promise<void>((resolve) => { resolveEnd = resolve; }); let client: PoolClient;
  const onError = () => { unexpectedFailure = true; };
  const onEnd = () => { ended = true; if (!ending && !aborted) unexpectedFailure = true; resolveEnd(); };
  const destroy = () => { aborted = true; (client as unknown as { connection?: { stream?: net.Socket } }).connection?.stream?.destroy(); };
  client = await new Promise<PoolClient>((resolve, reject) => { pool.connect((error, value) => {
    if (error || !value) { reject(failed()); return; } client = value; value.on('error', onError); value.once('end', onEnd);
    signal?.addEventListener('abort', destroy, { once: true }); if (signal?.aborted) destroy(); resolve(value);
  }); });
  const close = () => { if (closing) return closing; ending = true;
    closing = (async () => { try { if (!released) { released = true; client.release(aborted || unexpectedFailure); } await boundedSettlement(Promise.all([endPool(), terminal])); }
      catch { (client as unknown as { connection?: { stream?: net.Socket } }).connection?.stream?.destroy(); throw settlementUncertain(); }
      finally { signal?.removeEventListener('abort', destroy); if (ended) client.removeListener('error', onError); else client.once('end', () => client.removeListener('error', onError)); }
      if (aborted) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); if (unexpectedFailure) throw failed(); })(); return closing; };
  if (aborted || ended || unexpectedFailure) { await close(); throw failed(); } return { client, close };
}
export function d3DataPeer(servername: string, certificateSha256: string) { return (_host: string, cert: tls.PeerCertificate) => tls.checkServerIdentity(servername, cert) ?? (cert.raw && sha256(cert.raw) === certificateSha256 ? undefined : failed()); }
export function d3DataPoolConfig(input: { profile: D3SourceBackupProfile; ca: Buffer; certificateSha256: string; password: string }): PoolConfig {
  return { host: input.profile.postgres.ip, port: 5432, database: 'darshan', user: 'darshan', password: input.password,
    ssl: { ca: input.ca.toString('utf8'), rejectUnauthorized: true, servername: input.profile.postgres.name, minVersion: 'TLSv1.2', checkServerIdentity: d3DataPeer(input.profile.postgres.name, input.certificateSha256) },
    max: 1, idleTimeoutMillis: 1000, connectionTimeoutMillis: 10000, query_timeout: 30000, statement_timeout: 30000, application_name: 'darshan-d3-source-data',
    options: '-c search_path=public -c timezone=UTC -c datestyle=ISO,YMD -c log_statement=none -c log_min_error_statement=panic -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0' };
}
/** Explicit credentials and CA/pin: no default AWS/PG credential or endpoint chain. */
export async function createD3DataClients(authority: D3OperationAuthority, profile: D3SourceBackupProfile, layout: Pick<D3SourceLayoutBoundary, 'verify'>): Promise<D3DataClients> {
  const verified = await layout.verify(); const read = async (relative: string) => { const file = await openD3ProtectedFile(authority, `${authority.root}/source/${relative}`, 65536); try { return await file.readFile(); } finally { await file.close(); } };
  const ca = await read('tls/ca/ca.crt'); const password = (await read('secrets/postgres-password')).toString('utf8').trim();
  const accessKeyId = (await read('secrets/minio-access-key')).toString('utf8').trim(); const secretAccessKey = (await read('secrets/minio-secret-key')).toString('utf8').trim();
  const pool = new Pool(d3DataPoolConfig({ profile, ca, password, certificateSha256: verified.certificates.postgres })); pool.on('error', () => undefined);
  const agent = new https.Agent({ ca, rejectUnauthorized: true, servername: profile.minio.name, minVersion: 'TLSv1.2', checkServerIdentity: d3DataPeer(profile.minio.name, verified.certificates.minio) });
  const s3 = new S3Client({ endpoint: `https://${profile.minio.ip}:9000`, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey },
    requestHandler: new NodeHttpHandler({ httpsAgent: agent, connectionTimeout: 10000, requestTimeout: 30000, socketTimeout: 30000 }) });
  const objects = new NodeD3DataObjects(s3, () => agent.destroy());
  let ending: Promise<void> | null = null; const endPool = () => ending ??= boundedSettlement(pool.end()); let checkoutStarted = false;
  return { objects, async connect(signal) { if (checkoutStarted) throw failed(); checkoutStarted = true; return checkoutD3DataSession(pool, endPool, signal); },
    async close() { objects.close(); await endPool().catch(() => undefined); } };
}
/** The injectable command transport exists for deterministic tests; installed calls always use S3Client. */
export class NodeD3DataObjects implements D3DataObjects {
  constructor(private readonly client: Pick<S3Client, 'send' | 'destroy'>, private readonly closeAgent: () => void = () => undefined) {}
  async ensureBuckets(signal?: AbortSignal) { for (const { bucket } of BACKUP_OBJECT_SOURCES) { try { await this.client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal }); }
    catch (cause) { if ((cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw failed(); await this.client.send(new CreateBucketCommand({ Bucket: bucket }), { abortSignal: signal }); } } }
  async read(bucket: string, key: string, signal?: AbortSignal) { if (!isBackupObjectAllowed(bucket, key)) throw failed(); const value = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
    if (!value.Body || !value.ContentLength || value.ContentLength > 33554432) throw failed(); const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of value.Body as AsyncIterable<Uint8Array>) { size += chunk.length; if (signal?.aborted || size > 33554432) { (value.Body as { destroy?: () => void }).destroy?.(); throw failed(); } chunks.push(Buffer.from(chunk)); }
    if (size !== value.ContentLength) throw failed(); return Buffer.concat(chunks); }
  async putImmutable(object: D3SeedObject, signal?: AbortSignal) { if (!isBackupObjectAllowed(object.bucket, object.key) || object.bytes !== object.body.length || sha256(object.body) !== object.sha256) throw failed();
    try { await this.client.send(new PutObjectCommand({ Bucket: object.bucket, Key: object.key, Body: object.body, ContentType: object.contentType, IfNoneMatch: '*', ChecksumSHA256: Buffer.from(object.sha256, 'hex').toString('base64') }), { abortSignal: signal }); }
    catch (cause) { if ((cause as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw failed(); }
    const observed = await this.read(object.bucket, object.key, signal); if (observed.length !== object.bytes || sha256(observed) !== object.sha256) throw failed('CONTROLLED_RECOVERY_D3_SOURCE_OBJECT_CONFLICT'); }
  async list(signal?: AbortSignal) { const result: Array<{ bucket: string; key: string }> = []; for (const source of BACKUP_OBJECT_SOURCES) {
    const value = await this.client.send(new ListObjectsV2Command({ Bucket: source.bucket, Prefix: source.prefix, MaxKeys: 33 }), { abortSignal: signal });
    if (value.IsTruncated) throw failed(); for (const object of value.Contents ?? []) { if (!object.Key || !isBackupObjectAllowed(source.bucket, object.Key) || result.length >= 32) throw failed(); result.push({ bucket: source.bucket, key: object.Key }); }
  } return result; }
  close() { this.client.destroy(); this.closeAgent(); }
}
