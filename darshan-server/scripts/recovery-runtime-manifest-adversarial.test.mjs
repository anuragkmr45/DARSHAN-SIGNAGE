import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const generator = path.join(projectRoot, 'scripts/build-recovery-runtime-manifest.mjs');
const verifier = path.join(projectRoot, 'scripts/verify-recovery-runtime-manifest.mjs');
const nativeVerifier = path.join(projectRoot, 'scripts/verify-recovery-native-import.mjs');
const scratch = '/var/tmp/darshan-recovery-runtime';
let fixtureRoot;

function run(script, args = [], env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot, encoding: 'utf8', timeout: 20_000, maxBuffer: 512 * 1024, env,
  });
}

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-runtime-manifest-'));
  await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'dist-cli'), path.join(root, 'dist-cli'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'drizzle/migrations'), path.join(root, 'drizzle/migrations'), { recursive: true });
  await fs.cp(path.join(projectRoot, 'node_modules/zod'), path.join(root, 'node_modules/zod'), { recursive: true });
  await fs.copyFile(path.join(projectRoot, 'package-lock.json'), path.join(root, 'package-lock.json'));
  return root;
}

async function cloneFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-runtime-case-'));
  await fs.cp(fixtureRoot, root, { recursive: true });
  return root;
}

function expectFailure(result, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.equal(result.signal, null, `${label} was terminated by ${result.signal}`);
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

before(async () => {
  fixtureRoot = await makeFixture();
  const generated = run(generator, [fixtureRoot]);
  assert.equal(generated.status, 0, generated.stderr);
});

after(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

test('copied compiled runtime baseline generates and independently verifies only its immutable migration prefix', async () => {
  const verified = run(verifier, [fixtureRoot]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /recovery-runtime-manifest-ok/);
  const manifest = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'dist-cli/recovery-runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.assets.migrations.at(-1)?.path,
    'drizzle/migrations/0055_backup_deletion_idempotency_bindings.sql');
  assert.equal(manifest.assets.migrations.some(({ path: relative }) => /005[67]_/.test(relative)), false);
});

for (const [label, injected] of [
  ['side-effect bare dependency', "\nimport 'pg';\n"],
  ['unknown bare dependency', "\nimport 'unknown-recovery-package';\n"],
  ['dangerous builtin', "\nimport 'node:child_process';\n"],
  ['nonliteral dynamic import', "\nawait import(process.env.RUNTIME_MODULE);\n"],
  ['forbidden relative effect module', "\nimport '../src/deployment/migration-ledger.js';\n"],
]) {
  test(`generator rejects ${label}`, async () => {
    const root = await cloneFixture();
    try {
      await fs.appendFile(path.join(root, 'dist-cli/scripts/recovery-runtime.js'), injected);
      expectFailure(run(generator, [root]), label);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('generator rejects a closure symlink escaping the copied output', async () => {
  const root = await cloneFixture(); const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-runtime-outside-'));
  try {
    const outsideFile = path.join(outside, 'escape.js'); await fs.writeFile(outsideFile, 'export default true;\n');
    await fs.symlink(outsideFile, path.join(root, 'dist-cli/scripts/escape.js'));
    await fs.appendFile(path.join(root, 'dist-cli/scripts/recovery-runtime.js'), "\nimport './escape.js';\n");
    expectFailure(run(generator, [root]), 'closure symlink');
  } finally {
    await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true });
  }
});

test('generator rejects a relative import escaping dist-cli', async () => {
  const root = await cloneFixture();
  try {
    await fs.writeFile(path.join(root, 'external-audit.js'), 'export default true;\n');
    await fs.appendFile(path.join(root, 'dist-cli/scripts/recovery-runtime.js'), "\nimport '../../external-audit.js';\n");
    expectFailure(run(generator, [root]), 'compiled output escape');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('generator rejects regenerated manifest for changed dependency bytes', async () => {
  const root = await cloneFixture();
  try {
    await fs.appendFile(path.join(root, 'node_modules/zod/index.js'), '\n// tampered\n');
    expectFailure(run(generator, [root]), 'changed reviewed dependency bytes');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('generator rejects dependency version incoherent with the reviewed lock', async () => {
  const root = await cloneFixture();
  try {
    const packagePath = path.join(root, 'node_modules/zod/package.json');
    const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8')); pkg.version = '9.9.9';
    await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    expectFailure(run(generator, [root]), 'dependency version mismatch');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

for (const [label, mutate] of [
  ['package-lock tamper', (root) => fs.appendFile(path.join(root, 'package-lock.json'), '\n')],
  ['migration tamper', (root) => fs.appendFile(path.join(root, 'drizzle/migrations/0055_backup_deletion_idempotency_bindings.sql'), '\n')],
  ['closure tamper', (root) => fs.appendFile(path.join(root, 'dist-cli/scripts/recovery-runtime.js'), '\n// changed\n')],
  ['dependency-tree tamper', (root) => fs.appendFile(path.join(root, 'node_modules/zod/package.json'), '\n')],
  ['unsafe migration metadata directory', (root) => fs.mkdir(path.join(root, 'drizzle/migrations/meta/unknown'), { recursive: true })],
]) {
  test(`verifier rejects ${label}`, async () => {
    const root = await cloneFixture();
    try { await mutate(root); expectFailure(run(verifier, [root]), label); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('verifier rejects missing closure evidence and changed identity', async () => {
  const root = await cloneFixture();
  try {
    const manifestPath = path.join(root, 'dist-cli/recovery-runtime-manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.import_closure.files.shift(); manifest.identity.terminal_migration_id = '0054_changed.sql';
    await fs.writeFile(manifestPath, `${canonicalJson(manifest)}\n`);
    expectFailure(run(verifier, [root]), 'missing closure/changed identity');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('generator refuses a preexisting manifest output symlink without touching its target', async () => {
  const root = await cloneFixture(); const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-runtime-output-'));
  try {
    const output = path.join(root, 'dist-cli/recovery-runtime-manifest.json'); const target = path.join(outside, 'target');
    await fs.rm(output); await fs.writeFile(target, 'unchanged'); await fs.symlink(target, output);
    expectFailure(run(generator, [root]), 'manifest output symlink');
    assert.equal(await fs.readFile(target, 'utf8'), 'unchanged');
  } finally {
    await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true });
  }
});

async function scratchExists() {
  return fs.lstat(scratch).then(() => true, (cause) => {
    if (cause?.code === 'ENOENT') return false;
    throw cause;
  });
}

test('native verifier never follows or mutates an existing scratch symlink', async (context) => {
  if (await scratchExists()) { context.skip('fixed recovery scratch already exists'); return; }
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-native-symlink-')); let scratchIdentity;
  try {
    await fs.chmod(outside, 0o755); await fs.symlink(outside, scratch);
    scratchIdentity = await fs.lstat(scratch, { bigint: true });
    expectFailure(run(nativeVerifier), 'native scratch symlink');
    assert.equal(Number((await fs.lstat(outside, { bigint: true })).mode & 0o777n), 0o755);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    const current = await fs.lstat(scratch, { bigint: true }).catch(() => undefined);
    if (current && scratchIdentity && current.isSymbolicLink() && current.dev === scratchIdentity.dev && current.ino === scratchIdentity.ino) {
      await fs.unlink(scratch);
    }
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('native verifier leaves an existing unsafe scratch root unchanged', async (context) => {
  if (await scratchExists()) { context.skip('fixed recovery scratch already exists'); return; }
  let scratchIdentity;
  try {
    await fs.mkdir(scratch, { mode: 0o755 });
    scratchIdentity = await fs.lstat(scratch, { bigint: true });
    expectFailure(run(nativeVerifier), 'unsafe native scratch');
    assert.equal(Number((await fs.lstat(scratch, { bigint: true })).mode & 0o777n), 0o755);
    assert.deepEqual(await fs.readdir(scratch), []);
  } finally {
    const current = await fs.lstat(scratch, { bigint: true }).catch(() => undefined);
    if (current && scratchIdentity && current.isDirectory() && !current.isSymbolicLink() &&
        current.dev === scratchIdentity.dev && current.ino === scratchIdentity.ino && (await fs.readdir(scratch)).length === 0) {
      await fs.rmdir(scratch);
    }
  }
});

test('native verifier cleans identity-anchored scratch after a later failure', async (context) => {
  if (await scratchExists()) { context.skip('fixed recovery scratch already exists'); return; }
  const manifestPath = path.join(projectRoot, 'dist-cli/recovery-runtime-manifest.json');
  const original = await fs.readFile(manifestPath);
  try {
    await fs.appendFile(manifestPath, '\n'); expectFailure(run(nativeVerifier), 'native verifier late failure');
    await assert.rejects(fs.lstat(scratch), { code: 'ENOENT' });
  } finally { await fs.writeFile(manifestPath, original); }
});

test('native export probe is bounded and receives no ambient application environment', async (context) => {
  if (await scratchExists()) { context.skip('fixed recovery scratch already exists'); return; }
  const target = path.join(projectRoot, 'dist-production/recovery/index.js'); const original = await fs.readFile(target);
  try {
    await fs.writeFile(target, "if (process.env.DATABASE_URL) process.stdout.write(process.env.DATABASE_URL);\nsetInterval(() => {}, 60_000);\nawait new Promise(() => {});\n");
    const result = run(nativeVerifier, [], { ...process.env, DATABASE_URL: 'SECRET-AMBIENT-IMPORT-CANARY' });
    assert.ok(result.error || result.signal || result.status !== 0, 'bounded native export import unexpectedly succeeded');
    assert.equal(result.stdout.includes('SECRET-AMBIENT-IMPORT-CANARY'), false);
    assert.equal(result.stderr.includes('SECRET-AMBIENT-IMPORT-CANARY'), false);
    await assert.rejects(fs.lstat(scratch), { code: 'ENOENT' });
  } finally { await fs.writeFile(target, original); }
});
