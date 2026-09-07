const { expect } = require('chai')

describe('DeferredPlaybackGate', () => {
  const { DeferredPlaybackGate } = require('../../../src/renderer/deferred-playback-gate.ts')

  it('releases a deferred item only to a newer scheduled presentation', () => {
    const gate = new DeferredPlaybackGate()
    const item = { id: 'emergency-1' }

    gate.defer(item, 7)
    expect(gate.resolve(7, 'schedule')).to.equal(undefined)
    expect(gate.resolve(8, 'schedule')).to.equal(item)
    expect(gate.resolve(9, 'schedule')).to.equal(undefined)
  })

  it('discards a deferred item when the next authoritative revision is not scheduled content', () => {
    const gate = new DeferredPlaybackGate()
    gate.defer({ id: 'stale' }, 10)

    expect(gate.resolve(11, 'default')).to.equal(undefined)
    expect(gate.resolve(12, 'schedule')).to.equal(undefined)
  })

  it('keeps only the newest event and supports explicit lifecycle clearing', () => {
    const gate = new DeferredPlaybackGate()
    gate.defer({ id: 'first' }, 2)
    gate.defer({ id: 'second' }, 2)

    expect(gate.resolve(3, 'schedule')).to.deep.equal({ id: 'second' })
    gate.defer({ id: 'third' }, 3)
    gate.clear()
    expect(gate.resolve(4, 'schedule')).to.equal(undefined)
  })
})
