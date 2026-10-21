import type { SecurityConfig, SecureOfflinePlaybackPolicy } from './types'

export interface NormalizedSecureOfflinePlaybackConfig {
  offlinePlaybackPolicy: SecureOfflinePlaybackPolicy
  backendRequiredForPlayback: boolean
  networkSwitchGraceMs: number
  playbackLeaseMs: number
  lockAfterOfflineMs: number
  purgeCacheAfterOfflineMs: number
  showSecurityLockScreen: boolean
}

export interface SecurePlaybackEvaluationInput {
  security?: Partial<SecurityConfig> | null
  nowMs?: number
  lastBackendSuccessAtMs?: number | null
  firstBackendFailureAtMs?: number | null
}

export interface SecurePlaybackEvaluation {
  enabled: boolean
  allowed: boolean
  locked: boolean
  inGrace: boolean
  reason?: string
  lastBackendSuccessAtMs?: number
  firstBackendFailureAtMs?: number
  lockAtMs?: number
  lockedAtMs?: number
  purgeCacheAfterOfflineMs: number
  purgeDue: boolean
  purgeDueAtMs?: number
}

const POLICIES = new Set<SecureOfflinePlaybackPolicy>(['standard', 'secure', 'high_security'])

export const DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG: NormalizedSecureOfflinePlaybackConfig = {
  offlinePlaybackPolicy: 'standard',
  backendRequiredForPlayback: false,
  networkSwitchGraceMs: 30000,
  playbackLeaseMs: 120000,
  lockAfterOfflineMs: 120000,
  purgeCacheAfterOfflineMs: 0,
  showSecurityLockScreen: true,
}

export function normalizeSecureOfflinePlaybackConfig(
  security?: Partial<SecurityConfig> | null
): NormalizedSecureOfflinePlaybackConfig {
  const requestedPolicy = security?.offlinePlaybackPolicy
  const offlinePlaybackPolicy = POLICIES.has(requestedPolicy as SecureOfflinePlaybackPolicy)
    ? (requestedPolicy as SecureOfflinePlaybackPolicy)
    : DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.offlinePlaybackPolicy

  return {
    offlinePlaybackPolicy,
    backendRequiredForPlayback: security?.backendRequiredForPlayback === true,
    networkSwitchGraceMs: positiveInteger(
      security?.networkSwitchGraceMs,
      DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.networkSwitchGraceMs
    ),
    playbackLeaseMs: positiveInteger(security?.playbackLeaseMs, DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.playbackLeaseMs),
    lockAfterOfflineMs: positiveInteger(
      security?.lockAfterOfflineMs,
      DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.lockAfterOfflineMs
    ),
    purgeCacheAfterOfflineMs: nonNegativeInteger(
      security?.purgeCacheAfterOfflineMs,
      DEFAULT_SECURE_OFFLINE_PLAYBACK_CONFIG.purgeCacheAfterOfflineMs
    ),
    showSecurityLockScreen: security?.showSecurityLockScreen !== false,
  }
}

export function isSecureOfflinePlaybackEnabled(security?: Partial<SecurityConfig> | null): boolean {
  const config = normalizeSecureOfflinePlaybackConfig(security)
  return config.backendRequiredForPlayback || config.offlinePlaybackPolicy !== 'standard'
}

export function evaluateSecurePlaybackState(input: SecurePlaybackEvaluationInput): SecurePlaybackEvaluation {
  const config = normalizeSecureOfflinePlaybackConfig(input.security)
  const enabled = isSecureOfflinePlaybackEnabled(input.security)
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now()
  const lastBackendSuccessAtMs = validTimestamp(input.lastBackendSuccessAtMs)
  const firstBackendFailureAtMs = validTimestamp(input.firstBackendFailureAtMs)
  if (!enabled) {
    return {
      enabled: false,
      allowed: true,
      locked: false,
      inGrace: false,
      purgeCacheAfterOfflineMs: config.purgeCacheAfterOfflineMs,
      purgeDue: false,
      lastBackendSuccessAtMs,
      firstBackendFailureAtMs,
    }
  }

  if (lastBackendSuccessAtMs === undefined) {
    return {
      enabled: true,
      allowed: false,
      locked: true,
      inGrace: false,
      reason: 'Backend validation is required before playback can continue.',
      lockedAtMs: nowMs,
      purgeCacheAfterOfflineMs: config.purgeCacheAfterOfflineMs,
      purgeDue: false,
      lastBackendSuccessAtMs,
      firstBackendFailureAtMs,
    }
  }

  // Secure playback owns one authoritative deadline. Legacy grace settings
  // remain readable so old site profiles continue to parse, but they must not
  // extend playback beyond the lease established by the last authenticated
  // backend success.
  const lockAtMs = lastBackendSuccessAtMs + config.playbackLeaseMs
  const purgeDueAtMs = lockAtMs
  const purgeDue = nowMs >= purgeDueAtMs

  if (nowMs < lockAtMs) {
    return {
      enabled: true,
      allowed: true,
      locked: false,
      inGrace: false,
      lastBackendSuccessAtMs,
      firstBackendFailureAtMs,
      lockAtMs,
      purgeCacheAfterOfflineMs: config.purgeCacheAfterOfflineMs,
      purgeDue: false,
      purgeDueAtMs,
    }
  }

  return {
    enabled: true,
    allowed: false,
    locked: true,
    inGrace: false,
    reason: 'Backend validation has not succeeded within the 120-second playback security window.',
    lastBackendSuccessAtMs,
    firstBackendFailureAtMs,
    lockAtMs,
    lockedAtMs: lockAtMs,
    purgeCacheAfterOfflineMs: config.purgeCacheAfterOfflineMs,
    purgeDue,
    purgeDueAtMs,
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : fallback
}

function validTimestamp(value: unknown): number | undefined {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
}
