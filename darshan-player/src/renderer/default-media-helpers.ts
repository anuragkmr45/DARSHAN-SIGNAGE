import type { DefaultMediaItem } from '../common/types'

export function resolveDefaultMediaSource(media: DefaultMediaItem): string | undefined {
  return media.local_url || media.fallback_media_url || media.media_url
}

export type DisposableDefaultMediaNode = {
  __darshanCleanup?: () => void
  pause?: () => void
  removeAttribute?: (name: string) => void
  load?: () => void
  stop?: () => void
  querySelectorAll?: (selector: string) => ArrayLike<DisposableDefaultMediaNode>
  parentElement?: { removeChild?: (child: DisposableDefaultMediaNode) => void } | null
  remove?: () => void
  src?: string
}

function teardownDefaultMediaNode(node: DisposableDefaultMediaNode | null | undefined): void {
  if (!node) {
    return
  }

  try {
    node.pause?.()
  } catch {
    // ignore inert teardown failures
  }

  try {
    node.removeAttribute?.('src')
  } catch {
    // ignore inert teardown failures
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
    // ignore inert teardown failures
  }

  try {
    node.stop?.()
  } catch {
    // ignore inert teardown failures
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
    // ignore inert teardown failures
  }
}

export function teardownDefaultMediaElementTree(root: DisposableDefaultMediaNode | null | undefined): void {
  if (!root) {
    return
  }

  try {
    root.__darshanCleanup?.()
  } catch {
    // ignore inert teardown failures
  }

  const descendants =
    typeof root.querySelectorAll === 'function'
      ? Array.from(root.querySelectorAll('video, audio, iframe, webview'))
      : []

  descendants.forEach((node) => teardownDefaultMediaNode(node))
  teardownDefaultMediaNode(root)
}
