import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const serverRoot = resolve(new URL('..', import.meta.url).pathname);

test('native engine authority owns strict OFD lifetime and descriptor capability', async () => {
  const root = await mkdtemp(join(tmpdir(), 'target-engine-authority-'));
  const fixture = join(root, 'fixture'); const binary = join(root, 'fixture-bin'); await mkdir(fixture, { mode: 0o700 });
  try {
    await exec('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-DRECOVERY_TARGET_ENGINE_AUTHORITY_TESTING',
      '-I', join(serverRoot, 'src/native'), join(serverRoot, 'src/native/recovery-target-engine-authority.c'),
      join(serverRoot, 'src/native/recovery-target-engine-authority-test.c'), '-o', binary]);
    const { stdout } = await exec(binary, [fixture], { timeout: 15_000 });
    assert.equal(stdout, '46 engine authority checks passed\n');
    const source = await readFile(join(serverRoot, 'src/native/recovery-target-engine-authority.c'), 'utf8');
    assert.match(source, /F_OFD_SETLK/); assert.match(source, /SO_PEERCRED/);
    assert.doesNotMatch(source, /\b(?:unlink|unlinkat|rmdir|remove|system|exec[lv]?[pe]?)\s*\(/);
    assert.doesNotMatch(source, /\b(?:PURGE|argv|docker|podman|credential_value|daemon_endpoint)\b/i);
    const worker = await readFile(join(serverRoot, 'scripts/recovery-target-helper-worker.ts'), 'utf8');
    assert.match(worker, /new UnavailableRecoveryTargetEngine\(\)/);
    assert.doesNotMatch(worker, /TargetNativeResourceAuthorityClient|RECOVERY_TARGET_ENGINE_SELECTOR|nativeAuthoritySelector/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
