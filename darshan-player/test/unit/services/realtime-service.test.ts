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

    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
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
