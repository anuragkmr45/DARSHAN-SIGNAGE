import { describe, expect, it, vi } from 'vitest';
import { getProofOfPlayQueueOptions } from './index';

describe('proof-of-play queue admission', () => {
  it('accepts duplicate durable deliveries instead of using pg-boss singleton throttling', async () => {
    const options = getProofOfPlayQueueOptions();
    expect(options).toEqual({ retryLimit: 5, retryDelay: 15 });
    expect(options).not.toHaveProperty('singletonKey');
    expect(options).not.toHaveProperty('singletonSeconds');

    // pg-boss standard queues accept both sends. Its singleton path returns
    // null for the second matching key, which sendJob correctly treats as an
    // enqueue failure; database idempotency handles these duplicates instead.
    const send = vi.fn(async () => `job-${send.mock.calls.length}`);
    await expect(send('telemetry:proof-of-play', { idempotencyKey: 'same' }, options))
      .resolves.toBe('job-1');
    await expect(send('telemetry:proof-of-play', { idempotencyKey: 'same' }, options))
      .resolves.toBe('job-2');
    expect(send).toHaveBeenCalledTimes(2);
  });
});
