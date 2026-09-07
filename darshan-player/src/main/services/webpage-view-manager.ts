import { WebContentsView, session } from 'electron'
import type { BrowserWindow, Session } from 'electron'
import type { WebpageViewBounds, WebpageViewRequest, WebpageViewStatus } from '../../common/types'
import { redactUrlForDiagnostics } from '../../common/redaction'
import { assertPlayerWebpageUrlAllowed, hostMatches } from './webpage-network-policy'

const WEBPAGE_PARTITION = 'persist:darshan-webpage-playback'
const MAX_LIVE_VIEWS = 4
const READY_DEADLINE_MS = 12_000
const READY_SAMPLE_DELAY_MS = 150
const MAX_RETRIES = 3

const READY_PROBE = `(() => {
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return { ready: false, reason: 'missing-body' };
  const textLength = (body.innerText || '').trim().length;
  const mediaCount = body.querySelectorAll('img, video, canvas, svg, iframe, embed, object').length;
  const visible = Array.from(body.querySelectorAll('*')).filter((node) => {
    if (!(node instanceof HTMLElement) && !(node instanceof SVGElement)) return false;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 4 || rect.height <= 4) return false;
    const style = window.getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }).length;
  const ready = root.clientWidth > 0 && root.clientHeight > 0 && (textLength > 24 || mediaCount > 0 || visible > 1);
  return { ready, reason: ready ? 'ok' : 'empty-dom' };
})()`

const LOCKDOWN_SCRIPT = `((inputLocked) => {
  const lock = () => {
    window.scrollTo(0, 0);
    document.querySelectorAll('video, audio').forEach((node) => {
      try { node.muted = true; node.defaultMuted = true; node.volume = 0; } catch {}
    });
  };
  lock();
  new MutationObserver(lock).observe(document.documentElement, { childList: true, subtree: true });
  window.open = () => null;
  if (inputLocked) {
    const block = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'dragstart', 'drop']) {
      window.addEventListener(type, block, { capture: true, passive: false });
    }
  }
  return true;
})`

type Entry = {
  request: WebpageViewRequest
  view: WebContentsView
  healthy: boolean
  selected: boolean
  disposed: boolean
  retryCount: number
  probeGeneration: number
  timers: Set<NodeJS.Timeout>
  retryTimer?: NodeJS.Timeout
}

type WebpageViewManagerDependencies = {
  createView: () => WebContentsView
  getSession: () => Session
}

export class WebpageViewManager {
  private entries = new Map<string, Entry>()
  private configuredSession = false

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly getSecurity: () => import('../../common/types').SecurityConfig,
    private readonly isInputLocked: () => boolean,
    private readonly logger: { warn: (data: object, message?: string) => void },
    private readonly dependencies: Partial<WebpageViewManagerDependencies> = {},
  ) {}

  configureSession(): void {
    if (this.configuredSession) return
    this.configuredSession = true
    const webpageSession = this.dependencies.getSession?.() ?? session.fromPartition(WEBPAGE_PARTITION)
    webpageSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    webpageSession.setPermissionCheckHandler(() => false)
    webpageSession.on('will-download', (event) => event.preventDefault())
    webpageSession.webRequest.onBeforeRequest((details, callback) => {
      const purpose = details.resourceType === 'mainFrame' ? 'navigation' : 'resource'
      void assertPlayerWebpageUrlAllowed(details.url, purpose, this.getSecurity())
        .then(() => callback({ cancel: false }))
        .catch((error) => {
          this.logger.warn(
            { code: error?.code ?? 'WEBPAGE_POLICY_BLOCKED', url: redactUrlForDiagnostics(details.url) },
            'Blocked webpage network request',
          )
          callback({ cancel: true })
        })
    })
  }

  async mount(request: WebpageViewRequest): Promise<{ accepted: boolean; reason?: string }> {
    const window = this.getWindow()
    if (!window || window.isDestroyed()) return { accepted: false, reason: 'window-unavailable' }
    if (!this.validRequest(request)) return { accepted: false, reason: 'invalid-request' }
    try {
      await assertPlayerWebpageUrlAllowed(request.url, 'navigation', this.getSecurity())
    } catch (error) {
      const reason = typeof (error as { code?: unknown })?.code === 'string'
        ? String((error as { code: string }).code)
        : 'WEBPAGE_POLICY_BLOCKED'
      this.sendStatus({ id: request.id, generation: request.generation, state: 'blocked', reason })
      return { accepted: false, reason }
    }

    const existing = this.entries.get(request.id)
    if (existing && existing.request.generation > request.generation) {
      return { accepted: false, reason: 'stale-generation' }
    }
    if (existing) this.disposeEntry(existing)

    if (this.entries.size >= MAX_LIVE_VIEWS) {
      const lowestPriority = [...this.entries.values()].sort((left, right) =>
        left.request.zIndex - right.request.zIndex || right.request.id.localeCompare(left.request.id)
      )[0]
      const outranksLowest = lowestPriority && (
        request.zIndex > lowestPriority.request.zIndex ||
        (request.zIndex === lowestPriority.request.zIndex && request.id.localeCompare(lowestPriority.request.id) < 0)
      )
      if (!lowestPriority || !outranksLowest) {
        this.sendStatus({ id: request.id, generation: request.generation, state: 'fallback', reason: 'live-view-cap' })
        return { accepted: false, reason: 'live-view-cap' }
      }
      this.sendStatus({
        id: lowestPriority.request.id,
        generation: lowestPriority.request.generation,
        state: 'fallback',
        reason: 'live-view-cap',
      })
      this.disposeEntry(lowestPriority)
    }

    const view = this.dependencies.createView?.() ?? new WebContentsView({
      webPreferences: {
        partition: WEBPAGE_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        disableDialogs: true,
        navigateOnDragDrop: false,
      },
    })
    const entry: Entry = {
      request: { ...request, bounds: this.clampBounds(request.bounds, window) },
      view,
      healthy: false,
      selected: false,
      disposed: false,
      retryCount: 0,
      probeGeneration: 0,
      timers: new Set(),
    }
    this.entries.set(request.id, entry)
    window.contentView.addChildView(view)
    view.setBounds(entry.request.bounds)
    view.setVisible(false)
    this.configureContents(entry)
    this.rebalance()
    this.sendStatus({ id: request.id, generation: request.generation, state: 'loading' })
    void view.webContents.loadURL(request.url).catch((error) => this.fail(entry, 'load-rejected', error))
    return { accepted: true }
  }

  update(request: WebpageViewRequest): { accepted: boolean; reason?: string } {
    const entry = this.entries.get(request.id)
    const window = this.getWindow()
    if (!entry || !window || window.isDestroyed()) return { accepted: false, reason: 'view-not-found' }
    if (entry.request.generation !== request.generation) return { accepted: false, reason: 'stale-generation' }
    if (!this.validRequest(request)) return { accepted: false, reason: 'invalid-request' }
    entry.request = { ...entry.request, bounds: this.clampBounds(request.bounds, window), zIndex: request.zIndex }
    entry.view.setBounds(entry.request.bounds)
    this.rebalance()
    return { accepted: true }
  }

  destroy(id: string, generation: number): void {
    const entry = this.entries.get(id)
    if (!entry || entry.request.generation !== generation) return
    this.disposeEntry(entry)
    this.rebalance()
  }

  destroyAll(reason?: string): void {
    for (const entry of [...this.entries.values()]) {
      if (reason) {
        this.sendStatus({
          id: entry.request.id,
          generation: entry.request.generation,
          state: 'fallback',
          reason,
        })
      }
      this.disposeEntry(entry)
    }
  }

  private configureContents(entry: Entry): void {
    const contents = entry.view.webContents
    contents.setAudioMuted(true)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('before-input-event', (event) => {
      if (this.isInputLocked()) event.preventDefault()
    })
    contents.on('will-navigate', (event, url) => {
      if (!this.hostAllowed(url, 'navigation')) event.preventDefault()
    })
    contents.on('will-redirect', (event, url) => {
      if (!this.hostAllowed(url, 'navigation')) event.preventDefault()
    })
    contents.on('dom-ready', () => {
      void contents.executeJavaScript(`${LOCKDOWN_SCRIPT}(${JSON.stringify(this.isInputLocked())})`, false).catch(() => undefined)
      this.beginProbe(entry)
    })
    contents.on('did-stop-loading', () => this.beginProbe(entry))
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.fail(entry, `load-${code}`, { description, url })
    })
    contents.on('render-process-gone', (_event, details) => this.fail(entry, 'render-process-gone', details))
    contents.on('unresponsive', () => this.fail(entry, 'unresponsive'))
  }

  private beginProbe(entry: Entry): void {
    if (entry.disposed) return
    entry.probeGeneration += 1
    const generation = entry.probeGeneration
    const deadline = Date.now() + READY_DEADLINE_MS
    const sample = async (healthySamples: number): Promise<void> => {
      if (entry.disposed || generation !== entry.probeGeneration) return
      try {
        const result = (await entry.view.webContents.executeJavaScript(READY_PROBE, false)) as { ready?: boolean; reason?: string }
        if (result?.ready) {
          if (healthySamples + 1 >= 2) {
            entry.healthy = true
            if (entry.retryTimer) {
              clearTimeout(entry.retryTimer)
              entry.timers.delete(entry.retryTimer)
              entry.retryTimer = undefined
            }
            this.rebalance()
            this.sendStatus({ id: entry.request.id, generation: entry.request.generation, state: 'healthy' })
            return
          }
          this.schedule(entry, () => void sample(healthySamples + 1), READY_SAMPLE_DELAY_MS)
          return
        }
        if (Date.now() >= deadline) return this.fail(entry, `probe-${result?.reason || 'unhealthy'}`)
      } catch (error) {
        if (Date.now() >= deadline) return this.fail(entry, 'probe-execution-failed', error)
      }
      this.schedule(entry, () => void sample(0), 350)
    }
    void sample(0)
  }

  private fail(entry: Entry, reason: string, error?: unknown): void {
    if (entry.disposed) return
    entry.healthy = false
    entry.view.setVisible(false)
    this.sendStatus({ id: entry.request.id, generation: entry.request.generation, state: 'fallback', reason })
    this.logger.warn({ reason, url: redactUrlForDiagnostics(entry.request.url), error }, 'Webpage view fallback active')
    if (entry.retryTimer) return
    if (entry.retryCount >= MAX_RETRIES) {
      this.disposeEntry(entry)
      this.rebalance()
      return
    }
    const delay = 1000 * 2 ** entry.retryCount
    entry.retryCount += 1
    const timer = setTimeout(() => {
      entry.timers.delete(timer)
      entry.retryTimer = undefined
      if (!entry.disposed) void entry.view.webContents.reload()
    }, delay)
    entry.retryTimer = timer
    entry.timers.add(timer)
  }

  private rebalance(): void {
    const window = this.getWindow()
    const ordered = [...this.entries.values()].sort((left, right) =>
      left.request.zIndex - right.request.zIndex || right.request.id.localeCompare(left.request.id)
    )
    for (const entry of ordered) {
      entry.selected = true
      entry.view.setVisible(entry.healthy)
      if (window && !window.isDestroyed()) window.contentView.addChildView(entry.view)
    }
  }

  private disposeEntry(entry: Entry): void {
    if (entry.disposed) return
    entry.disposed = true
    entry.probeGeneration += 1
    for (const timer of entry.timers) clearTimeout(timer)
    entry.timers.clear()
    entry.retryTimer = undefined
    this.entries.delete(entry.request.id)
    const window = this.getWindow()
    try { if (window && !window.isDestroyed()) window.contentView.removeChildView(entry.view) } catch {
      // The BrowserWindow may have been destroyed between the guard and removal.
    }
    try { if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close() } catch {
      // Closing an already-terminating renderer is best effort during teardown.
    }
  }

  private schedule(entry: Entry, callback: () => void, delay: number): void {
    const timer = setTimeout(() => {
      entry.timers.delete(timer)
      callback()
    }, delay)
    entry.timers.add(timer)
  }

  private validRequest(request: WebpageViewRequest): boolean {
    return Boolean(
      request && typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 128 &&
      Number.isSafeInteger(request.generation) && request.generation > 0 &&
      Number.isFinite(request.zIndex) && this.validBounds(request.bounds)
    )
  }

  private validBounds(bounds: WebpageViewBounds): boolean {
    return Boolean(bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0)
  }

  private clampBounds(bounds: WebpageViewBounds, window: BrowserWindow): WebpageViewBounds {
    const [contentWidth = 1, contentHeight = 1] = window.getContentSize()
    const x = Math.max(0, Math.min(Math.round(bounds.x), contentWidth - 1))
    const y = Math.max(0, Math.min(Math.round(bounds.y), contentHeight - 1))
    return {
      x,
      y,
      width: Math.max(1, Math.min(Math.round(bounds.width), contentWidth - x)),
      height: Math.max(1, Math.min(Math.round(bounds.height), contentHeight - y)),
    }
  }

  private hostAllowed(url: string, purpose: 'navigation' | 'resource'): boolean {
    try {
      const parsed = new URL(url)
      if (parsed.username || parsed.password) return false
      const security = this.getSecurity()
      const allowHttp = security.webpageAllowHttp === true && process.env['NODE_ENV'] !== 'production'
      if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) return false
      const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      const allowedDomains = purpose === 'resource' && security.webpageResourceDomains?.length
        ? security.webpageResourceDomains
        : security.allowedDomains
      if (process.env['NODE_ENV'] !== 'production' && allowedDomains.length === 0) return true
      return allowedDomains.some((raw) => hostMatches(hostname, raw))
    } catch {
      return false
    }
  }

  private sendStatus(status: WebpageViewStatus): void {
    const window = this.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('webpage-view:status', status)
  }
}
