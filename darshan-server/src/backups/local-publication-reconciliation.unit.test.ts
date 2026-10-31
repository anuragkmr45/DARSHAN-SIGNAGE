import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import { createLocalPublicationInspector } from './local-backup-orchestrator.js';
import { serializeBackupManifest, signBackupManifest, type BackupManifestV1 } from './manifest.js';
import type { LocalRepository } from './local-repository.js';

describe('local publication restart reconciliation', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it.each([
    { cancelled: false, publishedAt: '2026-10-28T00:01:00.000Z', expected: 'ADOPTED', receiptMissing: false, now: '2026-10-28T00:01:10.000Z', superseded: false },
    { cancelled: true, publishedAt: '2026-10-28T00:01:00.000Z', expected: 'ABSENT', receiptMissing: false, now: '2026-10-28T00:01:10.000Z', superseded: false },
    { cancelled: false, publishedAt: '2026-10-28T00:03:00.000Z', expected: 'ABSENT', receiptMissing: false, now: '2026-10-28T00:03:10.000Z', superseded: false },
    { cancelled: false, publishedAt: '2026-10-28T00:01:10.000Z', expected: 'ADOPTED', receiptMissing: true, now: '2026-10-28T00:01:00.000Z', superseded: false },
    { cancelled: false, publishedAt: '2026-10-28T00:03:10.000Z', expected: 'ABSENT', receiptMissing: true, now: '2026-10-28T00:03:00.000Z', superseded: false },
    { cancelled: true, publishedAt: '2026-10-28T00:01:10.000Z', expected: 'ABSENT', receiptMissing: true, now: '2026-10-28T00:01:00.000Z', superseded: false },
    { cancelled: false, publishedAt: '2026-10-28T00:01:00.000Z', expected: 'ABSENT', receiptMissing: false, now: '2026-10-28T00:01:10.000Z', superseded: true },
  ] as const)('reconciles a rename crash without adopting cancelled/late/superseded attempts', async ({ cancelled, publishedAt, expected, receiptMissing, now, superseded }) => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-publication-restart-')); roots.push(root);
    const runId = randomUUID(); const attemptId = randomUUID(); const captureId = randomUUID(); const repositoryId = randomUUID();
    const runPath = join(root, 'runs', runId); await mkdir(runPath, { recursive: true });
    const signer = {
      algorithm: 'test-sha256', keyId: 'test-key',
      sign: async (payload: Uint8Array) => createHash('sha256').update(payload).digest(),
    };
    const unsigned: BackupManifestV1 = {
      version: 1, repository: { kind: 'LOCAL_FILESYSTEM', id: repositoryId }, site: { id: 'site-a' },
      run: { id: runId, attemptId: superseded ? randomUUID() : attemptId },
      capture: { id: captureId, generation: '1', startedAt: '2026-10-28T00:00:00.000Z', sealedAt: '2026-10-28T00:00:30.000Z', stagingInventorySha256: 'a'.repeat(64) },
      release: { id: 'test' }, schema: { migrationId: '0051', fingerprintSha256: 'b'.repeat(64) },
      encryption: { keyId: 'recovery-1', tool: { name: 'age', version: 'age test', executableSha256: 'c'.repeat(64) } },
      artifacts: [{ kind: 'DATABASE', name: 'database', ciphertextPath: 'database.tar.age', ciphertextSizeBytes: '1', ciphertextSha256: 'd'.repeat(64) }],
      signature: null,
    };
    const manifest = await signBackupManifest(unsigned, signer);
    const manifestBytes = serializeBackupManifest(manifest);
    await writeFile(join(runPath, 'manifest.json'), manifestBytes);
    const digest = createHash('sha256').update(manifestBytes).digest('hex');
    const publication = {
      id: randomUUID(), backup_run_id: runId, backup_attempt_id: attemptId, capture_id: captureId,
      repository_id: repositoryId, manifest_sha256: digest, incomplete_relative_path: 'incomplete/attempt',
      published_relative_path: `runs/${runId}`, status: 'PREPARED' as const, prepared_at: new Date(), published_at: null, verified_at: null,
    };
    const confirmPublished = vi.fn(async () => ({ ...publication, status: 'PUBLISHED' as const, published_at: new Date(publishedAt) }));
    const reconcileVerified = vi.fn(async () => true);
    const quarantinePublication = vi.fn(async () => true);
    const reconcileRepository = vi.fn(async () => ({
      adopted: receiptMissing && expected === 'ADOPTED' ? [runPath] : [], settled: [], preserved: [],
      quarantined: expected === 'ABSENT' ? [runPath] : [], corrupt: [],
    }));
    let reads = 0;
    const inspector = createLocalPublicationInspector({
      repository: { root, identity: { repository_id: repositoryId, site_id: 'site-a' } } as LocalRepository,
      verifier: { verify: async ({ payload, signature }) => createHash('sha256').update(payload).digest().equals(Buffer.from(signature)) },
      pool: { query: vi.fn(async () => ({ rows: [publication], rowCount: 1 })) } as unknown as Pool,
      adapters: {
        readPublished: async () => ({
          runPath, intent: { manifest_sha256: digest } as never,
          receipt: receiptMissing && reads++ === 0 ? null : { published_at: publishedAt } as never, artifactBytes: 1n,
        }),
        confirmPublished,
        reconcileVerified,
        quarantinePublication,
        reconcileRepository,
      },
      now: () => new Date(now),
    });
    await expect(inspector({
      id: runId, attempt_id: attemptId,
      cancellation_requested_at: cancelled ? new Date('2026-10-28T00:01:10.000Z') : null,
      deadline_at: new Date('2026-10-28T00:02:00.000Z'),
    })).resolves.toBe(expected);
    if (expected === 'ADOPTED') {
      expect(reconcileVerified).toHaveBeenCalledOnce();
      expect(quarantinePublication).not.toHaveBeenCalled();
      if (receiptMissing) expect(reconcileRepository).toHaveBeenCalledOnce();
    } else {
      expect(reconcileVerified).not.toHaveBeenCalled();
      expect(reconcileRepository).toHaveBeenCalledOnce();
      expect(quarantinePublication).toHaveBeenCalledOnce();
    }
  });

  it('preserves publication authority when repository I/O is transiently unavailable', async () => {
    const publication = {
      id: randomUUID(), backup_run_id: randomUUID(), backup_attempt_id: randomUUID(), capture_id: randomUUID(),
      repository_id: randomUUID(), manifest_sha256: 'a'.repeat(64), status: 'UNCERTAIN' as const,
    };
    const quarantinePublication = vi.fn();
    const inspector = createLocalPublicationInspector({
      repository: { root: '/unavailable' } as LocalRepository,
      verifier: { verify: async () => true },
      pool: { query: vi.fn(async () => ({ rows: [publication], rowCount: 1 })) } as unknown as Pool,
      adapters: {
        readPublished: async () => { throw Object.assign(new Error('temporary I/O failure'), { code: 'EIO' }); },
        quarantinePublication,
      },
    });
    await expect(inspector({
      id: publication.backup_run_id, attempt_id: publication.backup_attempt_id,
      cancellation_requested_at: null, deadline_at: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ code: 'EIO' });
    expect(quarantinePublication).not.toHaveBeenCalled();
  });
});
