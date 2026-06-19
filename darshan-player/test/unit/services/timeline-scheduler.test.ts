const { expect } = require('chai')

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
})
