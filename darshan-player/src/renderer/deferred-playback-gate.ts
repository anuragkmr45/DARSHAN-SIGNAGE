/**
 * Holds one playback event while its matching presentation revision is in
 * flight. The first newer presentation either releases it for scheduled
 * playback or discards it, preventing both event-order blanks and stale replay.
 */
export class DeferredPlaybackGate<T> {
  private pending?: { value: T; afterRevision: number }

  defer(value: T, afterRevision: number): void {
    this.pending = { value, afterRevision }
  }

  resolve(revision: number, source: 'schedule' | 'default' | 'none'): T | undefined {
    if (!this.pending || revision <= this.pending.afterRevision) return undefined
    const value = this.pending.value
    this.pending = undefined
    return source === 'schedule' ? value : undefined
  }

  clear(): void {
    this.pending = undefined
  }
}
