/**
 * Preload script - IPC bridge between main and renderer
 * Exposes safe APIs to renderer via contextBridge
 */

import { contextBridge, ipcRenderer } from 'electron'
import type {
  ActiveSlotPlayback,
  AppConfig,
  HealthStatus,
  DiagnosticsInfo,
  DefaultMediaResponse,
  PairingCodeRequest,
  PairingCodeResponse,
  PairingResponse,
  PairingStatusResponse,
  PlayerPresentationSnapshot,
  WebpageViewRequest,
  WebpageViewStatus,
} from '../common/types'
import type { PlaybackProgressEntry, PlaybackProgressIdentity } from '../common/playback-policy'

// Define the API that will be exposed to the renderer
export interface DarshanAPI {
  // Playback
  onPlaybackUpdate: (callback: (data: unknown) => void) => void
  onMediaChange: (callback: (data: unknown) => void) => void
  onEmergencyOverride: (callback: (data: unknown) => void) => void
  onPlayerStatus: (callback: (data: unknown) => void) => void
  onPlayerPresentation: (callback: (data: PlayerPresentationSnapshot) => void) => () => void

  // Pairing
  submitPairingCode: (code: string) => Promise<PairingResponse>
  getPairingStatus: () => Promise<PairingStatusResponse>
  requestPairingCode: (payload?: Partial<PairingCodeRequest>) => Promise<PairingCodeResponse>
  completePairing: (code?: string) => Promise<PairingResponse>
  playerAction: (
    action: 'retry-recovery' | 're-pair' | 'reset-doubtful-pairing' | 'refresh-pairing',
    payload?: Partial<PairingCodeRequest>
  ) => Promise<unknown>
  getDeviceInfo: () => Promise<unknown>

  // Diagnostics
  getDiagnostics: () => Promise<DiagnosticsInfo>
  toggleDiagnostics: () => Promise<void>

  // Health
  getHealth: () => Promise<HealthStatus>
  getPlayerStatus: () => Promise<unknown>
  getPlayerPresentation: () => Promise<PlayerPresentationSnapshot>

  // Default media
  getDefaultMedia: (options?: { refresh?: boolean }) => Promise<DefaultMediaResponse>
  onDefaultMediaChanged: (callback: (data: DefaultMediaResponse) => void) => () => void

  // Commands
  executeCommand: (command: string, payload?: unknown) => Promise<unknown>
  reportActivePlayback: (payload: { sceneId?: string; activeSlots: ActiveSlotPlayback[] }) => void
  reportPlaybackProgress: (payload: PlaybackProgressEntry) => void
  reportViewport: (payload: {
    width_css_px: number
    height_css_px: number
    device_pixel_ratio: number
    density: 'FULL' | 'COMPACT' | 'MINIMAL'
    conformant: boolean
    omitted_regions: string[]
  }) => void
  getPlaybackResumeState: (expected?: PlaybackProgressIdentity) => Promise<PlaybackProgressEntry | null>

  // Configuration
  getConfig: () => Promise<AppConfig>
  setConfig: (updates: Partial<AppConfig>) => Promise<AppConfig>
  onConfigChanged: (callback: (config: AppConfig) => void) => () => void
  updateConfig?: (updates: Partial<AppConfig>) => Promise<AppConfig>

  // Logs
  log: (level: string, message: string, data?: unknown) => void

  // Media
  readPdfData: (source: string) => Promise<ArrayBuffer>
  mountWebpageView: (request: WebpageViewRequest) => Promise<{ accepted: boolean; reason?: string }>
  updateWebpageView: (request: WebpageViewRequest) => Promise<{ accepted: boolean; reason?: string }>
  destroyWebpageView: (id: string, generation: number) => void
  onWebpageViewStatus: (callback: (status: WebpageViewStatus) => void) => () => void
}

const darshanApi: DarshanAPI = {
  // Playback events
  onPlaybackUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on('playback-update', (_event, data) => callback(data))
  },

  onMediaChange: (callback: (data: unknown) => void) => {
    ipcRenderer.on('media-change', (_event, data) => callback(data))
  },

  onEmergencyOverride: (callback: (data: unknown) => void) => {
    ipcRenderer.on('emergency-override', (_event, data) => callback(data))
  },

  onPlayerStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on('player-status', (_event, data) => callback(data))
  },

  onPlayerPresentation: (callback: (data: PlayerPresentationSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: PlayerPresentationSnapshot) => callback(data)
    ipcRenderer.on('player-presentation', listener)
    return () => ipcRenderer.removeListener('player-presentation', listener)
  },

  // Pairing
  submitPairingCode: async (code: string): Promise<PairingResponse> => {
    return await ipcRenderer.invoke('pairing-complete', code)
  },

  getPairingStatus: async (): Promise<PairingStatusResponse> => {
    return await ipcRenderer.invoke('pairing-status')
  },

  requestPairingCode: async (payload?: Partial<PairingCodeRequest>): Promise<PairingCodeResponse> => {
    return await ipcRenderer.invoke('pairing-request', payload)
  },

  completePairing: async (code?: string): Promise<PairingResponse> => {
    return await ipcRenderer.invoke('pairing-complete', code)
  },

  playerAction: async (
    action: 'retry-recovery' | 're-pair' | 'reset-doubtful-pairing' | 'refresh-pairing',
    payload?: Partial<PairingCodeRequest>
  ): Promise<unknown> => {
    return await ipcRenderer.invoke('player-action', action, payload)
  },

  getDeviceInfo: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('get-device-info')
  },

  // Diagnostics
  getDiagnostics: async (): Promise<DiagnosticsInfo> => {
    return await ipcRenderer.invoke('get-diagnostics')
  },

  toggleDiagnostics: async (): Promise<void> => {
    return await ipcRenderer.invoke('toggle-diagnostics')
  },

  // Health
  getHealth: async (): Promise<HealthStatus> => {
    return await ipcRenderer.invoke('get-health')
  },

  getPlayerStatus: async (): Promise<unknown> => {
    return await ipcRenderer.invoke('get-player-status')
  },

  getPlayerPresentation: async (): Promise<PlayerPresentationSnapshot> => {
    return await ipcRenderer.invoke('get-player-presentation')
  },

  // Default media
  getDefaultMedia: async (options?: { refresh?: boolean }): Promise<DefaultMediaResponse> => {
    return await ipcRenderer.invoke('default-media:get', options)
  },

  onDefaultMediaChanged: (callback: (data: DefaultMediaResponse) => void) => {
    const listener = (_event: any, data: DefaultMediaResponse) => callback(data)
    ipcRenderer.on('default-media:changed', listener)
    return () => {
      ipcRenderer.removeListener('default-media:changed', listener)
    }
  },

  // Commands
  executeCommand: async (command: string, payload?: unknown): Promise<unknown> => {
    return await ipcRenderer.invoke('execute-command', command, payload)
  },

  reportActivePlayback: (payload: { sceneId?: string; activeSlots: ActiveSlotPlayback[] }): void => {
    ipcRenderer.send('player-active-playback', payload)
  },

  reportPlaybackProgress: (payload: PlaybackProgressEntry): void => {
    ipcRenderer.send('player-playback-progress', payload)
  },

  reportViewport: (payload): void => {
    ipcRenderer.send('player-viewport', payload)
  },

  getPlaybackResumeState: async (expected?: PlaybackProgressIdentity): Promise<PlaybackProgressEntry | null> => {
    return await ipcRenderer.invoke('player-playback-resume-state', expected)
  },

  // Configuration
  getConfig: async (): Promise<AppConfig> => {
    return await ipcRenderer.invoke('config:get')
  },

  setConfig: async (updates: Partial<AppConfig>): Promise<AppConfig> => {
    return await ipcRenderer.invoke('config:set', updates)
  },

  onConfigChanged: (callback: (config: AppConfig) => void) => {
    const listener = (_event: any, data: AppConfig) => callback(data)
    ipcRenderer.on('config:changed', listener)
    return () => ipcRenderer.removeListener('config:changed', listener)
  },

  // Backwards compatibility
  updateConfig: async (updates: Partial<AppConfig>): Promise<AppConfig> => {
    return await ipcRenderer.invoke('config:set', updates)
  },

  // Logging
  log: (level: string, message: string, data?: unknown): void => {
    ipcRenderer.send('renderer-log', { level, message, data })
  },

  // Media
  readPdfData: async (source: string): Promise<ArrayBuffer> => {
    return await ipcRenderer.invoke('media:read-pdf', source)
  },

  mountWebpageView: async (request) => await ipcRenderer.invoke('webpage-view:mount', request),
  updateWebpageView: async (request) => await ipcRenderer.invoke('webpage-view:update', request),
  destroyWebpageView: (id, generation) => ipcRenderer.send('webpage-view:destroy', id, generation),
  onWebpageViewStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: WebpageViewStatus) => callback(status)
    ipcRenderer.on('webpage-view:status', listener)
    return () => ipcRenderer.removeListener('webpage-view:status', listener)
  },
}

// Expose the API to the renderer process. Keep `hexmon` as a one-release
// compatibility alias for existing renderer integrations.
contextBridge.exposeInMainWorld('darshan', darshanApi)
contextBridge.exposeInMainWorld('hexmon', darshanApi)

// Expose version info
contextBridge.exposeInMainWorld('versions', {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron,
})

// Log that preload script loaded
console.log('Preload script loaded successfully')
