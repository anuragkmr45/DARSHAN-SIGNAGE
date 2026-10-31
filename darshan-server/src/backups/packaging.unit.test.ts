import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_BACKUP_COMPONENTS, packageBackupComponents } from './packaging.js';

describe('local backup component packaging', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('packages exactly database, objects, and configuration in stable order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-package-components-'));
    roots.push(root);
    await chmod(root, 0o700);
    const rawRoot = join(root, 'raw');
    await mkdir(rawRoot, { mode: 0o700 });
    for (const component of LOCAL_BACKUP_COMPONENTS) {
      await mkdir(join(rawRoot, component), { mode: 0o700 });
      await writeFile(join(rawRoot, component, 'inventory.json'), '{}\n', { mode: 0o600 });
    }
    const calls: string[] = [];
    const result = await packageBackupComponents({
      rawRoot,
      packageRoot: join(root, 'packages'),
      tarExecutablePath: '/test/tar',
      signal: new AbortController().signal,
      archive: async ({ inputRoot, outputPath }) => {
        calls.push(inputRoot);
        await writeFile(outputPath, inputRoot, { flag: 'wx', mode: 0o600 });
      },
    });

    expect(result.map((item) => item.component)).toEqual(['database', 'objects', 'configuration']);
    expect(calls).toEqual(LOCAL_BACKUP_COMPONENTS.map((component) => join(rawRoot, component)));
    expect(result.map((item) => item.outputPath)).toEqual(
      LOCAL_BACKUP_COMPONENTS.map((component) => join(root, 'packages', `${component}.tar`))
    );
  });

  it('supports the broker worker ciphertext boundary without packaging configuration plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-package-components-'));
    roots.push(root);
    await chmod(root, 0o700);
    const rawRoot = join(root, 'raw');
    await mkdir(rawRoot, { mode: 0o700 });
    for (const component of ['database', 'objects'] as const) await mkdir(join(rawRoot, component), { mode: 0o700 });
    const result = await packageBackupComponents({ rawRoot, packageRoot: join(root, 'packages'), tarExecutablePath: '/test/tar',
      signal: new AbortController().signal, components: ['database', 'objects'],
      archive: async ({ outputPath }) => writeFile(outputPath, 'ciphertext-source', { flag: 'wx', mode: 0o600 }) });
    expect(result.map((item) => item.component)).toEqual(['database', 'objects']);
  });
});
