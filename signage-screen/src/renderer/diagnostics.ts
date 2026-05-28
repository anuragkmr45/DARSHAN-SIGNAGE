/**
 * Diagnostics Overlay - Real-time system diagnostics (Ctrl+Shift+D)
 * Displays device info, connection status, cache usage, and performance metrics
 */

// Import shared types
import './types'

class DiagnosticsOverlay {
  private overlay: HTMLElement | null = null
  private isVisible = false
  private updateInterval?: number
  private updateIntervalMs = 2000 // Update every 2 seconds

  constructor() {
    this.overlay = document.getElementById('diagnostics-overlay')
    this.setupHotkey()
    this.log('Diagnostics overlay initialized')
  }

  /**
   * Setup Ctrl+Shift+D hotkey
   */
  private setupHotkey(): void {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  /**
   * Toggle overlay visibility
   */
  async toggle(): Promise<void> {
    this.isVisible = !this.isVisible

    if (!this.overlay) return

    if (this.isVisible) {
      this.overlay.classList.remove('hidden')
      await this.update()
      this.startAutoUpdate()
      this.log('Diagnostics overlay shown')
    } else {
      this.overlay.classList.add('hidden')
      this.stopAutoUpdate()
      this.log('Diagnostics overlay hidden')
    }

    // Notify main process
    if (window.hexmon && window.hexmon.toggleDiagnostics) {
      await window.hexmon.toggleDiagnostics()
    }
  }

  /**
   * Update diagnostics data
   */
  private async update(): Promise<void> {
    try {
      const [diagnostics, health] = await Promise.all([
        window.hexmon.getDiagnostics(),
        window.hexmon.getHealth(),
      ])

      this.updateDisplay(diagnostics, health)
    } catch (error) {
      this.log('Failed to update diagnostics', error)
    }
  }

  /**
   * Update display with diagnostics data
   */
  private updateDisplay(diagnostics: any, health: any): void {
    this.updateField('diag-device-id', diagnostics.deviceId || '-')
    this.updateField('diag-ip', diagnostics.ipAddress || '-')
    this.updateField('diag-ws', this.formatWSState(diagnostics.wsState))
    this.updateField('diag-sync', this.formatTimestamp(diagnostics.lastSync))
    this.updateField('diag-cache', this.formatCacheUsage(health.cacheUsage))
    this.updateField('diag-queue', diagnostics.commandQueueSize?.toString() || '0')
    this.updateField('diag-uptime', this.formatUptime(health.uptime))
    this.updateField('diag-version', diagnostics.version || health.appVersion || '-')
  }

  /**
   * Update field value
   */
  private updateField(id: string, value: string): void {
    const element = document.getElementById(id)
    if (element) {
      element.textContent = value
    }
  }

  /**
   * Format WebSocket state
   */
  private formatWSState(state: string): string {
    const stateMap: Record<string, string> = {
      connected: '🟢 Connected',
      connecting: '🟡 Connecting',
      disconnected: '🔴 Disconnected',
      reconnecting: '🟡 Reconnecting',
    }
    return stateMap[state] || state
  }

  /**
   * Format timestamp
   */
  private formatTimestamp(timestamp?: string): string {
    if (!timestamp) return 'Never'

    try {
      const date = new Date(timestamp)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffSec = Math.floor(diffMs / 1000)

      if (diffSec < 60) return `${diffSec}s ago`
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
      return `${Math.floor(diffSec / 86400)}d ago`
    } catch {
      return 'Invalid'
    }
  }

  /**
   * Format cache usage
   */
  private formatCacheUsage(cacheUsage: any): string {
    if (!cacheUsage) return '-'

    const usedBytes = cacheUsage.usedBytes || 0
    const totalBytes = cacheUsage.totalBytes || 1
    const percentage = Math.round((usedBytes / totalBytes) * 100)

    return `${this.formatBytes(usedBytes)} / ${this.formatBytes(totalBytes)} (${percentage}%)`
  }

  /**
   * Format bytes to human-readable
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  /**
   * Format uptime
   */
  private formatUptime(seconds?: number): string {
    if (!seconds) return '-'

    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    if (days > 0) return `${days}d ${hours}h`
    if (hours > 0) return `${hours}h ${minutes}m`
    return `${minutes}m`
  }

  /**
   * Start auto-update
   */
  private startAutoUpdate(): void {
    this.stopAutoUpdate()

    this.updateInterval = window.setInterval(() => {
      this.update().catch((error) => {
        this.log('Auto-update failed', error)
      })
    }, this.updateIntervalMs)
  }

  /**
   * Stop auto-update
   */
  private stopAutoUpdate(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval)
      this.updateInterval = undefined
    }
  }

  /**
   * Log message
   */
  private log(message: string, data?: any): void {
    console.log(`[Diagnostics] ${message}`, data)
  }
}

// Initialize diagnostics overlay when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new DiagnosticsOverlay()
  })
} else {
  new DiagnosticsOverlay()
}

