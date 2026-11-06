import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { BrowserWindow } from 'electron'

export type RendererContentOwner = 'ordinary' | 'live-fallback' | 'blocked'
export type RendererDisposal = { contentEpoch: string; requestId: string }
/** Main-process fence for all renderer playback reports and async mutations. */
export class ContentOwner extends EventEmitter {
  private epoch = randomUUID()
  private owner: RendererContentOwner = 'ordinary'
  private senderId?: number
  private pending?: { request: RendererDisposal; senderId: number; resolve: (accepted: boolean) => void; timer: NodeJS.Timeout }
  getEpoch(): string { return this.epoch }
  getOwner(): RendererContentOwner { return this.owner }
  attach(window: BrowserWindow): boolean {
    if (this.senderId === window.webContents.id) return false
    this.senderId = window.webContents.id
    this.advance('blocked')
    return true
  }
  advance(owner: RendererContentOwner): string {
    const old = this.epoch
    this.epoch = randomUUID(); this.owner = owner
    this.finishDisposal(false)
    this.emit('invalidated', { oldEpoch: old, contentEpoch: this.epoch, owner })
    return this.epoch
  }
  accepts(senderId: number, contentEpoch: unknown): boolean {
    return this.owner !== 'blocked' && this.senderId === senderId && typeof contentEpoch === 'string' && contentEpoch === this.epoch
  }
  /** Mute synchronously; show/enable a different audio owner only after ACK. */
  disposeRenderer(window: BrowserWindow, timeoutMs = 1500): Promise<boolean> {
    const contentEpoch = this.advance('blocked')
    if (window.isDestroyed() || window.webContents.isDestroyed() || this.senderId !== window.webContents.id) return Promise.resolve(false)
    try { window.webContents.setAudioMuted(true) } catch { return Promise.resolve(false) }
    const request = { contentEpoch, requestId: randomUUID() }
    return new Promise(resolve => {
      const timer = setTimeout(() => this.finishDisposal(false), timeoutMs)
      this.pending = { request, senderId: window.webContents.id, resolve, timer }
      try { window.webContents.send('playback-owner:dispose', request) }
      catch { this.finishDisposal(false) }
    })
  }
  acknowledge(senderId: number, value: unknown): boolean {
    if (!value || typeof value !== 'object' || !this.pending) return false
    const request = value as Partial<RendererDisposal>
    if (Object.keys(request).some(key => key !== 'contentEpoch' && key !== 'requestId') || this.pending.senderId !== senderId ||
      request.contentEpoch !== this.epoch || request.contentEpoch !== this.pending.request.contentEpoch || request.requestId !== this.pending.request.requestId) return false
    this.finishDisposal(true)
    return true
  }
  private finishDisposal(accepted: boolean): void {
    const previous = this.pending
    this.pending = undefined
    if (!previous) return
    clearTimeout(previous.timer); previous.resolve(accepted)
  }
}
let instance: ContentOwner | undefined
export function getContentOwner(): ContentOwner { return instance ??= new ContentOwner() }
