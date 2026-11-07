const { expect } = require('chai')
const sinon = require('sinon')
const { captureWindowsBrowserWindowWith } = require('../../../src/main/services/windows-window-capture')

describe('Windows composed window capture', () => {
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
  })

  afterEach(() => {
    sandbox.restore()
  })

  it('captures the matching display compositor and crops it to the window', async () => {
    const cropped = { isEmpty: () => false }
    const thumbnail = {
      isEmpty: () => false,
      getSize: () => ({ width: 1920, height: 1080 }),
      crop: sandbox.stub().returns(cropped),
    }
    const dependencies = {
      getDisplayMatching: sandbox.stub().returns({
        id: 42,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      }),
      getSources: sandbox.stub().resolves([{ display_id: '42', thumbnail }]),
      settle: sandbox.stub().resolves(),
    }
    const window = {
      isDestroyed: sandbox.stub().returns(false),
      webContents: { isDestroyed: sandbox.stub().returns(false) },
      isAlwaysOnTop: sandbox.stub().returns(false),
      setAlwaysOnTop: sandbox.spy(),
      moveTop: sandbox.spy(),
      focus: sandbox.spy(),
      getBounds: sandbox.stub().returns({ x: 100, y: 50, width: 320, height: 240 }),
    }

    expect(await captureWindowsBrowserWindowWith(window, dependencies)).to.equal(cropped)
    expect(window.setAlwaysOnTop.firstCall.calledWith(true, 'screen-saver')).to.equal(true)
    expect(window.setAlwaysOnTop.secondCall.calledWith(false)).to.equal(true)
    expect(window.moveTop.calledOnce).to.equal(true)
    expect(thumbnail.crop.calledOnceWith({ x: 100, y: 50, width: 320, height: 240 })).to.equal(true)
  })

  it('does not capture after the window is destroyed', async () => {
    const moveTop = sandbox.spy()
    const window = {
      isDestroyed: sandbox.stub().returns(true),
      webContents: { isDestroyed: sandbox.stub().returns(false) },
      isAlwaysOnTop: sandbox.stub(),
      setAlwaysOnTop: sandbox.spy(),
      moveTop,
      focus: sandbox.spy(),
    }

    expect(await captureWindowsBrowserWindowWith(window, {
      getDisplayMatching: sandbox.stub(),
      getSources: sandbox.stub(),
      settle: sandbox.stub(),
    })).to.equal(undefined)
    expect(moveTop.called).to.equal(false)
  })

  it('preserves a window that was already always on top', async () => {
    const thumbnail = {
      isEmpty: () => false,
      getSize: () => ({ width: 1920, height: 1080 }),
      crop: sandbox.stub().returns({ isEmpty: () => false }),
    }
    const window = {
      isDestroyed: sandbox.stub().returns(false),
      webContents: { isDestroyed: sandbox.stub().returns(false) },
      isAlwaysOnTop: sandbox.stub().returns(true),
      setAlwaysOnTop: sandbox.spy(),
      moveTop: sandbox.spy(),
      focus: sandbox.spy(),
      getBounds: sandbox.stub().returns({ x: 100, y: 50, width: 320, height: 240 }),
    }

    await captureWindowsBrowserWindowWith(window, {
      getDisplayMatching: sandbox.stub().returns({
        id: 42,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        size: { width: 1920, height: 1080 },
        scaleFactor: 1,
      }),
      getSources: sandbox.stub().resolves([{ display_id: '42', thumbnail }]),
      settle: sandbox.stub().resolves(),
    })

    expect(window.setAlwaysOnTop.called).to.equal(false)
  })
})
