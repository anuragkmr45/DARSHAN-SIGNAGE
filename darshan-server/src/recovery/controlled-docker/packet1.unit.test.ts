import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupManifestV1 } from '../../backups/manifest';
import { canonicalJson } from '../../backups/backup-broker-protocol';
import { CAPSULE_ROLE_ALLOWLIST, EMBEDDED_MANIFEST_SIGNING_KEY, capsuleInventoryBytes, type CapsuleInventoryEntry } from '../../backups/configuration-capsule-inventory';
import { safeExtractArchive, calculateV2StagingInventory, validateConfigurationInventory } from './artifacts';
import { ControlledRecoveryError, digest, sha256, type ExactSourceIdentity, type OperationIdentity } from './contracts';
import { restoreDatabase, FIXED_PSQL_IMPORT_ARGUMENTS, type DatabaseObservation } from './database';
import { REQUIRED_REFERENCE_CLASSES, validateRecoveredData } from './data-validation';
import { buildTargetSpecification, createAndVerifyFreshTargets, verifyOwnedFreshTargets, type ObservedTargetResource } from './docker-targets';
import { ControlledRecoveryJournal } from './journal';
import { restoreObjects } from './objects';
import { assertCapacity, calculateCapacityRequirement, runControlledPreflight } from './preflight';
import { controlledRecoveryProfileSchema, currentControlledRecoveryProfileSchema, type ControlledRecoveryProfile } from './profile';
import { buildControlledRecoveryReport } from './report';
import { acquireAndVerifyRestoreHold, assertExactSourceIdentity } from './source';
import { prepareControlledRecovery, resumeControlledRecovery, type ControlledRecoveryWorkflowAdapter } from './workflow';
import { runControlledDockerRecoveryCli } from '../../../scripts/controlled-docker-recovery';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), 'controlled-recovery-')); roots.push(value); return value; }

function profile(overrides: Partial<Extract<ControlledRecoveryProfile, { release_id: 'release-01' }>> = {}): Extract<ControlledRecoveryProfile, { release_id: 'release-01' }> {
  return { format: 'darshan-controlled-docker-recovery-profile-v1', profile_id: 'darshan-release-01-controlled-recovery',
    site_id: 'site-a', release_id: 'release-01', target_id: 'darshan-server-release-01',
    terminal_migration_id: '0055_backup_deletion_idempotency_bindings.sql',
    repository: { root: '/repo', device_id: '1', repository_id: randomUUID(), owner_uid: 0, owner_gid: 0 },
    journal_root: '/journal', protected_workspace_root: '/workspace', recovery_key_root: '/keys',
    docker: { context: 'darshan-controlled-recovery', compose_file: '/fixed/compose.yml', executable: '/usr/bin/docker',
      private_network_prefix: 'darshan-recovery-net', postgres_volume_prefix: 'darshan-recovery-pg', minio_volume_prefix: 'darshan-recovery-minio',
      mount_destinations: { postgres: '/var/lib/postgresql/data', minio: '/data' } },
    images: { postgres: { reference: `postgres@sha256:${'1'.repeat(64)}` }, minio: { reference: `minio@sha256:${'2'.repeat(64)}` },
      importer: { reference: `importer@sha256:${'3'.repeat(64)}` }, validator: { reference: `validator@sha256:${'4'.repeat(64)}` } },
    tools: { age: { executable: '/usr/bin/age', version: '1', sha256: '5'.repeat(64) }, tar: { executable: '/usr/bin/tar', version: '1', sha256: '6'.repeat(64) },
      psql: { executable: '/usr/bin/psql', version: '1', sha256: '7'.repeat(64) } },
    configuration: { asset_manifest: '/fixed/assets.json', expected_sha256: '8'.repeat(64) },
    limits: { max_artifact_bytes: '1000000', max_entries: 100, max_path_bytes: 200, object_batch_size: 2, phase_timeout_ms: 1000 },
    capacity: { protected_workspace_headroom_bytes: '100', pg_multiplier_numerator: '3', pg_multiplier_denominator: '2',
      wal_headroom_bytes: '20', minio_headroom_bytes: '30', target_disk_headroom_bytes: '40', required_memory_bytes: '50', required_inodes: '10' }, ...overrides };
}

function source(): ExactSourceIdentity { return { siteId: 'site-a', repositoryId: randomUUID(), runId: randomUUID(), manifestSha256: 'a'.repeat(64),
  descriptorSha256: 'b'.repeat(64), keyId: 'age-key-1', releaseId: 'release-01', schemaMigrationId: '0055_backup_deletion_idempotency_bindings' }; }
function identity(): OperationIdentity { return { operationId: randomUUID(), siteId: 'site-a', approvedReleaseId: 'release-01', source: source() }; }

describe('controlled recovery journal and source authority', () => {
  it('persists hash-chained intents/results, distinguishes pending, and excludes another operation at the site', async () => {
    const directory = await root(); const first = identity(); const journal = await ControlledRecoveryJournal.create(directory, first);
    await journal.record({ phase: 'SOURCE_HELD', outcome: 'INTENT', effectTruth: 'PENDING', code: 'INTENT' });
    expect(await journal.read()).toMatchObject({ pendingPhase: 'SOURCE_HELD', ambiguous: true });
    await journal.record({ phase: 'SOURCE_HELD', outcome: 'RESULT', effectTruth: 'CONFIRMED', code: 'HELD', evidence: { status: 'ACTIVE' } });
    const snapshot = await ControlledRecoveryJournal.open(directory, first.operationId).then((value) => value.read());
    expect(snapshot.pendingPhase).toBeNull(); expect(snapshot.events[1].previousSha256).toBe(snapshot.events[0].eventSha256);
    await expect(ControlledRecoveryJournal.create(directory, { ...identity(), siteId: first.siteId })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_SITE_ACTIVE' });
  });

  it('repairs only a provably truncated final frame and rejects complete/interior corruption', async () => {
    const directory = await root(); const operation = identity(); const journal = await ControlledRecoveryJournal.create(directory, operation);
    const path = join(directory, 'operations', operation.operationId, 'journal.ndjson');
    const intact = await readFile(path);
    await appendFile(path, '{"format":"darshan-controlled-recovery-journal-event-v1"');
    await expect(journal.read()).resolves.toMatchObject({ events: [{ phase: 'PLANNED' }] });
    expect(await readFile(path)).toEqual(intact);

    await journal.record({ phase: 'SOURCE_HELD', outcome: 'RESULT', effectTruth: 'CONFIRMED', code: 'HELD' });
    const twoFrames = await readFile(path); const lines = twoFrames.toString('utf8').trimEnd().split('\n');
    const bad = JSON.parse(lines[0]); bad.eventSha256 = 'f'.repeat(64);
    await writeFile(path, `${JSON.stringify(bad)}\n${lines[1]}\n`);
    await expect(journal.read()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_JOURNAL_CORRUPT' });

    await writeFile(path, Buffer.concat([intact, Buffer.from('{"sequence":')]));
    let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
    let acquired!: () => void; const held = new Promise<void>((resolve) => { acquired = resolve; });
    const first = journal.withOperationLock(async () => { acquired(); await wait; });
    await held;
    await expect(journal.read()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_OPERATION_BUSY' });
    release(); await first;
    expect(await readFile(path)).toEqual(intact);
  });

  it('fails closed on a legacy mkdir-before-owner-publication lock claim', async () => {
    const directory = await root(); const operation = identity(); const journal = await ControlledRecoveryJournal.create(directory, operation);
    const lockPath = join(directory, 'locks', `${operation.siteId}.${operation.operationId}.lock`);
    await mkdir(lockPath, { mode: 0o700 });
    await expect(journal.read()).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_OPERATION_BUSY' });
    expect((await stat(lockPath)).isDirectory()).toBe(true);
  });

  it('serializes two stale-lock reclaimers and permits exactly one effect owner', async () => {
    const directory = await root(); const operation = identity();
    await ControlledRecoveryJournal.create(directory, operation);
    const lockPath = join(directory, 'locks', `${operation.siteId}.${operation.operationId}.lock`);
    await writeFile(lockPath, canonicalJson({ format: 'darshan-controlled-recovery-lock-owner-v2', kind: 'OPERATION',
      pid: 2147483647, nonce: randomUUID(), createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });

    let staleObservers = 0; let releaseStaleObservers!: () => void;
    const bothObserved = new Promise<void>((resolve) => { releaseStaleObservers = resolve; });
    let reclaimPublished!: () => void; const published = new Promise<void>((resolve) => { reclaimPublished = resolve; });
    let releaseReclaimer!: () => void; const holdReclaimer = new Promise<void>((resolve) => { releaseReclaimer = resolve; });
    const hooks = { afterStaleOwnerObserved: async () => { staleObservers += 1; if (staleObservers === 2) releaseStaleObservers(); await bothObserved; },
      afterReclaimLockPublished: async () => { reclaimPublished(); await holdReclaimer; } };
    const first = await ControlledRecoveryJournal.open(directory, operation.operationId, hooks);
    const second = await ControlledRecoveryJournal.open(directory, operation.operationId, hooks);
    let effects = 0;
    const contenders = [first, second].map((candidate) => candidate.withOperationLock(async () => { effects += 1; }));
    const settled = Promise.allSettled(contenders);
    await published;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseReclaimer();
    const results = await settled;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'CONTROLLED_RECOVERY_OPERATION_BUSY' });
    expect(effects).toBe(1);
  });

  it('requires an active hold re-observation and exact immutable source identity', async () => {
    const broker = { acquireRestoreHold: vi.fn().mockResolvedValue({ status: 'ACTIVE' }), inspectRestoreHold: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) };
    await expect(acquireAndVerifyRestoreHold({ broker, identity: {} as never })).resolves.toBeUndefined();
    broker.inspectRestoreHold.mockResolvedValue({ status: 'UNCERTAIN' });
    await expect(acquireAndVerifyRestoreHold({ broker, identity: {} as never })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_HOLD_AMBIGUOUS' });
    const expected = source();
    expect(() => assertExactSourceIdentity(expected, { descriptor: { ...expected, descriptorSha256: 'c'.repeat(64), kind: 'LOCAL_FILESYSTEM_V2', fullyEligible: true },
      manifest: { encryption: { keyId: expected.keyId }, release: { id: expected.releaseId }, schema: { migrationId: expected.schemaMigrationId } } } as never)).toThrowError(ControlledRecoveryError);
  });
});

describe('artifact paths and integer capacity', () => {
  it('rejects traversal, links, sparse entries, duplicates and oversize while recreating the V2 digest', async () => {
    const directory = await root();
    for (const entry of [
      { path: '../escape', type: 'file', bytes: Buffer.from('x'), declaredSize: '1' },
      { path: 'link', type: 'symlink', declaredSize: '0' },
      { path: 'sparse', type: 'file', bytes: Buffer.from('x'), declaredSize: '1', sparse: true },
    ] as const) await expect(safeExtractArchive({ entries: [entry], outputRoot: join(directory, randomUUID()), component: 'database', maximumBytes: '10', maximumEntries: 2, maximumPathBytes: 100 })).rejects.toBeInstanceOf(ControlledRecoveryError);
    await expect(safeExtractArchive({ entries: [{ path: 'same', type: 'file', bytes: Buffer.from('x'), declaredSize: '1' }, { path: './same', type: 'file', bytes: Buffer.from('x'), declaredSize: '1' }],
      outputRoot: join(directory, 'duplicate'), component: 'database', maximumBytes: '10', maximumEntries: 2, maximumPathBytes: 100 })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ARCHIVE_DUPLICATE' });
    await expect(safeExtractArchive({ entries: [{ path: 'large', type: 'file', bytes: Buffer.from('too-large'), declaredSize: '9' }],
      outputRoot: join(directory, 'large'), component: 'database', maximumBytes: '8', maximumEntries: 2, maximumPathBytes: 100 })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ARCHIVE_LIMIT' });
    const database = await safeExtractArchive({ entries: [{ path: './dump.sql', type: 'file', bytes: Buffer.from('db'), declaredSize: '2' }],
      outputRoot: join(directory, 'db'), component: 'database', maximumBytes: '10', maximumEntries: 2, maximumPathBytes: 100 });
    const objects = await safeExtractArchive({ entries: [{ path: 'bucket/a', type: 'file', bytes: Buffer.from('obj'), declaredSize: '3' }],
      outputRoot: join(directory, 'obj'), component: 'objects', maximumBytes: '10', maximumEntries: 2, maximumPathBytes: 100 });
    expect(calculateV2StagingInventory(database, objects)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('accepts producer root and trailing-slash directory records but not malicious file/directory variants', async () => {
    const directory = await root();
    const extracted = await safeExtractArchive({ entries: [
      { path: './', type: 'directory', declaredSize: '0' },
      { path: './database/', type: 'directory', declaredSize: '0' },
      { path: './database/dump.sql', type: 'file', bytes: Buffer.from('db'), declaredSize: '2' },
    ], outputRoot: join(directory, 'producer'), component: 'database', maximumBytes: '10', maximumEntries: 3, maximumPathBytes: 100 });
    expect(extracted.map((entry) => entry.path)).toEqual(['database/dump.sql']);
    for (const entry of [
      { path: '../escape/', type: 'directory', declaredSize: '0' },
      { path: './bad//', type: 'directory', declaredSize: '0' },
      { path: './file/', type: 'file', bytes: Buffer.from('x'), declaredSize: '1' },
    ] as const) await expect(safeExtractArchive({ entries: [entry], outputRoot: join(directory, randomUUID()), component: 'database', maximumBytes: '10', maximumEntries: 2, maximumPathBytes: 100 }))
      .rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_ARCHIVE_UNSAFE_PATH' });
  });

  it('accounts for workspace, plaintext, PG/WAL, objects, originals, images, inodes and memory with BigInt only', () => {
    const manifest = { artifacts: [{ ciphertextSizeBytes: '9007199254740993000' }, { ciphertextSizeBytes: '2' }] } as BackupManifestV1;
    const observation = { protectedWorkspaceFreeBytes: '18014398509481990000', targetDiskFreeBytes: '18014398509481990000', freeInodes: '100', availableMemoryBytes: '50', fixedImageBytes: '70', preservedOriginalBytes: '80' };
    const requirement = calculateCapacityRequirement({ profile: profile(), manifest, plaintextDatabaseBytes: '10', plaintextObjectBytes: '20', plaintextConfigurationBytes: '30', expectedObjectCount: '2', observation });
    expect(requirement.ciphertextBytes).toBe('9007199254740993002'); expect(requirement.postgresBytes).toBe('35'); expect(() => assertCapacity(requirement, observation)).not.toThrow();
    expect(() => assertCapacity(requirement, { ...observation, availableMemoryBytes: '49' })).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_CAPACITY_INSUFFICIENT' }));
  });

  it('fails wrong key, site/mount, or release eligibility before target effects', async () => {
    const installed = profile();
    const manifest = { encryption: { keyId: 'age-key-1' }, artifacts: [{ ciphertextSizeBytes: '1' }] } as BackupManifestV1;
    const observation = { protectedWorkspaceFreeBytes: '1000', targetDiskFreeBytes: '1000', freeInodes: '1000', availableMemoryBytes: '1000', fixedImageBytes: '1', preservedOriginalBytes: '1' };
    const base = { verifyRepositoryMount: async () => ({ siteId: installed.site_id, repositoryId: installed.repository.repository_id, mountIdentity: 'device:inode' }),
      proveRecoveryKeyRecipient: async () => ({ keyId: 'age-key-1' }), inspectFixedAssets: async () => ({ profileAssetsSha256: 'a'.repeat(64), toolsSha256: 'b'.repeat(64), imagesSha256: 'c'.repeat(64), configurationSha256: 'd'.repeat(64) }), inspectCapacity: async () => observation };
    const input = { profile: installed, manifest, compatibility: { fullyEligible: true, targetReleaseId: 'release-01' } as never, keyFile: '/keys/recovery.age',
      expectedProfileAssetsSha256: 'a'.repeat(64), expectedToolsSha256: 'b'.repeat(64), expectedImagesSha256: 'c'.repeat(64), expectedConfigurationSha256: 'd'.repeat(64),
      plaintextDatabaseBytes: '1', plaintextObjectBytes: '1', plaintextConfigurationBytes: '1', expectedObjectCount: '1' };
    await expect(runControlledPreflight({ ...input, adapter: { ...base, proveRecoveryKeyRecipient: async () => ({ keyId: 'wrong' }) } })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_KEY_MISMATCH' });
    await expect(runControlledPreflight({ ...input, adapter: { ...base, verifyRepositoryMount: async () => ({ siteId: 'site-b', repositoryId: installed.repository.repository_id, mountIdentity: 'device:inode' }) } })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_REPOSITORY_MISMATCH' });
    await expect(runControlledPreflight({ ...input, compatibility: { fullyEligible: false, targetReleaseId: 'release-01' } as never, adapter: base })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_RELEASE_INCOMPATIBLE' });
  });

  it('validates the configuration capsule against its separate exact signed inventory', () => {
    const entries: CapsuleInventoryEntry[] = Object.entries(CAPSULE_ROLE_ALLOWLIST).flatMap(([role, specifications]) => specifications.map((specification) => {
      const [path, sourceMode, restoreMode, maximumBytes] = specification;
      const bytes = Buffer.from(`fixture:${role}/${path}`);
      return { role: role as CapsuleInventoryEntry['role'], path, type: 'file' as const, source_mode: sourceMode,
        restore_owner: { uid: 0, gid: 0 }, restore_mode: restoreMode, max_bytes: String(maximumBytes), sha256: sha256(bytes) };
    }));
    const embeddedBytes = Buffer.from(`fixture:${EMBEDDED_MANIFEST_SIGNING_KEY.role}/${EMBEDDED_MANIFEST_SIGNING_KEY.path}`);
    entries.push({ role: EMBEDDED_MANIFEST_SIGNING_KEY.role, path: EMBEDDED_MANIFEST_SIGNING_KEY.path, type: 'file',
      source_mode: EMBEDDED_MANIFEST_SIGNING_KEY.sourceMode, restore_owner: { uid: 0, gid: 0 },
      restore_mode: EMBEDDED_MANIFEST_SIGNING_KEY.restoreMode, max_bytes: String(EMBEDDED_MANIFEST_SIGNING_KEY.maximumBytes), sha256: sha256(embeddedBytes) });
    entries.sort((left, right) => Buffer.compare(Buffer.from(`${left.role}/${left.path}`), Buffer.from(`${right.role}/${right.path}`)));
    const inventory = capsuleInventoryBytes(entries);
    const files = [{ path: 'capsule-inventory.json', size: String(inventory.byteLength), sha256: sha256(inventory), bytes: inventory },
      ...entries.map((entry) => { const bytes = entry.path === EMBEDDED_MANIFEST_SIGNING_KEY.path && entry.role === EMBEDDED_MANIFEST_SIGNING_KEY.role
        ? embeddedBytes : Buffer.from(`fixture:${entry.role}/${entry.path}`); return { path: `${entry.role}/${entry.path}`, size: String(bytes.byteLength), sha256: sha256(bytes), bytes }; })];
    expect(validateConfigurationInventory({ files, encryptedInventorySha256: sha256(inventory) })).toMatchObject({ count: files.length });
    expect(() => validateConfigurationInventory({ files: [...files, { path: 'unexpected', size: '1', sha256: sha256(Buffer.from('x')), bytes: Buffer.from('x') }],
      encryptedInventorySha256: sha256(inventory) })).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_CONFIGURATION_INVENTORY' }));
  });

  it('keeps the deployment example aligned with the fixed strict runtime schema', async () => {
    const bytes = await readFile(new URL('../../../../deploy/production/controlled-recovery/profile.example.json', import.meta.url), 'utf8');
    expect(() => controlledRecoveryProfileSchema.parse(JSON.parse(bytes))).not.toThrow();
    expect(() => controlledRecoveryProfileSchema.parse({ ...JSON.parse(bytes), docker_endpoint: 'tcp://attacker' })).toThrow();
  });

  it('keeps the separately approved release-03 deployment example aligned without widening release-01', async () => {
    const bytes = await readFile(new URL('../../../../deploy/production/controlled-recovery/profile.release-03.example.json', import.meta.url), 'utf8');
    expect(() => currentControlledRecoveryProfileSchema.parse(JSON.parse(bytes))).not.toThrow();
    expect(() => controlledRecoveryProfileSchema.parse(JSON.parse(bytes))).toThrow();
  });

  it('keeps Packet 1 isolated from native selection, shell execution, promotion, rollback, and hold release', async () => {
    const sourceRoot = new URL('./', import.meta.url);
    const files = ['artifacts.ts', 'contracts.ts', 'database.ts', 'data-validation.ts', 'docker-targets.ts', 'index.ts', 'journal.ts', 'objects.ts', 'preflight.ts', 'profile.ts', 'report.ts', 'source.ts', 'workflow.ts'];
    const combined = (await Promise.all(files.map((file) => readFile(new URL(file, sourceRoot), 'utf8')))).join('\n');
    expect(combined).not.toMatch(/node:child_process|target-native|releaseRestoreHold|dockerode/);
    const cli = await readFile(new URL('../../../scripts/controlled-docker-recovery.ts', import.meta.url), 'utf8');
    // Packet 2 adds explicit promotion/rollback dispatch to this shared CLI,
    // but the entrypoint still cannot execute shell/native/destructive actions.
    expect(cli).not.toMatch(/node:child_process|down\s+-v|\bprune\b|target-native/);
    const nativeWorker = await readFile(new URL('../../../scripts/recovery-target-helper-worker.ts', import.meta.url), 'utf8');
    expect(nativeWorker).toContain('engine: new UnavailableRecoveryTargetEngine()');
  });
});

function resources(spec: ReturnType<typeof buildTargetSpecification>): ObservedTargetResource[] {
  const common = { labels: spec.labels };
  return [
    { kind: 'network', name: spec.names.network, id: 'n1', consumers: [spec.names.postgresContainer, spec.names.minioContainer], ...common },
    { kind: 'volume', name: spec.names.postgresVolume, id: 'v1', consumers: [spec.names.postgresContainer], ...common },
    { kind: 'volume', name: spec.names.minioVolume, id: 'v2', consumers: [spec.names.minioContainer], ...common },
    { kind: 'container', name: spec.names.postgresContainer, id: 'c1', image: spec.images.postgres, configurationSha256: spec.containerConfigurationSha256.postgres, consumers: [], networks: [spec.names.network], mounts: [{ volumeName: spec.names.postgresVolume, destination: '/var/lib/postgresql/data', readOnly: false }], ...common },
    { kind: 'container', name: spec.names.minioContainer, id: 'c2', image: spec.images.minio, configurationSha256: spec.containerConfigurationSha256.minio, consumers: [], networks: [spec.names.network], mounts: [{ volumeName: spec.names.minioVolume, destination: '/data', readOnly: false }], ...common },
  ];
}

describe('fresh targets and fixed database import', () => {
  it('reconciles a complete owned crash-after-create set and rejects partial/foreign/misconfigured sets', async () => {
    const spec = buildTargetSpecification(profile(), randomUUID(), 1); const after = resources(spec); let created = false;
    const adapter = { inspect: vi.fn(async () => created ? after : []), createFresh: vi.fn(async () => { created = true; }), resetOwnedDatabaseTarget: vi.fn() };
    await expect(createAndVerifyFreshTargets({ adapter, specification: spec })).resolves.toMatchObject({ targetEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(() => verifyOwnedFreshTargets(spec, after.map((entry, index) => index === 1 ? { ...entry, labels: {} } : entry))).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_TARGET_FOREIGN' }));
    expect(() => verifyOwnedFreshTargets(spec, after.map((entry) => entry.kind === 'container' && entry.name === spec.names.postgresContainer
      ? { ...entry, mounts: [{ volumeName: 'production-data', destination: '/data', readOnly: false }] } : entry))).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_TARGET_CONFIGURATION_CHANGED' }));
    await expect(createAndVerifyFreshTargets({ adapter, specification: spec })).resolves.toMatchObject({ resources: expect.arrayContaining(after) });
    expect(adapter.createFresh).toHaveBeenCalledOnce();
    adapter.inspect.mockResolvedValue(after.slice(0, 1));
    await expect(createAndVerifyFreshTargets({ adapter, specification: spec })).rejects.toMatchObject({ code: expect.stringMatching(/CONTROLLED_RECOVERY_TARGET_(?:SET_INVALID|FOREIGN)/) });
  });

  it('uses -X, ON_ERROR_STOP, one transaction and reobserves ambiguous imports', async () => {
    let state: DatabaseObservation = { targetId: 'target', owned: true, empty: true, importMarker: 'ABSENT' };
    const adapter = { observe: vi.fn(async () => state), resetOwned: vi.fn(async () => { state = { targetId: 'target', owned: true, empty: true, importMarker: 'ABSENT' }; }),
      importDump: vi.fn(async ({ arguments: args }) => { expect(args).toEqual(FIXED_PSQL_IMPORT_ARGUMENTS); state = { targetId: 'target', owned: true, empty: false, importMarker: 'COMPLETED', schemaMigrationId: '0055', tableCounts: { users: '2' } }; }) };
    await expect(restoreDatabase({ adapter, dumpFile: '/workspace/dump.sql', expectedTargetId: 'target', terminalMigrationId: '0055' })).resolves.toMatchObject({ baselineTableCounts: { users: '2' } });
    state = { targetId: 'target', owned: true, empty: false, importMarker: 'STARTED' };
    await restoreDatabase({ adapter, dumpFile: '/workspace/dump.sql', expectedTargetId: 'target', terminalMigrationId: '0055' });
    expect(adapter.resetOwned).toHaveBeenCalled();
  });
});

describe('object restore, data validation, and report redaction', () => {
  it('GET-hashes before skip, repairs corruption, and full-GET validates the exact final set', async () => {
    const values = new Map<string, Uint8Array>([['a', Buffer.from('bad')]]);
    const adapter = { put: vi.fn(async ({ key, bytes }) => { values.set(key, bytes); }), get: vi.fn(async ({ key }) => values.get(key) ?? null), listAll: vi.fn(async () => [...values.keys()]) };
    const expected = [{ key: 'a', bytes: Buffer.from('one'), size: '3', sha256: sha256(Buffer.from('one')) }, { key: 'b', bytes: Buffer.from('two'), size: '3', sha256: sha256(Buffer.from('two')) }];
    await expect(restoreObjects({ adapter, expected, batchSize: 1 })).resolves.toMatchObject({ count: '2', bytes: '6' });
    expect(adapter.put).toHaveBeenCalledTimes(2); expect(adapter.get.mock.calls.length).toBeGreaterThanOrEqual(6);
    values.set('extra', Buffer.from('x')); await expect(restoreObjects({ adapter, expected, batchSize: 2 })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_OBJECT_SET_MISMATCH' });
  });

  it('resumes an interrupted bounded object batch by GET-hashing already written bytes', async () => {
    const values = new Map<string, Uint8Array>(); let fail = true;
    const adapter = { put: vi.fn(async ({ key, bytes }) => { if (key === 'b' && fail) { fail = false; throw new Error('interrupted'); } values.set(key, bytes); }),
      get: vi.fn(async ({ key }) => values.get(key) ?? null), listAll: vi.fn(async () => [...values.keys()]) };
    const expected = ['a', 'b'].map((key) => ({ key, bytes: Buffer.from(key), size: '1', sha256: sha256(Buffer.from(key)) }));
    await expect(restoreObjects({ adapter, expected, batchSize: 1 })).rejects.toThrow('interrupted');
    await expect(restoreObjects({ adapter, expected, batchSize: 1 })).resolves.toMatchObject({ count: '2' });
    expect(adapter.put.mock.calls.filter(([value]) => value.key === 'a')).toHaveLength(1);
  });

  it('validates all reference classes, missing object refs, explicit exclusions and allowed count deltas', async () => {
    const checks = Object.fromEntries(REQUIRED_REFERENCE_CLASSES.map((kind) => [kind, true])) as Record<typeof REQUIRED_REFERENCE_CLASSES[number], boolean>;
    const observation = { objectKeys: ['media/a'], references: REQUIRED_REFERENCE_CLASSES.map((kind) => ({ class: kind, objectKey: kind === 'storage_objects' ? 'media/a' : null, recordIdSha256: 'a'.repeat(64) })),
      integrityChecks: checks, postValidationTableCounts: { users: '3' }, reconciliationDeltas: { users: '1' }, excludedObjects: [],
      excludedSummary: { STAGING: '0', RECURSIVE_ARCHIVE: '0', TRANSIENT: '0' } };
    await expect(validateRecoveredData({ adapter: { observe: async () => observation }, baselineTableCounts: { users: '2' }, allowedReconciliationDeltas: { users: '1' } })).resolves.toMatchObject({ excludedCount: '0' });
    const broken = { ...observation, references: [{ class: 'media' as const, objectKey: 'missing', recordIdSha256: 'a'.repeat(64) }] };
    await expect(validateRecoveredData({ adapter: { observe: async () => broken }, baselineTableCounts: { users: '2' }, allowedReconciliationDeltas: { users: '1' } })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_VALIDATION_MISSING_REFERENCE' });
  });

  it('emits report v3 only at DATA_VALIDATED and rejects secret-shaped aggregates', async () => {
    const directory = await root(); const journal = await ControlledRecoveryJournal.create(directory, identity());
    await journal.record({ phase: 'DATA_VALIDATED', outcome: 'RESULT', effectTruth: 'CONFIRMED', code: 'CONTROLLED_RECOVERY_DATA_VALIDATED_CONFIRMED', evidence: { count: '1' } });
    const snapshot = await journal.read();
    expect(buildControlledRecoveryReport({ snapshot, aggregates: { objects: '1' }, timingsMs: { total: '2' } })).toMatchObject({ format: 'darshan-controlled-recovery-report-v3' });
    expect(() => buildControlledRecoveryReport({ snapshot, aggregates: { secret_token: '1' }, timingsMs: {} })).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_REPORT_UNSAFE' }));
  });
});

function scriptedWorkflow(exact: ExactSourceIdentity, completed = new Set<string>()): ControlledRecoveryWorkflowAdapter {
  const complete = (phase: string) => async () => { completed.add(phase); return { evidence: { phase } }; };
  return { selectSource: async () => exact, assessCompatibility: async ({ profile }) => ({ classification: exact.releaseId === profile.release_id ? 'COMPATIBLE_CURRENT' : 'COMPATIBLE_FORWARD',
    targetReleaseId: profile.release_id, targetSchemaMigrationId: profile.terminal_migration_id, sourceLedgerLength: 55,
    pendingMigrationIds: exact.releaseId === profile.release_id ? [] : ['0056_recovery_runtime_authority.sql', '0057_controlled_recovery_report_projection.sql'], fullyEligible: true }), reobserveSource: async ({ expected }) => {
    if (digest(expected) !== digest(exact)) throw new ControlledRecoveryError('CONTROLLED_RECOVERY_SOURCE_CHANGED', 'changed');
  }, observePhase: async ({ phase }) => ({ confirmed: completed.has(phase), evidence: { phase } }),
  sourceHeld: complete('SOURCE_HELD'), preflightPassed: complete('PREFLIGHT_PASSED'),
  decryptedVerified: complete('DECRYPTED_VERIFIED'), targetsCreated: complete('TARGETS_CREATED'),
  databaseRestored: complete('DATABASE_RESTORED'), objectsRestored: complete('OBJECTS_RESTORED'), dataValidated: complete('DATA_VALIDATED') };
}

describe('workflow crash convergence and narrow CLI', () => {
  it('admits current and explicitly compatible enrolled older sources, and rejects unsupported sources', async () => {
    const current = (journalRoot: string) => currentControlledRecoveryProfileSchema.parse({ ...profile({ journal_root: journalRoot }),
      profile_id: 'darshan-release-03-controlled-recovery', release_id: 'release-03', target_id: 'darshan-server-release-03-controlled',
      terminal_migration_id: '0057_controlled_recovery_report_projection.sql' });
    const attempt = async (exact: ExactSourceIdentity, eligible: boolean) => {
      const directory = await root(); const installed = current(directory); const adapter = scriptedWorkflow(exact);
      adapter.assessCompatibility = async () => ({ classification: exact.releaseId === 'release-03' ? 'COMPATIBLE_CURRENT' : 'COMPATIBLE_FORWARD',
        targetReleaseId: 'release-03', targetSchemaMigrationId: '0057_controlled_recovery_report_projection.sql', sourceLedgerLength: 55,
        pendingMigrationIds: exact.releaseId === 'release-03' ? [] : ['0056_recovery_runtime_authority.sql', '0057_controlled_recovery_report_projection.sql'], fullyEligible: eligible });
      const request = { operationId: randomUUID(), backupRunId: exact.runId, manifestSha256: exact.manifestSha256, siteId: 'site-a',
        approvedReleaseId: 'release-03' as const, recoveryKeyFile: '/keys/recovery.age' };
      return prepareControlledRecovery({ request, profile: installed, adapter });
    };
    const currentSource = { ...source(), releaseId: 'release-03', schemaMigrationId: '0057_controlled_recovery_report_projection' };
    await expect(attempt(currentSource, true)).resolves.toBeInstanceOf(ControlledRecoveryJournal);
    await expect(attempt(source(), true)).resolves.toBeInstanceOf(ControlledRecoveryJournal);
    await expect(attempt({ ...source(), releaseId: 'unsupported' }, false)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_RELEASE_INCOMPATIBLE' });
  });

  it('holds one execution lock so parallel resumes dispatch a destructive phase once and return BUSY', async () => {
    const directory = await root(); const exact = source(); const operationId = randomUUID();
    const installed = profile({ journal_root: directory });
    await ControlledRecoveryJournal.create(directory, { operationId, siteId: 'site-a', approvedReleaseId: 'release-01', source: exact });
    let entered!: () => void; let finish!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const finishPromise = new Promise<void>((resolve) => { finish = resolve; });
    const completed = new Set<string>(); const adapter = scriptedWorkflow(exact, completed); let dispatches = 0;
    adapter.sourceHeld = async () => { dispatches += 1; entered(); await finishPromise; completed.add('SOURCE_HELD'); return { evidence: {} }; };
    const request = { operationId, backupRunId: exact.runId, manifestSha256: exact.manifestSha256, siteId: 'site-a', approvedReleaseId: 'release-01' as const, recoveryKeyFile: '/keys/recovery.age' };
    const first = resumeControlledRecovery({ request, profile: installed, adapter }); await enteredPromise;
    await expect(resumeControlledRecovery({ request, profile: installed, adapter })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_OPERATION_BUSY' });
    finish(); await first; expect(dispatches).toBe(1);
  });
  it.each([
    'SOURCE_HELD', 'PREFLIGHT_PASSED', 'DECRYPTED_VERIFIED', 'TARGETS_CREATED',
    'DATABASE_RESTORED', 'OBJECTS_RESTORED', 'DATA_VALIDATED',
  ].flatMap((phase) => ['BEFORE_INTENT', 'AFTER_INTENT', 'BEFORE_RESULT', 'AFTER_RESULT'].map((point) => [phase, point] as const)))(
    'resumes safely across %s %s process-death boundary', async (failedPhase, failedPoint) => {
      const directory = await root(); const exact = source(); const completed = new Set<string>(); const operationId = randomUUID();
      const installed = profile({ journal_root: directory }); const adapter = scriptedWorkflow(exact, completed);
      const request = { operationId, backupRunId: exact.runId, manifestSha256: exact.manifestSha256, siteId: 'site-a',
        approvedReleaseId: 'release-01' as const, recoveryKeyFile: '/keys/recovery.age' };
      let injected = false;
      await expect(prepareControlledRecovery({ request, profile: installed, adapter, fault: async (point, phase) => {
        if (!injected && point === failedPoint && phase === failedPhase) { injected = true; throw new Error('simulated process death'); }
      } })).rejects.toThrow('simulated process death');
      expect(injected).toBe(true);
      await resumeControlledRecovery({ request, profile: installed, adapter });
      const snapshot = await ControlledRecoveryJournal.open(directory, operationId).then((value) => value.read());
      expect(snapshot.state).toBe('DATA_VALIDATED'); expect(snapshot.pendingPhase).toBeNull();
    },
  );

  it('reobserves a crash after effect and converges through DATA_VALIDATED without repeating it', async () => {
    const directory = await root(); const exact = source(); const operationId = randomUUID(); const completed = new Set<string>();
    const installed = profile({ journal_root: directory }); const base = scriptedWorkflow(exact, completed);
    const crash = { ...base, sourceHeld: async () => { completed.add('SOURCE_HELD'); throw new Error('process died after effect'); } };
    const request = { operationId, backupRunId: exact.runId, manifestSha256: exact.manifestSha256, siteId: 'site-a' as const,
      approvedReleaseId: 'release-01' as const, recoveryKeyFile: '/keys/recovery.age' };
    await expect(prepareControlledRecovery({ request, profile: installed, adapter: crash })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS' });
    expect((await ControlledRecoveryJournal.open(directory, operationId).then((value) => value.read())).state).toBe('OPERATOR_REVIEW');
    await resumeControlledRecovery({ request, profile: installed, adapter: base });
    const snapshot = await ControlledRecoveryJournal.open(directory, operationId).then((value) => value.read());
    expect(snapshot.state).toBe('DATA_VALIDATED');
    expect(snapshot.events.some((event) => event.phase === 'SOURCE_HELD' && event.outcome === 'OBSERVATION')).toBe(true);
  });

  it('accepts only prepare/resume/status/report fixed inputs and redacts CLI errors', async () => {
    const directory = await root(); const exact = source(); const operationId = randomUUID(); const installed = profile({ journal_root: directory });
    const output: string[] = []; const error: string[] = [];
    const dependencies = { loadProfile: async () => installed, adapter: scriptedWorkflow(exact),
      readReportAggregates: async () => ({ aggregates: { objects: '1' }, timingsMs: { total: '1' } }) };
    const args = ['prepare', '--operation-id', operationId, '--backup-run-id', exact.runId, '--manifest-sha256', exact.manifestSha256,
      '--site-id', 'site-a', '--approved-release-id', 'release-01', '--recovery-key-file', '/keys/recovery.age'];
    expect(await runControlledDockerRecoveryCli(args, dependencies, { stdout: (value) => output.push(value), stderr: (value) => error.push(value) })).toBe(0);
    expect(output.join('')).toContain('DATA_VALIDATED');
    expect(await runControlledDockerRecoveryCli(['prepare', ...args.slice(1), '--docker-context', 'evil'], dependencies,
      { stdout: vi.fn(), stderr: (value) => error.push(value) })).toBe(3);
    expect(error.at(-1)).toContain('CONTROLLED_RECOVERY_INPUT_INVALID'); expect(error.at(-1)).not.toContain('/keys/recovery.age');
  });
});

