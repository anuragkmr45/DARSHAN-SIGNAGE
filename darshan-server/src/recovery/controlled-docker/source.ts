import type { BrokerPublicationRecord } from '../../backups/backup-broker-journal';
import type { BrokerLifecycleIdentity } from '../../backups/backup-broker-worker-adapter';
import type { TrustedRecoverySource } from '../repository-source';
import { openRecoveryRepositoryReadonly, selectTrustedRecoverySource } from '../repository-source';
import { ControlledRecoveryError, digest, type ExactSourceIdentity } from './contracts';
import type { ControlledRecoveryProfile } from './profile';

export interface RestoreHoldBroker {
  acquireRestoreHold(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<{ status: string }>;
  inspectRestoreHold(identity: BrokerLifecycleIdentity, signal?: AbortSignal): Promise<{ status: string }>;
}

export interface TrustedSourceSelectionInput {
  profile: ControlledRecoveryProfile;
  runId: string;
  manifestSha256: string;
  publication: BrokerPublicationRecord;
  policyTrustKeys: ReadonlyMap<string, string>;
  manifestVerificationKeys: ReadonlyMap<string, string>;
  signal?: AbortSignal;
}

export async function selectControlledRecoverySource(input: TrustedSourceSelectionInput): Promise<TrustedRecoverySource> {
  const opened = await openRecoveryRepositoryReadonly({ root: input.profile.repository.root,
    expectedDeviceId: input.profile.repository.device_id, ownerUid: input.profile.repository.owner_uid,
    ownerGid: input.profile.repository.owner_gid, expectedSiteId: input.profile.site_id,
    expectedRepositoryId: input.profile.repository.repository_id, signal: input.signal });
  return selectTrustedRecoverySource({ repository: opened.repository, repositoryDescriptor: opened.descriptor,
    runId: input.runId, manifestSha256: input.manifestSha256, publication: input.publication,
    policyTrustKeys: input.policyTrustKeys, manifestVerificationKeys: input.manifestVerificationKeys, signal: input.signal });
}

export function exactSourceIdentity(source: TrustedRecoverySource): ExactSourceIdentity {
  return { siteId: source.descriptor.siteId, repositoryId: source.descriptor.repositoryId,
    runId: source.descriptor.runId, manifestSha256: source.descriptor.manifestSha256,
    descriptorSha256: source.descriptor.descriptorSha256, keyId: source.manifest.encryption.keyId,
    releaseId: source.manifest.release.id, schemaMigrationId: source.manifest.schema.migrationId };
}

export function assertExactSourceIdentity(expected: ExactSourceIdentity, observed: TrustedRecoverySource): void {
  if (digest(exactSourceIdentity(observed)) !== digest(expected)) {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SOURCE_CHANGED', 'Exact trusted recovery source identity changed between phases.');
  }
}

export async function acquireAndVerifyRestoreHold(input: {
  broker: RestoreHoldBroker; identity: BrokerLifecycleIdentity; signal?: AbortSignal;
}): Promise<void> {
  let acquired: { status: string };
  try { acquired = await input.broker.acquireRestoreHold(input.identity, input.signal); }
  catch (cause) { throw new ControlledRecoveryError('CONTROLLED_RECOVERY_HOLD_AMBIGUOUS', 'Restore hold acquisition truth is uncertain; source must remain retained.', { cause }); }
  if (acquired.status !== 'ACTIVE' && acquired.status !== 'ALREADY_ACTIVE') {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_HOLD_AMBIGUOUS', 'Restore hold was not durably active.');
  }
  const observed = await input.broker.inspectRestoreHold(input.identity, input.signal).catch((cause) => {
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_HOLD_AMBIGUOUS', 'Restore hold re-observation failed.', { cause });
  });
  if (observed.status !== 'ACTIVE') throw new ControlledRecoveryError('CONTROLLED_RECOVERY_HOLD_AMBIGUOUS', 'Restore hold re-observation is not active.');
}

