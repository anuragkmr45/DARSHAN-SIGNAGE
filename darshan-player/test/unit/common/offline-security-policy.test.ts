const { expect } = require('chai')

describe('secure offline playback policy', () => {
  it('keeps standard offline behavior allowed by default', () => {
    const { evaluateSecurePlaybackState } = require('../../../src/common/offline-security-policy')

    const result = evaluateSecurePlaybackState({
      nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
      lastBackendSuccessAtMs: undefined,
    })

    expect(result.enabled).to.equal(false)
    expect(result.allowed).to.equal(true)
    expect(result.locked).to.equal(false)
  })

  it('locks secure playback when no backend validation has succeeded', () => {
    const { evaluateSecurePlaybackState } = require('../../../src/common/offline-security-policy')

    const result = evaluateSecurePlaybackState({
      security: { offlinePlaybackPolicy: 'secure' },
      nowMs: Date.parse('2026-06-19T10:00:00.000Z'),
    })

    expect(result.enabled).to.equal(true)
    expect(result.allowed).to.equal(false)
    expect(result.locked).to.equal(true)
    expect(result.reason).to.match(/Backend validation is required/)
  })

  it('locks exactly when the authenticated playback lease expires without additive grace', () => {
    const { evaluateSecurePlaybackState } = require('../../../src/common/offline-security-policy')
    const successAt = Date.parse('2026-06-19T10:00:00.000Z')
    const security = {
      offlinePlaybackPolicy: 'secure',
      playbackLeaseMs: 60000,
      lockAfterOfflineMs: 30000,
      networkSwitchGraceMs: 10000,
    }

    const insideLease = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 30000,
      lastBackendSuccessAtMs: successAt,
    })
    const justBeforeDeadline = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 59999,
      lastBackendSuccessAtMs: successAt,
    })
    const locked = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 60000,
      lastBackendSuccessAtMs: successAt,
    })

    expect(insideLease.allowed).to.equal(true)
    expect(insideLease.inGrace).to.equal(false)
    expect(justBeforeDeadline.allowed).to.equal(true)
    expect(justBeforeDeadline.inGrace).to.equal(false)
    expect(locked.allowed).to.equal(false)
    expect(locked.locked).to.equal(true)
    expect(locked.lockAtMs).to.equal(successAt + 60000)
  })

  it('does not let the first failure or legacy grace settings extend the lease', () => {
    const { evaluateSecurePlaybackState } = require('../../../src/common/offline-security-policy')
    const successAt = Date.parse('2026-06-19T10:00:00.000Z')
    const failureAt = successAt + 10000
    const security = {
      backendRequiredForPlayback: true,
      playbackLeaseMs: 5000,
      lockAfterOfflineMs: 60000,
    }

    const result = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 5000,
      lastBackendSuccessAtMs: successAt,
      firstBackendFailureAtMs: failureAt,
    })

    expect(result.allowed).to.equal(false)
    expect(result.locked).to.equal(true)
    expect(result.inGrace).to.equal(false)
    expect(result.lockAtMs).to.equal(successAt + 5000)
  })

  it('reports media-cache purge due at the same instant as the lock', () => {
    const { evaluateSecurePlaybackState } = require('../../../src/common/offline-security-policy')
    const successAt = Date.parse('2026-06-19T10:00:00.000Z')
    const failureAt = successAt + 10000
    const security = {
      offlinePlaybackPolicy: 'high_security',
      playbackLeaseMs: 5000,
      networkSwitchGraceMs: 1000,
      lockAfterOfflineMs: 10000,
      purgeCacheAfterOfflineMs: 60000,
    }

    const justBeforeLock = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 4999,
      lastBackendSuccessAtMs: successAt,
      firstBackendFailureAtMs: failureAt,
    })
    const lockedWithPurge = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 5000,
      lastBackendSuccessAtMs: successAt,
      firstBackendFailureAtMs: failureAt,
    })

    expect(justBeforeLock.locked).to.equal(false)
    expect(justBeforeLock.purgeDue).to.equal(false)
    expect(lockedWithPurge.locked).to.equal(true)
    expect(lockedWithPurge.purgeDue).to.equal(true)
    expect(lockedWithPurge.purgeDueAtMs).to.equal(successAt + 5000)
  })
})
