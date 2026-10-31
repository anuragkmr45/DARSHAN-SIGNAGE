import { readBackupBrokerJournalSnapshot, type BrokerJournalState } from '../backups/backup-broker-journal';
import { assessRecoveryCompatibility } from './compatibility';
import { discoverRecoveryCandidates, findExactRecoveryPublication } from './discovery';
import { RecoveryError } from './errors';
import { loadRecoveryOperatorConfig, loadRecoveryPublicKeyring } from './operator-inputs';
import { buildRecoveryPlanV2 } from './plan';
import { writeRecoveryPlanFile } from './plan-file';
import { loadReleaseRecoveryTarget } from './release-target';
import { openRecoveryRepositoryReadonly, selectTrustedRecoverySource } from './repository-source';

function mapJournalError(cause: unknown): RecoveryError {
  if (cause instanceof RecoveryError && cause.code === 'RECOVERY_CANCELLED') return cause;
  const code = (cause as { code?: string }).code;
  if (code === 'BROKER_JOURNAL_SNAPSHOT_MISSING') return new RecoveryError('RECOVERY_JOURNAL_SNAPSHOT_MISSING', 'Broker journal snapshot is missing.', { cause });
  if (code === 'BROKER_JOURNAL_SNAPSHOT_CORRUPT') return new RecoveryError('RECOVERY_JOURNAL_SNAPSHOT_CORRUPT', 'Broker journal snapshot is corrupt.', { cause });
  return new RecoveryError('RECOVERY_JOURNAL_SNAPSHOT_UNSAFE', 'Broker journal snapshot failed read-only safety checks.', { cause });
}

async function snapshot(repository: Parameters<typeof readBackupBrokerJournalSnapshot>[0]['repository'], signal?: AbortSignal): Promise<BrokerJournalState> {
  try { return await readBackupBrokerJournalSnapshot({ repository, signal }); }
  catch (cause) { throw mapJournalError(cause); }
}

async function context(configFile: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const config = await loadRecoveryOperatorConfig(configFile, { signal });
  const [{ keys: policyTrustKeys }, { keys: manifestVerificationKeys }] = await Promise.all([
    loadRecoveryPublicKeyring(config.trust.policy_keyring_file, { signal }),
    loadRecoveryPublicKeyring(config.trust.manifest_keyring_file, { signal }),
  ]);
  const opened = await openRecoveryRepositoryReadonly({
    root: config.repository.root, expectedDeviceId: config.repository.device_id,
    ownerUid: config.repository.owner_uid, ownerGid: config.repository.owner_gid,
    expectedSiteId: config.site_id, expectedRepositoryId: config.repository.repository_id,
    signal,
  });
  return { config, ...opened, policyTrustKeys, manifestVerificationKeys };
}

export async function runRecoveryDiscovery(input: {
  configFile: string; limit?: number; afterRunId?: string; signal?: AbortSignal;
}) {
  const loaded = await context(input.configFile, input.signal);
  const state = await snapshot(loaded.repository, input.signal);
  return discoverRecoveryCandidates({ state, siteId: loaded.config.site_id,
    repositoryId: loaded.config.repository.repository_id, limit: input.limit, afterRunId: input.afterRunId });
}

export async function runRecoveryPlanning(input: {
  configFile: string;
  runId: string;
  manifestSha256: string;
  planOutput: string;
  operationId?: string;
  planId?: string;
  now?: Date;
  signal?: AbortSignal;
}) {
  const loaded = await context(input.configFile, input.signal);
  const initialState = await snapshot(loaded.repository, input.signal);
  const publication = findExactRecoveryPublication({ state: initialState, siteId: loaded.config.site_id,
    repositoryId: loaded.config.repository.repository_id, runId: input.runId, manifestSha256: input.manifestSha256 });
  const trusted = await selectTrustedRecoverySource({ repository: loaded.repository,
    repositoryDescriptor: loaded.descriptor, runId: input.runId, manifestSha256: input.manifestSha256,
    publication, policyTrustKeys: loaded.policyTrustKeys, manifestVerificationKeys: loaded.manifestVerificationKeys,
    signal: input.signal });
  input.signal?.throwIfAborted();
  const target = await loadReleaseRecoveryTarget({ targetId: loaded.config.target.target_id,
    releaseId: loaded.config.target.release_id, migrationsDirectory: loaded.config.target.migrations_directory });
  const compatibility = assessRecoveryCompatibility({ sourceKind: trusted.descriptor.kind,
    sourceManifest: trusted.manifest, sourcePolicy: trusted.policy, targetReleaseId: target.metadata.releaseId,
    targetManifest: target.manifest });

  // Re-observe lifecycle truth after the potentially long artifact verification. No hold is acquired in 5A2a.
  const finalState = await snapshot(loaded.repository, input.signal);
  const finalPublication = findExactRecoveryPublication({ state: finalState, siteId: loaded.config.site_id,
    repositoryId: loaded.config.repository.repository_id, runId: input.runId, manifestSha256: input.manifestSha256 });
  if (JSON.stringify(finalPublication) !== JSON.stringify(publication)) {
    throw new RecoveryError('RECOVERY_SOURCE_CHANGED', 'Publication evidence changed during recovery planning.');
  }
  const built = buildRecoveryPlanV2({ source: trusted.descriptor, compatibility, target: target.metadata,
    operationId: input.operationId, planId: input.planId, createdAt: input.now });
  input.signal?.throwIfAborted();
  const output = await writeRecoveryPlanFile({ path: input.planOutput, bytes: built.bytes, signal: input.signal });
  return { plan: built.plan, planSha256: built.sha256, planOutput: output.path, journalRevision: finalState.revision };
}
