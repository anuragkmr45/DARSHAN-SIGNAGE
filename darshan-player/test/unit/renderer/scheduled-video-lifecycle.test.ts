const { expect } = require('chai')
const sinon = require('sinon')

class FakeVideo extends EventTarget {
  autoplay = false
  currentTime = 0
  duration = 2
  ended = false
  error: { message?: string } | null = null
  loop = false
  muted = false
  paused = false
  playsInline = false
  preload = ''
  seeking = false
  play = sinon.stub().resolves()
  pause = sinon.stub()
}

describe('Scheduled video lifecycle', () => {
  afterEach(() => {
    sinon.restore()
  })

  it('configures native browser looping and signage playback attributes', () => {
    const { configureScheduledVideoElement } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()

    configureScheduledVideoElement(video as unknown as HTMLVideoElement, {
      muted: true,
      autoplay: true,
      loop: true,
    })

    expect(video.muted).to.equal(true)
    expect(video.autoplay).to.equal(true)
    expect(video.loop).to.equal(true)
    expect(video.playsInline).to.equal(true)
    expect(video.preload).to.equal('auto')

    const audibleVideo = new FakeVideo()
    configureScheduledVideoElement(audibleVideo as unknown as HTMLVideoElement, {
      muted: false,
      autoplay: true,
      loop: false,
    })
    expect(audibleVideo.muted).to.equal(false)
    expect(audibleVideo.loop).to.equal(false)
  })

  it('starts once and leaves repeated playback to the native loop flag', async () => {
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.loop = true
    const runtimeError = sinon.spy()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-1',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: runtimeError,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await lifecycle.ready
    const mountedVideo = video
    for (let cycle = 0; cycle < 3; cycle += 1) {
      video.currentTime = 1.9
      video.dispatchEvent(new Event('timeupdate'))
      video.currentTime = 0.1
      video.dispatchEvent(new Event('timeupdate'))
    }

    expect(video.play.callCount).to.equal(1)
    expect(video).to.equal(mountedVideo)
    expect(runtimeError.called).to.equal(false)
    lifecycle.dispose()
  })

  it('seeks a late loop join by decoded duration and waits for seek completion', async () => {
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.duration = 10
    video.seeking = true
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-late-join',
      displayMs: 60_000,
      loop: true,
      autoplay: true,
      seekMs: 35_000,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).to.equal(5)
    expect(video.play.called).to.equal(false)

    video.seeking = false
    video.dispatchEvent(new Event('seeked'))
    await lifecycle.ready

    expect(video.play.calledOnce).to.equal(true)
    lifecycle.dispose()
  })

  it('starts safely at zero when decoded loop duration is invalid', async () => {
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.duration = Number.NaN
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-invalid-duration',
      displayMs: 60_000,
      loop: true,
      autoplay: true,
      seekMs: 35_000,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await lifecycle.ready

    expect(video.currentTime).to.equal(0)
    expect(video.play.calledOnce).to.equal(true)
    lifecycle.dispose()
  })

  it('retries rejected initial play calls and resolves after recovery', async () => {
    const clock = sinon.useFakeTimers()
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.play.onFirstCall().rejects(new Error('first'))
    video.play.onSecondCall().rejects(new Error('second'))
    video.play.onThirdCall().resolves()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-retry',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await clock.tickAsync(1250)
    await lifecycle.ready

    expect(video.play.callCount).to.equal(3)
    lifecycle.dispose()
  })

  it('rejects after the bounded initial play attempts are exhausted', async () => {
    const clock = sinon.useFakeTimers()
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.play.rejects(new Error('decoder unavailable'))
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-retry-exhausted',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
    })
    const rejected = lifecycle.ready.catch((error) => error)

    video.dispatchEvent(new Event('loadedmetadata'))
    await clock.tickAsync(1250)
    const error = await rejected

    expect(video.play.callCount).to.equal(3)
    expect(error.message).to.equal('VIDEO_PLAYBACK_START_FAILED: decoder unavailable')
    lifecycle.dispose()
  })

  it('reports a loop stall and cancels the watchdog on disposal', async () => {
    const clock = sinon.useFakeTimers()
    const {
      attachScheduledVideoLifecycle,
      SCHEDULED_VIDEO_STALL_TIMEOUT_MS,
    } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    const runtimeError = sinon.spy()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-stall',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: runtimeError,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await lifecycle.ready
    video.dispatchEvent(new Event('waiting'))
    await clock.tickAsync(SCHEDULED_VIDEO_STALL_TIMEOUT_MS - 1)
    expect(runtimeError.called).to.equal(false)
    await clock.tickAsync(1)
    expect(runtimeError.calledOnce).to.equal(true)
    expect(runtimeError.firstCall.args[0].message).to.contain('VIDEO_PLAYBACK_STALLED')

    const second = new FakeVideo()
    const cancelledError = sinon.spy()
    const cancelled = attachScheduledVideoLifecycle(second as unknown as HTMLVideoElement, {
      itemId: 'video-disposed',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: cancelledError,
    })
    second.dispatchEvent(new Event('loadedmetadata'))
    await cancelled.ready
    second.dispatchEvent(new Event('waiting'))
    cancelled.dispose()
    await clock.tickAsync(SCHEDULED_VIDEO_STALL_TIMEOUT_MS)
    expect(cancelledError.called).to.equal(false)
  })

  it('cancels the stall watchdog when playback progress resumes', async () => {
    const clock = sinon.useFakeTimers()
    const {
      attachScheduledVideoLifecycle,
      SCHEDULED_VIDEO_STALL_TIMEOUT_MS,
    } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    const runtimeError = sinon.spy()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-recovers',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: runtimeError,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await lifecycle.ready
    video.dispatchEvent(new Event('waiting'))
    await clock.tickAsync(SCHEDULED_VIDEO_STALL_TIMEOUT_MS - 1)
    video.dispatchEvent(new Event('timeupdate'))
    await clock.tickAsync(SCHEDULED_VIDEO_STALL_TIMEOUT_MS + 1)

    expect(runtimeError.called).to.equal(false)
    lifecycle.dispose()
  })

  it('keeps concurrent loop video lifecycles isolated', async () => {
    const clock = sinon.useFakeTimers()
    const {
      attachScheduledVideoLifecycle,
      SCHEDULED_VIDEO_STALL_TIMEOUT_MS,
    } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const left = new FakeVideo()
    const right = new FakeVideo()
    const leftError = sinon.spy()
    const rightError = sinon.spy()
    const leftLifecycle = attachScheduledVideoLifecycle(left as unknown as HTMLVideoElement, {
      itemId: 'video-left',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: leftError,
    })
    const rightLifecycle = attachScheduledVideoLifecycle(right as unknown as HTMLVideoElement, {
      itemId: 'video-right',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: rightError,
    })

    left.dispatchEvent(new Event('loadedmetadata'))
    right.dispatchEvent(new Event('loadedmetadata'))
    await Promise.all([leftLifecycle.ready, rightLifecycle.ready])
    left.dispatchEvent(new Event('waiting'))
    right.dispatchEvent(new Event('waiting'))
    right.dispatchEvent(new Event('timeupdate'))
    await clock.tickAsync(SCHEDULED_VIDEO_STALL_TIMEOUT_MS)

    expect(leftError.calledOnce).to.equal(true)
    expect(rightError.called).to.equal(false)
    expect(left.play.calledOnce).to.equal(true)
    expect(right.play.calledOnce).to.equal(true)
    leftLifecycle.dispose()
    rightLifecycle.dispose()
  })

  it('reports an unexpected ended event only for a loop-enabled video', async () => {
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const loopedVideo = new FakeVideo()
    const loopError = sinon.spy()
    const looped = attachScheduledVideoLifecycle(loopedVideo as unknown as HTMLVideoElement, {
      itemId: 'video-loop-ended',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: loopError,
    })
    loopedVideo.dispatchEvent(new Event('loadedmetadata'))
    await looped.ready
    loopedVideo.dispatchEvent(new Event('ended'))
    expect(loopError.calledOnce).to.equal(true)
    expect(loopError.firstCall.args[0].message).to.equal('VIDEO_LOOP_ENDED_UNEXPECTEDLY')
    looped.dispose()

    const singlePlayVideo = new FakeVideo()
    const singlePlayError = sinon.spy()
    const singlePlay = attachScheduledVideoLifecycle(singlePlayVideo as unknown as HTMLVideoElement, {
      itemId: 'video-single-ended',
      displayMs: 30_000,
      loop: false,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: singlePlayError,
    })
    singlePlayVideo.dispatchEvent(new Event('loadedmetadata'))
    await singlePlay.ready
    singlePlayVideo.dispatchEvent(new Event('ended'))
    expect(singlePlayError.called).to.equal(false)
    singlePlay.dispose()
  })

  it('reports a late media error only once', async () => {
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.error = { message: 'decode failed' }
    const runtimeError = sinon.spy()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-late-error',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: runtimeError,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await lifecycle.ready
    video.dispatchEvent(new Event('error'))
    video.dispatchEvent(new Event('error'))

    expect(runtimeError.calledOnce).to.equal(true)
    expect(runtimeError.firstCall.args[0].message).to.contain('decode failed')
    lifecycle.dispose()
  })

  it('rejects readiness and cancels pending play retries when disposed', async () => {
    const clock = sinon.useFakeTimers()
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.play.rejects(new Error('autoplay blocked'))
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-disposed-during-retry',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
    })
    const rejected = lifecycle.ready.catch((error) => error)

    video.dispatchEvent(new Event('loadedmetadata'))
    await clock.tickAsync(0)
    expect(video.play.callCount).to.equal(1)
    lifecycle.dispose()
    const error = await rejected
    await clock.tickAsync(5000)

    expect(error.message).to.equal('VIDEO_PLAYBACK_DISPOSED')
    expect(video.play.callCount).to.equal(1)
  })

  it('cancels a pending seek and never starts after disposal', async () => {
    const clock = sinon.useFakeTimers()
    const { attachScheduledVideoLifecycle } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    video.seeking = true
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-disposed-during-seek',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 5000,
    })
    const rejected = lifecycle.ready.catch((error) => error)

    video.dispatchEvent(new Event('loadedmetadata'))
    lifecycle.dispose()
    const error = await rejected
    video.dispatchEvent(new Event('seeked'))
    await clock.tickAsync(2500)

    expect(error.message).to.equal('VIDEO_PLAYBACK_DISPOSED')
    expect(video.play.called).to.equal(false)
  })

  it('ignores media callbacks after the active authority is disposed', async () => {
    const clock = sinon.useFakeTimers()
    const {
      attachScheduledVideoLifecycle,
      SCHEDULED_VIDEO_STALL_TIMEOUT_MS,
    } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    const runtimeError = sinon.spy()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-authority-ended',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
      onRuntimeError: runtimeError,
    })

    video.dispatchEvent(new Event('loadedmetadata'))
    await lifecycle.ready
    lifecycle.dispose()
    video.dispatchEvent(new Event('waiting'))
    video.dispatchEvent(new Event('ended'))
    await clock.tickAsync(SCHEDULED_VIDEO_STALL_TIMEOUT_MS)

    expect(video.play.calledOnce).to.equal(true)
    expect(runtimeError.called).to.equal(false)
  })

  it('fails a media element that never becomes ready', async () => {
    const clock = sinon.useFakeTimers()
    const {
      attachScheduledVideoLifecycle,
      SCHEDULED_VIDEO_LOAD_TIMEOUT_MS,
    } = require('../../../src/renderer/scheduled-video-lifecycle.ts')
    const video = new FakeVideo()
    const lifecycle = attachScheduledVideoLifecycle(video as unknown as HTMLVideoElement, {
      itemId: 'video-timeout',
      displayMs: 30_000,
      loop: true,
      autoplay: true,
      seekMs: 0,
    })
    const rejected = lifecycle.ready.catch((error) => error)

    await clock.tickAsync(SCHEDULED_VIDEO_LOAD_TIMEOUT_MS)
    const error = await rejected

    expect(error.message).to.equal('VIDEO_MEDIA_LOAD_TIMEOUT')
    expect(video.play.called).to.equal(false)
    lifecycle.dispose()
  })
})
