import type { TimelineItem } from '../common/types'

export function parseAspectRatio(aspectRatio?: string): number | null {
  if (!aspectRatio || typeof aspectRatio !== 'string') {
    return null
  }

  const parts = aspectRatio.split(':')
  if (parts.length !== 2) {
    return null
  }

  const width = Number(parts[0]?.trim())
  const height = Number(parts[1]?.trim())
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return width / height
}

export function computeSceneStageFrame(
  aspectRatio: string | undefined,
  viewportWidth: number,
  viewportHeight: number
): { width: number; height: number; left: number; top: number } {
  const ratio = parseAspectRatio(aspectRatio)
  if (!ratio || viewportWidth <= 0 || viewportHeight <= 0) {
    return {
      width: viewportWidth,
      height: viewportHeight,
      left: 0,
      top: 0,
    }
  }

  const viewportRatio = viewportWidth / viewportHeight
  if (viewportRatio > ratio) {
    const height = viewportHeight
    const width = height * ratio
    return {
      width,
      height,
      left: (viewportWidth - width) / 2,
      top: 0,
    }
  }

  const width = viewportWidth
  const height = width / ratio
  return {
    width,
    height,
    left: 0,
    top: (viewportHeight - height) / 2,
  }
}

export function shouldUseManualVideoReplay(item: TimelineItem): boolean {
  return item.type === 'video' && item.loop === true
}

type TransitionStyleTarget = {
  style: {
    transition: string
    opacity: string
  }
}

export function resolveOpacityTransitionStyle(durationMs?: number): string {
  const safeDuration = Math.max(0, Number(durationMs) || 0)
  if (safeDuration <= 0) {
    return ''
  }

  return `opacity ${safeDuration}ms ease-in-out`
}

export function prepareElementForFadeIn(element: TransitionStyleTarget, durationMs?: number): boolean {
  const transitionStyle = resolveOpacityTransitionStyle(durationMs)
  element.style.transition = transitionStyle
  if (!transitionStyle) {
    element.style.opacity = '1'
    return false
  }

  element.style.opacity = '0'
  return true
}

export function prepareElementForFadeOut(element: TransitionStyleTarget, durationMs?: number): void {
  element.style.transition = resolveOpacityTransitionStyle(durationMs)
  element.style.opacity = '0'
}

export type DisposableMediaNode = {
  __darshanCleanup?: () => void
  pause?: () => void
  removeAttribute?: (name: string) => void
  load?: () => void
  stop?: () => void
  querySelectorAll?: (selector: string) => ArrayLike<DisposableMediaNode>
  parentElement?: { removeChild?: (child: DisposableMediaNode) => void } | null
  remove?: () => void
  src?: string
}

function teardownDisposableNode(node: DisposableMediaNode | null | undefined): void {
  if (!node) {
    return
  }

  try {
    node.pause?.()
  } catch {
    // ignore teardown errors from inert/fake nodes
  }

  try {
    node.removeAttribute?.('src')
  } catch {
    // ignore teardown errors from inert/fake nodes
  }

  if (typeof node.src === 'string') {
    try {
      node.src = ''
    } catch {
      // ignore read-only src properties
    }
  }

  try {
    node.load?.()
  } catch {
    // ignore teardown errors from inert/fake nodes
  }

  try {
    node.stop?.()
  } catch {
    // ignore teardown errors from inert/fake nodes
  }

  if (node.parentElement?.removeChild) {
    try {
      node.parentElement.removeChild(node)
      return
    } catch {
      // fall back to remove()
    }
  }

  try {
    node.remove?.()
  } catch {
    // ignore teardown errors from inert/fake nodes
  }
}

export function teardownScheduledElementTree(root: DisposableMediaNode | null | undefined): void {
  if (!root) {
    return
  }

  try {
    root.__darshanCleanup?.()
  } catch {
    // ignore teardown errors from managed nodes
  }

  const descendants =
    typeof root.querySelectorAll === 'function'
      ? Array.from(root.querySelectorAll('video, audio, iframe, webview'))
      : []

  descendants.forEach((node) => teardownDisposableNode(node))
  teardownDisposableNode(root)
}
