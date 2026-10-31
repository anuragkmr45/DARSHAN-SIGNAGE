import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackupHostHelperRuntime } from './backup-host-helper';
import { signBackupManifest, verifyBackupManifestSignature, type BackupManifestV1 } from './manifest';

describe('backup host helper protocol', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  async function helperFixture() {
    const root = await mkdtemp(join(tmpdir(), 'darshan-backup-helper-'));
    roots.push(root);
    const path = join(root, 'helper');
    const source = `#!${process.execPath}
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const op = args[0];
const value = name => args.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const site = value('site-id');
const run = value('run-id');
const attempt = value('attempt-id');
const output = value => process.stdout.write(JSON.stringify(value));
if (op === 'describe') output({version:1,helper_version:'helper-1',site_id:site,manifest_signing:{algorithm:'Ed25519',key_id:'manifest-2026'},configuration_contract:[{logical_name:'backend-runtime',required:true,max_bytes:'4096'}]});
else { let body=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
  if (op === 'sign-manifest') output({version:1,helper_version:'helper-1',operation:'SIGN_MANIFEST',site_id:site,run_id:run,attempt_id:attempt,algorithm:'Ed25519',key_id:'manifest-2026',manifest_sha256:crypto.createHash('sha256').update(body).digest('hex'),signature_base64:crypto.createHash('sha256').update(body).digest('base64')});
  else { const doc=JSON.parse(body); const unsigned=JSON.stringify({...doc,signature:null}); output({version:1,helper_version:'helper-1',operation:'VERIFY_MANIFEST',site_id:site,run_id:run,attempt_id:attempt,manifest_sha256:crypto.createHash('sha256').update(unsigned).digest('hex'),accepted:true}); }
}); }
`;
    await writeFile(path, source);
    await chmod(path, 0o700);
    return { path, sha256: createHash('sha256').update(source).digest('hex') };
  }

  function manifest(): BackupManifestV1 {
    return {
      version: 1,
      repository: { kind: 'LOCAL_FILESYSTEM', id: randomUUID() }, site: { id: 'site-a' },
      run: { id: randomUUID(), attemptId: randomUUID() },
      capture: { id: randomUUID(), generation: '1', startedAt: '2026-10-28T00:00:00.000Z', sealedAt: '2026-10-28T00:00:01.000Z', stagingInventorySha256: 'a'.repeat(64) },
      release: { id: 'release-01' }, schema: { migrationId: '0051', fingerprintSha256: 'b'.repeat(64) },
      encryption: { keyId: 'recovery-1', tool: { name: 'age', version: '1.3.2', executableSha256: 'c'.repeat(64) } },
      artifacts: [{ kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: '1', ciphertextSha256: 'd'.repeat(64) }],
      signature: null,
    };
  }

  it('negotiates a bounded contract and signs/verifies only canonical manifests for its site', async () => {
    const fixture = await helperFixture();
    const runtime = await createBackupHostHelperRuntime({
      helperPath: fixture.path, expectedHelperVersion: 'helper-1', expectedHelperSha256: fixture.sha256, siteId: 'site-a',
    });
    expect(runtime.configurationContract).toEqual([{ logicalName: 'backend-runtime', required: true, maxBytes: 4096n }]);
    const controller = new AbortController();
    const signed = await signBackupManifest(manifest(), runtime.signer(controller.signal));
    await expect(verifyBackupManifestSignature(signed, runtime.verifier(controller.signal))).resolves.toBeUndefined();
    await expect(runtime.signer(controller.signal).sign(Buffer.from('arbitrary payload')))
      .rejects.toMatchObject({ code: 'BACKUP_MANIFEST_INVALID' });
  });

  it('fails closed when the executable pin does not match', async () => {
    const fixture = await helperFixture();
    await expect(createBackupHostHelperRuntime({
      helperPath: fixture.path, expectedHelperVersion: 'helper-1', expectedHelperSha256: '0'.repeat(64), siteId: 'site-a',
    })).rejects.toMatchObject({ code: 'BACKUP_HOST_HELPER_INVALID' });
  });
});
