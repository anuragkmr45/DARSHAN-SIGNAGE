const { expect } = require('chai')
const sinon = require('sinon')
const { LIVE_IDS, liveFixture } = require('../../helpers/live-fixtures')
const { readLiveOccurrence } = require('../../../src/common/live-playback')
const { LiveAuthorityClient, validateLiveSignalUrl } = require('../../../src/main/services/live-authority-client')
const { DeviceApiError } = require('../../../src/common/types')
const RUNTIME = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const EPOCH = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const RUN = '01234567-1234-4234-8234-123456789abc'
const ADMISSION = '11234567-1234-4234-8234-123456789abc'
function runtimeState(occurrence) {
  return { version: 1, authority_epoch: EPOCH, server_now: new Date().toISOString(), live_version: `${EPOCH}/${RUN}/1/1`, availability: 'READY',
    occurrence_id: LIVE_IDS.source, publish_id: occurrence.publishId, schedule_id: occurrence.scheduleId, schedule_item_id: occurrence.itemId,
    start_at: occurrence.startAt, end_at: occurrence.endAt, screen_ids: [LIVE_IDS.device], control_revision: 1, enabled: true, policy_status: 'VALID', policy: occurrence.policy,
    run: { id: RUN, generation: 1, state: 'RUNNING', node_instance_id: LIVE_IDS.storage, presenter_participant_id: `presenter_${RUN}`,
      created_at: new Date().toISOString(), stopped_at: null, owns_current_attempt: false } }
}
function identity(occurrence) {
  return { version: 1, authority_epoch: EPOCH, server_now: new Date().toISOString(), live_version: null,
    occurrence_id: LIVE_IDS.source, publish_id: occurrence.publishId, schedule_item_id: occurrence.itemId, run_id: RUN, generation: 1,
    admission_id: ADMISSION, role: 'receiver', participant_id: `receiver_${LIVE_IDS.device}_${RUNTIME}`, presenter_participant_id: `presenter_${RUN}`,
    presenter_user_id: LIVE_IDS.presenter, microphone: false, screen_share_audio: false }
}
describe('Signed-device live REST authority client', () => {
  let client, request, fixture, occurrence
  beforeEach(() => {
    fixture = liveFixture()
    occurrence = readLiveOccurrence(fixture.item, { publishId: LIVE_IDS.publish, scheduleId: LIVE_IDS.schedule, deviceId: LIVE_IDS.device })
    request = sinon.stub().callsFake(async (_method, pathname, body) => {
      if (pathname.endsWith('/live-authority-epoch')) return { version: 1, nonce: body.nonce, epoch_id: EPOCH, server_now: new Date().toISOString() }
      return runtimeState(occurrence)
    })
    client = new LiveAuthorityClient(LIVE_IDS.device, { apiBase: 'https://backend.example.test', request, runtimeSessionId: RUNTIME })
  })
  it('authenticates a random nonce/epoch before interpreting opaque live-version state', async () => {
    const state = await client.state(occurrence)
    expect(request.firstCall.args[1]).to.include('/live-authority-epoch')
    expect(request.firstCall.args[2].nonce).to.match(/^[a-f0-9-]{36}$/)
    expect(state.live_version).to.include(EPOCH)
    expect(state.run.presenter_participant_id).to.equal(`presenter_${RUN}`)
  })
  it('rejects wrong nonce and old authority epochs rather than resetting numeric ordering blindly', async () => {
    request.resolves({ version: 1, nonce: LIVE_IDS.device, epoch_id: EPOCH, server_now: new Date().toISOString() })
    let failed = false
    try { await client.state(occurrence) } catch (error) { failed = error.code === 'INVALID_LIVE_AUTHORITY' }
    expect(failed).to.equal(true)
    request.callsFake(async (_method, pathname, body) => pathname.endsWith('/live-authority-epoch')
      ? { version: 1, nonce: body.nonce, epoch_id: EPOCH, server_now: new Date().toISOString() }
      : { ...runtimeState(occurrence), authority_epoch: LIVE_IDS.device })
    try { await client.state(occurrence); throw new Error('accepted stale epoch') } catch (error) { expect(error.code).to.equal('LIVE_AUTHORITY_EPOCH_CHANGED') }
  })
  it('compares policy JSON values independently of object property insertion order', async () => {
    const policy = Object.fromEntries(Object.entries(occurrence.policy).reverse())
    request.callsFake(async (_method, pathname, body) => pathname.endsWith('/live-authority-epoch')
      ? { version: 1, nonce: body.nonce, epoch_id: EPOCH, server_now: new Date().toISOString() }
      : { ...runtimeState(occurrence), policy })
    expect((await client.state(occurrence)).policy).to.deep.equal(occurrence.policy)
  })
  it('does not confuse pending creation with a lease and binds create to the selected run', async () => {
    await client.authenticateEpoch()
    request.resolves({ ...identity(occurrence), status: 'PREPARING', retry_after_ms: 500 })
    const proof = { preparation_id: LIVE_IDS.preparation, source_fingerprint: 'a'.repeat(64), asset_set_sha256: 'b'.repeat(64), ready: true }
    const pending = await client.create(occurrence, { id: RUN, generation: 1 }, proof)
    expect(pending.lease_ms).to.equal(undefined)
    expect(request.lastCall.args[2]).to.include({ run_id: RUN, generation: 1 })
    expect(request.lastCall.args[2].fallback).to.deep.equal(proof)
  })
  it('requires a fresh one-use ticket and forbids signaling credentials in renew responses', async () => {
    await client.authenticateEpoch()
    const admission = identity(occurrence)
    const grant = { ...admission, status: 'AUTHORIZED', lease_ms: 10000, window_remaining_ms: 20000, renew_after_ms: 3000,
      signaling: { url: 'wss://media.example.test:9443', ticket: 'opaque-one-use-ticket' } }
    request.resolves(grant)
    expect((await client.grant('ticket', occurrence, admission, {})).signaling.url).to.equal('wss://media.example.test:9443')
    try { await client.grant('renew', occurrence, admission, {}); throw new Error('accepted renew ticket') } catch (error) { expect(error.code).to.equal('INVALID_LIVE_AUTHORITY') }
    request.resolves({ ...grant, signaling: undefined })
    try { await client.grant('ticket', occurrence, admission, {}); throw new Error('accepted absent ticket') } catch (error) { expect(error.code).to.equal('INVALID_LIVE_AUTHORITY') }
  })
  it('rejects a receiver identity swap, foreign presenter and oversized lease', async () => {
    await client.authenticateEpoch()
    const admission = identity(occurrence)
    for (const change of [{ participant_id: 'foreign-receiver' }, { presenter_participant_id: 'foreign-presenter' }, { lease_ms: 10001 }]) {
      request.resolves({ ...admission, status: 'AUTHORIZED', lease_ms: 10000, window_remaining_ms: 20000, renew_after_ms: 3000,
        signaling: { url: 'wss://media.example.test', ticket: 'opaque' }, ...change })
      try { await client.grant('ticket', occurrence, admission, {}); throw new Error('accepted invalid identity') } catch (error) { expect(error.code).to.equal('INVALID_LIVE_AUTHORITY') }
    }
  })
  it('preserves invalid published windows as explicit blocking controls without accepting their policy', async () => {
    await client.authenticateEpoch()
    request.resolves({ version: 1, authority_epoch: EPOCH, server_now: new Date().toISOString(), live_version: null,
      current: { state: { ...runtimeState(occurrence), availability: 'UNAVAILABLE', policy_status: 'INVALID', policy: null }, item: null }, next: null, blocked_windows: [] })
    const found = await client.discover()
    expect(found.current.occurrence.invalidReason).to.equal('INVALID_LIVE_POLICY')
    expect(found.current.state.policy).to.equal(null)
  })
  it('keeps all conflicting current windows and rejects an unrelated frozen audience', async () => {
    await client.authenticateEpoch()
    const control = { occurrence_id: LIVE_IDS.source, publish_id: LIVE_IDS.publish, schedule_id: LIVE_IDS.schedule,
      schedule_item_id: LIVE_IDS.item, start_at: occurrence.startAt, end_at: occurrence.endAt, screen_ids: [LIVE_IDS.device] }
    const envelope = { version: 1, authority_epoch: EPOCH, server_now: new Date().toISOString(), live_version: null,
      current: null, next: null, blocked_windows: [control, { ...control, schedule_item_id: LIVE_IDS.entry }] }
    request.resolves(envelope)
    expect((await client.discover()).blockedWindows).to.have.length(2)
    control.screen_ids = [LIVE_IDS.presenter]
    try { await client.discover(); throw new Error('accepted unrelated screen') } catch (error) { expect(error.code).to.equal('INVALID_LIVE_AUTHORITY') }
  })
  it('keeps ended-run conflicts separate from device identity failures', async () => {
    request.rejects(new DeviceApiError({ status: 410, code: 'LIVE_ENDED', message: 'ended', transient: false }))
    try { await client.state(occurrence); throw new Error('accepted ended') } catch (error) { expect(error.status).to.equal(410); expect(error.isIdentityFailure).to.equal(false) }
    request.rejects(new DeviceApiError({ status: 401, code: 'UNAUTHORIZED', message: 'denied', transient: false }))
    try { await client.state(occurrence); throw new Error('accepted identity') } catch (error) { expect(error.isIdentityFailure).to.equal(true) }
  })
  it('hard-cancels a transport that never returns within 1500ms, without retrying', async () => {
    const clock = sinon.useFakeTimers()
    try {
      request.returns(new Promise(() => {}))
      const waiting = client.authenticateEpoch().catch(error => error)
      await clock.tickAsync(1500)
      expect((await waiting).code).to.equal('LIVE_AUTHORITY_TIMEOUT')
      expect(request.calledOnce).to.equal(true)
      expect(request.firstCall.args[3].aborted).to.equal(true)
    } finally { clock.restore() }
  })
  it('rejects insecure or credential-bearing signal origins except explicit loopback development', () => {
    for (const url of ['ws://192.168.1.10:8090', 'wss://user:pass@example.test', 'wss://example.test/other', 'wss://example.test?token=x']) expect(() => validateLiveSignalUrl(url)).to.throw()
    expect(validateLiveSignalUrl('ws://127.0.0.1:8090', true)).to.equal('ws://127.0.0.1:8090')
    expect(() => new LiveAuthorityClient(LIVE_IDS.device, { apiBase: 'http://192.168.1.10:3000' })).to.throw()
  })
})
module.exports = { runtimeState, identity, RUN, EPOCH, RUNTIME }
