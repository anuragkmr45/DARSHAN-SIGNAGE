import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MaintenanceCoordinatorError, type CaptureIdentity } from '@/maintenance';
import {
  createStagingInventoryDigest,
  runConsistentCapture,
  type ConsistentCaptureCoordinator,
} from './consistent-capture';

const roots: string[] = [];

async function stagingRoot() {
  const root = await mkdtemp(join(tmpdir(), 'darshan-capture-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function identity(): CaptureIdentity {
  return {
    siteKey: 'site-a',
    captureId: 'capture-a',
    generation: 2,
    backupRunId: 'run-a',
    backupAttemptId: 'attempt-a',
    owner: 'owner-a',
  };
}

function coordinator(overrides: Partial<ConsistentCaptureCoordinator> = {}): ConsistentCaptureCoordinator {
  return {
    beginCapture: vi.fn(async () => identity()),
    enterCopying: vi.fn(async () => undefined),
    seal: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('consistent backup capture orchestration', () => {
  it('drains, copies, seals a deterministic digest, then leaves packaging outside the barrier', async () => {
    const root = await stagingRoot();
    const events: string[] = [];
    let drainAttempts = 0;
    const captureCoordinator = coordinator({
      beginCapture: vi.fn(async () => { events.push('begin'); return identity(); }),
      enterCopying: vi.fn(async () => {
        events.push('drain');
        drainAttempts += 1;
        if (drainAttempts === 1) {
          throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_NOT_DRAINED', 'still draining');
        }
      }),
      seal: vi.fn(async (_identity, digest) => {
        events.push(`seal:${digest}`);
      }),
      abort: vi.fn(async () => { events.push('abort'); }),
    });

    const result = await runConsistentCapture({
      coordinator: captureCoordinator,
      siteKey: 'site-a',
      backupRunId: 'run-a',
      backupAttemptId: 'attempt-a',
      stagingRoot: root,
      signal: new AbortController().signal,
      drainPollMs: 1,
      copyIntoStaging: async () => {
        events.push('copy');
        await writeFile(join(root, 'database.sql'), 'database');
      },
    });

    expect(result.stagingInventoryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(events).toEqual([
      'begin',
      'drain',
      'drain',
      'copy',
      `seal:${result.stagingInventoryDigest}`,
    ]);
    expect(captureCoordinator.abort).not.toHaveBeenCalled();
  });

  it('aborts and preserves the original copy failure', async () => {
    const root = await stagingRoot();
    const captureCoordinator = coordinator();
    const failure = new Error('object copy failed');
    await expect(runConsistentCapture({
      coordinator: captureCoordinator,
      siteKey: 'site-a',
      backupRunId: 'run-a',
      backupAttemptId: 'attempt-a',
      stagingRoot: root,
      signal: new AbortController().signal,
      copyIntoStaging: async () => { throw failure; },
    })).rejects.toBe(failure);
    expect(captureCoordinator.abort).toHaveBeenCalledWith(identity());
  });

  it('does not mask an emergency or watchdog fence when abort also loses ownership', async () => {
    const root = await stagingRoot();
    const preempted = new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'preempted');
    const captureCoordinator = coordinator({
      seal: vi.fn(async () => { throw preempted; }),
      abort: vi.fn(async () => { throw new MaintenanceCoordinatorError('MAINTENANCE_CAPTURE_FENCED', 'already fenced'); }),
    });
    await expect(runConsistentCapture({
      coordinator: captureCoordinator,
      siteKey: 'site-a',
      backupRunId: 'run-a',
      backupAttemptId: 'attempt-a',
      stagingRoot: root,
      signal: new AbortController().signal,
      copyIntoStaging: async () => { await writeFile(join(root, 'db.sql'), 'data'); },
    })).rejects.toBe(preempted);
  });

  it('makes the inventory independent of enumeration order and sensitive to path and bytes', async () => {
    const first = await stagingRoot();
    const second = await stagingRoot();
    await writeFile(join(first, 'b'), 'two');
    await writeFile(join(first, 'a'), 'one');
    await writeFile(join(second, 'a'), 'one');
    await writeFile(join(second, 'b'), 'two');
    const signal = new AbortController().signal;
    expect(await createStagingInventoryDigest(first, signal)).toBe(await createStagingInventoryDigest(second, signal));
    await writeFile(join(second, 'b'), 'changed');
    expect(await createStagingInventoryDigest(first, signal)).not.toBe(await createStagingInventoryDigest(second, signal));
  });
});
