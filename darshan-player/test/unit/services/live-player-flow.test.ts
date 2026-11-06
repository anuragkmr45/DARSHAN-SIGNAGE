const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const path = require('path')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils')
const { liveFixture, LIVE_IDS } = require('../../helpers/live-fixtures')
function clearModules() { for (const key of Object.keys(require.cache)) { const normalizedKey = key.replace(/\\/g, '/'); if (normalizedKey.includes('/src/main/services/') || normalizedKey.includes('/src/common/')) delete require.cache[key] } }
describe('Ordinary PlayerFlow LIVE integration fences', () => {
  let dir, sandbox, flow, owner, engine, window, clock, originalConfigPaths
  beforeEach(() => {
    clearModules(); sandbox = sinon.createSandbox(); dir = createTempDir('normal-live-flow-')
    originalConfigPaths = Object.fromEntries(
      ['DARSHAN_PLAYER_CONFIG_FILE', 'SIGNHEX_PLAYER_CONFIG_FILE', 'HEXMON_CONFIG_PATH']
        .map(key => [key, process.env[key]])
    )
    delete process.env.DARSHAN_PLAYER_CONFIG_FILE
    delete process.env.SIGNHEX_PLAYER_CONFIG_FILE
    process.env.HEXMON_CONFIG_PATH = path.join(dir, 'config.json')
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify({ deviceId: LIVE_IDS.device, apiBase: 'https://backend.example.test',
      cache: { path: path.join(dir, 'cache'), maxBytes: 10485760 }, mtls: { enabled: false, certPath: path.join(dir, 'certs/client.crt'), keyPath: path.join(dir, 'certs/client.key'), caPath: path.join(dir, 'certs/ca.crt') }, livePlayback: { enabled: false } }))
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    engine = getPlaybackEngine()
    sandbox.stub(engine, 'stop')
    sandbox.stub(engine, 'start').resolves()
    sandbox.stub(engine, 'playOwnedFallback').resolves()
    const { getPlayerFlow } = require('../../../src/main/services/player-flow')
    flow = getPlayerFlow()
    const { getContentOwner } = require('../../../src/main/services/playback/content-owner')
    owner = getContentOwner()
    window = { isDestroyed: () => false, webContents: { id: 91, isDestroyed: () => false, send: sinon.spy(), setAudioMuted: sinon.spy(), reload: sinon.spy() } }
    flow.attachWindow(window)
    flow.state = 'PAIRED_RUNTIME'
  })
  afterEach(async () => {
    flow.stop(); clock?.restore(); clock = undefined
    await Promise.resolve()
    sandbox.restore()
    for (const [key, value] of Object.entries(originalConfigPaths)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    cleanupTempDir(dir); clearModules()
  })
  it('keeps unavailable emergency authority visible and never resolves it as ordinary default', () => {
    flow.handlePlaylistUpdate({ mode: 'emergency', items: [], unavailableReason: 'EMERGENCY_CONTENT_UNAVAILABLE' })
    expect(flow.getStatus().mode).to.equal('emergency')
    expect(flow.getStatus().contentUnavailableReason).to.equal('EMERGENCY_CONTENT_UNAVAILABLE')
    expect(engine.start.called).to.equal(false)
  })
  it('keeps a failed disposal muted, reloads the renderer and does not reveal fallback from old DOM', async () => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    window.webContents.setAudioMuted.resetHistory()
    const output = flow.liveCoordinator.options.output
    const pending = output.disposeOrdinary(() => true)
    await clock.tickAsync(1500)
    expect(await pending).to.equal(false)
    expect(window.webContents.reload.calledOnce).to.equal(true)
    expect(flow.rendererDisposalFailed).to.equal(true)
    flow.applyLiveFallback({ mode: 'live', items: [{ id: 'old', type: 'video' }] }, { phase: 'FALLBACK', fallbackReady: true })
    expect(window.webContents.setAudioMuted.calledWith(false)).to.equal(false)
    expect(engine.playOwnedFallback.called).to.equal(false)
  })
  it('does not let a delayed old first-frame disposal stop a new emergency owner', async () => {
    let release
    flow.fallbackTransition = new Promise(resolve => { release = resolve })
    let current = true
    const stopped = engine.stop.callCount
    const pending = flow.liveCoordinator.options.output.disposeOrdinary(() => current)
    current = false
    release(); await pending
    expect(engine.stop.callCount).to.equal(stopped)
    expect(window.webContents.send.calledWith('playback-owner:dispose')).to.equal(false)
  })
  it('resets the device-bound authority when local pairing identity is cleared', () => {
    const reset = sandbox.spy(flow.liveCoordinator, 'resetIdentity')
    flow.clearIdentityBoundRuntimeState()
    expect(reset.calledOnce).to.equal(true)
    expect(reset.calledBefore(engine.stop)).to.equal(true)
    expect(owner.getOwner()).to.equal('blocked')
  })
  it('binds LIVE authority to the same process runtime session carried by ordinary signed heartbeats', () => {
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    const authority = flow.liveCoordinator.options.createAuthority()
    expect(authority.runtimeSessionId).to.equal(getPairingService().getRuntimeSessionId())
    expect(flow.liveCoordinator.options.createAuthority().runtimeSessionId).to.equal(authority.runtimeSessionId)
  })
  it('holds LIVE while backend/trust reconfiguration enters real pairing/snapshot recovery', async () => {
    const { getConfigManager } = require('../../../src/common/config')
    const previous = getConfigManager().getConfig()
    const reset = sandbox.spy(flow.liveCoordinator, 'resetIdentity')
    const recover = sandbox.stub(flow, 'retryRecovery').resolves()
    flow.reconfigureLive(previous, { ...previous, apiBase: 'https://other-backend.example.test' })
    flow.handlePlaylistUpdate({ mode: 'normal', items: [{ id: 'unvalidated', type: 'image' }] })
    await Promise.resolve()
    expect(reset.calledOnce).to.equal(true)
    expect(recover.calledOnce).to.equal(true)
    expect(flow.liveTransportRecoveryRequired).to.equal(true)
    expect(flow.getStatus().live.reason).to.equal('BACKEND_REVALIDATION')
    expect(engine.start.called).to.equal(false)
  })
})
