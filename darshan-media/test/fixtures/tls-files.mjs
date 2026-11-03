import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function tlsFiles(t, san = 'DNS:localhost,IP:127.0.0.1') {
  const directory = await mkdtemp(path.join(tmpdir(), 'darshan-media-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keyFile = path.join(directory, 'key.pem'), certFile = path.join(directory, 'cert.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', keyFile, '-out', certFile, '-subj', '/CN=darshan-media-test', '-addext', `subjectAltName=${san}`, '-days', '1'], { timeout: 5000 });
  await chmod(keyFile, 0o600); await chmod(certFile, 0o644);
  return { directory, keyFile, certFile, key: await readFile(keyFile), cert: await readFile(certFile) };
}
