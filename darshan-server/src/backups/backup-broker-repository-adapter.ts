import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BackupBrokerRequest, BrokerPublicationEvidence } from './backup-broker-protocol';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import type { BrokerPublicationRecord } from './backup-broker-journal';
import { policySha256, type SignedConfigurationCapsulePolicy } from './configuration-capsule-policy';
import { createOwnedAttemptDirectory, ensureRepositoryDirectory, fsyncDirectory, parseAttemptOwnershipReceipt, readAttemptOwnership, repositoryPath, writeExclusiveRepositoryFile, type LocalRepository } from './local-repository';
import type { BackupManifestV1 } from './manifest';
import { CONFIGURATION_POLICY_FILE, completePublishedRunReceipt, publishRunDirectory, readAndVerifyPublishedRun, repositoryManifestViewFromBackupManifest } from './repository-publication';

export interface BackupBrokerRepositoryAdapterOptions {
  repository: LocalRepository; spoolRoot: string; spoolDeviceId: string; spoolOwnerUid: number; spoolOwnerGid: number;
  encryptedCapsule: Uint8Array;
  configurationPolicy: SignedConfigurationCapsulePolicy;
  fault?(stage: 'after-prepare-fsync' | 'after-publish-before-journal'): Promise<void>;
  writeDestination?(handle: FileHandle, buffer: Uint8Array, offset: number, length: number, position: number): Promise<number>;
}

export class BackupBrokerRepositoryAdapter {
  constructor(private readonly options: BackupBrokerRepositoryAdapterOptions) {}

  private async spoolDirectory(request: Extract<BackupBrokerRequest, { run_id: string }>): Promise<string> {
    if (!isAbsolute(this.options.spoolRoot) || resolve(this.options.spoolRoot) !== this.options.spoolRoot) throw new Error('Broker spool root must be canonical and absolute.');
    const root = await fs.lstat(this.options.spoolRoot, { bigint: true });
    if (root.isSymbolicLink() || !root.isDirectory() || root.dev.toString() !== this.options.spoolDeviceId || Number(root.uid) !== this.options.spoolOwnerUid || Number(root.gid) !== this.options.spoolOwnerGid || Number(root.mode & 0o777n) !== 0o700 || await fs.realpath(this.options.spoolRoot) !== this.options.spoolRoot) throw new Error('Broker spool root is unsafe.');
    const directory = resolve(this.options.spoolRoot, request.run_id, request.attempt_id, request.capture_id, request.capture_generation.toString());
    const suffix = relative(this.options.spoolRoot, directory);
    if (!suffix || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new Error('Derived broker spool path escaped its root.');
    let cursor = this.options.spoolRoot;
    for (const segment of [request.run_id, request.attempt_id, request.capture_id, request.capture_generation.toString()]) {
      cursor = join(cursor, segment); const stat = await fs.lstat(cursor, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== this.options.spoolDeviceId || Number(stat.uid) !== this.options.spoolOwnerUid || Number(stat.gid) !== this.options.spoolOwnerGid || Number(stat.mode & 0o777n) !== 0o700) throw new Error('Derived broker spool directory hierarchy is unsafe.');
    }
    if (await fs.realpath(directory) !== directory) throw new Error('Derived broker spool directory traverses a symbolic link.');
    return directory;
  }

  private async copyVerified(source: string, destination: string, expected: { ciphertextSizeBytes: string; ciphertextSha256: string }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const expectedSize = BigInt(expected.ciphertextSizeBytes);
    if (expectedSize < 0n || expectedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Expected ciphertext size is outside safe streaming bounds.');
    const sourceHandle = await fs.open(source, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
    let destinationHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      destinationHandle = await fs.open(destination, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
      const before = await sourceHandle.stat({ bigint: true });
      if (!before.isFile() || before.dev.toString() !== this.options.spoolDeviceId || Number(before.uid) !== this.options.spoolOwnerUid || Number(before.gid) !== this.options.spoolOwnerGid || Number(before.mode & 0o777n) !== 0o600 || before.nlink !== 1n) throw new Error('Spool ciphertext is not a protected single-link regular file.');
      if (before.size !== expectedSize) throw new Error('Spool ciphertext size does not match the canonical manifest before streaming.');
      const hash = createHash('sha256'); let offset = 0; let destinationOffset = 0; const buffer = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        signal.throwIfAborted();
        const remainingWithSentinel = Number(expectedSize) + 1 - offset;
        if (remainingWithSentinel <= 0) throw new Error('Spool ciphertext exceeded its declared size.');
        const { bytesRead } = await sourceHandle.read(buffer, 0, Math.min(buffer.length, remainingWithSentinel), offset); if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); let written = 0;
        while (written < chunk.length) {
          const bytesWritten = this.options.writeDestination
            ? await this.options.writeDestination(destinationHandle, chunk, written, chunk.length - written, destinationOffset + written)
            : (await destinationHandle.write(chunk, written, chunk.length - written, destinationOffset + written)).bytesWritten;
          if (bytesWritten <= 0) throw new Error('Destination ciphertext write made no progress.'); written += bytesWritten;
        }
        offset += bytesRead; destinationOffset += written;
        if (offset > Number(expectedSize)) throw new Error('Spool ciphertext exceeded its declared size.');
      }
      const after = await sourceHandle.stat({ bigint: true });
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw new Error('Spool ciphertext changed while it was copied.');
      if (offset !== Number(expectedSize) || hash.digest('hex') !== expected.ciphertextSha256) throw new Error('Spool ciphertext does not match the canonical manifest.');
      await destinationHandle.sync();
    } finally { await Promise.allSettled([sourceHandle.close(), ...(destinationHandle ? [destinationHandle.close()] : [])]); }
  }

  private async verifyPreparedFile(path: string, expected: { ciphertextSizeBytes: string; ciphertextSha256: string }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted(); const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.dev.toString() !== this.options.repository.deviceId || Number(stat.uid) !== this.options.repository.ownerUid || Number(stat.gid) !== this.options.repository.ownerGid || Number(stat.mode & 0o777n) !== 0o600 || stat.nlink !== 1n || stat.size.toString() !== expected.ciphertextSizeBytes) throw new Error('Prepared ciphertext is unsafe or has the wrong size.');
      const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024); let offset = 0;
      for (;;) { signal.throwIfAborted(); const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead; }
      if (hash.digest('hex') !== expected.ciphertextSha256) throw new Error('Prepared ciphertext digest mismatch.');
    } finally { await handle.close(); }
  }

  private async verifyPrepared(path: string, manifest: BackupManifestV1, signal: AbortSignal): Promise<void> {
    const stat = await fs.lstat(path, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== this.options.repository.deviceId || Number(stat.uid) !== this.options.repository.ownerUid || Number(stat.gid) !== this.options.repository.ownerGid || Number(stat.mode & 0o777n) !== 0o700) throw new Error('Prepared directory is unsafe.');
    const entries = (await fs.readdir(path)).sort();
    if (JSON.stringify(entries) !== JSON.stringify([CONFIGURATION_POLICY_FILE, 'configuration.tar.age', 'database.tar.age', 'objects.tar.age'])) throw new Error('Prepared directory has missing or unexpected entries.');
    for (const artifact of manifest.artifacts) await this.verifyPreparedFile(join(path, artifact.ciphertextPath), artifact, signal);
    const policyBytes = canonicalJson(this.options.configurationPolicy);
    await this.verifyPreparedFile(join(path, CONFIGURATION_POLICY_FILE), {
      ciphertextSizeBytes: policyBytes.byteLength.toString(), ciphertextSha256: policySha256(this.options.configurationPolicy),
    }, signal);
  }

  async prepare(input: { request: Extract<BackupBrokerRequest, { operation: 'PREPARE_PUBLICATION' }>; manifest: BackupManifestV1; signedManifestBytes: Buffer; signal: AbortSignal }): Promise<string> {
    const spool = await this.spoolDirectory(input.request);
    const ownerNonce = createHash('sha256').update(`${input.request.repository_id}:${input.request.run_id}:${input.request.attempt_id}:${input.request.capture_id}:${input.request.capture_generation}`).digest('hex').slice(0, 32);
    const incomplete = await ensureRepositoryDirectory(this.options.repository, 'incomplete');
    const expectedPath = join(incomplete, `${input.request.run_id}.${input.request.attempt_id}.${ownerNonce}`);
    try {
      const directory = await fs.lstat(expectedPath, { bigint: true });
      if (directory.isSymbolicLink() || !directory.isDirectory() || directory.dev.toString() !== this.options.repository.deviceId || Number(directory.uid) !== this.options.repository.ownerUid || Number(directory.gid) !== this.options.repository.ownerGid || Number(directory.mode & 0o777n) !== 0o700) throw new Error('Existing deterministic attempt directory is unsafe.');
      let receipt;
      try { receipt = await readAttemptOwnership(this.options.repository, expectedPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (receipt && (receipt.run_id !== input.request.run_id || receipt.attempt_id !== input.request.attempt_id || receipt.capture_id !== input.request.capture_id || receipt.capture_generation !== input.request.capture_generation || receipt.owner_nonce !== ownerNonce)) throw new Error('Existing deterministic attempt belongs to another identity.');
      if (receipt) {
        let valid = true;
        try { await this.verifyPrepared(join(expectedPath, 'prepared'), input.manifest, input.signal); } catch { valid = false; }
        if (valid) { await this.options.fault?.('after-prepare-fsync'); return basename(expectedPath); }
      }
      throw new Error('Uncertain deterministic prepared evidence was preserved for operator reconciliation.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const owned = await createOwnedAttemptDirectory({ repository: this.options.repository, runId: input.request.run_id, attemptId: input.request.attempt_id, captureId: input.request.capture_id, captureGeneration: input.request.capture_generation, ownerNonce });
    const prepared = join(owned.path, 'prepared'); await fs.mkdir(prepared, { mode: 0o700 });
    try {
      for (const name of ['database', 'objects'] as const) {
        const artifact = input.manifest.artifacts.find((candidate) => candidate.name === name)!;
        await this.copyVerified(join(spool, `${name}.tar.age`), join(prepared, `${name}.tar.age`), artifact, input.signal);
      }
      const configuration = input.manifest.artifacts.find((candidate) => candidate.name === 'configuration')!;
      if (createHash('sha256').update(this.options.encryptedCapsule).digest('hex') !== configuration.ciphertextSha256 || this.options.encryptedCapsule.byteLength.toString() !== configuration.ciphertextSizeBytes) throw new Error('Active capsule no longer matches manifest.');
      await writeExclusiveRepositoryFile(join(prepared, 'configuration.tar.age'), this.options.encryptedCapsule);
      await writeExclusiveRepositoryFile(join(prepared, CONFIGURATION_POLICY_FILE), canonicalJson(this.options.configurationPolicy));
      await fsyncDirectory(prepared); await fsyncDirectory(owned.path); await this.options.fault?.('after-prepare-fsync');
      return basename(owned.path);
    } catch (error) { throw error; }
  }

  private async verifiedEvidence(publication: BrokerPublicationRecord, signal: AbortSignal): Promise<BrokerPublicationEvidence> {
    const published = await readAndVerifyPublishedRun({ repository: this.options.repository, runId: publication.run_id, signal,
      trustedConfigurationPolicy: this.options.configurationPolicy });
    if (!published.receipt || published.intent.repository_id !== publication.repository_id || published.intent.site_id !== publication.site_id || published.intent.attempt_id !== publication.attempt_id || published.intent.capture_id !== publication.capture_id || published.intent.capture_generation !== publication.capture_generation || published.intent.manifest_sha256 !== publication.signed_manifest_sha256) throw new Error('Published repository truth conflicts with durable broker journal.');
    const manifestBytes = published.manifestBytes;
    if (createHash('sha256').update(manifestBytes).digest('hex') !== publication.signed_manifest_sha256) throw new Error('Published signed manifest digest conflicts with durable broker journal.');
    return {
      verified: true, run_relative_path: `runs/${publication.run_id}`, manifest_relative_path: `runs/${publication.run_id}/manifest.json`,
      configuration_policy_relative_path: `runs/${publication.run_id}/${CONFIGURATION_POLICY_FILE}`,
      canonical_signed_manifest_base64: manifestBytes.toString('base64'),
      canonical_signed_configuration_policy_base64: published.configurationPolicy!.bytes.toString('base64'),
      configuration_policy_sha256: published.configurationPolicy!.sha256,
      capsule_generation: published.configurationPolicy!.capsuleGeneration,
      encrypted_inventory_sha256: published.configurationPolicy!.encryptedInventorySha256,
      intent: published.intent, receipt: published.receipt,
    };
  }

  async inspect(publication: BrokerPublicationRecord, signal: AbortSignal): Promise<BrokerPublicationEvidence> {
    return this.verifiedEvidence(publication, signal);
  }

  async commit(input: { publication: BrokerPublicationRecord; manifest: BackupManifestV1; signedManifestBytes: Buffer; signal: AbortSignal }): Promise<BrokerPublicationEvidence> {
    if (!input.publication.attempt_directory) throw new Error('Prepared publication has no broker-owned attempt directory.');
    if (createHash('sha256').update(input.signedManifestBytes).digest('hex') !== input.publication.signed_manifest_sha256) throw new Error('Signed manifest bytes do not match durable broker journal.');
    const view = repositoryManifestViewFromBackupManifest(input.manifest);
    try {
      const published = await readAndVerifyPublishedRun({ repository: this.options.repository, runId: input.publication.run_id, requireReceipt: false, signal: input.signal,
        trustedConfigurationPolicy: this.options.configurationPolicy });
      if (published.intent.repository_id !== input.publication.repository_id || published.intent.site_id !== input.publication.site_id || published.intent.attempt_id !== input.publication.attempt_id || published.intent.capture_id !== input.publication.capture_id || published.intent.capture_generation !== input.publication.capture_generation || published.intent.manifest_sha256 !== input.publication.signed_manifest_sha256 || JSON.stringify(published.intent.artifacts) !== JSON.stringify(view.artifacts)) throw new Error('Published repository truth conflicts with durable broker journal.');
      if (!published.receipt) await completePublishedRunReceipt({ repository: this.options.repository, runId: input.publication.run_id, now: new Date(), signal: input.signal,
        trustedConfigurationPolicy: this.options.configurationPolicy });
      await this.options.fault?.('after-publish-before-journal'); return this.verifiedEvidence(input.publication, input.signal);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const attemptPath = repositoryPath(this.options.repository, 'incomplete', input.publication.attempt_directory);
    await publishRunDirectory({ repository: this.options.repository, attemptPath, preparedPath: join(attemptPath, 'prepared'), manifestBytes: input.signedManifestBytes,
      manifest: view, signal: input.signal, trustedConfigurationPolicy: this.options.configurationPolicy });
    await this.options.fault?.('after-publish-before-journal');
    return this.verifiedEvidence(input.publication, input.signal);
  }

  async quarantine(publication: BrokerPublicationRecord): Promise<void> {
    if (!publication.attempt_directory) throw new Error('Prepared publication has no broker-owned attempt directory.');
    const attemptPath = repositoryPath(this.options.repository, 'incomplete', publication.attempt_directory);
    const ownership = await readAttemptOwnership(this.options.repository, attemptPath);
    if (ownership.run_id !== publication.run_id || ownership.attempt_id !== publication.attempt_id || ownership.capture_id !== publication.capture_id || ownership.capture_generation !== publication.capture_generation) throw new Error('Prepared attempt ownership does not match journal.');
    const quarantine = await ensureRepositoryDirectory(this.options.repository, 'quarantine');
    const destination = join(quarantine, publication.attempt_directory);
    try { await fs.rename(attemptPath, destination); await fsyncDirectory(quarantine); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const directory = await fs.lstat(destination, { bigint: true });
      const receiptFile = join(destination, 'ownership.json'); const receiptStat = await fs.lstat(receiptFile, { bigint: true });
      if (directory.isSymbolicLink() || !directory.isDirectory() || directory.dev.toString() !== this.options.repository.deviceId ||
          receiptStat.isSymbolicLink() || !receiptStat.isFile() || receiptStat.dev.toString() !== this.options.repository.deviceId ||
          Number(receiptStat.uid) !== this.options.repository.ownerUid || Number(receiptStat.gid) !== this.options.repository.ownerGid || Number(receiptStat.mode & 0o777n) !== 0o600) throw new Error('Existing quarantine entry is unsafe.');
      const receipt = parseAttemptOwnershipReceipt(parseStrictJson(await fs.readFile(receiptFile), 64 * 1024));
      if (receipt.run_id !== publication.run_id || receipt.attempt_id !== publication.attempt_id || receipt.capture_id !== publication.capture_id || receipt.capture_generation !== publication.capture_generation) throw new Error('Existing quarantine entry belongs to another publication.');
    }
  }
}
