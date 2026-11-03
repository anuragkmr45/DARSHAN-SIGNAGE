import { performance } from 'perf_hooks'
import type { LiveOccurrence, LivePlaybackStatus } from '../../common/live-playback'
import { sameLivePolicy } from '../../common/live-playback'
import type { LiveAdmissionGrant, LiveAdmissionIdentity, LiveReceiverObservation, LiveRuntimeState } from '../../common/live-runtime'
import { LiveAuthorityError, type LiveAuthorityClient, type LiveDiscovery } from './live-authority-client'
import type { PreparedLiveFallback } from './live-fallback-cache'
import type { PlaybackPlaylist } from './snapshot-manager'

type CachePort = {
  updateDiscoveredLiveOccurrences(current?: LiveOccurrence, next?: LiveOccurrence): void
  prepareLiveFallback(occurrence: LiveOccurrence, options?: { force?: boolean; download?: boolean }): Promise<PreparedLiveFallback>
  getLiveFallbackPlaylist(occurrence: LiveOccurrence): PlaybackPlaylist
  getScheduleNowMs(): number
}
type ViewPort = {
  connect(grant: LiveAdmissionGrant, authorized: () => boolean, observation: (value: LiveReceiverObservation) => void, remaining: () => number): void
  activate(): boolean
  destroy(): void
}
export type LiveCoordinatorOutput = {
  fallback(playlist: PlaybackPlaylist, status: LivePlaybackStatus): void
  status(status: LivePlaybackStatus): void
  /** Must fence old reports, stop the engine and await actual DOM/media cleanup. */
  disposeOrdinary(isCurrent: () => boolean): Promise<boolean>
  released(): void
  identityFailure(error: LiveAuthorityError): void
}
/** One authority/content owner inside the ordinary installed player. All network,
 * cache and renderer completions are fenced by a local occurrence generation. */
export class LivePlaybackCoordinator {
  private allowed = false
  private disposed = false
  private epoch = 0
  private owns = false
  private active?: LiveOccurrence
  private blockedWindows: Array<{ occurrence: LiveOccurrence; deadline: number }> = []
  private boundary = 0
  private boundaryVerified = false
  private nextOccurrence?: { occurrence: LiveOccurrence; start: number; end: number }
  private authorityDeadline = 0
  private admission?: LiveAdmissionIdentity
  private proof?: PreparedLiveFallback['proof']
  private fallbackReady = false
  private phase: LivePlaybackStatus['phase'] = 'UNAVAILABLE'
  private reason = 'LIVE_NOT_RUNNING'
  private authority?: LiveAuthorityClient
  private task?: { controller: AbortController }
  private preparation?: { epoch: number; promise: Promise<void> }
  private timer?: NodeJS.Timeout
  private watchdog?: NodeJS.Timeout
  private rendererPulse?: number
  private connectingAt = 0
  private sequence = 0
  private lastObservationAt = 0
  private connected = false
  private audio: 'NONE' | 'READY' | 'DEGRADED' | 'MUTED' = 'NONE'
  private activationPending = false
  private lastSnapshotSelection?: string
  private emergencyHold = false
  private emergencyObservedAt = 0
  private emergencyRefresh?: Promise<{ fresh: boolean; playlist: PlaybackPlaylist | null }>

  constructor(private readonly options: { enabled: () => boolean; createAuthority: () => LiveAuthorityClient;
    cache: CachePort; view: ViewPort; output: LiveCoordinatorOutput; now?: () => number;
    refreshControl?: () => Promise<{ fresh: boolean; playlist: PlaybackPlaylist | null }> }) {}
  private now(): number { return this.options.now?.() ?? performance.now() }
  isOwningContent(): boolean { return this.owns }
  getStatus(): LivePlaybackStatus {
    return { phase: this.phase, reason: this.reason, fallbackReady: this.fallbackReady,
      ...(this.active ? { publishId: this.active.publishId, scheduleItemId: this.active.itemId } : {}),
      ...(this.admission ? { runId: this.admission.run_id, generation: this.admission.generation, admissionId: this.admission.admission_id } : {}) }
  }
  setContext(allowed: boolean, playlist?: PlaybackPlaylist): void {
    if (this.disposed) return
    const canRun = allowed && playlist?.mode !== 'emergency'
    if (!canRun) {
      this.allowed = false
      this.emergencyHold = false
      this.emergencyRefresh = undefined
      this.lastSnapshotSelection = undefined
      this.invalidate(playlist?.mode === 'emergency' ? 'EMERGENCY' : 'PLAYER_NOT_READY')
      this.options.cache.updateDiscoveredLiveOccurrences()
      this.active = undefined; this.blockedWindows = []; this.boundary = 0; this.nextOccurrence = undefined
      this.release()
      return
    }
    const resumed = !this.allowed
    this.allowed = true
    if (this.emergencyHold) {
      this.publishFallback(); this.requestEmergencyControl(); this.ensureWatchdog(); this.schedule(0)
      return
    }
    if (playlist && playlist.mode !== 'live' && this.owns && !this.active && !this.blockedWindows.length) {
      this.invalidate('LIVE_CONTROL_REMOVED'); this.release()
    }
    if (resumed) {
      this.authority?.resetEpoch()
      this.fallbackReady = false; this.proof = undefined
      if (this.active) { this.publishFallback(); this.prepare(true) }
    }
    // A snapshot LIVE window blocks ordinary/default immediately, including
    // when the feature gate is OFF or its fallback is invalid.
    const snapshotSelection = playlist?.mode === 'live' ? playlist.live ? `${playlist.live.publishId}:${playlist.live.itemId}` : 'invalid' : undefined
    if (snapshotSelection && snapshotSelection !== this.lastSnapshotSelection && !this.active && !this.blockedWindows.length) {
      if (playlist?.live) this.select(playlist.live, this.now() + Math.max(0, Date.parse(playlist.live.endAt) - this.options.cache.getScheduleNowMs()))
      else this.block('INVALID_LIVE_WINDOW')
    }
    this.lastSnapshotSelection = snapshotSelection
    if (this.owns || this.options.enabled()) this.ensureWatchdog()
    if (!this.options.enabled()) {
      this.invalidate('LIVE_PLAYBACK_DISABLED')
      if (this.owns) { this.fallbackReady = false; this.proof = undefined; this.publishFallback() }
      return
    }
    this.schedule(0)
  }
  wake(): void { if (this.allowed && !this.disposed && this.options.enabled()) this.schedule(0) }
  suspend(reason = 'PLAYER_SUSPENDED'): void {
    this.allowed = false
    this.invalidate(reason)
    this.emergencyRefresh = undefined
    this.fallbackReady = false; this.proof = undefined
    this.phase = 'SUSPENDED'; this.options.output.status(this.getStatus())
  }
  resetIdentity(): void {
    this.allowed = false
    this.invalidate('DEVICE_IDENTITY_CHANGED')
    this.authority = undefined; this.sequence = 0; this.lastObservationAt = 0; this.active = undefined
    this.emergencyHold = false
    this.emergencyRefresh = undefined
    this.nextOccurrence = undefined; this.blockedWindows = []; this.boundary = 0; this.boundaryVerified = false; this.lastSnapshotSelection = undefined
    this.options.cache.updateDiscoveredLiveOccurrences()
    this.release()
  }
  dispose(): void {
    this.disposed = true; this.allowed = false
    this.invalidate('PLAYER_STOPPED')
    if (this.watchdog) clearInterval(this.watchdog)
    this.watchdog = undefined
    this.options.cache.updateDiscoveredLiveOccurrences()
    this.active = undefined; this.blockedWindows = []; this.boundaryVerified = false; this.release()
  }
  private ensureWatchdog(): void {
    if (this.watchdog) return
    this.watchdog = setInterval(() => {
      if (!this.allowed || this.disposed) return
      const now = this.now()
      // A LIVE window ending cannot prove that a separately confirmed
      // emergency ended. Keep unavailable until fresh REST control resolves it.
      if (this.emergencyHold) return
      if (!this.active && !this.blockedWindows.length && this.nextOccurrence && this.nextOccurrence.start <= now) {
        const next = this.nextOccurrence
        this.nextOccurrence = undefined
        if (next.end > now) this.select(next.occurrence, next.end)
        this.wake()
      }
      if (this.blockedWindows.length) {
        this.blockedWindows = this.blockedWindows.filter(item => item.deadline > now)
        if (!this.blockedWindows.length) { this.release(); this.wake() }
        return
      }
      if (this.active && this.boundary <= now) {
        this.invalidate('LIVE_WINDOW_ENDED'); this.active = undefined; this.boundary = 0
        this.release(); this.wake(); return
      }
      if (this.authorityDeadline > 0 && this.authorityDeadline <= now) { this.reconnect('LIVE_LEASE_EXPIRED'); return }
      if (this.rendererPulse !== undefined && this.rendererPulse + 4000 <= now) { this.reconnect('LIVE_RENDERER_UNRESPONSIVE'); return }
      if (this.phase === 'CONNECTING' && this.connectingAt + 15000 <= now) this.reconnect('LIVE_FRAME_UNAVAILABLE')
    }, 200)
  }
  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.allowed || this.disposed || !this.options.enabled()) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.refresh() }, delay)
  }
  private invalidate(reason: string): void {
    this.epoch += 1
    this.task?.controller.abort(); this.task = undefined
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    // Destroy the context and all audio before reporting fallback ownership.
    this.options.view.destroy()
    this.admission = undefined; this.authorityDeadline = 0; this.rendererPulse = undefined; this.lastObservationAt = 0
    this.connected = false; this.audio = 'NONE'; this.activationPending = false; this.reason = reason
  }
  private select(occurrence: LiveOccurrence, deadline: number): void {
    const same = this.active && this.active.publishId === occurrence.publishId && this.active.itemId === occurrence.itemId &&
      this.active.startAt === occurrence.startAt && this.active.endAt === occurrence.endAt && sameLivePolicy(this.active.policy, occurrence.policy)
    if (same) {
      this.active = occurrence
      // A fresh REST clock/lease can shorten an existing local boundary but
      // never extend it due to clock movement or a delayed response.
      this.boundary = Math.min(this.boundary, deadline)
      return
    }
    this.invalidate(!this.options.enabled() ? 'LIVE_PLAYBACK_DISABLED' : occurrence.invalidReason ?? 'PREPARING_FALLBACK')
    this.active = occurrence; this.boundary = deadline; this.boundaryVerified = false; this.blockedWindows = []
    this.owns = true; this.proof = undefined; this.fallbackReady = false
    this.publishFallback()
    if (this.options.enabled()) this.prepare(false)
  }
  private block(reason: string): void {
    this.invalidate(reason)
    this.owns = true; this.active = undefined; this.boundaryVerified = false; this.fallbackReady = false; this.proof = undefined
    this.phase = 'UNAVAILABLE'
    this.options.output.fallback({ mode: 'live', items: [], unavailableReason: reason }, this.getStatus())
  }
  private release(): void {
    const wasOwner = this.owns
    this.owns = false; this.fallbackReady = false; this.proof = undefined; this.phase = 'UNAVAILABLE'
    if (!this.options.enabled() && !this.active && !this.nextOccurrence && !this.blockedWindows.length && this.watchdog) { clearInterval(this.watchdog); this.watchdog = undefined }
    if (wasOwner) this.options.output.released()
  }
  private publishFallback(): void {
    if (!this.owns) return
    this.phase = this.emergencyHold ? 'UNAVAILABLE' : this.fallbackReady ? 'FALLBACK' : this.active?.policy && this.options.enabled() ? 'PREPARING_FALLBACK' : 'UNAVAILABLE'
    const playlist = this.active ? this.options.cache.getLiveFallbackPlaylist(this.active) : { mode: 'live' as const, items: [], unavailableReason: this.reason }
    this.options.output.fallback(this.fallbackReady && !this.emergencyHold ? playlist : { ...playlist, items: [], unavailableReason: this.reason }, this.getStatus())
  }
  private prepare(force: boolean): void {
    const active = this.active, epoch = this.epoch
    if (!active?.policy || active.invalidReason || this.emergencyHold || !this.allowed || !this.options.enabled() || this.preparation?.epoch === epoch) return
    const preparation = { epoch, promise: Promise.resolve() }
    this.preparation = preparation
    preparation.promise = this.options.cache.prepareLiveFallback(active, { force }).then(result => {
      if (!this.allowed || epoch !== this.epoch || this.active?.publishId !== active.publishId || this.active.itemId !== active.itemId || this.boundary <= this.now()) return
      this.fallbackReady = result.ready; this.proof = result.proof
      this.reason = result.ready ? 'LIVE_NOT_RUNNING' : result.reason ?? 'FALLBACK_NOT_READY'
      if (this.phase !== 'LIVE' && this.phase !== 'CONNECTING') this.publishFallback()
      if (result.ready) this.wake()
    }).catch(() => {
      if (epoch === this.epoch) { this.fallbackReady = false; this.proof = undefined; this.reason = 'FALLBACK_NOT_READY'; this.publishFallback() }
    }).finally(() => { if (this.preparation === preparation) this.preparation = undefined })
  }
  private reconnect(reason: string): void {
    if (!this.active || !this.allowed) return
    if (this.emergencyHold) { this.publishFallback(); this.requestEmergencyControl(); return }
    this.invalidate(reason)
    this.fallbackReady = false; this.proof = undefined
    this.publishFallback(); this.prepare(true); this.schedule(1000)
  }
  private authorized(epoch: number, admission: LiveAdmissionIdentity): boolean {
    return !this.disposed && this.allowed && this.options.enabled() && this.owns && epoch === this.epoch && this.now() < this.boundary && this.now() < this.authorityDeadline &&
      this.admission?.admission_id === admission.admission_id && this.admission.run_id === admission.run_id && this.admission.generation === admission.generation
  }
  private applyDiscovery(discovery: LiveDiscovery, started: number, trustedClock: boolean): LiveRuntimeState | undefined {
    this.options.cache.updateDiscoveredLiveOccurrences(discovery.current?.occurrence, discovery.next?.occurrence)
    const next = discovery.next?.occurrence
    if (next) {
      const old = this.nextOccurrence
      const same = old?.occurrence.publishId === next.publishId && old.occurrence.itemId === next.itemId
      // A slow REST response may spend seconds in backend fallback hydration.
      // Its server_now is stamped at the end, so measuring from request start
      // would shorten the local window by all of that processing time.
      this.nextOccurrence = !trustedClock ? same ? old : undefined : { occurrence: next,
        start: Math.min(same ? old.start : Infinity, started + Math.max(0, Date.parse(next.startAt) - Date.parse(discovery.server_now))),
        end: Math.min(same ? old.end : Infinity, started + Math.max(0, Date.parse(next.endAt) - Date.parse(discovery.server_now))) }
    } else this.nextOccurrence = undefined
    if (discovery.blockedWindows.length) {
      const old = new Map(this.blockedWindows.map(item => [`${item.occurrence.publishId}:${item.occurrence.itemId}`, item.deadline]))
      this.blockedWindows = discovery.blockedWindows.map(occurrence => ({ occurrence, deadline: trustedClock
        ? Math.min(old.get(`${occurrence.publishId}:${occurrence.itemId}`) ?? Infinity, started + Math.max(0, Date.parse(occurrence.endAt) - Date.parse(discovery.server_now)))
        : old.get(`${occurrence.publishId}:${occurrence.itemId}`) ?? Infinity }))
      this.block(this.emergencyHold ? 'EMERGENCY_ACTIVE' : 'CONFLICTING_LIVE_WINDOWS')
      if (this.emergencyHold) this.requestEmergencyControl()
      return undefined
    }
    this.blockedWindows = []
    const selected = discovery.current
    if (!selected) {
      if (this.emergencyHold) { this.publishFallback(); this.requestEmergencyControl(); return undefined }
      if (this.active || this.owns) { this.invalidate('LIVE_NOT_SCHEDULED'); this.active = undefined; this.boundary = 0; this.boundaryVerified = false; this.release() }
      return undefined
    }
    const wasEmergency = this.emergencyHold
    if (selected.state?.availability === 'EMERGENCY') {
      this.emergencyObservedAt = this.now()
      if (!this.emergencyHold) this.invalidate('EMERGENCY_ACTIVE')
      this.emergencyHold = true; this.fallbackReady = false; this.proof = undefined
    } else if (this.emergencyHold && selected.state) {
      this.emergencyHold = false; this.invalidate('EMERGENCY_CLEARED'); this.fallbackReady = false; this.proof = undefined
    }
    const same = this.active && this.active.publishId === selected.occurrence.publishId && this.active.itemId === selected.occurrence.itemId &&
      this.active.startAt === selected.occurrence.startAt && this.active.endAt === selected.occurrence.endAt && sameLivePolicy(this.active.policy, selected.occurrence.policy)
    if (!trustedClock && !same) { this.block('LIVE_TIMING_UNCERTAIN'); return selected.state }
    this.select(selected.occurrence, trustedClock
      ? started + Math.max(0, Date.parse(selected.occurrence.endAt) - Date.parse(discovery.server_now)) : this.boundary)
    if (trustedClock) this.boundaryVerified = true
    if (this.emergencyHold) { this.reason = 'EMERGENCY_ACTIVE'; this.publishFallback(); this.requestEmergencyControl(); return selected.state }
    if (wasEmergency) { this.publishFallback(); this.prepare(true) }
    if (discovery.next?.occurrence.policy) void this.options.cache.prepareLiveFallback(discovery.next.occurrence).catch(() => undefined)
    return selected.state
  }
  private async refresh(): Promise<void> {
    if (this.task || !this.allowed || this.disposed || !this.options.enabled()) return
    const task = { controller: new AbortController() }, epoch = this.epoch
    this.task = task
    let nextDelay = 3000
    try {
      this.authority ??= this.options.createAuthority()
      const started = this.now()
      const discovery = await this.authority.discover(task.controller.signal)
      if (this.task !== task || !this.allowed || epoch !== this.epoch) return
      // Keep an established monotonic boundary when backend processing makes
      // this clock sample too old for the one-second schedule-end tolerance.
      // A new window waits for another sample instead of inventing a deadline.
      const elapsed = this.now() - started
      const state = this.applyDiscovery(discovery, started, Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 1000)
      // Selecting a new occurrence intentionally rotates the generation and
      // aborts this task. Its next iteration starts with the selected owner.
      if (this.task !== task || epoch !== this.epoch || !this.active || !state || !this.boundaryVerified) { nextDelay = 500; return }
      if (this.emergencyHold) { this.requestEmergencyControl(); return }
      if (!this.proof || !this.fallbackReady) { this.prepare(false); return }
      if (state.policy_status !== 'VALID' || !state.enabled || state.availability !== 'READY' || state.run?.state !== 'RUNNING') {
        if (this.admission) this.reconnect(`LIVE_${state.availability}`)
        else { this.reason = `LIVE_${state.availability}`; this.publishFallback() }
        return
      }
      const active = this.active, run = state.run
      if (this.admission && (this.admission.run_id !== run.id || this.admission.generation !== run.generation)) {
        this.reconnect('LIVE_RUN_REPLACED'); return
      }
      if (!this.admission) {
        const pending = await this.authority.create(active, run, this.proof, task.controller.signal)
        if (this.task !== task || epoch !== this.epoch || this.boundary <= this.now()) return
        if (pending.occurrence_id !== state.occurrence_id) throw new LiveAuthorityError('INVALID_LIVE_AUTHORITY')
        this.admission = pending; nextDelay = 500
        return
      }
      const requesting = this.now()
      if (this.authorityDeadline > 0 && this.authorityDeadline <= requesting) { this.reconnect('LIVE_LEASE_EXPIRED'); return }
      const action = this.authorityDeadline > this.now() ? 'renew' : 'ticket'
      const grant = await this.authority.grant(action, active, this.admission, this.proof, task.controller.signal)
      if (this.task !== task || epoch !== this.epoch || this.boundary <= this.now()) return
      if (action === 'renew' && this.authorityDeadline <= this.now()) { this.reconnect('LIVE_LEASE_EXPIRED'); return }
      // Measure from request start, never response receipt. A slow response
      // consumes its lease rather than granting extra seconds of playback.
      // The server stamps window_remaining_ms at the end of its work. The
      // independently verified monotonic boundary already limits playback;
      // subtracting slow grant processing again would cut a valid window early.
      const deadline = Math.min(this.boundary, requesting + grant.lease_ms)
      if (deadline <= this.now()) throw new LiveAuthorityError('LIVE_LEASE_EXPIRED')
      this.authorityDeadline = deadline
      if (action === 'ticket') {
        const admission = this.admission
        this.phase = 'CONNECTING'; this.reason = 'CONNECTING'; this.connectingAt = this.now()
        this.options.output.status(this.getStatus())
        try {
          this.options.view.connect(grant, () => this.authorized(epoch, admission), observation => this.observe(epoch, admission, observation),
            () => this.authorized(epoch, admission) ? Math.max(0, Math.floor(Math.min(this.authorityDeadline, this.boundary) - this.now())) : 0)
        } catch { this.reconnect('LIVE_VIEW_UNAVAILABLE'); return }
      }
      nextDelay = grant.renew_after_ms
    } catch (error) {
      if (this.task !== task || epoch !== this.epoch || !this.allowed) return
      const failure = error instanceof LiveAuthorityError ? error : new LiveAuthorityError('LIVE_AUTHORITY_UNAVAILABLE')
      nextDelay = 1000
      if (failure.code === 'LIVE_AUTHORITY_EPOCH_CHANGED') { this.authority?.resetEpoch(); if (this.active) this.reconnect(failure.code) }
      else if (failure.isIdentityFailure) {
        this.invalidate('LIVE_DEVICE_AUTH_FAILED'); this.allowed = false; this.fallbackReady = false; this.proof = undefined
        this.publishFallback(); this.options.output.identityFailure(failure)
      }
      else if (failure.status === 409 || failure.status === 410 || failure.code === 'INVALID_LIVE_AUTHORITY') {
        if (this.active) this.reconnect(failure.code)
      }
      // A lost response never extends a lease. Existing authorized playback
      // can continue only until its independent main-process watchdog expires.
    } finally {
      if (this.task === task) this.task = undefined
      if (this.allowed && !this.disposed) this.schedule(nextDelay)
    }
  }
  private requestEmergencyControl(): void {
    if (!this.emergencyHold || this.emergencyRefresh || !this.options.refreshControl || !this.allowed || this.disposed) return
    const epoch = this.epoch, started = this.now()
    const request = this.options.refreshControl()
    this.emergencyRefresh = request
    void request.then(result => {
      if (this.emergencyRefresh !== request || epoch !== this.epoch || this.emergencyObservedAt > started || !this.emergencyHold || !this.allowed || this.disposed || !result.fresh || !result.playlist || result.playlist.mode === 'emergency') return
      this.emergencyHold = false; this.invalidate('EMERGENCY_CLEARED')
      this.fallbackReady = false; this.proof = undefined
      if (this.active && this.boundary > this.now()) { this.publishFallback(); this.prepare(true) }
      else {
        this.active = undefined; this.boundary = 0
        const next = this.nextOccurrence
        if (next && next.start <= this.now() && next.end > this.now()) this.select(next.occurrence, next.end)
        else this.release()
      }
      this.wake()
    }).catch(() => undefined).finally(() => { if (this.emergencyRefresh === request) this.emergencyRefresh = undefined })
  }
  private observe(epoch: number, admission: LiveAdmissionIdentity, observation: LiveReceiverObservation): void {
    if (!this.authorized(epoch, admission)) return
    this.rendererPulse = this.now()
    if (observation.kind === 'heartbeat') {
      if (this.rendererPulse - this.lastObservationAt >= 5000) this.sendObservation(admission)
      return
    }
    if (observation.kind === 'disconnected' || observation.kind === 'failed') { this.reconnect('LIVE_DISCONNECTED'); return }
    if (observation.kind === 'connected') this.connected = true
    if (observation.kind === 'audio-ready') this.audio = 'READY'
    if (observation.kind === 'audio-degraded') this.audio = 'DEGRADED'
    if (observation.kind === 'first-frame') {
      if (this.activationPending || this.phase === 'LIVE') return
      this.activationPending = true
      void this.options.output.disposeOrdinary(() => this.authorized(epoch, admission)).then(acknowledged => {
        if (!this.authorized(epoch, admission)) return
        if (!acknowledged || !this.options.view.activate()) { this.reconnect('LIVE_RENDERER_DISPOSAL_FAILED'); return }
        this.phase = 'LIVE'; this.reason = 'AUTHORIZED_FRAME'; this.options.output.status(this.getStatus())
        this.sendObservation(admission)
      }).catch(() => { if (this.authorized(epoch, admission)) this.reconnect('LIVE_RENDERER_DISPOSAL_FAILED') })
      return
    }
    this.sendObservation(admission)
  }
  private sendObservation(admission: LiveAdmissionIdentity): void {
    if (!this.authority) return
    this.lastObservationAt = this.now()
    const sequence = ++this.sequence
    void this.authority.observe(admission, { sequence, connection: this.connected ? 'CONNECTED' : 'CONNECTING',
      subscription: this.phase === 'LIVE' ? 'SUBSCRIBED' : 'SUBSCRIBING', frame: this.phase === 'LIVE' ? 'READY' : 'NONE',
      audio: this.active?.policy?.microphone || this.active?.policy?.screen_share_audio ? this.audio : 'MUTED',
      fallback_ready: this.fallbackReady, fallback_reason: this.fallbackReady ? null : this.reason }).catch(() => undefined)
  }
}
