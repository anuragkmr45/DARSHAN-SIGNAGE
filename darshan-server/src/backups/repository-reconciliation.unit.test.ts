import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REPOSITORY_IDENTITY_FORMAT,
  createOwnedAttemptDirectory,
  openLocalRepository,
  type LocalRepository,
} from './local-repository';
import { reconcileIncompleteAttempts } from './repository-reconciliation';

async function fixture(): Promise<{ root: string; repository: LocalRepository }> {
  const root = await mkdtemp(join(tmpdir(), 'darshan-reconcile-'));
  await chmod(root, 0o700);
  const repositoryId = randomUUID();
  await writeFile(join(root, 'repository.json'), JSON.stringify({
    format: REPOSITORY_IDENTITY_FORMAT, site_id: 'site-a', repository_id: repositoryId,
  }), { mode: 0o600 });
  await chmod(join(root, 'repository.json'), 0o600);
  const metadata = await stat(root, { bigint: true });
  const repository = await openLocalRepository({
    root, expectedDeviceId: metadata.dev.toString(), ownerUid: Number(metadata.uid), ownerGid: Number(metadata.gid),
    minimumFreeBytes: 1, expectedSiteId: 'site-a', expectedRepositoryId: repositoryId,
  });
  return { root, repository };
}

describe('incomplete repository reconciliation', () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('deletes only an expired, positively owned attempt with affirmative authority', async () => {
    const item = await fixture(); roots.push(item.root);
    const attempt = await createOwnedAttemptDirectory({
      repository: item.repository, runId: randomUUID(), attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await mkdir(join(attempt.path, 'raw'), { mode: 0o700 });
    await writeFile(join(attempt.path, 'raw', 'capture.bin'), 'raw', { mode: 0o600 });
    const denied = await reconcileIncompleteAttempts({
      repository: item.repository, now: new Date('2026-02-01T00:00:00.000Z'), expireAfterMs: 1,
      authorizeCleanup: async () => false,
    });
    expect(denied.preserved).toEqual([attempt.path]);
    const allowed = await reconcileIncompleteAttempts({
      repository: item.repository, now: new Date('2026-02-01T00:00:00.000Z'), expireAfterMs: 1,
      authorizeCleanup: async (receipt) => receipt.attempt_id === attempt.receipt.attempt_id,
    });
    expect(allowed.deleted).toEqual([attempt.path]);
  });

  it('quarantines unknown entries and never age-deletes them', async () => {
    const item = await fixture(); roots.push(item.root);
    const incomplete = join(item.root, 'incomplete');
    await mkdir(incomplete, { mode: 0o700 });
    const unknown = join(incomplete, 'unknown-old-directory');
    await mkdir(unknown, { mode: 0o700 });
    await writeFile(join(unknown, 'untrusted'), 'evidence', { mode: 0o600 });
    const result = await reconcileIncompleteAttempts({
      repository: item.repository, now: new Date('2099-01-01T00:00:00.000Z'), expireAfterMs: 1,
      authorizeCleanup: async () => true,
    });
    expect(result.deleted).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
    expect(await stat(result.quarantined[0])).toBeTruthy();
  });

  it('quarantines an owned but unsafe tree instead of following or deleting a symlink', async () => {
    const item = await fixture(); roots.push(item.root);
    const attempt = await createOwnedAttemptDirectory({
      repository: item.repository, runId: randomUUID(), attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const protectedFile = join(item.root, 'protected');
    await writeFile(protectedFile, 'must survive', { mode: 0o600 });
    await symlink(protectedFile, join(attempt.path, 'unsafe-link'));
    const result = await reconcileIncompleteAttempts({
      repository: item.repository, now: new Date('2026-02-01T00:00:00.000Z'), expireAfterMs: 1,
      authorizeCleanup: async () => true,
    });
    expect(result.deleted).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
    expect(await stat(protectedFile)).toBeTruthy();
  });
});
