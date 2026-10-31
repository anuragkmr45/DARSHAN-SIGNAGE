import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';
import { BoundedD3SourceProcess } from './controlled-recovery-d3-source-process';

import { D3_OPENSSL } from './controlled-recovery-d3-source-enrollment';
export { D3_OPENSSL } from './controlled-recovery-d3-source-enrollment';
export type D3CertificateRole = 'ca' | 'postgres' | 'minio' | 'valkey';
export type D3CryptoOperation = 'version' | 'ec-key' | 'ca-cert' | 'csr' | 'csr-public-key' | 'service-cert' | 'certificate-text';
export function isD3SourceProcessUncertain(cause: unknown): cause is ControlledRecoveryError { return cause instanceof ControlledRecoveryError && cause.code === 'CONTROLLED_RECOVERY_D3_SOURCE_PROCESS_SETTLEMENT_UNCERTAIN'; }
const failed = () => new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_SOURCE_CRYPTO_FAILED', 'The fixed enrolled crypto operation or retained source certificate authority is unverified.');
export function fixedD3CryptoArgv(authority: D3OperationAuthority, operation: D3CryptoOperation, role: D3CertificateRole): string[] {
  const root = `${authority.root}/source/tls`; const directory = `${root}/${role}`; const key = `${directory}/${role === 'ca' ? 'ca' : 'server'}.key`; const cert = `${directory}/${role === 'ca' ? 'ca' : role === 'minio' ? 'public' : 'server'}.crt`;
  if (!['ca', 'postgres', 'minio', 'valkey'].includes(role)) throw failed();
  if (operation === 'version') return ['version'];
  if (operation === 'ec-key') return ['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${directory}/pending.key`];
  if (operation === 'ca-cert' && role === 'ca') return ['req', '-new', '-x509', '-sha256', '-days', '30', '-set_serial', '1', '-key', key, '-out', `${directory}/pending.crt`, '-config', `${directory}/certificate.cnf`, '-extensions', 'v3_ca'];
  if (operation === 'csr' && role !== 'ca') return ['req', '-new', '-sha256', '-key', key, '-out', `${directory}/pending.csr`, '-config', `${directory}/certificate.cnf`];
  if (operation === 'csr-public-key' && role !== 'ca') return ['req', '-in', `${directory}/pending.csr`, '-noout', '-verify', '-pubkey'];
  if (operation === 'service-cert' && role !== 'ca') return ['x509', '-req', '-sha256', '-days', '7', '-in', `${directory}/pending.csr`, '-CA', `${root}/ca/ca.crt`, '-CAkey', `${root}/ca/ca.key`, '-set_serial', String({ postgres: 2, minio: 3, valkey: 4 }[role]), '-out', `${directory}/pending.crt`, '-extfile', `${directory}/certificate.cnf`, '-extensions', 'v3_server'];
  if (operation === 'certificate-text') return ['x509', '-in', cert, '-noout', '-text'];
  throw failed();
}
export class EnrolledD3SourceCrypto {
  constructor(private readonly authority: D3OperationAuthority, private readonly process: BoundedD3SourceProcess = new BoundedD3SourceProcess()) {}
  async verifyEnrollment(): Promise<void> {
    const handle = await open(D3_OPENSSL.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = await handle.stat(); const hash = createHash('sha256'); if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o7777) !== 0o755 || await realpath(D3_OPENSSL.path) !== D3_OPENSSL.path || stat.size > 16 * 1024 * 1024) throw failed();
      for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); if (hash.digest('hex') !== D3_OPENSSL.sha256) throw failed();
    } catch { throw failed(); } finally { await handle.close(); }
  }
  async run(operation: D3CryptoOperation, role: D3CertificateRole, signal?: AbortSignal): Promise<{ publicText: string; evidenceSha256: string }> {
    await this.verifyEnrollment(); const argv = fixedD3CryptoArgv(this.authority, operation, role);
    try { const result = await this.process.run({ executable: '/usr/bin/openssl', argv, cwd: operation === 'version' ? dirname(this.authority.root) : `${this.authority.root}/source`, timeoutMs: 15000, maximumOutputBytes: 32 * 1024, ...(signal ? { signal } : {}) });
      if (result.exitCode !== 0 || (!['version', 'certificate-text', 'csr-public-key'].includes(operation) && result.stdout.length !== 0)) throw failed();
      const publicText = ['version', 'certificate-text', 'csr-public-key'].includes(operation) ? result.stdout.toString('utf8').trim() : '';
      if (operation === 'version' && publicText !== D3_OPENSSL.version) throw failed();
      if (/PRIVATE KEY|AGE-SECRET-KEY|password|secret-key/i.test(publicText)) throw failed(); return { publicText, evidenceSha256: digest({ operation, role, argv, publicText }) };
    } catch (cause) { if (isD3SourceProcessUncertain(cause)) throw cause; throw failed(); }
  }
}
