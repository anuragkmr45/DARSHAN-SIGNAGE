import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminSecretInputError, resolveAdminPasswordInput } from './admin-secret-input';

const temporaryDirectories: string[] = [];

async function createSecretFile(value: string, mode = 0o600) {
  const directory = await mkdtemp(join(tmpdir(), 'darshan-admin-secret-input-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'password');
  await writeFile(filePath, value, { mode });
  await chmod(filePath, mode);
  return filePath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('resolveAdminPasswordInput', () => {
  it('reads a protected password file without accepting plaintext arguments', async () => {
    const passwordFile = await createSecretFile('StrongRecoveryPassword123!\n');

    await expect(resolveAdminPasswordInput({ passwordFile })).resolves.toBe('StrongRecoveryPassword123!');
  });

  it('rejects missing or ambiguous password sources before recovery can run', async () => {
    await expect(resolveAdminPasswordInput({})).rejects.toBeInstanceOf(AdminSecretInputError);
    await expect(
      resolveAdminPasswordInput({
        passwordFile: '/secure/recovery-password',
        promptPassword: true,
      })
    ).rejects.toThrow(/exactly one password source/);
  });

  it('supports explicit non-echoing TTY mode through an injectable reader for CLI tests', async () => {
    const readTty = vi.fn(async () => 'PromptedRecoveryPassword123!');

    await expect(resolveAdminPasswordInput({ promptPassword: true, prompt: 'Recovery password: ' }, { readTty })).resolves.toBe(
      'PromptedRecoveryPassword123!'
    );
    expect(readTty).toHaveBeenCalledWith('Recovery password: ');
  });

  it('rejects empty or multiline prompted secrets', async () => {
    await expect(resolveAdminPasswordInput({ promptPassword: true }, { readTty: async () => '' })).rejects.toBeInstanceOf(
      AdminSecretInputError
    );
    await expect(
      resolveAdminPasswordInput({ promptPassword: true }, { readTty: async () => 'line-one\nline-two' })
    ).rejects.toBeInstanceOf(AdminSecretInputError);
  });
});
