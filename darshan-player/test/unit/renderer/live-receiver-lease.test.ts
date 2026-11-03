const { expect } = require('chai')
const sinon = require('sinon')
const { LiveReceiverLeaseClock } = require('../../../src/renderer/live-receiver-lease')
describe('Independent LIVE receiver lease cutoff', () => {
  let clock, lease, request, expired
  beforeEach(() => {
    clock = sinon.useFakeTimers({ now: 0, toFake: ['setTimeout', 'clearTimeout'] })
    request = sinon.stub().resolves({ view_epoch: 'current', lease_ms: 10000 })
    expired = sinon.spy()
    lease = new LiveReceiverLeaseClock({ viewEpoch: 'current', request, expired, now: () => clock.now })
  })
  afterEach(() => { lease.stop(); clock.restore() })
  it('spends initial IPC queue latency instead of granting ten more seconds after receipt', async () => {
    await clock.tickAsync(4000)
    request.returns(new Promise(() => {}))
    lease.start(0, 10000)
    await clock.tickAsync(5999)
    expect(lease.isAuthorized()).to.equal(true)
    await clock.tickAsync(1)
    expect(expired.calledOnce).to.equal(true)
    expect(lease.isAuthorized()).to.equal(false)
  })
  it('independently expires while main IPC is stalled, and never resurrects from its late response', async () => {
    let resolve
    request.returns(new Promise(done => { resolve = done }))
    lease.start(0, 10000)
    await clock.tickAsync(10000)
    expect(expired.calledOnce).to.equal(true)
    resolve({ view_epoch: 'current', lease_ms: 10000 })
    await clock.tickAsync(0)
    expect(lease.isAuthorized()).to.equal(false)
    expect(request.calledOnce).to.equal(true)
  })
  it('rejects late pulse responses which arrive after their pre-invoke budget', async () => {
    request.callsFake(async () => { await new Promise(resolve => setTimeout(resolve, 6000)); return { view_epoch: 'current', lease_ms: 5000 } })
    lease.start(0, 10000)
    await clock.tickAsync(7000)
    expect(expired.calledOnce).to.equal(true)
  })
  it('rejects foreign view epochs, secrets in pulses and oversized leases', async () => {
    for (const response of [{ view_epoch: 'old', lease_ms: 10000 }, { view_epoch: 'current', lease_ms: 10001 }, { view_epoch: 'current', lease_ms: 10000, ticket: 'forbidden' }]) {
      lease.stop(); expired.resetHistory(); request.resolves(response)
      lease = new LiveReceiverLeaseClock({ viewEpoch: 'current', request, expired, now: () => clock.now })
      lease.start(clock.now, 10000)
      await clock.tickAsync(1000)
      expect(expired.calledOnce).to.equal(true)
    }
  })
  it('permits only fresh valid authority-derived pulses and stops polling after disposal', async () => {
    lease.start(0, 10000)
    await clock.tickAsync(12000)
    expect(expired.called).to.equal(false)
    expect(lease.isAuthorized()).to.equal(true)
    lease.stop()
    const calls = request.callCount
    await clock.tickAsync(20000)
    expect(request.callCount).to.equal(calls)
    expect(lease.isAuthorized()).to.equal(false)
  })
})
