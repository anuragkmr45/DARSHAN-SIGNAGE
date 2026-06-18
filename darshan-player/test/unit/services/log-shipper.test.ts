const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const zlib = require('zlib')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

describe('Log Shipper', () => {
  let tempDir
  let sandbox
  let originalNodeEnv

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('log-shipper-test-')
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    fs.writeFileSync(
      process.env.HEXMON_CONFIG_PATH,
      JSON.stringify(
        {
          apiBase: 'https://api-test.darshan.com',
          wsUrl: 'wss://api-test.darshan.com/ws',
          deviceId: 'log-device',
          cache: {
            path: path.join(tempDir, 'cache'),
            maxBytes: 1024 * 1024,
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
    delete process.env.HEXMON_CONFIG_PATH
    process.env.NODE_ENV = originalNodeEnv
    try {
      const { destroyAllLoggers } = require('../../../src/common/logger')
      destroyAllLoggers()
    } catch {
      // ignore logger cleanup during module reset
    }
    cleanupTempDir(tempDir)
    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  it('redacts credentialed uploadUrl logs while returning the runtime URL unchanged', async () => {
    const pairingModule = require('../../../src/main/services/pairing-service')
    sandbox.stub(pairingModule, 'getPairingService').returns({
      getDeviceId: () => 'device-123',
    })

    const { LogShipper } = require('../../../src/main/services/log-shipper')
    const shipper = new LogShipper()
    const bundleDir = shipper.getBundleDirectory()
    fs.mkdirSync(bundleDir, { recursive: true })
    const bundlePath = path.join(bundleDir, 'bundle.json.gz')
    fs.writeFileSync(bundlePath, 'bundle')

    const rawUploadUrl = 'https://log-user:log-pass@backend.internal:3000/logs/bundle?token=abc#secret'
    sandbox.stub(shipper, 'bundleLogs').resolves(bundlePath)
    sandbox.stub(shipper, 'uploadBundle').resolves(rawUploadUrl)

    const result = await shipper.shipLogs()
    const logDir = path.join(tempDir, 'cache', 'logs')
    const logOutput = fs
      .readdirSync(logDir)
      .map((file) => fs.readFileSync(path.join(logDir, file), 'utf-8'))
      .join('\n')

    expect(result.uploadUrl).to.equal(rawUploadUrl)
    expect(logOutput).to.contain('https://backend.internal:3000/logs/bundle')
    expect(logOutput).not.to.contain('log-user')
    expect(logOutput).not.to.contain('log-pass')
    expect(logOutput).not.to.contain('token')
    expect(logOutput).not.to.contain('abc')
    expect(logOutput).not.to.contain('secret')
  })

  it('sanitizes log contents before bundling them for shipment', async () => {
    const pairingModule = require('../../../src/main/services/pairing-service')
    sandbox.stub(pairingModule, 'getPairingService').returns({
      getDeviceId: () => 'device-123',
    })

    const { LogShipper } = require('../../../src/main/services/log-shipper')
    const shipper = new LogShipper()
    const logDir = path.join(tempDir, 'cache', 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    fs.writeFileSync(
      path.join(logDir, 'player.log'),
      'Loading https://user:password@backend.internal:3000/api?token=abc#secret plain password=standalone'
    )
    fs.writeFileSync(
      path.join(logDir, 'historical.log.gz'),
      zlib.gzipSync('https://user:password@backend.internal:3000/api?token=abc#secret')
    )

    const bundlePath = await shipper.bundleLogs()
    const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(bundlePath)).toString('utf8'))
    const serialized = JSON.stringify(bundle)

    expect(bundle.logs['player.log']).to.contain('https://backend.internal:3000/api')
    expect(bundle.logs['historical.log.gz.omitted.txt']).to.contain('omitted')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('standalone')
    expect(serialized).not.to.contain('secret')
  })
})
