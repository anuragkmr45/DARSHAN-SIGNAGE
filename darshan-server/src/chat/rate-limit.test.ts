import { describe, expect, it } from 'vitest';
import {
  buildChatRateLimitStorageKey,
  InMemoryTokenBucketRateLimiter,
  ValkeyTokenBucketRateLimiter,
} from '@/chat/rate-limit';

describe('InMemoryTokenBucketRateLimiter', () => {
  it('blocks once bucket capacity is exhausted', () => {
    const limiter = new InMemoryTokenBucketRateLimiter(2, 0);
    expect(limiter.consume('k').allowed).toBe(true);
    expect(limiter.consume('k').allowed).toBe(true);
    const denied = limiter.consume('k');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('ValkeyTokenBucketRateLimiter', () => {
  it('uses a versioned hash key so Valkey does not store raw chat/user identifiers', () => {
    const raw = 'user-123:conversation-456:forum';
    const key = buildChatRateLimitStorageKey('darshan:test', raw);

    expect(key).toMatch(/^darshan:test:chat-rate-limit:v1:[a-f0-9]{64}$/);
    expect(key).not.toContain('user-123');
    expect(key).not.toContain('conversation-456');
  });

  it('consumes tokens through an atomic Valkey Lua command', async () => {
    const calls: Array<Array<string | number>> = [];
    const limiter = new ValkeyTokenBucketRateLimiter({
      url: 'rediss://valkey.internal:6379/0',
      namespace: 'darshan:test',
      tlsEnabled: true,
      commandTimeoutMs: 1000,
      capacity: 10,
      refillPerSecond: 0.5,
      client: {
        command: async (parts) => {
          calls.push(parts);
          return [0, 4];
        },
        close: async () => undefined,
      },
    });

    await expect(limiter.consume('user-123:conversation-456:attachments', 3)).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 4,
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call[0]).toBe('EVAL');
    expect(call[2]).toBe(1);
    expect(call[3]).toBe(buildChatRateLimitStorageKey('darshan:test', 'user-123:conversation-456:attachments'));
    expect(call[5]).toBe(10);
    expect(call[6]).toBe(0.5);
    expect(call[7]).toBe(3);
    expect(call.join(' ')).not.toContain('conversation-456');
  });

  it('falls back to the local bucket when Valkey is unavailable instead of allowing unlimited traffic', async () => {
    const limiter = new ValkeyTokenBucketRateLimiter({
      url: 'rediss://valkey.internal:6379/0',
      namespace: 'darshan:test',
      tlsEnabled: true,
      commandTimeoutMs: 1000,
      capacity: 2,
      refillPerSecond: 0,
      client: {
        command: async () => {
          throw new Error('connection refused');
        },
        close: async () => undefined,
      },
    });

    await expect(limiter.consume('fallback-key')).resolves.toEqual({ allowed: true });
    await expect(limiter.consume('fallback-key')).resolves.toEqual({ allowed: true });
    await expect(limiter.consume('fallback-key')).resolves.toMatchObject({ allowed: false });
  });
});
