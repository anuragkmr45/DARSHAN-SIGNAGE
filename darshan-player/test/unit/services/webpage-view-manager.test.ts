const { expect } = require('chai')
const sinon = require('sinon')
const { EventEmitter } = require('node:events')
const { WebpageViewManager } = require('../../../src/main/services/webpage-view-manager.ts')

const security = {
  csp: "default-src 'self'",
  allowedDomains: ['8.8.8.8'],
  webpageAllowedPorts: [443],
  disableEval: true,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}

class FakeContents extends EventEmitter {
  loadURL = sinon.stub().resolves()
  executeJavaScript = sinon.stub().resolves({ ready: true, reason: 'ok' })
  reload = sinon.stub().resolves()
  close = sinon.spy()
  isDestroyed = sinon.stub().returns(false)
  setAudioMuted = sinon.spy()
  setWindowOpenHandler = sinon.spy()
}

class FakeView {
  webContents = new FakeContents()
  setBounds = sinon.spy()
  setVisible = sinon.spy()
}

const request = (id: string, generation: number, zIndex: number, bounds = { x: 0, y: 0, width: 200, height: 100 }) => ({
  id,
  generation,
  zIndex,
  bounds,
  url: 'https://8.8.8.8/dashboard',
})

describe('WebpageViewManager', () => {
  let previousNodeEnv: string | undefined
  let views: FakeView[]
  let childViews: FakeView[]
  let statuses: any[]
  let permissionRequestHandler: Function | undefined
  let permissionCheckHandler: Function | undefined
  let willDownloadHandler: Function | undefined
  let beforeRequestHandler: Function | undefined
  let manager: InstanceType<typeof WebpageViewManager>

  beforeEach(() => {
    previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    views = []
    childViews = []
    statuses = []
    permissionRequestHandler = undefined
    permissionCheckHandler = undefined
    willDownloadHandler = undefined
    beforeRequestHandler = undefined

    const fakeWindow = {
      isDestroyed: () => false,
      getContentSize: () => [800, 600],
      contentView: {
        addChildView: (view: FakeView) => {
          childViews = childViews.filter((candidate) => candidate !== view)
          childViews.push(view)
        },
        removeChildView: (view: FakeView) => {
          childViews = childViews.filter((candidate) => candidate !== view)
        },
      },
      webContents: { send: (_channel: string, status: unknown) => statuses.push(status) },
    }
    const fakeSession = {
      setPermissionRequestHandler: (handler: Function) => { permissionRequestHandler = handler },
      setPermissionCheckHandler: (handler: Function) => { permissionCheckHandler = handler },
      on: (event: string, handler: Function) => { if (event === 'will-download') willDownloadHandler = handler },
      webRequest: { onBeforeRequest: (handler: Function) => { beforeRequestHandler = handler } },
    }
    manager = new WebpageViewManager(
      () => fakeWindow,
      () => security,
      () => true,
      { warn: sinon.spy() },
      {
        createView: () => {
          const view = new FakeView()
          views.push(view)
          return view
        },
        getSession: () => fakeSession,
      },
    )
  })

  afterEach(() => {
    manager.destroyAll()
    process.env.NODE_ENV = previousNodeEnv
    sinon.restore()
  })

  it('denies permissions, downloads, and disallowed subresources in its isolated session', async () => {
    manager.configureSession()
    expect(permissionCheckHandler?.()).to.equal(false)
    let allowed: boolean | undefined
    permissionRequestHandler?.(null, 'camera', (value: boolean) => { allowed = value })
    expect(allowed).to.equal(false)
    const downloadEvent = { preventDefault: sinon.spy() }
    willDownloadHandler?.(downloadEvent)
    expect(downloadEvent.preventDefault.calledOnce).to.equal(true)

    let decision: { cancel: boolean } | undefined
    beforeRequestHandler?.(
      { resourceType: 'script', url: 'https://127.0.0.1/private.js' },
      (value: { cancel: boolean }) => { decision = value },
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(decision).to.deep.equal({ cancel: true })
  })

  it('caps native views at four and deterministically promotes a higher-priority fifth view', async () => {
    for (let index = 1; index <= 4; index += 1) {
      expect(await manager.mount(request(`slot-${index}`, 1, index))).to.deep.equal({ accepted: true })
    }
    expect(await manager.mount(request('slot-low', 1, 0))).to.deep.equal({
      accepted: false,
      reason: 'live-view-cap',
    })
    expect(views).to.have.length(4)

    expect(await manager.mount(request('slot-high', 1, 9))).to.deep.equal({ accepted: true })
    expect(views).to.have.length(5)
    expect(views[0].webContents.close.calledOnce).to.equal(true)
    expect(childViews).to.have.length(4)
    expect(statuses).to.deep.include({ id: 'slot-1', generation: 1, state: 'fallback', reason: 'live-view-cap' })
  })

  it('rejects stale generations, replaces newer generations, and clamps resize bounds', async () => {
    expect(await manager.mount(request('slot', 2, 1))).to.deep.equal({ accepted: true })
    expect(await manager.mount(request('slot', 1, 1))).to.deep.equal({ accepted: false, reason: 'stale-generation' })
    expect(views).to.have.length(1)

    expect(await manager.mount(request('slot', 3, 1))).to.deep.equal({ accepted: true })
    expect(views[0].webContents.close.calledOnce).to.equal(true)
    expect(manager.update(request('slot', 3, 2, { x: -10, y: 599, width: 900, height: 900 }))).to.deep.equal({ accepted: true })
    expect(views[1].setBounds.lastCall.args[0]).to.deep.equal({ x: 0, y: 599, width: 800, height: 1 })
    expect(manager.update(request('slot', 2, 2))).to.deep.equal({ accepted: false, reason: 'stale-generation' })
  })

  it('keeps fallback hidden until two healthy probes and blocks kiosk input', async () => {
    const clock = sinon.useFakeTimers()
    await manager.mount(request('slot', 1, 1))
    const view = views[0]
    const inputEvent = { preventDefault: sinon.spy() }
    view.webContents.emit('before-input-event', inputEvent)
    expect(inputEvent.preventDefault.calledOnce).to.equal(true)

    view.webContents.emit('dom-ready')
    await clock.tickAsync(151)
    expect(statuses).to.deep.include({ id: 'slot', generation: 1, state: 'healthy' })
    expect(view.setVisible.lastCall.args[0]).to.equal(true)
    clock.restore()
  })

  it('blocks disallowed navigations and redirects before the native view can leave its origin policy', async () => {
    await manager.mount(request('slot', 1, 1))
    const contents = views[0].webContents
    const allowedNavigation = { preventDefault: sinon.spy() }
    const blockedNavigation = { preventDefault: sinon.spy() }
    const blockedRedirect = { preventDefault: sinon.spy() }

    contents.emit('will-navigate', allowedNavigation, 'https://8.8.8.8/next')
    contents.emit('will-navigate', blockedNavigation, 'https://evil.example/escape')
    contents.emit('will-redirect', blockedRedirect, 'https://user:secret@8.8.8.8/private')

    expect(allowedNavigation.preventDefault.called).to.equal(false)
    expect(blockedNavigation.preventDefault.calledOnce).to.equal(true)
    expect(blockedRedirect.preventDefault.calledOnce).to.equal(true)
  })

  it('keeps the fallback visible when a loaded page remains empty through the readiness deadline', async () => {
    const clock = sinon.useFakeTimers({ shouldClearNativeTimers: true })
    await manager.mount(request('blank-slot', 1, 1))
    const view = views[0]
    view.webContents.executeJavaScript.callsFake(async (script: string) =>
      script.includes('missing-body') ? { ready: false, reason: 'empty-dom' } : true)

    view.webContents.emit('dom-ready')
    await clock.tickAsync(12_500)

    expect(view.setVisible.lastCall.args[0]).to.equal(false)
    expect(statuses).to.deep.include({
      id: 'blank-slot',
      generation: 1,
      state: 'fallback',
      reason: 'probe-empty-dom',
    })
    clock.restore()
  })

  it('closes every child webContents and returns to baseline on transitions', async () => {
    await manager.mount(request('slot-a', 1, 1))
    await manager.mount(request('slot-b', 1, 2))
    manager.destroyAll('overlay-active')
    expect(childViews).to.have.length(0)
    expect(views.every((view) => view.webContents.close.calledOnce)).to.equal(true)
    expect(statuses).to.deep.include({ id: 'slot-a', generation: 1, state: 'fallback', reason: 'overlay-active' })
    expect(statuses).to.deep.include({ id: 'slot-b', generation: 1, state: 'fallback', reason: 'overlay-active' })
  })

  it('uses bounded exponential crash retries and disposes the exhausted view', async () => {
    const clock = sinon.useFakeTimers()
    await manager.mount(request('crashing-slot', 1, 1))
    const view = views[0]

    view.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await clock.tickAsync(1_000)
    expect(view.webContents.reload.callCount).to.equal(1)
    view.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await clock.tickAsync(2_000)
    expect(view.webContents.reload.callCount).to.equal(2)
    view.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await clock.tickAsync(4_000)
    expect(view.webContents.reload.callCount).to.equal(3)
    view.webContents.emit('render-process-gone', {}, { reason: 'crashed' })

    expect(view.webContents.close.calledOnce).to.equal(true)
    expect(childViews).to.have.length(0)
    clock.restore()
  })
})
