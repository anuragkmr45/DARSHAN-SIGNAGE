import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runLocalEncryptedBackup } from './local-backup-orchestrator.js';
import { REPOSITORY_IDENTITY_FORMAT, openLocalRepository } from './local-repository.js';
import { LOCAL_BACKUP_COMPONENTS } from './packaging.js';

async function expectProtectedTree(path: string): Promise<void> {
  const details = await stat(path);
  expect(details.mode & 0o777).toBe(details.isDirectory() ? 0o700 : 0o600);
  if (details.isDirectory()) {
    for (const name of await readdir(path)) await expectProtectedTree(join(path, name));
  }
}

describe('local encrypted backup orchestration', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('seals all three inventories, removes plaintext, signs, publishes, and conditionally completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-local-orchestrator-'));
    roots.push(root);
    await chmod(root, 0o700);
    const repositoryId = randomUUID();
    await writeFile(join(root, 'repository.json'), `${JSON.stringify({
      format: REPOSITORY_IDENTITY_FORMAT,
      site_id: 'site-a',
      repository_id: repositoryId,
    })}\n`, { mode: 0o600 });
    const rootStat = await stat(root, { bigint: true });
    const repository = await openLocalRepository({
      root,
      expectedDeviceId: rootStat.dev.toString(),
      ownerUid: Number(rootStat.uid),
      ownerGid: Number(rootStat.gid),
      minimumFreeBytes: 1,
      expectedSiteId: 'site-a',
      expectedRepositoryId: repositoryId,
    });
    const runId = randomUUID();
    const attemptId = randomUUID();
    const captureId = randomUUID();
    const signatureKey = Buffer.from('test-only-signing-key');
    let sealedDigest = '';
    let completed = false;
    let publishedRunPath = '';

    const result = await runLocalEncryptedBackup({
      repository,
      runId,
      attemptId,
      siteId: 'site-a',
      releaseId: 'release-test',
      schema: { migrationId: '0051_local_backup_publication.sql', fingerprintSha256: 'a'.repeat(64) },
      encryption: {
        recipient: 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqp5h4hy',
        keyId: 'recovery-key-1',
        executablePath: '/test/age',
        executableSha256: 'b'.repeat(64),
        version: 'age 1.2.1',
      },
      tarExecutablePath: '/test/tar',
      signal: new AbortController().signal,
    }, {
      signer: {
        algorithm: 'test-sha256', keyId: 'manifest-test-key',
        sign: async (payload) => createHash('sha256').update(signatureKey).update(payload).digest(),
      },
      verifier: {
        verify: async ({ payload, signature }) => createHash('sha256').update(signatureKey).update(payload).digest().equals(Buffer.from(signature)),
      },
      coordinator: {
        beginCapture: async () => ({
          siteKey: 'site-a', captureId, generation: 7, backupRunId: runId, backupAttemptId: attemptId, owner: randomUUID(),
        }),
        enterCopying: async () => ({}),
        seal: async (_identity, digest) => { sealedDigest = digest; return {}; },
        abort: async () => ({}),
      },
      captureDatabase: async (destination) => { await writeFile(join(destination, 'database.sql'), 'database', { mode: 0o644 }); },
      captureObjects: async (destination) => {
        await mkdir(join(destination, 'bucket'), { mode: 0o755 });
        await writeFile(join(destination, 'bucket', 'objects.bin'), 'objects', { mode: 0o644 });
      },
      captureConfiguration: async ({ destinationRoot }) => {
        const bytes = Buffer.from('configuration');
        await writeFile(join(destinationRoot, 'runtime.env'), bytes, { mode: 0o644 });
        return {
          version: 1,
          helper_version: 'helper-test',
          site_id: 'site-a',
          run_id: runId,
          attempt_id: attemptId,
          capsule_generation: 'generation-1',
          created_at: new Date('2026-10-28T00:00:00.000Z').toISOString(),
          entries: [{
            logical_name: 'runtime', relative_path: 'runtime.env', size_bytes: String(bytes.length),
            sha256: createHash('sha256').update(bytes).digest('hex'),
          }],
        };
      },
      readSealedCapture: async () => ({
        id: captureId,
        generation: 7,
        startedAt: new Date('2026-10-28T00:00:00.000Z'),
        sealedAt: new Date('2026-10-28T00:01:00.000Z'),
        stagingInventorySha256: sealedDigest,
      }),
      packageComponents: async ({ rawRoot, packageRoot }) => {
        await mkdir(packageRoot, { mode: 0o700 });
        return Promise.all(LOCAL_BACKUP_COMPONENTS.map(async (component) => {
          expect(await readFile(join(rawRoot, component, 'inventory.json'), 'utf8')).toContain('"version":1');
          await expectProtectedTree(join(rawRoot, component));
          const outputPath = join(packageRoot, `${component}.tar`);
          await writeFile(outputPath, `plain:${component}`, { mode: 0o600 });
          return { component, inputRoot: join(rawRoot, component), outputPath };
        }));
      },
      encrypt: async ({ inputPath, outputPath }) => {
        await writeFile(outputPath, Buffer.concat([Buffer.from('cipher:'), await readFile(inputPath)]), { flag: 'wx', mode: 0o600 });
        return { outputPath, sizeBytes: String((await stat(outputPath)).size) };
      },
      preparePublication: async (input) => ({
        id: randomUUID(), backup_run_id: input.runId, backup_attempt_id: input.attemptId,
        capture_id: input.captureId, repository_id: input.repositoryId, manifest_sha256: input.manifestSha256,
        incomplete_relative_path: input.incompleteRelativePath, published_relative_path: input.publishedRelativePath,
        status: 'PREPARED', prepared_at: new Date(), published_at: null, verified_at: null,
      }),
      recordPublicationOutcome: async (input) => ({
        id: 'publication-id', backup_run_id: runId, backup_attempt_id: attemptId, capture_id: captureId,
        repository_id: repositoryId, manifest_sha256: input.manifestSha256,
        incomplete_relative_path: 'incomplete/attempt', published_relative_path: `runs/${runId}`,
        status: input.outcome, prepared_at: new Date(), published_at: new Date(), verified_at: null,
      }),
      publish: async ({ preparedPath, manifestBytes, recordIntent, recordReceipt }) => {
        await writeFile(join(preparedPath, 'manifest.json'), manifestBytes, { mode: 0o600 });
        await recordIntent?.({} as never);
        const runs = join(root, 'runs');
        await mkdir(runs, { mode: 0o700 });
        publishedRunPath = join(runs, runId);
        await rename(preparedPath, publishedRunPath);
        const receipt = { published_at: new Date().toISOString() } as never;
        await recordReceipt?.(receipt);
        return { runPath: publishedRunPath, intent: {} as never, receipt, artifactBytes: 1n };
      },
      completePublication: async () => { completed = true; return true; },
    });

    expect(completed).toBe(true);
    expect(result.manifest.signature).not.toBeNull();
    expect(result.manifest.artifacts.map((artifact) => artifact.kind)).toEqual(['DATABASE', 'OBJECTS', 'CONFIGURATION']);
    expect(await Promise.all(result.manifest.artifacts.map((artifact) => readFile(join(publishedRunPath, artifact.ciphertextPath))))).toHaveLength(3);
    await expect(stat(join(publishedRunPath, '..', '..', 'raw'))).rejects.toThrow();
    expect((await readFile(join(publishedRunPath, 'manifest.json'), 'utf8'))).not.toContain('database.sql');
  });
});
