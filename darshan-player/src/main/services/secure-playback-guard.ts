import { EventEmitter } from 'events'
import { getConfigManager } from '../../common/config'
import { evaluateSecurePlaybackState, type SecurePlaybackEvaluation } from '../../common/offline-security-policy'
import type { AppConfig, PlayerSecurityLockStatus } from '../../common/types'
import { getLogger } from '../../common/logger'

const logger = getLogger('secure-playback-guard')

export interface SecurePlaybackGuardOptions {
  now?: () => number
  configProvider?: () => AppConfig
}

export interface SecurePlaybackGuardStatus extends PlayerSecurityLockStatus {
  allowed: boolean
  purgeDueAt?: string
}

export class SecurePlaybackGuard extends EventEmitter {
  private readonly now: () => number
  private readonly configProvider: () => AppConfig
  private lastBackendSuccessAtMs?: number
  private firstBackendFailureAtMs?: number
  private currentStatus: SecurePlaybackGuardStatus
  private timer?: NodeJS.Timeout
  private purgeRequested = false

  constructor(options: SecurePlaybackGuardOptions = {}) {
    super()
    this.now = options.now || Date.now
    this.configProvider = options.configProvider || (() => getConfigManager().getConfig())
    this.currentStatus = this.evaluate()
  }

  seedBackendSuccess(timestampMs?: number | null): void {
    if (!Number.isFinite(timestampMs) || Number(timestampMs) <= 0) {
      return
    }

    if (!this.lastBackendSuccessAtMs || Number(timestampMs) > this.lastBackendSuccessAtMs) {
      this.lastBackendSuccessAtMs = Number(timestampMs)
      this.refresh('seed-backend-success')
    }
  }

  markBackendSuccess(source: string): void {
    this.lastBackendSuccessAtMs = this.now()
    this.firstBackendFailureAtMs = undefined
    this.purgeRequested = false
    logger.debug({ source }, 'Secure playback backend success observed')
    this.refresh(source)
  }

  markBackendFailure(source: string, error?: unknown): void {
    if (!this.evaluateRaw().enabled) {
      return
    }

    if (!this.firstBackendFailureAtMs) {
      this.firstBackendFailureAtMs = this.now()
    }
    logger.warn({ source, error }, 'Secure playback backend failure observed')
    this.refresh(source)
  }

  reset(): void {
    this.lastBackendSuccessAtMs = undefined
    this.firstBackendFailureAtMs = undefined
    this.purgeRequested = false
    this.clearTimer()
    this.refresh('reset')
  }

  getStatus(): SecurePlaybackGuardStatus {
    this.currentStatus = this.evaluate()
    this.scheduleTimer(this.currentStatus)
    return { ...this.currentStatus }
  }

  isPlaybackLocked(): boolean {
    return this.getStatus().locked
  }

  private refresh(source: string): void {
    const previous = this.currentStatus
    const next = this.evaluate()
    this.currentStatus = next
    this.scheduleTimer(next)

    if (this.hasMeaningfulChange(previous, next)) {
      this.emit('changed', { ...next }, source)
    }

    if (next.purgeDue === true && !this.purgeRequested) {
      this.purgeRequested = true
      this.emit('purge-requested', { ...next }, source)
    }
  }

  private evaluateRaw(): SecurePlaybackEvaluation {
    return evaluateSecurePlaybackState({
      security: this.configProvider().security,
      nowMs: this.now(),
      lastBackendSuccessAtMs: this.lastBackendSuccessAtMs,
      firstBackendFailureAtMs: this.firstBackendFailureAtMs,
    })
  }

  private evaluate(): SecurePlaybackGuardStatus {
    return toGuardStatus(this.evaluateRaw())
  }

  private scheduleTimer(status: SecurePlaybackGuardStatus): void {
    this.clearTimer()
    if (!status.enabled) {
      return
    }

    const nowMs = this.now()
    const nextAt = status.locked ? parseIsoMs(status.purgeDueAt) : parseIsoMs(status.lockAt)

    if (!nextAt || nextAt <= nowMs) {
      return
    }

    const delayMs = Math.min(nextAt - nowMs + 1, 2147483647)
    this.timer = setTimeout(() => this.refresh('timer'), delayMs)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  private hasMeaningfulChange(previous: SecurePlaybackGuardStatus, next: SecurePlaybackGuardStatus): boolean {
    return (
      previous.enabled !== next.enabled ||
      previous.locked !== next.locked ||
      previous.inGrace !== next.inGrace ||
      previous.reason !== next.reason ||
      previous.lastBackendSuccessAt !== next.lastBackendSuccessAt ||
      previous.firstBackendFailureAt !== next.firstBackendFailureAt ||
      previous.lockAt !== next.lockAt ||
      previous.purgeDue !== next.purgeDue
    )
  }
}

function toGuardStatus(evaluation: SecurePlaybackEvaluation): SecurePlaybackGuardStatus {
  return {
    enabled: evaluation.enabled,
    allowed: evaluation.allowed,
    locked: evaluation.locked,
    inGrace: evaluation.inGrace,
    reason: evaluation.reason,
    lastBackendSuccessAt: isoOrUndefined(evaluation.lastBackendSuccessAtMs),
    firstBackendFailureAt: isoOrUndefined(evaluation.firstBackendFailureAtMs),
    lockedAt: isoOrUndefined(evaluation.lockedAtMs),
    lockAt: isoOrUndefined(evaluation.lockAtMs),
    purgeCacheAfterOfflineMs: evaluation.purgeCacheAfterOfflineMs,
    purgeDue: evaluation.purgeDue,
    purgeDueAt: isoOrUndefined(evaluation.purgeDueAtMs),
  }
}

function isoOrUndefined(value?: number): string | undefined {
  return Number.isFinite(value) ? new Date(value as number).toISOString() : undefined
}

function parseIsoMs(value?: string): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

let securePlaybackGuard: SecurePlaybackGuard | null = null

export function getSecurePlaybackGuard(): SecurePlaybackGuard {
  if (!securePlaybackGuard) {
    securePlaybackGuard = new SecurePlaybackGuard()
  }
  return securePlaybackGuard
}

export function resetSecurePlaybackGuard(): void {
  securePlaybackGuard?.reset()
  securePlaybackGuard = null
}
