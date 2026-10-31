import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import {
  type AttemptOwnershipReceipt,
  type LocalRepository,
  RepositorySafetyError,
  assertRepositoryStillMatches,
  ensureRepositoryDirectory,
  fsyncDirectory,
} from './local-repository';
import { discoverRepository, type RepositoryDiscoveryEntry } from './repository-discovery';
import {
  type PublicationIntent,
  type PublicationReceipt,
  completePublishedRunReceipt,
} from './repository-publication';

export interface IncompleteReconciliationResult {
  preserved: string[];
  deleted: string[];
  quarantined: string[];
}

export interface PublishedReconciliationResult {
  adopted: string[];
  settled: string[];
  preserved: string[];
  quarantined: string[];
  corrupt: string[];
}

export type PublishedReconciliationDecision = 'adopt' | 'settle' | 'preserve' | 'quarantine';

async function quarantineEntry(repository: LocalRepository, source: string, reason: string): Promise<string> {
  const quarantine = await ensureRepositoryDirectory(repository, 'quarantine');
  const safeName = basename(source).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'unknown';
  const destination = join(quarantine, `${safeName}.${Date.now()}.${randomBytes(8).toString('hex')}`);
  try { await fs.rename(source, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
      throw new RepositorySafetyError('BACKUP_REPOSITORY_CROSS_DEVICE', 'Quarantine cannot cross filesystems.', { cause: error });
    }
    throw error;
  }
  await fs.writeFile(join(quarantine, `${basename(destination)}.reason.txt`), `${reason}\n`, { flag: 'wx', mode: 0o600 });
  await fsyncDirectory(quarantine);
  return destination;
}

async function assertDeletableOwnedTree(repository: LocalRepository, path: string): Promise<void> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || stat.dev.toString() !== repository.deviceId) {
    throw new RepositorySafetyError('BACKUP_RECONCILIATION_UNSAFE_TREE', `${path} is a symlink or cross-device entry.`);
  }
  if (Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid) {
    throw new RepositorySafetyError('BACKUP_RECONCILIATION_UNSAFE_TREE', `${path} is not owned by the repository owner.`);
  }
  if (stat.isDirectory()) {
    if (Number(stat.mode & 0o777n) !== 0o700) throw new RepositorySafetyError('BACKUP_RECONCILIATION_UNSAFE_TREE', `${path} directory mode is not 0700.`);
    for (const name of await fs.readdir(path)) await assertDeletableOwnedTree(repository, join(path, name));
    return;
  }
  if (!stat.isFile() || Number(stat.mode & 0o777n) !== 0o600) {
    throw new RepositorySafetyError('BACKUP_RECONCILIATION_UNSAFE_TREE', `${path} is special or its file mode is not 0600.`);
  }
}

/**
 * Cleanup needs all three facts: a valid ownership receipt, receipt expiry, and
 * affirmative external authority. Age alone never grants deletion authority.
 */
export async function reconcileIncompleteAttempts(input: {
  repository: LocalRepository;
  now?: Date;
  expireAfterMs: number;
  authorizeCleanup(receipt: AttemptOwnershipReceipt): Promise<boolean>;
}): Promise<IncompleteReconciliationResult> {
  if (!Number.isSafeInteger(input.expireAfterMs) || input.expireAfterMs < 1) throw new RangeError('expireAfterMs must be a positive safe integer.');
  await assertRepositoryStillMatches(input.repository);
  const discovery = await discoverRepository(input.repository);
  const result: IncompleteReconciliationResult = { preserved: [], deleted: [], quarantined: [] };
  const nowMs = (input.now ?? new Date()).getTime();
  for (const entry of discovery.entries.filter((candidate) => candidate.area === 'incomplete')) {
    if (entry.classification !== 'incomplete' || !entry.ownership) {
      const destination = await quarantineEntry(input.repository, entry.path, entry.reason ?? 'Unknown or invalid incomplete entry.');
      result.quarantined.push(destination);
      continue;
    }
    const age = nowMs - Date.parse(entry.ownership.created_at);
    if (age < input.expireAfterMs || !await input.authorizeCleanup(entry.ownership)) {
      result.preserved.push(entry.path);
      continue;
    }
    try {
      await assertDeletableOwnedTree(input.repository, entry.path);
    } catch (error) {
      const destination = await quarantineEntry(input.repository, entry.path, error instanceof Error ? error.message : String(error));
      result.quarantined.push(destination);
      continue;
    }
    await fs.rm(entry.path, { recursive: true, force: false });
    await fsyncDirectory(join(input.repository.root, 'incomplete'));
    result.deleted.push(entry.path);
  }
  return result;
}

function entryIntent(entry: RepositoryDiscoveryEntry): PublicationIntent {
  if (!entry.intent) throw new RepositorySafetyError('BACKUP_PUBLICATION_PROTOCOL_INVALID', 'Discovered publication has no intent.');
  return entry.intent;
}

/**
 * Database/lease policy is injected so this module remains usable without SQL.
 * A caller should run it under the same execution lock used by attempt expiry.
 */
export async function reconcilePublishedRuns(input: {
  repository: LocalRepository;
  decide(entry: RepositoryDiscoveryEntry): Promise<PublishedReconciliationDecision>;
  recordReceipt?(receipt: PublicationReceipt): Promise<void>;
}): Promise<PublishedReconciliationResult> {
  await assertRepositoryStillMatches(input.repository);
  const discovery = await discoverRepository(input.repository);
  const result: PublishedReconciliationResult = {
    adopted: [], settled: [], preserved: [], quarantined: [], corrupt: [],
  };
  for (const entry of discovery.entries.filter((candidate) => candidate.area === 'runs')) {
    if (entry.classification === 'corrupt' || entry.classification === 'unsupported') {
      result.corrupt.push(entry.path);
      const decision = await input.decide(entry);
      if (decision === 'quarantine') {
        const destination = await quarantineEntry(input.repository, entry.path, entry.reason ?? entry.classification);
        result.quarantined.push(destination);
      } else result.preserved.push(entry.path);
      continue;
    }
    const decision = await input.decide(entry);
    if (decision === 'quarantine') {
      const destination = await quarantineEntry(input.repository, entry.path, 'Publication authority rejected or superseded this run.');
      result.quarantined.push(destination);
      continue;
    }
    if (decision === 'preserve') {
      result.preserved.push(entry.path);
      continue;
    }
    if (entry.classification === 'incomplete') {
      if (decision !== 'adopt') {
        result.preserved.push(entry.path);
        continue;
      }
      const intent = entryIntent(entry);
      const completed = await completePublishedRunReceipt({
        repository: input.repository,
        runId: intent.run_id,
        recordReceipt: input.recordReceipt,
      });
      if (!completed.receipt) throw new RepositorySafetyError('BACKUP_PUBLICATION_RECEIPT_MISSING', 'Reconciliation did not create a publication receipt.');
      result.adopted.push(entry.path);
      continue;
    }
    if (decision === 'settle' || decision === 'adopt') {
      if (!entry.receipt) throw new RepositorySafetyError('BACKUP_PUBLICATION_RECEIPT_MISSING', 'Complete publication has no receipt.');
      await input.recordReceipt?.(entry.receipt);
      result.settled.push(entry.path);
    } else result.preserved.push(entry.path);
  }
  return result;
}
