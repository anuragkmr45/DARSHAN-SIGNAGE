import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  ATTEMPT_OWNERSHIP_FILE,
  ATTEMPT_OWNERSHIP_FORMAT,
  type AttemptOwnershipReceipt,
  type LocalRepository,
  RepositorySafetyError,
  assertRepositoryStillMatches,
  parseAttemptOwnershipReceipt,
} from './local-repository';
import {
  PUBLICATION_INTENT_FILE,
  PUBLICATION_INTENT_FORMAT,
  type PublicationIntent,
  type PublicationReceipt,
  readAndVerifyPublishedRun,
} from './repository-publication';

export type RepositoryEntryClassification = 'complete' | 'incomplete' | 'corrupt' | 'unsupported';
export type RepositoryEntryArea = 'runs' | 'incomplete' | 'quarantine';

export interface RepositoryDiscoveryEntry {
  area: RepositoryEntryArea;
  name: string;
  path: string;
  classification: RepositoryEntryClassification;
  reason?: string;
  intent?: PublicationIntent;
  receipt?: PublicationReceipt | null;
  ownership?: AttemptOwnershipReceipt;
}

export interface RepositoryDiscoveryResult {
  repositoryId: string;
  siteId: string;
  entries: RepositoryDiscoveryEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  const bytes = await fs.readFile(path);
  if (bytes.length === 0 || bytes.length > 1024 * 1024) throw new RepositorySafetyError('BACKUP_DISCOVERY_INVALID', `${path} has invalid length.`);
  try { return JSON.parse(bytes.toString('utf8')) as unknown; }
  catch (error) { throw new RepositorySafetyError('BACKUP_DISCOVERY_INVALID', `${path} is not valid JSON.`, { cause: error }); }
}

async function listArea(repository: LocalRepository, area: RepositoryEntryArea): Promise<Array<{ name: string; path: string }>> {
  const path = join(repository.root, area);
  let stat;
  try { stat = await fs.lstat(path, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId) {
    throw new RepositorySafetyError('BACKUP_REPOSITORY_DIRECTORY_UNSAFE', `${area} is not a safe repository directory.`);
  }
  return (await fs.readdir(path)).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
    .map((name) => ({ name, path: join(path, name) }));
}

async function classifyRun(repository: LocalRepository, entry: { name: string; path: string }): Promise<RepositoryDiscoveryEntry> {
  try {
    const stat = await fs.lstat(entry.path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId) {
      return { area: 'runs', ...entry, classification: 'corrupt', reason: 'Run entry is a symlink, special file, or cross-device directory.' };
    }
    let rawIntent: unknown;
    try { rawIntent = await readJson(join(entry.path, PUBLICATION_INTENT_FILE)); }
    catch (error) {
      return { area: 'runs', ...entry, classification: 'corrupt', reason: error instanceof Error ? error.message : String(error) };
    }
    if (isPlainObject(rawIntent) && typeof rawIntent.format === 'string' && rawIntent.format !== PUBLICATION_INTENT_FORMAT) {
      return { area: 'runs', ...entry, classification: 'unsupported', reason: `Unsupported publication format ${rawIntent.format}.` };
    }
    const verified = await readAndVerifyPublishedRun({ repository, runId: entry.name, requireReceipt: false });
    return {
      area: 'runs',
      ...entry,
      classification: verified.receipt ? 'complete' : 'incomplete',
      reason: verified.receipt ? undefined : 'Filesystem publication is durable but its verification receipt is absent.',
      intent: verified.intent,
      receipt: verified.receipt,
    };
  } catch (error) {
    return { area: 'runs', ...entry, classification: 'corrupt', reason: error instanceof Error ? error.message : String(error) };
  }
}

async function classifyAttempt(repository: LocalRepository, entry: { name: string; path: string }): Promise<RepositoryDiscoveryEntry> {
  try {
    const stat = await fs.lstat(entry.path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId) {
      return { area: 'incomplete', ...entry, classification: 'corrupt', reason: 'Attempt entry is a symlink, special file, or cross-device directory.' };
    }
    const raw = await readJson(join(entry.path, ATTEMPT_OWNERSHIP_FILE));
    if (isPlainObject(raw) && typeof raw.format === 'string' && raw.format !== ATTEMPT_OWNERSHIP_FORMAT) {
      return { area: 'incomplete', ...entry, classification: 'unsupported', reason: `Unsupported ownership format ${raw.format}.` };
    }
    const ownership = parseAttemptOwnershipReceipt(raw);
    const expected = `${ownership.run_id}.${ownership.attempt_id}.${ownership.owner_nonce}`;
    if (entry.name !== expected || ownership.repository_id !== repository.identity.repository_id || ownership.site_id !== repository.identity.site_id) {
      return { area: 'incomplete', ...entry, classification: 'corrupt', reason: 'Attempt ownership is not bound to this repository/site/path.' };
    }
    return { area: 'incomplete', ...entry, classification: 'incomplete', ownership };
  } catch (error) {
    return { area: 'incomplete', ...entry, classification: 'corrupt', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Offline discovery imports no database, object-store, or application config.
 * It reports evidence; it never silently repairs or deletes it.
 */
export async function discoverRepository(repository: LocalRepository): Promise<RepositoryDiscoveryResult> {
  await assertRepositoryStillMatches(repository);
  const [runs, incomplete, quarantine] = await Promise.all([
    listArea(repository, 'runs'),
    listArea(repository, 'incomplete'),
    listArea(repository, 'quarantine'),
  ]);
  const entries: RepositoryDiscoveryEntry[] = [];
  for (const entry of runs) entries.push(await classifyRun(repository, entry));
  for (const entry of incomplete) entries.push(await classifyAttempt(repository, entry));
  for (const entry of quarantine) {
    entries.push({ area: 'quarantine', ...entry, classification: 'corrupt', reason: 'Entry is quarantined evidence and is never age-deleted.' });
  }
  return { repositoryId: repository.identity.repository_id, siteId: repository.identity.site_id, entries };
}
