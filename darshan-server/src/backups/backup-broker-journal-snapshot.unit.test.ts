import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from './backup-broker-protocol';
import { readBackupBrokerJournalSnapshot } from './backup-broker-journal';
import { openLocalRepositoryReadonly } from './local-repository';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
async function fixture(withJournal = true) {
  const root = await fs.mkdtemp(join(tmpdir(), 'journal-snapshot-')); roots.push(root); await fs.chmod(root, 0o700);
  const repositoryId = randomUUID(); await fs.writeFile(join(root, 'repository.json'), canonicalJson({ format: 'darshan-backup-repository-v1',
    site_id: 'site-a', repository_id: repositoryId }), { mode: 0o600 });
  if (withJournal) { await fs.mkdir(join(root, 'broker-journal'), { mode: 0o700 }); await fs.writeFile(join(root, 'broker-journal', 'state.json'),
    canonicalJson({ format: 'darshan-backup-broker-journal-v2', revision: 0, requests: {}, publications: {}, holds: {}, deletions: {},
      tombstones: {}, staging_cleanups: {} }), { mode: 0o600 }); }
  const stat = await fs.stat(root, { bigint: true }); const repository = await openLocalRepositoryReadonly({ root,
    expectedDeviceId: stat.dev.toString(), ownerUid: Number(stat.uid), ownerGid: Number(stat.gid), expectedSiteId: 'site-a', expectedRepositoryId: repositoryId });
  return { root, repository };
}

describe('read-only broker journal snapshot', () => {
  it('does not create a missing journal and returns a stable existing snapshot', async () => {
    const missing = await fixture(false); const before = await fs.readdir(missing.root);
    await expect(readBackupBrokerJournalSnapshot({ repository: missing.repository })).rejects.toMatchObject({ code: 'BROKER_JOURNAL_SNAPSHOT_MISSING' });
    expect(await fs.readdir(missing.root)).toEqual(before);
    const present = await fixture(); expect((await readBackupBrokerJournalSnapshot({ repository: present.repository })).revision).toBe(0);
  });

  it('rejects growth and a journal parent directory rename/replacement', async () => {
    const grown = await fixture(); await expect(readBackupBrokerJournalSnapshot({ repository: grown.repository, hooks: {
      afterRead: async (path) => { await fs.appendFile(path, ' '); },
    } })).rejects.toMatchObject({ code: 'BROKER_JOURNAL_SNAPSHOT_UNSAFE' });
    const swapped = await fixture(); await expect(readBackupBrokerJournalSnapshot({ repository: swapped.repository, hooks: {
      afterRead: async () => { const original = join(swapped.root, 'broker-journal'); await fs.rename(original, `${original}.old`); await fs.mkdir(original, { mode: 0o700 }); },
    } })).rejects.toMatchObject({ code: 'BROKER_JOURNAL_SNAPSHOT_UNSAFE' });
  });
});
