import { Client } from 'pg';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { EventEmitter } from 'node:events';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile } from './controlled-recovery-d3-protected-files';
import type { D3SourceBackupProfile } from './controlled-recovery-d3-source-profile';
import type { D3SourceHealthProbes, D3SourceLayoutBoundary } from './controlled-recovery-d3-source-services';

type Role = 'postgres' | 'minio' | 'valkey';
type Mode = 'authenticated' | 'unauthenticated' | 'plaintext';
export interface D3HealthRequest { role: Role; mode: Mode; host: string; servername: string; ca: Buffer; expectedCertificateSha256: string; timeoutMs: number; signal?: AbortSignal;
  password: string; accessKey?: string; secretKey?: string; }
export interface D3HealthResult { ok: boolean; certificateSha256: string | null; rejected?: 'AUTH' | 'TLS_REQUIRED'; one?: number; database?: string; user?: string; version?: number; ssl?: boolean; status?: number; reply?: string; aclUser?: string; }
export interface D3HealthTransport { pg(input: D3HealthRequest): Promise<D3HealthResult>; s3(input: D3HealthRequest): Promise<D3HealthResult>; valkey(input: D3HealthRequest): Promise<D3HealthResult>; }
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_HEALTH_UNVERIFIED', 'The fixed authenticated certificate-bound source probe or explicit negative probe failed.');
function peer(input: D3HealthRequest, observed: (sha: string) => void) { return (_host: string, cert: tls.PeerCertificate) => {
  const error = tls.checkServerIdentity(input.servername, cert); if (error || !cert.raw || sha256(cert.raw) !== input.expectedCertificateSha256) return failed(); observed(sha256(cert.raw)); return undefined;
}; }
function deadline(input: D3HealthRequest) { const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), input.timeoutMs); const listener = () => abort.abort(); input.signal?.addEventListener('abort', listener, { once: true }); if (input.signal?.aborted) abort.abort();
  return { signal: abort.signal, close: () => { clearTimeout(timer); input.signal?.removeEventListener('abort', listener); } }; }

export type D3ValkeyParseResult = 'INCOMPLETE' | 'AUTHENTICATED' | 'AUTH_REJECTED' | 'TLS_REQUIRED';
/** Bounded fixed-response parser. Chunk boundaries carry no protocol meaning. */
export class D3ValkeyProbeParser {
  private bytes = Buffer.alloc(0); private cursor = 0; private frames = 0; private complete = false;
  constructor(private readonly mode: Mode) {}
  get receivedBytes() { return this.bytes.length; }
  push(chunk: Buffer): D3ValkeyParseResult {
    if (this.complete || this.bytes.length + chunk.length > 4096) throw failed(); this.bytes = Buffer.concat([this.bytes, chunk]);
    if (this.mode === 'plaintext') {
      if (this.bytes.length && this.bytes[0] !== 0x15 || this.bytes.length > 1 && this.bytes[1] !== 3 || this.bytes.length > 2 && this.bytes[2]! > 4) throw failed();
      if (this.bytes.length < 5) return 'INCOMPLETE'; if (this.bytes.readUInt16BE(3) !== 2 || this.bytes.length > 7) throw failed(); if (this.bytes.length < 7) return 'INCOMPLETE';
      if (this.bytes[5] !== 2) throw failed(); this.complete = true; return 'TLS_REQUIRED';
    }
    const expected = this.mode === 'authenticated' ? 3 : 1;
    while (this.cursor < this.bytes.length && this.frames < expected) {
      const start = this.cursor; const prefix = this.bytes[start]; if (![43, 45, 36].includes(prefix!)) throw failed();
      const end = this.bytes.indexOf('\r\n', start + 1); const stop = end === -1 ? this.bytes.length : end; const lineBytes = this.bytes.subarray(start + 1, stop);
      if (lineBytes.length > 512 || [...lineBytes].some((byte, index) => byte < 32 && !(end === -1 && byte === 13 && index === lineBytes.length - 1) || byte > 126)) throw failed();
      if (end === -1) return 'INCOMPLETE'; const line = lineBytes.toString('ascii'); let value = line; let next = end + 2;
      if (prefix === 36) { if (!/^(0|[1-9][0-9]{0,2})$/.test(line) || Number(line) > 512) throw failed(); const size = Number(line); if (this.bytes.length < next + size + 2) return 'INCOMPLETE';
        if (this.bytes[next + size] !== 13 || this.bytes[next + size + 1] !== 10 || [...this.bytes.subarray(next, next + size)].some((byte) => byte < 32 || byte > 126)) throw failed(); value = this.bytes.subarray(next, next + size).toString('ascii'); next += size + 2; }
      if (this.mode === 'unauthenticated') { if (prefix !== 45 || !/^NOAUTH [ -~]{1,480}$/.test(value)) throw failed(); }
      else if (prefix !== [43, 36, 43][this.frames] || value !== ['OK', 'd3-source', 'PONG'][this.frames]) throw failed();
      this.cursor = next; this.frames++;
    }
    if (this.frames !== expected) return 'INCOMPLETE'; if (this.cursor !== this.bytes.length) throw failed(); this.complete = true; return this.mode === 'authenticated' ? 'AUTHENTICATED' : 'AUTH_REJECTED';
  }
}

/** Only fixed read-only PostgreSQL, S3 and RESP health operations; no application startup or arbitrary query surface. */
export class NodeD3HealthTransport implements D3HealthTransport {
  async pg(input: D3HealthRequest): Promise<D3HealthResult> {
    let certificateSha256: string | null = null; const limit = deadline(input);
    const client = new Client({ host: input.host, port: 5432, database: 'darshan', user: 'darshan', password: input.mode === 'authenticated' ? input.password : 'd3-negative-probe-only',
      ssl: input.mode === 'plaintext' ? false : { ca: input.ca.toString('utf8'), rejectUnauthorized: true, servername: input.servername, minVersion: 'TLSv1.2', checkServerIdentity: peer(input, (value) => { certificateSha256 = value; }) },
      connectionTimeoutMillis: input.timeoutMs, query_timeout: input.timeoutMs, statement_timeout: input.timeoutMs, application_name: 'darshan-d3-source-health' });
    const destroy = () => { (client as unknown as { connection?: { stream?: net.Socket } }).connection?.stream?.destroy(); }; limit.signal.addEventListener('abort', destroy, { once: true });
    try { if (limit.signal.aborted) throw failed(); await client.connect(); const result = await client.query('SELECT 1 AS one, current_database() AS database, current_user AS "user", current_setting(\'server_version_num\')::integer AS version, ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
      if (result.rows.length !== 1) throw failed(); const row = result.rows[0] as { one: number; database: string; user: string; version: number; ssl: boolean }; return { ok: true, certificateSha256, ...row };
    } catch (cause) { const error = cause as { code?: string; message?: string }; if (input.mode === 'unauthenticated' && error.code === '28P01' && certificateSha256) return { ok: false, certificateSha256, rejected: 'AUTH' };
      if (input.mode === 'plaintext' && error.code === '28000' && /no encryption|SSL off/i.test(error.message ?? '')) return { ok: false, certificateSha256: null, rejected: 'TLS_REQUIRED' }; return { ok: false, certificateSha256 };
    } finally { limit.close(); limit.signal.removeEventListener('abort', destroy); destroy(); await client.end().catch(() => undefined); }
  }
  private rawHttp(input: D3HealthRequest): Promise<D3HealthResult> {
    const failure = (): D3HealthResult => ({ ok: false, certificateSha256: null });
    if (input.signal?.aborted || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 2000) return Promise.resolve(failure());
    return new Promise((resolve) => {
      type Resource = EventEmitter & { closed?: boolean; destroy(): unknown };
      const limit = deadline(input), resources = new Map<Resource, Promise<void>>(), closed = new Set<Resource>();
      let request: http.ClientRequest | undefined, socket: net.Socket | undefined;
      let agent: http.Agent | https.Agent | undefined, finishing = false, unsafe = false;
      const chunks: Buffer[] = []; let size = 0, expectedBytes: number | null = null;
      const destroy = (resource: Resource) => { try { resource.destroy(); } catch { unsafe = true; } };
      const watch = (resource: Resource) => {
        if (resources.has(resource)) return;
        resource.on('error', () => finish(failure())); // Remains observed through and after intentional teardown.
        resources.set(resource, new Promise<void>((done) => {
          const joined = () => { closed.add(resource); done(); if (!finishing) finish(failure()); };
          resource.once('close', joined); if (resource.closed === true) joined();
        }));
        if (resources.size > 8) { unsafe = true; finish(failure()); }
        if (finishing) destroy(resource);
      };
      const agentResources = () => agent ? [...Object.values(agent.sockets).flat(), ...Object.values(agent.freeSockets).flat(), ...Object.values(agent.requests).flat()] : [];
      const settle = async (candidate: D3HealthResult) => {
        for (const resource of agentResources()) watch(resource as Resource);
        for (const resource of resources.keys()) destroy(resource);
        try { agent?.destroy(); } catch { unsafe = true; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const drain = (async () => { for (;;) { const count = resources.size; await Promise.all([...resources.values()]); if (count === resources.size) return true; } })();
        void drain.catch(() => undefined);
        const joined = await Promise.race([drain, new Promise<false>((done) => { timer = setTimeout(() => done(false), 250); })]).catch(() => false);
        clearTimeout(timer);
        const exact = joined && !unsafe && [...resources.keys()].every((resource) => closed.has(resource)) && agentResources().length === 0;
        resolve(exact && !input.signal?.aborted && !limit.signal.aborted ? candidate : failure());
      };
      const finish = (candidate: D3HealthResult) => {
        if (finishing) return; finishing = true; limit.close(); limit.signal.removeEventListener('abort', abort);
        void settle(candidate).catch(() => resolve(failure()));
      };
      const abort = () => finish(failure());
      const bindSocket = (value: net.Socket) => { watch(value); if (socket && socket !== value) { unsafe = true; finish(failure()); } socket = value; if (finishing) destroy(value); };
      const checkedPeer = (value: net.Socket): string => {
        if (!(value instanceof tls.TLSSocket) || value.encrypted !== true || value.authorized !== true || value.authorizationError != null) throw failed();
        const cert = value.getPeerCertificate(true);
        if (!cert.raw?.length || tls.checkServerIdentity(input.servername, cert) || sha256(cert.raw) !== input.expectedCertificateSha256) throw failed();
        const fingerprint = sha256(cert.raw);
        // Fresh owned agents make these paths impossible; still inspect authorization/pin before refusing them.
        if (request?.reusedSocket || value.isSessionReused()) throw failed();
        return fingerprint;
      };
      try {
        const secure = input.mode !== 'plaintext';
        const tlsOptions = secure ? { ca: input.ca, rejectUnauthorized: true, servername: input.servername, minVersion: 'TLSv1.2' as const, checkServerIdentity: peer(input, () => undefined) } : {};
        agent = secure ? new https.Agent({ keepAlive: false, maxCachedSessions: 0, maxSockets: 1, maxTotalSockets: 1, ...tlsOptions }) : new http.Agent({ keepAlive: false, maxSockets: 1, maxTotalSockets: 1 });
        agent.on('error', () => finish(failure()));
        request = (secure ? https : http).request({ host: input.host, port: 9000, path: '/', method: 'GET', agent, signal: limit.signal, ...tlsOptions }, (incoming) => {
          watch(incoming);
          if (incoming.socket) watch(incoming.socket); if (request?.socket) watch(request.socket);
          try {
            if (!request || (request as http.ClientRequest & { agent?: http.Agent }).agent !== agent || !incoming.socket || request.socket !== incoming.socket) throw failed();
            bindSocket(incoming.socket); if (secure) checkedPeer(incoming.socket);
            if (!Number.isInteger(incoming.statusCode) || incoming.statusCode! < 100 || incoming.statusCode! > 599) throw failed();
            const length = incoming.headers['content-length'];
            if (length !== undefined) { if (typeof length !== 'string' || !/^(0|[1-9][0-9]{0,3})$/.test(length) || Number(length) > 8192) throw failed(); expectedBytes = Number(length); }
          } catch { finish(failure()); return; }
          incoming.on('aborted', () => finish(failure()));
          incoming.on('data', (chunk: Buffer) => { if (finishing) return; if (!Buffer.isBuffer(chunk) || size + chunk.length > 8192) { finish(failure()); return; } size += chunk.length; chunks.push(chunk); });
          incoming.on('end', () => {
            if (finishing) return;
            try {
              if (incoming.socket) watch(incoming.socket); if (request?.socket) watch(request.socket);
              if (!socket || incoming.complete !== true || incoming.aborted || expectedBytes !== null && expectedBytes !== size || request?.socket && request.socket !== socket || incoming.socket && incoming.socket !== socket) throw failed();
              const certificateSha256 = secure ? checkedPeer(socket) : null, text = Buffer.concat(chunks).toString('utf8');
              const auth = input.mode === 'unauthenticated' && incoming.statusCode === 403 && /<Code>AccessDenied<\/Code>/.test(text);
              const plain = input.mode === 'plaintext' && incoming.statusCode === 400 && /HTTP request.*HTTPS server/is.test(text);
              finish({ ok: false, certificateSha256, ...(auth ? { rejected: 'AUTH' as const } : plain ? { rejected: 'TLS_REQUIRED' as const } : {}), status: incoming.statusCode });
            } catch { finish(failure()); }
          });
        });
        watch(request); request.on('socket', bindSocket); if (request.socket) bindSocket(request.socket);
        limit.signal.addEventListener('abort', abort, { once: true });
        if (limit.signal.aborted || finishing) finish(failure()); else request.end();
      } catch { finish(failure()); }
    });
  }
  async s3(input: D3HealthRequest): Promise<D3HealthResult> {
    if (input.mode !== 'authenticated') return this.rawHttp(input); const limit = deadline(input); let certificateSha256: string | null = null;
    const agent = new https.Agent({ ca: input.ca, rejectUnauthorized: true, servername: input.servername, minVersion: 'TLSv1.2', checkServerIdentity: peer(input, (value) => { certificateSha256 = value; }) });
    const client = new S3Client({ endpoint: `https://${input.host}:9000`, region: 'us-east-1', forcePathStyle: true, maxAttempts: 1, credentials: { accessKeyId: input.accessKey!, secretAccessKey: input.secretKey! },
      requestHandler: new NodeHttpHandler({ httpsAgent: agent, connectionTimeout: input.timeoutMs, requestTimeout: input.timeoutMs, socketTimeout: input.timeoutMs }) });
    try { const value = await client.send(new ListBucketsCommand({}), { abortSignal: limit.signal }); return { ok: value.$metadata.httpStatusCode === 200, certificateSha256, status: value.$metadata.httpStatusCode }; }
    catch { return { ok: false, certificateSha256 }; } finally { limit.close(); client.destroy(); agent.destroy(); }
  }
  valkey(input: D3HealthRequest): Promise<D3HealthResult> {
    return new Promise((resolve) => {
      const limit = deadline(input); let certificateSha256: string | null = null; let done = false; let connected = false; let written = false; const parser = new D3ValkeyProbeParser(input.mode);
      const encode = (parts: string[]) => `*${parts.length}\r\n${parts.map((value) => `$${Buffer.byteLength(value)}\r\n${value}\r\n`).join('')}`;
      const socket = input.mode === 'plaintext' ? net.createConnection({ host: input.host, port: 6379 }) : tls.connect({ host: input.host, port: 6379, ca: input.ca, rejectUnauthorized: true,
        servername: input.servername, minVersion: 'TLSv1.2', checkServerIdentity: peer(input, (value) => { certificateSha256 = value; }) });
      const finish = (result: D3HealthResult) => { if (done) return; done = true; limit.close(); limit.signal.removeEventListener('abort', abort); socket.destroy(); resolve(result); }; const abort = () => finish({ ok: false, certificateSha256 });
      socket.once(input.mode === 'plaintext' ? 'connect' : 'secureConnect', () => { connected = true; if (limit.signal.aborted || (input.mode !== 'plaintext' && !certificateSha256)) { abort(); return; }
        written = true; socket.write(input.mode === 'authenticated' ? encode(['AUTH', 'd3-source', input.password]) + encode(['ACL', 'WHOAMI']) + encode(['PING']) : encode(['PING'])); });
      socket.on('data', (chunk: Buffer) => { try { const result = parser.push(chunk);
        if (result === 'AUTHENTICATED') finish({ ok: true, certificateSha256, reply: 'PONG', aclUser: 'd3-source' });
        else if (result === 'AUTH_REJECTED') finish({ ok: false, certificateSha256, rejected: 'AUTH' });
        else if (result === 'TLS_REQUIRED') finish({ ok: false, certificateSha256: null, rejected: 'TLS_REQUIRED' });
      } catch { abort(); }
      });
      socket.on('error', (error: NodeJS.ErrnoException) => { if (input.mode === 'plaintext' && connected && written && parser.receivedBytes === 0 && error.code === 'ECONNRESET') finish({ ok: false, certificateSha256: null, rejected: 'TLS_REQUIRED' }); else abort(); });
      socket.on('close', () => { if (!done && input.mode === 'plaintext' && connected && written && !limit.signal.aborted && parser.receivedBytes === 0) finish({ ok: false, certificateSha256: null, rejected: 'TLS_REQUIRED' }); else if (!done) abort(); });
      limit.signal.addEventListener('abort', abort, { once: true }); if (limit.signal.aborted) abort();
    });
  }
}

export class ProtectedD3SourceHealth implements D3SourceHealthProbes {
  constructor(private readonly authority: D3OperationAuthority, private readonly profile: D3SourceBackupProfile, private readonly layout: Pick<D3SourceLayoutBoundary, 'verify'>,
    private readonly verifyTarget: (role: Role, containerId: string) => Promise<void>, private readonly transport: D3HealthTransport = new NodeD3HealthTransport()) {}
  readOnlyView(layout: Pick<D3SourceLayoutBoundary, 'verify'>, verifyTarget: (role: Role, containerId: string) => Promise<void>) { return new ProtectedD3SourceHealth(this.authority, this.profile, layout, verifyTarget, this.transport); }
  private async read(relative: string) { const handle = await openD3ProtectedFile(this.authority, `${this.authority.root}/source/${relative}`, 64 * 1024); try { return await handle.readFile(); } finally { await handle.close(); } }
  private async probe(role: Role, input: { profile: D3SourceBackupProfile; containerId: string; timeoutMs: number; signal?: AbortSignal }) {
    try {
      if (digest(input.profile) !== digest(this.profile) || !/^[a-f0-9]{64}$/.test(input.containerId) || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 3 || input.timeoutMs > this.profile.health.probe_timeout_ms || input.signal?.aborted) throw failed();
      await this.verifyTarget(role, input.containerId); const layout = await this.layout.verify(); const ca = await this.read('tls/ca/ca.crt'); const password = (await this.read(`secrets/${role === 'minio' ? 'minio-secret-key' : `${role}-password`}`)).toString('utf8').trim();
      const request = (mode: Mode): D3HealthRequest => ({ role, mode, host: this.profile[role].ip, servername: `darshan-d2-20261030-${role}`, ca, expectedCertificateSha256: layout.certificates[role], timeoutMs: Math.max(1, Math.floor(input.timeoutMs / 3)), password: mode === 'authenticated' ? password : '',
        ...(input.signal ? { signal: input.signal } : {}) });
      const positive = request('authenticated'); if (role === 'minio') { positive.accessKey = (await this.read('secrets/minio-access-key')).toString('utf8').trim(); positive.secretKey = (await this.read('secrets/minio-secret-key')).toString('utf8').trim(); }
      const call = role === 'postgres' ? this.transport.pg.bind(this.transport) : role === 'minio' ? this.transport.s3.bind(this.transport) : this.transport.valkey.bind(this.transport);
      const yes = await call(positive); const no = await call(request('unauthenticated')); const plain = await call(request('plaintext'));
      if (!yes.ok || yes.certificateSha256 !== layout.certificates[role] || no.ok || no.rejected !== 'AUTH' || no.certificateSha256 !== layout.certificates[role] || plain.ok || plain.rejected !== 'TLS_REQUIRED' || input.signal?.aborted) throw failed();
      if (role === 'postgres' && (yes.one !== 1 || yes.database !== 'darshan' || yes.user !== 'darshan' || !yes.ssl || !yes.version || yes.version < 160000 || yes.version >= 170000)) throw failed();
      if (role === 'minio' && yes.status !== 200) throw failed(); if (role === 'valkey' && (yes.reply !== 'PONG' || yes.aclUser !== 'd3-source')) throw failed();
      return { authenticated: true, tlsVerified: true, plaintextRejected: true, unauthenticatedRejected: true, peerCertificateSha256: layout.certificates[role], evidenceSha256: digest({ role, containerId: input.containerId, yes, no, plain }) };
    } catch { throw failed(); }
  }
  async postgresTlsSelect(input: Parameters<D3SourceHealthProbes['postgresTlsSelect']>[0]) { return { ...await this.probe('postgres', input), result: '1' as const, database: 'darshan' as const, user: 'darshan' as const, serverMajor: 16 as const }; }
  async minioTlsS3(input: Parameters<D3SourceHealthProbes['minioTlsS3']>[0]) { return { ...await this.probe('minio', input), operation: 'LIST_BUCKETS' as const, success: true }; }
  async valkeyTlsPing(input: Parameters<D3SourceHealthProbes['valkeyTlsPing']>[0]) { return { ...await this.probe('valkey', input), reply: 'PONG' as const, aclUser: 'd3-source' as const }; }
}
