const { expect } = require('chai')
const sinon = require('sinon')

describe('TimelineScheduler schedule resume alignment', () => {
  it('starts a multi-item schedule at the wall-clock active item', () => {
    const { TimelineScheduler } = require('../../../src/main/services/playback/timeline-scheduler.ts')
    const scheduler = new TimelineScheduler()
    const originalNow = Date.now
    Date.now = () => Date.parse('2026-06-19T10:01:10.000Z')

    try {
      const played = []
      scheduler.on('play-item', (scheduledItem) => {
        played.push(scheduledItem)
      })

      scheduler.start([
        {
          id: 'item-1',
          type: 'image',
          mediaId: 'media-1',
          displayMs: 60000,
          fit: 'contain',
          muted: true,
          loop: false,
          transitionDurationMs: 0,
          meta: {
            scheduleWindowStartsAt: '2026-06-19T10:00:00.000Z',
            serverTimeOffsetMs: 0,
          },
        },
        {
          id: 'item-2',
          type: 'video',
          mediaId: 'media-2',
          displayMs: 60000,
          fit: 'contain',
          muted: true,
          loop: false,
          transitionDurationMs: 0,
          meta: {
            scheduleWindowStartsAt: '2026-06-19T10:00:00.000Z',
            serverTimeOffsetMs: 0,
          },
        },
      ])

      expect(played).to.have.length(1)
      expect(played[0].index).to.equal(1)
      expect(played[0].item.id).to.equal('item-2')
      expect(played[0].resumeDecision.seekMs).to.equal(10000)
      expect(played[0].resumeDecision.remainingMs).to.equal(50000)
    } finally {
      scheduler.stop()
      Date.now = originalNow
    }
  })

  it('marks a completed single non-looping schedule item as complete', () => {
    const { TimelineScheduler } = require('../../../src/main/services/playback/timeline-scheduler.ts')
    const scheduler = new TimelineScheduler()
    const originalNow = Date.now
    Date.now = () => Date.parse('2026-06-19T10:08:00.000Z')

    try {
      const played = []
      scheduler.on('play-item', (scheduledItem) => {
        played.push(scheduledItem)
      })

      scheduler.start([
        {
          id: 'item-video',
          type: 'video',
          mediaId: 'media-video',
          displayMs: 464000,
          fit: 'contain',
          muted: false,
          loop: false,
          transitionDurationMs: 0,
          meta: {
            scheduleWindowStartsAt: '2026-06-19T10:00:00.000Z',
            serverTimeOffsetMs: 0,
          },
        },
      ])

      expect(played).to.have.length(1)
      expect(played[0].resumeDecision.completed).to.equal(true)
      expect(played[0].resumeDecision.autoplay).to.equal(false)
      expect(played[0].endTime).to.equal(played[0].startTime)
    } finally {
      scheduler.stop()
      Date.now = originalNow
    }
  })

  it('keeps one looping occurrence mounted instead of restarting it every display duration', () => {
    const clock = sinon.useFakeTimers({ now: Date.parse('2026-06-19T10:00:00.000Z') })
    const { TimelineScheduler } = require('../../../src/main/services/playback/timeline-scheduler.ts')
    const scheduler = new TimelineScheduler()
    const played = []
    const completed = []
    scheduler.on('play-item', (scheduledItem) => played.push(scheduledItem))
    scheduler.on('item-complete', (scheduledItem) => completed.push(scheduledItem))

    try {
      scheduler.start([
        {
          id: 'looping-video',
          type: 'video',
          mediaId: 'media-video',
          displayMs: 2000,
          fit: 'contain',
          muted: true,
          loop: true,
          transitionDurationMs: 0,
        },
      ])

      clock.tick(10_000)
      expect(played).to.have.length(1)
      expect(completed).to.have.length(0)
      expect(played[0].endTime).to.equal(Number.POSITIVE_INFINITY)
    } finally {
      scheduler.stop()
      clock.restore()
    }
  })

  it('ends one continuously mounted loop at its authoritative schedule boundary without remounting', () => {
    const clock = sinon.useFakeTimers({ now: Date.parse('2026-06-19T10:00:00.000Z') })
    const { TimelineScheduler } = require('../../../src/main/services/playback/timeline-scheduler.ts')
    const scheduler = new TimelineScheduler()
    const played = []
    const completed = []
    const timelineCompletions = []
    scheduler.on('play-item', (scheduledItem) => played.push(scheduledItem))
    scheduler.on('item-complete', (scheduledItem) => completed.push(scheduledItem))
    scheduler.on('timeline-complete', (completion) => timelineCompletions.push(completion))

    try {
      scheduler.start([
        {
          id: 'bounded-looping-video',
          type: 'video',
          mediaId: 'media-video',
          displayMs: 1000,
          fit: 'contain',
          muted: true,
          loop: true,
          transitionDurationMs: 0,
          meta: {
            scheduleWindowStartsAt: '2026-06-19T10:00:00.000Z',
            scheduleWindowEndsAt: '2026-06-19T10:00:05.000Z',
            serverTimeOffsetMs: 0,
          },
        },
      ])

      clock.tick(4999)
      expect(played).to.have.length(1)
      expect(completed).to.have.length(0)
      clock.tick(1)

      expect(played).to.have.length(1)
      expect(completed).to.have.length(1)
      expect(timelineCompletions).to.deep.equal([{ willRepeat: false, authorityEnded: true }])
    } finally {
      scheduler.stop()
      clock.restore()
    }
  })

  it('preserves the authoritative loop boundary when paused and resumed', () => {
    const clock = sinon.useFakeTimers({ now: Date.parse('2026-06-19T10:00:00.000Z') })
    const { TimelineScheduler } = require('../../../src/main/services/playback/timeline-scheduler.ts')
    const scheduler = new TimelineScheduler()
    const played = []
    const completed = []
    const timelineCompletions = []
    scheduler.on('play-item', (scheduledItem) => played.push(scheduledItem))
    scheduler.on('item-complete', (scheduledItem) => completed.push(scheduledItem))
    scheduler.on('timeline-complete', (completion) => timelineCompletions.push(completion))

    try {
      scheduler.start([
        {
          id: 'paused-bounded-loop',
          type: 'video',
          mediaId: 'media-video',
          displayMs: 1000,
          fit: 'contain',
          muted: true,
          loop: true,
          transitionDurationMs: 0,
          meta: {
            scheduleWindowStartsAt: '2026-06-19T10:00:00.000Z',
            scheduleWindowEndsAt: '2026-06-19T10:00:05.000Z',
            serverTimeOffsetMs: 0,
          },
        },
      ])

      clock.tick(2000)
      scheduler.pause()
      clock.tick(2000)
      scheduler.resume()
      clock.tick(999)
      expect(completed).to.have.length(0)
      clock.tick(1)

      expect(played).to.have.length(1)
      expect(completed).to.have.length(1)
      expect(timelineCompletions).to.deep.equal([{ willRepeat: false, authorityEnded: true }])
    } finally {
      scheduler.stop()
      clock.restore()
    }
  })

  it('cancels transition and completion timers when stopped', () => {
    const clock = sinon.useFakeTimers()
    const { TimelineScheduler } = require('../../../src/main/services/playback/timeline-scheduler.ts')
    const scheduler = new TimelineScheduler()
    const transitions = []
    const completed = []
    scheduler.on('transition-start', (...args) => transitions.push(args))
    scheduler.on('item-complete', (scheduledItem) => completed.push(scheduledItem))

    try {
      scheduler.start([
        {
          id: 'transition-cleanup-a',
          type: 'image',
          mediaId: 'media-a',
          displayMs: 1000,
          fit: 'contain',
          muted: true,
          loop: false,
          transitionDurationMs: 500,
        },
        {
          id: 'transition-cleanup-b',
          type: 'image',
          mediaId: 'media-b',
          displayMs: 1000,
          fit: 'contain',
          muted: true,
          loop: false,
          transitionDurationMs: 0,
        },
      ])
      scheduler.stop()
      clock.tick(2000)

      expect(transitions).to.have.length(0)
      expect(completed).to.have.length(0)
    } finally {
      scheduler.stop()
      clock.restore()
    }
  })
})
