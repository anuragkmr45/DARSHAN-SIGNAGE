const { expect } = require('chai')

describe('display profile normalization', () => {
  it('reduces real arbitrary display modes', () => {
    const { greatestCommonDivisor, normalizedAspect } = require('../../../src/common/display-profile')
    expect(greatestCommonDivisor(2400, 1000)).to.equal(200)
    expect(normalizedAspect(2400, 1000).exact_key).to.equal('12:5')
    expect(normalizedAspect(1080, 1920).exact_key).to.equal('9:16')
  })

  it('does not infer portrait only from rotation metadata', () => {
    const { outputOrientation } = require('../../../src/common/display-profile')
    expect(outputOrientation(1080, 1920)).to.equal('PORTRAIT')
    expect(outputOrientation(1920, 1080)).to.equal('LANDSCAPE')
    expect(outputOrientation(1080, 1080)).to.equal('SQUARE')
  })
})
