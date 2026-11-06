const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils')
const { LIVE_IDS, liveFixture } = require('../../helpers/live-fixtures')
function clearLiveModules() {
  for (const key of Object.keys(require.cache)) {
    const normalizedKey = key.replace(/\\/g, '/')
    if (normalizedKey.includes('/src/main/services/') || normalizedKey.includes('/src/common/')) delete require.cache[key]
  }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

describe('LIVE snapshot preparation authority', () => {
  let tempDir, sandbox, manager, preparation, heartbeat, response
  beforeEach(() => {
    clearLiveModules()
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('live-snapshot-')
    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify({ deviceId: LIVE_IDS.device,
      apiBase: 'https://backend.example.test', wsUrl: 'wss://backend.example.test/ws',
      cache: { path: path.join(tempDir, 'cache'), maxBytes: 10485760 }, livePlayback: { enabled: true }, mtls: { enabled: false, certPath: path.join(tempDir, 'certs/client.crt'), keyPath: path.join(tempDir, 'certs/client.key'), caPath: path.join(tempDir, 'certs/ca.crt') } }))
    const { getPairingService } = require('../../../src/main/services/pairing-service')
    sandbox.stub(getPairingService(), 'getDeviceId').returns(LIVE_IDS.device)
    const { getHttpClient } = require('../../../src/main/services/network/http-client')
    response = sandbox.stub(getHttpClient(), 'getResponse')
    const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
    sandbox.stub(getCacheManager(), 'prefetch').resolves()
    sandbox.stub(getCacheManager(), 'has').resolves(true)
    const { getHeartbeatService } = require('../../../src/main/services/telemetry/heartbeat')
    heartbeat = getHeartbeatService()
    sandbox.stub(heartbeat, 'setAppliedSnapshot')
    sandbox.stub(heartbeat, 'clearAppliedSnapshot')
    sandbox.stub(heartbeat, 'sendImmediate').resolves()
    const { SnapshotManager } = require('../../../src/main/services/snapshot-manager')
    manager = new SnapshotManager()
    preparation = deferred()
    sandbox.stub(manager.liveCache, 'prepare').callsFake(() => preparation.promise)
    sandbox.stub(manager.liveCache, 'release')
  })
  afterEach(async () => {
    preparation.resolve({ ready: false, items: [] })
    await manager.mediaCompletion
    manager.stop()
    sandbox.restore()
    delete process.env.HEXMON_CONFIG_PATH
    cleanupTempDir(tempDir)
    clearLiveModules()
  })
  it('returns persisted blocking control before download completion and withholds Success ACK', async () => {
    const { raw } = liveFixture()
    response.resolves({ status: 200, data: raw })
    const observed = []
    manager.on('playlist-updated', playlist => observed.push(playlist.mode))
    const playlist = await manager.refreshSnapshot()
    expect(playlist.mode).to.equal('live')
    expect(playlist.items).to.deep.equal([])
    expect(manager.didLastRefreshSucceed()).to.equal(true)
    expect(observed).to.include('live')
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
    const persisted = fs.readFileSync(path.join(tempDir, 'cache', 'last-snapshot.json'), 'utf8')
    expect(persisted).not.to.include('temporary-secret')
    preparation.resolve({ ready: true, items: [{ id: 'fallback-entry', mediaId: LIVE_IDS.media, type: 'image', localPath: '/exact-approved-image', displayMs: 10000 }],
      proof: { preparation_id: LIVE_IDS.preparation, source_fingerprint: 'a'.repeat(64), asset_set_sha256: 'b'.repeat(64), ready: true } })
    await manager.mediaCompletion
    expect(heartbeat.setAppliedSnapshot.calledOnceWithExactly(LIVE_IDS.publish, LIVE_IDS.snapshot)).to.equal(true)
    expect(manager.getCurrentPlaylist().items[0].mediaId).to.equal(LIVE_IDS.media)
  })
  it('shows fresh emergency before deferred fallback download, then preserves emergency selection', async () => {
    const { raw } = liveFixture()
    raw.emergency = { id: 'urgent', active: true, kind: 'MESSAGE', message: 'Evacuate now', expires_at: new Date(Date.now() + 30000).toISOString() }
    response.resolves({ status: 200, data: raw })
    const playlist = await manager.refreshSnapshot()
    expect(playlist.mode).to.equal('emergency')
    expect(playlist.items[0].meta.emergency_message).to.equal('Evacuate now')
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
    preparation.resolve({ ready: false, items: [] })
    await manager.mediaCompletion
    expect(manager.getCurrentPlaylist().mode).to.equal('emergency')
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
  })
  it('keeps unavailable emergency blocking while its exact expiry is locally reevaluated', async () => {
    const { raw } = liveFixture()
    raw.emergency = { active: true, expires_at: new Date(Date.now() + 5000).toISOString() }
    response.resolves({ status: 200, data: raw })
    const playlist = await manager.refreshSnapshot()
    expect(playlist.mode).to.equal('emergency')
    expect(playlist.items).to.deep.equal([])
    expect(playlist.unavailableReason).to.equal('EMERGENCY_CONTENT_UNAVAILABLE')
    expect(manager.evaluationTimer).to.exist
  })
  it('does not let an old completion restore playback or ACK after identity deletion', async () => {
    response.resolves({ status: 200, data: liveFixture().raw })
    await manager.refreshSnapshot()
    const completion = manager.mediaCompletion
    manager.clearIdentityBoundState()
    preparation.resolve({ ready: true, items: [{ id: 'stale', mediaId: LIVE_IDS.media, type: 'image' }] })
    await completion
    expect(manager.getCurrentPlaylist().mode).to.equal('empty')
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
    expect(fs.existsSync(path.join(tempDir, 'cache', 'last-snapshot.json'))).to.equal(false)
  })
  it('fences an in-flight cached reevaluation after identity deletion', async () => {
    response.resolves({ status: 200, data: liveFixture().raw })
    await manager.refreshSnapshot()
    const evaluated = deferred()
    sandbox.stub(manager, 'buildPlaylist').returns(evaluated.promise)
    const pending = manager.rebuildFromCachedSnapshot()
    manager.clearIdentityBoundState()
    evaluated.resolve({ mode: 'live', items: [{ id: 'old-fallback' }] })
    await pending
    expect(manager.getCurrentPlaylist()).to.deep.equal({ mode: 'empty', items: [] })
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
  })
  it('uses server time before selecting active LIVE even when host clock differs', async () => {
    response.resolves({ status: 200, data: liveFixture(Date.now() + 3600000).raw })
    expect((await manager.refreshSnapshot()).mode).to.equal('live')
  })
  it('returns cached 304 control without waiting on unfinished immutable preparation', async () => {
    response.onFirstCall().resolves({ status: 200, data: liveFixture().raw })
    response.onSecondCall().resolves({ status: 304 })
    await manager.refreshSnapshot()
    expect((await manager.refreshSnapshot()).mode).to.equal('live')
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
  })
  it('never substitutes an ordinary default for invalid LIVE policy', async () => {
    const { raw, policy } = liveFixture()
    policy.presenter_user_id = 'invalid'
    response.resolves({ status: 200, data: raw })
    const playlist = await manager.refreshSnapshot()
    expect(playlist.mode).to.equal('live')
    expect(playlist.items).to.deep.equal([])
    await manager.mediaCompletion
    expect(heartbeat.setAppliedSnapshot.called).to.equal(false)
  })
})
