const { expect } = require('chai')
const sinon = require('sinon')
const { LIVE_IDS, liveFixture } = require('../../helpers/live-fixtures')
const { readLiveOccurrence } = require('../../../src/common/live-playback')
const { LivePlaybackCoordinator } = require('../../../src/main/services/live-playback-coordinator')
const { LiveAuthorityError } = require('../../../src/main/services/live-authority-client')
const RUN = '01234567-1234-4234-8234-123456789abc'
const ADMISSION = '11234567-1234-4234-8234-123456789abc'
function waitingValue() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

describe('Normal player LIVE coordinator ownership and deadlines', () => {
  let clock, fixture, occurrence, client, cache, view, output, coordinator, callbacks, wall, enabled, state
  beforeEach(() => {
    wall = Date.now()
    clock = sinon.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    fixture = liveFixture(wall)
    occurrence = readLiveOccurrence(fixture.item, { publishId: LIVE_IDS.publish, scheduleId: LIVE_IDS.schedule, deviceId: LIVE_IDS.device })
    state = { occurrence_id: LIVE_IDS.source, availability: 'READY', enabled: true, policy_status: 'VALID', run: { id: RUN, generation: 1, state: 'RUNNING' } }
    const identity = { occurrence_id: LIVE_IDS.source, publish_id: LIVE_IDS.publish, schedule_item_id: LIVE_IDS.item,
      run_id: RUN, generation: 1, admission_id: ADMISSION, role: 'receiver', presenter_participant_id: `presenter_${RUN}` }
    client = { resetEpoch: sinon.spy(), discover: sinon.stub().callsFake(async () => ({ server_now: new Date(wall + clock.now).toISOString(),
      authority_epoch: LIVE_IDS.device, live_version: null, current: { occurrence: { ...occurrence }, state: { ...state } }, next: null, blockedWindows: [] })),
      create: sinon.stub().callsFake(async () => ({ ...identity, run_id: state.run.id, generation: state.run.generation, status: 'READY', retry_after_ms: 500 })),
      grant: sinon.stub().callsFake(async (_action, _occ, admission) => ({ ...admission, status: 'AUTHORIZED', lease_ms: 10000, window_remaining_ms: 60000 - clock.now,
        renew_after_ms: 3000, signaling: { url: 'wss://media.example.test', ticket: 'ephemeral-ticket' } })), observe: sinon.stub().resolves() }
    const proof = { preparation_id: LIVE_IDS.preparation, source_fingerprint: 'a'.repeat(64), asset_set_sha256: 'b'.repeat(64), ready: true }
    const items = [{ id: LIVE_IDS.entry, mediaId: LIVE_IDS.media, type: 'image', localPath: '/approved-file' }]
    cache = { updateDiscoveredLiveOccurrences: sinon.spy(), prepareLiveFallback: sinon.stub().resolves({ ready: true, items, proof }),
      getLiveFallbackPlaylist: sinon.stub().callsFake(occ => ({ mode: 'live', live: occ, publishId: occ.publishId, scheduleId: occ.scheduleId, items })),
      getScheduleNowMs: () => wall + clock.now }
    callbacks = []
    view = { connect: sinon.spy((_grant, authorized, observe) => callbacks.push({ authorized, observe })), activate: sinon.stub().returns(true), destroy: sinon.stub() }
    output = { fallback: sinon.spy(), status: sinon.spy(), disposeOrdinary: sinon.stub().resolves(true), released: sinon.spy(), identityFailure: sinon.spy() }
    enabled = true
    coordinator = new LivePlaybackCoordinator({ enabled: () => enabled, createAuthority: () => client, cache, view, output, now: () => clock.now })
  })
  afterEach(() => { coordinator.dispose(); clock.restore() })
  function begin() { coordinator.setContext(true, { mode: 'live', live: occurrence, items: [] }) }
  async function connected() {
    begin()
    await clock.tickAsync(1000)
    expect(view.connect.calledOnce).to.equal(true)
    return callbacks[0]
  }
  it('keeps fallback until an authorized decoded frame and exact ordinary-renderer disposal ACK', async () => {
    const receiver = await connected()
    expect(view.activate.called).to.equal(false)
    const disposal = waitingValue()
    output.disposeOrdinary.returns(disposal.promise)
    receiver.observe({ kind: 'first-frame', view_epoch: 'view' })
    await clock.tickAsync(0)
    expect(output.disposeOrdinary.calledOnce).to.equal(true)
    expect(view.activate.called).to.equal(false)
    disposal.resolve(true)
    await clock.tickAsync(0)
    expect(view.activate.calledOnce).to.equal(true)
    expect(coordinator.getStatus().phase).to.equal('LIVE')
    expect(JSON.stringify(coordinator.getStatus())).not.to.include('ephemeral-ticket')
  })
  it('does not create an admission while exact fallback hashing is unfinished', async () => {
    const hashing = waitingValue()
    cache.prepareLiveFallback.returns(hashing.promise)
    begin()
    await clock.tickAsync(4000)
    expect(client.create.called).to.equal(false)
    expect(output.fallback.lastCall.args[0].items).to.deep.equal([])
    hashing.resolve({ ready: false, items: [], reason: 'FALLBACK_NOT_READY' })
    await clock.tickAsync(0)
    expect(coordinator.getStatus().fallbackReady).to.equal(false)
  })
  it('preempts from REST emergency discovery before a pending hash can complete and never reveals that fallback', async () => {
    const hashing = waitingValue(), refresh = waitingValue()
    cache.prepareLiveFallback.returns(hashing.promise)
    coordinator.options.refreshControl = sinon.stub().returns(refresh.promise)
    state.availability = 'EMERGENCY'
    begin(); await clock.tickAsync(1)
    expect(coordinator.getStatus().phase).to.equal('UNAVAILABLE')
    expect(coordinator.getStatus().reason).to.equal('EMERGENCY_ACTIVE')
    expect(output.fallback.lastCall.args[0].items).to.deep.equal([])
    expect(coordinator.options.refreshControl.calledOnce).to.equal(true)
    hashing.resolve({ ready: true, items: [{ id: 'old-fallback' }], proof: { ready: true } })
    await clock.tickAsync(0)
    expect(coordinator.getStatus().fallbackReady).to.equal(false)
    expect(client.create.called).to.equal(false)
    refresh.resolve({ fresh: false, playlist: { mode: 'normal', items: [] } })
  })
  it('keeps an unresolved emergency unavailable beyond the LIVE window and releases only on fresh control', async () => {
    occurrence.endAt = new Date(wall + 1000).toISOString()
    state.availability = 'EMERGENCY'
    const first = waitingValue(), second = waitingValue()
    const refresh = sinon.stub().onFirstCall().returns(first.promise).onSecondCall().returns(second.promise)
    coordinator.options.refreshControl = refresh
    client.discover.callsFake(async () => ({ server_now: new Date(wall + clock.now).toISOString(),
      current: clock.now < 1000 ? { occurrence, state } : null, next: null, blockedWindows: [] }))
    begin(); await clock.tickAsync(1200)
    expect(coordinator.isOwningContent()).to.equal(true)
    expect(output.released.called).to.equal(false)
    first.resolve({ fresh: false, playlist: { mode: 'normal', items: [] } })
    await clock.tickAsync(0)
    coordinator.wake(); await clock.tickAsync(0)
    expect(refresh.calledTwice).to.equal(true)
    second.resolve({ fresh: true, playlist: { mode: 'normal', items: [] } })
    await clock.tickAsync(0)
    expect(coordinator.isOwningContent()).to.equal(false)
    expect(output.released.calledOnce).to.equal(true)
  })
  it('does not clear a newer confirmed emergency with an older delayed normal-control response', async () => {
    const refresh = waitingValue()
    coordinator.options.refreshControl = sinon.stub().returns(refresh.promise)
    state.availability = 'EMERGENCY'
    begin(); await clock.tickAsync(600)
    const hashes = cache.prepareLiveFallback.callCount
    output.fallback.resetHistory()
    refresh.resolve({ fresh: true, playlist: { mode: 'normal', items: [] } })
    await clock.tickAsync(0)
    expect(cache.prepareLiveFallback.callCount).to.equal(hashes)
    expect(output.fallback.getCalls().every(call => call.args[0].items.length === 0)).to.equal(true)
    expect(coordinator.getStatus().reason).to.equal('EMERGENCY_ACTIVE')
    expect(coordinator.getStatus().fallbackReady).to.equal(false)
    expect(output.released.called).to.equal(false)
  })
  it('destroys LIVE on lease expiry before waiting for a large rehash and shows unavailable for post-ready corruption', async () => {
    const receiver = await connected()
    receiver.observe({ kind: 'first-frame', view_epoch: 'view' })
    await clock.tickAsync(0)
    const hashing = waitingValue(), order = []
    cache.prepareLiveFallback.callsFake(async (_occ, options) => { if (options.force) { order.push('rehash'); return await hashing.promise } return { ready: false, items: [] } })
    view.destroy.callsFake(() => order.push('destroy'))
    client.discover.rejects(new LiveAuthorityError('LIVE_AUTHORITY_UNAVAILABLE'))
    const pulse = setInterval(() => receiver.observe({ kind: 'heartbeat', view_epoch: 'view' }), 1000)
    await clock.tickAsync(9000)
    expect(receiver.authorized()).to.equal(true)
    await clock.tickAsync(1000)
    clearInterval(pulse)
    expect(order[0]).to.equal('destroy')
    expect(order).to.include('rehash')
    expect(output.fallback.lastCall.args[0].items).to.deep.equal([])
    expect(coordinator.getStatus().phase).not.to.equal('LIVE')
    hashing.resolve({ ready: false, items: [], reason: 'FALLBACK_NOT_READY' })
    await clock.tickAsync(0)
    expect(coordinator.getStatus().fallbackReady).to.equal(false)
  })
  it('rejects first-frame callbacks and late admission responses after emergency takeover', async () => {
    const late = waitingValue()
    client.create.returns(late.promise)
    begin(); await clock.tickAsync(1)
    coordinator.setContext(true, { mode: 'emergency', items: [], unavailableReason: 'EMERGENCY_CONTENT_UNAVAILABLE' })
    late.resolve({ admission_id: ADMISSION })
    await clock.tickAsync(1000)
    expect(view.connect.called).to.equal(false)
    expect(coordinator.isOwningContent()).to.equal(false)
    expect(client.grant.called).to.equal(false)
  })
  it('does not activate after a valid first frame if the window ends while disposal is pending', async () => {
    occurrence.endAt = new Date(wall + 2000).toISOString()
    const receiver = await connected()
    const disposal = waitingValue()
    output.disposeOrdinary.returns(disposal.promise)
    receiver.observe({ kind: 'first-frame', view_epoch: 'view' })
    await clock.tickAsync(1400)
    disposal.resolve(true); await clock.tickAsync(0)
    expect(view.activate.called).to.equal(false)
    expect(receiver.authorized()).to.equal(false)
    expect(output.released.called).to.equal(true)
  })
  it('fences a replaced run and never accepts the old view callback', async () => {
    const receiver = await connected()
    state.run = { id: LIVE_IDS.presenter, generation: 2, state: 'RUNNING' }
    await clock.tickAsync(3500)
    receiver.observe({ kind: 'first-frame', view_epoch: 'old' })
    await clock.tickAsync(0)
    expect(receiver.authorized()).to.equal(false)
    expect(view.activate.called).to.equal(false)
    expect(client.create.callCount).to.be.greaterThan(1)
  })
  it('treats ended-run 410 as fallback, never as deleted device or fresh pairing', async () => {
    await connected()
    client.discover.rejects(new LiveAuthorityError('LIVE_ENDED', 410))
    await clock.tickAsync(3500)
    expect(output.identityFailure.called).to.equal(false)
    expect(coordinator.getStatus().phase).not.to.equal('LIVE')
  })
  it('forwards genuine identity denial only after synchronously destroying the live view', async () => {
    await connected()
    client.discover.rejects(new LiveAuthorityError('UNAUTHORIZED', 401))
    await clock.tickAsync(3500)
    expect(output.identityFailure.called).to.equal(true)
    expect(view.destroy.calledBefore(output.identityFailure)).to.equal(true)
  })
  it('keeps all conflicting windows blocking until their separate monotonic boundaries pass', async () => {
    const first = { ...occurrence, endAt: new Date(wall + 1000).toISOString() }, second = { ...occurrence, itemId: LIVE_IDS.entry, endAt: new Date(wall + 2500).toISOString() }
    client.discover.callsFake(async () => ({ server_now: new Date(wall + clock.now).toISOString(), current: null, next: null,
      blockedWindows: [first, second].filter(item => Date.parse(item.endAt) > wall + clock.now) }))
    coordinator.setContext(true, { mode: 'normal', items: [] })
    await clock.tickAsync(1500)
    expect(coordinator.isOwningContent()).to.equal(true)
    expect(output.released.called).to.equal(false)
    await clock.tickAsync(1200)
    expect(coordinator.isOwningContent()).to.equal(false)
  })
  it('blocks LIVE without any network request when the feature gate is off', async () => {
    enabled = false
    begin(); await clock.tickAsync(5000)
    expect(client.discover.called).to.equal(false)
    expect(output.fallback.lastCall.args[0].items).to.deep.equal([])
    expect(coordinator.getStatus().reason).to.equal('LIVE_PLAYBACK_DISABLED')
  })
  it('releases a disabled LIVE owner at its boundary so later ordinary content can resume', async () => {
    enabled = false
    occurrence.endAt = new Date(wall + 1000).toISOString()
    begin(); await clock.tickAsync(1200)
    coordinator.setContext(true, { mode: 'normal', items: [] })
    expect(coordinator.isOwningContent()).to.equal(false)
    expect(output.released.calledOnce).to.equal(true)
    expect(client.discover.called).to.equal(false)
  })
  it('releases a malformed window placeholder when fresh control removes it, even with LIVE disabled', () => {
    enabled = false
    coordinator.setContext(true, { mode: 'live', items: [], unavailableReason: 'INVALID_LIVE_WINDOW' })
    expect(coordinator.isOwningContent()).to.equal(true)
    coordinator.setContext(true, { mode: 'normal', items: [] })
    expect(coordinator.isOwningContent()).to.equal(false)
    expect(client.discover.called).to.equal(false)
  })
  it('recreates identity-bound authority after fresh pairing and fences old in-flight admission callbacks', async () => {
    const create = sinon.spy(() => client)
    coordinator.dispose()
    coordinator = new LivePlaybackCoordinator({ enabled: () => true, createAuthority: create, cache, view, output, now: () => clock.now })
    const late = waitingValue()
    client.create.onFirstCall().returns(late.promise)
    begin(); await clock.tickAsync(1)
    expect(create.calledOnce).to.equal(true)
    coordinator.resetIdentity()
    begin(); await clock.tickAsync(1000)
    late.resolve({ admission_id: 'old-admission' }); await clock.tickAsync(0)
    expect(create.calledTwice).to.equal(true)
    expect(coordinator.getStatus().admissionId).not.to.equal('old-admission')
    expect(output.identityFailure.called).to.equal(false)
  })
  it('destroys the active view immediately when feature disablement occurs', async () => {
    const receiver = await connected()
    enabled = false
    coordinator.setContext(true, { mode: 'live', live: occurrence, items: [] })
    expect(receiver.authorized()).to.equal(false)
    expect(coordinator.getStatus().fallbackReady).to.equal(false)
    expect(view.destroy.callCount).to.be.greaterThan(1)
  })
  it('never auto-starts a stopped or disabled run', async () => {
    state.availability = 'ENDED'; state.run.state = 'STOPPED'
    begin(); await clock.tickAsync(5000)
    expect(client.create.called).to.equal(false)
    expect(client.grant.called).to.equal(false)
  })
})
