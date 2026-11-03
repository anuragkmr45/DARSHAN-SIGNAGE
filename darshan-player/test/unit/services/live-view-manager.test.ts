const { expect } = require('chai')
const sinon = require('sinon')
const { EventEmitter } = require('events')
const path = require('path')
const { pathToFileURL } = require('url')
const { LiveViewManager, isAllowedLiveViewRequest } = require('../../../src/main/services/live-view-manager')

describe('Managed normal-player LIVE view isolation', () => {
  let manager, view, window, isolated, requestFilter, headersFilter, certificateFilter, authorized, remaining, observe, grant
  beforeEach(() => {
    const wc = new EventEmitter()
    Object.assign(wc, { id: 42, isDestroyed: () => false, setAudioMuted: sinon.spy(), setWindowOpenHandler: sinon.spy(),
      loadFile: sinon.stub().resolves(), close: sinon.spy(), send: sinon.spy(), capturePage: sinon.stub().resolves({ pixels: 'current' }) })
    view = { webContents: wc, setVisible: sinon.spy(), setBounds: sinon.spy() }
    window = { isDestroyed: () => false, getContentSize: () => [1920, 1080], contentView: { addChildView: sinon.spy(), removeChildView: sinon.spy() } }
    isolated = { setPermissionRequestHandler: sinon.spy(), setPermissionCheckHandler: sinon.spy(), on: sinon.spy(),
      setCertificateVerifyProc: fn => { certificateFilter = fn }, webRequest: { onBeforeRequest: fn => { requestFilter = fn }, onHeadersReceived: fn => { headersFilter = fn } } }
    manager = new LiveViewManager(() => window, { createView: () => view, getSession: () => isolated })
    authorized = true; remaining = 9000; observe = sinon.spy()
    grant = { run_id: 'current-run', generation: 1, admission_id: 'current-admission', participant_id: 'receiver', presenter_participant_id: 'approved-presenter',
      microphone: false, screen_share_audio: true, signaling: { url: 'wss://media.example.test:9443', ticket: 'private-one-use-ticket' } }
    manager.connect(grant, () => authorized, observe, () => remaining)
  })
  afterEach(() => manager.destroy())
  it('starts hidden/muted in the same parent window with no navigation or popup permissions', () => {
    expect(window.contentView.addChildView.calledOnceWithExactly(view)).to.equal(true)
    expect(view.setVisible.firstCall.args).to.deep.equal([false])
    expect(view.webContents.setAudioMuted.firstCall.args).to.deep.equal([true])
    expect(view.setBounds.firstCall.args[0]).to.deep.equal({ x: 0, y: 0, width: 1920, height: 1080 })
    const deny = view.webContents.setWindowOpenHandler.firstCall.args[0]
    expect(deny()).to.deep.equal({ action: 'deny' })
    for (const name of ['will-navigate', 'will-redirect', 'before-input-event']) { const event = { preventDefault: sinon.spy() }; view.webContents.emit(name, event); expect(event.preventDefault.calledOnce).to.equal(true) }
    const callback = sinon.spy()
    isolated.setPermissionRequestHandler.firstCall.args[0](null, 'media', callback)
    expect(callback.calledOnceWithExactly(false)).to.equal(true)
    expect(isolated.setPermissionCheckHandler.firstCall.args[0]()).to.equal(false)
  })
  it('gives its restricted one-use grant only to the exact receiver and exposes lease pulses without credentials', () => {
    expect(manager.getGrant(43)).to.equal(null)
    const first = manager.getGrant(42)
    expect(first.signaling.ticket).to.equal('private-one-use-ticket')
    expect(first.lease_remaining_ms).to.equal(9000)
    first.signaling.ticket = 'caller-modified'
    expect(manager.getGrant(42)).to.equal(null)
    expect(Object.keys(manager.getLease(42)).sort()).to.deep.equal(['lease_ms', 'view_epoch'])
    expect(JSON.stringify(manager.getLease(42))).not.to.include('private-one-use-ticket')
    remaining = 10001
    expect(manager.getLease(42)).to.equal(null)
    remaining = 9000; authorized = false
    expect(manager.getLease(42)).to.equal(null)
  })
  it('pins network requests and CSP to packaged receiver assets plus the single gateway origin', () => {
    const root = path.resolve(__dirname, '../../../src/renderer')
    expect(isAllowedLiveViewRequest(pathToFileURL(path.join(root, 'live-receiver.html')).toString(), grant.signaling.url, root)).to.equal(true)
    for (const url of ['https://foreign.example.test', 'wss://media.example.test:9444/rtc', 'file:///etc/passwd', 'wss://user:pass@media.example.test:9443/rtc']) {
      expect(isAllowedLiveViewRequest(url, grant.signaling.url, root)).to.equal(false)
    }
    const allowed = sinon.spy(), blocked = sinon.spy(), csp = sinon.spy()
    requestFilter({ url: 'wss://media.example.test:9443/rtc' }, allowed)
    requestFilter({ url: 'https://foreign.example.test/file' }, blocked)
    expect(allowed.calledOnceWithExactly({ cancel: false })).to.equal(true)
    expect(blocked.calledOnceWithExactly({ cancel: true })).to.equal(true)
    headersFilter({ responseHeaders: {} }, csp)
    const header = csp.firstCall.args[0].responseHeaders['Content-Security-Policy'][0]
    expect(header).to.include('connect-src wss://media.example.test:9443 https://media.example.test:9443')
    expect(header).not.to.include('private-one-use-ticket')
  })
  it('rejects stale sender/view epoch and unknown observations before coordinator mutation', () => {
    const epoch = manager.getLease(42).view_epoch
    expect(manager.report(43, { view_epoch: epoch, kind: 'first-frame' })).to.equal(false)
    expect(manager.report(42, { view_epoch: 'old', kind: 'first-frame' })).to.equal(false)
    expect(manager.report(42, { view_epoch: epoch, kind: 'first-frame', ticket: 'extra' })).to.equal(false)
    expect(observe.called).to.equal(false)
    expect(manager.report(42, { view_epoch: epoch, kind: 'first-frame' })).to.equal(true)
    authorized = false
    expect(manager.report(42, { view_epoch: epoch, kind: 'audio-ready' })).to.equal(false)
    expect(observe.calledOnce).to.equal(true)
  })
  it('activates only while authority remains valid and clears tracks/context before fallback can take over', () => {
    expect(manager.activate()).to.equal(true)
    expect(view.setVisible.lastCall.args).to.deep.equal([true])
    expect(view.webContents.send.calledOnceWithExactly('live-receiver:activate')).to.equal(true)
    manager.destroy()
    expect(view.webContents.setAudioMuted.lastCall.args).to.deep.equal([true])
    expect(view.setVisible.lastCall.args).to.deep.equal([false])
    expect(view.webContents.setAudioMuted.lastCall.calledBefore(view.webContents.close.firstCall)).to.equal(true)
    expect(window.contentView.removeChildView.calledOnceWithExactly(view)).to.equal(true)
    expect(view.webContents.close.calledOnceWithExactly({ waitForBeforeUnload: false })).to.equal(true)
    expect(manager.getLease(42)).to.equal(null)
    const deny = sinon.spy(); requestFilter({ url: 'wss://media.example.test:9443/rtc' }, deny)
    expect(deny.calledOnceWithExactly({ cancel: true })).to.equal(true)
    const trust = sinon.spy(); certificateFilter({}, trust); expect(trust.calledOnceWithExactly(-2)).to.equal(true)
    expect(headersFilter).to.equal(null)
  })
  it('does not unmute or expose pixels after revocation, including a capture already in flight', async () => {
    manager.activate()
    let resolve
    view.webContents.capturePage.returns(new Promise(done => { resolve = done }))
    const captured = manager.captureVisible()
    authorized = false
    resolve({ pixels: 'now-stale' })
    expect(await captured).to.equal(undefined)
    expect(manager.activate()).to.equal(false)
  })
  it('captures only the actual visible authorized child and fences disposal during capture', async () => {
    expect(await manager.captureVisible()).to.equal(undefined)
    manager.activate()
    expect(await manager.captureVisible()).to.deep.equal({ pixels: 'current' })
    let resolve
    view.webContents.capturePage.returns(new Promise(done => { resolve = done }))
    const pending = manager.captureVisible()
    manager.destroy(); resolve({ pixels: 'destroyed-view' })
    expect(await pending).to.equal(undefined)
  })
})
