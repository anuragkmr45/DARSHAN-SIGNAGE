import { spawnSync } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyManifest } from './verify-recovery-runtime-manifest.mjs';

const cwd = new URL('..', import.meta.url);
const root = fileURLToPath(cwd);
const scratch = '/var/tmp/darshan-recovery-runtime';
const home = `${scratch}/home`;
const temporary = `${scratch}/tmp`;
const safeEnvironment = {
  PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', HOME: home, TMPDIR: temporary,
};

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid &&
    left.mode === right.mode && left.nlink === right.nlink;
}

async function checkedPrivateDirectory(target, expectedIdentity) {
  const before = await fs.lstat(target, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory() || before.uid !== 1000n || before.gid !== 1000n ||
      (before.mode & 0o777n) !== 0o700n || await fs.realpath(target) !== target ||
      (expectedIdentity && !sameIdentity(before, expectedIdentity))) {
    throw new Error('Recovery native smoke scratch directory is unsafe.');
  }
  const after = await fs.lstat(target, { bigint: true });
  if (!sameIdentity(before, after) || await fs.realpath(target) !== target) {
    throw new Error('Recovery native smoke scratch directory changed during validation.');
  }
  return after;
}

async function removeCreated(created) {
  for (const entry of [...created].reverse()) {
    const current = await fs.lstat(entry.anchored, { bigint: true });
    if (current.isSymbolicLink() || !current.isDirectory() || current.dev !== entry.identity.dev || current.ino !== entry.identity.ino) {
      throw new Error('Created recovery native smoke scratch identity changed; refusing cleanup.');
    }
    await fs.rmdir(entry.anchored);
  }
}

async function prepareScratch() {
  const parent = path.dirname(scratch); const basename = path.basename(scratch);
  const parentBefore = await fs.lstat(parent, { bigint: true });
  if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory() || await fs.realpath(parent) !== parent) {
    throw new Error('Recovery native smoke scratch parent is unsafe.');
  }
  const parentHandle = await fs.open(parent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  const created = []; let createdRootHandle;
  try {
    if (!sameIdentity(parentBefore, await parentHandle.stat({ bigint: true }))) {
      throw new Error('Recovery native smoke scratch parent changed.');
    }
    let exists = true;
    try { await fs.lstat(scratch); } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
      exists = false;
    }
    if (!exists) {
      const anchored = `/proc/self/fd/${parentHandle.fd}/${basename}`;
      await fs.mkdir(anchored, { mode: 0o700 });
      created.push({ anchored, identity: await fs.lstat(anchored, { bigint: true }) });
      await checkedPrivateDirectory(scratch, created.at(-1).identity);
      createdRootHandle = await fs.open(anchored, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
      for (const child of [home, temporary]) {
        const anchoredChild = `/proc/self/fd/${createdRootHandle.fd}/${path.basename(child)}`;
        await fs.mkdir(anchoredChild, { mode: 0o700 });
        created.push({ anchored: anchoredChild, identity: await fs.lstat(anchoredChild, { bigint: true }) });
        await checkedPrivateDirectory(child, created.at(-1).identity);
      }
    } else {
      await checkedPrivateDirectory(scratch);
      await checkedPrivateDirectory(home);
      await checkedPrivateDirectory(temporary);
    }
    const scratchIdentity = await checkedPrivateDirectory(scratch);
    return {
      scratchBefore: (await fs.readdir(scratch)).sort(),
      assertStable: async () => { await checkedPrivateDirectory(scratch, scratchIdentity); },
      cleanup: async () => {
        try { await removeCreated(created); } finally {
          await createdRootHandle?.close(); await parentHandle.close();
        }
      },
    };
  } catch (cause) {
    try { await removeCreated(created); } finally {
      await createdRootHandle?.close(); await parentHandle.close();
    }
    throw cause;
  }
}

async function node20Path() {
  if (Number(process.versions.node.split('.')[0]) === 20) return process.execPath;
  const versionsRoot = path.join(process.env.HOME ?? '', '.nvm/versions/node');
  const versions = (await fs.readdir(versionsRoot)).filter((name) => /^v20\./.test(name)).sort().reverse();
  if (versions.length === 0) throw new Error('Node.js 20 executable is required for recovery native smoke.');
  return path.join(versionsRoot, versions[0], 'bin/node');
}
const runtimeNode = await node20Path();

function spawn(args, env = safeEnvironment, timeout = 15_000) {
  return spawnSync(runtimeNode, args, { cwd, encoding: 'utf8', env, timeout, maxBuffer: 512 * 1024, killSignal: 'SIGKILL' });
}

const prepared = await prepareScratch();
try {
  await verifyManifest(root);
  const importProbe = spawn(['--input-type=module', '--eval', `
    for (const target of ['./dist-production/recovery/index.js', './dist-cli/src/recovery/index.js']) {
      const module = await import(new URL(target, 'file://' + process.cwd() + '/'));
      if (typeof module.RecoveryJournal !== 'function' || typeof module.assessRecoveryCompatibility !== 'function') process.exit(9);
    }
    process.stdout.write('recovery-export-probe-ok\\n');
  `], safeEnvironment, 5_000);
  if (importProbe.error || importProbe.signal || importProbe.status !== 0 || importProbe.stderr !== '' ||
      importProbe.stdout !== 'recovery-export-probe-ok\n') {
    throw new Error('Bounded recovery export import probe failed.');
  }

  const help = spawn(['dist-cli/scripts/recovery-runtime.js', '--help']);
  if (help.error || help.signal || help.status !== 0 || help.stderr !== '' ||
      !['discover', 'plan', 'hold', 'verify-source', 'resume', 'status', 'release', 'abandon'].every((command) => help.stdout.includes(`recovery-cli ${command}`))) {
    throw new Error('Fresh compiled recovery runtime --help smoke failed.');
  }
  const missing = spawn(['dist-cli/scripts/recovery-runtime.js', 'discover', '--config-file', '/definitely-missing-recovery-config', '--json']);
  const envelope = JSON.parse(missing.stdout);
  if (missing.error || missing.signal || missing.status !== 3 || missing.stderr !== '' || envelope.format !== 'darshan-recovery-cli-result-v1' ||
      envelope.code !== 'RECOVERY_INPUT_MISSING') throw new Error('Fresh compiled recovery runtime safe missing-config smoke failed.');
  if (JSON.stringify((await fs.readdir(scratch)).sort()) !== JSON.stringify(prepared.scratchBefore)) {
    throw new Error('Help or missing-input smoke created runtime scratch/journal state.');
  }
  await prepared.assertStable();

  const canary = 'SECRET-POISON-CANARY-MUST-NOT-LEAK';
  for (const [name, value] of [
    ['DATABASE_URL', canary], ['S3_ENDPOINT', canary], ['AWS_ACCESS_KEY_ID', canary], ['PGHOST', canary],
    ['HTTPS_PROXY', canary], ['NODE_PATH', canary], ['NODE_OPTIONS', '--no-warnings'],
  ]) {
    const poisoned = spawn(['dist-cli/scripts/recovery-runtime.js', '--help'], { ...safeEnvironment, [name]: value });
    if (poisoned.status !== 78 || poisoned.stdout.includes(canary) || poisoned.stderr.includes(canary) ||
        !poisoned.stderr.includes('darshan-recovery-runtime-v1')) {
      throw new Error(`Poisoned recovery environment did not fail closed and redacted: ${name}`);
    }
  }
  // Loader variables are acted on before JavaScript can validate or redact
  // them. Use a non-secret sentinel here; Packet 5A2c2's pre-Node env-i
  // launcher is the boundary that prevents inherited loader diagnostics.
  const loaderPoisoned = spawn(['dist-cli/scripts/recovery-runtime.js', '--help'], {
    ...safeEnvironment, LD_PRELOAD: '/definitely-missing-reviewed-recovery-loader.so',
  });
  if (loaderPoisoned.status !== 78 || !loaderPoisoned.stderr.includes('darshan-recovery-runtime-v1')) {
    throw new Error('Loader-poisoned recovery environment did not fail closed.');
  }
  process.stdout.write('recovery-native-import-ok\n');
} finally {
  await prepared.cleanup();
}
