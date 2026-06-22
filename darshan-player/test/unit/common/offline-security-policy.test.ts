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

  it('allows playback inside lease and grace windows, then locks', () => {
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
    const insideGrace = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 70000,
      lastBackendSuccessAtMs: successAt,
    })
    const locked = evaluateSecurePlaybackState({
      security,
      nowMs: successAt + 91000,
      lastBackendSuccessAtMs: successAt,
    })

    expect(insideLease.allowed).to.equal(true)
    expect(insideLease.inGrace).to.equal(false)
    expect(insideGrace.allowed).to.equal(true)
    expect(insideGrace.inGrace).to.equal(true)
    expect(locked.allowed).to.equal(false)
    expect(locked.locked).to.equal(true)
  })

  it('uses first backend failure as the grace anchor when known', () => {
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
      nowMs: failureAt + 59000,
      lastBackendSuccessAtMs: successAt,
      firstBackendFailureAtMs: failureAt,
    })

    expect(result.allowed).to.equal(true)
    expect(result.inGrace).to.equal(true)
    expect(result.lockAtMs).to.equal(failureAt + 60000)
  })

  it('reports purge due only after configured purge timeout', () => {
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

    const lockedNoPurge = evaluateSecurePlaybackState({
      security,
      nowMs: failureAt + 20000,
      lastBackendSuccessAtMs: successAt,
      firstBackendFailureAtMs: failureAt,
    })
    const lockedWithPurge = evaluateSecurePlaybackState({
      security,
      nowMs: failureAt + 61000,
      lastBackendSuccessAtMs: successAt,
      firstBackendFailureAtMs: failureAt,
    })

    expect(lockedNoPurge.locked).to.equal(true)
    expect(lockedNoPurge.purgeDue).to.equal(false)
    expect(lockedWithPurge.locked).to.equal(true)
    expect(lockedWithPurge.purgeDue).to.equal(true)
  })
})
