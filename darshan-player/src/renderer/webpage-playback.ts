import { redactUrlForDiagnostics, sanitizeLogPayloadForDiagnostics } from '../common/redaction'

import type { WebpageViewRequest, WebpageViewStatus } from '../common/types'

export type ManagedWebpageElement = HTMLElement & { __darshanCleanup?: () => void }
type WebpageLogLevel = 'debug' | 'warn'

export type WebpagePlaybackOptions = {
  liveUrl: string
  fallbackUrl?: string
  fallbackFit?: 'contain' | 'cover' | 'fill'
  zIndex?: number
  onHealthy?: () => void
  onFallback?: (reason: string) => void
  onLog?: (level: WebpageLogLevel, message: string, data?: Record<string, unknown>) => void
}

type WebpageProbeResult = {
  width: number
  height: number
  textLength: number
  mediaCount: number
  visibleElementCount: number
  overflowX: boolean
  overflowY: boolean
}

let nextGeneration = 0
const MAX_MOUNT_RETRIES = 60

export function shouldRevealLiveWebpage(
  probe: Pick<WebpageProbeResult, 'width' | 'height' | 'textLength' | 'mediaCount' | 'visibleElementCount'> &
    Partial<Pick<WebpageProbeResult, 'overflowX' | 'overflowY'>>
): boolean {
  return probe.width > 0 && probe.height > 0 &&
    (probe.textLength > 24 || probe.mediaCount > 0 || probe.visibleElementCount > 1)
}

function log(options: WebpagePlaybackOptions, level: WebpageLogLevel, message: string, data?: Record<string, unknown>) {
  options.onLog?.(level, message, sanitizeLogPayloadForDiagnostics(data) as Record<string, unknown>)
}

function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  nextGeneration += 1
  return `webpage-${Date.now()}-${nextGeneration}`
}

export function createWebpagePlaybackElement(options: WebpagePlaybackOptions): ManagedWebpageElement {
  const container = document.createElement('div') as ManagedWebpageElement
  Object.assign(container.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', background: '#000', overflow: 'hidden',
  })

  const fallbackLayer = document.createElement('div')
  Object.assign(fallbackLayer.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', background: '#000',
    zIndex: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
  })
  container.appendChild(fallbackLayer)

  if (options.fallbackUrl) {
    const fallbackImage = document.createElement('img')
    fallbackImage.src = options.fallbackUrl
    Object.assign(fallbackImage.style, {
      width: '100%', height: '100%', objectFit: options.fallbackFit ?? 'contain', background: '#000',
    })
    fallbackLayer.appendChild(fallbackImage)
  } else {
    const fallbackLabel = document.createElement('div')
    fallbackLabel.textContent = 'Live webpage unavailable'
    Object.assign(fallbackLabel.style, { color: '#fff', fontSize: '18px', fontWeight: '600', opacity: '0.8' })
    fallbackLayer.appendChild(fallbackLabel)
  }

  const id = makeId()
  const generation = ++nextGeneration
  let disposed = false
  let mounted = false
  let animationFrame: number | undefined
  let retryTimer: number | undefined
  let mountRetryCount = 0

  const scheduleMountRetry = () => {
    if (disposed || retryTimer !== undefined || mountRetryCount >= MAX_MOUNT_RETRIES) return
    mountRetryCount += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      syncBounds()
    }, 1000)
  }

  const buildRequest = (): WebpageViewRequest | null => {
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      id,
      generation,
      url: options.liveUrl,
      bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      zIndex: options.zIndex ?? (Number.parseInt(container.style.zIndex || '0', 10) || 0),
    }
  }

  const syncBounds = () => {
    if (disposed) return
    if (animationFrame !== undefined) window.cancelAnimationFrame?.(animationFrame)
    animationFrame = window.requestAnimationFrame?.(() => {
      animationFrame = undefined
      const request = buildRequest()
      if (!request) return
      const operation = mounted ? window.darshan.updateWebpageView(request) : window.darshan.mountWebpageView(request)
      void operation.then((result) => {
        if (disposed) return
        mounted = mounted || result.accepted
        if (!result.accepted) {
          log(options, 'warn', 'Webpage view request rejected', {
            reason: result.reason,
            url: redactUrlForDiagnostics(options.liveUrl),
          })
          options.onFallback?.(result.reason ?? 'view-rejected')
          if (result.reason === 'live-view-cap') scheduleMountRetry()
        }
      }).catch((error) => {
        log(options, 'warn', 'Webpage view IPC failed', { error, url: redactUrlForDiagnostics(options.liveUrl) })
        options.onFallback?.('view-ipc-failed')
      })
    })
  }

  const removeStatusListener = window.darshan.onWebpageViewStatus((status: WebpageViewStatus) => {
    if (disposed || status.id !== id || status.generation !== generation) return
    if (status.state === 'healthy') {
      mountRetryCount = 0
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer)
        retryTimer = undefined
      }
      fallbackLayer.style.display = 'none'
      log(options, 'debug', 'Webpage live view healthy', { url: redactUrlForDiagnostics(options.liveUrl) })
      options.onHealthy?.()
      return
    }
    fallbackLayer.style.display = 'flex'
    if (status.state === 'fallback' || status.state === 'blocked') {
      log(options, 'warn', 'Webpage fallback active', {
        reason: status.reason,
        url: redactUrlForDiagnostics(options.liveUrl),
      })
      options.onFallback?.(status.reason ?? status.state)
      if (status.reason === 'live-view-cap' || status.reason === 'display-changed') {
        mounted = false
        scheduleMountRetry()
      }
    }
  })

  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(syncBounds)
  resizeObserver?.observe(container)
  queueMicrotask(syncBounds)

  container.__darshanCleanup = () => {
    if (disposed) return
    disposed = true
    resizeObserver?.disconnect()
    removeStatusListener()
    if (animationFrame !== undefined) window.cancelAnimationFrame?.(animationFrame)
    if (retryTimer !== undefined) window.clearTimeout(retryTimer)
    window.darshan.destroyWebpageView(id, generation)
  }

  return container
}
