/**
 * Snapshot Manager - Fetches device snapshots, caches media, and builds playlists
 */

import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { createHash } from 'crypto'
import { getLogger } from '../../common/logger'
import { getConfigManager } from '../../common/config'
import { CacheError, DeviceApiError, LayoutScene, PlaybackMode, TimelineItem } from '../../common/types'
import { atomicWrite, ensureDir } from '../../common/utils'
import { getHttpClient } from './network/http-client'
import { getPairingService } from './pairing-service'
import { buildRevisionedCacheKey, getCacheManager } from './cache/cache-manager'
import { NormalizedSnapshot, parseSnapshotResponse } from './snapshot-parser'
import { getLifecycleEvents } from './lifecycle-events'
import { getSecurePlaybackGuard } from './secure-playback-guard'
import { getHeartbeatService } from './telemetry/heartbeat'
import { NormalizedScheduleWindow, evaluateScheduleWindows } from './snapshot-evaluator'
import type { LiveOccurrence } from '../../common/live-playback'
import { LiveFallbackCache, type PreparedLiveFallback } from './live-fallback-cache'

const logger = getLogger('snapshot-manager')

export interface PlaybackPlaylist {
  mode: PlaybackMode
  items: TimelineItem[]
  scheduleId?: string
  snapshotId?: string
  publishId?: string
  lastSnapshotAt?: string
  live?: LiveOccurrence
  unavailableReason?: string
}

type LayoutSlotSpec = {
  id?: string
  slot_id?: string
  x?: number | string
  y?: number | string
  w?: number | string
  h?: number | string
  width?: number | string
  height?: number | string
  zIndex?: number
  z_index?: number
}

export class SnapshotManager extends EventEmitter {
  private currentSnapshot?: NormalizedSnapshot
  private currentPlaylist?: PlaybackPlaylist
  private pollInterval?: NodeJS.Timeout
  private evaluationTimer?: NodeJS.Timeout
  private isPolling = false
  private snapshotPath: string
  private lastError?: string
  private lastRefreshSucceeded = false
  private serverClockOffsetMs = 0
  private representationEtag?: string
  private lastImmediateEvaluationKey?: string
  // Every refresh captures this generation. A pairing reset or newer refresh
  // invalidates older async work before it can replace visible playback.
  private refreshGeneration = 0
  private readonly liveCache = new LiveFallbackCache()
  private liveKnown = new Map<string, LiveOccurrence>()
  private liveRetained = new Set<string>()
  private liveReady = new Map<string, { fingerprint: string; result: PreparedLiveFallback }>()
  private livePreparing = new Map<string, { fingerprint: string; controller: AbortController; promise: Promise<PreparedLiveFallback> }>()
  private mediaCompletion?: Promise<PlaybackPlaylist | null>
  private discoveredLive: LiveOccurrence[] = []

  constructor() {
    super()
    const config = getConfigManager().getConfig()
    this.snapshotPath = path.join(config.cache.path, 'last-snapshot.json')
    ensureDir(path.dirname(this.snapshotPath), 0o755)
    this.loadCachedSnapshot()
  }

  start(options: { networkPolling?: boolean } = {}): void {
    if (this.isPolling) {
      return
    }

    const networkPolling = options.networkPolling !== false
    const intervalMs = getConfigManager().getConfig().intervals.schedulePollMs

    this.isPolling = true
    if (!networkPolling) {
      logger.info('Snapshot manager started; realtime desired-state reconciliation owns network refreshes')
      return
    }

    this.refreshSnapshot().catch((error) => {
      logger.error({ error }, 'Initial snapshot fetch failed')
    }).finally(() => {
      this.scheduleNextPoll(intervalMs)
    })

    logger.info({ intervalMs }, 'Snapshot manager started with fallback network polling')
  }

  stop(): void {
    if (this.pollInterval) {
      clearTimeout(this.pollInterval)
      this.pollInterval = undefined
    }
    if (this.evaluationTimer) {
      clearTimeout(this.evaluationTimer)
      this.evaluationTimer = undefined
    }
    this.isPolling = false
    for (const preparation of this.livePreparing.values()) preparation.controller.abort()
  }

  getCurrentPlaylist(): PlaybackPlaylist | undefined {
    return this.currentPlaylist
  }

  getLastSnapshotAt(): string | undefined {
    return this.currentPlaylist?.lastSnapshotAt
  }

  getLastError(): string | undefined {
    return this.lastError
  }

  didLastRefreshSucceed(): boolean {
    return this.lastRefreshSucceeded
  }

  getScheduleNowMs(): number { return this.getServerNowMs() }

  /** Same owner registry for snapshot delivery and independently discovered
   * published occurrences; one path cannot release the other's active pins. */
  updateDiscoveredLiveOccurrences(current?: LiveOccurrence, next?: LiveOccurrence): void {
    this.discoveredLive = [current, next].filter((item): item is LiveOccurrence => Boolean(item))
    this.reconcileLiveOwners(this.currentSnapshot)
  }

  getLiveFallbackPlaylist(occurrence: LiveOccurrence): PlaybackPlaylist {
    const ready = this.getPreparedLiveFallback(occurrence)
    const window: NormalizedScheduleWindow = { id: occurrence.itemId, startAt: occurrence.startAt, endAt: occurrence.endAt,
      priority: occurrence.priority, items: [], live: occurrence,
      layout: occurrence.policy?.fallback.manifest.presentation.layout as NormalizedScheduleWindow['layout'] }
    return { mode: 'live', live: occurrence, publishId: occurrence.publishId, scheduleId: occurrence.scheduleId,
      items: ready.ready ? this.buildLayoutSceneItems(window, ready.items, occurrence.scheduleId, undefined, occurrence.publishId) : [],
      ...(ready.ready ? {} : { unavailableReason: ready.reason ?? 'FALLBACK_NOT_READY' }) }
  }

  private liveKey(occurrence: LiveOccurrence): string { return `${occurrence.publishId}:${occurrence.itemId}` }
  private liveFingerprint(occurrence: LiveOccurrence): string {
    return createHash('sha256').update(JSON.stringify(occurrence.policy ?? null)).digest('hex')
  }

  private reconcileLiveOwners(snapshot?: NormalizedSnapshot): void {
    const all = [...(snapshot?.scheduleWindows ?? []).flatMap(window => window.live?.policy && !window.live.invalidReason ? [window.live] : []), ...this.discoveredLive.filter(item => item.policy && !item.invalidReason)]
    const occurrences = [...new Map(all.map(occurrence => [this.liveKey(occurrence), occurrence])).values()]
    const now = this.getServerNowMs()
    const upcoming = occurrences.filter(occurrence => Date.parse(occurrence.endAt) > now)
      .sort((a, b) => {
        const activeA = Date.parse(a.startAt) <= now, activeB = Date.parse(b.startAt) <= now
        if (activeA !== activeB) return activeA ? -1 : 1
        return activeA ? b.priority - a.priority || Date.parse(b.startAt) - Date.parse(a.startAt)
          : Date.parse(a.startAt) - Date.parse(b.startAt) || b.priority - a.priority
      })
    this.liveRetained = new Set(upcoming.slice(0, 2).map(occurrence => this.liveKey(occurrence)))
    const current = new Map(occurrences.map(occurrence => [this.liveKey(occurrence), occurrence]))
    for (const [key, old] of this.liveKnown) {
      const next = current.get(key)
      if (!next || this.liveFingerprint(old) !== this.liveFingerprint(next)) {
        this.livePreparing.get(key)?.controller.abort()
        this.livePreparing.delete(key); this.liveReady.delete(key)
        this.liveCache.release(old)
      } else if (!this.liveRetained.has(key) && !this.livePreparing.has(key)) this.liveCache.release(old)
    }
    this.liveKnown = current
  }

  getPreparedLiveFallback(occurrence: LiveOccurrence): PreparedLiveFallback {
    if (getConfigManager().getConfig().livePlayback?.enabled !== true) return { ready: false, items: [], reason: 'LIVE_PLAYBACK_DISABLED' }
    const cached = this.liveReady.get(this.liveKey(occurrence))
    return cached?.fingerprint === this.liveFingerprint(occurrence) ? cached.result : { ready: false, items: [], reason: occurrence.invalidReason ?? 'FALLBACK_NOT_READY' }
  }

  async prepareLiveFallback(occurrence: LiveOccurrence, options: { download?: boolean; force?: boolean } = {}): Promise<PreparedLiveFallback> {
    if (getConfigManager().getConfig().livePlayback?.enabled !== true) return { ready: false, items: [], reason: 'LIVE_PLAYBACK_DISABLED' }
    if (!occurrence.policy || occurrence.invalidReason) return { ready: false, items: [], reason: 'INVALID_LIVE_POLICY' }
    const key = this.liveKey(occurrence), fingerprint = this.liveFingerprint(occurrence)
    const known = this.liveKnown.get(key)
    if (!known || this.liveFingerprint(known) !== fingerprint) return { ready: false, items: [], reason: 'FALLBACK_CANCELLED' }
    const pending = this.livePreparing.get(key)
    if (pending?.fingerprint === fingerprint) return pending.promise
    const existing = this.liveReady.get(key)
    if (!options.force && existing?.fingerprint === fingerprint && existing.result.ready) return existing.result
    pending?.controller.abort()
    const state = { fingerprint, controller: new AbortController(), promise: Promise.resolve<PreparedLiveFallback>({ ready: false, items: [] }) }
    this.livePreparing.set(key, state)
    state.promise = this.liveCache.prepare(occurrence, { signal: state.controller.signal, download: options.download }).then(result => {
      if (state.controller.signal.aborted || this.livePreparing.get(key) !== state || this.liveKnown.get(key)?.policy === undefined || this.liveFingerprint(this.liveKnown.get(key)!) !== fingerprint) {
        return { ready: false, items: [], reason: 'FALLBACK_CANCELLED' }
      }
      const old = this.liveReady.get(key)
      this.liveReady.set(key, { fingerprint, result })
      if (this.currentSnapshot && old?.result.ready !== result.ready) void this.rebuildFromCachedSnapshot(this.currentSnapshot.snapshotId)
      return result
    }).finally(() => {
      if (this.livePreparing.get(key) === state) {
        this.livePreparing.delete(key)
        if (!this.liveRetained.has(key)) this.liveCache.release(occurrence)
      }
    })
    return state.promise
  }

  clearIdentityBoundState(): void {
    this.refreshGeneration += 1
    if (this.evaluationTimer) {
      clearTimeout(this.evaluationTimer)
      this.evaluationTimer = undefined
    }

    this.currentSnapshot = undefined
    for (const preparation of this.livePreparing.values()) preparation.controller.abort()
    this.livePreparing.clear()
    for (const occurrence of this.liveKnown.values()) this.liveCache.release(occurrence)
    this.liveKnown.clear(); this.liveReady.clear(); this.liveRetained.clear()
    this.discoveredLive = []
    this.clearAppliedSnapshot()
    this.lastError = undefined
    this.lastRefreshSucceeded = false

    if (fs.existsSync(this.snapshotPath)) {
      try {
        fs.unlinkSync(this.snapshotPath)
      } catch (error) {
        logger.warn({ error, snapshotPath: this.snapshotPath }, 'Failed to remove cached snapshot metadata')
      }
    }

    const playlist: PlaybackPlaylist = {
      mode: 'empty',
      items: [],
    }

    this.currentPlaylist = playlist
    this.emit('playlist-updated', playlist)
  }

  async refreshSnapshot(
    options: {
      retryOnExpired?: boolean
      force?: boolean
      onSnapshotFetched?: () => void
      allowWhileSecurityLocked?: boolean
    } = {}
  ): Promise<PlaybackPlaylist | null> {
    const pairingService = getPairingService()
    const deviceId = pairingService.getDeviceId()

    if (!deviceId) {
      return null
    }
    if (getSecurePlaybackGuard().isPlaybackLocked() && options.allowWhileSecurityLocked !== true) {
      this.lastRefreshSucceeded = false
      logger.warn('Ignoring snapshot refresh while the playback security lock is active')
      return this.currentPlaylist ?? null
    }

    const generation = ++this.refreshGeneration
    const retryOnExpired = options.retryOnExpired !== false

    try {
      const httpClient = getHttpClient()
      const response = await httpClient.getResponse(`/api/v1/device/${deviceId}/snapshot?include_urls=true`, {
        headers: this.representationEtag && !options.force
          ? {
              'If-None-Match': this.representationEtag,
            }
          : undefined,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
      })

      if (response.status === 304 && this.currentSnapshot) {
        if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
        logger.debug({ snapshotId: this.currentSnapshot.snapshotId }, 'Snapshot not modified, reusing cached payload')
        const playlist = await this.buildPlaylist(this.currentSnapshot, 'normal')
        if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
        this.currentPlaylist = playlist
        this.lastError = undefined
        this.lastRefreshSucceeded = true
        this.emit('playlist-updated', playlist)
        if (this.currentSnapshot.invalidLiveControls || this.currentSnapshot.emergencyActive || this.currentSnapshot.scheduleWindows.some(window => window.live)) {
          this.beginMediaCompletion(this.currentSnapshot, generation)
        }
        return playlist
      }

      if (response.data && typeof response.data === 'object' && (response.data as any).success === false) {
        const message = (response.data as any)?.error?.message || 'Snapshot request failed'
        throw new Error(message)
      }

      const normalized = parseSnapshotResponse(response.data, { deviceId })
      const responseEtag = response.headers?.['etag']
      if (generation !== this.refreshGeneration) {
        logger.debug({ generation }, 'Discarding stale snapshot response before cache hydration')
        return this.currentPlaylist ?? null
      }
      options.onSnapshotFetched?.()
      this.updateServerClock(normalized.serverTime)
      this.representationEtag = typeof responseEtag === 'string' ? responseEtag : undefined
      this.reconcileLiveOwners(normalized)
      // Publish the new control surface before potentially long immutable
      // downloads. A LIVE/emergency window cannot reveal an ordinary default.
      const immediateControl = normalized.invalidLiveControls || normalized.emergencyActive || normalized.scheduleWindows.some(window => window.live) || this.currentPlaylist?.mode === 'live'
      if (immediateControl) {
        const control = await this.buildPlaylist(normalized, 'normal')
        if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
        this.currentSnapshot = normalized
        this.currentPlaylist = control
        this.emit('playlist-updated', control)
      }
      if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
      await this.persistSnapshot(normalized)
      if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
      if (immediateControl) {
        this.lastError = undefined
        this.lastRefreshSucceeded = true
        this.beginMediaCompletion(normalized, generation)
        return this.currentPlaylist ?? null
      }
      return await this.completeSnapshotMedia(normalized, generation)
    } catch (error: any) {
      if (generation !== this.refreshGeneration) {
        logger.debug({ generation }, 'Discarding stale snapshot refresh failure')
        return this.currentPlaylist ?? null
      }
      if (error instanceof DeviceApiError && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND')) {
        getLifecycleEvents().emitRuntimeAuthFailure({
          source: 'snapshot',
          error,
        })
      }

      const status = error?.response?.status

      if (status === 404) {
        logger.warn('Snapshot not found (404), clearing scheduled content instead of reusing cached snapshot')
        this.lastRefreshSucceeded = true
        return this.applyIntentionalNoContent(undefined, 'empty', 'No published snapshot available')
      }

      if (error instanceof CacheError && error.details?.['reason'] === 'URL_EXPIRED' && retryOnExpired) {
        logger.warn('Media URL expired, refetching snapshot')
        return await this.refreshSnapshot({
          retryOnExpired: false,
          force: true,
          onSnapshotFetched: options.onSnapshotFetched,
          allowWhileSecurityLocked: options.allowWhileSecurityLocked,
        })
      }

      logger.error({ error }, 'Snapshot fetch failed, using offline fallback')
      this.lastRefreshSucceeded = false
      return this.applyOfflineFallback((error as Error).message)
    }
  }

  private beginMediaCompletion(snapshot: NormalizedSnapshot, generation: number): void {
    this.clearAppliedSnapshot()
    const completion = this.completeSnapshotMedia(snapshot, generation).catch(() => {
      if (generation === this.refreshGeneration) {
        this.clearAppliedSnapshot()
        this.lastError = 'Snapshot content preparation is incomplete'
      }
      return this.currentPlaylist ?? null
    })
    this.mediaCompletion = completion
    void completion.finally(() => {
      if (this.mediaCompletion === completion) this.mediaCompletion = undefined
    })
  }

  private async completeSnapshotMedia(snapshot: NormalizedSnapshot, generation: number): Promise<PlaybackPlaylist | null> {
    const mediaReady = await this.cacheSnapshotMedia(snapshot)
    if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
    const playlist = await this.buildPlaylist(snapshot, 'normal')
    if (generation !== this.refreshGeneration) return this.currentPlaylist ?? null
    this.currentSnapshot = snapshot
    this.currentPlaylist = playlist
    this.lastError = undefined
    this.lastRefreshSucceeded = true
    if (mediaReady) this.recordAppliedSnapshot(snapshot, true)
    else this.clearAppliedSnapshot()
    this.emit('playlist-updated', playlist)
    return playlist
  }

  private loadCachedSnapshot(): void {
    if (!fs.existsSync(this.snapshotPath)) {
      return
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf-8'))
      const cacheMetadata = data?.__darshan_cache
      if (cacheMetadata && typeof cacheMetadata === 'object') {
        if (typeof cacheMetadata.server_clock_offset_ms === 'number' && Number.isFinite(cacheMetadata.server_clock_offset_ms)) {
          this.serverClockOffsetMs = cacheMetadata.server_clock_offset_ms
        }
        if (typeof cacheMetadata.representation_etag === 'string') {
          this.representationEtag = cacheMetadata.representation_etag
        }
      }
      const normalized = parseSnapshotResponse(data, { deviceId: getPairingService().getDeviceId() ?? undefined })
      this.reconcileLiveOwners(normalized)
      this.currentSnapshot = normalized
      const generation = this.refreshGeneration
      this.buildPlaylist(normalized, 'offline').then((playlist) => {
        if (generation !== this.refreshGeneration || this.currentSnapshot !== normalized) return
        this.currentPlaylist = playlist
        this.emit('playlist-updated', playlist)
        void this.requiredSnapshotMediaIsReady(normalized)
          .then((mediaReady) => {
            if (mediaReady && generation === this.refreshGeneration && this.currentSnapshot === normalized) {
              this.recordAppliedSnapshot(normalized, false)
            }
          })
          .catch((error) => {
            logger.warn({ error }, 'Could not validate cached snapshot media readiness')
          })
      })
      logger.info('Loaded cached snapshot for offline fallback')
    } catch (error) {
      logger.error({ error }, 'Failed to load cached snapshot')
    }
  }

  private async persistSnapshot(snapshot: NormalizedSnapshot): Promise<void> {
    const payload = snapshot.raw ?? snapshot
    const cachedPayload = payload && typeof payload === 'object'
      ? {
          ...(payload as Record<string, unknown>),
          __darshan_cache: {
            representation_etag: this.representationEtag ?? null,
            server_clock_offset_ms: this.serverClockOffsetMs,
            cached_at: new Date().toISOString(),
          },
        }
      : payload
    await atomicWrite(this.snapshotPath, JSON.stringify(cachedPayload, null, 2))
  }

  private async cacheSnapshotMedia(snapshot: NormalizedSnapshot): Promise<boolean> {
    const cacheManager = getCacheManager()
    const liveWindows = snapshot.scheduleWindows.filter(window => window.live)
      .sort((a, b) => (this.liveRetained.has(this.liveKey(a.live!)) ? 0 : 1) - (this.liveRetained.has(this.liveKey(b.live!)) ? 0 : 1) || Date.parse(a.startAt!) - Date.parse(b.startAt!))
    // Each owner is released after non-current preparation; only the current
    // and next occurrence retain pins. Every dependency is rechecked for ACK.
    for (const window of liveWindows) await this.prepareLiveFallback(window.live!)
    const prioritizedItems: TimelineItem[] = []
    const activeWindow = snapshot.scheduleWindows.length > 0
      ? evaluateScheduleWindows(snapshot.scheduleWindows, this.getServerNowMs()).activeWindow
      : undefined

    if (activeWindow) {
      prioritizedItems.push(...activeWindow.items)
    }
    if (snapshot.emergencyItem) prioritizedItems.push(snapshot.emergencyItem)
    if (snapshot.defaultItem) prioritizedItems.push(snapshot.defaultItem)
    prioritizedItems.push(...snapshot.items)
    snapshot.scheduleWindows.forEach((window) => {
      if (window.id !== activeWindow?.id) {
        prioritizedItems.push(...window.items)
      }
    })

    const prefetchItems: Array<{
      mediaId: string
      url: string
      sha256?: string
      contentType?: string
      source?: 'SNAPSHOT' | 'DEFAULT_MEDIA' | 'EMERGENCY'
      snapshotId?: string
      scheduleId?: string
      playbackMode?: Exclude<PlaybackMode, 'live'>
    }> = []
    for (const item of prioritizedItems) {
      if (!item.mediaId) {
        continue
      }

      const source =
        snapshot.emergencyItem === item
          ? 'EMERGENCY'
          : snapshot.defaultItem === item
            ? 'DEFAULT_MEDIA'
            : 'SNAPSHOT'

      const cacheUrl =
        item.type === 'url'
          ? (typeof item.meta?.['fallback_url'] === 'string' ? String(item.meta?.['fallback_url']) : undefined)
          : item.remoteUrl

      if (!cacheUrl) {
        continue
      }

      const fallbackRevision = item.type === 'url'
        ? (typeof item.meta?.['fallback_revision'] === 'string'
            ? String(item.meta?.['fallback_revision'])
            : typeof item.meta?.['fallback_sha256'] === 'string'
              ? String(item.meta?.['fallback_sha256'])
              : undefined)
        : undefined

      prefetchItems.push({
        mediaId: buildRevisionedCacheKey(item.mediaId, fallbackRevision),
        url: cacheUrl,
        sha256: item.sha256,
        contentType:
          typeof item.meta?.['content_type'] === 'string' ? String(item.meta?.['content_type']) : undefined,
        source,
        snapshotId: snapshot.snapshotId,
        scheduleId: snapshot.scheduleId,
        playbackMode: source === 'EMERGENCY' ? 'emergency' : source === 'DEFAULT_MEDIA' ? 'default' : 'normal',
      })
    }

    try {
      await cacheManager.prefetch(prefetchItems)
    } catch (error) {
      if (error instanceof CacheError && error.details?.['reason'] === 'URL_EXPIRED') {
        throw error
      }
      logger.warn({ error }, 'Failed to prefetch snapshot media')
    }

    return await this.requiredSnapshotMediaIsReady(snapshot)
  }

  private async requiredSnapshotMediaIsReady(snapshot: NormalizedSnapshot): Promise<boolean> {
    if (snapshot.invalidLiveControls) return false
    for (const window of snapshot.scheduleWindows) {
      if (window.live && !(await this.prepareLiveFallback(window.live, { download: false, force: true })).ready) return false
    }
    const cacheManager = getCacheManager()
    const scheduledItems = [
      ...snapshot.items,
      ...snapshot.scheduleWindows.flatMap((window) => window.items),
    ]
    const requiredKeys = new Set<string>()
    for (const item of [...scheduledItems, snapshot.defaultItem, snapshot.emergencyItem].filter(Boolean) as TimelineItem[]) {
      if (item.type === 'message') {
        continue
      }
      if (item.type === 'url' && typeof item.meta?.['fallback_url'] !== 'string') {
        if (!item.remoteUrl) {
          return false
        }
        continue
      }
      if (!item.mediaId) {
        return false
      }
      const revision = item.type === 'url'
        ? (typeof item.meta?.['fallback_revision'] === 'string'
            ? String(item.meta['fallback_revision'])
            : typeof item.meta?.['fallback_sha256'] === 'string'
              ? String(item.meta['fallback_sha256'])
              : undefined)
        : undefined
      requiredKeys.add(buildRevisionedCacheKey(item.mediaId, revision))
    }
    const readiness = await Promise.all([...requiredKeys].map((cacheKey) => cacheManager.has(cacheKey)))
    return readiness.every(Boolean)
  }

  private async buildPlaylist(snapshot: NormalizedSnapshot, _fallbackMode: PlaybackMode): Promise<PlaybackPlaylist> {
    let mode: PlaybackMode = 'normal'
    let items: TimelineItem[] = []
    let nextTransitionAt: number | undefined
    let live: LiveOccurrence | undefined
    let unavailableReason: string | undefined
    const emergencyExpiresAtMs = snapshot.emergencyExpiresAt ? Date.parse(snapshot.emergencyExpiresAt) : Number.NaN
    const emergencyItem =
      snapshot.emergencyItem &&
      (!Number.isFinite(emergencyExpiresAtMs) || emergencyExpiresAtMs > this.getServerNowMs())
        ? snapshot.emergencyItem
        : undefined

    this.reconcileLiveOwners(snapshot)
    if (snapshot.emergencyActive && (!Number.isFinite(emergencyExpiresAtMs) || emergencyExpiresAtMs > this.getServerNowMs()) && !emergencyItem) {
      mode = 'emergency'; items = []; unavailableReason = 'EMERGENCY_CONTENT_UNAVAILABLE'
      nextTransitionAt = Number.isFinite(emergencyExpiresAtMs) ? emergencyExpiresAtMs : undefined
    } else if (snapshot.invalidLiveControls && !emergencyItem) {
      mode = 'live'; items = []; unavailableReason = 'INVALID_LIVE_WINDOW'
    } else if (snapshot.contentState === 'empty' && !emergencyItem) {
      mode = 'empty'
      items = []
    } else if (snapshot.contentState === 'default' && !emergencyItem) {
      if (snapshot.defaultItem) {
        mode = 'default'
        items = await this.attachLocalMedia([snapshot.defaultItem])
      } else {
        mode = 'empty'
        items = []
      }
    } else if (emergencyItem) {
      mode = 'emergency'
      items = await this.attachLocalMedia([emergencyItem])
      nextTransitionAt =
        snapshot.emergencyExpiresAt && Number.isFinite(Date.parse(snapshot.emergencyExpiresAt))
          ? Date.parse(snapshot.emergencyExpiresAt)
          : undefined
    } else if (snapshot.scheduleWindows.length > 0) {
      const evaluation = evaluateScheduleWindows(snapshot.scheduleWindows, this.getServerNowMs())
      nextTransitionAt = evaluation.nextTransitionAt

      if (evaluation.activeWindow?.live) {
        mode = 'live'
        live = evaluation.activeWindow.live
        const prepared = this.getPreparedLiveFallback(live)
        items = prepared.ready ? this.buildLayoutSceneItems(evaluation.activeWindow, prepared.items, snapshot.scheduleId, snapshot.snapshotId, snapshot.publishId) : []
        unavailableReason = prepared.ready ? undefined : prepared.reason ?? 'FALLBACK_NOT_READY'
      } else if (evaluation.activeWindow && evaluation.items.length > 0) {
        mode = 'normal'
        const hydratedWindowItems = await this.attachLocalMedia(evaluation.items)
        items = this.buildLayoutSceneItems(
          evaluation.activeWindow,
          hydratedWindowItems,
          snapshot.scheduleId,
          snapshot.snapshotId,
          snapshot.publishId
        )
      } else if (snapshot.defaultItem) {
        mode = 'default'
        items = await this.attachLocalMedia([snapshot.defaultItem])
      } else {
        mode = 'empty'
        items = []
      }
    } else if (snapshot.items.length > 0) {
      mode = 'normal'
      items = await this.attachLocalMedia(snapshot.items)
    } else if (snapshot.defaultItem) {
      mode = 'default'
      items = await this.attachLocalMedia([snapshot.defaultItem])
    } else {
      mode = 'empty'
      items = []
    }

    const signedUrlRefreshAt = this.findSignedUrlRefreshAt(snapshot)
    const forceRefreshAt = signedUrlRefreshAt && (!nextTransitionAt || signedUrlRefreshAt < nextTransitionAt)
      ? signedUrlRefreshAt
      : undefined
    this.scheduleLocalEvaluation(snapshot, forceRefreshAt ?? nextTransitionAt, Boolean(forceRefreshAt))

    return {
      mode,
      items,
      scheduleId: snapshot.scheduleId,
      snapshotId: snapshot.snapshotId,
      publishId: snapshot.publishId,
      lastSnapshotAt: snapshot.fetchedAt,
      ...(live ? { live } : {}),
      ...(unavailableReason ? { unavailableReason } : {}),
    }
  }

  private recordAppliedSnapshot(snapshot: NormalizedSnapshot, sendImmediately: boolean): void {
    if (!snapshot.publishId || !snapshot.snapshotId) {
      return
    }
    const heartbeat = getHeartbeatService()
    heartbeat.setAppliedSnapshot(snapshot.publishId, snapshot.snapshotId)
    if (sendImmediately) {
      void heartbeat.sendImmediate().catch((error) => {
        logger.warn(
          { error, publishId: snapshot.publishId, snapshotId: snapshot.snapshotId },
          'Immediate applied-snapshot heartbeat failed; the next heartbeat will retry'
        )
      })
    }
  }

  private clearAppliedSnapshot(): void {
    getHeartbeatService().clearAppliedSnapshot()
  }

  private scheduleLocalEvaluation(snapshot: NormalizedSnapshot, nextTransitionAt?: number, forceRefresh = false): void {
    if (this.evaluationTimer) {
      clearTimeout(this.evaluationTimer)
      this.evaluationTimer = undefined
    }

    if (!nextTransitionAt || !Number.isFinite(nextTransitionAt)) {
      return
    }

    const remainingMs = nextTransitionAt - this.getServerNowMs()
    // Schedule boundaries are authoritative and must be applied immediately
    // when already due. Signed-URL refreshes keep a small floor so a backend
    // returning the same expired URL cannot create a tight refresh loop.
    if (!forceRefresh && remainingMs <= 0) {
      const immediateKey = `${snapshot.snapshotId || 'snapshot'}:${nextTransitionAt}`
      if (this.lastImmediateEvaluationKey === immediateKey) {
        logger.warn({ immediateKey }, 'Skipping repeated expired snapshot boundary evaluation')
        return
      }
      this.lastImmediateEvaluationKey = immediateKey
    } else if (remainingMs > 0) {
      this.lastImmediateEvaluationKey = undefined
    }

    const delayMs = forceRefresh ? Math.max(250, remainingMs) : Math.max(0, remainingMs)
    this.evaluationTimer = setTimeout(() => {
      if (forceRefresh) {
        void this.refreshSnapshot({ force: true })
        return
      }
      void this.rebuildFromCachedSnapshot(snapshot.snapshotId)
    }, delayMs)
  }

  private findSignedUrlRefreshAt(snapshot: NormalizedSnapshot): number | undefined {
    const urls = new Set<string>()
    const collect = (item?: TimelineItem) => {
      if (!item) return
      if (item.remoteUrl) urls.add(item.remoteUrl)
      const fallback = item.meta?.['fallback_url']
      if (typeof fallback === 'string') urls.add(fallback)
    }
    snapshot.items.forEach(collect)
    snapshot.scheduleWindows.forEach((window) => window.items.forEach(collect))
    snapshot.scheduleWindows.forEach(window => window.live?.downloads.forEach(download => urls.add(download.url)))
    collect(snapshot.defaultItem)
    collect(snapshot.emergencyItem)

    const candidates: number[] = []
    for (const rawUrl of urls) {
      try {
        const url = new URL(rawUrl)
        const date = url.searchParams.get('X-Amz-Date') ?? url.searchParams.get('x-amz-date')
        const expires = Number(url.searchParams.get('X-Amz-Expires') ?? url.searchParams.get('x-amz-expires'))
        if (!date || !Number.isFinite(expires)) continue
        const match = date.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
        if (!match) continue
        const issuedAt = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]))
        const refreshAt = issuedAt + expires * 1000 - 60_000
        // Keep already-expired signatures in the candidate set. The scheduler
        // clamps past boundaries to a near-immediate refresh, which prevents a
        // persisted representation ETag from validating otherwise stale URLs
        // after a player restart.
        if (Number.isFinite(refreshAt)) candidates.push(refreshAt)
      } catch {
        // Non-URL and non-S3 media sources do not need signature refresh scheduling.
      }
    }
    return candidates.length > 0 ? Math.min(...candidates) : undefined
  }

  private async rebuildFromCachedSnapshot(expectedSnapshotId?: string): Promise<void> {
    if (!this.currentSnapshot) {
      return
    }

    if (expectedSnapshotId && this.currentSnapshot.snapshotId && expectedSnapshotId !== this.currentSnapshot.snapshotId) {
      return
    }

    const snapshot = this.currentSnapshot, generation = this.refreshGeneration
    const playlist = await this.buildPlaylist(snapshot, 'offline')
    if (generation !== this.refreshGeneration || this.currentSnapshot !== snapshot) return
    this.currentPlaylist = playlist
    this.emit('playlist-updated', playlist)
  }

  private async attachLocalMedia(items: TimelineItem[]): Promise<TimelineItem[]> {
    const cacheManager = getCacheManager()

    const hydrated: TimelineItem[] = []
    for (const item of items) {
      const mediaId = item.mediaId || item.objectKey
      const contentType =
        typeof item.meta?.['content_type'] === 'string' ? String(item.meta?.['content_type']) : undefined
      let localPath: string | undefined
      let cacheKey = mediaId
      if (mediaId) {
        if (item.type === 'url') {
          const requestedRevision =
            typeof item.meta?.['fallback_revision'] === 'string'
              ? String(item.meta?.['fallback_revision'])
              : typeof item.meta?.['fallback_sha256'] === 'string'
                ? String(item.meta?.['fallback_sha256'])
                : undefined
          const resolved = await cacheManager.resolveRevisioned(mediaId, requestedRevision, contentType)
          localPath = resolved?.localPath
          cacheKey = resolved?.cacheKey ?? buildRevisionedCacheKey(mediaId, requestedRevision)
        } else {
          localPath = await cacheManager.get(mediaId, contentType)
        }
      }

      if (!localPath && item.type !== 'url' && item.type !== 'message') {
        logger.warn({ mediaId }, 'Media not cached, keeping remote playback source')
      }

      const fallbackRevision =
        typeof item.meta?.['fallback_revision'] === 'string'
          ? String(item.meta?.['fallback_revision'])
          : undefined
      const fallbackLocalUrl = localPath
        ? `${pathToFileURL(localPath).toString()}${fallbackRevision ? `?revision=${encodeURIComponent(fallbackRevision)}` : ''}`
        : undefined

      hydrated.push({
        ...item,
        localPath,
        localUrl: fallbackLocalUrl,
        meta: item.type === 'url'
          ? {
              ...(item.meta ?? {}),
              fallback_local_url: fallbackLocalUrl,
              cache_key: cacheKey,
            }
          : item.meta,
      })
    }

    return hydrated
  }

  private buildLayoutSceneItems(
    window: NormalizedScheduleWindow,
    items: TimelineItem[],
    scheduleId?: string,
    snapshotId?: string,
    publishId?: string,
  ): TimelineItem[] {
    const scheduledItems = this.addScheduleWindowMeta(window, items, scheduleId, snapshotId, publishId)
    const slots = this.extractLayoutSlots(window)
    if (slots.length === 0) {
      return scheduledItems
    }

    const itemsBySlot = new Map<string, TimelineItem[]>()
    for (const item of scheduledItems) {
      const slotId = typeof item.meta?.['slotId'] === 'string' ? String(item.meta?.['slotId']) : undefined
      if (!slotId) {
        return scheduledItems
      }
      const bucket = itemsBySlot.get(slotId) || []
      bucket.push(item)
      itemsBySlot.set(slotId, bucket)
    }

    const sceneSlots = slots
      .map((slot) => {
        const slotId = slot.id || slot.slot_id
        if (!slotId) {
          return null
        }

        const slotItems = itemsBySlot.get(slotId) || []
        if (slotItems.length === 0) {
          return null
        }

        return {
          id: slotId,
          bounds: {
            x: slot.x ?? 0,
            y: slot.y ?? 0,
            w: slot.w ?? slot.width ?? 1,
            h: slot.h ?? slot.height ?? 1,
            zIndex: slot.zIndex ?? slot.z_index,
          },
          items: slotItems,
        }
      })
      .filter(Boolean) as LayoutScene['slots']

    if (sceneSlots.length === 0) {
      return items
    }

    const nowMs = this.getServerNowMs()
    const endAtMs = window.endAt ? Date.parse(window.endAt) : Number.NaN
    // The scene item is the main-process hard-stop guard. Preserve the real
    // remaining window even in the final sub-second interval so the scheduler
    // cannot extend playback by the old one-second minimum.
    const remainingMs = Number.isFinite(endAtMs) ? Math.max(1, endAtMs - nowMs) : 10000

    const scene: LayoutScene = {
      layoutId: window.layout?.id,
      layoutName: window.layout?.name,
      aspectRatio: window.layout?.aspect_ratio,
      startsAt: window.startAt,
      endsAt: window.endAt,
      serverTimeOffsetMs: this.serverClockOffsetMs,
      slots: sceneSlots,
    }

    return [
      {
        id: `scene:${window.id}`,
        type: 'scene',
        displayMs: remainingMs,
        fit: 'contain',
        muted: true,
        loop: false,
        transitionDurationMs: 0,
        meta: {
          source: 'schedule',
          scheduleId,
          snapshotId,
          publishId,
          presentationId: window.presentationId,
          presentationName: window.presentationName,
          layout: window.layout,
          scene,
        },
      },
    ]
  }

  private addScheduleWindowMeta(
    window: NormalizedScheduleWindow,
    items: TimelineItem[],
    scheduleId?: string,
    snapshotId?: string,
    publishId?: string,
  ): TimelineItem[] {
    return items.map((item) => ({
      ...item,
      meta: {
        ...(item.meta ?? {}),
        source: 'schedule',
        scheduleId,
        snapshotId,
        publishId,
        presentationId: window.presentationId,
        presentationName: window.presentationName,
        scheduleWindowId: window.id,
        scheduleWindowStartsAt: window.startAt,
        scheduleWindowEndsAt: window.endAt,
        serverTimeOffsetMs: this.serverClockOffsetMs,
      },
    }))
  }

  private extractLayoutSlots(window: NormalizedScheduleWindow): LayoutSlotSpec[] {
    const spec = window.layout?.spec
    if (!spec || typeof spec !== 'object') {
      return []
    }

    const slots = (spec as { slots?: unknown[] }).slots
    return Array.isArray(slots) ? (slots as LayoutSlotSpec[]) : []
  }

  private async applyOfflineFallback(reason?: string): Promise<PlaybackPlaylist> {
    this.lastError = reason

    if (this.currentSnapshot) {
      const snapshot = this.currentSnapshot, generation = this.refreshGeneration
      const playlist = await this.buildPlaylist(snapshot, 'offline')
      if (generation !== this.refreshGeneration || this.currentSnapshot !== snapshot) return this.currentPlaylist ?? { mode: 'empty', items: [] }
      const effectivePlaylist =
        playlist.mode === 'empty' && snapshot.contentState === 'scheduled'
          ? {
              ...playlist,
              mode: 'offline' as PlaybackMode,
            }
          : playlist
      this.currentPlaylist = effectivePlaylist
      this.emit('playlist-updated', effectivePlaylist)
      return effectivePlaylist
    }

    const playlist: PlaybackPlaylist = {
      mode: 'offline',
      items: [],
      lastSnapshotAt: this.currentPlaylist?.lastSnapshotAt,
    }
    this.currentPlaylist = playlist
    this.emit('playlist-updated', playlist)
    return playlist
  }

  private async applyIntentionalNoContent(
    snapshot: NormalizedSnapshot | undefined,
    contentState: 'default' | 'empty',
    reason?: string
  ): Promise<PlaybackPlaylist> {
    this.lastError = reason
    if (this.evaluationTimer) {
      clearTimeout(this.evaluationTimer)
      this.evaluationTimer = undefined
    }

    const nextSnapshot =
      snapshot ??
      ({
        contentState,
        items: [],
        scheduleWindows: [],
        mediaUrlMap: {},
        fetchedAt: new Date().toISOString(),
      } as NormalizedSnapshot)

    this.currentSnapshot = nextSnapshot
    const generation = this.refreshGeneration
    const playlist = await this.buildPlaylist(nextSnapshot, 'normal')
    if (generation !== this.refreshGeneration || this.currentSnapshot !== nextSnapshot) return this.currentPlaylist ?? { mode: 'empty', items: [] }
    this.currentPlaylist = playlist
    this.clearAppliedSnapshot()
    this.emit('playlist-updated', playlist)
    return playlist
  }

  private updateServerClock(serverTime?: string): void {
    if (!serverTime) {
      return
    }

    const serverMs = Date.parse(serverTime)
    if (!Number.isFinite(serverMs)) {
      return
    }

    this.serverClockOffsetMs = serverMs - Date.now()
  }

  private getServerNowMs(): number {
    return Date.now() + this.serverClockOffsetMs
  }

  private scheduleNextPoll(intervalMs: number): void {
    if (!this.isPolling) {
      return
    }

    if (this.pollInterval) {
      clearTimeout(this.pollInterval)
    }

    const jitter = intervalMs * 0.15 * (Math.random() * 2 - 1)
    const delayMs = Math.max(1000, Math.round(intervalMs + jitter))
    this.pollInterval = setTimeout(() => {
      this.refreshSnapshot()
        .catch((error) => {
          logger.error({ error }, 'Snapshot poll failed')
        })
        .finally(() => {
          this.scheduleNextPoll(intervalMs)
        })
    }, delayMs)
  }
}

// Singleton instance
let snapshotManager: SnapshotManager | null = null

export function getSnapshotManager(): SnapshotManager {
  if (!snapshotManager) {
    snapshotManager = new SnapshotManager()
  }
  return snapshotManager
}
