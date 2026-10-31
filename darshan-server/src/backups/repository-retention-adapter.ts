import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type { BrokerDeletionEntry, BrokerDeletionRecord, BrokerPublicationRecord, BrokerStagingCleanupRecord } from './backup-broker-journal';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import { parseSignedCapsulePolicy, policySha256, type SignedConfigurationCapsulePolicy } from './configuration-capsule-policy';
import {
  assertRepositoryStillMatches,
  ensureRepositoryDirectory,
  openExistingRepositoryDirectory,
  fsyncDirectory,
  parseAttemptOwnershipReceipt,
  type LocalRepository,
} from './local-repository';
import { parseBackupManifest, serializeBackupManifest, serializeUnsignedBackupManifest, verifyBackupManifestSignature, type BackupManifestV1 } from './manifest';
import {
  CONFIGURATION_POLICY_FILE,
  PUBLICATION_INTENT_FILE,
  PUBLICATION_RECEIPT_FILE,
  REPOSITORY_MANIFEST_FILE,
  assertPublishedRunDirectory,
  readAndVerifyPublishedRun,
  readProtectedRepositoryFile,
} from './repository-publication';

const DELETION_DIRECTORY = 'broker-deletions';
const STAGING_DELETION_DIRECTORY = 'broker-staging-deletions';
const MAX_ENTRIES = 64;

export type RetentionFaultStage = 'before-rename' | 'after-rename' | 'before-unlink' | 'after-unlink' | 'before-complete' | 'after-directory-removal' | 'after-complete';

export class RepositoryDeletionError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RepositoryDeletionError';
  }
}

async function validateDirectory(repository: LocalRepository, path: string): Promise<void> {
  const stat = await fs.lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev.toString() !== repository.deviceId ||
      Number(stat.uid) !== repository.ownerUid || Number(stat.gid) !== repository.ownerGid ||
      Number(stat.mode & 0o777n) !== 0o700 || await fs.realpath(path) !== path) {
    throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNSAFE', 'Deletion candidate directory identity is unsafe.');
  }
}

async function hashExpectedFile(input: {
  repository: LocalRepository; path: string; expectedSize?: string; expectedSha256?: string; signal: AbortSignal;
}): Promise<{ size: string; sha256: string; inode: bigint; device: bigint }> {
  input.signal.throwIfAborted();
  const handle = await fs.open(input.path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev.toString() !== input.repository.deviceId ||
        Number(before.uid) !== input.repository.ownerUid || Number(before.gid) !== input.repository.ownerGid ||
        Number(before.mode & 0o777n) !== 0o600 || before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNSAFE', 'Deletion candidate contains an unsafe file.');
    }
    if (input.expectedSize !== undefined && before.size.toString() !== input.expectedSize) {
      throw new RepositoryDeletionError('BROKER_DELETE_EVIDENCE_MISMATCH', 'Deletion candidate size differs from immutable evidence.');
    }
    const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(1024 * 1024); let offset = 0;
    for (;;) {
      input.signal.throwIfAborted();
      const remaining = Number(before.size) + 1 - offset;
      if (remaining <= 0) throw new RepositoryDeletionError('BROKER_DELETE_EVIDENCE_MISMATCH', 'Deletion candidate grew during verification.');
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, remaining), offset);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      if (offset > Number(before.size)) throw new RepositoryDeletionError('BROKER_DELETE_EVIDENCE_MISMATCH', 'Deletion candidate grew during verification.');
    }
    const after = await handle.stat({ bigint: true }); const digest = hash.digest('hex');
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mode !== before.mode ||
        after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || BigInt(offset) !== before.size) {
      throw new RepositoryDeletionError('BROKER_DELETE_EVIDENCE_MISMATCH', 'Deletion candidate changed during verification.');
    }
    if (input.expectedSha256 !== undefined && digest !== input.expectedSha256) {
      throw new RepositoryDeletionError('BROKER_DELETE_EVIDENCE_MISMATCH', 'Deletion candidate digest differs from immutable evidence.');
    }
    return { size: before.size.toString(), sha256: digest, inode: before.ino, device: before.dev };
  } finally { await handle.close(); }
}

async function readProtectedMetadata(repository: LocalRepository, path: string): Promise<Buffer> {
  const handle = await fs.open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev.toString() !== repository.deviceId || Number(before.uid) !== repository.ownerUid ||
        Number(before.gid) !== repository.ownerGid || Number(before.mode & 0o777n) !== 0o600 || before.nlink !== 1n ||
        before.size < 1n || before.size > 64n * 1024n) {
      throw new RepositoryDeletionError('BROKER_STAGING_TREE_UNSAFE', 'Staging ownership evidence is unsafe.');
    }
    const bytes = await handle.readFile(); const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mode !== before.mode ||
        after.uid !== before.uid || after.gid !== before.gid || after.nlink !== before.nlink ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs || BigInt(bytes.byteLength) !== before.size) {
      throw new RepositoryDeletionError('BROKER_STAGING_TREE_UNSAFE', 'Staging ownership evidence changed while read.');
    }
    return bytes;
  } finally { await handle.close(); }
}

function expectedNames(entries: Record<string, BrokerDeletionEntry>): string[] {
  return Object.keys(entries).sort();
}

async function assertExactTree(input: {
  repository: LocalRepository; root: string; entries: Record<string, BrokerDeletionEntry>; signal: AbortSignal;
}): Promise<void> {
  await validateDirectory(input.repository, input.root);
  const names = await fs.readdir(input.root);
  if (names.length > MAX_ENTRIES || JSON.stringify(names.sort()) !== JSON.stringify(expectedNames(input.entries))) {
    throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNEXPECTED', 'Deletion candidate contains missing or unexpected entries.');
  }
  for (const name of names) {
    if (basename(name) !== name || name === '.' || name === '..') throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNSAFE', 'Deletion candidate entry name is unsafe.');
    const expected = input.entries[name];
    if (expected.kind !== 'FILE') throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNSAFE', 'Nested deletion candidates are not supported by this repository contract.');
    await hashExpectedFile({ repository: input.repository, path: join(input.root, name), expectedSize: expected.expected_size ?? undefined,
      expectedSha256: expected.expected_sha256 ?? undefined, signal: input.signal });
  }
}

export class RepositoryRetentionAdapter {
  constructor(private readonly options: {
    repository: LocalRepository;
    policyTrustKeys: ReadonlyMap<string, string>;
    manifestVerificationKeys: ReadonlyMap<string, string>;
    assertAuthority(): Promise<void>;
    fault?(stage: RetentionFaultStage, entry?: string): Promise<void>;
  }) {
    if (options.policyTrustKeys.size < 1 || options.manifestVerificationKeys.size < 1) {
      throw new RepositoryDeletionError('BROKER_DELETE_TRUST_UNAVAILABLE', 'Retention trust keyrings must not be empty.');
    }
  }

  private async verifyManifest(manifest: BackupManifestV1, publication: BrokerPublicationRecord): Promise<void> {
    if (!manifest.signature || manifest.signature.algorithm !== 'Ed25519' || manifest.signature.keyId !== publication.key_id ||
        manifest.signature.valueBase64 !== publication.signature_base64 ||
        createHash('sha256').update(serializeBackupManifest(manifest)).digest('hex') !== publication.signed_manifest_sha256) {
      throw new RepositoryDeletionError('BROKER_DELETE_MANIFEST_TRUST_INVALID', 'Stored manifest does not match durable signed publication evidence.');
    }
    try {
      await verifyBackupManifestSignature(manifest, { verify: async (input) => {
        const key = input.algorithm === 'Ed25519' ? this.options.manifestVerificationKeys.get(input.keyId) : undefined;
        return Boolean(key && verify(null, input.payload, createPublicKey(key), input.signature));
      }});
    } catch (cause) {
      throw new RepositoryDeletionError('BROKER_DELETE_MANIFEST_TRUST_INVALID', 'Stored manifest signature is not trusted by the retained keyring.', { cause });
    }
  }

  async resolvePublishedTrust(publication: BrokerPublicationRecord, signal: AbortSignal): Promise<{
    policy: SignedConfigurationCapsulePolicy;
    policyBytes: Buffer;
    published: Awaited<ReturnType<typeof readAndVerifyPublishedRun>>;
  }> {
    const runs = await openExistingRepositoryDirectory(this.options.repository, 'runs');
    const runPath = join(runs, publication.run_id);
    await assertPublishedRunDirectory(runPath, this.options.repository);
    const policyFile = await readProtectedRepositoryFile(join(runPath, CONFIGURATION_POLICY_FILE), this.options.repository, 1024 * 1024, signal);
    let policy: SignedConfigurationCapsulePolicy;
    try { policy = parseSignedCapsulePolicy(policyFile.bytes, this.options.policyTrustKeys); }
    catch (cause) { throw new RepositoryDeletionError('BROKER_DELETE_POLICY_TRUST_INVALID', 'Stored configuration policy signature is not trusted.', { cause }); }
    if (!policyFile.bytes.equals(canonicalJson(policy)) || policy.policy.site_id !== publication.site_id ||
        policy.policy.repository_id !== publication.repository_id || policySha256(policy) !== publication.policy_sha256 ||
        policy.policy.generation !== publication.capsule_generation) {
      throw new RepositoryDeletionError('BROKER_DELETE_POLICY_TRUST_INVALID', 'Stored configuration policy identity or canonical bytes are invalid.');
    }
    const published = await readAndVerifyPublishedRun({ repository: this.options.repository, runId: publication.run_id, signal,
      trustedConfigurationPolicy: policy });
    const manifest = parseBackupManifest(published.manifestBytes);
    await this.verifyManifest(manifest, publication);
    return { policy, policyBytes: policyFile.bytes, published };
  }

  /** Historical per-run trust verification used by restore-hold admission and recovery selection. */
  async inspectPublished(publication: BrokerPublicationRecord, signal: AbortSignal): Promise<void> {
    const trusted = await this.resolvePublishedTrust(publication, signal);
    if (!trusted.published.receipt || trusted.published.intent.manifest_sha256 !== publication.signed_manifest_sha256) {
      throw new RepositoryDeletionError('BROKER_DELETE_IDENTITY_MISMATCH', 'Published run identity differs from durable publication evidence.');
    }
  }

  async planDeletion(publication: BrokerPublicationRecord, signal: AbortSignal): Promise<Record<string, BrokerDeletionEntry>> {
    const trusted = await this.resolvePublishedTrust(publication, signal);
    const published = trusted.published;
    if (!published.receipt || published.intent.manifest_sha256 !== publication.signed_manifest_sha256 ||
        published.intent.attempt_id !== publication.attempt_id || published.intent.capture_id !== publication.capture_id ||
        published.intent.capture_generation !== publication.capture_generation) {
      throw new RepositoryDeletionError('BROKER_DELETE_IDENTITY_MISMATCH', 'Published run identity differs from deletion claim.');
    }
    if (published.intent.artifacts.some((artifact) => basename(artifact.path) !== artifact.path)) {
      throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNSAFE', 'Published artifact layout is not supported for whole-run deletion.');
    }
    const evidence = new Map<string, { size: string; sha256: string }>(
      published.intent.artifacts.map((artifact) => [artifact.path, { size: artifact.size, sha256: artifact.sha256 }]),
    );
    evidence.set(REPOSITORY_MANIFEST_FILE, { size: published.manifestBytes.byteLength.toString(), sha256: publication.signed_manifest_sha256 });
    evidence.set(CONFIGURATION_POLICY_FILE, { size: trusted.policyBytes.byteLength.toString(), sha256: policySha256(trusted.policy) });
    for (const name of [PUBLICATION_INTENT_FILE, PUBLICATION_RECEIPT_FILE]) {
      const actual = await hashExpectedFile({ repository: this.options.repository, path: join(published.runPath, name), signal });
      evidence.set(name, { size: actual.size, sha256: actual.sha256 });
    }
    if (evidence.size > MAX_ENTRIES) throw new RepositoryDeletionError('BROKER_DELETE_LIMIT_EXCEEDED', 'Deletion candidate exceeds the bounded entry limit.');
    const entries = Object.fromEntries([...evidence.entries()].map(([name, value]) => [name, {
      kind: 'FILE' as const, expected_size: value.size, expected_sha256: value.sha256, status: 'PENDING' as const,
    }]));
    await assertExactTree({ repository: this.options.repository, root: published.runPath, entries, signal });
    return entries;
  }

  async executeDeletion(input: {
    deletion: BrokerDeletionRecord;
    signal: AbortSignal;
    checkpoint(): Promise<void>;
  }): Promise<void> {
    await assertRepositoryStillMatches(this.options.repository);
    const runs = await ensureRepositoryDirectory(this.options.repository, 'runs');
    const deletionRoot = await ensureRepositoryDirectory(this.options.repository, DELETION_DIRECTORY);
    const source = join(runs, input.deletion.run_id);
    const destination = join(deletionRoot, `${input.deletion.run_id}.${input.deletion.operation_id}`);

    if (!input.deletion.namespace_renamed) {
      let sourcePresent = true;
      try { await assertExactTree({ repository: this.options.repository, root: source, entries: input.deletion.entries, signal: input.signal }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') sourcePresent = false; else throw error; }
      if (sourcePresent) {
        await this.options.assertAuthority();
        await this.options.fault?.('before-rename');
        await fs.rename(source, destination);
        await fsyncDirectory(runs); await fsyncDirectory(deletionRoot);
        await this.options.fault?.('after-rename');
      } else {
        try { await assertExactTree({ repository: this.options.repository, root: destination, entries: input.deletion.entries, signal: input.signal }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new RepositoryDeletionError('BROKER_DELETE_BYTES_MISSING_UNCERTAIN', 'Claimed run and broker deletion namespace are both absent.');
          }
          throw error;
        }
      }
      input.deletion.namespace_renamed = true; input.deletion.status = 'RENAMED'; input.deletion.updated_at = new Date().toISOString();
      await input.checkpoint();
    }

    if (Object.values(input.deletion.entries).every((entry) => entry.status === 'DELETED')) {
      await this.options.assertAuthority(); await assertRepositoryStillMatches(this.options.repository);
      const sourceMissing = await fs.lstat(source).then(() => false, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return true; throw error;
      });
      const destinationMissing = await fs.lstat(destination).then(() => false, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return true; throw error;
      });
      if (sourceMissing && destinationMissing) {
        await fsyncDirectory(deletionRoot); await fsyncDirectory(runs);
        input.deletion.status = 'DELETED'; input.deletion.updated_at = new Date().toISOString(); input.deletion.last_error_code = null;
        await input.checkpoint(); return;
      }
    }

    await validateDirectory(this.options.repository, destination);
    const currentNames = new Set(await fs.readdir(destination));
    if (currentNames.size > MAX_ENTRIES || [...currentNames].some((name) => !input.deletion.entries[name] || input.deletion.entries[name].status === 'DELETED')) {
      throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNEXPECTED', 'Deletion namespace contains an unexpected or reappeared entry.');
    }
    for (const [name, entry] of Object.entries(input.deletion.entries)) {
      if (entry.status === 'DELETED') continue;
      if (!currentNames.has(name)) {
        // The durable claim plus broker-owned renamed namespace proves that a
        // missing pending file can only be retained crash progress.
        entry.status = 'DELETED'; input.deletion.status = 'PARTIAL'; input.deletion.updated_at = new Date().toISOString(); await input.checkpoint();
        continue;
      }
      await hashExpectedFile({ repository: this.options.repository, path: join(destination, name), expectedSize: entry.expected_size ?? undefined,
        expectedSha256: entry.expected_sha256 ?? undefined, signal: input.signal });
    }
    input.deletion.status = 'DELETING'; input.deletion.updated_at = new Date().toISOString(); await input.checkpoint();
    for (const name of expectedNames(input.deletion.entries)) {
      const entry = input.deletion.entries[name]; if (entry.status === 'DELETED') continue;
      const path = join(destination, name);
      let actual: Awaited<ReturnType<typeof hashExpectedFile>>;
      try { actual = await hashExpectedFile({ repository: this.options.repository, path, expectedSize: entry.expected_size ?? undefined,
        expectedSha256: entry.expected_sha256 ?? undefined, signal: input.signal }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Only a durable exact claim in the broker-owned namespace can turn a
          // missing pending entry into crash-recovery progress.
          entry.status = 'DELETED'; input.deletion.status = 'PARTIAL'; input.deletion.updated_at = new Date().toISOString(); await input.checkpoint(); continue;
        }
        throw error;
      }
      const link = await fs.lstat(path, { bigint: true });
      if (!link.isFile() || link.isSymbolicLink() || link.dev !== actual.device || link.ino !== actual.inode || link.nlink !== 1n) {
        throw new RepositoryDeletionError('BROKER_DELETE_SWAP_DETECTED', 'Deletion candidate entry changed at the destructive boundary.');
      }
      await this.options.assertAuthority(); input.signal.throwIfAborted();
      await this.options.fault?.('before-unlink', name);
      const boundary = await fs.lstat(path, { bigint: true });
      if (!boundary.isFile() || boundary.isSymbolicLink() || boundary.dev !== actual.device || boundary.ino !== actual.inode ||
          boundary.nlink !== 1n || Number(boundary.uid) !== this.options.repository.ownerUid ||
          Number(boundary.gid) !== this.options.repository.ownerGid || Number(boundary.mode & 0o777n) !== 0o600) {
        throw new RepositoryDeletionError('BROKER_DELETE_SWAP_DETECTED', 'Deletion candidate entry changed at the final destructive boundary.');
      }
      await fs.unlink(path); await fsyncDirectory(destination);
      await this.options.fault?.('after-unlink', name);
      entry.status = 'DELETED'; input.deletion.status = 'PARTIAL'; input.deletion.updated_at = new Date().toISOString(); await input.checkpoint();
    }
    await this.options.assertAuthority();
    await this.options.fault?.('before-complete');
    if ((await fs.readdir(destination)).length !== 0) throw new RepositoryDeletionError('BROKER_DELETE_TREE_UNEXPECTED', 'Deletion namespace is not empty at completion.');
    await fs.rmdir(destination); await fsyncDirectory(deletionRoot); await fsyncDirectory(runs);
    await this.options.fault?.('after-directory-removal');
    try { await fs.lstat(source); throw new RepositoryDeletionError('BROKER_DELETE_COMPLETION_UNCERTAIN', 'Published run reappeared during deletion completion.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    input.deletion.status = 'DELETED'; input.deletion.updated_at = new Date().toISOString(); input.deletion.last_error_code = null;
    await input.checkpoint(); await this.options.fault?.('after-complete');
  }

  async cleanupStaging(input: {
    publication: BrokerPublicationRecord;
    cleanup: BrokerStagingCleanupRecord;
    signal: AbortSignal;
    checkpoint(): Promise<void>;
  }): Promise<'CLEANED' | 'ABSENT'> {
    if (input.publication.status !== 'QUARANTINED' || !input.publication.attempt_directory) {
      throw new RepositoryDeletionError('BROKER_STAGING_NOT_TERMINAL', 'Only an exactly owned quarantined attempt can be cleaned.');
    }
    await assertRepositoryStillMatches(this.options.repository);
    const quarantine = await ensureRepositoryDirectory(this.options.repository, 'quarantine');
    const cleanupRoot = await ensureRepositoryDirectory(this.options.repository, STAGING_DELETION_DIRECTORY);
    const source = join(quarantine, input.publication.attempt_directory);
    const destination = join(cleanupRoot, `${input.publication.attempt_directory}.${input.cleanup.operation_id}`);
    const unsignedManifest = parseBackupManifest(Buffer.from(input.publication.unsigned_manifest_base64, 'base64'));
    if (unsignedManifest.signature !== null || !serializeUnsignedBackupManifest(unsignedManifest).equals(Buffer.from(input.publication.unsigned_manifest_base64, 'base64'))) {
      throw new RepositoryDeletionError('BROKER_STAGING_IDENTITY_MISMATCH', 'Staging publication has invalid canonical unsigned manifest evidence.');
    }
    const manifest = { ...unsignedManifest, signature: { algorithm: 'Ed25519' as const, keyId: input.publication.key_id, valueBase64: input.publication.signature_base64 } };
    await this.verifyManifest(manifest, input.publication);
    const expectedPrepared = new Map(manifest.artifacts.map((artifact) => [artifact.ciphertextPath, {
      size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256,
    }]));
    let preparedPolicyFile: Awaited<ReturnType<typeof readProtectedRepositoryFile>>;
    try { preparedPolicyFile = await readProtectedRepositoryFile(join(source, 'prepared', CONFIGURATION_POLICY_FILE), this.options.repository, 1024 * 1024, input.signal); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      preparedPolicyFile = await readProtectedRepositoryFile(join(destination, 'prepared', CONFIGURATION_POLICY_FILE), this.options.repository, 1024 * 1024, input.signal);
    }
    let preparedPolicy: SignedConfigurationCapsulePolicy;
    try { preparedPolicy = parseSignedCapsulePolicy(preparedPolicyFile.bytes, this.options.policyTrustKeys); }
    catch (cause) { throw new RepositoryDeletionError('BROKER_DELETE_POLICY_TRUST_INVALID', 'Stored staging configuration policy signature is not trusted.', { cause }); }
    const binding = manifest.configurationPolicy;
    if (!preparedPolicyFile.bytes.equals(canonicalJson(preparedPolicy)) || !binding ||
        binding.policySha256 !== policySha256(preparedPolicy) || binding.capsuleGeneration !== preparedPolicy.policy.generation ||
        binding.encryptedInventorySha256 !== preparedPolicy.policy.encrypted_inventory_sha256 ||
        preparedPolicy.policy.site_id !== input.publication.site_id || preparedPolicy.policy.repository_id !== input.publication.repository_id) {
      throw new RepositoryDeletionError('BROKER_DELETE_POLICY_TRUST_INVALID', 'Stored staging policy does not match the publication manifest.');
    }
    expectedPrepared.set(CONFIGURATION_POLICY_FILE, { size: preparedPolicyFile.size.toString(), sha256: preparedPolicyFile.sha256 });

    const validate = async (root: string, allowMissing: boolean): Promise<void> => {
      await validateDirectory(this.options.repository, root);
      const ownership = parseAttemptOwnershipReceipt(parseStrictJson(
        await readProtectedMetadata(this.options.repository, join(root, 'ownership.json')), 64 * 1024,
      ));
      if (ownership.run_id !== input.publication.run_id || ownership.attempt_id !== input.publication.attempt_id ||
          ownership.capture_id !== input.publication.capture_id || ownership.capture_generation !== input.publication.capture_generation ||
          ownership.repository_id !== input.publication.repository_id || ownership.site_id !== input.publication.site_id ||
          input.publication.attempt_directory !== `${ownership.run_id}.${ownership.attempt_id}.${ownership.owner_nonce}`) {
        throw new RepositoryDeletionError('BROKER_STAGING_IDENTITY_MISMATCH', 'Staging cleanup ownership does not match durable publication evidence.');
      }
      const rootNames = (await fs.readdir(root)).sort();
      if (rootNames.some((name) => name !== 'ownership.json' && name !== 'prepared') || !rootNames.includes('ownership.json')) {
        throw new RepositoryDeletionError('BROKER_STAGING_TREE_UNEXPECTED', 'Staging cleanup candidate contains unexpected evidence.');
      }
      if (!rootNames.includes('prepared')) {
        if (allowMissing) return;
        throw new RepositoryDeletionError('BROKER_STAGING_TREE_UNEXPECTED', 'Staging prepared directory is missing.');
      }
      const prepared = join(root, 'prepared'); await validateDirectory(this.options.repository, prepared);
      const names = new Set(await fs.readdir(prepared));
      if ([...names].some((name) => !expectedPrepared.has(name)) || (!allowMissing && names.size !== expectedPrepared.size)) {
        throw new RepositoryDeletionError('BROKER_STAGING_TREE_UNEXPECTED', 'Staging prepared directory has missing or unexpected files.');
      }
      for (const name of names) {
        const expected = expectedPrepared.get(name)!;
        await hashExpectedFile({ repository: this.options.repository, path: join(prepared, name), expectedSize: expected.size, expectedSha256: expected.sha256, signal: input.signal });
      }
    };

    if (input.cleanup.status !== 'RENAMED' && input.cleanup.status !== 'CLEANED') {
      try {
        await validate(source, false); await this.options.assertAuthority(); await fs.rename(source, destination);
        await fsyncDirectory(quarantine); await fsyncDirectory(cleanupRoot);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        try { await validate(destination, true); }
        catch (nested) {
          if ((nested as NodeJS.ErrnoException).code === 'ENOENT') throw new RepositoryDeletionError('BROKER_STAGING_ABSENCE_UNCERTAIN', 'Claimed staging bytes are absent from both owned namespaces.');
          throw nested;
        }
      }
      input.cleanup.status = 'RENAMED'; await input.checkpoint();
    }
    try { await validate(destination, true); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && input.cleanup.status === 'RENAMED') return 'CLEANED';
      throw error;
    }
    const prepared = join(destination, 'prepared');
    for (const name of await fs.readdir(prepared).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      await this.options.assertAuthority(); await fs.unlink(join(prepared, name)); await fsyncDirectory(prepared);
    }
    await fs.rmdir(prepared).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await this.options.assertAuthority(); await fs.unlink(join(destination, 'ownership.json'));
    await fs.rmdir(destination); await fsyncDirectory(cleanupRoot); await fsyncDirectory(quarantine);
    return 'CLEANED';
  }
}
