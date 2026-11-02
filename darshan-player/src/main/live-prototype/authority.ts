import * as http from 'http'
import * as https from 'https'
import { performance } from 'perf_hooks'
import type { LivePrototypeGrant } from '../../common/live-prototype'
import { isLoopback, type LivePrototypeConfig } from './config'

export type AuthorityResponse = { status: number; data?: unknown }
export type AuthorityRequest = (reconnect: boolean) => Promise<AuthorityResponse>

export function createAuthorityRequest(config: LivePrototypeConfig): AuthorityRequest {
  return (reconnect) => new Promise((resolve, reject) => {
    let complete = false
    let deadline: NodeJS.Timeout | undefined
    const finish = (value?: AuthorityResponse): void => {
      if (complete) return
      complete = true
      if (deadline) clearTimeout(deadline)
      if (value) resolve(value)
      else reject(new Error('Authority unavailable'))
    }
    const url = new URL(config.authority_url)
    const body = JSON.stringify({ receiver_session_id: config.receiver_session_id, reconnect })
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'POST', timeout: 1500,
      headers: { Authorization: `Bearer ${config.renewal_token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (response) => {
      let bytes = 0
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > 16_384) { finish(); request.destroy(); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const status = response.statusCode || 500
        if (status !== 200) { finish({ status }); return }
        try { finish({ status, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
        catch { finish() }
      })
      response.on('error', () => finish())
      response.on('aborted', () => finish())
    })
    // Socket timeout alone is inactivity-based; a dribbling response must not
    // monopolize the single-flight renewal indefinitely.
    deadline = setTimeout(() => { finish(); request.destroy() }, 1500)
    request.on('timeout', () => { finish(); request.destroy() })
    request.on('error', () => finish())
    request.on('close', () => finish())
    request.end(body)
  })
}

export function validatePrototypeGrant(value: unknown): LivePrototypeGrant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid authority')
  const grant = value as LivePrototypeGrant
  for (const field of ['admission_id', 'run_id', 'presenter_identity'] as const) {
    if (typeof grant[field] !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(grant[field])) throw new Error('Invalid authority')
  }
  if (!Number.isSafeInteger(grant.generation) || grant.generation < 1 ||
      !Number.isFinite(grant.lease_ms) || grant.lease_ms <= 0 || grant.lease_ms > 10_000 ||
      !Number.isFinite(grant.window_remaining_ms) || grant.window_remaining_ms <= 0 ||
      (grant.ticket !== undefined && (typeof grant.ticket !== 'string' || grant.ticket.length < 16 || grant.ticket.length > 8192))) throw new Error('Invalid authority')
  const signal = new URL(grant.signal_url)
  if (!['ws:', 'wss:'].includes(signal.protocol) || signal.username || signal.password || signal.search || signal.hash ||
      (signal.pathname !== '/' && signal.pathname !== '') || (signal.protocol === 'ws:' && !isLoopback(signal.hostname))) throw new Error('Invalid signaling endpoint')
  return {
    signal_url: signal.origin, admission_id: grant.admission_id, run_id: grant.run_id,
    generation: grant.generation, presenter_identity: grant.presenter_identity,
    lease_ms: grant.lease_ms, window_remaining_ms: grant.window_remaining_ms,
    ...(grant.ticket !== undefined ? { ticket: grant.ticket } : {}),
  }
}

/** Owns the lease independently of renderer timers and SDK reconnect behavior. */
export class LivePrototypeAuthority {
  private running = false
  private suspended = false
  private epoch = 0
  private inFlight = false
  private needsTicket = true
  private renewal?: NodeJS.Timeout
  private expiry?: NodeJS.Timeout
  private deadline = 0
  private current?: LivePrototypeGrant
  private pinnedSignal?: string

  constructor(private options: {
    request: AuthorityRequest
    onGrant: (grant: LivePrototypeGrant) => void
    onUnavailable: (reason: string) => void
    now?: () => number
  }) {}

  start(): void {
    if (this.running) return
    this.running = true
    void this.refresh()
  }

  stop(reason = 'Prototype stopped'): void {
    this.running = false
    this.epoch += 1
    if (this.renewal) clearTimeout(this.renewal)
    this.renewal = undefined
    this.invalidate(reason)
  }

  suspend(): void {
    this.suspended = true
    this.epoch += 1
    this.invalidate('Content unavailable — player suspended')
  }

  resume(): void {
    this.suspended = false
    this.epoch += 1
    this.invalidate('Content unavailable — revalidating after resume')
    this.schedule(1000)
  }

  requestReconnect(reason = 'Content unavailable — reconnecting'): void {
    if (!this.running || this.suspended || this.needsTicket) return
    this.epoch += 1
    this.invalidate(reason)
    this.schedule(1000)
  }

  isAuthorized(grant: Pick<LivePrototypeGrant, 'run_id' | 'generation' | 'admission_id'>): boolean {
    return this.running && !this.suspended && this.now() < this.deadline &&
      this.current?.run_id === grant.run_id && this.current.generation === grant.generation && this.current.admission_id === grant.admission_id
  }

  private now(): number { return this.options.now?.() ?? performance.now() }

  private invalidate(reason: string): void {
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = undefined
    this.current = undefined
    this.deadline = 0
    this.needsTicket = true
    this.options.onUnavailable(reason)
  }

  private schedule(delay: number): void {
    if (this.renewal) clearTimeout(this.renewal)
    if (!this.running) return
    this.renewal = setTimeout(() => { void this.refresh() }, delay)
  }

  private async refresh(): Promise<void> {
    if (!this.running) return
    if (this.suspended || this.inFlight) { this.schedule(1000); return }
    this.inFlight = true
    const epoch = this.epoch
    const started = this.now()
    const reconnect = this.needsTicket
    try {
      const response = await this.options.request(reconnect)
      if (!this.running || this.suspended || epoch !== this.epoch) return
      if (!reconnect && this.deadline <= this.now()) {
        this.epoch += 1
        this.invalidate('Content unavailable — live authority expired')
        return
      }
      if (response.status !== 200) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          this.stop('Content unavailable — live authority rejected')
        }
        return
      }
      let grant: LivePrototypeGrant
      try { grant = validatePrototypeGrant(response.data) }
      catch { this.stop('Content unavailable — invalid live authority'); return }
      if (this.pinnedSignal && this.pinnedSignal !== grant.signal_url) {
        this.stop('Content unavailable — signaling authority changed'); return
      }
      if (!reconnect && this.current && (this.current.run_id !== grant.run_id || this.current.generation !== grant.generation ||
          this.current.admission_id !== grant.admission_id || this.current.presenter_identity !== grant.presenter_identity || grant.ticket)) {
        this.stop('Content unavailable — live authority changed'); return
      }
      if (reconnect && !grant.ticket) { this.stop('Content unavailable — missing connection ticket'); return }
      const deadline = started + Math.min(grant.lease_ms, grant.window_remaining_ms)
      if (deadline <= this.now()) { this.invalidate('Content unavailable — authority response expired'); return }
      this.pinnedSignal = grant.signal_url
      this.current = grant
      this.deadline = deadline
      this.needsTicket = false
      if (this.expiry) clearTimeout(this.expiry)
      this.expiry = setTimeout(() => {
        this.epoch += 1
        this.invalidate('Content unavailable — live authority expired')
      }, Math.max(0, deadline - this.now()))
      if (grant.ticket) this.options.onGrant(grant)
    } catch {
      // Transient failures never move the current deadline. Invalid grants
      // also cannot replace a valid lease or display their arbitrary content.
      if (reconnect && !this.current) this.options.onUnavailable('Content unavailable — awaiting valid live authority')
    } finally {
      this.inFlight = false
      this.schedule(3000)
    }
  }
}
