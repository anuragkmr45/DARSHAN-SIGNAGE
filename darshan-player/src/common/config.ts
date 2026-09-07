/**
 * Configuration management persisted to a user-writable JSON file.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'
import { EventEmitter } from 'events'
import type { AppConfig, RuntimeMode } from './types'
import { importLegacyLinuxRuntimeState, resolveRuntimePaths, type RuntimePaths } from './platform-paths'
import { buildRedactedPlayerConfigSummary, loadPlayerFileConfig, type PlayerConfigFileDiagnostics } from './file-config'
import { DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG, normalizeSecureOfflinePlaybackConfig } from './offline-security-policy'

const RUNTIME_MODES: RuntimeMode[] = ['dev', 'qa', 'production']
const SECURE_OFFLINE_PLAYBACK_POLICIES = new Set(['standard', 'secure', 'high_security'])
const LEGACY_COMMAND_POLL_MS = 30000
const LIVE_COMMAND_POLL_MS = 5000
const LEGACY_PLAYER_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
const PRE_PDF_VIEWER_PLAYER_CSP = [
  "default-src 'self' data: blob: file: http: https:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: file: http: https:",
  "media-src 'self' data: blob: file: http: https:",
  "connect-src 'self' data: blob: http: https: ws: wss:",
  "frame-src 'self' data: blob: file: http: https:",
  "worker-src 'self' blob:",
  "font-src 'self' data: http: https:",
  "object-src 'none'",
].join('; ')

function buildDefaultPlayerCsp(): string {
  return [
    "default-src 'self' data: blob: file: http: https:",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: http: https:",
    "media-src 'self' data: blob: file: http: https:",
    "connect-src 'self' data: blob: http: https: ws: wss:",
    "frame-src 'self' data: blob: file: http: https: chrome-extension:",
    "worker-src 'self' blob:",
    "font-src 'self' data: http: https:",
    "object-src 'none'",
  ].join('; ')
}

function buildDefaultObservabilityBindAddress(allowRemoteAccess: boolean): string {
  return allowRemoteAccess ? '0.0.0.0' : '127.0.0.1'
}

function envValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return undefined
}

function envPresent(...names: string[]): boolean {
  return envValue(...names) !== undefined
}

function envFlag(defaultValue: boolean, ...names: string[]): boolean {
  const value = envValue(...names)
  if (value === undefined) return defaultValue
  return value === 'true'
}

function envNumber(defaultValue: number, ...names: string[]): number {
  const value = envValue(...names)
  if (value === undefined) return defaultValue
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

function envSecureOfflinePlaybackPolicy(
  defaultValue: AppConfig['security']['offlinePlaybackPolicy'],
  ...names: string[]
) {
  const value = envValue(...names)
  if (!value) return defaultValue
  const normalized = value.trim().toLowerCase()
  return SECURE_OFFLINE_PLAYBACK_POLICIES.has(normalized)
    ? (normalized as AppConfig['security']['offlinePlaybackPolicy'])
    : defaultValue
}

function isLoopbackAddress(value: string): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

export class ConfigManager {
  private config: AppConfig
  private readonly configPath: string
  private readonly defaults: AppConfig
  private readonly runtimePaths: RuntimePaths
  private readonly fileConfigDiagnostics: PlayerConfigFileDiagnostics
  private readonly emitter = new EventEmitter()

  constructor(configPath?: string) {
    this.runtimePaths = resolveRuntimePaths()
    if (!configPath) {
      importLegacyLinuxRuntimeState(this.runtimePaths)
    }
    this.configPath = configPath || this.getDefaultConfigPath()
    this.defaults = this.buildDefaultConfig()
    // An explicitly selected writable runtime config is authoritative. Do not
    // let an ambient /etc site profile unexpectedly override tests, recovery
    // tooling, or a deliberately selected device configuration. Explicit
    // DARSHAN_PLAYER_CONFIG_FILE/SIGNHEX_PLAYER_CONFIG_FILE values still load.
    const hasExplicitRuntimeConfig = Boolean(
      configPath ||
      envValue(
        'DARSHAN_CONFIG_PATH',
        'SIGNAGE_CONFIG_PATH',
        'HEXMON_CONFIG_PATH',
        'DARSHAN_RUNTIME_ROOT',
        'HEXMON_RUNTIME_ROOT'
      )
    )
    const fileConfig = loadPlayerFileConfig(process.env, { allowDefaultPath: !hasExplicitRuntimeConfig })
    this.fileConfigDiagnostics = fileConfig.diagnostics
    this.config = this.loadConfig(fileConfig.config)
  }

  private getDefaultConfigPath(): string {
    return this.runtimePaths.configPath
  }

  private buildDefaultConfig(): AppConfig {
    const runtimeMode = this.buildDefaultRuntimeMode()
    const apiBase = this.buildDefaultApiBase(runtimeMode)
    const wsUrl = this.buildDefaultWsUrl(apiBase, runtimeMode)

    const defaultCachePath = envValue('DARSHAN_CACHE_PATH', 'HEXMON_CACHE_PATH') || this.runtimePaths.cachePath
    const defaultCertDir = envValue('DARSHAN_MTLS_CERT_DIR', 'HEXMON_MTLS_CERT_DIR') || this.runtimePaths.certDir

    const defaultCertPath =
      envValue('DARSHAN_MTLS_CERT_PATH', 'HEXMON_MTLS_CERT_PATH') || path.join(defaultCertDir, 'client.crt')
    const defaultKeyPath =
      envValue('DARSHAN_MTLS_KEY_PATH', 'HEXMON_MTLS_KEY_PATH') || path.join(defaultCertDir, 'client.key')
    const defaultCaPath = envValue('DARSHAN_MTLS_CA_PATH', 'HEXMON_MTLS_CA_PATH') || path.join(defaultCertDir, 'ca.crt')

    return {
      apiBase,
      wsUrl,
      deviceId: envValue('DARSHAN_DEVICE_ID', 'HEXMON_DEVICE_ID') || '',
      environment: {
        name: envValue('DARSHAN_ENVIRONMENT_NAME', 'SIGNHEX_ENVIRONMENT_NAME'),
        deploymentId: envValue('DARSHAN_DEPLOYMENT_ID', 'SIGNHEX_DEPLOYMENT_ID'),
        expectedServerId: envValue('DARSHAN_EXPECTED_SERVER_ID', 'SIGNHEX_EXPECTED_SERVER_ID'),
      },
      runtime: {
        mode: runtimeMode,
      },
      realtime: {
        enabled: envFlag(false, 'DARSHAN_REALTIME_PLAYER_ENABLED', 'HEXMON_REALTIME_SYNC_ENABLED'),
        signedAuthEnabled: envFlag(
          false,
          'DARSHAN_REALTIME_SIGNED_AUTH_ENABLED',
          'HEXMON_REALTIME_SIGNED_AUTH_ENABLED'
        ),
        deviceNamespace: envValue('DARSHAN_REALTIME_DEVICE_NAMESPACE', 'HEXMON_REALTIME_DEVICE_NAMESPACE') || '/device',
        commandSafetyPollMs: envNumber(
          60000,
          'DARSHAN_REALTIME_COMMAND_SAFETY_POLL_MS',
          'HEXMON_REALTIME_COMMAND_SAFETY_POLL_MS'
        ),
        desiredStatePollMs: envNumber(
          300000,
          'DARSHAN_REALTIME_DESIRED_STATE_POLL_MS',
          'HEXMON_REALTIME_DESIRED_STATE_POLL_MS'
        ),
        reconnectMinMs: envNumber(1000, 'DARSHAN_REALTIME_RECONNECT_MIN_MS', 'HEXMON_REALTIME_RECONNECT_MIN_MS'),
        reconnectMaxMs: envNumber(60000, 'DARSHAN_REALTIME_RECONNECT_MAX_MS', 'HEXMON_REALTIME_RECONNECT_MAX_MS'),
        pingIntervalMs: envNumber(25000, 'DARSHAN_REALTIME_WS_PING_INTERVAL_MS', 'HEXMON_REALTIME_WS_PING_INTERVAL_MS'),
        notificationMaxBytes: envNumber(32768, 'DARSHAN_WS_NOTIFICATION_MAX_BYTES', 'HEXMON_WS_NOTIFICATION_MAX_BYTES'),
        wsUrl: this.normalizeUrl(envValue('DARSHAN_REALTIME_WS_URL', 'HEXMON_REALTIME_WS_URL')),
      },
      transportTls: {
        enabled: envFlag(false, 'DARSHAN_TRANSPORT_TLS_ENABLED'),
        caPath: envValue('DARSHAN_TRANSPORT_TLS_CA_PATH') || '',
        strictCertificateValidation: envFlag(true, 'DARSHAN_TRANSPORT_TLS_STRICT_CERTIFICATE_VALIDATION'),
      },
      mtls: {
        enabled: envFlag(false, 'DARSHAN_MTLS_ENABLED', 'HEXMON_MTLS_ENABLED'),
        certPath: defaultCertPath,
        keyPath: defaultKeyPath,
        caPath: defaultCaPath,
        strictCertificateValidation: envFlag(
          true,
          'DARSHAN_MTLS_STRICT_CERTIFICATE_VALIDATION',
          'HEXMON_MTLS_STRICT_CERTIFICATE_VALIDATION'
        ),
        autoRenew: envFlag(true, 'DARSHAN_MTLS_AUTO_RENEW', 'HEXMON_MTLS_AUTO_RENEW'),
        renewBeforeDays: envNumber(30, 'DARSHAN_MTLS_RENEW_BEFORE_DAYS', 'HEXMON_MTLS_RENEW_BEFORE_DAYS'),
      },
      cache: {
        path: defaultCachePath,
        maxBytes: envNumber(10 * 1024 * 1024 * 1024, 'DARSHAN_CACHE_MAX_BYTES', 'HEXMON_CACHE_MAX_BYTES'),
        prefetchConcurrency: envNumber(3, 'DARSHAN_CACHE_PREFETCH_CONCURRENCY', 'HEXMON_CACHE_PREFETCH_CONCURRENCY'),
        bandwidthBudgetMbps: envNumber(50, 'DARSHAN_CACHE_BANDWIDTH_BUDGET_MBPS', 'HEXMON_CACHE_BANDWIDTH_BUDGET_MBPS'),
      },
      intervals: {
        heartbeatMs: envNumber(30000, 'DARSHAN_INTERVAL_HEARTBEAT_MS', 'HEXMON_INTERVAL_HEARTBEAT_MS'),
        commandPollMs: envNumber(5000, 'DARSHAN_INTERVAL_COMMAND_POLL_MS', 'HEXMON_INTERVAL_COMMAND_POLL_MS'),
        schedulePollMs: envNumber(300000, 'DARSHAN_INTERVAL_SCHEDULE_POLL_MS', 'HEXMON_INTERVAL_SCHEDULE_POLL_MS'),
        defaultMediaPollMs: envNumber(
          300000,
          'DARSHAN_INTERVAL_DEFAULT_MEDIA_POLL_MS',
          'HEXMON_INTERVAL_DEFAULT_MEDIA_POLL_MS'
        ),
        healthCheckMs: envNumber(60000, 'DARSHAN_INTERVAL_HEALTH_CHECK_MS', 'HEXMON_INTERVAL_HEALTH_CHECK_MS'),
        screenshotMs: envNumber(30000, 'DARSHAN_INTERVAL_SCREENSHOT_MS', 'HEXMON_INTERVAL_SCREENSHOT_MS'),
      },
      log: {
        level: (envValue('DARSHAN_LOG_LEVEL', 'HEXMON_LOG_LEVEL') as AppConfig['log']['level']) || 'info',
        shipPolicy:
          (envValue('DARSHAN_LOG_SHIP_POLICY', 'HEXMON_LOG_SHIP_POLICY') as AppConfig['log']['shipPolicy']) || 'batch',
        rotationSizeMb: envNumber(100, 'DARSHAN_LOG_ROTATION_SIZE_MB', 'HEXMON_LOG_ROTATION_SIZE_MB'),
        rotationIntervalHours: envNumber(
          24,
          'DARSHAN_LOG_ROTATION_INTERVAL_HOURS',
          'HEXMON_LOG_ROTATION_INTERVAL_HOURS'
        ),
        compressionEnabled: envFlag(true, 'DARSHAN_LOG_COMPRESSION_ENABLED', 'HEXMON_LOG_COMPRESSION_ENABLED'),
      },
      power: {
        dpmsEnabled: envFlag(true, 'DARSHAN_POWER_DPMS_ENABLED', 'HEXMON_POWER_DPMS_ENABLED'),
        preventBlanking: envFlag(true, 'DARSHAN_POWER_PREVENT_BLANKING', 'HEXMON_POWER_PREVENT_BLANKING'),
        scheduleEnabled: envFlag(false, 'DARSHAN_POWER_SCHEDULE_ENABLED', 'HEXMON_POWER_SCHEDULE_ENABLED'),
        onTime: envValue('DARSHAN_POWER_ON_TIME', 'HEXMON_POWER_ON_TIME'),
        offTime: envValue('DARSHAN_POWER_OFF_TIME', 'HEXMON_POWER_OFF_TIME'),
      },
      security: {
        csp: envValue('DARSHAN_SECURITY_CSP', 'HEXMON_SECURITY_CSP') || buildDefaultPlayerCsp(),
        allowedDomains:
          envValue('DARSHAN_SECURITY_ALLOWED_DOMAINS', 'HEXMON_SECURITY_ALLOWED_DOMAINS')?.split(',') || [],
        webpageResourceDomains:
          envValue('DARSHAN_WEBPAGE_RESOURCE_ALLOWLIST', 'HEXMON_WEBPAGE_RESOURCE_ALLOWLIST')?.split(',') || undefined,
        webpageAllowedCidrs:
          envValue('DARSHAN_WEBPAGE_ALLOWED_CIDRS', 'HEXMON_WEBPAGE_ALLOWED_CIDRS')?.split(',') || [],
        webpageAllowedPorts:
          envValue('DARSHAN_WEBPAGE_ALLOWED_PORTS', 'HEXMON_WEBPAGE_ALLOWED_PORTS')
            ?.split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isInteger(value) && value > 0 && value <= 65535) || [443],
        webpageAllowHttp: envFlag(false, 'DARSHAN_WEBPAGE_ALLOW_HTTP', 'HEXMON_WEBPAGE_ALLOW_HTTP'),
        disableEval: envFlag(true, 'DARSHAN_SECURITY_DISABLE_EVAL', 'HEXMON_SECURITY_DISABLE_EVAL'),
        contextIsolation: envFlag(true, 'DARSHAN_SECURITY_CONTEXT_ISOLATION', 'HEXMON_SECURITY_CONTEXT_ISOLATION'),
        nodeIntegration: envFlag(false, 'DARSHAN_SECURITY_NODE_INTEGRATION', 'HEXMON_SECURITY_NODE_INTEGRATION'),
        sandbox: envFlag(true, 'DARSHAN_SECURITY_SANDBOX', 'HEXMON_SECURITY_SANDBOX'),
        offlinePlaybackPolicy: envSecureOfflinePlaybackPolicy(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.offlinePlaybackPolicy,
          'DARSHAN_SECURITY_OFFLINE_PLAYBACK_POLICY',
          'SIGNHEX_SECURITY_OFFLINE_PLAYBACK_POLICY'
        ),
        backendRequiredForPlayback: envFlag(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.backendRequiredForPlayback,
          'DARSHAN_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK',
          'SIGNHEX_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK'
        ),
        networkSwitchGraceMs: envNumber(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.networkSwitchGraceMs,
          'DARSHAN_SECURITY_NETWORK_SWITCH_GRACE_MS',
          'SIGNHEX_SECURITY_NETWORK_SWITCH_GRACE_MS'
        ),
        playbackLeaseMs: envNumber(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.playbackLeaseMs,
          'DARSHAN_SECURITY_PLAYBACK_LEASE_MS',
          'SIGNHEX_SECURITY_PLAYBACK_LEASE_MS'
        ),
        lockAfterOfflineMs: envNumber(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.lockAfterOfflineMs,
          'DARSHAN_SECURITY_LOCK_AFTER_OFFLINE_MS',
          'SIGNHEX_SECURITY_LOCK_AFTER_OFFLINE_MS'
        ),
        purgeCacheAfterOfflineMs: envNumber(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.purgeCacheAfterOfflineMs,
          'DARSHAN_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS',
          'SIGNHEX_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS'
        ),
        showSecurityLockScreen: envFlag(
          DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.showSecurityLockScreen,
          'DARSHAN_SECURITY_SHOW_LOCK_SCREEN',
          'SIGNHEX_SECURITY_SHOW_LOCK_SCREEN'
        ),
      },
      observability: {
        enabled: envFlag(true, 'DARSHAN_OBSERVABILITY_ENABLED', 'HEXMON_OBSERVABILITY_ENABLED'),
        metricsEnabled: envFlag(true, 'DARSHAN_OBSERVABILITY_METRICS_ENABLED', 'HEXMON_OBSERVABILITY_METRICS_ENABLED'),
        mediaCacheReportingEnabled: envFlag(
          true,
          'DARSHAN_MEDIA_CACHE_REPORTING_ENABLED',
          'HEXMON_MEDIA_CACHE_REPORTING_ENABLED'
        ),
        bindAddress:
          envValue('DARSHAN_OBSERVABILITY_BIND_ADDRESS', 'HEXMON_OBSERVABILITY_BIND_ADDRESS') ||
          buildDefaultObservabilityBindAddress(false),
        port: envNumber(3300, 'DARSHAN_OBSERVABILITY_PORT', 'HEXMON_OBSERVABILITY_PORT'),
        allowRemoteAccess: envFlag(
          false,
          'DARSHAN_OBSERVABILITY_ALLOW_REMOTE_ACCESS',
          'HEXMON_OBSERVABILITY_ALLOW_REMOTE_ACCESS'
        ),
      },
      pairing: {
        offlineValidationGraceMs: envNumber(
          7 * 24 * 60 * 60 * 1000,
          'DARSHAN_PAIRING_OFFLINE_VALIDATION_GRACE_MS',
          'SIGNHEX_PAIRING_OFFLINE_VALIDATION_GRACE_MS'
        ),
        backendFirstRolloutMode: envFlag(
          true,
          'DARSHAN_PAIRING_BACKEND_FIRST_ROLLOUT_MODE',
          'SIGNHEX_PAIRING_BACKEND_FIRST_ROLLOUT_MODE'
        ),
      },
      duplicateIdentity: {
        enabled: envFlag(
          true,
          'DARSHAN_DUPLICATE_IDENTITY_DETECTION_ENABLED',
          'SIGNHEX_DUPLICATE_IDENTITY_DETECTION_ENABLED'
        ),
        enforcement:
          (envValue('DARSHAN_DUPLICATE_IDENTITY_ENFORCEMENT', 'SIGNHEX_DUPLICATE_IDENTITY_ENFORCEMENT') as
            'warn' | 'block' | undefined) || 'warn',
      },
      diagnostics: {
        showEnvironmentIdentity: envFlag(
          true,
          'DARSHAN_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY',
          'SIGNHEX_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY'
        ),
      },
    }
  }

  public getRuntimePaths(): RuntimePaths {
    return {
      ...this.runtimePaths,
      legacyLinux: { ...this.runtimePaths.legacyLinux },
    }
  }

  private buildDefaultRuntimeMode(): RuntimeMode {
    const requestedMode = (envValue('DARSHAN_RUNTIME_MODE', 'HEXMON_RUNTIME_MODE') || '').trim().toLowerCase()
    if (this.isRuntimeMode(requestedMode)) {
      return requestedMode
    }

    return process.env['NODE_ENV'] === 'development' ? 'dev' : 'production'
  }

  private isRuntimeMode(value: string): value is RuntimeMode {
    return RUNTIME_MODES.includes(value as RuntimeMode)
  }

  private allowLocalhostFallback(runtimeMode: RuntimeMode): boolean {
    return (
      envFlag(false, 'DARSHAN_ALLOW_LOCALHOST', 'SIGNAGE_ALLOW_LOCALHOST') ||
      process.env['NODE_ENV'] === 'development' ||
      runtimeMode === 'dev'
    )
  }

  private buildDefaultApiBase(runtimeMode: RuntimeMode): string {
    const envApiBase = envValue(
      'DARSHAN_API_BASE_URL',
      'DARSHAN_API_BASE',
      'SIGNAGE_API_BASE_URL',
      'HEXMON_API_BASE',
      'API_BASE_URL'
    )
    const normalizedEnv = this.normalizeUrl(envApiBase)
    if (normalizedEnv) return normalizedEnv
    return this.allowLocalhostFallback(runtimeMode) ? 'http://localhost:3000' : ''
  }

  private buildDefaultWsUrl(apiBase: string, runtimeMode: RuntimeMode): string {
    const envWsUrl = envValue('DARSHAN_WS_URL', 'DARSHAN_REALTIME_WS_URL', 'SIGNAGE_WS_URL', 'HEXMON_WS_URL', 'WS_URL')
    const normalizedEnv = this.normalizeUrl(envWsUrl)
    if (normalizedEnv) return normalizedEnv

    const derived = this.deriveWsUrl(apiBase)
    if (derived) return derived
    return this.allowLocalhostFallback(runtimeMode) ? 'ws://localhost:3000/ws' : ''
  }

  private loadConfig(selectedFileConfig: Partial<AppConfig> = {}): AppConfig {
    const runtimeFileConfig = this.readConfigFromDisk()
    const selectedFileConfigLoaded = this.fileConfigDiagnostics.configFile.loaded
    const mergedRuntime = this.mergeConfig(this.defaults, runtimeFileConfig || {})
    const merged = selectedFileConfigLoaded
      ? this.mergeConfig(this.mergeConfig(mergedRuntime, selectedFileConfig), this.buildExplicitEnvOverrides())
      : mergedRuntime
    const normalized = this.normalizeConfig(merged)

    if (!runtimeFileConfig) {
      this.config = normalized
      this.saveConfig()
      return normalized
    }

    this.config = normalized
    if (
      merged.intervals.commandPollMs !== normalized.intervals.commandPollMs ||
      merged.security.csp !== normalized.security.csp
    ) {
      this.saveConfig()
    }
    return normalized
  }

  private readConfigFromDisk(): Partial<AppConfig> | null {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8')
        return JSON.parse(content) as Partial<AppConfig>
      }
    } catch (error) {
      console.error('Failed to load config file, falling back to defaults:', error)
    }
    return null
  }

  private mergeConfig(defaults: AppConfig, overrides: Partial<AppConfig>): AppConfig {
    return {
      apiBase: overrides.apiBase ?? defaults.apiBase,
      wsUrl: overrides.wsUrl ?? defaults.wsUrl,
      deviceId: overrides.deviceId ?? defaults.deviceId,
      environment: { ...defaults.environment, ...overrides.environment },
      runtime: { ...defaults.runtime, ...overrides.runtime },
      realtime: {
        enabled: overrides.realtime?.enabled ?? defaults.realtime?.enabled ?? false,
        signedAuthEnabled: overrides.realtime?.signedAuthEnabled ?? defaults.realtime?.signedAuthEnabled ?? false,
        deviceNamespace: overrides.realtime?.deviceNamespace ?? defaults.realtime?.deviceNamespace ?? '/device',
        commandSafetyPollMs: overrides.realtime?.commandSafetyPollMs ?? defaults.realtime?.commandSafetyPollMs ?? 60000,
        desiredStatePollMs: overrides.realtime?.desiredStatePollMs ?? defaults.realtime?.desiredStatePollMs ?? 300000,
        reconnectMinMs: overrides.realtime?.reconnectMinMs ?? defaults.realtime?.reconnectMinMs ?? 1000,
        reconnectMaxMs: overrides.realtime?.reconnectMaxMs ?? defaults.realtime?.reconnectMaxMs ?? 60000,
        pingIntervalMs: overrides.realtime?.pingIntervalMs ?? defaults.realtime?.pingIntervalMs ?? 25000,
        notificationMaxBytes:
          overrides.realtime?.notificationMaxBytes ?? defaults.realtime?.notificationMaxBytes ?? 32768,
        wsUrl: overrides.realtime?.wsUrl ?? defaults.realtime?.wsUrl,
      },
      transportTls: { ...defaults.transportTls, ...overrides.transportTls },
      mtls: { ...defaults.mtls, ...overrides.mtls },
      cache: { ...defaults.cache, ...overrides.cache },
      intervals: { ...defaults.intervals, ...overrides.intervals },
      log: { ...defaults.log, ...overrides.log },
      power: { ...defaults.power, ...overrides.power },
      security: { ...defaults.security, ...overrides.security },
      observability: { ...defaults.observability, ...overrides.observability },
      pairing: { ...defaults.pairing, ...overrides.pairing },
      duplicateIdentity: { ...defaults.duplicateIdentity, ...overrides.duplicateIdentity },
      diagnostics: { ...defaults.diagnostics, ...overrides.diagnostics },
    }
  }

  private buildExplicitEnvOverrides(): Partial<AppConfig> {
    const overrides: Partial<AppConfig> = {}
    const apiBase = this.normalizeUrl(
      envValue('DARSHAN_API_BASE_URL', 'DARSHAN_API_BASE', 'SIGNAGE_API_BASE_URL', 'HEXMON_API_BASE', 'API_BASE_URL')
    )
    const wsUrl = this.normalizeUrl(
      envValue('DARSHAN_WS_URL', 'DARSHAN_REALTIME_WS_URL', 'SIGNAGE_WS_URL', 'HEXMON_WS_URL', 'WS_URL')
    )
    const runtimeMode = this.getRuntimeModeOverride()
    const environment: AppConfig['environment'] = {}
    const duplicateIdentityEnforcement = envValue(
      'DARSHAN_DUPLICATE_IDENTITY_ENFORCEMENT',
      'SIGNHEX_DUPLICATE_IDENTITY_ENFORCEMENT'
    )

    if (apiBase) overrides.apiBase = apiBase
    if (wsUrl) overrides.wsUrl = wsUrl
    if (runtimeMode) overrides.runtime = { mode: runtimeMode }

    if (envPresent('DARSHAN_ENVIRONMENT_NAME', 'SIGNHEX_ENVIRONMENT_NAME')) {
      environment.name = envValue('DARSHAN_ENVIRONMENT_NAME', 'SIGNHEX_ENVIRONMENT_NAME')
    }
    if (envPresent('DARSHAN_DEPLOYMENT_ID', 'SIGNHEX_DEPLOYMENT_ID')) {
      environment.deploymentId = envValue('DARSHAN_DEPLOYMENT_ID', 'SIGNHEX_DEPLOYMENT_ID')
    }
    if (envPresent('DARSHAN_EXPECTED_SERVER_ID', 'SIGNHEX_EXPECTED_SERVER_ID')) {
      environment.expectedServerId = envValue('DARSHAN_EXPECTED_SERVER_ID', 'SIGNHEX_EXPECTED_SERVER_ID')
    }
    if (Object.values(environment).some(Boolean)) overrides.environment = environment

    const realtime: Partial<NonNullable<AppConfig['realtime']>> = {}
    if (envPresent('DARSHAN_REALTIME_PLAYER_ENABLED', 'HEXMON_REALTIME_SYNC_ENABLED')) {
      realtime.enabled = envFlag(false, 'DARSHAN_REALTIME_PLAYER_ENABLED', 'HEXMON_REALTIME_SYNC_ENABLED')
    }
    if (envPresent('DARSHAN_REALTIME_SIGNED_AUTH_ENABLED', 'HEXMON_REALTIME_SIGNED_AUTH_ENABLED')) {
      realtime.signedAuthEnabled = envFlag(
        false,
        'DARSHAN_REALTIME_SIGNED_AUTH_ENABLED',
        'HEXMON_REALTIME_SIGNED_AUTH_ENABLED'
      )
    }
    if (envPresent('DARSHAN_REALTIME_DEVICE_NAMESPACE', 'HEXMON_REALTIME_DEVICE_NAMESPACE')) {
      realtime.deviceNamespace = envValue('DARSHAN_REALTIME_DEVICE_NAMESPACE', 'HEXMON_REALTIME_DEVICE_NAMESPACE')
    }
    if (envPresent('DARSHAN_REALTIME_COMMAND_SAFETY_POLL_MS', 'HEXMON_REALTIME_COMMAND_SAFETY_POLL_MS')) {
      realtime.commandSafetyPollMs = envNumber(
        60000,
        'DARSHAN_REALTIME_COMMAND_SAFETY_POLL_MS',
        'HEXMON_REALTIME_COMMAND_SAFETY_POLL_MS'
      )
    }
    if (envPresent('DARSHAN_REALTIME_DESIRED_STATE_POLL_MS', 'HEXMON_REALTIME_DESIRED_STATE_POLL_MS')) {
      realtime.desiredStatePollMs = envNumber(
        300000,
        'DARSHAN_REALTIME_DESIRED_STATE_POLL_MS',
        'HEXMON_REALTIME_DESIRED_STATE_POLL_MS'
      )
    }
    if (envPresent('DARSHAN_REALTIME_RECONNECT_MIN_MS', 'HEXMON_REALTIME_RECONNECT_MIN_MS')) {
      realtime.reconnectMinMs = envNumber(1000, 'DARSHAN_REALTIME_RECONNECT_MIN_MS', 'HEXMON_REALTIME_RECONNECT_MIN_MS')
    }
    if (envPresent('DARSHAN_REALTIME_RECONNECT_MAX_MS', 'HEXMON_REALTIME_RECONNECT_MAX_MS')) {
      realtime.reconnectMaxMs = envNumber(
        60000,
        'DARSHAN_REALTIME_RECONNECT_MAX_MS',
        'HEXMON_REALTIME_RECONNECT_MAX_MS'
      )
    }
    if (envPresent('DARSHAN_REALTIME_WS_PING_INTERVAL_MS', 'HEXMON_REALTIME_WS_PING_INTERVAL_MS')) {
      realtime.pingIntervalMs = envNumber(
        25000,
        'DARSHAN_REALTIME_WS_PING_INTERVAL_MS',
        'HEXMON_REALTIME_WS_PING_INTERVAL_MS'
      )
    }
    if (envPresent('DARSHAN_WS_NOTIFICATION_MAX_BYTES', 'HEXMON_WS_NOTIFICATION_MAX_BYTES')) {
      realtime.notificationMaxBytes = envNumber(
        32768,
        'DARSHAN_WS_NOTIFICATION_MAX_BYTES',
        'HEXMON_WS_NOTIFICATION_MAX_BYTES'
      )
    }
    if (envPresent('DARSHAN_REALTIME_WS_URL', 'HEXMON_REALTIME_WS_URL')) {
      realtime.wsUrl = this.normalizeUrl(envValue('DARSHAN_REALTIME_WS_URL', 'HEXMON_REALTIME_WS_URL'))
    }
    if (Object.keys(realtime).length > 0) overrides.realtime = realtime as AppConfig['realtime']

    if (
      envPresent(
        'DARSHAN_TRANSPORT_TLS_ENABLED',
        'DARSHAN_TRANSPORT_TLS_CA_PATH',
        'DARSHAN_TRANSPORT_TLS_STRICT_CERTIFICATE_VALIDATION'
      )
    ) {
      overrides.transportTls = {
        enabled: envFlag(false, 'DARSHAN_TRANSPORT_TLS_ENABLED'),
        caPath: envValue('DARSHAN_TRANSPORT_TLS_CA_PATH') || this.defaults.transportTls.caPath,
        strictCertificateValidation: envFlag(true, 'DARSHAN_TRANSPORT_TLS_STRICT_CERTIFICATE_VALIDATION'),
      }
    }

    const intervals: Partial<AppConfig['intervals']> = {}
    if (envPresent('DARSHAN_INTERVAL_HEARTBEAT_MS', 'HEXMON_INTERVAL_HEARTBEAT_MS')) {
      intervals.heartbeatMs = envNumber(30000, 'DARSHAN_INTERVAL_HEARTBEAT_MS', 'HEXMON_INTERVAL_HEARTBEAT_MS')
    }
    if (envPresent('DARSHAN_INTERVAL_COMMAND_POLL_MS', 'HEXMON_INTERVAL_COMMAND_POLL_MS')) {
      intervals.commandPollMs = envNumber(5000, 'DARSHAN_INTERVAL_COMMAND_POLL_MS', 'HEXMON_INTERVAL_COMMAND_POLL_MS')
    }
    if (envPresent('DARSHAN_INTERVAL_SCHEDULE_POLL_MS', 'HEXMON_INTERVAL_SCHEDULE_POLL_MS')) {
      intervals.schedulePollMs = envNumber(
        300000,
        'DARSHAN_INTERVAL_SCHEDULE_POLL_MS',
        'HEXMON_INTERVAL_SCHEDULE_POLL_MS'
      )
    }
    if (envPresent('DARSHAN_INTERVAL_DEFAULT_MEDIA_POLL_MS', 'HEXMON_INTERVAL_DEFAULT_MEDIA_POLL_MS')) {
      intervals.defaultMediaPollMs = envNumber(
        300000,
        'DARSHAN_INTERVAL_DEFAULT_MEDIA_POLL_MS',
        'HEXMON_INTERVAL_DEFAULT_MEDIA_POLL_MS'
      )
    }
    if (envPresent('DARSHAN_INTERVAL_HEALTH_CHECK_MS', 'HEXMON_INTERVAL_HEALTH_CHECK_MS')) {
      intervals.healthCheckMs = envNumber(60000, 'DARSHAN_INTERVAL_HEALTH_CHECK_MS', 'HEXMON_INTERVAL_HEALTH_CHECK_MS')
    }
    if (envPresent('DARSHAN_INTERVAL_SCREENSHOT_MS', 'HEXMON_INTERVAL_SCREENSHOT_MS')) {
      intervals.screenshotMs = envNumber(30000, 'DARSHAN_INTERVAL_SCREENSHOT_MS', 'HEXMON_INTERVAL_SCREENSHOT_MS')
    }
    if (Object.keys(intervals).length > 0) overrides.intervals = intervals as AppConfig['intervals']

    const security: Partial<AppConfig['security']> = {}
    if (envPresent('DARSHAN_SECURITY_OFFLINE_PLAYBACK_POLICY', 'SIGNHEX_SECURITY_OFFLINE_PLAYBACK_POLICY')) {
      security.offlinePlaybackPolicy = envSecureOfflinePlaybackPolicy(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.offlinePlaybackPolicy,
        'DARSHAN_SECURITY_OFFLINE_PLAYBACK_POLICY',
        'SIGNHEX_SECURITY_OFFLINE_PLAYBACK_POLICY'
      )
    }
    if (
      envPresent('DARSHAN_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK', 'SIGNHEX_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK')
    ) {
      security.backendRequiredForPlayback = envFlag(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.backendRequiredForPlayback,
        'DARSHAN_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK',
        'SIGNHEX_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK'
      )
    }
    if (envPresent('DARSHAN_SECURITY_NETWORK_SWITCH_GRACE_MS', 'SIGNHEX_SECURITY_NETWORK_SWITCH_GRACE_MS')) {
      security.networkSwitchGraceMs = envNumber(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.networkSwitchGraceMs,
        'DARSHAN_SECURITY_NETWORK_SWITCH_GRACE_MS',
        'SIGNHEX_SECURITY_NETWORK_SWITCH_GRACE_MS'
      )
    }
    if (envPresent('DARSHAN_SECURITY_PLAYBACK_LEASE_MS', 'SIGNHEX_SECURITY_PLAYBACK_LEASE_MS')) {
      security.playbackLeaseMs = envNumber(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.playbackLeaseMs,
        'DARSHAN_SECURITY_PLAYBACK_LEASE_MS',
        'SIGNHEX_SECURITY_PLAYBACK_LEASE_MS'
      )
    }
    if (envPresent('DARSHAN_SECURITY_LOCK_AFTER_OFFLINE_MS', 'SIGNHEX_SECURITY_LOCK_AFTER_OFFLINE_MS')) {
      security.lockAfterOfflineMs = envNumber(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.lockAfterOfflineMs,
        'DARSHAN_SECURITY_LOCK_AFTER_OFFLINE_MS',
        'SIGNHEX_SECURITY_LOCK_AFTER_OFFLINE_MS'
      )
    }
    if (envPresent('DARSHAN_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS', 'SIGNHEX_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS')) {
      security.purgeCacheAfterOfflineMs = envNumber(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.purgeCacheAfterOfflineMs,
        'DARSHAN_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS',
        'SIGNHEX_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS'
      )
    }
    if (envPresent('DARSHAN_SECURITY_SHOW_LOCK_SCREEN', 'SIGNHEX_SECURITY_SHOW_LOCK_SCREEN')) {
      security.showSecurityLockScreen = envFlag(
        DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.showSecurityLockScreen,
        'DARSHAN_SECURITY_SHOW_LOCK_SCREEN',
        'SIGNHEX_SECURITY_SHOW_LOCK_SCREEN'
      )
    }
    if (Object.keys(security).length > 0) overrides.security = security as AppConfig['security']

    if (envPresent('DARSHAN_CACHE_MAX_BYTES', 'HEXMON_CACHE_MAX_BYTES')) {
      overrides.cache = {
        maxBytes: envNumber(10 * 1024 * 1024 * 1024, 'DARSHAN_CACHE_MAX_BYTES', 'HEXMON_CACHE_MAX_BYTES'),
      } as AppConfig['cache']
    }

    const pairing: AppConfig['pairing'] = {}
    if (envPresent('DARSHAN_PAIRING_OFFLINE_VALIDATION_GRACE_MS', 'SIGNHEX_PAIRING_OFFLINE_VALIDATION_GRACE_MS')) {
      pairing.offlineValidationGraceMs = envNumber(
        7 * 24 * 60 * 60 * 1000,
        'DARSHAN_PAIRING_OFFLINE_VALIDATION_GRACE_MS',
        'SIGNHEX_PAIRING_OFFLINE_VALIDATION_GRACE_MS'
      )
    }
    if (envPresent('DARSHAN_PAIRING_BACKEND_FIRST_ROLLOUT_MODE', 'SIGNHEX_PAIRING_BACKEND_FIRST_ROLLOUT_MODE')) {
      pairing.backendFirstRolloutMode = envFlag(
        true,
        'DARSHAN_PAIRING_BACKEND_FIRST_ROLLOUT_MODE',
        'SIGNHEX_PAIRING_BACKEND_FIRST_ROLLOUT_MODE'
      )
    }
    if (Object.keys(pairing).length > 0) overrides.pairing = pairing

    const duplicateIdentity: AppConfig['duplicateIdentity'] = {}
    if (envPresent('DARSHAN_DUPLICATE_IDENTITY_DETECTION_ENABLED', 'SIGNHEX_DUPLICATE_IDENTITY_DETECTION_ENABLED')) {
      duplicateIdentity.enabled = envFlag(
        true,
        'DARSHAN_DUPLICATE_IDENTITY_DETECTION_ENABLED',
        'SIGNHEX_DUPLICATE_IDENTITY_DETECTION_ENABLED'
      )
    }
    if (duplicateIdentityEnforcement === 'block' || duplicateIdentityEnforcement === 'warn') {
      duplicateIdentity.enforcement = duplicateIdentityEnforcement
    }
    if (Object.keys(duplicateIdentity).length > 0) overrides.duplicateIdentity = duplicateIdentity

    const diagnostics: AppConfig['diagnostics'] = {}
    if (envPresent('DARSHAN_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY', 'SIGNHEX_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY')) {
      diagnostics.showEnvironmentIdentity = envFlag(
        true,
        'DARSHAN_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY',
        'SIGNHEX_DIAGNOSTICS_SHOW_ENVIRONMENT_IDENTITY'
      )
    }
    if (Object.keys(diagnostics).length > 0) overrides.diagnostics = diagnostics

    return overrides
  }

  private normalizeConfig(config: AppConfig): AppConfig {
    const runtimeMode = this.getRuntimeModeOverride() || config.runtime.mode
    const apiBase = this.normalizeUrl(config.apiBase) || this.buildDefaultApiBase(runtimeMode)
    const wsUrl = this.normalizeUrl(config.wsUrl) || this.buildDefaultWsUrl(apiBase, runtimeMode)
    const commandPollMs =
      config.intervals.commandPollMs === LEGACY_COMMAND_POLL_MS ? LIVE_COMMAND_POLL_MS : config.intervals.commandPollMs
    const normalizedCsp =
      !config.security.csp ||
      config.security.csp.trim() === '' ||
      config.security.csp === LEGACY_PLAYER_CSP ||
      config.security.csp === PRE_PDF_VIEWER_PLAYER_CSP
        ? buildDefaultPlayerCsp()
        : config.security.csp
    const secureOfflinePlayback = normalizeSecureOfflinePlaybackConfig(config.security)
    const allowRemoteAccess = config.observability.allowRemoteAccess === true
    const requestedBindAddress = config.observability.bindAddress?.trim()
    const bindAddress = allowRemoteAccess
      ? requestedBindAddress || buildDefaultObservabilityBindAddress(true)
      : '127.0.0.1'
    const port =
      Number.isFinite(config.observability.port) && config.observability.port > 0
        ? Math.round(config.observability.port)
        : 3300

    return {
      ...config,
      environment: {
        ...config.environment,
      },
      apiBase,
      wsUrl,
      runtime: {
        ...config.runtime,
        mode: runtimeMode,
      },
      realtime: {
        ...config.realtime,
        enabled: config.realtime?.enabled === true,
        signedAuthEnabled: config.realtime?.signedAuthEnabled === true,
        deviceNamespace: config.realtime?.deviceNamespace || '/device',
        commandSafetyPollMs: Math.max(config.realtime?.commandSafetyPollMs || 60000, 10000),
        desiredStatePollMs: Math.max(config.realtime?.desiredStatePollMs || 300000, 30000),
        reconnectMinMs: Math.max(config.realtime?.reconnectMinMs || 1000, 250),
        reconnectMaxMs: Math.max(config.realtime?.reconnectMaxMs || 60000, config.realtime?.reconnectMinMs || 1000),
        pingIntervalMs: Math.max(config.realtime?.pingIntervalMs || 25000, 5000),
        notificationMaxBytes: Math.max(config.realtime?.notificationMaxBytes || 32768, 1024),
        wsUrl: this.normalizeUrl(config.realtime?.wsUrl),
      },
      transportTls: {
        ...config.transportTls,
        enabled: config.transportTls?.enabled === true,
        caPath: config.transportTls?.caPath?.trim() || '',
        strictCertificateValidation: config.transportTls?.strictCertificateValidation !== false,
      },
      intervals: {
        ...config.intervals,
        commandPollMs,
      },
      security: {
        ...config.security,
        csp: normalizedCsp,
        ...secureOfflinePlayback,
      },
      observability: {
        ...config.observability,
        allowRemoteAccess,
        bindAddress,
        port,
      },
      pairing: {
        offlineValidationGraceMs: Math.max(config.pairing?.offlineValidationGraceMs ?? 7 * 24 * 60 * 60 * 1000, 0),
        backendFirstRolloutMode: config.pairing?.backendFirstRolloutMode !== false,
      },
      duplicateIdentity: {
        enabled: config.duplicateIdentity?.enabled !== false,
        enforcement: config.duplicateIdentity?.enforcement === 'block' ? 'block' : 'warn',
      },
      diagnostics: {
        showEnvironmentIdentity: config.diagnostics?.showEnvironmentIdentity !== false,
      },
    }
  }

  private getRuntimeModeOverride(): RuntimeMode | undefined {
    const requestedMode = (envValue('DARSHAN_RUNTIME_MODE', 'HEXMON_RUNTIME_MODE') || '').trim().toLowerCase()
    if (this.isRuntimeMode(requestedMode)) {
      return requestedMode
    }

    return undefined
  }

  private deriveWsUrl(apiBase: string): string | null {
    try {
      const url = new URL(apiBase)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.pathname = '/ws'
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/$/, '')
    } catch {
      return null
    }
  }

  private normalizeUrl(value?: string | null): string {
    if (!value) return ''
    return value.replace(/\/+$/, '')
  }

  private cloneConfig(config: AppConfig): AppConfig {
    return {
      ...config,
      environment: config.environment ? { ...config.environment } : undefined,
      runtime: { ...config.runtime },
      realtime: config.realtime ? { ...config.realtime } : undefined,
      transportTls: { ...config.transportTls },
      mtls: { ...config.mtls },
      cache: { ...config.cache },
      intervals: { ...config.intervals },
      log: { ...config.log },
      power: { ...config.power },
      security: {
        ...config.security,
        allowedDomains: [...config.security.allowedDomains],
        webpageResourceDomains: config.security.webpageResourceDomains
          ? [...config.security.webpageResourceDomains]
          : undefined,
        webpageAllowedCidrs: config.security.webpageAllowedCidrs
          ? [...config.security.webpageAllowedCidrs]
          : undefined,
        webpageAllowedPorts: config.security.webpageAllowedPorts
          ? [...config.security.webpageAllowedPorts]
          : undefined,
      },
      observability: { ...config.observability },
      pairing: config.pairing ? { ...config.pairing } : undefined,
      duplicateIdentity: config.duplicateIdentity ? { ...config.duplicateIdentity } : undefined,
      diagnostics: config.diagnostics ? { ...config.diagnostics } : undefined,
    }
  }

  public getConfig(): AppConfig {
    return this.cloneConfig(this.config)
  }

  public updateConfig(updates: Partial<AppConfig>): AppConfig {
    const normalizedUpdates = { ...updates }
    if (updates?.apiBase && updates.wsUrl === undefined) {
      const runtimeMode = updates.runtime?.mode || this.getRuntimeModeOverride() || this.config.runtime.mode
      normalizedUpdates.wsUrl = this.buildDefaultWsUrl(this.normalizeUrl(updates.apiBase), runtimeMode)
    }

    this.config = this.normalizeConfig(this.mergeConfig(this.config, normalizedUpdates))
    this.saveConfig()
    this.emitter.emit('change', this.getConfig())
    return this.getConfig()
  }

  public saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 })
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { mode: 0o600 })
    } catch (error) {
      console.error('Failed to save config:', error)
      throw error
    }
  }

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key]
  }

  public set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.updateConfig({ [key]: value } as Partial<AppConfig>)
  }

  public onChange(listener: (config: AppConfig) => void): () => void {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }

  public getConfigPath(): string {
    return this.configPath
  }

  public getFileConfigDiagnostics(): PlayerConfigFileDiagnostics {
    return {
      configFile: { ...this.fileConfigDiagnostics.configFile },
      profile: { ...this.fileConfigDiagnostics.profile },
      mappedConfigKeys: [...this.fileConfigDiagnostics.mappedConfigKeys],
    }
  }

  public getRedactedRuntimeConfigSummary() {
    return buildRedactedPlayerConfigSummary(this.config, this.fileConfigDiagnostics)
  }

  public validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const runtimeMode = this.config.runtime.mode
    const requireExplicitBackend = runtimeMode === 'qa' || runtimeMode === 'production'

    if (!this.config.apiBase) {
      errors.push(
        requireExplicitBackend
          ? 'apiBase is required for qa/production. Configure the backend HTTPS URL, for example https://10.20.0.20:3000'
          : 'apiBase is required'
      )
    }

    if (!this.config.wsUrl) {
      errors.push(
        requireExplicitBackend
          ? 'wsUrl is required for qa/production. Configure the backend secure websocket URL, for example wss://10.20.0.20:3000/ws'
          : 'wsUrl is required'
      )
    }

    if (this.config.apiBase) {
      try {
        new URL(this.config.apiBase)
      } catch {
        errors.push('apiBase must be a valid URL')
      }
    }

    if (this.config.wsUrl) {
      try {
        new URL(this.config.wsUrl)
      } catch {
        errors.push('wsUrl must be a valid URL')
      }
    }

    if (runtimeMode === 'production') {
      if (this.config.apiBase && !this.config.apiBase.startsWith('https://')) {
        errors.push('production apiBase must use https')
      }
      if (this.config.wsUrl && !this.config.wsUrl.startsWith('wss://')) {
        errors.push('production wsUrl must use wss')
      }
      if (!this.config.transportTls.enabled) {
        errors.push('production transportTls.enabled must be true')
      }
      if (!this.config.transportTls.strictCertificateValidation) {
        errors.push('production transportTls.strictCertificateValidation must be true')
      }
      if (this.config.security.webpageAllowHttp) {
        errors.push('production webpageAllowHttp must be false')
      }
    }

    if (this.config.transportTls.enabled && !this.config.transportTls.caPath) {
      errors.push('transportTls.caPath is required when transport TLS trust is enabled')
    }

    if (!this.isRuntimeMode(this.config.runtime.mode)) {
      errors.push(`runtime.mode must be one of: ${RUNTIME_MODES.join(', ')}`)
    }

    if (this.config.realtime?.enabled) {
      const namespace = this.config.realtime.deviceNamespace
      if (!namespace || !namespace.startsWith('/')) {
        errors.push('realtime.deviceNamespace must start with /')
      }
      if (this.config.realtime.commandSafetyPollMs < 10000) {
        errors.push('realtime.commandSafetyPollMs must be at least 10 seconds')
      }
      if (this.config.realtime.notificationMaxBytes > 32768) {
        errors.push('realtime.notificationMaxBytes must not exceed 32768 bytes')
      }
    }

    if (this.config.cache.maxBytes < 1024 * 1024 * 100) {
      errors.push('cache.maxBytes must be at least 100MB')
    }

    if (this.config.cache.prefetchConcurrency < 1 || this.config.cache.prefetchConcurrency > 10) {
      errors.push('cache.prefetchConcurrency must be between 1 and 10')
    }

    if (this.config.intervals.heartbeatMs < 10000) {
      errors.push('intervals.heartbeatMs must be at least 10 seconds')
    }
    if (this.config.intervals.commandPollMs < 5000) {
      errors.push('intervals.commandPollMs must be at least 5 seconds')
    }
    if (this.config.intervals.schedulePollMs < 10000) {
      errors.push('intervals.schedulePollMs must be at least 10 seconds')
    }
    if (this.config.intervals.defaultMediaPollMs < 10000) {
      errors.push('intervals.defaultMediaPollMs must be at least 10 seconds')
    }
    if (this.config.intervals.screenshotMs < 10000) {
      errors.push('intervals.screenshotMs must be at least 10 seconds')
    }

    if (this.config.mtls.enabled) {
      const paths = [this.config.mtls.certPath, this.config.mtls.keyPath, this.config.mtls.caPath]
      for (const p of paths) {
        if (!p) {
          errors.push(`mTLS path is required when mTLS is enabled: ${p}`)
        }
      }
    }

    if (this.config.power.scheduleEnabled) {
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
      if (this.config.power.onTime && !timeRegex.test(this.config.power.onTime)) {
        errors.push('power.onTime must be in HH:MM format')
      }
      if (this.config.power.offTime && !timeRegex.test(this.config.power.offTime)) {
        errors.push('power.offTime must be in HH:MM format')
      }
    }

    if (
      !Number.isInteger(this.config.observability.port) ||
      this.config.observability.port < 1 ||
      this.config.observability.port > 65535
    ) {
      errors.push('observability.port must be between 1 and 65535')
    }

    const bindAddress = this.config.observability.bindAddress.trim()
    if (!bindAddress) {
      errors.push('observability.bindAddress is required')
    } else if (!this.config.observability.allowRemoteAccess && !isLoopbackAddress(bindAddress)) {
      errors.push('observability.bindAddress must remain loopback unless observability.allowRemoteAccess is true')
    } else if (bindAddress !== 'localhost' && net.isIP(bindAddress) === 0 && !/^[a-z0-9.-]+$/i.test(bindAddress)) {
      errors.push('observability.bindAddress must be a valid IP address or hostname')
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }
}

let configManager: ConfigManager | null = null

export function getConfigManager(configPath?: string): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager(configPath)
  }
  return configManager
}

export function resetConfigManager(): void {
  configManager = null
}
