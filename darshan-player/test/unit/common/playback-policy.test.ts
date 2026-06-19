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

  it('seeks a single non-looping video to the wall-clock position inside the schedule', () => {
    const { resolveScheduledResumePosition } = require('../../../src/common/playback-policy.ts')
    const startsAt = new Date('2026-06-19T10:00:00.000Z').toISOString()
    const decision = resolveScheduledResumePosition({
      startsAt,
      nowMs: Date.parse('2026-06-19T10:02:00.000Z'),
      items: [
        {
          id: 'item-video',
          mediaId: 'media-video',
          displayMs: 464000,
          loop: false,
        },
      ],
    })

    expect(decision.source).to.equal('wall-clock')
    expect(decision.index).to.equal(0)
    expect(decision.seekMs).to.equal(120000)
    expect(decision.autoplay).to.equal(true)
    expect(decision.completed).to.equal(false)
  })

  it('holds a completed single non-looping video near the final frame instead of replaying from zero', () => {
    const { resolveScheduledResumePosition } = require('../../../src/common/playback-policy.ts')
    const startsAt = new Date('2026-06-19T10:00:00.000Z').toISOString()
    const decision = resolveScheduledResumePosition({
      startsAt,
      nowMs: Date.parse('2026-06-19T10:08:00.000Z'),
      items: [
        {
          id: 'item-video',
          mediaId: 'media-video',
          displayMs: 464000,
          loop: false,
        },
      ],
    })

    expect(decision.index).to.equal(0)
    expect(decision.seekMs).to.equal(463750)
    expect(decision.autoplay).to.equal(false)
    expect(decision.completed).to.equal(true)
  })

  it('uses modulo wall-clock position for a loop-enabled single video', () => {
    const { resolveScheduledResumePosition } = require('../../../src/common/playback-policy.ts')
    const startsAt = new Date('2026-06-19T10:00:00.000Z').toISOString()
    const decision = resolveScheduledResumePosition({
      startsAt,
      nowMs: Date.parse('2026-06-19T10:08:00.000Z'),
      items: [
        {
          id: 'item-video',
          mediaId: 'media-video',
          displayMs: 464000,
          loop: true,
        },
      ],
    })

    expect(decision.index).to.equal(0)
    expect(decision.seekMs).to.equal(16000)
    expect(decision.autoplay).to.equal(true)
    expect(decision.completed).to.equal(false)
  })

  it('selects the active item in a multi-item timed slot from wall-clock elapsed time', () => {
    const { resolveScheduledResumePosition } = require('../../../src/common/playback-policy.ts')
    const startsAt = new Date('2026-06-19T10:00:00.000Z').toISOString()
    const decision = resolveScheduledResumePosition({
      startsAt,
      nowMs: Date.parse('2026-06-19T10:01:10.000Z'),
      items: [
        { id: 'item-1', mediaId: 'media-1', displayMs: 60000, loop: false },
        { id: 'item-2', mediaId: 'media-2', displayMs: 60000, loop: false },
      ],
    })

    expect(decision.index).to.equal(1)
    expect(decision.seekMs).to.equal(10000)
    expect(decision.remainingMs).to.equal(50000)
  })

  it('uses fresh matching persisted progress only when no schedule start anchor exists', () => {
    const { resolveScheduledResumePosition } = require('../../../src/common/playback-policy.ts')
    const nowMs = Date.parse('2026-06-19T10:00:00.000Z')
    const decision = resolveScheduledResumePosition({
      nowMs,
      expected: {
        scheduleId: 'schedule-1',
        sceneId: 'scene-1',
        slotId: 'slot-1',
      },
      persisted: {
        scheduleId: 'schedule-1',
        sceneId: 'scene-1',
        slotId: 'slot-1',
        itemId: 'item-2',
        mediaId: 'media-2',
        positionMs: 22000,
        updatedAt: new Date(nowMs - 3000).toISOString(),
      },
      items: [
        { id: 'item-1', mediaId: 'media-1', displayMs: 60000, loop: false },
        { id: 'item-2', mediaId: 'media-2', displayMs: 60000, loop: false },
      ],
    })

    expect(decision.source).to.equal('persisted')
    expect(decision.index).to.equal(1)
    expect(decision.seekMs).to.equal(22000)
  })

  it('rejects stale or mismatched persisted progress', () => {
    const { resolveScheduledResumePosition } = require('../../../src/common/playback-policy.ts')
    const nowMs = Date.parse('2026-06-19T10:00:00.000Z')
    const items = [
      { id: 'item-1', mediaId: 'media-1', displayMs: 60000, loop: false },
    ]

    const stale = resolveScheduledResumePosition({
      nowMs,
      expected: { scheduleId: 'schedule-1' },
      persisted: {
        scheduleId: 'schedule-1',
        itemId: 'item-1',
        mediaId: 'media-1',
        positionMs: 22000,
        updatedAt: new Date(nowMs - 11 * 60 * 1000).toISOString(),
      },
      items,
    })

    const mismatch = resolveScheduledResumePosition({
      nowMs,
      expected: { scheduleId: 'schedule-2' },
      persisted: {
        scheduleId: 'schedule-1',
        itemId: 'item-1',
        mediaId: 'media-1',
        positionMs: 22000,
        updatedAt: new Date(nowMs - 1000).toISOString(),
      },
      items,
    })

    expect(stale.source).to.equal('initial')
    expect(stale.seekMs).to.equal(0)
    expect(mismatch.source).to.equal('initial')
    expect(mismatch.seekMs).to.equal(0)
  })

  it('clamps video seek time to a safe final frame', () => {
    const { clampVideoSeekSeconds } = require('../../../src/common/playback-policy.ts')

    expect(clampVideoSeekSeconds(480000, 464, 464000)).to.equal(463.75)
    expect(clampVideoSeekSeconds(120000, 464, 464000)).to.equal(120)
  })
})
