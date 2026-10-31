import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { ControlledRecoveryError, canonicalDecimal, digest } from './contracts';
import { openBoundedArtifactStream, type DiskBackedObject, type StreamingObjectStoreAdapter } from './streaming-artifacts';

async function hashStream(stream: Readable, maximum: bigint, signal?: AbortSignal): Promise<{ bytes: bigint; sha256: string }> {
  const hash = createHash('sha256'); let bytes = 0n; let completed = false;
  try {
    for await (const chunk of stream) { signal?.throwIfAborted(); const value = Buffer.from(chunk); bytes += BigInt(value.byteLength);
      if (bytes > maximum) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_LIMIT', 'Object stream exceeded its declared bound.'); hash.update(value); }
    completed = true; return { bytes, sha256: hash.digest('hex') };
  } finally { if (!completed && !stream.destroyed) stream.destroy(); }
}

function validKey(key: string): boolean { return !!key && !key.startsWith('/') && !key.includes('\\') && key.split('/').every((part) => part && part !== '.' && part !== '..'); }

export async function restoreDiskBackedObjects(input: { adapter: StreamingObjectStoreAdapter; expected: readonly DiskBackedObject[]; batchSize: number;
  maximumObjectBytes: string; signal?: AbortSignal; afterBatch?: (completed: number, aggregateSha256: string) => Promise<void> }): Promise<{ count: string; bytes: string; aggregateSha256: string }> {
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 1000) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_BATCH_INVALID', 'Object batch size is invalid.');
  const keys = new Set<string>(); const maximum = canonicalDecimal(input.maximumObjectBytes, 'maximumObjectBytes');
  for (const object of input.expected) if (!validKey(object.key) || keys.has(object.key) || canonicalDecimal(object.artifact.size, 'object size') > maximum || !/^[a-f0-9]{64}$/.test(object.artifact.sha256))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_INVENTORY_INVALID', 'Disk object inventory is invalid.'); else keys.add(object.key);
  const ordered = [...input.expected].sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  const matches = async (object: DiskBackedObject): Promise<boolean> => { const found = await input.adapter.getStream({ key: object.key, maximumBytes: object.artifact.size, signal: input.signal });
    if (!found) return false; if (found.size !== object.artifact.size) { found.stream.destroy(); return false; } const actual = await hashStream(found.stream, canonicalDecimal(object.artifact.size, 'object size'), input.signal);
    const matched = actual.bytes.toString() === object.artifact.size && actual.sha256 === object.artifact.sha256;
    if (!matched && !found.stream.destroyed) found.stream.destroy(); return matched; };
  for (let offset = 0; offset < ordered.length; offset += input.batchSize) {
    const batch = ordered.slice(offset, offset + input.batchSize);
    for (const object of batch) if (!await matches(object)) { const stream = await openBoundedArtifactStream({ descriptor: object.artifact, maximumBytes: input.maximumObjectBytes });
      await input.adapter.putStream({ key: object.key, size: object.artifact.size, sha256: object.artifact.sha256, stream, signal: input.signal });
      if (!await matches(object)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_WRITE_CORRUPT', 'Object readback differs after streaming PUT.'); }
    await input.afterBatch?.(Math.min(offset + batch.length, ordered.length), digest(ordered.slice(0, offset + batch.length).map(({ key, artifact }) => ({ key, size: artifact.size, sha256: artifact.sha256 }))));
  }
  const actual = [...await input.adapter.listAll(input.signal)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  if (JSON.stringify(actual) !== JSON.stringify(ordered.map(({ key }) => key))) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_SET_MISMATCH', 'Final object enumeration differs.');
  for (const object of ordered) if (!await matches(object)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_FINAL_CORRUPT', 'Final object GET/hash/size verification failed.');
  const bytes = ordered.reduce((sum, item) => sum + canonicalDecimal(item.artifact.size, 'object size'), 0n);
  return { count: ordered.length.toString(), bytes: bytes.toString(), aggregateSha256: digest(ordered.map(({ key, artifact }) => ({ key, size: artifact.size, sha256: artifact.sha256 }))) };
}
