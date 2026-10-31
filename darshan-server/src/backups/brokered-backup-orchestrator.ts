import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream, promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { Pool } from 'pg';
import type { CaptureIdentity } from '@/maintenance';
import { BackupBrokerWorkerAdapter, type BrokerAttemptIdentity } from './backup-broker-worker-adapter';
import { runConsistentCapture, type ConsistentCaptureCoordinator } from './consistent-capture';
import { encryptFileWithAge, type AgeEncryptionOptions } from './encryption';
import { BackupError, asBackupError } from './errors';
import { serializeBackupManifest, type BackupManifestArtifactV1, type BackupManifestV1 } from './manifest';
import { packageBackupComponents } from './packaging';
import {
  completeVerifiedBackupPublication, confirmBackupPublicationPublished, prepareBackupPublication,
  recordBackupPublicationOutcome, type BackupPublicationRecord,
} from './publication-store';

export interface BrokerWorkerSpool {
  root: string;
  deviceId: string;
  ownerUid: number;
  ownerGid: number;
}

export interface BrokeredBackupInput {
  runId: string;
  attemptId: string;
  deadlineAt: Date;
  siteId: string;
  releaseId: string;
  schema: { migrationId: string; fingerprintSha256: string };
  encryption: { recipient: string; keyId: string; executablePath: string; executableSha256: string; version: string };
  tarExecutablePath: string;
  signal: AbortSignal;
}

export interface BrokeredBackupDependencies {
  coordinator: ConsistentCaptureCoordinator;
  broker: Pick<BackupBrokerWorkerAdapter, 'capability' | 'selectCapsule' | 'prepare' | 'commit'>;
  spool: BrokerWorkerSpool;
  pool: Pool;
  captureDatabase(destinationRoot: string, signal: AbortSignal): Promise<void>;
  captureObjects(destinationRoot: string, signal: AbortSignal): Promise<void>;
  readSealedCapture(identity: CaptureIdentity): Promise<{
    id: string; generation: number; startedAt: Date; sealedAt: Date; stagingInventorySha256: string;
  }>;
  transitionStage?(stage: 'PACKAGING' | 'ENCRYPTING' | 'PUBLISHING' | 'VERIFYING'): Promise<void>;
  packageComponents?: typeof packageBackupComponents;
  encrypt?: (input: AgeEncryptionOptions) => ReturnType<typeof encryptFileWithAge>;
  preparePublication?: typeof prepareBackupPublication;
  confirmPublication?: typeof confirmBackupPublicationPublished;
  completePublication?: typeof completeVerifiedBackupPublication;
  recordPublicationOutcome?: typeof recordBackupPublicationOutcome;
  durablySealSpool?: (attemptRoot: string, spool: BrokerWorkerSpool) => Promise<void>;
  /** Explicit controller-owned settlement policy; production defaults retain their existing behavior. */
  cleanupSpool?: (root: string, spool: BrokerWorkerSpool, phase: 'RAW_AFTER_ENCRYPTION' | 'RAW_FAILURE' | 'AFTER_VERIFIED') => Promise<void>;
  resumeSealedArtifacts?: boolean;
}

async function validateSpoolNode(path: string, spool: BrokerWorkerSpool, kind: 'directory' | 'file'): Promise<void> {
  const stat = await fs.lstat(path, { bigint: true });
  const validKind = kind === 'directory' ? stat.isDirectory() : stat.isFile();
  const expectedMode = kind === 'directory' ? 0o700 : 0o600;
  if (stat.isSymbolicLink() || !validKind || stat.dev.toString() !== spool.deviceId || Number(stat.uid) !== spool.ownerUid ||
      Number(stat.gid) !== spool.ownerGid || Number(stat.mode & 0o777n) !== expectedMode || (kind === 'file' && stat.nlink !== 1n)) {
    throw new BackupError('BACKUP_SPOOL_UNSAFE', `Worker spool ${kind} is unsafe: ${path}`);
  }
}

async function createAttemptRoot(spool: BrokerWorkerSpool, identity: CaptureIdentity): Promise<string> {
  if (!isAbsolute(spool.root) || resolve(spool.root) !== spool.root || await fs.realpath(spool.root) !== spool.root) {
    throw new BackupError('BACKUP_SPOOL_UNSAFE', 'Worker spool root must be canonical and absolute.');
  }
  await validateSpoolNode(spool.root, spool, 'directory');
  let cursor = spool.root;
  for (const segment of [identity.backupRunId, identity.backupAttemptId, identity.captureId, identity.generation.toString()]) {
    cursor = join(cursor, segment);
    try { await fs.mkdir(cursor, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    await validateSpoolNode(cursor, spool, 'directory');
  }
  const suffix = relative(spool.root, cursor);
  if (!suffix || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new BackupError('BACKUP_SPOOL_UNSAFE', 'Derived worker spool path escaped its root.');
  return cursor;
}

async function protectCapturedTree(path: string, spool: BrokerWorkerSpool): Promise<void> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || stat.dev.toString() !== spool.deviceId || Number(stat.uid) !== spool.ownerUid || Number(stat.gid) !== spool.ownerGid) {
    throw new BackupError('BACKUP_SPOOL_UNSAFE', 'Captured content is outside worker spool ownership.');
  }
  if (stat.isDirectory()) {
    await fs.chmod(path, 0o700);
    for (const name of (await fs.readdir(path)).sort()) await protectCapturedTree(join(path, name), spool);
  } else if (stat.isFile() && stat.nlink === 1n) {
    await fs.chmod(path, 0o600);
  } else {
    throw new BackupError('BACKUP_SPOOL_UNSAFE', 'Captured content contains a special or multiply-linked file.');
  }
}

async function fileEvidence(path: string, spool: BrokerWorkerSpool, signal: AbortSignal): Promise<{ sha256: string; size: bigint }> {
  await validateSpoolNode(path, spool, 'file');
  const stat = await fs.lstat(path, { bigint: true });
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  const abort = () => stream.destroy(signal.reason instanceof Error ? signal.reason : new Error('Backup aborted.'));
  signal.addEventListener('abort', abort, { once: true });
  try { for await (const chunk of stream) { signal.throwIfAborted(); hash.update(chunk); } }
  finally { signal.removeEventListener('abort', abort); }
  return { sha256: hash.digest('hex'), size: stat.size };
}

async function removeOwnedTree(root: string, spool: BrokerWorkerSpool): Promise<void> {
  const visit = async (path: string): Promise<void> => {
    const stat = await fs.lstat(path, { bigint: true });
    if (stat.isDirectory()) {
      await validateSpoolNode(path, spool, 'directory');
      for (const name of await fs.readdir(path)) await visit(join(path, name));
    } else await validateSpoolNode(path, spool, 'file');
  };
  await visit(root);
  await fs.rm(root, { recursive: true, force: false });
}

export async function durablySealBrokerSpool(attemptRoot: string, spool: BrokerWorkerSpool): Promise<void> {
  for (const name of ['database.tar.age', 'objects.tar.age', 'configuration.tar.age']) {
    const path = join(attemptRoot, name); await validateSpoolNode(path, spool, 'file');
    const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
  let directory = attemptRoot;
  for (;;) {
    await validateSpoolNode(directory, spool, 'directory');
    const handle = await fs.open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
    try { await handle.sync(); } finally { await handle.close(); }
    if (directory === spool.root) break;
    directory = dirname(directory);
    if (!directory.startsWith(`${spool.root}${sep}`) && directory !== spool.root) throw new BackupError('BACKUP_SPOOL_UNSAFE', 'Spool durability path escaped its root.');
  }
}

function manifestRecord(manifest: BackupManifestV1): Record<string, unknown> {
  return JSON.parse(serializeBackupManifest(manifest).toString('utf8')) as Record<string, unknown>;
}

export async function runBrokeredEncryptedBackup(input: BrokeredBackupInput, deps: BrokeredBackupDependencies): Promise<{
  manifest: BackupManifestV1; publication: BackupPublicationRecord;
}> {
  input.signal.throwIfAborted();
  if (!Number.isFinite(input.deadlineAt.getTime()) || input.deadlineAt.getTime() <= Date.now()) {
    throw new BackupError('BACKUP_PUBLICATION_AUTHORITY_EXPIRED', 'Authoritative backup attempt deadline is absent or expired.');
  }
  let attemptRoot = '';
  let rawRoot = '';
  const captured = await runConsistentCapture({
    coordinator: deps.coordinator, siteKey: input.siteId, backupRunId: input.runId, backupAttemptId: input.attemptId,
    signal: input.signal,
    stagingRoot: async (identity) => {
      attemptRoot = await createAttemptRoot(deps.spool, identity);
      rawRoot = join(attemptRoot, 'raw');
      await fs.mkdir(rawRoot, { mode: 0o700 });
      await fs.mkdir(join(rawRoot, 'database'), { mode: 0o700 });
      await fs.mkdir(join(rawRoot, 'objects'), { mode: 0o700 });
      return rawRoot;
    },
    copyIntoStaging: async (_identity, staging) => {
      await deps.captureDatabase(join(staging, 'database'), input.signal);
      await deps.captureObjects(join(staging, 'objects'), input.signal);
      await protectCapturedTree(staging, deps.spool);
    },
  });
  return publishBrokeredSealedBackup(input, deps, captured);
}

/** Reuses one exact SQL-SEALED capture; it never starts a barrier or copies source content again. */
export async function publishBrokeredSealedBackup(input: BrokeredBackupInput, deps: BrokeredBackupDependencies, captured: {
  identity: CaptureIdentity; stagingRoot: string; stagingInventoryDigest: string;
}): Promise<{ manifest: BackupManifestV1; publication: BackupPublicationRecord }> {
  input.signal.throwIfAborted();
  if (!Number.isFinite(input.deadlineAt.getTime()) || input.deadlineAt.getTime() <= Date.now()) throw new BackupError('BACKUP_PUBLICATION_AUTHORITY_EXPIRED', 'Authoritative backup attempt deadline is absent or expired.');
  if (captured.identity.backupRunId !== input.runId || captured.identity.backupAttemptId !== input.attemptId || captured.identity.siteKey !== input.siteId) throw new BackupError('BACKUP_INVENTORY_CHANGED', 'Sealed capture differs from the current attempt.');
  const attemptRoot = await createAttemptRoot(deps.spool, captured.identity), rawRoot = join(attemptRoot, 'raw');
  if (resolve(captured.stagingRoot) !== rawRoot) throw new BackupError('BACKUP_SPOOL_UNSAFE', 'Sealed capture staging path differs from its exact attempt.');
  const cleanup = (root: string, phase: 'RAW_AFTER_ENCRYPTION' | 'RAW_FAILURE' | 'AFTER_VERIFIED') => deps.cleanupSpool ? deps.cleanupSpool(root, deps.spool, phase) : removeOwnedTree(root, deps.spool);
  const sealed = await deps.readSealedCapture(captured.identity);
  if (sealed.id !== captured.identity.captureId || sealed.generation !== captured.identity.generation || sealed.stagingInventorySha256 !== captured.stagingInventoryDigest) {
    throw new BackupError('BACKUP_INVENTORY_CHANGED', 'Sealed capture evidence does not match the worker spool.');
  }
  const authority: BrokerAttemptIdentity = {
    runId: input.runId, attemptId: input.attemptId, captureId: sealed.id, captureGeneration: sealed.generation, deadlineAt: input.deadlineAt,
  };

  const artifacts: BackupManifestArtifactV1[] = [];
  try {
    const capsule = await deps.broker.selectCapsule(authority, input.signal);
    await deps.transitionStage?.('PACKAGING');
    const packaged = await (deps.packageComponents ?? packageBackupComponents)({
      rawRoot, packageRoot: join(rawRoot, 'packages'), tarExecutablePath: input.tarExecutablePath,
      signal: input.signal, components: ['database', 'objects'],
    });
    if (packaged.length !== 2 || packaged[0].component !== 'database' || packaged[1].component !== 'objects') {
      throw new BackupError('BACKUP_INTERNAL', 'Brokered packaging must produce only database and objects.');
    }
    await deps.transitionStage?.('ENCRYPTING');
    for (const item of packaged) {
      const output = join(attemptRoot, `${item.component}.tar.age`);
      await (deps.encrypt ?? encryptFileWithAge)({ inputPath: item.outputPath, outputPath: output, recipient: input.encryption.recipient,
        executablePath: input.encryption.executablePath, expectedExecutableSha256: input.encryption.executableSha256,
        expectedVersion: input.encryption.version, signal: input.signal });
      const evidence = await fileEvidence(output, deps.spool, input.signal);
      artifacts.push({ kind: item.component === 'database' ? 'DATABASE' : 'OBJECTS', name: item.component,
        ciphertextPath: basename(output), ciphertextSizeBytes: evidence.size.toString(), ciphertextSha256: evidence.sha256 });
    }
    const configurationPath = join(attemptRoot, 'configuration.tar.age');
    try { await fs.writeFile(configurationPath, capsule, { flag: 'wx', mode: 0o600 }); }
    catch (cause) { if (!deps.resumeSealedArtifacts || (cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; await validateSpoolNode(configurationPath, deps.spool, 'file'); const existing = await fs.open(configurationPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); try { const before = await existing.stat(); if (before.size !== capsule.length || !capsule.equals(await existing.readFile()) || (await existing.stat()).ino !== before.ino) throw new BackupError('BACKUP_INVENTORY_CHANGED', 'Retained configuration ciphertext differs.'); } finally { await existing.close(); } }
    const configuration = await fileEvidence(configurationPath, deps.spool, input.signal);
    artifacts.push({ kind: 'CONFIGURATION', name: 'configuration', ciphertextPath: basename(configurationPath),
      ciphertextSizeBytes: configuration.size.toString(), ciphertextSha256: configuration.sha256 });
    await cleanup(rawRoot, 'RAW_AFTER_ENCRYPTION');
  } catch (error) {
    await fs.lstat(rawRoot).then(() => cleanup(rawRoot, 'RAW_FAILURE')).catch((cleanupError: NodeJS.ErrnoException) => {
      if (cleanupError.code !== 'ENOENT') throw new BackupError('BACKUP_PARTIAL_CLEANUP_FAILED', 'Owned plaintext spool cleanup failed.', undefined, { cause: cleanupError });
    });
    throw error;
  }

  const unsigned: BackupManifestV1 = {
    version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: deps.broker.capability.repository_id }, site: { id: input.siteId },
    run: { id: input.runId, attemptId: input.attemptId }, capture: { id: sealed.id, generation: sealed.generation.toString(),
      startedAt: sealed.startedAt.toISOString(), sealedAt: sealed.sealedAt.toISOString(), stagingInventorySha256: sealed.stagingInventorySha256 },
    release: { id: input.releaseId }, schema: input.schema,
    encryption: { keyId: input.encryption.keyId, tool: { name: 'age', version: input.encryption.version, executableSha256: input.encryption.executableSha256 } },
    artifacts, configurationPolicy: { policySha256: deps.broker.capability.policy_sha256,
      capsuleGeneration: deps.broker.capability.capsule_generation,
      encryptedInventorySha256: deps.broker.capability.encrypted_inventory_sha256 }, signature: null,
  };

  await deps.transitionStage?.('PUBLISHING');
  await (deps.durablySealSpool ?? durablySealBrokerSpool)(attemptRoot, deps.spool);
  const prepared = await deps.broker.prepare({ identity: authority, attemptRoot, unsignedManifest: unsigned, signal: input.signal });
  input.signal.throwIfAborted();
  let publication = await (deps.preparePublication ?? prepareBackupPublication)({ runId: input.runId, attemptId: input.attemptId, captureId: sealed.id,
    repositoryId: deps.broker.capability.repository_id, manifestSha256: prepared.signedSha256,
    incompleteRelativePath: prepared.incompleteRelativePath,
    publishedRelativePath: prepared.publishedRelativePath, pool: deps.pool });
  let evidence;
  try {
    evidence = await deps.broker.commit({ identity: authority, attemptRoot, unsignedSha256: prepared.unsignedSha256,
      signedSha256: prepared.signedSha256, signedBytes: prepared.signedBytes, signal: input.signal });
  } catch (error) {
    const brokerCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string' ? error.code : asBackupError(error).code;
    await (deps.recordPublicationOutcome ?? recordBackupPublicationOutcome)({ publicationId: publication.id, manifestSha256: prepared.signedSha256, outcome: 'UNCERTAIN',
      errorCode: brokerCode, errorMessage: error instanceof Error ? error.message : String(error), pool: deps.pool }).catch(() => undefined);
    throw error;
  }
  input.signal.throwIfAborted();
  publication = await (deps.confirmPublication ?? confirmBackupPublicationPublished)({ publicationId: publication.id, manifestSha256: prepared.signedSha256,
    publishedAt: new Date(evidence.receipt.published_at), pool: deps.pool });
  await deps.transitionStage?.('VERIFYING');
  const completed = await (deps.completePublication ?? completeVerifiedBackupPublication)({ publicationId: publication.id, runId: input.runId, attemptId: input.attemptId,
    captureId: sealed.id, manifestSha256: prepared.signedSha256, repositoryManifest: manifestRecord(prepared.signedManifest), pool: deps.pool });
  if (!completed) throw new BackupError('BACKUP_INTERNAL', 'Verified broker publication lost conditional completion authority.');
  await cleanup(attemptRoot, 'AFTER_VERIFIED');
  return { manifest: prepared.signedManifest, publication };
}
