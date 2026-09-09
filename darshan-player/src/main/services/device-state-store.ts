import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { getConfigManager } from '../../common/config'
import { CommandResult, CommandSource, DeviceStateRecord, PlayerState, RecentCommandRecord } from '../../common/types'
import { atomicWrite, ensureDir } from '../../common/utils'
import { getLogger } from '../../common/logger'

const logger = getLogger('device-state-store')

const MAX_RECENT_COMMANDS = 200
const RECENT_COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_COMMAND_RESULT_JSON_BYTES = 16 * 1024
const MAX_COMMAND_RESULT_TEXT_LENGTH = 2048

export interface IdentitySnapshot {
  deviceIdPresent: boolean
  fingerprintPresent: boolean
  keyPresent: boolean
  certPresent: boolean
  caPresent: boolean
}

export type IdentityHealth = 'missing' | 'partial' | 'complete'

export class DeviceStateStore {
  private readonly statePath: string
  private state: DeviceStateRecord
  private readonly emitter = new EventEmitter()

  constructor(statePath?: string) {
    this.statePath = statePath || this.getDefaultStatePath()
    this.state = this.loadState()
  }

  private getDefaultStatePath(): string {
    const configPath = getConfigManager().getConfigPath()
    return path.join(path.dirname(configPath), 'device-state.json')
  }

  private loadState(): DeviceStateRecord {
    try {
      if (!fs.existsSync(this.statePath)) {
        return {}
      }

      const raw = fs.readFileSync(this.statePath, 'utf-8')
      const parsed = JSON.parse(raw) as DeviceStateRecord
      return {
        ...parsed,
        recentCommands: Array.isArray(parsed.recentCommands) ? parsed.recentCommands : [],
      }
    } catch (error) {
      logger.error({ error, statePath: this.statePath }, 'Failed to load device state')
      return {}
    }
  }

  private async persist(): Promise<void> {
    ensureDir(path.dirname(this.statePath), 0o755)
    await atomicWrite(this.statePath, JSON.stringify(this.state, null, 2))
  }

  getState(): DeviceStateRecord {
    return {
      ...this.state,
      recentCommands: [...(this.state.recentCommands || [])],
    }
  }

  async update(patch: Partial<DeviceStateRecord>): Promise<DeviceStateRecord> {
    this.state = {
      ...this.state,
      ...patch,
      recentCommands: patch.recentCommands ? [...patch.recentCommands] : [...(this.state.recentCommands || [])],
    }

    await this.persist()
    this.emitter.emit('change', this.getState())
    return this.getState()
  }

  async ensureInstallInstanceId(): Promise<string> {
    if (this.state.installInstanceId) {
      return this.state.installInstanceId
    }

    const installInstanceId = randomUUID()
    await this.update({ installInstanceId })
    return installInstanceId
  }

  async clearPairingMetadata(): Promise<DeviceStateRecord> {
    return await this.update({
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      activePairingMode: undefined,
      pairingRequestInDoubtAt: undefined,
    })
  }

  async clearIdentity(reason?: string): Promise<DeviceStateRecord> {
    return await this.update({
      lifecycleState: undefined,
      deviceId: undefined,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      activePairingMode: undefined,
      fingerprint: undefined,
      lastSuccessfulPairingAt: undefined,
      lastHeartbeatAt: undefined,
      recoveryReason: reason,
      installInstanceId: undefined,
      duplicateIdentity: undefined,
      hardRecoveryDeadlineAt: undefined,
      pairingRequestInDoubtAt: undefined,
      recentCommands: [],
      lastObservedStateVersion: undefined,
      lastAppliedStateVersion: undefined,
      lastDesiredStateVersion: undefined,
      lastDesiredCommandVersion: undefined,
      lastDesiredSnapshotId: undefined,
      lastDesiredDefaultMediaVersion: undefined,
      lastDesiredEmergencyVersion: undefined,
      lastDesiredDisplaySelectionVersion: undefined,
      lastDesiredStateAt: undefined,
      lastRealtimeConnectedAt: undefined,
      lastPairingValidationStatus: undefined,
      lastPairingValidatedAt: undefined,
      lastValidatedDeviceId: undefined,
      lastValidatedServerIdentity: undefined,
    })
  }

  async setLifecycleState(state: PlayerState, extras: Partial<DeviceStateRecord> = {}): Promise<DeviceStateRecord> {
    return await this.update({
      ...extras,
      lifecycleState: state,
    })
  }

  async recordCommandSeen(commandId: string, source: CommandSource, deliveryToken?: string): Promise<void> {
    const now = new Date().toISOString()
    const current = this.state.recentCommands || []
    const existingIndex = current.findIndex(
      (entry) => entry.id === commandId && (entry.deliveryToken || '') === (deliveryToken || '')
    )
    let next: RecentCommandRecord[]

    if (existingIndex >= 0) {
      next = current.map((entry, index) =>
        index === existingIndex
          ? {
              ...entry,
              deliveryToken: deliveryToken || entry.deliveryToken,
              lastSeenAt: now,
              source,
            }
          : entry
      )
    } else {
      next = [
        ...current,
        {
          id: commandId,
          deliveryToken,
          firstSeenAt: now,
          lastSeenAt: now,
          source,
        },
      ]
    }

    await this.update({
      recentCommands: this.pruneRecentCommands(next),
    })
  }

  async recordCommandAcknowledged(commandId: string, deliveryToken?: string): Promise<void> {
    const now = new Date().toISOString()
    const next = (this.state.recentCommands || []).map((entry) =>
      entry.id === commandId
        ? {
            ...entry,
            deliveryToken: deliveryToken || entry.deliveryToken,
            acknowledgedAt: now,
            lastSeenAt: now,
          }
        : entry
    )

    await this.update({
      recentCommands: this.pruneRecentCommands(next),
    })
  }

  async recordCommandCompleted(commandId: string, deliveryToken: string | undefined, result: CommandResult): Promise<void> {
    const now = new Date().toISOString()
    const persistedResult = this.toPersistedCommandResult(result)
    const current = this.state.recentCommands || []
    const existingIndex = current.findIndex((entry) => entry.id === commandId)
    let next: RecentCommandRecord[]

    if (existingIndex >= 0) {
      next = current.map((entry, index) =>
        index === existingIndex
          ? {
              ...entry,
              deliveryToken: deliveryToken || entry.deliveryToken,
              lastSeenAt: now,
              completedAt: now,
              lastResult: persistedResult,
            }
          : entry
      )
    } else {
      next = [
        ...current,
        {
          id: commandId,
          deliveryToken,
          firstSeenAt: now,
          lastSeenAt: now,
          source: 'poll',
          completedAt: now,
          lastResult: persistedResult,
        },
      ]
    }

    await this.update({
      recentCommands: this.pruneRecentCommands(next),
    })
  }

  getCompletedCommandResult(commandId: string): CommandResult | null {
    const record = (this.state.recentCommands || []).find(
      (entry) => entry.id === commandId && !entry.acknowledgedAt && entry.completedAt && entry.lastResult
    )
    return record?.lastResult ? { ...record.lastResult, data: record.lastResult.data ? { ...record.lastResult.data } : undefined } : null
  }

  hasRecentCommand(commandId: string, deliveryToken?: string): boolean {
    return (this.state.recentCommands || []).some((entry) => {
      if (entry.id !== commandId) {
        return false
      }
      if (entry.acknowledgedAt) {
        return true
      }
      if (!deliveryToken) {
        return true
      }
      return entry.deliveryToken === deliveryToken
    })
  }

  getIdentitySnapshot(paths: { key: string; cert: string; ca: string }): IdentitySnapshot {
    return {
      deviceIdPresent: Boolean(this.state.deviceId),
      fingerprintPresent: Boolean(this.state.fingerprint),
      keyPresent: fs.existsSync(paths.key),
      certPresent: fs.existsSync(paths.cert),
      caPresent: fs.existsSync(paths.ca),
    }
  }

  classifyIdentity(snapshot: IdentitySnapshot): { health: IdentityHealth; issues: string[] } {
    const issues: string[] = []

    if (snapshot.deviceIdPresent && !snapshot.keyPresent) {
      issues.push('Persisted device id exists but private key is missing')
    }
    if (snapshot.keyPresent && !snapshot.certPresent) {
      issues.push('Private key exists but certificate is missing')
    }
    if (snapshot.certPresent && !snapshot.fingerprintPresent) {
      issues.push('Certificate exists but fingerprint is missing')
    }
    if (snapshot.fingerprintPresent && !snapshot.certPresent) {
      issues.push('Fingerprint exists but certificate is missing')
    }
    if ((snapshot.certPresent || snapshot.caPresent) && !snapshot.keyPresent) {
      issues.push('Certificate material exists but private key is missing')
    }

    const presentValues = [
      snapshot.deviceIdPresent,
      snapshot.fingerprintPresent,
      snapshot.keyPresent,
      snapshot.certPresent,
      snapshot.caPresent,
    ]
    const anyPresent = presentValues.some(Boolean)
    const allPresent = presentValues.every(Boolean)

    if (allPresent) {
      return { health: 'complete', issues }
    }
    if (anyPresent) {
      return { health: 'partial', issues: issues.length > 0 ? issues : ['Device identity is incomplete'] }
    }
    return { health: 'missing', issues: [] }
  }

  onChange(listener: (state: DeviceStateRecord) => void): () => void {
    this.emitter.on('change', listener)
    return () => this.emitter.off('change', listener)
  }

  private pruneRecentCommands(entries: RecentCommandRecord[]): RecentCommandRecord[] {
    const cutoff = Date.now() - RECENT_COMMAND_RETENTION_MS
    const filtered = entries.filter((entry) => {
      const lastSeen = Date.parse(entry.lastSeenAt)
      return !Number.isNaN(lastSeen) && lastSeen >= cutoff
    })

    if (filtered.length <= MAX_RECENT_COMMANDS) {
      return filtered
    }

    return filtered.slice(filtered.length - MAX_RECENT_COMMANDS)
  }

  private toPersistedCommandResult(result: CommandResult): CommandResult {
    const persisted: CommandResult = {
      success: result.success,
      timestamp: result.timestamp,
      ...(typeof result.message === 'string' ? { message: this.truncateResultText(result.message) } : {}),
      ...(typeof result.error === 'string' ? { error: this.truncateResultText(result.error) } : {}),
      ...(result.data ? { data: { ...result.data } } : {}),
    }

    const encoded = Buffer.byteLength(JSON.stringify(persisted), 'utf8')
    if (encoded <= MAX_COMMAND_RESULT_JSON_BYTES) {
      return persisted
    }

    return {
      ...persisted,
      data: {
        omitted: true,
        reason: 'COMMAND_RESULT_TOO_LARGE_FOR_LOCAL_LEDGER',
        originalBytes: encoded,
      },
    }
  }

  private truncateResultText(value: string): string {
    if (value.length <= MAX_COMMAND_RESULT_TEXT_LENGTH) {
      return value
    }
    return `${value.slice(0, MAX_COMMAND_RESULT_TEXT_LENGTH)}…`
  }
}

let deviceStateStore: DeviceStateStore | null = null

export function getDeviceStateStore(): DeviceStateStore {
  if (!deviceStateStore) {
    deviceStateStore = new DeviceStateStore()
  }
  return deviceStateStore
}

export function resetDeviceStateStore(): void {
  deviceStateStore = null
}
