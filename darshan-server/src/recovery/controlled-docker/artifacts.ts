import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { canonicalJson, parseStrictJson } from '../../backups/backup-broker-protocol';
import { CAPSULE_INVENTORY_FILE, validateProductionCapsuleInventory } from '../../backups/configuration-capsule-inventory';
import type { BackupManifestV1 } from '../../backups/manifest';
import { ControlledRecoveryError, canonicalDecimal, sha256 } from './contracts';

export interface ControlledAgeRunner {
  proveRecipientKey(input: { keyFile: string; expectedKeyId: string; signal?: AbortSignal }): Promise<void>;
  decryptArchive(input: { ciphertextPath: string; keyFile: string; expectedCiphertextSha256: string;
    expectedCiphertextBytes: string; signal?: AbortSignal }): Promise<readonly ArchiveEntry[]>;
}

export interface ArchiveEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'hardlink' | 'character' | 'block' | 'fifo';
  bytes?: Uint8Array;
  declaredSize: string;
  sparse?: boolean;
}

export interface ExtractedFile { path: string; size: string; sha256: string; bytes: Buffer }

function normalizedArchivePath(value: string, maximumBytes: number, type: ArchiveEntry['type']): string {
  const rootDirectory = type === 'directory' && (value === '.' || value === './');
  const directoryValue = type === 'directory' && value.endsWith('/') && !rootDirectory ? value.slice(0, -1) : value;
  const withoutDot = directoryValue.startsWith('./') ? directoryValue.slice(2) : directoryValue;
  if (rootDirectory) return '.';
  if (!withoutDot || withoutDot.startsWith('/') || withoutDot.includes('\\') || Buffer.byteLength(withoutDot) > maximumBytes ||
      withoutDot.split('/').some((part) => !part || part === '.' || part === '..') || posix.normalize(withoutDot) !== withoutDot) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'Archive contains an unsafe path.');
  }
  return withoutDot;
}

export async function safeExtractArchive(input: {
  entries: readonly ArchiveEntry[]; outputRoot: string; component: 'database' | 'objects' | 'configuration';
  maximumBytes: string; maximumEntries: number; maximumPathBytes: number;
}): Promise<ExtractedFile[]> {
  if (resolve(input.outputRoot) !== input.outputRoot) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'Extraction root must be absolute and normalized.');
  if (input.entries.length > input.maximumEntries) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_LIMIT', 'Archive entry count exceeds the fixed bound.');
  await mkdir(input.outputRoot, { recursive: false, mode: 0o700 });
  const maximum = canonicalDecimal(input.maximumBytes, 'maximumBytes'); let total = 0n;
  const seen = new Set<string>(); const files: ExtractedFile[] = [];
  for (const entry of input.entries) {
    const path = normalizedArchivePath(entry.path, input.maximumPathBytes, entry.type);
    if (seen.has(path)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_DUPLICATE', 'Archive contains a duplicate normalized path.');
    seen.add(path);
    if (entry.sparse || (entry.type !== 'file' && entry.type !== 'directory')) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_TYPE', 'Archive contains a link, device, sparse, or special entry.');
    }
    if (path === '.') continue;
    const destination = join(input.outputRoot, path);
    if (!destination.startsWith(`${input.outputRoot}/`)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'Archive path escaped extraction root.');
    if (entry.type === 'directory') { await mkdir(destination, { recursive: true, mode: 0o700 }); continue; }
    const bytes = Buffer.from(entry.bytes ?? []);
    const declared = canonicalDecimal(entry.declaredSize, 'declaredSize');
    if (declared !== BigInt(bytes.byteLength)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_SIZE_MISMATCH', 'Archive entry size differs from extracted bytes.');
    total += declared;
    if (total > maximum) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_LIMIT', 'Archive expanded size exceeds the fixed bound.');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(destination, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    files.push({ path, size: declared.toString(), sha256: sha256(bytes), bytes });
  }
  if (files.length === 0) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_EMPTY', `${input.component} archive contains no files.`);
  return files.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

/** Recreates the V2 raw `database/` + `objects/` capture tree; no legacy per-component inventory is assumed. */
export function calculateV2StagingInventory(database: readonly ExtractedFile[], objects: readonly ExtractedFile[]): string {
  const hash = createHash('sha256');
  const files = [...database.map((entry) => ({ ...entry, path: `database/${entry.path}` })),
    ...objects.map((entry) => ({ ...entry, path: `objects/${entry.path}` }))]
    .sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  for (const file of files) {
    hash.update(`${Buffer.byteLength(file.path)}:${file.path}:${file.size}:`); hash.update(file.bytes); hash.update(';');
  }
  return hash.digest('hex');
}

export function validateConfigurationInventory(input: {
  files: readonly ExtractedFile[]; encryptedInventorySha256: string;
}): { count: number; aggregateSha256: string } {
  const byPath = new Map(input.files.map((file) => [file.path, file]));
  const inventoryFile = byPath.get(CAPSULE_INVENTORY_FILE);
  if (!inventoryFile || inventoryFile.sha256 !== input.encryptedInventorySha256) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_CONFIGURATION_INVENTORY', 'Configuration capsule inventory digest differs from signed policy.');
  }
  let inventory;
  try { inventory = validateProductionCapsuleInventory(parseStrictJson(inventoryFile.bytes, 1024 * 1024)); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_CONFIGURATION_INVENTORY', 'Configuration capsule inventory is invalid.', { cause }); }
  const expected = new Set([CAPSULE_INVENTORY_FILE, ...inventory.entries.map((entry) => `${entry.role}/${entry.path}`)]);
  if (expected.size !== byPath.size || [...byPath.keys()].some((path) => !expected.has(path))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_CONFIGURATION_INVENTORY', 'Configuration capsule has missing or unexpected files.');
  }
  for (const entry of inventory.entries) {
    const file = byPath.get(`${entry.role}/${entry.path}`);
    if (!file || file.sha256 !== entry.sha256 || canonicalDecimal(file.size, 'configuration size') > canonicalDecimal(entry.max_bytes, 'configuration maximum')) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_CONFIGURATION_INVENTORY', 'Configuration capsule file differs from its signed inventory.');
    }
  }
  return { count: byPath.size, aggregateSha256: sha256(canonicalJson(input.files.map(({ path, size, sha256: fileSha }) => ({ path, size, sha256: fileSha })))) };
}

export async function decryptAndVerifyArtifacts(input: {
  runner: ControlledAgeRunner; manifest: BackupManifestV1; publishedRoot: string; workspaceRoot: string;
  keyFile: string; encryptedInventorySha256: string; maximumBytes: string; maximumEntries: number;
  maximumPathBytes: number; signal?: AbortSignal;
}): Promise<{ database: ExtractedFile[]; objects: ExtractedFile[]; configuration: ExtractedFile[]; evidenceSha256: string }> {
  await input.runner.proveRecipientKey({ keyFile: input.keyFile, expectedKeyId: input.manifest.encryption.keyId, signal: input.signal });
  const exactSet = input.manifest.artifacts.map((artifact) => `${artifact.kind}:${artifact.name}`).sort();
  if (JSON.stringify(exactSet) !== JSON.stringify(['CONFIGURATION:configuration', 'DATABASE:database', 'OBJECTS:objects'])) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_SET_INVALID', 'Manifest must contain only the exact database, objects, and configuration artifacts.');
  }
  const results = new Map<string, ExtractedFile[]>();
  for (const component of ['database', 'objects', 'configuration'] as const) {
    const artifact = input.manifest.artifacts.find((candidate) => candidate.name === component && candidate.kind === component.toUpperCase());
    if (!artifact) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_SET_INVALID', 'Manifest must contain exact database, objects, and configuration artifacts.');
    const entries = await input.runner.decryptArchive({ ciphertextPath: join(input.publishedRoot, artifact.ciphertextPath), keyFile: input.keyFile,
      expectedCiphertextSha256: artifact.ciphertextSha256, expectedCiphertextBytes: artifact.ciphertextSizeBytes, signal: input.signal });
    results.set(component, await safeExtractArchive({ entries, outputRoot: join(input.workspaceRoot, component), component,
      maximumBytes: input.maximumBytes, maximumEntries: input.maximumEntries, maximumPathBytes: input.maximumPathBytes }));
  }
  const database = results.get('database')!; const objects = results.get('objects')!; const configuration = results.get('configuration')!;
  if (calculateV2StagingInventory(database, objects) !== input.manifest.capture.stagingInventorySha256) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_STAGING_INVENTORY_MISMATCH', 'Reconstructed V2 raw database/object inventory differs from the sealed capture.');
  }
  const config = validateConfigurationInventory({ files: configuration, encryptedInventorySha256: input.encryptedInventorySha256 });
  return { database, objects, configuration, evidenceSha256: sha256(canonicalJson({ database: database.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    objects: objects.map(({ path, size, sha256 }) => ({ path, size, sha256 })), configuration: config })) };
}

