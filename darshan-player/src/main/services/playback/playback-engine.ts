/**
 * Playback Engine - Main orchestrator for media playback
 * Coordinates timeline scheduling, media rendering, and transitions
 */

import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import { getLogger } from '../../../common/logger'
import { ActiveSlotPlayback, PlaybackError, TimelineItem } from '../../../common/types'
import { getCacheManager } from '../cache/cache-manager'
import { getProofOfPlayService } from '../pop-service'
import { getTelemetryService } from '../telemetry/telemetry-service'
import { TimelineScheduler, ScheduledItem } from './timeline-scheduler'
import { getSnapshotManager, PlaybackPlaylist } from '../snapshot-manager'
import { getSecurePlaybackGuard } from '../secure-playback-guard'
import { getContentOwner } from './content-owner'

const logger = getLogger('playback-engine')

export type PlaybackState = 'stopped' | 'playing' | 'paused' | 'error' | 'emergency'

function usesTimelinePlayback(playlist: PlaybackPlaylist): boolean {
  return playlist.mode === 'normal' || playlist.mode === 'emergency'
}

export class PlaybackEngine extends EventEmitter {
  private state: PlaybackState = 'stopped'
  private scheduler: TimelineScheduler
  private mainWindow?: BrowserWindow
  private currentItem?: TimelineItem
  private currentScheduleId?: string
  private currentPublishId?: string
  private currentRenderToken?: string
  private currentTimelineFingerprint?: string
  private currentPlaybackInstanceId?: string
  private currentPlaylistItemCount = 0
  private errorCount = 0
  private maxErrors = 5
  private externallyOwned = false

  constructor() {
    super()
    this.scheduler = new TimelineScheduler()
    this.setupSchedulerListeners()
    this.setupSnapshotManagerListeners()
  }

  /**
   * Initialize playback engine with main window
   */
  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow
    logger.info('Playback engine initialized')
  }

  /**
   * Start playback
   */
  async start(): Promise<void> {
    if (this.externallyOwned) return
    if (this.state === 'playing') {
      logger.warn('Playback already started')
      return
    }

    logger.info('Starting playback')

    try {
      if (getSecurePlaybackGuard().isPlaybackLocked()) {
        logger.warn('Secure offline playback lock is active; timeline playback will not start')
        this.stop()
        return
      }

      const snapshotManager = getSnapshotManager()
      const playlist = snapshotManager.getCurrentPlaylist()

      if (!playlist || playlist.items.length === 0) {
        throw new Error('No playlist available')
      }

      if (!usesTimelinePlayback(playlist)) {
        logger.info({ mode: playlist.mode }, 'Skipping timeline playback for non-scheduled playlist')
        this.stop()
        return
      }

      await this.startPlaylist(playlist)

      this.emit('playback-started')
      logger.info({ scheduleId: playlist.scheduleId, itemCount: playlist.items.length }, 'Playback started')
    } catch (error) {
      logger.error({ error }, 'Failed to start playback')
      this.state = 'error'
      this.handleError(error as Error)
      throw error
    }
  }

  setExternalOwnership(owned: boolean): void {
    if (this.externallyOwned === owned) return
    this.externallyOwned = owned
    this.stop()
  }

  /** Only the main LIVE coordinator calls this after exact local readiness. */
  async playOwnedFallback(playlist: PlaybackPlaylist): Promise<void> {
    if (!this.externallyOwned || playlist.mode !== 'live' || getSecurePlaybackGuard().isPlaybackLocked()) return
    const fingerprint = this.fingerprintPlaylist(playlist)
    if (this.state === 'playing' && this.currentTimelineFingerprint === fingerprint) return
    this.stop()
    if (playlist.items.length) await this.startPlaylist(playlist)
  }

  /**
   * Stop playback
   */
  stop(): void {
    logger.info('Stopping playback')

    this.scheduler.stop()
    this.state = 'stopped'
    if (this.currentPlaybackInstanceId) {
      const popService = getProofOfPlayService()
      popService.recordEnd(this.currentPlaybackInstanceId, false)
      this.currentPlaybackInstanceId = undefined
    }
    this.currentItem = undefined
    this.currentScheduleId = undefined
    this.currentPublishId = undefined
    this.currentRenderToken = undefined
    this.currentTimelineFingerprint = undefined
    this.currentPlaylistItemCount = 0

    const telemetryService = getTelemetryService()
    telemetryService.clearCurrentPlayback()

    if (this.mainWindow) {
      this.mainWindow.webContents.send('playback-update', {
        contentEpoch: getContentOwner().getEpoch(),
        type: 'clear-active',
        reason: 'timeline-stopped',
      })
    }

    this.emit('playback-stopped')
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.state !== 'playing') {
      return
    }

    logger.info('Pausing playback')

    this.scheduler.pause()
    this.state = 'paused'

    this.emit('playback-paused')
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this.state !== 'paused') {
      return
    }

    logger.info('Resuming playback')

    this.scheduler.resume()
    this.state = 'playing'

    this.emit('playback-resumed')
  }

  /**
   * Handle emergency override
   */
  private async startPlaylist(playlist: PlaybackPlaylist): Promise<void> {
    this.currentScheduleId = playlist.scheduleId || playlist.snapshotId
    this.currentPublishId = playlist.publishId
    this.currentPlaylistItemCount = playlist.items.length
    this.scheduler.stop()

    if (playlist.items.length === 0) {
      throw new Error('Playlist is empty')
    }

    this.state = playlist.mode === 'emergency' ? 'emergency' : 'playing'
    this.currentTimelineFingerprint = this.fingerprintPlaylist(playlist)
    this.scheduler.start(playlist.items)

    const telemetryService = getTelemetryService()
    if (this.currentScheduleId) {
      telemetryService.setCurrentSchedule(this.currentScheduleId)
    }
  }

  /**
   * Setup scheduler listeners
   */
  private setupSchedulerListeners(): void {
    this.scheduler.on('play-item', (scheduledItem: ScheduledItem) => {
      this.handlePlayItem(scheduledItem).catch((error) => {
        logger.error({ error, itemId: scheduledItem.item.id }, 'Failed to play item')
        this.handleError(error as Error)
      })
    })

    this.scheduler.on('item-complete', (scheduledItem: ScheduledItem) => {
      this.handleItemComplete(scheduledItem)
    })

    this.scheduler.on('transition-start', (current: ScheduledItem, next?: ScheduledItem) => {
      this.handleTransitionStart(current, next)
    })

    this.scheduler.on('timeline-complete', (completion?: { authorityEnded?: boolean }) => {
      logger.debug({ itemType: this.currentItem?.type }, 'Timeline completed')
      if ((this.currentItem?.type === 'scene' || completion?.authorityEnded === true) && this.mainWindow) {
        this.mainWindow.webContents.send('playback-update', {
          contentEpoch: getContentOwner().getEpoch(),
          type: 'clear-active',
          reason: completion?.authorityEnded === true ? 'timeline-authority-ended' : 'scene-window-complete',
        })
      }
    })
  }

  /**
   * Setup schedule manager listeners
   */
  private setupSnapshotManagerListeners(): void {
    const snapshotManager = getSnapshotManager()

    snapshotManager.on('playlist-updated', (playlist: PlaybackPlaylist) => {
      if (this.externallyOwned) return
      if (getSecurePlaybackGuard().isPlaybackLocked()) {
        logger.warn(
          { mode: playlist.mode },
          'Secure offline playback lock is active; ignoring timeline playlist update'
        )
        this.stop()
        return
      }

      if (!usesTimelinePlayback(playlist)) {
        logger.info({ mode: playlist.mode }, 'Playlist updated for fallback mode, stopping timeline playback')
        this.stop()
        return
      }

      const nextFingerprint = this.fingerprintPlaylist(playlist)
      if (this.state !== 'stopped' && this.currentTimelineFingerprint === nextFingerprint) {
        logger.debug({ mode: playlist.mode }, 'Ignoring equivalent timeline playlist update')
        return
      }

      logger.info({ mode: playlist.mode }, 'Playlist updated, restarting playback')
      this.stop()
      this.startPlaylist(playlist).catch((error) => {
        logger.error({ error }, 'Failed to start playback for updated playlist')
      })
    })
  }

  /**
   * Handle play item
   */
  private async handlePlayItem(scheduledItem: ScheduledItem): Promise<void> {
    const item = scheduledItem.item
    this.currentItem = item
    this.currentPlaybackInstanceId = undefined
    this.currentRenderToken =
      item.type !== 'scene' && scheduledItem.resumeDecision?.completed !== true ? randomUUID() : undefined

    logger.info(
      {
        itemId: item.id,
        pageNumber: item.type === 'pdf' ? item.pageNumber ?? 1 : undefined,
        type: item.type,
        displayMs: item.displayMs,
      },
      'Playing item'
    )

    // Mark as now-playing in cache
    const mediaId = item.mediaId || item.objectKey || item.id
    if (item.type !== 'scene' && mediaId) {
      const cacheManager = getCacheManager()
      const cacheKey = typeof item.meta?.['cache_key'] === 'string' ? String(item.meta['cache_key']) : mediaId
      cacheManager.markNowPlaying(cacheKey)
    }

    // Update telemetry
    const telemetryService = getTelemetryService()
    if (item.type === 'scene') {
      telemetryService.setActivePlayback(item.id, [])
    } else {
      telemetryService.setCurrentMedia(mediaId)
    }

    // Send to renderer
    if (this.mainWindow) {
      this.mainWindow.webContents.send('media-change', {
        contentEpoch: getContentOwner().getEpoch(),
        item,
        scheduledItem,
        scheduleId: this.currentScheduleId,
        renderToken: this.currentRenderToken,
        singleItemFrame: this.currentPlaylistItemCount === 1,
      })
    }

    this.emit('item-playing', item)
  }

  confirmRenderedPlayback(input: {
    itemId: string
    mediaId: string
    renderToken: string
    pageNumber?: number
  }): boolean {
    const current = this.currentItem
    const currentMediaId = current?.mediaId || current?.objectKey || current?.id
    if (!current || current.type === 'scene' || !this.currentScheduleId) {
      return false
    }
    if (
      input.itemId !== current.id ||
      input.mediaId !== currentMediaId ||
      input.renderToken !== this.currentRenderToken ||
      this.currentPlaybackInstanceId
    ) {
      return false
    }

    this.currentPlaybackInstanceId = randomUUID()
    getProofOfPlayService().recordStart({
      scheduleId: this.currentScheduleId,
      publishId: this.currentPublishId ?? null,
      mediaId: currentMediaId,
      playbackInstanceId: this.currentPlaybackInstanceId,
      itemId: current.id,
      pageNumber: current.type === 'pdf' ? current.pageNumber ?? 1 : undefined,
      startedAt: new Date().toISOString(),
    })
    return true
  }

  getCurrentPublishId(): string | null {
    return this.currentPublishId ?? null
  }

  recordRenderedLayoutPlayback(slot: ActiveSlotPlayback): boolean {
    if (
      !slot.schedule_id ||
      !slot.media_id ||
      this.currentItem?.type !== 'scene' ||
      this.currentItem.id !== slot.scene_id ||
      this.currentScheduleId !== slot.schedule_id
    ) {
      return false
    }
    getProofOfPlayService().recordStart({
      scheduleId: slot.schedule_id,
      publishId: this.getCurrentPublishId(),
      mediaId: slot.media_id,
      playbackInstanceId: slot.playback_instance_id,
      sceneId: slot.scene_id,
      slotId: slot.slot_id,
      itemId: slot.item_id,
      pageNumber: slot.page_number,
      startedAt: new Date().toISOString(),
    })
    return true
  }

  /**
   * Handle item complete
   */
  private handleItemComplete(scheduledItem: ScheduledItem): void {
    const item = scheduledItem.item

    logger.debug({ itemId: item.id }, 'Item completed')
    // Invalidate the renderer occurrence before ending PoP. A delayed or
    // duplicated IPC confirmation must not reopen a completed occurrence.
    this.currentRenderToken = undefined

    // Unmark as now-playing in cache
    const mediaId = item.mediaId || item.objectKey || item.id
    if (item.type !== 'scene' && mediaId) {
      const cacheManager = getCacheManager()
      const cacheKey = typeof item.meta?.['cache_key'] === 'string' ? String(item.meta['cache_key']) : mediaId
      cacheManager.unmarkNowPlaying(cacheKey)
    }

    // Record proof-of-play end
    if (this.currentPlaybackInstanceId && item.type !== 'scene') {
      const popService = getProofOfPlayService()
      popService.recordEnd(this.currentPlaybackInstanceId, true)
      this.currentPlaybackInstanceId = undefined
    }

    this.emit('item-completed', item)
  }

  /**
   * Handle transition start
   */
  private handleTransitionStart(current: ScheduledItem, next?: ScheduledItem): void {
    logger.debug(
      {
        currentId: current.item.id,
        nextId: next?.item.id,
      },
      'Transition starting'
    )

    if (this.mainWindow && next) {
      this.mainWindow.webContents.send('playback-update', {
        contentEpoch: getContentOwner().getEpoch(),
        type: 'transition-start',
        current: current.item,
        next: next.item,
        scheduleId: this.currentScheduleId,
        durationMs: current.item.transitionDurationMs || 0,
      })
    }

    this.emit('transition-start', current.item, next?.item)
  }

  /**
   * Handle playback error
   */
  private handleError(error: Error): void {
    this.errorCount++

    logger.error({ error, errorCount: this.errorCount }, 'Playback error')

    const telemetryService = getTelemetryService()
    telemetryService.reportError(error.message)

    if (this.errorCount >= this.maxErrors) {
      logger.error('Max errors reached, stopping playback')
      this.stop()
      this.state = 'error'
      this.emit('playback-error', new PlaybackError('Max errors reached', { error: error.message }))
    } else {
      // Show fallback slide
      if (this.mainWindow) {
        this.mainWindow.webContents.send('playback-update', {
          contentEpoch: getContentOwner().getEpoch(),
          type: 'show-fallback',
          message: error.message,
        })
      }
    }
  }

  /**
   * Get current state
   */
  getState(): PlaybackState {
    return this.state
  }

  /**
   * Get current item
   */
  getCurrentItem(): TimelineItem | undefined {
    return this.currentItem
  }

  /**
   * Re-send the already active item after Electron recreates the renderer.
   * The scheduler deliberately keeps running across a renderer crash, so the
   * fresh DOM must be given the current item instead of waiting for its next
   * boundary (which could otherwise leave a signage screen blank).
   */
  restoreCurrentItemInRenderer(): boolean {
    if (!this.mainWindow || !this.currentItem) {
      return false
    }

    this.mainWindow.webContents.send('media-change', {
      contentEpoch: getContentOwner().getEpoch(),
      item: this.currentItem,
      scheduleId: this.currentScheduleId,
      renderToken: this.currentRenderToken,
      restored: true,
      singleItemFrame: this.currentPlaylistItemCount === 1,
    })
    return true
  }

  /**
   * Get jitter statistics
   */
  getJitterStats() {
    return this.scheduler.getJitterStats()
  }

  private fingerprintPlaylist(playlist: PlaybackPlaylist): string {
    return JSON.stringify({
      mode: playlist.mode,
      scheduleId: playlist.scheduleId ?? null,
      items: playlist.items.map((item) => this.fingerprintTimelineItem(item)),
    })
  }

  private fingerprintTimelineItem(item: TimelineItem): unknown {
    const liveUrl = item.remoteUrl ?? item.url

    return {
      id: item.id,
      type: item.type,
      mediaId: item.mediaId ?? null,
      objectKey: item.objectKey ?? null,
      displayMs: item.type === 'scene' ? null : item.displayMs,
      fit: item.fit,
      muted: item.muted,
      loop: item.loop,
      pageNumber: item.type === 'pdf' ? item.pageNumber ?? 1 : null,
      sha256: item.sha256 ?? null,
      transitionDurationMs: item.transitionDurationMs,
      remoteUrl:
        item.type === 'url' ? this.normalizeComparableUrl(liveUrl, true) : this.normalizeComparableUrl(liveUrl, false),
      meta: this.normalizeComparableMeta(item.meta),
    }
  }

  private normalizeComparableMeta(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.normalizeComparableMeta(entry))
    }

    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && key) {
        if (key === 'source_url') {
          return this.normalizeComparableUrl(value, true)
        }

        if (
          key === 'media_url' ||
          key === 'fallback_url' ||
          key === 'fallback_media_url' ||
          key === 'remoteUrl' ||
          key === 'localUrl' ||
          key === 'fallback_local_url' ||
          key === 'url'
        ) {
          return this.normalizeComparableUrl(value, false)
        }
      }

      return value
    }

    const record = value as Record<string, unknown>

    if (record['type'] === 'url') {
      return {
        ...Object.keys(record)
          .sort()
          .reduce<Record<string, unknown>>((acc, currentKey) => {
            const currentValue = record[currentKey]
            if (currentKey === 'remoteUrl' || currentKey === 'url' || currentKey === 'source_url') {
              acc[currentKey] =
                typeof currentValue === 'string'
                  ? this.normalizeComparableUrl(currentValue, true)
                  : this.normalizeComparableMeta(currentValue, currentKey)
              return acc
            }

            acc[currentKey] = this.normalizeComparableMeta(currentValue, currentKey)
            return acc
          }, {}),
      }
    }

    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, currentKey) => {
        if (currentKey === 'serverTimeOffsetMs') {
          return acc
        }
        acc[currentKey] = this.normalizeComparableMeta(record[currentKey], currentKey)
        return acc
      }, {})
  }

  private normalizeComparableUrl(value?: string, preserveQuery: boolean = false): string | null {
    if (!value) {
      return null
    }

    try {
      const parsed = new URL(value)
      parsed.hash = ''
      if (!preserveQuery) {
        parsed.search = ''
      }
      return parsed.toString()
    } catch {
      return value
    }
  }
}

// Singleton instance
let playbackEngine: PlaybackEngine | null = null

export function getPlaybackEngine(): PlaybackEngine {
  if (!playbackEngine) {
    playbackEngine = new PlaybackEngine()
  }
  return playbackEngine
}
