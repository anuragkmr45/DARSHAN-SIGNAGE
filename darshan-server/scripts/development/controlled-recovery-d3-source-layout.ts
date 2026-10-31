import { createHash, createPrivateKey, createPublicKey, randomBytes, X509Certificate } from 'node:crypto';
import { lstat, mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks, syncD3Directory } from './controlled-recovery-d3-protected-files';
import { D3_OPENSSL, EnrolledD3SourceCrypto, isD3SourceProcessUncertain, type D3CertificateRole } from './controlled-recovery-d3-source-crypto';
import type { D3SourceLayoutBoundary, D3SourceLayoutReceipt } from './controlled-recovery-d3-source-services';

const roles = ['ca', 'postgres', 'minio', 'valkey'] as const;
const credentials = ['postgres-password', 'minio-access-key', 'minio-secret-key', 'valkey-password', 'jwt-secret'] as const;
const credentialBytes = (name: string) => name === 'minio-access-key' ? 10 : name === 'minio-secret-key' ? 20 : 32;
const valkeyConfiguration = 'bind 0.0.0.0\nprotected-mode yes\nport 0\ntls-port 6379\naclfile /data/.d3-config/users.acl\nappendonly yes\nappendfsync always\nmaxmemory 33554432\nmaxmemory-policy noeviction\n';
const postgresHba = 'local all all scram-sha-256\nhostnossl all all 0.0.0.0/0 reject\nhostssl darshan darshan 172.30.250.0/28 scram-sha-256\nhostssl all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n';
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ format: z.literal('darshan-d3-source-layout-v1'), operationId: z.string().uuid(), siteId: z.string(), repositoryId: z.string().uuid(),
  opensslSha256: sha, inventory: z.array(z.object({ path: z.string(), sha256: sha, bytes: z.number().int().positive() }).strict()).max(64),
  retainedSecretsSha256: sha, caSha256: sha, certificates: z.object({ postgres: sha, minio: sha, valkey: sha }).strict(), receiptSha256: sha }).strict();
type LayoutRecord = z.infer<typeof receiptSchema>;
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID', 'Retained source secrets, CA, certificate identity, expiry, ownership, or publication differs.');
const uncertain = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN', 'An enrolled layout process has not proved settlement; retained layout authority is locked for investigation.');
const root = (authority: D3OperationAuthority) => `${authority.root}/source`;
export function d3SourceCertificateSans(role: Exclude<D3CertificateRole, 'ca'>): string[] {
  return [`DNS:darshan-d2-20261030-${role}`, `DNS:${role}`, `IP Address:172.30.250.${{ postgres: 2, minio: 3, valkey: 4 }[role]}`];
}
export function d3SourceCertificateConfig(role: D3CertificateRole): string {
  if (role === 'ca') return '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\nCN=Darshan D3 Source Disposable CA\nO=Darshan NonProduction\n[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n';
  const ip = { postgres: 2, minio: 3, valkey: 4 }[role]; return `[req]\nprompt=no\ndistinguished_name=dn\nreq_extensions=req_ext\n[dn]\nCN=darshan-d2-20261030-${role}\nO=Darshan NonProduction\n[req_ext]\nsubjectAltName=DNS:darshan-d2-20261030-${role},DNS:${role},IP:172.30.250.${ip}\n[v3_server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:darshan-d2-20261030-${role},DNS:${role},IP:172.30.250.${ip}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n`;
}
function certificatePaths(role: D3CertificateRole) { return { key: `tls/${role}/${role === 'ca' ? 'ca' : 'server'}.key`, cert: `tls/${role}/${role === 'ca' ? 'ca' : role === 'minio' ? 'public' : 'server'}.crt` }; }
function certificateIdentity(certBytes: Buffer, keyBytes: Buffer, role: D3CertificateRole, caBytes: Buffer | undefined, now: number) {
  const cert = new X509Certificate(certBytes); const key = createPrivateKey(keyBytes); const pub = cert.publicKey;
  if (key.asymmetricKeyType !== 'ec' || pub.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || pub.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || !cert.checkPrivateKey(key)) throw failed();
  const from = Date.parse(cert.validFrom); const to = Date.parse(cert.validTo); const skew = 5 * 60 * 1000; const maximum = (role === 'ca' ? 30 : 7) * 86400000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > now + skew || to - now < 86400000 || to - from > maximum + skew || to > now + maximum + skew) throw failed();
  if (role === 'ca') { if (!cert.ca || cert.subject !== 'CN=Darshan D3 Source Disposable CA\nO=Darshan NonProduction' || cert.issuer !== cert.subject || !cert.verify(pub) || cert.subjectAltName || cert.serialNumber !== '01') throw failed(); }
  else { const ca = new X509Certificate(caBytes!); if (cert.ca || !cert.verify(ca.publicKey) || cert.issuer !== ca.subject || cert.subject !== `CN=darshan-d2-20261030-${role}\nO=Darshan NonProduction` ||
      cert.serialNumber !== { postgres: '02', minio: '03', valkey: '04' }[role] || from < Date.parse(ca.validFrom) - skew || to > Date.parse(ca.validTo) ||
      digest((cert.subjectAltName ?? '').split(', ').sort()) !== digest(d3SourceCertificateSans(role).sort()) || digest(cert.keyUsage) !== digest(['1.3.6.1.5.5.7.3.1'])) throw failed(); }
  return { fingerprint: sha256(cert.raw), publicKeySha256: sha256(pub.export({ type: 'spki', format: 'der' })) };
}

/** The only private bytes returned by this provider are through explicit protected-file reads for internal clients, never receipts/errors. */
export class ProtectedD3SourceLayout implements D3SourceLayoutBoundary {
  constructor(readonly authority: D3OperationAuthority, private readonly dependentAuthorityExists: () => Promise<boolean>,
    private readonly crypto: Pick<EnrolledD3SourceCrypto, 'run'> = new EnrolledD3SourceCrypto(authority), private readonly now: () => number = Date.now, private readonly readOnly = false) {}
  readOnlyView() { return new ProtectedD3SourceLayout(this.authority, this.dependentAuthorityExists, this.crypto, this.now, true); }
  private path(relative: string) { return `${root(this.authority)}/${relative}`; }
  private async read(relative: string): Promise<Buffer> { if (!this.readOnly) await recoverD3PublishedLinks(this.authority, this.path(relative)); const handle = await openD3ProtectedFile(this.authority, this.path(relative), 64 * 1024); try { return await handle.readFile(); } finally { await handle.close(); } }
  private async optional(relative: string): Promise<Buffer | null> { try { return await this.read(relative); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null; throw cause; } }
  private async fixed(relative: string, bytes: Buffer) { const existing = await this.optional(relative); if (existing) { if (!existing.equals(bytes)) throw failed(); return; }
    await publishD3ProtectedBytes(this.authority, this.path(relative), bytes); }
  private async receipt(): Promise<LayoutRecord | null> {
    const bytes = await this.optional('layout-receipt.json'); if (!bytes) return null;
    const value = receiptSchema.parse(parseStrictJson(bytes, 64 * 1024)); const { receiptSha256, ...unsigned } = value;
    if (!canonicalJson(value).equals(bytes) || receiptSha256 !== digest(unsigned) || value.operationId !== this.authority.operationId || value.siteId !== this.authority.siteId || value.repositoryId !== this.authority.repositoryId || value.opensslSha256 !== D3_OPENSSL.sha256) throw failed(); return value;
  }
  private async withLock<T>(create: boolean, action: () => Promise<T>): Promise<T> {
    await protectD3Directory(this.authority, root(this.authority), create); const lock = this.path('layout.lock');
    try { await mkdir(lock, { mode: 0o700 }); await syncD3Directory(root(this.authority)); }
    catch { const marker = await this.optional('layout.lock/uncertainty.json').catch(() => null); if (marker) throw uncertain(); throw failed(); }
    let retained = false;
    try { return await action(); }
    catch (cause) {
      if (isD3SourceProcessUncertain(cause)) { retained = true; const binding = { format: 'darshan-d3-source-layout-uncertain-v1', operationId: this.authority.operationId, siteId: this.authority.siteId, repositoryId: this.authority.repositoryId, opensslSha256: D3_OPENSSL.sha256, reason: 'PROCESS_SETTLEMENT_UNCERTAIN' };
        await publishD3ProtectedBytes(this.authority, `${lock}/uncertainty.json`, canonicalJson({ ...binding, receiptSha256: digest(binding) })).catch(() => undefined); await syncD3Directory(lock).catch(() => undefined); await syncD3Directory(root(this.authority)).catch(() => undefined); }
      throw cause;
    } finally { if (!retained) { await rmdir(lock); await syncD3Directory(root(this.authority)); } }
  }
  private async removeMatchingPending(relative: string, expected: Buffer) {
    const handle = await openD3ProtectedFile(this.authority, this.path(relative), 64 * 1024);
    try { const stat = await handle.stat(); if (!(await handle.readFile()).equals(expected)) throw failed(); const current = await lstat(this.path(relative)); if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || current.nlink !== 1) throw failed(); await unlink(this.path(relative)); await syncD3Directory(dirname(this.path(relative))); }
    finally { await handle.close(); }
  }
  private async validateGenerated(role: D3CertificateRole, type: 'key' | 'cert', bytes: Buffer) {
    const paths = certificatePaths(role);
    if (type === 'key') { const key = createPrivateKey(bytes); if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw failed(); const cert = await this.optional(paths.cert); if (cert) certificateIdentity(cert, bytes, role, role === 'ca' ? undefined : await this.read('tls/ca/ca.crt'), this.now()); }
    else certificateIdentity(bytes, await this.read(paths.key), role, role === 'ca' ? undefined : await this.read('tls/ca/ca.crt'), this.now());
  }
  private async cleanPendingCsr(role: D3CertificateRole, signal?: AbortSignal) {
    if (role === 'ca') return; const relative = `tls/${role}/pending.csr`; const bytes = await this.optional(relative); if (!bytes) return;
    const publicKey = createPublicKey((await this.crypto.run('csr-public-key', role, signal)).publicText); const cert = new X509Certificate(await this.read(certificatePaths(role).cert));
    if (!publicKey.export({ format: 'der', type: 'spki' }).equals(cert.publicKey.export({ format: 'der', type: 'spki' }))) throw failed(); await this.removeMatchingPending(relative, bytes);
  }
  private async generated(role: D3CertificateRole, type: 'key' | 'cert', signal?: AbortSignal) {
    if (signal?.aborted) throw failed();
    const paths = certificatePaths(role); const relative = paths[type]; const pending = `tls/${role}/pending.${type === 'key' ? 'key' : 'crt'}`; const retained = await this.optional(relative);
    if (retained) { await this.validateGenerated(role, type, retained); const remainder = await this.optional(pending); if (remainder) { if (!remainder.equals(retained)) throw failed(); await this.validateGenerated(role, type, remainder); await this.removeMatchingPending(pending, remainder); } if (type === 'cert') await this.cleanPendingCsr(role, signal); return; }
    if (type === 'key' && await this.optional(paths.cert)) throw failed();
    if (!await this.optional(pending)) {
      if (type === 'key') await this.crypto.run('ec-key', role, signal);
      else if (role === 'ca') await this.crypto.run('ca-cert', role, signal);
      else { if (!await this.optional(`tls/${role}/pending.csr`)) await this.crypto.run('csr', role, signal); if (signal?.aborted) throw failed(); await this.crypto.run('service-cert', role, signal); }
    }
    if (signal?.aborted) throw failed(); const bytes = await this.read(pending);
    await this.validateGenerated(role, type, bytes); await this.fixed(relative, bytes); await this.removeMatchingPending(pending, bytes); if (type === 'cert') await this.cleanPendingCsr(role, signal);
  }
  async prepare(signal?: AbortSignal): Promise<D3SourceLayoutReceipt> {
    try {
      if (this.readOnly) throw failed();
      if (signal?.aborted) throw failed();
      return await this.withLock(true, async () => {
        if (await this.receipt()) return this.verifyUnlocked();
        if (await this.dependentAuthorityExists()) throw failed();
        for (const directory of ['secrets', 'config', 'tls', ...roles.map((role) => `tls/${role}`), 'tls/minio/CAs']) await protectD3Directory(this.authority, this.path(directory), true);
        await this.crypto.run('version', 'ca', signal);
        for (const name of credentials) { if (signal?.aborted) throw failed(); if (!await this.optional(`secrets/${name}`)) await this.fixed(`secrets/${name}`, Buffer.from(randomBytes(credentialBytes(name)).toString('hex') + '\n')); }
        const password = (await this.read('secrets/valkey-password')).toString('utf8').trim();
        await this.fixed('secrets/valkey.acl', Buffer.from(`user default off\nuser d3-source on #${createHash('sha256').update(password).digest('hex')} ~* &* +ping +acl|whoami\n`));
        await this.fixed('config/valkey.conf', Buffer.from(valkeyConfiguration)); await this.fixed('config/pg_hba.conf', Buffer.from(postgresHba));
        for (const role of roles) { if (signal?.aborted) throw failed(); await this.fixed(`tls/${role}/certificate.cnf`, Buffer.from(d3SourceCertificateConfig(role))); await this.generated(role, 'key', signal); await this.generated(role, 'cert', signal); }
        const ca = await this.read('tls/ca/ca.crt'); for (const role of ['postgres', 'minio', 'valkey']) await this.fixed(`tls/${role}/ca.crt`, ca);
        await this.fixed('tls/minio/CAs/ca.crt', ca); await this.fixed('tls/minio/private.key', await this.read('tls/minio/server.key'));
        const value = await this.inspect(); if (signal?.aborted) throw failed(); await publishD3ProtectedBytes(this.authority, this.path('layout-receipt.json'), canonicalJson(value));
        return this.verifyUnlocked();
      });
    } catch (cause) { if (isD3SourceProcessUncertain(cause)) throw cause; throw failed(); }
  }
  private async inspect(): Promise<LayoutRecord> {
    await this.crypto.run('version', 'ca'); const inventory: LayoutRecord['inventory'] = []; const keys: string[] = []; const fingerprints: Record<string, string> = {};
    const names = ['config/pg_hba.conf', 'config/valkey.conf', ...credentials.map((name) => `secrets/${name}`), 'secrets/valkey.acl'];
    const secretValues = await Promise.all(credentials.map(async (name) => (await this.read(`secrets/${name}`)).toString('utf8')));
    if (new Set(secretValues).size !== credentials.length || secretValues.some((value, index) => !new RegExp(`^[a-f0-9]{${credentialBytes(credentials[index]!) * 2}}\\n$`).test(value))) throw failed();
    if ((await this.read('config/pg_hba.conf')).toString('utf8') !== postgresHba || (await this.read('config/valkey.conf')).toString('utf8') !== valkeyConfiguration) throw failed();
    const expectedAcl = `user default off\nuser d3-source on #${createHash('sha256').update(secretValues[3]!.trim()).digest('hex')} ~* &* +ping +acl|whoami\n`;
    if ((await this.read('secrets/valkey.acl')).toString('utf8') !== expectedAcl) throw failed();
    for (const role of roles) {
      const paths = certificatePaths(role); const identity = certificateIdentity(await this.read(paths.cert), await this.read(paths.key), role, role === 'ca' ? undefined : await this.read('tls/ca/ca.crt'), this.now());
      const text = (await this.crypto.run('certificate-text', role)).publicText; const algorithms = [...text.matchAll(/Signature Algorithm:\s*([^\n]+)/gu)].map((match) => match[1]!.trim()); if (!algorithms.length || algorithms.some((value) => value !== 'ecdsa-with-SHA256')) throw failed();
      if (role === 'ca' ? !/CA:TRUE, pathlen:0/.test(text) || !/Certificate Sign, CRL Sign/.test(text) : !/CA:FALSE/.test(text) || !/Digital Signature/.test(text)) throw failed();
      keys.push(identity.publicKeySha256); fingerprints[role] = identity.fingerprint; names.push(paths.key, paths.cert, `tls/${role}/certificate.cnf`);
      if ((await this.read(`tls/${role}/certificate.cnf`)).toString('utf8') !== d3SourceCertificateConfig(role)) throw failed();
      if (role !== 'ca') { names.push(`tls/${role}/ca.crt`); if (!(await this.read(`tls/${role}/ca.crt`)).equals(await this.read('tls/ca/ca.crt'))) throw failed(); }
    }
    if (new Set(keys).size !== roles.length || !(await this.read('tls/minio/private.key')).equals(await this.read('tls/minio/server.key')) || !(await this.read('tls/minio/CAs/ca.crt')).equals(await this.read('tls/ca/ca.crt'))) throw failed();
    names.push('tls/minio/private.key', 'tls/minio/CAs/ca.crt'); names.sort();
    const inspectTree = async (directory: string) => { await protectD3Directory(this.authority, this.path(directory)); for (const entry of await readdir(this.path(directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`; if (entry.isDirectory() && names.some((name) => name.startsWith(`${path}/`))) await inspectTree(path);
      else if (!entry.isFile() || !names.includes(path)) throw failed(); } };
    for (const directory of ['config', 'secrets', 'tls']) await inspectTree(directory);
    for (const path of names) { const bytes = await this.read(path); inventory.push({ path, sha256: sha256(bytes), bytes: bytes.length }); }
    const unsigned = { format: 'darshan-d3-source-layout-v1' as const, operationId: this.authority.operationId, siteId: this.authority.siteId, repositoryId: this.authority.repositoryId, opensslSha256: D3_OPENSSL.sha256, inventory,
      retainedSecretsSha256: digest(inventory.filter(({ path }) => path.startsWith('secrets/'))), caSha256: fingerprints.ca!, certificates: { postgres: fingerprints.postgres!, minio: fingerprints.minio!, valkey: fingerprints.valkey! } };
    return receiptSchema.parse({ ...unsigned, receiptSha256: digest(unsigned) });
  }
  async verify(): Promise<D3SourceLayoutReceipt> {
    if (this.readOnly) { try { await protectD3Directory(this.authority, root(this.authority)); if (await lstat(this.path('layout.lock')).then(() => true, (cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return false; throw cause; })) throw failed();
      const retained = await this.receipt(); if (!retained || digest(retained) !== digest(await this.inspect())) throw failed(); return this.publicReceipt(retained); } catch (cause) { if (isD3SourceProcessUncertain(cause)) throw cause; throw failed(); } }
    try { return await this.withLock(false, () => this.verifyUnlocked()); } catch (cause) { if (isD3SourceProcessUncertain(cause)) throw cause; throw failed(); }
  }
  private async verifyUnlocked(): Promise<D3SourceLayoutReceipt> {
    const retained = await this.receipt(); if (!retained) throw failed();
    for (const role of roles) { const paths = certificatePaths(role); await this.read(paths.key); await this.read(paths.cert); }
    for (const role of roles) { await this.generated(role, 'key'); await this.generated(role, 'cert'); }
    if (digest(retained) !== digest(await this.inspect())) throw failed();
    return this.publicReceipt(retained);
  }
  private publicReceipt(retained: LayoutRecord): D3SourceLayoutReceipt { return { evidenceSha256: retained.receiptSha256, retainedSecretsSha256: retained.retainedSecretsSha256, caSha256: retained.caSha256, certificates: retained.certificates, protectedModesVerified: true, exclusiveRetainedSecretsVerified: true }; }
}
