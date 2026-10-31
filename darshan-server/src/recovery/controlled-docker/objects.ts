import { ControlledRecoveryError, canonicalDecimal, digest, sha256 } from './contracts';

export interface ExpectedObject { key: string; size: string; sha256: string; bytes: Uint8Array }
export interface ObjectStoreAdapter {
  put(input: { key: string; bytes: Uint8Array; signal?: AbortSignal }): Promise<void>;
  get(input: { key: string; signal?: AbortSignal }): Promise<Uint8Array | null>;
  listAll(signal?: AbortSignal): Promise<readonly string[]>;
}

function assertExpected(objects: readonly ExpectedObject[]): void {
  const keys = new Set<string>();
  for (const object of objects) {
    if (!object.key || object.key.startsWith('/') || object.key.includes('\\') || object.key.split('/').some((part) => !part || part === '.' || part === '..') ||
        keys.has(object.key) || canonicalDecimal(object.size, 'object size') !== BigInt(object.bytes.byteLength) || sha256(object.bytes) !== object.sha256) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_INVENTORY_INVALID', 'Expected object inventory is invalid.');
    }
    keys.add(object.key);
  }
}

async function matches(adapter: ObjectStoreAdapter, object: ExpectedObject, signal?: AbortSignal): Promise<boolean> {
  const bytes = await adapter.get({ key: object.key, signal });
  return bytes !== null && bytes.byteLength.toString() === object.size && sha256(bytes) === object.sha256;
}

export async function restoreObjects(input: {
  adapter: ObjectStoreAdapter; expected: readonly ExpectedObject[]; batchSize: number; signal?: AbortSignal;
  afterBatch?: (completed: number, aggregateSha256: string) => Promise<void>;
}): Promise<{ count: string; bytes: string; aggregateSha256: string }> {
  assertExpected(input.expected);
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 1000) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_BATCH_INVALID', 'Object batch size is invalid.');
  }
  const ordered = [...input.expected].sort((left, right) => Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)));
  for (let index = 0; index < ordered.length; index += input.batchSize) {
    input.signal?.throwIfAborted();
    const batch = ordered.slice(index, index + input.batchSize);
    for (const object of batch) {
      // Resume never trusts HEAD or ETag: GET and hash bytes before every skip.
      if (!await matches(input.adapter, object, input.signal)) {
        await input.adapter.put({ key: object.key, bytes: object.bytes, signal: input.signal });
        if (!await matches(input.adapter, object, input.signal)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_WRITE_CORRUPT', 'Restored object GET bytes differ after write.');
      }
    }
    await input.afterBatch?.(Math.min(index + batch.length, ordered.length), digest(ordered.slice(0, index + batch.length).map(({ key, size, sha256 }) => ({ key, size, sha256 }))));
  }
  const actualKeys = [...await input.adapter.listAll(input.signal)].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (JSON.stringify(actualKeys) !== JSON.stringify(ordered.map((object) => object.key))) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_SET_MISMATCH', 'Final object enumeration has missing or unexpected keys.');
  }
  let bytes = 0n;
  for (const object of ordered) {
    const actual = await input.adapter.get({ key: object.key, signal: input.signal });
    if (!actual || actual.byteLength.toString() !== object.size || sha256(actual) !== object.sha256) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_OBJECT_FINAL_CORRUPT', 'Final full GET validation found corrupt object bytes.');
    }
    bytes += BigInt(actual.byteLength);
  }
  return { count: ordered.length.toString(), bytes: bytes.toString(), aggregateSha256: digest(ordered.map(({ key, size, sha256 }) => ({ key, size, sha256 }))) };
}

