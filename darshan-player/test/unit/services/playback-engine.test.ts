const { expect } = require('chai')
const sinon = require('sinon')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils.ts')

describe('Playback Engine', () => {
  let sandbox
  let tempDir
  let originalRuntimeRoot

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    tempDir = createTempDir('playback-engine-test-')
    originalRuntimeRoot = process.env.DARSHAN_RUNTIME_ROOT
    process.env.DARSHAN_RUNTIME_ROOT = tempDir

    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services/playback') || key.includes('src/main/services/snapshot-manager') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  afterEach(() => {
    sandbox.restore()
    if (originalRuntimeRoot === undefined) {
      delete process.env.DARSHAN_RUNTIME_ROOT
    } else {
      process.env.DARSHAN_RUNTIME_ROOT = originalRuntimeRoot
    }
    cleanupTempDir(tempDir)

    Object.keys(require.cache).forEach((key) => {
      if (key.includes('src/main/services/playback') || key.includes('src/main/services/snapshot-manager') || key.includes('src/common')) {
        delete require.cache[key]
      }
    })
  })

  it('emits a clear-active playback update when playback stops', () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getTelemetryService } = require('../../../src/main/services/telemetry/telemetry-service')

    const send = sandbox.spy()
    const clearCurrentPlayback = sandbox.spy(getTelemetryService(), 'clearCurrentPlayback')
    const engine = getPlaybackEngine()
    engine.initialize({
      webContents: {
        send,
      },
    })

    engine.stop()

    expect(send.calledWith('playback-update', {
      type: 'clear-active',
      reason: 'timeline-stopped',
    })).to.equal(true)
    expect(clearCurrentPlayback.calledOnce).to.equal(true)
  })

  it('clears an active layout scene when its authoritative timeline ends', () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const send = sandbox.spy()
    const engine = getPlaybackEngine()
    engine.initialize({ webContents: { send } })
    engine.currentItem = {
      id: 'scene:window-1',
      type: 'scene',
      displayMs: 30_000,
      fit: 'contain',
      muted: true,
      loop: false,
      transitionDurationMs: 0,
    }

    engine.scheduler.emit('timeline-complete')

    expect(send.calledWith('playback-update', {
      type: 'clear-active',
      reason: 'scene-window-complete',
    })).to.equal(true)
  })

  it('clears a native looping video when its authoritative schedule boundary ends', () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const send = sandbox.spy()
    const engine = getPlaybackEngine()
    engine.initialize({ webContents: { send } })
    engine.currentItem = {
      id: 'looping-video',
      type: 'video',
      displayMs: 2000,
      fit: 'contain',
      muted: true,
      loop: true,
      transitionDurationMs: 0,
    }

    engine.scheduler.emit('timeline-complete', { willRepeat: false, authorityEnded: true })

    expect(send.calledWith('playback-update', {
      type: 'clear-active',
      reason: 'timeline-authority-ended',
    })).to.equal(true)
  })

  it('preserves one-item retry behavior when restoring the current renderer item', () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const send = sandbox.spy()
    const engine = getPlaybackEngine()
    engine.initialize({ webContents: { send } })
    engine.currentPlaylistItemCount = 1
    engine.currentScheduleId = 'schedule-1'
    engine.currentItem = {
      id: 'only-video',
      type: 'video',
      displayMs: 5000,
      fit: 'contain',
      muted: true,
      loop: false,
      transitionDurationMs: 0,
    }

    expect(engine.restoreCurrentItemInRenderer()).to.equal(true)
    expect(send.calledWith('media-change', sinon.match({
      scheduleId: 'schedule-1',
      restored: true,
      singleItemFrame: true,
    }))).to.equal(true)
  })

  it('ignores equivalent timeline playlist updates when only presigned asset urls changed', async () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')

    const engine = getPlaybackEngine()
    sandbox.stub(engine, 'stop')
    const startPlaylistStub = sandbox.stub(engine, 'startPlaylist').resolves()

    const basePlaylist = {
      mode: 'emergency',
      scheduleId: 'schedule-1',
      snapshotId: 'snapshot-1',
      items: [
        {
          id: 'item-1',
          type: 'url',
          mediaId: 'media-1',
          remoteUrl: 'https://status.example.com/dashboard?view=ops',
          displayMs: 10000,
          fit: 'contain',
          muted: true,
          loop: false,
          transitionDurationMs: 0,
          meta: {
            source_url: 'https://status.example.com/dashboard?view=ops',
            fallback_url: 'https://cdn.example.com/webpage-fallback.png?X-Amz-Signature=one',
          },
        },
      ],
    }

    engine.state = 'emergency'
    engine.currentTimelineFingerprint = engine.fingerprintPlaylist(basePlaylist)

    getSnapshotManager().emit('playlist-updated', {
      ...basePlaylist,
      snapshotId: 'snapshot-2',
      items: [
        {
          ...basePlaylist.items[0],
          meta: {
            ...basePlaylist.items[0].meta,
            fallback_url: 'https://cdn.example.com/webpage-fallback.png?X-Amz-Signature=two',
          },
        },
      ],
    })

    await Promise.resolve()

    expect(engine.stop.called).to.equal(false)
    expect(startPlaylistStub.called).to.equal(false)
  })

  it('changes the playlist fingerprint when only the selected PDF page changes', () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const engine = getPlaybackEngine()
    const base = {
      mode: 'normal',
      scheduleId: 'schedule-1',
      items: [{
        id: 'pdf-item', type: 'pdf', mediaId: 'media-pdf', remoteUrl: 'https://cdn.example/doc.pdf',
        displayMs: 10000, fit: 'contain', muted: true, loop: false, transitionDurationMs: 0,
        pageNumber: 1,
      }],
    }

    const pageOne = engine.fingerprintPlaylist(base)
    const pageTwo = engine.fingerprintPlaylist({
      ...base,
      items: [{ ...base.items[0], pageNumber: 2 }],
    })
    const legacyPageOne = engine.fingerprintPlaylist({
      ...base,
      items: [{ ...base.items[0], pageNumber: undefined }],
    })

    expect(pageOne).not.to.equal(pageTwo)
    expect(pageOne).to.equal(legacyPageOne)
  })

  it('records direct timeline proof-of-play only after the renderer confirms display', async () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getProofOfPlayService } = require('../../../src/main/services/pop-service')
    const engine = getPlaybackEngine()
    const recordStart = sandbox.stub(getProofOfPlayService(), 'recordStart')
    engine.currentScheduleId = 'schedule-1'
    engine.currentPublishId = 'publish-1'
    const send = sandbox.spy()
    engine.mainWindow = { webContents: { send } }

    const now = Date.now()
    await engine.handlePlayItem({
      item: {
        id: 'pdf-item',
        type: 'pdf',
        mediaId: 'media-pdf',
        remoteUrl: 'https://cdn.example/doc.pdf',
        displayMs: 10000,
        fit: 'contain',
        muted: true,
        loop: false,
        transitionDurationMs: 0,
        pageNumber: 3,
      },
      startTime: now,
      endTime: now + 10000,
      index: 0,
    })

    expect(recordStart.called).to.equal(false)
    const renderToken = send.firstCall.args[1].renderToken
    expect(engine.confirmRenderedPlayback({
      itemId: 'pdf-item',
      mediaId: 'media-pdf',
      renderToken,
      pageNumber: 3,
    })).to.equal(true)
    expect(recordStart.calledWithMatch({
      scheduleId: 'schedule-1',
      publishId: 'publish-1',
      mediaId: 'media-pdf',
      pageNumber: 3,
    })).to.equal(true)
    expect(engine.confirmRenderedPlayback({
      itemId: 'pdf-item',
      mediaId: 'media-pdf',
      renderToken,
      pageNumber: 3,
    })).to.equal(false)
  })

  it('records layout proof-of-play with the authoritative applied publish identity', () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getProofOfPlayService } = require('../../../src/main/services/pop-service')
    const engine = getPlaybackEngine()
    engine.currentPublishId = 'publish-layout-1'
    engine.currentScheduleId = 'schedule-1'
    engine.currentItem = {
      id: 'scene-1',
      type: 'scene',
      displayMs: 10000,
      fit: 'contain',
      muted: true,
      loop: false,
      transitionDurationMs: 0,
    }
    const recordStart = sandbox.stub(getProofOfPlayService(), 'recordStart')

    expect(engine.recordRenderedLayoutPlayback({
      scene_id: 'scene-1',
      slot_id: 'slot-1',
      item_id: 'item-1',
      media_id: 'media-1',
      schedule_id: 'schedule-1',
      playback_instance_id: 'layout-instance-1',
      started_at: '2000-01-01T00:00:00.000Z',
    })).to.equal(true)

    expect(recordStart.calledWithMatch({
      scheduleId: 'schedule-1',
      publishId: 'publish-layout-1',
      mediaId: 'media-1',
      playbackInstanceId: 'layout-instance-1',
    })).to.equal(true)
    expect(recordStart.firstCall.args[0].startedAt).not.to.equal('2000-01-01T00:00:00.000Z')
  })

  it('rejects a delayed renderer confirmation after the scheduled occurrence completed', async () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getProofOfPlayService } = require('../../../src/main/services/pop-service')
    const engine = getPlaybackEngine()
    const recordStart = sandbox.stub(getProofOfPlayService(), 'recordStart')
    engine.currentScheduleId = 'schedule-1'
    const send = sandbox.spy()
    engine.mainWindow = { webContents: { send } }
    const item = {
      id: 'late-image', type: 'image', mediaId: 'media-late', remoteUrl: 'https://cdn.example/late.png',
      displayMs: 1000, fit: 'contain', muted: true, loop: false, transitionDurationMs: 0,
    }
    const scheduledItem = { item, startTime: Date.now(), endTime: Date.now() + 1000, index: 0 }

    await engine.handlePlayItem(scheduledItem)
    const renderToken = send.firstCall.args[1].renderToken
    engine.handleItemComplete(scheduledItem)

    expect(engine.confirmRenderedPlayback({
      itemId: item.id,
      mediaId: item.mediaId,
      renderToken,
    })).to.equal(false)
    expect(recordStart.called).to.equal(false)
  })

  it('ignores equivalent scene playlist updates when only remaining scene time changed', async () => {
    const { getPlaybackEngine } = require('../../../src/main/services/playback/playback-engine')
    const { getSnapshotManager } = require('../../../src/main/services/snapshot-manager')

    const engine = getPlaybackEngine()
    sandbox.stub(engine, 'stop')
    const startPlaylistStub = sandbox.stub(engine, 'startPlaylist').resolves()

    const sceneMeta = {
      source: 'schedule',
      scheduleId: 'schedule-1',
      scene: {
        startsAt: '2026-06-19T11:38:00.000Z',
        endsAt: '2026-06-19T12:30:00.000Z',
        serverTimeOffsetMs: 100,
        slots: [
          {
            id: 'slot-1',
            bounds: { x: 0, y: 0, w: 1, h: 1 },
            items: [
              {
                id: 'slot-item-1',
                type: 'video',
                mediaId: 'media-1',
                remoteUrl: 'https://cdn.example.com/video.mp4?signature=one',
                displayMs: 464000,
                fit: 'cover',
                muted: false,
                loop: false,
                transitionDurationMs: 0,
              },
            ],
          },
        ],
      },
    }

    const basePlaylist = {
      mode: 'normal',
      scheduleId: 'schedule-1',
      snapshotId: 'snapshot-1',
      items: [
        {
          id: 'scene:window-1',
          type: 'scene',
          displayMs: 2_400_000,
          fit: 'contain',
          muted: true,
          loop: false,
          transitionDurationMs: 0,
          meta: sceneMeta,
        },
      ],
    }

    engine.state = 'playing'
    engine.currentTimelineFingerprint = engine.fingerprintPlaylist(basePlaylist)

    getSnapshotManager().emit('playlist-updated', {
      ...basePlaylist,
      snapshotId: 'snapshot-2',
      items: [
        {
          ...basePlaylist.items[0],
          displayMs: 2_100_000,
          meta: {
            ...sceneMeta,
            scene: {
              ...sceneMeta.scene,
              serverTimeOffsetMs: 500,
            },
          },
        },
      ],
    })

    await Promise.resolve()

    expect(engine.stop.called).to.equal(false)
    expect(startPlaylistStub.called).to.equal(false)
  })
})
