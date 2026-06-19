const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')

describe('PlaybackProgressStore', () => {
  let tempDir
  let progressPath

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-playback-progress-'))
    progressPath = path.join(tempDir, 'playback-progress.json')
  })

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('writes and reads the latest matching playback progress', async () => {
    const { PlaybackProgressStore } = require('../../../src/main/services/playback-progress-store.ts')
    const store = new PlaybackProgressStore(progressPath)
    const now = new Date('2026-06-19T10:00:00.000Z').toISOString()

    await store.record({
      scheduleId: 'schedule-1',
      snapshotId: 'snapshot-1',
      sceneId: 'scene-1',
      slotId: 'slot-1',
      itemId: 'item-1',
      mediaId: 'media-1',
      positionMs: 123456,
      itemDisplayMs: 464000,
      updatedAt: now,
    })

    const latest = store.getLatest(
      {
        scheduleId: 'schedule-1',
        snapshotId: 'snapshot-1',
        sceneId: 'scene-1',
        slotId: 'slot-1',
      },
      { nowMs: Date.parse(now) + 1000 },
    )

    expect(latest).to.include({
      scheduleId: 'schedule-1',
      snapshotId: 'snapshot-1',
      sceneId: 'scene-1',
      slotId: 'slot-1',
      itemId: 'item-1',
      mediaId: 'media-1',
      positionMs: 123456,
      itemDisplayMs: 464000,
    })
  })

  it('does not persist URLs or arbitrary secret-looking fields', async () => {
    const { PlaybackProgressStore } = require('../../../src/main/services/playback-progress-store.ts')
    const store = new PlaybackProgressStore(progressPath)

    await store.record({
      scheduleId: 'schedule-1',
      sceneId: 'scene-1',
      slotId: 'slot-1',
      itemId: 'item-1',
      mediaId: 'https://user:pass@cdn.example.com/video.mp4?token=abc#secret',
      mediaUrl: 'https://cdn.example.com/video.mp4?token=abc',
      signedUrl: 'https://cdn.example.com/video.mp4?signature=abc',
      token: 'secret-token',
      password: 'secret-password',
      positionMs: 1000,
      updatedAt: '2026-06-19T10:00:00.000Z',
    })

    const serialized = fs.readFileSync(progressPath, 'utf8')
    expect(serialized).not.to.contain('https://')
    expect(serialized).not.to.contain('user:pass')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('signature')
    expect(serialized).not.to.contain('secret-password')
    expect(serialized).not.to.contain('cdn.example.com')
  })

  it('ignores stale or mismatched progress', async () => {
    const { PlaybackProgressStore } = require('../../../src/main/services/playback-progress-store.ts')
    const store = new PlaybackProgressStore(progressPath)
    const nowMs = Date.parse('2026-06-19T10:00:00.000Z')

    await store.record({
      scheduleId: 'schedule-1',
      itemId: 'item-1',
      mediaId: 'media-1',
      positionMs: 1000,
      updatedAt: new Date(nowMs - 11 * 60 * 1000).toISOString(),
    })

    expect(store.getLatest({ scheduleId: 'schedule-1' }, { nowMs })).to.equal(null)
    expect(store.getLatest({ scheduleId: 'schedule-2' }, { nowMs: nowMs - 10 * 60 * 1000 })).to.equal(null)
  })

  it('clears playback progress state', async () => {
    const { PlaybackProgressStore } = require('../../../src/main/services/playback-progress-store.ts')
    const store = new PlaybackProgressStore(progressPath)

    await store.record({
      scheduleId: 'schedule-1',
      itemId: 'item-1',
      mediaId: 'media-1',
      positionMs: 1000,
      updatedAt: '2026-06-19T10:00:00.000Z',
    })

    expect(fs.existsSync(progressPath)).to.equal(true)
    store.clear()
    expect(fs.existsSync(progressPath)).to.equal(false)
  })
})
