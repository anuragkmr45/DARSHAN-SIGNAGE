import { chmod, link, lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackupBrokerWorkerAdapter, persistedBrokerRequestIds } from './backup-broker-worker-adapter.js';

describe('backup broker worker replay identity', () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

  it('persists stable per-operation request ids in an exact 0600 single-link file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-broker-worker-'));
    roots.push(root);
    await chmod(root, 0o700);
    const deadline = new Date(Date.now() + 60_000);
    const first = await persistedBrokerRequestIds(root, deadline);
    const second = await persistedBrokerRequestIds(root, deadline);
    expect(second).toEqual(first);
    expect(new Set([first.PREPARE_PUBLICATION.request_id, first.COMMIT_PUBLICATION.request_id, first.QUARANTINE_PUBLICATION.request_id]).size).toBe(3);
    expect(first.PREPARE_PUBLICATION.deadline).toBe(deadline.toISOString());
    const stat = await lstat(join(root, 'broker-request-ids.json'));
    expect(stat.mode & 0o777).toBe(0o600);
    expect(stat.nlink).toBe(1);
  });

  it('rejects a hard-linked request-id journal instead of accepting replay ambiguity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-broker-worker-'));
    roots.push(root);
    await chmod(root, 0o700);
    const deadline = new Date(Date.now() + 60_000);
    await persistedBrokerRequestIds(root, deadline);
    await link(join(root, 'broker-request-ids.json'), join(root, 'duplicate'));
    await expect(persistedBrokerRequestIds(root, deadline)).rejects.toThrow('Unsafe broker request-id file');
  });

  it('rejects a restart that tries to mutate the same attempt with a changed deadline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'darshan-broker-worker-'));
    roots.push(root); await chmod(root, 0o700);
    const deadline = new Date(Date.now() + 60_000);
    const first = await persistedBrokerRequestIds(root, deadline);
    await expect(persistedBrokerRequestIds(root, new Date(deadline.getTime() + 1_000))).rejects.toMatchObject({ code: 'BROKER_MUTATION_REPLAY_CONFLICT' });
    expect((await persistedBrokerRequestIds(root, deadline)).PREPARE_PUBLICATION).toEqual(first.PREPARE_PUBLICATION);
  });
});

describe('backup broker worker retention contract', () => {
  const identity = {
    runId: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222',
    captureId: '33333333-3333-4333-8333-333333333333', captureGeneration: 7,
    manifestSha256: 'a'.repeat(64), operationId: '44444444-4444-4444-8444-444444444444',
    ownerToken: '55555555-5555-4555-8555-555555555555', fenceToken: '66666666-6666-4666-8666-666666666666',
  };

  it('binds deletion responses to the exact operation and progress counts', async () => {
    const client = { request: vi.fn().mockResolvedValue({ operation: 'CLAIM_RUN_DELETION',
      operation_id: identity.operationId, status: 'CLAIMED', deleted_entries: 0, total_entries: 1,
      artifacts: [{ artifact_key: 'manifest.json', artifact_kind: 'MANIFEST', expected_size_bytes: '10',
        expected_sha256: 'a'.repeat(64), status: 'PENDING' }] }) };
    const adapter = new (BackupBrokerWorkerAdapter as never as new (...args: unknown[]) => BackupBrokerWorkerAdapter)(client, new Map(), {});
    await expect(adapter.claimRunDeletion(identity)).resolves.toMatchObject({ status: 'CLAIMED' });
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'CLAIM_RUN_DELETION', operation_id: identity.operationId,
      owner_token: identity.ownerToken, fence_token: identity.fenceToken,
    }), undefined);
  });

  it('rejects wrong operation identity and inconsistent deletion progress', async () => {
    const client = { request: vi.fn()
      .mockResolvedValueOnce({ operation: 'CLAIM_RUN_DELETION', operation_id: '77777777-7777-4777-8777-777777777777',
        status: 'CLAIMED', deleted_entries: 0, total_entries: 0, artifacts: [] })
      .mockResolvedValueOnce({ operation: 'CLAIM_RUN_DELETION', operation_id: identity.operationId,
        status: 'PARTIAL', deleted_entries: 1, total_entries: 1,
        artifacts: [{ artifact_key: 'manifest.json', artifact_kind: 'MANIFEST', status: 'PENDING' }] }) };
    const adapter = new (BackupBrokerWorkerAdapter as never as new (...args: unknown[]) => BackupBrokerWorkerAdapter)(client, new Map(), {});
    await expect(adapter.claimRunDeletion(identity)).rejects.toMatchObject({ code: 'BROKER_RETENTION_EVIDENCE_MISMATCH' });
    await expect(adapter.claimRunDeletion(identity)).rejects.toMatchObject({ code: 'BROKER_RETENTION_EVIDENCE_MISMATCH' });
  });

  it('keeps inspection within 60 seconds and grants bounded long mutation deadlines', async () => {
    const client = { request: vi.fn()
      .mockResolvedValueOnce({ operation: 'INSPECT_RETENTION_TRUTH', status: 'AVAILABLE', active_holds: 0,
        uncertain_holds: 0, manifest_sha256: identity.manifestSha256 })
      .mockResolvedValueOnce({ operation: 'CLAIM_RUN_DELETION', operation_id: identity.operationId,
        status: 'CLAIMED', deleted_entries: 0, total_entries: 0, artifacts: [] }) };
    const adapter = new (BackupBrokerWorkerAdapter as never as new (...args: unknown[]) => BackupBrokerWorkerAdapter)(client, new Map(), {});
    const before = Date.now();
    await adapter.inspectRetentionTruth(identity);
    await adapter.claimRunDeletion(identity);
    const inspectDeadline = Date.parse(client.request.mock.calls[0][0].deadline);
    const mutationDeadline = Date.parse(client.request.mock.calls[1][0].deadline);
    expect(inspectDeadline - before).toBeGreaterThan(0);
    expect(inspectDeadline - before).toBeLessThanOrEqual(60_000);
    expect(mutationDeadline - before).toBeGreaterThan(60_000);
    expect(mutationDeadline - before).toBeLessThanOrEqual(4 * 60 * 60 * 1_000);
  });

  it('binds exact hold inspection to the complete lifecycle identity', async () => {
    const client = { inspectRestoreHold: vi.fn().mockResolvedValue({ operation: 'INSPECT_RESTORE_HOLD',
      operation_id: identity.operationId, manifest_sha256: identity.manifestSha256, status: 'ACTIVE' }) };
    const adapter = new (BackupBrokerWorkerAdapter as never as new (...args: unknown[]) => BackupBrokerWorkerAdapter)(client, new Map(), {});
    await expect(adapter.inspectRestoreHold(identity)).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(client.inspectRestoreHold).toHaveBeenCalledWith(expect.objectContaining({
      run_id: identity.runId, attempt_id: identity.attemptId, capture_id: identity.captureId,
      capture_generation: identity.captureGeneration, manifest_sha256: identity.manifestSha256,
      operation_id: identity.operationId, owner_token: identity.ownerToken, fence_token: identity.fenceToken,
    }), undefined);
  });
});
