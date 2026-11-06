const { expect } = require('chai')
const sinon = require('sinon')

describe('Renderer playback handshake', () => {
  it('applies lifecycle status before asking main to restore the active item', async () => {
    const { synchronizeCurrentPlayback } = require('../../../src/renderer/renderer-playback-handshake.ts')
    const order = []
    const presentation = {
      revision: 7,
      status: {
        state: 'PAIRED_RUNTIME',
        mode: 'normal',
        online: true,
        contentEpoch: 'epoch-1',
      },
    }
    const api = {
      getPlayerPresentation: sinon.stub().callsFake(async () => {
        order.push('get-presentation')
        return presentation
      }),
      restoreCurrentPlayback: sinon.stub().callsFake(async () => {
        order.push('restore-playback')
        return true
      }),
    }
    const applyPresentation = sinon.spy(() => order.push('apply-presentation'))

    expect(await synchronizeCurrentPlayback(api, applyPresentation)).to.equal(true)
    expect(applyPresentation.calledOnceWithExactly(presentation)).to.equal(true)
    expect(order).to.deep.equal(['get-presentation', 'apply-presentation', 'restore-playback'])
  })

  it('does not request playback restoration when the lifecycle snapshot fails', async () => {
    const { synchronizeCurrentPlayback } = require('../../../src/renderer/renderer-playback-handshake.ts')
    const restoreCurrentPlayback = sinon.stub().resolves(true)

    let rejected = false
    try {
      await synchronizeCurrentPlayback({
        getPlayerPresentation: sinon.stub().rejects(new Error('presentation unavailable')),
        restoreCurrentPlayback,
      }, sinon.spy())
    } catch {
      rejected = true
    }

    expect(rejected).to.equal(true)
    expect(restoreCurrentPlayback.called).to.equal(false)
  })
})
