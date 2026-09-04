const { expect } = require('chai')

describe('PDF playback helpers', () => {
  it('keeps the runtime PDF source unchanged for PDF.js rendering', async () => {
    const { buildPdfPlaybackSource } = require('../../../src/renderer/pdf-playback')

    const source = buildPdfPlaybackSource('file:///tmp/darshan/doc.pdf')

    expect(source).to.equal('file:///tmp/darshan/doc.pdf')
  })

  it('preserves existing PDF fragments for PDF.js rendering', async () => {
    const { buildPdfPlaybackSource } = require('../../../src/renderer/pdf-playback')

    const source = buildPdfPlaybackSource('https://backend.local/media/doc.pdf#page=2')

    expect(source).to.equal('https://backend.local/media/doc.pdf#page=2')
  })

  it('creates a full-frame canvas container for PDF playback', async () => {
    const originalDocument = global.document
    const originalWindow = global.window
    const createdElements = []
    const createdDiv = {
      style: {},
      attributes: {},
      children: [],
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      appendChild(child) {
        this.children.push(child)
      },
    }
    const createdCanvas = {
      style: {},
    }

    global.document = {
      createElement: (tagName) => {
        createdElements.push(tagName)
        if (tagName === 'div') return createdDiv
        if (tagName === 'canvas') return createdCanvas
        throw new Error(`Unexpected tag ${tagName}`)
      },
    }
    global.window = {
      requestAnimationFrame: () => 1,
      devicePixelRatio: 1,
    }

    try {
      const { createPdfPlaybackElement } = require('../../../src/renderer/pdf-playback')
      const element = createPdfPlaybackElement('file:///tmp/darshan/doc.pdf')

      expect(element).to.equal(createdDiv)
      expect(createdElements).to.deep.equal(['div', 'canvas'])
      expect(createdDiv.attributes.title).to.equal('PDF playback')
      expect(createdDiv.children).to.deep.equal([createdCanvas])
      expect(createdDiv.style.position).to.equal('absolute')
      expect(createdDiv.style.width).to.equal('100%')
      expect(createdDiv.style.height).to.equal('100%')
      expect(createdDiv.style.display).to.equal('flex')
      expect(createdCanvas.style.maxWidth).to.equal('100%')
      expect(createdCanvas.style.maxHeight).to.equal('100%')
    } finally {
      global.document = originalDocument
      global.window = originalWindow
    }
  })

  it('uses the bundled PDF.js worker asset', async () => {
    const { PDF_WORKER_SOURCE } = require('../../../src/renderer/pdf-playback')

    expect(PDF_WORKER_SOURCE).to.equal('./pdf.worker.mjs')
  })
})
