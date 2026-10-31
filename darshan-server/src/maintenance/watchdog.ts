import type { MaintenanceStore } from './store';

export const DEFAULT_WATCHDOG_INTERVAL_MS = 5_000;

export class MaintenanceWatchdog {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: MaintenanceStore,
    private readonly intervalMs = DEFAULT_WATCHDOG_INTERVAL_MS,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100) {
      throw new RangeError('Maintenance watchdog interval must be at least 100ms.');
    }
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.store.reconcileStartup();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.store.reconcileStartup()
      .then(() => undefined)
      .catch((error) => this.onError(error))
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
