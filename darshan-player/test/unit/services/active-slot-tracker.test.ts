const { expect } = require('chai')
const sinon = require('sinon')
const { retainRecordedActiveSlots } = require('../../../src/main/services/playback/active-slot-tracker')

describe('Active layout slot tracking', () => {
  const slot = (playbackInstanceId: string) => ({
    playback_instance_id: playbackInstanceId,
    schedule_id: 'schedule-1',
    media_id: 'media-1',
    scene_id: 'scene-1',
    slot_id: 'main',
    item_id: 'item-1',
  })

  it('retries a first-frame report that PoP could not accept yet', () => {
    const recordStart = sinon.stub().onFirstCall().returns(false).onSecondCall().returns(true)
    const reported = new Map([['playback-1', slot('playback-1')]])

    const first = retainRecordedActiveSlots(new Map(), reported, recordStart)
    const second = retainRecordedActiveSlots(first, reported, recordStart)

    expect(first.size).to.equal(0)
    expect(second.has('playback-1')).to.equal(true)
    expect(recordStart.callCount).to.equal(2)
  })

  it('does not reopen a slot after PoP has accepted it', () => {
    const existing = slot('playback-1')
    const recordStart = sinon.spy(() => true)

    const next = retainRecordedActiveSlots(
      new Map([['playback-1', existing]]),
      new Map([['playback-1', existing]]),
      recordStart
    )

    expect(next.get('playback-1')).to.equal(existing)
    expect(recordStart.called).to.equal(false)
  })

  it('drops slots that are no longer reported', () => {
    const next = retainRecordedActiveSlots(
      new Map([['playback-1', slot('playback-1')]]),
      new Map(),
      sinon.spy()
    )

    expect(next.size).to.equal(0)
  })
})
