import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const serverRoot = resolve(new URL('..', import.meta.url).pathname);

test('strict native storage authority fixture is gated, fail-closed, and deletion-free', async () => {
  const root = await mkdtemp(join(tmpdir(), 'target-storage-native-'));
  const fixture = join(root, 'fixture'); const binary = join(root, 'fixture-bin'); await mkdir(fixture, { mode: 0o700 });
  try {
    await exec('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DTARGET_STORAGE_AUTHORITY_TESTING',
      `-DTARGET_STORAGE_POSTGRES_UID=${process.getuid()}`, `-DTARGET_STORAGE_POSTGRES_GID=${process.getgid()}`,
      `-DTARGET_STORAGE_MINIO_UID=${process.getuid()}`, `-DTARGET_STORAGE_MINIO_GID=${process.getgid()}`,
      '-I', join(serverRoot, 'src/native'), join(serverRoot, 'src/native/recovery-target-storage-authority.c'),
      join(serverRoot, 'src/native/recovery-target-storage-authority-test.c'), '-o', binary]);
    const { stdout } = await exec(binary, [fixture], { timeout: 10_000 });
    assert.match(stdout, /^28 storage authority checks passed\n$/);
    for (const name of await readdir(join(fixture, 'ledger'))) {
      const match = name.match(/-([a-f0-9]{64})\.json$/); assert.ok(match, `canonical ledger filename: ${name}`);
      const bytes = await readFile(join(fixture, 'ledger', name));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), match[1]);
    }
    const source = await readFile(join(serverRoot, 'src/native/recovery-target-storage-authority.c'), 'utf8');
    assert.doesNotMatch(source, /\b(?:unlink|unlinkat|rmdir|remove|system|exec[lv]?[pe]?)\s*\(/);
    assert.doesNotMatch(source, /\bPURGE\b/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
