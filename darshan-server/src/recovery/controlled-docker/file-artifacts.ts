import { join } from 'node:path';
import type { TrustedRecoverySource } from '../repository-source';
import { openRecoveryRepositoryReadonly, selectTrustedRecoverySource } from '../repository-source';
import { findExactRecoveryPublication } from '../discovery';
import { loadRecoveryPublicKeyring } from '../operator-inputs';
import { readBackupBrokerJournalSnapshot } from '../../backups/backup-broker-journal';
import type { ControlledRecoveryActivation } from './activation';
import type { ControlledRecoveryProfile } from './profile';
import type { ControlledRecoveryRequest } from './workflow';
import { ControlledRecoveryError } from './contracts';
import { extractDeterministicTarStream, type DiskArtifactDescriptor, type ExtractedDiskFile } from './streaming-artifacts';

export interface ProtectedSourceBoundary {
  select(input: { request: ControlledRecoveryRequest; profile: ControlledRecoveryProfile; signal?: AbortSignal }): Promise<TrustedRecoverySource>;
}

export function createInstalledProtectedSourceBoundary(activation: ControlledRecoveryActivation): ProtectedSourceBoundary {
  return { async select({ request, profile, signal }) {
    if (profile.repository.root !== activation.source.repository_root || profile.recovery_key_root !== activation.source.recovery_key_root) {
      throw new ControlledRecoveryError('CONTROLLED_RECOVERY_ACTIVATION_IDENTITY_MISMATCH', 'Profile repository or key root differs from activation.');
    }
    const opened = await openRecoveryRepositoryReadonly({ root: profile.repository.root, expectedDeviceId: profile.repository.device_id,
      ownerUid: profile.repository.owner_uid, ownerGid: profile.repository.owner_gid, expectedSiteId: profile.site_id,
      expectedRepositoryId: profile.repository.repository_id, signal });
    const [journal, policy, manifest] = await Promise.all([
      readBackupBrokerJournalSnapshot({ repository: opened.repository, signal }),
      loadRecoveryPublicKeyring(activation.source.policy_keyring.path, { expectedUid: 0, expectedGid: 0, signal }),
      loadRecoveryPublicKeyring(activation.source.manifest_keyring.path, { expectedUid: 0, expectedGid: 0, signal }),
    ]);
    const publication = findExactRecoveryPublication({ state: journal, siteId: profile.site_id, repositoryId: profile.repository.repository_id,
      runId: request.backupRunId, manifestSha256: request.manifestSha256 });
    return selectTrustedRecoverySource({ repository: opened.repository, repositoryDescriptor: opened.descriptor,
      runId: request.backupRunId, manifestSha256: request.manifestSha256, publication,
      policyTrustKeys: policy.keys, manifestVerificationKeys: manifest.keys, signal });
  } };
}

export interface DecryptedArtifactSet {
  database: readonly ExtractedDiskFile[];
  objects: readonly ExtractedDiskFile[];
  configuration: readonly ExtractedDiskFile[];
  evidenceSha256: string;
}

export interface FixedArtifactBoundary {
  inspectPlaintext(source: TrustedRecoverySource, signal?: AbortSignal): Promise<{ databaseBytes: string; objectBytes: string; configurationBytes: string; objectCount: string }>;
  decrypt(input: { source: TrustedRecoverySource; keyFile: string; workspaceRoot: string; signal?: AbortSignal }): Promise<DecryptedArtifactSet>;
  reobserve(input: { source: TrustedRecoverySource; workspaceRoot: string; signal?: AbortSignal }): Promise<DecryptedArtifactSet>;
}

export interface ControlledDecryptStreamProcess {
  readonly output: AsyncIterable<Uint8Array>;
  terminateAndJoin(reason: 'COMPLETED' | 'FAILED' | 'CANCELLED'): Promise<void>;
}

/** The decrypt authority is not released until its subprocess is terminated and joined. */
export async function extractControlledDecryptProcess(input: { process: ControlledDecryptStreamProcess; outputRoot: string;
  maximumBytes: string; maximumEntries: number; maximumPathBytes: number; signal?: AbortSignal }) {
  let termination: Promise<void> | undefined;
  const terminate = (reason: 'COMPLETED' | 'FAILED' | 'CANCELLED') => { if (termination) return termination;
    const pending = Promise.resolve().then(() => input.process.terminateAndJoin(reason)); let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ControlledRecoveryError(
      'CONTROLLED_RECOVERY_DECRYPT_CLEANUP_TIMEOUT', 'Decrypt process cleanup did not settle within the fixed bound.')), 30_000); timer.unref(); });
    termination = Promise.race([pending, timeout]).finally(() => { if (timer) clearTimeout(timer); }); void pending.catch(() => undefined); return termination; };
  try { return await extractDeterministicTarStream({ source: input.process.output, outputRoot: input.outputRoot,
      maximumBytes: input.maximumBytes, maximumEntries: input.maximumEntries, maximumPathBytes: input.maximumPathBytes, signal: input.signal,
      beforeCleanup: terminate }); }
  finally { if (!termination) await terminate(input.signal?.aborted ? 'CANCELLED' : 'FAILED'); }
}

export function databaseDump(files: readonly ExtractedDiskFile[]): DiskArtifactDescriptor {
  const matches = files.filter((file) => /^darshan_postgres_[0-9]{8}_[0-9]{6}\.sql$/.test(file.archivePath));
  if (matches.length !== 1 || files.length !== 1) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_DATABASE_DUMP_INVALID', 'Decrypted database archive must contain exactly one producer-named SQL dump.');
  return matches[0];
}

export function objectDescriptors(files: readonly ExtractedDiskFile[]): Array<{ key: string; artifact: DiskArtifactDescriptor }> {
  return files.map((file) => ({ key: file.archivePath, artifact: { path: file.path, size: file.size, sha256: file.sha256 } }));
}

export function operationWorkspace(profile: ControlledRecoveryProfile, operationId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(operationId)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_INPUT_INVALID', 'Operation ID is invalid.');
  return join(profile.protected_workspace_root, operationId);
}
