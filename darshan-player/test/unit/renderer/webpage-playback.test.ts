const { expect } = require('chai')

describe('Webpage playback helpers', () => {
  const loadWebpagePlaybackModule = () => require('../../../dist/renderer/renderer/webpage-playback.js')

  class FakeElement {
    tagName
    style = {}
    children = []
    attributes = {}
    listeners = {}
    src = ''
    loadURL
    stop = () => {}

    constructor(tagName) {
      this.tagName = String(tagName).toUpperCase()
    }

    appendChild(child) {
      this.children.push(child)
      child.parentElement = this
      return child
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value)
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener
    }

    removeEventListener(type) {
      delete this.listeners[type]
    }

    dispatch(type, event = {}) {
      const listener = this.listeners[type]
      if (typeof listener === 'function') {
        listener(event)
      }
    }
  }

  let originalDocument
  let originalWindow

  beforeEach(() => {
    originalDocument = global.document
    originalWindow = global.window
    global.document = {
      createElement: (tagName) => new FakeElement(tagName),
    }
    global.window = {
      setTimeout: () => 0,
      clearTimeout: () => {},
    }
  })

  afterEach(() => {
    global.document = originalDocument
    global.window = originalWindow
  })

  it('does not reveal the live page for an empty SPA shell', async () => {
    const { shouldRevealLiveWebpage } = loadWebpagePlaybackModule()

    const ready = shouldRevealLiveWebpage({
      width: 1280,
      height: 720,
      textLength: 0,
      mediaCount: 0,
      visibleElementCount: 1,
    })

    expect(ready).to.equal(false)
  })

  it('reveals the live page once visible rendered content exists', async () => {
    const { shouldRevealLiveWebpage } = loadWebpagePlaybackModule()

    const ready = shouldRevealLiveWebpage({
      width: 1280,
      height: 720,
      textLength: 56,
      mediaCount: 0,
      visibleElementCount: 3,
    })

    expect(ready).to.equal(true)
  })

  it('redacts credentialed live URLs in renderer webpage logs without changing runtime URL', async () => {
    const { createWebpagePlaybackElement } = loadWebpagePlaybackModule()
    const liveUrl = 'https://user:password@backend.internal:3000/page?token=abc#secret'
    const logs = []

    const container = createWebpagePlaybackElement({
      liveUrl,
      onLog: (level, message, data) => logs.push({ level, message, data }),
    })
    const webview = container.children[1]

    webview.dispatch('dom-ready')

    const serialized = JSON.stringify(logs)
    expect(webview.src).to.equal(liveUrl)
    expect(serialized).to.contain('https://backend.internal:3000/page')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('secret')
    container.__darshanCleanup()
  })

  it('redacts expected and actual URLs in renderer navigation drift logs', async () => {
    const { createWebpagePlaybackElement } = loadWebpagePlaybackModule()
    const liveUrl = 'https://user:password@backend.internal:3000/page?token=abc#secret'
    const driftUrl = 'https://attacker:secret@elsewhere.internal:3000/path?password=def#fragment'
    const logs = []
    let reloadedUrl = ''

    const container = createWebpagePlaybackElement({
      liveUrl,
      onLog: (level, message, data) => logs.push({ level, message, data }),
    })
    const webview = container.children[1]
    webview.loadURL = (url) => {
      reloadedUrl = url
    }

    webview.dispatch('did-navigate', { url: driftUrl })

    const serialized = JSON.stringify(logs)
    expect(reloadedUrl).to.equal(liveUrl)
    expect(serialized).to.contain('https://backend.internal:3000/page')
    expect(serialized).to.contain('https://elsewhere.internal:3000/path')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('attacker')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('def')
    expect(serialized).not.to.contain('fragment')
    container.__darshanCleanup()
  })
})
