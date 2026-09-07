import * as fs from 'fs'
import * as path from 'path'
import type { AppConfig, RuntimeMode } from './types'
import { redactUrlForDiagnostics } from './redaction'

export { redactUrlForDiagnostics } from './redaction'

export type PlayerConfigSelectorSource =
  'DARSHAN_PLAYER_CONFIG_FILE' | 'SIGNHEX_PLAYER_CONFIG_FILE' | 'both' | 'default-path'
export type PlayerProfileSelectorSource = 'DARSHAN_ENV' | 'SIGNHEX_ENV' | 'NODE_ENV' | 'default'

export interface PlayerConfigFileSelector {
  configured: boolean
  path?: string
  source?: PlayerConfigSelectorSource
}

export interface PlayerProfileSelector {
  name: string
  source: PlayerProfileSelectorSource
}

export interface PlayerConfigFileDiagnostics {
  configFile: {
    configured: boolean
    loaded: boolean
    source?: PlayerConfigSelectorSource
    path?: string
    format?: 'json'
  }
  profile: PlayerProfileSelector
  mappedConfigKeys: string[]
}

export interface PlayerFileConfigLoadResult {
  config: Partial<AppConfig>
  diagnostics: PlayerConfigFileDiagnostics
}

export interface PlayerFileConfigLoadOptions {
  /** Explicit player selectors still win; this only suppresses the OS site default. */
  allowDefaultPath?: boolean
}

type JsonObject = Record<string, unknown>

const RUNTIME_MODES = new Set<RuntimeMode>(['dev', 'qa', 'production'])
const DUPLICATE_ENFORCEMENT = new Set(['warn', 'block'])
const OFFLINE_PLAYBACK_POLICIES = new Set(['standard', 'secure', 'high_security'])
const SECRET_KEY_FRAGMENTS = [
  'accesskey',
  'apikey',
  'bearer',
  'credential',
  'jwt',
  'password',
  'private',
  'secret',
  'secretkey',
  'token',
]

function envText(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function assertPlainObject(value: unknown, pathLabel: string): asserts value is JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${pathLabel} must be an object`)
  }
}

function assertNoSecretLikeKeys(value: unknown, pathParts: string[] = []): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretLikeKeys(item, [...pathParts, String(index)]))
    return
  }

  if (!value || typeof value !== 'object') {
    return
  }

  for (const [key, child] of Object.entries(value as JsonObject)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const forbidden = SECRET_KEY_FRAGMENTS.find((fragment) => normalized.includes(fragment))
    if (forbidden) {
      const label = [...pathParts, key].join('.') || key
      throw new Error(
        `Player config contains secret-like key "${label}" (${forbidden}); keep secrets in env/runtime state`
      )
    }
    assertNoSecretLikeKeys(child, [...pathParts, key])
  }
}

function assertKnownKeys(value: JsonObject, allowedKeys: string[], pathLabel: string): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`Unknown player config key "${pathLabel}.${key}"`)
    }
  }
}

function stringValue(value: unknown, pathLabel: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new Error(`${pathLabel} must be a string`)
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function booleanValue(value: unknown, pathLabel: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new Error(`${pathLabel} must be a boolean`)
  }
  return value
}

function numberValue(value: unknown, pathLabel: string, min = 0): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${pathLabel} must be a number >= ${min}`)
  }
  return Math.round(value)
}

function stringArrayValue(value: unknown, pathLabel: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`${pathLabel} must be an array of non-empty strings`)
  }
  return value.map((entry) => String(entry).trim())
}

function portArrayValue(value: unknown, pathLabel: string): number[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry) || entry < 1 || entry > 65535)) {
    throw new Error(`${pathLabel} must be an array of TCP ports from 1 to 65535`)
  }
  return value as number[]
}

function normalizeUrl(value: string, pathLabel: string, allowedProtocols: string[]): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`${pathLabel} must be a valid URL`)
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`${pathLabel} must use one of: ${allowedProtocols.join(', ')}`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${pathLabel} must not include credentials`)
  }

  return parsed.toString().replace(/\/$/, '')
}

function normalizeSocketUrl(value: string, pathLabel: string): string {
  const normalized = normalizeUrl(value, pathLabel, ['http:', 'https:', 'ws:', 'wss:'])
  const parsed = new URL(normalized)
  if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
  return parsed.toString().replace(/\/$/, '')
}

function setNested<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) {
    target[key] = value
  }
}

function mapPlayerConfig(rawPlayer: JsonObject): { config: Partial<AppConfig>; mappedConfigKeys: string[] } {
  assertKnownKeys(
    rawPlayer,
    [
      'environment',
      'backend',
      'realtime',
      'polling',
      'pairing',
      'duplicateIdentity',
      'cache',
      'diagnostics',
      'runtime',
      'security',
      'transportTls',
    ],
    'player'
  )

  const config: any = {}
  const mappedConfigKeys: string[] = []

  const environment = rawPlayer['environment']
  if (environment !== undefined) {
    assertPlainObject(environment, 'player.environment')
    assertKnownKeys(
      environment,
      ['name', 'deploymentId', 'expectedServerId', 'releaseId', 'sourceCommit'],
      'player.environment'
    )
    config.environment = {}
    setNested(config.environment, 'name', stringValue(environment['name'], 'player.environment.name'))
    setNested(
      config.environment,
      'deploymentId',
      stringValue(environment['deploymentId'], 'player.environment.deploymentId')
    )
    setNested(
      config.environment,
      'expectedServerId',
      stringValue(environment['expectedServerId'], 'player.environment.expectedServerId')
    )
    setNested(config.environment, 'releaseId', stringValue(environment['releaseId'], 'player.environment.releaseId'))
    setNested(
      config.environment,
      'sourceCommit',
      stringValue(environment['sourceCommit'], 'player.environment.sourceCommit')
    )
    mappedConfigKeys.push('environment')
  }

  const runtime = rawPlayer['runtime']
  if (runtime !== undefined) {
    assertPlainObject(runtime, 'player.runtime')
    assertKnownKeys(runtime, ['mode'], 'player.runtime')
    const mode = stringValue(runtime['mode'], 'player.runtime.mode')
    if (mode !== undefined && !RUNTIME_MODES.has(mode as RuntimeMode)) {
      throw new Error('player.runtime.mode must be one of: dev, qa, production')
    }
    if (mode) {
      config.runtime = { mode: mode as RuntimeMode }
      mappedConfigKeys.push('runtime.mode')
    }
  }

  const backend = rawPlayer['backend']
  if (backend !== undefined) {
    assertPlainObject(backend, 'player.backend')
    assertKnownKeys(backend, ['baseUrl', 'socketIoUrl'], 'player.backend')
    const baseUrl = stringValue(backend['baseUrl'], 'player.backend.baseUrl')
    if (baseUrl) {
      config.apiBase = normalizeUrl(baseUrl, 'player.backend.baseUrl', ['http:', 'https:'])
      mappedConfigKeys.push('apiBase')
    }
    const socketIoUrl = stringValue(backend['socketIoUrl'], 'player.backend.socketIoUrl')
    if (socketIoUrl) {
      const normalizedSocketUrl = normalizeSocketUrl(socketIoUrl, 'player.backend.socketIoUrl')
      config.wsUrl = normalizedSocketUrl
      config.realtime = {
        ...(config.realtime || {}),
        wsUrl: normalizedSocketUrl,
      }
      mappedConfigKeys.push('wsUrl')
      mappedConfigKeys.push('realtime.wsUrl')
    }
  }

  const realtime = rawPlayer['realtime']
  if (realtime !== undefined) {
    assertPlainObject(realtime, 'player.realtime')
    assertKnownKeys(
      realtime,
      ['enabled', 'signedAuthEnabled', 'deviceNamespace', 'commandSafetyPollMs', 'desiredStatePollMs'],
      'player.realtime'
    )
    config.realtime = { ...(config.realtime || {}) }
    setNested(config.realtime!, 'enabled', booleanValue(realtime['enabled'], 'player.realtime.enabled') as any)
    setNested(
      config.realtime!,
      'signedAuthEnabled',
      booleanValue(realtime['signedAuthEnabled'], 'player.realtime.signedAuthEnabled') as any
    )
    setNested(
      config.realtime!,
      'deviceNamespace',
      stringValue(realtime['deviceNamespace'], 'player.realtime.deviceNamespace') as any
    )
    setNested(
      config.realtime!,
      'commandSafetyPollMs',
      numberValue(realtime['commandSafetyPollMs'], 'player.realtime.commandSafetyPollMs', 10000) as any
    )
    setNested(
      config.realtime!,
      'desiredStatePollMs',
      numberValue(realtime['desiredStatePollMs'], 'player.realtime.desiredStatePollMs', 30000) as any
    )
    mappedConfigKeys.push('realtime')
  }

  const transportTls = rawPlayer['transportTls']
  if (transportTls !== undefined) {
    assertPlainObject(transportTls, 'player.transportTls')
    assertKnownKeys(transportTls, ['enabled', 'caPath', 'strictCertificateValidation'], 'player.transportTls')
    config.transportTls = {}
    setNested(
      config.transportTls,
      'enabled',
      booleanValue(transportTls['enabled'], 'player.transportTls.enabled') as any
    )
    setNested(config.transportTls, 'caPath', stringValue(transportTls['caPath'], 'player.transportTls.caPath') as any)
    setNested(
      config.transportTls,
      'strictCertificateValidation',
      booleanValue(
        transportTls['strictCertificateValidation'],
        'player.transportTls.strictCertificateValidation'
      ) as any
    )
    mappedConfigKeys.push('transportTls')
  }

  const polling = rawPlayer['polling']
  if (polling !== undefined) {
    assertPlainObject(polling, 'player.polling')
    assertKnownKeys(polling, ['heartbeatMs', 'commandPollMs', 'snapshotPollMs', 'defaultMediaPollMs'], 'player.polling')
    config.intervals = {}
    setNested(
      config.intervals,
      'heartbeatMs',
      numberValue(polling['heartbeatMs'], 'player.polling.heartbeatMs', 10000) as any
    )
    setNested(
      config.intervals,
      'commandPollMs',
      numberValue(polling['commandPollMs'], 'player.polling.commandPollMs', 5000) as any
    )
    setNested(
      config.intervals,
      'schedulePollMs',
      numberValue(polling['snapshotPollMs'], 'player.polling.snapshotPollMs', 10000) as any
    )
    setNested(
      config.intervals,
      'defaultMediaPollMs',
      numberValue(polling['defaultMediaPollMs'], 'player.polling.defaultMediaPollMs', 10000) as any
    )
    mappedConfigKeys.push('intervals')
  }

  const pairing = rawPlayer['pairing']
  if (pairing !== undefined) {
    assertPlainObject(pairing, 'player.pairing')
    assertKnownKeys(pairing, ['offlineValidationGraceMs', 'backendFirstRolloutMode'], 'player.pairing')
    config.pairing = {}
    setNested(
      config.pairing,
      'offlineValidationGraceMs',
      numberValue(pairing['offlineValidationGraceMs'], 'player.pairing.offlineValidationGraceMs', 0)
    )
    setNested(
      config.pairing,
      'backendFirstRolloutMode',
      booleanValue(pairing['backendFirstRolloutMode'], 'player.pairing.backendFirstRolloutMode')
    )
    mappedConfigKeys.push('pairing')
  }

  const security = rawPlayer['security']
  if (security !== undefined) {
    assertPlainObject(security, 'player.security')
    assertKnownKeys(
      security,
      [
        'offlinePlaybackPolicy',
        'backendRequiredForPlayback',
        'networkSwitchGraceMs',
        'playbackLeaseMs',
        'lockAfterOfflineMs',
        'purgeCacheAfterOfflineMs',
        'showSecurityLockScreen',
        'allowedDomains',
        'webpageResourceDomains',
        'webpageAllowedCidrs',
        'webpageAllowedPorts',
        'webpageAllowHttp',
      ],
      'player.security'
    )
    const offlinePlaybackPolicy = stringValue(
      security['offlinePlaybackPolicy'],
      'player.security.offlinePlaybackPolicy'
    )
    if (offlinePlaybackPolicy !== undefined && !OFFLINE_PLAYBACK_POLICIES.has(offlinePlaybackPolicy)) {
      throw new Error('player.security.offlinePlaybackPolicy must be one of: standard, secure, high_security')
    }
    config.security = {}
    setNested(config.security, 'allowedDomains', stringArrayValue(security['allowedDomains'], 'player.security.allowedDomains') as any)
    setNested(config.security, 'webpageResourceDomains', stringArrayValue(security['webpageResourceDomains'], 'player.security.webpageResourceDomains'))
    setNested(config.security, 'webpageAllowedCidrs', stringArrayValue(security['webpageAllowedCidrs'], 'player.security.webpageAllowedCidrs'))
    setNested(config.security, 'webpageAllowedPorts', portArrayValue(security['webpageAllowedPorts'], 'player.security.webpageAllowedPorts'))
    setNested(config.security, 'webpageAllowHttp', booleanValue(security['webpageAllowHttp'], 'player.security.webpageAllowHttp'))
    setNested(config.security, 'offlinePlaybackPolicy', offlinePlaybackPolicy as any)
    setNested(
      config.security,
      'backendRequiredForPlayback',
      booleanValue(security['backendRequiredForPlayback'], 'player.security.backendRequiredForPlayback') as any
    )
    setNested(
      config.security,
      'networkSwitchGraceMs',
      numberValue(security['networkSwitchGraceMs'], 'player.security.networkSwitchGraceMs', 0) as any
    )
    setNested(
      config.security,
      'playbackLeaseMs',
      numberValue(security['playbackLeaseMs'], 'player.security.playbackLeaseMs', 1000) as any
    )
    setNested(
      config.security,
      'lockAfterOfflineMs',
      numberValue(security['lockAfterOfflineMs'], 'player.security.lockAfterOfflineMs', 0) as any
    )
    setNested(
      config.security,
      'purgeCacheAfterOfflineMs',
      numberValue(security['purgeCacheAfterOfflineMs'], 'player.security.purgeCacheAfterOfflineMs', 0) as any
    )
    setNested(
      config.security,
      'showSecurityLockScreen',
      booleanValue(security['showSecurityLockScreen'], 'player.security.showSecurityLockScreen') as any
    )
    mappedConfigKeys.push('security')
  }

  const duplicateIdentity = rawPlayer['duplicateIdentity']
  if (duplicateIdentity !== undefined) {
    assertPlainObject(duplicateIdentity, 'player.duplicateIdentity')
    assertKnownKeys(duplicateIdentity, ['enabled', 'enforcement'], 'player.duplicateIdentity')
    const enforcement = stringValue(duplicateIdentity['enforcement'], 'player.duplicateIdentity.enforcement')
    if (enforcement !== undefined && !DUPLICATE_ENFORCEMENT.has(enforcement)) {
      throw new Error('player.duplicateIdentity.enforcement must be one of: warn, block')
    }
    config.duplicateIdentity = {}
    setNested(
      config.duplicateIdentity,
      'enabled',
      booleanValue(duplicateIdentity['enabled'], 'player.duplicateIdentity.enabled')
    )
    setNested(config.duplicateIdentity, 'enforcement', enforcement as any)
    mappedConfigKeys.push('duplicateIdentity')
  }

  const cache = rawPlayer['cache']
  if (cache !== undefined) {
    assertPlainObject(cache, 'player.cache')
    assertKnownKeys(cache, ['maxBytes'], 'player.cache')
    config.cache = {}
    setNested(
      config.cache,
      'maxBytes',
      numberValue(cache['maxBytes'], 'player.cache.maxBytes', 1024 * 1024 * 100) as any
    )
    mappedConfigKeys.push('cache.maxBytes')
  }

  const diagnostics = rawPlayer['diagnostics']
  if (diagnostics !== undefined) {
    assertPlainObject(diagnostics, 'player.diagnostics')
    assertKnownKeys(diagnostics, ['showEnvironmentIdentity'], 'player.diagnostics')
    config.diagnostics = {}
    setNested(
      config.diagnostics,
      'showEnvironmentIdentity',
      booleanValue(diagnostics['showEnvironmentIdentity'], 'player.diagnostics.showEnvironmentIdentity')
    )
    mappedConfigKeys.push('diagnostics')
  }

  return { config, mappedConfigKeys }
}

export function resolvePlayerConfigFileSelector(
  env: NodeJS.ProcessEnv = process.env,
  options: PlayerFileConfigLoadOptions = {}
): PlayerConfigFileSelector {
  const darshan = envText(env, 'DARSHAN_PLAYER_CONFIG_FILE')
  const signhex = envText(env, 'SIGNHEX_PLAYER_CONFIG_FILE')

  if (darshan && signhex) {
    const darshanPath = path.resolve(darshan)
    const signhexPath = path.resolve(signhex)
    if (darshanPath !== signhexPath) {
      throw new Error(
        'DARSHAN_PLAYER_CONFIG_FILE and SIGNHEX_PLAYER_CONFIG_FILE point to different player config files'
      )
    }
    return { configured: true, path: darshanPath, source: 'both' }
  }

  if (darshan) {
    return { configured: true, path: path.resolve(darshan), source: 'DARSHAN_PLAYER_CONFIG_FILE' }
  }

  if (signhex) {
    return { configured: true, path: path.resolve(signhex), source: 'SIGNHEX_PLAYER_CONFIG_FILE' }
  }

  if (options.allowDefaultPath !== false) {
    const defaultPath = resolveDefaultPlayerSiteConfigPath(process.platform, env)
    if (defaultPath && fs.existsSync(defaultPath)) {
      return { configured: true, path: defaultPath, source: 'default-path' }
    }
  }

  return { configured: false }
}

export function resolveDefaultPlayerSiteConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (platform === 'linux') return '/etc/darshan/player/config.json'
  if (platform === 'win32') {
    const programData = env['PROGRAMDATA']?.trim()
    return programData ? path.win32.join(programData, 'DARSHAN', 'config.json') : undefined
  }
  return undefined
}

export function resolvePlayerProfileSelector(env: NodeJS.ProcessEnv = process.env): PlayerProfileSelector {
  const darshan = envText(env, 'DARSHAN_ENV')
  const signhex = envText(env, 'SIGNHEX_ENV')

  if (darshan && signhex && darshan !== signhex) {
    throw new Error('DARSHAN_ENV and SIGNHEX_ENV select different player environments')
  }

  if (darshan) return { name: darshan, source: 'DARSHAN_ENV' }
  if (signhex) return { name: signhex, source: 'SIGNHEX_ENV' }
  if (envText(env, 'NODE_ENV')) return { name: envText(env, 'NODE_ENV')!, source: 'NODE_ENV' }
  return { name: 'development', source: 'default' }
}

export function loadPlayerFileConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: PlayerFileConfigLoadOptions = {}
): PlayerFileConfigLoadResult {
  const selector = resolvePlayerConfigFileSelector(env, options)
  const profile = resolvePlayerProfileSelector(env)
  const emptyDiagnostics: PlayerConfigFileDiagnostics = {
    configFile: {
      configured: selector.configured,
      loaded: false,
      source: selector.source,
      path: selector.path,
    },
    profile,
    mappedConfigKeys: [],
  }

  if (!selector.configured || !selector.path) {
    return { config: {}, diagnostics: emptyDiagnostics }
  }

  if (!fs.existsSync(selector.path)) {
    throw new Error(`Player config file does not exist: ${selector.path}`)
  }

  const extension = path.extname(selector.path).toLowerCase()
  if (extension === '.yaml' || extension === '.yml') {
    throw new Error('Player config loader supports JSON files only in CONFIG-2')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(selector.path, 'utf-8'))
  } catch (error) {
    throw new Error(`Invalid player config JSON: ${(error as Error).message}`)
  }

  assertPlainObject(parsed, 'player config')
  assertNoSecretLikeKeys(parsed)
  assertKnownKeys(parsed, ['player'], 'player config')
  assertPlainObject(parsed['player'], 'player')

  const mapped = mapPlayerConfig(parsed['player'])

  return {
    config: mapped.config,
    diagnostics: {
      configFile: {
        configured: true,
        loaded: true,
        source: selector.source,
        path: selector.path,
        format: 'json',
      },
      profile,
      mappedConfigKeys: mapped.mappedConfigKeys,
    },
  }
}

export function buildRedactedPlayerConfigSummary(config: AppConfig, diagnostics: PlayerConfigFileDiagnostics) {
  return {
    configFile: {
      configured: diagnostics.configFile.configured,
      loaded: diagnostics.configFile.loaded,
      source: diagnostics.configFile.source ?? null,
      path: diagnostics.configFile.path ?? null,
      format: diagnostics.configFile.format ?? null,
    },
    profile: diagnostics.profile,
    environment: config.environment ?? null,
    backend: {
      apiBase: redactUrlForDiagnostics(config.apiBase) ?? null,
      wsUrl: redactUrlForDiagnostics(config.wsUrl) ?? null,
      realtimeWsUrl: redactUrlForDiagnostics(config.realtime?.wsUrl) ?? null,
      realtimeWsConfigured: Boolean(config.realtime?.wsUrl || config.wsUrl),
    },
    transportTls: {
      enabled: config.transportTls.enabled,
      caPathConfigured: Boolean(config.transportTls.caPath),
      strictCertificateValidation: config.transportTls.strictCertificateValidation,
    },
    runtime: config.runtime,
    pairing: config.pairing ?? null,
    duplicateIdentity: config.duplicateIdentity ?? null,
    security: {
      offlinePlaybackPolicy: config.security.offlinePlaybackPolicy ?? 'standard',
      backendRequiredForPlayback: config.security.backendRequiredForPlayback === true,
      networkSwitchGraceMs: config.security.networkSwitchGraceMs ?? null,
      playbackLeaseMs: config.security.playbackLeaseMs ?? null,
      lockAfterOfflineMs: config.security.lockAfterOfflineMs ?? null,
      purgeCacheAfterOfflineMs: config.security.purgeCacheAfterOfflineMs ?? null,
      showSecurityLockScreen: config.security.showSecurityLockScreen !== false,
    },
    cache: {
      maxBytes: config.cache.maxBytes,
      pathConfigured: Boolean(config.cache.path),
    },
    diagnostics: config.diagnostics ?? null,
    mappedConfigKeys: diagnostics.mappedConfigKeys,
    redaction: {
      secrets: 'redacted',
      secretValuesIncluded: false,
    },
  }
}
