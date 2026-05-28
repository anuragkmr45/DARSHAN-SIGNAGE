const { expect } = require('chai')
const sinon = require('sinon')
const path = require('path')
const fs = require('fs')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

describe('Media Cache Reporter', () => {
  let tempDir: string
  let sandbox: sinon.SinonSandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('media-cache-reporter-test-')

    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    fs.writeFileSync(
      process.env.HEXMON_CONFIG_PATH,
      JSON.stringify(
        {
          apiBase: 'https://api-test.darshan.com',
          wsUrl: 'wss://api-test.darshan.com/ws',
          deviceId: 'device-123',
          cache: {
            path: tempDir,
            maxBytes: 10485760,
            prefetchConcurrency: 2,
          },
          intervals: {
            heartbeatMs: 300000,
            commandPollMs: 30000,
            schedulePollMs: 300000,
            defaultMediaPollMs: 300000,
            healthCheckMs: 60000,
            screenshotMs: 300000,
          },
          observability: {
            enabled: true,
            metricsEnabled: true,
            mediaCacheReportingEnabled: true,
          },
        },
        null,
        2
      )
    )
  })

  afterEach(() => {
    sandbox.restore()
    cleanupTempDir(tempDir)
    delete process.env.HEXMON_CONFIG_PATH

    for (const modulePath of [
      '../../../src/main/services/media-cache-reporter',
      '../../../src/main/services/network/http-client',
      '../../../src/main/services/network/request-queue',
      '../../../src/main/services/pairing-service',
      '../../../src/common/config',
    ]) {
      delete require.cache[require.resolve(modulePath)]
    }
  })

  it('sends sanitized media/cache failure reports through REST', async () => {
    const { reportMediaCacheFailure } = require('../../../src/main/services/media-cache-reporter')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    sandbox.stub(getPairingService(), 'getDeviceId').returns('device-123')
    const postStub = sandbox.stub(getHttpClient(), 'post').resolves({ id: 'report-1' })

    const result = await reportMediaCacheFailure({
      mediaId: 'media-1',
      source: 'SNAPSHOT',
      url: 'https://cdn.example.test/media/file.mp4?signature=secret',
      errorCode: 'HTTP_503',
      httpStatus: 503,
      message: 'download failed',
      snapshotId: '11111111-1111-4111-8111-111111111111',
      playbackMode: 'normal',
    })

    expect(result).to.deep.include({ sent: true, queued: false, id: 'report-1' })
    expect(postStub.calledOnce).to.equal(true)
    const [url, payload] = postStub.firstCall.args
    expect(url).to.equal('/api/v1/device/device-123/media-cache-report')
    expect(payload).to.include({
      event_type: 'DOWNLOAD_FAILED',
      severity: 'ERROR',
      source: 'SNAPSHOT',
      media_id: 'media-1',
      error_code: 'HTTP_503',
      http_status: 503,
      message: 'download failed',
      url_host: 'cdn.example.test',
    })
    expect(payload.url_path_hash).to.be.a('string').and.have.length(64)
    expect(JSON.stringify(payload)).not.to.include('signature=secret')
  })

  it('queues report payloads when immediate REST send fails', async () => {
    const { reportMediaCacheFailure } = require('../../../src/main/services/media-cache-reporter')
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const { getRequestQueue } = require('../../../src/main/services/network/request-queue')
    const { getPairingService } = require('../../../src/main/services/pairing-service')

    sandbox.stub(getPairingService(), 'getDeviceId').returns('device-123')
    sandbox.stub(getHttpClient(), 'post').rejects(new Error('offline'))
    const enqueueStub = sandbox.stub(getRequestQueue(), 'enqueue').resolves(true)

    const result = await reportMediaCacheFailure({
      mediaId: 'media-2',
      source: 'DEFAULT_MEDIA',
      errorCode: 'URL_EXPIRED',
      message: 'presigned URL expired',
    })

    expect(result).to.deep.equal({ sent: false, queued: true })
    expect(enqueueStub.calledOnce).to.equal(true)
    expect(enqueueStub.firstCall.args[0]).to.include({
      method: 'POST',
      url: '/api/v1/device/device-123/media-cache-report',
      maxRetries: 10,
    })
  })
})
