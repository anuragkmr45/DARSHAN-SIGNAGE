/**
 * Timeline Scheduler - Precise timing control for media playback
 * Target: Timeline jitter ≤100ms p95
 */

import { EventEmitter } from 'events'
import { getLogger } from '../../../common/logger'
import { TimelineItem } from '../../../common/types'
import {
  PlaybackResumeDecision,
  resolveScheduledResumePosition,
  shouldRepeatScheduledItem,
} from '../../../common/playback-policy'

const logger = getLogger('timeline-scheduler')

export interface ScheduledItem {
  item: TimelineItem
  startTime: number
  endTime: number
  index: number
  resumeDecision?: PlaybackResumeDecision
}

export interface TimelineCompletion {
  willRepeat: boolean
  authorityEnded: boolean
}

function getScheduleWindowEndMs(item?: TimelineItem): number | null {
  const rawEnd = item?.meta?.['scheduleWindowEndsAt']
  if (typeof rawEnd !== 'string') {
    return null
  }

  const endMs = Date.parse(rawEnd)
  return Number.isFinite(endMs) ? endMs : null
}

function getServerNowMs(item?: TimelineItem): number {
  const rawOffset = Number(item?.meta?.['serverTimeOffsetMs'])
  return Date.now() + (Number.isFinite(rawOffset) ? rawOffset : 0)
}

function isScheduleWindowActive(item?: TimelineItem): boolean {
  const endMs = getScheduleWindowEndMs(item)
  return endMs === null || getServerNowMs(item) < endMs
}

function resolveSingleLoopHoldMs(item: TimelineItem): number {
  const endMs = getScheduleWindowEndMs(item)
  if (endMs === null) {
    return Number.POSITIVE_INFINITY
  }

  return Math.max(0, endMs - getServerNowMs(item))
}

function resolveScheduleWindowRemainingMs(item?: TimelineItem): number {
  const endMs = getScheduleWindowEndMs(item)
  if (endMs === null) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(0, endMs - getServerNowMs(item))
}

export class TimelineScheduler extends EventEmitter {
  private currentItem?: ScheduledItem
  private nextItem?: ScheduledItem
  private timer?: NodeJS.Timeout
  private transitionTimer?: NodeJS.Timeout
  private activeItems: TimelineItem[] = []
  private startTime: number = 0
  private isPaused = false
  private jitterLog: number[] = []
  private maxJitterLogSize = 100

  /**
   * Start timeline with items
   */
  start(items: TimelineItem[]): void {
    if (items.length === 0) {
      logger.warn('Cannot start timeline with empty items')
      return
    }

    this.clearScheduledTimers()
    this.activeItems = items
    logger.info({ itemCount: items.length }, 'Starting timeline')

    this.startTime = Date.now()
    const resumeDecision = this.resolveInitialResumeDecision(items)
    this.scheduleNext(items, resumeDecision.index, resumeDecision)
  }

  /**
   * Schedule next item
   */
  private scheduleNext(items: TimelineItem[], index: number, resumeDecision?: PlaybackResumeDecision): void {
    if (this.isPaused) {
      return
    }

    if (index >= items.length) {
      const repeatable = shouldRepeatScheduledItem(items.length, items[0])
      const willRepeat = repeatable && isScheduleWindowActive(items[0])
      this.emit('timeline-complete', {
        willRepeat,
        authorityEnded: repeatable && !willRepeat,
      } satisfies TimelineCompletion)
      if (willRepeat) {
        // Loop back to start
        logger.debug('Timeline completed, looping')
        this.start(items)
      } else {
        logger.debug('Timeline completed without looping')
      }
      return
    }

    const item = items[index]
    if (!item) {
      logger.error({ index, itemsLength: items.length }, 'Item not found at index')
      return
    }

    const scheduleWindowRemainingMs = resolveScheduleWindowRemainingMs(item)
    if (scheduleWindowRemainingMs <= 0) {
      this.emit('timeline-complete', {
        willRepeat: false,
        authorityEnded: true,
      } satisfies TimelineCompletion)
      return
    }

    const now = Date.now()
    const startTime = now
    const durationMs = Math.max(1, item.displayMs)
    const isSingleContinuousLoop = items.length === 1 && item.loop === true && resumeDecision?.completed !== true
    const itemDurationMs = isSingleContinuousLoop
      ? resolveSingleLoopHoldMs(item)
      : resumeDecision
        ? resumeDecision.completed
          ? 0
          : Math.max(0, resumeDecision.remainingMs)
        : durationMs
    const scheduledDurationMs = Math.min(itemDurationMs, scheduleWindowRemainingMs)
    const authorityEndsAtCompletion = Number.isFinite(scheduleWindowRemainingMs) && scheduleWindowRemainingMs <= itemDurationMs
    const endTime = startTime + scheduledDurationMs

    const scheduledItem: ScheduledItem = {
      item,
      startTime,
      endTime,
      index,
      resumeDecision,
    }

    // Set as current item
    this.currentItem = scheduledItem

    // Prepare next item
    if (!authorityEndsAtCompletion && index + 1 < items.length) {
      const nextItem = items[index + 1]
      if (nextItem) {
        this.nextItem = {
          item: nextItem,
          startTime: endTime,
          endTime: endTime + Math.max(1, nextItem.displayMs),
          index: index + 1,
        }
      } else {
        this.nextItem = undefined
      }
    } else {
      this.nextItem = undefined
    }

    // Emit play event
    const actualStartTime = Date.now()
    const jitter = actualStartTime - startTime
    this.recordJitter(jitter)

    logger.debug(
      {
        itemId: item.id,
        index,
        displayMs: item.displayMs,
        scheduledDurationMs,
        resumeSource: resumeDecision?.source,
        resumeSeekMs: resumeDecision?.seekMs,
        resumeCompleted: resumeDecision?.completed,
        jitter,
      },
      'Playing item'
    )

    this.emit('play-item', scheduledItem)

    // A single loop-enabled occurrence is owned by the browser's native loop
    // flag. With no explicit schedule end it remains mounted until a higher
    // authority stops/replaces the timeline; do not remount it every displayMs.
    if (!Number.isFinite(scheduledDurationMs)) {
      return
    }

    // Schedule transition to next item
    const transitionTime = scheduledDurationMs - (item.transitionDurationMs || 0)

    // Schedule transition start
    if (!authorityEndsAtCompletion && item.transitionDurationMs && item.transitionDurationMs > 0) {
      this.transitionTimer = setTimeout(() => {
        this.transitionTimer = undefined
        if (!this.isPaused && this.currentItem === scheduledItem) {
          this.emit('transition-start', scheduledItem, this.nextItem)
        }
      }, Math.max(0, transitionTime))
    }

    // Schedule next item
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (!this.isPaused) {
        this.emit('item-complete', scheduledItem)
        if (authorityEndsAtCompletion) {
          this.emit('timeline-complete', {
            willRepeat: false,
            authorityEnded: true,
          } satisfies TimelineCompletion)
        } else {
          this.scheduleNext(items, index + 1)
        }
      }
    }, Math.max(0, scheduledDurationMs))
  }

  private resolveInitialResumeDecision(items: TimelineItem[]): PlaybackResumeDecision {
    const first = items[0]
    if (!first || first.type === 'scene') {
      return resolveScheduledResumePosition({ items })
    }

    const startsAt = typeof first.meta?.['scheduleWindowStartsAt'] === 'string'
      ? String(first.meta['scheduleWindowStartsAt'])
      : undefined
    const serverTimeOffsetMs = Number(first.meta?.['serverTimeOffsetMs'])

    return resolveScheduledResumePosition({
      items,
      startsAt,
      serverTimeOffsetMs: Number.isFinite(serverTimeOffsetMs) ? serverTimeOffsetMs : 0,
    })
  }

  /**
   * Record jitter for monitoring
   */
  private recordJitter(jitter: number): void {
    this.jitterLog.push(Math.abs(jitter))

    if (this.jitterLog.length > this.maxJitterLogSize) {
      this.jitterLog.shift()
    }

    // Log warning if jitter exceeds threshold
    if (Math.abs(jitter) > 100) {
      logger.warn({ jitter }, 'Timeline jitter exceeded 100ms threshold')
    }
  }

  /**
   * Get jitter statistics
   */
  getJitterStats(): { mean: number; p95: number; p99: number; max: number } {
    if (this.jitterLog.length === 0) {
      return { mean: 0, p95: 0, p99: 0, max: 0 }
    }

    const sorted = [...this.jitterLog].sort((a, b) => a - b)
    const sum = sorted.reduce((acc, val) => acc + val, 0)
    const mean = sum / sorted.length

    const p95Index = Math.floor(sorted.length * 0.95)
    const p99Index = Math.floor(sorted.length * 0.99)

    return {
      mean: Math.round(mean * 100) / 100,
      p95: sorted[p95Index] || 0,
      p99: sorted[p99Index] || 0,
      max: sorted[sorted.length - 1] || 0,
    }
  }

  /**
   * Pause timeline
   */
  pause(): void {
    if (this.isPaused) {
      return
    }

    logger.info('Pausing timeline')
    this.isPaused = true

    this.clearScheduledTimers()

    this.emit('paused')
  }

  /**
   * Resume timeline
   */
  resume(): void {
    if (!this.isPaused) {
      return
    }

    logger.info('Resuming timeline')
    this.isPaused = false
    this.emit('resumed')

    const scheduledItem = this.currentItem
    if (!scheduledItem || !Number.isFinite(scheduledItem.endTime)) {
      return
    }

    const remaining = Math.max(0, scheduledItem.endTime - Date.now())
    const transitionDurationMs = scheduledItem.item.transitionDurationMs || 0
    const transitionRemaining = remaining - transitionDurationMs
    if (transitionDurationMs > 0 && this.nextItem) {
      this.transitionTimer = setTimeout(() => {
        this.transitionTimer = undefined
        if (!this.isPaused && this.currentItem === scheduledItem) {
          this.emit('transition-start', scheduledItem, this.nextItem)
        }
      }, Math.max(0, transitionRemaining))
    }

    this.timer = setTimeout(() => {
      this.timer = undefined
      if (!this.isPaused && this.currentItem === scheduledItem) {
        this.emit('item-complete', scheduledItem)
        this.scheduleNext(this.activeItems, scheduledItem.index + 1)
      }
    }, remaining)
  }

  /**
   * Stop timeline
   */
  stop(): void {
    logger.info('Stopping timeline')

    this.clearScheduledTimers()

    this.isPaused = false
    this.currentItem = undefined
    this.nextItem = undefined
    this.activeItems = []

    this.emit('stopped')
  }

  /**
   * Skip to next item
   */
  skipToNext(): void {
    if (!this.currentItem) {
      return
    }

    logger.info({ currentIndex: this.currentItem.index }, 'Skipping to next item')

    this.clearScheduledTimers()

    this.emit('item-complete', this.currentItem)
    this.scheduleNext(this.activeItems, this.currentItem.index + 1)
  }

  /**
   * Get current item
   */
  getCurrentItem(): ScheduledItem | undefined {
    return this.currentItem
  }

  /**
   * Get next item
   */
  getNextItem(): ScheduledItem | undefined {
    return this.nextItem
  }

  /**
   * Check if paused
   */
  isPausedState(): boolean {
    return this.isPaused
  }

  private clearScheduledTimers(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer)
      this.transitionTimer = undefined
    }
  }

  /**
   * Get elapsed time since start
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime
  }
}
