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
import { DeferredPlaybackGate } from './deferred-playback-gate'
import {
  resolveFailedSingleItemRetryPosition,
  resolveScheduledResumePosition,
} from '../common/playback-policy'
import { resolvePlayerContentSource, shouldDisplaySecurityLock } from '../common/player-content-source'
import {
  computeSceneStageFrame,
  prepareElementForFadeIn,
  prepareElementForFadeOut,
  resolveSceneSlotOccurrenceBoundaryDelayMs,
  resolveSceneSlotRecoveryDelayMs,
  shouldReportSceneSlotPlayback,
  shouldAdvanceSceneSlot,
  teardownScheduledElementTree,
  type DisposableMediaNode,
} from './player-layout-helpers'
import { attachScheduledVideoLifecycle, configureScheduledVideoElement } from './scheduled-video-lifecycle'
import type { PlaybackProgressEntry, PlaybackProgressIdentity, PlaybackResumeDecision } from '../common/playback-policy'
import { sanitizeLogPayloadForDiagnostics } from '../common/redaction'

export { resolvePlayerContentSource } from '../common/player-content-source'
export {
  computeSceneStageFrame,
  prepareElementForFadeIn,
  prepareElementForFadeOut,
  resolveOpacityTransitionStyle,
  resolveSceneSlotOccurrenceBoundaryDelayMs,
  resolveSceneSlotRecoveryDelayMs,
  shouldAdvanceSceneSlot,
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
  contentEpoch?: string
  scheduleStartsAt?: string | null
  scheduleEndsAt?: string | null
  itemDisplayMs?: number
}

type ScheduledMediaOptions = {
  contentEpoch?: string
  scheduleId?: string
  renderToken?: string
  singleItemFrame?: boolean
  retryingFailedItem?: boolean
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
  private activeContentEpoch?: string
  private contentUnavailableOverlay?: HTMLElement
  private ignoreFallbackStatusUntil = 0
  private pendingTransition?: PendingTransition
  private activeSceneId?: string
  private activeSlotPlaybacks = new Map<string, ActiveSlotPlayback>()
  private deferredPlayback = new DeferredPlaybackGate<{ item: TimelineItem } & ScheduledMediaOptions>()
  private topLevelRecoveryTimer?: number
  private topLevelRenderAbortController?: AbortController

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
      getContentEpoch: () => this.latestStatus?.contentEpoch,
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
    window.darshan?.onContentDisposal?.(request => {
      this.deferredPlayback.clear()
      this.clearScheduledPlayback('content-owner-disposal')
      this.setActiveSource('none')
      this.activeContentEpoch = undefined
      window.darshan.acknowledgeContentDisposal(request)
    })
    // Listen for media playback events
    if (window.darshan && window.darshan.onMediaChange) {
      window.darshan.onMediaChange((data: any) => {
        if (typeof data?.contentEpoch !== 'string' || data.contentEpoch !== this.latestStatus?.contentEpoch) return
        this.log('debug', 'Received play-media event', data)
        if (!this.canRenderScheduledContent()) {
          const currentSource = this.latestStatus ? resolvePlayerContentSource(this.latestStatus) : 'none'
          if (currentSource !== 'none' && data?.item) {
            this.deferredPlayback.defer(
              {
                item: data.item,
                contentEpoch: data.contentEpoch,
                scheduleId: typeof data.scheduleId === 'string' ? data.scheduleId : undefined,
                renderToken: typeof data.renderToken === 'string' ? data.renderToken : undefined,
                singleItemFrame: data.singleItemFrame === true,
              },
              this.latestPresentationRevision,
            )
          }
          this.log('debug', 'Ignoring playback event while lifecycle blocks content', {
            state: this.latestStatus?.state,
            deferred: currentSource !== 'none' && Boolean(data?.item),
          })
          return
        }
        this.deferredPlayback.clear()
        this.ignoreFallbackStatusUntil = Date.now() + Player.FALLBACK_STATUS_GUARD_MS
        this.setActiveSource('schedule')
        this.playMedia(data.item, {
          contentEpoch: data.contentEpoch,
          scheduleId: typeof data.scheduleId === 'string' ? data.scheduleId : undefined,
          renderToken: typeof data.renderToken === 'string' ? data.renderToken : undefined,
          singleItemFrame: data.singleItemFrame === true,
        }).catch((error) => {
          this.log('error', 'Failed to play media', { error: error.message })
          this.showFallback(error.message)
        })
      })
    }

    // Listen for transition events
    if (window.darshan && window.darshan.onPlaybackUpdate) {
      window.darshan.onPlaybackUpdate((data: any) => {
        if (typeof data?.contentEpoch !== 'string' || data.contentEpoch !== this.latestStatus?.contentEpoch) return
        if (data.type === 'transition-start') {
          if (!this.canRenderScheduledContent()) {
            return
          }
          this.log('debug', 'Received transition-start event', data)
          this.startTransition(data.current, data.next, data.durationMs)
        } else if (data.type === 'clear-active') {
          this.log('debug', 'Received clear-active event', data)
          this.deferredPlayback.clear()
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

    if (this.latestStatus?.contentEpoch !== presentation.status.contentEpoch) {
      this.deferredPlayback.clear()
      this.clearScheduledPlayback('content-epoch-changed')
      this.activeContentEpoch = undefined
    }
    this.latestPresentationRevision = presentation.revision
    this.latestStatus = presentation.status
    this.updateStatusOverlay(presentation.status)
    this.updateContentSource(presentation.status)
    const source = resolvePlayerContentSource(presentation.status)
    const deferred = this.deferredPlayback.resolve(presentation.revision, source)
    if (deferred) {
      this.ignoreFallbackStatusUntil = Date.now() + Player.FALLBACK_STATUS_GUARD_MS
      this.setActiveSource('schedule')
      void this.playMedia(deferred.item, {
        contentEpoch: deferred.contentEpoch,
        scheduleId: deferred.scheduleId,
        renderToken: deferred.renderToken,
        singleItemFrame: deferred.singleItemFrame,
      }).catch((error) => {
        this.log('error', 'Failed to play deferred media', { error: error.message })
        this.showFallback(error.message)
      })
    }
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
    const runtime = ['PAIRED_RUNTIME', 'OFFLINE_USING_LAST_VALID_PAIRING', 'SOFT_RECOVERY'].includes(status.state)
    const unavailable = runtime && !shouldDisplaySecurityLock(status) && (Boolean(status.contentUnavailableReason) ||
      (status.mode === 'live' && status.live?.phase !== 'LIVE' && !(status.live?.fallbackReady && ['FALLBACK', 'CONNECTING'].includes(status.live.phase))))
    this.showContentUnavailable(unavailable)
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

  private showContentUnavailable(visible: boolean): void {
    if (!this.contentUnavailableOverlay && visible) {
      const element = document.createElement('div')
      element.id = 'content-unavailable-overlay'
      element.textContent = 'Content unavailable'
      Object.assign(element.style, { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', zIndex: '2500' })
      document.body.appendChild(element)
      this.contentUnavailableOverlay = element
    }
    if (this.contentUnavailableOverlay) this.contentUnavailableOverlay.style.display = visible ? 'grid' : 'none'
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
  private async playMedia(item: TimelineItem, options: ScheduledMediaOptions = {}): Promise<void> {
    if (!options.contentEpoch || options.contentEpoch !== this.latestStatus?.contentEpoch) return
    this.activeContentEpoch = options.contentEpoch
    this.clearTopLevelRecoveryTimer()
    this.abortTopLevelRender()
    const sessionId = ++this.playbackSession
    const renderAbortController = item.type === 'video' ? new AbortController() : undefined
    this.topLevelRenderAbortController = renderAbortController
    this.log('info', 'Playing media', { itemId: item.id, type: item.type })
    // Emergency text must replace the prior frame immediately; a decorative
    // crossfade can briefly show two conflicting safety instructions.
    const transitionDurationMs = item.type === 'message' || typeof item.meta?.['emergency_message'] === 'string'
      ? 0
      : this.pendingTransition?.nextId === item.id ? this.pendingTransition.durationMs : undefined
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

      const compat: CompatResult = item.type === 'message'
        ? { status: 'PLAYABLE_NOW', kind: 'UNKNOWN', reason: 'native emergency message' }
        : this.getItemCompatibility(item)

      if (compat.status === 'PLAYABLE_NOW') {
        this.log('debug', 'Media compatibility check', { itemId: item.id, compat })
      } else if (compat.status === 'ACCEPTED_BUT_NOT_SUPPORTED_YET') {
        this.log('warn', 'Media not supported yet', { itemId: item.id, compat })
        this.showCompatibilityPlaceholder(compat, item)
        return
      } else {
        this.log('error', 'Media rejected by compatibility check', { itemId: item.id, compat })
        this.showFallback(item.type === 'url' ? 'Content unavailable' : `Unsupported media: ${compat.reason}`)
        return
      }

      let element: HTMLElement
      let shouldWrapEmergencyMedia = item.type !== 'message' && typeof item.meta?.['emergency_message'] === 'string'
      const normalResumeDecision = await this.resolveSingleItemResumeDecision(item, options.scheduleId)
      const resumeDecision = options.retryingFailedItem === true
        ? resolveFailedSingleItemRetryPosition({
            items: [item],
            startsAt:
              this.getStringMeta(item, 'scheduleWindowStartsAt') || this.getStringMeta(item, 'scheduleStartsAt'),
            serverTimeOffsetMs: this.getNumberMeta(item, 'serverTimeOffsetMs') || 0,
          })
        : normalResumeDecision
      const progressContext = this.buildPlaybackProgressContext(item, {
        contentEpoch: options.contentEpoch,
        scheduleId: options.scheduleId,
      })

      switch (item.type) {
        case 'image':
          element = await this.renderImage(item)
          break
        case 'video':
          element = await this.renderVideo(
            item,
            resumeDecision,
            (error) => {
              this.handleTopLevelVideoFailure(item, error, sessionId, options)
            },
            renderAbortController?.signal,
          )
          this.attachVideoProgressReporter(element as HTMLVideoElement, item, progressContext)
          break
        case 'pdf':
          element = await this.renderPDF(item)
          break
        case 'office':
          element = this.renderDocumentPlaceholder(item, compat)
          break
        case 'url':
          if (typeof item.meta?.['emergency_message'] === 'string') {
            const fallbackUrl = item.meta?.['fallback_local_url'] || item.meta?.['fallback_url']
            element = typeof fallbackUrl === 'string'
              ? await this.renderImage({ ...item, type: 'image', localUrl: fallbackUrl, remoteUrl: fallbackUrl })
              : this.renderEmergencyMessage(item)
            if (typeof fallbackUrl !== 'string') shouldWrapEmergencyMedia = false
          } else {
            element = await this.renderURL(item, options.contentEpoch)
          }
          break
        case 'message':
          element = this.renderEmergencyMessage(item)
          break
        default:
          throw new Error(`Unsupported media type: ${item.type}`)
      }

      // Apply fit mode
      this.applyFitMode(element, item.fit)
      if (shouldWrapEmergencyMedia) {
        element = this.wrapEmergencyMedia(element, item)
      }

      if (sessionId !== this.playbackSession) {
        this.disposeScheduledElement(element)
        return
      }

      // Show element
      this.showElement(element, undefined, transitionDurationMs)

      this.currentElement = element
      const mediaId = item.mediaId || item.objectKey || item.id
      const result = await window.darshan?.reportMediaStarted?.({
        contentEpoch: options.contentEpoch,
        itemId: item.id,
        mediaId,
        renderToken: options.renderToken || '',
        pageNumber: item.type === 'pdf' ? item.pageNumber ?? 1 : undefined,
      })
      if (result && !result.accepted) {
        this.log('warn', 'Main process rejected stale rendered playback confirmation', { itemId: item.id })
      }
    } catch (error) {
      this.log('error', 'Failed to play media', { error: (error as Error).message })
      if (item.type !== 'message' && typeof item.meta?.['emergency_message'] === 'string' && sessionId === this.playbackSession) {
        const fallback = this.renderEmergencyMessage(item)
        this.showElement(fallback, undefined, 0)
        this.currentElement = fallback
        return
      }
      if (item.type === 'video' && sessionId === this.playbackSession) {
        this.handleTopLevelVideoFailure(item, error as Error, sessionId, options)
        return
      }
      throw error
    } finally {
      if (this.topLevelRenderAbortController === renderAbortController) {
        this.topLevelRenderAbortController = undefined
      }
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

  private renderEmergencyMessage(item: TimelineItem): HTMLElement {
    const severity = this.emergencySeverity(item)
    const container = document.createElement('section')
    container.className = `player-emergency player-emergency--${severity.toLowerCase()}`
    container.setAttribute('role', 'alert')
    container.setAttribute('aria-live', 'assertive')

    const heading = document.createElement('div')
    heading.className = 'player-emergency-heading'
    heading.textContent = `${severity} EMERGENCY`

    const message = document.createElement('div')
    message.className = 'player-emergency-copy'
    message.textContent = String(item.meta?.['message'] ?? 'Emergency alert')

    const footer = document.createElement('div')
    footer.className = 'player-emergency-footer'
    footer.textContent = 'Follow onsite safety instructions immediately'

    container.append(heading, message, footer)
    const fitMessage = (): void => {
      if (!container.isConnected || message.clientWidth <= 0 || message.clientHeight <= 0) return
      const minimumSize = 10
      let low = minimumSize
      let high = Math.min(72, Math.max(18, Math.floor(container.clientHeight * 0.12)))
      let fittedSize = minimumSize

      while (low <= high) {
        const candidate = Math.floor((low + high) / 2)
        message.style.fontSize = `${candidate}px`
        if (message.scrollHeight <= message.clientHeight && message.scrollWidth <= message.clientWidth) {
          fittedSize = candidate
          low = candidate + 1
        } else {
          high = candidate - 1
        }
      }

      message.style.fontSize = `${fittedSize}px`
    }
    const scheduleFit = (): void => this.deferStyleCommit(fitMessage)
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : undefined
    resizeObserver?.observe(container)
    ;(container as DisposableMediaNode).__darshanCleanup = () => resizeObserver?.disconnect()
    scheduleFit()
    return container
  }

  private emergencySeverity(item: TimelineItem): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const severity = String(item.meta?.['severity'] ?? 'HIGH').toUpperCase()
    return severity === 'LOW' || severity === 'MEDIUM' || severity === 'CRITICAL' ? severity : 'HIGH'
  }

  private wrapEmergencyMedia(media: HTMLElement, item: TimelineItem): HTMLElement {
    const severity = this.emergencySeverity(item)
    const wrapper = document.createElement('section')
    wrapper.className = `player-emergency-media player-emergency--${severity.toLowerCase()}`
    wrapper.setAttribute('role', 'alert')
    Object.assign(wrapper.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: '#000000',
    })
    wrapper.appendChild(media)

    const overlay = document.createElement('div')
    overlay.className = 'player-emergency-media-copy'
    Object.assign(overlay.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      zIndex: '2',
      maxHeight: '42%',
      overflow: 'hidden',
      padding: 'clamp(12px, 3vmin, 48px)',
      borderTopWidth: 'clamp(3px, 0.6vmin, 10px)',
      fontSize: 'clamp(18px, 4vmin, 64px)',
      fontWeight: '800',
      lineHeight: '1.12',
      textAlign: 'center',
      overflowWrap: 'anywhere',
    })
    overlay.textContent = String(item.meta?.['emergency_message'])
    wrapper.appendChild(overlay)
    return wrapper
  }

  /**
   * Render video
   */
  private async renderVideo(
    item: TimelineItem,
    resume?: PlaybackResumeInstruction,
    onRuntimeError?: (error: Error) => void,
    signal?: AbortSignal,
  ): Promise<HTMLElement> {
    const video = document.createElement('video')
    const source = this.getMediaSource(item)
    video.style.position = 'absolute'
    video.style.top = '0'
    video.style.left = '0'
    video.style.width = '100%'
    video.style.height = '100%'
    configureScheduledVideoElement(video, {
      muted: item.muted,
      autoplay: resume?.autoplay !== false,
      loop: item.loop,
    })

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

    const lifecycle = attachScheduledVideoLifecycle(video, {
      itemId: item.id,
      displayMs: item.displayMs,
      loop: item.loop,
      autoplay: resume?.autoplay !== false,
      seekMs: resume?.seekMs ?? 0,
      onRuntimeError,
      onLog: (level, message, data) => this.log(level, message, data),
    })
    ;(video as DisposableMediaNode).__darshanCleanup = lifecycle.dispose
    const onAbort = (): void => this.disposeScheduledElement(video)
    if (signal?.aborted) {
      onAbort()
      throw new Error('VIDEO_PLAYBACK_DISPOSED')
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    video.src = source

    try {
      await lifecycle.ready
      this.log('debug', 'Video loaded', {
        itemId: item.id,
        resumeSource: resume?.source,
        resumeSeekMs: resume?.seekMs,
        completed: resume?.completed,
      })
      return video
    } catch (error) {
      this.disposeScheduledElement(video)
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
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
      contentEpoch: overrides.contentEpoch ?? this.activeContentEpoch,
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
        contentEpoch: context.contentEpoch,
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
    const onEnded = () => sendProgress(item.loop !== true)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)

    const previousCleanup = (video as DisposableMediaNode).__darshanCleanup
    ;(video as DisposableMediaNode).__darshanCleanup = () => {
      window.clearInterval(interval)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      sendProgress(item.loop !== true && video.ended)
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
    return createPdfPlaybackElement(this.getMediaSource(item), item.pageNumber ?? 1, {
      itemId: item.id,
      mediaId: item.mediaId,
      snapshotId: this.getStringMeta(item, 'snapshotId'),
    })
  }

  /**
   * Render URL
   */
  private async renderURL(_item: TimelineItem, _contentEpoch?: string): Promise<HTMLElement> {
    const element = document.createElement('div')
    element.className = 'content-unavailable'
    element.textContent = 'Content unavailable'
    element.style.display = 'flex'
    element.style.alignItems = 'center'
    element.style.justifyContent = 'center'
    element.style.width = '100%'
    element.style.height = '100%'
    return element
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

    const reflowStage = () => {
      const rect = container.getBoundingClientRect()
      const width = Math.max(1, rect.width || window.innerWidth)
      const height = Math.max(1, rect.height || window.innerHeight)
      const frame = computeSceneStageFrame(scene.aspectRatio, width, height)
      stage.style.left = `${frame.left}px`
      stage.style.top = `${frame.top}px`
      stage.style.width = `${frame.width}px`
      stage.style.height = `${frame.height}px`
    }
    reflowStage()
    stage.dataset['sceneAspectRatio'] = scene.aspectRatio || 'free'
    container.appendChild(stage)

    const cleanupCallbacks: Array<() => void> = []
    const stageResizeObserver = new ResizeObserver(reflowStage)
    stageResizeObserver.observe(container)
    let cleanedUp = false
    let sceneEndTimer: number | undefined

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
      if (cleanedUp) {
        return
      }
      cleanedUp = true
      if (sceneEndTimer !== undefined) {
        window.clearTimeout(sceneEndTimer)
        sceneEndTimer = undefined
      }
      stageResizeObserver.disconnect()
      cleanupCallbacks.forEach((cleanup) => cleanup())
      cleanupCallbacks.length = 0
    }

    const sceneEndsAtMs = scene.endsAt ? Date.parse(scene.endsAt) : Number.NaN
    if (Number.isFinite(sceneEndsAtMs)) {
      const delayMs = Math.max(0, sceneEndsAtMs - (Date.now() + (scene.serverTimeOffsetMs || 0)))
      sceneEndTimer = window.setTimeout(() => {
        sceneEndTimer = undefined
        if (!cleanedUp && this.activeSceneId === sceneItem.id) {
          this.clearScheduledPlayback('scene-window-ended')
        }
      }, delayMs)
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
      if (typeof (previous as DisposableMediaNode).__darshanCleanup === 'function') {
        this.disposeScheduledElement(previous)
        this.currentElement = undefined
      } else if (safeFadeMs === 0) {
        this.disposeScheduledElement(previous)
      } else {
        prepareElementForFadeOut(previous, safeFadeMs)
        setTimeout(() => {
          if (this.mediaContainer && previous.parentElement === this.mediaContainer) {
            this.disposeScheduledElement(previous)
          }
        }, safeFadeMs)
      }
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

  private handleTopLevelVideoFailure(
    item: TimelineItem,
    error: Error,
    sessionId: number,
    options: ScheduledMediaOptions,
  ): void {
    if (sessionId !== this.playbackSession || !this.canRenderScheduledContent() || !this.mediaContainer) {
      return
    }

    this.log('error', 'Scheduled video unavailable', {
      itemId: item.id,
      error: error.message,
      singleItemFrame: options.singleItemFrame === true,
    })
    const unavailable = this.createMediaPreviewCard(item, 'Unavailable', 'This video could not be played.')
    this.showElement(unavailable, undefined, 0)
    this.currentElement = unavailable

    if (options.singleItemFrame !== true) {
      return
    }

    const retryDelayMs = resolveSceneSlotRecoveryDelayMs(item.displayMs)
    this.topLevelRecoveryTimer = window.setTimeout(() => {
      this.topLevelRecoveryTimer = undefined
      if (sessionId !== this.playbackSession || !this.canRenderScheduledContent()) {
        return
      }
      void this.playMedia(item, { ...options, retryingFailedItem: true }).catch((retryError) => {
        this.log('error', 'Failed to retry scheduled video', { error: (retryError as Error).message })
      })
    }, retryDelayMs)
  }

  private clearTopLevelRecoveryTimer(): void {
    if (this.topLevelRecoveryTimer === undefined) {
      return
    }
    window.clearTimeout(this.topLevelRecoveryTimer)
    this.topLevelRecoveryTimer = undefined
  }

  private abortTopLevelRender(): void {
    this.topLevelRenderAbortController?.abort()
    this.topLevelRenderAbortController = undefined
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
    const contentEpoch = this.activeContentEpoch
    const timers = new Set<number>()
    const pendingRenderControllers = new Set<AbortController>()
    let disposed = false
    let activeElement: HTMLElement | undefined
    let renderGeneration = 0

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

    const renderIntoSlot = async (
      item: TimelineItem,
      resume?: PlaybackResumeInstruction,
      onVideoRuntimeError?: (error: Error) => void,
      signal?: AbortSignal,
    ): Promise<HTMLElement> => {
      const compat = this.getItemCompatibility(item)
      if (compat.status === 'ACCEPTED_BUT_NOT_SUPPORTED_YET') {
        return this.renderDocumentPlaceholder(item, compat)
      }

      if (compat.status === 'REJECTED') {
        return this.createMediaPreviewCard(item, item.type === 'url' ? 'Content unavailable' : 'Preview unavailable', compat.reason)
      }

      switch (item.type) {
        case 'image':
          return await this.renderImage(item)
        case 'video':
          return await this.renderVideo(item, resume, onVideoRuntimeError, signal)
        case 'pdf':
          return await this.renderPDF(item)
        case 'office':
          return this.renderDocumentPlaceholder(item, compat)
        case 'url':
          return await this.renderURL(item, contentEpoch)
        case 'message':
          return this.renderEmergencyMessage(item)
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
      const generation = ++renderGeneration
      const renderAbortController = new AbortController()
      pendingRenderControllers.add(renderAbortController)
      let nextElement: HTMLElement | undefined
      let pendingRuntimeError: Error | undefined
      let runtimeFailureHandled = false
      const shouldAdvance = shouldAdvanceSceneSlot(slot.items.length)
      const resumeDecision =
        resumeOverride && resumeOverride.index === normalizedIndex
          ? resumeOverride
          : resolveScheduledResumePosition({
              items: [item],
              startsAt: sceneStartsAt,
              serverTimeOffsetMs,
            })

      // Own the occurrence boundary independently from asynchronous media
      // loading. A decode/load failure must not restart the item duration.
      if (shouldAdvance && !resumeDecision.completed) {
        const boundaryDelayMs = resolveSceneSlotOccurrenceBoundaryDelayMs(
          item.displayMs,
          delayOverrideMs,
          resumeDecision.remainingMs,
        )
        const timer = window.setTimeout(() => {
          timers.delete(timer)
          if (disposed || generation !== renderGeneration) {
            return
          }
          // End the old occurrence at its wall-clock boundary even when the
          // following item is still resolving or the current decoder is hung.
          renderAbortController.abort()
          renderGeneration += 1
          if (activeElement) {
            this.disposeScheduledElement(activeElement)
            activeElement = undefined
          }
          this.clearActiveSlotPlayback(slot.id, contentEpoch)
          if (sceneStartsAt) {
            void resolveScenePosition().then((nextPosition) => {
              void showSlotItem(nextPosition.index, nextPosition.remainingMs, nextPosition)
            })
          } else {
            void showSlotItem(normalizedIndex + 1)
          }
        }, boundaryDelayMs)
        timers.add(timer)
      }

      const handleVideoRuntimeError = (error: Error) => {
        if (!nextElement) {
          pendingRuntimeError = error
          return
        }
        if (disposed || runtimeFailureHandled || generation !== renderGeneration || activeElement !== nextElement) {
          return
        }
        runtimeFailureHandled = true
        this.log('error', 'Scheduled video failed while active in scene slot', {
          slotId: slot.id,
          itemId: item.id,
          error: error.message,
        })

        this.disposeScheduledElement(nextElement)
        const placeholder = this.createMediaPreviewCard(item, 'Unavailable', 'This video could not be played.')
        placeholder.style.opacity = '1'
        container.appendChild(placeholder)
        activeElement = placeholder
        this.clearActiveSlotPlayback(slot.id, contentEpoch)

        if (!shouldAdvanceSceneSlot(slot.items.length)) {
          const retryDelayMs = resolveSceneSlotRecoveryDelayMs(item.displayMs)
          const timer = window.setTimeout(() => {
            timers.delete(timer)
            const retryResumeDecision = resolveFailedSingleItemRetryPosition({
              items: [item],
              startsAt: sceneStartsAt,
              serverTimeOffsetMs,
            })
            void showSlotItem(normalizedIndex, undefined, retryResumeDecision)
          }, retryDelayMs)
          timers.add(timer)
        }
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

        const renderedElement = await renderIntoSlot(
          item,
          resumeDecision,
          handleVideoRuntimeError,
          renderAbortController.signal,
        )
        pendingRenderControllers.delete(renderAbortController)
        nextElement = renderedElement
        if (disposed || generation !== renderGeneration) {
          this.disposeScheduledElement(renderedElement)
          return
        }
        if (item.type === 'video') {
          this.attachVideoProgressReporter(
            renderedElement,
            item,
            this.buildPlaybackProgressContext(item, {
              contentEpoch,
              scheduleId: scheduleId || null,
              sceneId,
              slotId: slot.id,
              scheduleStartsAt: sceneStartsAt || null,
              scheduleEndsAt: sceneEndsAt || null,
            })
          )
        }
        this.applyFitMode(renderedElement, item.fit)
        const slotFadeMs = Math.max(0, item.transitionDurationMs || 0)
        const deferSlotFadeIn = prepareElementForFadeIn(renderedElement, slotFadeMs)
        container.appendChild(renderedElement)
        if (deferSlotFadeIn) {
          this.deferStyleCommit(() => {
            renderedElement.style.opacity = '1'
          })
        } else {
          renderedElement.style.opacity = '1'
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

        activeElement = renderedElement
        const compatibility = this.getItemCompatibility(item)
        const playable = item.type === 'message' || compatibility.status === 'PLAYABLE_NOW'
        if (!shouldReportSceneSlotPlayback(item.type, resumeDecision.completed, playable)) {
          this.clearActiveSlotPlayback(slot.id, contentEpoch)
        } else {
          this.setActiveSlotPlayback(contentEpoch, slot.id, {
            scene_id: sceneId,
            slot_id: slot.id,
            item_id: item.id,
            media_id: item.mediaId || item.objectKey || null,
            cache_key: typeof item.meta?.['cache_key'] === 'string' ? String(item.meta['cache_key']) : null,
            schedule_id: scheduleId || null,
            playback_instance_id: globalThis.crypto.randomUUID(),
            started_at: new Date(Date.now() + serverTimeOffsetMs).toISOString(),
            page_number: item.type === 'pdf' ? item.pageNumber ?? 1 : undefined,
          })
        }
        if (pendingRuntimeError) {
          handleVideoRuntimeError(pendingRuntimeError)
        }
      } catch (error) {
        pendingRenderControllers.delete(renderAbortController)
        if (disposed || generation !== renderGeneration) {
          return
        }
        this.log('error', 'Failed to render scene slot media', {
          slotId: slot.id,
          itemId: item.id,
          error: (error as Error).message,
        })

        const placeholder = this.createMediaPreviewCard(
          item,
          'Unavailable',
          item.type === 'video' ? 'This video could not be played.' : 'This item could not be displayed.',
        )
        placeholder.style.opacity = '1'
        while (container.firstChild) {
          this.disposeScheduledElement(container.firstChild as HTMLElement)
        }
        container.appendChild(placeholder)
        activeElement = placeholder
        this.clearActiveSlotPlayback(slot.id, contentEpoch)
        if (!shouldAdvance) {
          const delayMs = resolveSceneSlotRecoveryDelayMs(item.displayMs)
          const timer = window.setTimeout(() => {
            timers.delete(timer)
            const retryResumeDecision = resolveFailedSingleItemRetryPosition({
              items: [item],
              startsAt: sceneStartsAt,
              serverTimeOffsetMs,
            })
            void showSlotItem(normalizedIndex, undefined, retryResumeDecision)
          }, delayMs)
          timers.add(timer)
        }
      }
    }

    void resolveScenePosition().then((initialPosition) => {
      void showSlotItem(initialPosition.index, initialPosition.remainingMs, initialPosition)
    })

    return () => {
      disposed = true
      renderGeneration += 1
      this.clearActiveSlotPlayback(slot.id, contentEpoch)
      pendingRenderControllers.forEach((controller) => controller.abort())
      pendingRenderControllers.clear()
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
    this.clearTopLevelRecoveryTimer()
    this.abortTopLevelRender()
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
      contentEpoch: this.activeContentEpoch,
      sceneId: this.activeSceneId,
      activeSlots: Array.from(this.activeSlotPlaybacks.values()),
    })
  }

  private setActiveSlotPlayback(contentEpoch: string | undefined, slotId: string, playback: ActiveSlotPlayback): void {
    if (!contentEpoch || contentEpoch !== this.activeContentEpoch) return
    this.activeSlotPlaybacks.set(slotId, playback)
    this.reportActivePlayback()
  }

  private clearActiveSlotPlayback(slotId: string, contentEpoch: string | undefined): void {
    if (!contentEpoch || contentEpoch !== this.activeContentEpoch) return
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
    container.className = 'player-media-placeholder'
    container.style.display = 'flex'
    container.style.flexDirection = 'column'
    container.style.alignItems = 'center'
    container.style.justifyContent = 'center'
    container.style.width = '100%'
    container.style.height = '100%'
    container.style.padding = '18px'
    container.style.gap = '10px'
    container.style.textAlign = 'center'

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
