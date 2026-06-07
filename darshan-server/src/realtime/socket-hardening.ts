import { z, type ZodType } from 'zod';
import { Socket } from 'socket.io';
import { config } from '@/config';
import { recordRealtimeSocketReject } from '@/observability/metrics';
import { createLogger } from '@/utils/logger';

const logger = createLogger('realtime-socket-hardening');

type RealtimeNamespace = '/device' | '/screens' | '/chat' | '/notifications';
type RealtimeRejectReason = 'invalid_payload' | 'payload_too_large' | 'rate_limited';

type RateLimitBucket = {
  tokens: number;
  lastRefillMs: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export class SocketEventRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {}

  consume(key: string): RateLimitDecision {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefillMs: now,
    };
    const elapsedSeconds = Math.max((now - bucket.lastRefillMs) / 1000, 0);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.lastRefillMs = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / this.refillPerSecond)),
      };
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return { allowed: true };
  }

  clear(key: string): void {
    this.buckets.delete(key);
  }
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'invalid_payload' | 'payload_too_large' };

export type SocketAck = (result: unknown) => void;

const uuidSchema = z.string().uuid();
const shortStringSchema = z.string().trim().min(1).max(128);

export const deviceHelloPayloadSchema = z.object({
  type: z.literal('HELLO').optional(),
  protocol_version: z.string().trim().min(1).max(32).optional(),
  device_id: uuidSchema.optional(),
  session_id: shortStringSchema.optional(),
  app: z
    .object({
      version: z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
  platform: z
    .object({
      family: z.string().trim().min(1).max(64).optional(),
    })
    .optional(),
});

export const devicePingPayloadSchema = z
  .object({
    type: z.literal('PING').optional(),
    client_time: z.string().datetime().optional(),
    sent_at: z.string().datetime().optional(),
    nonce: shortStringSchema.optional(),
    seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .optional()
  .nullable();

export const screensSubscribePayloadSchema = z.object({
  screenIds: z.array(uuidSchema).max(500).optional(),
  includeAll: z.boolean().optional(),
});

export const screensSyncPayloadSchema = z
  .object({
    screenIds: z.array(uuidSchema).max(500).optional(),
  })
  .optional()
  .nullable();

export const chatSubscribePayloadSchema = z.object({
  conversationIds: z.array(uuidSchema).max(200).optional(),
});

export const chatTypingPayloadSchema = z.object({
  conversationId: uuidSchema,
  isTyping: z.boolean(),
});

export const chatReadPayloadSchema = z.object({
  conversationId: uuidSchema,
  lastReadSeq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const notificationsSyncPayloadSchema = z
  .union([z.undefined(), z.null(), z.object({}).strict()])
  .optional();

export function normalizePayloadAndAck(payloadOrAck: unknown, maybeAck?: SocketAck) {
  if (typeof payloadOrAck === 'function') {
    return { payload: undefined, ack: payloadOrAck as SocketAck };
  }
  return {
    payload: payloadOrAck,
    ack: typeof maybeAck === 'function' ? maybeAck : undefined,
  };
}

export function buildSafeSocketError(
  code: 'INVALID_PAYLOAD' | 'PAYLOAD_TOO_LARGE' | 'RATE_LIMITED',
  message: string,
  retryAfterSeconds?: number
) {
  return {
    server_time: new Date().toISOString(),
    error: {
      code,
      message,
      ...(retryAfterSeconds ? { retry_after_seconds: retryAfterSeconds } : {}),
    },
  };
}

export function buildDeviceSocketError(
  code: string,
  message: string,
  retryable: boolean,
  retryAfterSeconds?: number
) {
  return {
    type: 'ERROR',
    code,
    message,
    retryable,
    server_time: new Date().toISOString(),
    ...(retryAfterSeconds ? { retry_after_seconds: retryAfterSeconds } : {}),
  };
}

export function validateSocketPayload<T>(input: {
  socket: Socket;
  namespace: RealtimeNamespace;
  event: string;
  payload: unknown;
  schema: ZodType<T>;
}): ValidationResult<T> {
  const size = socketPayloadSizeBytes(input.payload);
  if (size > config.WS_NOTIFICATION_MAX_BYTES) {
    logRealtimeReject(input.socket, input.namespace, input.event, 'payload_too_large', {
      payload_bytes: size,
      max_bytes: config.WS_NOTIFICATION_MAX_BYTES,
    });
    return { ok: false, reason: 'payload_too_large' };
  }

  const parsed = input.schema.safeParse(input.payload);
  if (!parsed.success) {
    logRealtimeReject(input.socket, input.namespace, input.event, 'invalid_payload', {
      payload_type: summarizePayloadType(input.payload),
      issue_count: parsed.error.issues.length,
      issue_paths: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')),
    });
    return { ok: false, reason: 'invalid_payload' };
  }

  return { ok: true, data: parsed.data };
}

export function consumeSocketRateLimit(input: {
  socket: Socket;
  namespace: RealtimeNamespace;
  event: string;
  limiter: SocketEventRateLimiter;
}): RateLimitDecision {
  const decision = input.limiter.consume(input.socket.id);
  if (!decision.allowed) {
    logRealtimeReject(input.socket, input.namespace, input.event, 'rate_limited', {
      retry_after_seconds: decision.retryAfterSeconds ?? 1,
    });
  }
  return decision;
}

function socketPayloadSizeBytes(payload: unknown) {
  if (payload === undefined) return 0;
  try {
    const json = JSON.stringify(payload);
    return Buffer.byteLength(json ?? '', 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function summarizePayloadType(payload: unknown) {
  if (payload === null) return 'null';
  if (Array.isArray(payload)) return 'array';
  return typeof payload;
}

function logRealtimeReject(
  socket: Socket,
  namespace: RealtimeNamespace,
  event: string,
  reason: RealtimeRejectReason,
  details: Record<string, unknown> = {}
) {
  recordRealtimeSocketReject(namespace, event, reason);
  logger.warn(
    {
      namespace,
      event,
      reason,
      socket_id: socket.id,
      ...details,
    },
    'Realtime socket event rejected'
  );
}
