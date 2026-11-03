import { BrowserWindow } from 'electron'
import * as os from 'os'
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
  AppConfig,
  isDeviceApiError,
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
import { getCacheManager } from './cache/cache-manager'
import { getContentOwner } from './playback/content-owner'
import { LiveAuthorityClient } from './live-authority-client'
import { LivePlaybackCoordinator } from './live-playback-coordinator'
import { LiveViewManager } from './live-view-manager'
import type { LivePlaybackStatus } from '../../common/live-playback'

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
  private securePlaybackLockActive = false
  private rendererServicesInitialized = false
  private screenshotInterval?: NodeJS.Timeout
  private pairingPollTimer?: NodeJS.Timeout
  private pairingRenewalPromise?: Promise<PairingCodeResponse | null>
  private bootstrapRetryTimer?: NodeJS.Timeout
  private secureRecoveryRetryTimer?: NodeJS.Timeout
  private secureRecoveryPromise?: Promise<void>
  private liveCoordinator?: LivePlaybackCoordinator
  private liveView?: LiveViewManager
  private liveTransportRecoveryRequired = false
  private rendererDisposalFailed = false
  private stopping = false
  private fallbackTransition?: Promise<void>
  private fallbackRevision = 0
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
  private readonly onSecurePlaybackRecoveryRequested = (): void => {
    void this.startSecurePlaybackRecovery()
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
    this.liveCoordinator?.suspend('RENDERER_REATTACHED')
    this.mainWindow = mainWindow
    this.rendererDisposalFailed = false
    getContentOwner().attach(mainWindow)
    getContentOwner().advance(['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(this.state) ? 'ordinary' : 'blocked')
    this.initializeLivePlayback()

    const playbackEngine = getPlaybackEngine()
    playbackEngine.initialize(mainWindow)
    getScreenshotService().initialize(mainWindow)
    getDefaultMediaService().initialize(mainWindow)
    mainWindow.webContents.setAudioMuted(false)
    this.updateStatus({})

    // `loadFile()` has completed before reattachment, so renderer listeners
    // are registered. Restore the in-flight timeline item immediately rather
    // than showing a blank/default surface until the next scheduler boundary.
    if (
      this.playbackReady &&
      ['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(this.status.state)
    ) {
      playbackEngine.restoreCurrentItemInRenderer()
    }
    this.refreshPlaybackStatusFromCurrentState()
  }

  private initializeLivePlayback(): void {
    if (this.liveCoordinator) return
    this.liveView = new LiveViewManager(() => this.mainWindow)
    getScreenshotService().setContentCaptureProvider(() => this.liveView!.captureVisible())
    this.liveCoordinator = new LivePlaybackCoordinator({
      enabled: () => getConfigManager().getConfig().livePlayback?.enabled === true,
      createAuthority: () => {
        const deviceId = this.pairingService.getDeviceId()
        if (!deviceId) throw new Error('Paired device identity required')
        return new LiveAuthorityClient(deviceId, { development: getConfigManager().getConfig().runtime.mode === 'dev',
          runtimeSessionId: this.pairingService.getRuntimeSessionId() })
      }, cache: getSnapshotManager(), view: this.liveView,
      refreshControl: async () => {
        const snapshots = getSnapshotManager()
        const playlist = await snapshots.refreshSnapshot({ force: true })
        return { fresh: snapshots.didLastRefreshSucceed() && snapshots.getCurrentPlaylist() === playlist, playlist }
      },
      output: {
        fallback: (playlist, live) => this.applyLiveFallback(playlist, live),
        status: live => this.updateStatus({ mode: 'live', live, currentMediaId: live.phase === 'LIVE' ? undefined : this.status.currentMediaId }),
        disposeOrdinary: async isCurrent => {
          await this.fallbackTransition
          if (!isCurrent()) return false
          const window = this.mainWindow
          if (!window || window.isDestroyed()) return false
          const acknowledged = getContentOwner().disposeRenderer(window)
          getPlaybackEngine().stop()
          this.playbackReady = false
          this.updateStatus({ currentMediaId: undefined })
          const completed = await acknowledged
          if (!completed && isCurrent() && this.mainWindow === window && !window.isDestroyed()) {
            this.rendererDisposalFailed = true
            this.interruptLive('RENDERER_DISPOSAL_FAILED')
            window.webContents.reload()
          }
          return completed
        },
        released: () => {
          this.fallbackRevision += 1
          getPlaybackEngine().setExternalOwnership(false)
          getContentOwner().advance('ordinary')
          if (!this.rendererDisposalFailed && !this.stopping) this.mainWindow?.webContents.setAudioMuted(false)
          this.playbackReady = false
          this.updateStatus({ live: undefined, currentMediaId: undefined })
          queueMicrotask(() => { if (!this.stopping) this.refreshPlaybackStatusFromCurrentState() })
        },
        identityFailure: failure => {
          this.lifecycleEvents.emitRuntimeAuthFailure({ source: 'live', error: new DeviceApiError({
            status: failure.status ?? 401, code: failure.status === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED', message: 'Live device identity requires verification', transient: false,
          }) })
        },
      },
    })
  }

  private applyLiveFallback(playlist: PlaybackPlaylist, live: LivePlaybackStatus): void {
    const window = this.mainWindow
    if (!window || window.isDestroyed()) return
    if (this.rendererDisposalFailed) {
      window.webContents.setAudioMuted(true)
      getPlaybackEngine().stop()
      this.updateStatus({ mode: 'live', live: { ...live, phase: 'UNAVAILABLE', fallbackReady: false, reason: 'RENDERER_RECOVERY' }, currentMediaId: undefined })
      return
    }
    const owner = getContentOwner()
    getPlaybackEngine().setExternalOwnership(true)
    const display = (): void => {
      this.playbackReady = playlist.items.length > 0
      this.updateStatus({ mode: 'live', live, scheduleId: playlist.scheduleId, currentMediaId: owner.getOwner() === 'live-fallback' ? this.status.currentMediaId : undefined, contentUnavailableReason: playlist.unavailableReason, lastSnapshotAt: playlist.lastSnapshotAt ?? this.status.lastSnapshotAt })
      const contentEpoch = owner.getEpoch()
      if (playlist.items.length) void getPlaybackEngine().playOwnedFallback(playlist).catch(() => {
        if (owner.getEpoch() === contentEpoch && !this.stopping && this.liveCoordinator?.isOwningContent()) this.updateStatus({ live: { ...live, phase: 'UNAVAILABLE', fallbackReady: false, reason: 'FALLBACK_RENDER_FAILED' } })
      })
      else getPlaybackEngine().stop()
    }
    if (!playlist.items.length) {
      this.fallbackRevision += 1
      window.webContents.setAudioMuted(true)
      if (owner.getOwner() !== 'blocked') owner.advance('blocked')
      display()
      return
    }
    if (owner.getOwner() === 'live-fallback') { display(); return }
    const revision = ++this.fallbackRevision
    window.webContents.setAudioMuted(true)
    this.playbackReady = false
    this.updateStatus({ mode: 'live', live: { ...live, phase: 'PREPARING_FALLBACK', fallbackReady: false }, currentMediaId: undefined })
    const transition = (async (): Promise<void> => {
      const acknowledged = owner.disposeRenderer(window)
      getPlaybackEngine().stop()
      const completed = await acknowledged
      if (revision !== this.fallbackRevision || this.stopping || this.mainWindow !== window || window.isDestroyed() || !this.liveCoordinator?.isOwningContent()) return
      if (!completed) {
        this.rendererDisposalFailed = true
        this.interruptLive('RENDERER_DISPOSAL_FAILED')
        window.webContents.reload()
        return
      }
      owner.advance('live-fallback')
      window.webContents.setAudioMuted(false)
      display()
    })()
    this.fallbackTransition = transition
    void transition.finally(() => { if (this.fallbackTransition === transition) this.fallbackTransition = undefined }).catch(() => undefined)
  }

  getLiveReceiverGrant(senderId: number): import('../../common/live-runtime').LiveReceiverGrant | null { return this.liveView?.getGrant(senderId) ?? null }
  getLiveReceiverLease(senderId: number): import('../../common/live-runtime').LiveReceiverLease | null { return this.liveView?.getLease(senderId) ?? null }
  reportLiveReceiver(senderId: number, value: unknown): boolean { return this.liveView?.report(senderId, value) ?? false }
  /** Call synchronously before window/display/power lifecycle changes. */
  interruptLive(reason: string): void {
    this.fallbackRevision += 1
    this.liveCoordinator?.suspend(reason)
    if (this.liveCoordinator?.isOwningContent()) {
      this.mainWindow?.webContents.setAudioMuted(true)
      getContentOwner().advance('blocked')
      getPlaybackEngine().stop()
      this.playbackReady = false
      this.updateStatus({ currentMediaId: undefined })
    }
  }
  resumeLive(): void { this.refreshPlaybackStatusFromCurrentState(); this.liveCoordinator?.wake() }
  /** Called before HTTP/WS clients switch endpoints or trust configuration. */
  reconfigureLive(previous: AppConfig, next: AppConfig): void {
    const changedAuthority = previous.apiBase !== next.apiBase || previous.deviceId !== next.deviceId ||
      JSON.stringify(previous.transportTls) !== JSON.stringify(next.transportTls) || JSON.stringify(previous.mtls) !== JSON.stringify(next.mtls) ||
      JSON.stringify(previous.environment) !== JSON.stringify(next.environment)
    if (changedAuthority) {
      this.liveTransportRecoveryRequired = true
      this.liveCoordinator?.resetIdentity()
      if (['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(this.state)) {
        queueMicrotask(() => { void this.retryRecovery() })
      }
    } else if (previous.livePlayback?.enabled !== next.livePlayback?.enabled) {
      this.refreshPlaybackStatusFromCurrentState()
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

    if (persisted.pairingCode && trustworthyDeviceId) {
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

    if (identity.health === 'missing' && !trustworthyDeviceId && this.pairingService.hasPairingCredential()) {
      await this.transitionState('HARD_RECOVERY', {
        error: 'Recovering the existing pairing request from the backend...',
      })
      await this.requestFreshPairingCode(undefined, 'HARD_RECOVERY')
      return
    }

    await this.enterHardRecovery('No trustworthy persisted device identity is available')
  }

  getState(): PlayerState {
    return this.state
  }

  getStatus(): PlayerStatus {
    return {
      ...this.status,
      contentEpoch: getContentOwner().getEpoch(),
      hostname: os.hostname(),
      pairingRemainingMs: this.pairingService.getPairingRemainingMs(),
    }
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
    if (this.state === 'PAIRING_PENDING' || this.state === 'PAIRING_CONFIRMED' || this.state === 'PAIRING_COMPLETING') {
      return await this.renewCurrentPairing(overrides)
    }
    return await this.requestFreshPairingCode(overrides, 'HARD_RECOVERY')
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
      case 'reset-doubtful-pairing':
        await this.enterHardRecovery('Fresh pairing requested', payload)
        break
      case 'refresh-pairing':
        await this.renewCurrentPairing(payload)
        break
      default:
        break
    }
  }

  async refreshSnapshot(): Promise<void> {
    await getSnapshotManager().refreshSnapshot()
  }

  stop(): void {
    this.stopping = true
    this.liveCoordinator?.dispose()
    this.stopPairingTimers()
    this.stopBootstrapRetryTimer()
    this.stopSecureRecoveryRetryTimer()
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
    // Publish the authoritative mode before PlaybackEngine emits media-change.
    // The engine subscribes during construction, so a normal `on` listener can
    // otherwise send the first emergency item while the renderer still owns a
    // DEFAULT presentation and correctly rejects that item as stale.
    getSnapshotManager().prependListener('playlist-updated', (playlist: PlaybackPlaylist) => {
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
    guard.on('recovery-requested', this.onSecurePlaybackRecoveryRequested)
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
    guard.off('recovery-requested', this.onSecurePlaybackRecoveryRequested)
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

    // A background reconnect attempt must not replace valid cached playback
    // with the bootstrap surface. Keep the offline lifecycle authoritative
    // until the backend has actually accepted the stored identity.
    if (this.state !== 'OFFLINE_USING_LAST_VALID_PAIRING') {
      await this.transitionState('BOOTSTRAP_AUTH', {
        error: 'Validating device pairing with backend...',
        backendAvailable: false,
        awaitingManualRecovery: false,
      })
    }

    try {
      const securePlaybackGuard = getSecurePlaybackGuard()
      if (securePlaybackGuard.isPlaybackLocked()) {
        securePlaybackGuard.setRecoveryPhase('REVALIDATING_IDENTITY', 'bootstrap')
      }
      const pairingStatus = await this.validateBackendPairingStatus()
      if (!pairingStatus) {
        return
      }

      await this.probeAuthenticatedSnapshot()
      await this.applyBootstrapScreenshotPolicy()
      securePlaybackGuard.setRecoveryPhase('FETCHING_CURRENT_SNAPSHOT', 'bootstrap')
      await getSnapshotManager().refreshSnapshot({
        force: true,
        allowWhileSecurityLocked: true,
        onSnapshotFetched: () => securePlaybackGuard.setRecoveryPhase('SYNCING_CONTENT', 'bootstrap'),
      })
      if (!getSnapshotManager().didLastRefreshSucceed()) {
        throw new Error('Fresh snapshot retrieval failed during secure bootstrap')
      }
      securePlaybackGuard.setRecoveryPhase('APPLYING_AUTHORITY', 'bootstrap')
      securePlaybackGuard.markBackendSuccess('pairing-status-and-current-snapshot')
      this.securePlaybackPurgeCompleted = false
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
      this.refreshPlaybackStatusFromCurrentState()
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
    const realtimeEnabled = getConfigManager().getConfig().realtime?.enabled === true
    getSnapshotManager().start({ networkPolling: !realtimeEnabled })
    getDefaultMediaService().start({ networkPolling: !realtimeEnabled })
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
    this.liveCoordinator?.resetIdentity()
    getContentOwner().advance('blocked')
    getPlaybackEngine().stop()
    this.playbackReady = false
    getSecurePlaybackGuard().reset()
    this.securePlaybackPurgeCompleted = false
    getSnapshotManager().clearIdentityBoundState()
    getDefaultMediaService().clearIdentityBoundState()
  }

  private resolveVisiblePlaybackMode(playlist: PlaybackPlaylist): PlaybackMode {
    if (playlist.mode === 'live' || playlist.mode === 'emergency') return playlist.mode
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
    if (this.liveTransportRecoveryRequired) {
      this.liveCoordinator?.setContext(false, playlist)
      getPlaybackEngine().stop()
      this.playbackReady = false
      this.updateStatus({ mode: 'live', live: { phase: 'UNAVAILABLE', reason: 'BACKEND_REVALIDATION', fallbackReady: false }, currentMediaId: undefined })
      return
    }
    const securePlaybackStatus = getSecurePlaybackGuard().getStatus()
    if (securePlaybackStatus.locked) {
      this.liveCoordinator?.setContext(false, playlist)
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
      if (this.playbackReady) {
        this.playbackReady = false
        getPlaybackEngine().stop()
      }
      return
    }

    const liveAllowed = !this.liveTransportRecoveryRequired && ['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(this.state)
    this.liveCoordinator?.setContext(liveAllowed, playlist)
    if (this.liveCoordinator?.isOwningContent()) return

    const timelineRequired = requiresTimelinePlayback(playlist)
    const shouldStartTimeline = timelineRequired && !this.playbackReady
    const shouldStopTimeline = !timelineRequired && this.playbackReady

    // Presentation state is authoritative for renderer acceptance. Publish it
    // before start()/stop() can synchronously emit media-change/clear-active.
    this.updateStatus({
      mode: this.resolveVisiblePlaybackMode(playlist),
      contentUnavailableReason: playlist.unavailableReason,
      online: playlist.mode !== 'offline',
      scheduleId: playlist.scheduleId,
      currentMediaId: requiresTimelinePlayback(playlist) ? this.status.currentMediaId : undefined,
      lastSnapshotAt: playlist.lastSnapshotAt,
      backendAvailable: playlist.mode !== 'offline',
      securityLock: this.toPlayerSecurityLockStatus(securePlaybackStatus),
    })

    if (shouldStartTimeline) {
      this.playbackReady = true
      void getPlaybackEngine().start()
    } else if (shouldStopTimeline) {
      this.playbackReady = false
      getPlaybackEngine().stop()
    }
  }

  private async handleSecurePlaybackStatus(status: SecurePlaybackGuardStatus): Promise<void> {
    if (status.locked) {
      this.liveCoordinator?.setContext(false)
      getContentOwner().advance('blocked')
      if (!this.securePlaybackLockActive) {
        this.securePlaybackLockActive = true
        getCacheManager().invalidatePendingWrites()
        getDefaultMediaService().enterSecurityLock()
      }
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

    this.securePlaybackLockActive = false

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
      await getCacheManager().clear(true)
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
      recoveryPhase: status.recoveryPhase,
    }
  }

  private async startSecurePlaybackRecovery(): Promise<void> {
    if (this.secureRecoveryPromise) {
      return await this.secureRecoveryPromise
    }

    this.stopSecureRecoveryRetryTimer()
    const recovery = this.recoverSecurePlaybackAfterBackendReturn()
    this.secureRecoveryPromise = recovery
    try {
      await recovery
    } finally {
      if (this.secureRecoveryPromise === recovery) {
        this.secureRecoveryPromise = undefined
      }
    }
  }

  private async recoverSecurePlaybackAfterBackendReturn(): Promise<void> {
    const guard = getSecurePlaybackGuard()
    if (!guard.isPlaybackLocked()) {
      return
    }

    try {
      guard.setRecoveryPhase('REVALIDATING_IDENTITY', 'secure-recovery')
      const pairingStatus = await this.validateBackendPairingStatus()
      if (!pairingStatus) {
        return
      }

      guard.setRecoveryPhase('FETCHING_CURRENT_SNAPSHOT', 'secure-recovery')
      await getSnapshotManager().refreshSnapshot({
        force: true,
        allowWhileSecurityLocked: true,
        onSnapshotFetched: () => guard.setRecoveryPhase('SYNCING_CONTENT', 'secure-recovery'),
      })
      if (!getSnapshotManager().didLastRefreshSucceed()) {
        throw new Error('Fresh snapshot retrieval failed during secure recovery')
      }

      // Snapshot refresh awaits media prefetch/checksum work before publishing
      // the playlist. Its event remains blocked while this guard is locked.
      guard.setRecoveryPhase('APPLYING_AUTHORITY', 'secure-recovery')
      guard.markBackendSuccess('secure-recovery-complete')
      this.securePlaybackPurgeCompleted = false
      this.bootstrapBackoff.reset()
      await this.transitionState('PAIRED_RUNTIME', {
        backendAvailable: true,
        online: true,
        awaitingManualRecovery: false,
        error: undefined,
        recoveryReason: undefined,
      })
    } catch (error) {
      if (
        this.pairingService.isDeviceNotRegisteredError(error) ||
        this.pairingService.isInvalidCredentialError(error)
      ) {
        await this.enterHardRecovery((error as Error).message || 'Stored device identity is no longer valid')
        return
      }

      guard.markRecoveryFailed('secure-recovery', error)
      this.securePlaybackPurgeCompleted = false
      await this.handleSecurePlaybackPurgeRequest(guard.getStatus())
      logger.warn({ error }, 'Secure playback recovery failed; playback remains locked')
      this.scheduleSecureRecoveryRetry(this.bootstrapBackoff.getDelay())
    }
  }

  private scheduleSecureRecoveryRetry(delayMs: number): void {
    this.stopSecureRecoveryRetryTimer()
    this.secureRecoveryRetryTimer = setTimeout(() => {
      void this.startSecurePlaybackRecovery()
    }, delayMs)
  }

  private stopSecureRecoveryRetryTimer(): void {
    if (this.secureRecoveryRetryTimer) {
      clearTimeout(this.secureRecoveryRetryTimer)
      this.secureRecoveryRetryTimer = undefined
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
      this.pairingPollTimer = setTimeout(() => {
        void this.requestFreshPairingCode(overrides, failureState)
      }, this.pairingPollBackoff.getDelay())
      return null
    }
  }

  private async renewCurrentPairing(overrides?: Partial<PairingCodeRequest>): Promise<PairingCodeResponse | null> {
    if (this.pairingRenewalPromise) return this.pairingRenewalPromise
    const renewal = async (): Promise<PairingCodeResponse | null> => {
      this.stopPairingTimers()
      if (!this.pairingService.hasPairingCredential()) {
        try {
          const status = await this.pairingService.fetchPairingStatus()
          if (status.active_pairing) {
            await this.syncActivePairingMetadata(status.active_pairing)
            await this.transitionState('PAIRING_PENDING', {
              error: 'Pre-upgrade code: wait for expiry before a protected new code can be issued.',
            })
            this.schedulePairingStatusPoll(PAIRING_POLL_INTERVAL_MS)
            return null
          }
          if (status.screen) {
            await this.enterRecoveryRequired('Pairing completed on the backend; device credentials need recovery')
            return null
          }
          await this.enterHardRecovery('Pre-upgrade pairing code expired; starting protected pairing', overrides)
        } catch (error) {
          await this.transitionState('PAIRING_PENDING', { error: (error as Error).message })
          this.schedulePairingStatusPoll(this.pairingPollBackoff.getDelay())
        }
        return null
      }
      try {
        const response = await this.pairingService.renewPairingCode(overrides)
        this.pairingPollBackoff.reset()
        await this.transitionState('PAIRING_PENDING', { error: 'New code generated. Waiting for admin approval...' })
        this.startPairingStatusPolling()
        return response
      } catch (error) {
        if (isDeviceApiError(error) && error.code === 'PAIRING_RENEWAL_EXPIRED') {
          await this.store.update({ pendingRenewalRequestId: undefined, pairingRequestInDoubtAt: undefined })
          await this.transitionState('PAIRING_PENDING', { error: 'Code expired. Requesting a new code...' })
          this.schedulePairingStatusPoll(0)
          return null
        }
        if (isDeviceApiError(error) &&
            (error.code === 'PAIRING_SESSION_REVOKED' || error.code === 'PAIRING_ALREADY_PAIRED')) {
          try {
            const status = await this.pairingService.fetchPairingStatus()
            if (status.screen) {
              await this.enterRecoveryRequired('Pairing completed or changed on the backend; device credentials need recovery')
              return null
            }
            if (!status.active_pairing) {
              await this.enterHardRecovery('Pairing session was revoked by the backend', overrides)
              return null
            }
          } catch (verificationError) {
            logger.warn({ error: verificationError }, 'Could not verify revoked pairing session')
          }
        }
        logger.warn({ error }, 'Pairing renewal needs reconciliation')
        await this.pairingService.markPairingRequestInDoubt((error as Error).message)
        await this.transitionState('PAIRING_PENDING', { error: 'Checking the latest code with the backend...' })
        this.schedulePairingStatusPoll(this.pairingPollBackoff.getDelay())
        return null
      }
    }
    this.pairingRenewalPromise = renewal()
    try {
      return await this.pairingRenewalPromise
    } finally {
      this.pairingRenewalPromise = undefined
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

    try {
      const status = await this.pairingService.fetchPairingStatus()
      const activePairing = status.active_pairing || null
      const beforeSync = this.store.getState()
      await this.syncActivePairingMetadata(activePairing)
      this.pairingPollBackoff.reset()

      if (beforeSync.pendingRenewalRequestId && this.store.getState().pendingRenewalRequestId &&
          (!activePairing || (activePairing.generation ?? 0) <= (beforeSync.pairingGeneration ?? 0))) {
        await this.renewCurrentPairing()
        return
      }
      if (!activePairing) {
        if (status.screen) {
          await this.enterRecoveryRequired('Pairing completed on the backend; device credentials need recovery')
        } else {
          await this.renewCurrentPairing()
        }
        return
      }

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

    const current = this.store.getState()
    const advanced = (activePairing.generation ?? 0) > (current.pairingGeneration ?? 0) ||
      Boolean(activePairing.pairing_code && activePairing.pairing_code !== current.pairingCode)
    await this.store.update({
      activePairingMode: activePairing.mode,
      pairingCode: activePairing.pairing_code || current.pairingCode,
      pairingExpiresAt: activePairing.expires_at || current.pairingExpiresAt,
      pairingGeneration: activePairing.generation ?? current.pairingGeneration,
      pendingRenewalRequestId: advanced ? undefined : current.pendingRenewalRequestId,
      pairingRequestInDoubtAt: advanced ? undefined : current.pairingRequestInDoubtAt,
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
        if (currentMode === 'RECOVERY') {
          await this.pairingService.clearPairingMetadata()
          await this.enterRecoveryRequired(
            'Recovery pairing expired. Waiting for admin to create a new recovery pairing...'
          )
        } else if (this.pairingService.hasPairingCredential()) {
          await this.transitionState('PAIRING_PENDING', { error: 'Code changed or expired. Checking the latest code...' })
          this.startPairingStatusPolling()
        } else {
          await this.pairingService.clearPairingMetadata()
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
      // A deleted screen loses its certificate before its next authenticated
      // request. Confirm the missing screen through REST before clearing local
      // identity; a revoked credential can still belong to an existing screen.
      try {
        const status = await this.pairingService.fetchPairingStatus()
        if (status.device_id === this.pairingService.getDeviceId() && !status.screen && !status.active_pairing) {
          await this.enterHardRecovery('Screen was removed from the backend')
          return
        }
      } catch (error) {
        logger.warn({ error }, 'Could not confirm screen identity after authentication failure')
      }
      await this.enterRecoveryRequired(event.error.message || 'Device credentials are no longer valid')
      return
    }

    if (this.pairingService.hasTrustworthyDeviceId()) {
      await this.enterRecoveryRequired(event.error.message || 'Device authentication requires recovery')
      return
    }

    await this.enterHardRecovery(event.error.message || 'Stored device identity is unusable')
  }

  private async transitionState(next: PlayerState, statusPatch: Partial<PlayerStatus> = {}): Promise<void> {
    this.state = next
    if (next === 'PAIRED_RUNTIME') this.liveTransportRecoveryRequired = false
    if (!['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(next)) {
      this.liveCoordinator?.setContext(false)
      getContentOwner().advance('blocked')
    } else if (getContentOwner().getOwner() === 'blocked' && !this.liveCoordinator?.isOwningContent()) {
      getContentOwner().advance('ordinary')
    }
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
      pairingCode: persisted.pairingRequestInDoubtAt ? undefined : persisted.pairingCode,
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
