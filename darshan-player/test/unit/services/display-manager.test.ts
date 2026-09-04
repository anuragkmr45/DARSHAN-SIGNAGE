const { expect } = require('chai')

describe('DisplayManager output normalization', () => {
  const loadManager = () => require('../../../src/main/services/display-manager')

  it('reports bounds, backing pixels, and orientation from current dimensions', () => {
    const { toDisplayOutput } = loadManager()
    const output = toDisplayOutput(
      {
        id: 42,
        label: 'Lobby panel',
        bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
        workArea: { x: -1920, y: 0, width: 1920, height: 1040 },
        scaleFactor: 1.5,
        rotation: 90,
        displayFrequency: 60,
      },
      42
    )

    expect(output).to.include({
      key: 'platform:42',
      electron_id: '42',
      identity_confidence: 'PLATFORM',
      primary: true,
      orientation: 'LANDSCAPE',
      rotation_degrees: 90,
    })
    expect(output.bounds_dip).to.deep.equal({ x: -1920, y: 0, width: 1920, height: 1080 })
    expect(output.estimated_backing_px).to.deep.equal({ width: 2880, height: 1620 })
    expect(output.aspect.exact_key).to.equal('16:9')
  })

  it('marks indistinguishable output signatures as session-scoped and unsafe to pin', () => {
    const { toDisplayOutput } = loadManager()
    const output = toDisplayOutput(
      {
        id: 7,
        label: '',
        bounds: { x: 0, y: 0, width: 1200, height: 500 },
        workArea: { x: 0, y: 0, width: 1200, height: 500 },
        scaleFactor: 1,
        rotation: 0,
      },
      7,
      true
    )

    expect(output.key).to.equal('session:7')
    expect(output.identity_confidence).to.equal('SESSION')
    expect(output.aspect.exact_key).to.equal('12:5')
  })
})
