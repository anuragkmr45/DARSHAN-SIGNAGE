/**
 * Coordinates two startup operations that intentionally run concurrently.
 * A renderer can receive playback only after its document has loaded and the
 * long-lived player services have an active item to restore.
 */
export class RendererReadinessGate<T extends object> {
  private renderer?: T
  private claimedRenderer?: T
  private servicesReady = false

  markRendererLoaded(renderer: T): T | undefined {
    if (this.renderer !== renderer) {
      this.renderer = renderer
      this.claimedRenderer = undefined
    }
    return this.claimIfReady()
  }

  markServicesReady(): T | undefined {
    this.servicesReady = true
    return this.claimIfReady()
  }

  releaseClaim(renderer: T): void {
    if (this.claimedRenderer === renderer) this.claimedRenderer = undefined
  }

  clear(renderer: T): void {
    if (this.renderer !== renderer) return
    this.renderer = undefined
    this.claimedRenderer = undefined
  }

  private claimIfReady(): T | undefined {
    if (!this.servicesReady || !this.renderer || this.claimedRenderer === this.renderer) {
      return undefined
    }
    this.claimedRenderer = this.renderer
    return this.renderer
  }
}
