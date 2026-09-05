import { createHash } from 'node:crypto';
import { config } from '@/config';
import { ValkeyCommandClient } from '@/realtime/valkey-resp-client';

type AttemptState = {
  count: number;
  windowStart: number;
  lockedUntil?: number;
};

const attempts = new Map<string, AttemptState>();

export type LoginThrottleResult =
  | { status: 'available'; locked: boolean; retryAfter?: number }
  | { status: 'unavailable' };

export type LoginThrottleCommandClient = {
  command(parts: Array<string | number>): Promise<string | number | null | unknown[]>;
  close(): Promise<void>;
};

export type LoginThrottleStore = {
  isLocked(key: string, lockoutWindowMs: number): Promise<LoginThrottleResult>;
  recordFailure(key: string, maxAttempts: number, lockoutWindowMs: number): Promise<LoginThrottleResult>;
  reset(key: string): Promise<LoginThrottleResult>;
  close(): Promise<void>;
};

const THROTTLE_KEY_VERSION = 'login-throttle:v1';

function parseLockResult(value: string | number | null | unknown[]): LoginThrottleResult {
  if (!Array.isArray(value) || value.length < 2) return { status: 'unavailable' };
  const locked = Number(value[0]);
  const retryAfter = Number(value[1]);
  if (!Number.isFinite(locked) || !Number.isFinite(retryAfter)) return { status: 'unavailable' };
  return locked > 0
    ? { status: 'available', locked: true, retryAfter: Math.max(1, Math.ceil(retryAfter)) }
    : { status: 'available', locked: false };
}

export function buildLoginThrottleKey(namespace: string, emailAndIp: string) {
  const digest = createHash('sha256').update(emailAndIp).digest('hex');
  return `${namespace}:${THROTTLE_KEY_VERSION}:${digest}`;
}

class InMemoryLoginThrottleStore implements LoginThrottleStore {
  async isLocked(key: string, lockoutWindowMs: number): Promise<LoginThrottleResult> {
    return { status: 'available', ...isLockedOut(key, lockoutWindowMs) };
  }

  async recordFailure(key: string, maxAttempts: number, lockoutWindowMs: number): Promise<LoginThrottleResult> {
    return { status: 'available', ...recordFailedAttempt(key, maxAttempts, lockoutWindowMs) };
  }

  async reset(key: string): Promise<LoginThrottleResult> {
    resetAttempts(key);
    return { status: 'available', locked: false };
  }

  async close() {
    _clearAllAttemptsForTests();
  }
}

const CHECK_LOCK_SCRIPT = `
local locked_until = tonumber(redis.call('HGET', KEYS[1], 'locked_until') or '0')
local now = tonumber(ARGV[1])
if locked_until > now then
  return {1, math.ceil((locked_until - now) / 1000)}
end
if locked_until > 0 then redis.call('DEL', KEYS[1]) end
return {0, 0}
`;

const RECORD_FAILURE_SCRIPT = `
local now = tonumber(ARGV[1])
local max_attempts = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local locked_until = tonumber(redis.call('HGET', KEYS[1], 'locked_until') or '0')
if locked_until > now then
  return {1, math.ceil((locked_until - now) / 1000)}
end
local window_started_at = tonumber(redis.call('HGET', KEYS[1], 'window_started_at') or '0')
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts') or '0')
if window_started_at == 0 or now - window_started_at >= window_ms then
  window_started_at = now
  attempts = 0
end
attempts = attempts + 1
if attempts >= max_attempts then
  locked_until = now + window_ms
  redis.call('HSET', KEYS[1], 'attempts', attempts, 'window_started_at', window_started_at, 'locked_until', locked_until)
  redis.call('PEXPIRE', KEYS[1], window_ms)
  return {1, math.ceil(window_ms / 1000)}
end
local remaining_ms = math.max(1, window_ms - (now - window_started_at))
redis.call('HSET', KEYS[1], 'attempts', attempts, 'window_started_at', window_started_at, 'locked_until', 0)
redis.call('PEXPIRE', KEYS[1], remaining_ms)
return {0, 0}
`;

export class ValkeyLoginThrottleStore implements LoginThrottleStore {
  private readonly client: LoginThrottleCommandClient;

  constructor(
    private readonly options: {
      url?: string;
      namespace: string;
      tlsEnabled: boolean;
      caCertPath?: string;
      commandTimeoutMs: number;
      client?: LoginThrottleCommandClient;
    }
  ) {
    this.client = options.client ?? new ValkeyCommandClient({
      url: options.url,
      tlsEnabled: options.tlsEnabled,
      caCertPath: options.caCertPath,
      commandTimeoutMs: options.commandTimeoutMs,
    });
  }

  async isLocked(key: string): Promise<LoginThrottleResult> {
    if (!this.options.url) return { status: 'unavailable' };
    try {
      return parseLockResult(await this.client.command(['EVAL', CHECK_LOCK_SCRIPT, 1, this.storageKey(key), Date.now()]));
    } catch {
      return { status: 'unavailable' };
    }
  }

  async recordFailure(key: string, maxAttempts: number, lockoutWindowMs: number): Promise<LoginThrottleResult> {
    if (!this.options.url) return { status: 'unavailable' };
    try {
      return parseLockResult(
        await this.client.command([
          'EVAL',
          RECORD_FAILURE_SCRIPT,
          1,
          this.storageKey(key),
          Date.now(),
          maxAttempts,
          lockoutWindowMs,
        ])
      );
    } catch {
      return { status: 'unavailable' };
    }
  }

  async reset(key: string): Promise<LoginThrottleResult> {
    if (!this.options.url) return { status: 'unavailable' };
    try {
      await this.client.command(['DEL', this.storageKey(key)]);
      return { status: 'available', locked: false };
    } catch {
      return { status: 'unavailable' };
    }
  }

  async close() {
    await this.client.close();
  }

  private storageKey(key: string) {
    return buildLoginThrottleKey(this.options.namespace, key);
  }
}

let defaultLoginThrottleStore: LoginThrottleStore | null = null;

export function createLoginThrottleStore(options: {
  provider: 'memory' | 'valkey';
  url?: string;
  namespace: string;
  tlsEnabled: boolean;
  caCertPath?: string;
  commandTimeoutMs: number;
  client?: LoginThrottleCommandClient;
}): LoginThrottleStore {
  if (options.provider === 'valkey') {
    return new ValkeyLoginThrottleStore(options);
  }
  return new InMemoryLoginThrottleStore();
}

export function getLoginThrottleStore() {
  if (!defaultLoginThrottleStore) {
    defaultLoginThrottleStore = createLoginThrottleStore({
      provider: config.LOGIN_THROTTLE_PROVIDER,
      url: config.VALKEY_URL,
      namespace: config.VALKEY_NAMESPACE,
      tlsEnabled: config.VALKEY_TLS_ENABLED,
      caCertPath: config.VALKEY_CA_CERT_PATH,
      commandTimeoutMs: config.REALTIME_VALKEY_PUBLISH_TIMEOUT_MS,
    });
  }
  return defaultLoginThrottleStore;
}

export async function resetLoginThrottleStoreForTests() {
  await defaultLoginThrottleStore?.close();
  defaultLoginThrottleStore = null;
}

export function isLockedOut(key: string, _lockoutWindowMs: number): { locked: boolean; retryAfter?: number } {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state?.lockedUntil) return { locked: false };

  if (state.lockedUntil > now) {
    return { locked: true, retryAfter: Math.ceil((state.lockedUntil - now) / 1000) };
  }

  // Lock expired, reset
  attempts.delete(key);
  return { locked: false };
}

export function recordFailedAttempt(
  key: string,
  maxAttempts: number,
  lockoutWindowMs: number
): { locked: boolean; retryAfter?: number } {
  const now = Date.now();
  const state = attempts.get(key);

  if (!state) {
    const next: AttemptState = { count: 1, windowStart: now };
    attempts.set(key, next);
    return { locked: false };
  }

  // Reset window if stale
  if (now - state.windowStart > lockoutWindowMs) {
    state.count = 1;
    state.windowStart = now;
    delete state.lockedUntil;
    attempts.set(key, state);
    return { locked: false };
  }

  state.count += 1;
  if (state.count >= maxAttempts) {
    state.lockedUntil = now + lockoutWindowMs;
    attempts.set(key, state);
    return { locked: true, retryAfter: Math.ceil(lockoutWindowMs / 1000) };
  }

  attempts.set(key, state);
  return { locked: false };
}

export function resetAttempts(key: string): void {
  attempts.delete(key);
}

export function _clearAllAttemptsForTests() {
  attempts.clear();
}
