/**
 * Transition Manager - GPU-accelerated transitions between media items
 * Supports fade in/out transitions with configurable duration
 */

import { getLogger } from '../../../common/logger'

const logger = getLogger('transition-manager')

export type TransitionType = 'fade' | 'none'

export interface TransitionConfig {
  type: TransitionType
  durationMs: number
}

// Use any for DOM elements since this runs in main process but manipulates renderer elements
type DOMElement = any

export class TransitionManager {
  private currentTransition?: {
    type: TransitionType
    startTime: number
    durationMs: number
    fromElement?: DOMElement
    toElement?: DOMElement
  }

  /**
   * Start transition between two elements
   */
  startTransition(
    fromElement: DOMElement | undefined,
    toElement: DOMElement,
    config: TransitionConfig
  ): Promise<void> {
    return new Promise((resolve) => {
      if (config.type === 'none' || config.durationMs === 0) {
        // No transition, instant switch
        if (fromElement) {
          fromElement.style.opacity = '0'
          fromElement.style.display = 'none'
        }
        toElement.style.opacity = '1'
        toElement.style.display = 'block'
        resolve()
        return
      }

      logger.debug({ type: config.type, durationMs: config.durationMs }, 'Starting transition')

      this.currentTransition = {
        type: config.type,
        startTime: Date.now(),
        durationMs: config.durationMs,
        fromElement,
        toElement,
      }

      // Apply transition based on type
      switch (config.type) {
        case 'fade':
          this.applyFadeTransition(fromElement, toElement, config.durationMs, resolve)
          break
        default:
          logger.warn({ type: config.type }, 'Unknown transition type')
          resolve()
      }
    })
  }

  /**
   * Apply fade transition
   */
  private applyFadeTransition(
    fromElement: DOMElement | undefined,
    toElement: DOMElement,
    durationMs: number,
    onComplete: () => void
  ): void {
    // Prepare elements
    toElement.style.opacity = '0'
    toElement.style.display = 'block'
    toElement.style.transition = `opacity ${durationMs}ms ease-in-out`

    if (fromElement) {
      fromElement.style.transition = `opacity ${durationMs}ms ease-in-out`
    }

    // Use setTimeout instead of requestAnimationFrame (not available in main process)
    setTimeout(() => {
      // Fade out old element
      if (fromElement) {
        fromElement.style.opacity = '0'
      }

      // Fade in new element
      toElement.style.opacity = '1'

      // Wait for transition to complete
      setTimeout(() => {
        if (fromElement) {
          fromElement.style.display = 'none'
          fromElement.style.transition = ''
        }
        toElement.style.transition = ''

        this.currentTransition = undefined
        onComplete()
      }, durationMs)
    })
  }

  /**
   * Cancel current transition
   */
  cancelTransition(): void {
    if (!this.currentTransition) {
      return
    }

    logger.debug('Cancelling transition')

    const { fromElement, toElement } = this.currentTransition

    // Reset transition styles
    if (fromElement) {
      fromElement.style.transition = ''
      fromElement.style.opacity = '0'
      fromElement.style.display = 'none'
    }

    if (toElement) {
      toElement.style.transition = ''
      toElement.style.opacity = '1'
      toElement.style.display = 'block'
    }

    this.currentTransition = undefined
  }

  /**
   * Check if transition is in progress
   */
  isTransitioning(): boolean {
    return this.currentTransition !== undefined
  }

  /**
   * Get transition progress (0-1)
   */
  getTransitionProgress(): number {
    if (!this.currentTransition) {
      return 0
    }

    const elapsed = Date.now() - this.currentTransition.startTime
    const progress = Math.min(elapsed / this.currentTransition.durationMs, 1)

    return progress
  }

  /**
   * Apply CSS for GPU acceleration
   */
  static enableGPUAcceleration(element: DOMElement): void {
    element.style.willChange = 'opacity, transform'
    element.style.transform = 'translateZ(0)'
    element.style.backfaceVisibility = 'hidden'
  }

  /**
   * Remove GPU acceleration CSS
   */
  static disableGPUAcceleration(element: DOMElement): void {
    element.style.willChange = 'auto'
    element.style.transform = ''
    element.style.backfaceVisibility = ''
  }
}

