const { expect } = require('chai')
const sinon = require('sinon')

describe('PowerManager', () => {
  let clock

  afterEach(() => {
    if (clock) {
      clock.restore()
      clock = undefined
    }
    sinon.restore()
  })

  function buildPowerConfig(overrides = {}) {
    return {
      dpmsEnabled: true,
      preventBlanking: true,
      scheduleEnabled: false,
      ...overrides,
    }
  }

  it('starts and stops Electron display sleep prevention from the player app', async () => {
    const blocker = {
      start: sinon.stub().returns(42),
      stop: sinon.stub(),
      isStarted: sinon.stub().returns(true),
    }
    const { PowerManager } = require('../../../src/main/services/power-manager')
    const manager = new PowerManager({
      platform: 'darwin',
      powerSaveBlocker: blocker,
      enforcementIntervalMs: 1000,
    })

    await manager.initialize(buildPowerConfig())

    expect(blocker.start.calledOnceWithExactly('prevent-display-sleep')).to.equal(true)

    manager.cleanup()

    expect(blocker.stop.calledOnceWithExactly(42)).to.equal(true)
  })

  it('restarts Electron display sleep prevention if it stops while the app is open', async () => {
    clock = sinon.useFakeTimers()
    let active = true
    let nextBlockerId = 7
    const blocker = {
      start: sinon.stub().callsFake(() => {
        active = true
        return nextBlockerId++
      }),
      stop: sinon.stub().callsFake(() => {
        active = false
      }),
      isStarted: sinon.stub().callsFake(() => active),
    }
    const { PowerManager } = require('../../../src/main/services/power-manager')
    const manager = new PowerManager({
      platform: 'darwin',
      powerSaveBlocker: blocker,
      enforcementIntervalMs: 1000,
    })

    await manager.initialize(buildPowerConfig())
    active = false
    await clock.tickAsync(1000)

    expect(blocker.start.callCount).to.equal(2)
    expect(blocker.start.secondCall.calledWithExactly('prevent-display-sleep')).to.equal(true)

    manager.cleanup()

    expect(blocker.stop.calledOnceWithExactly(8)).to.equal(true)
  })

  it('stops app-owned sleep prevention when disabled by config', async () => {
    clock = sinon.useFakeTimers()
    const blocker = {
      start: sinon.stub().returns(42),
      stop: sinon.stub(),
      isStarted: sinon.stub().returns(true),
    }
    const { PowerManager } = require('../../../src/main/services/power-manager')
    const manager = new PowerManager({
      platform: 'darwin',
      powerSaveBlocker: blocker,
      enforcementIntervalMs: 1000,
    })

    await manager.initialize(buildPowerConfig())
    await manager.initialize(buildPowerConfig({ preventBlanking: false }))
    await clock.tickAsync(1000)

    expect(blocker.stop.calledOnceWithExactly(42)).to.equal(true)
    expect(blocker.start.calledOnce).to.equal(true)

    manager.cleanup()
  })
})
