import { BrowserWindow, desktopCapturer, screen, type NativeImage, type Rectangle } from 'electron'

const COMPOSITOR_SETTLE_MS = 250

type WindowsCaptureDependencies = {
  getDisplayMatching: (bounds: Rectangle) => ReturnType<typeof screen.getDisplayMatching>
  getSources: (options: Parameters<typeof desktopCapturer.getSources>[0]) => ReturnType<typeof desktopCapturer.getSources>
  settle: () => Promise<void>
}

function scaleToThumbnail(bounds: Rectangle, displayBounds: Rectangle, thumbnail: NativeImage): Rectangle | undefined {
  const left = Math.max(bounds.x, displayBounds.x)
  const top = Math.max(bounds.y, displayBounds.y)
  const right = Math.min(bounds.x + bounds.width, displayBounds.x + displayBounds.width)
  const bottom = Math.min(bounds.y + bounds.height, displayBounds.y + displayBounds.height)
  if (right <= left || bottom <= top) return undefined

  const thumbnailSize = thumbnail.getSize()
  const scaleX = thumbnailSize.width / displayBounds.width
  const scaleY = thumbnailSize.height / displayBounds.height
  const x = Math.max(0, Math.round((left - displayBounds.x) * scaleX))
  const y = Math.max(0, Math.round((top - displayBounds.y) * scaleY))
  return {
    x,
    y,
    width: Math.min(thumbnailSize.width - x, Math.max(1, Math.round((right - left) * scaleX))),
    height: Math.min(thumbnailSize.height - y, Math.max(1, Math.round((bottom - top) * scaleY))),
  }
}

/** Capture the composed Windows player window, including accelerated canvases. */
export async function captureWindowsBrowserWindow(window: BrowserWindow): Promise<NativeImage | undefined> {
  return await captureWindowsBrowserWindowWith(window, {
    getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
    getSources: (options) => desktopCapturer.getSources(options),
    settle: async () => await new Promise((resolve) => setTimeout(resolve, COMPOSITOR_SETTLE_MS)),
  })
}

export async function captureWindowsBrowserWindowWith(
  window: BrowserWindow,
  dependencies: WindowsCaptureDependencies
): Promise<NativeImage | undefined> {
  if (process.platform !== 'win32' || window.isDestroyed() || window.webContents.isDestroyed()) return undefined

  // Electron currently omits the calling process's BrowserWindow from the
  // Windows window-source list. Temporarily place the kiosk above other apps,
  // capture its display compositor and crop back to the exact window bounds.
  // moveTop() alone is not enough when the CMS/browser owns the foreground.
  const wasAlwaysOnTop = window.isAlwaysOnTop()
  try {
    if (!wasAlwaysOnTop) window.setAlwaysOnTop(true, 'screen-saver')
    window.moveTop()
    window.focus()
    await dependencies.settle()
    if (window.isDestroyed()) return undefined

    const bounds = window.getBounds()
    const display = dependencies.getDisplayMatching(bounds)
    const requestedSize = {
      width: Math.max(1, Math.round(display.size.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.size.height * display.scaleFactor)),
    }
    const sources = await dependencies.getSources({
      types: ['screen'],
      thumbnailSize: requestedSize,
      fetchWindowIcons: false,
    })
    const source = sources.find((candidate) => candidate.display_id === String(display.id))
      ?? (sources.length === 1 ? sources[0] : undefined)
    if (!source || source.thumbnail.isEmpty()) return undefined

    const crop = scaleToThumbnail(bounds, display.bounds, source.thumbnail)
    if (!crop) return undefined
    const image = source.thumbnail.crop(crop)
    return image.isEmpty() ? undefined : image
  } finally {
    if (!wasAlwaysOnTop && !window.isDestroyed()) window.setAlwaysOnTop(false)
  }
}
