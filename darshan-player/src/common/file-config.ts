import * as fs from 'fs'
import * as path from 'path'
import type { AppConfig, RuntimeMode } from './types'
import { redactUrlForDiagnostics } from './redaction'

export { redactUrlForDiagnostics } from './redaction'

export type PlayerConfigSelectorSource = 'DARSHAN_PLAYER_CONFIG_FILE' | 'SIGNHEX_PLAYER_CONFIG_FILE' | 'both'
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

type JsonObject = Record<string, unknown>

const RUNTIME_MODES = new Set<RuntimeMode>(['dev', 'qa', 'production'])
const DUPLICATE_ENFORCEMENT = new Set(['warn', 'block'])
const SECRET_KEY_FRAGMENTS = [
  'accesskey',
  'apikey',
  'bearer',
  'certificate',
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
      throw new Error(`Player config contains secret-like key "${label}" (${forbidden}); keep secrets in env/runtime state`)
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
    ['environment', 'backend', 'realtime', 'polling', 'pairing', 'duplicateIdentity', 'cache', 'diagnostics', 'runtime'],
    'player'
  )

  const config: any = {}
  const mappedConfigKeys: string[] = []

  const environment = rawPlayer['environment']
  if (environment !== undefined) {
    assertPlainObject(environment, 'player.environment')
    assertKnownKeys(environment, ['name', 'deploymentId', 'expectedServerId'], 'player.environment')
    config.environment = {}
    setNested(config.environment, 'name', stringValue(environment['name'], 'player.environment.name'))
    setNested(config.environment, 'deploymentId', stringValue(environment['deploymentId'], 'player.environment.deploymentId'))
    setNested(
      config.environment,
      'expectedServerId',
      stringValue(environment['expectedServerId'], 'player.environment.expectedServerId')
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

  const polling = rawPlayer['polling']
  if (polling !== undefined) {
    assertPlainObject(polling, 'player.polling')
    assertKnownKeys(polling, ['heartbeatMs', 'commandPollMs', 'snapshotPollMs', 'defaultMediaPollMs'], 'player.polling')
    config.intervals = {}
    setNested(config.intervals, 'heartbeatMs', numberValue(polling['heartbeatMs'], 'player.polling.heartbeatMs', 10000) as any)
    setNested(config.intervals, 'commandPollMs', numberValue(polling['commandPollMs'], 'player.polling.commandPollMs', 5000) as any)
    setNested(config.intervals, 'schedulePollMs', numberValue(polling['snapshotPollMs'], 'player.polling.snapshotPollMs', 10000) as any)
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
    setNested(config.cache, 'maxBytes', numberValue(cache['maxBytes'], 'player.cache.maxBytes', 1024 * 1024 * 100) as any)
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

export function resolvePlayerConfigFileSelector(env: NodeJS.ProcessEnv = process.env): PlayerConfigFileSelector {
  const darshan = envText(env, 'DARSHAN_PLAYER_CONFIG_FILE')
  const signhex = envText(env, 'SIGNHEX_PLAYER_CONFIG_FILE')

  if (darshan && signhex) {
    const darshanPath = path.resolve(darshan)
    const signhexPath = path.resolve(signhex)
    if (darshanPath !== signhexPath) {
      throw new Error('DARSHAN_PLAYER_CONFIG_FILE and SIGNHEX_PLAYER_CONFIG_FILE point to different player config files')
    }
    return { configured: true, path: darshanPath, source: 'both' }
  }

  if (darshan) {
    return { configured: true, path: path.resolve(darshan), source: 'DARSHAN_PLAYER_CONFIG_FILE' }
  }

  if (signhex) {
    return { configured: true, path: path.resolve(signhex), source: 'SIGNHEX_PLAYER_CONFIG_FILE' }
  }

  return { configured: false }
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

export function loadPlayerFileConfig(env: NodeJS.ProcessEnv = process.env): PlayerFileConfigLoadResult {
  const selector = resolvePlayerConfigFileSelector(env)
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
    runtime: config.runtime,
    pairing: config.pairing ?? null,
    duplicateIdentity: config.duplicateIdentity ?? null,
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
