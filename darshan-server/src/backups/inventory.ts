import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { BackupError, asBackupError } from './errors';
import { canonicalJSONStringify } from './manifest';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function hasControlCharacters(value: string) {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
}

export interface FileInventoryEntryV1 {
  path: string;
  sizeBytes: string;
  sha256: string;
}

export interface FileInventoryV1 {
  version: 1;
  fileCount: string;
  totalBytes: string;
  entries: FileInventoryEntryV1[];
}

export interface FileInventoryLimits {
  maxDepth?: number;
  maxEntries?: number;
  maxPathBytes?: number;
  maxTotalBytes?: bigint;
}

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 64,
  maxEntries: 1_000_000,
  maxPathBytes: 4096,
  maxTotalBytes: (1n << 63n) - 1n,
});

function compareUtf8(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function validateLimit(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BackupError('BACKUP_INVALID_INPUT', `${name} must be a positive safe integer.`);
  }
}

export function assertSafeInventoryPath(path: string, maximumBytes: number = DEFAULT_LIMITS.maxPathBytes): string {
  if (!path || path.startsWith('/') || path.includes('\\') || hasControlCharacters(path)) {
    throw new BackupError('BACKUP_UNSAFE_PATH', `Unsafe inventory path ${JSON.stringify(path)}.`);
  }
  if (path.normalize('NFC') !== path || Buffer.from(path, 'utf8').toString('utf8') !== path) {
    throw new BackupError('BACKUP_UNSAFE_PATH', `Inventory path ${JSON.stringify(path)} is not well-formed NFC UTF-8.`);
  }
  if (Buffer.byteLength(path, 'utf8') > maximumBytes || path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new BackupError('BACKUP_UNSAFE_PATH', `Inventory path ${JSON.stringify(path)} is not a bounded normalized relative path.`);
  }
  return path;
}

function changed(before: Awaited<ReturnType<Awaited<ReturnType<typeof fs.open>>['stat']>>, after: typeof before) {
  return before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.mode !== after.mode;
}

async function hashRegularFile(filePath: string, displayPath: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Inventory entry ${JSON.stringify(displayPath)} is not a regular file.`);
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (changed(before, after)) {
      throw new BackupError('BACKUP_INVENTORY_CHANGED', `Inventory entry ${JSON.stringify(displayPath)} changed while it was hashed.`);
    }
    return { size: before.size, sha256: hash.digest('hex') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Inventory entry ${JSON.stringify(displayPath)} became a symlink.`, undefined, { cause: error as Error });
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function createFileInventory(
  root: string,
  options: FileInventoryLimits & { signal?: AbortSignal } = {}
): Promise<FileInventoryV1> {
  if (!isAbsolute(root)) throw new BackupError('BACKUP_INVALID_INPUT', 'Inventory root must be an absolute path.');
  const maxDepth = options.maxDepth ?? DEFAULT_LIMITS.maxDepth;
  const maxEntries = options.maxEntries ?? DEFAULT_LIMITS.maxEntries;
  const maxPathBytes = options.maxPathBytes ?? DEFAULT_LIMITS.maxPathBytes;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes;
  validateLimit('maxDepth', maxDepth);
  validateLimit('maxEntries', maxEntries);
  validateLimit('maxPathBytes', maxPathBytes);
  if (maxTotalBytes < 0n) throw new BackupError('BACKUP_INVALID_INPUT', 'maxTotalBytes must not be negative.');

  const absoluteRoot = resolve(root);
  try {
    const rootStat = await fs.lstat(absoluteRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', 'Inventory root must be a real directory, not a symlink or special file.');
    }
    if (await fs.realpath(absoluteRoot) !== absoluteRoot) {
      throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', 'Inventory root must not traverse symlinked parent directories.');
    }

    const entries: FileInventoryEntryV1[] = [];
    let traversedEntries = 0;
    let totalBytes = 0n;

    const visit = async (directory: string, relativeDirectory: string, depth: number): Promise<void> => {
      options.signal?.throwIfAborted();
      if (depth > maxDepth) throw new BackupError('BACKUP_INVENTORY_LIMIT_EXCEEDED', `Inventory traversal exceeded maxDepth ${maxDepth}.`);
      const children = await fs.readdir(directory, { withFileTypes: true });
      children.sort((left, right) => compareUtf8(left.name, right.name));
      for (const child of children) {
        options.signal?.throwIfAborted();
        traversedEntries++;
        if (traversedEntries > maxEntries) throw new BackupError('BACKUP_INVENTORY_LIMIT_EXCEEDED', `Inventory traversal exceeded maxEntries ${maxEntries}.`);
        const relativePath = assertSafeInventoryPath(relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name, maxPathBytes);
        const absolutePath = join(directory, child.name);
        // Dirent is only a hint. lstat is authoritative and avoids following links.
        const stat = await fs.lstat(absolutePath, { bigint: true });
        if (stat.isSymbolicLink()) {
          throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Inventory entry ${JSON.stringify(relativePath)} is a symlink.`);
        }
        if (stat.isDirectory()) {
          await visit(absolutePath, relativePath, depth + 1);
          continue;
        }
        if (!stat.isFile()) {
          throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Inventory entry ${JSON.stringify(relativePath)} is a special file.`);
        }
        if (totalBytes + stat.size > maxTotalBytes) {
          throw new BackupError('BACKUP_INVENTORY_LIMIT_EXCEEDED', `Inventory contents exceed maxTotalBytes ${maxTotalBytes}.`);
        }
        const hashed = await hashRegularFile(absolutePath, relativePath, options.signal);
        if (hashed.size !== stat.size || hashed.size + totalBytes > maxTotalBytes) {
          throw new BackupError('BACKUP_INVENTORY_CHANGED', `Inventory entry ${JSON.stringify(relativePath)} changed before hashing completed.`);
        }
        totalBytes += hashed.size;
        entries.push({ path: relativePath, sizeBytes: hashed.size.toString(), sha256: hashed.sha256 });
      }
    };

    await visit(absoluteRoot, '', 0);
    entries.sort((left, right) => compareUtf8(left.path, right.path));
    return { version: 1, fileCount: entries.length.toString(), totalBytes: totalBytes.toString(), entries };
  } catch (error) {
    if (options.signal?.aborted) {
      throw new BackupError('BACKUP_ABORTED', 'File inventory generation was aborted.', undefined, error instanceof Error ? { cause: error } : undefined);
    }
    throw asBackupError(error, 'BACKUP_INVENTORY_UNSAFE_ENTRY');
  }
}

export function serializeFileInventory(inventory: FileInventoryV1): Buffer {
  validateFileInventory(inventory);
  return Buffer.from(`${canonicalJSONStringify(inventory)}\n`, 'utf8');
}

export function fileInventorySha256(inventory: FileInventoryV1): string {
  return createHash('sha256').update(serializeFileInventory(inventory)).digest('hex');
}

export function validateFileInventory(inventory: FileInventoryV1): void {
  if (inventory.version !== 1 || !/^(0|[1-9][0-9]*)$/.test(inventory.fileCount) || !/^(0|[1-9][0-9]*)$/.test(inventory.totalBytes)) {
    throw new BackupError('BACKUP_MANIFEST_INVALID', 'File inventory header is invalid.');
  }
  if (inventory.fileCount !== inventory.entries.length.toString()) {
    throw new BackupError('BACKUP_MANIFEST_INVALID', 'File inventory count does not match its entries.');
  }
  let total = 0n;
  let previous: string | undefined;
  for (const entry of inventory.entries) {
    assertSafeInventoryPath(entry.path);
    if (previous !== undefined && compareUtf8(previous, entry.path) >= 0) {
      throw new BackupError('BACKUP_MANIFEST_DUPLICATE_ENTRY', 'File inventory paths must be unique and UTF-8 byte sorted.');
    }
    if (!/^(0|[1-9][0-9]*)$/.test(entry.sizeBytes) || entry.sizeBytes.length > 40 || !SHA256_PATTERN.test(entry.sha256)) {
      throw new BackupError('BACKUP_MANIFEST_INVALID', `File inventory entry ${JSON.stringify(entry.path)} is invalid.`);
    }
    total += BigInt(entry.sizeBytes);
    previous = entry.path;
  }
  if (total.toString() !== inventory.totalBytes) {
    throw new BackupError('BACKUP_MANIFEST_INVALID', 'File inventory byte total does not match its entries.');
  }
}
