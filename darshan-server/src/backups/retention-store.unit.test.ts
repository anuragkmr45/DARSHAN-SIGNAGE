import { describe, expect, it, vi } from 'vitest';
import {
  listBackupRetentionInventory,
  projectTerminalBackupExecutionOutcomes,
  transitionBackupArtifactLifecycle,
  transitionBackupRetentionOperation,
} from './retention-store';

describe('backup retention store', () => {
  it('projects exact verified publication evidence atomically and never reads synthetic run verification', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ backup_run_id: '11111111-1111-4111-8111-111111111111' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });
    const client = { query, release: vi.fn() };
    const result = await projectTerminalBackupExecutionOutcomes({ siteKey: 'site-a', repositoryId: '33333333-3333-4333-8333-333333333333',
      pool: { connect: vi.fn(async () => client) } as never });
    expect(result).toEqual({ projectedVerified: 1, projectedTerminal: 0, exactReplays: 0 });
    expect(query.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('run.verified_at');
    expect(query.mock.calls.map((call) => String(call[0])).join('\n')).toContain('outcome.verified_good_at IS DISTINCT FROM exact.verified_at');
    expect(query.mock.calls.flatMap((call) => call[1] ?? []).some((value) => value instanceof Date)).toBe(false);
  });

  it('maps only explicit immutable publication provenance and restore projections', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      backup_run_id: 'run-1', site_key: 'site-a', repository_id: 'repo-a', outcome: 'SUCCEEDED',
      lifecycle_state: 'AVAILABLE', verification_provenance: 'PUBLICATION_READ_BACK',
      captured_at: new Date('2026-07-31T23:55:00.000Z'),
      publication_id: 'publication-1', manifest_sha256: 'a'.repeat(64),
      verified_good_at: new Date('2026-08-01T00:00:00.000Z'),
      has_active_retention_operation: false, restore_hold: 'ACTIVE',
    }] });
    const result = await listBackupRetentionInventory({ siteKey: 'site-a', repositoryId: 'repo-a', pool: { query } as never });
    expect(result).toEqual([expect.objectContaining({
      id: 'run-1', executionOutcome: 'SUCCEEDED', restoreHold: 'ACTIVE',
      capturedAt: new Date('2026-07-31T23:55:00.000Z'),
      verification: expect.objectContaining({ kind: 'PUBLICATION_READ_BACK', publicationId: 'publication-1' }),
    })]);
    expect(query.mock.calls[0][0]).not.toContain('run.verified_at');
  });

  it('uses compare-and-swap lifecycle versions and keeps exact repeats idempotent', async () => {
    const changed = { backup_run_id: 'run-1', state: 'DELETE_REQUESTED', state_version: 8 };
    const query = vi.fn().mockResolvedValueOnce({ rows: [changed] });
    await expect(transitionBackupArtifactLifecycle({
      backupRunId: 'run-1', expectedState: 'AVAILABLE', expectedVersion: 7,
      nextState: 'DELETE_REQUESTED', pool: { query } as never,
    })).resolves.toBe(changed);
    expect(query.mock.calls[0][0]).toContain('state_version = state_version + 1');

    query.mockResolvedValueOnce({ rows: [changed] });
    await expect(transitionBackupArtifactLifecycle({
      backupRunId: 'run-1', expectedState: 'DELETE_REQUESTED', expectedVersion: 8,
      nextState: 'DELETE_REQUESTED', pool: { query } as never,
    })).resolves.toBe(changed);
    expect(query.mock.calls[1][0]).toContain('SELECT backup_run_id');
  });

  it('rejects stale lifecycle versions and stale operation fences', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(transitionBackupArtifactLifecycle({
      backupRunId: 'run-1', expectedState: 'AVAILABLE', expectedVersion: 1,
      nextState: 'DELETE_REQUESTED', pool: { query } as never,
    })).rejects.toMatchObject({ code: 'BACKUP_RETENTION_STATE_CONFLICT' });
    await expect(transitionBackupRetentionOperation({
      operationId: 'operation-1', fenceToken: 'old-fence', expectedState: 'RUNNING',
      nextState: 'SUCCEEDED', pool: { query } as never,
    })).rejects.toMatchObject({ code: 'BACKUP_RETENTION_FENCE_REJECTED' });
  });

  it('uses the fence token and expected state in legal operation transitions', async () => {
    const row = { id: 'operation-1', status: 'PARTIAL', fence_token: 'fence-1' };
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    await expect(transitionBackupRetentionOperation({
      operationId: row.id, fenceToken: row.fence_token, expectedState: 'RUNNING',
      nextState: 'PARTIAL', errorCode: 'DELETE_FAILED', pool: { query } as never,
    })).resolves.toBe(row);
    expect(query.mock.calls[0][1].slice(0, 4)).toEqual(['operation-1', 'fence-1', 'RUNNING', 'PARTIAL']);
  });
});
