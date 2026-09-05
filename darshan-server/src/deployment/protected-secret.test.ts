import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProtectedSecretError, readProtectedSecretFile } from './protected-secret';

const temporaryDirectories: string[] = [];

async function createSecretFile(value: string, mode = 0o600) {
  const directory = await mkdtemp(join(tmpdir(), 'darshan-protected-secret-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'password');
  await writeFile(filePath, value, { mode });
  await chmod(filePath, mode);
  return { directory, filePath };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('readProtectedSecretFile', () => {
  it('reads one trailing newline without returning it', async () => {
    const { filePath } = await createSecretFile('StrongPassword123!\n');
    await expect(readProtectedSecretFile(filePath)).resolves.toBe('StrongPassword123!');
  });

  it('rejects files readable by group or other on Unix', async () => {
    if (process.platform === 'win32') return;
    const { filePath } = await createSecretFile('StrongPassword123!', 0o640);
    await expect(readProtectedSecretFile(filePath)).rejects.toBeInstanceOf(ProtectedSecretError);
  });

  it('rejects symbolic links and multiline content', async () => {
    const { directory, filePath } = await createSecretFile('StrongPassword123!\nsecond-line');
    await expect(readProtectedSecretFile(filePath)).rejects.toBeInstanceOf(ProtectedSecretError);

    const linkPath = join(directory, 'password-link');
    await symlink(filePath, linkPath);
    await expect(readProtectedSecretFile(linkPath)).rejects.toBeInstanceOf(ProtectedSecretError);
  });
});
