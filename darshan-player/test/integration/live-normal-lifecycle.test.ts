const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { performance } = require('perf_hooks')
const { createTempDir, cleanupTempDir } = require('../helpers/test-utils')
const { liveFixture, LIVE_IDS } = require('../helpers/live-fixtures')
const RUN = '01234567-1234-4234-8234-123456789abc'
function clearModules() { for (const key of Object.keys(require.cache)) { const normalizedKey = key.replace(/\\/g, '/'); if (normalizedKey.includes('/src/main/services/') || normalizedKey.includes('/src/common/')) delete require.cache[key] } }
async function until(predicate, limit = 5000) { const end = performance.now() + limit; while (!predicate()) { if (performance.now() >= end) throw new Error('Timed out waiting for normal LIVE integration state'); await new Promise(resolve => setTimeout(resolve, 20)) } }
describe('Normal LIVE snapshot/cache/authority ownership integration', function () {
  this.timeout(10000)
  it('waits for actual downloaded CAS bytes and renderer cleanup, then blocks post-ready corrupt offline fallback', async () => {
    clearModules()
    const sandbox = sinon.createSandbox(), dir = createTempDir('live-normal-integration-')
    const previousEnvironment = {
      DARSHAN_CONFIG_PATH: process.env.DARSHAN_CONFIG_PATH,
      DARSHAN_RUNTIME_ROOT: process.env.DARSHAN_RUNTIME_ROOT,
      DARSHAN_PLAYER_CONFIG_FILE: process.env.DARSHAN_PLAYER_CONFIG_FILE,
      HEXMON_CONFIG_PATH: process.env.HEXMON_CONFIG_PATH,
    }
    process.env.DARSHAN_RUNTIME_ROOT = dir
    process.env.DARSHAN_CONFIG_PATH = path.join(dir, 'config.json')
    delete process.env.DARSHAN_PLAYER_CONFIG_FILE
    delete process.env.HEXMON_CONFIG_PATH
    fs.writeFileSync(process.env.DARSHAN_CONFIG_PATH, JSON.stringify({ deviceId: LIVE_IDS.device, apiBase: 'https://backend.example.test', livePlayback: { enabled: true },
      cache: { path: path.join(dir, 'cache'), maxBytes: 10485760 }, mtls: { enabled: false, certPath: path.join(dir, 'certs/client.crt'), keyPath: path.join(dir, 'certs/client.key'), caPath: path.join(dir, 'certs/ca.crt') } }))
    const fixture = liveFixture()
    let releaseDownload
    const allowedDownload = new Promise(resolve => { releaseDownload = resolve })
    const sockets = new Set()
    let requests = 0
    const server = http.createServer(async (_request, response) => {
      requests += 1; await allowedDownload
      if (response.destroyed) return
      response.writeHead(200, { 'Content-Type': fixture.asset.content_type, 'Content-Length': fixture.bytes.length })
      response.end(fixture.bytes)
    })
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    fixture.item.live_fallback_downloads[0].url = `http://127.0.0.1:${server.address().port}/approved.png`
    let coordinator, manager, cache
    try {
      const { getPairingService } = require('../../src/main/services/pairing-service')
      sandbox.stub(getPairingService(), 'getDeviceId').returns(LIVE_IDS.device)
      const { getHttpClient } = require('../../src/main/services/network/http-client')
      sandbox.stub(getHttpClient(), 'getResponse').resolves({ status: 200, data: fixture.raw })
      const { getHeartbeatService } = require('../../src/main/services/telemetry/heartbeat')
      const heartbeat = getHeartbeatService()
      const applied = sandbox.stub(heartbeat, 'setAppliedSnapshot')
      sandbox.stub(heartbeat, 'sendImmediate').resolves()
      const { SnapshotManager } = require('../../src/main/services/snapshot-manager')
      manager = new SnapshotManager()
      const { getCacheManager } = require('../../src/main/services/cache/cache-manager')
      cache = getCacheManager()
      const playlist = await manager.refreshSnapshot()
      expect(playlist.mode).to.equal('live'); expect(playlist.items).to.deep.equal([]); expect(applied.called).to.equal(false)
      const occurrence = playlist.live
      const identity = { occurrence_id: LIVE_IDS.source, publish_id: LIVE_IDS.publish, schedule_item_id: LIVE_IDS.item, run_id: RUN,
        generation: 1, admission_id: LIVE_IDS.preparation, presenter_participant_id: `presenter_${RUN}` }
      const authority = { resetEpoch: () => {}, discover: async () => ({ server_now: new Date().toISOString(), current: { occurrence, state: {
        occurrence_id: LIVE_IDS.source, availability: 'READY', enabled: true, policy_status: 'VALID', run: { id: RUN, generation: 1, state: 'RUNNING' } } }, next: null, blockedWindows: [] }),
        create: sinon.stub().resolves(identity), grant: async () => ({ ...identity, lease_ms: 10000, window_remaining_ms: 50000, renew_after_ms: 3000,
          signaling: { url: 'wss://gateway.example.test', ticket: 'memory-only-ticket' } }), observe: async () => {} }
      let receiver
      const view = { connect: sinon.spy((_grant, authorized, report) => { receiver = { authorized, report } }), activate: sinon.stub().returns(true), destroy: sinon.spy() }
      const { ContentOwner } = require('../../src/main/services/playback/content-owner')
      const owner = new ContentOwner(), sender = { isDestroyed: () => false, webContents: { id: 501, isDestroyed: () => false, setAudioMuted: sinon.spy(), send: sinon.spy() } }
      owner.attach(sender); owner.advance('live-fallback')
      const output = { fallback: sinon.spy(), status: sinon.spy(), disposeOrdinary: () => owner.disposeRenderer(sender), released: sinon.spy(), identityFailure: sinon.spy() }
      const { LivePlaybackCoordinator } = require('../../src/main/services/live-playback-coordinator')
      coordinator = new LivePlaybackCoordinator({ enabled: () => true, createAuthority: () => authority, cache: manager, view, output })
      coordinator.setContext(true, playlist)
      await until(() => requests > 0)
      expect(authority.create.called).to.equal(false)
      releaseDownload()
      await manager.mediaCompletion
      expect(applied.called).to.equal(true)
      const readiness = manager.getPreparedLiveFallback(occurrence)
      expect(readiness.ready).to.equal(true)
      expect(fs.readFileSync(readiness.items[0].localPath).equals(fixture.bytes)).to.equal(true)
      coordinator.wake()
      await until(() => view.connect.called)
      expect(requests).to.equal(1)
      receiver.report({ kind: 'first-frame', view_epoch: 'current' })
      await until(() => sender.webContents.send.called)
      expect(view.activate.called).to.equal(false)
      const request = sender.webContents.send.lastCall.args[1]
      expect(owner.acknowledge(501, request)).to.equal(true)
      await until(() => view.activate.called)
      fs.writeFileSync(readiness.items[0].localPath, Buffer.alloc(fixture.bytes.length, 'x'))
      occurrence.downloads = []
      receiver.report({ kind: 'disconnected', view_epoch: 'current' })
      expect(receiver.authorized()).to.equal(false)
      expect(output.fallback.lastCall.args[0].items).to.deep.equal([])
      await until(() => coordinator.getStatus().phase === 'PREPARING_FALLBACK' || coordinator.getStatus().phase === 'UNAVAILABLE')
      const forced = await manager.prepareLiveFallback(occurrence, { force: true, download: false })
      expect(forced.ready).to.equal(false)
      expect(forced.items).to.deep.equal([])
      expect(output.identityFailure.called).to.equal(false)
    } finally {
      releaseDownload()
      coordinator?.dispose(); manager?.stop()
      if (manager?.mediaCompletion) await manager.mediaCompletion
      if (cache) await cache.cleanup()
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
      sandbox.restore()
      for (const [name, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      cleanupTempDir(dir); clearModules()
    }
  })
})
