import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { canonicalJson, parseStrictJson } from '../src/backups/backup-broker-protocol';
import { CAPSULE_INVENTORY_FILE, validateProductionCapsuleInventory } from '../src/backups/configuration-capsule-inventory';

interface Input { root: string; encryptedInventorySha256: string }
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input = parseStrictJson(Buffer.concat(chunks), 16 * 1024) as Input;
if (!input || typeof input !== 'object' || typeof input.root !== 'string' || resolve(input.root) !== input.root ||
    typeof input.encryptedInventorySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.encryptedInventorySha256)) throw new Error('Decrypted capsule validation input is invalid.');
if (await fs.realpath(input.root) !== input.root) throw new Error('Decrypted capsule root must be canonical and must not traverse a symlink.');
const inventoryPath = join(input.root, CAPSULE_INVENTORY_FILE);
const inventoryStat = await fs.lstat(inventoryPath, { bigint: true });
if (inventoryStat.isSymbolicLink() || !inventoryStat.isFile() || inventoryStat.nlink !== 1n || inventoryStat.size < 1n || inventoryStat.size > 1024n * 1024n) throw new Error('Encrypted inventory document is unsafe.');
const inventoryBytes = await fs.readFile(inventoryPath);
if (createHash('sha256').update(inventoryBytes).digest('hex') !== input.encryptedInventorySha256) throw new Error('Encrypted inventory digest does not match the trusted signed descriptor.');
const inventory = validateProductionCapsuleInventory(parseStrictJson(inventoryBytes, 1024 * 1024));
if (!inventoryBytes.equals(canonicalJson(inventory))) throw new Error('Encrypted inventory document is not byte-for-byte canonical.');
const expected = new Set([CAPSULE_INVENTORY_FILE, ...inventory.entries.map((entry) => `${entry.role}/${entry.path}`)]);
const actual: string[] = [];
async function walk(directory: string): Promise<void> {
  for (const name of await fs.readdir(directory)) {
    const path = join(directory, name); const suffix = relative(input.root, path);
    if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`)) throw new Error('Decrypted capsule path escaped its root.');
    const stat = await fs.lstat(path, { bigint: true });
    if (stat.isSymbolicLink()) throw new Error(`Decrypted capsule contains a symbolic link: ${suffix}.`);
    if (stat.isDirectory()) await walk(path);
    else if (stat.isFile()) actual.push(suffix);
    else throw new Error(`Decrypted capsule contains a special file: ${suffix}.`);
  }
}
await walk(input.root);
if (actual.length !== expected.size || actual.some((path) => !expected.has(path))) throw new Error('Decrypted capsule contains missing or unexpected files.');
for (const entry of inventory.entries) {
  const path = join(input.root, entry.role, entry.path); const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || Number(stat.mode & 0o777n).toString(8).padStart(4, '0') !== entry.restore_mode || stat.size < 1n || stat.size > BigInt(entry.max_bytes)) {
      throw new Error(`Decrypted capsule file violates restore metadata: ${entry.role}/${entry.path}.`);
    }
    const bytes = await handle.readFile();
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Decrypted capsule content digest mismatch: ${entry.role}/${entry.path}.`);
  } finally { await handle.close(); }
}
