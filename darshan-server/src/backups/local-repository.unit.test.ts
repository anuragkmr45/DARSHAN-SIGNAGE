import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, chmod, stat, symlink, mkdir, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REPOSITORY_IDENTITY_FORMAT,
  assertLocalBackupRepository,
  assertRepositoryStillMatches,
  createOwnedAttemptDirectory,
  openLocalRepository,
  parseAttemptOwnershipReceipt,
  parseRepositoryIdentity,
  readAttemptOwnership,
} from './local-repository';

async function initializeRepository(root: string, siteId = 'site-a', repositoryId = randomUUID()) {
  await chmod(root, 0o700);
  await writeFile(`${root}/repository.json`, `${JSON.stringify({
    format: REPOSITORY_IDENTITY_FORMAT,
    site_id: siteId,
    repository_id: repositoryId,
  })}\n`, { mode: 0o600 });
  await chmod(`${root}/repository.json`, 0o600);
  const metadata = await stat(root, { bigint: true });
  return { repositoryId, metadata };
}

describe('local backup repository preflight', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('validates device identity, ownership, restrictive permissions, and free space', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-'));
    await chmod(root, 0o700);
    const metadata = await stat(root, { bigint: true });
    const result = await assertLocalBackupRepository({
      root,
      expectedDeviceId: metadata.dev.toString(),
      ownerUid: Number(metadata.uid),
      ownerGid: Number(metadata.gid),
      minimumFreeBytes: 1,
    });
    expect(result.deviceId).toBe(metadata.dev.toString());
  });

  it('fails closed on a changed mount identity', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-'));
    await chmod(root, 0o700);
    const metadata = await stat(root, { bigint: true });
    await expect(assertLocalBackupRepository({
      root,
      expectedDeviceId: (metadata.dev + 1n).toString(),
      ownerUid: Number(metadata.uid),
      ownerGid: Number(metadata.gid),
      minimumFreeBytes: 1,
    })).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_MOUNT_MISMATCH' });
  });

  it('rejects a path that traverses a symlinked parent', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-'));
    const actualParent = join(root, 'actual-parent');
    const actual = join(actualParent, 'repository');
    const linkParent = join(root, 'linked-parent');
    await mkdir(actual, { recursive: true, mode: 0o700 });
    await symlink(actualParent, linkParent);
    const linkedRepository = join(linkParent, 'repository');
    const metadata = await stat(linkedRepository, { bigint: true });
    await expect(assertLocalBackupRepository({
      root: linkedRepository,
      expectedDeviceId: metadata.dev.toString(),
      ownerUid: Number(metadata.uid),
      ownerGid: Number(metadata.gid),
      minimumFreeBytes: 1,
    })).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_SYMLINK' });
  });

  it('emits stable codes for missing, non-directory, owner, mode, and capacity prerequisites', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-'));
    const metadata = await stat(root, { bigint: true });
    const base = {
      expectedDeviceId: metadata.dev.toString(), ownerUid: Number(metadata.uid),
      ownerGid: Number(metadata.gid), minimumFreeBytes: 1,
    };
    await expect(assertLocalBackupRepository({ root: join(root, 'missing'), ...base }))
      .rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_MISSING' });
    const file = join(root, 'file');
    await writeFile(file, 'x');
    await expect(assertLocalBackupRepository({ root: file, ...base }))
      .rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_NOT_DIRECTORY' });
    await expect(assertLocalBackupRepository({ root, ...base, ownerUid: base.ownerUid + 1 }))
      .rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_OWNERSHIP_MISMATCH' });
    await chmod(root, 0o777);
    await expect(assertLocalBackupRepository({ root, ...base }))
      .rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_INSECURE_MODE' });
    await chmod(root, 0o700);
    await expect(assertLocalBackupRepository({ root, ...base, minimumFreeBytes: Number.MAX_SAFE_INTEGER }))
      .rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_CAPACITY' });
  });

  it('strictly parses repository and attempt identity objects', () => {
    const repositoryId = randomUUID();
    expect(parseRepositoryIdentity({ format: REPOSITORY_IDENTITY_FORMAT, site_id: 'site-a', repository_id: repositoryId }))
      .toMatchObject({ site_id: 'site-a', repository_id: repositoryId });
    expect(() => parseRepositoryIdentity({ format: REPOSITORY_IDENTITY_FORMAT, site_id: 'site-a', repository_id: repositoryId, ignored: true }))
      .toThrow(/unknown fields/);
    expect(() => parseRepositoryIdentity({ format: 'future', site_id: 'site-a', repository_id: repositoryId }))
      .toThrow(/unsupported format/);
    expect(() => parseAttemptOwnershipReceipt({ format: 'future' }))
      .toThrow(/unknown fields|unsupported format/);
  });

  it('never initializes a missing marker and rejects wrong or unsafe identity markers', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-'));
    await chmod(root, 0o700);
    const metadata = await stat(root, { bigint: true });
    const base = {
      root,
      expectedDeviceId: metadata.dev.toString(),
      ownerUid: Number(metadata.uid),
      ownerGid: Number(metadata.gid),
      minimumFreeBytes: 1,
      expectedSiteId: 'site-a',
      expectedRepositoryId: randomUUID(),
    };
    await expect(openLocalRepository(base)).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_IDENTITY_MISSING' });
    expect(await stat(root)).toBeTruthy();
    await writeFile(join(root, 'repository.json'), '{}', { mode: 0o600 });
    await expect(openLocalRepository(base)).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_IDENTITY_INVALID' });
    await rm(join(root, 'repository.json'));
    const target = join(root, 'identity-target');
    await writeFile(target, '{}', { mode: 0o600 });
    await symlink(target, join(root, 'repository.json'));
    await expect(openLocalRepository(base)).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_IDENTITY_INVALID' });
  });

  it('opens a marker-bound repository and creates an exclusive receipt-bound attempt', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-'));
    const { repositoryId, metadata } = await initializeRepository(root);
    const repository = await openLocalRepository({
      root,
      expectedDeviceId: metadata.dev.toString(), ownerUid: Number(metadata.uid), ownerGid: Number(metadata.gid),
      minimumFreeBytes: 1, expectedSiteId: 'site-a', expectedRepositoryId: repositoryId,
    });
    const identity = { runId: randomUUID(), attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 7 };
    const owned = await createOwnedAttemptDirectory({ repository, ...identity, ownerNonce: 'a'.repeat(32) });
    expect((await stat(owned.path)).mode & 0o777).toBe(0o700);
    expect((await stat(join(owned.path, 'ownership.json'))).mode & 0o777).toBe(0o600);
    await expect(readAttemptOwnership(repository, owned.path)).resolves.toMatchObject({
      run_id: identity.runId,
      attempt_id: identity.attemptId,
      capture_id: identity.captureId,
      capture_generation: 7,
      repository_id: repositoryId,
    });
    await expect(createOwnedAttemptDirectory({ repository, ...identity, ownerNonce: 'a'.repeat(32) }))
      .rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('detects replacement of the configured root after preflight', async () => {
    root = await mkdtemp(join(tmpdir(), 'darshan-repository-parent-'));
    const repositoryRoot = join(root, 'repository');
    await mkdir(repositoryRoot, { mode: 0o700 });
    const { repositoryId, metadata } = await initializeRepository(repositoryRoot);
    const repository = await openLocalRepository({
      root: repositoryRoot,
      expectedDeviceId: metadata.dev.toString(), ownerUid: Number(metadata.uid), ownerGid: Number(metadata.gid),
      minimumFreeBytes: 1, expectedSiteId: 'site-a', expectedRepositoryId: repositoryId,
    });
    const moved = join(root, 'moved');
    await rename(repositoryRoot, moved);
    await mkdir(repositoryRoot, { mode: 0o700 });
    await writeFile(join(repositoryRoot, 'repository.json'), JSON.stringify({
      format: REPOSITORY_IDENTITY_FORMAT, site_id: 'site-a', repository_id: repositoryId,
    }), { mode: 0o600 });
    await expect(assertRepositoryStillMatches(repository)).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_CHANGED' });
  });
});
