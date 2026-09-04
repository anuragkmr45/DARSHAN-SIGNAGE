/**
 * Player - Main playback UI controller
 * Handles media rendering and transitions in the renderer process
 */

import {
  ActiveSlotPlayback,
  DefaultMediaResponse,
  FitMode,
  LayoutScene,
  LayoutSceneSlot,
  PlayerPresentationSnapshot,
  PlayerStatus,
  TimelineItem,
} from '../common/types'
import './types'
import { DefaultMediaPlayer } from './default-media-player'
import { checkMediaCompatibility, CompatResult } from '../common/media-compat'
import { createPdfPlaybackElement } from './pdf-playback'
import { createWebpagePlaybackElement } from './webpage-playback'
import {
  clampVideoSeekSeconds,
  resolveScheduledResumePosition,
  shouldRepeatScheduledItem,
} from '../common/playback-policy'
import { resolvePlayerContentSource, shouldDisplaySecurityLock } from '../common/player-content-source'
import {
  computeSceneStageFrame,
  prepareElementForFadeIn,
  prepareElementForFadeOut,
  shouldUseManualVideoReplay,
  teardownScheduledElementTree,
  type DisposableMediaNode,
} from './player-layout-helpers'
import type { PlaybackProgressEntry, PlaybackProgressIdentity, PlaybackResumeDecision } from '../common/playback-policy'

const { sanitizeLogPayloadForDiagnostics } = require('../common/redaction') as typeof import('../common/redaction')

export { resolvePlayerContentSource } from '../common/player-content-source'
export {
  computeSceneStageFrame,
  prepareElementForFadeIn,
  prepareElementForFadeOut,
  resolveOpacityTransitionStyle,
  shouldUseManualVideoReplay,
  teardownScheduledElementTree,
} from './player-layout-helpers'

type RenderedScene = {
  element: HTMLElement
  cleanup: () => void
}

type PendingTransition = {
  currentId: string
  nextId: string
  durationMs: number
}

type PlaybackResumeInstruction = Pick<PlaybackResumeDecision, 'seekMs' | 'autoplay' | 'completed' | 'source'>

type PlaybackProgressContext = PlaybackProgressIdentity & {
  scheduleStartsAt?: string | null
  scheduleEndsAt?: string | null
  itemDisplayMs?: number
}

class Player {
  private static readonly FALLBACK_STATUS_GUARD_MS = 2000
  private canvas: HTMLCanvasElement | null = null
  private currentElement?: HTMLElement
  private mediaContainer: HTMLElement | null = null
  private defaultMediaContainer: HTMLElement | null = null
  private defaultMediaPlayer?: DefaultMediaPlayer
  private latestStatus?: PlayerStatus
  private latestPresentationRevision = -1
  private statusOverlay: HTMLElement | null = null
  private statusConnection: HTMLElement | null = null
  private statusSnapshot: HTMLElement | null = null
  private modeBanner: HTMLElement | null = null
  private securityLockOverlay: HTMLElement | null = null
  private currentCleanup?: () => void
  private playbackSession = 0
  private ignoreFallbackStatusUntil = 0
  private pendingTransition?: PendingTransition
  private activeSceneId?: string
  private activeSlotPlaybacks = new Map<string, ActiveSlotPlayback>()

  constructor() {
    this.initializeElements()
    this.setupDefaultMedia()
    this.setupIPC()
    this.log('info', 'Player initialized')
  }

  /**
   * Initialize DOM elements
   */
  private initializeElements(): void {
    this.canvas = document.getElementById('media-canvas') as HTMLCanvasElement
    this.mediaContainer = document.getElementById('playback-container')
    this.defaultMediaContainer = document.getElementById('default-media-container')
    this.statusOverlay = document.getElementById('status-overlay')
    this.statusConnection = document.getElementById('status-connection')
    this.statusSnapshot = document.getElementById('status-snapshot-time')
    this.modeBanner = document.getElementById('mode-banner')
    this.securityLockOverlay = document.getElementById('security-lock-overlay')

    // The DOM is parsed before the first player-status IPC message arrives.
    // Keep the playback root inert during that interval so it cannot cover the
    // pairing/recovery surface after a renderer reload.
    this.mediaContainer?.classList.add('hidden')
    this.defaultMediaContainer?.classList.add('hidden')

    if (this.canvas) {
      this.resizeCanvas()
      this.canvas.style.display = 'none'

      // Handle window resize
      window.addEventListener('resize', () => this.resizeCanvas())
    }
  }

  private setupDefaultMedia(): void {
    if (!this.defaultMediaContainer) {
      return
    }

    this.defaultMediaPlayer = new DefaultMediaPlayer(this.defaultMediaContainer, {
      onRefreshRequested: (reason) => {
        this.refreshDefaultMedia(reason).catch((error) => {
          this.log('warn', 'Default media refresh failed', { reason, error: error.message })
        })
      },
      onLog: (level, message, data) => {
        this.log(level, message, data)
      },
      debugOverlay: false,
    })

    this.loadDefaultMediaConfig().catch((error) => {
      this.log('warn', 'Failed to load default media config', { error: error.message })
    })

    this.refreshDefaultMedia('initial').catch((error) => {
      this.log('warn', 'Initial default media fetch failed', { error: error.message })
    })

    if (window.darshan && window.darshan.onDefaultMediaChanged) {
      window.darshan.onDefaultMediaChanged((data: any) => {
        this.defaultMediaPlayer?.setMedia(data as DefaultMediaResponse)
      })
    }
  }

  /**
   * Resize canvas to window size
   */
  private resizeCanvas(): void {
    if (!this.canvas) return

    this.canvas.width = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  /**
   * Setup IPC listeners
   */
  private setupIPC(): void {
    // Listen for media playback events
    if (window.darshan && window.darshan.onMediaChange) {
      window.darshan.onMediaChange((data: any) => {
        this.log('debug', 'Received play-media event', data)
        if (!this.canRenderScheduledContent()) {
          this.log('debug', 'Ignoring playback event while lifecycle blocks content', {
            state: this.latestStatus?.state,
          })
          return
        }
        this.ignoreFallbackStatusUntil = Date.now() + Player.FALLBACK_STATUS_GUARD_MS
        this.setActiveSource('schedule')
        this.playMedia(data.item, {
          scheduleId: typeof data.scheduleId === 'string' ? data.scheduleId : undefined,
        }).catch((error) => {
          this.log('error', 'Failed to play media', { error: error.message })
          this.showFallback(error.message)
        })
      })
    }

    // Listen for transition events
    if (window.darshan && window.darshan.onPlaybackUpdate) {
      window.darshan.onPlaybackUpdate((data: any) => {
        if (data.type === 'transition-start') {
          if (!this.canRenderScheduledContent()) {
            return
          }
          this.log('debug', 'Received transition-start event', data)
          this.startTransition(data.current, data.next, data.durationMs)
        } else if (data.type === 'clear-active') {
          this.log('debug', 'Received clear-active event', data)
          this.ignoreFallbackStatusUntil = 0
          this.clearScheduledPlayback(data.reason || 'clear-active')
        } else if (data.type === 'show-fallback') {
          if (!this.canRenderScheduledContent()) {
            return
          }
          this.log('warn', 'Received show-fallback event', data)
          this.showFallback(data.message)
        }
      })
    }

    // Arm the event stream before fetching the snapshot. A lifecycle change
    // between those two operations is safe because stale snapshots are ignored
    // by their monotonic revision.
    if (window.darshan && window.darshan.onPlayerPresentation) {
      window.darshan.onPlayerPresentation((presentation) => this.applyPresentation(presentation))
    }

    if (window.darshan && window.darshan.getPlayerPresentation) {
      window.darshan
        .getPlayerPresentation()
        .then((presentation) => this.applyPresentation(presentation))
        .catch(() => {
          // ignore initial status failures
        })
    }
  }

  private applyPresentation(presentation: PlayerPresentationSnapshot): void {
    if (!presentation || !presentation.status || presentation.revision < this.latestPresentationRevision) {
      return
    }

    this.latestPresentationRevision = presentation.revision
    this.latestStatus = presentation.status
    this.updateStatusOverlay(presentation.status)
    this.updateContentSource(presentation.status)
  }

  private async refreshDefaultMedia(reason: string): Promise<void> {
    if (!window.darshan || !window.darshan.getDefaultMedia) {
      return
    }

    const data = await window.darshan.getDefaultMedia({ refresh: true })
    this.defaultMediaPlayer?.setMedia(data as DefaultMediaResponse)
    this.log('debug', 'Default media refreshed', { reason })
  }

  private async loadDefaultMediaConfig(): Promise<void> {
    if (!window.darshan || !window.darshan.getConfig) {
      return
    }

    const config = await window.darshan.getConfig()
    const logLevel = (config as any)?.log?.level
    const debugEnabled = logLevel === 'debug' || logLevel === 'trace'

    this.defaultMediaPlayer?.setDebugOverlayEnabled(debugEnabled)
  }

  private updateContentSource(status: PlayerStatus): void {
    if (shouldDisplaySecurityLock(status)) {
      this.clearScheduledPlayback('security-lock')
      this.setActiveSource('none')
      return
    }

    const nextSource = resolvePlayerContentSource(status)
    if (nextSource === 'none') {
      // Pairing/recovery is authoritative and must never wait behind the
      // schedule fallback guard. This is the expiry/OTP regression boundary.
      this.clearScheduledPlayback(`lifecycle-${status.state.toLowerCase()}`)
      this.setActiveSource('none')
      return
    }

    if (nextSource === 'schedule') {
      this.setActiveSource('schedule')
      return
    }

    if (Date.now() < this.ignoreFallbackStatusUntil) {
      this.log('debug', 'Ignoring stale fallback status during schedule activation', {
        mode: status.mode,
        state: status.state,
      })
      return
    }

    this.clearScheduledPlayback('default-media')
    this.setActiveSource('default')
  }

  private canRenderScheduledContent(): boolean {
    return this.latestStatus ? resolvePlayerContentSource(this.latestStatus) === 'schedule' : false
  }

  private setActiveSource(source: 'schedule' | 'default' | 'none'): void {
    this.mediaContainer?.classList.toggle('hidden', source !== 'schedule')
    this.defaultMediaContainer?.classList.toggle('hidden', source !== 'default')

    if (source === 'default') {
      this.defaultMediaPlayer?.show()
    } else {
      this.defaultMediaPlayer?.hide()
    }
  }

  /**
   * Play media item
   */
  private async playMedia(item: TimelineItem, options: { scheduleId?: string } = {}): Promise<void> {
    const sessionId = ++this.playbackSession
    this.log('info', 'Playing media', { itemId: item.id, type: item.type })
    const transitionDurationMs =
      this.pendingTransition?.nextId === item.id ? this.pendingTransition.durationMs : undefined
    this.pendingTransition = undefined

    try {
      if (item.type === 'scene') {
        const scene = this.getSceneDefinition(item)
        if (!scene) {
          throw new Error('Scene definition missing from scheduled layout item')
        }

        this.activeSceneId = item.id
        this.activeSlotPlaybacks.clear()
        this.reportActivePlayback()
        const renderedScene = this.renderScene(item, scene)
        const element = renderedScene.element
        if (sessionId !== this.playbackSession) {
          this.disposeScheduledElement(element)
          return
        }
        this.showElement(element, renderedScene.cleanup, transitionDurationMs)
        this.currentElement = element
        return
      }

      this.activeSceneId = undefined
      this.activeSlotPlaybacks.clear()
      this.reportActivePlayback()

      const compat = this.getItemCompatibility(item)

      if (compat.status === 'PLAYABLE_NOW') {
        this.log('debug', 'Media compatibility check', { itemId: item.id, compat })
      } else if (compat.status === 'ACCEPTED_BUT_NOT_SUPPORTED_YET') {
        this.log('warn', 'Media not supported yet', { itemId: item.id, compat })
        this.showCompatibilityPlaceholder(compat, item)
        return
      } else {
        this.log('error', 'Media rejected by compatibility check', { itemId: item.id, compat })
        this.showFallback(`Unsupported media: ${compat.reason}`)
        return
      }

      let element: HTMLElement
      const resumeDecision = await this.resolveSingleItemResumeDecision(item, options.scheduleId)
      const progressContext = this.buildPlaybackProgressContext(item, {
        scheduleId: options.scheduleId,
      })

      switch (item.type) {
        case 'image':
          element = await this.renderImage(item)
          break
        case 'video':
          element = await this.renderVideo(item, resumeDecision)
          this.attachVideoProgressReporter(element as HTMLVideoElement, item, progressContext)
          break
        case 'pdf':
          element = await this.renderPDF(item)
          break
        case 'office':
          element = this.renderDocumentPlaceholder(item, compat)
          break
        case 'url':
          element = await this.renderURL(item)
          break
        default:
          throw new Error(`Unsupported media type: ${item.type}`)
      }

      // Apply fit mode
      this.applyFitMode(element, item.fit)

      if (sessionId !== this.playbackSession) {
        this.disposeScheduledElement(element)
        return
      }

      // Show element
      this.showElement(element, undefined, transitionDurationMs)

      this.currentElement = element
    } catch (error) {
      this.log('error', 'Failed to play media', { error: (error as Error).message })
      throw error
    }
  }

  /**
   * Render image
   */
  private async renderImage(item: TimelineItem): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      const img = document.createElement('img')
      img.style.position = 'absolute'
      img.style.top = '0'
      img.style.left = '0'
      img.style.width = '100%'
      img.style.height = '100%'

      img.onload = () => {
        this.log('debug', 'Image loaded', { itemId: item.id })
        resolve(img)
      }

      img.onerror = () => {
        reject(new Error(`Failed to load image: ${item.mediaId || item.objectKey || item.url}`))
      }

      // Set source (from cache or URL)
      img.src = this.getMediaSource(item)
    })
  }

  /**
   * Render video
   */
  private async renderVideo(item: TimelineItem, resume?: PlaybackResumeInstruction): Promise<HTMLElement> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video')
      const source = this.getMediaSource(item)
      const useManualReplay = shouldUseManualVideoReplay(item)
      let resolved = false
      let started = false
      video.style.position = 'absolute'
      video.style.top = '0'
      video.style.left = '0'
      video.style.width = '100%'
      video.style.height = '100%'
      video.muted = item.muted
      video.loop = !useManualReplay && item.loop

      this.log('debug', 'Preparing video playback', {
        itemId: item.id,
        displayMs: item.displayMs,
        loop: item.loop,
        resumeSource: resume?.source,
        resumeSeekMs: resume?.seekMs,
        resumeCompleted: resume?.completed,
        source,
        slotId: typeof item.meta?.['slotId'] === 'string' ? item.meta?.['slotId'] : null,
      })

      const finalize = () => {
        if (resolved) {
          return
        }
        resolved = true
        this.log('debug', 'Video loaded', {
          itemId: item.id,
          resumeSource: resume?.source,
          resumeSeekMs: resume?.seekMs,
          completed: resume?.completed,
        })

        if (resume?.autoplay === false) {
          video.pause()
          resolve(video)
          return
        }

        started = true
        video.play().catch((error) => {
          this.log('error', 'Failed to play video', { error: error.message })
        })
        resolve(video)
      }

      video.onloadedmetadata = () => {
        const seekSeconds = clampVideoSeekSeconds(resume?.seekMs ?? 0, video.duration, item.displayMs)
        if (seekSeconds > 0.1) {
          try {
            video.currentTime = seekSeconds
          } catch (error) {
            this.log('warn', 'Failed to seek scheduled video before playback', {
              itemId: item.id,
              error: (error as Error).message,
            })
            finalize()
            return
          }

          let seekTimer: number | undefined
          const onSeeked = () => {
            if (seekTimer !== undefined) {
              window.clearTimeout(seekTimer)
            }
            video.removeEventListener('seeked', onSeeked)
            finalize()
          }
          seekTimer = window.setTimeout(() => {
            video.removeEventListener('seeked', onSeeked)
            finalize()
          }, 2000)
          video.addEventListener('seeked', onSeeked)
          return
        }

        finalize()
      }

      video.onloadeddata = () => {
        if (!resolved && !video.seeking) {
          finalize()
        }
      }

      video.onerror = () => {
        reject(new Error(`Failed to load video: ${item.mediaId || item.objectKey || item.url}`))
      }

      if (useManualReplay) {
        video.onended = () => {
          this.log('debug', 'Manually replaying loop-enabled video', {
            itemId: item.id,
            displayMs: item.displayMs,
            source,
          })
          if (!started) {
            return
          }
          video.currentTime = 0
          video.play().catch((error) => {
            this.log('error', 'Failed to replay loop-enabled video', { error: error.message, itemId: item.id })
          })
        }
      }

      video.src = source
    })
  }

  private async resolveSingleItemResumeDecision(
    item: TimelineItem,
    scheduleId?: string
  ): Promise<PlaybackResumeInstruction> {
    const context = this.buildPlaybackProgressContext(item, { scheduleId })
    const startsAt = this.getStringMeta(item, 'scheduleWindowStartsAt') || this.getStringMeta(item, 'scheduleStartsAt')
    const persisted = startsAt ? null : await this.getPersistedPlaybackProgress(context)

    return resolveScheduledResumePosition({
      items: [item],
      startsAt,
      serverTimeOffsetMs: this.getNumberMeta(item, 'serverTimeOffsetMs') || 0,
      expected: context,
      persisted,
    })
  }

  private buildPlaybackProgressContext(
    item: TimelineItem,
    overrides: Partial<PlaybackProgressContext> = {}
  ): PlaybackProgressContext {
    return {
      scheduleId:
        overrides.scheduleId ??
        this.getStringMeta(item, 'scheduleId') ??
        this.getStringMeta(item, 'presentationId') ??
        null,
      snapshotId: overrides.snapshotId ?? this.getStringMeta(item, 'snapshotId') ?? null,
      sceneId: overrides.sceneId ?? this.getStringMeta(item, 'sceneId') ?? null,
      slotId: overrides.slotId ?? this.getStringMeta(item, 'slotId') ?? null,
      itemId: overrides.itemId ?? item.id,
      mediaId: overrides.mediaId ?? item.mediaId ?? item.objectKey ?? null,
      scheduleStartsAt:
        overrides.scheduleStartsAt ??
        this.getStringMeta(item, 'scheduleWindowStartsAt') ??
        this.getStringMeta(item, 'scheduleStartsAt') ??
        null,
      scheduleEndsAt:
        overrides.scheduleEndsAt ??
        this.getStringMeta(item, 'scheduleWindowEndsAt') ??
        this.getStringMeta(item, 'scheduleEndsAt') ??
        null,
      itemDisplayMs: overrides.itemDisplayMs ?? item.displayMs,
    }
  }

  private async getPersistedPlaybackProgress(
    expected: PlaybackProgressIdentity
  ): Promise<PlaybackProgressEntry | null> {
    if (!window.darshan?.getPlaybackResumeState) {
      return null
    }

    try {
      return await window.darshan.getPlaybackResumeState(expected)
    } catch (error) {
      this.log('debug', 'Playback resume state unavailable', { error: (error as Error).message })
      return null
    }
  }

  private attachVideoProgressReporter(
    element: HTMLElement,
    item: TimelineItem,
    context: PlaybackProgressContext
  ): void {
    if (!(element instanceof HTMLVideoElement) || !window.darshan?.reportPlaybackProgress) {
      return
    }

    const video = element
    const sendProgress = (completed: boolean = false) => {
      window.darshan.reportPlaybackProgress({
        scheduleId: context.scheduleId ?? null,
        snapshotId: context.snapshotId ?? null,
        sceneId: context.sceneId ?? null,
        slotId: context.slotId ?? null,
        itemId: context.itemId ?? item.id,
        mediaId: context.mediaId ?? item.mediaId ?? item.objectKey ?? null,
        scheduleStartsAt: context.scheduleStartsAt ?? null,
        scheduleEndsAt: context.scheduleEndsAt ?? null,
        itemDisplayMs: context.itemDisplayMs ?? item.displayMs,
        positionMs: Math.max(0, Math.round((Number(video.currentTime) || 0) * 1000)),
        completed,
        updatedAt: new Date().toISOString(),
      })
    }

    const interval = window.setInterval(() => sendProgress(false), 5000)
    const onPause = () => sendProgress(false)
    const onEnded = () => sendProgress(true)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)

    const previousCleanup = (video as DisposableMediaNode).__darshanCleanup
    ;(video as DisposableMediaNode).__darshanCleanup = () => {
      window.clearInterval(interval)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      sendProgress(video.ended)
      previousCleanup?.()
    }
  }

  private getStringMeta(item: TimelineItem, key: string): string | undefined {
    const value = item.meta?.[key]
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }

  private getNumberMeta(item: TimelineItem, key: string): number | undefined {
    const value = item.meta?.[key]
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
  }

  /**
   * Render PDF
   */
  private async renderPDF(item: TimelineItem): Promise<HTMLElement> {
    return createPdfPlaybackElement(this.getMediaSource(item))
  }

  /**
   * Render URL
   */
  private async renderURL(item: TimelineItem): Promise<HTMLElement> {
    const sourceUrl = this.getMediaSource(item)
    const fallbackUrl =
      item.localUrl ||
      (typeof item.meta?.['fallback_local_url'] === 'string' ? String(item.meta?.['fallback_local_url']) : undefined) ||
      (typeof item.meta?.['fallback_url'] === 'string' ? String(item.meta?.['fallback_url']) : undefined)

    return createWebpagePlaybackElement({
      liveUrl: sourceUrl,
      fallbackUrl,
      fallbackFit: item.fit === 'stretch' ? 'fill' : item.fit,
      onFallback: (reason) => {
        this.log('warn', 'Scheduled webpage fallback active', {
          itemId: item.id,
          reason,
          sourceUrl,
        })
      },
      onLog: (level, message, data) => {
        this.log(level, message, {
          itemId: item.id,
          ...data,
        })
      },
    })
  }

  private renderScene(sceneItem: TimelineItem, scene: LayoutScene): RenderedScene {
    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.top = '0'
    container.style.left = '0'
    container.style.width = '100%'
    container.style.height = '100%'
    container.style.backgroundColor = '#000'
    container.dataset['sceneId'] = sceneItem.id

    const stage = document.createElement('div')
    stage.style.position = 'absolute'
    stage.style.overflow = 'hidden'
    stage.style.backgroundColor = '#000'

    const frame = computeSceneStageFrame(scene.aspectRatio, window.innerWidth, window.innerHeight)
    stage.style.left = `${frame.left}px`
    stage.style.top = `${frame.top}px`
    stage.style.width = `${frame.width}px`
    stage.style.height = `${frame.height}px`
    stage.dataset['sceneAspectRatio'] = scene.aspectRatio || 'free'
    container.appendChild(stage)

    const cleanupCallbacks: Array<() => void> = []

    scene.slots.forEach((slot) => {
      const slotContainer = document.createElement('div')
      slotContainer.style.position = 'absolute'
      slotContainer.style.overflow = 'hidden'
      slotContainer.style.backgroundColor = '#000'
      this.applySlotBounds(slotContainer, slot)

      stage.appendChild(slotContainer)
      cleanupCallbacks.push(
        this.mountSceneSlot(
          slotContainer,
          slot,
          sceneItem.id,
          scene.startsAt,
          scene.endsAt,
          typeof sceneItem.meta?.['scheduleId'] === 'string' ? String(sceneItem.meta?.['scheduleId']) : undefined,
          scene.serverTimeOffsetMs || 0
        )
      )
    })

    const cleanup = () => {
      cleanupCallbacks.forEach((cleanup) => cleanup())
      cleanupCallbacks.length = 0
    }

    return {
      element: container,
      cleanup,
    }
  }

  /**
   * Get media source (from cache or URL)
   */
  private getMediaSource(item: TimelineItem): string {
    if (item.type === 'url') {
      if (item.url) return item.url
      if (item.remoteUrl) return item.remoteUrl
    }

    const sourceContentType =
      typeof item.meta?.['source_content_type'] === 'string' ? String(item.meta?.['source_content_type']) : undefined
    const contentType =
      typeof item.meta?.['content_type'] === 'string' ? String(item.meta?.['content_type']) : undefined
    const localSourceLooksLikePdf = Boolean(
      (item.localUrl && /\.pdf(\?|#|$)/i.test(item.localUrl)) ||
      (item.localPath && /\.pdf(\?|#|$)/i.test(item.localPath))
    )
    if (
      item.type === 'pdf' &&
      (contentType === 'application/pdf' || sourceContentType === 'application/pdf') &&
      item.remoteUrl &&
      !localSourceLooksLikePdf
    ) {
      return item.remoteUrl
    }

    if (item.localUrl) {
      return item.localUrl
    }

    if (item.remoteUrl) {
      return item.remoteUrl
    }

    if (item.localPath) {
      return item.localPath
    }

    throw new Error('Media is not cached')
  }

  /**
   * Apply fit mode to element
   */
  private applyFitMode(element: HTMLElement, fit: FitMode): void {
    switch (fit) {
      case 'contain':
        element.style.objectFit = 'contain'
        break
      case 'cover':
        element.style.objectFit = 'cover'
        break
      case 'stretch':
        element.style.objectFit = 'fill'
        break
    }
  }

  /**
   * Show element with fade in
   */
  private showElement(element: HTMLElement, nextCleanup?: () => void, fadeMs: number = 500): void {
    if (!this.mediaContainer) return

    const safeFadeMs = Math.max(0, fadeMs)

    this.runCurrentCleanup()

    // Hide current element
    if (this.currentElement) {
      const previous = this.currentElement
      prepareElementForFadeOut(previous, safeFadeMs)
      setTimeout(() => {
        if (this.mediaContainer && previous.parentElement === this.mediaContainer) {
          this.disposeScheduledElement(previous)
        }
      }, safeFadeMs)
    }

    // Add and show new element
    element.style.zIndex = '1'
    const deferFadeIn = prepareElementForFadeIn(element, safeFadeMs)
    this.mediaContainer.appendChild(element)
    if (deferFadeIn) {
      this.deferStyleCommit(() => {
        element.style.opacity = '1'
      })
    } else {
      element.style.opacity = '1'
    }
    this.currentCleanup = nextCleanup
  }

  /**
   * Start transition between items
   */
  private startTransition(current: TimelineItem, next: TimelineItem, durationMs: number): void {
    this.log('debug', 'Starting transition', { currentId: current.id, nextId: next.id, durationMs })
    this.pendingTransition = {
      currentId: current.id,
      nextId: next.id,
      durationMs: Math.max(0, durationMs),
    }
  }

  /**
   * Show fallback slide
   */
  private showFallback(message: string): void {
    if (!this.canRenderScheduledContent()) return
    if (!this.mediaContainer) return

    const fallback = document.createElement('div')
    fallback.className = 'fallback-slide'

    const icon = document.createElement('div')
    icon.className = 'fallback-icon'
    icon.textContent = '⚠️'

    const msg = document.createElement('div')
    msg.className = 'fallback-message'
    msg.textContent = message || 'An error occurred during playback'

    fallback.appendChild(icon)
    fallback.appendChild(msg)

    this.showElement(fallback)
  }

  private showCompatibilityPlaceholder(result: CompatResult, item: TimelineItem): void {
    if (!this.mediaContainer) return

    const container = this.createMediaPreviewCard(
      item,
      result.kind === 'DOCUMENT' ? 'Document preview' : 'Media playback not supported yet',
      result.reason
    )

    this.showElement(container)
    this.currentElement = container
  }

  private updateStatusOverlay(status: PlayerStatus): void {
    const displaySecurityLock = shouldDisplaySecurityLock(status)
    const displayRuntimeStatus =
      status.state === 'PAIRED_RUNTIME' ||
      status.state === 'OFFLINE_USING_LAST_VALID_PAIRING' ||
      status.state === 'SOFT_RECOVERY'
    if (displaySecurityLock) {
      this.showSecurityLock(status)
    } else {
      this.hideSecurityLock()
    }

    if (this.statusOverlay) {
      this.statusOverlay.classList.toggle('hidden', !displayRuntimeStatus)
    }

    if (!displayRuntimeStatus) {
      this.modeBanner?.classList.add('hidden')
      return
    }

    if (this.statusConnection) {
      this.statusConnection.textContent = status.online ? 'ONLINE' : 'OFFLINE'
      this.statusConnection.className = status.online ? 'status-pill online' : 'status-pill offline'
    }

    if (this.statusSnapshot) {
      this.statusSnapshot.textContent = status.lastSnapshotAt ? new Date(status.lastSnapshotAt).toLocaleString() : '-'
    }

    if (this.modeBanner) {
      this.modeBanner.classList.remove('hidden', 'emergency', 'default', 'offline')

      if (displaySecurityLock) {
        this.modeBanner.textContent = 'SECURITY LOCK'
        this.modeBanner.classList.add('offline')
      } else if (status.mode === 'emergency') {
        this.modeBanner.textContent = 'EMERGENCY'
        this.modeBanner.classList.add('emergency')
      } else if (status.mode === 'default') {
        this.modeBanner.textContent = 'DEFAULT MEDIA'
        this.modeBanner.classList.add('default')
      } else if (status.mode === 'empty') {
        this.modeBanner.textContent = 'NO CONTENT ASSIGNED'
        this.modeBanner.classList.add('default')
      } else if (status.mode === 'offline') {
        this.modeBanner.textContent = 'OFFLINE MODE'
        this.modeBanner.classList.add('offline')
      } else {
        this.modeBanner.textContent = ''
        this.modeBanner.classList.add('hidden')
      }
    }
  }

  private showSecurityLock(status: PlayerStatus): void {
    if (!this.securityLockOverlay) {
      return
    }

    const reason = status.securityLock?.reason || 'Backend validation is required before playback can continue.'
    const lastSuccess = status.securityLock?.lastBackendSuccessAt
      ? new Date(status.securityLock.lastBackendSuccessAt).toLocaleString()
      : 'not available'

    this.securityLockOverlay.classList.remove('hidden')
    this.securityLockOverlay.innerHTML = `
      <div class="security-lock-card">
        <div class="security-lock-eyebrow">Playback locked</div>
        <h1>DARSHAN requires backend validation</h1>
        <p>${this.escapeHtml(reason)}</p>
        <div class="security-lock-meta">
          <span>Last backend validation</span>
          <strong>${this.escapeHtml(lastSuccess)}</strong>
        </div>
        <div class="security-lock-guidance">
          Connect this player to the approved DARSHAN network. Playback will resume only after backend validation succeeds.
        </div>
      </div>
    `
  }

  private hideSecurityLock(): void {
    this.securityLockOverlay?.classList.add('hidden')
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        case "'":
          return '&#39;'
        default:
          return char
      }
    })
  }

  /**
   * Log message to main process
   */
  private log(level: string, message: string, data?: any): void {
    const safeData = sanitizeLogPayloadForDiagnostics(data)
    if (window.darshan && window.darshan.log) {
      window.darshan.log(level, message, safeData)
    } else {
      console.log(`[${level}] ${message}`, safeData)
    }
  }

  private getSceneDefinition(item: TimelineItem): LayoutScene | null {
    const scene = item.meta?.['scene']
    if (!scene || typeof scene !== 'object') {
      return null
    }

    return scene as LayoutScene
  }

  private applySlotBounds(element: HTMLElement, slot: LayoutSceneSlot): void {
    const width = this.normalizeDimension(slot.bounds.w)
    const height = this.normalizeDimension(slot.bounds.h)
    const left = this.normalizeDimension(slot.bounds.x)
    const top = this.normalizeDimension(slot.bounds.y)

    element.style.left = left
    element.style.top = top
    element.style.width = width
    element.style.height = height

    if (typeof slot.bounds.zIndex === 'number') {
      element.style.zIndex = String(slot.bounds.zIndex)
    }
  }

  private normalizeDimension(value: number | string | undefined): string {
    if (typeof value === 'number') {
      return value > 1 ? `${value}px` : `${value * 100}%`
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.endsWith('%') || trimmed.endsWith('px')) {
        return trimmed
      }

      const numeric = Number(trimmed)
      if (Number.isFinite(numeric)) {
        return numeric > 1 ? `${numeric}px` : `${numeric * 100}%`
      }
    }

    return '0%'
  }

  private mountSceneSlot(
    container: HTMLElement,
    slot: LayoutSceneSlot,
    sceneId: string,
    sceneStartsAt?: string,
    sceneEndsAt?: string,
    scheduleId?: string,
    serverTimeOffsetMs: number = 0
  ): () => void {
    const timers = new Set<number>()
    let disposed = false
    let activeElement: HTMLElement | undefined

    const slotContext: PlaybackProgressIdentity = {
      scheduleId: scheduleId || null,
      sceneId,
      slotId: slot.id,
    }

    const resolveScenePosition = async (): Promise<PlaybackResumeDecision> => {
      const persisted = sceneStartsAt ? null : await this.getPersistedPlaybackProgress(slotContext)
      return resolveScheduledResumePosition({
        items: slot.items,
        startsAt: sceneStartsAt,
        serverTimeOffsetMs,
        expected: slotContext,
        persisted,
      })
    }

    const renderIntoSlot = async (item: TimelineItem, resume?: PlaybackResumeInstruction): Promise<HTMLElement> => {
      const compat = this.getItemCompatibility(item)
      if (compat.status === 'ACCEPTED_BUT_NOT_SUPPORTED_YET') {
        return this.renderDocumentPlaceholder(item, compat)
      }

      if (compat.status === 'REJECTED') {
        return this.createMediaPreviewCard(item, 'Preview unavailable', compat.reason)
      }

      switch (item.type) {
        case 'image':
          return await this.renderImage(item)
        case 'video':
          return await this.renderVideo(item, resume)
        case 'pdf':
          return await this.renderPDF(item)
        case 'office':
          return this.renderDocumentPlaceholder(item, compat)
        case 'url':
          return await this.renderURL(item)
        default:
          throw new Error(`Unsupported scene media type: ${item.type}`)
      }
    }

    const showSlotItem = async (
      index: number,
      delayOverrideMs?: number,
      resumeOverride?: PlaybackResumeDecision
    ): Promise<void> => {
      if (disposed || slot.items.length === 0) {
        return
      }

      const normalizedIndex = index % slot.items.length
      const item = slot.items[normalizedIndex]
      if (!item) {
        return
      }

      try {
        this.log('debug', 'Rendering scene slot item', {
          slotId: slot.id,
          itemId: item.id,
          mediaType: item.type,
          displayMs: item.displayMs,
          loop: item.loop,
          source: item.localUrl || item.localPath || item.remoteUrl || item.url || null,
        })

        const resumeDecision =
          resumeOverride && resumeOverride.index === normalizedIndex
            ? resumeOverride
            : resolveScheduledResumePosition({
                items: [item],
                startsAt: sceneStartsAt,
                serverTimeOffsetMs,
              })
        const nextElement = await renderIntoSlot(item, resumeDecision)
        if (disposed) {
          this.disposeScheduledElement(nextElement)
          return
        }
        if (item.type === 'video') {
          this.attachVideoProgressReporter(
            nextElement,
            item,
            this.buildPlaybackProgressContext(item, {
              scheduleId: scheduleId || null,
              sceneId,
              slotId: slot.id,
              scheduleStartsAt: sceneStartsAt || null,
              scheduleEndsAt: sceneEndsAt || null,
            })
          )
        }
        this.applyFitMode(nextElement, item.fit)
        const slotFadeMs = Math.max(0, item.transitionDurationMs || 0)
        const deferSlotFadeIn = prepareElementForFadeIn(nextElement, slotFadeMs)
        container.appendChild(nextElement)
        if (deferSlotFadeIn) {
          this.deferStyleCommit(() => {
            nextElement.style.opacity = '1'
          })
        } else {
          nextElement.style.opacity = '1'
        }

        if (activeElement && activeElement.parentElement === container) {
          const previous = activeElement
          prepareElementForFadeOut(previous, slotFadeMs)
          const fadeTimer = window.setTimeout(() => {
            timers.delete(fadeTimer)
            if (previous.parentElement === container) {
              this.disposeScheduledElement(previous)
            }
          }, slotFadeMs)
          timers.add(fadeTimer)
        }

        activeElement = nextElement
        if (resumeDecision.completed) {
          this.clearActiveSlotPlayback(slot.id)
        } else {
          this.setActiveSlotPlayback(slot.id, {
            scene_id: sceneId,
            slot_id: slot.id,
            item_id: item.id,
            media_id: item.mediaId || item.objectKey || null,
            schedule_id: scheduleId || null,
            playback_instance_id: globalThis.crypto.randomUUID(),
            started_at: new Date(Date.now() + serverTimeOffsetMs).toISOString(),
          })
        }
        if (shouldRepeatScheduledItem(slot.items.length, item) && !resumeDecision.completed) {
          const delayMs = delayOverrideMs ?? resumeDecision.remainingMs ?? Math.max(250, item.displayMs)
          const timer = window.setTimeout(() => {
            timers.delete(timer)
            if (sceneStartsAt) {
              void resolveScenePosition().then((nextPosition) => {
                void showSlotItem(nextPosition.index, nextPosition.remainingMs, nextPosition)
              })
            } else {
              void showSlotItem(normalizedIndex + 1)
            }
          }, delayMs)
          timers.add(timer)
        }
      } catch (error) {
        this.log('error', 'Failed to render scene slot media', {
          slotId: slot.id,
          itemId: item.id,
          error: (error as Error).message,
        })

        const placeholder = this.createMediaPreviewCard(item, 'Preview unavailable', (error as Error).message)
        placeholder.style.opacity = '1'
        while (container.firstChild) {
          container.removeChild(container.firstChild)
        }
        container.appendChild(placeholder)
        activeElement = placeholder
        this.clearActiveSlotPlayback(slot.id)
        const delayMs = delayOverrideMs ?? Math.max(250, item.displayMs)
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          if (sceneStartsAt) {
            void resolveScenePosition().then((nextPosition) => {
              void showSlotItem(nextPosition.index, nextPosition.remainingMs, nextPosition)
            })
          } else {
            void showSlotItem(normalizedIndex + 1)
          }
        }, delayMs)
        timers.add(timer)
      }
    }

    void resolveScenePosition().then((initialPosition) => {
      void showSlotItem(initialPosition.index, initialPosition.remainingMs, initialPosition)
    })

    return () => {
      disposed = true
      this.clearActiveSlotPlayback(slot.id)
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()

      if (activeElement) {
        this.disposeScheduledElement(activeElement)
        activeElement = undefined
      }

      while (container.firstChild) {
        this.disposeScheduledElement(container.firstChild as HTMLElement)
      }
    }
  }

  private disposeScheduledElement(element: HTMLElement | null | undefined): void {
    teardownScheduledElementTree(element as DisposableMediaNode | null | undefined)
  }

  private clearScheduledPlayback(reason: string): void {
    this.playbackSession += 1
    this.pendingTransition = undefined
    this.activeSceneId = undefined
    this.activeSlotPlaybacks.clear()
    this.reportActivePlayback()
    this.runCurrentCleanup()

    if (this.mediaContainer) {
      while (this.mediaContainer.firstChild) {
        this.disposeScheduledElement(this.mediaContainer.firstChild as HTMLElement)
      }
    }

    this.currentElement = undefined
    this.log('debug', 'Cleared scheduled playback', { reason })
  }

  private reportActivePlayback(): void {
    window.darshan?.reportActivePlayback?.({
      sceneId: this.activeSceneId,
      activeSlots: Array.from(this.activeSlotPlaybacks.values()),
    })
  }

  private setActiveSlotPlayback(slotId: string, playback: ActiveSlotPlayback): void {
    this.activeSlotPlaybacks.set(slotId, playback)
    this.reportActivePlayback()
  }

  private clearActiveSlotPlayback(slotId: string): void {
    if (!this.activeSlotPlaybacks.has(slotId)) {
      return
    }
    this.activeSlotPlaybacks.delete(slotId)
    this.reportActivePlayback()
  }

  private runCurrentCleanup(): void {
    if (!this.currentCleanup) {
      return
    }

    const cleanup = this.currentCleanup
    this.currentCleanup = undefined
    cleanup()
  }

  private deferStyleCommit(callback: () => void): void {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => callback())
      return
    }

    window.setTimeout(() => callback(), 0)
  }

  private getItemCompatibility(item: TimelineItem): CompatResult {
    const sourceContentType =
      typeof item.meta?.['source_content_type'] === 'string'
        ? (item.meta?.['source_content_type'] as string)
        : undefined
    const contentType =
      typeof item.meta?.['content_type'] === 'string' ? (item.meta?.['content_type'] as string) : undefined
    const mediaName = typeof item.meta?.['name'] === 'string' ? (item.meta?.['name'] as string) : undefined
    const mediaUrl = item.localUrl || item.remoteUrl || item.url || item.localPath

    return checkMediaCompatibility({
      type: item.type,
      content_type: contentType,
      source_content_type: sourceContentType,
      name: mediaName,
      media_url: mediaUrl,
    })
  }

  private renderDocumentPlaceholder(item: TimelineItem, compat?: CompatResult): HTMLElement {
    return this.createMediaPreviewCard(
      item,
      'Document preview',
      compat?.reason || 'Document rendering is not available for this file'
    )
  }

  private createMediaPreviewCard(item: TimelineItem, titleText: string, subtitleText?: string): HTMLElement {
    const kind = item.type === 'video' ? 'VIDEO' : item.type === 'pdf' || item.type === 'office' ? 'DOCUMENT' : 'MEDIA'
    const name = typeof item.meta?.['name'] === 'string' ? String(item.meta?.['name']) : item.mediaId || item.id

    const container = document.createElement('div')
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.alignItems = 'center'
    container.style.justifyContent = 'center'
    container.style.width = '100%'
    container.style.height = '100%'
    container.style.padding = '18px'
    container.style.gap = '10px'
    container.style.background = 'linear-gradient(180deg, rgba(27,31,38,0.95), rgba(15,18,24,0.98))'
    container.style.color = '#fff'
    container.style.textAlign = 'center'
    container.style.border = '1px solid rgba(255,255,255,0.12)'

    const badge = document.createElement('div')
    badge.textContent = kind
    badge.style.fontSize = '11px'
    badge.style.fontWeight = '700'
    badge.style.letterSpacing = '0.18em'
    badge.style.textTransform = 'uppercase'
    badge.style.opacity = '0.7'

    const title = document.createElement('div')
    title.textContent = titleText
    title.style.fontSize = '18px'
    title.style.fontWeight = '700'
    title.style.lineHeight = '1.2'

    const nameEl = document.createElement('div')
    nameEl.textContent = name
    nameEl.style.fontSize = '13px'
    nameEl.style.opacity = '0.86'
    nameEl.style.maxWidth = '100%'
    nameEl.style.wordBreak = 'break-word'

    container.appendChild(badge)
    container.appendChild(title)
    container.appendChild(nameEl)

    if (subtitleText) {
      const subtitle = document.createElement('div')
      subtitle.textContent = subtitleText
      subtitle.style.fontSize = '12px'
      subtitle.style.opacity = '0.58'
      subtitle.style.maxWidth = '100%'
      subtitle.style.wordBreak = 'break-word'
      container.appendChild(subtitle)
    }

    return container
  }
}

export function bootstrapPlayer(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      new Player()
    })
  } else {
    new Player()
  }
}

if (typeof document !== 'undefined') {
  bootstrapPlayer()
}
