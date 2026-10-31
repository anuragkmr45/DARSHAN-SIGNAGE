import { createHash } from 'node:crypto';
import type { BrokerPublicationRecord } from '../backups/backup-broker-journal';
import type { SignedConfigurationCapsulePolicy } from '../backups/configuration-capsule-policy';
import {
  openLocalRepositoryReadonly,
  type ProtectedMetadataReadHooks,
  type LocalRepository,
} from '../backups/local-repository';
import { parseBackupManifest, type BackupManifestV1 } from '../backups/manifest';
import { RepositoryRetentionAdapter } from '../backups/repository-retention-adapter';
import {
  canonicalRecoveryBytes,
  recoveryDigest,
  recoverySourceDescriptorV2Digest,
  recoveryUuid,
  sha256RecoveryBytes,
  type RecoverySourceDescriptorV2,
} from './contracts';
import { RecoveryError } from './errors';

export interface ReadonlyRecoveryRepositoryDescriptor {
  siteId: string;
  repositoryId: string;
  deviceId: string;
  inode: string;
  ownerUid: number;
  ownerGid: number;
  mode: number;
  descriptorSha256: string;
}

export async function openRecoveryRepositoryReadonly(input: {
  root: string; expectedDeviceId: string; ownerUid: number; ownerGid: number;
  expectedSiteId: string; expectedRepositoryId: string;
  metadataReadHooks?: ProtectedMetadataReadHooks;
  signal?: AbortSignal;
}): Promise<{ repository: LocalRepository; descriptor: ReadonlyRecoveryRepositoryDescriptor }> {
  try {
    input.signal?.throwIfAborted();
    const repository = await openLocalRepositoryReadonly(input);
    const identity = {
      siteId: repository.identity.site_id, repositoryId: repository.identity.repository_id,
      deviceId: repository.deviceId, inode: repository.inode, ownerUid: repository.ownerUid,
      ownerGid: repository.ownerGid, mode: repository.mode,
    };
    return { repository, descriptor: { ...identity, descriptorSha256: sha256RecoveryBytes(canonicalRecoveryBytes(identity)) } };
  } catch (cause) {
    if (cause instanceof RecoveryError && cause.code === 'RECOVERY_CANCELLED') throw cause;
    const code = (cause as { code?: string }).code;
    if (code === 'ENOENT' || code === 'BACKUP_REPOSITORY_MISSING') {
      throw new RecoveryError('RECOVERY_REPOSITORY_MISSING', 'Recovery repository is missing.', { cause });
    }
    if (code === 'BACKUP_REPOSITORY_IDENTITY_MISMATCH') {
      throw new RecoveryError('RECOVERY_REPOSITORY_IDENTITY_MISMATCH', 'Recovery repository identity differs.', { cause });
    }
    throw new RecoveryError('RECOVERY_REPOSITORY_UNSAFE', 'Recovery repository failed read-only safety checks.', { cause });
  }
}

export interface TrustedRecoverySource {
  repository: LocalRepository;
  repositoryDescriptor: ReadonlyRecoveryRepositoryDescriptor;
  publication: BrokerPublicationRecord;
  manifest: BackupManifestV1;
  policy: SignedConfigurationCapsulePolicy;
  descriptor: RecoverySourceDescriptorV2;
}

/** Exact read-only selection; there is intentionally no latest/fallback/repair path. */
export async function selectTrustedRecoverySource(input: {
  repository: LocalRepository;
  repositoryDescriptor: ReadonlyRecoveryRepositoryDescriptor;
  runId: string;
  manifestSha256: string;
  publication: BrokerPublicationRecord;
  policyTrustKeys: ReadonlyMap<string, string>;
  manifestVerificationKeys: ReadonlyMap<string, string>;
  signal?: AbortSignal;
}): Promise<TrustedRecoverySource> {
  const runId = recoveryUuid(input.runId, 'runId');
  const manifestSha256 = recoveryDigest(input.manifestSha256, 'manifestSha256');
  if (input.publication.run_id !== runId || input.publication.signed_manifest_sha256 !== manifestSha256 ||
      input.publication.repository_id !== input.repository.identity.repository_id ||
      input.publication.site_id !== input.repository.identity.site_id) {
    throw new RecoveryError('RECOVERY_SOURCE_IDENTITY_MISMATCH', 'Requested run/digest does not match durable publication evidence.');
  }
  const adapter = new RepositoryRetentionAdapter({
    repository: input.repository, policyTrustKeys: input.policyTrustKeys,
    manifestVerificationKeys: input.manifestVerificationKeys,
    assertAuthority: async () => { throw new RecoveryError('RECOVERY_REPOSITORY_UNSAFE', 'Read-only recovery verification cannot acquire mutation authority.'); },
  });
  try {
    const trusted = await adapter.resolvePublishedTrust(input.publication, input.signal ?? new AbortController().signal);
    if (!trusted.published.receipt || trusted.published.intent.run_id !== runId ||
        trusted.published.intent.manifest_sha256 !== manifestSha256 ||
        createHash('sha256').update(trusted.published.manifestBytes).digest('hex') !== manifestSha256) {
      throw new RecoveryError('RECOVERY_SOURCE_CHANGED', 'Published source no longer matches exact run/digest selection.');
    }
    const manifest = parseBackupManifest(trusted.published.manifestBytes);
    const identity = {
      kind: 'LOCAL_FILESYSTEM_V2' as const,
      siteId: manifest.site.id, repositoryId: manifest.repository.id, runId: manifest.run.id,
      attemptId: manifest.run.attemptId, captureId: manifest.capture.id,
      captureGeneration: Number(manifest.capture.generation),
      manifestSha256, releaseId: manifest.release.id, schemaMigrationId: manifest.schema.migrationId,
      schemaFingerprintSha256: manifest.schema.fingerprintSha256,
      repositoryDescriptorSha256: input.repositoryDescriptor.descriptorSha256,
    };
    if (identity.attemptId !== input.publication.attempt_id || identity.captureId !== input.publication.capture_id ||
        identity.captureGeneration !== input.publication.capture_generation) {
      throw new RecoveryError('RECOVERY_SOURCE_CHANGED', 'Signed manifest publication tuple differs from durable journal evidence.');
    }
    const descriptor: RecoverySourceDescriptorV2 = {
      ...identity, fullyEligible: true,
      descriptorSha256: recoverySourceDescriptorV2Digest(identity),
    };
    return { repository: input.repository, repositoryDescriptor: input.repositoryDescriptor,
      publication: input.publication, manifest, policy: trusted.policy, descriptor };
  } catch (cause) {
    if (cause instanceof RecoveryError) throw cause;
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RecoveryError('RECOVERY_SOURCE_NOT_FOUND', 'Exact recovery source run is missing.', { cause });
    }
    throw new RecoveryError('RECOVERY_SOURCE_TRUST_INVALID', 'Recovery source failed retained policy/manifest trust verification.', { cause });
  }
}
