const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

describe('Player Flow', () => {
  let tempDir: string
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('player-flow-test-')

    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    const testConfig = {
      apiBase: 'https://api-test.darshan.com',
      wsUrl: 'wss://api-test.darshan.com/ws',
      deviceId: '',
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
        commandPollMs: 30000,
        schedulePollMs: 60000,
        healthCheckMs: 60000,
        screenshotMs: 300000,
      },
    }
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify(testConfig, null, 2))

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

  function createCompleteBootstrapStubs() {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getHeartbeatService } = require('../../../src/main/services/telemetry/heartbeat')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getTelemetryService } = require('../../../src/main/services/telemetry/telemetry-service')
    const { getCommandProcessor } = require('../../../src/main/services/command-processor')
    const { getDefaultMediaService } = require('../../../src/main/services/settings/default-media-service')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    const httpClient = getHttpClient()
    const heartbeatService = getHeartbeatService()
    const snapshotManager = getSnapshotManager()
    const playbackEngine = getPlaybackEngine()
    const telemetryService = getTelemetryService()
    const commandProcessor = getCommandProcessor()
    const defaultMediaService = getDefaultMediaService()
    const pairingService = getPairingService()

    sandbox.stub(httpClient, 'get').resolves({})
    if (!pairingService.fetchBackendPairingStatus.restore) {
      sandbox.stub(pairingService, 'fetchBackendPairingStatus').resolves({
        status: 'VALID',
        deviceId: '11111111-1111-4111-8111-111111111111',
        screenId: '11111111-1111-4111-8111-111111111111',
        screenVisible: true,
        screenName: 'Test Screen',
        serverIdentity: {
          environment: 'test',
          deploymentId: 'test-suite',
          serverId: 'darshan-api-test',
        },
        certExpiresAt: null,
        requiresReclaim: false,
        serverTime: new Date().toISOString(),
      })
    }
    sandbox.stub(heartbeatService, 'sendImmediate').resolves()
    sandbox.stub(snapshotManager, 'start').returns(undefined)
    sandbox.stub(snapshotManager, 'refreshSnapshot').resolves({ mode: 'normal', items: [], scheduleId: 'sched-1' })
    sandbox.stub(playbackEngine, 'start').resolves()
    sandbox.stub(telemetryService, 'start').resolves()
    sandbox.stub(telemetryService, 'stop').resolves()
    sandbox.stub(commandProcessor, 'start').returns()
    sandbox.stub(commandProcessor, 'stop').returns()
    sandbox.stub(defaultMediaService, 'start').returns()
    sandbox.stub(defaultMediaService, 'stop').returns()

    return {
      httpClient,
      heartbeatService,
      snapshotManager,
      playbackEngine,
      telemetryService,
      commandProcessor,
      defaultMediaService,
      pairingService,
    }
  }

  it('should bootstrap to PAIRED_RUNTIME when stored credentials authenticate successfully', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'fetchScreenshotPolicy').resolves({
      enabled: false,
      interval_seconds: null,
    })

    const stubs = createCompleteBootstrapStubs()
    const playerFlow = getPlayerFlow()

    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('PAIRED_RUNTIME')
    expect(playerFlow.getStatus().pairingCode).to.equal(undefined)
    expect(stubs.httpClient.get.calledOnce).to.equal(true)
    expect(stubs.heartbeatService.sendImmediate.calledOnce).to.equal(true)

    await playerFlow.stop()
  })

  it('should preserve duplicate identity warnings without blocking warn-mode playback', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'fetchScreenshotPolicy').resolves({
      enabled: false,
      interval_seconds: null,
    })
    sandbox.stub(pairingService, 'fetchBackendPairingStatus').resolves({
      status: 'VALID_NO_CONTENT',
      deviceId: '11111111-1111-4111-8111-111111111111',
      screenId: '11111111-1111-4111-8111-111111111111',
      screenVisible: true,
      screenName: 'Test Screen',
      serverIdentity: {
        environment: 'test',
        deploymentId: 'test-suite',
        serverId: 'darshan-api-test',
      },
      certExpiresAt: null,
      requiresReclaim: false,
      duplicateIdentity: {
        active: true,
        conflictId: 'conflict-1',
        status: 'OPEN',
        severity: 'WARN',
        enforcement: 'warn',
        activeSessionCount: 2,
        leaseMs: 300000,
        restartGraceMs: 120000,
        firstSeenAt: new Date(0).toISOString(),
        lastSeenAt: new Date(1).toISOString(),
        sessions: [],
        recommendedAction: 'VERIFY_PHYSICAL_PLAYERS_AND_REVOKE_STALE_PAIRING',
      },
      serverTime: new Date().toISOString(),
    })

    const stubs = createCompleteBootstrapStubs()
    const playerFlow = getPlayerFlow()

    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('PAIRED_RUNTIME')
    expect(stateStore.getState().duplicateIdentity?.active).to.equal(true)
    expect(stubs.heartbeatService.sendImmediate.calledOnce).to.equal(true)

    await playerFlow.stop()
  })

  it('should remain in HARD_RECOVERY when boot has no trustworthy credentials and fresh pairing request fails', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')

    await getDeviceStateStore().clearIdentity()
    const pairingService = getPairingService()

    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'missing', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(false)
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('backend offline'))

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    await playerFlow.stop()
  })

  it('should move to RECOVERY_REQUIRED when startup finds a partial identity for a trustworthy device id', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    await getDeviceStateStore().clearIdentity()
    const pairingService = getPairingService()

    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({
      health: 'partial',
      issues: ['Private key exists but certificate is missing'],
    })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('RECOVERY_REQUIRED')
    expect(playerFlow.getStatus().recoveryReason).to.include('Private key exists but certificate is missing')
    await playerFlow.stop()
  })

  it('should require pairing validation when backend is unreachable and identity was never validated', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(getHttpClient(), 'get').rejects(
      new DeviceApiError({
        code: 'NETWORK_ERROR',
        message: 'connect ETIMEDOUT',
        transient: true,
      })
    )

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('LOCAL_IDENTITY_PRESENT')
    expect(playerFlow.getStatus().awaitingManualRecovery).to.equal(true)
    await playerFlow.stop()
  })

  it('should allow offline playback when backend is unreachable after a recent valid pairing validation', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')

    const deviceId = '11111111-1111-4111-8111-111111111111'
    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId,
      fingerprint: 'fingerprint-1',
      lastPairingValidationStatus: 'VALID',
      lastPairingValidatedAt: new Date().toISOString(),
      lastValidatedDeviceId: deviceId,
      lastValidatedServerIdentity: {
        environment: 'test',
        deploymentId: 'test-suite',
        serverId: 'darshan-api-test',
      },
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(getSnapshotManager(), 'getCurrentPlaylist').returns({
      mode: 'offline',
      items: [],
      scheduleId: 'cached-schedule',
      lastSnapshotAt: new Date().toISOString(),
    })
    sandbox.stub(getHttpClient(), 'get').rejects(
      new DeviceApiError({
        code: 'NETWORK_ERROR',
        message: 'connect ETIMEDOUT',
        transient: true,
      })
    )

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('OFFLINE_USING_LAST_VALID_PAIRING')
    expect(playerFlow.getStatus().mode).to.equal('offline')
    expect(playerFlow.getStatus().backendAvailable).to.equal(false)
    await playerFlow.stop()
  })

  it('should preserve identity when an old backend is missing the pairing-status endpoint', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')

    const deviceId = '11111111-1111-4111-8111-111111111111'
    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId,
      fingerprint: 'fingerprint-1',
      lastPairingValidationStatus: 'VALID',
      lastPairingValidatedAt: new Date().toISOString(),
      lastValidatedDeviceId: deviceId,
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    const requestPairingCode = sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('should not request'))
    sandbox.stub(getHttpClient(), 'get').rejects(
      new DeviceApiError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Route GET:/api/v1/device/11111111-1111-4111-8111-111111111111/pairing-status not found',
      })
    )

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('RECOVERY_REQUIRED')
    expect(playerFlow.getStatus().awaitingManualRecovery).to.equal(true)
    expect(stateStore.getState().deviceId).to.equal(deviceId)
    expect(stateStore.getState().fingerprint).to.equal('fingerprint-1')
    expect(requestPairingCode.called).to.equal(false)
    await playerFlow.stop()
  })

  it('should force re-pair on bootstrap credential expiry failure', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('request failed'))
    sandbox.stub(getHttpClient(), 'get').rejects(
      new DeviceApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Device credentials expired',
      })
    )

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    await playerFlow.stop()
  })

  it('should force re-pair on bootstrap invalid credential failure', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('request failed'))
    sandbox.stub(getHttpClient(), 'get').rejects(
      new DeviceApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Invalid device credentials',
      })
    )

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    await playerFlow.stop()
  })

  it('should remain in HARD_RECOVERY when bootstrap reports device not registered and fresh pairing cannot start', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').onFirstCall().returns(true).returns(false)
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('request failed'))
    sandbox.stub(getHttpClient(), 'get').rejects(
      new DeviceApiError({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Device not registered',
      })
    )

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    await playerFlow.stop()
  })

  it('should clear identity-bound cache and re-pair when backend reports deleted screen', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const { getDefaultMediaService } = require('../../../src/main/services/settings/default-media-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
      lastPairingValidationStatus: 'VALID',
      lastPairingValidatedAt: new Date().toISOString(),
      lastValidatedDeviceId: '11111111-1111-4111-8111-111111111111',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').onFirstCall().returns(true).returns(false)
    sandbox.stub(pairingService, 'fetchBackendPairingStatus').resolves({
      status: 'SCREEN_DELETED',
      code: 'SCREEN_DELETED',
      message: 'This screen pairing was deleted. Pair again.',
      deviceId: '11111111-1111-4111-8111-111111111111',
      screenVisible: false,
      requiresReclaim: false,
    })
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('request failed'))
    const snapshotClear = sandbox.spy(getSnapshotManager(), 'clearIdentityBoundState')
    const defaultClear = sandbox.spy(getDefaultMediaService(), 'clearIdentityBoundState')

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    expect(snapshotClear.called).to.equal(true)
    expect(defaultClear.called).to.equal(true)
    expect(stateStore.getState().deviceId).to.equal(undefined)
    expect(stateStore.getState().lastPairingValidationStatus).to.equal(undefined)
    await playerFlow.stop()
  })

  it('should force re-pair when backend reports environment mismatch', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').onFirstCall().returns(true).returns(false)
    sandbox.stub(pairingService, 'fetchBackendPairingStatus').resolves({
      status: 'ENVIRONMENT_MISMATCH',
      code: 'ENVIRONMENT_MISMATCH',
      message: 'Player is paired to a different backend environment.',
      deviceId: '11111111-1111-4111-8111-111111111111',
      requiresReclaim: true,
    })
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('request failed'))

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    expect(playerFlow.getStatus().recoveryReason).to.equal('request failed')
    expect(stateStore.getState().deviceId).to.equal(undefined)
    await playerFlow.stop()
  })

  it('should complete in-place recovery on the same device id when active_pairing is RECOVERY', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getLifecycleEvents } = require('../../../src/main/services/lifecycle-events')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    const fetchStatusStub = sandbox.stub(pairingService, 'fetchPairingStatus').resolves({
      device_id: '11111111-1111-4111-8111-111111111111',
      screen: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'OFFLINE',
      },
      active_pairing: {
        mode: 'RECOVERY',
        confirmed: true,
        pairing_code: 'REC123',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    })
    const submitPairingStub = sandbox.stub(pairingService, 'submitPairing').resolves({
      success: true,
      device_id: '11111111-1111-4111-8111-111111111111',
      certificate: 'cert',
      ca_certificate: 'ca',
      fingerprint: 'fingerprint-2',
    })

    createCompleteBootstrapStubs()
    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    getLifecycleEvents().emitRuntimeAuthFailure({
      source: 'heartbeat',
      error: new DeviceApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Invalid device credentials',
      }),
    })

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(fetchStatusStub.called).to.equal(true)
    expect(submitPairingStub.calledOnce).to.equal(true)
    expect(playerFlow.getState()).to.equal('PAIRED_RUNTIME')
    await playerFlow.stop()
  })

  it('should stay in RECOVERY_REQUIRED with a clear reason when confirmed recovery status omits pairing_code', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getLifecycleEvents } = require('../../../src/main/services/lifecycle-events')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'fetchPairingStatus').resolves({
      device_id: '11111111-1111-4111-8111-111111111111',
      screen: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'OFFLINE',
      },
      active_pairing: {
        id: 'pairing-1',
        mode: 'RECOVERY',
        confirmed: true,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    })
    const submitPairingStub = sandbox.stub(pairingService, 'submitPairing').resolves({
      success: true,
      device_id: '11111111-1111-4111-8111-111111111111',
      certificate: 'cert',
      ca_certificate: 'ca',
      fingerprint: 'fingerprint-2',
    })

    createCompleteBootstrapStubs()
    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    getLifecycleEvents().emitRuntimeAuthFailure({
      source: 'heartbeat',
      error: new DeviceApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Invalid device credentials',
      }),
    })

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(submitPairingStub.called).to.equal(false)
    expect(playerFlow.getState()).to.equal('RECOVERY_REQUIRED')
    expect(playerFlow.getStatus().recoveryReason).to.equal(
      'Recovery confirmed, but backend did not return the recovery code yet.'
    )
    await playerFlow.stop()
  })

  it('should hard recover when runtime recovery polling reports revoked credentials', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getLifecycleEvents } = require('../../../src/main/services/lifecycle-events')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'fetchPairingStatus').rejects(
      new DeviceApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Pairing revoked',
      })
    )
    sandbox.stub(pairingService, 'requestPairingCode').rejects(new Error('request failed'))

    createCompleteBootstrapStubs()
    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    getLifecycleEvents().emitRuntimeAuthFailure({
      source: 'heartbeat',
      error: new DeviceApiError({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Invalid device credentials',
      }),
    })

    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(playerFlow.getState()).to.equal('HARD_RECOVERY')
    expect(playerFlow.getStatus().recoveryReason).to.equal('request failed')
    expect(stateStore.getState().deviceId).to.equal(undefined)
    await playerFlow.stop()
  })

  it('should complete fresh pairing when active_pairing mode is PAIRING', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'missing', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').callsFake(() => {
      const state = stateStore.getState()
      return Boolean(state.deviceId)
    })
    sandbox.stub(pairingService, 'requestPairingCode').callsFake(async () => {
      await stateStore.update({
        deviceId: '11111111-1111-4111-8111-111111111111',
        pairingCode: 'PAIR12',
        pairingExpiresAt: new Date(Date.now() + 60000).toISOString(),
        activePairingMode: 'PAIRING',
      })
      return {
        id: 'pairing-1',
        device_id: '11111111-1111-4111-8111-111111111111',
        pairing_code: 'PAIR12',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        expires_in: 60,
        connected: true,
      }
    })
    sandbox.stub(pairingService, 'fetchPairingStatus').resolves({
      device_id: '11111111-1111-4111-8111-111111111111',
      screen: null,
      active_pairing: {
        mode: 'PAIRING',
        confirmed: true,
        pairing_code: 'PAIR12',
        expires_at: new Date(Date.now() + 60000).toISOString(),
      },
    })
    const submitPairingStub = sandbox.stub(pairingService, 'submitPairing').resolves({
      success: true,
      device_id: '11111111-1111-4111-8111-111111111111',
      certificate: 'cert',
      ca_certificate: 'ca',
      fingerprint: 'fingerprint-2',
    })

    createCompleteBootstrapStubs()
    const playerFlow = getPlayerFlow()
    await playerFlow.start()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(submitPairingStub.calledOnce).to.equal(true)
    expect(playerFlow.getState()).to.equal('PAIRED_RUNTIME')
    await playerFlow.stop()
  })

  it('should skip scheduled screenshot capture when the screenshot policy is disabled', async () => {
    const clock = sandbox.useFakeTimers()
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'fetchScreenshotPolicy').resolves({
      enabled: false,
      interval_seconds: null,
    })

    createCompleteBootstrapStubs()
    const screenshotService = getScreenshotService()
    const captureStub = sandbox.stub(screenshotService, 'captureAndUpload').resolves('object-key')

    const playerFlow = getPlayerFlow()
    await playerFlow.start()
    await clock.tickAsync(300000)

    expect(playerFlow.getState()).to.equal('PAIRED_RUNTIME')
    expect(captureStub.called).to.equal(false)

    await playerFlow.stop()
  })

  it('should keep runtime active when scheduled screenshot upload fails', async () => {
    const clock = sandbox.useFakeTimers()
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    sandbox.stub(pairingService, 'fetchScreenshotPolicy').resolves({
      enabled: true,
      interval_seconds: 300,
    })

    createCompleteBootstrapStubs()
    const screenshotService = getScreenshotService()
    const captureStub = sandbox.stub(screenshotService, 'captureAndUpload').rejects(new Error('upload failed'))

    const playerFlow = getPlayerFlow()
    await playerFlow.start()
    await clock.tickAsync(300000)

    expect(captureStub.calledOnce).to.equal(true)
    expect(playerFlow.getState()).to.equal('PAIRED_RUNTIME')

    await playerFlow.stop()
  })

  it('should apply fetched screenshot policy before runtime loops start', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const { getConfigManager } = require('../../../src/common/config')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)
    const fetchPolicyStub = sandbox.stub(pairingService, 'fetchScreenshotPolicy').resolves({
      enabled: true,
      interval_seconds: 45,
    })

    createCompleteBootstrapStubs()
    const screenshotService = getScreenshotService()
    const applyPolicyStub = sandbox.spy(screenshotService, 'applyPolicy')

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    expect(fetchPolicyStub.calledOnce).to.equal(true)
    expect(applyPolicyStub.calledOnceWith({ enabled: true, interval_seconds: 45 })).to.equal(true)
    expect(screenshotService.isCaptureEnabled()).to.equal(true)
    expect(getConfigManager().getConfig().intervals.screenshotMs).to.equal(45000)

    await playerFlow.stop()
  })

  it('should stop timeline playback and switch status to default when fallback media is active', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')

    const stateStore = getDeviceStateStore()
    await stateStore.clearIdentity()
    await stateStore.update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })

    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)

    const stubs = createCompleteBootstrapStubs()
    stubs.snapshotManager.refreshSnapshot.resolves({ mode: 'default', items: [], scheduleId: undefined })
    const playbackStopStub = sandbox.stub(stubs.playbackEngine, 'stop').returns()
    sandbox.stub(stubs.defaultMediaService, 'getCurrent').returns({
      source: 'GLOBAL',
      aspect_ratio: null,
      media_id: 'media-default',
      media: {
        id: 'media-default',
        name: 'Lobby Fallback',
        type: 'IMAGE',
        media_url: 'https://cdn.example.com/default.png',
      },
    })

    const playerFlow = getPlayerFlow()
    await playerFlow.start()

    getSnapshotManager().emit('playlist-updated', {
      mode: 'default',
      items: [
        {
          id: 'default-item-1',
          type: 'image',
          displayMs: 10000,
          fit: 'contain',
          muted: true,
          transitionDurationMs: 0,
        },
      ],
      lastSnapshotAt: new Date().toISOString(),
    })

    expect(playerFlow.getStatus().mode).to.equal('default')
    expect(playbackStopStub.called).to.equal(true)
    expect(stubs.playbackEngine.start.called).to.equal(false)

    await playerFlow.stop()
  })

  it('publishes emergency presentation authority before starting its timeline', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')

    await getDeviceStateStore().update({
      deviceId: '11111111-1111-4111-8111-111111111111',
      fingerprint: 'fingerprint-1',
    })
    const pairingService = getPairingService()
    sandbox.stub(pairingService, 'getStoredIdentityHealth').returns({ health: 'complete', issues: [] })
    sandbox.stub(pairingService, 'hasTrustworthyDeviceId').returns(true)

    const stubs = createCompleteBootstrapStubs()
    stubs.snapshotManager.refreshSnapshot.resolves({ mode: 'default', items: [] })
    const order: string[] = []
    stubs.playbackEngine.start.callsFake(async () => {
      order.push('start')
    })
    const playerFlow = getPlayerFlow()
    playerFlow.on('presentation-status', (presentation: { status?: { mode?: string } }) => {
      if (presentation.status?.mode === 'emergency') order.push('presentation')
    })

    await playerFlow.start()
    getSnapshotManager().emit('playlist-updated', {
      mode: 'emergency',
      items: [{ id: 'emergency-1', type: 'message', displayMs: 10000, fit: 'contain', muted: false }],
      lastSnapshotAt: new Date().toISOString(),
    })

    expect(order).to.deep.equal(['presentation', 'start'])
    expect(playerFlow.getStatus().mode).to.equal('emergency')
    await playerFlow.stop()
  })

  it('switches idle playback into default mode when resolved default media appears', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const { getDefaultMediaService } = require('../../../src/main/services/settings/default-media-service')

    const snapshotManager = getSnapshotManager()
    const defaultMediaService = getDefaultMediaService()
    const playerFlow = getPlayerFlow()

    sandbox.stub(snapshotManager, 'getCurrentPlaylist').returns({
      mode: 'empty',
      items: [],
      scheduleId: 'sched-default',
    })
    sandbox.stub(defaultMediaService, 'getCurrent').returns({
      source: 'GLOBAL',
      aspect_ratio: null,
      media_id: 'media-default',
      media: {
        id: 'media-default',
        name: 'Lobby Fallback',
        type: 'IMAGE',
        media_url: 'https://cdn.example.com/default.png',
      },
    })

    playerFlow['state'] = 'PAIRED_RUNTIME'
    playerFlow['status'] = {
      ...playerFlow.getStatus(),
      state: 'PAIRED_RUNTIME',
      mode: 'empty',
      online: true,
    }

    playerFlow['refreshPlaybackStatusFromCurrentState']()

    expect(playerFlow.getStatus().mode).to.equal('default')
    expect(playerFlow.getStatus().scheduleId).to.equal('sched-default')
  })

  it('clears fallback mode when resolved default media is removed and no schedule is active', async () => {
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')
    const { getDefaultMediaService } = require('../../../src/main/services/settings/default-media-service')

    const snapshotManager = getSnapshotManager()
    const defaultMediaService = getDefaultMediaService()
    const playerFlow = getPlayerFlow()

    sandbox.stub(snapshotManager, 'getCurrentPlaylist').returns({
      mode: 'default',
      items: [],
      scheduleId: 'sched-cleared',
    })
    sandbox.stub(defaultMediaService, 'getCurrent').returns({
      source: 'NONE',
      aspect_ratio: null,
      media_id: null,
      media: null,
    })

    playerFlow['state'] = 'PAIRED_RUNTIME'
    playerFlow['status'] = {
      ...playerFlow.getStatus(),
      state: 'PAIRED_RUNTIME',
      mode: 'default',
      online: true,
    }

    playerFlow['refreshPlaybackStatusFromCurrentState']()

    expect(playerFlow.getStatus().mode).to.equal('empty')
    expect(playerFlow.getStatus().currentMediaId).to.equal(undefined)
  })
})
