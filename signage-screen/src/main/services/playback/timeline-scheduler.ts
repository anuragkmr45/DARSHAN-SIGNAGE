/**
 * Timeline Scheduler - Precise timing control for media playback
 * Target: Timeline jitter ≤100ms p95
 */

import { EventEmitter } from 'events'
import { getLogger } from '../../../common/logger'
import { TimelineItem } from '../../../common/types'

const logger = getLogger('timeline-scheduler')

export interface ScheduledItem {
  item: TimelineItem
  startTime: number
  endTime: number
  index: number
}

export class TimelineScheduler extends EventEmitter {
  private currentItem?: ScheduledItem
  private nextItem?: ScheduledItem
  private timer?: NodeJS.Timeout
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

    logger.info({ itemCount: items.length }, 'Starting timeline')

    this.startTime = Date.now()
    this.scheduleNext(items, 0)
  }

  /**
   * Schedule next item
   */
  private scheduleNext(items: TimelineItem[], index: number): void {
    if (this.isPaused) {
      return
    }

    if (index >= items.length) {
      // Loop back to start
      logger.debug('Timeline completed, looping')
      this.emit('timeline-complete')
      this.start(items)
      return
    }

    const item = items[index]
    if (!item) {
      logger.error({ index, itemsLength: items.length }, 'Item not found at index')
      return
    }

    const now = Date.now()
    const startTime = now
    const endTime = startTime + item.displayMs

    const scheduledItem: ScheduledItem = {
      item,
      startTime,
      endTime,
      index,
    }

    // Set as current item
    this.currentItem = scheduledItem

    // Prepare next item
    if (index + 1 < items.length) {
      const nextItem = items[index + 1]
      if (nextItem) {
        this.nextItem = {
          item: nextItem,
          startTime: endTime,
          endTime: endTime + nextItem.displayMs,
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
        jitter,
      },
      'Playing item'
    )

    this.emit('play-item', scheduledItem)

    // Schedule transition to next item
    const transitionTime = item.displayMs - (item.transitionDurationMs || 0)

    // Schedule transition start
    if (item.transitionDurationMs && item.transitionDurationMs > 0) {
      setTimeout(() => {
        if (!this.isPaused && this.currentItem === scheduledItem) {
          this.emit('transition-start', scheduledItem, this.nextItem)
        }
      }, transitionTime)
    }

    // Schedule next item
    this.timer = setTimeout(() => {
      if (!this.isPaused) {
        this.emit('item-complete', scheduledItem)
        this.scheduleNext(items, index + 1)
      }
    }, item.displayMs)
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

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

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

    // Resume from current position
    if (this.currentItem) {
      const now = Date.now()
      const elapsed = now - this.currentItem.startTime
      const remaining = this.currentItem.item.displayMs - elapsed

      if (remaining > 0) {
        this.timer = setTimeout(() => {
          if (!this.isPaused && this.currentItem) {
            this.emit('item-complete', this.currentItem)
            // Continue with next item
            // Note: This is simplified - in production you'd need to track the full timeline
          }
        }, remaining)
      }
    }
  }

  /**
   * Stop timeline
   */
  stop(): void {
    logger.info('Stopping timeline')

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    this.isPaused = false
    this.currentItem = undefined
    this.nextItem = undefined

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

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    this.emit('item-complete', this.currentItem)
    // Note: This is simplified - in production you'd need to track the full timeline
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

  /**
   * Get elapsed time since start
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime
  }
}

