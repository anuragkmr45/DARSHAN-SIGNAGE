const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { developmentLiveTestRoot, developmentLiveCapability, registerNormalProfileAutostart } = require('../../../src/main/live-development-profile')
const { buildPlayerCapabilities } = require('../../../src/main/services/player-capabilities')
describe('Owned normal-app LIVE development override', () => {
  let root, env, config
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'normal-live-owned-'))
    fs.chmodSync(root, 0o700)
    fs.writeFileSync(path.join(root, '.darshan-normal-live-test.json'), JSON.stringify({ version: 1, purpose: 'normal-live-integration' }), { mode: 0o600 })
    env = { DARSHAN_DEV_LIVE_CAPABILITY: '1', DARSHAN_RUNTIME_MODE: 'dev', DARSHAN_RUNTIME_ROOT: root,
      DARSHAN_CONFIG_PATH: path.join(root, 'config.json'), DARSHAN_CACHE_PATH: path.join(root, 'cache'), DARSHAN_MTLS_CERT_DIR: path.join(root, 'certs') }
    config = { runtime: { mode: 'dev' }, livePlayback: { enabled: true }, apiBase: 'https://127.0.0.1:18443', cache: { path: path.join(root, 'cache') },
      mtls: { certPath: path.join(root, 'certs/device.crt'), keyPath: path.join(root, 'certs/device.key'), caPath: path.join(root, 'certs/ca.crt') } }
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  it('requires an explicit private marked root and enables only the normal dev loopback fixture', () => {
    expect(developmentLiveTestRoot(env)).to.equal(root)
    expect(developmentLiveCapability(config, env)).to.equal(true)
    expect(developmentLiveTestRoot({})).to.equal(undefined)
  })
  it('advertises the same guarded current capabilities without depending on a WebSocket and removes LIVE when disabled', () => {
    const enabled = buildPlayerCapabilities({ ...config, realtime: { enabled: false } }, env)
    expect(enabled.features).to.include('live_broadcast_v1')
    expect(enabled.commands).to.include('SCREENSHOT')
    const disabled = buildPlayerCapabilities({ ...config, livePlayback: { enabled: false } }, env)
    expect(disabled.features).to.deep.equal(['message_emergency_v1', 'webcontents_view_v1', 'pdf_page_selection_v1'])
    for (const mode of ['production', 'qa']) expect(buildPlayerCapabilities({ ...config, runtime: { mode } }, env).features).not.to.include('live_broadcast_v1')
    enabled.features.length = 0
    expect(buildPlayerCapabilities(config, env).features).to.include('live_broadcast_v1')
  })
  it('leaves OS autostart untouched only for the validated owned fixture and retains normal startup registration', async () => {
    let registrations = 0
    const register = async () => { registrations += 1 }
    await registerNormalProfileAutostart(register, env)
    expect(registrations).to.equal(0)
    for (const mode of ['dev', 'qa', 'production']) await registerNormalProfileAutostart(register, { DARSHAN_RUNTIME_MODE: mode })
    expect(registrations).to.equal(3)
    fs.chmodSync(path.join(root, '.darshan-normal-live-test.json'), 0o644)
    if (process.platform !== 'win32') {
      let refused = false
      try { await registerNormalProfileAutostart(register, env) } catch { refused = true }
      expect(refused).to.equal(true)
      expect(registrations).to.equal(3)
    }
  })
  it('cannot override production or QA runtime, disabled LIVE or a remote backend', () => {
    for (const mode of ['production', 'qa']) {
      expect(() => developmentLiveTestRoot({ ...env, DARSHAN_RUNTIME_MODE: mode })).to.throw()
      expect(developmentLiveCapability({ ...config, runtime: { mode } }, env)).to.equal(false)
    }
    expect(developmentLiveCapability({ ...config, livePlayback: { enabled: false } }, env)).to.equal(false)
    for (const apiBase of ['https://localhost.foreign.test', 'https://127.0.0.1.foreign.test', 'https://192.168.1.10', 'https://user:pass@localhost']) expect(developmentLiveCapability({ ...config, apiBase }, env)).to.equal(false)
  })
  it('rejects a marker symlink, an unknown marker and identity/cache paths outside the owned profile', () => {
    const marker = path.join(root, '.darshan-normal-live-test.json')
    fs.writeFileSync(marker, JSON.stringify({ version: 1, purpose: 'production' }))
    expect(() => developmentLiveTestRoot(env)).to.throw()
    fs.unlinkSync(marker)
    const target = path.join(root, 'different-marker')
    fs.writeFileSync(target, JSON.stringify({ version: 1, purpose: 'normal-live-integration' }), { mode: 0o600 })
    fs.symlinkSync(target, marker)
    expect(() => developmentLiveTestRoot(env)).to.throw()
    fs.unlinkSync(marker); fs.renameSync(target, marker)
    expect(developmentLiveCapability({ ...config, cache: { path: path.dirname(root) } }, env)).to.equal(false)
    expect(developmentLiveCapability({ ...config, mtls: { ...config.mtls, keyPath: '/outside/device.key' } }, env)).to.equal(false)
  })
  it('rejects permissive Linux owner modes instead of silently adopting an ordinary profile', function () {
    if (process.platform === 'win32') this.skip()
    fs.chmodSync(root, 0o755)
    expect(() => developmentLiveTestRoot(env)).to.throw()
    fs.chmodSync(root, 0o700)
    fs.chmodSync(path.join(root, '.darshan-normal-live-test.json'), 0o644)
    expect(() => developmentLiveTestRoot(env)).to.throw()
  })
})
