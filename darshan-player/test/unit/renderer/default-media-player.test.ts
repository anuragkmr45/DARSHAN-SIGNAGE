/* eslint-disable @typescript-eslint/explicit-function-return-type */
const { expect } = require('chai')
const sinon = require('sinon')

function createFakeElement(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    children: [],
    parentElement: null,
    className: '',
    textContent: '',
    src: '',
    appendChild(child) {
      child.parentElement = this
      this.children.push(child)
      return child
    },
    append(...children) {
      children.forEach((child) => this.appendChild(child))
    },
    removeChild(child) {
      const index = this.children.indexOf(child)
      if (index >= 0) {
        this.children.splice(index, 1)
        child.parentElement = null
      }
      return child
    },
    remove() {
      this.parentElement?.removeChild(this)
    },
    removeAttribute(name) {
      if (name === 'src') this.src = ''
    },
    querySelectorAll() {
      return []
    },
    pause() {},
    load() {},
    addEventListener() {},
    get firstChild() {
      return this.children[0] ?? null
    },
  }

  return node
}

describe('Default Media Player helpers', () => {
  it('synchronizes assigned default media on entry and backend recovery without polling every presentation', () => {
    const { shouldSynchronizeDefaultMedia } = require('../../../src/renderer/default-media-helpers.ts')

    expect(shouldSynchronizeDefaultMedia(undefined, 'default', undefined, true)).to.equal(true)
    expect(shouldSynchronizeDefaultMedia('none', 'default', true, true)).to.equal(true)
    expect(shouldSynchronizeDefaultMedia('default', 'default', false, true)).to.equal(true)
    expect(shouldSynchronizeDefaultMedia('default', 'default', true, true)).to.equal(false)
    expect(shouldSynchronizeDefaultMedia('default', 'schedule', false, true)).to.equal(false)
  })

  it('prefers cached local_url over remote media_url', async () => {
    const { resolveDefaultMediaSource } = require('../../../src/renderer/default-media-helpers.ts')

    const source = resolveDefaultMediaSource({
      id: 'media-1',
      name: 'Fallback',
      type: 'IMAGE',
      media_url: 'https://cdn.example.com/fallback.png',
      local_url: 'file:///tmp/fallback.png',
    })

    expect(source).to.equal('file:///tmp/fallback.png')
  })

  it('falls back to remote media_url when no cached local_url exists', async () => {
    const { resolveDefaultMediaSource } = require('../../../src/renderer/default-media-helpers.ts')

    const source = resolveDefaultMediaSource({
      id: 'media-1',
      name: 'Fallback',
      type: 'VIDEO',
      media_url: 'https://cdn.example.com/fallback.mp4',
    })

    expect(source).to.equal('https://cdn.example.com/fallback.mp4')
  })

  it('does not resolve a retired webpage preview', async () => {
    const { resolveDefaultMediaSource } = require('../../../src/renderer/default-media-helpers.ts')

    const source = resolveDefaultMediaSource({
      id: 'media-webpage',
      name: 'Status',
      type: 'WEBPAGE',
      source_url: 'https://status.example.com',
      fallback_media_url: 'https://cdn.example.com/webpage-fallback.svg',
    })

    expect(source).to.equal(undefined)
  })

  it('recursively tears down hidden default-media trees', async () => {
    const { teardownDefaultMediaElementTree } = require('../../../src/renderer/default-media-helpers.ts')

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
      src: 'https://example.com/default.pdf',
    }

    const rootNode = {
      querySelectorAll: sinon.stub().returns([videoNode, iframeNode]),
      parentElement: rootParent,
    }

    teardownDefaultMediaElementTree(rootNode)

    expect(videoNode.pause.calledOnce).to.equal(true)
    expect(videoNode.removeAttribute.calledWith('src')).to.equal(true)
    expect(videoNode.load.calledOnce).to.equal(true)
    expect(videoParent.removeChild.calledWith(videoNode)).to.equal(true)

    expect(iframeNode.removeAttribute.calledWith('src')).to.equal(true)
    expect(iframeNode.src).to.equal('')
    expect(iframeParent.removeChild.calledWith(iframeNode)).to.equal(true)

    expect(rootParent.removeChild.calledWith(rootNode)).to.equal(true)
  })

  it('replaces a failed assigned image with a controlled unavailable state and retries it', () => {
    const originalDocument = global.document
    const originalWindow = global.window
    const timers = []
    const refreshRequested = sinon.spy()

    global.document = {
      createElement: (tagName) => createFakeElement(tagName),
    }
    global.window = {
      setTimeout: (callback, delay) => {
        timers.push({ callback, delay, cleared: false })
        return timers.length
      },
      clearTimeout: (id) => {
        if (timers[id - 1]) timers[id - 1].cleared = true
      },
    }

    try {
      const { DefaultMediaPlayer } = require('../../../src/renderer/default-media-player.ts')
      const container = createFakeElement('div')
      const player = new DefaultMediaPlayer(container, { onRefreshRequested: refreshRequested })
      const payload = {
        source: 'SCREEN',
        media_id: 'media-1',
        media: {
          id: 'media-1',
          name: 'Assigned fallback',
          type: 'IMAGE',
          media_url: 'https://cdn.example.com/fallback.png',
          local_url: 'file:///missing/fallback.png',
        },
      }

      player.setMedia(payload)
      player.show()

      const content = container.children[0]
      const status = container.children[1]
      const failedImage = content.children[0]
      expect(failedImage.tagName).to.equal('IMG')

      failedImage.onerror()

      expect(content.children).to.have.length(1)
      expect(content.children[0].className).to.equal('darshan-default-unavailable')
      expect(content.children[0].children[0].textContent).to.equal('Content unavailable')
      expect(content.children[0].children[1].textContent).to.contain('assigned default content')
      expect(status.textContent).to.equal('Reconnecting...')
      expect(status.style.display).to.equal('block')
      expect(timers).to.have.length(1)
      expect(timers[0].delay).to.equal(1000)

      timers[0].callback()
      expect(refreshRequested.calledOnceWithExactly('image-error')).to.equal(true)

      player.setMedia(payload)
      const recoveredImage = content.children[0]
      expect(recoveredImage.tagName).to.equal('IMG')
      recoveredImage.onload()
      expect(status.style.display).to.equal('none')
    } finally {
      global.document = originalDocument
      global.window = originalWindow
    }
  })
})
