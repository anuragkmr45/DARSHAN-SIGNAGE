const { expect } = require('chai')

describe('Webpage playback helpers', () => {
  const loadModule = () => require('../../../dist/renderer/renderer/webpage-playback.js')

  class FakeElement {
    tagName
    style = {}
    children = []
    src = ''
    parentElement
    textContent = ''
    constructor(tagName) { this.tagName = String(tagName).toUpperCase() }
    appendChild(child) { this.children.push(child); child.parentElement = this; return child }
    getBoundingClientRect() { return { left: 20, top: 30, width: 640, height: 360 } }
  }

  let originalDocument
  let originalWindow
  let statusListener
  let mountedRequests
  let updatedRequests
  let destroyedRequests

  beforeEach(() => {
    originalDocument = global.document
    originalWindow = global.window
    mountedRequests = []
    updatedRequests = []
    destroyedRequests = []
    global.document = { createElement: (tagName) => new FakeElement(tagName) }
    global.window = {
      requestAnimationFrame: (callback) => { callback(); return 1 },
      cancelAnimationFrame: () => {},
      darshan: {
        mountWebpageView: async (request) => { mountedRequests.push(request); return { accepted: true } },
        updateWebpageView: async (request) => { updatedRequests.push(request); return { accepted: true } },
        destroyWebpageView: (id, generation) => destroyedRequests.push({ id, generation }),
        onWebpageViewStatus: (callback) => { statusListener = callback; return () => { statusListener = undefined } },
      },
    }
  })

  afterEach(() => {
    global.document = originalDocument
    global.window = originalWindow
    statusListener = undefined
  })

  it('does not reveal an empty page shell', () => {
    const { shouldRevealLiveWebpage } = loadModule()
    expect(shouldRevealLiveWebpage({ width: 1280, height: 720, textLength: 0, mediaCount: 0, visibleElementCount: 1 })).to.equal(false)
  })

  it('accepts normal webpage overflow as healthy content', () => {
    const { shouldRevealLiveWebpage } = loadModule()
    expect(shouldRevealLiveWebpage({
      width: 1280, height: 1200, textLength: 56, mediaCount: 0, visibleElementCount: 3,
      overflowX: false, overflowY: true,
    })).to.equal(true)
  })

  it('mounts a main-process webpage view, reveals it only after health, and destroys it idempotently', async () => {
    const { createWebpagePlaybackElement } = loadModule()
    const healthy = []
    const container = createWebpagePlaybackElement({ liveUrl: 'https://display.example.test/page', onHealthy: () => healthy.push(true) })
    await Promise.resolve()
    await Promise.resolve()

    expect(container.children).to.have.length(1)
    expect(mountedRequests).to.have.length(1)
    expect(mountedRequests[0]).to.include({ url: 'https://display.example.test/page' })
    expect(mountedRequests[0].bounds).to.deep.equal({ x: 20, y: 30, width: 640, height: 360 })

    statusListener({ id: mountedRequests[0].id, generation: mountedRequests[0].generation, state: 'healthy' })
    expect(container.children[0].style.display).to.equal('none')
    expect(healthy).to.deep.equal([true])

    container.__darshanCleanup()
    container.__darshanCleanup()
    expect(destroyedRequests).to.deep.equal([{ id: mountedRequests[0].id, generation: mountedRequests[0].generation }])
  })

  it('redacts a rejected credentialed URL in renderer logs', async () => {
    global.window.darshan.mountWebpageView = async () => ({ accepted: false, reason: 'url-not-allowed' })
    const { createWebpagePlaybackElement } = loadModule()
    const logs = []
    createWebpagePlaybackElement({
      liveUrl: 'https://user:password@backend.internal/page?token=abc#secret',
      onLog: (level, message, data) => logs.push({ level, message, data }),
    })
    await Promise.resolve()
    await Promise.resolve()
    const serialized = JSON.stringify(logs)
    expect(serialized).to.contain('https://backend.internal/page')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('secret')
  })
})
