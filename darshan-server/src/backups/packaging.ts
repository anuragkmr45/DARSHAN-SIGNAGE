import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { attachAbortTermination } from './abortable-process';
import { BackupError, asBackupError } from './errors';

export const LOCAL_BACKUP_COMPONENTS = ['database', 'objects', 'configuration'] as const;
export type LocalBackupComponent = typeof LOCAL_BACKUP_COMPONENTS[number];

export interface PackagedBackupComponent {
  component: LocalBackupComponent;
  inputRoot: string;
  outputPath: string;
}

/**
 * Produces a byte-stable uncompressed POSIX tar. Encryption is deliberately a
 * separate step so plaintext lifetime and cleanup can be fenced explicitly.
 */
export async function createDeterministicTar(input: {
  executablePath: string;
  inputRoot: string;
  outputPath: string;
  signal: AbortSignal;
}): Promise<void> {
  input.signal.throwIfAborted();
  for (const [label, path] of [['inputRoot', input.inputRoot], ['outputPath', input.outputPath]] as const) {
    if (!isAbsolute(path) || resolve(path) !== path) {
      throw new BackupError('BACKUP_INVALID_INPUT', `${label} must be an absolute normalized path.`);
    }
  }
  if (dirname(input.outputPath) === input.inputRoot || input.outputPath.startsWith(`${input.inputRoot}/`)) {
    throw new BackupError('BACKUP_INVALID_INPUT', 'A package output must not be created inside its input tree.');
  }
  const root = await fs.lstat(input.inputRoot);
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', 'Package input must be a non-symlink directory.');
  }
  try {
    await fs.lstat(input.outputPath);
    throw new BackupError('BACKUP_OUTPUT_EXISTS', `Package output already exists: ${basename(input.outputPath)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const child = spawn(input.executablePath, [
    '--format=posix', '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '--pax-option=delete=atime,delete=ctime', '-cf', input.outputPath, '-C', input.inputRoot, '.',
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' },
  });
  const termination = attachAbortTermination(child, input.signal);
  let diagnostics = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => { diagnostics = `${diagnostics}${chunk}`.slice(-16 * 1024); });
  try {
    const code = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once('error', rejectExit);
      child.once('close', resolveExit);
    });
    await termination.wait();
    input.signal.throwIfAborted();
    if (code !== 0) {
      throw new BackupError('BACKUP_IO_TRANSIENT', `Deterministic packaging failed${diagnostics.trim() ? `: ${diagnostics.trim()}` : '.'}`);
    }
    const output = await fs.lstat(input.outputPath);
    if (output.isSymbolicLink() || !output.isFile()) {
      throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', 'Package output is not a regular file.');
    }
    await fs.chmod(input.outputPath, 0o600);
  } catch (error) {
    await fs.rm(input.outputPath, { force: true }).catch(() => undefined);
    throw asBackupError(error, 'BACKUP_IO_TRANSIENT');
  } finally {
    termination.dispose();
  }
}

export async function packageBackupComponents(input: {
  rawRoot: string;
  packageRoot: string;
  tarExecutablePath: string;
  signal: AbortSignal;
  archive?: typeof createDeterministicTar;
  components?: readonly LocalBackupComponent[];
}): Promise<PackagedBackupComponent[]> {
  await fs.mkdir(input.packageRoot, { recursive: false, mode: 0o700 });
  const archive = input.archive ?? createDeterministicTar;
  const packaged: PackagedBackupComponent[] = [];
  const components = input.components ?? LOCAL_BACKUP_COMPONENTS;
  if (new Set(components).size !== components.length || components.some((component) => !LOCAL_BACKUP_COMPONENTS.includes(component))) {
    throw new BackupError('BACKUP_INVALID_INPUT', 'Backup component selection is invalid.');
  }
  for (const component of components) {
    const inputRoot = resolve(input.rawRoot, component);
    const outputPath = resolve(input.packageRoot, `${component}.tar`);
    await archive({ executablePath: input.tarExecutablePath, inputRoot, outputPath, signal: input.signal });
    packaged.push({ component, inputRoot, outputPath });
  }
  return packaged;
}
