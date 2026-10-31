import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REPOSITORY_IDENTITY_FORMAT,
  createOwnedAttemptDirectory,
  openLocalRepository,
  type LocalRepository,
} from './local-repository';
import { discoverRepository } from './repository-discovery';
import { assertPublishedRunDirectory, completePublishedRunReceipt, publishRunDirectory, readAndVerifyPublishedRun, type RepositoryManifestView } from './repository-publication';
import { reconcilePublishedRuns } from './repository-reconciliation';
import { serializeBackupManifest, type BackupManifestV1 } from './manifest';
import { canonicalJson } from './backup-broker-protocol';

interface Fixture {
  root: string;
  repository: LocalRepository;
}

async function repositoryFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'darshan-publication-'));
  await chmod(root, 0o700);
  const repositoryId = randomUUID();
  await writeFile(join(root, 'repository.json'), JSON.stringify({
    format: REPOSITORY_IDENTITY_FORMAT, site_id: 'site-a', repository_id: repositoryId,
  }), { mode: 0o600 });
  await chmod(join(root, 'repository.json'), 0o600);
  const metadata = await stat(root, { bigint: true });
  const repository = await openLocalRepository({
    root, expectedDeviceId: metadata.dev.toString(), ownerUid: Number(metadata.uid), ownerGid: Number(metadata.gid),
    minimumFreeBytes: 1, expectedSiteId: 'site-a', expectedRepositoryId: repositoryId,
  });
  return { root, repository };
}

async function preparedFixture(repository: LocalRepository, runId = randomUUID()) {
  const identity = { runId, attemptId: randomUUID(), captureId: randomUUID(), captureGeneration: 3 };
  const attempt = await createOwnedAttemptDirectory({ repository, ...identity });
  const preparedPath = join(attempt.path, 'prepared');
  await mkdir(join(preparedPath, 'encrypted'), { recursive: true, mode: 0o700 });
  await chmod(preparedPath, 0o700);
  await chmod(join(preparedPath, 'encrypted'), 0o700);
  const payload = Buffer.from('ciphertext bytes\n');
  const artifactPath = join(preparedPath, 'encrypted', 'database.sql.gz.age');
  await writeFile(artifactPath, payload, { mode: 0o600 });
  await chmod(artifactPath, 0o600);
  const secondPayload = Buffer.from('objects ciphertext\n');
  await writeFile(join(preparedPath, 'encrypted', 'objects.tar.age'), secondPayload, { mode: 0o600 });
  const manifest: RepositoryManifestView = {
    repository_id: repository.identity.repository_id,
    site_id: repository.identity.site_id,
    run_id: identity.runId,
    attempt_id: identity.attemptId,
    capture_id: identity.captureId,
    capture_generation: identity.captureGeneration,
    artifacts: [{
      path: 'encrypted/database.sql.gz.age',
      size: payload.length.toString(),
      sha256: createHash('sha256').update(payload).digest('hex'),
    }, { path: 'encrypted/objects.tar.age', size: secondPayload.length.toString(),
      sha256: createHash('sha256').update(secondPayload).digest('hex') }],
  };
  const signedManifest: BackupManifestV1 = {
    version: 1, repository: { kind: 'LOCAL_FILESYSTEM', id: manifest.repository_id }, site: { id: manifest.site_id },
    run: { id: manifest.run_id, attemptId: manifest.attempt_id }, capture: { id: manifest.capture_id,
      generation: manifest.capture_generation.toString(), startedAt: '2026-10-29T00:00:00.000Z',
      sealedAt: '2026-10-29T00:01:00.000Z', stagingInventorySha256: 'a'.repeat(64) },
    release: { id: 'test' }, schema: { migrationId: '0001_test.sql', fingerprintSha256: 'b'.repeat(64) },
    encryption: { keyId: 'test', tool: { name: 'age', version: '1', executableSha256: 'c'.repeat(64) } },
    artifacts: manifest.artifacts.map((artifact) => ({ kind: 'OTHER', name: artifact.path,
      ciphertextPath: artifact.path, ciphertextSizeBytes: artifact.size, ciphertextSha256: artifact.sha256 })),
    signature: { algorithm: 'Ed25519', keyId: 'test', valueBase64: 'AA==' },
  };
  return { attempt, preparedPath, manifest, manifestBytes: serializeBackupManifest(signedManifest) };
}

describe('local repository publication protocol', () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('publishes one whole run, fsyncs the protocol, and verifies bytes by reading them back', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root);
    const prepared = await preparedFixture(fixture.repository);
    const points: string[] = [];
    const intents: string[] = [];
    const receipts: string[] = [];
    const result = await publishRunDirectory({
      repository: fixture.repository,
      attemptPath: prepared.attempt.path,
      preparedPath: prepared.preparedPath,
      manifest: prepared.manifest,
      manifestBytes: prepared.manifestBytes,
      operations: { fault: async (point) => { points.push(point); } },
      recordIntent: async (intent) => { intents.push(intent.manifest_sha256); },
      recordReceipt: async (receipt) => { receipts.push(receipt.manifest_sha256); },
    });
    expect(result.receipt?.manifest_sha256).toBe(result.intent.manifest_sha256);
    expect(result.artifactBytes).toBe(BigInt('ciphertext bytes\n'.length + 'objects ciphertext\n'.length));
    expect(intents).toEqual(receipts);
    expect(points).toContain('before-rename');
    expect(points).toContain('after-readback');
    await expect(readAndVerifyPublishedRun({ repository: fixture.repository, runId: prepared.manifest.run_id }))
      .resolves.toMatchObject({ receipt: { run_id: prepared.manifest.run_id } });
    await expect(publishRunDirectory({
      repository: fixture.repository,
      attemptPath: prepared.attempt.path,
      preparedPath: prepared.preparedPath,
      manifest: prepared.manifest,
      manifestBytes: prepared.manifestBytes,
    })).resolves.toMatchObject({ receipt: { attempt_id: prepared.manifest.attempt_id } });
  });

  it('never overwrites an existing destination and preserves the previous good run', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root);
    const runId = randomUUID();
    const first = await preparedFixture(fixture.repository, runId);
    await publishRunDirectory({ repository: fixture.repository, attemptPath: first.attempt.path, preparedPath: first.preparedPath, manifest: first.manifest, manifestBytes: first.manifestBytes });
    const second = await preparedFixture(fixture.repository, runId);
    await expect(publishRunDirectory({
      repository: fixture.repository, attemptPath: second.attempt.path, preparedPath: second.preparedPath,
      manifest: second.manifest, manifestBytes: second.manifestBytes,
    })).rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_DESTINATION_EXISTS' });
    await expect(readAndVerifyPublishedRun({ repository: fixture.repository, runId }))
      .resolves.toMatchObject({ intent: { attempt_id: first.manifest.attempt_id } });
  });

  it('rejects symlinked artifacts and a cross-device rename seam', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root);
    const unsafe = await preparedFixture(fixture.repository);
    await rm(join(unsafe.preparedPath, 'encrypted', 'database.sql.gz.age'));
    await symlink(join(fixture.root, 'repository.json'), join(unsafe.preparedPath, 'encrypted', 'database.sql.gz.age'));
    await expect(publishRunDirectory({
      repository: fixture.repository, attemptPath: unsafe.attempt.path, preparedPath: unsafe.preparedPath,
      manifest: unsafe.manifest, manifestBytes: unsafe.manifestBytes,
    })).rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_FILE_UNSAFE' });

    const crossDevice = await preparedFixture(fixture.repository);
    await expect(publishRunDirectory({
      repository: fixture.repository, attemptPath: crossDevice.attempt.path, preparedPath: crossDevice.preparedPath,
      manifest: crossDevice.manifest, manifestBytes: crossDevice.manifestBytes,
      operations: { rename: async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); } },
    })).rejects.toMatchObject({ code: 'BACKUP_REPOSITORY_CROSS_DEVICE' });
  });

  it('reconciles a crash immediately after rename from durable filesystem intent', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root);
    const prepared = await preparedFixture(fixture.repository);
    await expect(publishRunDirectory({
      repository: fixture.repository, attemptPath: prepared.attempt.path, preparedPath: prepared.preparedPath,
      manifest: prepared.manifest, manifestBytes: prepared.manifestBytes,
      operations: { fault: async (point) => { if (point === 'after-rename') throw new Error('simulated crash'); } },
    })).rejects.toThrow('simulated crash');
    const before = await discoverRepository(fixture.repository);
    expect(before.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'runs', classification: 'incomplete', name: prepared.manifest.run_id }),
    ]));
    const recorded: string[] = [];
    const reconciled = await reconcilePublishedRuns({
      repository: fixture.repository,
      decide: async (entry) => entry.classification === 'incomplete' ? 'adopt' : 'preserve',
      recordReceipt: async (receipt) => { recorded.push(receipt.run_id); },
    });
    expect(reconciled.adopted).toHaveLength(1);
    expect(recorded).toEqual([prepared.manifest.run_id]);
    await expect(readAndVerifyPublishedRun({ repository: fixture.repository, runId: prepared.manifest.run_id })).resolves.toBeTruthy();
  });

  it('does not create completion evidence when aborted during receipt repair', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root); const prepared = await preparedFixture(fixture.repository);
    await expect(publishRunDirectory({ repository: fixture.repository, attemptPath: prepared.attempt.path, preparedPath: prepared.preparedPath, manifest: prepared.manifest, manifestBytes: prepared.manifestBytes, operations: { fault: async (point) => { if (point === 'after-readback') throw new Error('stop before receipt'); } } })).rejects.toThrow(/stop before receipt/);
    const controller = new AbortController();
    await expect(completePublishedRunReceipt({ repository: fixture.repository, runId: prepared.manifest.run_id, signal: controller.signal, fault: async () => controller.abort(new Error('deadline')) })).rejects.toThrow(/deadline/);
    expect((await readAndVerifyPublishedRun({ repository: fixture.repository, runId: prepared.manifest.run_id, requireReceipt: false })).receipt).toBeNull();
  });

  it('classifies read-back tampering as corrupt without damaging another good run', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root);
    const first = await preparedFixture(fixture.repository);
    const second = await preparedFixture(fixture.repository);
    await publishRunDirectory({ repository: fixture.repository, attemptPath: first.attempt.path, preparedPath: first.preparedPath, manifest: first.manifest, manifestBytes: first.manifestBytes });
    await publishRunDirectory({ repository: fixture.repository, attemptPath: second.attempt.path, preparedPath: second.preparedPath, manifest: second.manifest, manifestBytes: second.manifestBytes });
    await writeFile(join(fixture.root, 'runs', second.manifest.run_id, 'encrypted', 'database.sql.gz.age'), 'altered', { mode: 0o600 });
    const discovery = await discoverRepository(fixture.repository);
    expect(discovery.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'runs', name: first.manifest.run_id, classification: 'complete' }),
      expect.objectContaining({ area: 'runs', name: second.manifest.run_id, classification: 'corrupt' }),
    ]));
  });

  it.each(['empty', 'missing', 'extra', 'reordered', 'duplicate', 'mismatched'] as const)(
    'rejects %s intent artifacts instead of skipping signed ciphertext verification', async (kind) => {
      const fixture = await repositoryFixture(); roots.push(fixture.root); const prepared = await preparedFixture(fixture.repository);
      await publishRunDirectory({ repository: fixture.repository, attemptPath: prepared.attempt.path,
        preparedPath: prepared.preparedPath, manifest: prepared.manifest, manifestBytes: prepared.manifestBytes });
      const intentPath = join(fixture.root, 'runs', prepared.manifest.run_id, 'publication-intent.json');
      const intent = JSON.parse(await readFile(intentPath, 'utf8')) as { artifacts: RepositoryManifestView['artifacts'] } & Record<string, unknown>;
      if (kind === 'empty') intent.artifacts = [];
      if (kind === 'missing') intent.artifacts = intent.artifacts.slice(0, 1);
      if (kind === 'extra') intent.artifacts.push({ path: 'extra.age', size: '1', sha256: 'd'.repeat(64) });
      if (kind === 'reordered') intent.artifacts.reverse();
      if (kind === 'duplicate') intent.artifacts[1] = { ...intent.artifacts[0] };
      if (kind === 'mismatched') intent.artifacts[0] = { ...intent.artifacts[0], sha256: 'e'.repeat(64) };
      await writeFile(intentPath, canonicalJson(intent), { mode: 0o600 });
      await expect(readAndVerifyPublishedRun({ repository: fixture.repository, runId: prepared.manifest.run_id })).rejects.toThrow();
    },
  );

  it.each(['duplicate-intent', 'noncanonical-intent', 'duplicate-receipt', 'noncanonical-receipt'] as const)(
    'rejects %s protocol JSON bytes', async (kind) => {
      const fixture = await repositoryFixture(); roots.push(fixture.root); const prepared = await preparedFixture(fixture.repository);
      await publishRunDirectory({ repository: fixture.repository, attemptPath: prepared.attempt.path,
        preparedPath: prepared.preparedPath, manifest: prepared.manifest, manifestBytes: prepared.manifestBytes });
      const run = join(fixture.root, 'runs', prepared.manifest.run_id);
      const intentPath = join(run, 'publication-intent.json'); const receiptPath = join(run, 'publication-receipt.json');
      const target = kind.includes('intent') ? intentPath : receiptPath;
      const parsed = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;
      const bytes = kind.startsWith('duplicate')
        ? Buffer.from(`{"format":${JSON.stringify(parsed.format)},"format":${JSON.stringify(parsed.format)},${canonicalJson(parsed).toString('utf8').slice(1)}`)
        : Buffer.from(` ${JSON.stringify(parsed)}\n`);
      await writeFile(target, bytes, { mode: 0o600 });
      await expect(readAndVerifyPublishedRun({ repository: fixture.repository, runId: prepared.manifest.run_id })).rejects.toMatchObject({
        code: 'BACKUP_PUBLICATION_PROTOCOL_INVALID',
      });
    },
  );

  it('rejects permissive and wrong-owner published run directories', async () => {
    const fixture = await repositoryFixture(); roots.push(fixture.root); const prepared = await preparedFixture(fixture.repository);
    await publishRunDirectory({ repository: fixture.repository, attemptPath: prepared.attempt.path,
      preparedPath: prepared.preparedPath, manifest: prepared.manifest, manifestBytes: prepared.manifestBytes });
    const run = join(fixture.root, 'runs', prepared.manifest.run_id);
    await chmod(run, 0o777);
    await expect(readAndVerifyPublishedRun({ repository: fixture.repository, runId: prepared.manifest.run_id }))
      .rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_DIRECTORY_UNSAFE' });
    await chmod(run, 0o700);
    await expect(assertPublishedRunDirectory(run, { ...fixture.repository, ownerUid: fixture.repository.ownerUid + 1 }))
      .rejects.toMatchObject({ code: 'BACKUP_PUBLICATION_DIRECTORY_UNSAFE' });
  });
});
