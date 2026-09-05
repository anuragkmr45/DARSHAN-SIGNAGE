import { lstat, readFile } from 'node:fs/promises';

export class ProtectedSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtectedSecretError';
  }
}

/**
 * Read a one-use operator secret without accepting it through a command line
 * argument. Linux production files must not be readable by group or other.
 */
export async function readProtectedSecretFile(filePath: string): Promise<string> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ProtectedSecretError('Password file must be a regular file.');
  }

  if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
    throw new ProtectedSecretError('Password file must have mode 0600 or stricter.');
  }

  const value = await readFile(filePath, 'utf8');
  const normalized = value.replace(/\r?\n$/, '');
  if (!normalized || /[\r\n\0]/.test(normalized)) {
    throw new ProtectedSecretError('Password file must contain one non-empty line.');
  }

  return normalized;
}
