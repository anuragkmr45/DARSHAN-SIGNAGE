import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { openRecoveryRepositoryReadonly } from './repository-source';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function repositoryFixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'recovery-source-')); roots.push(root);
  const repositoryId = randomUUID();
  await fs.writeFile(join(root, 'repository.json'), canonicalJson({ format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId }), { mode: 0o600 });
  await fs.mkdir(join(root, 'runs'), { mode: 0o700 });
  const stat = await fs.stat(root, { bigint: true });
  const input = { root, expectedDeviceId: stat.dev.toString(), ownerUid: Number(stat.uid), ownerGid: Number(stat.gid),
    expectedSiteId: 'site-a', expectedRepositoryId: repositoryId };
  return { root, repositoryId, input };
}

describe('read-only recovery repository open', () => {
  it('returns stable mount/owner/mode identity without creating or changing repository entries', async () => {
    const value = await repositoryFixture(); const before = await fs.readdir(value.root);
    const opened = await openRecoveryRepositoryReadonly(value.input);
    expect(opened.descriptor).toMatchObject({ siteId: 'site-a', repositoryId: value.repositoryId, mode: 0o700 });
    expect(await fs.readdir(value.root)).toEqual(before);
  });

  it('fails stably for missing, malformed, changed, symlinked, and hardlinked descriptors', async () => {
    const missing = await repositoryFixture(); await fs.rm(missing.root, { recursive: true });
    await expect(openRecoveryRepositoryReadonly(missing.input)).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_MISSING' });
    const malformed = await repositoryFixture(); await fs.writeFile(join(malformed.root, 'repository.json'), '{', { mode: 0o600 });
    await expect(openRecoveryRepositoryReadonly(malformed.input)).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_UNSAFE' });
    const changed = await repositoryFixture(); await fs.writeFile(join(changed.root, 'repository.json'), canonicalJson({
      format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: randomUUID(),
    }), { mode: 0o600 });
    await expect(openRecoveryRepositoryReadonly(changed.input)).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_IDENTITY_MISMATCH' });
    const symlinked = await repositoryFixture(); await fs.rename(join(symlinked.root, 'repository.json'), join(symlinked.root, 'real.json'));
    await fs.symlink(join(symlinked.root, 'real.json'), join(symlinked.root, 'repository.json'));
    await expect(openRecoveryRepositoryReadonly(symlinked.input)).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_UNSAFE' });
    const hardlinked = await repositoryFixture(); await fs.link(join(hardlinked.root, 'repository.json'), join(hardlinked.root, 'copy.json'));
    await expect(openRecoveryRepositoryReadonly(hardlinked.input)).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_UNSAFE' });
  });

  it('rejects descriptor pathname swaps and growth during the bounded descriptor read', async () => {
    const swapped = await repositoryFixture();
    await expect(openRecoveryRepositoryReadonly({ ...swapped.input, metadataReadHooks: { afterOpen: async (path) => {
      await fs.rename(path, `${path}.opened`);
      await fs.writeFile(path, canonicalJson({ format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: swapped.repositoryId }), { mode: 0o600 });
    } } })).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_UNSAFE' });
    const grown = await repositoryFixture();
    await expect(openRecoveryRepositoryReadonly({ ...grown.input, metadataReadHooks: { afterRead: async (path) => {
      await fs.appendFile(path, ' ');
    } } })).rejects.toMatchObject({ code: 'RECOVERY_REPOSITORY_UNSAFE' });
  });
});
