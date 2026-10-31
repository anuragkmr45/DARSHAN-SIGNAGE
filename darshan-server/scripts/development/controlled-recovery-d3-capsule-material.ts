import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { link, lstat, readdir, unlink } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { canonicalJson, parseStrictJson } from '../../src/backups/backup-broker-protocol';
import { parseCanonicalEd25519PrivateKey } from '../../src/backups/ed25519-public-keyring';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { D3_CAPSULE_TLS_ROLES, d3CapsuleCertificateConfig, EnrolledD3CapsuleCrypto, validateD3CapsuleCertificate, type D3CapsuleTlsRole } from './controlled-recovery-d3-capsule-crypto';
import { openD3ProtectedFile, protectD3Directory, publishD3ProtectedBytes, recoverD3PublishedLinks, syncD3Directory } from './controlled-recovery-d3-protected-files';

const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPSULE_MATERIAL_INVALID', 'Retained disposable capsule material, private publication, authority separation or certificate identity differs.');
/** Known-byte 0600 publication only; recovery never guesses bytes or relaxes the private helper. */
export async function publishExactD3CapsulePrivateBytes(authority: D3OperationAuthority, path: string, expected: Buffer, publish: typeof publishD3ProtectedBytes = publishD3ProtectedBytes) {
  if (!expected.length || expected.length > 16777216) throw failed(); await protectD3Directory(authority, dirname(path), true); await recoverD3PublishedLinks(authority, path);
  const read = async (candidate: string) => { const file = await openD3ProtectedFile(authority, candidate, 16777216); try { const stat = await file.stat(), bytes = await file.readFile(), after = await lstat(candidate); if (stat.dev !== after.dev || stat.ino !== after.ino || after.nlink !== 1 || !bytes.equals(expected)) throw failed(); return stat; } finally { await file.close(); } };
  let retained = false; try { await read(path); retained = true; } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
  const prefix = `${basename(path)}.`, names = (await readdir(dirname(path))).filter((name) => name.startsWith(prefix) && /^[a-f0-9-]{36}\.tmp$/.test(name.slice(prefix.length))); if (names.length > 1) throw failed();
  if (names.length) { const temporary = `${dirname(path)}/${names[0]}`, stat = await read(temporary); if (!retained) { await link(temporary, path); await syncD3Directory(dirname(path)); retained = true; } const after = await lstat(temporary); if (stat.dev !== after.dev || stat.ino !== after.ino || ![1, 2].includes(after.nlink)) throw failed(); await unlink(temporary); await syncD3Directory(dirname(path)); }
  if (!retained) { try { await publish(authority, path, expected); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; } } await read(path);
}
export const D3_CAPSULE_SIGNERS = ['policy', 'manifest', 'release'] as const;
export type D3CapsuleSigner = typeof D3_CAPSULE_SIGNERS[number];
export interface D3CapsuleMaterial { keys: Record<D3CapsuleSigner, { privateKey: Buffer; publicKey: string; keyId: string }>; tls: Record<D3CapsuleTlsRole, { key: Buffer; certificate: Buffer }>; metricsToken: Buffer; grafanaPassword: Buffer; monitoringPassword: Buffer; }
function key(bytes: Buffer, algorithm: 'ed25519' | 'ec') { const value = algorithm === 'ed25519' ? parseCanonicalEd25519PrivateKey(bytes, 'Disposable D3 capsule authority') : createPrivateKey(bytes); if (value.asymmetricKeyType !== algorithm || !Buffer.from(value.export({ type: 'pkcs8', format: 'pem' })).equals(bytes) || algorithm === 'ec' && value.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw failed(); return value; }

/** General private material remains 0600. All mutation callers must own the capsule lock. */
export class ProtectedD3CapsuleMaterial {
  constructor(readonly authority: D3OperationAuthority, private readonly crypto: Pick<EnrolledD3CapsuleCrypto, 'run'> = new EnrolledD3CapsuleCrypto(authority), private readonly readOnly = false) {}
  readOnlyView() { return new ProtectedD3CapsuleMaterial(this.authority, this.crypto, true); }
  private path(relative: string) { return `${this.authority.root}/capsule/private/${relative}`; }
  private async bytes(path: string) { const file = await openD3ProtectedFile(this.authority, path, 65536); try { const before = await file.stat(), bytes = await file.readFile(), after = await file.stat(), current = await lstat(path); if (before.dev !== current.dev || before.ino !== current.ino || current.nlink !== 1 || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== bytes.length) throw failed(); return bytes; } finally { await file.close(); } }
  /** Recover pre-link and post-link windows only for this exact canonical path and valid bytes. */
  private async retained(relative: string, validate: (bytes: Buffer) => unknown): Promise<Buffer | null> {
    const path = this.path(relative); if (!this.readOnly) await protectD3Directory(this.authority, dirname(path), true);
    const names = await readdir(dirname(path)).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return []; throw cause; }); const prefix = `${basename(path)}.`;
    const pending = names.filter((name) => name.startsWith(prefix) && /^[a-f0-9-]{36}\.tmp$/.test(name.slice(prefix.length)));
    if (this.readOnly && pending.length) throw failed(); if (!this.readOnly) await recoverD3PublishedLinks(this.authority, path);
    let bytes: Buffer | null; try { bytes = await this.bytes(path); validate(bytes); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; bytes = null; }
    const remaining = pending;
    for (const name of remaining) { const temporary = `${dirname(path)}/${name}`; const stat = await lstat(temporary).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; }); if (!stat) continue; if (remaining.length !== 1 || this.readOnly) throw failed(); const candidate = await this.bytes(temporary); validate(candidate); if (bytes && !bytes.equals(candidate)) throw failed();
      if (!bytes) { await link(temporary, path); await syncD3Directory(dirname(path)); bytes = candidate; } const current = await lstat(temporary); if (current.dev !== stat.dev || current.ino !== stat.ino || ![1, 2].includes(current.nlink)) throw failed(); await unlink(temporary); await syncD3Directory(dirname(path)); }
    return bytes;
  }
  async fixed(relative: string, bytes: Buffer) { const previous = await this.retained(relative, () => undefined); if (previous) { if (!previous.equals(bytes)) throw failed(); return previous; } if (this.readOnly) throw failed(); await publishD3ProtectedBytes(this.authority, this.path(relative), bytes); const actual = await this.retained(relative, () => undefined); if (!actual?.equals(bytes)) throw failed(); return actual; }
  private async generated(relative: string, make: () => Buffer, validate: (bytes: Buffer) => unknown, complete: boolean) { let bytes = await this.retained(relative, validate); if (!bytes) { if (this.readOnly || complete) throw failed(); bytes = make(); validate(bytes); await this.fixed(relative, bytes); } return bytes; }
  private async promote(relative: string, pending: string, validate: (bytes: Buffer) => unknown) {
    const retained = await this.retained(relative, validate); const source = await this.retained(pending, validate); if (!retained && !source) return null; if (retained && source && !retained.equals(source)) throw failed(); const bytes = retained ?? source!;
    if (!this.readOnly) { if (!retained) await this.fixed(relative, bytes); if (source) { const path = this.path(pending); const before = await lstat(path); if (!(await this.bytes(path)).equals(bytes)) throw failed(); const after = await lstat(path); if (before.ino !== after.ino || before.dev !== after.dev || after.nlink !== 1) throw failed(); await unlink(path); await syncD3Directory(dirname(path)); } } else if (!retained || source) throw failed(); return bytes;
  }
  async load(transportCa: Buffer, complete = false, signal?: AbortSignal): Promise<D3CapsuleMaterial> {
    if (await this.retained('material.json', (bytes) => { const value = parseStrictJson(bytes, 65536); if (!canonicalJson(value).equals(bytes)) throw failed(); })) complete = true;
    const keys = {} as D3CapsuleMaterial['keys']; for (const role of D3_CAPSULE_SIGNERS) { const bytes = await this.generated(`authorities/${role}.key`, () => Buffer.from(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })), (value) => key(value, 'ed25519'), complete); const publicKey = createPublicKey(key(bytes, 'ed25519')).export({ type: 'spki', format: 'pem' }).toString(); keys[role] = { privateKey: bytes, publicKey, keyId: sha256(Buffer.from(publicKey)) }; }
    if (new Set(Object.values(keys).map(({ keyId }) => keyId)).size !== 3) throw failed();
    const credential = async (role: string) => this.generated(`credentials/${role}`, () => Buffer.from(randomBytes(32).toString('hex') + '\n'), (bytes) => { if (!/^[a-f0-9]{64}\n$/.test(bytes.toString('ascii'))) throw failed(); }, complete);
    const metricsToken = await credential('metrics-token'), grafanaPassword = await credential('grafana-password'), monitoringPassword = await credential('monitoring-password'); if (new Set([metricsToken, grafanaPassword, monitoringPassword].map((bytes) => sha256(bytes))).size !== 3) throw failed();
    const tls = {} as D3CapsuleMaterial['tls']; for (const role of D3_CAPSULE_TLS_ROLES) { const base = `tls/${role}`; await this.fixed(`${base}/certificate.cnf`, Buffer.from(d3CapsuleCertificateConfig(role)));
      let privateKey = await this.promote(`${base}/key.pem`, `${base}/pending.key`, (bytes) => key(bytes, 'ec')); if (!privateKey) { if (this.readOnly || complete) throw failed(); await this.crypto.run('key', role, signal); privateKey = await this.promote(`${base}/key.pem`, `${base}/pending.key`, (bytes) => key(bytes, 'ec')); } if (!privateKey) throw failed();
      const validate = (bytes: Buffer) => validateD3CapsuleCertificate(role, bytes, privateKey!, transportCa); let certificate = await this.promote(`${base}/cert.pem`, `${base}/pending.crt`, validate);
      if (!certificate) { if (this.readOnly || complete) throw failed(); if (role !== 'device-ca') { let csr = await this.retained(`${base}/pending.csr`, (bytes) => { if (!/^-----BEGIN CERTIFICATE REQUEST-----\n/.test(bytes.toString('ascii'))) throw failed(); }); if (!csr) { await this.crypto.run('csr', role, signal); csr = await this.retained(`${base}/pending.csr`, () => undefined); } if (!csr) throw failed(); } await this.crypto.run('certificate', role, signal); certificate = await this.promote(`${base}/cert.pem`, `${base}/pending.crt`, validate); }
      if (!certificate) throw failed(); validate(certificate); const text = await this.crypto.run('certificate-text', role, signal); if ((text.match(/Signature Algorithm: ecdsa-with-SHA256/g) ?? []).length !== 2 || !text.includes('ASN1 OID: prime256v1') || !text.includes('X509v3 Key Usage: critical') || !text.includes(role === 'device-ca' ? 'Certificate Sign, CRL Sign' : 'Digital Signature') || role === 'device-ca' && !text.includes('CA:TRUE, pathlen:0')) throw failed();
      const csrPath = this.path(`${base}/pending.csr`); const csr = await lstat(csrPath).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; }); if (csr) { if (this.readOnly) throw failed(); await this.bytes(csrPath); await unlink(csrPath); await syncD3Directory(dirname(csrPath)); } tls[role] = { key: privateKey, certificate };
    }
    const material = { keys, tls, metricsToken, grafanaPassword, monitoringPassword }; const inventory = this.identity(material); const prior = await this.retained('material.json', (bytes) => { if (!canonicalJson(parseStrictJson(bytes, 65536)).equals(bytes) || !bytes.equals(canonicalJson(inventory))) throw failed(); }); if (!prior) { if (this.readOnly || complete) throw failed(); await this.fixed('material.json', canonicalJson(inventory)); } return material;
  }
  identity(material: D3CapsuleMaterial) { return { format: 'darshan-d3-capsule-material-v1', keys: Object.fromEntries(Object.entries(material.keys).map(([role, value]) => [role, value.keyId])), tls: Object.fromEntries(Object.entries(material.tls).map(([role, value]) => [role, { certificateSha256: sha256(value.certificate), privateKeySha256: sha256(value.key) }])), credentialsSha256: digest([material.metricsToken, material.grafanaPassword, material.monitoringPassword].map(sha256)) }; }
}
