import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, type FileHandle } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { ControlledRecoveryError, canonicalDecimal } from './contracts';

export interface DiskArtifactDescriptor { path: string; size: string; sha256: string }
export interface ExtractedDiskFile extends DiskArtifactDescriptor { archivePath: string }
export interface DiskBackedObject { key: string; artifact: DiskArtifactDescriptor }
export interface StreamingObjectStoreAdapter {
  putStream(input: { key: string; size: string; sha256: string; stream: Readable; signal?: AbortSignal }): Promise<void>;
  getStream(input: { key: string; maximumBytes: string; signal?: AbortSignal }): Promise<{ size: string; stream: Readable } | null>;
  listAll(signal?: AbortSignal): Promise<readonly string[]>;
}

export async function openBoundedArtifactStream(input: {
  descriptor: DiskArtifactDescriptor; maximumBytes: string; expectedUid?: number; expectedGid?: number;
}): Promise<Readable> {
  const maximum = canonicalDecimal(input.maximumBytes, 'maximumBytes');
  const expectedSize = canonicalDecimal(input.descriptor.size, 'artifact size');
  if (!input.descriptor.path.startsWith('/') || !/^[a-f0-9]{64}$/.test(input.descriptor.sha256) || expectedSize > maximum) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_DESCRIPTOR_INVALID', 'Disk artifact descriptor is invalid or exceeds its bound.');
  }
  let handle: FileHandle;
  try { handle = await open(input.descriptor.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_DESCRIPTOR_INVALID', 'Disk artifact cannot be opened safely.', { cause }); }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || BigInt(stat.size) !== expectedSize ||
        (input.expectedUid !== undefined && stat.uid !== input.expectedUid) || (input.expectedGid !== undefined && stat.gid !== input.expectedGid)) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_DESCRIPTOR_INVALID', 'Disk artifact identity, ownership, link count, or size differs.');
    }
    const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < stat.size) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
      if (result.bytesRead < 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_TRUNCATED', 'Disk artifact truncated while hashing.');
      hash.update(buffer.subarray(0, result.bytesRead)); offset += result.bytesRead;
    }
    if (hash.digest('hex') !== input.descriptor.sha256) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARTIFACT_HASH_MISMATCH', 'Disk artifact digest differs.');
    if (stat.size === 0) { await handle.close(); return Readable.from([]); }
    return handle.createReadStream({ autoClose: true, start: 0, end: stat.size - 1, highWaterMark: 64 * 1024 });
  } catch (cause) { await handle.close(); throw cause; }
}

class BoundedReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private current = Buffer.alloc(0); private offset = 0; private ended = false; private closed = false;
  constructor(source: AsyncIterable<Uint8Array>, private readonly signal?: AbortSignal) { this.iterator = source[Symbol.asyncIterator](); }
  private async fill(): Promise<boolean> {
    if (this.offset < this.current.length) return true;
    this.signal?.throwIfAborted();
    const pending = this.iterator.next(); let abort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => { abort = () => reject(this.signal?.reason ?? new Error('aborted')); this.signal?.addEventListener('abort', abort, { once: true }); });
    let next: IteratorResult<Uint8Array>;
    try { next = this.signal ? await Promise.race([pending, aborted]) : await pending; }
    catch (cause) { void pending.catch(() => undefined); throw cause; }
    finally { if (abort) this.signal?.removeEventListener('abort', abort); }
    if (next.done) { this.ended = true; return false; }
    if (next.value.byteLength < 1 || next.value.byteLength > 1024 * 1024) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_LIMIT', 'Archive stream chunk exceeds the fixed bound.');
    this.current = Buffer.from(next.value); this.offset = 0; return true;
  }
  async exact(length: number): Promise<Buffer> {
    const output = Buffer.allocUnsafe(length); let written = 0;
    while (written < length) {
      if (!await this.fill()) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_TRUNCATED', 'Archive ended before the declared boundary.');
      const count = Math.min(length - written, this.current.length - this.offset);
      this.current.copy(output, written, this.offset, this.offset + count); this.offset += count; written += count;
    }
    return output;
  }
  async hasRemainingNonzero(): Promise<boolean> {
    while (await this.fill()) {
      const rest = this.current.subarray(this.offset); this.offset = this.current.length;
      if (rest.some((byte) => byte !== 0)) return true;
    }
    return false;
  }
  get isEnded(): boolean { return this.ended; }
  async close(): Promise<void> { if (this.closed) return; this.closed = true; const returning = Promise.resolve(this.iterator.return?.());
    let timer: NodeJS.Timeout | undefined; const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ControlledRecoveryError(
      'CONTROLLED_RECOVERY_ARCHIVE_CLEANUP_TIMEOUT', 'Archive iterator cleanup did not settle within the fixed bound.')), 30_000); timer.unref(); });
    try { await Promise.race([returning, timeout]); } finally { if (timer) clearTimeout(timer); void returning.catch(() => undefined); } }
}

async function cleanupBoundedReader(reader: BoundedReader, beforeCleanup: (() => Promise<void>) | undefined): Promise<void> {
  let cleanupError: unknown;
  try { await beforeCleanup?.(); } catch (cause) { cleanupError = cause; }
  try { await reader.close(); } catch (cause) { cleanupError ??= cause; }
  if (cleanupError) throw cleanupError;
}

function fieldText(block: Buffer, start: number, length: number): string {
  const field = block.subarray(start, start + length); const zero = field.indexOf(0);
  return field.subarray(0, zero < 0 ? field.length : zero).toString('utf8');
}

function octal(block: Buffer, start: number, length: number, name: string): bigint {
  const text = fieldText(block, start, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', `Archive ${name} is not canonical octal.`);
  return BigInt(`0o${text}`);
}

function normalizeTarPath(value: string, type: 'file' | 'directory', maximumPathBytes: number): string {
  const root = type === 'directory' && (value === '.' || value === './');
  let path = type === 'directory' && value.endsWith('/') && !root ? value.slice(0, -1) : value;
  if (path.startsWith('./')) path = path.slice(2);
  if (root) return '.';
  if (!path || path.startsWith('/') || path.includes('\\') || Buffer.byteLength(path) > maximumPathBytes ||
      path.split('/').some((part) => !part || part === '.' || part === '..') || posix.normalize(path) !== path) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'Archive contains an unsafe path.');
  }
  return path;
}

function verifyHeader(block: Buffer): void {
  if (fieldText(block, 257, 6).trimEnd() !== 'ustar') {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'Archive header is not POSIX/GNU ustar.');
  }
  const stored = octal(block, 148, 8, 'checksum'); let sum = 0n;
  for (let index = 0; index < block.length; index += 1) sum += BigInt(index >= 148 && index < 156 ? 0x20 : block[index]);
  if (sum !== stored) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'Archive header checksum differs.');
}

function parsePax(bytes: Buffer, maximumPathBytes: number): { path?: string; size?: bigint } {
  const values: Record<string, string> = {}; let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space < 0) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'PAX record length is missing.');
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    if (!/^[1-9][0-9]*$/.test(lengthText)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'PAX record length is invalid.');
    const length = Number(lengthText); const end = offset + length;
    if (!Number.isSafeInteger(length) || end > bytes.length || bytes[end - 1] !== 0x0a) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_TRUNCATED', 'PAX record is truncated.');
    const record = bytes.subarray(space + 1, end - 1).toString('utf8'); const equals = record.indexOf('=');
    if (equals < 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'PAX record is malformed.');
    const key = record.slice(0, equals); const value = record.slice(equals + 1);
    if (key.startsWith('GNU.sparse') || key === 'SCHILY.filetype') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_TYPE', 'Sparse PAX records are forbidden.');
    if (key === 'path' || key === 'size') values[key] = value;
    offset = end;
  }
  if (values.path && Buffer.byteLength(values.path) > maximumPathBytes) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'PAX path exceeds the fixed bound.');
  if (values.size && !/^(0|[1-9][0-9]*)$/.test(values.size)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'PAX size is invalid.');
  return { path: values.path, size: values.size === undefined ? undefined : BigInt(values.size) };
}

export async function extractDeterministicTarStream(input: {
  source: AsyncIterable<Uint8Array>; outputRoot: string; maximumBytes: string; maximumEntries: number;
  maximumPathBytes: number; signal?: AbortSignal;
  beforeCleanup?: (outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED') => Promise<void>;
}): Promise<readonly ExtractedDiskFile[]> {
  if (resolve(input.outputRoot) !== input.outputRoot || !Number.isSafeInteger(input.maximumEntries) || input.maximumEntries < 1) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'Streaming extraction contract is invalid.');
  }
  const maximum = canonicalDecimal(input.maximumBytes, 'maximumBytes'); const reader = new BoundedReader(input.source, input.signal);
  await mkdir(input.outputRoot, { recursive: false, mode: 0o700 });
  let outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED' = 'FAILED';
  try {
    const seen = new Set<string>(); const files: ExtractedDiskFile[] = []; let entries = 0; let expanded = 0n;
    let pendingPax: { path?: string; size?: bigint } | null = null; let zeroBlocks = 0;
    while (zeroBlocks < 2) {
    const header = await reader.exact(512);
    if (header.every((byte) => byte === 0)) { zeroBlocks += 1; continue; }
    if (zeroBlocks !== 0) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'Nonzero header followed an archive terminator block.');
    verifyHeader(header); entries += 1;
    if (entries > input.maximumEntries) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_LIMIT', 'Archive entry count exceeds the fixed bound.');
    const typeFlag = String.fromCharCode(header[156] || 0x30); const prefix = fieldText(header, 345, 155); const name = fieldText(header, 0, 100);
    const headerPath = prefix ? `${prefix}/${name}` : name; let size = octal(header, 124, 12, 'size');
    if (typeFlag === 'x') {
      if (size > BigInt(Math.min(1024 * 1024, input.maximumPathBytes * 16))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_LIMIT', 'PAX header exceeds the fixed bound.');
      pendingPax = parsePax(await reader.exact(Number(size)), input.maximumPathBytes);
      const padding = Number((512n - (size % 512n)) % 512n); if (padding) await reader.exact(padding);
      continue;
    }
    if (!['0', '5'].includes(typeFlag)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_TYPE', 'Archive contains a link, device, sparse, or special entry.');
    const type = typeFlag === '5' ? 'directory' : 'file';
    const path = normalizeTarPath(pendingPax?.path ?? headerPath, type, input.maximumPathBytes);
    size = pendingPax?.size ?? size; pendingPax = null;
    if (type === 'directory' && size !== 0n) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_SIZE_MISMATCH', 'Directory entry declares file bytes.');
    if (seen.has(path)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_DUPLICATE', 'Archive contains a duplicate normalized path.');
    seen.add(path); if (path === '.') continue;
    const destination = join(input.outputRoot, path);
    if (!destination.startsWith(`${input.outputRoot}/`)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH', 'Archive path escaped extraction root.');
    if (type === 'directory') { await mkdir(destination, { recursive: true, mode: 0o700 }); continue; }
    expanded += size; if (expanded > maximum) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_LIMIT', 'Archive expanded size exceeds the fixed bound.');
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(destination, 'wx', 0o600); const hash = createHash('sha256'); let remaining = size;
    try {
      while (remaining > 0n) {
        const count = Number(remaining > 64n * 1024n ? 64n * 1024n : remaining); const chunk = await reader.exact(count);
        await handle.write(chunk); hash.update(chunk); remaining -= BigInt(count);
      }
      await handle.sync();
    } finally { await handle.close(); }
    const padding = Number((512n - (size % 512n)) % 512n); if (padding) await reader.exact(padding);
    files.push({ archivePath: path, path: destination, size: size.toString(), sha256: hash.digest('hex') });
    }
    if (pendingPax) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_TRUNCATED', 'Archive ended after an unconsumed PAX header.');
    if (await reader.hasRemainingNonzero()) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_HEADER_INVALID', 'Archive contains nonzero bytes after its terminator.');
    if (files.length === 0) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ARCHIVE_EMPTY', 'Archive contains no files.');
    outcome = 'COMPLETED'; return files.sort((left, right) => Buffer.compare(Buffer.from(left.archivePath), Buffer.from(right.archivePath)));
  } catch (cause) { outcome = input.signal?.aborted ? 'CANCELLED' : 'FAILED'; throw cause; }
  finally { await cleanupBoundedReader(reader, input.beforeCleanup ? () => input.beforeCleanup!(outcome) : undefined); }
}
