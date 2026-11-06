import type { PlayerPresentationSnapshot } from '../common/types'

interface RendererPlaybackHandshakeAPI {
  getPlayerPresentation: () => Promise<PlayerPresentationSnapshot>
  restoreCurrentPlayback: () => Promise<boolean>
}

/**
 * Restore the active timeline item only after the renderer has applied its
 * lifecycle snapshot. The media listener is registered before this handshake,
 * so the main process can safely re-send an item emitted during startup.
 */
export async function synchronizeCurrentPlayback(
  api: RendererPlaybackHandshakeAPI,
  applyPresentation: (presentation: PlayerPresentationSnapshot) => void,
): Promise<boolean> {
  const presentation = await api.getPlayerPresentation()
  applyPresentation(presentation)
  return api.restoreCurrentPlayback()
}
