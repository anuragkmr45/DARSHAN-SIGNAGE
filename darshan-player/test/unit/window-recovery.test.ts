const { expect } = require('chai')
const sinon = require('sinon')
const { recoverOrFocusWindow } = require('../../src/main/window-recovery')

describe('Window recovery', () => {
  it('creates a player window when the long-lived process has none', () => {
    const createWindow = sinon.spy()

    expect(recoverOrFocusWindow(null, createWindow)).to.equal('created')
    expect(createWindow.calledOnce).to.equal(true)
  })

  it('creates a player window when the previous window was destroyed', () => {
    const createWindow = sinon.spy()
    const window = {
      isDestroyed: () => true,
      isMinimized: sinon.spy(),
      restore: sinon.spy(),
      focus: sinon.spy(),
    }

    expect(recoverOrFocusWindow(window, createWindow)).to.equal('created')
    expect(createWindow.calledOnce).to.equal(true)
    expect(window.focus.called).to.equal(false)
  })

  it('restores and focuses the existing minimized window', () => {
    const createWindow = sinon.spy()
    const window = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: sinon.spy(),
      focus: sinon.spy(),
    }

    expect(recoverOrFocusWindow(window, createWindow)).to.equal('focused')
    expect(createWindow.called).to.equal(false)
    expect(window.restore.calledOnce).to.equal(true)
    expect(window.focus.calledOnce).to.equal(true)
  })
})
