const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const os = require('os')
const path = require('path')

function resetRuntimeModules() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.includes(`${path.sep}darshan-player${path.sep}src${path.sep}`)) {
      delete require.cache[modulePath]
    }
  }
}

describe('PairingService', () => {
  let tempDir
  let sandbox
  let originalEnv

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    originalEnv = {
      DARSHAN_RUNTIME_ROOT: process.env.DARSHAN_RUNTIME_ROOT,
      DARSHAN_PLAYER_CONFIG_FILE: process.env.DARSHAN_PLAYER_CONFIG_FILE,
      DARSHAN_API_BASE_URL: process.env.DARSHAN_API_BASE_URL,
      DARSHAN_WS_URL: process.env.DARSHAN_WS_URL,
      HEXMON_CONFIG_PATH: process.env.HEXMON_CONFIG_PATH,
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-pairing-service-'))
    process.env.DARSHAN_RUNTIME_ROOT = path.join(tempDir, 'runtime')
    process.env.DARSHAN_PLAYER_CONFIG_FILE = path.join(tempDir, 'player-config.json')
    delete process.env.HEXMON_CONFIG_PATH

    fs.mkdirSync(process.env.DARSHAN_RUNTIME_ROOT, { recursive: true })
    fs.writeFileSync(
      path.join(process.env.DARSHAN_RUNTIME_ROOT, 'config.json'),
      JSON.stringify(
        {
          apiBase: 'http://runtime.local:3000',
          wsUrl: 'ws://runtime.local:3000/ws',
          deviceId: '11111111-1111-4111-8111-111111111111',
        },
        null,
        2
      )
    )
    fs.writeFileSync(
      process.env.DARSHAN_PLAYER_CONFIG_FILE,
      JSON.stringify(
        {
          player: {
            environment: {
              name: 'onprem-qa',
              deploymentId: 'qa-lab-1',
              expectedServerId: 'backend-a',
            },
            backend: {
              baseUrl: 'http://192.168.0.5:3000',
            },
          },
        },
        null,
        2
      )
    )
    resetRuntimeModules()
  })

  afterEach(() => {
    sandbox.restore()
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    resetRuntimeModules()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('sends configured environment labels on backend pairing-status validation', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const httpClient = getHttpClient()
    let capturedHeaders

    sandbox.stub(httpClient, 'get').callsFake(async (_url, options) => {
      capturedHeaders = options.headers
      return {
        status: 'VALID_NO_CONTENT',
        deviceId: '11111111-1111-4111-8111-111111111111',
        screenId: '11111111-1111-4111-8111-111111111111',
        screenVisible: true,
        serverIdentity: {
          environment: 'onprem-qa',
          deploymentId: 'qa-lab-1',
          serverId: 'backend-a',
        },
        requiresReclaim: false,
        serverTime: new Date().toISOString(),
      }
    })

    const response = await getPairingService().fetchBackendPairingStatus()

    expect(response.status).to.equal('VALID_NO_CONTENT')
    expect(capturedHeaders['x-signhex-environment-name']).to.equal('onprem-qa')
    expect(capturedHeaders['x-signhex-deployment-id']).to.equal('qa-lab-1')
    expect(capturedHeaders['x-signhex-install-instance-id']).to.be.a('string')
    expect(capturedHeaders['x-signhex-runtime-session-id']).to.be.a('string')
    expect(capturedHeaders).not.to.have.property('x-signhex-server-id')
  })

  it('persists a private credential before requesting an OTP and uses server time despite local clock skew', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getConfigManager } = require('../../../src/common/config')
    const httpClient = getHttpClient()
    const pairingService = getPairingService()
    const serverTime = '2020-01-01T00:00:00.000Z'
    const expiresAt = '2020-01-01T00:10:00.000Z'
    const deviceId = '22222222-2222-4222-8222-222222222222'
    const captured = []
    sandbox.stub(httpClient, 'post').callsFake(async (_url, payload) => {
      captured.push(payload)
      if (captured.length === 1) throw new Error('response lost')
      return {
        id: '33333333-3333-4333-8333-333333333333',
        device_id: deviceId,
        pairing_code: '123456',
        expires_at: expiresAt,
        expires_in: 600,
        server_time: serverTime,
        generation: 1,
        connected: true,
      }
    })

    try { await pairingService.requestPairingCode() } catch (error) {
      expect(error.message).to.equal('response lost')
    }
    const credentialPath = path.join(path.dirname(getConfigManager().getConfigPath()), 'pairing-credential')
    const credentialStat = fs.statSync(credentialPath)
    expect(credentialStat.isFile()).to.equal(true)
    if (process.platform !== 'win32') expect(credentialStat.mode & 0o777).to.equal(0o600)
    await pairingService.requestPairingCode()
    expect(captured[0].pairing_credential).to.equal(captured[1].pairing_credential)
    expect(getDeviceStateStore().getState().deviceId).to.equal(deviceId)
    expect(pairingService.getPairingRemainingMs()).to.be.within(590000, 600000)
  })

  it('rejects a linked credential path without changing the target file', () => {
    const { PairingCredentialStore } = require('../../../src/main/services/pairing-credential-store')
    const target = path.join(tempDir, 'unrelated-file')
    const link = path.join(tempDir, 'pairing-credential')
    const original = Buffer.from('a'.repeat(64))
    fs.writeFileSync(target, original, { mode: 0o644 })
    fs.symlinkSync(target, link)

    expect(() => new PairingCredentialStore(link).read()).to.throw(/not a regular file/)
    expect(fs.readFileSync(target)).to.deep.equal(original)
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).to.equal(0o644)
  })

  it('retries a timed-out renewal with the same request ID and keeps the device ID', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const httpClient = getHttpClient()
    const pairingService = getPairingService()
    const deviceId = '22222222-2222-4222-8222-222222222222'
    const now = new Date().toISOString()
    const expiry = new Date(Date.now() + 600000).toISOString()
    const requests = []
    sandbox.stub(httpClient, 'post').callsFake(async (url, payload) => {
      if (url.endsWith('/request')) return {
        id: '33333333-3333-4333-8333-333333333333', device_id: deviceId,
        pairing_code: '123456', expires_at: expiry, expires_in: 600,
        server_time: now, generation: 1, connected: true,
      }
      requests.push(payload)
      if (requests.length === 1) throw new Error('timeout')
      return {
        id: '44444444-4444-4444-8444-444444444444', device_id: deviceId,
        pairing_code: '654321', expires_at: expiry, expires_in: 600,
        server_time: now, generation: 2, connected: true,
      }
    })
    await pairingService.requestPairingCode()
    try { await pairingService.renewPairingCode() } catch (error) {
      expect(error.message).to.equal('timeout')
    }
    const inDoubtId = getDeviceStateStore().getState().pendingRenewalRequestId
    expect(inDoubtId).to.be.a('string')
    await pairingService.renewPairingCode()
    expect(requests[0].renewal_request_id).to.equal(requests[1].renewal_request_id)
    expect(getDeviceStateStore().getState().deviceId).to.equal(deviceId)
    expect(getDeviceStateStore().getState().pairingCode).to.equal('654321')
    expect(getDeviceStateStore().getState().pendingRenewalRequestId).to.equal(undefined)
  })

  it('redacts credentialed backend URLs from network diagnostics', async () => {
    process.env.DARSHAN_API_BASE_URL =
      'https://diag-user:diag-pass@localhost:3000/api?token=diag-token#diag-fragment'
    process.env.DARSHAN_WS_URL =
      'wss://socket-user:socket-pass@localhost:3000/socket.io/?access_key=socket-key#socket-fragment'
    resetRuntimeModules()

    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const httpClient = getHttpClient()
    sandbox.stub(httpClient, 'checkConnectivityDetailed').resolves({
      ok: false,
      baseURL: 'https://result-user:result-pass@localhost:3000/api?password=result-secret#result-fragment',
      endpoint: '/api/v1/health',
      error: 'offline',
    })

    const diagnostics = await getPairingService().runDiagnostics()
    const serialized = JSON.stringify(diagnostics)

    expect(diagnostics.apiBase).to.equal('https://localhost:3000/api')
    expect(serialized).not.to.contain('diag-user')
    expect(serialized).not.to.contain('diag-pass')
    expect(serialized).not.to.contain('diag-token')
    expect(serialized).not.to.contain('diag-fragment')
    expect(serialized).not.to.contain('result-user')
    expect(serialized).not.to.contain('result-pass')
    expect(serialized).not.to.contain('result-secret')
    expect(serialized).not.to.contain('result-fragment')
    expect(serialized).not.to.contain('socket-user')
    expect(serialized).not.to.contain('socket-pass')
    expect(serialized).not.to.contain('socket-key')
    expect(serialized).not.to.contain('socket-fragment')
  })
})
