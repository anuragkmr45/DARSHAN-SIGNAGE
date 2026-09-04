import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const forbiddenConfigKeyFragments = [
  'accesskey',
  'apikey',
  'bearertoken',
  'credential',
  'databaseurl',
  'jwt',
  'password',
  'privatekey',
  'redishosturl',
  'redisurl',
  'secret',
  'secretkey',
  'token',
  'valkeyurl',
];

const urlWithoutCredentials = z
  .string()
  .url()
  .refine(
    (value) => {
      const parsed = new URL(value);
      return parsed.username.length === 0 && parsed.password.length === 0;
    },
    { message: 'URL values in backend config files must not include credentials' }
  );

const backendFileConfigSchema = z
  .object({
    environment: z
      .object({
        name: z.string().trim().min(1).optional(),
        deploymentId: z.string().trim().min(1).optional(),
        serverId: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    http: z
      .object({
        appPublicBaseUrl: urlWithoutCredentials.optional(),
        corsOrigins: z.array(urlWithoutCredentials).optional(),
        socketAllowedOrigins: z.array(urlWithoutCredentials).optional(),
        socketIoPath: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    realtime: z
      .object({
        enabled: z.boolean().optional(),
        busProvider: z.enum(['memory', 'valkey']).optional(),
        socketTransport: z.enum(['websocket', 'polling']).optional(),
        socketAllowPolling: z.boolean().optional(),
        socketRequireStickySessions: z.boolean().optional(),
        deviceNamespace: z.string().trim().min(1).optional(),
        wsPingIntervalMs: z.number().int().positive().optional(),
        wsIdleTimeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    valkey: z
      .object({
        mode: z.enum(['standalone', 'sentinel', 'cluster']).optional(),
        tlsEnabled: z.boolean().optional(),
        authRequired: z.boolean().optional(),
        caCertPath: z.string().trim().min(1).optional(),
        namespace: z.string().trim().min(1).optional(),
        pubsubEnabled: z.boolean().optional(),
        deviceNodeTtlMs: z.number().int().positive().optional(),
        reconnectMinMs: z.number().int().positive().optional(),
        reconnectMaxMs: z.number().int().positive().optional(),
        publishTimeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    duplicateIdentity: z
      .object({
        enabled: z.boolean().optional(),
        enforcement: z.enum(['warn', 'block']).optional(),
        sessionLeaseMs: z.number().int().positive().optional(),
        restartGraceMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    security: z
      .object({
        authCookieSecure: z.boolean().optional(),
        csrfEnabled: z.boolean().optional(),
        loginMaxAttempts: z.number().int().positive().optional(),
        loginLockoutWindowSeconds: z.number().int().positive().optional(),
        maxUploadMb: z.number().int().positive().optional(),
        storageQuotaBytes: z.number().int().nonnegative().optional(),
        swaggerUiEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    deviceSocketAuth: z
      .object({
        legacyAllowed: z.boolean().optional(),
        signedEnabled: z.boolean().optional(),
        maxClockSkewMs: z.number().int().positive().optional(),
        replayProtectionEnabled: z.boolean().optional(),
        replayCacheTtlMs: z.number().int().positive().optional(),
        replayFailClosed: z.boolean().optional(),
      })
      .strict()
      .optional(),
    commands: z
      .object({
        leaseMs: z.number().int().positive().optional(),
        maxAttempts: z.number().int().positive().optional(),
        defaultExpiresMs: z.number().int().positive().optional(),
        emergencyExpiresMs: z.number().int().positive().optional(),
        outboxWriteEnabled: z.boolean().optional(),
        desiredStateEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    outbox: z
      .object({
        dispatchEnabled: z.boolean().optional(),
        batchSize: z.number().int().positive().optional(),
        dispatchIntervalMs: z.number().int().positive().optional(),
        dispatchLeaseMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    media: z
      .object({
        endpoint: urlWithoutCredentials.optional(),
        publicEndpoint: urlWithoutCredentials.optional(),
        region: z.string().trim().min(1).optional(),
        cacheReportingEnabled: z.boolean().optional(),
      })
      .strict()
      .optional(),
    observability: z
      .object({
        prometheusUrl: urlWithoutCredentials.optional(),
        prometheusTimeoutMs: z.number().int().positive().optional(),
        grafanaEnabled: z.boolean().optional(),
        grafanaEmbedEnabled: z.boolean().optional(),
        grafanaBasePath: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    limits: z
      .object({
        wsNotificationMaxBytes: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type BackendFileConfig = z.infer<typeof backendFileConfigSchema>;

export type BackendConfigFileSource = 'DARSHAN_CONFIG_FILE' | 'SIGNHEX_CONFIG_FILE' | 'both';

export interface BackendConfigFileSelector {
  path?: string;
  source?: BackendConfigFileSource;
}

export interface BackendProfileSelector {
  name?: string;
  source: 'DARSHAN_ENV' | 'SIGNHEX_ENV' | 'NODE_ENV' | 'default';
}

export interface BackendFileConfigLoadResult {
  env: Record<string, string>;
  diagnostics: BackendConfigFileDiagnostics;
}

export interface BackendConfigFileDiagnostics {
  configFile: {
    configured: boolean;
    loaded: boolean;
    source?: BackendConfigFileSource;
    path?: string;
    format?: 'json';
  };
  profile: BackendProfileSelector;
  mappedEnvKeys: string[];
}

function normalizedEnvValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSelectorPath(filePath: string) {
  return path.resolve(filePath);
}

export function resolveBackendConfigFileSelector(env: NodeJS.ProcessEnv): BackendConfigFileSelector {
  const darshanPath = normalizedEnvValue(env.DARSHAN_CONFIG_FILE);
  const signhexPath = normalizedEnvValue(env.SIGNHEX_CONFIG_FILE);

  if (darshanPath && signhexPath) {
    const normalizedDarshan = normalizeSelectorPath(darshanPath);
    const normalizedSignhex = normalizeSelectorPath(signhexPath);
    if (normalizedDarshan !== normalizedSignhex) {
      throw new Error('DARSHAN_CONFIG_FILE and SIGNHEX_CONFIG_FILE point to different backend config files');
    }
    return { path: normalizedDarshan, source: 'both' };
  }

  if (darshanPath) return { path: normalizeSelectorPath(darshanPath), source: 'DARSHAN_CONFIG_FILE' };
  if (signhexPath) return { path: normalizeSelectorPath(signhexPath), source: 'SIGNHEX_CONFIG_FILE' };
  return {};
}

export function resolveBackendProfileSelector(env: NodeJS.ProcessEnv): BackendProfileSelector {
  const darshanEnv = normalizedEnvValue(env.DARSHAN_ENV);
  const signhexEnv = normalizedEnvValue(env.SIGNHEX_ENV);

  if (darshanEnv && signhexEnv && darshanEnv !== signhexEnv) {
    throw new Error('DARSHAN_ENV and SIGNHEX_ENV select different backend environments');
  }

  if (darshanEnv) return { name: darshanEnv, source: 'DARSHAN_ENV' };
  if (signhexEnv) return { name: signhexEnv, source: 'SIGNHEX_ENV' };
  if (normalizedEnvValue(env.NODE_ENV)) return { name: env.NODE_ENV, source: 'NODE_ENV' };
  return { name: 'development', source: 'default' };
}

function normalizeKey(key: string) {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function assertNoForbiddenSecretKeys(value: unknown, keyPath: string[] = []) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenSecretKeys(item, [...keyPath, String(index)]));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (forbiddenConfigKeyFragments.some((fragment) => normalized.includes(fragment))) {
      throw new Error(`Backend config file contains secret-like key "${[...keyPath, key].join('.')}"`);
    }
    assertNoForbiddenSecretKeys(nested, [...keyPath, key]);
  }
}

function parseJsonConfig(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Invalid backend config JSON: ${message}`);
  }
}

function parseMediaEndpoint(endpoint: string) {
  const parsed = new URL(endpoint);
  const port =
    parsed.port.length > 0
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;
  return {
    host: parsed.hostname,
    port,
    useSsl: parsed.protocol === 'https:',
  };
}

function boolEnv(value: boolean) {
  return value ? 'true' : 'false';
}

function numberEnv(value: number) {
  return String(value);
}

function putIfDefined(target: Record<string, string>, key: string, value: string | number | boolean | undefined) {
  if (typeof value === 'undefined') return;
  target[key] = typeof value === 'boolean' ? boolEnv(value) : typeof value === 'number' ? numberEnv(value) : value;
}

export function mapBackendFileConfigToEnv(config: BackendFileConfig): Record<string, string> {
  const env: Record<string, string> = {};

  putIfDefined(env, 'SIGNHEX_ENVIRONMENT_NAME', config.environment?.name);
  putIfDefined(env, 'SIGNHEX_DEPLOYMENT_ID', config.environment?.deploymentId);
  putIfDefined(env, 'SIGNHEX_SERVER_ID', config.environment?.serverId);

  putIfDefined(env, 'APP_PUBLIC_BASE_URL', config.http?.appPublicBaseUrl);
  if (config.http?.corsOrigins) putIfDefined(env, 'CORS_ORIGINS', config.http.corsOrigins.join(','));
  if (config.http?.socketAllowedOrigins) {
    putIfDefined(env, 'SOCKET_ALLOWED_ORIGINS', config.http.socketAllowedOrigins.join(','));
  }
  putIfDefined(env, 'REALTIME_WS_PATH', config.http?.socketIoPath);

  putIfDefined(env, 'DARSHAN_REALTIME_SYNC_ENABLED', config.realtime?.enabled);
  putIfDefined(env, 'REALTIME_BUS_PROVIDER', config.realtime?.busProvider);
  putIfDefined(env, 'REALTIME_SOCKET_TRANSPORT', config.realtime?.socketTransport);
  putIfDefined(env, 'REALTIME_SOCKET_ALLOW_POLLING', config.realtime?.socketAllowPolling);
  putIfDefined(env, 'REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS', config.realtime?.socketRequireStickySessions);
  putIfDefined(env, 'REALTIME_DEVICE_NAMESPACE', config.realtime?.deviceNamespace);
  putIfDefined(env, 'REALTIME_WS_PING_INTERVAL_MS', config.realtime?.wsPingIntervalMs);
  putIfDefined(env, 'REALTIME_WS_IDLE_TIMEOUT_MS', config.realtime?.wsIdleTimeoutMs);

  putIfDefined(env, 'VALKEY_MODE', config.valkey?.mode);
  putIfDefined(env, 'VALKEY_TLS_ENABLED', config.valkey?.tlsEnabled);
  putIfDefined(env, 'VALKEY_AUTH_REQUIRED', config.valkey?.authRequired);
  putIfDefined(env, 'VALKEY_CA_CERT_PATH', config.valkey?.caCertPath);
  putIfDefined(env, 'VALKEY_NAMESPACE', config.valkey?.namespace);
  putIfDefined(env, 'VALKEY_PUBSUB_ENABLED', config.valkey?.pubsubEnabled);
  putIfDefined(env, 'REALTIME_DEVICE_NODE_TTL_MS', config.valkey?.deviceNodeTtlMs);
  putIfDefined(env, 'REALTIME_VALKEY_RECONNECT_MIN_MS', config.valkey?.reconnectMinMs);
  putIfDefined(env, 'REALTIME_VALKEY_RECONNECT_MAX_MS', config.valkey?.reconnectMaxMs);
  putIfDefined(env, 'REALTIME_VALKEY_PUBLISH_TIMEOUT_MS', config.valkey?.publishTimeoutMs);

  putIfDefined(env, 'DUPLICATE_IDENTITY_DETECTION_ENABLED', config.duplicateIdentity?.enabled);
  putIfDefined(env, 'DUPLICATE_IDENTITY_ENFORCEMENT', config.duplicateIdentity?.enforcement);
  putIfDefined(env, 'DEVICE_SESSION_LEASE_MS', config.duplicateIdentity?.sessionLeaseMs);
  putIfDefined(env, 'DEVICE_SESSION_RESTART_GRACE_MS', config.duplicateIdentity?.restartGraceMs);

  putIfDefined(env, 'AUTH_COOKIE_SECURE', config.security?.authCookieSecure);
  putIfDefined(env, 'CSRF_ENABLED', config.security?.csrfEnabled);
  putIfDefined(env, 'LOGIN_MAX_ATTEMPTS', config.security?.loginMaxAttempts);
  putIfDefined(env, 'LOGIN_LOCKOUT_WINDOW_SECONDS', config.security?.loginLockoutWindowSeconds);
  putIfDefined(env, 'MAX_UPLOAD_MB', config.security?.maxUploadMb);
  putIfDefined(env, 'STORAGE_QUOTA_BYTES', config.security?.storageQuotaBytes);
  putIfDefined(env, 'ENABLE_SWAGGER_UI', config.security?.swaggerUiEnabled);

  putIfDefined(env, 'DEVICE_SOCKET_LEGACY_AUTH_ALLOWED', config.deviceSocketAuth?.legacyAllowed);
  putIfDefined(env, 'DEVICE_SOCKET_SIGNED_AUTH_ENABLED', config.deviceSocketAuth?.signedEnabled);
  putIfDefined(env, 'DEVICE_SOCKET_AUTH_MAX_CLOCK_SKEW_MS', config.deviceSocketAuth?.maxClockSkewMs);
  putIfDefined(
    env,
    'DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED',
    config.deviceSocketAuth?.replayProtectionEnabled
  );
  putIfDefined(env, 'DEVICE_SOCKET_AUTH_REPLAY_CACHE_TTL_MS', config.deviceSocketAuth?.replayCacheTtlMs);
  putIfDefined(env, 'DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED', config.deviceSocketAuth?.replayFailClosed);

  putIfDefined(env, 'COMMAND_LEASE_MS', config.commands?.leaseMs);
  putIfDefined(env, 'COMMAND_MAX_ATTEMPTS', config.commands?.maxAttempts);
  putIfDefined(env, 'COMMAND_DEFAULT_EXPIRES_MS', config.commands?.defaultExpiresMs);
  putIfDefined(env, 'COMMAND_EMERGENCY_EXPIRES_MS', config.commands?.emergencyExpiresMs);
  putIfDefined(env, 'COMMAND_OUTBOX_WRITE_ENABLED', config.commands?.outboxWriteEnabled);
  putIfDefined(env, 'DEVICE_DESIRED_STATE_ENABLED', config.commands?.desiredStateEnabled);

  putIfDefined(env, 'OUTBOX_DISPATCH_ENABLED', config.outbox?.dispatchEnabled);
  putIfDefined(env, 'OUTBOX_DISPATCH_BATCH_SIZE', config.outbox?.batchSize);
  putIfDefined(env, 'OUTBOX_DISPATCH_INTERVAL_MS', config.outbox?.dispatchIntervalMs);
  putIfDefined(env, 'OUTBOX_DISPATCH_LEASE_MS', config.outbox?.dispatchLeaseMs);

  if (config.media?.endpoint) {
    const endpoint = parseMediaEndpoint(config.media.endpoint);
    putIfDefined(env, 'MINIO_ENDPOINT', endpoint.host);
    putIfDefined(env, 'MINIO_PORT', endpoint.port);
    putIfDefined(env, 'MINIO_USE_SSL', endpoint.useSsl);
  }
  putIfDefined(env, 'MINIO_REGION', config.media?.region);
  putIfDefined(env, 'MINIO_PUBLIC_ENDPOINT', config.media?.publicEndpoint);
  putIfDefined(env, 'DARSHAN_MEDIA_CACHE_REPORTING_ENABLED', config.media?.cacheReportingEnabled);

  putIfDefined(env, 'OBSERVABILITY_PROMETHEUS_BASE_URL', config.observability?.prometheusUrl);
  putIfDefined(env, 'OBSERVABILITY_PROMETHEUS_TIMEOUT_MS', config.observability?.prometheusTimeoutMs);
  putIfDefined(env, 'OBSERVABILITY_GRAFANA_ENABLED', config.observability?.grafanaEnabled);
  putIfDefined(env, 'OBSERVABILITY_GRAFANA_EMBED_ENABLED', config.observability?.grafanaEmbedEnabled);
  putIfDefined(env, 'OBSERVABILITY_GRAFANA_BASE_PATH', config.observability?.grafanaBasePath);

  putIfDefined(env, 'WS_NOTIFICATION_MAX_BYTES', config.limits?.wsNotificationMaxBytes);

  return env;
}

export function loadBackendFileConfigEnv(env: NodeJS.ProcessEnv = process.env): BackendFileConfigLoadResult {
  const selector = resolveBackendConfigFileSelector(env);
  const profile = resolveBackendProfileSelector(env);
  const diagnostics: BackendConfigFileDiagnostics = {
    configFile: {
      configured: Boolean(selector.path),
      loaded: false,
      source: selector.source,
      path: selector.path,
    },
    profile,
    mappedEnvKeys: [],
  };

  const profileEnv: Record<string, string> = {};
  if (profile.source === 'DARSHAN_ENV' || profile.source === 'SIGNHEX_ENV') {
    profileEnv.SIGNHEX_ENVIRONMENT_NAME = profile.name ?? '';
  }

  if (!selector.path) {
    diagnostics.mappedEnvKeys = Object.keys(profileEnv).sort();
    return { env: profileEnv, diagnostics };
  }

  const extension = path.extname(selector.path).toLowerCase();
  if (extension !== '.json') {
    throw new Error('Backend config loader supports JSON files only in CONFIG-1');
  }

  if (!existsSync(selector.path)) {
    throw new Error('Backend config file does not exist');
  }

  const parsedJson = parseJsonConfig(selector.path);
  assertNoForbiddenSecretKeys(parsedJson);
  const parsedConfig = backendFileConfigSchema.safeParse(parsedJson);
  if (!parsedConfig.success) {
    const issues = parsedConfig.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid backend config file: ${issues}`);
  }

  const fileEnv = mapBackendFileConfigToEnv(parsedConfig.data);
  const mappedEnv = { ...profileEnv, ...fileEnv };
  diagnostics.configFile.loaded = true;
  diagnostics.configFile.format = 'json';
  diagnostics.mappedEnvKeys = Object.keys(mappedEnv).sort();
  return { env: mappedEnv, diagnostics };
}

export function buildBackendRuntimeEnv(env: NodeJS.ProcessEnv = process.env): {
  env: NodeJS.ProcessEnv;
  diagnostics: BackendConfigFileDiagnostics;
} {
  const fileConfig = loadBackendFileConfigEnv(env);
  return {
    env: { ...fileConfig.env, ...env },
    diagnostics: fileConfig.diagnostics,
  };
}

export function buildRedactedRuntimeConfigSummary(
  runtimeConfig: Record<string, unknown>,
  diagnostics: BackendConfigFileDiagnostics
) {
  return {
    configFile: {
      configured: diagnostics.configFile.configured,
      loaded: diagnostics.configFile.loaded,
      source: diagnostics.configFile.source ?? null,
      path: diagnostics.configFile.path ?? null,
      format: diagnostics.configFile.format ?? null,
    },
    profile: diagnostics.profile,
    environment: {
      name: runtimeConfig.SIGNHEX_ENVIRONMENT_NAME ?? null,
      deploymentId: runtimeConfig.SIGNHEX_DEPLOYMENT_ID ?? null,
      serverId: runtimeConfig.SIGNHEX_SERVER_ID ?? null,
    },
    duplicateIdentity: {
      enabled: runtimeConfig.DUPLICATE_IDENTITY_DETECTION_ENABLED ?? null,
      enforcement: runtimeConfig.DUPLICATE_IDENTITY_ENFORCEMENT ?? null,
      sessionLeaseMs: runtimeConfig.DEVICE_SESSION_LEASE_MS ?? null,
      restartGraceMs: runtimeConfig.DEVICE_SESSION_RESTART_GRACE_MS ?? null,
    },
    realtime: {
      busProvider: runtimeConfig.REALTIME_BUS_PROVIDER ?? null,
      socketTransport: runtimeConfig.REALTIME_SOCKET_TRANSPORT ?? null,
      socketPath: runtimeConfig.REALTIME_WS_PATH ?? null,
      socketAllowPolling: runtimeConfig.REALTIME_SOCKET_ALLOW_POLLING ?? null,
      socketRequireStickySessions: runtimeConfig.REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS ?? null,
    },
    valkey: {
      mode: runtimeConfig.VALKEY_MODE ?? null,
      tlsEnabled: runtimeConfig.VALKEY_TLS_ENABLED ?? null,
      authRequired: runtimeConfig.VALKEY_AUTH_REQUIRED ?? null,
      namespace: runtimeConfig.VALKEY_NAMESPACE ?? null,
      urlConfigured: Boolean(runtimeConfig.VALKEY_URL),
    },
    observability: {
      metricsEnabled: runtimeConfig.OBSERVABILITY_METRICS_ENABLED ?? null,
      prometheusBaseUrl: runtimeConfig.OBSERVABILITY_PROMETHEUS_BASE_URL ?? null,
      grafanaEnabled: runtimeConfig.OBSERVABILITY_GRAFANA_ENABLED ?? null,
      grafanaBasePath: runtimeConfig.OBSERVABILITY_GRAFANA_BASE_PATH ?? null,
    },
    mappedEnvKeys: diagnostics.mappedEnvKeys,
    redaction: {
      secrets: 'redacted',
      secretValuesIncluded: false,
    },
  };
}
