import { z } from 'zod';
import 'dotenv/config'; 

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().optional()
);

const optionalBooleanString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) return undefined;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return value;
  },
  z.boolean().optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  DEVICE_PORT: z.coerce.number().default(8443),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.coerce.number().default(900),
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_USE_SSL: z.enum(['true', 'false']).transform((v) => v === 'true').default('false'),
  MINIO_REGION: z.string().default('us-east-1'),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  TLS_CERT_PATH: z.string().default('./certs/server.crt'),
  TLS_KEY_PATH: z.string().default('./certs/server.key'),
  CA_CERT_PATH: z.string().default('./certs/ca.crt'),
  CA_KEY_PATH: z.string().default('./certs/ca.key'),
  DEVICE_AUTH_MODE: z.enum(['legacy', 'dual', 'signature']).default('legacy'),
  DEVICE_AUTH_SIGNATURE_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: optionalBooleanString,
  DEVICE_SOCKET_SIGNED_AUTH_ENABLED: optionalBooleanString,
  DEVICE_SOCKET_AUTH_MAX_CLOCK_SKEW_MS: z.coerce.number().int().positive().default(300_000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  LIBREOFFICE_PATH: z.string().default('soffice'),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  TAR_PATH: z.string().default('tar'),
  DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH: optionalTrimmedString,
  HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH: optionalTrimmedString,
  PG_BOSS_SCHEMA: z.string().default('pgboss'),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_TIME_WINDOW: z.string().default('1 minute'),
  CORS_ORIGINS: z.string().default(''),
  SOCKET_ALLOWED_ORIGINS: z.string().default(''),
  APP_PUBLIC_BASE_URL: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().url().optional()
  ),
  CSRF_ENABLED: z.enum(['true', 'false']).transform((v) => v === 'true').default('true'),
  REDIS_URL: z.string().url().optional(),
  REDIS_URL_ALIAS_FOR_VALKEY: optionalBooleanString,
  REALTIME_BUS_PROVIDER: z.enum(['memory', 'valkey']).default('memory'),
  VALKEY_URL: z.string().url().optional(),
  VALKEY_MODE: z.enum(['standalone', 'sentinel', 'cluster']).default('standalone'),
  VALKEY_TLS_ENABLED: optionalBooleanString,
  VALKEY_AUTH_REQUIRED: optionalBooleanString,
  VALKEY_CA_CERT_PATH: optionalTrimmedString,
  VALKEY_NAMESPACE: z.string().default('darshan:realtime'),
  VALKEY_PUBSUB_ENABLED: optionalBooleanString,
  REALTIME_NODE_ID: optionalTrimmedString,
  REALTIME_DEVICE_NODE_TTL_MS: z.coerce.number().int().positive().default(120_000),
  REALTIME_VALKEY_RECONNECT_MIN_MS: z.coerce.number().int().positive().default(500),
  REALTIME_VALKEY_RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30_000),
  REALTIME_VALKEY_PUBLISH_TIMEOUT_MS: z.coerce.number().int().positive().default(1_000),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_WINDOW_SECONDS: z.coerce.number().int().positive().default(15 * 60),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(200),
  STORAGE_QUOTA_BYTES: z.coerce.number().int().nonnegative().default(0),
  ENABLE_SWAGGER_UI: optionalBooleanString,
  OBSERVABILITY_METRICS_ENABLED: optionalBooleanString,
  OBSERVABILITY_METRICS_BEARER_TOKEN: optionalTrimmedString,
  OBSERVABILITY_DEPLOYMENT_MODE: z.enum(['development', 'qa', 'production']).optional(),
  OBSERVABILITY_PROMETHEUS_BASE_URL: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().url().optional()
  ),
  OBSERVABILITY_PROMETHEUS_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
  OBSERVABILITY_GRAFANA_ENABLED: optionalBooleanString,
  OBSERVABILITY_GRAFANA_EMBED_ENABLED: optionalBooleanString,
  OBSERVABILITY_GRAFANA_BASE_PATH: z.string().default('/grafana'),
  COMMAND_LEASE_MS: z.coerce.number().int().positive().default(60_000),
  COMMAND_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  COMMAND_DEFAULT_EXPIRES_MS: z.coerce.number().int().positive().default(86_400_000),
  COMMAND_EMERGENCY_EXPIRES_MS: z.coerce.number().int().positive().default(300_000),
  COMMAND_OUTBOX_WRITE_ENABLED: optionalBooleanString,
  DEVICE_DESIRED_STATE_ENABLED: optionalBooleanString,
  DARSHAN_REALTIME_SYNC_ENABLED: optionalBooleanString,
  REALTIME_SYNC_ENABLED: optionalBooleanString,
  REALTIME_DEVICE_NAMESPACE: z.string().default('/device'),
  REALTIME_WS_PATH: z.string().default('/socket.io/'),
  REALTIME_WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(25_000),
  REALTIME_WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(75_000),
  REALTIME_SOCKET_TRANSPORT: z.enum(['websocket', 'polling']).default('websocket'),
  REALTIME_SOCKET_ALLOW_POLLING: optionalBooleanString,
  REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS: optionalBooleanString,
  WS_NOTIFICATION_MAX_BYTES: z.coerce.number().int().positive().default(32_768),
  OUTBOX_DISPATCH_ENABLED: optionalBooleanString,
  OUTBOX_DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),
  OUTBOX_DISPATCH_LEASE_MS: z.coerce.number().int().positive().default(60_000),
  DARSHAN_MEDIA_CACHE_REPORTING_ENABLED: optionalBooleanString,
  MEDIA_CACHE_REPORTING_ENABLED: optionalBooleanString,
});

export function resolveValkeyUrl(input: {
  VALKEY_URL?: string;
  REDIS_URL?: string;
  REDIS_URL_ALIAS_FOR_VALKEY?: boolean;
}) {
  return input.VALKEY_URL ?? (input.REDIS_URL_ALIAS_FOR_VALKEY ? input.REDIS_URL : undefined);
}

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten());
  throw new Error('Invalid environment variables');
}

export const config = Object.freeze({
  ...parsed.data,
  ENABLE_SWAGGER_UI: parsed.data.ENABLE_SWAGGER_UI ?? parsed.data.NODE_ENV !== 'production',
  OBSERVABILITY_METRICS_ENABLED: parsed.data.OBSERVABILITY_METRICS_ENABLED ?? true,
  OBSERVABILITY_DEPLOYMENT_MODE:
    parsed.data.OBSERVABILITY_DEPLOYMENT_MODE ??
    (parsed.data.NODE_ENV === 'production' ? 'production' : 'development'),
  OBSERVABILITY_GRAFANA_ENABLED: parsed.data.OBSERVABILITY_GRAFANA_ENABLED ?? true,
  OBSERVABILITY_GRAFANA_EMBED_ENABLED: parsed.data.OBSERVABILITY_GRAFANA_EMBED_ENABLED ?? true,
  COMMAND_OUTBOX_WRITE_ENABLED: parsed.data.COMMAND_OUTBOX_WRITE_ENABLED ?? true,
  DEVICE_DESIRED_STATE_ENABLED: parsed.data.DEVICE_DESIRED_STATE_ENABLED ?? true,
  HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH:
    parsed.data.DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH ?? parsed.data.HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH,
  VALKEY_URL: resolveValkeyUrl(parsed.data),
  VALKEY_TLS_ENABLED: parsed.data.VALKEY_TLS_ENABLED ?? false,
  VALKEY_AUTH_REQUIRED: parsed.data.VALKEY_AUTH_REQUIRED ?? Boolean(parsed.data.VALKEY_URL),
  VALKEY_PUBSUB_ENABLED: parsed.data.VALKEY_PUBSUB_ENABLED ?? parsed.data.REALTIME_BUS_PROVIDER === 'valkey',
  OUTBOX_DISPATCH_ENABLED: parsed.data.OUTBOX_DISPATCH_ENABLED ?? false,
  REALTIME_SYNC_ENABLED: parsed.data.DARSHAN_REALTIME_SYNC_ENABLED ?? parsed.data.REALTIME_SYNC_ENABLED ?? false,
  REALTIME_SOCKET_ALLOW_POLLING: parsed.data.REALTIME_SOCKET_ALLOW_POLLING ?? true,
  REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS:
    parsed.data.REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS ?? false,
  DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: parsed.data.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED ?? true,
  DEVICE_SOCKET_SIGNED_AUTH_ENABLED: parsed.data.DEVICE_SOCKET_SIGNED_AUTH_ENABLED ?? true,
  MEDIA_CACHE_REPORTING_ENABLED:
    parsed.data.DARSHAN_MEDIA_CACHE_REPORTING_ENABLED ?? parsed.data.MEDIA_CACHE_REPORTING_ENABLED ?? true,
});
export type Config = typeof config;
