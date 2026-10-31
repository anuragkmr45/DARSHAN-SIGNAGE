import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createFileInventory, fileInventorySha256, serializeFileInventory } from './inventory';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function root() {
  const directory = await fs.mkdtemp(join(tmpdir(), 'darshan-inventory-'));
  roots.push(directory);
  return directory;
}

describe('deterministic backup file inventory', () => {
  it('sorts paths by UTF-8 bytes and hashes each regular file', async () => {
    const directory = await root();
    await fs.mkdir(join(directory, 'nested'));
    await fs.writeFile(join(directory, 'z.txt'), 'z');
    await fs.writeFile(join(directory, 'a.txt'), 'alpha');
    await fs.writeFile(join(directory, 'nested', 'b.bin'), Buffer.from([0, 1, 2]));

    const first = await createFileInventory(directory);
    const second = await createFileInventory(directory);
    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.path)).toEqual(['a.txt', 'nested/b.bin', 'z.txt']);
    expect(first).toMatchObject({ version: 1, fileCount: '3', totalBytes: '9' });
    expect(first.entries[0]).toEqual({
      path: 'a.txt',
      sizeBytes: '5',
      sha256: createHash('sha256').update('alpha').digest('hex'),
    });
    expect(fileInventorySha256(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(serializeFileInventory(first).at(-1)).toBe(10);
  });

  it('rejects symlinks and bounded traversal overflows', async () => {
    const directory = await root();
    await fs.writeFile(join(directory, 'target'), 'secret');
    await fs.symlink(join(directory, 'target'), join(directory, 'link'));
    await expect(createFileInventory(directory)).rejects.toMatchObject({ code: 'BACKUP_INVENTORY_UNSAFE_ENTRY' });
    await fs.rm(join(directory, 'link'));
    await fs.writeFile(join(directory, 'second'), 'two');
    await expect(createFileInventory(directory, { maxEntries: 1 })).rejects.toMatchObject({ code: 'BACKUP_INVENTORY_LIMIT_EXCEEDED' });
    await expect(createFileInventory(directory, { maxTotalBytes: 2n })).rejects.toMatchObject({ code: 'BACKUP_INVENTORY_LIMIT_EXCEEDED' });
  });

  it('rejects control characters in portable paths', async () => {
    const directory = await root();
    await fs.writeFile(join(directory, 'bad\nname'), 'x');
    await expect(createFileInventory(directory)).rejects.toMatchObject({ code: 'BACKUP_UNSAFE_PATH' });
  });
});
