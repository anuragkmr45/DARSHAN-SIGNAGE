const { expect } = require('chai')
const sinon = require('sinon')
const { ContentOwner } = require('../../../src/main/services/playback/content-owner')

describe('Exclusive renderer content ownership', () => {
  let owner, window
  beforeEach(() => {
    owner = new ContentOwner()
    window = { isDestroyed: () => false, webContents: { id: 7, isDestroyed: () => false, send: sinon.spy(), setAudioMuted: sinon.spy() } }
    owner.attach(window)
  })
  it('accepts reports only from the actual renderer and exact active epoch', () => {
    const epoch = owner.advance('ordinary')
    expect(owner.accepts(7, epoch)).to.equal(true)
    expect(owner.accepts(8, epoch)).to.equal(false)
    owner.advance('live-fallback')
    expect(owner.accepts(7, epoch)).to.equal(false)
  })
  it('keeps the epoch stable when the readiness gate reattaches the same renderer', () => {
    const epoch = owner.advance('ordinary')
    expect(owner.attach(window)).to.equal(false)
    expect(owner.getEpoch()).to.equal(epoch)
    expect(owner.accepts(7, epoch)).to.equal(true)
  })
  it('mutes and fences all old reports before requesting disposal, requiring exact sender and request ACK', async () => {
    const old = owner.advance('live-fallback')
    const waiting = owner.disposeRenderer(window)
    expect(owner.accepts(7, old)).to.equal(false)
    expect(window.webContents.setAudioMuted.calledOnceWithExactly(true)).to.equal(true)
    expect(window.webContents.setAudioMuted.calledBefore(window.webContents.send)).to.equal(true)
    const request = window.webContents.send.firstCall.args[1]
    expect(owner.acknowledge(8, request)).to.equal(false)
    expect(owner.acknowledge(7, { ...request, requestId: 'stale' })).to.equal(false)
    expect(owner.acknowledge(7, request)).to.equal(true)
    expect(await waiting).to.equal(true)
    expect(owner.accepts(7, request.contentEpoch)).to.equal(false)
  })
  it('cannot reuse a late ACK after another owner or window replaces the renderer', async () => {
    const pending = owner.disposeRenderer(window)
    const old = window.webContents.send.firstCall.args[1]
    owner.advance('ordinary')
    expect(await pending).to.equal(false)
    expect(owner.acknowledge(7, old)).to.equal(false)
    owner.attach({ ...window, webContents: { ...window.webContents, id: 9 } })
    expect(owner.accepts(7, owner.getEpoch())).to.equal(false)
  })
  it('fails closed when the renderer hangs instead of authorizing a new audio owner', async () => {
    expect(await owner.disposeRenderer(window, 10)).to.equal(false)
    expect(owner.getOwner()).to.equal('blocked')
  })
})
