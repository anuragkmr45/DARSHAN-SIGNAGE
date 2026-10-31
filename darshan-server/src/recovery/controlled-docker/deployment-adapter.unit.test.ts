import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from './contracts';
import { RecoveryOperationStore } from './recovery-operation-store';
import { restoreDiskBackedObjects } from './target-object-adapter';
import { TargetDatabaseAdapter } from './target-database-adapter';
import type { RecoveryTargetSpecification } from './docker-targets';
import type { StreamingObjectStoreAdapter } from './streaming-artifacts';
import { createControlledRecoveryWorkflowAdapter, loadAndVerifyDurableDatabaseBaseline } from './deployment-adapter';
import { databaseDump } from './file-artifacts';

const operationId = '11111111-1111-4111-8111-111111111111';
const source = { siteId: 'site-a', repositoryId: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333',
  manifestSha256: 'a'.repeat(64), descriptorSha256: 'b'.repeat(64), keyId: 'age-1', releaseId: 'release-03', schemaMigrationId: '0057_controlled_recovery_report_projection.sql' };

describe('Activation Packet B durable and streaming boundaries', () => {
  it('persists private hold identity and immutable secret-free phase receipts atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-b-store-')); const store = new RecoveryOperationStore(root, process.getuid!(), process.getgid!());
    await store.bindSource(operationId, source); const first = await store.ensureHoldBinding(operationId, 'c'.repeat(64)); const second = await store.ensureHoldBinding(operationId, 'c'.repeat(64));
    expect(second).toEqual(first); expect(first.owner_token).not.toBe(first.fence_token);
    await store.recordReceipt({ format: 'darshan-controlled-recovery-operation-receipt-v1', operation_id: operationId, phase: 'SOURCE_HELD',
      source_identity_sha256: 'c'.repeat(64), evidence_sha256: 'd'.repeat(64), aggregates: { held: '1' }, timings_ms: { source_held: '4' }, completed_at: new Date(0).toISOString() });
    await expect(store.readReceipt(operationId, 'SOURCE_HELD')).resolves.toMatchObject({ evidence_sha256: 'd'.repeat(64) });
    await expect(store.recordReceipt({ format: 'darshan-controlled-recovery-operation-receipt-v1', operation_id: operationId, phase: 'SOURCE_HELD',
      source_identity_sha256: 'c'.repeat(64), evidence_sha256: 'e'.repeat(64), aggregates: {}, timings_ms: {}, completed_at: new Date(0).toISOString() })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_EFFECT_AMBIGUOUS' });
    const bytes = await readFile(join(root, operationId, 'source_held.json'), 'utf8'); expect(bytes).not.toMatch(/owner_token|fence_token|object|password|key_file/i);
  });

  it('publishes one immutable source winner under a concurrent different-source race', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-b-source-')); let linked!: () => void; const linkedGate = new Promise<void>((resolve) => { linked = resolve; });
    let release!: () => void; const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const store = new RecoveryOperationStore(root, process.getuid!(), process.getgid!(), { afterExclusiveLink: async ({ name }) => { if (name === 'source.json') { linked(); await releaseGate; } } });
    const competing = { ...source, runId: '44444444-4444-4444-8444-444444444444', manifestSha256: 'c'.repeat(64) };
    const winnerPublication = store.bindSource(operationId, source); await linkedGate; const loserPublication = store.bindSource(operationId, competing);
    await Promise.resolve(); release(); const results = await Promise.allSettled([winnerPublication, loserPublication]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const winner = await store.readSourceBinding(operationId); expect(winner?.source).toEqual(source);
    await expect(store.bindSource(operationId, source)).resolves.toBeUndefined();
    await expect(store.bindSource(operationId, competing)).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_SOURCE_CHANGED' });
  });

  it('accepts exactly the single real producer database artifact name', () => {
    const artifact = { archivePath: 'darshan_postgres_20261030_235959.sql', path: '/protected/darshan_postgres_20261030_235959.sql', size: '7', sha256: 'f'.repeat(64) };
    expect(databaseDump([artifact])).toEqual(artifact);
    expect(() => databaseDump([{ ...artifact, archivePath: 'database.sql' }])).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_DATABASE_DUMP_INVALID' }));
    expect(() => databaseDump([artifact, { ...artifact, archivePath: 'unexpected.txt' }])).toThrowError(expect.objectContaining({ code: 'CONTROLLED_RECOVERY_DATABASE_DUMP_INVALID' }));
  });

  it('streams disk objects, hashes every resume GET, repairs corruption, and enumerates the exact final set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-b-object-')); const path = join(root, 'body'); const body = Buffer.from('bounded-object-body'); await writeFile(path, body, { mode: 0o600 });
    const values = new Map([['media/body', Buffer.from('corrupt')]]); const puts: string[] = [];
    const adapter: StreamingObjectStoreAdapter = {
      async getStream({ key }) { const value = values.get(key); return value ? { size: value.byteLength.toString(), stream: Readable.from([value]) } : null; },
      async putStream({ key, stream }) { const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk)); values.set(key, Buffer.concat(chunks)); puts.push(key); },
      async listAll() { return [...values.keys()]; },
    };
    const result = await restoreDiskBackedObjects({ adapter, expected: [{ key: 'media/body', artifact: { path, size: body.byteLength.toString(), sha256: sha256(body) } }], batchSize: 1, maximumObjectBytes: '1024' });
    expect(result).toMatchObject({ count: '1', bytes: body.byteLength.toString() }); expect(puts).toEqual(['media/body']); expect(values.get('media/body')).toEqual(body);
  });

  it('GET-streams and hashes every object after enumeration and rejects cross-object final corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-b-corrupt-')); const descriptors = [];
    for (const [key, value] of [['a', 'first'], ['b', 'second']] as const) { const path = join(root, key); await writeFile(path, value, { mode: 0o600 });
      descriptors.push({ key, artifact: { path, size: Buffer.byteLength(value).toString(), sha256: sha256(Buffer.from(value)) } }); }
    const calls = new Map<string, number>();
    const adapter: StreamingObjectStoreAdapter = { async getStream({ key }) { const count = (calls.get(key) ?? 0) + 1; calls.set(key, count);
        const expected = key === 'a' ? Buffer.from('first') : Buffer.from('second'); const bytes = key === 'b' && count === 2 ? Buffer.from('broken') : expected;
        return { size: bytes.byteLength.toString(), stream: Readable.from([bytes]) }; }, async putStream() { throw new Error('unexpected put'); }, async listAll() { return ['a', 'b']; } };
    await expect(restoreDiskBackedObjects({ adapter, expected: descriptors, batchSize: 2, maximumObjectBytes: '1024' })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_OBJECT_FINAL_CORRUPT' });
    expect(calls.get('a')).toBe(2); expect(calls.get('b')).toBe(2);
  });

  it('loads the durable database baseline after restart and rejects row loss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-b-baseline-')); const store = new RecoveryOperationStore(root, process.getuid!(), process.getgid!());
    await store.recordReceipt({ format: 'darshan-controlled-recovery-operation-receipt-v1', operation_id: operationId, phase: 'DATABASE_RESTORED', source_identity_sha256: '1'.repeat(64),
      evidence_sha256: '2'.repeat(64), aggregates: { users: '5', media: '2' }, timings_ms: {}, completed_at: new Date(0).toISOString() });
    const specification = { operationId, generation: 1 } as RecoveryTargetSpecification;
    const database = { observe: vi.fn().mockResolvedValue({ targetId: 'target', owned: true, empty: false, importMarker: 'COMPLETED', tableCounts: { users: '4', media: '2' } }), import: vi.fn(), resetExactOwned: vi.fn() };
    await expect(loadAndVerifyDurableDatabaseBaseline({ operationStore: store, operationId, database, specification })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_DATABASE_BASELINE_CHANGED' });
    database.observe.mockResolvedValue({ targetId: 'target', owned: true, empty: false, importMarker: 'COMPLETED', tableCounts: { users: '5', media: '3' } });
    await expect(loadAndVerifyDurableDatabaseBaseline({ operationStore: store, operationId, database, specification })).resolves.toEqual({ users: '5', media: '2' });
  });

  it('binds database import to the exact dump, target, psql argv, empty environment and private credential mount', async () => {
    const specification = { operationId, generation: 1 } as RecoveryTargetSpecification; const dump = { path: '/fixed/database.sql', size: '1', sha256: 'f'.repeat(64) };
    const executor = { observe: vi.fn(), import: vi.fn().mockResolvedValue(undefined), resetExactOwned: vi.fn() }; const adapter = new TargetDatabaseAdapter(specification, dump, executor);
    await adapter.importDump({ dumpFile: dump.path, arguments: ['-X', '--set=ON_ERROR_STOP=1', '--single-transaction'], ambientOptions: {} });
    expect(executor.import).toHaveBeenCalledWith(expect.objectContaining({ argv: ['-X', '--set=ON_ERROR_STOP=1', '--single-transaction'], environment: {}, credentialMount: 'FIXED_PRIVATE_PGPASS' }));
    await expect(adapter.importDump({ dumpFile: '/other.sql', arguments: [], ambientOptions: {} })).rejects.toMatchObject({ code: 'CONTROLLED_RECOVERY_DATABASE_IMPORT_INVALID' });
  });

  it('confirms a resumed phase only after exact source re-observation and matching external live truth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-packet-b-resume-')); const store = new RecoveryOperationStore(root, process.getuid!(), process.getgid!());
    await store.recordReceipt({ format: 'darshan-controlled-recovery-operation-receipt-v1', operation_id: operationId, phase: 'TARGETS_CREATED',
      source_identity_sha256: '1'.repeat(64), evidence_sha256: '2'.repeat(64), aggregates: {}, timings_ms: {}, completed_at: new Date(0).toISOString() });
    const trusted = { descriptor: { siteId: source.siteId, repositoryId: source.repositoryId, runId: source.runId, manifestSha256: source.manifestSha256, descriptorSha256: source.descriptorSha256 },
      manifest: { encryption: { keyId: source.keyId }, release: { id: source.releaseId }, schema: { migrationId: source.schemaMigrationId } } } as never;
    const phaseTruth = { observe: vi.fn().mockResolvedValue({ evidenceSha256: '2'.repeat(64) }) };
    const adapter = createControlledRecoveryWorkflowAdapter({ source: { select: vi.fn().mockResolvedValue(trusted) }, targetManifest: [], broker: vi.fn() as never,
      preflight: {} as never, artifacts: {} as never, deployment: {} as never, database: {} as never, objects: vi.fn() as never,
      validation: vi.fn() as never, phaseTruth, operationStore: store, allowedReconciliationDeltas: {} });
    const profile = { site_id: source.siteId, release_id: 'release-03', recovery_key_root: '/keys', docker: { private_network_prefix: 'darshan-recovery-net', postgres_volume_prefix: 'darshan-recovery-pg', minio_volume_prefix: 'darshan-recovery-minio',
      compose_file: '/fixed/compose.yml', context: 'darshan-controlled-recovery', mount_destinations: { postgres: '/var/lib/postgresql/data', minio: '/data' } },
      images: { postgres: { reference: `postgres@sha256:${'a'.repeat(64)}` }, minio: { reference: `minio@sha256:${'b'.repeat(64)}` } } } as never;
    await adapter.reobserveSource({ expected: source, profile });
    await expect(adapter.observePhase({ phase: 'TARGETS_CREATED', identity: { operationId, siteId: source.siteId, approvedReleaseId: 'release-03', source }, profile })).resolves.toMatchObject({ confirmed: true });
    phaseTruth.observe.mockResolvedValue({ evidenceSha256: '3'.repeat(64) });
    await expect(adapter.observePhase({ phase: 'TARGETS_CREATED', identity: { operationId, siteId: source.siteId, approvedReleaseId: 'release-03', source }, profile })).resolves.toMatchObject({ confirmed: false });
  });
});
