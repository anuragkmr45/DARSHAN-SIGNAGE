import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { RecoveryError } from './errors';

export const RECOVERY_RUNTIME_FORMAT = 'darshan-recovery-runtime-v1' as const;
export const RECOVERY_RUNTIME_COMMANDS = Object.freeze([
  'discover', 'plan', 'hold', 'verify-source', 'resume', 'status', 'release', 'abandon',
] as const);
export const RECOVERY_RUNTIME_METADATA = Object.freeze({
  format: RECOVERY_RUNTIME_FORMAT,
  targetId: 'darshan-server-release-01',
  releaseId: 'release-01',
  compatibilityGeneration: 1,
  platform: 'linux',
  architecture: 'x64',
  nodeMajor: 20,
  uid: 1000,
  gid: 1000,
  scratchPath: '/var/tmp/darshan-recovery-runtime',
  homePath: '/var/tmp/darshan-recovery-runtime/home',
  temporaryPath: '/var/tmp/darshan-recovery-runtime/tmp',
  scratchMode: 0o700,
  minimumScratchAvailableBytes: 1024 * 1024,
  signalGraceMs: 5_000,
  commands: RECOVERY_RUNTIME_COMMANDS,
});

type BigintStats = Awaited<ReturnType<typeof fs.lstat>> & { dev: bigint; ino: bigint; uid: bigint; gid: bigint; mode: bigint };

export interface RecoveryRuntimeSystem {
  platform: NodeJS.Platform;
  architecture: string;
  nodeVersion: string;
  uid(): number | undefined;
  gid(): number | undefined;
  execArgv: readonly string[];
  env: Readonly<NodeJS.ProcessEnv>;
  lstat(path: string): Promise<BigintStats>;
  realpath(path: string): Promise<string>;
  statfs(path: string): Promise<{ bavail: bigint; bsize: bigint }>;
  probe(path: string): Promise<void>;
}

async function probeScratch(path: string): Promise<void> {
  const directory = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW);
  let probe: Awaited<ReturnType<typeof fs.open>> | undefined;
  let identity: { dev: bigint; ino: bigint } | undefined;
  const anchored = `/proc/self/fd/${directory.fd}/.runtime-probe-${randomUUID()}`;
  try {
    probe = await fs.open(anchored, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
    const opened = await probe.stat({ bigint: true }); identity = { dev: opened.dev, ino: opened.ino };
    if (!opened.isFile() || opened.nlink !== 1n || Number(opened.mode & 0o777n) !== 0o600) throw new Error('unsafe scratch probe');
    await probe.writeFile(Buffer.from([0])); await probe.sync();
    const pathname = await fs.lstat(anchored, { bigint: true });
    if (pathname.isSymbolicLink() || pathname.dev !== opened.dev || pathname.ino !== opened.ino || pathname.nlink !== 1n) {
      throw new Error('scratch probe identity changed');
    }
    await probe.close(); probe = undefined;
    await fs.unlink(anchored); identity = undefined;
    await directory.sync();
  } catch (cause) {
    await probe?.close().catch(() => undefined);
    if (identity) {
      const pathname = await fs.lstat(anchored, { bigint: true }).catch(() => undefined);
      if (pathname && !pathname.isSymbolicLink() && pathname.dev === identity.dev && pathname.ino === identity.ino) {
        await fs.unlink(anchored).catch(() => undefined);
      }
    }
    throw cause;
  } finally { await directory.close(); }
}

const defaultSystem: RecoveryRuntimeSystem = {
  platform: process.platform,
  architecture: process.arch,
  nodeVersion: process.versions.node,
  uid: () => process.geteuid?.() ?? process.getuid?.(),
  gid: () => process.getegid?.() ?? process.getgid?.(),
  execArgv: process.execArgv,
  env: process.env,
  lstat: (path) => fs.lstat(path, { bigint: true }) as Promise<BigintStats>,
  realpath: (path) => fs.realpath(path),
  statfs: (path) => fs.statfs(path, { bigint: true }),
  probe: probeScratch,
};

const EXACT_ENVIRONMENT = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  TZ: 'UTC',
  HOME: RECOVERY_RUNTIME_METADATA.homePath,
  TMPDIR: RECOVERY_RUNTIME_METADATA.temporaryPath,
});
const FORBIDDEN_OPTION = /^--(?:private[-_]?key|identity[-_]?file|decrypt|executable|command[-_]?path|node[-_]?options|node[-_]?path|require|import|eval)(?:=|$)/i;

function fail(message: string): never {
  throw new RecoveryError('RECOVERY_RUNTIME_INVALID', message);
}

function validateMetadata(): void {
  if (RECOVERY_RUNTIME_METADATA.format !== RECOVERY_RUNTIME_FORMAT ||
      RECOVERY_RUNTIME_METADATA.targetId !== 'darshan-server-release-01' ||
      RECOVERY_RUNTIME_METADATA.releaseId !== 'release-01' ||
      RECOVERY_RUNTIME_METADATA.compatibilityGeneration !== 1 ||
      RECOVERY_RUNTIME_METADATA.scratchPath !== '/var/tmp/darshan-recovery-runtime' ||
      !Object.isFrozen(RECOVERY_RUNTIME_METADATA) || !Object.isFrozen(RECOVERY_RUNTIME_COMMANDS)) {
    fail('Compiled recovery runtime metadata is inconsistent.');
  }
}

export function validateRecoveryRuntimeArguments(argv: readonly string[]): void {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h'))) return;
  if (argv.length > 32 || !RECOVERY_RUNTIME_COMMANDS.includes(argv[0] as typeof RECOVERY_RUNTIME_COMMANDS[number])) {
    fail('Recovery runtime command is unsupported.');
  }
  for (const argument of argv) {
    if (argument.length < 1 || argument.length > 4096 || argument.includes('\0') || FORBIDDEN_OPTION.test(argument)) {
      fail('Recovery runtime argument is forbidden.');
    }
  }
}

function validateEnvironment(system: RecoveryRuntimeSystem): void {
  if (system.execArgv.length !== 0) fail('Recovery runtime does not permit Node execution flags.');
  const actual = Object.entries(system.env).filter(([, value]) => value !== undefined)
    .map(([name, value]) => [name, value] as const).sort(([left], [right]) => left.localeCompare(right));
  const expected = Object.entries(EXACT_ENVIRONMENT).sort(([left], [right]) => left.localeCompare(right));
  if (actual.length !== expected.length || actual.some(([name, value], index) =>
    name !== expected[index]?.[0] || value !== expected[index]?.[1])) {
    fail('Recovery runtime requires the exact minimal reviewed environment.');
  }
}

function sameScratchIdentity(left: BigintStats, right: BigintStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode;
}

export async function validateRecoveryRuntime(
  argv: readonly string[],
  system: RecoveryRuntimeSystem = defaultSystem,
): Promise<typeof RECOVERY_RUNTIME_METADATA> {
  validateMetadata();
  validateRecoveryRuntimeArguments(argv);
  validateEnvironment(system);
  const nodeMajor = Number(system.nodeVersion.split('.')[0]);
  if (system.platform !== RECOVERY_RUNTIME_METADATA.platform || system.architecture !== RECOVERY_RUNTIME_METADATA.architecture ||
      !Number.isSafeInteger(nodeMajor) ||
      nodeMajor !== RECOVERY_RUNTIME_METADATA.nodeMajor) fail('Recovery runtime requires Linux and Node.js 20.');
  if (system.uid() !== RECOVERY_RUNTIME_METADATA.uid || system.gid() !== RECOVERY_RUNTIME_METADATA.gid) {
    fail('Recovery runtime requires exact effective uid/gid 1000:1000.');
  }
  const scratch = RECOVERY_RUNTIME_METADATA.scratchPath;
  if (!isAbsolute(scratch) || resolve(scratch) !== scratch || scratch.endsWith(sep)) fail('Recovery runtime scratch metadata is unsafe.');
  let before: BigintStats;
  try { before = await system.lstat(scratch); }
  catch (cause) { throw new RecoveryError('RECOVERY_RUNTIME_INVALID', 'Recovery runtime scratch is unavailable.', { cause }); }
  if (before.isSymbolicLink() || !before.isDirectory() || Number(before.uid) !== RECOVERY_RUNTIME_METADATA.uid ||
      Number(before.gid) !== RECOVERY_RUNTIME_METADATA.gid || Number(before.mode & 0o777n) !== RECOVERY_RUNTIME_METADATA.scratchMode) {
    fail('Recovery runtime scratch must be an owner-only non-symlink directory.');
  }
  let real: string; let capacity: { bavail: bigint; bsize: bigint };
  try {
    [real, capacity] = await Promise.all([system.realpath(scratch), system.statfs(scratch)]);
  } catch (cause) {
    throw new RecoveryError('RECOVERY_RUNTIME_INVALID', 'Recovery runtime scratch is read-only or inaccessible.', { cause });
  }
  if (real !== scratch || capacity.bavail * capacity.bsize < BigInt(RECOVERY_RUNTIME_METADATA.minimumScratchAvailableBytes)) {
    fail('Recovery runtime scratch is noncanonical or lacks bounded free capacity.');
  }
  const after = await system.lstat(scratch);
  if (after.isSymbolicLink() || !after.isDirectory() || !sameScratchIdentity(before, after) || await system.realpath(scratch) !== scratch) {
    fail('Recovery runtime scratch identity changed during validation.');
  }
  try { await system.probe(scratch); }
  catch (cause) { throw new RecoveryError('RECOVERY_RUNTIME_INVALID', 'Recovery runtime scratch is read-only, full, or unsafe to write.', { cause }); }
  const afterProbe = await system.lstat(scratch);
  if (!sameScratchIdentity(before, afterProbe) || afterProbe.isSymbolicLink() || !afterProbe.isDirectory()) {
    fail('Recovery runtime scratch identity changed during writeability probe.');
  }
  for (const privatePath of [RECOVERY_RUNTIME_METADATA.homePath, RECOVERY_RUNTIME_METADATA.temporaryPath]) {
    let privateBefore: BigintStats;
    try { privateBefore = await system.lstat(privatePath); }
    catch (cause) { throw new RecoveryError('RECOVERY_RUNTIME_INVALID', 'Recovery runtime private environment directory is unavailable.', { cause }); }
    if (privateBefore.isSymbolicLink() || !privateBefore.isDirectory() || Number(privateBefore.uid) !== RECOVERY_RUNTIME_METADATA.uid ||
        Number(privateBefore.gid) !== RECOVERY_RUNTIME_METADATA.gid || Number(privateBefore.mode & 0o777n) !== RECOVERY_RUNTIME_METADATA.scratchMode ||
        await system.realpath(privatePath) !== privatePath) fail('Recovery runtime private environment directory is unsafe.');
    const privateAfter = await system.lstat(privatePath);
    if (privateAfter.isSymbolicLink() || !privateAfter.isDirectory() || !sameScratchIdentity(privateBefore, privateAfter) ||
        await system.realpath(privatePath) !== privatePath) fail('Recovery runtime private environment directory identity changed.');
  }
  const finalScratch = await system.lstat(scratch);
  if (finalScratch.isSymbolicLink() || !finalScratch.isDirectory() || !sameScratchIdentity(before, finalScratch) ||
      await system.realpath(scratch) !== scratch) {
    fail('Recovery runtime scratch identity changed while validating private directories.');
  }
  return RECOVERY_RUNTIME_METADATA;
}

export interface RecoverySignalProcess {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): never;
}

export function installRecoverySignalBoundary(input: {
  process?: RecoverySignalProcess;
  graceMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
} = {}): { signal: AbortSignal; dispose(): void } {
  const runtimeProcess = input.process ?? process;
  const controller = new AbortController();
  const setTimer = input.setTimer ?? setTimeout;
  const clearTimer = input.clearTimer ?? clearTimeout;
  let count = 0; let timer: ReturnType<typeof setTimeout> | undefined;
  const onSignal = () => {
    count += 1;
    if (count === 1) {
      controller.abort(new RecoveryError('RECOVERY_CANCELLED', 'Recovery runtime cancellation was requested.'));
      timer = setTimer(() => runtimeProcess.exit(130), input.graceMs ?? RECOVERY_RUNTIME_METADATA.signalGraceMs);
      timer.unref?.();
    } else runtimeProcess.exit(130);
  };
  runtimeProcess.on('SIGINT', onSignal); runtimeProcess.on('SIGTERM', onSignal);
  return { signal: controller.signal, dispose: () => {
    runtimeProcess.off('SIGINT', onSignal); runtimeProcess.off('SIGTERM', onSignal);
    if (timer) clearTimer(timer);
  } };
}
