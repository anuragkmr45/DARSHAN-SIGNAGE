import type { LiveReceiverLease } from '../common/live-runtime'
/** Independent receiver cutoff if the main event loop stalls. Main remains the
 * only authority; IPC queue time consumes rather than extends every pulse. */
export class LiveReceiverLeaseClock {
  private disposed = false
  private deadline = 0
  private expiry?: ReturnType<typeof setTimeout>
  private poll?: ReturnType<typeof setTimeout>
  constructor(private readonly options: { viewEpoch: string; request: () => Promise<LiveReceiverLease | null>;
    expired: () => void; now?: () => number }) {}
  private now(): number { return this.options.now?.() ?? performance.now() }
  isAuthorized(): boolean { return !this.disposed && this.deadline > this.now() }
  start(started: number, remaining: number): void {
    if (this.disposed || this.deadline !== 0 || !this.accept(started, { view_epoch: this.options.viewEpoch, lease_ms: remaining })) return
    this.schedulePoll()
  }
  stop(): void {
    this.disposed = true
    if (this.expiry) clearTimeout(this.expiry)
    if (this.poll) clearTimeout(this.poll)
    this.expiry = undefined; this.poll = undefined; this.deadline = 0
  }
  private expire(): void {
    if (this.disposed) return
    this.stop(); this.options.expired()
  }
  private accept(started: number, lease: LiveReceiverLease | null): boolean {
    if (this.disposed) return false
    const now = this.now()
    if ((this.deadline > 0 && this.deadline <= now) || !lease || Object.keys(lease).some(key => !['view_epoch', 'lease_ms'].includes(key)) ||
      lease.view_epoch !== this.options.viewEpoch || !Number.isSafeInteger(lease.lease_ms) || lease.lease_ms <= 0 || lease.lease_ms > 10000 ||
      !Number.isFinite(started) || started > now || started + lease.lease_ms <= now) { this.expire(); return false }
    this.deadline = started + lease.lease_ms
    if (this.expiry) clearTimeout(this.expiry)
    this.expiry = setTimeout(() => this.expire(), Math.max(0, this.deadline - now))
    return true
  }
  private schedulePoll(): void {
    if (this.disposed) return
    this.poll = setTimeout(() => { this.poll = undefined; void this.refresh() }, 1000)
  }
  private async refresh(): Promise<void> {
    if (!this.isAuthorized()) { this.expire(); return }
    const started = this.now()
    try { if (this.accept(started, await this.options.request())) this.schedulePoll() }
    catch { this.expire() }
  }
}
