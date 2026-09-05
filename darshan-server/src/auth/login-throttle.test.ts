import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  _clearAllAttemptsForTests,
  buildLoginThrottleKey,
  isLockedOut,
  recordFailedAttempt,
  resetAttempts,
  ValkeyLoginThrottleStore,
} from './login-throttle';

const KEY = 'user@example.com:127.0.0.1';

describe('login throttle', () => {
  beforeEach(() => {
    _clearAllAttemptsForTests();
  });

  it('locks after max attempts within window', () => {
    const maxAttempts = 3;
    const lockMs = 1000;

    expect(isLockedOut(KEY, lockMs)).toEqual({ locked: false });
    recordFailedAttempt(KEY, maxAttempts, lockMs);
    recordFailedAttempt(KEY, maxAttempts, lockMs);
    const result = recordFailedAttempt(KEY, maxAttempts, lockMs);
    expect(result.locked).toBe(true);
    const locked = isLockedOut(KEY, lockMs);
    expect(locked.locked).toBe(true);
  });

  it('resets after successful login', () => {
    const maxAttempts = 2;
    const lockMs = 1000;
    recordFailedAttempt(KEY, maxAttempts, lockMs);
    resetAttempts(KEY);
    expect(isLockedOut(KEY, lockMs).locked).toBe(false);
  });

  it('uses a versioned hash key so Valkey never stores the login identifier', () => {
    const key = buildLoginThrottleKey('darshan:production', KEY);

    expect(key).toMatch(/^darshan:production:login-throttle:v1:[a-f0-9]{64}$/);
    expect(key).not.toContain('user@example.com');
    expect(key).not.toContain('127.0.0.1');
  });

  it('uses atomic Valkey commands for check, failure recording, and reset', async () => {
    const calls: Array<Array<string | number>> = [];
    const store = new ValkeyLoginThrottleStore({
      url: 'rediss://valkey.internal:6379',
      namespace: 'darshan:test',
      tlsEnabled: true,
      commandTimeoutMs: 1000,
      client: {
        command: async (parts) => {
          calls.push(parts);
          if (parts[0] === 'DEL') return 1;
          return String(parts[1]).includes('max_attempts') ? [1, 15] : [0, 0];
        },
        close: async () => undefined,
      },
    });

    await expect(store.isLocked(KEY, 15_000)).resolves.toEqual({ status: 'available', locked: false });
    await expect(store.recordFailure(KEY, 3, 15_000)).resolves.toEqual({
      status: 'available',
      locked: true,
      retryAfter: 15,
    });
    await expect(store.reset(KEY)).resolves.toEqual({ status: 'available', locked: false });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.[0]).toBe('EVAL');
    expect(calls[1]?.[0]).toBe('EVAL');
    expect(calls[2]).toEqual(['DEL', buildLoginThrottleKey('darshan:test', KEY)]);
    for (const call of calls) expect(call.join(' ')).not.toContain('user@example.com');
  });

  it('reports a Valkey failure explicitly instead of silently claiming a lock decision', async () => {
    const store = new ValkeyLoginThrottleStore({
      url: 'redis://valkey.internal:6379',
      namespace: 'darshan:test',
      tlsEnabled: false,
      commandTimeoutMs: 1000,
      client: {
        command: async () => {
          throw new Error('connection refused');
        },
        close: async () => undefined,
      },
    });

    await expect(store.isLocked(KEY, 1000)).resolves.toEqual({ status: 'unavailable' });
    await expect(store.recordFailure(KEY, 3, 1000)).resolves.toEqual({ status: 'unavailable' });
    await expect(store.reset(KEY)).resolves.toEqual({ status: 'unavailable' });
  });
});

const integrationValkeyUrl = process.env.LOGIN_THROTTLE_TEST_VALKEY_URL;

describe.runIf(Boolean(integrationValkeyUrl))('Valkey login throttle integration', () => {
  it('persists an atomic lock across store instances and removes it on successful-login reset', async () => {
    const namespace = `darshan:login-throttle-test:${randomUUID()}`;
    const input = `admin@example.test\u0000127.0.0.1`;
    const options = {
      url: integrationValkeyUrl,
      namespace,
      tlsEnabled: false,
      commandTimeoutMs: 1_000,
    };
    const first = new ValkeyLoginThrottleStore(options);
    const second = new ValkeyLoginThrottleStore(options);

    try {
      await expect(first.isLocked(input, 10_000)).resolves.toEqual({ status: 'available', locked: false });
      await expect(first.recordFailure(input, 2, 10_000)).resolves.toEqual({ status: 'available', locked: false });
      await expect(first.recordFailure(input, 2, 10_000)).resolves.toEqual({
        status: 'available',
        locked: true,
        retryAfter: 10,
      });
      await expect(second.isLocked(input, 10_000)).resolves.toMatchObject({
        status: 'available',
        locked: true,
      });
      await expect(second.reset(input)).resolves.toEqual({ status: 'available', locked: false });
      await expect(first.isLocked(input, 10_000)).resolves.toEqual({ status: 'available', locked: false });
    } finally {
      await Promise.all([first.reset(input), first.close(), second.close()]);
    }
  });
});
