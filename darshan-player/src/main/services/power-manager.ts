/**
 * Power Manager - Display power management and DPMS control
 * Linux-specific features with Windows stubs for cross-platform compatibility
 */

import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getLogger } from '../../common/logger'
import type { PowerConfig } from '../../common/types'
import { findExecutable } from '../../common/utils'

const execAsync = promisify(exec)
const logger = getLogger('power-manager')

export interface DisplayInfo {
  name: string
  connected: boolean
  resolution?: string
  primary?: boolean
}

export interface PowerSchedule {
  onTime?: string // HH:MM format
  offTime?: string // HH:MM format
  enabled: boolean
}

export interface PowerCapabilities {
  platform: NodeJS.Platform
  dpmsControl: boolean
  preventBlanking: boolean
  displayEnumeration: boolean
}

type PowerSaveBlockerApi = Pick<typeof import('electron')['powerSaveBlocker'], 'start' | 'stop' | 'isStarted'>
type PowerSaveBlockerProvider = () => PowerSaveBlockerApi | null

export interface PowerManagerOptions {
  platform?: NodeJS.Platform
  xsetPath?: string | null
  powerSaveBlocker?: PowerSaveBlockerApi | null
  enforcementIntervalMs?: number
}

const DEFAULT_POWER_CONFIG: PowerConfig = {
  dpmsEnabled: true,
  preventBlanking: true,
  scheduleEnabled: false,
}
const DEFAULT_SLEEP_PREVENTION_ENFORCEMENT_MS = 60000

function getPowerSaveBlocker(): PowerSaveBlockerApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron') | string
    if (typeof electron !== 'object' || !electron.powerSaveBlocker) {
      return null
    }

    const blocker = electron.powerSaveBlocker
    if (
      typeof blocker.start !== 'function' ||
      typeof blocker.stop !== 'function' ||
      typeof blocker.isStarted !== 'function'
    ) {
      return null
    }

    return blocker
  } catch {
    return null
  }
}

export class PowerManager {
  private readonly platform: NodeJS.Platform
  private isLinux: boolean
  private readonly xsetPath: string | null
  private readonly powerSaveBlockerProvider: PowerSaveBlockerProvider
  private readonly enforcementIntervalMs: number
  private powerSaveBlockerId?: number
  private enforcementTimer?: NodeJS.Timeout
  private scheduleTimer?: NodeJS.Timeout
  private currentSchedule?: PowerSchedule
  private activePowerConfig: PowerConfig = DEFAULT_POWER_CONFIG

  constructor(options: PowerManagerOptions = {}) {
    this.platform = options.platform || os.platform()
    this.isLinux = this.platform === 'linux'
    this.xsetPath = options.xsetPath !== undefined ? options.xsetPath : this.isLinux ? findExecutable('xset') : null
    this.powerSaveBlockerProvider =
      options.powerSaveBlocker !== undefined ? () => options.powerSaveBlocker || null : getPowerSaveBlocker
    this.enforcementIntervalMs = options.enforcementIntervalMs || DEFAULT_SLEEP_PREVENTION_ENFORCEMENT_MS
    logger.info(
      {
        platform: this.platform,
        isLinux: this.isLinux,
        xsetAvailable: Boolean(this.xsetPath),
      },
      'Power manager initialized'
    )
  }

  getCapabilities(): PowerCapabilities {
    return {
      platform: this.platform,
      dpmsControl: Boolean(this.xsetPath),
      preventBlanking: Boolean(this.xsetPath) || Boolean(this.powerSaveBlockerProvider()),
      displayEnumeration: true,
    }
  }

  /**
   * Initialize power manager
   */
  async initialize(powerConfig: PowerConfig = DEFAULT_POWER_CONFIG): Promise<void> {
    logger.info(
      {
        preventBlanking: powerConfig.preventBlanking,
        dpmsEnabled: powerConfig.dpmsEnabled,
        scheduleEnabled: powerConfig.scheduleEnabled,
      },
      'Initializing power manager'
    )

    try {
      this.activePowerConfig = { ...DEFAULT_POWER_CONFIG, ...powerConfig }

      if (this.activePowerConfig.preventBlanking) {
        await this.enforceSleepPrevention('initialize')
        this.startSleepPreventionEnforcement()
      } else {
        this.stopSleepPreventionEnforcement()
        this.unblockPowerSave()
        logger.info('Screen blanking prevention disabled by configuration')
      }

      this.setSchedule({
        enabled: this.activePowerConfig.scheduleEnabled,
        onTime: this.activePowerConfig.onTime,
        offTime: this.activePowerConfig.offTime,
      })

      logger.info('Power manager initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize power manager')
      throw error
    }
  }

  /**
   * Keep app-owned sleep prevention active while the player is running.
   */
  private async enforceSleepPrevention(source: 'initialize' | 'watchdog'): Promise<void> {
    if (!this.activePowerConfig.preventBlanking) {
      return
    }

    this.blockPowerSave()
    await this.preventScreenBlanking()

    if (this.isLinux && this.activePowerConfig.dpmsEnabled) {
      await this.disableDPMS()
    }

    logger.debug({ source }, 'Sleep prevention enforced')
  }

  private startSleepPreventionEnforcement(): void {
    if (this.enforcementTimer) {
      return
    }

    this.enforcementTimer = setInterval(() => {
      void this.enforceSleepPrevention('watchdog').catch((error) => {
        logger.warn({ error }, 'Failed to enforce sleep prevention')
      })
    }, this.enforcementIntervalMs)

    if (typeof this.enforcementTimer.unref === 'function') {
      this.enforcementTimer.unref()
    }
  }

  private stopSleepPreventionEnforcement(): void {
    if (!this.enforcementTimer) {
      return
    }

    clearInterval(this.enforcementTimer)
    this.enforcementTimer = undefined
  }

  /**
   * Prevent screen blanking
   */
  private async preventScreenBlanking(): Promise<void> {
    if (!this.isLinux || !this.xsetPath) {
      logger.debug('Screen blanking prevention not available on this platform')
      return
    }

    try {
      // Disable screen saver
      await execAsync(`${this.xsetPath} s off`)
      logger.info('Screen saver disabled')

      // Disable screen blanking
      await execAsync(`${this.xsetPath} s noblank`)
      logger.info('Screen blanking disabled')
    } catch (error) {
      logger.warn({ error }, 'Failed to prevent screen blanking (xset may not be available)')
    }
  }

  /**
   * Disable DPMS (Display Power Management Signaling)
   */
  private async disableDPMS(): Promise<void> {
    if (!this.isLinux || !this.xsetPath) {
      logger.debug('DPMS control not available on this platform')
      return
    }

    try {
      await execAsync(`${this.xsetPath} -dpms`)
      logger.info('DPMS disabled')
    } catch (error) {
      logger.warn({ error }, 'Failed to disable DPMS (xset may not be available)')
    }
  }

  /**
   * Enable DPMS
   */
  async enableDPMS(): Promise<void> {
    if (!this.isLinux || !this.xsetPath) {
      logger.debug('DPMS control not available on this platform')
      return
    }

    try {
      await execAsync(`${this.xsetPath} +dpms`)
      logger.info('DPMS enabled')
    } catch (error) {
      logger.error({ error }, 'Failed to enable DPMS')
      throw error
    }
  }

  /**
   * Block power save using Electron's powerSaveBlocker
   */
  private blockPowerSave(): void {
    const powerSaveBlocker = this.powerSaveBlockerProvider()
    if (!powerSaveBlocker) {
      logger.warn('Electron powerSaveBlocker is not available; display sleep prevention is limited to platform tools')
      return
    }

    if (this.powerSaveBlockerId !== undefined && powerSaveBlocker.isStarted(this.powerSaveBlockerId)) {
      logger.debug('Power save already blocked')
      return
    }

    if (this.powerSaveBlockerId !== undefined) {
      logger.warn({ blockerId: this.powerSaveBlockerId }, 'Power save blocker stopped unexpectedly; restarting')
      this.powerSaveBlockerId = undefined
    }

    try {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep')
      logger.info({ blockerId: this.powerSaveBlockerId }, 'Power save blocked')
    } catch (error) {
      logger.error({ error }, 'Failed to block power save')
    }
  }

  /**
   * Unblock power save
   */
  private unblockPowerSave(): void {
    if (this.powerSaveBlockerId === undefined) {
      return
    }

    const powerSaveBlocker = this.powerSaveBlockerProvider()
    if (!powerSaveBlocker) {
      logger.warn({ blockerId: this.powerSaveBlockerId }, 'Electron powerSaveBlocker unavailable during unblock')
      this.powerSaveBlockerId = undefined
      return
    }

    try {
      powerSaveBlocker.stop(this.powerSaveBlockerId)
      logger.info({ blockerId: this.powerSaveBlockerId }, 'Power save unblocked')
      this.powerSaveBlockerId = undefined
    } catch (error) {
      logger.error({ error }, 'Failed to unblock power save')
    }
  }

  /**
   * Turn display on
   */
  async turnDisplayOn(): Promise<void> {
    logger.info('Turning display on')

    if (!this.isLinux || !this.xsetPath) {
      logger.debug('Display control not available on this platform')
      return
    }

    try {
      // Force display on using xset
      await execAsync(`${this.xsetPath} dpms force on`)
      logger.info('Display turned on')
    } catch (error) {
      logger.error({ error }, 'Failed to turn display on')
      throw error
    }
  }

  /**
   * Turn display off
   */
  async turnDisplayOff(): Promise<void> {
    logger.info('Turning display off')

    if (!this.isLinux || !this.xsetPath) {
      logger.debug('Display control not available on this platform')
      return
    }

    try {
      // Force display off using xset
      await execAsync(`${this.xsetPath} dpms force off`)
      logger.info('Display turned off')
    } catch (error) {
      logger.error({ error }, 'Failed to turn display off')
      throw error
    }
  }

  /**
   * Get display information
   */
  async getDisplayInfo(): Promise<DisplayInfo[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { screen } = require('electron') as typeof import('electron')
      if (!screen || typeof screen.getAllDisplays !== 'function') {
        logger.debug('Electron screen API not available')
        return []
      }

      const primaryId = screen.getPrimaryDisplay()?.id
      const displays = screen.getAllDisplays().map((display) => ({
        name: display.label || `Display ${display.id}`,
        connected: true,
        resolution: `${display.bounds.width}x${display.bounds.height}`,
        primary: display.id === primaryId,
      }))
      logger.debug({ displays }, 'Display information retrieved')
      return displays
    } catch (error) {
      logger.error({ error }, 'Failed to get display information')
      return []
    }
  }

  /**
   * Set power schedule
   */
  setSchedule(schedule: PowerSchedule): void {
    logger.info({ schedule }, 'Setting power schedule')

    this.currentSchedule = schedule

    // Clear existing timer
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer)
      this.scheduleTimer = undefined
    }

    if (!schedule.enabled) {
      logger.info('Power schedule disabled')
      return
    }

    // Schedule next action
    this.scheduleNextAction()
  }

  /**
   * Schedule next power action
   */
  private scheduleNextAction(): void {
    if (!this.currentSchedule || !this.currentSchedule.enabled) {
      return
    }

    const now = new Date()
    const { onTime, offTime } = this.currentSchedule

    let nextAction: 'on' | 'off' | null = null
    let nextTime: Date | null = null

    // Parse times
    if (onTime) {
      const timeParts = onTime.split(':').map(Number)
      const hours = timeParts[0]
      const minutes = timeParts[1]
      if (hours !== undefined && minutes !== undefined) {
        const onDate = new Date(now)
        onDate.setHours(hours, minutes, 0, 0)

        if (onDate > now) {
          nextAction = 'on'
          nextTime = onDate
        }
      }
    }

    if (offTime) {
      const timeParts = offTime.split(':').map(Number)
      const hours = timeParts[0]
      const minutes = timeParts[1]
      if (hours !== undefined && minutes !== undefined) {
        const offDate = new Date(now)
        offDate.setHours(hours, minutes, 0, 0)

        if (offDate > now && (!nextTime || offDate < nextTime)) {
          nextAction = 'off'
          nextTime = offDate
        }
      }
    }

    // If no action today, schedule for tomorrow
    if (!nextTime && (onTime || offTime)) {
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)

      if (onTime) {
        const timeParts = onTime.split(':').map(Number)
        const hours = timeParts[0]
        const minutes = timeParts[1]
        if (hours !== undefined && minutes !== undefined) {
          tomorrow.setHours(hours, minutes, 0, 0)
          nextAction = 'on'
          nextTime = tomorrow
        }
      }
    }

    if (nextTime && nextAction) {
      const delay = nextTime.getTime() - now.getTime()
      logger.info({ nextAction, nextTime: nextTime.toISOString(), delayMs: delay }, 'Scheduling next power action')

      this.scheduleTimer = setTimeout(() => {
        this.executePowerAction(nextAction!)
        this.scheduleNextAction() // Schedule next action
      }, delay)
    }
  }

  /**
   * Execute power action
   */
  private async executePowerAction(action: 'on' | 'off'): Promise<void> {
    logger.info({ action }, 'Executing power action')

    try {
      if (action === 'on') {
        await this.turnDisplayOn()
      } else {
        await this.turnDisplayOff()
      }
    } catch (error) {
      logger.error({ error, action }, 'Failed to execute power action')
    }
  }

  /**
   * Get current schedule
   */
  getSchedule(): PowerSchedule | undefined {
    return this.currentSchedule
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    logger.info('Cleaning up power manager')

    // Clear schedule timer
    if (this.scheduleTimer) {
      clearTimeout(this.scheduleTimer)
      this.scheduleTimer = undefined
    }

    this.stopSleepPreventionEnforcement()

    // Unblock power save
    this.unblockPowerSave()
  }
}

// Singleton instance
let powerManager: PowerManager | null = null

export function getPowerManager(): PowerManager {
  if (!powerManager) {
    powerManager = new PowerManager()
  }
  return powerManager
}
