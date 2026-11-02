import { app, BrowserWindow, ipcMain, powerMonitor, session } from 'electron'
import * as path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import type { LivePrototypeGrant, LivePrototypeObservation } from '../../common/live-prototype'
import { assertLivePrototypeMode, loadLivePrototypeConfig, preparePrototypeProfile } from './config'
import { createAuthorityRequest, LivePrototypeAuthority } from './authority'
import { capturePrototypeEvidence } from './evidence'

export async function startLivePrototype(configPath: string): Promise<void> {
  assertLivePrototypeMode(process.env['DARSHAN_RUNTIME_MODE'])
  const config = loadLivePrototypeConfig(configPath)
  const profile = preparePrototypeProfile(config.receiver_session_id)
  app.setPath('userData', profile)
  app.commandLine.appendSwitch('disable-http-cache')
  if (!app.requestSingleInstanceLock()) { app.exit(1); return }
  await app.whenReady()

  const rendererRoot = path.resolve(__dirname, '../../../renderer')
  const preload = path.join(__dirname, 'preload.js')
  const shell = new BrowserWindow({
    width: 960, height: 640, title: 'DARSHAN Live Prototype — fallback',
    webPreferences: { preload, partition: `live-prototype-shell-${config.receiver_session_id}`, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true },
  })
  shell.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  shell.webContents.session.setPermissionCheckHandler(() => false)
  shell.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shell.webContents.on('will-navigate', (event) => event.preventDefault())
  let live: BrowserWindow | undefined
  let liveGrant: LivePrototypeGrant | undefined
  let reason = 'Content unavailable — awaiting live authority'
  let rendererGeneration = 0
  let frameWarning: NodeJS.Timeout | undefined
  let shellReady = false
  let evidenceBusy = false
  let evidenceCount = 0
  let pendingEvidence: { window: BrowserWindow; event: 'first-frame' | 'fallback'; generation: number } | undefined
  const fallbackUrl = config.fallback_path ? pathToFileURL(config.fallback_path).toString() : undefined
  const log = (event: string, grant?: LivePrototypeGrant): void => {
    console.log(JSON.stringify({ component: 'live-prototype', event, at: new Date().toISOString(),
      ...(grant ? { run_id: grant.run_id, generation: grant.generation, admission_id: grant.admission_id } : {}) }))
  }
  const captureEvidence = (window: BrowserWindow, event: 'first-frame' | 'fallback', generation: number): void => {
    if (!config.evidence_dir || evidenceCount >= 120) return
    if (evidenceBusy) { pendingEvidence = { window, event, generation }; return }
    evidenceBusy = true
    // Allow the renderer's IPC state update and compositor to paint before
    // capturing actual pixels. Never capture a superseded playback surface.
    void new Promise<void>(resolve => setTimeout(resolve, 250)).then(() => capturePrototypeEvidence(
      config.evidence_dir, event,
      async () => (await window.webContents.capturePage()).toPNG(),
      () => generation === rendererGeneration && !window.isDestroyed() &&
        (event === 'first-frame' ? live === window && Boolean(liveGrant && authority.isAuthorized(liveGrant)) : shellReady && (!live || !live.isVisible())),
    )).then(file => { if (file) { evidenceCount += 1; log(`evidence-${event}-saved`) } })
      .catch(() => log('evidence-unavailable')).finally(() => {
        evidenceBusy = false
        const pending = pendingEvidence
        pendingEvidence = undefined
        if (pending) captureEvidence(pending.window, pending.event, pending.generation)
      })
  }
  const showFallback = (message: string): void => {
    const changed = message !== reason || Boolean(live)
    rendererGeneration += 1
    reason = message
    const previous = live
    live = undefined
    liveGrant = undefined
    if (frameWarning) clearTimeout(frameWarning)
    frameWarning = undefined
    if (previous && !previous.isDestroyed()) previous.destroy()
    if (!shell.isDestroyed()) shell.webContents.send('live-prototype:state', { reason, fallback_url: fallbackUrl })
    log('fallback')
    if (changed && shellReady) captureEvidence(shell, 'fallback', rendererGeneration)
  }

  const authority = new LivePrototypeAuthority({
    request: createAuthorityRequest(config),
    onUnavailable: showFallback,
    onGrant: (grant) => {
      showFallback('Content unavailable — connecting live video')
      const generation = rendererGeneration
      liveGrant = grant
      const isolatedSession = session.fromPartition(`live-prototype-track-${config.receiver_session_id}-${generation}`)
      isolatedSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      isolatedSession.setPermissionCheckHandler(() => false)
      const signalOrigin = new URL(grant.signal_url).origin
      const httpOrigin = signalOrigin.replace(/^ws/, 'http')
      isolatedSession.webRequest.onBeforeRequest((details, callback) => {
        try {
          const url = new URL(details.url)
          const allowed = url.protocol === 'file:'
            ? [path.join(rendererRoot, 'live-prototype.html'), path.join(rendererRoot, 'live-prototype.bundle.js')].includes(fileURLToPath(url))
            : [signalOrigin, httpOrigin].includes(url.origin)
          callback({ cancel: !allowed })
        } catch { callback({ cancel: true }) }
      })
      const view = new BrowserWindow({
        parent: shell, x: shell.getBounds().x, y: shell.getBounds().y, width: shell.getBounds().width,
        height: shell.getBounds().height, show: false, title: 'DARSHAN Live Prototype — receiving',
        webPreferences: { preload, session: isolatedSession, nodeIntegration: false, contextIsolation: true,
          sandbox: true, webSecurity: true, backgroundThrottling: false },
      })
      live = view
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', (event) => event.preventDefault())
      const failed = (): void => {
        if (live === view && generation === rendererGeneration) authority.requestReconnect('Content unavailable — receiver interrupted')
      }
      view.on('unresponsive', failed)
      view.webContents.on('render-process-gone', failed)
      view.webContents.on('did-fail-load', failed)
      view.on('closed', () => { if (live === view) failed() })
      void view.loadFile(path.join(rendererRoot, 'live-prototype.html')).catch(failed)
      log('admitted', grant)
      frameWarning = setTimeout(() => {
        if (live === view && generation === rendererGeneration) log('awaiting-first-frame', grant)
      }, 5000)
    },
  })

  ipcMain.handle('live-prototype:state', (event) => event.sender.id === shell.webContents.id ? { reason, fallback_url: fallbackUrl } : null)
  ipcMain.handle('live-prototype:grant', (event) => {
    if (!live || live.isDestroyed() || event.sender.id !== live.webContents.id || !liveGrant || !authority.isAuthorized(liveGrant)) return null
    return liveGrant
  })
  ipcMain.on('live-prototype:observation', (event, value: LivePrototypeObservation) => {
    if (!live || live.isDestroyed() || event.sender.id !== live.webContents.id || !liveGrant ||
        !value || typeof value !== 'object' || value.run_id !== liveGrant.run_id || value.generation !== liveGrant.generation ||
        !authority.isAuthorized(liveGrant) || !['connected', 'first-frame', 'audio-playing', 'audio-unavailable', 'disconnected', 'failed'].includes(value.kind)) return
    log(value.kind, liveGrant)
    if (value.kind === 'first-frame') {
      if (frameWarning) clearTimeout(frameWarning)
      frameWarning = undefined
      live.show()
      captureEvidence(live, 'first-frame', rendererGeneration)
    }
    if (value.kind === 'disconnected' || value.kind === 'failed') authority.requestReconnect()
  })
  powerMonitor.on('suspend', () => authority.suspend())
  powerMonitor.on('resume', () => authority.resume())
  shell.on('closed', () => { authority.stop(); app.quit() })
  app.on('before-quit', () => authority.stop())
  await shell.loadFile(path.join(rendererRoot, 'live-prototype-shell.html'))
  shellReady = true
  authority.start()
}
