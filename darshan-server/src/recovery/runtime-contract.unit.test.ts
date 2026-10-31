import { describe, expect, it, vi } from 'vitest';
import {
  installRecoverySignalBoundary,
  RECOVERY_RUNTIME_METADATA,
  validateRecoveryRuntime,
  validateRecoveryRuntimeArguments,
  type RecoveryRuntimeSystem,
  type RecoverySignalProcess,
} from './runtime-contract';

const environment = {
  PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC',
  HOME: '/var/tmp/darshan-recovery-runtime/home', TMPDIR: '/var/tmp/darshan-recovery-runtime/tmp',
};
const directory = (overrides: Record<string, unknown> = {}) => ({
  dev: 1n, ino: 2n, uid: 1000n, gid: 1000n, mode: 0o40700n,
  isSymbolicLink: () => false, isDirectory: () => true, ...overrides,
});

function system(overrides: Partial<RecoveryRuntimeSystem> = {}): RecoveryRuntimeSystem {
  return {
    platform: 'linux', architecture: 'x64', nodeVersion: '20.19.0', uid: () => 1000, gid: () => 1000,
    execArgv: [], env: environment, lstat: async () => directory() as never,
    realpath: async (path) => path, statfs: async () => ({ bavail: 1024n, bsize: 4096n }), probe: async () => undefined,
    ...overrides,
  };
}

describe('recovery runtime contract', () => {
  it('accepts only the fixed Linux/x64/uid/gid/environment/scratch contract', async () => {
    await expect(validateRecoveryRuntime(['--help'], system())).resolves.toBe(RECOVERY_RUNTIME_METADATA);
  });

  it.each([
    ['wrong uid', { uid: () => 999 }],
    ['wrong architecture', { architecture: 'arm64' }],
    ['old node', { nodeVersion: '18.20.0' }],
    ['node flags', { execArgv: ['--import=tsx'] }],
    ['poisoned env', { env: { ...environment, DATABASE_URL: 'SECRET' } }],
    ['wrong mode', { lstat: async () => directory({ mode: 0o40750n }) as never }],
    ['symlink', { lstat: async () => directory({ isSymbolicLink: () => true }) as never }],
    ['full filesystem', { statfs: async () => ({ bavail: 0n, bsize: 4096n }) }],
    ['read-only filesystem', { probe: async () => { throw new Error('EROFS'); } }],
  ] as const)('rejects %s', async (_label, override) => {
    await expect(validateRecoveryRuntime(['--help'], system(override))).rejects.toMatchObject({ code: 'RECOVERY_RUNTIME_INVALID' });
  });

  it('rejects a scratch path identity swap', async () => {
    let scratchReads = 0;
    const lstat = async (path: string) => path === RECOVERY_RUNTIME_METADATA.scratchPath && ++scratchReads === 2
      ? directory({ ino: 9n }) as never : directory() as never;
    await expect(validateRecoveryRuntime(['--help'], system({ lstat }))).rejects.toMatchObject({ code: 'RECOVERY_RUNTIME_INVALID' });
  });

  it('rejects root and private-directory swaps during the final validation window', async () => {
    let scratchReads = 0;
    await expect(validateRecoveryRuntime(['--help'], system({ lstat: async (path) => {
      if (path === RECOVERY_RUNTIME_METADATA.scratchPath && ++scratchReads === 4) return directory({ ino: 99n }) as never;
      return directory() as never;
    } }))).rejects.toMatchObject({ code: 'RECOVERY_RUNTIME_INVALID' });

    let homeReads = 0;
    await expect(validateRecoveryRuntime(['--help'], system({ lstat: async (path) => {
      if (path === RECOVERY_RUNTIME_METADATA.homePath && ++homeReads === 2) return directory({ ino: 88n }) as never;
      return directory() as never;
    } }))).rejects.toMatchObject({ code: 'RECOVERY_RUNTIME_INVALID' });
  });

  it('uses option-aware rejection and leaves ordinary path values to the CLI parser', () => {
    expect(() => validateRecoveryRuntimeArguments(['discover', '--config-file', '/safe/decrypt-review.json'])).not.toThrow();
    expect(() => validateRecoveryRuntimeArguments(['discover', '--decrypt=/secret'])).toThrowError(expect.objectContaining({ code: 'RECOVERY_RUNTIME_INVALID' }));
    expect(() => validateRecoveryRuntimeArguments(['sh', '-c', 'anything'])).toThrowError(expect.objectContaining({ code: 'RECOVERY_RUNTIME_INVALID' }));
  });

  it('aborts on the first signal and fail-stops on a second signal or grace expiry', () => {
    const listeners = new Map<string, () => void>(); let grace: (() => void) | undefined;
    const runtimeProcess = {
      on: (event: string, listener: () => void) => listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
      exit: vi.fn(() => { throw new Error('exit'); }),
    } as unknown as RecoverySignalProcess;
    const boundary = installRecoverySignalBoundary({ process: runtimeProcess,
      setTimer: ((callback: () => void) => { grace = callback; return { unref: () => undefined } as never; }) as typeof setTimeout,
      clearTimer: vi.fn() as unknown as typeof clearTimeout });
    listeners.get('SIGINT')?.();
    expect(boundary.signal.aborted).toBe(true); expect(runtimeProcess.exit).not.toHaveBeenCalled();
    expect(() => listeners.get('SIGTERM')?.()).toThrow('exit');
    expect(runtimeProcess.exit).toHaveBeenCalledWith(130);
    expect(() => grace?.()).toThrow('exit');
    boundary.dispose();
  });
});
