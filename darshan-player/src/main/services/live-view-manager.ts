import { WebContentsView, session } from 'electron'
import type { BrowserWindow, NativeImage, Session } from 'electron'
import { randomUUID } from 'crypto'
import * as path from 'path'
import { fileURLToPath } from 'url'
import type { LiveAdmissionGrant, LiveReceiverGrant, LiveReceiverLease, LiveReceiverObservation } from '../../common/live-runtime'
import { getConfigManager } from '../../common/config'
import { createLiveCertificateVerifier } from './network/live-session-tls'
import { getLogger } from '../../common/logger'

const KINDS: LiveReceiverObservation['kind'][] = ['connected', 'first-frame', 'audio-ready', 'audio-degraded', 'disconnected', 'failed', 'heartbeat']
const logger = getLogger('live-view-manager')
const STAGES = new Set(['RECEIVER_START', 'GRANT_ACCEPTED', 'SIGNAL_JOINED', 'SIGNAL_CONNECTED', 'ROOM_CONNECTED',
  'SUBSCRIBE_REQUESTED', 'TRACK_PUBLISHED', 'TRACK_SUBSCRIBED', 'FRAME_CALLBACK',
  'VIDEO_PLAY_STARTED', 'VIDEO_PLAY_FAILED', 'VIDEO_LOADED_DATA', 'VIDEO_METADATA', 'VIDEO_PLAYING',
  'VIDEO_WAITING', 'TRACK_UNSUBSCRIBED', 'CONNECT_FAILED'])
type Entry = { view: WebContentsView; grant: LiveReceiverGrant; controller: AbortController; window: BrowserWindow;
  isolated: Session; authorized: () => boolean; remaining: () => number; observation: (value: LiveReceiverObservation) => void; disposed: boolean; delivered: boolean; visible: boolean }
export function isAllowedLiveViewRequest(raw: string, gatewayOrigin: string, rendererRoot: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === 'file:') return !url.search && !url.hash && [path.join(rendererRoot, 'live-receiver.html'), path.join(rendererRoot, 'live-receiver.bundle.js')].includes(fileURLToPath(url))
    const signal = new URL(gatewayOrigin)
    return !url.username && !url.password && !url.hash && [signal.origin, signal.origin.replace(/^ws/, 'http')].includes(url.origin)
  } catch { return false }
}
export class LiveViewManager {
  private entry?: Entry
  constructor(private readonly getWindow: () => BrowserWindow | undefined,
    private readonly dependencies: { createView?: (isolated: Session) => WebContentsView; getSession?: (partition: string) => Session } = {}) {}
  connect(grant: LiveAdmissionGrant, authorized: () => boolean, observation: (value: LiveReceiverObservation) => void, remaining: () => number): void {
    this.destroy()
    const window = this.getWindow()
    if (!window || window.isDestroyed() || !grant.signaling || !authorized()) throw new Error('Live receiver unavailable')
    const rendererRoot = path.resolve(__dirname, '../../../renderer')
    const controller = new AbortController()
    const viewEpoch = randomUUID()
    const signalUrl = grant.signaling.url
    const isolated = this.dependencies.getSession?.(`darshan-live-${viewEpoch}`) ?? session.fromPartition(`darshan-live-${viewEpoch}`)
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    isolated.on('will-download', event => event.preventDefault())
    isolated.setCertificateVerifyProc(createLiveCertificateVerifier(signalUrl, getConfigManager().getConfig().transportTls, controller.signal))
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: controller.signal.aborted || !isAllowedLiveViewRequest(details.url, signalUrl, rendererRoot) }))
    const connectOrigin = `${signalUrl} ${signalUrl.replace(/^ws/, 'http')}`
    isolated.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src ${connectOrigin}; media-src blob:; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`],
    } }))
    const view = this.dependencies.createView?.(isolated) ?? new WebContentsView({ webPreferences: { preload: path.join(__dirname, '../live-receiver-preload.js'),
      session: isolated, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } })
    const receiver: LiveReceiverGrant = { view_epoch: viewEpoch, run_id: grant.run_id, generation: grant.generation,
      admission_id: grant.admission_id, participant_id: grant.participant_id, presenter_participant_id: grant.presenter_participant_id,
      microphone: grant.microphone, screen_share_audio: grant.screen_share_audio, lease_remaining_ms: 0, signaling: { ...grant.signaling } }
    const entry: Entry = { view, grant: receiver, controller, window, isolated, authorized, remaining, observation, disposed: false, delivered: false, visible: false }
    this.entry = entry
    view.setVisible(false)
    view.webContents.setAudioMuted(true)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', event => event.preventDefault())
    view.webContents.on('will-redirect', event => event.preventDefault())
    view.webContents.on('before-input-event', event => event.preventDefault())
    const failed = (): void => {
      if (this.entry === entry && !entry.disposed) {
        logger.warn('Live receiver view failed before a confirmed frame')
        observation({ view_epoch: viewEpoch, kind: 'failed' })
      }
    }
    view.webContents.on('unresponsive', failed)
    view.webContents.on('render-process-gone', failed)
    view.webContents.on('did-fail-load', failed)
    view.webContents.on('console-message', (_event, _level, message: string) => {
      const stage = /^DARSHAN_LIVE_RX_STAGE:([A-Z_]+)$/.exec(message)?.[1]
      if (stage && STAGES.has(stage) && this.entry === entry && !entry.disposed) logger.info({ stage }, 'Live receiver stage')
    })
    window.contentView.addChildView(view)
    this.resize()
    logger.info('Live receiver view attached')
    void view.webContents.loadFile(path.join(rendererRoot, 'live-receiver.html'))
      .then(() => { if (this.entry === entry && !entry.disposed) logger.info('Live receiver renderer loaded') })
      .catch(failed)
  }
  getGrant(senderId: number): LiveReceiverGrant | null {
    const entry = this.entry
    const lease = this.getLease(senderId)
    if (!entry || entry.delivered || !lease) return null
    entry.delivered = true
    return { ...entry.grant, signaling: { ...entry.grant.signaling }, lease_remaining_ms: lease.lease_ms }
  }
  getLease(senderId: number): LiveReceiverLease | null {
    const entry = this.entry
    if (!entry || entry.disposed || entry.view.webContents.id !== senderId || !entry.authorized()) return null
    const remaining = entry.remaining()
    if (!Number.isSafeInteger(remaining) || remaining <= 0 || remaining > 10000) return null
    return { view_epoch: entry.grant.view_epoch, lease_ms: remaining }
  }
  report(senderId: number, value: unknown): boolean {
    const entry = this.entry
    if (!entry || entry.disposed || !entry.authorized() || entry.view.webContents.id !== senderId || !value || typeof value !== 'object') return false
    const row = value as LiveReceiverObservation
    if (Object.keys(row).some(key => !['view_epoch', 'kind'].includes(key)) || row.view_epoch !== entry.grant.view_epoch || !KINDS.includes(row.kind)) return false
    entry.observation({ view_epoch: row.view_epoch, kind: row.kind })
    return true
  }
  activate(): boolean {
    const entry = this.entry
    if (!entry || entry.disposed || !entry.authorized() || entry.window.isDestroyed() || entry.view.webContents.isDestroyed()) return false
    this.resize()
    entry.view.setVisible(true)
    entry.visible = true
    entry.view.webContents.setAudioMuted(false)
    entry.view.webContents.send('live-receiver:activate')
    return true
  }
  async captureVisible(): Promise<NativeImage | undefined> {
    const entry = this.entry
    if (!entry || entry.disposed || !entry.visible || !entry.authorized() || entry.view.webContents.isDestroyed()) return undefined
    let image: NativeImage
    try { image = await entry.view.webContents.capturePage() }
    catch (error) { if (this.entry !== entry || entry.disposed || !entry.authorized()) return undefined; throw error }
    return this.entry === entry && !entry.disposed && entry.visible && entry.authorized() ? image : undefined
  }
  resize(): void {
    const entry = this.entry
    if (!entry || entry.disposed || entry.window.isDestroyed()) return
    const [width = 1, height = 1] = entry.window.getContentSize()
    entry.view.setBounds({ x: 0, y: 0, width, height })
  }
  destroy(): void {
    const entry = this.entry
    this.entry = undefined
    if (!entry) return
    entry.disposed = true; entry.controller.abort()
    entry.grant.signaling.ticket = ''
    entry.isolated.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
    entry.isolated.webRequest.onHeadersReceived(null)
    entry.isolated.setCertificateVerifyProc((_request, callback) => callback(-2))
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.setAudioMuted(true)
      entry.view.setVisible(false)
    }
    if (!entry.window.isDestroyed()) entry.window.contentView.removeChildView(entry.view)
    // Destruction, rather than an overlay, revokes tracks, audio and tickets.
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close({ waitForBeforeUnload: false })
  }
}
