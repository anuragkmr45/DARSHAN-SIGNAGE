import { createHash, randomUUID } from 'node:crypto';
import { chmod, link, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BackupManifestArtifactV1 } from './manifest';
import type { LocalRepository } from './local-repository';
import { openVerifiedCiphertextFile } from './encrypted-download';

const manifestSha256 = 'f'.repeat(64);

describe('encrypted backup download file boundary', () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  async function fixture(bytes = Buffer.from('age-encrypted-fixture')): Promise<{
    path: string; repository: LocalRepository; artifact: BackupManifestArtifactV1;
  }> {
    root = await mkdtemp(join(tmpdir(), 'darshan-encrypted-download-'));
    await chmod(root, 0o700);
    const path = join(root, 'database.dump.age');
    await writeFile(path, bytes, { mode: 0o600 });
    await chmod(path, 0o600);
    const metadata = await stat(root, { bigint: true });
    return {
      path,
      repository: {
        root,
        identity: { format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: randomUUID() },
        deviceId: metadata.dev.toString(), inode: metadata.ino.toString(),
        ownerUid: Number(metadata.uid), ownerGid: Number(metadata.gid), mode: 0o700,
      },
      artifact: {
        kind: 'DATABASE', name: 'database.dump.age', ciphertextPath: 'database.dump.age',
        ciphertextSizeBytes: String(bytes.byteLength), ciphertextSha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
  }

  it('streams only the same verified ciphertext descriptor', async () => {
    const input = await fixture();
    const download = await openVerifiedCiphertextFile({ ...input, filename: 'backup.age', manifestSha256 });
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('age-encrypted-fixture');
    expect(download).toMatchObject({ filename: 'backup.age', artifactKind: 'DATABASE', manifestSha256 });
  });

  it('maps symlink and hard-link replacement to a stable fail-closed error', async () => {
    const symlinkInput = await fixture();
    const target = join(root!, 'target.age');
    await writeFile(target, 'age-encrypted-fixture', { mode: 0o600 });
    await rm(symlinkInput.path);
    await symlink(target, symlinkInput.path);
    await expect(openVerifiedCiphertextFile({ ...symlinkInput, filename: 'backup.age', manifestSha256 }))
      .rejects.toMatchObject({ code: 'BACKUP_DOWNLOAD_SOURCE_CHANGED' });

    await rm(root!, { recursive: true, force: true });
    root = undefined;
    const hardLinkInput = await fixture();
    await link(hardLinkInput.path, join(root!, 'second-link.age'));
    await expect(openVerifiedCiphertextFile({ ...hardLinkInput, filename: 'backup.age', manifestSha256 }))
      .rejects.toMatchObject({ code: 'BACKUP_DOWNLOAD_SOURCE_CHANGED' });
  });

  it('rejects hash mismatch, mutation during verification, and cancellation', async () => {
    const mismatch = await fixture();
    mismatch.artifact.ciphertextSha256 = '0'.repeat(64);
    await expect(openVerifiedCiphertextFile({ ...mismatch, filename: 'backup.age', manifestSha256 }))
      .rejects.toMatchObject({ code: 'BACKUP_DOWNLOAD_SOURCE_CHANGED' });

    await rm(root!, { recursive: true, force: true });
    root = undefined;
    const changed = await fixture();
    await expect(openVerifiedCiphertextFile({ ...changed, filename: 'backup.age', manifestSha256,
      hooks: { afterArtifactOpen: async () => { await writeFile(changed.path, 'age-encrypted-changed', { mode: 0o600 }); } } }))
      .rejects.toMatchObject({ code: 'BACKUP_DOWNLOAD_SOURCE_CHANGED' });

    await rm(root!, { recursive: true, force: true });
    root = undefined;
    const cancelled = await fixture();
    const controller = new AbortController();
    await expect(openVerifiedCiphertextFile({ ...cancelled, filename: 'backup.age', manifestSha256,
      signal: controller.signal, hooks: { afterArtifactOpen: async () => controller.abort() } }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
