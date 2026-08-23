import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServerTlsOptions } from './tls';

describe('loadServerTlsOptions', () => {
  it('does not read certificate files when TLS is disabled', () => {
    expect(
      loadServerTlsOptions({
        enabled: false,
        certificatePath: '/missing/server.crt',
        privateKeyPath: '/missing/server.key',
      })
    ).toBeUndefined();
  });

  it('fails closed when TLS is enabled without readable material', () => {
    expect(() =>
      loadServerTlsOptions({
        enabled: true,
        certificatePath: '/missing/server.crt',
        privateKeyPath: '/missing/server.key',
      })
    ).toThrow(/SERVER_TLS_ENABLED=true/);
  });

  it('loads a matching certificate and key for the Fastify HTTPS listener', () => {
    const directory = mkdtempSync(join(tmpdir(), 'darshan-server-tls-'));
    const certificatePath = join(directory, 'server.crt');
    const privateKeyPath = join(directory, 'server.key');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-keyout',
        privateKeyPath,
        '-out',
        certificatePath,
      ],
      { stdio: 'ignore' }
    );

    const options = loadServerTlsOptions({ enabled: true, certificatePath, privateKeyPath });
    expect(options?.minVersion).toBe('TLSv1.2');
    expect(options?.cert.length).toBeGreaterThan(0);
    expect(options?.key.length).toBeGreaterThan(0);
    rmSync(directory, { recursive: true, force: true });
  });
});
