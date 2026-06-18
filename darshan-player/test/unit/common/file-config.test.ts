const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')

const ENV_KEYS = [
  'DARSHAN_PLAYER_CONFIG_FILE',
  'SIGNHEX_PLAYER_CONFIG_FILE',
  'DARSHAN_ENV',
  'SIGNHEX_ENV',
  'DARSHAN_RUNTIME_ROOT',
  'HEXMON_RUNTIME_ROOT',
  'DARSHAN_CONFIG_PATH',
  'HEXMON_CONFIG_PATH',
  'DARSHAN_API_BASE_URL',
  'HEXMON_API_BASE',
  'DARSHAN_WS_URL',
  'HEXMON_WS_URL',
  'DARSHAN_ENVIRONMENT_NAME',
  'SIGNHEX_ENVIRONMENT_NAME',
  'DARSHAN_DEPLOYMENT_ID',
  'SIGNHEX_DEPLOYMENT_ID',
  'DARSHAN_PAIRING_OFFLINE_VALIDATION_GRACE_MS',
]

function resetRuntimeModules() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.includes(`${path.sep}darshan-player${path.sep}src${path.sep}`)) {
      delete require.cache[modulePath]
    }
  }
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-player-config-'))
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
}

describe('player file config loader', () => {
  let tempDir
  let originalEnv

  beforeEach(() => {
    originalEnv = {}
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key]
      delete process.env[key]
    }
    tempDir = makeTempDir()
    process.env.DARSHAN_RUNTIME_ROOT = path.join(tempDir, 'runtime')
    resetRuntimeModules()
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
    resetRuntimeModules()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('keeps existing runtime config behavior when no player config file is selected', () => {
    const runtimeConfigPath = path.join(process.env.DARSHAN_RUNTIME_ROOT, 'config.json')
    writeJson(runtimeConfigPath, {
      apiBase: 'http://runtime.local:3000',
      wsUrl: 'ws://runtime.local:3000/ws',
      deviceId: 'runtime-device',
      runtime: { mode: 'production' },
    })
    process.env.DARSHAN_API_BASE_URL = 'http://env.local:3000'

    const { getConfigManager } = require('../../../src/common/config')
    const configManager = getConfigManager()
    const config = configManager.getConfig()

    expect(config.apiBase).to.equal('http://runtime.local:3000')
    expect(config.deviceId).to.equal('runtime-device')
    expect(configManager.getFileConfigDiagnostics().configFile.loaded).to.equal(false)
  })

  it('loads DARSHAN_PLAYER_CONFIG_FILE and keeps runtime identity separate', () => {
    const runtimeConfigPath = path.join(process.env.DARSHAN_RUNTIME_ROOT, 'config.json')
    writeJson(runtimeConfigPath, {
      apiBase: 'http://runtime.local:3000',
      wsUrl: 'ws://runtime.local:3000/ws',
      deviceId: 'runtime-device',
      mtls: {
        enabled: true,
      },
    })
    const siteConfigPath = path.join(tempDir, 'player-config.json')
    writeJson(siteConfigPath, {
      player: {
        environment: {
          name: 'onprem-qa',
          deploymentId: 'qa-lab-1',
          expectedServerId: 'backend-a',
        },
        backend: {
          baseUrl: 'http://192.168.0.5:3000',
          socketIoUrl: 'http://192.168.0.5:3000/socket.io/',
        },
        realtime: {
          enabled: true,
          commandSafetyPollMs: 120000,
        },
        polling: {
          heartbeatMs: 45000,
          commandPollMs: 7000,
          snapshotPollMs: 300000,
          defaultMediaPollMs: 300000,
        },
        pairing: {
          offlineValidationGraceMs: 123456,
          backendFirstRolloutMode: true,
        },
        duplicateIdentity: {
          enabled: true,
          enforcement: 'warn',
        },
        cache: {
          maxBytes: 2147483648,
        },
        diagnostics: {
          showEnvironmentIdentity: true,
        },
      },
    })
    process.env.DARSHAN_PLAYER_CONFIG_FILE = siteConfigPath

    const { getConfigManager } = require('../../../src/common/config')
    const configManager = getConfigManager()
    const config = configManager.getConfig()

    expect(configManager.getFileConfigDiagnostics().configFile.source).to.equal('DARSHAN_PLAYER_CONFIG_FILE')
    expect(config.apiBase).to.equal('http://192.168.0.5:3000')
    expect(config.wsUrl).to.equal('ws://192.168.0.5:3000/socket.io')
    expect(config.realtime.wsUrl).to.equal('ws://192.168.0.5:3000/socket.io')
    expect(config.deviceId).to.equal('runtime-device')
    expect(config.mtls.enabled).to.equal(true)
    expect(config.environment.name).to.equal('onprem-qa')
    expect(config.environment.deploymentId).to.equal('qa-lab-1')
    expect(config.pairing.offlineValidationGraceMs).to.equal(123456)
    expect(config.cache.maxBytes).to.equal(2147483648)
  })

  it('loads SIGNHEX_PLAYER_CONFIG_FILE when DARSHAN_PLAYER_CONFIG_FILE is absent', () => {
    const siteConfigPath = path.join(tempDir, 'player-config.json')
    writeJson(siteConfigPath, {
      player: {
        backend: {
          baseUrl: 'http://10.20.0.20:3000',
        },
      },
    })
    process.env.SIGNHEX_PLAYER_CONFIG_FILE = siteConfigPath
    process.env.NODE_ENV = 'development'

    const { getConfigManager } = require('../../../src/common/config')
    const configManager = getConfigManager()

    expect(configManager.getFileConfigDiagnostics().configFile.source).to.equal('SIGNHEX_PLAYER_CONFIG_FILE')
    expect(configManager.getConfig().apiBase).to.equal('http://10.20.0.20:3000')
  })

  it('allows both player selectors when they resolve to the same path', () => {
    const siteConfigPath = path.join(tempDir, 'player-config.json')
    writeJson(siteConfigPath, { player: { backend: { baseUrl: 'http://10.20.0.20:3000' } } })

    const { resolvePlayerConfigFileSelector } = require('../../../src/common/file-config')
    const selector = resolvePlayerConfigFileSelector({
      DARSHAN_PLAYER_CONFIG_FILE: siteConfigPath,
      SIGNHEX_PLAYER_CONFIG_FILE: path.relative(process.cwd(), siteConfigPath),
    })

    expect(selector.source).to.equal('both')
    expect(selector.path).to.equal(path.resolve(siteConfigPath))
  })

  it('fails fast when player selectors point to different paths', () => {
    const { resolvePlayerConfigFileSelector } = require('../../../src/common/file-config')

    expect(() =>
      resolvePlayerConfigFileSelector({
        DARSHAN_PLAYER_CONFIG_FILE: '/tmp/player-a.json',
        SIGNHEX_PLAYER_CONFIG_FILE: '/tmp/player-b.json',
      })
    ).to.throw(/different player config files/)
  })

  it('lets env vars override selected player config values', () => {
    const siteConfigPath = path.join(tempDir, 'player-config.json')
    writeJson(siteConfigPath, {
      player: {
        environment: { name: 'from-file', deploymentId: 'file-deployment' },
        backend: { baseUrl: 'http://file.local:3000' },
        pairing: { offlineValidationGraceMs: 999999 },
      },
    })
    process.env.DARSHAN_PLAYER_CONFIG_FILE = siteConfigPath
    process.env.DARSHAN_API_BASE_URL = 'http://env.local:3000'
    process.env.DARSHAN_ENVIRONMENT_NAME = 'from-env'
    process.env.DARSHAN_PAIRING_OFFLINE_VALIDATION_GRACE_MS = '111111'

    const { getConfigManager } = require('../../../src/common/config')
    const config = getConfigManager().getConfig()

    expect(config.apiBase).to.equal('http://env.local:3000')
    expect(config.environment.name).to.equal('from-env')
    expect(config.environment.deploymentId).to.equal('file-deployment')
    expect(config.pairing.offlineValidationGraceMs).to.equal(111111)
  })

  it('fails clearly on invalid JSON', () => {
    const siteConfigPath = path.join(tempDir, 'player-config.json')
    fs.writeFileSync(siteConfigPath, '{not-json')
    process.env.DARSHAN_PLAYER_CONFIG_FILE = siteConfigPath

    const { loadPlayerFileConfig } = require('../../../src/common/file-config')
    expect(() => loadPlayerFileConfig()).to.throw(/Invalid player config JSON/)
  })

  it('rejects unknown keys and secret-looking keys', () => {
    const unknownConfigPath = path.join(tempDir, 'unknown.json')
    writeJson(unknownConfigPath, { player: { backend: { baseUrl: 'http://ok.local:3000' }, unknown: true } })
    process.env.DARSHAN_PLAYER_CONFIG_FILE = unknownConfigPath

    const { loadPlayerFileConfig } = require('../../../src/common/file-config')
    expect(() => loadPlayerFileConfig()).to.throw(/Unknown player config key/)

    resetRuntimeModules()
    const secretConfigPath = path.join(tempDir, 'secret.json')
    writeJson(secretConfigPath, { player: { jwtSecret: 'must-not-be-here' } })
    process.env.DARSHAN_PLAYER_CONFIG_FILE = secretConfigPath

    expect(() => loadPlayerFileConfig()).to.throw(/secret-like key/)
  })

  it('rejects credentialed URLs and YAML in CONFIG-2', () => {
    const credentialedPath = path.join(tempDir, 'credentialed.json')
    writeJson(credentialedPath, { player: { backend: { baseUrl: 'http://user:pass@backend.local:3000' } } })
    process.env.DARSHAN_PLAYER_CONFIG_FILE = credentialedPath
    const { loadPlayerFileConfig } = require('../../../src/common/file-config')
    expect(() => loadPlayerFileConfig()).to.throw(/must not include credentials/)

    resetRuntimeModules()
    const yamlPath = path.join(tempDir, 'player-config.yaml')
    fs.writeFileSync(yamlPath, 'player:\n  backend:\n    baseUrl: http://backend.local:3000\n')
    process.env.DARSHAN_PLAYER_CONFIG_FILE = yamlPath
    expect(() => loadPlayerFileConfig()).to.throw(/supports JSON files only/)
  })

  it('redacts diagnostic URLs without changing useful host details', () => {
    const { redactUrlForDiagnostics } = require('../../../src/common/file-config')

    expect(
      redactUrlForDiagnostics('https://user:password@backend.internal:3000/api?token=abc123#secret-fragment')
    ).to.equal('https://backend.internal:3000/api')
    expect(redactUrlForDiagnostics('http://admin:secret@192.168.0.5:3000/api')).to.equal(
      'http://192.168.0.5:3000/api'
    )
    expect(redactUrlForDiagnostics('https://backend.internal:3000/api?password=abc&safe=value')).to.equal(
      'https://backend.internal:3000/api'
    )
    expect(redactUrlForDiagnostics('https://backend.internal:3000/api#secret-fragment')).to.equal(
      'https://backend.internal:3000/api'
    )
    expect(redactUrlForDiagnostics('http://192.168.0.5:3000')).to.equal('http://192.168.0.5:3000')
    expect(redactUrlForDiagnostics('not a url with password=abc')).to.equal('[invalid-url-redacted]')
  })

  it('builds redacted diagnostics without secret values', () => {
    const siteConfigPath = path.join(tempDir, 'player-config.json')
    writeJson(siteConfigPath, {
      player: {
        environment: { name: 'qa', deploymentId: 'qa-lab' },
        backend: { baseUrl: 'http://backend.local:3000' },
      },
    })
    process.env.DARSHAN_PLAYER_CONFIG_FILE = siteConfigPath

    const { getConfigManager } = require('../../../src/common/config')
    const configManager = getConfigManager()
    configManager.updateConfig({
      deviceId: 'sensitive-device-id',
      mtls: {
        ...configManager.getConfig().mtls,
        certPath: '/secret/client.crt',
        keyPath: '/secret/client.key',
        caPath: '/secret/ca.crt',
      },
    })

    const summary = configManager.getRedactedRuntimeConfigSummary()
    const serialized = JSON.stringify(summary)

    expect(summary.configFile.loaded).to.equal(true)
    expect(summary.backend.apiBase).to.equal('http://backend.local:3000')
    expect(serialized).not.to.contain('sensitive-device-id')
    expect(serialized).not.to.contain('/secret/client.key')
    expect(summary.redaction.secretValuesIncluded).to.equal(false)
  })

  it('redacts credentialed env URLs in diagnostics while preserving runtime config', () => {
    process.env.DARSHAN_API_BASE_URL = 'https://env-user:env-password@backend.internal:3000/api?token=env-token#env-fragment'
    process.env.DARSHAN_WS_URL = 'wss://ws-user:ws-password@backend.internal:3000/socket.io/?access_key=ws-key#ws-fragment'

    const { getConfigManager } = require('../../../src/common/config')
    const configManager = getConfigManager()
    const runtimeConfig = configManager.getConfig()
    const summary = configManager.getRedactedRuntimeConfigSummary()
    const serialized = JSON.stringify(summary)

    expect(runtimeConfig.apiBase).to.equal(
      'https://env-user:env-password@backend.internal:3000/api?token=env-token#env-fragment'
    )
    expect(summary.backend.apiBase).to.equal('https://backend.internal:3000/api')
    expect(summary.backend.wsUrl).to.equal('wss://backend.internal:3000/socket.io')
    expect(serialized).to.contain('backend.internal:3000')
    expect(serialized).not.to.contain('env-user')
    expect(serialized).not.to.contain('env-password')
    expect(serialized).not.to.contain('env-token')
    expect(serialized).not.to.contain('env-fragment')
    expect(serialized).not.to.contain('ws-user')
    expect(serialized).not.to.contain('ws-password')
    expect(serialized).not.to.contain('ws-key')
    expect(serialized).not.to.contain('ws-fragment')
  })
})
