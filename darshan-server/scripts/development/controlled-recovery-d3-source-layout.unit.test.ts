import { chmod, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { ProtectedD3SourceLayout } from './controlled-recovery-d3-source-layout';
import { testD3Operation } from './controlled-recovery-d3.test-support';
import type { D3OperationAuthority } from './controlled-recovery-d3-authority';

describe('D3 retained source layout using enrolled OpenSSL in temporary test directories only', () => {
  it('creates one CA and fixed service identities exclusively, reloads the same bytes, and refuses missing or unsafe retained artifacts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'd3-source-layout-test-')); const authority = { ...testD3Operation, root: directory } as D3OperationAuthority;
    try {
      const layout = new ProtectedD3SourceLayout(authority, async () => false); const first = await layout.prepare(); const before = await readFile(`${directory}/source/tls/ca/ca.key`);
      expect(await new ProtectedD3SourceLayout(authority, async () => true).prepare()).toEqual(first); expect(await readFile(`${directory}/source/tls/ca/ca.key`)).toEqual(before);
      const ca = new X509Certificate(await readFile(`${directory}/source/tls/ca/ca.crt`)); expect(ca.ca).toBe(true);
      const postgres = new X509Certificate(await readFile(`${directory}/source/tls/postgres/server.crt`)); expect(postgres.checkIP('172.30.250.2')).toBe('172.30.250.2'); expect(postgres.verify(ca.publicKey)).toBe(true);
      const publicReceipt = await readFile(`${directory}/source/layout-receipt.json`, 'utf8'); expect(publicReceipt).not.toContain('PRIVATE KEY'); expect(publicReceipt).not.toContain((await readFile(`${directory}/source/secrets/postgres-password`, 'utf8')).trim());
      await chmod(`${directory}/source/secrets/postgres-password`, 0o644); await expect(layout.verify()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); await chmod(`${directory}/source/secrets/postgres-password`, 0o600);
      await unlink(`${directory}/source/tls/ca/ca.key`); await expect(layout.prepare()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_D3_SOURCE_LAYOUT_INVALID' }); expect(await readFile(`${directory}/source/layout-receipt.json`, 'utf8')).toBe(publicReceipt);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
