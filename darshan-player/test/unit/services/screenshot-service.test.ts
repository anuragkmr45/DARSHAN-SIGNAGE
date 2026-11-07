const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

describe('Screenshot Service', () => {
  let tempDir: string
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('screenshot-service-test-')

    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    const testConfig = {
      apiBase: 'https://api-test.darshan.com',
      wsUrl: 'wss://api-test.darshan.com/ws',
      deviceId: '11111111-1111-4111-8111-111111111111',
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
      const normalizedKey = key.replace(/\\/g, '/')
      if (normalizedKey.includes('src/main/services') || normalizedKey.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  afterEach(async () => {
    sandbox.restore()
    delete process.env.HEXMON_CONFIG_PATH

    try {
      const { getRequestQueue } = require('../../../src/main/services/network/request-queue')
      await getRequestQueue().cleanup()
    } catch {
      // ignore cleanup failures during module reset
    }

    cleanupTempDir(tempDir)
    Object.keys(require.cache).forEach((key) => {
      const normalizedKey = key.replace(/\\/g, '/')
      if (normalizedKey.includes('src/main/services') || normalizedKey.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  it('captures the visible authorized content provider instead of the hidden ordinary renderer', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const service = getScreenshotService()
    const live = { toPNG: () => Buffer.from('actual-live-view') }
    const ordinary = sandbox.stub().resolves({ toPNG: () => Buffer.from('ordinary-renderer') })
    service.initialize({ webContents: { capturePage: ordinary } })
    service.setContentCaptureProvider(async () => live)
    expect(await service.capture()).to.equal(live)
    expect(ordinary.called).to.equal(false)
  })

  it('uses ordinary content when the managed view is hidden or its lease expired during capture', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const service = getScreenshotService()
    const image = { toPNG: () => Buffer.from('current-ordinary') }
    const ordinary = sandbox.stub().resolves(image)
    service.initialize({ webContents: { capturePage: ordinary } })
    service.setContentCaptureProvider(async () => undefined)
    expect(await service.capture()).to.equal(image)
    expect(ordinary.calledOnce).to.equal(true)
  })

  it('uses the composed window capture for ordinary Windows playback', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const service = getScreenshotService()
    const composed = { toPNG: () => Buffer.from('composed-window') }
    const renderer = sandbox.stub().resolves({ toPNG: () => Buffer.from('renderer-only') })
    const windowCapture = sandbox.stub().resolves(composed)
    service.initialize({ webContents: { capturePage: renderer } })
    service.setContentCaptureProvider(async () => undefined)
    service.setWindowCaptureProvider(windowCapture)

    expect(await service.capture()).to.equal(composed)
    expect(windowCapture.calledOnce).to.equal(true)
    expect(renderer.called).to.equal(false)
  })

  it('falls back to renderer capture when composed window capture fails', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const service = getScreenshotService()
    const rendererImage = { toPNG: () => Buffer.from('renderer-fallback') }
    const renderer = sandbox.stub().resolves(rendererImage)
    service.initialize({ webContents: { capturePage: renderer } })
    service.setContentCaptureProvider(async () => undefined)
    service.setWindowCaptureProvider(async () => { throw new Error('capture unavailable') })

    expect(await service.capture()).to.equal(rendererImage)
    expect(renderer.calledOnce).to.equal(true)
  })

  it('queues screenshot uploads for retry on non-auth failures and removes the local file', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getCertificateManager } = require('../../../src/main/services/cert-manager')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getRequestQueue } = require('../../../src/main/services/network/request-queue')
    const { getPlayerMetrics } = require('../../../src/main/services/telemetry/player-metrics')

    const screenshotService = getScreenshotService()
    const filepath = path.join(tempDir, 'capture.png')
    fs.writeFileSync(filepath, Buffer.from('fake-image-data'))

    sandbox.stub(getPairingService(), 'getDeviceId').returns('11111111-1111-4111-8111-111111111111')
    sandbox.stub(getCertificateManager(), 'getCertificateMetadata').returns({
      serialNumber: 'serial-1',
      fingerprint: 'fingerprint-1',
      validFrom: '2026-03-12T00:00:00.000Z',
      validTo: '2027-03-12T00:00:00.000Z',
      subject: 'CN=device',
      issuer: 'CN=ca',
    })

    sandbox.stub(getHttpClient(), 'post').rejects(new Error('backend unavailable'))
    const enqueueStub = sandbox.stub(getRequestQueue(), 'enqueue').resolves(true)

    let thrown: Error | null = null
    try {
      await screenshotService.uploadScreenshot(filepath)
    } catch (error) {
      thrown = error as Error
    }

    const metrics = await getPlayerMetrics().renderPrometheusMetrics(async () => ({
      cpuUsage: 0,
      cpuCores: 4,
      cpuLoad1m: 0,
      cpuLoad5m: 0,
      cpuLoad15m: 0,
      memoryUsage: 0,
      memoryTotal: 1,
      memoryFree: 1,
      diskUsage: 0,
      diskTotal: 1,
      diskFree: 1,
      uptime: 0,
      networkInterfaces: [],
      displayCount: 1,
      displays: [],
      hostname: 'player-host',
      osVersion: 'linux',
    }))

    expect(thrown).to.be.instanceOf(Error)
    expect(thrown?.message).to.contain('queued for retry')
    expect(enqueueStub.calledOnce).to.equal(true)
    expect(fs.existsSync(filepath)).to.equal(false)
    expect(metrics).to.contain('darshan_player_screenshot_upload_total{result="queued"} 1')
  })

  it('emits runtime auth failure and does not queue when screenshot upload gets an auth error', async () => {
    const { DeviceApiError } = require('../../../src/common/types')
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getCertificateManager } = require('../../../src/main/services/cert-manager')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getRequestQueue } = require('../../../src/main/services/network/request-queue')
    const { getLifecycleEvents } = require('../../../src/main/services/lifecycle-events')

    const screenshotService = getScreenshotService()
    const filepath = path.join(tempDir, 'capture-auth.png')
    fs.writeFileSync(filepath, Buffer.from('fake-image-data'))

    sandbox.stub(getPairingService(), 'getDeviceId').returns('11111111-1111-4111-8111-111111111111')
    sandbox.stub(getCertificateManager(), 'getCertificateMetadata').returns({
      serialNumber: 'serial-1',
      fingerprint: 'fingerprint-1',
      validFrom: '2026-03-12T00:00:00.000Z',
      validTo: '2027-03-12T00:00:00.000Z',
      subject: 'CN=device',
      issuer: 'CN=ca',
    })

    const authError = new DeviceApiError({
      code: 'FORBIDDEN',
      status: 403,
      message: 'Invalid device credentials',
    })

    sandbox.stub(getHttpClient(), 'post').rejects(authError)
    const enqueueStub = sandbox.stub(getRequestQueue(), 'enqueue').resolves(true)
    const emitStub = sandbox.stub(getLifecycleEvents(), 'emitRuntimeAuthFailure').returns(true)

    let thrown: unknown
    try {
      await screenshotService.uploadScreenshot(filepath)
    } catch (error) {
      thrown = error
    }

    expect(thrown).to.equal(authError)
    expect(emitStub.calledOnce).to.equal(true)
    expect(emitStub.firstCall.args[0].source).to.equal('screenshot')
    expect(enqueueStub.called).to.equal(false)
    expect(fs.existsSync(filepath)).to.equal(true)
  })

  it('does not claim a screenshot was queued when the retry queue rejects it', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const { getCertificateManager } = require('../../../src/main/services/cert-manager')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getRequestQueue } = require('../../../src/main/services/network/request-queue')
    const { getPlayerMetrics } = require('../../../src/main/services/telemetry/player-metrics')

    const screenshotService = getScreenshotService()
    const filepath = path.join(tempDir, 'capture-drop.png')
    fs.writeFileSync(filepath, Buffer.from('fake-image-data'))

    sandbox.stub(getPairingService(), 'getDeviceId').returns('11111111-1111-4111-8111-111111111111')
    sandbox.stub(getCertificateManager(), 'getCertificateMetadata').returns({
      serialNumber: 'serial-1',
      fingerprint: 'fingerprint-1',
      validFrom: '2026-03-12T00:00:00.000Z',
      validTo: '2027-03-12T00:00:00.000Z',
      subject: 'CN=device',
      issuer: 'CN=ca',
    })

    sandbox.stub(getHttpClient(), 'post').rejects(new Error('backend unavailable'))
    sandbox.stub(getRequestQueue(), 'enqueue').resolves(false)

    let thrown: Error | null = null
    try {
      await screenshotService.uploadScreenshot(filepath)
    } catch (error) {
      thrown = error as Error
    }

    const metrics = await getPlayerMetrics().renderPrometheusMetrics(async () => ({
      cpuUsage: 0,
      cpuCores: 4,
      cpuLoad1m: 0,
      cpuLoad5m: 0,
      cpuLoad15m: 0,
      memoryUsage: 0,
      memoryTotal: 1,
      memoryFree: 1,
      diskUsage: 0,
      diskTotal: 1,
      diskFree: 1,
      uptime: 0,
      networkInterfaces: [],
      displayCount: 1,
      displays: [],
      hostname: 'player-host',
      osVersion: 'linux',
    }))

    expect(thrown).to.be.instanceOf(Error)
    expect(thrown?.message).to.equal('backend unavailable')
    expect(metrics).to.contain('darshan_player_screenshot_upload_total{result="failed"} 1')
  })

  it('tracks whether scheduled screenshot capture is enabled', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const screenshotService = getScreenshotService()

    expect(screenshotService.isCaptureEnabled()).to.equal(false)

    screenshotService.setCaptureEnabled(false)
    expect(screenshotService.isCaptureEnabled()).to.equal(false)

    screenshotService.setCaptureEnabled(true)
    expect(screenshotService.isCaptureEnabled()).to.equal(true)
  })

  it('applies server screenshot policy and persists the interval when enabled', async () => {
    const { getScreenshotService } = require('../../../src/main/services/screenshot-service')
    const { getConfigManager } = require('../../../src/common/config')
    const screenshotService = getScreenshotService()

    const applied = screenshotService.applyPolicy({
      enabled: true,
      interval_seconds: 45,
    })

    expect(applied.enabled).to.equal(true)
    expect(applied.intervalMs).to.equal(45000)
    expect(screenshotService.isCaptureEnabled()).to.equal(true)
    expect(getConfigManager().getConfig().intervals.screenshotMs).to.equal(45000)
  })
})
