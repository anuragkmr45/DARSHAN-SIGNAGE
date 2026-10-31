import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrokerDeletionRecord, BrokerPublicationRecord } from './backup-broker-journal';
import { canonicalJson, parseStrictJson } from './backup-broker-protocol';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from './configuration-capsule-inventory';
import { policySha256, signCapsulePolicy } from './configuration-capsule-policy';
import type { LocalRepository } from './local-repository';
import { serializeBackupManifest, serializeUnsignedBackupManifest, type BackupManifestV1 } from './manifest';
import { RepositoryMutationAuthority } from './repository-mutation-authority';
import { RepositoryRetentionAdapter, type RetentionFaultStage } from './repository-retention-adapter';
import { selectTrustedRecoverySource } from '../recovery/repository-source';
import {
  CONFIGURATION_POLICY_FILE, PUBLICATION_INTENT_FILE, PUBLICATION_RECEIPT_FILE, REPOSITORY_MANIFEST_FILE,
} from './repository-publication';

const roots: string[] = [];
const execFileAsync = promisify(execFile);
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture(fault?: (stage: RetentionFaultStage, entry?: string) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), 'retention-repository-')); roots.push(root);
  const repositoryId = randomUUID();
  await fs.writeFile(join(root, 'repository.json'), canonicalJson({ format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId }), { mode: 0o600 });
  const stat = await fs.stat(root, { bigint: true });
  const repository: LocalRepository = Object.freeze({ root, identity: { format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId },
    deviceId: stat.dev.toString(), inode: stat.ino.toString(), ownerUid: Number(stat.uid), ownerGid: Number(stat.gid), mode: 0o700 });
  const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 7 };
  const policyKey = generateKeyPairSync('ed25519'); const manifestKey = generateKeyPairSync('ed25519');
  const policyPrivatePem = policyKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const policyPublicPem = policyKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const manifestPublicPem = manifestKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const policy = signCapsulePolicy({ privateKeyPem: policyPrivatePem, keyId: 'policy-old', policy: { version: 2, generation: 'generation-1', site_id: 'site-a', repository_id: repositoryId,
    created_at: '2026-10-28T08:00:00.000Z', capsule_sha256: digest(Buffer.from('configuration')), capsule_size_bytes: '13',
    release_generation: 'release-01', deployment_generation: 'deployment-1', compatibility_generation: 1,
    age_recipient_key_id: 'age-1', contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, encrypted_inventory_sha256: 'a'.repeat(64),
    required_roles: [...REQUIRED_CAPSULE_ROLES] } });
  const files = { 'database.tar.age': Buffer.from('database'), 'objects.tar.age': Buffer.from('objects'), 'configuration.tar.age': Buffer.from('configuration') };
  const unsignedManifest: BackupManifestV1 = { version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: repositoryId }, site: { id: 'site-a' },
    run: { id: ids.run_id, attemptId: ids.attempt_id }, capture: { id: ids.capture_id, generation: '7', startedAt: '2026-10-28T09:00:00.000Z', sealedAt: '2026-10-28T09:01:00.000Z', stagingInventorySha256: 'b'.repeat(64) },
    release: { id: 'release-01' }, schema: { migrationId: '0051_local_backup_publication', fingerprintSha256: 'c'.repeat(64) },
    encryption: { keyId: 'age-1', tool: { name: 'age', version: '1.3.2', executableSha256: 'd'.repeat(64) } },
    artifacts: [
      { kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: files['database.tar.age'].byteLength.toString(), ciphertextSha256: digest(files['database.tar.age']) },
      { kind: 'OBJECTS', name: 'objects', ciphertextPath: 'objects.tar.age', ciphertextSizeBytes: files['objects.tar.age'].byteLength.toString(), ciphertextSha256: digest(files['objects.tar.age']) },
      { kind: 'CONFIGURATION', name: 'configuration', ciphertextPath: 'configuration.tar.age', ciphertextSizeBytes: files['configuration.tar.age'].byteLength.toString(), ciphertextSha256: digest(files['configuration.tar.age']) },
    ], configurationPolicy: { policySha256: policySha256(policy), capsuleGeneration: 'generation-1', encryptedInventorySha256: 'a'.repeat(64) },
    signature: null };
  const unsignedManifestBytes = serializeUnsignedBackupManifest(unsignedManifest);
  const manifest: BackupManifestV1 = { ...unsignedManifest, signature: { algorithm: 'Ed25519', keyId: 'manifest-old',
    valueBase64: sign(null, unsignedManifestBytes, manifestKey.privateKey).toString('base64') } };
  const manifestBytes = serializeBackupManifest(manifest); const manifestSha256 = digest(manifestBytes);
  const run = join(root, 'runs', ids.run_id); await fs.mkdir(run, { recursive: true, mode: 0o700 });
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(join(run, name), bytes, { mode: 0o600 });
  await fs.writeFile(join(run, REPOSITORY_MANIFEST_FILE), manifestBytes, { mode: 0o600 });
  await fs.writeFile(join(run, CONFIGURATION_POLICY_FILE), canonicalJson(policy), { mode: 0o600 });
  const identity = { repository_id: repositoryId, site_id: 'site-a', ...ids, manifest_sha256: manifestSha256 };
  const artifacts = manifest.artifacts.map((artifact) => ({ path: artifact.ciphertextPath, size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256 }));
  await fs.writeFile(join(run, PUBLICATION_INTENT_FILE), canonicalJson({ format: 'darshan-backup-publication-intent-v1', ...identity, created_at: '2026-10-28T09:02:00.000Z', artifacts }), { mode: 0o600 });
  await fs.writeFile(join(run, PUBLICATION_RECEIPT_FILE), canonicalJson({ format: 'darshan-backup-publication-receipt-v1', ...identity, published_at: '2026-10-28T09:03:00.000Z', verified_at: '2026-10-28T09:04:00.000Z' }), { mode: 0o600 });
  const publication: BrokerPublicationRecord = { site_id: 'site-a', repository_id: repositoryId, ...ids, policy_sha256: policySha256(policy), capsule_generation: 'generation-1',
    unsigned_manifest_sha256: digest(unsignedManifestBytes), signed_manifest_sha256: manifestSha256, key_id: 'manifest-old', signature_base64: manifest.signature!.valueBase64,
    unsigned_manifest_base64: unsignedManifestBytes.toString('base64'), attempt_directory: null, status: 'COMMITTED' };
  let authorityChecks = 0;
  const policyTrustKeys = new Map([['policy-old', policyPublicPem]]); const manifestVerificationKeys = new Map([['manifest-old', manifestPublicPem]]);
  const adapter = new RepositoryRetentionAdapter({ repository, policyTrustKeys, manifestVerificationKeys,
    assertAuthority: async () => { authorityChecks += 1; }, fault });
  const entries = await adapter.planDeletion(publication, new AbortController().signal);
  const now = new Date().toISOString();
  const deletion: BrokerDeletionRecord = { site_id: 'site-a', repository_id: repositoryId, ...ids, manifest_sha256: manifestSha256,
    operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID(), status: 'CLAIMED', claimed_at: now, updated_at: now,
    namespace_renamed: false, entries, last_error_code: null };
  return { root, run, repository, policy, publication, manifest, files, ids, adapter, deletion, policyTrustKeys, manifestVerificationKeys,
    authorityChecks: () => authorityChecks };
}

describe('repository retention authority and whole-run deletion', () => {
  it('renames into a derived broker namespace, checkpoints every file, and completes only after durable absence', async () => {
    const value = await fixture(); let checkpoints = 0;
    await value.adapter.executeDeletion({ deletion: value.deletion, signal: new AbortController().signal, checkpoint: async () => { checkpoints += 1; } });
    expect(value.deletion.status).toBe('DELETED');
    expect(Object.values(value.deletion.entries).every((entry) => entry.status === 'DELETED')).toBe(true);
    await expect(fs.lstat(value.run)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(join(value.root, 'broker-deletions'))).toEqual([]);
    expect(checkpoints).toBeGreaterThan(Object.keys(value.deletion.entries).length);
    expect(value.authorityChecks()).toBeGreaterThan(1);
  });

  it.each(['symlink', 'fifo', 'hardlink', 'unexpected', 'mode', 'owner', 'device'] as const)('rejects an unsafe %s before rename or unlink', async (kind) => {
    const value = await fixture(); const target = join(value.run, 'database.tar.age');
    if (kind === 'symlink') { await fs.rm(target); await fs.symlink(join(value.root, 'repository.json'), target); }
    if (kind === 'fifo') { await fs.rm(target); await execFileAsync('mkfifo', ['-m', '600', target]); }
    if (kind === 'hardlink') await fs.link(target, join(value.root, 'outside-link'));
    if (kind === 'unexpected') await fs.writeFile(join(value.run, 'unexpected'), 'x', { mode: 0o600 });
    if (kind === 'mode') await fs.chmod(target, 0o644);
    const repository = kind === 'owner' ? { ...value.repository, ownerUid: value.repository.ownerUid + 1 }
      : kind === 'device' ? { ...value.repository, deviceId: (BigInt(value.repository.deviceId) + 1n).toString() } : value.repository;
    const adapter = kind === 'owner' || kind === 'device' ? new RepositoryRetentionAdapter({ repository,
      policyTrustKeys: value.policyTrustKeys, manifestVerificationKeys: value.manifestVerificationKeys, assertAuthority: async () => undefined }) : value.adapter;
    await expect(adapter.planDeletion(value.publication, new AbortController().signal)).rejects.toThrow();
    expect(await fs.readdir(join(value.root, 'runs'))).toContain(value.ids.run_id);
    await expect(fs.lstat(join(value.root, 'broker-deletions', `${value.ids.run_id}.${value.deletion.operation_id}`))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reconciles faults after rename and after unlink without deleting an unrelated replacement', async () => {
    let failRename = true; let failUnlink = true;
    const value = await fixture(async (stage) => {
      if (stage === 'after-rename' && failRename) { failRename = false; throw new Error('rename fault'); }
      if (stage === 'after-unlink' && failUnlink) { failUnlink = false; throw new Error('unlink fault'); }
    });
    const input = { deletion: value.deletion, signal: new AbortController().signal, checkpoint: async () => undefined };
    await expect(value.adapter.executeDeletion(input)).rejects.toThrow(/rename fault/);
    await expect(value.adapter.executeDeletion(input)).rejects.toThrow(/unlink fault/);
    await expect(value.adapter.executeDeletion(input)).resolves.toBeUndefined();
    expect(value.deletion.status).toBe('DELETED');
  });

  it('reconciles a crash after directory removal and parent fsync but before the terminal checkpoint', async () => {
    let fail = true;
    const value = await fixture(async (stage) => {
      if (stage === 'after-directory-removal' && fail) { fail = false; throw new Error('post-rmdir crash'); }
    });
    let checkpoints = 0;
    const input = { deletion: value.deletion, signal: new AbortController().signal, checkpoint: async () => { checkpoints += 1; } };
    await expect(value.adapter.executeDeletion(input)).rejects.toThrow(/post-rmdir crash/);
    expect(value.deletion.namespace_renamed).toBe(true);
    expect(Object.values(value.deletion.entries).every((entry) => entry.status === 'DELETED')).toBe(true);
    await expect(fs.lstat(value.run)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(join(value.root, 'broker-deletions', `${value.ids.run_id}.${value.deletion.operation_id}`))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(value.adapter.executeDeletion(input)).resolves.toBeUndefined();
    expect(value.deletion.status).toBe('DELETED');
    expect(checkpoints).toBeGreaterThan(Object.keys(value.deletion.entries).length);
  });

  it('accepts an older run after active policy and manifest key rotation when both old keys remain retained', async () => {
    const value = await fixture(); const newPolicy = generateKeyPairSync('ed25519'); const newManifest = generateKeyPairSync('ed25519');
    const adapter = new RepositoryRetentionAdapter({ repository: value.repository,
      policyTrustKeys: new Map([...value.policyTrustKeys, ['policy-active', newPolicy.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      manifestVerificationKeys: new Map([...value.manifestVerificationKeys, ['manifest-active', newManifest.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      assertAuthority: async () => undefined });
    await expect(adapter.planDeletion(value.publication, new AbortController().signal)).resolves.toEqual(value.deletion.entries);
    await expect(adapter.inspectPublished(value.publication, new AbortController().signal)).resolves.toBeUndefined();
    const selected = await selectTrustedRecoverySource({ repository: value.repository,
      repositoryDescriptor: { siteId: 'site-a', repositoryId: value.repository.identity.repository_id,
        deviceId: value.repository.deviceId, inode: value.repository.inode, ownerUid: value.repository.ownerUid,
        ownerGid: value.repository.ownerGid, mode: 0o700, descriptorSha256: 'f'.repeat(64) },
      runId: value.ids.run_id, manifestSha256: value.publication.signed_manifest_sha256,
      publication: value.publication,
      policyTrustKeys: new Map([...value.policyTrustKeys, ['policy-active', newPolicy.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
      manifestVerificationKeys: new Map([...value.manifestVerificationKeys, ['manifest-active', newManifest.publicKey.export({ type: 'spki', format: 'pem' }).toString()]]),
    });
    expect(selected.descriptor).toMatchObject({ kind: 'LOCAL_FILESYSTEM_V2', runId: value.ids.run_id, fullyEligible: true });
  });

  it.each(['policy-key', 'manifest-key', 'policy-tamper', 'manifest-signature'] as const)('fails closed for retained trust defect %s without rename or unlink', async (kind) => {
    const value = await fixture(); const unrelated = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    let publication = value.publication;
    let policyTrustKeys: ReadonlyMap<string, string> = value.policyTrustKeys;
    let manifestVerificationKeys: ReadonlyMap<string, string> = value.manifestVerificationKeys;
    if (kind === 'policy-key') policyTrustKeys = new Map([['policy-active', unrelated]]);
    if (kind === 'manifest-key') manifestVerificationKeys = new Map([['manifest-active', unrelated]]);
    if (kind === 'policy-tamper') {
      const path = join(value.run, CONFIGURATION_POLICY_FILE); const bytes = await fs.readFile(path); bytes[bytes.length - 10] ^= 1; await fs.writeFile(path, bytes, { mode: 0o600 });
    }
    if (kind === 'manifest-signature') {
      const manifest = { ...value.manifest, signature: { ...value.manifest.signature!, valueBase64: Buffer.alloc(64, 7).toString('base64') } };
      const bytes = serializeBackupManifest(manifest); const manifestSha256 = digest(bytes);
      await fs.writeFile(join(value.run, REPOSITORY_MANIFEST_FILE), bytes, { mode: 0o600 });
      const identity = { repository_id: value.repository.identity.repository_id, site_id: 'site-a', ...value.ids, manifest_sha256: manifestSha256 };
      const artifacts = manifest.artifacts.map((artifact) => ({ path: artifact.ciphertextPath, size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256 }));
      await fs.writeFile(join(value.run, PUBLICATION_INTENT_FILE), canonicalJson({ format: 'darshan-backup-publication-intent-v1', ...identity,
        created_at: '2026-10-28T09:02:00.000Z', artifacts }), { mode: 0o600 });
      await fs.writeFile(join(value.run, PUBLICATION_RECEIPT_FILE), canonicalJson({ format: 'darshan-backup-publication-receipt-v1', ...identity,
        published_at: '2026-10-28T09:03:00.000Z', verified_at: '2026-10-28T09:04:00.000Z' }), { mode: 0o600 });
      publication = { ...publication, signed_manifest_sha256: manifestSha256, signature_base64: manifest.signature.valueBase64 };
    }
    const adapter = new RepositoryRetentionAdapter({ repository: value.repository, policyTrustKeys, manifestVerificationKeys,
      assertAuthority: async () => undefined });
    await expect(adapter.planDeletion(publication, new AbortController().signal)).rejects.toThrow();
    expect(await fs.readdir(join(value.root, 'runs'))).toContain(value.ids.run_id);
    expect(await fs.readdir(join(value.root, 'broker-deletions')).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))).toEqual([]);
  });

  it.each(['policy-digest', 'capsule-generation'] as const)('rejects journal %s mismatch before rename or unlink', async (kind) => {
    const value = await fixture();
    const publication: BrokerPublicationRecord = kind === 'policy-digest'
      ? { ...value.publication, policy_sha256: '0'.repeat(64) }
      : { ...value.publication, capsule_generation: 'generation-other' };
    await expect(value.adapter.planDeletion(publication, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BROKER_DELETE_POLICY_TRUST_INVALID' });
    expect(await fs.readdir(join(value.root, 'runs'))).toContain(value.ids.run_id);
    expect(await fs.readdir(join(value.root, 'broker-deletions')).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error))).toEqual([]);
  });

  it('rejects recovery selection and restore-hold historical inspection when intent omits signed artifacts', async () => {
    const value = await fixture(); const intentPath = join(value.run, PUBLICATION_INTENT_FILE);
    const intent = parseStrictJson(await fs.readFile(intentPath), 1024 * 1024) as Record<string, unknown>;
    await fs.writeFile(intentPath, canonicalJson({ ...intent, artifacts: [] }), { mode: 0o600 });
    await expect(value.adapter.inspectPublished(value.publication, new AbortController().signal)).rejects.toThrow();
    await expect(selectTrustedRecoverySource({ repository: value.repository,
      repositoryDescriptor: { siteId: 'site-a', repositoryId: value.repository.identity.repository_id,
        deviceId: value.repository.deviceId, inode: value.repository.inode, ownerUid: value.repository.ownerUid,
        ownerGid: value.repository.ownerGid, mode: 0o700, descriptorSha256: 'f'.repeat(64) },
      runId: value.ids.run_id, manifestSha256: value.publication.signed_manifest_sha256,
      publication: value.publication, policyTrustKeys: value.policyTrustKeys,
      manifestVerificationKeys: value.manifestVerificationKeys,
    })).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_TRUST_INVALID' });
  });

  it('validates the published run directory before reading its historical policy', async () => {
    const value = await fixture();
    await fs.chmod(value.run, 0o777); await fs.rm(join(value.run, CONFIGURATION_POLICY_FILE));
    await expect(value.adapter.inspectPublished(value.publication, new AbortController().signal))
      .rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_DIRECTORY_UNSAFE' });
  });

  it('detects a deterministic final-boundary inode swap', async () => {
    let swapped = false;
    const value = await fixture(async (stage, entry) => {
      if (stage !== 'before-unlink' || swapped || !entry) return;
      swapped = true;
      const deletionPath = join(value.root, 'broker-deletions', `${value.ids.run_id}.${value.deletion.operation_id}`, entry);
      const replacement = join(value.root, 'replacement'); await fs.writeFile(replacement, 'replacement', { mode: 0o600 });
      await fs.rm(deletionPath); await fs.rename(replacement, deletionPath);
    });
    await expect(value.adapter.executeDeletion({ deletion: value.deletion, signal: new AbortController().signal, checkpoint: async () => undefined }))
      .rejects.toMatchObject({ code: 'BROKER_DELETE_SWAP_DETECTED' });
  });

  it('recovers provably dead authority evidence and makes the former fence stale', async () => {
    const value = await fixture();
    const first = await RepositoryMutationAuthority.acquire({ repository: value.repository, socketPath: join(value.root, 'one.sock') });
    const ownerPath = join(value.root, 'broker-authority', 'owner.json');
    const owner = parseStrictJson(await fs.readFile(ownerPath), 64 * 1024) as Record<string, unknown>;
    await fs.writeFile(ownerPath, canonicalJson({ ...owner, pid: 2_147_483_647, process_start_ticks: '1' }), { mode: 0o600 });
    const second = await RepositoryMutationAuthority.acquire({ repository: value.repository, socketPath: join(value.root, 'two.sock') });
    await expect(first.assertCurrent()).rejects.toMatchObject({ code: 'BROKER_AUTHORITY_STALE_FENCE' });
    expect((await fs.readdir(join(value.root, 'broker-authority-recovery'))).some((name) => name.includes(String(owner.owner_instance_id)))).toBe(true);
    await second.release();
  });

  it('rejects a distinct process and socket while the repository authority is live', async () => {
    const value = await fixture();
    const authority = await RepositoryMutationAuthority.acquire({ repository: value.repository, socketPath: join(value.root, 'parent.sock') });
    const moduleUrl = pathToFileURL(join(process.cwd(), 'src/backups/repository-mutation-authority.ts')).href;
    const script = `
      const { RepositoryMutationAuthority } = await import(${JSON.stringify(moduleUrl)});
      const repository = JSON.parse(process.env.PACKET4B_REPOSITORY);
      try {
        const authority = await RepositoryMutationAuthority.acquire({ repository, socketPath: process.env.PACKET4B_SOCKET });
        await authority.release();
        process.stdout.write('ACQUIRED');
      } catch (error) {
        process.stdout.write(error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN');
      }
    `;
    const result = await execFileAsync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, PACKET4B_REPOSITORY: JSON.stringify(value.repository), PACKET4B_SOCKET: join(value.root, 'child.sock') },
    });
    expect(result.stdout).toBe('BROKER_AUTHORITY_CONTENDED');
    await authority.release();
  });

  it('cleans only an exact quarantined staging tree through a durable derived operation identity', async () => {
    const value = await fixture(); const nonce = 'f'.repeat(32);
    const attemptDirectory = `${value.ids.run_id}.${value.ids.attempt_id}.${nonce}`;
    const attempt = join(value.root, 'quarantine', attemptDirectory); const prepared = join(attempt, 'prepared');
    await fs.mkdir(prepared, { recursive: true, mode: 0o700 }); await fs.chmod(join(value.root, 'quarantine'), 0o700);
    await fs.writeFile(join(attempt, 'ownership.json'), canonicalJson({ format: 'darshan-backup-attempt-ownership-v1',
      repository_id: value.repository.identity.repository_id, site_id: 'site-a', ...value.ids, owner_nonce: nonce, created_at: '2026-10-28T09:00:00.000Z' }), { mode: 0o600 });
    for (const [name, bytes] of Object.entries(value.files)) await fs.writeFile(join(prepared, name), bytes, { mode: 0o600 });
    await fs.writeFile(join(prepared, CONFIGURATION_POLICY_FILE), canonicalJson(value.policy), { mode: 0o600 });
    const publication: BrokerPublicationRecord = { ...value.publication, status: 'QUARANTINED', attempt_directory: attemptDirectory,
      unsigned_manifest_base64: value.publication.unsigned_manifest_base64 };
    const now = new Date().toISOString();
    const cleanup = { site_id: 'site-a', repository_id: value.repository.identity.repository_id, ...value.ids,
      manifest_sha256: publication.signed_manifest_sha256, operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID(),
      status: 'CLAIMED' as const, claimed_at: now };
    await expect(value.adapter.cleanupStaging({ publication, cleanup, signal: new AbortController().signal, checkpoint: async () => undefined })).resolves.toBe('CLEANED');
    await expect(fs.lstat(attempt)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(cleanup.status).toBe('RENAMED');
  });
});
