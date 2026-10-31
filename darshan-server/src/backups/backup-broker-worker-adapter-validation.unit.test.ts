import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupBrokerClient } from './backup-broker-client.js';
import { BackupBrokerWorkerAdapter, type BrokerAttemptIdentity } from './backup-broker-worker-adapter.js';
import { canonicalJson, type BrokerPublicationEvidence } from './backup-broker-protocol.js';
import { policySha256, type SignedConfigurationCapsulePolicy } from './configuration-capsule-policy.js';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from './configuration-capsule-inventory.js';
import { serializeBackupManifest, serializeUnsignedBackupManifest, type BackupManifestV1 } from './manifest.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const repositoryId = randomUUID();
  const policy: SignedConfigurationCapsulePolicy = { policy: { version: 2, generation: 'capsule-1', site_id: 'site-a', repository_id: repositoryId,
    created_at: '2026-10-28T09:00:00.000Z', capsule_sha256: 'b'.repeat(64), capsule_size_bytes: '10', release_generation: 'release-1',
    deployment_generation: 'deployment-1', compatibility_generation: 1, age_recipient_key_id: 'age-key', contract_id: PRODUCTION_CAPSULE_CONTRACT_ID,
    encrypted_inventory_sha256: 'c'.repeat(64), required_roles: [...REQUIRED_CAPSULE_ROLES] },
    signature: { algorithm: 'Ed25519', key_id: 'policy-key', value_base64: Buffer.alloc(64).toString('base64') } };
  const capability = { protocol_version: 2 as const, operation: 'DESCRIBE' as const, request_id: randomUUID(), helper_version: '2', policy_sha256: policySha256(policy),
    site_id: 'site-a', repository_id: repositoryId, capsule_generation: 'capsule-1', capsule_sha256: 'b'.repeat(64), capsule_size_bytes: '10',
    release_generation: 'release-1', deployment_generation: 'deployment-1', compatibility_generation: 1, age_recipient_key_id: 'age-key',
    contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, encrypted_inventory_sha256: 'c'.repeat(64),
    required_roles: [...REQUIRED_CAPSULE_ROLES], capabilities: { durable_publication: true },
    manifest_verification_keys: [{ key_id: 'key-1', algorithm: 'Ed25519' as const, public_key_pem: publicKeyPem, active: true }],
    configuration_contract: [{ logical_name: 'configuration.encrypted-capsule', required: true, max_bytes: '10' }] };
  const identity: BrokerAttemptIdentity = { runId: randomUUID(), attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 4, deadlineAt: new Date(Date.now() + 120_000) };
  const unsigned: BackupManifestV1 = { version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: repositoryId }, site: { id: 'site-a' },
    run: { id: identity.runId, attemptId: identity.attemptId }, capture: { id: identity.captureId, generation: '4', startedAt: '2026-10-28T10:00:00.000Z', sealedAt: '2026-10-28T10:01:00.000Z', stagingInventorySha256: 'd'.repeat(64) },
    release: { id: 'release-1' }, schema: { migrationId: '0051', fingerprintSha256: 'e'.repeat(64) }, encryption: { keyId: 'age-key', tool: { name: 'age', version: '1', executableSha256: 'f'.repeat(64) } },
    artifacts: [{ kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: '1', ciphertextSha256: '1'.repeat(64) },
      { kind: 'OBJECTS', name: 'objects', ciphertextPath: 'objects.tar.age', ciphertextSizeBytes: '2', ciphertextSha256: '2'.repeat(64) },
      { kind: 'CONFIGURATION', name: 'configuration', ciphertextPath: 'configuration.tar.age', ciphertextSizeBytes: '10', ciphertextSha256: 'b'.repeat(64) }],
    configurationPolicy: { policySha256: policySha256(policy), capsuleGeneration: 'capsule-1', encryptedInventorySha256: 'c'.repeat(64) }, signature: null };
  return { pair, publicKeyPem, capability, identity, unsigned, policy };
}

function injectedAdapter(value: ReturnType<typeof fixture>, request: (input: any) => Promise<any>) {
  return new (BackupBrokerWorkerAdapter as any)({ request }, new Map([['key-1', value.publicKeyPem]]), value.capability) as BackupBrokerWorkerAdapter;
}

describe('backup broker worker validation', () => {
  it('replays byte-identical PREPARE mutation metadata after restart', async () => {
    const value = fixture(); const root = await mkdtemp('/tmp/darshan-worker-prepare-'); roots.push(root); await chmod(root, 0o700);
    const requests: unknown[] = [];
    const bytes = serializeUnsignedBackupManifest(value.unsigned); const signature = sign(null, bytes, value.pair.privateKey).toString('base64');
    const signedBytes = serializeBackupManifest({ ...value.unsigned, signature: { algorithm: 'Ed25519', keyId: 'key-1', valueBase64: signature } });
    const adapter = injectedAdapter(value, async (input) => { requests.push(input); return { protocol_version: 2, operation: 'PREPARE_PUBLICATION', request_id: input.request_id,
      helper_version: '2', policy_sha256: 'a'.repeat(64), unsigned_manifest_sha256: createHash('sha256').update(bytes).digest('hex'), signed_manifest_sha256: createHash('sha256').update(signedBytes).digest('hex'),
      algorithm: 'Ed25519', key_id: 'key-1', signature_base64: signature,
      incomplete_relative_path: `incomplete/${value.identity.runId}.${value.identity.attemptId}.${'a'.repeat(32)}`, published_relative_path: `runs/${value.identity.runId}` }; });
    await adapter.prepare({ identity: value.identity, attemptRoot: root, unsignedManifest: value.unsigned, signal: new AbortController().signal });
    await adapter.prepare({ identity: value.identity, attemptRoot: root, unsignedManifest: value.unsigned, signal: new AbortController().signal });
    expect(requests[1]).toEqual(requests[0]);
    expect((requests[0] as any).deadline).toBe(value.identity.deadlineAt.toISOString());
  });

  it('rejects startup when protected local keyring differs from DESCRIBE', async () => {
    const value = fixture(); const root = await mkdtemp('/home/hexmon/darshan-keyring-test-'); roots.push(root); await chmod(root, 0o700);
    const keyring = join(root, 'keyring.json'); await writeFile(keyring, canonicalJson({ 'different-key': value.publicKeyPem }), { mode: 0o600 });
    vi.spyOn(BackupBrokerClient.prototype, 'describe').mockResolvedValue(value.capability);
    await expect(BackupBrokerWorkerAdapter.create({ socketPath: '/run/darshan/broker.sock', helperVersion: '2', policySha256: 'a'.repeat(64), siteId: 'site-a', repositoryId: value.capability.repository_id,
      keyringPath: keyring, expectedRelease: 'release-1', expectedDeployment: 'deployment-1', expectedCompatibility: 1, expectedAgeKeyId: 'age-key', expectedCapsuleGeneration: 'capsule-1', expectedCapsuleSha256: 'b'.repeat(64) }))
      .rejects.toMatchObject({ code: 'BROKER_KEYRING_MISMATCH' });
  });

  it('rejects a selected capsule whose bytes match the digest but not the described size', async () => {
    const value = fixture(); const capsule = Buffer.from('capsule');
    value.capability.capsule_sha256 = createHash('sha256').update(capsule).digest('hex');
    value.capability.capsule_size_bytes = String(capsule.byteLength + 1);
    const marker = canonicalJson({ version: 2, site_id: 'site-a', repository_id: value.capability.repository_id,
      capsule_generation: value.capability.capsule_generation, capsule_sha256: value.capability.capsule_sha256 }).toString('utf8');
    const adapter = injectedAdapter(value, async (input) => ({ protocol_version: 2, operation: 'SELECT_CAPSULE', request_id: input.request_id,
      helper_version: '2', policy_sha256: 'a'.repeat(64), capsule_generation: value.capability.capsule_generation,
      capsule_sha256: value.capability.capsule_sha256, capsule_base64: capsule.toString('base64'), active_marker: marker,
      active_marker_signature_base64: sign(null, Buffer.from(marker), value.pair.privateKey).toString('base64'), key_id: 'key-1' }));
    await expect(adapter.selectCapsule(value.identity, new AbortController().signal)).rejects.toMatchObject({ code: 'BROKER_CAPSULE_EVIDENCE_INVALID' });
  });

  it('rejects duplicate artifact evidence and crossed timestamps', () => {
    const value = fixture(); const unsignedBytes = serializeUnsignedBackupManifest(value.unsigned);
    const signature = sign(null, unsignedBytes, value.pair.privateKey).toString('base64');
    const signedBytes = serializeBackupManifest({ ...value.unsigned, signature: { algorithm: 'Ed25519', keyId: 'key-1', valueBase64: signature } });
    const manifestSha256 = createHash('sha256').update(signedBytes).digest('hex');
    const identity = { repository_id: value.capability.repository_id, site_id: 'site-a', run_id: value.identity.runId, attempt_id: value.identity.attemptId,
      capture_id: value.identity.captureId, capture_generation: 4, manifest_sha256: manifestSha256 };
    const artifacts = value.unsigned.artifacts.map((artifact) => ({ path: artifact.ciphertextPath, size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256 }));
    const evidence: BrokerPublicationEvidence = { verified: true, run_relative_path: `runs/${value.identity.runId}`, manifest_relative_path: `runs/${value.identity.runId}/manifest.json`,
      configuration_policy_relative_path: `runs/${value.identity.runId}/configuration-policy.json`, canonical_signed_manifest_base64: signedBytes.toString('base64'),
      canonical_signed_configuration_policy_base64: canonicalJson(value.policy).toString('base64'), configuration_policy_sha256: policySha256(value.policy),
      capsule_generation: 'capsule-1', encrypted_inventory_sha256: 'c'.repeat(64),
      intent: { format: 'darshan-backup-publication-intent-v1', ...identity, created_at: '2026-10-28T10:02:00.000Z', artifacts },
      receipt: { format: 'darshan-backup-publication-receipt-v1', ...identity, published_at: '2026-10-28T10:03:00.000Z', verified_at: '2026-10-28T10:04:00.000Z' } };
    value.identity.deadlineAt = new Date('2026-10-28T10:10:00.000Z');
    const adapter = injectedAdapter(value, async () => undefined);
    expect(() => adapter.validateEvidence({ ...evidence, intent: { ...evidence.intent, artifacts: [artifacts[0], artifacts[0], artifacts[2]] } }, value.identity, signedBytes)).toThrow(/artifact set/);
    expect(() => adapter.validateEvidence({ ...evidence, receipt: { ...evidence.receipt, published_at: '2026-10-28T10:05:00.000Z', verified_at: '2026-10-28T10:04:00.000Z' } }, value.identity, signedBytes)).toThrow(/deadline|bytes/);
    expect(() => adapter.validateEvidence({ ...evidence, intent: { ...evidence.intent, created_at: 'not-a-timestamp' } } as never, value.identity, signedBytes)).toThrow(/deadline|bytes/);
  });
});
