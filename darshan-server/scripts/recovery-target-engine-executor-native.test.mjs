import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);
const serverRoot = resolve(new URL('..', import.meta.url).pathname);

test('fixed native executor and materialization use only the harmless local fixture boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'target-engine-executor-'));
  const fixtureRoot = join(root, 'state'); const fixture = join(root, 'fixture'); const testBinary = join(root, 'test');
  await mkdir(fixtureRoot, { mode: 0o700 });
  try {
    await exec('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
      '-DRECOVERY_TARGET_ENGINE_EXECUTOR_TESTING',
      join(serverRoot, 'src/native/recovery-target-engine-fixture.c'), '-o', fixture]);
    await exec('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
      '-DRECOVERY_TARGET_ENGINE_EXECUTOR_TESTING', '-DRECOVERY_TARGET_ENGINE_AUTHORITY_TESTING',
      '-I', join(serverRoot, 'src/native'),
      join(serverRoot, 'src/native/recovery-target-engine-authority.c'),
      join(serverRoot, 'src/native/recovery-target-engine-materialization.c'),
      join(serverRoot, 'src/native/recovery-target-engine-executor.c'),
      join(serverRoot, 'src/native/recovery-target-engine-executor-test.c'), '-o', testBinary]);
    const { stdout, stderr } = await exec(testBinary, [fixtureRoot, fixture], { timeout: 20_000 });
    assert.equal(stdout, '41 native executor/materialization checks passed\n'); assert.equal(stderr, '');
    const executor = await readFile(join(serverRoot, 'src/native/recovery-target-engine-executor.c'), 'utf8');
    assert.match(executor, /SYS_execveat/); assert.match(executor, /PR_SET_CHILD_SUBREAPER/);
    assert.doesNotMatch(executor, /\b(?:system|popen|execvp|execvpe|docker|podman|compose|PURGE)\b/i);
    const fixtureSource = await readFile(join(serverRoot, 'src/native/recovery-target-engine-fixture.c'), 'utf8');
    assert.match(fixtureSource, /#error "the harmless recovery target executor fixture is test-only"/);
    const worker = await readFile(join(serverRoot, 'scripts/recovery-target-helper-worker.ts'), 'utf8');
    assert.match(worker, /new UnavailableRecoveryTargetEngine\(\)/);
    assert.doesNotMatch(worker, /TestOnlyTargetNativeEngineClient|recovery-target-engine-executor/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

