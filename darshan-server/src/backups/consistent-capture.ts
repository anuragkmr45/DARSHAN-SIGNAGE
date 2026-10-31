import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { MaintenanceCoordinator } from '../maintenance/coordinator';
import type { CaptureIdentity } from '../maintenance/store';
import { MaintenanceCoordinatorError } from '../maintenance/errors';

const DEFAULT_DRAIN_POLL_MS = 100;

export interface ConsistentCaptureCoordinator {
  beginCapture(input: {
    siteKey: string;
    backupRunId: string;
    backupAttemptId: string;
    owner: string;
  }): Promise<CaptureIdentity>;
  enterCopying(identity: CaptureIdentity): Promise<unknown>;
  seal(identity: CaptureIdentity, stagingInventoryDigest: string): Promise<unknown>;
  abort(identity: CaptureIdentity): Promise<unknown>;
}

export interface ConsistentCaptureResult {
  identity: CaptureIdentity;
  stagingInventoryDigest: string;
  stagingRoot: string;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise<void>((resolveWait, rejectWait) => {
    const settle = (error?: Error) => {
      signal.removeEventListener('abort', abort);
      if (error) rejectWait(error);
      else resolveWait();
    };
    const timer = setTimeout(() => settle(), delayMs);
    timer.unref();
    const abort = () => {
      clearTimeout(timer);
      settle(signal.reason instanceof Error ? signal.reason : new Error('Capture was aborted.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  }).finally(() => signal.throwIfAborted());
}

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Backup staging must not contain symbolic links: ${relative(root, path)}`);
    }
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Backup staging contains an unsupported file type: ${relative(root, path)}`);
  }
  return files;
}

/**
 * Hashes the staged inventory, including relative paths, sizes and file bytes.
 * The digest is deterministic across directory enumeration order and cannot be
 * confused by path/size boundary concatenation.
 */
export async function createStagingInventoryDigest(root: string, signal: AbortSignal): Promise<string> {
  const absoluteRoot = resolve(root);
  const digest = createHash('sha256');
  for (const path of await listFiles(absoluteRoot)) {
    signal.throwIfAborted();
    const name = relative(absoluteRoot, path).split(sep).join('/');
    const stat = await fs.lstat(path);
    digest.update(`${Buffer.byteLength(name)}:${name}:${stat.size}:`);
    const stream = createReadStream(path);
    const abort = () => stream.destroy(signal.reason instanceof Error ? signal.reason : new Error('Capture was aborted.'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      for await (const chunk of stream) {
        signal.throwIfAborted();
        digest.update(chunk);
      }
    } finally {
      signal.removeEventListener('abort', abort);
    }
    digest.update(';');
  }
  return digest.digest('hex');
}

/**
 * Owns the five-minute mutation barrier only through raw database/object copy.
 * Packaging, encryption and repository publication deliberately happen after
 * this function seals and reopens admission.
 */
export async function runConsistentCapture(input: {
  coordinator: ConsistentCaptureCoordinator | MaintenanceCoordinator;
  siteKey: string;
  backupRunId: string;
  backupAttemptId: string;
  stagingRoot: string | ((identity: CaptureIdentity) => Promise<string>);
  signal: AbortSignal;
  copyIntoStaging(identity: CaptureIdentity, stagingRoot: string): Promise<void>;
  owner?: string;
  drainPollMs?: number;
}): Promise<ConsistentCaptureResult> {
  const pollMs = input.drainPollMs ?? DEFAULT_DRAIN_POLL_MS;
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1_000) {
    throw new RangeError('Capture drain poll interval must be 1 through 1000 milliseconds.');
  }
  input.signal.throwIfAborted();
  const identity = await input.coordinator.beginCapture({
    siteKey: input.siteKey,
    backupRunId: input.backupRunId,
    backupAttemptId: input.backupAttemptId,
    owner: input.owner ?? randomUUID(),
  });
  let sealed = false;
  try {
    const stagingRoot = typeof input.stagingRoot === 'string'
      ? input.stagingRoot
      : await input.stagingRoot(identity);
    await fs.chmod(stagingRoot, 0o700);
    for (;;) {
      input.signal.throwIfAborted();
      try {
        await input.coordinator.enterCopying(identity);
        break;
      } catch (error) {
        if (!(error instanceof MaintenanceCoordinatorError) || error.code !== 'MAINTENANCE_CAPTURE_NOT_DRAINED') {
          throw error;
        }
        await waitForRetry(pollMs, input.signal);
      }
    }

    await input.copyIntoStaging(identity, stagingRoot);
    input.signal.throwIfAborted();
    const stagingInventoryDigest = await createStagingInventoryDigest(stagingRoot, input.signal);
    await input.coordinator.seal(identity, stagingInventoryDigest);
    sealed = true;
    return { identity, stagingInventoryDigest, stagingRoot };
  } catch (error) {
    if (!sealed) {
      // Preemption, expiry, or a concurrent watchdog may already own the
      // terminal transition. Never mask the original failure with that fence.
      await input.coordinator.abort(identity).catch(() => undefined);
    }
    throw error;
  }
}
