import { z } from 'zod';
import { statSync } from 'node:fs';
import 'dotenv/config';
import {
  assertProductionFileBackedSecrets,
  buildBackendRuntimeEnv,
  buildRedactedRuntimeConfigSummary,
  requiredProductionFileBackedSecretKeys,
  requiredProductionWorkerFileBackedSecretKeys,
} from './file-config';
import { parseOffHostBackupLocation } from '@/utils/off-host-backup-location';
import {
  BACKUP_REPOSITORY_KINDS,
  assertDailyBackupTime,
  assertIanaTimeZone,
  createBackupRepositoryPolicy,
} from '@/backups/policy';

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalBooleanString = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return value;
}, z.boolean().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().default(3000),
  DEVICE_PORT: z.coerce.number().default(8443),
  DATABASE_URL: z.string().url(),
  DATABASE_TLS_ENABLED: optionalBooleanString,
  DATABASE_CA_CERT_PATH: optionalTrimmedString,
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.coerce.number().default(900),
  AUTH_COOKIE_SECURE: optionalBooleanString,
  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  MINIO_REGION: z.string().default('us-east-1'),
  // Recipient-facing, path-style S3 endpoint used for browser and player
  // transfers. It is normally the CMS HTTPS origin fronting MinIO through
  // Nginx; service-to-service storage operations still use MINIO_ENDPOINT.
  MINIO_PUBLIC_ENDPOINT: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().url().optional()),
  // Initial administrator credentials are consumed only by the one-shot
  // production bootstrap command. API and worker processes must be able to
  // run without receiving an administrator password in their environment.
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  SERVER_TLS_ENABLED: optionalBooleanString,
  TLS_CERT_PATH: z.string().default('./certs/server.crt'),
  TLS_KEY_PATH: z.string().default('./certs/server.key'),
  CA_CERT_PATH: z.string().default('./certs/ca.crt'),
  CA_KEY_PATH: z.string().default('./certs/ca.key'),
  DEVICE_AUTH_MODE: z.enum(['legacy', 'dual', 'signature']).default('legacy'),
  DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT: optionalTrimmedString,
  DEVICE_AUTH_SIGNATURE_MAX_SKEW_SECONDS: z.coerce.number().int().positive().default(300),
  DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: optionalBooleanString,
  DEVICE_SOCKET_SIGNED_AUTH_ENABLED: optionalBooleanString,
  DEVICE_SOCKET_AUTH_MAX_CLOCK_SKEW_MS: z.coerce.number().int().positive().default(300_000),
  DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED: optionalBooleanString,
  DEVICE_SOCKET_AUTH_REPLAY_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
  DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED: optionalBooleanString,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  LIBREOFFICE_PATH: z.string().default('soffice'),
  PG_DUMP_PATH: z.string().default('pg_dump'),
  TAR_PATH: z.string().default('tar'),
  AGE_PATH: z.string().trim().min(1).default('age'),
  AGE_VERSION: optionalTrimmedString,
  AGE_SHA256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  BACKUP_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).optional(),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
  BACKUP_REPOSITORY_KIND: z.enum(BACKUP_REPOSITORY_KINDS).optional(),
  BACKUP_REPOSITORY_ROOT: optionalTrimmedString,
  BACKUP_REPOSITORY_DEVICE_ID: z.string().trim().regex(/^\d+$/).optional(),
  BACKUP_REPOSITORY_OWNER_UID: z.coerce.number().int().nonnegative().optional(),
  BACKUP_REPOSITORY_OWNER_GID: z.coerce.number().int().nonnegative().optional(),
  BACKUP_REPOSITORY_MIN_FREE_BYTES: z.coerce.number().int().positive().optional(),
  BACKUP_REPOSITORY_ID: z.string().uuid().optional(),
  BACKUP_ENCRYPTION_RECIPIENT: z.string().trim()
    .regex(/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/, 'must be a canonical native age X25519 recipient')
    .optional(),
  BACKUP_ENCRYPTION_KEY_ID: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
  BACKUP_CAPSULE_HELPER_PATH: optionalTrimmedString,
  BACKUP_CAPSULE_HELPER_VERSION: optionalTrimmedString,
  BACKUP_CAPSULE_HELPER_SHA256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  BACKUP_LOCAL_PROTOCOL: z.enum(['V1_HELPER', 'V2_BROKER']).optional(),
  BACKUP_BROKER_SOCKET_PATH: optionalTrimmedString,
  BACKUP_BROKER_HELPER_VERSION: optionalTrimmedString,
  BACKUP_BROKER_POLICY_SHA256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  BACKUP_MANIFEST_PUBLIC_KEYRING_PATH: optionalTrimmedString,
  BACKUP_POLICY_PUBLIC_KEYRING_PATH: optionalTrimmedString,
  BACKUP_WORKER_SPOOL_ROOT: optionalTrimmedString,
  BACKUP_WORKER_SPOOL_DEVICE_ID: z.string().trim().regex(/^\d+$/).optional(),
  BACKUP_WORKER_SPOOL_OWNER_UID: z.coerce.number().int().nonnegative().optional(),
  BACKUP_WORKER_SPOOL_OWNER_GID: z.coerce.number().int().nonnegative().optional(),
  BACKUP_CAPSULE_GENERATION: optionalTrimmedString,
  BACKUP_CAPSULE_SHA256: z.string().trim().regex(/^[a-f0-9]{64}$/i).optional(),
  BACKUP_SITE_ID: optionalTrimmedString,
  BACKUP_SCHEDULE_TIME: optionalTrimmedString,
  BACKUP_SCHEDULE_TIMEZONE: optionalTrimmedString,
  BACKUP_OFFHOST_DESTINATION: optionalTrimmedString,
  BACKUP_OFFHOST_ENDPOINT: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().url().optional()),
  BACKUP_OFFHOST_REGION: optionalTrimmedString,
  BACKUP_OFFHOST_ACCESS_KEY: optionalTrimmedString,
  BACKUP_OFFHOST_SECRET_KEY: optionalTrimmedString,
  DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH: optionalTrimmedString,
  HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH: optionalTrimmedString,
  WEBPAGE_NAVIGATION_ALLOWLIST: z.string().default(''),
  WEBPAGE_RESOURCE_ALLOWLIST: z.string().default(''),
  WEBPAGE_ALLOWED_CIDRS: z.string().default(''),
  WEBPAGE_ALLOWED_PORTS: z.string().default('443'),
  WEBPAGE_ALLOW_HTTP: optionalBooleanString,
  WEBPAGE_PREVIEW_REFRESH_INTERVAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  WEBPAGE_PREVIEW_REFRESH_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  PG_BOSS_SCHEMA: z.string().default('pgboss'),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_TIME_WINDOW: z.string().default('1 minute'),
  CORS_ORIGINS: z.string().default(''),
  SOCKET_ALLOWED_ORIGINS: z.string().default(''),
  APP_PUBLIC_BASE_URL: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().url().optional()),
  SIGNHEX_DEPLOYMENT_ID: z.string().trim().min(1).default('local'),
  SIGNHEX_ENVIRONMENT_NAME: z.string().trim().min(1).default('development'),
  SIGNHEX_SERVER_ID: z.string().trim().min(1).default('darshan-api'),
  DARSHAN_RELEASE_ID: z.string().trim().min(1).default('development'),
  DARSHAN_SOURCE_COMMIT: z.string().trim().regex(/^(?:development|[a-f0-9]{40})$/i).default('development'),
  DARSHAN_COMPATIBILITY_GENERATION: z.coerce.number().int().positive().default(1),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  WORKER_HEARTBEAT_STALE_MS: z.coerce.number().int().min(5_000).max(900_000).default(60_000),
  DUPLICATE_IDENTITY_DETECTION_ENABLED: optionalBooleanString,
  DUPLICATE_IDENTITY_ENFORCEMENT: z.enum(['warn', 'block']).default('warn'),
  DEVICE_SESSION_LEASE_MS: z.coerce.number().int().positive().default(300_000),
  DEVICE_SESSION_RESTART_GRACE_MS: z.coerce.number().int().positive().default(120_000),
  CSRF_ENABLED: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('true'),
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
  LOGIN_LOCKOUT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),
  LOGIN_THROTTLE_PROVIDER: z.enum(['memory', 'valkey']).optional(),
  LOGIN_THROTTLE_FAIL_CLOSED: optionalBooleanString,
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(500),
  STORAGE_QUOTA_BYTES: z.coerce.number().int().nonnegative().default(0),
  ENABLE_SWAGGER_UI: optionalBooleanString,
  OBSERVABILITY_METRICS_ENABLED: optionalBooleanString,
  OBSERVABILITY_METRICS_BEARER_TOKEN: optionalTrimmedString,
  OBSERVABILITY_DEPLOYMENT_MODE: z.enum(['development', 'qa', 'production']).optional(),
  OBSERVABILITY_PROMETHEUS_BASE_URL: z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, z.string().url().optional()),
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
});

export function resolveValkeyUrl(input: {
  VALKEY_URL?: string;
  REDIS_URL?: string;
  REDIS_URL_ALIAS_FOR_VALKEY?: boolean;
}) {
  return input.VALKEY_URL ?? (input.REDIS_URL_ALIAS_FOR_VALKEY ? input.REDIS_URL : undefined);
}

const runtimeEnv = buildBackendRuntimeEnv(process.env);
const parsed = envSchema.safeParse(runtimeEnv.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten());
  throw new Error('Invalid environment variables');
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is forbidden in production. Use the one-shot protected bootstrap password file instead.');
}
if (parsed.data.NODE_ENV === 'production') {
  assertProductionFileBackedSecrets(
    process.env,
    isBackgroundWorkerProcess() && parsed.data.BACKUP_REPOSITORY_KIND === 'LEGACY_OFF_HOST'
      ? requiredProductionWorkerFileBackedSecretKeys
      : requiredProductionFileBackedSecretKeys
  );
  if (parsed.data.OBSERVABILITY_METRICS_BEARER_TOKEN) {
    assertProductionFileBackedSecrets(process.env, ['OBSERVABILITY_METRICS_BEARER_TOKEN']);
  }
}

const loginThrottleProvider = parsed.data.LOGIN_THROTTLE_PROVIDER ??
  (parsed.data.NODE_ENV === 'production' ? 'valkey' : 'memory');
if (parsed.data.NODE_ENV === 'production') {
  if (loginThrottleProvider !== 'valkey') {
    throw new Error('Production login throttling must use Valkey; memory throttling is forbidden.');
  }
  if (!resolveValkeyUrl(parsed.data)) {
    throw new Error('Production login throttling requires VALKEY_URL.');
  }
}

function assertProductionStateServiceTransport(input: z.infer<typeof envSchema>) {
  if (input.NODE_ENV !== 'production') return;

  if (input.DATABASE_TLS_ENABLED !== true) {
    throw new Error('Production requires DATABASE_TLS_ENABLED=true.');
  }
  if (!isReadableRegularFile(input.DATABASE_CA_CERT_PATH)) {
    throw new Error('Production requires a readable DATABASE_CA_CERT_PATH.');
  }

  const valkeyUrl = resolveValkeyUrl(input);
  if (!valkeyUrl) return;
  const endpoint = new URL(valkeyUrl);
  if (endpoint.protocol !== 'rediss:' && endpoint.protocol !== 'valkeys:') {
    throw new Error('Production VALKEY_URL must use the encrypted rediss:// or valkeys:// scheme.');
  }
  if (input.VALKEY_TLS_ENABLED !== true) {
    throw new Error('Production requires VALKEY_TLS_ENABLED=true.');
  }
  if (input.VALKEY_AUTH_REQUIRED !== true) {
    throw new Error('Production requires VALKEY_AUTH_REQUIRED=true.');
  }
  if (!endpoint.password) {
    throw new Error('Production VALKEY_URL must include an authenticated credential from VALKEY_URL_FILE.');
  }
  if (!isReadableRegularFile(input.VALKEY_CA_CERT_PATH)) {
    throw new Error('Production requires a readable VALKEY_CA_CERT_PATH.');
  }
}

function assertProductionDeviceAuthPolicy(input: z.infer<typeof envSchema>, sourceEnv: NodeJS.ProcessEnv = process.env) {
  if (input.NODE_ENV !== 'production') return;

  const requested = requestedProductionDeviceAuthMode(input, sourceEnv);
  if (requested === 'signature' && input.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED === true) {
    throw new Error('Production signature-only device authentication forbids DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true.');
  }
  if (requested === 'legacy') {
    throw new Error('Production legacy device authentication is forbidden. Use dual with an expiry or signature.');
  }
  if (requested !== 'dual' && requested !== 'signature') {
    throw new Error('Production DEVICE_AUTH_MODE must be dual or signature.');
  }
  if (requested === 'dual') {
    const expiresAt = input.DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT;
    if (!expiresAt || Number.isNaN(new Date(expiresAt).getTime())) {
      throw new Error('Production dual device authentication requires DEVICE_AUTH_LEGACY_COMPATIBILITY_EXPIRES_AT as an ISO-8601 timestamp.');
    }
  }
}

function requestedProductionDeviceAuthMode(input: z.infer<typeof envSchema>, sourceEnv: NodeJS.ProcessEnv = process.env) {
  return (
    sourceEnv.DARSHAN_DEVICE_AUTH_MODE?.trim().toLowerCase() ||
    sourceEnv.HEXMON_DEVICE_AUTH_MODE?.trim().toLowerCase() ||
    input.DEVICE_AUTH_MODE
  );
}

function assertProductionBackupPolicy(input: z.infer<typeof envSchema>, sourceEnv: NodeJS.ProcessEnv = process.env, backgroundWorker = isBackgroundWorkerProcess()) {
  if (input.NODE_ENV !== 'production') return;
  if (!input.BACKUP_RETENTION_DAYS || !input.BACKUP_REPOSITORY_KIND || !input.BACKUP_SITE_ID ||
      !input.BACKUP_SCHEDULE_TIME || !input.BACKUP_SCHEDULE_TIMEZONE) {
    throw new Error(
      'Production requires BACKUP_RETENTION_DAYS, BACKUP_REPOSITORY_KIND, BACKUP_SITE_ID, BACKUP_SCHEDULE_TIME, and BACKUP_SCHEDULE_TIMEZONE.'
    );
  }
  if (input.BACKUP_RETENTION_DAYS < 30) {
    throw new Error('Production BACKUP_RETENTION_DAYS must be at least 30.');
  }
  assertDailyBackupTime(input.BACKUP_SCHEDULE_TIME);
  assertIanaTimeZone(input.BACKUP_SCHEDULE_TIMEZONE);
  createBackupRepositoryPolicy({
    kind: input.BACKUP_REPOSITORY_KIND,
    siteId: input.BACKUP_SITE_ID,
    root: input.BACKUP_REPOSITORY_ROOT,
  });

  if (input.BACKUP_REPOSITORY_KIND === 'LOCAL_FILESYSTEM') {
    for (const name of [
      'AGE_IDENTITY',
      'AGE_IDENTITY_FILE',
      'BACKUP_ENCRYPTION_IDENTITY',
      'BACKUP_ENCRYPTION_IDENTITY_FILE',
    ]) {
      if (sourceEnv[name]?.trim()) {
        throw new Error(`Production LOCAL_FILESYSTEM forbids private age identity field ${name}; workers receive only a public recipient.`);
      }
    }
    if (!input.BACKUP_REPOSITORY_DEVICE_ID || input.BACKUP_REPOSITORY_OWNER_UID === undefined ||
        input.BACKUP_REPOSITORY_OWNER_GID === undefined || !input.BACKUP_REPOSITORY_MIN_FREE_BYTES) {
      throw new Error('LOCAL_FILESYSTEM production backups require device identity, owner uid/gid, and minimum free bytes.');
    }
    if (backgroundWorker) {
      if (!input.BACKUP_REPOSITORY_ID || !input.BACKUP_ENCRYPTION_RECIPIENT || !input.BACKUP_ENCRYPTION_KEY_ID) {
        throw new Error('LOCAL_FILESYSTEM production worker requires repository id, public encryption recipient, and encryption key id.');
      }
      if (!input.AGE_PATH.startsWith('/') || !input.AGE_VERSION || !input.AGE_SHA256) {
        throw new Error('LOCAL_FILESYSTEM production worker requires an absolute AGE_PATH plus pinned AGE_VERSION and AGE_SHA256 metadata.');
      }
      if (!input.BACKUP_LOCAL_PROTOCOL) {
        throw new Error('LOCAL_FILESYSTEM production worker requires an explicit BACKUP_LOCAL_PROTOCOL; protocol fallback is forbidden.');
      }
      if (input.BACKUP_LOCAL_PROTOCOL === 'V1_HELPER' &&
          (!input.BACKUP_CAPSULE_HELPER_PATH?.startsWith('/') || !input.BACKUP_CAPSULE_HELPER_VERSION || !input.BACKUP_CAPSULE_HELPER_SHA256)) {
        throw new Error('V1_HELPER production worker requires the absolute combined backup host-helper path plus pinned version and SHA-256 metadata.');
      }
      if (input.BACKUP_LOCAL_PROTOCOL === 'V2_BROKER') {
        if (!input.BACKUP_BROKER_SOCKET_PATH?.startsWith('/') || !input.BACKUP_BROKER_HELPER_VERSION || !input.BACKUP_BROKER_POLICY_SHA256 ||
            !input.BACKUP_MANIFEST_PUBLIC_KEYRING_PATH?.startsWith('/') || !input.BACKUP_WORKER_SPOOL_ROOT?.startsWith('/') ||
            !input.BACKUP_WORKER_SPOOL_DEVICE_ID || input.BACKUP_WORKER_SPOOL_OWNER_UID === undefined || input.BACKUP_WORKER_SPOOL_OWNER_GID === undefined ||
            !input.BACKUP_CAPSULE_GENERATION || !input.BACKUP_CAPSULE_SHA256) {
          throw new Error('V2_BROKER production worker requires pinned broker, public keyring, capsule, and owned worker-spool policy.');
        }
      }
    }
    return;
  }

  if (!input.BACKUP_INTERVAL_HOURS || !input.BACKUP_OFFHOST_DESTINATION ||
      !input.BACKUP_OFFHOST_ENDPOINT || !input.BACKUP_OFFHOST_REGION) {
    throw new Error('LEGACY_OFF_HOST requires the legacy interval, destination, endpoint, and region settings.');
  }
  if (backgroundWorker && (!input.BACKUP_OFFHOST_ACCESS_KEY || !input.BACKUP_OFFHOST_SECRET_KEY)) {
    throw new Error('LEGACY_OFF_HOST production worker requires file-backed off-host S3 credentials.');
  }

  const endpoint = new URL(input.BACKUP_OFFHOST_ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Production BACKUP_OFFHOST_ENDPOINT must be a credential-free HTTPS URL.');
  }
  if (['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname.toLowerCase()) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(endpoint.hostname)) {
    throw new Error('Production BACKUP_OFFHOST_ENDPOINT must not point to localhost or an IP address.');
  }
  parseOffHostBackupLocation(input.BACKUP_OFFHOST_DESTINATION);
}

/** Pure entry point used by fixed deployment tooling to exercise the same production schema and policies as module startup. */
export function validateBackendProductionEnvironment(sourceEnv: NodeJS.ProcessEnv, options: { backgroundWorker: boolean }) {
  const runtime = buildBackendRuntimeEnv(sourceEnv); const result = envSchema.safeParse(runtime.env);
  if (!result.success) throw new Error(`Invalid environment variables: ${JSON.stringify(result.error.flatten().fieldErrors)}`);
  if (result.data.NODE_ENV !== 'production') throw new Error('D3 backend validation requires NODE_ENV=production.');
  if (result.data.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD is forbidden in production.');
  assertProductionFileBackedSecrets(sourceEnv, requiredProductionFileBackedSecretKeys);
  if ((result.data.LOGIN_THROTTLE_PROVIDER ?? 'valkey') !== 'valkey' || !resolveValkeyUrl(result.data)) throw new Error('Production login throttling requires Valkey.');
  assertProductionStateServiceTransport(result.data); assertProductionDeviceAuthPolicy(result.data, sourceEnv);
  assertProductionBackupPolicy(result.data, sourceEnv, options.backgroundWorker);
  return { env: result.data, diagnostics: runtime.diagnostics };
}

function isBackgroundWorkerProcess() {
  return process.env.DARSHAN_PROCESS_ROLE === 'worker' || process.env.HEXMON_PROCESS_ROLE === 'worker' || process.argv.includes('--role=worker');
}

function isReadableRegularFile(filePath: string | undefined) {
  if (!filePath) return false;
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

assertProductionStateServiceTransport(parsed.data);
assertProductionDeviceAuthPolicy(parsed.data);
assertProductionBackupPolicy(parsed.data);

const defaultDeviceSocketLegacyAuthAllowed = parsed.data.NODE_ENV === 'production'
  ? requestedProductionDeviceAuthMode(parsed.data) === 'dual'
  : true;

export const config = Object.freeze({
  ...parsed.data,
  DATABASE_TLS_ENABLED: parsed.data.DATABASE_TLS_ENABLED ?? false,
  SERVER_TLS_ENABLED: parsed.data.SERVER_TLS_ENABLED ?? false,
  AUTH_COOKIE_SECURE: parsed.data.AUTH_COOKIE_SECURE ?? parsed.data.NODE_ENV !== 'development',
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
    parsed.data.DARSHAN_WEBPAGE_CAPTURE_EXECUTABLE_PATH ??
    parsed.data.HEXMON_WEBPAGE_CAPTURE_EXECUTABLE_PATH,
  VALKEY_URL: resolveValkeyUrl(parsed.data),
  LOGIN_THROTTLE_PROVIDER: loginThrottleProvider,
  LOGIN_THROTTLE_FAIL_CLOSED: parsed.data.LOGIN_THROTTLE_FAIL_CLOSED ?? parsed.data.NODE_ENV === 'production',
  VALKEY_TLS_ENABLED: parsed.data.VALKEY_TLS_ENABLED ?? false,
  VALKEY_AUTH_REQUIRED: parsed.data.VALKEY_AUTH_REQUIRED ?? Boolean(parsed.data.VALKEY_URL),
  VALKEY_PUBSUB_ENABLED:
    parsed.data.VALKEY_PUBSUB_ENABLED ?? parsed.data.REALTIME_BUS_PROVIDER === 'valkey',
  OUTBOX_DISPATCH_ENABLED: parsed.data.OUTBOX_DISPATCH_ENABLED ?? false,
  REALTIME_SYNC_ENABLED:
    parsed.data.DARSHAN_REALTIME_SYNC_ENABLED ?? parsed.data.REALTIME_SYNC_ENABLED ?? false,
  REALTIME_SOCKET_ALLOW_POLLING: parsed.data.REALTIME_SOCKET_ALLOW_POLLING ?? true,
  REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS:
    parsed.data.REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS ?? false,
  DEVICE_SOCKET_LEGACY_AUTH_ALLOWED: parsed.data.DEVICE_SOCKET_LEGACY_AUTH_ALLOWED ?? defaultDeviceSocketLegacyAuthAllowed,
  DEVICE_SOCKET_SIGNED_AUTH_ENABLED: parsed.data.DEVICE_SOCKET_SIGNED_AUTH_ENABLED ?? true,
  DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED:
    parsed.data.DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED ?? true,
  DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED: parsed.data.DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED ?? false,
  DUPLICATE_IDENTITY_DETECTION_ENABLED: parsed.data.DUPLICATE_IDENTITY_DETECTION_ENABLED ?? true,
  DARSHAN_MEDIA_CACHE_REPORTING_ENABLED: parsed.data.DARSHAN_MEDIA_CACHE_REPORTING_ENABLED ?? true,
});
export type Config = typeof config;

export function getRedactedRuntimeConfigSummary() {
  return buildRedactedRuntimeConfigSummary(config, runtimeEnv.diagnostics);
}
