import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { config as appConfig } from '@/config';
import { AppError } from '@/utils/app-error';
import { readBackupBrokerJournalSnapshot } from './backup-broker-journal';
import type { BackupArtifactKind, BackupManifestArtifactV1 } from './manifest';
import { openExistingRepositoryDirectory } from './local-repository';
import type { LocalRepository } from './local-repository';
import { loadRecoveryPublicKeyring } from '@/recovery/operator-inputs';
import { openRecoveryRepositoryReadonly, selectTrustedRecoverySource } from '@/recovery/repository-source';

const MAX_DOWNLOAD_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export type EncryptedBackupDownload = {
  stream: Readable;
  filename: string;
  contentLength: string;
  sha256: string;
  artifactKind: BackupArtifactKind;
  manifestSha256: string;
};

function conflict(code: string, message: string): AppError {
  return new AppError({ statusCode: 409, code, message });
}

export async function openVerifiedCiphertextFile(input: {
  repository: LocalRepository;
  path: string;
  artifact: BackupManifestArtifactV1;
  filename: string;
  manifestSha256: string;
  signal?: AbortSignal;
  hooks?: { afterArtifactOpen?(): Promise<void> };
}): Promise<EncryptedBackupDownload> {
  const expectedSize = BigInt(input.artifact.ciphertextSizeBytes);
  if (expectedSize < 1n || expectedSize > MAX_DOWNLOAD_BYTES) {
    throw conflict('BACKUP_DOWNLOAD_ARTIFACT_TOO_LARGE', 'The encrypted artifact exceeds the bounded streaming range.');
  }
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(input.path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  } catch (cause) {
    throw new AppError({ statusCode: 409, code: 'BACKUP_DOWNLOAD_SOURCE_CHANGED',
      message: 'The encrypted artifact could not be opened with its trusted identity.',
      details: { reason: (cause as NodeJS.ErrnoException).code ?? 'OPEN_FAILED' } });
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.dev.toString() !== input.repository.deviceId ||
        Number(before.uid) !== input.repository.ownerUid || Number(before.gid) !== input.repository.ownerGid ||
        Number(before.mode & 0o777n) !== 0o600 || before.size !== expectedSize) {
      throw conflict('BACKUP_DOWNLOAD_SOURCE_CHANGED', 'The encrypted artifact identity changed before streaming.');
    }
    await input.hooks?.afterArtifactOpen?.();
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    for (;;) {
      input.signal?.throwIfAborted();
      const remaining = Number(before.size) + 1 - offset;
      if (remaining <= 0) throw conflict('BACKUP_DOWNLOAD_SOURCE_CHANGED', 'The encrypted artifact grew while verifying.');
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.byteLength, remaining), offset);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
      if (offset > Number(before.size)) throw conflict('BACKUP_DOWNLOAD_SOURCE_CHANGED', 'The encrypted artifact grew while verifying.');
    }
    const after = await handle.stat({ bigint: true });
    const digest = hash.digest('hex');
    if (BigInt(offset) !== before.size || digest !== input.artifact.ciphertextSha256 || after.dev !== before.dev ||
        after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs || after.nlink !== before.nlink || after.mode !== before.mode) {
      throw conflict('BACKUP_DOWNLOAD_SOURCE_CHANGED', 'The encrypted artifact changed during trusted read-back.');
    }
    const stream = handle.createReadStream({ start: 0, autoClose: true });
    if (input.signal) {
      const abort = () => stream.destroy(input.signal?.reason);
      input.signal.addEventListener('abort', abort, { once: true });
      stream.once('close', () => input.signal?.removeEventListener('abort', abort));
    }
    return { stream, filename: input.filename, contentLength: before.size.toString(), sha256: digest,
      artifactKind: input.artifact.kind, manifestSha256: input.manifestSha256 };
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function openEncryptedBackupArtifact(input: {
  runId: string;
  manifestSha256: string;
  artifactKind: Exclude<BackupArtifactKind, 'OTHER'>;
  signal?: AbortSignal;
  hooks?: { afterTrustedSource?(): Promise<void>; afterArtifactOpen?(): Promise<void> };
}): Promise<EncryptedBackupDownload> {
  if (appConfig.BACKUP_REPOSITORY_KIND !== 'LOCAL_FILESYSTEM' || appConfig.BACKUP_LOCAL_PROTOCOL !== 'V2_BROKER') {
    throw conflict('BACKUP_DOWNLOAD_LEGACY_SOURCE_UNSUPPORTED', 'Only trusted local V2 encrypted artifacts can be downloaded.');
  }
  const root = appConfig.BACKUP_REPOSITORY_ROOT;
  const device = appConfig.BACKUP_REPOSITORY_DEVICE_ID;
  const ownerUid = appConfig.BACKUP_REPOSITORY_OWNER_UID;
  const ownerGid = appConfig.BACKUP_REPOSITORY_OWNER_GID;
  const siteId = appConfig.BACKUP_SITE_ID;
  const repositoryId = appConfig.BACKUP_REPOSITORY_ID;
  const manifestKeysPath = appConfig.BACKUP_MANIFEST_PUBLIC_KEYRING_PATH;
  const policyKeysPath = appConfig.BACKUP_POLICY_PUBLIC_KEYRING_PATH ?? manifestKeysPath;
  if (!root || !device || ownerUid === undefined || ownerGid === undefined || !siteId || !repositoryId ||
      !manifestKeysPath || !policyKeysPath) {
    throw conflict('BACKUP_DOWNLOAD_RUNTIME_UNCONFIGURED', 'Encrypted backup download trust is not configured.');
  }
  const [opened, manifestKeys, policyKeys] = await Promise.all([
    openRecoveryRepositoryReadonly({ root, expectedDeviceId: device, ownerUid, ownerGid,
      expectedSiteId: siteId, expectedRepositoryId: repositoryId, signal: input.signal }),
    loadRecoveryPublicKeyring(manifestKeysPath, { signal: input.signal }),
    loadRecoveryPublicKeyring(policyKeysPath, { signal: input.signal }),
  ]);
  const journal = await readBackupBrokerJournalSnapshot({ repository: opened.repository, signal: input.signal });
  const publication = journal.publications[input.runId];
  if (!publication || publication.status !== 'COMMITTED') {
    throw conflict('BACKUP_DOWNLOAD_SOURCE_NOT_VERIFIED', 'The exact durable publication is not available.');
  }
  const source = await selectTrustedRecoverySource({ repository: opened.repository,
    repositoryDescriptor: opened.descriptor, runId: input.runId, manifestSha256: input.manifestSha256,
    publication, policyTrustKeys: policyKeys.keys, manifestVerificationKeys: manifestKeys.keys,
    signal: input.signal });
  await input.hooks?.afterTrustedSource?.();
  const artifacts = source.manifest.artifacts.filter((candidate) => candidate.kind === input.artifactKind);
  if (artifacts.length !== 1) {
    throw conflict('BACKUP_DOWNLOAD_ARTIFACT_UNAVAILABLE', 'The requested encrypted artifact is absent or ambiguous.');
  }
  const artifact = artifacts[0];
  const runs = await openExistingRepositoryDirectory(source.repository, 'runs');
  const path = join(runs, source.descriptor.runId, artifact.ciphertextPath);
  return openVerifiedCiphertextFile({ repository: source.repository, path, artifact,
    filename: `darshan-${source.descriptor.runId}-${input.artifactKind.toLowerCase()}.age`,
    manifestSha256: source.descriptor.manifestSha256, signal: input.signal, hooks: input.hooks });
}
