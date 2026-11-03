const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

describe('HTTP Client', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir('http-client-test-')

    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    fs.writeFileSync(
      process.env.HEXMON_CONFIG_PATH,
      JSON.stringify(
        {
          apiBase: 'https://api-test.darshan.com',
          wsUrl: 'wss://api-test.darshan.com/ws',
          deviceId: 'device-1',
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
            defaultMediaPollMs: 60000,
            healthCheckMs: 60000,
            screenshotMs: 300000,
          },
        },
        null,
        2
      )
    )
  })

  afterEach(() => {
    cleanupTempDir(tempDir)
    delete process.env.HEXMON_CONFIG_PATH
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  it('replaces configured transport CA and restores system trust when runtime config changes', () => {
    const { getConfigManager } = require('../../../src/common/config')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const client = getHttpClient()
    const config = getConfigManager().getConfig()
    const caPath = path.join(tempDir, 'site-ca.pem')
    fs.writeFileSync(caPath, 'test-site-ca')
    client.applyConfig({ ...config, apiBase: 'https://new-backend.example.test', transportTls: { enabled: true, caPath, strictCertificateValidation: true } })
    expect(client.getAxiosInstance().defaults.baseURL).to.equal('https://new-backend.example.test')
    expect(client.getAxiosInstance().defaults.httpsAgent.options.ca.toString()).to.equal('test-site-ca')
    expect(client.getAxiosInstance().defaults.httpsAgent.options.rejectUnauthorized).to.equal(true)
    expect(client.transportTls.caPath).to.equal(caPath)
    client.applyConfig({ ...config, transportTls: { enabled: false, caPath: '', strictCertificateValidation: true } })
    expect(client.getAxiosInstance().defaults.httpsAgent).to.equal(undefined)
    expect(client.transportTls.enabled).to.equal(false)
  })

  it('fails closed after a bad CA reconfiguration and contacts only the new endpoint after valid repair', async () => {
    const { getConfigManager } = require('../../../src/common/config')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const config = getConfigManager().getConfig(), client = getHttpClient()
    let requests = 0
    client.getAxiosInstance().defaults.adapter = async config => {
      requests += 1
      return { data: { source: config.baseURL }, status: 200, statusText: 'OK', headers: {}, config }
    }
    expect(() => client.applyConfig({ ...config, apiBase: 'https://new-backend.example.test', transportTls: {
      enabled: true, caPath: path.join(tempDir, 'missing-ca.pem'), strictCertificateValidation: true,
    } })).to.throw('HTTP transport configuration changed or is unavailable')
    let failure
    try { await client.get('/api/v1/health', { retry: false }) } catch (error) { failure = error }
    expect(failure.code).to.equal('NETWORK_ERROR')
    expect(failure.transient).to.equal(false)
    expect(requests).to.equal(0)
    client.applyConfig({ ...config, apiBase: 'https://new-backend.example.test', transportTls: { enabled: false, caPath: '', strictCertificateValidation: true } })
    expect((await client.get('/api/v1/health', { retry: false })).source).to.equal('https://new-backend.example.test')
    expect(requests).to.equal(1)
  })

  it('rejects a deferred old-backend response after transport context changes', async () => {
    const { getConfigManager } = require('../../../src/common/config')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const client = getHttpClient(), config = getConfigManager().getConfig()
    let finish, entered
    const called = new Promise(resolve => { entered = resolve })
    client.getAxiosInstance().defaults.adapter = async config => {
      entered()
      await new Promise(resolve => { finish = resolve })
      return { data: { stale: true }, status: 200, statusText: 'OK', headers: {}, config }
    }
    const pending = client.get('/api/v1/health', { retry: false }).catch(error => error)
    await called
    client.applyConfig({ ...config, apiBase: 'https://new-backend.example.test' })
    finish()
    const failure = await pending
    expect(failure.code).to.equal('NETWORK_ERROR')
    expect(failure.transient).to.equal(false)
    expect(failure.stale).to.equal(undefined)
  })

  it('does not retry an old operation body against a newly configured backend', async () => {
    const sinon = require('sinon'), axios = require('axios')
    const { getConfigManager } = require('../../../src/common/config')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const client = getHttpClient(), config = getConfigManager().getConfig()
    const clock = sinon.useFakeTimers()
    let calls = 0
    client.getAxiosInstance().defaults.adapter = async config => { calls += 1; throw new axios.AxiosError('network reset', 'ECONNRESET', config) }
    try {
      const pending = client.post('/api/v1/health', { original: true }, { retryPolicy: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 1000 } }).catch(error => error)
      await clock.tickAsync(0)
      expect(calls).to.equal(1)
      client.applyConfig({ ...config, apiBase: 'https://new-backend.example.test' })
      await clock.tickAsync(2000)
      expect((await pending).code).to.equal('NETWORK_ERROR')
      expect(calls).to.equal(1)
    } finally { clock.restore() }
  })

  it('should send device identity headers on device endpoints', async () => {
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getDeviceStateStore } = require('../../../src/main/services/device-state-store')
    const { getCertificateManager } = require('../../../src/main/services/cert-manager')

    const { privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const certManager = getCertificateManager()
    const paths = certManager.getCertificatePaths()
    fs.writeFileSync(paths.key, privateKey)

    await getDeviceStateStore().update({
      deviceId: 'device-1',
      fingerprint: 'fingerprint-123',
    })

    const httpClient = getHttpClient()
    const client = httpClient.getAxiosInstance()
    client.defaults.adapter = async (config: any) => {
      expect(config.headers['x-device-serial']).to.equal('fingerprint-123')
      expect(config.headers['x-device-auth-version']).to.equal('v1')
      expect(config.headers['x-device-timestamp']).to.be.a('string')
      expect(config.headers['x-device-signature']).to.be.a('string')
      expect(config.url).to.equal('/api/v1/device/screenshot')
      return {
        data: {
          success: true,
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    const response = await httpClient.post('/api/v1/device/screenshot', {
      device_id: 'device-1',
      timestamp: new Date().toISOString(),
      image_data: 'abc',
    })

    expect(response.success).to.equal(true)
  })

  it('redacts credentialed base URLs from connectivity diagnostics', async () => {
    fs.writeFileSync(
      process.env.HEXMON_CONFIG_PATH,
      JSON.stringify(
        {
          apiBase: 'https://diag-user:diag-pass@backend.internal:3000/api?token=diag-token#diag-fragment',
          wsUrl: 'wss://api-test.darshan.com/ws',
          deviceId: 'device-1',
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
            defaultMediaPollMs: 60000,
            healthCheckMs: 60000,
            screenshotMs: 300000,
          },
        },
        null,
        2
      )
    )

    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    const client = httpClient.getAxiosInstance()
    client.defaults.adapter = async (config: any) => ({
      data: { ok: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })

    const result = await httpClient.checkConnectivityDetailed()
    const serialized = JSON.stringify(result)

    expect(result.baseURL).to.equal('https://backend.internal:3000/api')
    expect(serialized).not.to.contain('diag-user')
    expect(serialized).not.to.contain('diag-pass')
    expect(serialized).not.to.contain('diag-token')
    expect(serialized).not.to.contain('diag-fragment')
  })

  it('classifies an Axios request timeout as a transient network error', async () => {
    const axios = require('axios')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    const client = httpClient.getAxiosInstance()

    client.defaults.adapter = async (config: any) => {
      throw new axios.AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED', config)
    }

    let rejected: any
    try {
      await httpClient.get('/api/v1/device-pairing/status', { retry: false })
    } catch (error) {
      rejected = error
    }

    expect(rejected).to.exist
    expect(rejected.code).to.equal('NETWORK_ERROR')
    expect(rejected.transient).to.equal(true)
    expect(rejected.detailsPayload).to.deep.equal({ code: 'ECONNABORTED' })
  })
})
