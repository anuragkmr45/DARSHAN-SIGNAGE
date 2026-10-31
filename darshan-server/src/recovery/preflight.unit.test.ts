import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../backups/backup-broker-protocol';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from '../backups/configuration-capsule-inventory';
import { policySha256, signCapsulePolicy } from '../backups/configuration-capsule-policy';
import { serializeBackupManifest, serializeUnsignedBackupManifest, type BackupManifestV1 } from '../backups/manifest';
import { CONFIGURATION_POLICY_FILE, PUBLICATION_INTENT_FILE, PUBLICATION_RECEIPT_FILE, REPOSITORY_MANIFEST_FILE } from '../backups/repository-publication';
import { backupSchemaFingerprint, loadMigrationManifest } from '../deployment/migration-ledger';
import { runRecoveryDiscovery, runRecoveryPlanning } from './preflight';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));
async function snapshot(root: string) {
  const result: Record<string, string> = {}; const pending = [''];
  while (pending.length) { const relative = pending.pop()!; const path = relative ? join(root, relative) : root;
    for (const entry of (await fs.readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative ? join(relative, entry.name) : entry.name; const stat = await fs.lstat(join(root, child), { bigint: true });
      result[child] = `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`; if (entry.isDirectory()) pending.push(child);
    } }
  return result;
}

async function fixture(journal = true) {
  const base = await fs.mkdtemp(join(tmpdir(), 'recovery-preflight-')); roots.push(base); await fs.chmod(base, 0o700);
  const repository = join(base, 'repository'); await fs.mkdir(repository, { mode: 0o700 }); const repositoryId = randomUUID();
  await fs.writeFile(join(repository, 'repository.json'), canonicalJson({ format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId }), { mode: 0o600 });
  if (journal) { await fs.mkdir(join(repository, 'broker-journal'), { mode: 0o700 }); await fs.writeFile(join(repository, 'broker-journal', 'state.json'),
    canonicalJson({ format: 'darshan-backup-broker-journal-v2', revision: 1, requests: {}, publications: {}, holds: {}, deletions: {}, tombstones: {}, staging_cleanups: {} }), { mode: 0o600 }); }
  const { publicKey } = generateKeyPairSync('ed25519'); const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const policy = join(base, 'policy.json'); const manifest = join(base, 'manifest.json');
  await fs.writeFile(policy, canonicalJson({ policy: pem }), { mode: 0o600 }); await fs.writeFile(manifest, canonicalJson({ manifest: pem }), { mode: 0o600 });
  const stat = await fs.stat(repository, { bigint: true }); const config = join(base, 'config.json');
  await fs.writeFile(config, canonicalJson({ format: 'darshan-recovery-operator-config-v1', site_id: 'site-a', repository: {
    root: repository, device_id: stat.dev.toString(), owner_uid: Number(stat.uid), owner_gid: Number(stat.gid), repository_id: repositoryId },
  trust: { policy_keyring_file: policy, manifest_keyring_file: manifest }, target: { target_id: 'darshan-server-release-01', release_id: 'release-01',
    migrations_directory: join(process.cwd(), 'drizzle', 'migrations') } }), { mode: 0o600 });
  return { base, repository, config };
}

const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
async function planningFixture() {
  const value = await fixture(false); const config = JSON.parse(await fs.readFile(value.config, 'utf8')) as {
    repository: { repository_id: string };
    trust: { policy_keyring_file: string; manifest_keyring_file: string };
  };
  const repositoryId = config.repository.repository_id as string; const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 3 };
  const policyKey = generateKeyPairSync('ed25519'); const manifestKey = generateKeyPairSync('ed25519');
  const policyPem = policyKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const manifestPem = manifestKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await fs.writeFile(config.trust.policy_keyring_file, canonicalJson({ 'policy-old': policyPem }), { mode: 0o600 });
  await fs.writeFile(config.trust.manifest_keyring_file, canonicalJson({ 'manifest-old': manifestPem }), { mode: 0o600 });
  const files = { 'database.tar.age': Buffer.from('database'), 'objects.tar.age': Buffer.from('objects'), 'configuration.tar.age': Buffer.from('configuration') };
  const policy = signCapsulePolicy({ privateKeyPem: policyKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), keyId: 'policy-old', policy: {
    version: 2, generation: 'generation-1', site_id: 'site-a', repository_id: repositoryId, created_at: '2026-10-29T00:00:00.000Z',
    capsule_sha256: sha256(files['configuration.tar.age']), capsule_size_bytes: files['configuration.tar.age'].byteLength.toString(), release_generation: 'release-01',
    deployment_generation: 'deployment-1', compatibility_generation: 1, age_recipient_key_id: 'age-1', contract_id: PRODUCTION_CAPSULE_CONTRACT_ID,
    encrypted_inventory_sha256: 'a'.repeat(64), required_roles: [...REQUIRED_CAPSULE_ROLES],
  } });
  const fullMigrations = await loadMigrationManifest(config.target.migrations_directory);
  const release01Terminal = fullMigrations.findIndex((entry) => entry.id === '0055_backup_deletion_idempotency_bindings.sql');
  const migrations = fullMigrations.slice(0, release01Terminal + 1);
  const unsigned: BackupManifestV1 = { version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: repositoryId }, site: { id: 'site-a' },
    run: { id: ids.run_id, attemptId: ids.attempt_id }, capture: { id: ids.capture_id, generation: '3', startedAt: '2026-10-29T00:00:00.000Z',
      sealedAt: '2026-10-29T00:01:00.000Z', stagingInventorySha256: 'b'.repeat(64) }, release: { id: 'release-01' },
    schema: { migrationId: migrations.at(-1)!.id.replace(/\.sql$/, ''), fingerprintSha256: backupSchemaFingerprint(migrations) },
    encryption: { keyId: 'age-1', tool: { name: 'age', version: '1', executableSha256: 'c'.repeat(64) } },
    artifacts: Object.entries(files).map(([path, bytes], index) => ({ kind: ['DATABASE', 'OBJECTS', 'CONFIGURATION'][index] as 'DATABASE' | 'OBJECTS' | 'CONFIGURATION',
      name: path.split('.')[0], ciphertextPath: path, ciphertextSizeBytes: bytes.byteLength.toString(), ciphertextSha256: sha256(bytes) })),
    configurationPolicy: { policySha256: policySha256(policy), capsuleGeneration: 'generation-1', encryptedInventorySha256: 'a'.repeat(64) }, signature: null };
  const unsignedBytes = serializeUnsignedBackupManifest(unsigned); const manifest: BackupManifestV1 = { ...unsigned,
    signature: { algorithm: 'Ed25519', keyId: 'manifest-old', valueBase64: sign(null, unsignedBytes, manifestKey.privateKey).toString('base64') } };
  const manifestBytes = serializeBackupManifest(manifest); const manifestSha256 = sha256(manifestBytes); const run = join(value.repository, 'runs', ids.run_id);
  await fs.mkdir(run, { recursive: true, mode: 0o700 }); for (const [name, bytes] of Object.entries(files)) await fs.writeFile(join(run, name), bytes, { mode: 0o600 });
  await fs.writeFile(join(run, REPOSITORY_MANIFEST_FILE), manifestBytes, { mode: 0o600 });
  await fs.writeFile(join(run, CONFIGURATION_POLICY_FILE), canonicalJson(policy), { mode: 0o600 });
  const identity = { repository_id: repositoryId, site_id: 'site-a', ...ids, manifest_sha256: manifestSha256 };
  const artifacts = manifest.artifacts.map((item) => ({ path: item.ciphertextPath, size: item.ciphertextSizeBytes, sha256: item.ciphertextSha256 }));
  await fs.writeFile(join(run, PUBLICATION_INTENT_FILE), canonicalJson({ format: 'darshan-backup-publication-intent-v1', ...identity,
    created_at: '2026-10-29T00:02:00.000Z', artifacts }), { mode: 0o600 });
  await fs.writeFile(join(run, PUBLICATION_RECEIPT_FILE), canonicalJson({ format: 'darshan-backup-publication-receipt-v1', ...identity,
    published_at: '2026-10-29T00:03:00.000Z', verified_at: '2026-10-29T00:04:00.000Z' }), { mode: 0o600 });
  const publication = { site_id: 'site-a', repository_id: repositoryId, ...ids, policy_sha256: policySha256(policy), capsule_generation: 'generation-1',
    unsigned_manifest_sha256: sha256(unsignedBytes), signed_manifest_sha256: manifestSha256, key_id: 'manifest-old', signature_base64: manifest.signature!.valueBase64,
    unsigned_manifest_base64: unsignedBytes.toString('base64'), attempt_directory: null, status: 'COMMITTED' };
  await fs.mkdir(join(value.repository, 'broker-journal'), { mode: 0o700 }); await fs.writeFile(join(value.repository, 'broker-journal', 'state.json'),
    canonicalJson({ format: 'darshan-backup-broker-journal-v2', revision: 1, requests: {}, publications: { [ids.run_id]: publication }, holds: {}, deletions: {},
      tombstones: {}, staging_cleanups: {} }), { mode: 0o600 });
  const output = join(value.base, 'plans'); await fs.mkdir(output, { mode: 0o700 });
  return { ...value, output, ids, manifestSha256 };
}

describe('recovery preflight mutation boundary', () => {
  it('discovery leaves config, trust, repository, and journal metadata unchanged', async () => {
    const value = await fixture(); const before = await snapshot(value.base);
    await expect(runRecoveryDiscovery({ configFile: value.config })).resolves.toMatchObject({ candidates: [], journalRevision: 1 });
    expect(await snapshot(value.base)).toEqual(before);
  });

  it('a missing journal is not created or repaired', async () => {
    const value = await fixture(false); const before = await snapshot(value.base);
    await expect(runRecoveryDiscovery({ configFile: value.config })).rejects.toMatchObject({ code: 'RECOVERY_JOURNAL_SNAPSHOT_MISSING' });
    expect(await snapshot(value.base)).toEqual(before); await expect(fs.lstat(join(value.repository, 'broker-journal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('exact planning mutates only the requested exclusive plan output and emits deterministic bytes for fixed IDs/time', async () => {
    const value = await planningFixture(); const beforeRepository = await snapshot(value.repository); const planPath = join(value.output, 'reviewed.json');
    const fixed = { operationId: '11111111-1111-4111-8111-111111111111', planId: '22222222-2222-4222-8222-222222222222', now: new Date('2026-10-29T00:10:00.000Z') };
    const result = await runRecoveryPlanning({ configFile: value.config, runId: value.ids.run_id, manifestSha256: value.manifestSha256,
      planOutput: planPath, ...fixed });
    expect(result.plan.source).toMatchObject({ runId: value.ids.run_id, attemptId: value.ids.attempt_id, captureId: value.ids.capture_id,
      captureGeneration: 3, manifestSha256: value.manifestSha256 });
    expect(await snapshot(value.repository)).toEqual(beforeRepository); const firstBytes = await fs.readFile(planPath);
    await fs.rm(planPath); const second = await runRecoveryPlanning({ configFile: value.config, runId: value.ids.run_id, manifestSha256: value.manifestSha256,
      planOutput: planPath, ...fixed });
    expect(await fs.readFile(planPath)).toEqual(firstBytes); expect(second.planSha256).toBe(result.planSha256);
    await expect(runRecoveryPlanning({ configFile: value.config, runId: value.ids.run_id, manifestSha256: value.manifestSha256,
      planOutput: planPath, ...fixed })).rejects.toMatchObject({ code: 'RECOVERY_PLAN_EXISTS' });
    expect(await snapshot(value.repository)).toEqual(beforeRepository);
  });
});
