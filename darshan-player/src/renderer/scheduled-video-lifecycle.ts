import { resolveVideoSeekSeconds } from '../common/playback-policy'

export const SCHEDULED_VIDEO_PLAY_RETRY_DELAYS_MS = [250, 1000] as const
export const SCHEDULED_VIDEO_STALL_TIMEOUT_MS = 10_000
export const SCHEDULED_VIDEO_LOAD_TIMEOUT_MS = 15_000

export interface ScheduledVideoLifecycleOptions {
  itemId: string
  displayMs: number
  loop: boolean
  autoplay: boolean
  seekMs: number
  onRuntimeError?: (error: Error) => void
  onLog?: (level: 'debug' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void
}

export interface ScheduledVideoLifecycle {
  ready: Promise<void>
  dispose: () => void
}

export function configureScheduledVideoElement(
  video: HTMLVideoElement,
  options: Pick<ScheduledVideoLifecycleOptions, 'loop' | 'autoplay'> & { muted: boolean },
): void {
  video.muted = options.muted
  video.autoplay = options.autoplay
  video.loop = options.loop
  video.playsInline = true
  video.preload = 'auto'
}

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(typeof error === 'string' && error.trim() ? error : fallback)
}

/**
 * Owns the asynchronous start/recovery listeners for one scheduled video.
 * Media teardown (pause/remove src/load) remains centralized in
 * teardownScheduledElementTree; dispose only cancels callbacks and timers.
 */
export function attachScheduledVideoLifecycle(
  video: HTMLVideoElement,
  options: ScheduledVideoLifecycleOptions,
): ScheduledVideoLifecycle {
  let disposed = false
  let readySettled = false
  let playbackStarted = false
  let playbackStarting = false
  let runtimeFailureReported = false
  let playAttempt = 0
  let seekTimer: ReturnType<typeof setTimeout> | undefined
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  let pendingSeekedListener: (() => void) | undefined
  const retryTimers = new Set<ReturnType<typeof setTimeout>>()

  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject): void => {
    resolveReady = resolve
    rejectReady = reject
  })

  const log = (
    level: 'debug' | 'warn' | 'error',
    message: string,
    data: Record<string, unknown> = {},
  ): void => {
    options.onLog?.(level, message, { itemId: options.itemId, ...data })
  }

  const clearStallTimer = (): void => {
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer)
      stallTimer = undefined
    }
  }

  const clearAsyncTimers = (): void => {
    if (seekTimer !== undefined) {
      clearTimeout(seekTimer)
      seekTimer = undefined
    }
    if (loadTimer !== undefined) {
      clearTimeout(loadTimer)
      loadTimer = undefined
    }
    if (pendingSeekedListener) {
      video.removeEventListener('seeked', pendingSeekedListener)
      pendingSeekedListener = undefined
    }
    clearStallTimer()
    retryTimers.forEach((timer): void => clearTimeout(timer))
    retryTimers.clear()
  }

  const settleReady = (): void => {
    if (readySettled || disposed) {
      return
    }
    readySettled = true
    clearAsyncTimers()
    resolveReady()
  }

  const failInitial = (error: Error): void => {
    if (readySettled || disposed) {
      return
    }
    readySettled = true
    clearAsyncTimers()
    rejectReady(error)
  }

  const reportRuntimeFailure = (error: Error): void => {
    if (disposed || runtimeFailureReported) {
      return
    }
    runtimeFailureReported = true
    clearAsyncTimers()
    log('error', 'Scheduled video failed after playback started', { error: error.message })
    options.onRuntimeError?.(error)
  }

  const scheduleStallWatchdog = (reason: string): void => {
    if (!options.loop || !playbackStarted || disposed || runtimeFailureReported) {
      return
    }
    clearStallTimer()
    stallTimer = setTimeout((): void => {
      stallTimer = undefined
      reportRuntimeFailure(new Error(`VIDEO_PLAYBACK_STALLED: ${reason}`))
    }, SCHEDULED_VIDEO_STALL_TIMEOUT_MS)
  }

  const onPlaybackProgress = (): void => clearStallTimer()
  const onWaiting = (): void => scheduleStallWatchdog('media waiting without progress')
  const onStalled = (): void => scheduleStallWatchdog('media stalled without progress')
  const onEnded = (): void => {
    if (options.loop) {
      reportRuntimeFailure(new Error('VIDEO_LOOP_ENDED_UNEXPECTEDLY'))
    }
  }

  const startPlayback = (): void => {
    if (disposed || playbackStarting || playbackStarted || readySettled) {
      return
    }
    if (!options.autoplay) {
      video.pause()
      settleReady()
      return
    }

    playbackStarting = true
    const attemptPlay = (): void => {
      if (disposed) {
        return
      }
      playAttempt += 1
      let playResult: Promise<void> | undefined
      try {
        playResult = video.play()
      } catch (error) {
        playResult = Promise.reject(error)
      }

      Promise.resolve(playResult).then((): void => {
        if (disposed) {
          return
        }
        playbackStarting = false
        playbackStarted = true
        log('debug', 'Scheduled video playback started', { playAttempt })
        settleReady()
      }).catch((error): void => {
        if (disposed) {
          return
        }
        const normalized = asError(error, 'Video play() failed')
        const retryDelay = SCHEDULED_VIDEO_PLAY_RETRY_DELAYS_MS[playAttempt - 1]
        if (retryDelay !== undefined) {
          log('warn', 'Scheduled video play attempt failed; retrying', {
            error: normalized.message,
            playAttempt,
            retryDelay,
          })
          const timer = setTimeout((): void => {
            retryTimers.delete(timer)
            attemptPlay()
          }, retryDelay)
          retryTimers.add(timer)
          return
        }

        playbackStarting = false
        failInitial(new Error(`VIDEO_PLAYBACK_START_FAILED: ${normalized.message}`))
      })
    }

    attemptPlay()
  }

  const beginAfterMetadata = (): void => {
    if (disposed || readySettled || playbackStarting || playbackStarted) {
      return
    }
    const seekSeconds = resolveVideoSeekSeconds(
      options.seekMs,
      video.duration,
      options.displayMs,
      options.loop,
    )
    if (seekSeconds <= 0.1) {
      startPlayback()
      return
    }

    try {
      video.currentTime = seekSeconds
    } catch (error) {
      log('warn', 'Failed to seek scheduled video before playback', {
        error: asError(error, 'Video seek failed').message,
        seekSeconds,
      })
      startPlayback()
      return
    }

    const onSeeked = (): void => {
      if (seekTimer !== undefined) {
        clearTimeout(seekTimer)
        seekTimer = undefined
      }
      video.removeEventListener('seeked', onSeeked)
      pendingSeekedListener = undefined
      startPlayback()
    }
    pendingSeekedListener = onSeeked
    seekTimer = setTimeout((): void => {
      seekTimer = undefined
      video.removeEventListener('seeked', onSeeked)
      pendingSeekedListener = undefined
      startPlayback()
    }, 2000)
    video.addEventListener('seeked', onSeeked)
  }

  const onLoadedMetadata = (): void => beginAfterMetadata()
  const onLoadedData = (): void => {
    if (!video.seeking) {
      beginAfterMetadata()
    }
  }
  const onError = (): void => {
    const mediaMessage = video.error?.message || 'Failed to load or decode scheduled video'
    const error = new Error(`VIDEO_MEDIA_ERROR: ${mediaMessage}`)
    if (!readySettled) {
      failInitial(error)
      return
    }
    reportRuntimeFailure(error)
  }

  video.addEventListener('loadedmetadata', onLoadedMetadata)
  video.addEventListener('loadeddata', onLoadedData)
  video.addEventListener('error', onError)
  video.addEventListener('waiting', onWaiting)
  video.addEventListener('stalled', onStalled)
  video.addEventListener('playing', onPlaybackProgress)
  video.addEventListener('timeupdate', onPlaybackProgress)
  video.addEventListener('seeked', onPlaybackProgress)
  video.addEventListener('ended', onEnded)

  loadTimer = setTimeout((): void => {
    loadTimer = undefined
    failInitial(new Error('VIDEO_MEDIA_LOAD_TIMEOUT'))
  }, SCHEDULED_VIDEO_LOAD_TIMEOUT_MS)

  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    if (!readySettled) {
      readySettled = true
      rejectReady(new Error('VIDEO_PLAYBACK_DISPOSED'))
    }
    clearAsyncTimers()
    video.removeEventListener('loadedmetadata', onLoadedMetadata)
    video.removeEventListener('loadeddata', onLoadedData)
    video.removeEventListener('error', onError)
    video.removeEventListener('waiting', onWaiting)
    video.removeEventListener('stalled', onStalled)
    video.removeEventListener('playing', onPlaybackProgress)
    video.removeEventListener('timeupdate', onPlaybackProgress)
    video.removeEventListener('seeked', onPlaybackProgress)
    video.removeEventListener('ended', onEnded)
  }

  return { ready, dispose }
}
