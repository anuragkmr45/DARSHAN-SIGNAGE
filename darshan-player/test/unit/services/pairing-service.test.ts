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
})
