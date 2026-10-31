import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import type { Pool } from 'pg';
import type { CaptureIdentity } from '@/maintenance';
import { runConsistentCapture, type ConsistentCaptureCoordinator } from './consistent-capture';
import type { ConfigurationCapsuleReceipt } from './configuration-capsule';
import { encryptFileWithAge, type AgeEncryptionOptions } from './encryption';
import { BackupError, asBackupError } from './errors';
import { createFileInventory, serializeFileInventory } from './inventory';
import {
  signBackupManifest,
  serializeBackupManifest,
  parseBackupManifest,
  verifyBackupManifestSignature,
  type BackupManifestArtifactV1,
  type BackupManifestSigner,
  type BackupManifestV1,
  type BackupManifestVerifier,
} from './manifest';
import {
  createOwnedAttemptDirectory,
  RepositorySafetyError,
  type LocalRepository,
} from './local-repository';
import { packageBackupComponents, type LocalBackupComponent } from './packaging';
import {
  confirmBackupPublicationPublished,
  completeVerifiedBackupPublication,
  prepareBackupPublication,
  quarantineBackupPublication,
  reconcileVerifiedBackupPublication,
  recordBackupPublicationOutcome,
  type BackupPublicationRecord,
} from './publication-store';
import {
  publishRunDirectory,
  readAndVerifyPublishedRun,
  repositoryManifestViewFromBackupManifest,
  type PublicationIntent,
  type PublicationReceipt,
} from './repository-publication';
import { reconcilePublishedRuns } from './repository-reconciliation';

const INVENTORY_FILE = 'inventory.json';

export interface SealedCaptureEvidence {
  id: string;
  generation: number;
  startedAt: Date;
  sealedAt: Date;
  stagingInventorySha256: string;
}

export interface LocalBackupOrchestratorDependencies {
  coordinator: ConsistentCaptureCoordinator;
  signer: BackupManifestSigner;
  verifier: BackupManifestVerifier;
  captureDatabase(destinationRoot: string, signal: AbortSignal): Promise<void>;
  captureObjects(destinationRoot: string, signal: AbortSignal): Promise<void>;
  captureConfiguration(input: {
    destinationRoot: string;
    siteId: string;
    runId: string;
    attemptId: string;
    signal: AbortSignal;
  }): Promise<ConfigurationCapsuleReceipt>;
  transitionStage?(stage: 'PACKAGING' | 'ENCRYPTING' | 'PUBLISHING' | 'VERIFYING'): Promise<void>;
  readSealedCapture(identity: CaptureIdentity): Promise<SealedCaptureEvidence>;
  packageComponents?: typeof packageBackupComponents;
  encrypt?: (input: AgeEncryptionOptions) => ReturnType<typeof encryptFileWithAge>;
  preparePublication?: typeof prepareBackupPublication;
  recordPublicationOutcome?: typeof recordBackupPublicationOutcome;
  completePublication?: typeof completeVerifiedBackupPublication;
  publish?: typeof publishRunDirectory;
  pool?: Pool;
}

export interface LocalBackupOrchestratorInput {
  repository: LocalRepository;
  runId: string;
  attemptId: string;
  siteId: string;
  releaseId: string;
  schema: { migrationId: string; fingerprintSha256: string };
  encryption: {
    recipient: string;
    keyId: string;
    executablePath: string;
    executableSha256: string;
    version: string;
  };
  tarExecutablePath: string;
  signal: AbortSignal;
}

async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  await fs.writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  const handle = await fs.open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function sha256File(path: string, signal: AbortSignal): Promise<{ sha256: string; size: bigint }> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isFile()) throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `${path} is not a regular ciphertext file.`);
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  const abort = () => stream.destroy(signal.reason instanceof Error ? signal.reason : new Error('Backup was aborted.'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      hash.update(chunk);
    }
  } finally {
    signal.removeEventListener('abort', abort);
  }
  return { sha256: hash.digest('hex'), size: stat.size };
}

async function sealComponentInventory(root: string, signal: AbortSignal): Promise<void> {
  const inventory = await createFileInventory(root, { signal });
  await writePrivateFile(join(root, INVENTORY_FILE), serializeFileInventory(inventory));
}

async function protectOwnedStagingTree(root: string, repository: LocalRepository): Promise<void> {
  const visit = async (path: string): Promise<void> => {
    const before = await fs.lstat(path, { bigint: true });
    if (before.isSymbolicLink() || before.dev.toString() !== repository.deviceId ||
        Number(before.uid) !== repository.ownerUid || Number(before.gid) !== repository.ownerGid) {
      throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Captured staging entry is not repository-owned: ${path}`);
    }
    if (before.isDirectory()) {
      await fs.chmod(path, 0o700);
      const names = await fs.readdir(path);
      names.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
      for (const name of names) await visit(join(path, name));
      const after = await fs.lstat(path);
      if (after.isSymbolicLink() || !after.isDirectory() || (after.mode & 0o777) !== 0o700) {
        throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Captured staging directory could not be protected: ${path}`);
      }
      return;
    }
    if (!before.isFile()) throw new BackupError('BACKUP_INVENTORY_UNSAFE_ENTRY', `Captured staging contains a special file: ${path}`);
    await fs.chmod(path, 0o600);
    const after = await fs.lstat(path, { bigint: true });
    if (after.isSymbolicLink() || !after.isFile() || after.dev !== before.dev || after.ino !== before.ino ||
        Number(after.mode & 0o777n) !== 0o600) {
      throw new BackupError('BACKUP_INVENTORY_CHANGED', `Captured staging entry changed while it was protected: ${path}`);
    }
  };
  await visit(root);
}

function artifactKind(component: LocalBackupComponent): BackupManifestArtifactV1['kind'] {
  return component === 'database' ? 'DATABASE' : component === 'objects' ? 'OBJECTS' : 'CONFIGURATION';
}

function repositoryRelative(repository: LocalRepository, path: string): string {
  const value = relative(repository.root, path).split(sep).join('/');
  if (!value || value.startsWith('../') || value.includes('/../')) {
    throw new BackupError('BACKUP_UNSAFE_PATH', 'Publication path escaped the local repository.');
  }
  return value;
}

function asRepositoryManifestRecord(manifest: BackupManifestV1): Record<string, unknown> {
  return JSON.parse(serializeBackupManifest(manifest).toString('utf8')) as Record<string, unknown>;
}

/**
 * Packet 3 local repository flow. The only plaintext lives below the owned
 * incomplete attempt. It is removed after all three age outputs are durable,
 * before the signed manifest can be atomically published.
 */
export async function runLocalEncryptedBackup(
  input: LocalBackupOrchestratorInput,
  dependencies: LocalBackupOrchestratorDependencies,
): Promise<{ manifest: BackupManifestV1; publication: BackupPublicationRecord }> {
  if (!dependencies.signer || !dependencies.verifier) {
    throw new BackupError('BACKUP_MANIFEST_SIGNATURE_REQUIRED', 'Local production backup publication requires an injected manifest signer and verifier.');
  }
  input.signal.throwIfAborted();
  let attemptPath = '';
  let rawRoot = '';
  let preparedPath = '';

  const capture = await runConsistentCapture({
    coordinator: dependencies.coordinator,
    siteKey: input.siteId,
    backupRunId: input.runId,
    backupAttemptId: input.attemptId,
    signal: input.signal,
    stagingRoot: async (identity) => {
      const owned = await createOwnedAttemptDirectory({
        repository: input.repository,
        runId: input.runId,
        attemptId: input.attemptId,
        captureId: identity.captureId,
        captureGeneration: identity.generation,
      });
      attemptPath = owned.path;
      rawRoot = join(attemptPath, 'raw');
      preparedPath = join(attemptPath, 'prepared');
      await fs.mkdir(rawRoot, { mode: 0o700 });
      for (const component of ['database', 'objects', 'configuration'] as const) {
        await fs.mkdir(join(rawRoot, component), { mode: 0o700 });
      }
      return rawRoot;
    },
    copyIntoStaging: async (_identity, stagingRoot) => {
      const databaseRoot = join(stagingRoot, 'database');
      const objectsRoot = join(stagingRoot, 'objects');
      const configurationRoot = join(stagingRoot, 'configuration');
      await dependencies.captureDatabase(databaseRoot, input.signal);
      await dependencies.captureObjects(objectsRoot, input.signal);
      const receipt = await dependencies.captureConfiguration({
        destinationRoot: configurationRoot,
        siteId: input.siteId,
        runId: input.runId,
        attemptId: input.attemptId,
        signal: input.signal,
      });
      await writePrivateFile(join(configurationRoot, 'capsule-receipt.json'), Buffer.from(`${JSON.stringify(receipt)}\n`));
      await sealComponentInventory(databaseRoot, input.signal);
      await sealComponentInventory(objectsRoot, input.signal);
      await sealComponentInventory(configurationRoot, input.signal);
      // Reconciliation deletes only exact 0700/0600 repository-owned trees.
      // Normalize helper/tool umasks now and verify the tree before it is
      // included in the immutable capture digest.
      await protectOwnedStagingTree(stagingRoot, input.repository);
    },
  });
  if (!attemptPath || capture.stagingRoot !== rawRoot) throw new BackupError('BACKUP_INTERNAL', 'Capture did not retain its owned repository staging identity.');

  const evidence = await dependencies.readSealedCapture(capture.identity);
  if (evidence.id !== capture.identity.captureId || evidence.generation !== capture.identity.generation ||
      evidence.stagingInventorySha256 !== capture.stagingInventoryDigest) {
    throw new BackupError('BACKUP_INVENTORY_CHANGED', 'Sealed capture evidence does not match the staged inventory.');
  }

  input.signal.throwIfAborted();
  await dependencies.transitionStage?.('PACKAGING');
  const packageRoot = join(rawRoot, 'packages');
  const packaged = await (dependencies.packageComponents ?? packageBackupComponents)({
    rawRoot,
    packageRoot,
    tarExecutablePath: input.tarExecutablePath,
    signal: input.signal,
  });
  if (packaged.length !== 3 || packaged.some((item, index) => item.component !== ['database', 'objects', 'configuration'][index])) {
    throw new BackupError('BACKUP_INTERNAL', 'Local packaging must produce exactly database, objects, and configuration.');
  }

  await fs.mkdir(preparedPath, { mode: 0o700 });
  input.signal.throwIfAborted();
  await dependencies.transitionStage?.('ENCRYPTING');
  const artifacts: BackupManifestArtifactV1[] = [];
  const encrypt = dependencies.encrypt ?? encryptFileWithAge;
  for (const item of packaged) {
    input.signal.throwIfAborted();
    const ciphertextPath = join(preparedPath, `${item.component}.tar.age`);
    await encrypt({
      inputPath: item.outputPath,
      outputPath: ciphertextPath,
      recipient: input.encryption.recipient,
      executablePath: input.encryption.executablePath,
      expectedExecutableSha256: input.encryption.executableSha256,
      expectedVersion: input.encryption.version,
      signal: input.signal,
    });
    const digest = await sha256File(ciphertextPath, input.signal);
    await fs.rm(item.outputPath);
    artifacts.push({
      kind: artifactKind(item.component),
      name: item.component,
      ciphertextPath: basename(ciphertextPath),
      ciphertextSizeBytes: digest.size.toString(),
      ciphertextSha256: digest.sha256,
    });
  }
  try { await fs.rm(rawRoot, { recursive: true, force: false }); }
  catch (error) {
    throw new BackupError('BACKUP_PARTIAL_CLEANUP_FAILED', 'Encrypted artifacts are safe but plaintext staging cleanup failed.', undefined, { cause: error as Error });
  }

  const unsigned: BackupManifestV1 = {
    version: 1,
    repository: { kind: 'LOCAL_FILESYSTEM', id: input.repository.identity.repository_id },
    site: { id: input.siteId },
    run: { id: input.runId, attemptId: input.attemptId },
    capture: {
      id: evidence.id,
      generation: evidence.generation.toString(),
      startedAt: evidence.startedAt.toISOString(),
      sealedAt: evidence.sealedAt.toISOString(),
      stagingInventorySha256: evidence.stagingInventorySha256,
    },
    release: { id: input.releaseId },
    schema: input.schema,
    encryption: {
      keyId: input.encryption.keyId,
      tool: { name: 'age', version: input.encryption.version, executableSha256: input.encryption.executableSha256 },
    },
    artifacts,
    signature: null,
  };
  const manifest = await signBackupManifest(unsigned, dependencies.signer);
  input.signal.throwIfAborted();
  await verifyBackupManifestSignature(manifest, dependencies.verifier);
  input.signal.throwIfAborted();
  const manifestBytes = serializeBackupManifest(manifest);
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  const manifestView = repositoryManifestViewFromBackupManifest(manifest);

  const publicationState: { value: BackupPublicationRecord | null } = { value: null };
  let outcomeRecorded = false;
  const prepare = dependencies.preparePublication ?? prepareBackupPublication;
  const recordOutcome = dependencies.recordPublicationOutcome ?? recordBackupPublicationOutcome;
  try {
    await dependencies.transitionStage?.('PUBLISHING');
    input.signal.throwIfAborted();
    const published = await (dependencies.publish ?? publishRunDirectory)({
      repository: input.repository,
      attemptPath,
      preparedPath,
      manifestBytes,
      manifest: manifestView,
      signal: input.signal,
      recordIntent: async (_intent: PublicationIntent) => {
        publicationState.value = await prepare({
          runId: input.runId,
          attemptId: input.attemptId,
          captureId: evidence.id,
          repositoryId: input.repository.identity.repository_id,
          manifestSha256,
          incompleteRelativePath: repositoryRelative(input.repository, attemptPath),
          publishedRelativePath: `runs/${input.runId.toLowerCase()}`,
          pool: dependencies.pool,
        });
      },
      recordReceipt: async (_receipt: PublicationReceipt) => {
        if (!publicationState.value) throw new BackupError('BACKUP_INTERNAL', 'Publication receipt arrived before durable intent.');
        publicationState.value = await recordOutcome({
          publicationId: publicationState.value.id,
          manifestSha256,
          outcome: 'PUBLISHED',
          pool: dependencies.pool,
        });
        outcomeRecorded = true;
      },
    });
    const durablePublication = publicationState.value;
    if (!durablePublication || !published.receipt || !outcomeRecorded) {
      throw new BackupError('BACKUP_INTERNAL', 'Atomic publication did not produce durable intent, outcome, and receipt evidence.');
    }
    input.signal.throwIfAborted();
    await dependencies.transitionStage?.('VERIFYING');
    const readBackManifest = parseBackupManifest(await fs.readFile(join(published.runPath, 'manifest.json')));
    input.signal.throwIfAborted();
    await verifyBackupManifestSignature(readBackManifest, dependencies.verifier);
    input.signal.throwIfAborted();
    const complete = dependencies.completePublication ?? completeVerifiedBackupPublication;
    if (!await complete({
      publicationId: durablePublication.id,
      runId: input.runId,
      attemptId: input.attemptId,
      captureId: evidence.id,
      manifestSha256,
      repositoryManifest: asRepositoryManifestRecord(readBackManifest),
      pool: dependencies.pool,
    })) {
      throw new BackupError('BACKUP_INTERNAL', 'Verified local publication lost conditional completion authority.');
    }
    return { manifest: readBackManifest, publication: durablePublication };
  } catch (error) {
    const uncertainPublication = publicationState.value;
    if (uncertainPublication && !outcomeRecorded && uncertainPublication.status === 'PREPARED') {
      await recordOutcome({
        publicationId: uncertainPublication.id,
        manifestSha256,
        outcome: 'UNCERTAIN',
        errorCode: asBackupError(error).code,
        errorMessage: error instanceof Error ? error.message : String(error),
        pool: dependencies.pool,
      }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Restart inspector for the crash window between filesystem rename/receipt and
 * PostgreSQL completion. The caller must hold the same site execution advisory
 * lock used by a live backup worker.
 */
export function createLocalPublicationInspector(input: {
  repository: LocalRepository;
  verifier: BackupManifestVerifier;
  pool: Pool;
  now?: () => Date;
  adapters?: {
    readPublished?: typeof readAndVerifyPublishedRun;
    confirmPublished?: typeof confirmBackupPublicationPublished;
    reconcileVerified?: typeof reconcileVerifiedBackupPublication;
    quarantinePublication?: typeof quarantineBackupPublication;
    reconcileRepository?: typeof reconcilePublishedRuns;
  };
}) {
  return async (run: {
    id: string;
    attempt_id: string | null;
    cancellation_requested_at: Date | null;
    deadline_at: Date | null;
  }): Promise<'ADOPTED' | 'PRESERVE' | 'ABSENT'> => {
    if (!run.attempt_id) return 'ABSENT';
    const publicationResult = await input.pool.query<BackupPublicationRecord>(
      `SELECT * FROM backup_publications
       WHERE backup_run_id = $1 AND backup_attempt_id = $2
         AND status IN ('PREPARED', 'PUBLISHED', 'UNCERTAIN', 'VERIFIED')
       LIMIT 1`,
      [run.id, run.attempt_id]
    );
    let publication = publicationResult.rows[0];
    if (!publication) return 'ABSENT';

    const quarantine = async (code: string, message: string) => {
      await (input.adapters?.reconcileRepository ?? reconcilePublishedRuns)({
        repository: input.repository,
        decide: async (entry) => {
          const entryRunId = entry.intent?.run_id ?? basename(entry.path);
          return entryRunId === run.id.toLowerCase() ? 'quarantine' : 'preserve';
        },
      });
      await (input.adapters?.quarantinePublication ?? quarantineBackupPublication)({
        publicationId: publication.id,
        errorCode: code,
        errorMessage: message,
        pool: input.pool,
      });
    };

    try {
      let published = await (input.adapters?.readPublished ?? readAndVerifyPublishedRun)({
        repository: input.repository,
        runId: run.id,
        requireReceipt: false,
      });
      const manifestBytes = await fs.readFile(join(published.runPath, 'manifest.json'));
      const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
      if (manifestSha256 !== publication.manifest_sha256 || manifestSha256 !== published.intent.manifest_sha256) {
        throw new BackupError('BACKUP_MANIFEST_INVALID', 'Published manifest does not match its durable publication intent.');
      }
      const manifest = parseBackupManifest(manifestBytes);
      await verifyBackupManifestSignature(manifest, input.verifier);
      if (manifest.run.id !== run.id.toLowerCase() || manifest.run.attemptId !== run.attempt_id.toLowerCase() ||
          manifest.capture.id !== publication.capture_id.toLowerCase()) {
        throw new BackupError('BACKUP_MANIFEST_INVALID', 'Published manifest identity does not match the stranded attempt.');
      }
      if (run.cancellation_requested_at || !run.deadline_at) {
        await quarantine('BACKUP_PUBLICATION_AUTHORITY_EXPIRED', 'Published bytes are cancelled or outside the immutable attempt deadline.');
        return 'ABSENT';
      }
      if (!published.receipt) {
        // Without a receipt there is no durable pre-deadline publication time.
        // Repair is permitted only while the same attempt still has live
        // deadline authority; reconciliation then creates the receipt now.
        if ((input.now?.() ?? new Date()).getTime() >= run.deadline_at.getTime()) {
          await quarantine('BACKUP_PUBLICATION_AUTHORITY_EXPIRED', 'Receipt-less publication cannot establish completion before its immutable deadline.');
          return 'ABSENT';
        }
        const reconciliation = await (input.adapters?.reconcileRepository ?? reconcilePublishedRuns)({
          repository: input.repository,
          decide: async (entry) => {
            const entryRunId = entry.intent?.run_id ?? basename(entry.path);
            if (entryRunId !== run.id.toLowerCase()) return 'preserve';
            if (entry.classification !== 'incomplete' || !entry.intent ||
                entry.intent.attempt_id !== run.attempt_id!.toLowerCase() ||
                entry.intent.capture_id !== publication.capture_id.toLowerCase() ||
                entry.intent.manifest_sha256 !== publication.manifest_sha256) return 'quarantine';
            return 'adopt';
          },
        });
        if (reconciliation.adopted.length !== 1) {
          throw new BackupError('BACKUP_INTERNAL', 'Receipt-less publication was not durably adopted.');
        }
        published = await (input.adapters?.readPublished ?? readAndVerifyPublishedRun)({
          repository: input.repository, runId: run.id, requireReceipt: true,
        });
        if (!published.receipt) throw new BackupError('BACKUP_INTERNAL', 'Adopted publication has no durable receipt.');
      }
      if (Date.parse(published.receipt.published_at) > run.deadline_at.getTime()) {
        await quarantine('BACKUP_PUBLICATION_AUTHORITY_EXPIRED', 'Published bytes are outside the immutable attempt deadline.');
        return 'ABSENT';
      }
      if (publication.status === 'PREPARED' || publication.status === 'UNCERTAIN') {
        publication = await (input.adapters?.confirmPublished ?? confirmBackupPublicationPublished)({
          publicationId: publication.id,
          manifestSha256,
          publishedAt: new Date(published.receipt.published_at),
          pool: input.pool,
        });
      }
      if (publication.status === 'VERIFIED') return 'ADOPTED';
      const adopted = await (input.adapters?.reconcileVerified ?? reconcileVerifiedBackupPublication)({
        publicationId: publication.id,
        runId: run.id,
        attemptId: run.attempt_id,
        captureId: publication.capture_id,
        manifestSha256,
        repositoryManifest: asRepositoryManifestRecord(manifest),
        pool: input.pool,
      });
      return adopted ? 'ADOPTED' : 'PRESERVE';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await quarantine('BACKUP_PUBLICATION_MISSING', 'Prepared publication intent has no repository run directory.');
        return 'ABSENT';
      }
      const terminal = error instanceof BackupError
        ? ['INTEGRITY', 'INVALID_INPUT'].includes(error.failureClass)
        : error instanceof RepositorySafetyError && /(?:INVALID|MISMATCH|UNSAFE|PROTOCOL|CORRUPT)/.test(error.code);
      if (!terminal) throw error;
      const classified = asBackupError(error);
      await quarantine(error instanceof RepositorySafetyError ? error.code : classified.code, classified.message);
      return 'ABSENT';
    }
  };
}
