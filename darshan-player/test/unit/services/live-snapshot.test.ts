const { expect } = require('chai')
const { LIVE_IDS, liveFixture } = require('../../helpers/live-fixtures')
const { readLiveOccurrence } = require('../../../src/common/live-playback')
const { parseSnapshotResponse } = require('../../../src/main/services/snapshot-parser')
const { evaluateScheduleWindows } = require('../../../src/main/services/snapshot-evaluator')

describe('Frozen LIVE snapshot control', () => {
  const context = { publishId: LIVE_IDS.publish, scheduleId: LIVE_IDS.schedule, deviceId: LIVE_IDS.device }
  it('retains an active LIVE window with no ordinary presentation or URL', () => {
    const { raw } = liveFixture()
    const parsed = parseSnapshotResponse(raw, { deviceId: LIVE_IDS.device })
    expect(parsed.items).to.deep.equal([])
    expect(parsed.scheduleWindows).to.have.length(1)
    expect(evaluateScheduleWindows(parsed.scheduleWindows, Date.now()).activeWindow.live.policy).to.exist
    expect(parsed.scheduleWindows[0].items).to.deep.equal([])
  })
  it('validates the frozen identity and never trusts the wrapper device ID', () => {
    const { raw } = liveFixture()
    const parsed = parseSnapshotResponse(raw, { deviceId: LIVE_IDS.presenter })
    expect(parsed.scheduleWindows[0].live.invalidReason).to.equal('INVALID_LIVE_POLICY')
    expect(parsed.scheduleWindows[0].live.policy).to.equal(undefined)
  })
  it('keeps invalid immutable policy blocking without persisting an injected credential', () => {
    const { raw, policy } = liveFixture()
    policy.ticket = 'unexpected-token'
    const parsed = parseSnapshotResponse(raw, { deviceId: LIVE_IDS.device })
    expect(parsed.scheduleWindows[0].live.invalidReason).to.equal('INVALID_LIVE_POLICY')
    expect(JSON.stringify(parsed.raw)).not.to.include('unexpected-token')
    expect(JSON.stringify(parsed.raw)).not.to.include('temporary-secret')
    expect(parseSnapshotResponse(parsed.raw, { deviceId: LIVE_IDS.device }).scheduleWindows[0].live.invalidReason).to.equal('INVALID_LIVE_POLICY')
  })
  it('persists exact immutable policy without expiring downloads or changing asset identities', () => {
    const { raw, asset } = liveFixture()
    const first = parseSnapshotResponse(raw, { deviceId: LIVE_IDS.device })
    const cached = parseSnapshotResponse(first.raw, { deviceId: LIVE_IDS.device })
    expect(cached.scheduleWindows[0].live.policy.fallback.manifest.assets[0]).to.deep.equal(asset)
    expect(cached.scheduleWindows[0].live.downloads).to.deep.equal([])
    expect(JSON.stringify(first.raw)).not.to.include('temporary-secret')
  })
  it('treats remote URL unavailability separately from valid immutable local fallback authority', () => {
    const { item } = liveFixture()
    item.live_fallback_download_status = 'UNAVAILABLE'
    const parsed = readLiveOccurrence(item, context)
    expect(parsed.policy).to.exist
    expect(parsed.invalidReason).to.equal(undefined)
    expect(parsed.downloads).to.deep.equal([])
  })
  it('rejects wrong CAS key and dependency cycles rather than substituting media source data', () => {
    const { item, asset } = liveFixture()
    asset.object_key = 'mutable/ready.png'
    expect(readLiveOccurrence(item, context).invalidReason).to.equal('INVALID_LIVE_POLICY')
    const next = liveFixture()
    next.asset.dependencies = [next.asset.id]
    expect(readLiveOccurrence(next.item, context).invalidReason).to.equal('INVALID_LIVE_POLICY')
  })
  it('marks malformed LIVE window controls globally blocking instead of dropping to default', () => {
    const { raw, item } = liveFixture()
    delete item.end_at
    const parsed = parseSnapshotResponse(raw, { deviceId: LIVE_IDS.device })
    expect(parsed.invalidLiveControls).to.equal(true)
    expect(parsed.scheduleWindows).to.deep.equal([])
    expect(parseSnapshotResponse(parsed.raw, { deviceId: LIVE_IDS.device }).invalidLiveControls).to.equal(true)
  })
  it('retains unavailable emergency authority independently of a renderable item', () => {
    const { raw } = liveFixture()
    raw.emergency = { active: true, expires_at: new Date(Date.now() + 10000).toISOString() }
    const parsed = parseSnapshotResponse(raw, { deviceId: LIVE_IDS.device })
    expect(parsed.emergencyActive).to.equal(true)
    expect(parsed.emergencyItem).to.equal(undefined)
  })
})
