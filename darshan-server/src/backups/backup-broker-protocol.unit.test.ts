import { createHash, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupBrokerClient } from './backup-broker-client';
import { BACKUP_BROKER_MAX_REQUEST_BYTES, backupBrokerResponseSchema, canonicalJson, parseBackupBrokerRequest, parseStrictJson } from './backup-broker-protocol';
import { BackupBrokerService } from './backup-broker-service';
import { policySha256, signCapsulePolicy, validateCapsulePolicy } from './configuration-capsule-policy';
import { PRODUCTION_CAPSULE_CONTRACT_ID, REQUIRED_CAPSULE_ROLES } from './configuration-capsule-inventory';
import { serializeUnsignedBackupManifest, type BackupManifestV1 } from './manifest';
import type { LocalRepository } from './local-repository';
import { BackupBrokerJournal } from './backup-broker-journal';

const directories: string[] = []; const services: BackupBrokerService[] = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.close())); await Promise.all(directories.splice(0).map((path) => fs.rm(path, { recursive: true, force: true }))); });
const pem = (key: ReturnType<typeof generateKeyPairSync>['privateKey'] | ReturnType<typeof generateKeyPairSync>['publicKey'], type: 'pkcs8' | 'spki') => key.export({ type, format: 'pem' }).toString();

async function fixture(beforeOperation?: ConstructorParameters<typeof BackupBrokerService>[0]['beforeOperation'], capsuleOverride?: Buffer,
  serviceOverrides: Partial<ConstructorParameters<typeof BackupBrokerService>[0]> = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'backup-broker-')); directories.push(root);
  const capsule = capsuleOverride ?? Buffer.from('age-encryption.org/v1\nsynthetic-encrypted-fixture\n');
  const rootKey = generateKeyPairSync('ed25519'); const active = generateKeyPairSync('ed25519'); const old = generateKeyPairSync('ed25519');
  const repositoryId = randomUUID();
  await fs.writeFile(join(root, 'repository.json'), `${JSON.stringify({ format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId })}\n`, { mode: 0o600 });
  const rootStat = await fs.stat(root, { bigint: true });
  const repository: LocalRepository = Object.freeze({ root, identity: { format: 'darshan-backup-repository-v1', site_id: 'site-a', repository_id: repositoryId }, deviceId: rootStat.dev.toString(), inode: rootStat.ino.toString(), ownerUid: Number(rootStat.uid), ownerGid: Number(rootStat.gid), mode: 0o700 });
  const policy = signCapsulePolicy({
    privateKeyPem: pem(rootKey.privateKey, 'pkcs8'), keyId: 'deployment-policy-2026',
    policy: { version: 2, generation: 'site-a-2026-10-28.1', site_id: 'site-a', repository_id: repositoryId, created_at: new Date().toISOString(), capsule_sha256: createHash('sha256').update(capsule).digest('hex'), capsule_size_bytes: capsule.byteLength.toString(), release_generation: 'release-01', deployment_generation: 'site-a-deploy-42', compatibility_generation: 1, age_recipient_key_id: 'age-site-a-2026', contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, encrypted_inventory_sha256: 'a'.repeat(64), required_roles: [...REQUIRED_CAPSULE_ROLES] },
  });
  const published = new Map<string, { manifest: BackupManifestV1; bytes: Buffer }>();
  const evidence = (publication: import('./backup-broker-journal').BrokerPublicationRecord) => {
    const stored = published.get(publication.run_id); if (!stored) throw Object.assign(new Error('not published'), { code: 'ENOENT' });
    if (createHash('sha256').update(stored.bytes).digest('hex') !== publication.signed_manifest_sha256) throw new Error('repository manifest tampered');
    const artifacts = stored.manifest.artifacts.map((artifact) => ({ path: artifact.ciphertextPath, size: artifact.ciphertextSizeBytes, sha256: artifact.ciphertextSha256 }));
    const identity = { repository_id: publication.repository_id, site_id: publication.site_id, run_id: publication.run_id, attempt_id: publication.attempt_id, capture_id: publication.capture_id, capture_generation: publication.capture_generation, manifest_sha256: publication.signed_manifest_sha256 };
    return { verified: true as const, run_relative_path: `runs/${publication.run_id}`, manifest_relative_path: `runs/${publication.run_id}/manifest.json`,
      configuration_policy_relative_path: `runs/${publication.run_id}/configuration-policy.json`, canonical_signed_manifest_base64: stored.bytes.toString('base64'),
      canonical_signed_configuration_policy_base64: canonicalJson(policy).toString('base64'), configuration_policy_sha256: policySha256(policy),
      capsule_generation: policy.policy.generation, encrypted_inventory_sha256: policy.policy.encrypted_inventory_sha256,
      intent: { format: 'darshan-backup-publication-intent-v1' as const, ...identity, created_at: '2026-10-28T10:02:00.000Z', artifacts }, receipt: { format: 'darshan-backup-publication-receipt-v1' as const, ...identity, published_at: '2026-10-28T10:03:00.000Z', verified_at: '2026-10-28T10:04:00.000Z' } };
  };
  const repositoryAdapter: ConstructorParameters<typeof BackupBrokerService>[0]['repositoryAdapter'] = {
    prepare: async ({ request }) => `${request.run_id}.${request.attempt_id}.${'a'.repeat(32)}`,
    commit: async ({ publication, manifest, signedManifestBytes }) => { published.set(publication.run_id, { manifest, bytes: signedManifestBytes }); return evidence(publication); },
    inspect: async (publication) => evidence(publication), quarantine: async () => undefined,
  };
  const retentionAdapter: NonNullable<ConstructorParameters<typeof BackupBrokerService>[0]['retentionAdapter']> = {
    planDeletion: async () => ({
      'manifest.json': { kind: 'FILE', expected_size: '1', expected_sha256: '1'.repeat(64), status: 'PENDING' },
      'database.tar.age': { kind: 'FILE', expected_size: '1', expected_sha256: '2'.repeat(64), status: 'PENDING' },
    }),
    executeDeletion: async ({ deletion, checkpoint }) => {
      deletion.namespace_renamed = true; deletion.status = 'RENAMED'; await checkpoint();
      for (const entry of Object.values(deletion.entries)) { entry.status = 'DELETED'; deletion.status = 'PARTIAL'; await checkpoint(); }
      deletion.status = 'DELETED'; await checkpoint();
    },
    cleanupStaging: async () => 'CLEANED',
  };
  const serviceOptions: ConstructorParameters<typeof BackupBrokerService>[0] = { socketPath: join(root, 'broker.sock'), socketMode: 0o660, allowFilesystemListenersForTests: true, helperVersion: '2.0.0', policy, encryptedCapsule: capsule, repository, repositoryAdapter, retentionAdapter, activeSigningKey: { keyId: 'manifest-2026', privateKeyPem: pem(active.privateKey, 'pkcs8') }, retainedVerificationKeys: [{ keyId: 'manifest-2025', publicKeyPem: pem(old.publicKey, 'spki') }], beforeOperation, ...serviceOverrides };
  const service = new BackupBrokerService(serviceOptions);
  await service.listen(); services.push(service);
  const options = { socketPath: join(root, 'broker.sock'), helperVersion: '2.0.0', policySha256: policySha256(policy), siteId: 'site-a', repositoryId: policy.policy.repository_id };
  return { root, capsule, policy, service, serviceOptions, client: new BackupBrokerClient(options), options, active, old, published };
}

function manifestBytes(input: {
  policy: Awaited<ReturnType<typeof fixture>>['policy']; run_id: string; attempt_id: string; capture_id: string; capture_generation: number;
  overrides?: Partial<BackupManifestV1>;
}): Buffer {
  const manifest: BackupManifestV1 = {
    version: 2, repository: { kind: 'LOCAL_FILESYSTEM', id: input.policy.policy.repository_id }, site: { id: input.policy.policy.site_id },
    run: { id: input.run_id, attemptId: input.attempt_id }, capture: { id: input.capture_id, generation: input.capture_generation.toString(), startedAt: '2026-10-28T10:00:00.000Z', sealedAt: '2026-10-28T10:01:00.000Z', stagingInventorySha256: '1'.repeat(64) },
    release: { id: input.policy.policy.release_generation }, schema: { migrationId: '0051_local_backup_publication', fingerprintSha256: '2'.repeat(64) },
    encryption: { keyId: input.policy.policy.age_recipient_key_id, tool: { name: 'age', version: '1.3.2', executableSha256: '3'.repeat(64) } },
    artifacts: [
      { kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: '100', ciphertextSha256: '4'.repeat(64) },
      { kind: 'OBJECTS', name: 'objects', ciphertextPath: 'objects.tar.age', ciphertextSizeBytes: '200', ciphertextSha256: '5'.repeat(64) },
      { kind: 'CONFIGURATION', name: 'configuration', ciphertextPath: 'configuration.tar.age', ciphertextSizeBytes: input.policy.policy.capsule_size_bytes, ciphertextSha256: input.policy.policy.capsule_sha256 },
    ], configurationPolicy: { policySha256: policySha256(input.policy), capsuleGeneration: input.policy.policy.generation,
      encryptedInventorySha256: input.policy.policy.encrypted_inventory_sha256 }, signature: null,
    ...input.overrides,
  };
  return serializeUnsignedBackupManifest(manifest);
}

const prepareInput = (policy: Awaited<ReturnType<typeof fixture>>['policy'], ids: { run_id: string; attempt_id: string; capture_id: string; capture_generation: number }, bytes: Buffer) => ({
  operation: 'PREPARE_PUBLICATION' as const, ...ids, expected_capsule_generation: policy.policy.generation,
  unsigned_manifest_sha256: createHash('sha256').update(bytes).digest('hex'), manifest_base64: bytes.toString('base64'),
});

describe('strict broker protocol v2', () => {
  it('rejects duplicate JSON names, unknown fields, and oversized frames', () => {
    expect(() => parseStrictJson(Buffer.from('{"operation":"DESCRIBE","operation":"SELECT_CAPSULE"}'), 1024)).toThrow(/duplicate object key/);
    const valid = { protocol_version: 2, operation: 'DESCRIBE', request_id: randomUUID(), helper_version: '2', policy_sha256: 'a'.repeat(64), site_id: 'site-a', repository_id: randomUUID(), deadline: new Date(Date.now() + 1000).toISOString() };
    expect(() => parseBackupBrokerRequest(canonicalJson({ ...valid, path: '/etc/shadow' }))).toThrow();
    expect(() => parseBackupBrokerRequest(canonicalJson({ ...valid, operation: 'INSPECT_RESTORE_HOLD',
      run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 1,
      manifest_sha256: 'a'.repeat(64), operation_id: randomUUID(), owner_token: randomUUID() }))).toThrow();
    expect(() => parseStrictJson(Buffer.alloc(BACKUP_BROKER_MAX_REQUEST_BYTES + 1), BACKUP_BROKER_MAX_REQUEST_BYTES)).toThrow(/invalid size/);
    expect(canonicalJson({ 'ä': 1, z: 2, b: 3 }).toString('utf8')).toBe('{"b":3,"z":2,"ä":1}\n');
    for (const invalidId of ['11111111-1111-4111-8111-11111111111A', '00000000-0000-0000-0000-000000000000',
      '11111111-1111-0111-8111-111111111111', '11111111-1111-9111-8111-111111111111', '11111111-1111-4111-7111-111111111111']) {
      expect(() => parseBackupBrokerRequest(canonicalJson({ ...valid, request_id: invalidId }))).toThrow();
      expect(() => backupBrokerResponseSchema.parse({ protocol_version: 2, operation: 'INSPECT_RESTORE_HOLD',
        request_id: valid.request_id, helper_version: '2', policy_sha256: 'a'.repeat(64), operation_id: invalidId,
        manifest_sha256: 'b'.repeat(64), status: 'ABSENT' })).toThrow();
    }
  });

  it('validates the public capsule descriptor without exposing private inventory entries', () => {
    const base = { version: 2 as const, generation: 'g1', site_id: 'site-a', repository_id: randomUUID(), created_at: new Date().toISOString(), capsule_sha256: 'a'.repeat(64), capsule_size_bytes: '10', release_generation: 'r1', deployment_generation: 'd1', compatibility_generation: 1, age_recipient_key_id: 'age-1', contract_id: PRODUCTION_CAPSULE_CONTRACT_ID, encrypted_inventory_sha256: 'c'.repeat(64), required_roles: [...REQUIRED_CAPSULE_ROLES] };
    expect(validateCapsulePolicy(base)).toEqual(base);
    expect(() => validateCapsulePolicy({ ...base, entries: [{ path: 'tls/server.key', sha256: 'b'.repeat(64) }] })).toThrow();
    expect(() => validateCapsulePolicy({ ...base, required_roles: ['backend'] })).toThrow(/exact production role set/);
  });

  it('rejects an encrypted capsule whose actual size disagrees with signed policy', async () => {
    const { serviceOptions, capsule, policy } = await fixture();
    const wrongSizePolicy = { ...policy, policy: { ...policy.policy, capsule_size_bytes: (capsule.byteLength + 1).toString() } };
    expect(() => new BackupBrokerService({ ...serviceOptions, policy: wrongSizePolicy })).toThrow(/size/);
    const wrongDigestPolicy = { ...policy, policy: { ...policy.policy, capsule_sha256: '0'.repeat(64) } };
    expect(() => new BackupBrokerService({ ...serviceOptions, policy: wrongDigestPolicy })).toThrow(/digest/);
  });

  it('serves DESCRIBE and SELECT_CAPSULE with socket bounds, exact identity, and retained keys', async () => {
    const { root, capsule, policy, client, old } = await fixture();
    expect((await fs.stat(join(root, 'broker.sock'))).mode & 0o777).toBe(0o660);
    const described = await client.describe();
    expect(described.manifest_verification_keys.map((key) => [key.key_id, key.active])).toEqual([['manifest-2026', true], ['manifest-2025', false]]);
    const oldPayload = Buffer.from('retained verification proof'); const oldSignature = sign(null, oldPayload, old.privateKey);
    expect(verify(null, oldPayload, described.manifest_verification_keys.find((key) => key.key_id === 'manifest-2025')!.public_key_pem, oldSignature)).toBe(true);
    const selected = await client.request({ operation: 'SELECT_CAPSULE', run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 1, expected_capsule_generation: policy.policy.generation, expected_capsule_sha256: policy.policy.capsule_sha256 });
    expect(selected.operation).toBe('SELECT_CAPSULE');
    if (selected.operation === 'SELECT_CAPSULE') expect(Buffer.from(selected.capsule_base64, 'base64')).toEqual(capsule);
  });

  it('does not unlink a non-socket entry at the configured socket path', async () => {
    const { service, options } = await fixture(); await service.close(); services.splice(services.indexOf(service), 1);
    await fs.writeFile(options.socketPath, 'operator-owned');
    // Reusing the service after normal close exercises startup cleanup without
    // reaching into its private configuration.
    await expect(service.listen()).rejects.toThrow(/non-socket/);
    expect(await fs.readFile(options.socketPath, 'utf8')).toBe('operator-owned');
  });

  it('does not unlink or replace a live socket when a second broker starts', async () => {
    const { client, serviceOptions } = await fixture();
    const second = new BackupBrokerService(serviceOptions);
    await expect(second.listen()).rejects.toThrow(/active listener/);
    expect((await client.describe()).operation).toBe('DESCRIBE');
    await second.close();
    expect((await client.describe()).operation).toBe('DESCRIBE');
  });

  it.each([
    ['site', { siteId: 'site-b' }, 'BROKER_IDENTITY_MISMATCH'],
    ['repository', { repositoryId: randomUUID() }, 'BROKER_IDENTITY_MISMATCH'],
    ['policy key', { policySha256: 'f'.repeat(64) }, 'BROKER_RESPONSE_IDENTITY_MISMATCH'],
  ])('rejects wrong %s binding', async (_label, override, code) => {
    const { options } = await fixture(); const client = new BackupBrokerClient({ ...options, ...override });
    await expect(client.describe()).rejects.toMatchObject({ code });
  });

  it('rejects wrong capsule generation and signs only the bound canonical unsigned manifest', async () => {
    const { client, policy, active } = await fixture(); const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 4 };
    await expect(client.request({ operation: 'SELECT_CAPSULE', ...ids, expected_capsule_generation: 'stale', expected_capsule_sha256: policy.policy.capsule_sha256 })).rejects.toMatchObject({ code: 'BROKER_CAPSULE_MISMATCH' });
    const bytes = manifestBytes({ policy, ...ids }); const prepared = await client.request(prepareInput(policy, ids, bytes));
    expect(prepared.operation).toBe('PREPARE_PUBLICATION');
    if (prepared.operation === 'PREPARE_PUBLICATION') {
      expect(verify(null, bytes, active.publicKey, Buffer.from(prepared.signature_base64, 'base64'))).toBe(true);
      expect(prepared.incomplete_relative_path).toBe(`incomplete/${ids.run_id}.${ids.attempt_id}.${'a'.repeat(32)}`);
      expect(prepared.published_relative_path).toBe(`runs/${ids.run_id}`);
    }
  });

  it('refuses malformed, noncanonical, unbound, or wrong-capsule manifests without returning a signature', async () => {
    const { client, policy } = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 7 };
    const valid = manifestBytes({ policy, ...ids });
    const unknown = Buffer.from(JSON.stringify({ ...(JSON.parse(valid.toString('utf8')) as object), unknown_authority: true }));
    const cases: Array<[string, Buffer, string]> = [
      ['malformed', Buffer.from('{'), 'BROKER_MANIFEST_INVALID'],
      ['noncanonical', Buffer.concat([Buffer.from(' '), valid]), 'BROKER_MANIFEST_INVALID'],
      ['unknown field', unknown, 'BROKER_MANIFEST_INVALID'],
      ['wrong site', manifestBytes({ policy, ...ids, overrides: { site: { id: 'site-b' } } }), 'BROKER_MANIFEST_IDENTITY_MISMATCH'],
      ['wrong run', manifestBytes({ policy, ...ids, overrides: { run: { id: randomUUID(), attemptId: ids.attempt_id } } }), 'BROKER_MANIFEST_IDENTITY_MISMATCH'],
      ['wrong attempt', manifestBytes({ policy, ...ids, overrides: { run: { id: ids.run_id, attemptId: randomUUID() } } }), 'BROKER_MANIFEST_IDENTITY_MISMATCH'],
      ['wrong capture', manifestBytes({ policy, ...ids, overrides: { capture: { id: randomUUID(), generation: ids.capture_generation.toString(), startedAt: '2026-10-28T10:00:00.000Z', sealedAt: '2026-10-28T10:01:00.000Z', stagingInventorySha256: '1'.repeat(64) } } }), 'BROKER_MANIFEST_IDENTITY_MISMATCH'],
      ['wrong generation', manifestBytes({ policy, ...ids, overrides: { capture: { id: ids.capture_id, generation: '8', startedAt: '2026-10-28T10:00:00.000Z', sealedAt: '2026-10-28T10:01:00.000Z', stagingInventorySha256: '1'.repeat(64) } } }), 'BROKER_MANIFEST_IDENTITY_MISMATCH'],
      ['wrong repository', manifestBytes({ policy, ...ids, overrides: { repository: { kind: 'LOCAL_FILESYSTEM', id: randomUUID() } } }), 'BROKER_MANIFEST_IDENTITY_MISMATCH'],
      ['wrong release', manifestBytes({ policy, ...ids, overrides: { release: { id: 'release-other' } } }), 'BROKER_MANIFEST_POLICY_MISMATCH'],
      ['wrong age recipient key', manifestBytes({ policy, ...ids, overrides: { encryption: { keyId: 'age-other', tool: { name: 'age', version: '1.3.2', executableSha256: '3'.repeat(64) } } } }), 'BROKER_MANIFEST_POLICY_MISMATCH'],
      ['wrong policy digest', manifestBytes({ policy, ...ids, overrides: { configurationPolicy: { policySha256: '0'.repeat(64), capsuleGeneration: policy.policy.generation, encryptedInventorySha256: policy.policy.encrypted_inventory_sha256 } } }), 'BROKER_MANIFEST_POLICY_MISMATCH'],
      ['wrong policy generation', manifestBytes({ policy, ...ids, overrides: { configurationPolicy: { policySha256: policySha256(policy), capsuleGeneration: 'stale', encryptedInventorySha256: policy.policy.encrypted_inventory_sha256 } } }), 'BROKER_MANIFEST_POLICY_MISMATCH'],
      ['wrong encrypted inventory digest', manifestBytes({ policy, ...ids, overrides: { configurationPolicy: { policySha256: policySha256(policy), capsuleGeneration: policy.policy.generation, encryptedInventorySha256: '0'.repeat(64) } } }), 'BROKER_MANIFEST_POLICY_MISMATCH'],
    ];
    for (const [label, bytes, code] of cases) {
      let rejection: unknown;
      try { await client.request(prepareInput(policy, ids, bytes)); } catch (error) { rejection = error; }
      expect(rejection, label).toMatchObject({ code });
      expect(rejection, label).not.toHaveProperty('signature_base64');
    }
  });

  it('requires exactly the database, objects, and active configuration artifacts before signing', async () => {
    const { client, policy } = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 12 };
    const original = (JSON.parse(manifestBytes({ policy, ...ids }).toString('utf8')) as BackupManifestV1).artifacts;
    const cases: Array<[string, BackupManifestV1['artifacts'], string]> = [
      ['missing', original.slice(0, 2), 'BROKER_MANIFEST_ARTIFACT_SET_INVALID'],
      ['duplicate kind', [original[0], { ...original[0], name: 'database-copy', ciphertextPath: 'database-copy.tar.age' }, original[2]], 'BROKER_MANIFEST_ARTIFACT_SET_INVALID'],
      ['OTHER', [original[0], original[1], { ...original[2], kind: 'OTHER' }], 'BROKER_MANIFEST_ARTIFACT_SET_INVALID'],
      ['extra', [...original, { kind: 'OTHER', name: 'extra', ciphertextPath: 'extra.tar.age', ciphertextSizeBytes: '1', ciphertextSha256: '6'.repeat(64) }], 'BROKER_MANIFEST_ARTIFACT_SET_INVALID'],
      ['wrong capsule digest', [original[0], original[1], { ...original[2], ciphertextSha256: '9'.repeat(64) }], 'BROKER_MANIFEST_CAPSULE_MISMATCH'],
    ];
    for (const [label, artifacts, code] of cases) {
      const bytes = manifestBytes({ policy, ...ids, overrides: { artifacts } });
      let rejection: unknown;
      try { await client.request(prepareInput(policy, ids, bytes)); } catch (error) { rejection = error; }
      expect(rejection, label).toMatchObject({ code });
      expect(rejection, label).not.toHaveProperty('signature_base64');
    }
  });

  it('replays an identical request and conflicts on changed content or publication digest', async () => {
    const { client, policy } = await fixture(); const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 9 }; const request_id = randomUUID();
    const bytes = manifestBytes({ policy, ...ids });
    const input = { ...prepareInput(policy, ids, bytes), request_id, deadline: new Date(Date.now() + 30_000).toISOString() };
    const first = await client.request(input); expect(await client.request(input)).toEqual(first);
    const conflictingBytes = manifestBytes({ policy, ...ids, overrides: { schema: { migrationId: '0051_local_backup_publication', fingerprintSha256: '4'.repeat(64) } } });
    await expect(client.request({ ...input, unsigned_manifest_sha256: createHash('sha256').update(conflictingBytes).digest('hex'), manifest_base64: conflictingBytes.toString('base64') })).rejects.toMatchObject({ code: 'BROKER_REPLAY_CONFLICT' });
    await expect(client.request({ ...prepareInput(policy, ids, conflictingBytes), request_id: randomUUID() })).rejects.toMatchObject({ code: 'BROKER_PUBLICATION_CONFLICT' });
  });

  it('durably replays after broker restart and serializes concurrent identical requests', async () => {
    let operations = 0;
    const fixtureValue = await fixture(async () => { operations += 1; await new Promise((resolve) => setTimeout(resolve, 15)); });
    const { client, policy, service, serviceOptions } = fixtureValue;
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 21 };
    const bytes = manifestBytes({ policy, ...ids }); const input = { ...prepareInput(policy, ids, bytes), request_id: randomUUID(), deadline: new Date(Date.now() + 30_000).toISOString() };
    const [first, concurrent] = await Promise.all([client.request(input), client.request(input)]);
    expect(concurrent).toEqual(first); expect(operations).toBe(1);
    await service.close(); services.splice(services.indexOf(service), 1);
    const restarted = new BackupBrokerService(serviceOptions); await restarted.listen(); services.push(restarted);
    expect(await client.request(input)).toEqual(first); expect(operations).toBe(1);
  });

  it('does not journal repeated large SELECT_CAPSULE or health reads', async () => {
    const largeCapsule = Buffer.alloc(2 * 1024 * 1024, 0x61);
    const { root, client, policy, service, serviceOptions } = await fixture(undefined, largeCapsule);
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 23 };
    const input = { operation: 'SELECT_CAPSULE' as const, ...ids, expected_capsule_generation: policy.policy.generation, expected_capsule_sha256: policy.policy.capsule_sha256, request_id: randomUUID(), deadline: new Date(Date.now() + 30_000).toISOString() };
    const first = await client.request(input); expect(await client.request(input)).toEqual(first);
    await expect(fs.stat(join(root, 'broker-journal', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const prepareIds = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 24 };
    const bytes = manifestBytes({ policy, ...prepareIds }); await client.request(prepareInput(policy, prepareIds, bytes));
    const statePath = join(root, 'broker-journal', 'state.json'); const size = (await fs.stat(statePath)).size;
    for (let index = 0; index < 4; index += 1) {
      await client.describe();
      await client.request({ ...input, request_id: randomUUID(), deadline: new Date(Date.now() + 30_000).toISOString() });
      await client.request({ operation: 'INSPECT_PUBLICATION', ...prepareIds });
    }
    expect((await fs.stat(statePath)).size).toBe(size);
    await service.close(); services.splice(services.indexOf(service), 1); const restarted = new BackupBrokerService(serviceOptions); await restarted.listen(); services.push(restarted);
    expect(await client.request(input)).toEqual(first); expect((await fs.stat(statePath)).size).toBe(size);
  });

  it('returns exact hold absence without creating broker journal paths or replay state', async () => {
    const value = await fixture();
    const before = (await fs.readdir(value.root)).sort();
    await expect(value.client.inspectRestoreHold({
      run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 1,
      manifest_sha256: 'a'.repeat(64), operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID(),
    })).resolves.toMatchObject({ status: 'ABSENT' });
    expect((await fs.readdir(value.root)).sort()).toEqual(before);
    await expect(fs.lstat(join(value.root, 'broker-journal'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('enforces one run claim, monotonic terminal state, and inspect digest binding', async () => {
    const { client, policy } = await fixture(); const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 22 };
    const bytes = manifestBytes({ policy, ...ids }); const prepared = await client.request(prepareInput(policy, ids, bytes));
    expect(prepared.operation).toBe('PREPARE_PUBLICATION'); if (prepared.operation !== 'PREPARE_PUBLICATION') return;
    await expect(client.request({ operation: 'PREPARE_PUBLICATION', ...prepareInput(policy, { ...ids, attempt_id: randomUUID() }, manifestBytes({ policy, ...ids, attempt_id: randomUUID() })) })).rejects.toMatchObject({ code: 'BROKER_RUN_CLAIM_CONFLICT' });
    await expect(client.request({ operation: 'INSPECT_PUBLICATION', ...ids, signed_manifest_sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'BROKER_PUBLICATION_CONFLICT' });
    const digests = { unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 };
    const committed = await client.request({ operation: 'COMMIT_PUBLICATION', ...ids, ...digests }); expect(committed).toMatchObject({ operation: 'COMMIT_PUBLICATION', status: 'COMMITTED' });
    await expect(client.request({ operation: 'QUARANTINE_PUBLICATION', ...ids, ...digests })).rejects.toMatchObject({ code: 'BROKER_PUBLICATION_STATE_CONFLICT' });
    expect(await client.request({ operation: 'INSPECT_PUBLICATION', ...ids, signed_manifest_sha256: prepared.signed_manifest_sha256 })).toMatchObject({ status: 'COMMITTED' });
  });

  it('persists multiple exact restore holds across restart and fences deletion until each is released', async () => {
    const value = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 31 };
    const prepared = await value.client.request(prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })));
    if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await value.client.request({ operation: 'COMMIT_PUBLICATION', ...ids, unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 });
    const owner = randomUUID(); const first = { operation_id: randomUUID(), owner_token: owner, fence_token: randomUUID() };
    const second = { operation_id: randomUUID(), owner_token: owner, fence_token: randomUUID() };
    const bound = { ...ids, manifest_sha256: prepared.signed_manifest_sha256 };
    await expect(value.client.request({ operation: 'ACQUIRE_RESTORE_HOLD', ...bound, ...first })).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(value.client.request({ operation: 'ACQUIRE_RESTORE_HOLD', ...bound, ...second })).resolves.toMatchObject({ status: 'ACTIVE' });
    await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const restarted = new BackupBrokerService(value.serviceOptions); await restarted.listen(); services.push(restarted);
    expect(await value.client.request({ operation: 'INSPECT_RETENTION_TRUTH', ...bound, operation_id: randomUUID(), owner_token: owner, fence_token: randomUUID() })).toMatchObject({ status: 'AVAILABLE', active_holds: 2 });
    await value.client.request({ operation: 'RELEASE_RESTORE_HOLD', ...bound, ...first });
    const deletion = { operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await expect(value.client.request({ operation: 'CLAIM_RUN_DELETION', ...bound, ...deletion })).rejects.toMatchObject({ code: 'BROKER_DELETE_BLOCKED_BY_HOLD' });
    await value.client.request({ operation: 'MARK_RESTORE_HOLD_UNCERTAIN', ...bound, ...second });
    await expect(value.client.request({ operation: 'CLAIM_RUN_DELETION', ...bound, ...deletion })).rejects.toMatchObject({ code: 'BROKER_DELETE_BLOCKED_BY_HOLD' });
    await expect(value.client.request({ operation: 'RELEASE_RESTORE_HOLD', ...bound, ...second, fence_token: randomUUID() })).rejects.toMatchObject({ code: 'BROKER_LIFECYCLE_FENCE_CONFLICT' });
    await value.client.request({ operation: 'RELEASE_RESTORE_HOLD', ...bound, ...second });
    await expect(value.client.request({ operation: 'CLAIM_RUN_DELETION', ...bound, ...deletion })).resolves.toMatchObject({ status: 'CLAIMED' });
    await expect(value.client.request({ operation: 'ACQUIRE_RESTORE_HOLD', ...bound, operation_id: randomUUID(), owner_token: owner, fence_token: randomUUID() })).rejects.toMatchObject({ code: 'BROKER_DELETE_ALREADY_CLAIMED' });
  });

  it('inspects one exact durable restore hold without replay state, aggregates, or physical source reads', async () => {
    const value = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 36 };
    const prepared = await value.client.request(prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })));
    if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await value.client.request({ operation: 'COMMIT_PUBLICATION', ...ids,
      unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 });
    const bound = { ...ids, manifest_sha256: prepared.signed_manifest_sha256 };
    const hold = { operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    const absent = { operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await expect(value.client.inspectRestoreHold({ ...bound, ...absent })).resolves.toMatchObject({
      operation: 'INSPECT_RESTORE_HOLD', operation_id: absent.operation_id,
      manifest_sha256: bound.manifest_sha256, status: 'ABSENT',
    });
    await value.client.request({ operation: 'ACQUIRE_RESTORE_HOLD', ...bound, ...hold });
    const request_id = randomUUID();
    const active = await value.client.inspectRestoreHold({ ...bound, ...hold, request_id });
    expect(active).toMatchObject({ status: 'ACTIVE', operation_id: hold.operation_id });
    expect(active).not.toHaveProperty('active_holds');
    expect(active).not.toHaveProperty('owner_token');
    for (const aliasedOperationId of [hold.operation_id.toUpperCase(), '00000000-0000-0000-0000-000000000000',
      '11111111-1111-0111-8111-111111111111', '11111111-1111-9111-8111-111111111111', '11111111-1111-4111-7111-111111111111']) {
      let rejected: unknown;
      try { await value.client.inspectRestoreHold({ ...bound, ...hold, operation_id: aliasedOperationId }); }
      catch (error) { rejected = error; }
      expect(rejected).toBeInstanceOf(Error);
      expect(rejected).not.toMatchObject({ status: 'ABSENT' });
    }
    await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const restarted = new BackupBrokerService({ ...value.serviceOptions,
      repositoryAdapter: { ...value.serviceOptions.repositoryAdapter,
        inspect: async () => { throw new Error('physical source inspection is forbidden'); } },
      retentionAdapter: { ...value.serviceOptions.retentionAdapter!,
        inspectPublished: async () => { throw new Error('physical source inspection is forbidden'); } } });
    await restarted.listen(); services.push(restarted);
    const journalPath = join(value.root, 'broker-journal', 'state.json');
    const before = await fs.readFile(journalPath);
    await expect(value.client.inspectRestoreHold({ ...bound, ...hold })).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(await fs.readFile(journalPath)).toEqual(before);
    await value.client.request({ operation: 'MARK_RESTORE_HOLD_UNCERTAIN', ...bound, ...hold });
    await expect(value.client.inspectRestoreHold({ ...bound, ...hold, request_id })).resolves.toMatchObject({ status: 'UNCERTAIN' });
    await expect(value.client.inspectRestoreHold({ ...bound, ...hold, owner_token: randomUUID() }))
      .rejects.toMatchObject({ code: 'BROKER_LIFECYCLE_FENCE_CONFLICT' });
    await value.client.request({ operation: 'RELEASE_RESTORE_HOLD', ...bound, ...hold });
    await expect(value.client.inspectRestoreHold({ ...bound, ...hold })).resolves.toMatchObject({ status: 'RELEASED' });
    const deletion = { operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await value.client.request({ operation: 'CLAIM_RUN_DELETION', ...bound, ...deletion });
    await expect(value.client.inspectRestoreHold({ ...bound, ...hold })).resolves.toMatchObject({ status: 'RELEASED' });
    await expect(value.client.inspectRestoreHold({ ...bound, ...absent })).resolves.toMatchObject({ status: 'ABSENT' });
  });

  it('has the client reject a response carrying an aliased lifecycle UUID', async () => {
    const value = await fixture(); const socketPath = join(value.root, 'alias-response.sock');
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      socket.resume(); socket.once('end', () => socket.end(canonicalJson({
        protocol_version: 2, operation: 'INSPECT_RESTORE_HOLD', request_id: '11111111-1111-4111-8111-111111111111',
        helper_version: value.options.helperVersion, policy_sha256: value.options.policySha256,
        operation_id: '44444444-4444-4444-8444-44444444444A', manifest_sha256: 'a'.repeat(64), status: 'ACTIVE',
      })));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    try {
      const client = new BackupBrokerClient({ ...value.options, socketPath });
      await expect(client.inspectRestoreHold({
        run_id: '11111111-1111-4111-8111-111111111111', attempt_id: '22222222-2222-4222-8222-222222222222',
        capture_id: '33333333-3333-4333-8333-333333333333', capture_generation: 1,
        manifest_sha256: 'a'.repeat(64), operation_id: '44444444-4444-4444-8444-444444444444',
        owner_token: '55555555-5555-4555-8555-555555555555', fence_token: '66666666-6666-4666-8666-666666666666',
        request_id: '11111111-1111-4111-8111-111111111111',
      })).rejects.toMatchObject({ code: 'BROKER_RESPONSE_INVALID', dispatched: true });
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });

  it('serializes exact hold inspection ahead of a competing release', async () => {
    let entered!: () => void; let continueInspection!: () => void;
    const inspectionEntered = new Promise<void>((resolve) => { entered = resolve; });
    const inspectionGate = new Promise<void>((resolve) => { continueInspection = resolve; });
    let blockInspection = false;
    const value = await fixture(async (request) => {
      if (blockInspection && request.operation === 'INSPECT_RESTORE_HOLD') { entered(); await inspectionGate; }
    });
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 37 };
    const prepared = await value.client.request(prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })));
    if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await value.client.request({ operation: 'COMMIT_PUBLICATION', ...ids,
      unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 });
    const identity = { ...ids, manifest_sha256: prepared.signed_manifest_sha256,
      operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await value.client.request({ operation: 'ACQUIRE_RESTORE_HOLD', ...identity });
    blockInspection = true;
    const inspected = value.client.inspectRestoreHold(identity); await inspectionEntered;
    let releaseSettled = false;
    const released = value.client.request({ operation: 'RELEASE_RESTORE_HOLD', ...identity }).finally(() => { releaseSettled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20)); expect(releaseSettled).toBe(false);
    continueInspection();
    await expect(inspected).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(released).resolves.toMatchObject({ status: 'RELEASED' });
  });

  it('admits an old trusted run through historical trust after active capsule rotation and still fences the hold/delete race', async () => {
    const value = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 35 };
    const prepared = await value.client.request(prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })));
    if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await value.client.request({ operation: 'COMMIT_PUBLICATION', ...ids,
      unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 });
    await value.service.close(); services.splice(services.indexOf(value.service), 1);
    let historicalInspections = 0;
    const historicalRetention = { ...value.serviceOptions.retentionAdapter!,
      inspectPublished: async () => { historicalInspections += 1; } };
    const rotated = new BackupBrokerService({ ...value.serviceOptions,
      repositoryAdapter: { ...value.serviceOptions.repositoryAdapter,
        inspect: async () => { throw new Error('active capsule rotated'); } },
      retentionAdapter: historicalRetention });
    await rotated.listen(); services.push(rotated);
    const bound = { ...ids, manifest_sha256: prepared.signed_manifest_sha256 };
    const hold = { operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await expect(value.client.request({ operation: 'ACQUIRE_RESTORE_HOLD', ...bound, ...hold })).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(historicalInspections).toBe(1);
    await expect(value.client.request({ operation: 'CLAIM_RUN_DELETION', ...bound,
      operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() }))
      .rejects.toMatchObject({ code: 'BROKER_DELETE_BLOCKED_BY_HOLD' });
  });

  it('keeps deletion terminal truth ahead of cached publication acknowledgements', async () => {
    const value = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 32 };
    const prepareRequest = { ...prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })), request_id: randomUUID(), deadline: new Date(Date.now() + 30_000).toISOString() };
    const prepared = await value.client.request(prepareRequest); if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    const commitRequest = { operation: 'COMMIT_PUBLICATION' as const, ...ids, unsigned_manifest_sha256: prepared.unsigned_manifest_sha256,
      signed_manifest_sha256: prepared.signed_manifest_sha256, request_id: randomUUID(), deadline: new Date(Date.now() + 30_000).toISOString() };
    await value.client.request(commitRequest);
    const deletion = { ...ids, manifest_sha256: prepared.signed_manifest_sha256, operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await value.client.request({ operation: 'CLAIM_RUN_DELETION', ...deletion });
    expect(await value.client.request({ operation: 'INSPECT_PUBLICATION', ...ids })).toMatchObject({ status: 'DELETION_CLAIMED' });
    await value.client.request({ operation: 'EXECUTE_RUN_DELETION', ...deletion });
    expect(await value.client.request({ operation: 'INSPECT_PUBLICATION', ...ids })).toMatchObject({ status: 'DELETED' });
    await expect(value.client.request(prepareRequest)).rejects.toMatchObject({ code: 'BROKER_PUBLICATION_HISTORICAL_ONLY' });
    await expect(value.client.request(commitRequest)).rejects.toMatchObject({ code: 'BROKER_PUBLICATION_HISTORICAL_ONLY' });
    expect(await value.client.request({ operation: 'INSPECT_RETENTION_TRUTH', ...deletion })).toMatchObject({ status: 'DELETED' });
  });

  it('exposes staging cleanup only for an exact terminal quarantined attempt', async () => {
    const value = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 33 };
    const prepared = await value.client.request(prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })));
    if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await value.client.request({ operation: 'QUARANTINE_PUBLICATION', ...ids, unsigned_manifest_sha256: prepared.unsigned_manifest_sha256,
      signed_manifest_sha256: prepared.signed_manifest_sha256 });
    const cleanup = { ...ids, manifest_sha256: prepared.signed_manifest_sha256, operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() };
    await expect(value.client.request({ operation: 'CLEANUP_STAGING', ...cleanup })).resolves.toMatchObject({ status: 'CLEANED' });
    await expect(value.client.request({ operation: 'CLEANUP_STAGING', ...cleanup, request_id: randomUUID(), owner_token: randomUUID() }))
      .rejects.toMatchObject({ code: 'BROKER_LIFECYCLE_FENCE_CONFLICT' });
  });

  it('fsyncs deletion intent before execution and resumes the exact claim after an injected response-boundary crash', async () => {
    const value = await fixture();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 34 };
    const prepared = await value.client.request(prepareInput(value.policy, ids, manifestBytes({ policy: value.policy, ...ids })));
    if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await value.client.request({ operation: 'COMMIT_PUBLICATION', ...ids, unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 });
    await value.service.close(); services.splice(services.indexOf(value.service), 1);
    let fail = true;
    const restarted = new BackupBrokerService({ ...value.serviceOptions, retentionFault: async () => { if (fail) { fail = false; throw new Error('injected post-intent crash'); } } });
    await restarted.listen(); services.push(restarted);
    const claim = { operation: 'CLAIM_RUN_DELETION' as const, ...ids, manifest_sha256: prepared.signed_manifest_sha256,
      operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID(), request_id: randomUUID(), deadline: new Date(Date.now() + 30_000).toISOString() };
    await expect(value.client.request(claim)).rejects.toThrow(/post-intent crash/);
    expect(await value.client.request({ ...claim, operation: 'INSPECT_RETENTION_TRUTH', request_id: randomUUID() })).toMatchObject({ status: 'DELETION_CLAIMED' });
    await expect(value.client.request(claim)).resolves.toMatchObject({ status: 'CLAIMED' });
  });

  it('accepts a mutation deadline beyond 60 seconds while rejecting it for control reads', async () => {
    const { client, policy } = await fixture(); const deadline = new Date(Date.now() + 120_000).toISOString();
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 25 };
    const bytes = manifestBytes({ policy, ...ids });
    await expect(client.request({ ...prepareInput(policy, ids, bytes), deadline })).resolves.toMatchObject({ operation: 'PREPARE_PUBLICATION' });
    await expect(client.request({ operation: 'DESCRIBE', deadline })).rejects.toMatchObject({ code: 'BROKER_DEADLINE_INVALID' });
  });

  it('fails INSPECT when durable journal COMMITTED disagrees with repository truth', async () => {
    const { client, policy, published } = await fixture(); const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 26 };
    const prepared = await client.request(prepareInput(policy, ids, manifestBytes({ policy, ...ids }))); if (prepared.operation !== 'PREPARE_PUBLICATION') throw new Error('unexpected response');
    await client.request({ operation: 'COMMIT_PUBLICATION', ...ids, unsigned_manifest_sha256: prepared.unsigned_manifest_sha256, signed_manifest_sha256: prepared.signed_manifest_sha256 });
    published.get(ids.run_id)!.bytes[0] ^= 1;
    await expect(client.request({ operation: 'INSPECT_PUBLICATION', ...ids, signed_manifest_sha256: prepared.signed_manifest_sha256 })).rejects.toMatchObject({ code: 'BROKER_REPOSITORY_TRUTH_MISMATCH' });
  });

  it('does not start broker work when a client disconnects before frame EOF', async () => {
    let operations = 0; const { options } = await fixture(async () => { operations += 1; });
    const socket = createConnection(options.socketPath); await new Promise<void>((resolve) => socket.once('connect', resolve));
    const frame = canonicalJson({ protocol_version: 2, operation: 'DESCRIBE', request_id: randomUUID(), helper_version: options.helperVersion, policy_sha256: options.policySha256, site_id: options.siteId, repository_id: options.repositoryId, deadline: new Date(Date.now() + 5000).toISOString() });
    socket.write(frame.subarray(0, frame.length - 1));
    socket.destroy(); await new Promise((resolve) => setTimeout(resolve, 30)); expect(operations).toBe(0);
  });

  it('serves immutable DESCRIBE while a mutation is blocked without touching the journal', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { root, client, policy } = await fixture(async (request) => {
      if (request.operation === 'PREPARE_PUBLICATION') { entered(); await gate; }
    });
    const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 28 };
    const mutation = client.request(prepareInput(policy, ids, manifestBytes({ policy, ...ids })));
    await started;
    const begin = Date.now();
    await expect(client.describe()).resolves.toMatchObject({ operation: 'DESCRIBE', capabilities: { durable_publication: true } });
    expect(Date.now() - begin).toBeLessThan(1000);
    await expect(fs.stat(join(root, 'broker-journal', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    release(); await expect(mutation).resolves.toMatchObject({ operation: 'PREPARE_PUBLICATION' });
  });

  it('rejects trailing frames at write EOF before dispatch', async () => {
    let operations = 0; const { options } = await fixture(async () => { operations += 1; });
    const socket = createConnection(options.socketPath); const response: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => response.push(chunk)); await new Promise<void>((resolve) => socket.once('connect', resolve));
    const frame = canonicalJson({ protocol_version: 2, operation: 'DESCRIBE', request_id: randomUUID(), helper_version: options.helperVersion, policy_sha256: options.policySha256, site_id: options.siteId, repository_id: options.repositoryId, deadline: new Date(Date.now() + 5000).toISOString() });
    socket.end(Buffer.concat([frame, Buffer.from('{}\n')])); await new Promise<void>((resolve) => socket.once('end', resolve));
    expect(parseStrictJson(Buffer.concat(response), 1024 * 1024)).toMatchObject({ operation: 'ERROR', code: 'BROKER_FRAME_INVALID' }); expect(operations).toBe(0);
  });

  it('fails closed when durable journal ownership or mode is changed', async () => {
    const { root, client, policy } = await fixture(); const ids = { run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 27 };
    await client.request(prepareInput(policy, ids, manifestBytes({ policy, ...ids })));
    await fs.chmod(join(root, 'broker-journal', 'state.json'), 0o644);
    await expect(client.request({ operation: 'INSPECT_PUBLICATION', ...ids })).rejects.toMatchObject({ code: 'BROKER_JOURNAL_UNSAFE' });
  });

  it('removes a journal temporary file when writing fails before rename', async () => {
    const { serviceOptions, root } = await fixture();
    const journal = new BackupBrokerJournal(serviceOptions.repository, async () => { throw new Error('injected journal write failure'); });
    await expect(journal.execute({ requestId: randomUUID(), requestSha256: 'a'.repeat(64), operation: () => Buffer.from('{}\n') })).rejects.toThrow(/injected/);
    expect((await fs.readdir(join(root, 'broker-journal'))).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('reads a v1 journal and durably upgrades it on the next mutation', async () => {
    const { service, serviceOptions, root } = await fixture(); await service.close(); services.splice(services.indexOf(service), 1);
    const directory = join(root, 'broker-journal'); await fs.mkdir(directory, { mode: 0o700 });
    await fs.writeFile(join(directory, 'state.json'), canonicalJson({ format: 'darshan-backup-broker-journal-v1', revision: 4, requests: {}, publications: {} }), { mode: 0o600 });
    const journal = new BackupBrokerJournal(serviceOptions.repository);
    expect(await journal.query((state) => state)).toMatchObject({ format: 'darshan-backup-broker-journal-v2', revision: 4, holds: {}, deletions: {}, tombstones: {} });
    await journal.execute({ requestId: randomUUID(), requestSha256: 'a'.repeat(64), operation: () => Buffer.from('{}\n') });
    expect(parseStrictJson(await fs.readFile(join(directory, 'state.json')), 64 * 1024 * 1024)).toMatchObject({ format: 'darshan-backup-broker-journal-v2', revision: 5 });
  });

  it('gates the recovery endpoint before identity, hooks, journal, and replay state', async () => {
    let operations = 0;
    const socketRoot = await fs.mkdtemp(join(tmpdir(), 'backup-broker-recovery-')); directories.push(socketRoot);
    const recoverySocketPath = join(socketRoot, 'recovery.sock');
    const value = await fixture(async () => { operations += 1; }, undefined, { recoverySocketPath });
    const recovery = new BackupBrokerClient({ ...value.options, socketPath: recoverySocketPath });
    const requestId = randomUUID();
    await expect(recovery.request({ operation: 'DESCRIBE', request_id: requestId })).rejects.toMatchObject({ code: 'BROKER_RECOVERY_OPERATION_FORBIDDEN' });
    expect(operations).toBe(0);
    const raw = createConnection(recoverySocketPath); const chunks: Buffer[] = [];
    raw.on('data', (chunk: Buffer) => chunks.push(chunk)); await new Promise<void>((resolve) => raw.once('connect', resolve));
    raw.end(canonicalJson({ protocol_version: 2, operation: 'DESCRIBE', request_id: randomUUID(), helper_version: 'wrong',
      policy_sha256: '0'.repeat(64), site_id: 'wrong-site', repository_id: randomUUID(), deadline: new Date(Date.now() + 5000).toISOString() }));
    await new Promise<void>((resolve) => raw.once('end', resolve));
    expect(parseStrictJson(Buffer.concat(chunks), 1024 * 1024)).toMatchObject({ code: 'BROKER_RECOVERY_OPERATION_FORBIDDEN' });
    expect(operations).toBe(0);
    await expect(fs.stat(join(value.root, 'broker-journal', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(value.client.request({ operation: 'DESCRIBE', request_id: requestId })).resolves.toMatchObject({ operation: 'DESCRIBE' });
    expect(operations).toBe(1);
    await expect(recovery.request({ operation: 'INSPECT_RESTORE_HOLD', request_id: randomUUID(),
      run_id: randomUUID(), attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 1,
      manifest_sha256: 'a'.repeat(64), operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID(),
    })).resolves.toMatchObject({ operation: 'INSPECT_RESTORE_HOLD', status: 'ABSENT' });
  });

  it('bounds recovery frames and concurrent admissions independently of the main listener', async () => {
    let operations = 0;
    const socketRoot = await fs.mkdtemp(join(tmpdir(), 'backup-broker-bounds-')); directories.push(socketRoot);
    const recoverySocketPath = join(socketRoot, 'recovery.sock');
    const value = await fixture(async () => { operations += 1; }, undefined, { recoverySocketPath });
    const oversized = createConnection(recoverySocketPath);
    await new Promise<void>((resolve) => oversized.once('connect', resolve));
    oversized.end(Buffer.alloc(8 * 1024 + 2, 0x20));
    await new Promise<void>((resolve) => oversized.once('close', () => resolve()));
    expect(operations).toBe(0);
    const held = Array.from({ length: 4 }, () => createConnection(recoverySocketPath));
    await Promise.all(held.map((socket) => new Promise<void>((resolve) => socket.once('connect', resolve))));
    held.forEach((socket) => socket.write('{'));
    const excess = createConnection(recoverySocketPath);
    await new Promise<void>((resolve) => excess.once('close', () => resolve()));
    held.forEach((socket) => socket.destroy());
    await expect(value.client.describe()).resolves.toMatchObject({ operation: 'DESCRIBE' });
  });

  it('drains accepted recovery work before shared repeated close completes', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const socketRoot = await fs.mkdtemp(join(tmpdir(), 'backup-broker-drain-')); directories.push(socketRoot);
    const recoverySocketPath = join(socketRoot, 'recovery.sock');
    const value = await fixture(async (request) => {
      if (request.operation === 'INSPECT_RESTORE_HOLD') { entered(); await gate; }
    }, undefined, { recoverySocketPath, closeGraceMs: 10_000 });
    const recovery = new BackupBrokerClient({ ...value.options, socketPath: recoverySocketPath });
    const pending = recovery.request({ operation: 'INSPECT_RESTORE_HOLD', run_id: randomUUID(), attempt_id: randomUUID(),
      capture_id: randomUUID(), capture_generation: 1, manifest_sha256: 'a'.repeat(64), operation_id: randomUUID(),
      owner_token: randomUUID(), fence_token: randomUUID() });
    await started;
    const first = value.service.close(); const second = value.service.close();
    let closed = false; void first.then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20)); expect(closed).toBe(false);
    release(); await expect(pending).resolves.toMatchObject({ status: 'ABSENT' });
    await Promise.all([first, second]); services.splice(services.indexOf(value.service), 1);
    await expect(fs.lstat(value.options.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(recoverySocketPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(value.service.close()).resolves.toBeUndefined();
  });

  it('retains disconnected request work until its admitted task and journal queue settle', async () => {
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const value = await fixture(async (request) => {
      if (request.operation === 'INSPECT_RESTORE_HOLD') { entered(); await gate; }
    }, undefined, { closeGraceMs: 10_000 });
    const socket = createConnection(value.options.socketPath);
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.end(canonicalJson({ protocol_version: 2, operation: 'INSPECT_RESTORE_HOLD', request_id: randomUUID(),
      helper_version: value.options.helperVersion, policy_sha256: value.options.policySha256, site_id: value.options.siteId,
      repository_id: value.options.repositoryId, deadline: new Date(Date.now() + 5_000).toISOString(), run_id: randomUUID(),
      attempt_id: randomUUID(), capture_id: randomUUID(), capture_generation: 1, manifest_sha256: 'a'.repeat(64),
      operation_id: randomUUID(), owner_token: randomUUID(), fence_token: randomUUID() }));
    await started; socket.destroy();
    const closing = value.service.close(); let closed = false; void closing.then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 20)); expect(closed).toBe(false);
    release(); await closing; services.splice(services.indexOf(value.service), 1);
  });

  it.each(['file', 'symlink'] as const)('never lets Node close unlink a replacement %s at the public socket path', async (kind) => {
    const value = await fixture();
    await fs.unlink(value.options.socketPath);
    if (kind === 'file') await fs.writeFile(value.options.socketPath, 'replacement');
    else await fs.symlink('operator-target', value.options.socketPath);
    await expect(value.service.close()).rejects.toMatchObject({ code: 'BROKER_SOCKET_OWNERSHIP_UNCERTAIN' });
    services.splice(services.indexOf(value.service), 1);
    const replacement = await fs.lstat(value.options.socketPath);
    expect(kind === 'file' ? replacement.isFile() : replacement.isSymbolicLink()).toBe(true);
  });

  it.each(['file', 'symlink'] as const)('fails stopped without letting Node close unlink a replacement %s at the detached bind path', async (kind) => {
    let injected = true;
    const value = await fixture(undefined, undefined, { beforeListenerClose: async ({ bindPath }) => {
      if (!injected) return; injected = false;
      if (kind === 'file') await fs.writeFile(bindPath, 'hidden replacement'); else await fs.symlink('hidden-target', bindPath);
    } });
    await expect(value.service.close()).rejects.toMatchObject({ code: 'BROKER_HIDDEN_PATH_OWNERSHIP_UNCERTAIN' });
    const hidden = join(dirname(value.options.socketPath), '.broker-bind');
    const replacement = await fs.lstat(hidden); expect(kind === 'file' ? replacement.isFile() : replacement.isSymbolicLink()).toBe(true);
    expect((await fs.lstat(value.options.socketPath)).isSocket()).toBe(true);
    await fs.unlink(hidden); await value.service.close(); services.splice(services.indexOf(value.service), 1);
  });

  it('retains hidden and public evidence when startup rollback sees a recreated detached bind path', async () => {
    const value = await fixture(); await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const recoverySocketPath = join(value.root, 'rollback-occupied'); await fs.writeFile(recoverySocketPath, 'occupied');
    let injected = true;
    const service = new BackupBrokerService({ ...value.serviceOptions, recoverySocketPath, beforeListenerClose: async ({ kind, bindPath }) => {
      if (kind === 'main' && injected) { injected = false; await fs.writeFile(bindPath, 'rollback replacement'); }
    } });
    await expect(service.listen()).rejects.toMatchObject({ code: 'BROKER_STARTUP_ROLLBACK_UNCERTAIN' });
    const hidden = join(dirname(value.options.socketPath), '.broker-bind');
    expect(await fs.readFile(hidden, 'utf8')).toBe('rollback replacement');
    expect((await fs.lstat(value.options.socketPath)).isSocket()).toBe(true);
    await fs.unlink(hidden); await fs.unlink(recoverySocketPath); await service.close();
  });

  it('reclaims a crash orphan published at the public path and leaves no private bind orphan', async () => {
    const value = await fixture(); await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const hidden = join(dirname(value.options.socketPath), '.broker-bind'); const orphan = createServer();
    await new Promise<void>((resolve, reject) => { orphan.once('error', reject); orphan.listen(hidden, resolve); });
    await fs.link(hidden, value.options.socketPath); await fs.unlink(hidden);
    await new Promise<void>((resolve, reject) => orphan.close((error) => error ? reject(error) : resolve()));
    expect((await fs.lstat(value.options.socketPath)).isSocket()).toBe(true);
    const restarted = new BackupBrokerService(value.serviceOptions); await restarted.listen(); services.push(restarted);
    await expect(fs.lstat(hidden)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(new BackupBrokerClient(value.options).describe()).resolves.toMatchObject({ operation: 'DESCRIBE' });
  });

  it('rejects public or private Unix socket paths beyond the Linux sockaddr_un bound', async () => {
    const value = await fixture(); await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const longDirectory = join(value.root, 'x'.repeat(100)); await fs.mkdir(longDirectory);
    const service = new BackupBrokerService({ ...value.serviceOptions, socketPath: join(longDirectory, 'broker.sock') });
    await expect(service.listen()).rejects.toThrow(/sockaddr_un bound/);
    await service.close();
  });

  it('rolls back the main listener and authority when the recovery bind cannot be admitted', async () => {
    const value = await fixture(); await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const recoverySocketPath = join(value.root, 'occupied-recovery.sock');
    const occupied = createServer(); await new Promise<void>((resolve, reject) => { occupied.once('error', reject); occupied.listen(recoverySocketPath, resolve); });
    const service = new BackupBrokerService({ ...value.serviceOptions, recoverySocketPath });
    await expect(service.listen()).rejects.toThrow(/active listener/);
    await expect(fs.lstat(value.options.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.lstat(recoverySocketPath)).isSocket()).toBe(true);
    await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
    await expect(service.listen()).resolves.toBeUndefined(); services.push(service);
    expect((await fs.lstat(value.options.socketPath)).isSocket()).toBe(true);
  });

  it('does not process a main-endpoint request until recovery binding makes shared startup ready', async () => {
    const value = await fixture(); await value.service.close(); services.splice(services.indexOf(value.service), 1);
    const recoverySocketPath = join(value.root, 'failed-startup.sock'); let operations = 0; let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const service = new BackupBrokerService({ ...value.serviceOptions, recoverySocketPath,
      beforeRecoveryBind: async () => barrier, beforeOperation: async () => { operations += 1; } });
    const listening = service.listen();
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await fs.lstat(value.options.socketPath).then(() => true, () => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const socket = createConnection(value.options.socketPath);
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.end(canonicalJson({ protocol_version: 2, operation: 'DESCRIBE', request_id: randomUUID(),
      helper_version: value.options.helperVersion, policy_sha256: value.options.policySha256, site_id: value.options.siteId,
      repository_id: value.options.repositoryId, deadline: new Date(Date.now() + 5_000).toISOString() }));
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await fs.writeFile(recoverySocketPath, 'replacement'); release();
    await expect(listening).rejects.toThrow(/non-socket/);
    await closed;
    expect(operations).toBe(0);
    await expect(fs.lstat(value.options.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(recoverySocketPath, 'utf8')).toBe('replacement');
  });
});
