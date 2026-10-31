import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupBrokerRepositoryAdapter } from './backup-broker-repository-adapter';
import type { BackupBrokerRequest } from './backup-broker-protocol';
import type { BrokerPublicationRecord } from './backup-broker-journal';
import type { LocalRepository } from './local-repository';
import { serializeBackupManifest, type BackupManifestV1 } from './manifest';
import { policySha256, type SignedConfigurationCapsulePolicy } from './configuration-capsule-policy';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from './configuration-capsule-inventory';
import { CONFIGURATION_POLICY_FILE, readAndVerifyPublishedRun } from './repository-publication';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const execFileAsync = promisify(execFile);

async function fixture(fault?: ConstructorParameters<typeof BackupBrokerRepositoryAdapter>[0]['fault'], writeDestination?: ConstructorParameters<typeof BackupBrokerRepositoryAdapter>[0]['writeDestination']) {
  const root = await fs.mkdtemp(join(tmpdir(), 'broker-repository-')); const spool = await fs.mkdtemp(join(tmpdir(), 'broker-spool-')); roots.push(root, spool);
  const repositoryId = randomUUID(); await fs.writeFile(join(root, 'repository.json'), `${JSON.stringify({ format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId })}\n`, { mode: 0o600 });
  const rootStat = await fs.stat(root, { bigint: true }); const spoolStat = await fs.stat(spool, { bigint: true });
  const repository: LocalRepository = Object.freeze({ root, identity: { format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId }, deviceId: rootStat.dev.toString(), inode: rootStat.ino.toString(), ownerUid: Number(rootStat.uid), ownerGid: Number(rootStat.gid), mode: 0o700 });
  const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 3 };
  let spoolAttempt = spool;
  for (const segment of [ids.run_id, ids.attempt_id, ids.capture_id, '3']) { spoolAttempt = join(spoolAttempt, segment); await fs.mkdir(spoolAttempt, { mode: 0o700 }); }
  const database = Buffer.from('database ciphertext'); const objects = Buffer.from('objects ciphertext'); const capsule = Buffer.from('configuration ciphertext');
  await fs.writeFile(join(spoolAttempt, 'database.tar.age'), database, { mode: 0o600 }); await fs.writeFile(join(spoolAttempt, 'objects.tar.age'), objects, { mode: 0o600 });
  const configurationPolicy: SignedConfigurationCapsulePolicy = { policy: { version: 2, generation: 'g1', site_id: 'site-a', repository_id: repositoryId,
    created_at: '2026-10-28T09:00:00.000Z', capsule_sha256: digest(capsule), capsule_size_bytes: capsule.byteLength.toString(),
    release_generation: 'release-01', deployment_generation: 'deployment-1', compatibility_generation: 1, age_recipient_key_id: 'age-1',
    contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, encrypted_inventory_sha256: '9'.repeat(64), required_roles: [...REQUIRED_CAPSULE_ROLES] },
    signature: { algorithm: 'Ed25519', key_id: 'policy-1', value_base64: Buffer.alloc(64).toString('base64') } };
  const manifest: BackupManifestV1 = { version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: repositoryId }, site: { id: 'site-a' }, run: { id: ids.run_id, attemptId: ids.attempt_id }, capture: { id: ids.capture_id, generation: '3', startedAt: '2026-10-28T10:00:00.000Z', sealedAt: '2026-10-28T10:01:00.000Z', stagingInventorySha256: '1'.repeat(64) }, release: { id: 'release-01' }, schema: { migrationId: '0051_local_backup_publication', fingerprintSha256: '2'.repeat(64) }, encryption: { keyId: 'age-1', tool: { name: 'age', version: '1.3.2', executableSha256: '3'.repeat(64) } }, artifacts: [
    { kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: database.byteLength.toString(), ciphertextSha256: digest(database) },
    { kind: 'OBJECTS', name: 'objects', ciphertextPath: 'objects.tar.age', ciphertextSizeBytes: objects.byteLength.toString(), ciphertextSha256: digest(objects) },
    { kind: 'CONFIGURATION', name: 'configuration', ciphertextPath: 'configuration.tar.age', ciphertextSizeBytes: capsule.byteLength.toString(), ciphertextSha256: digest(capsule) },
  ], configurationPolicy: { policySha256: policySha256(configurationPolicy), capsuleGeneration: configurationPolicy.policy.generation,
    encryptedInventorySha256: configurationPolicy.policy.encrypted_inventory_sha256 },
    signature: { algorithm: 'Ed25519', keyId: 'manifest-1', valueBase64: Buffer.alloc(64).toString('base64') } };
  const adapter = new BackupBrokerRepositoryAdapter({ repository, spoolRoot: spool, spoolDeviceId: spoolStat.dev.toString(), spoolOwnerUid: Number(spoolStat.uid), spoolOwnerGid: Number(spoolStat.gid), encryptedCapsule: capsule, configurationPolicy, fault, writeDestination });
  const request = { operation: 'PREPARE_PUBLICATION', ...ids } as Extract<BackupBrokerRequest, { operation: 'PREPARE_PUBLICATION' }>;
  return { root, spoolAttempt, repository, ids, manifest, adapter, request, configurationPolicy };
}

describe('backup broker repository adapter', () => {
  it('copies verified spool ciphertext and atomically publishes the signed manifest', async () => {
    const value = await fixture(); const signal = new AbortController().signal; const signedBytes = serializeBackupManifest(value.manifest);
    const attemptDirectory = await value.adapter.prepare({ request: value.request, manifest: value.manifest, signedManifestBytes: signedBytes, signal });
    const publication: BrokerPublicationRecord = { site_id: 'site-a', repository_id: value.repository.identity.repository_id, ...value.ids, policy_sha256: '4'.repeat(64), capsule_generation: 'g1', unsigned_manifest_sha256: '5'.repeat(64), signed_manifest_sha256: digest(signedBytes), key_id: 'manifest-1', signature_base64: value.manifest.signature!.valueBase64, unsigned_manifest_base64: Buffer.from('e30=').toString('base64'), attempt_directory: attemptDirectory, status: 'PREPARED' };
    await value.adapter.commit({ publication, manifest: value.manifest, signedManifestBytes: signedBytes, signal });
    const published = await readAndVerifyPublishedRun({ repository: value.repository, runId: value.ids.run_id, trustedConfigurationPolicy: value.configurationPolicy });
    expect(published.intent.manifest_sha256).toBe(digest(signedBytes)); expect(published.artifactBytes).toBeGreaterThan(0n);
    expect(published.configurationPolicy?.sha256).toBe(policySha256(value.configurationPolicy));
  });

  it('rejects spool tampering before creating a publishable run', async () => {
    const value = await fixture(); await fs.writeFile(join(value.spoolAttempt, 'database.tar.age'), 'tampered', { mode: 0o600 });
    const input = { request: value.request, manifest: value.manifest, signedManifestBytes: serializeBackupManifest(value.manifest), signal: new AbortController().signal };
    await expect(value.adapter.prepare(input)).rejects.toThrow(/size.*before streaming/);
    expect(await fs.readdir(join(value.root, 'incomplete'))).toHaveLength(1);
    await expect(value.adapter.prepare(input)).rejects.toThrow(/preserved/);
    await expect(fs.lstat(join(value.root, 'runs', value.ids.run_id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects oversized ciphertext before streaming and opens FIFO leaves nonblocking', async () => {
    const oversized = await fixture(); await fs.appendFile(join(oversized.spoolAttempt, 'database.tar.age'), 'extra');
    await expect(oversized.adapter.prepare({ request: oversized.request, manifest: oversized.manifest, signedManifestBytes: serializeBackupManifest(oversized.manifest), signal: new AbortController().signal })).rejects.toThrow(/size.*before streaming/);
    const fifo = await fixture(); const fifoPath = join(fifo.spoolAttempt, 'database.tar.age'); await fs.rm(fifoPath); await execFileAsync('mkfifo', ['-m', '600', fifoPath]);
    await expect(fifo.adapter.prepare({ request: fifo.request, manifest: fifo.manifest, signedManifestBytes: serializeBackupManifest(fifo.manifest), signal: new AbortController().signal })).rejects.toThrow(/regular file/);
  });

  it('completes each ciphertext chunk when destination writes are partial', async () => {
    let writes = 0; const value = await fixture(undefined, async (handle, buffer, offset, length, position) => {
      writes += 1; return (await handle.write(buffer, offset, Math.min(length, 3), position)).bytesWritten;
    });
    await value.adapter.prepare({ request: value.request, manifest: value.manifest, signedManifestBytes: serializeBackupManifest(value.manifest), signal: new AbortController().signal });
    expect(writes).toBeGreaterThan(2);
  });

  it('reconciles a deterministic prepared attempt after a crash before journal storage', async () => {
    let fail = true; const value = await fixture(async (stage) => { if (stage === 'after-prepare-fsync' && fail) { fail = false; throw new Error('injected prepare crash'); } });
    const input = { request: value.request, manifest: value.manifest, signedManifestBytes: serializeBackupManifest(value.manifest), signal: new AbortController().signal };
    await expect(value.adapter.prepare(input)).rejects.toThrow(/injected prepare crash/);
    const attemptDirectory = await value.adapter.prepare(input);
    expect((await fs.readdir(join(value.root, 'incomplete'))).filter((name) => !name.startsWith('.'))).toEqual([attemptDirectory]);
  });

  it('reconciles exact repository truth after publish succeeds before journal COMMITTED storage', async () => {
    let fail = true; const value = await fixture(async (stage) => { if (stage === 'after-publish-before-journal' && fail) { fail = false; throw new Error('injected commit crash'); } });
    const signal = new AbortController().signal; const signedBytes = serializeBackupManifest(value.manifest);
    const attemptDirectory = await value.adapter.prepare({ request: value.request, manifest: value.manifest, signedManifestBytes: signedBytes, signal });
    const publication: BrokerPublicationRecord = { site_id: 'site-a', repository_id: value.repository.identity.repository_id, ...value.ids, policy_sha256: '4'.repeat(64), capsule_generation: 'g1', unsigned_manifest_sha256: '5'.repeat(64), signed_manifest_sha256: digest(signedBytes), key_id: 'manifest-1', signature_base64: value.manifest.signature!.valueBase64, unsigned_manifest_base64: Buffer.from('e30=').toString('base64'), attempt_directory: attemptDirectory, status: 'PREPARED' };
    await expect(value.adapter.commit({ publication, manifest: value.manifest, signedManifestBytes: signedBytes, signal })).rejects.toThrow(/injected commit crash/);
    await fs.rm(join(value.root, 'incomplete', attemptDirectory), { recursive: true, force: true });
    await expect(value.adapter.commit({ publication, manifest: value.manifest, signedManifestBytes: signedBytes, signal })).resolves.toMatchObject({ verified: true });
    expect((await readAndVerifyPublishedRun({ repository: value.repository, runId: value.ids.run_id, trustedConfigurationPolicy: value.configurationPolicy })).receipt).not.toBeNull();
  });

  it('rejects missing, tampered, or externally mismatched published configuration policy metadata', async () => {
    const value = await fixture(); const signal = new AbortController().signal; const signedBytes = serializeBackupManifest(value.manifest);
    const attemptDirectory = await value.adapter.prepare({ request: value.request, manifest: value.manifest, signedManifestBytes: signedBytes, signal });
    const publication: BrokerPublicationRecord = { site_id: 'site-a', repository_id: value.repository.identity.repository_id, ...value.ids,
      policy_sha256: policySha256(value.configurationPolicy), capsule_generation: 'g1', unsigned_manifest_sha256: '5'.repeat(64),
      signed_manifest_sha256: digest(signedBytes), key_id: 'manifest-1', signature_base64: value.manifest.signature!.valueBase64,
      unsigned_manifest_base64: Buffer.from('e30=').toString('base64'), attempt_directory: attemptDirectory, status: 'PREPARED' };
    await value.adapter.commit({ publication, manifest: value.manifest, signedManifestBytes: signedBytes, signal });
    const policyPath = join(value.root, 'runs', value.ids.run_id, CONFIGURATION_POLICY_FILE);
    const original = await fs.readFile(policyPath);
    await fs.writeFile(policyPath, Buffer.alloc(original.length, 0x20), { mode: 0o600 });
    await expect(value.adapter.inspect({ ...publication, status: 'COMMITTED' }, signal)).rejects.toThrow(/configuration policy/);
    await fs.writeFile(policyPath, original, { mode: 0o600 });
    const wrongPolicy = { ...value.configurationPolicy, policy: { ...value.configurationPolicy.policy, encrypted_inventory_sha256: '8'.repeat(64) } };
    await expect(readAndVerifyPublishedRun({ repository: value.repository, runId: value.ids.run_id, trustedConfigurationPolicy: wrongPolicy })).rejects.toThrow(/configuration policy/);
    await fs.rm(policyPath);
    await expect(value.adapter.inspect({ ...publication, status: 'COMMITTED' }, signal)).rejects.toThrow();
  });
});
