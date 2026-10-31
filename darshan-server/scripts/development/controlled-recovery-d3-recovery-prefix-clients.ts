import { Pool, type PoolConfig } from 'pg';
import { ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'node:https';
import { Readable } from 'node:stream';
import { canonicalJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile } from './controlled-recovery-d3-protected-files';
import { checkoutD3DataSession, d3DataPeer, d3DataPoolConfig, type D3DataSession } from './controlled-recovery-d3-source-data-clients';
import type { D3DataSql } from './controlled-recovery-d3-source-seal';
import type { D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import type { D3SourceLayoutBoundary } from './controlled-recovery-d3-source-services';
import { D3_PREFIX_APPLICATION, d3PrefixQueryBody, prefixFailure, type D3PrefixQueryId } from './controlled-recovery-d3-recovery-prefix-contract';

export interface D3PrefixSql { execute(id: D3PrefixQueryId): ReturnType<D3DataSql['query']>; }
export interface D3RecoveryPrefixClients { readonly kind: 'D3_READ_ONLY_PREFIX'; connect(signal?: AbortSignal): Promise<{ sql: D3PrefixSql; close(): Promise<void> }>; assertEmptyBuckets(signal?: AbortSignal): Promise<{ buckets: 0; objects: 0; inventorySha256: string }>; close(): Promise<void>; }
const clients = new WeakSet<object>();
export function assertD3ReadOnlyPrefixClients(value: D3RecoveryPrefixClients) { if (!clients.has(value) || !Object.isFrozen(value) || digest(Reflect.ownKeys(value).sort()) !== digest(['assertEmptyBuckets','close','connect','kind'])) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_CAPABILITY_REJECTED'); }
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw prefixFailure('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED'); };
const settle = (action: Promise<unknown>) => new Promise<void>((resolve, reject) => { const failed = () => prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_SETTLEMENT_UNCERTAIN'); const timer = setTimeout(() => reject(failed()), 10000); action.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); reject(failed()); }); });
/** Exact SQL statements and a one-transaction state machine; no query objects, callbacks or parameters. */
export function guardD3PrefixSql(raw: D3DataSql, signal?: AbortSignal): D3PrefixSql {
  let phase: 'NEW' | 'BEGUN' | 'PROVEN' | 'CLOSED' = 'NEW'; let failed = false; let previous: D3PrefixQueryId | null = null;
  return Object.freeze({ async execute(id: D3PrefixQueryId, ...extra: never[]) {
    try { if (extra.length) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_QUERY_REJECTED'); const text = d3PrefixQueryBody(id); if (id !== 'rollback') cancelled(signal); if (failed && id !== 'rollback') throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_QUERY_REJECTED');
      if (id === 'begin' ? phase !== 'NEW' : id === 'proof' ? phase !== 'BEGUN' : id === 'rollback' ? !['BEGUN','PROVEN'].includes(phase) : id === 'commit' ? phase !== 'PROVEN' : phase !== 'PROVEN') throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_QUERY_REJECTED');
      if (id === 'activity' && previous !== 'statistics_clear') throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_QUERY_REJECTED');
      const result = await raw.query(text); if (!result || !Array.isArray(result.rows) || result.rows.length > 128 || canonicalJson(result.rows).length > 131072) throw prefixFailure();
      if (id === 'proof') { const row = result.rows[0]; if (result.rows.length !== 1 || row?.transaction_read_only !== 'on' || row.default_transaction_read_only !== 'on') throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_NOT_READ_ONLY'); phase = 'PROVEN'; }
      else if (id === 'begin') phase = 'BEGUN'; else if (id === 'commit' || id === 'rollback') phase = 'CLOSED'; previous = id; return result;
    } catch (cause) { failed = true; if (cause instanceof ControlledRecoveryError) throw cause; throw prefixFailure(); }
  } });
}
/** The only admitted object request is an exact GET ListBuckets. Reconstruct rather than trust command hooks. */
export async function sendD3PrefixS3(send: (command: ListBucketsCommand, options: { abortSignal?: AbortSignal }) => Promise<unknown>, command: unknown, signal?: AbortSignal) {
  try {
  cancelled(signal); if (!(command instanceof ListBucketsCommand) || Object.getPrototypeOf(command) !== ListBucketsCommand.prototype || digest(command.input) !== digest({})) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_REQUEST_REJECTED');
  const value = await send(new ListBucketsCommand({}), { abortSignal: signal }); cancelled(signal); if (!value || typeof value !== 'object' || Array.isArray(value)) throw prefixFailure();
  const result = value as Record<string, unknown>, metadata = result.$metadata as { httpStatusCode?: number } | undefined;
  if (metadata?.httpStatusCode !== 200 || !Array.isArray(result.Buckets) || result.Buckets.length || Object.keys(result).some((key) => !['$metadata','Buckets','Owner','ContinuationToken','Prefix'].includes(key)) || ['ContinuationToken','NextContinuationToken','IsTruncated','Prefix'].some((key) => result[key] !== undefined)) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECTS_NOT_EMPTY');
  return { buckets: 0 as const, objects: 0 as const, inventorySha256: digest([]) };
  } catch (cause) { cancelled(signal); if (cause instanceof ControlledRecoveryError) throw cause; throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED'); }
}
/** Shared test seam wraps raw transports in the same closed capabilities as installed clients. */
export function guardD3RecoveryPrefixClients(raw: { connect(signal?: AbortSignal): Promise<Pick<D3DataSession, 'close'> & { client: D3DataSql }>; send(command: ListBucketsCommand, options: { abortSignal?: AbortSignal }): Promise<unknown>; close(): Promise<void> }): D3RecoveryPrefixClients {
  let connected = false, closing: Promise<void> | null = null; const result: D3RecoveryPrefixClients = Object.freeze({ kind: 'D3_READ_ONLY_PREFIX',
    async connect(signal?: AbortSignal) { cancelled(signal); if (connected || closing) throw prefixFailure(); connected = true; const session = await raw.connect(signal); let ended: Promise<void> | null = null; return Object.freeze({ sql: guardD3PrefixSql(session.client, signal), close: () => ended ??= settle(Promise.resolve().then(() => session.close())) }); },
    assertEmptyBuckets: (signal?: AbortSignal) => { if (closing) return Promise.reject(prefixFailure()); return sendD3PrefixS3(raw.send, new ListBucketsCommand({}), signal); },
    close: () => closing ??= settle(Promise.resolve().then(() => raw.close())),
  }); clients.add(result); return result;
}
export function d3RecoveryPrefixPoolConfig(input: Parameters<typeof d3DataPoolConfig>[0]): PoolConfig { const base = d3DataPoolConfig(input); return { ...base, application_name: D3_PREFIX_APPLICATION, options: `${base.options} -c default_transaction_read_only=on -c row_security=off -c idle_in_transaction_session_timeout=10000` }; }
/** Closed, bounded ListBuckets XML subset. No entity expansion, namespaces beyond the
 * exact S3 default, or ignored XML fields can disappear in SDK deserialization. */
function emptyBucketXml(bytes: Buffer): { Owner?: Record<string, string> } {
  const refuse = () => { throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED'); };
  let xml: string; try { xml = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return refuse(); }
  if ([...xml].some((c) => { const n = c.codePointAt(0)!; return n !== 9 && n !== 10 && n !== 13 && (n < 32 || n === 0xfffe || n === 0xffff); }) || /[&]/.test(xml)) return refuse();
  let at = 0; const whitespace = () => { while (/[\t\n\r ]/.test(xml[at] ?? '') && at < xml.length) at++; };
  const consume = (value: string) => { if (!xml.startsWith(value, at)) return refuse(); at += value.length; };
  if (xml.startsWith('<?xml')) { const declaration = /^<\?xml version=(?:"1\.0"|'1\.0')(?: encoding=(?:"UTF-8"|'UTF-8'))?\?>/.exec(xml); if (!declaration) return refuse(); at = declaration[0].length; }
  whitespace(); const root = /^<ListAllMyBucketsResult xmlns=(?:"http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/"|'http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/')>/.exec(xml.slice(at)); if (!root) return refuse(); at += root[0].length;
  let buckets = false, owner: Record<string, string> | undefined;
  while (at < xml.length) {
    whitespace(); if (xml.startsWith('</ListAllMyBucketsResult>', at)) break;
    if (xml.startsWith('<Buckets', at)) { if (buckets) return refuse(); buckets = true; if (xml.startsWith('<Buckets/>', at)) consume('<Buckets/>'); else { consume('<Buckets>'); whitespace(); consume('</Buckets>'); } }
    else if (xml.startsWith('<Owner', at)) {
      if (owner) return refuse(); owner = {};
      if (xml.startsWith('<Owner/>', at)) consume('<Owner/>'); else {
        consume('<Owner>'); while (at < xml.length) { whitespace(); if (xml.startsWith('</Owner>', at)) break; const field = xml.startsWith('<ID>', at) || xml.startsWith('<ID/>', at) ? 'ID' : xml.startsWith('<DisplayName>', at) || xml.startsWith('<DisplayName/>', at) ? 'DisplayName' : refuse(); if (Object.hasOwn(owner, field)) return refuse();
          if (xml.startsWith(`<${field}/>`, at)) { consume(`<${field}/>`); owner[field] = ''; } else { consume(`<${field}>`); const end = xml.indexOf('<', at); if (end < at) return refuse(); const text = xml.slice(at, end); if (Buffer.byteLength(text) > 256 || text.includes('>')) return refuse(); at = end; consume(`</${field}>`); owner[field] = text; }
        } consume('</Owner>');
      }
    } else return refuse();
  }
  consume('</ListAllMyBucketsResult>'); whitespace(); if (!buckets || at !== xml.length) return refuse(); return owner ? { Owner: owner } : {};
}
/** Buffer and validate the complete wire document BEFORE handing bytes to the SDK. */
export class BoundedD3PrefixHttpHandler extends NodeHttpHandler {
  private used = false; private proof: ReturnType<typeof emptyBucketXml> | null = null;
  verifyProjection(value: unknown) { const proof = this.proof; this.proof = null; if (!proof || !value || typeof value !== 'object') throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED'); const result = value as Record<string, unknown>; if (digest({ Owner: result.Owner }) !== digest(proof) || !Array.isArray(result.Buckets) || result.Buckets.length) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED'); }
  override async handle(...args: Parameters<NodeHttpHandler['handle']>) {
    const request = args[0], signal = args[1]?.abortSignal; if (request.method !== 'GET' || request.path !== '/' || this.used || (signal && !(signal instanceof AbortSignal))) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_REQUEST_REJECTED'); this.used = true;
    const result = await super.handle(...args); const body: unknown = result.response.body; if (!(body instanceof Readable)) throw prefixFailure();
    const abort = () => body.destroy(prefixFailure('CONTROLLED_RECOVERY_D3_SOURCE_CANCELLED')); const timer = setTimeout(() => body.destroy(prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED')), 30000); signal?.addEventListener('abort', abort, { once: true });
    try { cancelled(signal); if (result.response.statusCode !== 200) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED'); const chunks: Buffer[] = []; let length = 0; for await (const chunk of body) { const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string); length += bytes.length; if (length > 16384) throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_RESPONSE_LIMIT'); chunks.push(bytes); } cancelled(signal); const bytes = Buffer.concat(chunks); this.proof = emptyBucketXml(bytes); result.response.body = Readable.from([bytes]); return result; }
    catch (cause) { body.destroy(); if (cause instanceof ControlledRecoveryError) throw cause; throw prefixFailure('CONTROLLED_RECOVERY_D3_PREFIX_OBJECT_UNVERIFIED'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
/** Fixed certificate/credential-bound clients only; never ordinary app config, jobs or a writer facade. */
export async function createD3RecoveryPrefixClients(authority: D3OperationAuthority, profile: D3SourceBackupProfile, layout: Pick<D3SourceLayoutBoundary, 'verify'>): Promise<D3RecoveryPrefixClients> {
  const verified = await layout.verify(); const read = async (relative: string) => { const h = await openD3ProtectedFile(authority, `${authority.root}/source/${relative}`, 65536); try { return await h.readFile(); } finally { await h.close(); } };
  const ca = await read('tls/ca/ca.crt'), password = (await read('secrets/postgres-password')).toString('utf8').trim(), accessKeyId = (await read('secrets/minio-access-key')).toString('utf8').trim(), secretAccessKey = (await read('secrets/minio-secret-key')).toString('utf8').trim();
  const pool = new Pool(d3RecoveryPrefixPoolConfig({ profile, ca, password, certificateSha256: verified.certificates.postgres })); pool.on('error', () => undefined);
  const agent = new https.Agent({ ca, rejectUnauthorized: true, servername: profile.minio.name, minVersion: 'TLSv1.2', checkServerIdentity: d3DataPeer(profile.minio.name, verified.certificates.minio) });
  const handler = new BoundedD3PrefixHttpHandler({ httpsAgent: agent, connectionTimeout: 10000, requestTimeout: 30000, socketTimeout: 30000 });
  const s3 = new S3Client({ endpoint: `https://${profile.minio.ip}:9000`, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId, secretAccessKey }, requestHandler: handler });
  let ending: Promise<void> | null = null; const end = () => ending ??= pool.end();
  return guardD3RecoveryPrefixClients({ connect: (signal) => checkoutD3DataSession(pool, end, signal), send: async (command, options) => { const value = await s3.send(command, options); handler.verifyProjection(value); return value; }, close: async () => { s3.destroy(); agent.destroy(); await end(); } });
}
