import { createHash, randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import type { BrowserWindow, Display } from 'electron'
import { getElectronScreen } from '../../common/platform-paths'
import { getLogger } from '../../common/logger'
import {
  DisplayDesiredSelection,
  DisplayOutput,
  DisplayProfileV1,
  normalizedAspect,
  outputOrientation,
} from '../../common/display-profile'
import { getDisplayPreferenceStore } from './display-preference-store'

const logger = getLogger('display-manager')
const DISPLAY_EVENT_DEBOUNCE_MS = 500

type DisplayBounds = { x: number; y: number; width: number; height: number }

function asBounds(bounds: DisplayBounds): DisplayBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  }
}

function isNativeWayland(): boolean {
  return (
    process.platform === 'linux' &&
    process.env['XDG_SESSION_TYPE'] === 'wayland' &&
    process.env['ELECTRON_OZONE_PLATFORM'] !== 'x11'
  )
}

function displaySignature(display: Display): string {
  const scale = Number.isFinite(display.scaleFactor) ? display.scaleFactor : 1
  const label = (display.label || '').trim().toLocaleLowerCase()
  const work = display.workAreaSize
  return `${label}|${Math.round(work.width * scale)}x${Math.round(work.height * scale)}|${Math.round(scale * 100) / 100}`
}

function displayKey(
  display: Display,
  duplicateSignature: boolean
): { key: string; confidence: DisplayOutput['identity_confidence'] } {
  const id = String(display.id)
  if (!duplicateSignature && id && id !== '0') {
    return { key: `platform:${id}`, confidence: 'PLATFORM' }
  }
  if (!duplicateSignature) {
    return {
      key: `signature:${createHash('sha256').update(displaySignature(display)).digest('hex').slice(0, 24)}`,
      confidence: 'SIGNATURE',
    }
  }
  // Two indistinguishable outputs cannot be safely pinned across reconnects.
  return { key: `session:${id}`, confidence: 'SESSION' }
}

export function toDisplayOutput(display: Display, primaryId: number, duplicateSignature = false): DisplayOutput {
  const bounds = asBounds(display.bounds)
  const workArea = asBounds(display.workArea)
  const scale = Number.isFinite(display.scaleFactor) && display.scaleFactor > 0 ? display.scaleFactor : 1
  const estimated = {
    width: Math.max(1, Math.round(bounds.width * scale)),
    height: Math.max(1, Math.round(bounds.height * scale)),
  }
  const identity = displayKey(display, duplicateSignature)
  return {
    key: identity.key,
    electron_id: String(display.id),
    identity_confidence: identity.confidence,
    label: display.label || null,
    detected: true,
    internal: Boolean((display as unknown as { internal?: boolean }).internal),
    primary: display.id === primaryId,
    bounds_dip: bounds,
    work_area_dip: workArea,
    scale_factor: scale,
    estimated_backing_px: estimated,
    native_mode_px: null,
    rotation_degrees: Number.isFinite(display.rotation) ? display.rotation : 0,
    refresh_rate_hz: Number.isFinite(display.displayFrequency) ? display.displayFrequency : null,
    orientation: outputOrientation(estimated.width, estimated.height),
    aspect: normalizedAspect(estimated.width, estimated.height),
  }
}

/** Main-process-only authority for all Electron screen access and placement. */
export class DisplayManager {
  private readonly emitter = new EventEmitter()
  private readonly runtimeSessionId = randomUUID()
  private observationSeq = 0
  private profile: DisplayProfileV1 = this.emptyProfile()
  private timer?: NodeJS.Timeout
  private started = false
  private window: BrowserWindow | null = null
  private reconciliationGeneration = 0
  private reconciliationPromise?: Promise<void>
  private preferenceUnsubscribe?: () => void
  private lastAppliedWindowSignature = ''

  private emptyProfile(): DisplayProfileV1 {
    const selection = getDisplayPreferenceStore().get()
    return {
      schema_version: 1,
      runtime_session_id: this.runtimeSessionId,
      observation_seq: 0,
      observed_at: new Date().toISOString(),
      selection: {
        mode: selection.mode,
        preferred_key: selection.preferred_key,
        active_key: null,
        fallback_used: false,
        fallback_reason: null,
      },
      placement: 'HEADLESS',
      output: null,
      inventory: [],
      viewport: null,
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    const electronScreen = getElectronScreen()
    if (!electronScreen) {
      logger.warn('Electron screen API unavailable; reporting headless display state')
      this.refresh('headless')
      return
    }
    electronScreen.on('display-added', this.scheduleRefresh)
    electronScreen.on('display-removed', this.scheduleRefresh)
    electronScreen.on('display-metrics-changed', this.scheduleRefresh)
    this.preferenceUnsubscribe = getDisplayPreferenceStore().onChange(() => this.refresh('selection-change'))
    this.refresh('startup')
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const electronScreen = getElectronScreen()
    electronScreen?.off('display-added', this.scheduleRefresh)
    electronScreen?.off('display-removed', this.scheduleRefresh)
    electronScreen?.off('display-metrics-changed', this.scheduleRefresh)
    this.preferenceUnsubscribe?.()
    this.preferenceUnsubscribe = undefined
    this.started = false
  }

  attachWindow(window: BrowserWindow): void {
    this.window = window
    void this.reconcileWindow()
  }

  detachWindow(window?: BrowserWindow): void {
    if (!window || this.window === window) this.window = null
  }

  getProfile(): DisplayProfileV1 {
    return JSON.parse(JSON.stringify(this.profile)) as DisplayProfileV1
  }

  getInitialWindowBounds(): DisplayBounds {
    if (this.profile.output) return { ...this.profile.output.bounds_dip }
    const electronScreen = getElectronScreen()
    const primary = electronScreen?.getPrimaryDisplay()
    return primary ? asBounds(primary.workArea) : { x: 0, y: 0, width: 1280, height: 720 }
  }

  async applyDesiredSelection(input: {
    mode?: unknown
    preferred_key?: unknown
    selection_version?: unknown
  }): Promise<DisplayProfileV1> {
    const selection: DisplayDesiredSelection =
      input.mode === 'PINNED' && typeof input.preferred_key === 'string' && input.preferred_key.trim()
        ? {
            mode: 'PINNED',
            preferred_key: input.preferred_key.trim(),
            selection_version: typeof input.selection_version === 'number' ? input.selection_version : undefined,
          }
        : {
            mode: 'PRIMARY',
            preferred_key: null,
            selection_version: typeof input.selection_version === 'number' ? input.selection_version : undefined,
          }
    await getDisplayPreferenceStore().set(selection)
    await this.reconcileWindow()
    return this.getProfile()
  }

  reportViewport(input: {
    width_css_px?: unknown
    height_css_px?: unknown
    device_pixel_ratio?: unknown
    density?: unknown
    conformant?: unknown
    omitted_regions?: unknown
  }): void {
    const width = Number(input.width_css_px)
    const height = Number(input.height_css_px)
    const dpr = Number(input.device_pixel_ratio)
    if (
      !Number.isFinite(width) ||
      width < 1 ||
      !Number.isFinite(height) ||
      height < 1 ||
      !Number.isFinite(dpr) ||
      dpr <= 0
    )
      return
    const density =
      input.density === 'FULL' || input.density === 'COMPACT' || input.density === 'MINIMAL' ? input.density : 'MINIMAL'
    const omittedRegions = Array.isArray(input.omitted_regions)
      ? input.omitted_regions.filter((value): value is string => typeof value === 'string').slice(0, 16)
      : []
    this.profile = {
      ...this.profile,
      observation_seq: ++this.observationSeq,
      observed_at: new Date().toISOString(),
      viewport: {
        width_css_px: Math.round(width),
        height_css_px: Math.round(height),
        device_pixel_ratio: dpr,
        density,
        conformant: input.conformant === true,
        omitted_regions: omittedRegions,
      },
    }
    this.emitChanged()
  }

  refresh(reason: string): void {
    const electronScreen = getElectronScreen()
    if (!electronScreen) {
      this.profile = { ...this.emptyProfile(), observation_seq: ++this.observationSeq }
      this.emitChanged()
      return
    }
    const displays = electronScreen.getAllDisplays()
    const primary = electronScreen.getPrimaryDisplay()
    const counts = new Map<string, number>()
    displays.forEach((display) =>
      counts.set(displaySignature(display), (counts.get(displaySignature(display)) || 0) + 1)
    )
    const inventory = displays.map((display) =>
      toDisplayOutput(display, primary.id, (counts.get(displaySignature(display)) || 0) > 1)
    )
    const desired = getDisplayPreferenceStore().get()
    let output = inventory.find((display) => display.primary) || inventory[0] || null
    let fallbackUsed = false
    let fallbackReason: DisplayProfileV1['selection']['fallback_reason'] = null
    if (desired.mode === 'PINNED') {
      const candidates = inventory.filter((display) => display.key === desired.preferred_key)
      if (isNativeWayland()) {
        fallbackUsed = true
        fallbackReason = 'WAYLAND_UNVERIFIED'
      } else if (candidates.length !== 1 || candidates[0]?.identity_confidence === 'SESSION') {
        fallbackUsed = true
        fallbackReason = candidates.length ? 'AMBIGUOUS_IDENTITY' : 'TARGET_MISSING'
      } else {
        output = candidates[0] ?? null
      }
    }
    // Electron can enumerate an output before the window has actually been
    // moved there. Placement becomes VERIFIED only after getDisplayMatching
    // confirms the selected window bounds in reconcileWindow().
    const placement = output ? 'UNVERIFIED' : 'HEADLESS'
    this.profile = {
      schema_version: 1,
      runtime_session_id: this.runtimeSessionId,
      observation_seq: ++this.observationSeq,
      observed_at: new Date().toISOString(),
      selection: {
        mode: desired.mode,
        preferred_key: desired.preferred_key,
        active_key: output?.key ?? null,
        fallback_used: fallbackUsed,
        fallback_reason: fallbackReason,
      },
      placement,
      output,
      inventory,
      viewport: this.profile.viewport,
    }
    logger.info({ reason, outputs: inventory.length, active: output?.key, fallbackReason }, 'Display profile refreshed')
    this.emitChanged()
    void this.reconcileWindow()
  }

  async reconcileWindow(): Promise<void> {
    this.reconciliationGeneration += 1
    if (!this.reconciliationPromise) {
      this.reconciliationPromise = this.drainReconciliation().finally(() => {
        this.reconciliationPromise = undefined
      })
    }
    await this.reconciliationPromise
  }

  private async drainReconciliation(): Promise<void> {
    let reconciledGeneration = -1
    while (reconciledGeneration !== this.reconciliationGeneration) {
      reconciledGeneration = this.reconciliationGeneration
      await this.applyWindowPlacement()
    }
  }

  private async applyWindowPlacement(): Promise<void> {
    const window = this.window
    const output = this.profile.output
    if (!window || window.isDestroyed() || !output) return
    try {
      const bounds = output.bounds_dip
      const { getRuntimeWindowPolicy, getRuntimeMode } = await import('../runtime-mode.js')
      const { getConfigManager } = await import('../../common/config.js')
      const policy = getRuntimeWindowPolicy(getRuntimeMode(getConfigManager().getConfig()))
      const target = policy.kiosk ? bounds : output.work_area_dip
      const width = policy.kiosk ? target.width : Math.min(target.width, 1440)
      const height = policy.kiosk ? target.height : Math.min(target.height, 900)
      const windowSignature = `${output.key}|${target.x},${target.y},${width},${height}|${policy.kiosk}`
      const placementChanged = this.lastAppliedWindowSignature !== windowSignature
      if (placementChanged) {
        window.setBounds({ x: target.x, y: target.y, width, height })
        this.lastAppliedWindowSignature = windowSignature
      }
      if (policy.kiosk) {
        if (!window.isFullScreen()) window.setFullScreen(true)
        if (!window.isKiosk()) window.setKiosk(true)
      } else {
        if (window.isKiosk()) window.setKiosk(false)
        if (window.isFullScreen()) window.setFullScreen(false)
      }
      const electronScreen = getElectronScreen()
      const matching = electronScreen?.getDisplayMatching(window.getBounds())
      const verified = !isNativeWayland() && matching && String(matching.id) === output.electron_id
      if (this.profile.placement !== (verified ? 'VERIFIED' : 'UNVERIFIED')) {
        this.profile = {
          ...this.profile,
          observation_seq: ++this.observationSeq,
          observed_at: new Date().toISOString(),
          placement: verified ? 'VERIFIED' : 'UNVERIFIED',
        }
        this.emitChanged()
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to reconcile player window with selected display')
    }
  }

  onChange(listener: (profile: DisplayProfileV1) => void): () => void {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }

  private scheduleRefresh = (): void => {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.refresh('display-event')
    }, DISPLAY_EVENT_DEBOUNCE_MS)
  }

  private emitChanged(): void {
    this.emitter.emit('change', this.getProfile())
  }
}

let displayManager: DisplayManager | null = null

export function getDisplayManager(): DisplayManager {
  if (!displayManager) displayManager = new DisplayManager()
  return displayManager
}
