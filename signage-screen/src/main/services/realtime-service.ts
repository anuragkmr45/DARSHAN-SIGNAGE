import { EventEmitter } from 'events'
import WebSocket from 'ws'
import { getConfigManager } from '../../common/config'
import { getLogger } from '../../common/logger'
import { CommandType } from '../../common/types'
import { ExponentialBackoff } from '../../common/utils'
import { getCommandProcessor } from './command-processor'
import { getDeviceStateStore } from './device-state-store'
import { getHttpClient } from './network/http-client'
import { getPairingService } from './pairing-service'
import { getDefaultMediaService } from './settings/default-media-service'
import { getSnapshotManager } from './snapshot-manager'

const logger = getLogger('realtime-service')

export type RealtimeConnectionState = 'disabled' | 'disconnected' | 'connecting' | 'connected'

type RealtimeNotificationType = 'HELLO_ACK' | 'COMMAND_AVAILABLE' | 'RESYNC_REQUIRED' | 'SERVER_TIME' | 'ERROR'

export type RealtimeNotification = {
  type: RealtimeNotificationType
  device_id?: string
  state_version?: number | null
  command_version?: number | null
  command_hint?: {
    command_id?: string | null
    command_type?: CommandType | string | null
    priority?: number | null
    reason?: string | null
  }
  reason?: string
  resources?: string[]
  sent_at?: string
  [key: string]: unknown
}

export type DesiredStateResponse = {
  device_id: string
  server_time?: string
  state: {
    state_version: number
    command_version: number
    snapshot_id: string | null
    default_media_version: string | null
    emergency_version: string | null
    last_command_id: string | null
    last_command_type: string | null
    last_command_reason: string | null
    last_changed_reason: string | null
    updated_at: string | null
  }
  resources?: {
    commands?: string
    snapshot?: string
    default_media?: string
  }
}

export interface RealtimeTransport extends EventEmitter {
  connect(): Promise<void>
  disconnect(): void
  sendEvent(event: string, payload: unknown): void
  isConnected(): boolean
}

function normalizeNamespace(value?: string): string {
  const namespace = value && value.startsWith('/') ? value : '/device'
  return namespace === '/' ? '' : namespace
}

function encodeSocketIoPacket(namespace: string, event: string, payload: unknown): string {
  const normalizedNamespace = normalizeNamespace(namespace)
  return `42${normalizedNamespace},${JSON.stringify([event, payload])}`
}

function parseSocketIoPacket(raw: string, namespace: string): { event: string; payload: unknown } | null {
  const normalizedNamespace = normalizeNamespace(namespace)
  const prefix = `42${normalizedNamespace},`
  if (!raw.startsWith(prefix)) {
    return null
  }

  const parsed = JSON.parse(raw.slice(prefix.length))
  if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
    return null
  }

  return {
    event: parsed[0],
    payload: parsed[1] ?? null,
  }
}

export class SocketIoDeviceTransport extends EventEmitter implements RealtimeTransport {
  private ws: WebSocket | null = null
  private readonly wsUrl: string
  private readonly namespace: string
  private readonly auth: Record<string, string>
  private connected = false

  constructor(input: { wsUrl: string; namespace: string; auth: Record<string, string> }) {
    super()
    this.wsUrl = input.wsUrl
    this.namespace = normalizeNamespace(input.namespace)
    this.auth = input.auth
  }

  async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error('Realtime Socket.IO transport connect timeout'))
        }
      }, 10000)

      this.ws = new WebSocket(this.wsUrl, {
        handshakeTimeout: 10000,
      })

      this.ws.on('open', () => {
        this.ws?.send(`40${this.namespace},${JSON.stringify(this.auth)}`)
      })

      this.ws.on('message', (data) => {
        const packet = data.toString()
        if (packet === '2') {
          this.ws?.send('3')
          return
        }

        if (packet.startsWith(`40${this.namespace}`)) {
          this.connected = true
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            resolve()
          }
          this.emit('connect')
          return
        }

        if (packet.startsWith(`44${this.namespace}`)) {
          const error = new Error('Realtime Socket.IO namespace rejected connection')
          this.emit('error', error)
          if (!settled) {
            settled = true
            clearTimeout(timeout)
            reject(error)
          }
          return
        }

        const eventPacket = parseSocketIoPacket(packet, this.namespace)
        if (eventPacket) {
          this.emit(eventPacket.event, eventPacket.payload)
        }
      })

      this.ws.on('close', (code, reason) => {
        this.connected = false
        this.emit('disconnect', { code, reason: reason.toString() })
      })

      this.ws.on('error', (error) => {
        this.emit('error', error)
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(error)
        }
      })
    })
  }

  disconnect(): void {
    this.connected = false
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
  }

  sendEvent(event: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.connected) {
      return
    }

    this.ws.send(encodeSocketIoPacket(this.namespace, event, payload))
  }

  isConnected(): boolean {
    return this.connected
  }
}

export class RealtimeService extends EventEmitter {
  private state: RealtimeConnectionState = 'disabled'
  private transport?: RealtimeTransport
  private reconnectTimer?: NodeJS.Timeout
  private desiredStateTimer?: NodeJS.Timeout
  private helloAckTimer?: NodeJS.Timeout
  private started = false
  private readonly reconnectBackoff: ExponentialBackoff

  constructor(transport?: RealtimeTransport) {
    super()
    const realtime = getConfigManager().getConfig().realtime
    this.reconnectBackoff = new ExponentialBackoff(
      realtime?.reconnectMinMs || 1000,
      realtime?.reconnectMaxMs || 60000,
      10,
      0.2
    )
    this.transport = transport
  }

  start(): void {
    const config = getConfigManager().getConfig()
    if (!config.realtime?.enabled) {
      this.state = 'disabled'
      getCommandProcessor().setRealtimeHealthy(false)
      logger.info('Realtime sync disabled; polling fallback remains active')
      return
    }

    if (this.started) {
      return
    }

    this.started = true
    this.state = 'disconnected'
    void this.connect()
  }

  stop(): void {
    this.started = false
    this.state = getConfigManager().getConfig().realtime?.enabled ? 'disconnected' : 'disabled'
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.desiredStateTimer) {
      clearTimeout(this.desiredStateTimer)
      this.desiredStateTimer = undefined
    }
    if (this.helloAckTimer) {
      clearTimeout(this.helloAckTimer)
      this.helloAckTimer = undefined
    }
    this.transport?.disconnect()
    getCommandProcessor().setRealtimeHealthy(false)
  }

  getState(): RealtimeConnectionState {
    return this.state
  }

  isHealthy(): boolean {
    return this.state === 'connected' && this.transport?.isConnected() === true
  }

  async handleNotification(notification: RealtimeNotification): Promise<void> {
    if (!this.isValidNotification(notification)) {
      logger.warn({ type: notification?.type }, 'Ignoring invalid realtime notification')
      return
    }

    switch (notification.type) {
      case 'COMMAND_AVAILABLE':
        if (!(await this.reconcileDesiredState('command-available'))) {
          await getCommandProcessor().pollNow('realtime')
        }
        break
      case 'HELLO_ACK':
        await this.handleHelloAck(notification)
        break
      case 'RESYNC_REQUIRED':
        await this.reconcileDesiredState(notification.reason || 'resync-required')
        break
      case 'SERVER_TIME':
        break
      case 'ERROR':
        logger.warn({ notification }, 'Realtime gateway error notification')
        break
      default:
        break
    }
  }

  async reconcileDesiredState(reason: string): Promise<DesiredStateResponse | null> {
    const deviceId = getPairingService().getDeviceId()
    if (!deviceId) {
      return null
    }

    try {
      const desired = await getHttpClient().get<DesiredStateResponse>(`/api/v1/device/${deviceId}/desired-state`, {
        retryPolicy: {
          maxAttempts: 3,
          baseDelayMs: 1000,
          maxDelayMs: 10000,
        },
      })

      await this.applyDesiredState(desired, reason)
      return desired
    } catch (error) {
      logger.warn({ error, reason }, 'Desired-state reconciliation failed')
      return null
    }
  }

  private async connect(): Promise<void> {
    if (!this.started) {
      return
    }

    const transport = this.transport || this.createDefaultTransport()
    this.transport = transport
    this.bindTransport(transport)
    this.state = 'connecting'

    try {
      await transport.connect()
      this.reconnectBackoff.reset()
      this.sendHello()
      this.startHelloAckTimeout()
    } catch (error) {
      logger.warn({ error }, 'Realtime connection failed; polling fallback remains active')
      this.state = 'disconnected'
      getCommandProcessor().setRealtimeHealthy(false)
      this.scheduleReconnect()
    }
  }

  private createDefaultTransport(): RealtimeTransport {
    const config = getConfigManager().getConfig()
    const deviceId = getPairingService().getDeviceId()
    const authValue = getPairingService().getDeviceAuthHeaderValue()
    if (!deviceId || !authValue) {
      throw new Error('Realtime requires paired device identity')
    }

    return new SocketIoDeviceTransport({
      wsUrl: this.buildSocketIoUrl(config.realtime?.wsUrl || config.wsUrl || config.apiBase),
      namespace: config.realtime?.deviceNamespace || '/device',
      auth: {
        device_id: deviceId,
        device_serial: authValue,
      },
    })
  }

  private buildSocketIoUrl(baseUrl: string): string {
    const parsed = new URL(baseUrl)
    parsed.protocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'wss:' : 'ws:'
    parsed.pathname = '/socket.io/'
    parsed.search = 'EIO=4&transport=websocket'
    parsed.hash = ''
    return parsed.toString()
  }

  private bindTransport(transport: RealtimeTransport): void {
    transport.removeAllListeners('COMMAND_AVAILABLE')
    transport.removeAllListeners('HELLO_ACK')
    transport.removeAllListeners('RESYNC_REQUIRED')
    transport.removeAllListeners('SERVER_TIME')
    transport.removeAllListeners('ERROR')
    transport.removeAllListeners('disconnect')
    transport.removeAllListeners('error')

    transport.on('HELLO_ACK', (payload) => {
      void this.handleNotification(payload as RealtimeNotification)
    })
    transport.on('COMMAND_AVAILABLE', (payload) => {
      void this.handleNotification(payload as RealtimeNotification)
    })
    transport.on('RESYNC_REQUIRED', (payload) => {
      void this.handleNotification(payload as RealtimeNotification)
    })
    transport.on('SERVER_TIME', (payload) => {
      void this.handleNotification(payload as RealtimeNotification)
    })
    transport.on('ERROR', (payload) => {
      void this.handleNotification(payload as RealtimeNotification)
    })
    transport.on('disconnect', (event) => {
      logger.warn({ event }, 'Realtime disconnected; returning to fallback polling')
      this.state = 'disconnected'
      getCommandProcessor().setRealtimeHealthy(false)
      this.scheduleReconnect()
    })
    transport.on('error', (error) => {
      logger.warn({ error }, 'Realtime transport error')
    })
  }

  private sendHello(): void {
    const pairingService = getPairingService()
    const storeState = getDeviceStateStore().getState()
    this.transport?.sendEvent('HELLO', {
      type: 'HELLO',
      protocol_version: '1.0',
      device_id: pairingService.getDeviceId(),
      session_id: `electron-${process.pid}`,
      app: {
        name: 'signhex-electron',
        version: pairingService.getDeviceInfo().appVersion,
      },
      platform: {
        family: 'electron',
        os: process.platform,
        arch: process.arch,
      },
      capabilities: {
        commands: ['REFRESH', 'REFRESH_SCHEDULE', 'RESYNC', 'REBOOT', 'SCREENSHOT', 'TAKE_SCREENSHOT', 'CLEAR_CACHE', 'PING'],
        screenshot: true,
        log_upload: true,
        offline_startup: true,
        background_push: false,
      },
      local_state: {
        snapshot_id: getSnapshotManager().getCurrentPlaylist()?.snapshotId ?? storeState.lastDesiredSnapshotId ?? null,
        default_media_version: storeState.lastDesiredDefaultMediaVersion ?? null,
        emergency_version: storeState.lastDesiredEmergencyVersion ?? null,
        command_seq: storeState.lastDesiredCommandVersion ?? 0,
        desired_state_version: storeState.lastDesiredStateVersion ?? 0,
      },
      sent_at: new Date().toISOString(),
    })
  }

  private startHelloAckTimeout(): void {
    if (this.helloAckTimer) {
      clearTimeout(this.helloAckTimer)
    }

    this.helloAckTimer = setTimeout(() => {
      logger.warn('Realtime HELLO_ACK timeout; reconnecting through fallback path')
      this.transport?.disconnect()
      this.state = 'disconnected'
      getCommandProcessor().setRealtimeHealthy(false)
      this.scheduleReconnect()
    }, 10000)
  }

  private async handleHelloAck(_notification: RealtimeNotification): Promise<void> {
    if (this.helloAckTimer) {
      clearTimeout(this.helloAckTimer)
      this.helloAckTimer = undefined
    }

    this.state = 'connected'
    getCommandProcessor().setRealtimeHealthy(true)
    await getDeviceStateStore().update({ lastRealtimeConnectedAt: new Date().toISOString() })
    await getCommandProcessor().pollNow('realtime')
    await this.reconcileDesiredState('realtime-connected')
    this.scheduleDesiredStatePoll()
    this.emit('connected')
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer || getConfigManager().getConfig().realtime?.enabled !== true) {
      return
    }

    const delay = this.reconnectBackoff.getDelay()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.connect()
    }, delay)
  }

  private scheduleDesiredStatePoll(): void {
    if (!this.started || this.state !== 'connected') {
      return
    }

    if (this.desiredStateTimer) {
      clearTimeout(this.desiredStateTimer)
    }

    const interval = getConfigManager().getConfig().realtime?.desiredStatePollMs || 300000
    this.desiredStateTimer = setTimeout(() => {
      this.reconcileDesiredState('safety-poll')
        .catch((error) => logger.warn({ error }, 'Desired-state safety poll failed'))
        .finally(() => this.scheduleDesiredStatePoll())
    }, interval)
  }

  private isValidNotification(notification: RealtimeNotification): boolean {
    if (!notification || typeof notification !== 'object') {
      return false
    }

    const encodedSize = Buffer.byteLength(JSON.stringify(notification), 'utf8')
    const maxBytes = getConfigManager().getConfig().realtime?.notificationMaxBytes || 32768
    if (encodedSize > maxBytes) {
      return false
    }

    if ('snapshot' in notification || 'media' in notification || 'media_bytes' in notification) {
      return false
    }

    return ['HELLO_ACK', 'COMMAND_AVAILABLE', 'RESYNC_REQUIRED', 'SERVER_TIME', 'ERROR'].includes(notification.type)
  }

  private async applyDesiredState(desired: DesiredStateResponse, reason: string): Promise<void> {
    const current = getDeviceStateStore().getState()
    const state = desired.state

    const commandChanged = state.command_version > (current.lastDesiredCommandVersion ?? 0)
    const snapshotChanged = state.snapshot_id !== (current.lastDesiredSnapshotId ?? null)
    const defaultMediaChanged = state.default_media_version !== (current.lastDesiredDefaultMediaVersion ?? null)
    const emergencyChanged = state.emergency_version !== (current.lastDesiredEmergencyVersion ?? null)

    if (commandChanged) {
      await getCommandProcessor().pollNow('realtime')
    }

    if (snapshotChanged || emergencyChanged) {
      await getSnapshotManager().refreshSnapshot()
    }

    if (defaultMediaChanged) {
      await getDefaultMediaService().refreshNow(`desired-state:${reason}`)
    }

    await getDeviceStateStore().update({
      lastDesiredStateVersion: state.state_version,
      lastDesiredCommandVersion: state.command_version,
      lastDesiredSnapshotId: state.snapshot_id,
      lastDesiredDefaultMediaVersion: state.default_media_version,
      lastDesiredEmergencyVersion: state.emergency_version,
      lastDesiredStateAt: desired.server_time || new Date().toISOString(),
    })
  }
}

let realtimeService: RealtimeService | null = null

export function getRealtimeService(): RealtimeService {
  if (!realtimeService) {
    realtimeService = new RealtimeService()
  }
  return realtimeService
}

export function resetRealtimeService(): void {
  realtimeService?.stop()
  realtimeService = null
}
