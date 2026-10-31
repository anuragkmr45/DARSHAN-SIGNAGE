import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { BackupBrokerWorkerAdapter } from './backup-broker-worker-adapter.js';
import { runBrokeredEncryptedBackup } from './brokered-backup-orchestrator.js';
import { serializeBackupManifest } from './manifest.js';

describe('brokered encrypted backup orchestration', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it.each(['success', 'unknown', 'cancelled'] as const)('orders publication and preserves ciphertext for %s COMMIT outcome', async (outcome) => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-brokered-orchestrator-'));
    roots.push(root); await chmod(root, 0o700);
    const rootStat = await stat(root, { bigint: true });
    const runId = randomUUID(), attemptId = randomUUID(), captureId = randomUUID(), repositoryId = randomUUID();
    const events: string[] = []; let sealedDigest = '';
    const publication = (status: 'PREPARED' | 'PUBLISHED' | 'UNCERTAIN') => ({ id: randomUUID(), backup_run_id: runId, backup_attempt_id: attemptId,
      capture_id: captureId, repository_id: repositoryId, manifest_sha256: '1'.repeat(64), incomplete_relative_path: 'broker-spool/test',
      published_relative_path: `runs/${runId}`, status, prepared_at: new Date(), published_at: status === 'PUBLISHED' ? new Date() : null, verified_at: null });
    const controller = new AbortController();
    const broker = {
      capability: { repository_id: repositoryId, policy_sha256: 'c'.repeat(64), capsule_generation: 'capsule-1', encrypted_inventory_sha256: 'd'.repeat(64) },
      selectCapsule: async () => Buffer.from('encrypted-capsule'),
      prepare: async ({ unsignedManifest }: { unsignedManifest: Parameters<typeof serializeBackupManifest>[0] }) => {
        events.push('PREPARE');
        const signedManifest = { ...unsignedManifest, signature: { algorithm: 'Ed25519', keyId: 'key-1', valueBase64: Buffer.alloc(64).toString('base64') } };
        const signedBytes = serializeBackupManifest(signedManifest);
        return { signedManifest, signedBytes, unsignedSha256: '0'.repeat(64), signedSha256: createHash('sha256').update(signedBytes).digest('hex'),
          incompleteRelativePath: `incomplete/${runId}.${attemptId}.${'a'.repeat(32)}`, publishedRelativePath: `runs/${runId}` };
      },
      commit: async ({ signedBytes }: { signedBytes: Uint8Array }) => {
        events.push('COMMIT');
        if (outcome === 'cancelled') controller.abort(new Error('cancelled during COMMIT'));
        if (outcome !== 'success') throw new Error('unknown COMMIT outcome');
        const manifest = JSON.parse(Buffer.from(signedBytes).toString('utf8'));
        return { receipt: { published_at: new Date(Date.now() - 1000).toISOString() }, intent: { artifacts: manifest.artifacts } };
      },
    } as unknown as BackupBrokerWorkerAdapter;

    const running = runBrokeredEncryptedBackup({ runId, attemptId, deadlineAt: new Date(Date.now() + 60_000), siteId: 'site-a', releaseId: 'release-1',
      schema: { migrationId: '0051', fingerprintSha256: 'a'.repeat(64) }, encryption: { recipient: 'age-test', keyId: 'age-key',
        executablePath: '/age', executableSha256: 'b'.repeat(64), version: '1' }, tarExecutablePath: '/tar', signal: controller.signal }, {
      broker, spool: { root, deviceId: rootStat.dev.toString(), ownerUid: Number(rootStat.uid), ownerGid: Number(rootStat.gid) }, pool: {} as never,
      coordinator: { beginCapture: async () => ({ siteKey: 'site-a', captureId, generation: 3, backupRunId: runId, backupAttemptId: attemptId, owner: randomUUID() }),
        enterCopying: async () => ({}), seal: async (_identity, digest) => { sealedDigest = digest; events.push('BARRIER_RELEASED'); return {}; }, abort: async () => ({}) },
      captureDatabase: async (destination) => writeFile(join(destination, 'database.sql'), 'db', { mode: 0o600 }),
      captureObjects: async (destination) => { await mkdir(join(destination, 'bucket'), { mode: 0o700 }); await writeFile(join(destination, 'bucket', 'object'), 'object', { mode: 0o600 }); },
      readSealedCapture: async () => ({ id: captureId, generation: 3, startedAt: new Date(), sealedAt: new Date(), stagingInventorySha256: sealedDigest }),
      packageComponents: async ({ rawRoot, packageRoot, components }) => { events.push('PACKAGE'); await mkdir(packageRoot, { mode: 0o700 });
        return Promise.all(components!.map(async (component) => { const outputPath = join(packageRoot, `${component}.tar`); await writeFile(outputPath, await readFile(join(rawRoot, component, component === 'database' ? 'database.sql' : 'bucket/object')), { mode: 0o600 }); return { component, inputRoot: join(rawRoot, component), outputPath }; })); },
      encrypt: async ({ inputPath, outputPath }) => { await writeFile(outputPath, await readFile(inputPath), { flag: 'wx', mode: 0o600 }); return { outputPath, sizeBytes: '1' }; },
      preparePublication: async (input) => { events.push('DB_INTENT');
        expect(input.incompleteRelativePath).toBe(`incomplete/${runId}.${attemptId}.${'a'.repeat(32)}`);
        expect(input.publishedRelativePath).toBe(`runs/${runId}`);
        return publication('PREPARED'); },
      confirmPublication: async () => { events.push('DB_CONFIRM'); return publication('PUBLISHED'); },
      completePublication: async () => { events.push('DB_COMPLETE'); return true; },
      recordPublicationOutcome: async (input) => { events.push('DB_UNCERTAIN'); expect(input.outcome).toBe('UNCERTAIN'); return publication('UNCERTAIN'); },
      durablySealSpool: async () => { events.push('FSYNC'); },
    });

    const attemptRoot = join(root, runId, attemptId, captureId, '3');
    if (outcome === 'success') {
      await running;
      expect(events).toEqual(['BARRIER_RELEASED', 'PACKAGE', 'FSYNC', 'PREPARE', 'DB_INTENT', 'COMMIT', 'DB_CONFIRM', 'DB_COMPLETE']);
      await expect(stat(attemptRoot)).rejects.toThrow();
    } else {
      await expect(running).rejects.toThrow(outcome === 'cancelled' ? /cancelled|unknown COMMIT/ : /unknown COMMIT/);
      expect(events).toEqual(['BARRIER_RELEASED', 'PACKAGE', 'FSYNC', 'PREPARE', 'DB_INTENT', 'COMMIT', 'DB_UNCERTAIN']);
      expect((await stat(join(attemptRoot, 'database.tar.age'))).isFile()).toBe(true);
      await expect(stat(join(attemptRoot, 'raw'))).rejects.toThrow();
    }
  });
});
