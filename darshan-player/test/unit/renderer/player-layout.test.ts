const { expect } = require('chai')
const sinon = require('sinon')

describe('Player layout helpers', () => {
  it('computes a centered letterboxed frame for 16:9 content on a tall viewport', async () => {
    const { computeSceneStageFrame } = require('../../../src/renderer/player-layout-helpers.ts')

    const frame = computeSceneStageFrame('16:9', 1080, 1920)

    expect(Math.round(frame.width)).to.equal(1080)
    expect(Math.round(frame.height)).to.equal(608)
    expect(Math.round(frame.left)).to.equal(0)
    expect(Math.round(frame.top)).to.equal(656)
  })

  it('computes a centered pillarboxed frame for 9:16 content on a wide viewport', async () => {
    const { computeSceneStageFrame } = require('../../../src/renderer/player-layout-helpers.ts')

    const frame = computeSceneStageFrame('9:16', 1920, 1080)

    expect(Math.round(frame.width)).to.equal(608)
    expect(Math.round(frame.height)).to.equal(1080)
    expect(Math.round(frame.left)).to.equal(656)
    expect(Math.round(frame.top)).to.equal(0)
  })

  it('switches to default content when player status mode is default', async () => {
    const { resolvePlayerContentSource } = require('../../../src/common/player-content-source.ts')

    const source = resolvePlayerContentSource({
      state: 'PAIRED_RUNTIME',
      mode: 'default',
      online: true,
    })

    expect(source).to.equal('default')
  })

  it('keeps schedule content active when scheduled playback is selected before current item metadata arrives', async () => {
    const { resolvePlayerContentSource } = require('../../../src/common/player-content-source.ts')

    const source = resolvePlayerContentSource({
      state: 'PAIRED_RUNTIME',
      mode: 'normal',
      online: true,
    })

    expect(source).to.equal('schedule')
  })

  it('advances only multi-item scene slots and bounds single-item recovery delay', () => {
    const {
      resolveSceneSlotRecoveryDelayMs,
      resolveSceneSlotOccurrenceBoundaryDelayMs,
      shouldAdvanceSceneSlot,
    } = require('../../../src/renderer/player-layout-helpers.ts')

    expect(shouldAdvanceSceneSlot(1)).to.equal(false)
    expect(shouldAdvanceSceneSlot(2)).to.equal(true)
    expect(resolveSceneSlotRecoveryDelayMs(250)).to.equal(1000)
    expect(resolveSceneSlotRecoveryDelayMs(10_000)).to.equal(10_000)
    expect(resolveSceneSlotRecoveryDelayMs(120_000)).to.equal(30_000)
    expect(resolveSceneSlotOccurrenceBoundaryDelayMs(10_000, undefined, 2500)).to.equal(2500)
    expect(resolveSceneSlotOccurrenceBoundaryDelayMs(10_000, 750, 2500)).to.equal(750)
    expect(resolveSceneSlotOccurrenceBoundaryDelayMs(10_000, -10, 2500)).to.equal(0)
  })

  it('keeps successfully rendered static single-slot content active after its nominal duration', () => {
    const { shouldReportSceneSlotPlayback } = require('../../../src/renderer/player-layout-helpers.ts')

    expect(shouldReportSceneSlotPlayback('image', true, true)).to.equal(true)
    expect(shouldReportSceneSlotPlayback('pdf', true, true)).to.equal(true)
    expect(shouldReportSceneSlotPlayback('url', true, true)).to.equal(true)
    expect(shouldReportSceneSlotPlayback('video', true, true)).to.equal(false)
    expect(shouldReportSceneSlotPlayback('video', false, true)).to.equal(true)
    expect(shouldReportSceneSlotPlayback('image', false, false)).to.equal(false)
  })

  it('applies configured opacity transition styles to entering and exiting scheduled elements', async () => {
    const {
      resolveOpacityTransitionStyle,
      prepareElementForFadeIn,
      prepareElementForFadeOut,
    } = require('../../../src/renderer/player-layout-helpers.ts')

    const entering = {
      style: {
        transition: '',
        opacity: '',
      },
    }

    const exiting = {
      style: {
        transition: '',
        opacity: '1',
      },
    }

    expect(resolveOpacityTransitionStyle(450)).to.equal('opacity 450ms ease-in-out')
    expect(prepareElementForFadeIn(entering, 450)).to.equal(true)
    expect(entering.style.transition).to.equal('opacity 450ms ease-in-out')
    expect(entering.style.opacity).to.equal('0')

    prepareElementForFadeOut(exiting, 450)
    expect(exiting.style.transition).to.equal('opacity 450ms ease-in-out')
    expect(exiting.style.opacity).to.equal('0')
  })

  it('keeps opacity transitions disabled when the configured duration is zero', async () => {
    const {
      resolveOpacityTransitionStyle,
      prepareElementForFadeIn,
      prepareElementForFadeOut,
    } = require('../../../src/renderer/player-layout-helpers.ts')

    const entering = {
      style: {
        transition: 'stale',
        opacity: '',
      },
    }

    const exiting = {
      style: {
        transition: 'stale',
        opacity: '1',
      },
    }

    expect(resolveOpacityTransitionStyle(0)).to.equal('')
    expect(prepareElementForFadeIn(entering, 0)).to.equal(false)
    expect(entering.style.transition).to.equal('')
    expect(entering.style.opacity).to.equal('1')

    prepareElementForFadeOut(exiting, 0)
    expect(exiting.style.transition).to.equal('')
    expect(exiting.style.opacity).to.equal('0')
  })

  it('recursively tears down scheduled media trees', async () => {
    const { teardownScheduledElementTree } = require('../../../src/renderer/player-layout-helpers.ts')

    const videoParent = { removeChild: sinon.spy() }
    const iframeParent = { removeChild: sinon.spy() }
    const rootParent = { removeChild: sinon.spy() }

    const videoNode = {
      pause: sinon.spy(),
      removeAttribute: sinon.spy(),
      load: sinon.spy(),
      parentElement: videoParent,
    }

    const iframeNode = {
      removeAttribute: sinon.spy(),
      parentElement: iframeParent,
      src: 'https://example.com/embed',
    }

    const rootNode = {
      querySelectorAll: sinon.stub().returns([videoNode, iframeNode]),
      parentElement: rootParent,
    }

    teardownScheduledElementTree(rootNode)

    expect(videoNode.pause.calledOnce).to.equal(true)
    expect(videoNode.removeAttribute.calledWith('src')).to.equal(true)
    expect(videoNode.load.calledOnce).to.equal(true)
    expect(videoParent.removeChild.calledWith(videoNode)).to.equal(true)

    expect(iframeNode.removeAttribute.calledWith('src')).to.equal(true)
    expect(iframeNode.src).to.equal('')
    expect(iframeParent.removeChild.calledWith(iframeNode)).to.equal(true)

    expect(rootParent.removeChild.calledWith(rootNode)).to.equal(true)
  })
})
