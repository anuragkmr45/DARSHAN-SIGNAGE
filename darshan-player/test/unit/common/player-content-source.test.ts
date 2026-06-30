const { expect } = require('chai')

describe('player content source policy', () => {
  it('switches to default content when player status mode is default', () => {
    const { resolvePlayerContentSource } = require('../../../src/common/player-content-source')

    const source = resolvePlayerContentSource({
      state: 'PAIRED_RUNTIME',
      mode: 'default',
      online: true,
    })

    expect(source).to.equal('default')
  })

  it('keeps schedule content active during normal scheduled playback', () => {
    const { resolvePlayerContentSource } = require('../../../src/common/player-content-source')

    const source = resolvePlayerContentSource({
      state: 'PAIRED_RUNTIME',
      mode: 'normal',
      online: true,
    })

    expect(source).to.equal('schedule')
  })

  it('hides schedule and default content while secure playback lock is active', () => {
    const {
      resolvePlayerContentSource,
      shouldDisplaySecurityLock,
    } = require('../../../src/common/player-content-source')

    const status = {
      state: 'PAIRED_RUNTIME',
      mode: 'default',
      online: false,
      securityLock: {
        enabled: true,
        locked: true,
        inGrace: false,
        reason: 'Backend validation required',
      },
    }
    const source = resolvePlayerContentSource(status)

    expect(shouldDisplaySecurityLock(status)).to.equal(true)
    expect(source).to.equal('none')
  })

  it('does not cover OTP/recovery states with the security lock overlay', () => {
    const {
      resolvePlayerContentSource,
      shouldDisplaySecurityLock,
    } = require('../../../src/common/player-content-source')
    const status = {
      state: 'HARD_RECOVERY',
      mode: 'empty',
      online: false,
      securityLock: {
        enabled: true,
        locked: true,
        inGrace: false,
        reason: 'Backend validation required',
      },
    }

    expect(shouldDisplaySecurityLock(status)).to.equal(false)
    expect(resolvePlayerContentSource(status)).to.equal('none')
  })
})
