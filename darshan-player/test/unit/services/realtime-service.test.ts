const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { EventEmitter } = require('events')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

class FakeRealtimeTransport extends EventEmitter {
  connected = false
  events: Array<{ event: string; payload: any }> = []

  async connect() {
    this.connected = true
  }

  disconnect() {
    this.connected = false
    this.emit('disconnect', { code: 1000, reason: 'test' })
  }

  sendEvent(event: string, payload: any) {
    this.events.push({ event, payload })
    if (event === 'HELLO') {
      setImmediate(() => {
        this.emit('HELLO_ACK', {
          type: 'HELLO_ACK',
          device_id: payload.device_id,
          protocol_version: '1.0',
          server_time: new Date().toISOString(),
        })
      })
    }
  }

  isConnected() {
    return this.connected
  }
}

describe('Realtime Service', () => {
  let tempDir: string
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('realtime-service-test-')

    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    fs.writeFileSync(
      process.env.HEXMON_CONFIG_PATH,
      JSON.stringify(
        {
          apiBase: 'https://api-test.darshan.com',
          wsUrl: 'wss://api-test.darshan.com/ws',
          deviceId: 'device-1',
          realtime: {
            enabled: true,
            deviceNamespace: '/device',
            commandSafetyPollMs: 60000,
            desiredStatePollMs: 300000,
            reconnectMinMs: 1000,
            reconnectMaxMs: 60000,
            pingIntervalMs: 25000,
            notificationMaxBytes: 32768,
          },
          mtls: {
            enabled: false,
            certPath: path.join(tempDir, 'client.crt'),
            keyPath: path.join(tempDir, 'client.key'),
            caPath: path.join(tempDir, 'ca.crt'),
          },
          cache: {
            path: path.join(tempDir, 'cache'),
            maxBytes: 10485760,
          },
          intervals: {
            heartbeatMs: 30000,
            commandPollMs: 5000,
            schedulePollMs: 60000,
            defaultMediaPollMs: 60000,
            healthCheckMs: 60000,
            screenshotMs: 300000,
          },
        },
        null,
        2
      )
    )

    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  afterEach(() => {
    sandbox.restore()
    cleanupTempDir(tempDir)
    delete process.env.HEXMON_CONFIG_PATH
    delete process.env.DARSHAN_REALTIME_SIGNED_AUTH_ENABLED
    delete process.env.HEXMON_REALTIME_SIGNED_AUTH_ENABLED

    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  function createFakeSocketAuthCertificateManager(
    options: {
      hasPrivateKey?: boolean
      areCertificatesPresent?: boolean
      failSigning?: boolean
    } = {}
  ) {
    const calls: any[] = []
    return {
      calls,
      manager: {
        hasPrivateKey: () => options.hasPrivateKey ?? true,
        areCertificatesPresent: () => options.areCertificatesPresent ?? true,
        signDeviceSocketAuth: async (params: any) => {
          calls.push(params)
          if (options.failSigning) {
            throw new Error('signing failed')
          }
          return Buffer.from(`signature:${params.nonce}`).toString('base64')
        },
      },
    }
  }

  it('keeps realtime socket auth legacy-only by default', async () => {
    const { getConfigManager } = require('../../../src/common/config')
    const { buildRealtimeDeviceSocketAuth } = require('../../../src/main/services/realtime-service')

    expect(getConfigManager().getConfig().realtime.signedAuthEnabled).to.equal(false)

    const auth = await buildRealtimeDeviceSocketAuth({
      deviceId: 'device-1',
      deviceSerial: 'serial-1',
      signedAuthEnabled: false,
    })

    expect(auth).to.deep.equal({
      device_id: 'device-1',
      device_serial: 'serial-1',
    })
  })

  it('reads the realtime signed auth player flag from environment', () => {
    process.env.DARSHAN_REALTIME_SIGNED_AUTH_ENABLED = 'true'
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/common')) {
        delete require.cache[key]
      }
    })

    const { getConfigManager } = require('../../../src/common/config')

    expect(getConfigManager().getConfig().realtime.signedAuthEnabled).to.equal(true)
  })

  it('builds the exact realtime socket auth canonical payload', () => {
    const { buildDeviceSocketAuthPayload } = require('../../../src/main/services/cert-manager')

    const payload = buildDeviceSocketAuthPayload({
      deviceId: 'device-1',
      serial: 'serial-1',
      timestamp: '1770000000000',
      nonce: '0123456789abcdef0123456789abcdef',
    })

    expect(payload).to.equal(
      [
        'DARSHAN_DEVICE_SOCKET_AUTH_V1',
        'CONNECT',
        '/device',
        'device-1',
        'serial-1',
        '1770000000000',
        '0123456789abcdef0123456789abcdef',
      ].join('\n')
    )
    expect(payload).to.not.contain('DARSHAN_DEVICE_AUTH_V1')
    expect(payload).to.not.contain('GET')
  })

  it('builds signed realtime socket auth with auth_version v1 when enabled', async () => {
    const { buildRealtimeDeviceSocketAuth } = require('../../../src/main/services/realtime-service')
    const fake = createFakeSocketAuthCertificateManager()

    const auth = await buildRealtimeDeviceSocketAuth({
      deviceId: 'device-1',
      deviceSerial: 'serial-1',
      signedAuthEnabled: true,
      certificateManager: fake.manager,
      nowMs: () => 1770000000000,
      nonceFactory: () => '0123456789abcdef0123456789abcdef',
    })

    expect(auth).to.include({
      device_id: 'device-1',
      device_serial: 'serial-1',
      auth_version: 'v1',
      auth_timestamp: '1770000000000',
      auth_nonce: '0123456789abcdef0123456789abcdef',
    })
    expect(auth.auth_signature).to.match(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(fake.calls).to.deep.equal([
      {
        deviceId: 'device-1',
        serial: 'serial-1',
        timestamp: '1770000000000',
        nonce: '0123456789abcdef0123456789abcdef',
      },
    ])
  })

  it('generates fresh realtime socket auth nonce values for reconnect auth factory calls', async () => {
    const { buildRealtimeDeviceSocketAuth } = require('../../../src/main/services/realtime-service')
    const fake = createFakeSocketAuthCertificateManager()

    const first = await buildRealtimeDeviceSocketAuth({
      deviceId: 'device-1',
      deviceSerial: 'serial-1',
      signedAuthEnabled: true,
      certificateManager: fake.manager,
    })
    const second = await buildRealtimeDeviceSocketAuth({
      deviceId: 'device-1',
      deviceSerial: 'serial-1',
      signedAuthEnabled: true,
      certificateManager: fake.manager,
    })

    expect(first.auth_timestamp).to.match(/^\d{10,17}$/)
    expect(second.auth_timestamp).to.match(/^\d{10,17}$/)
    expect(first.auth_nonce).to.match(/^[0-9a-f]{32}$/)
    expect(second.auth_nonce).to.match(/^[0-9a-f]{32}$/)
    expect(first.auth_nonce).to.not.equal(second.auth_nonce)
    expect(fake.calls).to.have.length(2)
  })

  it('falls back to legacy-only realtime auth when signing credentials are missing', async () => {
    const { buildRealtimeDeviceSocketAuth } = require('../../../src/main/services/realtime-service')
    const fake = createFakeSocketAuthCertificateManager({ hasPrivateKey: false })
    const fallbackReasons: string[] = []

    const auth = await buildRealtimeDeviceSocketAuth({
      deviceId: 'device-1',
      deviceSerial: 'serial-1',
      signedAuthEnabled: true,
      certificateManager: fake.manager,
      onFallback: (reason: string) => fallbackReasons.push(reason),
    })

    expect(auth).to.deep.equal({
      device_id: 'device-1',
      device_serial: 'serial-1',
    })
    expect(fake.calls).to.deep.equal([])
    expect(fallbackReasons).to.deep.equal(['missing_credentials'])
  })

  it('falls back to legacy-only realtime auth with bounded logging data when signing fails', async () => {
    const { buildRealtimeDeviceSocketAuth } = require('../../../src/main/services/realtime-service')
    const fake = createFakeSocketAuthCertificateManager({ failSigning: true })
    const fallbackReasons: string[] = []

    const auth = await buildRealtimeDeviceSocketAuth({
      deviceId: 'device-1',
      deviceSerial: 'secret-serial-value',
      signedAuthEnabled: true,
      certificateManager: fake.manager,
      nowMs: () => 1770000000000,
      nonceFactory: () => '0123456789abcdef0123456789abcdef',
      onFallback: (reason: string) => fallbackReasons.push(reason),
    })

    expect(auth).to.deep.equal({
      device_id: 'device-1',
      device_serial: 'secret-serial-value',
    })
    expect(Object.keys(auth)).to.not.include('auth_signature')
    expect(Object.keys(auth)).to.not.include('auth_nonce')
    expect(fallbackReasons).to.deep.equal(['signing_failed'])
    expect(JSON.stringify(fallbackReasons)).to.not.contain('secret-serial-value')
    expect(JSON.stringify(fallbackReasons)).to.not.contain('0123456789abcdef0123456789abcdef')
  })

  it('treats COMMAND_AVAILABLE as a wake-up and pulls commands/desired state by REST', async () => {
    const { RealtimeService } = require('../../../src/main/services/realtime-service')
    const { getCommandProcessor } = require('../../../src/main/services/command-processor')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const { getDefaultMediaService } = require('../../../src/main/services/settings/default-media-service')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')

    const commandProcessor = getCommandProcessor()
    const httpClient = getHttpClient()
    const snapshotManager = getSnapshotManager()
    const defaultMediaService = getDefaultMediaService()

    const pollStub = sandbox.stub(commandProcessor, 'pollNow').resolves()
    const desiredState = {
      device_id: 'device-1',
      server_time: '2026-05-24T07:30:00.000Z',
      state: {
        state_version: 2,
        command_version: 3,
        snapshot_id: 'snapshot-1',
        default_media_version: 'default-1',
        emergency_version: null,
        last_command_id: 'cmd-1',
        last_command_type: 'REFRESH',
        last_command_reason: 'PUBLISH',
        last_changed_reason: 'PUBLISH',
        updated_at: '2026-05-24T07:29:59.000Z',
      },
    }
    const getStub = sandbox.stub(httpClient, 'get').resolves(desiredState)
    const snapshotStub = sandbox.stub(snapshotManager, 'refreshSnapshot').resolves({ mode: 'normal', items: [] })
    const defaultStub = sandbox.stub(defaultMediaService, 'refreshNow').resolves({
      source: 'NONE',
      aspect_ratio: null,
      media_id: null,
      media: null,
    })

    const realtimeService = new RealtimeService()
    await realtimeService.handleNotification({
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      command_hint: {
        command_id: 'cmd-1',
        command_type: 'REFRESH',
        priority: 10,
        reason: 'PUBLISH',
      },
    })

    expect(pollStub.calledWith('realtime')).to.equal(true)
    expect(getStub.calledWith('/api/v1/device/device-1/desired-state')).to.equal(true)
    expect(snapshotStub.calledOnce).to.equal(true)
    expect(defaultStub.calledOnce).to.equal(true)

    const state = getDeviceStateStore().getState()
    expect(state.lastDesiredStateVersion).to.equal(2)
    expect(state.lastDesiredCommandVersion).to.equal(3)
    expect(state.lastDesiredSnapshotId).to.equal('snapshot-1')
    expect(state.lastDesiredDefaultMediaVersion).to.equal('default-1')
  })

  it('sends HELLO and waits for HELLO_ACK before marking realtime healthy', async () => {
    const { RealtimeService } = require('../../../src/main/services/realtime-service')
    const { getCommandProcessor } = require('../../../src/main/services/command-processor')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')

    const transport = new FakeRealtimeTransport()
    const commandProcessor = getCommandProcessor()
    const httpClient = getHttpClient()
    sandbox.stub(commandProcessor, 'pollNow').resolves()
    sandbox.stub(httpClient, 'get').resolves({
      device_id: 'device-1',
      state: {
        state_version: 0,
        command_version: 0,
        snapshot_id: null,
        default_media_version: null,
        emergency_version: null,
        last_command_id: null,
        last_command_type: null,
        last_command_reason: null,
        last_changed_reason: null,
        updated_at: null,
      },
    })

    const realtimeService = new RealtimeService(transport)
    realtimeService.start()
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))

    expect(transport.events[0].event).to.equal('HELLO')
    expect(transport.events[0].payload).to.include({
      type: 'HELLO',
      protocol_version: '1.0',
      device_id: 'device-1',
    })
    expect(transport.events[0].payload.snapshot).to.equal(undefined)
    expect(transport.events[0].payload.media).to.equal(undefined)
    expect(realtimeService.getState()).to.equal('connected')
    expect(commandProcessor.isRealtimeHealthy()).to.equal(true)
    expect(getDeviceStateStore().getState().lastRealtimeConnectedAt).to.be.a('string')

    realtimeService.stop()
  })

  it('rejects oversized or state-bearing realtime payloads instead of treating WebSocket as truth', async () => {
    const { RealtimeService } = require('../../../src/main/services/realtime-service')
    const { getCommandProcessor } = require('../../../src/main/services/command-processor')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')

    const commandProcessor = getCommandProcessor()
    const httpClient = getHttpClient()
    const pollStub = sandbox.stub(commandProcessor, 'pollNow').resolves()
    const getStub = sandbox.stub(httpClient, 'get').resolves()

    const realtimeService = new RealtimeService()
    await realtimeService.handleNotification({
      type: 'COMMAND_AVAILABLE',
      device_id: 'device-1',
      snapshot: {
        id: 'must-not-be-accepted',
      },
    } as any)

    expect(pollStub.called).to.equal(false)
    expect(getStub.called).to.equal(false)
  })
})
