import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const onConflictDoUpdate = vi.fn();
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const where = vi.fn();
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  return {
    config: {
      SIGNHEX_DEPLOYMENT_ID: 'deployment-a',
      SIGNHEX_SERVER_ID: 'worker-a',
      DARSHAN_RELEASE_ID: 'release-a',
      WORKER_HEARTBEAT_INTERVAL_MS: 30_000,
    },
    insert,
    values,
    onConflictDoUpdate,
    select,
    from,
    where,
    schema: {
      workerRuntimeHeartbeats: {
        id: 'workerRuntimeHeartbeats.id',
      },
    },
  };
});

vi.mock('@/config', () => ({ config: mocks.config }));
vi.mock('@/db', () => ({
  getDatabase: () => ({
    insert: mocks.insert,
    select: mocks.select,
  }),
  schema: mocks.schema,
}));
vi.mock('@/utils/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }));

describe('worker heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records one bounded row per worker identity and refreshes process started_at on upsert', async () => {
    const observedAt = new Date('2026-09-05T08:00:00.000Z');
    const { recordWorkerHeartbeat } = await import('./worker-heartbeat');

    await recordWorkerHeartbeat(observedAt);

    expect(mocks.insert).toHaveBeenCalledWith(mocks.schema.workerRuntimeHeartbeats);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'deployment-a:worker-a',
        deployment_id: 'deployment-a',
        server_id: 'worker-a',
        release_id: 'release-a',
        observed_at: observedAt,
        updated_at: observedAt,
        started_at: expect.any(Date),
      })
    );
    const insertStartedAt = mocks.values.mock.calls[0]?.[0]?.started_at;
    expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith({
      target: mocks.schema.workerRuntimeHeartbeats.id,
      set: {
        release_id: 'release-a',
        observed_at: observedAt,
        started_at: insertStartedAt,
        updated_at: observedAt,
      },
    });
  });
});
