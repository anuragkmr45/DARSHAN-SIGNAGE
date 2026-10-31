import { createHash } from 'node:crypto';
import { config as appConfig } from '@/config';
import { getDatabasePool } from '@/db';
import type { LocalBackupRuntimeDependencies } from '@/utils/backup-runs';
import { createBackupHostHelperRuntime } from './backup-host-helper';
import { BackupBrokerWorkerAdapter, type BrokerAttemptIdentity } from './backup-broker-worker-adapter';
import type { BackupRun } from './coordination';
import { createLocalPublicationInspector } from './local-backup-orchestrator';
import { openLocalRepository } from './local-repository';
import { parseBackupManifest, serializeBackupManifest } from './manifest';
import { confirmBackupPublicationPublished, quarantineBackupPublication, reconcileVerifiedBackupPublication, type BackupPublicationRecord } from './publication-store';

async function openConfiguredRepository() {
  return openLocalRepository({ root: appConfig.BACKUP_REPOSITORY_ROOT!, expectedDeviceId: appConfig.BACKUP_REPOSITORY_DEVICE_ID!,
    ownerUid: appConfig.BACKUP_REPOSITORY_OWNER_UID!, ownerGid: appConfig.BACKUP_REPOSITORY_OWNER_GID!,
    minimumFreeBytes: appConfig.BACKUP_REPOSITORY_MIN_FREE_BYTES!, expectedSiteId: appConfig.BACKUP_SITE_ID!,
    expectedRepositoryId: appConfig.BACKUP_REPOSITORY_ID! });
}

export interface LocalBackupWorkerRuntime {
  readonly runDependencies: LocalBackupRuntimeDependencies;
  readonly retentionBroker?: BackupBrokerWorkerAdapter;
  inspectPublication(run: BackupRun): Promise<'ADOPTED' | 'PRESERVE' | 'ABSENT'>;
}

function createBrokerPublicationInspector(adapter: BackupBrokerWorkerAdapter) {
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  return async (run: BackupRun): Promise<'ADOPTED' | 'PRESERVE' | 'ABSENT'> => {
    if (!run.attempt_id || !run.deadline_at || run.cancellation_requested_at) return 'PRESERVE';
    const result = await pool.query<BackupPublicationRecord & { capture_generation: string }>(
      `SELECT publication.*, capture.generation::text AS capture_generation
         FROM backup_publications AS publication
         JOIN backup_captures AS capture ON capture.id = publication.capture_id
        WHERE publication.backup_run_id = $1 AND publication.backup_attempt_id = $2
          AND publication.status IN ('PREPARED', 'PUBLISHED', 'UNCERTAIN', 'VERIFIED') LIMIT 1`, [run.id, run.attempt_id]);
    let publication = result.rows[0];
    if (!publication) {
      const captureResult = await pool.query<{ id: string; generation: string }>(
        `SELECT id, generation::text FROM backup_captures
          WHERE backup_run_id = $1 AND backup_attempt_id = $2 AND status = 'SEALED'
          ORDER BY generation DESC LIMIT 1`, [run.id, run.attempt_id]);
      const capture = captureResult.rows[0];
      if (!capture) return 'ABSENT';
      const identity: BrokerAttemptIdentity = { runId: run.id, attemptId: run.attempt_id, captureId: capture.id,
        captureGeneration: Number(capture.generation), deadlineAt: run.deadline_at };
      const inspected = await adapter.inspect(identity);
      if (inspected.status === 'COMMITTED') {
        if (!inspected.evidence) throw new Error('Committed broker publication omitted repository evidence.');
        const signedBytes = Buffer.from(inspected.evidence.canonical_signed_manifest_base64, 'base64');
        adapter.validateEvidence(inspected.evidence, identity, signedBytes);
        return 'PRESERVE';
      }
      // A broker PREPARED record without migration-0051 SQL intent is a
      // cross-store inconsistency, never proof that a successor may retry.
      if (inspected.status === 'PREPARED') return 'PRESERVE';
      return 'ABSENT';
    }
    const identity: BrokerAttemptIdentity = { runId: run.id, attemptId: run.attempt_id, captureId: publication.capture_id,
      captureGeneration: Number(publication.capture_generation), deadlineAt: run.deadline_at };
    const inspected = await adapter.inspect(identity, publication.manifest_sha256);
    if (inspected.status === 'PREPARED') return 'PRESERVE';
    if (inspected.status === 'ABSENT' || inspected.status === 'QUARANTINED') {
      await quarantineBackupPublication({ publicationId: publication.id,
        errorCode: inspected.status === 'ABSENT' ? 'BACKUP_BROKER_PUBLICATION_ABSENT' : 'BACKUP_BROKER_PUBLICATION_QUARANTINED',
        errorMessage: 'The authoritative backup broker reports no adoptable publication.', pool });
      return 'ABSENT';
    }
    if (!inspected.evidence || inspected.signed_manifest_sha256 !== publication.manifest_sha256) {
      throw new Error('Committed broker inspection did not return the exact durable publication evidence.');
    }
    const signedBytes = Buffer.from(inspected.evidence.canonical_signed_manifest_base64, 'base64');
    if (createHash('sha256').update(signedBytes).digest('hex') !== publication.manifest_sha256) {
      throw new Error('Broker inspection signed-manifest digest conflicts with PostgreSQL intent.');
    }
    adapter.validateEvidence(inspected.evidence, identity, signedBytes);
    const manifest = parseBackupManifest(signedBytes);
    if (publication.status === 'PREPARED' || publication.status === 'UNCERTAIN') {
      publication = { ...publication, ...await confirmBackupPublicationPublished({ publicationId: publication.id,
        manifestSha256: publication.manifest_sha256, publishedAt: new Date(inspected.evidence.receipt.published_at), pool }) };
    }
    if (publication.status === 'VERIFIED') return 'ADOPTED';
    const adopted = await reconcileVerifiedBackupPublication({ publicationId: publication.id, runId: run.id, attemptId: run.attempt_id,
      captureId: publication.capture_id, manifestSha256: publication.manifest_sha256,
      repositoryManifest: JSON.parse(serializeBackupManifest(manifest).toString('utf8')) as Record<string, unknown>, pool });
    return adopted ? 'ADOPTED' : 'PRESERVE';
  };
}

/** Production Packet 3 composition root. Protocol selection is explicit and never falls back. */
export async function createLocalBackupWorkerRuntime(): Promise<LocalBackupWorkerRuntime | null> {
  if (appConfig.NODE_ENV !== 'production' || appConfig.BACKUP_REPOSITORY_KIND !== 'LOCAL_FILESYSTEM') return null;
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database pool is not initialized.');
  if (appConfig.BACKUP_LOCAL_PROTOCOL === 'V2_BROKER') {
    const broker = await BackupBrokerWorkerAdapter.create({ socketPath: appConfig.BACKUP_BROKER_SOCKET_PATH!,
      helperVersion: appConfig.BACKUP_BROKER_HELPER_VERSION!, policySha256: appConfig.BACKUP_BROKER_POLICY_SHA256!.toLowerCase(),
      siteId: appConfig.BACKUP_SITE_ID!, repositoryId: appConfig.BACKUP_REPOSITORY_ID!, keyringPath: appConfig.BACKUP_MANIFEST_PUBLIC_KEYRING_PATH!,
      expectedRelease: appConfig.DARSHAN_RELEASE_ID, expectedDeployment: appConfig.SIGNHEX_DEPLOYMENT_ID,
      expectedCompatibility: appConfig.DARSHAN_COMPATIBILITY_GENERATION, expectedAgeKeyId: appConfig.BACKUP_ENCRYPTION_KEY_ID!,
      expectedCapsuleGeneration: appConfig.BACKUP_CAPSULE_GENERATION!, expectedCapsuleSha256: appConfig.BACKUP_CAPSULE_SHA256!.toLowerCase() });
    return { runDependencies: { protocol: 'V2_BROKER', broker,
      spool: { root: appConfig.BACKUP_WORKER_SPOOL_ROOT!, deviceId: appConfig.BACKUP_WORKER_SPOOL_DEVICE_ID!,
        ownerUid: appConfig.BACKUP_WORKER_SPOOL_OWNER_UID!, ownerGid: appConfig.BACKUP_WORKER_SPOOL_OWNER_GID! } },
      retentionBroker: broker,
      inspectPublication: createBrokerPublicationInspector(broker) };
  }
  if (appConfig.BACKUP_LOCAL_PROTOCOL !== 'V1_HELPER') throw new Error('LOCAL_FILESYSTEM backup protocol selection is invalid or absent.');
  const helper = await createBackupHostHelperRuntime({ helperPath: appConfig.BACKUP_CAPSULE_HELPER_PATH!,
    expectedHelperVersion: appConfig.BACKUP_CAPSULE_HELPER_VERSION!, expectedHelperSha256: appConfig.BACKUP_CAPSULE_HELPER_SHA256!.toLowerCase(),
    siteId: appConfig.BACKUP_SITE_ID! });
  return { runDependencies: { protocol: 'V1_HELPER', configurationContract: helper.configurationContract,
      createManifestAuthority: (signal) => ({ signer: helper.signer(signal), verifier: helper.verifier(signal) }) },
    inspectPublication: async (run) => createLocalPublicationInspector({ repository: await openConfiguredRepository(), verifier: helper.verifier(), pool })(run) };
}
