import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  registerDatabaseShutdownHook: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/config', () => ({
  config: {
    OUTBOX_DISPATCH_ENABLED: true,
    REALTIME_SYNC_ENABLED: true,
    OUTBOX_DISPATCH_INTERVAL_MS: 10,
    OUTBOX_DISPATCH_LEASE_MS: 60_000,
    OUTBOX_DISPATCH_BATCH_SIZE: 10,
  },
}));

vi.mock('@/db', () => ({
  getDatabase: () => ({ transaction: mocks.transaction }),
  registerDatabaseShutdownHook: mocks.registerDatabaseShutdownHook,
  schema: {
    commandOutbox: {
      id: 'id',
      status: 'status',
      attempt_count: 'attempt_count',
      max_attempts: 'max_attempts',
      payload: 'payload',
      screen_id: 'screen_id',
    },
  },
}));

vi.mock('@/observability/metrics', () => ({ recordOutboxDispatch: vi.fn() }));
vi.mock('@/realtime/device-gateway', () => ({ sendDeviceNotification: vi.fn() }));
vi.mock('@/utils/logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }));

import { startOutboxDispatcher, stopOutboxDispatcher } from './outbox-dispatcher';

describe('outbox dispatcher lifecycle', () => {
  afterEach(async () => {
    await stopOutboxDispatcher();
    vi.useRealTimers();
    mocks.execute.mockReset();
    mocks.transaction.mockReset();
    mocks.warn.mockReset();
  });

  it('serializes ticks and waits for the active database operation during shutdown', async () => {
    vi.useFakeTimers();
    let resolveClaim: ((value: { rows: [] }) => void) | undefined;
    const claim = new Promise<{ rows: [] }>((resolve) => {
      resolveClaim = resolve;
    });
    mocks.execute.mockReturnValue(claim);
    mocks.transaction.mockImplementation(async (callback: (tx: { execute: typeof mocks.execute }) => unknown) =>
      callback({ execute: mocks.execute })
    );

    expect(startOutboxDispatcher()).toBe(true);
    vi.advanceTimersByTime(10);
    await Promise.resolve();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = stopOutboxDispatcher().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    resolveClaim?.({ rows: [] });
    await stopping;
    expect(stopped).toBe(true);
  });

  it('registers its drain function with the database lifecycle', () => {
    expect(mocks.registerDatabaseShutdownHook).toHaveBeenCalledWith(
      'outbox-dispatcher',
      expect.any(Function)
    );
  });
});
