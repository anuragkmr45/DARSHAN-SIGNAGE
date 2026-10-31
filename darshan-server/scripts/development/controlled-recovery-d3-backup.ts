import { ControlledRecoveryError, digest } from '../../src/recovery/controlled-docker/contracts';
import { assertD3OperationBinding, type D3OperationAuthority } from './controlled-recovery-d3-authority';
import { assertVerifiedD3AgeIdentity, type VerifiedD3AgeIdentity } from './controlled-recovery-d3-age-identity';
import { validateD3Publication, type D3PublicationReceipt, type D3PublicationStore } from './controlled-recovery-d3-publication';
export type { D3PublicationReceipt, D3PublicationStore } from './controlled-recovery-d3-publication';

export type D3BackupEvidence = Omit<D3PublicationReceipt, 'format' | 'receiptSha256' | 'artifactInventorySha256'>;
export interface D3BackupBoundary {
  /** Must reserve/coalesce this operation durably in the real broker transaction before capture. */
  reserveOperationBackup(input: { operationId: string; repositoryId: string; sourceSealSha256: string; keyId: string }): Promise<{ runId: string }>;
  runBrokeredV2Backup(input: { brokerSocket: string; repositoryRoot: string; operationId: string; runId: string; sourceSealSha256: string }): Promise<D3BackupEvidence>;
}
export interface D3PublicationVerifier {
  /** Reload repository/manifest/capsule and every encrypted artifact; verify signatures, hashes and all bindings. */
  revalidate(value: D3PublicationReceipt, identity: VerifiedD3AgeIdentity): Promise<D3BackupEvidence>;
}
export class FixedD3Backup {
  constructor(private readonly boundary: D3BackupBoundary, private readonly publications: D3PublicationStore, private readonly authority: D3OperationAuthority,
    private readonly identity: VerifiedD3AgeIdentity, private readonly verifier: D3PublicationVerifier) {}
  async execute(input: { operationId: string; siteId: string; releaseId: 'release-03'; sourceSealSha256: string }) {
    assertD3OperationBinding(this.authority, input); assertVerifiedD3AgeIdentity(this.identity, this.authority);
    if (!/^[a-f0-9]{64}$/.test(input.sourceSealSha256)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_BACKUP_INPUT_INVALID', 'D3 backup input is invalid.');
    const existing = await this.publications.load(input.operationId);
    if (existing) { await revalidateD3Publication(existing, this.authority, this.identity, this.verifier, input.sourceSealSha256); return { keyId: this.identity.keyId, recipientSha256: digest(this.identity.recipient), publication: existing }; }
    const binding = await this.boundary.reserveOperationBackup({ operationId: input.operationId, repositoryId: this.authority.repositoryId, sourceSealSha256: input.sourceSealSha256, keyId: this.identity.keyId });
    if (!/^[0-9a-f-]{36}$/.test(binding.runId)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_INVALID', 'The broker operation-to-backup reservation is invalid.');
    const backup = await this.boundary.runBrokeredV2Backup({ brokerSocket: `${this.authority.root}/run/backup-broker.sock`, repositoryRoot: this.authority.repositoryRoot,
      operationId: input.operationId, runId: binding.runId, sourceSealSha256: input.sourceSealSha256 });
    if (backup.runId !== binding.runId) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_CHANGED', 'The publication differs from its durable broker reservation.');
    const unsigned = { format: 'darshan-d3-publication-v2' as const, ...backup, artifactInventorySha256: digest(backup.artifacts) };
    const publication = validateD3Publication({ ...unsigned, receiptSha256: digest(unsigned) });
    await revalidateD3Publication(publication, this.authority, this.identity, this.verifier, input.sourceSealSha256);
    await this.publications.persist(publication); return { keyId: this.identity.keyId, recipientSha256: digest(this.identity.recipient), publication };
  }
}

async function revalidateD3Publication(value: D3PublicationReceipt, authority: D3OperationAuthority, identity: VerifiedD3AgeIdentity, verifier: D3PublicationVerifier, sourceSealSha256?: string) {
  validateD3Publication(value); assertD3OperationBinding(authority, value); assertVerifiedD3AgeIdentity(identity, authority);
  if (value.keyId !== identity.keyId || value.recipientSha256 !== digest(identity.recipient) || value.ageReceiptSha256 !== identity.receiptSha256 ||
      (sourceSealSha256 !== undefined && value.sourceSealSha256 !== sourceSealSha256))
    throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_CHANGED', 'D3 publication key or source binding differs.');
  const observed = await verifier.revalidate(value, identity);
  const expected: Record<string, unknown> = { ...value }; delete expected.format; delete expected.receiptSha256; delete expected.artifactInventorySha256;
  if (digest(observed) !== digest(expected)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_CHANGED', 'The repository no longer verifies against the D3 publication index.');
}

export async function requestFromD3Publication(input: { store: D3PublicationStore; authority: D3OperationAuthority; identity: VerifiedD3AgeIdentity; verifier: D3PublicationVerifier;
  operationId: string; siteId: string; releaseId: 'release-03'; recoveryKeyFile: string }): Promise<import('../../src/recovery/controlled-docker/workflow').ControlledRecoveryRequest> {
  assertD3OperationBinding(input.authority, input); assertVerifiedD3AgeIdentity(input.identity, input.authority);
  const value = await input.store.load(input.operationId);
  if (!value || input.recoveryKeyFile !== input.authority.keyPath) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_D3_PUBLICATION_CHANGED', 'Restore request has no exact durable D3 publication or retained key.');
  await revalidateD3Publication(value, input.authority, input.identity, input.verifier);
  return { operationId: value.operationId, backupRunId: value.runId, manifestSha256: value.manifestSha256, siteId: value.siteId, approvedReleaseId: value.releaseId, recoveryKeyFile: input.recoveryKeyFile };
}
