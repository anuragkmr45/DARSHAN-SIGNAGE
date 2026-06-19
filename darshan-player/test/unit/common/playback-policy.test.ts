const { expect } = require('chai')

describe('Playback policy helpers', () => {
  it('does not repeat a single non-looping scheduled item', () => {
    const { shouldRepeatScheduledItem } = require('../../../src/common/playback-policy.ts')

    expect(shouldRepeatScheduledItem(1, { loop: false })).to.equal(false)
  })

  it('repeats multi-item schedules and explicitly looped single items', () => {
    const { shouldRepeatScheduledItem } = require('../../../src/common/playback-policy.ts')

    expect(shouldRepeatScheduledItem(2, { loop: false })).to.equal(true)
    expect(shouldRepeatScheduledItem(1, { loop: true })).to.equal(true)
  })
})
