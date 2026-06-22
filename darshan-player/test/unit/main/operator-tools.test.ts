const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ENV_KEYS = [
  'DARSHAN_RUNTIME_ROOT',
  'DARSHAN_CONFIG_PATH',
  'DARSHAN_CACHE_PATH',
  'DARSHAN_MTLS_CERT_DIR',
  'DARSHAN_MTLS_CERT_PATH',
  'DARSHAN_MTLS_KEY_PATH',
  'DARSHAN_MTLS_CA_PATH',
  'DARSHAN_API_BASE_URL',
  'DARSHAN_WS_URL',
  'DARSHAN_PLAYER_CONFIG_FILE',
  'SIGNHEX_PLAYER_CONFIG_FILE',
  'HEXMON_RUNTIME_ROOT',
  'HEXMON_CONFIG_PATH',
  'HEXMON_CACHE_PATH',
  'HEXMON_MTLS_CERT_DIR',
  'HEXMON_MTLS_CERT_PATH',
  'HEXMON_MTLS_KEY_PATH',
  'HEXMON_MTLS_CA_PATH',
]

function resetRuntimeModules() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.includes(`${path.sep}darshan-player${path.sep}src${path.sep}`)) {
      delete require.cache[modulePath]
    }
  }
}

function writeFile(filePath, content = 'test') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

async function captureJson(fn) {
  const originalLog = console.log
  const lines = []
  console.log = (value) => {
    lines.push(String(value))
  }

  try {
    const code = await fn()
    const payload = JSON.parse(lines[lines.length - 1] || '{}')
    return { code, payload }
  } finally {
    console.log = originalLog
  }
}

function seedRuntime() {
  const { getConfigManager } = require('../../../src/common/config')
  const configManager = getConfigManager()
  configManager.updateConfig({
    deviceId: '11111111-1111-4111-8111-111111111111',
    mtls: {
      ...configManager.getConfig().mtls,
      enabled: true,
    },
  })

  const config = configManager.getConfig()
  const cacheRoot = config.cache.path
  const statePath = path.join(path.dirname(configManager.getConfigPath()), 'device-state.json')
  const certDir = path.dirname(config.mtls.keyPath)

  writeFile(config.mtls.certPath, 'client-cert')
  writeFile(config.mtls.keyPath, 'private-key')
  writeFile(config.mtls.caPath, 'ca-cert')
  writeFile(path.join(certDir, 'client.csr'), 'csr')
  writeFile(path.join(certDir, 'cert-meta.json'), JSON.stringify({
    fingerprint: 'fingerprint-value',
    serialNumber: 'serial-value',
    validFrom: new Date(0).toISOString(),
    validTo: new Date(1).toISOString(),
    subject: 'subject',
    issuer: 'issuer',
    verificationMode: 'compatibility',
  }))
  writeFile(statePath, JSON.stringify({
    deviceId: '11111111-1111-4111-8111-111111111111',
    fingerprint: 'fingerprint-value',
    installInstanceId: 'install-instance-sensitive-value',
    lastPairingValidationStatus: 'VALID',
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
  }))
  writeFile(path.join(cacheRoot, 'last-snapshot.json'), '{}')
  writeFile(path.join(cacheRoot, 'default-media.json'), '{}')
  writeFile(path.join(cacheRoot, 'playback-progress.json'), JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        scheduleId: 'schedule-1',
        itemId: 'item-1',
        mediaId: 'media-1',
        positionMs: 120000,
        updatedAt: new Date().toISOString(),
      },
    ],
  }))
  writeFile(path.join(cacheRoot, 'media', 'media-1.bin'), 'media')
  writeFile(path.join(cacheRoot, 'objects', 'object-1.bin'), 'object')
  writeFile(path.join(cacheRoot, 'quarantine', 'bad.bin'), 'bad')
  writeFile(path.join(cacheRoot, 'cache-index.db'), 'index')
  writeFile(path.join(cacheRoot, 'request-queue.json'), '[]')
  writeFile(path.join(cacheRoot, 'request-queue.state.json'), '{}')
  writeFile(path.join(cacheRoot, 'pop-spool', 'pending.json'), '{}')
  writeFile(path.join(cacheRoot, 'logs', 'player.log'), 'log')

  return {
    configManager,
    config,
    cacheRoot,
    statePath,
    certDir,
  }
}

describe('operator reset tooling', () => {
  let runtimeRoot

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-reset-test-'))
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    process.env.DARSHAN_RUNTIME_ROOT = runtimeRoot
    resetRuntimeModules()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    resetRuntimeModules()
    if (runtimeRoot) {
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it('reports reset dry-run plan without deleting identity or cache files', async () => {
    const seeded = seedRuntime()
    const { resetPairingForCli } = require('../../../src/main/services/operator-tools')

    const { code, payload } = await captureJson(() =>
      resetPairingForCli({ dryRun: true, clearCache: true, reason: 'unit dry run' })
    )

    expect(code).to.equal(0)
    expect(payload.dryRun).to.equal(true)
    expect(payload.plan.clearCache).to.equal(true)
    expect(fs.existsSync(seeded.config.mtls.keyPath)).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'last-snapshot.json'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'playback-progress.json'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'media', 'media-1.bin'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'request-queue.json'))).to.equal(true)
  })

  it('reports pairing status with redacted session metadata', async () => {
    process.env.DARSHAN_API_BASE_URL =
      'https://diag-user:diag-pass@backend.internal:3000/api?token=diag-token#diag-fragment'
    process.env.DARSHAN_WS_URL =
      'wss://socket-user:socket-pass@backend.internal:3000/socket.io/?access_key=socket-key#socket-fragment'
    seedRuntime()
    const { pairingStatusForCli } = require('../../../src/main/services/operator-tools')

    const { code, payload } = await captureJson(() => pairingStatusForCli())
    const serialized = JSON.stringify(payload)

    expect(code).to.equal(0)
    expect(payload.session.installInstancePresent).to.equal(true)
    expect(payload.session.installInstanceSuffix).to.equal('...ve-value')
    expect(payload.session.runtimeSessionSuffix).to.be.a('string')
    expect(payload.duplicateIdentity.active).to.equal(true)
    expect(payload.config.backend.apiBase).to.equal('https://backend.internal:3000/api')
    expect(payload.config.backend.wsUrl).to.equal('wss://backend.internal:3000/socket.io')
    expect(serialized).not.to.contain('install-instance-sensitive-value')
    expect(serialized).not.to.contain('diag-user')
    expect(serialized).not.to.contain('diag-pass')
    expect(serialized).not.to.contain('diag-token')
    expect(serialized).not.to.contain('diag-fragment')
    expect(serialized).not.to.contain('socket-user')
    expect(serialized).not.to.contain('socket-pass')
    expect(serialized).not.to.contain('socket-key')
    expect(serialized).not.to.contain('socket-fragment')
  })

  it('redacts credentialed URLs from doctor network output', async () => {
    process.env.DARSHAN_API_BASE_URL =
      'https://doctor-user:doctor-pass@localhost:3000/api?token=doctor-token#doctor-fragment'
    process.env.DARSHAN_WS_URL =
      'wss://doctor-socket:socket-pass@localhost:3000/socket.io/?access_key=doctor-key#socket-fragment'
    seedRuntime()

    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    const httpClient = getHttpClient()
    const originalCheckConnectivityDetailed = httpClient.checkConnectivityDetailed.bind(httpClient)
    httpClient.checkConnectivityDetailed = async () => ({
      ok: false,
      baseURL: 'https://doctor-result:result-pass@localhost:3000/api?password=result-secret#result-fragment',
      endpoint: '/api/v1/health',
      error: 'offline',
    })

    const { runDoctor } = require('../../../src/main/services/operator-tools')

    try {
      const { code, payload } = await captureJson(() => runDoctor())
      const serialized = JSON.stringify(payload)

      expect(code).to.equal(0)
      expect(payload.config.backend.apiBase).to.equal('https://localhost:3000/api')
      expect(payload.config.backend.wsUrl).to.equal('wss://localhost:3000/socket.io')
      expect(payload.network.apiBase).to.equal('https://localhost:3000/api')
      expect(serialized).to.contain('localhost:3000')
      expect(serialized).not.to.contain('doctor-user')
      expect(serialized).not.to.contain('doctor-pass')
      expect(serialized).not.to.contain('doctor-token')
      expect(serialized).not.to.contain('doctor-fragment')
      expect(serialized).not.to.contain('doctor-socket')
      expect(serialized).not.to.contain('socket-pass')
      expect(serialized).not.to.contain('doctor-key')
      expect(serialized).not.to.contain('socket-fragment')
      expect(serialized).not.to.contain('doctor-result')
      expect(serialized).not.to.contain('result-pass')
      expect(serialized).not.to.contain('result-secret')
      expect(serialized).not.to.contain('result-fragment')
    } finally {
      httpClient.checkConnectivityDetailed = originalCheckConnectivityDetailed
    }
  })

  it('sanitizes copied log contents in support bundles', async () => {
    const seeded = seedRuntime()
    const logDir = path.join(seeded.cacheRoot, 'logs')
    fs.writeFileSync(
      path.join(logDir, 'player.log'),
      'Loading https://user:password@backend.internal:3000/api?token=abc#secret plain password=standalone'
    )
    fs.writeFileSync(path.join(logDir, 'historical.log.gz'), 'raw compressed placeholder')

    const { collectLogs } = require('../../../src/main/services/operator-tools')
    const { code, payload } = await captureJson(() => collectLogs())
    const supportLog = fs.readFileSync(path.join(payload.bundleDir, 'logs', 'player.log'), 'utf8')
    const omittedLog = fs.readFileSync(path.join(payload.bundleDir, 'logs', 'historical.log.gz.omitted.txt'), 'utf8')
    const serialized = JSON.stringify({ supportLog, omittedLog })

    expect(code).to.equal(0)
    expect(payload.success).to.equal(true)
    expect(supportLog).to.contain('https://backend.internal:3000/api')
    expect(omittedLog).to.contain('omitted')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('standalone')
    expect(serialized).not.to.contain('secret')

    fs.rmSync(payload.bundleDir, { recursive: true, force: true })
  })

  it('generates a new runtime session id after process module reload', () => {
    seedRuntime()
    const first = require('../../../src/main/services/pairing-service').getPairingService().getRuntimeSessionId()

    resetRuntimeModules()
    process.env.DARSHAN_RUNTIME_ROOT = runtimeRoot
    const second = require('../../../src/main/services/pairing-service').getPairingService().getRuntimeSessionId()

    expect(first).to.match(/^[0-9a-f-]{36}$/i)
    expect(second).to.match(/^[0-9a-f-]{36}$/i)
    expect(second).not.to.equal(first)
  })


  it('clears identity-bound state while preserving media cache and pending queues by default', async () => {
    const seeded = seedRuntime()
    const { resetPairingForCli } = require('../../../src/main/services/operator-tools')

    const { code, payload } = await captureJson(() => resetPairingForCli({ reason: 'unit reset' }))

    expect(code).to.equal(0)
    expect(payload.clearCache).to.equal(false)
    expect(fs.existsSync(seeded.config.mtls.keyPath)).to.equal(false)
    expect(fs.existsSync(seeded.config.mtls.certPath)).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'last-snapshot.json'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'default-media.json'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'playback-progress.json'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'media', 'media-1.bin'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'request-queue.json'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'pop-spool', 'pending.json'))).to.equal(true)
    expect(seeded.configManager.getConfig().deviceId).to.equal('')
    expect(seeded.configManager.getConfig().mtls.enabled).to.equal(false)
    const persistedState = JSON.parse(fs.readFileSync(seeded.statePath, 'utf-8'))
    expect(persistedState.installInstanceId).to.equal(undefined)
    expect(persistedState.duplicateIdentity).to.equal(undefined)
  })

  it('only clears media cache targets when reset-pairing clear-cache is requested', async () => {
    const seeded = seedRuntime()
    const { resetPairingForCli } = require('../../../src/main/services/operator-tools')

    const { code, payload } = await captureJson(() => resetPairingForCli({ clearCache: true, reason: 'unit reset' }))

    expect(code).to.equal(0)
    expect(payload.clearCache).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'media', 'media-1.bin'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'objects', 'object-1.bin'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'quarantine', 'bad.bin'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'cache-index.db'))).to.equal(false)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'request-queue.json'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'request-queue.state.json'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'pop-spool', 'pending.json'))).to.equal(true)
    expect(fs.existsSync(path.join(seeded.cacheRoot, 'logs', 'player.log'))).to.equal(true)
  })
})
