import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import {
  DeviceApiError,
  BackendPairingStatusResponse,
  BackendPairingValidationStatus,
  PairingCodeRequest,
  PairingCodeResponse,
  PairingResponse,
  PairingStatusResponse,
  PlaybackMode,
  PlayerPresentationSnapshot,
  PlayerState,
  PlayerStatus,
  TimelineItem,
} from '../../common/types'
import { getLogger } from '../../common/logger'
import { getConfigManager } from '../../common/config'
import { ExponentialBackoff } from '../../common/utils'
import { getDeviceStateStore } from './device-state-store'
import { getPairingService } from './pairing-service'
import { getSnapshotManager, PlaybackPlaylist } from './snapshot-manager'
import { getPlaybackEngine } from './playback/playback-engine'
import { getTelemetryService } from './telemetry/telemetry-service'
import { getHeartbeatService } from './telemetry/heartbeat'
import { getCommandProcessor } from './command-processor'
import { getScreenshotService } from './screenshot-service'
import { getDefaultMediaService } from './settings/default-media-service'
import { getLifecycleEvents, RuntimeAuthFailureEvent } from './lifecycle-events'
import { getHttpClient } from './network/http-client'
import { getPlayerMetrics } from './telemetry/player-metrics'
import { getDisplayManager } from './display-manager'
import { getRealtimeService } from './realtime-service'
import { getSecurePlaybackGuard, type SecurePlaybackGuardStatus } from './secure-playback-guard'
import { clearMediaCacheTargets } from './media-cache-purge'

const logger = getLogger('player-flow')
const PAIRING_POLL_INTERVAL_MS = 5000
const DEFAULT_PAIRING_VALIDATION_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000

const VALID_BACKEND_PAIRING_STATUSES = new Set<BackendPairingValidationStatus>(['VALID', 'VALID_NO_CONTENT'])
const STALE_BACKEND_PAIRING_STATUSES = new Set<BackendPairingValidationStatus>([
  'UNPAIRED',
  'INVALID_TOKEN',
  'SCREEN_NOT_FOUND',
  'SCREEN_DELETED',
  'PAIRING_REVOKED',
  'ORPHANED_CREDENTIAL',
  'ENVIRONMENT_MISMATCH',
  'RECLAIM_REQUIRED',
  'BACKEND_REPAIR_REQUIRED',
])

function requiresTimelinePlayback(playlist: PlaybackPlaylist): boolean {
  return (playlist.mode === 'normal' || playlist.mode === 'emergency') && playlist.items.length > 0
}

export class PlayerFlow extends EventEmitter {
  private state: PlayerState = 'BOOT'
  private status: PlayerStatus = {
    state: 'BOOT',
    mode: 'empty',
    online: false,
    backendAvailable: false,
  }
  private statusRevision = 0
  private mainWindow?: BrowserWindow
  private runtimeLoopsStarted = false
  private playbackReady = false
  private snapshotListenerBound = false
  private lifecycleEventsBound = false
  private defaultMediaListenerBound = false
  private securePlaybackGuardBound = false
  private securePlaybackPurgeCompleted = false
  private rendererServicesInitialized = false
  private screenshotInterval?: NodeJS.Timeout
  private pairingPollTimer?: NodeJS.Timeout
  private bootstrapRetryTimer?: NodeJS.Timeout
  private readonly bootstrapBackoff = new ExponentialBackoff(2000, 30000, 10, 0.2)
  private readonly pairingPollBackoff = new ExponentialBackoff(2000, 30000, 10, 0.2)
  private readonly store = getDeviceStateStore()
  private readonly pairingService = getPairingService()
  private readonly lifecycleEvents = getLifecycleEvents()
  private readonly onRuntimeAuthFailure = (event: RuntimeAuthFailureEvent): void => {
    void this.handleRuntimeAuthFailure(event)
  }
  private readonly onDefaultMediaChanged = (): void => {
    this.refreshPlaybackStatusFromCurrentState()
  }
  private readonly onSecurePlaybackChanged = (status: SecurePlaybackGuardStatus): void => {
    void this.handleSecurePlaybackStatus(status)
  }
  private readonly onSecurePlaybackPurgeRequested = (status: SecurePlaybackGuardStatus): void => {
    void this.handleSecurePlaybackPurgeRequest(status)
  }

  constructor() {
    super()
    getPlayerMetrics().setPlayerState(this.state)
    this.store.onChange(() => {
      this.refreshStatusFromState()
    })
  }

  initialize(mainWindow: BrowserWindow): void {
    this.attachWindow(mainWindow)

    if (this.rendererServicesInitialized) {
      return
    }
    this.rendererServicesInitialized = true

    const playbackEngine = getPlaybackEngine()
    playbackEngine.on('item-playing', (item: TimelineItem) => {
      this.updateStatus({
        currentMediaId: item.mediaId || item.id,
      })
    })

    this.bindLifecycleEvents()
    this.bindSnapshotListener()
    this.bindDefaultMediaListener()
    this.bindSecurePlaybackGuard()
  }

  /** Rebind long-lived services after the renderer window is recreated. */
  attachWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    const playbackEngine = getPlaybackEngine()
    playbackEngine.initialize(mainWindow)
    getScreenshotService().initialize(mainWindow)
    getDefaultMediaService().initialize(mainWindow)

    // `loadFile()` has completed before reattachment, so renderer listeners
    // are registered. Restore the in-flight timeline item immediately rather
    // than showing a blank/default surface until the next scheduler boundary.
    if (
      this.playbackReady &&
      ['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(this.status.state)
    ) {
      playbackEngine.restoreCurrentItemInRenderer()
    }
  }

  async start(): Promise<void> {
    this.bindLifecycleEvents()
    this.bindSnapshotListener()
    this.bindSecurePlaybackGuard()
    await this.transitionState('BOOT', {
      error: 'Starting player...',
    })

    const persisted = this.store.getState()
    if (persisted.lastPairingValidatedAt) {
      getSecurePlaybackGuard().seedBackendSuccess(Date.parse(persisted.lastPairingValidatedAt))
    }
    const identity = this.pairingService.getStoredIdentityHealth()
    const trustworthyDeviceId = this.pairingService.hasTrustworthyDeviceId()

    if (identity.health === 'complete' && trustworthyDeviceId) {
      await this.transitionState('LOCAL_IDENTITY_PRESENT', {
        error: 'Stored device identity found. Validating pairing with backend...',
        backendAvailable: false,
        awaitingManualRecovery: false,
      })
      await this.bootstrapAuthenticatedRuntime()
      return
    }

    if (persisted.pairingCode && trustworthyDeviceId && this.isPairingCodeStillValid(persisted.pairingExpiresAt)) {
      await this.transitionState('PAIRING_PENDING', {
        error: 'Waiting for admin approval...',
      })
      this.startPairingStatusPolling()
      return
    }

    if (identity.health === 'partial' && trustworthyDeviceId) {
      await this.enterRecoveryRequired(identity.issues.join('. ') || 'Stored device identity is incomplete')
      return
    }

    await this.enterHardRecovery('No trustworthy persisted device identity is available')
  }

  getState(): PlayerState {
    return this.state
  }

  getStatus(): PlayerStatus {
    return { ...this.status }
  }

  getPresentationSnapshot(): PlayerPresentationSnapshot {
    return {
      revision: this.statusRevision,
      status: this.getStatus(),
      display: getDisplayManager().getProfile(),
    }
  }

  /** Publish a display-only update through the same monotonic renderer stream. */
  refreshPresentation(): void {
    this.updateStatus({})
  }

  async requestPairingCode(overrides?: Partial<PairingCodeRequest>): Promise<PairingCodeResponse | null> {
    const fallbackState: Extract<PlayerState, 'HARD_RECOVERY' | 'PAIRING_PENDING'> =
      this.state === 'PAIRING_PENDING' || this.state === 'PAIRING_CONFIRMED' || this.state === 'PAIRING_COMPLETING'
        ? 'PAIRING_PENDING'
        : 'HARD_RECOVERY'
    return await this.requestFreshPairingCode(overrides, fallbackState)
  }

  async checkPairingStatus(): Promise<PairingStatusResponse> {
    return await this.pairingService.fetchPairingStatus()
  }

  async completePairing(): Promise<PairingResponse | null> {
    return await this.attemptPairingCompletion()
  }

  async performAction(
    action: 'retry-recovery' | 're-pair' | 'reset-doubtful-pairing' | 'refresh-pairing',
    payload?: Partial<PairingCodeRequest>
  ): Promise<void> {
    switch (action) {
      case 'retry-recovery':
        await this.retryRecovery()
        break
      case 're-pair':
      case 'refresh-pairing':
      case 'reset-doubtful-pairing':
        await this.enterHardRecovery('Fresh pairing requested', payload)
        break
      default:
        break
    }
  }

  async refreshSnapshot(): Promise<void> {
    await getSnapshotManager().refreshSnapshot()
  }

  stop(): void {
    this.stopPairingTimers()
    this.stopBootstrapRetryTimer()
    this.stopRuntimeLoops(false)
    this.unbindLifecycleEvents()
    this.unbindDefaultMediaListener()
    this.unbindSecurePlaybackGuard()
  }

  private bindLifecycleEvents(): void {
    if (this.lifecycleEventsBound) {
      return
    }

    this.lifecycleEvents.onRuntimeAuthFailure(this.onRuntimeAuthFailure)
    this.lifecycleEventsBound = true
  }

  private unbindLifecycleEvents(): void {
    if (!this.lifecycleEventsBound) {
      return
    }

    this.lifecycleEvents.off('runtime-auth-failure', this.onRuntimeAuthFailure)
    this.lifecycleEventsBound = false
  }

  private bindSnapshotListener(): void {
    if (this.snapshotListenerBound) {
      return
    }

    this.snapshotListenerBound = true
    getSnapshotManager().on('playlist-updated', (playlist: PlaybackPlaylist) => {
      this.handlePlaylistUpdate(playlist)
    })
  }

  private bindDefaultMediaListener(): void {
    if (this.defaultMediaListenerBound) {
      return
    }

    getDefaultMediaService().on('changed', this.onDefaultMediaChanged)
    this.defaultMediaListenerBound = true
  }

  private unbindDefaultMediaListener(): void {
    if (!this.defaultMediaListenerBound) {
      return
    }

    getDefaultMediaService().off('changed', this.onDefaultMediaChanged)
    this.defaultMediaListenerBound = false
  }

  private bindSecurePlaybackGuard(): void {
    if (this.securePlaybackGuardBound) {
      return
    }

    const guard = getSecurePlaybackGuard()
    guard.on('changed', this.onSecurePlaybackChanged)
    guard.on('purge-requested', this.onSecurePlaybackPurgeRequested)
    this.securePlaybackGuardBound = true
    this.updateStatus({
      securityLock: this.toPlayerSecurityLockStatus(guard.getStatus()),
    })
  }

  private unbindSecurePlaybackGuard(): void {
    if (!this.securePlaybackGuardBound) {
      return
    }

    const guard = getSecurePlaybackGuard()
    guard.off('changed', this.onSecurePlaybackChanged)
    guard.off('purge-requested', this.onSecurePlaybackPurgeRequested)
    this.securePlaybackGuardBound = false
  }

  private restoreCachedPlayback(): void {
    const cachedPlaylist = getSnapshotManager().getCurrentPlaylist()
    if (!cachedPlaylist) {
      return
    }

    this.handlePlaylistUpdate(cachedPlaylist)
  }

  private async bootstrapAuthenticatedRuntime(): Promise<void> {
    this.stopPairingTimers()
    this.stopBootstrapRetryTimer()
    this.bindSnapshotListener()

    await this.transitionState('BOOTSTRAP_AUTH', {
      error: 'Validating device pairing with backend...',
      backendAvailable: false,
      awaitingManualRecovery: false,
    })

    try {
      const pairingStatus = await this.validateBackendPairingStatus()
      if (!pairingStatus) {
        return
      }
      getSecurePlaybackGuard().markBackendSuccess('pairing-status')

      this.restoreCachedPlayback()
      await this.probeAuthenticatedSnapshot()
      await this.applyBootstrapScreenshotPolicy()
      await getSnapshotManager().refreshSnapshot()
      await getHeartbeatService().sendImmediate()
      await this.startRuntimeLoops()
      await this.store.update({
        lifecycleState: 'PAIRED_RUNTIME',
        recoveryReason: undefined,
        hardRecoveryDeadlineAt: undefined,
      })
      await this.transitionState('PAIRED_RUNTIME', {
        backendAvailable: true,
        awaitingManualRecovery: false,
        error: undefined,
        recoveryReason: undefined,
      })
      this.bootstrapBackoff.reset()
    } catch (error) {
      await this.handleBootstrapFailure(error)
    }
  }

  private async applyBootstrapScreenshotPolicy(): Promise<void> {
    const policy = await this.pairingService.fetchScreenshotPolicy()
    getScreenshotService().applyPolicy({
      enabled: policy?.enabled === true,
      interval_seconds: policy?.interval_seconds ?? null,
    })
  }

  private async validateBackendPairingStatus(): Promise<BackendPairingStatusResponse | null> {
    const status = await this.pairingService.fetchBackendPairingStatus()

    if (VALID_BACKEND_PAIRING_STATUSES.has(status.status)) {
      await this.pairingService.markPairingValidation(status)
      return status
    }

    if (STALE_BACKEND_PAIRING_STATUSES.has(status.status)) {
      const message =
        status.message ||
        `Stored device identity is not valid for this backend (${status.status}). Fresh pairing is required.`
      await this.enterHardRecovery(message)
      return null
    }

    throw new Error(`Unsupported backend pairing status: ${status.status}`)
  }

  private async startRuntimeLoops(): Promise<void> {
    if (this.runtimeLoopsStarted) {
      return
    }

    this.runtimeLoopsStarted = true
    getCommandProcessor().start()
    await getTelemetryService().start()
    getSnapshotManager().start()
    getDefaultMediaService().start()
    getRealtimeService().start()
    this.startScreenshotLoop()
  }

  private stopRuntimeLoops(stopPlayback: boolean): void {
    getCommandProcessor().stop()
    void getTelemetryService().stop()
    getSnapshotManager().stop()
    getDefaultMediaService().stop()
    getRealtimeService().stop()
    this.stopScreenshotLoop()
    this.runtimeLoopsStarted = false

    if (stopPlayback) {
      getPlaybackEngine().stop()
      this.playbackReady = false
    }
  }

  private clearIdentityBoundRuntimeState(): void {
    getPlaybackEngine().stop()
    this.playbackReady = false
    getSecurePlaybackGuard().reset()
    this.securePlaybackPurgeCompleted = false
    getSnapshotManager().clearIdentityBoundState()
    getDefaultMediaService().clearIdentityBoundState()
  }

  private resolveVisiblePlaybackMode(playlist: PlaybackPlaylist): PlaybackMode {
    if (requiresTimelinePlayback(playlist)) {
      return playlist.mode
    }

    if (playlist.mode === 'offline') {
      return 'offline'
    }

    return getDefaultMediaService().getCurrent().media_id ? 'default' : 'empty'
  }

  private refreshPlaybackStatusFromCurrentState(): void {
    const playlist = getSnapshotManager().getCurrentPlaylist()
    if (playlist) {
      this.handlePlaylistUpdate(playlist)
      return
    }

    if (
      this.state !== 'PAIRED_RUNTIME' &&
      this.state !== 'BOOTSTRAP_AUTH' &&
      this.state !== 'OFFLINE_USING_LAST_VALID_PAIRING'
    ) {
      return
    }

    this.updateStatus({
      mode: getDefaultMediaService().getCurrent().media_id ? 'default' : 'empty',
      currentMediaId: undefined,
      securityLock: this.toPlayerSecurityLockStatus(getSecurePlaybackGuard().getStatus()),
    })
  }

  private handlePlaylistUpdate(playlist: PlaybackPlaylist): void {
    const securePlaybackStatus = getSecurePlaybackGuard().getStatus()
    if (securePlaybackStatus.locked) {
      if (this.playbackReady) {
        getPlaybackEngine().stop()
        this.playbackReady = false
      }

      this.updateStatus({
        mode: 'offline',
        online: false,
        scheduleId: playlist.scheduleId,
        currentMediaId: undefined,
        lastSnapshotAt: playlist.lastSnapshotAt,
        backendAvailable: false,
        error: securePlaybackStatus.reason,
        securityLock: this.toPlayerSecurityLockStatus(securePlaybackStatus),
      })
      return
    }

    if (requiresTimelinePlayback(playlist)) {
      if (!this.playbackReady) {
        void getPlaybackEngine().start()
        this.playbackReady = true
      }
    } else if (this.playbackReady) {
      getPlaybackEngine().stop()
      this.playbackReady = false
    }

    this.updateStatus({
      mode: this.resolveVisiblePlaybackMode(playlist),
      online: playlist.mode !== 'offline',
      scheduleId: playlist.scheduleId,
      currentMediaId: requiresTimelinePlayback(playlist) ? this.status.currentMediaId : undefined,
      lastSnapshotAt: playlist.lastSnapshotAt,
      backendAvailable: playlist.mode !== 'offline',
      securityLock: this.toPlayerSecurityLockStatus(securePlaybackStatus),
    })
  }

  private async handleSecurePlaybackStatus(status: SecurePlaybackGuardStatus): Promise<void> {
    if (status.locked) {
      getPlaybackEngine().stop()
      this.playbackReady = false

      this.updateStatus({
        mode: 'offline',
        online: false,
        backendAvailable: false,
        currentMediaId: undefined,
        error: status.reason,
        securityLock: this.toPlayerSecurityLockStatus(status),
      })
      return
    }

    this.updateStatus({
      securityLock: this.toPlayerSecurityLockStatus(status),
      error: this.state === 'PAIRED_RUNTIME' ? undefined : this.status.error,
    })

    if (this.state === 'PAIRED_RUNTIME' || this.state === 'OFFLINE_USING_LAST_VALID_PAIRING') {
      this.refreshPlaybackStatusFromCurrentState()
    }
  }

  private async handleSecurePlaybackPurgeRequest(status: SecurePlaybackGuardStatus): Promise<void> {
    if (this.securePlaybackPurgeCompleted || !status.locked || status.purgeDue !== true) {
      return
    }

    this.securePlaybackPurgeCompleted = true
    try {
      const removed = clearMediaCacheTargets(getConfigManager().getConfig().cache.path)
      logger.warn({ removed }, 'Secure offline playback lock purged media cache targets')
    } catch (error) {
      this.securePlaybackPurgeCompleted = false
      logger.error({ error }, 'Secure offline playback lock failed to purge media cache targets')
    }
  }

  private toPlayerSecurityLockStatus(status: SecurePlaybackGuardStatus): PlayerStatus['securityLock'] {
    return {
      enabled: status.enabled,
      locked: status.locked,
      inGrace: status.inGrace,
      reason: status.reason,
      lastBackendSuccessAt: status.lastBackendSuccessAt,
      firstBackendFailureAt: status.firstBackendFailureAt,
      lockedAt: status.lockedAt,
      lockAt: status.lockAt,
      purgeCacheAfterOfflineMs: status.purgeCacheAfterOfflineMs,
      purgeDue: status.purgeDue,
    }
  }

  private startScreenshotLoop(): void {
    this.stopScreenshotLoop()
    const scheduleNext = (): void => {
      if (!this.runtimeLoopsStarted) {
        return
      }

      const intervalMs = getConfigManager().getConfig().intervals.screenshotMs
      this.screenshotInterval = setTimeout((): void => {
        void (async (): Promise<void> => {
          try {
            if (getScreenshotService().isCaptureEnabled()) {
              await getScreenshotService().captureAndUpload()
            }
          } catch (error) {
            logger.warn({ error }, 'Screenshot upload failed')
          } finally {
            scheduleNext()
          }
        })()
      }, intervalMs)
    }

    scheduleNext()
  }

  private stopScreenshotLoop(): void {
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval)
      this.screenshotInterval = undefined
    }
  }

  private async probeAuthenticatedSnapshot(): Promise<void> {
    const deviceId = this.pairingService.getDeviceId()
    if (!deviceId || !this.pairingService.hasTrustworthyDeviceId()) {
      throw new Error('Invalid or missing stored device id')
    }

    try {
      const response = await getHttpClient().get(`/api/v1/device/${deviceId}/snapshot?include_urls=true`, {
        retry: false,
      })
      if (response && typeof response === 'object' && (response as Record<string, unknown>)['success'] === false) {
        throw new Error(
          String((response as { error?: { message?: string } }).error?.message || 'Snapshot request failed')
        )
      }
    } catch (error) {
      if (
        error instanceof DeviceApiError &&
        error.code === 'NOT_FOUND' &&
        !error.message.includes('Device not registered')
      ) {
        return
      }
      throw error
    }
  }

  private async handleBootstrapFailure(error: unknown): Promise<void> {
    logger.warn(
      {
        error,
        code: error instanceof DeviceApiError ? error.code : undefined,
        transient: error instanceof DeviceApiError ? error.transient : undefined,
        details: error instanceof DeviceApiError ? error.detailsPayload : undefined,
        deviceId: this.pairingService.getDeviceId(),
        state: this.state,
      },
      'Bootstrap authenticated runtime failed'
    )

    const backendPairingStatus = this.pairingService.getBackendPairingStatusFromError(error)
    if (backendPairingStatus && STALE_BACKEND_PAIRING_STATUSES.has(backendPairingStatus)) {
      await this.enterHardRecovery((error as Error).message || `Pairing is invalid (${backendPairingStatus})`)
      return
    }

    if (this.pairingService.isDeviceNotRegisteredError(error) || !this.pairingService.hasTrustworthyDeviceId()) {
      await this.enterHardRecovery((error as Error).message || 'Stored device identity is no longer registered')
      return
    }

    if (this.pairingService.isInvalidCredentialError(error)) {
      await this.enterRecoveryRequired((error as Error).message || 'Device credentials are no longer valid')
      return
    }

    if (this.pairingService.isTransientRuntimeError(error)) {
      getSecurePlaybackGuard().markBackendFailure('bootstrap', error)
      if (this.canUseOfflineLastValidatedPairing()) {
        await this.enterOfflineUsingLastValidPairing((error as Error).message || 'Backend is temporarily unavailable')
      } else {
        await this.enterPairingValidationRequired(
          (error as Error).message || 'Backend is unavailable and this local pairing has never been validated'
        )
      }
      return
    }

    await this.enterRecoveryRequired((error as Error).message || 'Unable to validate stored device credentials')
  }

  private canUseOfflineLastValidatedPairing(): boolean {
    const state = this.store.getState()
    const deviceId = this.pairingService.getDeviceId()
    if (!deviceId || state.lastValidatedDeviceId !== deviceId) {
      return false
    }
    if (!state.lastPairingValidationStatus || !VALID_BACKEND_PAIRING_STATUSES.has(state.lastPairingValidationStatus)) {
      return false
    }
    if (!state.lastPairingValidatedAt) {
      return false
    }

    const validatedAt = Date.parse(state.lastPairingValidatedAt)
    if (Number.isNaN(validatedAt)) {
      return false
    }

    const offlineGraceMs =
      getConfigManager().getConfig().pairing?.offlineValidationGraceMs ?? DEFAULT_PAIRING_VALIDATION_OFFLINE_GRACE_MS
    return Date.now() - validatedAt <= offlineGraceMs
  }

  private async enterOfflineUsingLastValidPairing(reason: string): Promise<void> {
    this.stopPairingTimers()
    this.stopRuntimeLoops(false)
    this.restoreCachedPlayback()

    await this.store.update({
      lifecycleState: 'OFFLINE_USING_LAST_VALID_PAIRING',
      recoveryReason: reason,
    })

    await this.transitionState('OFFLINE_USING_LAST_VALID_PAIRING', {
      online: false,
      backendAvailable: false,
      awaitingManualRecovery: false,
      error: reason,
      recoveryReason: reason,
    })

    this.scheduleBootstrapRetry(this.bootstrapBackoff.getDelay())
  }

  private async enterPairingValidationRequired(reason: string): Promise<void> {
    this.stopPairingTimers()
    this.stopRuntimeLoops(false)

    await this.store.update({
      lifecycleState: 'LOCAL_IDENTITY_PRESENT',
      recoveryReason: reason,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      activePairingMode: undefined,
    })

    await this.transitionState('LOCAL_IDENTITY_PRESENT', {
      mode: 'empty',
      online: false,
      backendAvailable: false,
      awaitingManualRecovery: true,
      error: reason,
      recoveryReason: reason,
    })

    this.scheduleBootstrapRetry(this.bootstrapBackoff.getDelay())
  }

  private scheduleBootstrapRetry(delayMs: number): void {
    this.stopBootstrapRetryTimer()
    this.bootstrapRetryTimer = setTimeout(() => {
      void this.bootstrapAuthenticatedRuntime()
    }, delayMs)
  }

  private stopBootstrapRetryTimer(): void {
    if (this.bootstrapRetryTimer) {
      clearTimeout(this.bootstrapRetryTimer)
      this.bootstrapRetryTimer = undefined
    }
  }

  private async enterRecoveryRequired(reason: string): Promise<void> {
    this.stopBootstrapRetryTimer()
    this.stopRuntimeLoops(false)

    await this.store.update({
      lifecycleState: 'RECOVERY_REQUIRED',
      recoveryReason: reason,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      activePairingMode: undefined,
      hardRecoveryDeadlineAt: undefined,
    })

    await this.transitionState('RECOVERY_REQUIRED', {
      backendAvailable: true,
      awaitingManualRecovery: true,
      error: reason,
      recoveryReason: reason,
    })

    this.startPairingStatusPolling()
  }

  private async enterHardRecovery(reason: string, overrides?: Partial<PairingCodeRequest>): Promise<void> {
    this.stopBootstrapRetryTimer()
    this.stopPairingTimers()
    this.stopRuntimeLoops(false)
    this.clearIdentityBoundRuntimeState()

    await this.store.update({
      lifecycleState: 'HARD_RECOVERY',
      recoveryReason: reason,
      hardRecoveryDeadlineAt: undefined,
    })

    await this.transitionState('HARD_RECOVERY', {
      online: false,
      backendAvailable: true,
      awaitingManualRecovery: false,
      error: reason,
      recoveryReason: reason,
      hardRecoveryDeadlineAt: undefined,
    })

    await this.pairingService.resetStoredIdentity(reason)
    await this.requestFreshPairingCode(overrides, 'HARD_RECOVERY')
  }

  private async requestFreshPairingCode(
    overrides?: Partial<PairingCodeRequest>,
    failureState: Extract<PlayerState, 'HARD_RECOVERY' | 'PAIRING_PENDING'> = 'HARD_RECOVERY'
  ): Promise<PairingCodeResponse | null> {
    this.stopPairingTimers()

    try {
      const response = await this.pairingService.requestPairingCode(overrides)
      this.pairingPollBackoff.reset()
      await this.transitionState('PAIRING_PENDING', {
        error: 'Waiting for admin approval...',
      })
      this.startPairingStatusPolling()
      return response
    } catch (error) {
      logger.error({ error }, 'Pairing request failed')
      await this.pairingService.markPairingRequestInDoubt((error as Error).message)
      await this.transitionState(failureState, {
        error: (error as Error).message,
        recoveryReason: (error as Error).message,
      })
      return null
    }
  }

  private startPairingStatusPolling(): void {
    this.stopPairingTimers()
    this.schedulePairingStatusPoll(0)
  }

  private schedulePairingStatusPoll(delayMs: number): void {
    this.pairingPollTimer = setTimeout(() => {
      void this.pollPairingStatus()
    }, delayMs)
  }

  private stopPairingTimers(): void {
    if (this.pairingPollTimer) {
      clearTimeout(this.pairingPollTimer)
      this.pairingPollTimer = undefined
    }
  }

  private async pollPairingStatus(): Promise<void> {
    if (this.state === 'RECOVERY_REQUIRED') {
      await this.pollRecoveryStatus()
      return
    }

    if (this.state !== 'PAIRING_PENDING' && this.state !== 'PAIRING_CONFIRMED' && this.state !== 'PAIRING_COMPLETING') {
      return
    }

    const current = this.store.getState()
    if (!this.isPairingCodeStillValid(current.pairingExpiresAt)) {
      await this.pairingService.clearPairingMetadata()
      await this.enterHardRecovery('Fresh pairing code expired before completion')
      return
    }

    try {
      const status = await this.pairingService.fetchPairingStatus()
      const activePairing = status.active_pairing || null
      await this.syncActivePairingMetadata(activePairing)
      this.pairingPollBackoff.reset()

      if (activePairing?.mode === 'PAIRING' && activePairing.confirmed) {
        await this.transitionState('PAIRING_CONFIRMED', {
          error: 'Pairing confirmed. Provisioning credentials...',
        })
        await this.attemptPairingCompletion()
        return
      }

      await this.transitionState('PAIRING_PENDING', {
        error: 'Waiting for admin approval...',
      })
      this.schedulePairingStatusPoll(PAIRING_POLL_INTERVAL_MS)
    } catch (error) {
      logger.warn({ error }, 'Pairing status poll failed')
      const delay = this.pairingPollBackoff.getDelay()
      await this.transitionState('PAIRING_PENDING', {
        error: (error as Error).message,
      })
      this.schedulePairingStatusPoll(delay)
    }
  }

  private async pollRecoveryStatus(): Promise<void> {
    if (!this.pairingService.hasTrustworthyDeviceId()) {
      await this.enterHardRecovery('Stored device id is no longer usable')
      return
    }

    try {
      const status = await this.pairingService.fetchPairingStatus()
      const activePairing = status.active_pairing || null
      await this.syncActivePairingMetadata(activePairing)
      this.pairingPollBackoff.reset()

      if (activePairing?.mode === 'RECOVERY' && activePairing.confirmed) {
        if (!this.store.getState().pairingCode) {
          logger.error(
            {
              activePairingId: activePairing.id,
              expiresAt: activePairing.expires_at,
            },
            'Recovery pairing is confirmed but backend status did not return pairing_code'
          )
          await this.transitionState('RECOVERY_REQUIRED', {
            error: 'Recovery confirmed, but backend did not return the recovery code yet.',
            recoveryReason: 'Recovery confirmed, but backend did not return the recovery code yet.',
          })
          this.schedulePairingStatusPoll(PAIRING_POLL_INTERVAL_MS)
          return
        }

        await this.transitionState('PAIRING_CONFIRMED', {
          error: 'Recovery confirmed. Provisioning replacement credentials...',
        })
        await this.attemptPairingCompletion()
        return
      }

      await this.transitionState('RECOVERY_REQUIRED', {
        error:
          activePairing?.mode === 'RECOVERY'
            ? 'Waiting for admin to confirm device recovery...'
            : 'Waiting for admin to start recovery for this screen identity...',
        recoveryReason: this.status.recoveryReason,
      })
      this.schedulePairingStatusPoll(PAIRING_POLL_INTERVAL_MS)
    } catch (error) {
      const backendPairingStatus = this.pairingService.getBackendPairingStatusFromError(error)
      if (backendPairingStatus && STALE_BACKEND_PAIRING_STATUSES.has(backendPairingStatus)) {
        await this.enterHardRecovery((error as Error).message || `Pairing is invalid (${backendPairingStatus})`)
        return
      }

      if (this.pairingService.isDeviceNotRegisteredError(error)) {
        await this.enterHardRecovery((error as Error).message || 'Device not registered in backend')
        return
      }

      logger.warn({ error }, 'Recovery status poll failed')
      await this.transitionState('RECOVERY_REQUIRED', {
        error: (error as Error).message,
        recoveryReason: this.status.recoveryReason,
      })
      this.schedulePairingStatusPoll(this.pairingPollBackoff.getDelay())
    }
  }

  private async syncActivePairingMetadata(activePairing: PairingStatusResponse['active_pairing']): Promise<void> {
    if (!activePairing) {
      return
    }

    await this.store.update({
      activePairingMode: activePairing.mode,
      pairingCode: activePairing.pairing_code || this.store.getState().pairingCode,
      pairingExpiresAt: activePairing.expires_at || this.store.getState().pairingExpiresAt,
    })
  }

  private async attemptPairingCompletion(): Promise<PairingResponse | null> {
    const currentMode = this.store.getState().activePairingMode
    const pairingCode = this.pairingService.getLastPairingCode()

    if (!pairingCode) {
      if (currentMode === 'RECOVERY') {
        await this.enterRecoveryRequired('Recovery pairing is missing a pairing code')
      } else {
        await this.enterHardRecovery('Fresh pairing is missing a pairing code')
      }
      return null
    }

    await this.transitionState('PAIRING_COMPLETING', {
      error: 'Generating key and CSR, then requesting device certificate...',
    })

    try {
      const response = await this.pairingService.submitPairing(pairingCode)
      await this.bootstrapAuthenticatedRuntime()
      return response
    } catch (error) {
      if (this.pairingService.isPairingNotConfirmedError(error)) {
        if (currentMode === 'RECOVERY') {
          await this.enterRecoveryRequired('Recovery pairing is not confirmed yet. Continuing to poll...')
        } else {
          await this.transitionState('PAIRING_PENDING', {
            error: 'Pairing not confirmed yet. Continuing to poll...',
          })
          this.startPairingStatusPolling()
        }
        return null
      }

      if (this.pairingService.isExpiredPairingCodeError(error)) {
        await this.pairingService.clearPairingMetadata()
        if (currentMode === 'RECOVERY') {
          await this.enterRecoveryRequired(
            'Recovery pairing expired. Waiting for admin to create a new recovery pairing...'
          )
        } else {
          await this.enterHardRecovery('Fresh pairing code expired before completion')
        }
        return null
      }

      if (currentMode === 'RECOVERY') {
        await this.enterRecoveryRequired((error as Error).message || 'Failed to complete recovery pairing')
        return null
      }

      await this.transitionState('PAIRING_CONFIRMED', {
        error: (error as Error).message,
      })
      this.schedulePairingStatusPoll(this.pairingPollBackoff.getDelay())
      return null
    }
  }

  private async retryRecovery(): Promise<void> {
    const identity = this.pairingService.getStoredIdentityHealth()
    const trustworthyDeviceId = this.pairingService.hasTrustworthyDeviceId()

    if (identity.health === 'complete' && trustworthyDeviceId) {
      await this.bootstrapAuthenticatedRuntime()
      return
    }

    if (trustworthyDeviceId) {
      await this.enterRecoveryRequired(identity.issues.join('. ') || 'Device identity requires recovery')
      return
    }

    await this.enterHardRecovery('Stored device identity is not recoverable')
  }

  private async handleRuntimeAuthFailure(event: RuntimeAuthFailureEvent): Promise<void> {
    logger.warn(
      { source: event.source, code: event.error.code, message: event.error.message },
      'Runtime auth failure received'
    )

    if (
      this.state === 'PAIRING_PENDING' ||
      this.state === 'PAIRING_CONFIRMED' ||
      this.state === 'PAIRING_COMPLETING' ||
      this.state === 'HARD_RECOVERY'
    ) {
      return
    }

    if (this.pairingService.isDeviceNotRegisteredError(event.error)) {
      await this.enterHardRecovery('Device not registered in backend')
      return
    }

    if (this.pairingService.isInvalidCredentialError(event.error)) {
      await this.enterRecoveryRequired(event.error.message || 'Device credentials are no longer valid')
      return
    }

    if (this.pairingService.hasTrustworthyDeviceId()) {
      await this.enterRecoveryRequired(event.error.message || 'Device authentication requires recovery')
      return
    }

    await this.enterHardRecovery(event.error.message || 'Stored device identity is unusable')
  }

  private isPairingCodeStillValid(expiresAt?: string): boolean {
    if (!expiresAt) return false
    const parsed = Date.parse(expiresAt)
    return !Number.isNaN(parsed) && parsed > Date.now()
  }

  private async transitionState(next: PlayerState, statusPatch: Partial<PlayerStatus> = {}): Promise<void> {
    this.state = next
    await this.store.setLifecycleState(next)
    getPlayerMetrics().setPlayerState(next)

    if (
      next === 'LOCAL_IDENTITY_PRESENT' ||
      next === 'BOOTSTRAP_AUTH' ||
      next === 'RECOVERY_REQUIRED' ||
      next === 'HARD_RECOVERY' ||
      next === 'PAIRING_PENDING' ||
      next === 'PAIRING_CONFIRMED' ||
      next === 'PAIRING_COMPLETING'
    ) {
      this.updateStatus({
        mode: 'empty',
        online: false,
        ...statusPatch,
      })
    } else {
      this.updateStatus(statusPatch)
    }

    logger.info({ state: next }, 'Player state updated')
  }

  private refreshStatusFromState(): void {
    const persisted = this.store.getState()
    this.status = {
      ...this.status,
      state: persisted.lifecycleState || this.state,
      deviceId: persisted.deviceId,
      pairingCode: persisted.pairingCode,
      pairingExpiresAt: persisted.pairingExpiresAt,
      recoveryReason: persisted.recoveryReason,
      hardRecoveryDeadlineAt: persisted.hardRecoveryDeadlineAt,
      lastHeartbeatAt: persisted.lastHeartbeatAt,
    }
    getPlayerMetrics().setPlayerState(this.status.state)
    this.emitStatus()
  }

  private updateStatus(update: Partial<PlayerStatus>): void {
    this.status = {
      ...this.status,
      ...update,
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    this.statusRevision += 1
    const presentation = this.getPresentationSnapshot()
    this.emit('status', presentation.status)
    this.emit('presentation-status', presentation)
    if (this.mainWindow) {
      // Retain player-status until all renderer integrations have migrated.
      // New renderer code consumes the revisioned presentation event below.
      this.mainWindow.webContents.send('player-status', presentation.status)
      this.mainWindow.webContents.send('player-presentation', presentation)
    }
  }
}

let playerFlow: PlayerFlow | null = null

export function getPlayerFlow(): PlayerFlow {
  if (!playerFlow) {
    playerFlow = new PlayerFlow()
  }
  return playerFlow
}
