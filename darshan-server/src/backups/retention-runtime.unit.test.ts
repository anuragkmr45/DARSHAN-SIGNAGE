import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetentionBackup } from './retention-policy';
import { createBackupRetentionPolicy } from './retention-policy';

const mocks = vi.hoisted(() => ({
  listInventory: vi.fn(),
  project: vi.fn(),
}));

vi.mock('./retention-store', () => ({
  listBackupRetentionInventory: mocks.listInventory,
  projectTerminalBackupExecutionOutcomes: mocks.project,
}));

import { runBackupRetentionPass } from './retention-runtime.js';
import { BACKUP_RETENTION_PASS_BUDGET_MS } from './retention-runtime.js';

const siteKey = 'site-a';
const repositoryId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-10-29T00:00:00.000Z');
const policy = createBackupRetentionPolicy();

function backup(id: string, daysOld: number): RetentionBackup {
  const capturedAt = new Date(now.getTime() - daysOld * 24 * 60 * 60 * 1_000);
  return {
    id, siteKey, repositoryId, capturedAt, executionOutcome: 'SUCCEEDED', lifecycleState: 'AVAILABLE',
    verification: { kind: 'PUBLICATION_READ_BACK', publicationId: id.replace(/^./, '3'), manifestSha256: 'a'.repeat(64), verifiedAt: capturedAt },
    hasActiveRetentionOperation: false, restoreHold: 'NONE',
  };
}

function inventory(count = 4, firstDaysOld = 40): RetentionBackup[] {
  return Array.from({ length: count }, (_, index) => backup(
    index === count - 1 ? runId : `${String(index + 4).repeat(8)}-${String(index + 4).repeat(4)}-4${String(index + 4).repeat(3)}-8${String(index + 4).repeat(3)}-${String(index + 4).repeat(12)}`,
    firstDaysOld + index,
  ));
}

function deletion(status: 'CLAIMED' | 'PARTIAL' | 'DELETED') {
  return {
    operation: status === 'CLAIMED' ? 'CLAIM_RUN_DELETION' as const : 'RECONCILE_RUN_DELETION' as const,
    operation_id: '', status, deleted_entries: status === 'CLAIMED' ? 0 : 1, total_entries: 1,
    artifacts: [{ artifact_key: 'manifest.json', artifact_kind: 'MANIFEST' as const,
      expected_sha256: 'a'.repeat(64), expected_size_bytes: '10', status: status === 'CLAIMED' ? 'PENDING' as const : 'DELETED' as const }],
  };
}

function fakePool() {
  let operationId = '';
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes('FROM backup_retention_operations AS operation')) return { rows: [], rowCount: 0 };
    if (text.includes('SELECT clock_timestamp() AS now')) return { rows: [{ now }], rowCount: 1 };
    if (text.includes('FROM backup_execution_outcomes AS outcome') && text.includes('WHERE outcome.backup_run_id')) return { rows: [{
      backup_run_id: runId, attempt_id: '44444444-4444-4444-8444-444444444444',
      capture_id: '55555555-5555-4555-8555-555555555555', capture_generation: '7', manifest_sha256: 'a'.repeat(64),
      lifecycle_state: 'AVAILABLE', state_version: 0,
    }], rowCount: 1 };
    if (text.includes('SELECT state, state_version')) return { rows: [{ state: 'AVAILABLE', state_version: 0 }], rowCount: 1 };
    if (text.includes('INSERT INTO backup_retention_operations')) { operationId = String(values[0]); return { rows: [{ id: operationId }], rowCount: 1 }; }
    if (text.includes("count(*) FILTER (WHERE status = 'DELETED')")) return { rows: [{ deleted: '1' }], rowCount: 1 };
    if (text.includes('SELECT 1 FROM backup_retention_artifact_progress')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
    return { rows: [{ operation_id: operationId }], rowCount: 1 };
  });
  const client = { query, release: vi.fn() };
  return { query, connect: vi.fn(async () => client) };
}

function lock(available = true) {
  const release = vi.fn(async () => undefined);
  return { acquire: vi.fn(async () => available ? { release } : null), release };
}

describe('backup retention runtime orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockResolvedValue({ projectedVerified: 0, projectedTerminal: 0, exactReplays: 4 });
  });

  it('protects three or fewer copies without consulting the broker', async () => {
    mocks.listInventory.mockResolvedValue(inventory(3));
    const broker = { inspectRetentionTruth: vi.fn(), claimRunDeletion: vi.fn(), executeRunDeletion: vi.fn(), reconcileRunDeletion: vi.fn() };
    const guard = lock();
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: broker as never, policy,
      pool: fakePool() as never, acquireLock: guard.acquire });
    expect(summary).toMatchObject({ checked: 3, eligible: 0, claimed: 0, deleted: 0 });
    expect(summary.protected.BACKUP_RETENTION_NEWEST_THREE).toBe(3);
    expect(broker.inspectRetentionTruth).not.toHaveBeenCalled();
    expect(guard.release).toHaveBeenCalledOnce();
  });

  it('recomputes policy under the lock and fails closed when a hold appears before broker claim', async () => {
    mocks.listInventory.mockResolvedValue(inventory(4));
    const broker = {
      inspectRetentionTruth: vi.fn()
        .mockResolvedValueOnce({ status: 'AVAILABLE', active_holds: 0, uncertain_holds: 0, manifest_sha256: 'a'.repeat(64) })
        .mockResolvedValueOnce({ status: 'AVAILABLE', active_holds: 1, uncertain_holds: 0, manifest_sha256: 'a'.repeat(64) }),
      claimRunDeletion: vi.fn(), executeRunDeletion: vi.fn(), reconcileRunDeletion: vi.fn(),
    };
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: broker as never, policy,
      pool: fakePool() as never, acquireLock: lock().acquire });
    expect(summary).toMatchObject({ eligible: 1, claimed: 1, deleted: 0, failed: 1 });
    expect(broker.claimRunDeletion).not.toHaveBeenCalled();
  });

  it('converges a timeout through broker reconciliation and records partial progress', async () => {
    mocks.listInventory.mockResolvedValue(inventory(4));
    const broker = {
      inspectRetentionTruth: vi.fn().mockResolvedValue({ status: 'AVAILABLE', active_holds: 0, uncertain_holds: 0, manifest_sha256: 'a'.repeat(64) }),
      claimRunDeletion: vi.fn(async (identity) => ({ ...deletion('CLAIMED'), operation_id: identity.operationId })),
      executeRunDeletion: vi.fn(async () => { throw Object.assign(new Error('timeout'), { code: 'BROKER_TIMEOUT' }); }),
      reconcileRunDeletion: vi.fn(async (identity) => ({ ...deletion('PARTIAL'), operation_id: identity.operationId })),
    };
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: broker as never, policy,
      pool: fakePool() as never, acquireLock: lock().acquire });
    expect(summary).toMatchObject({ claimed: 1, deleted: 0, partial: 1 });
    expect(broker.reconcileRunDeletion).toHaveBeenCalledOnce();
    expect(mocks.listInventory).toHaveBeenCalledTimes(3);
  });

  it('skips a duplicate worker when the site execution lock is held', async () => {
    const guard = lock(false);
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: {} as never, policy,
      pool: fakePool() as never, acquireLock: guard.acquire });
    expect(summary.skipped).toBe(true);
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it('manual mode loads and resumes only the targeted durable operation', async () => {
    mocks.listInventory.mockResolvedValue(inventory(4));
    const pool = fakePool();
    const broker = { inspectRetentionTruth: vi.fn(), claimRunDeletion: vi.fn(), executeRunDeletion: vi.fn(), reconcileRunDeletion: vi.fn() };
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: broker as never, policy,
      mode: { kind: 'MANUAL_DELETE', backupRunId: runId }, pool: pool as never, acquireLock: lock().acquire });
    const unresolvedCall = pool.query.mock.calls.find(([text]) => String(text).includes('FROM backup_retention_operations AS operation'));
    expect(unresolvedCall?.[1]?.[3]).toBe(runId);
    expect(summary.claimed).toBe(0);
    expect(broker.inspectRetentionTruth).not.toHaveBeenCalled();
  });

  it('stops admitting candidates when the absolute pass budget is exhausted', async () => {
    mocks.listInventory.mockResolvedValue(inventory(4, 100));
    const broker = { inspectRetentionTruth: vi.fn(), claimRunDeletion: vi.fn(), executeRunDeletion: vi.fn(), reconcileRunDeletion: vi.fn() };
    const guard = lock();
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(BACKUP_RETENTION_PASS_BUDGET_MS + 1);
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: broker as never, policy,
      pool: fakePool() as never, acquireLock: guard.acquire, now });
    expect(summary.budgetExhausted).toBe(true);
    expect(broker.inspectRetentionTruth).not.toHaveBeenCalled();
    expect(mocks.listInventory).not.toHaveBeenCalled();
    expect(guard.release).toHaveBeenCalledOnce();
  });

  it('mirrors an authoritative broker tombstone after stale SQL is restored and never reclaims it', async () => {
    mocks.listInventory.mockResolvedValue(inventory(4));
    const brokerOperationId = '77777777-7777-4777-8777-777777777777';
    const broker = {
      inspectRetentionTruth: vi.fn().mockResolvedValue({ status: 'DELETED', active_holds: 0, uncertain_holds: 0,
        deletion_operation_id: brokerOperationId, manifest_sha256: 'a'.repeat(64) }),
      claimRunDeletion: vi.fn(), executeRunDeletion: vi.fn(), reconcileRunDeletion: vi.fn(),
    };
    const summary = await runBackupRetentionPass({ siteKey, repositoryId, broker: broker as never, policy,
      pool: fakePool() as never, acquireLock: lock().acquire });
    expect(summary.deleted).toBe(1);
    expect(broker.claimRunDeletion).not.toHaveBeenCalled();
  });

  it('uses the same 90-day policy at scan, SQL-intent, and immediate pre-claim rechecks', async () => {
    const ninetyDays = createBackupRetentionPolicy({ retentionDays: 90 });
    const makeBroker = () => ({
      inspectRetentionTruth: vi.fn().mockResolvedValue({ status: 'AVAILABLE', active_holds: 0, uncertain_holds: 0,
        manifest_sha256: 'a'.repeat(64) }),
      claimRunDeletion: vi.fn(), executeRunDeletion: vi.fn(), reconcileRunDeletion: vi.fn(),
    });

    mocks.listInventory.mockResolvedValueOnce(inventory(4, 40));
    const scanBroker = makeBroker();
    await runBackupRetentionPass({ siteKey, repositoryId, broker: scanBroker as never, policy: ninetyDays,
      pool: fakePool() as never, acquireLock: lock().acquire });
    expect(scanBroker.inspectRetentionTruth).not.toHaveBeenCalled();

    mocks.listInventory.mockReset().mockResolvedValueOnce(inventory(4, 100)).mockResolvedValueOnce(inventory(4, 40));
    const intentBroker = makeBroker();
    await runBackupRetentionPass({ siteKey, repositoryId, broker: intentBroker as never, policy: ninetyDays,
      pool: fakePool() as never, acquireLock: lock().acquire });
    expect(intentBroker.inspectRetentionTruth).toHaveBeenCalledOnce();
    expect(intentBroker.claimRunDeletion).not.toHaveBeenCalled();

    mocks.listInventory.mockReset()
      .mockResolvedValueOnce(inventory(4, 100))
      .mockResolvedValueOnce(inventory(4, 100))
      .mockResolvedValueOnce(inventory(4, 40));
    const claimBroker = makeBroker();
    await runBackupRetentionPass({ siteKey, repositoryId, broker: claimBroker as never, policy: ninetyDays,
      pool: fakePool() as never, acquireLock: lock().acquire });
    expect(claimBroker.inspectRetentionTruth).toHaveBeenCalledTimes(2);
    expect(claimBroker.claimRunDeletion).not.toHaveBeenCalled();
  });
});
