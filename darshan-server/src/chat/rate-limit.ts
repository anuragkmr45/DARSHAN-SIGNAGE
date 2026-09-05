import { createHash } from 'node:crypto';
import { config as appConfig } from '@/config';
import { ValkeyCommandClient } from '@/realtime/valkey-resp-client';
import { createLogger } from '@/utils/logger';

const logger = createLogger('chat-rate-limit');

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type RateLimitCommandClient = {
  command(parts: Array<string | number>): Promise<string | number | null | unknown[]>;
  close(): Promise<void>;
};

export interface RateLimiter {
  consume(key: string, tokens?: number): RateLimitDecision | Promise<RateLimitDecision>;
}

type TokenBucketState = {
  tokens: number;
  lastRefillMs: number;
};

export class InMemoryTokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, TokenBucketState>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {}

  consume(key: string, tokens = 1): RateLimitDecision {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefillMs: now,
    };

    const elapsedSeconds = Math.max((now - bucket.lastRefillMs) / 1000, 0);
    const refilled = elapsedSeconds * this.refillPerSecond;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled);
    bucket.lastRefillMs = now;

    if (bucket.tokens < tokens) {
      this.buckets.set(key, bucket);
      const missing = tokens - bucket.tokens;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(missing / this.refillPerSecond),
      };
    }

    bucket.tokens -= tokens;
    this.buckets.set(key, bucket);
    return { allowed: true };
  }
}

const TOKEN_BUCKET_SCRIPT = `
local now = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local refill_per_second = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or capacity)
local last_refill_ms = tonumber(redis.call('HGET', KEYS[1], 'last_refill_ms') or now)
local elapsed_seconds = math.max((now - last_refill_ms) / 1000, 0)
tokens = math.min(capacity, tokens + (elapsed_seconds * refill_per_second))
if tokens < requested then
  redis.call('HSET', KEYS[1], 'tokens', tokens, 'last_refill_ms', now)
  redis.call('PEXPIRE', KEYS[1], ttl_ms)
  local retry_after = 1
  if refill_per_second > 0 then
    retry_after = math.max(1, math.ceil((requested - tokens) / refill_per_second))
  end
  return {0, retry_after}
end
tokens = tokens - requested
redis.call('HSET', KEYS[1], 'tokens', tokens, 'last_refill_ms', now)
redis.call('PEXPIRE', KEYS[1], ttl_ms)
return {1, 0}
`;

function parseTokenBucketResult(value: string | number | null | unknown[]): RateLimitDecision | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const allowed = Number(value[0]);
  const retryAfter = Number(value[1]);
  if (!Number.isFinite(allowed) || !Number.isFinite(retryAfter)) return undefined;
  return allowed > 0
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfter)) };
}

export function buildChatRateLimitStorageKey(namespace: string, key: string) {
  const digest = createHash('sha256').update(key).digest('hex');
  return `${namespace}:chat-rate-limit:v1:${digest}`;
}

export class ValkeyTokenBucketRateLimiter implements RateLimiter {
  private readonly client: RateLimitCommandClient;
  private readonly fallback: InMemoryTokenBucketRateLimiter;
  private readonly ttlMs: number;

  constructor(
    private readonly options: {
      url?: string;
      namespace: string;
      tlsEnabled: boolean;
      caCertPath?: string;
      commandTimeoutMs: number;
      capacity: number;
      refillPerSecond: number;
      client?: RateLimitCommandClient;
    }
  ) {
    this.client = options.client ?? new ValkeyCommandClient({
      url: options.url,
      tlsEnabled: options.tlsEnabled,
      caCertPath: options.caCertPath,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    this.fallback = new InMemoryTokenBucketRateLimiter(options.capacity, options.refillPerSecond);
    const fullRefillSeconds = options.refillPerSecond > 0 ? Math.ceil(options.capacity / options.refillPerSecond) : 60;
    this.ttlMs = Math.max(60_000, fullRefillSeconds * 2_000);
  }

  async consume(key: string, tokens = 1): Promise<RateLimitDecision> {
    if (!this.options.url) return this.fallback.consume(key, tokens);
    try {
      const result = parseTokenBucketResult(await this.client.command([
        'EVAL',
        TOKEN_BUCKET_SCRIPT,
        1,
        buildChatRateLimitStorageKey(this.options.namespace, key),
        Date.now(),
        this.options.capacity,
        this.options.refillPerSecond,
        tokens,
        this.ttlMs,
      ]));
      if (!result) throw new Error('Unexpected Valkey token bucket response');
      return result;
    } catch (error) {
      logger.warn({ err: error }, 'Valkey chat rate limiter unavailable; using local fallback bucket');
      return this.fallback.consume(key, tokens);
    }
  }

  async close() {
    await this.client.close();
  }
}

export function createRateLimiter(options?: {
  capacity?: number;
  refillPerSecond?: number;
  client?: RateLimitCommandClient;
}): RateLimiter {
  const capacity = options?.capacity ?? 20;
  const refillPerSecond = options?.refillPerSecond ?? 1;

  if (appConfig.VALKEY_URL) {
    return new ValkeyTokenBucketRateLimiter({
      url: appConfig.VALKEY_URL,
      namespace: appConfig.VALKEY_NAMESPACE,
      tlsEnabled: appConfig.VALKEY_TLS_ENABLED,
      caCertPath: appConfig.VALKEY_CA_CERT_PATH,
      commandTimeoutMs: appConfig.REALTIME_VALKEY_PUBLISH_TIMEOUT_MS,
      capacity,
      refillPerSecond,
      client: options?.client,
    });
  }

  if (appConfig.REDIS_URL) {
    logger.warn('REDIS_URL is set but REDIS_URL_ALIAS_FOR_VALKEY is not enabled; using in-memory chat rate limiter');
  }

  return new InMemoryTokenBucketRateLimiter(capacity, refillPerSecond);
}
