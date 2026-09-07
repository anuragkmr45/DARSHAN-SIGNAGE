const { expect } = require('chai')

describe('RendererReadinessGate', () => {
  const { RendererReadinessGate } = require('../../../src/main/services/renderer-readiness-gate.ts')

  it('claims once when the renderer loads before services finish', () => {
    const gate = new RendererReadinessGate()
    const renderer = {}

    expect(gate.markRendererLoaded(renderer)).to.equal(undefined)
    expect(gate.markServicesReady()).to.equal(renderer)
    expect(gate.markServicesReady()).to.equal(undefined)
    expect(gate.markRendererLoaded(renderer)).to.equal(undefined)
  })

  it('claims once when services finish before the renderer loads', () => {
    const gate = new RendererReadinessGate()
    const renderer = {}

    expect(gate.markServicesReady()).to.equal(undefined)
    expect(gate.markRendererLoaded(renderer)).to.equal(renderer)
    expect(gate.markRendererLoaded(renderer)).to.equal(undefined)
  })

  it('allows retry after an attachment failure and reclaims a recreated renderer', () => {
    const gate = new RendererReadinessGate()
    const firstRenderer = {}
    const replacementRenderer = {}

    gate.markServicesReady()
    expect(gate.markRendererLoaded(firstRenderer)).to.equal(firstRenderer)
    gate.releaseClaim(firstRenderer)
    expect(gate.markRendererLoaded(firstRenderer)).to.equal(firstRenderer)
    gate.clear(firstRenderer)
    expect(gate.markRendererLoaded(replacementRenderer)).to.equal(replacementRenderer)
  })
})
