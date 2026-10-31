import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const serverRoot = resolve(new URL('..', import.meta.url).pathname);

test('credential authority provisions only fixed compile-gated temporary roles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'target-credential-authority-'));
  const state = join(root, 'state'); const binary = join(root, 'test'); await mkdir(state, { mode: 0o700 });
  try {
    await exec('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
      '-DRECOVERY_TARGET_CREDENTIAL_AUTHORITY_TESTING', '-DRECOVERY_TARGET_ENGINE_AUTHORITY_TESTING',
      '-I', join(serverRoot, 'src/native'),
      join(serverRoot, 'src/native/recovery-target-engine-authority.c'),
      join(serverRoot, 'src/native/recovery-target-credential-authority.c'),
      join(serverRoot, 'src/native/recovery-target-engine-wire-v4.c'),
      join(serverRoot, 'src/native/recovery-target-docker-backend.c'),
      join(serverRoot, 'src/native/recovery-target-credential-authority-test.c'), '-o', binary]);
    const { stdout, stderr } = await exec(binary, [state], { timeout: 20_000,
      env: { LANG: 'C', LC_ALL: 'C', PATH: process.env.PATH ?? '/usr/bin:/bin', RTCA_PARENT_SECRET_SENTINEL: 'must-not-escape' } });
    assert.equal(stdout, '78 native credential authority checks passed\n'); assert.equal(stderr, '');
    const source = await readFile(join(serverRoot, 'src/native/recovery-target-credential-authority.c'), 'utf8');
    assert.doesNotMatch(source, /\b(?:docker|podman|compose|system|popen|execv|unlink|truncate|rename|PURGE)\b/i);
    assert.match(source, /F_OFD_SETLK/); assert.match(source, /getrandom/); assert.match(source, /PR_SET_DUMPABLE/);
    const worker = await readFile(join(serverRoot, 'scripts/recovery-target-helper-worker.ts'), 'utf8');
    assert.match(worker, /new UnavailableRecoveryTargetEngine\(\)/);
    assert.doesNotMatch(worker, /recovery-target-credential-authority|TargetCredentialAdmissionVerifier/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
