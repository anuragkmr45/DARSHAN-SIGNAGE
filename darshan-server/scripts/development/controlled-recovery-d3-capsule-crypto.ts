import { createPrivateKey, X509Certificate } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { ControlledRecoveryError, digest, sha256 } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { BoundedD3SourceProcess } from './controlled-recovery-d3-source-process';
import { D3_OPENSSL, EnrolledD3SourceCrypto, isD3SourceProcessUncertain } from './controlled-recovery-d3-source-crypto';
import { openD3ProtectedFile } from './controlled-recovery-d3-protected-files';

export const D3_CAPSULE_TLS_ROLES = ['device-ca', 'backend', 'cms', 'observability'] as const;
export type D3CapsuleTlsRole = typeof D3_CAPSULE_TLS_ROLES[number];
type Operation = 'version' | 'key' | 'csr' | 'certificate' | 'certificate-text';
const subjects = { 'device-ca': 'Darshan D3 Capsule Disposable Device CA', backend: 'darshan-d2-20261030-api', cms: 'darshan-d2-20261030-cms', observability: 'darshan-d3-observability' };
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_CAPSULE_CRYPTO_INVALID', 'Disposable capsule certificate generation, identity, expiry or protected material differs.');
export function d3CapsuleCertificateConfig(role: D3CapsuleTlsRole) {
  if (!D3_CAPSULE_TLS_ROLES.includes(role)) throw failed(); const ca = role === 'device-ca'; return `[req]\nprompt=no\ndistinguished_name=dn\n${ca ? 'x509_extensions=v3_ca' : 'req_extensions=req_ext'}\n[dn]\nCN=${subjects[role]}\nO=Darshan NonProduction\n${ca ? '[v3_ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n' : `[req_ext]\nsubjectAltName=DNS:${subjects[role]},DNS:localhost,IP:127.0.0.1\n[v3_server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${subjects[role]},DNS:localhost,IP:127.0.0.1\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n`}`;
}
export function fixedD3CapsuleCryptoArgv(authority: D3OperationAuthority, operation: Operation, role: D3CapsuleTlsRole): string[] {
  if (!D3_CAPSULE_TLS_ROLES.includes(role)) throw failed(); const root = `${authority.root}/capsule/private/tls/${role}`; const config = `${root}/certificate.cnf`;
  if (operation === 'version') return ['version'];
  if (operation === 'key') return ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${root}/pending.key`];
  if (operation === 'csr' && role !== 'device-ca') return ['req', '-new', '-sha256', '-key', `${root}/key.pem`, '-out', `${root}/pending.csr`, '-config', config];
  if (operation === 'certificate') return role === 'device-ca' ? ['req', '-new', '-x509', '-sha256', '-days', '30', '-set_serial', '10', '-key', `${root}/key.pem`, '-out', `${root}/pending.crt`, '-config', config, '-extensions', 'v3_ca']
    : ['x509', '-req', '-sha256', '-days', '7', '-in', `${root}/pending.csr`, '-CA', `${authority.root}/source/tls/ca/ca.crt`, '-CAkey', `${authority.root}/source/tls/ca/ca.key`, '-set_serial', String({ backend: 11, cms: 12, observability: 13 }[role]), '-out', `${root}/pending.crt`, '-extfile', config, '-extensions', 'v3_server'];
  if (operation === 'certificate-text') return ['x509', '-in', `${root}/cert.pem`, '-noout', '-text']; throw failed();
}
export function validateD3CapsuleCertificate(role: D3CapsuleTlsRole, certificate: Buffer, privateKey: Buffer, transportCa: Buffer, now = Date.now()) {
  const cert = new X509Certificate(certificate); const key = createPrivateKey(privateKey); const ca = role === 'device-ca' ? cert : new X509Certificate(transportCa);
  const from = Date.parse(cert.validFrom), to = Date.parse(cert.validTo), maximum = (role === 'device-ca' ? 30 : 7) * 86400000, skew = 300000;
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || cert.publicKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1' || !cert.checkPrivateKey(key) || !cert.verify(ca.publicKey) || cert.subject !== `CN=${subjects[role]}\nO=Darshan NonProduction` || cert.issuer !== ca.subject || !Number.isFinite(from) || !Number.isFinite(to) || from > now + skew || from < Date.parse(ca.validFrom) - skew || to - now < 86400000 || to - from > maximum + skew || to > now + maximum + skew || to > Date.parse(ca.validTo)) throw failed();
  if (role === 'device-ca' ? !cert.ca || cert.subjectAltName || cert.serialNumber !== '0A' : cert.ca || cert.serialNumber !== { backend: '0B', cms: '0C', observability: '0D' }[role] || digest((cert.subjectAltName ?? '').split(', ').sort()) !== digest([`DNS:${subjects[role]}`, 'DNS:localhost', 'IP Address:127.0.0.1'].sort()) || digest(cert.keyUsage) !== digest(['1.3.6.1.5.5.7.3.1'])) throw failed();
  return { certificateSha256: sha256(cert.raw), publicKeySha256: sha256(cert.publicKey.export({ type: 'spki', format: 'der' })) };
}
/** Fixed offline OpenSSL operations only; the source CA is read, never copied or changed. */
export class EnrolledD3CapsuleCrypto {
  constructor(private readonly authority: D3OperationAuthority, private readonly process = new BoundedD3SourceProcess()) {}
  async run(operation: Operation, role: D3CapsuleTlsRole, signal?: AbortSignal): Promise<string> {
    await new EnrolledD3SourceCrypto(this.authority).verifyEnrollment(); const root = `${this.authority.root}/capsule/private/tls/${role}`;
    if (operation !== 'version') { const config = await openD3ProtectedFile(this.authority, `${root}/certificate.cnf`, 16384); try { if ((await config.readFile('utf8')) !== d3CapsuleCertificateConfig(role)) throw failed(); } finally { await config.close(); } }
    const inputs = operation === 'csr' || operation === 'certificate' ? [`${root}/key.pem`, ...(operation === 'certificate' && role !== 'device-ca' ? [`${root}/pending.csr`, `${this.authority.root}/source/tls/ca/ca.crt`, `${this.authority.root}/source/tls/ca/ca.key`] : [])] : operation === 'certificate-text' ? [`${root}/cert.pem`] : [];
    for (const path of inputs) { const file = await openD3ProtectedFile(this.authority, path, 65536); await file.close(); }
    const output = operation === 'key' ? 'pending.key' : operation === 'csr' ? 'pending.csr' : operation === 'certificate' ? 'pending.crt' : null; if (output) { const retained = await lstat(`${root}/${output}`).catch((cause: NodeJS.ErrnoException) => { if (cause.code === 'ENOENT') return null; throw cause; }); if (retained) throw failed(); }
    const argv = fixedD3CapsuleCryptoArgv(this.authority, operation, role);
    try { const result = await this.process.run({ executable: '/usr/bin/openssl', argv, cwd: operation === 'version' ? this.authority.root : root, timeoutMs: 15000, maximumOutputBytes: 32768, ...(signal ? { signal } : {}) }); if (result.exitCode !== 0) throw failed(); const text = ['version', 'certificate-text'].includes(operation) ? result.stdout.toString('utf8').trim() : ''; if (!['version', 'certificate-text'].includes(operation) && result.stdout.length || /PRIVATE KEY|AGE-SECRET-KEY/i.test(text) || operation === 'version' && text !== D3_OPENSSL.version) throw failed(); return text; }
    catch (cause) { if (isD3SourceProcessUncertain(cause)) throw cause; throw failed(); }
  }
}
