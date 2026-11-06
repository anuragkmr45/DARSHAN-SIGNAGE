const { expect } = require('chai')
const sinon = require('sinon')

function makeConfig(security) {
  return {
    security: {
      csp: '',
      allowedDomains: [],
      disableEval: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...security,
    },
  }
}

describe('secure playback guard', () => {
  let clock

  afterEach(() => {
    if (clock) {
      clock.restore()
      clock = undefined
    }
  })

  it('tracks backend availability without locking playback when secure mode is disabled', () => {
    const { SecurePlaybackGuard } = require('../../../src/main/services/secure-playback-guard')
    const guard = new SecurePlaybackGuard({
      now: () => Date.parse('2026-06-19T10:00:00.000Z'),
      configProvider: () => makeConfig({ offlinePlaybackPolicy: 'standard' }),
    })

    const changes = []
    guard.on('changed', (status) => changes.push(status))

    guard.markBackendFailure('unit')

    expect(guard.getStatus().enabled).to.equal(false)
    expect(guard.getStatus().locked).to.equal(false)
    expect(guard.getStatus().firstBackendFailureAt).to.equal('2026-06-19T10:00:00.000Z')
    expect(changes.some((status) => Boolean(status.firstBackendFailureAt))).to.equal(true)

    guard.markBackendSuccess('unit-recovery')
    expect(guard.getStatus().firstBackendFailureAt).to.equal(undefined)
  })

  it('locks when the authenticated lease expires and unlocks on backend success', () => {
    const start = Date.parse('2026-06-19T10:00:00.000Z')
    clock = sinon.useFakeTimers({ now: start, shouldAdvanceTime: false })
    const { SecurePlaybackGuard } = require('../../../src/main/services/secure-playback-guard')
    const guard = new SecurePlaybackGuard({
      now: () => Date.now(),
      configProvider: () =>
        makeConfig({
          offlinePlaybackPolicy: 'secure',
          playbackLeaseMs: 1000,
          lockAfterOfflineMs: 2000,
          networkSwitchGraceMs: 1000,
        }),
    })
    const changes = []
    guard.on('changed', (status) => changes.push(status))

    guard.markBackendSuccess('unit-success')
    expect(guard.getStatus().locked).to.equal(false)

    clock.tick(1001)
    expect(guard.getStatus().locked).to.equal(true)
    expect(changes.some((status) => status.locked === true)).to.equal(true)

    guard.markBackendSuccess('unit-reconnect')
    expect(guard.getStatus().locked).to.equal(false)
  })

  it('emits purge-requested at the security lock deadline', () => {
    const start = Date.parse('2026-06-19T10:00:00.000Z')
    clock = sinon.useFakeTimers({ now: start, shouldAdvanceTime: false })
    const { SecurePlaybackGuard } = require('../../../src/main/services/secure-playback-guard')
    const guard = new SecurePlaybackGuard({
      now: () => Date.now(),
      configProvider: () =>
        makeConfig({
          offlinePlaybackPolicy: 'high_security',
          playbackLeaseMs: 1000,
          networkSwitchGraceMs: 500,
          lockAfterOfflineMs: 1000,
          purgeCacheAfterOfflineMs: 3000,
        }),
    })
    const purgeEvents = []
    guard.on('purge-requested', (status) => purgeEvents.push(status))

    guard.markBackendSuccess('unit-success')
    guard.markBackendFailure('unit-failure')
    clock.tick(1001)

    expect(guard.getStatus().locked).to.equal(true)
    expect(guard.getStatus().purgeDue).to.equal(true)
    expect(purgeEvents.length).to.equal(1)
  })

  it('reports locked backend reachability without unlocking and emits one recovery request', () => {
    const start = Date.parse('2026-06-19T10:00:00.000Z')
    clock = sinon.useFakeTimers({ now: start, shouldAdvanceTime: false })
    const { SecurePlaybackGuard } = require('../../../src/main/services/secure-playback-guard')
    const guard = new SecurePlaybackGuard({
      now: () => Date.now(),
      configProvider: () =>
        makeConfig({
          offlinePlaybackPolicy: 'secure',
          backendRequiredForPlayback: true,
          playbackLeaseMs: 1000,
        }),
    })
    const recoveryRequests = []
    guard.on('recovery-requested', (status) => recoveryRequests.push(status))

    guard.markBackendSuccess('unit-success')
    clock.tick(1001)
    guard.markBackendReachable('heartbeat')
    guard.markBackendReachable('heartbeat-duplicate')

    expect(guard.getStatus().locked).to.equal(true)
    expect(guard.getStatus().recoveryPhase).to.equal('REVALIDATING_IDENTITY')
    expect(recoveryRequests).to.have.length(1)

    guard.setRecoveryPhase('FETCHING_CURRENT_SNAPSHOT')
    expect(guard.getStatus().locked).to.equal(true)
    guard.markBackendSuccess('validated-fresh-authority')
    expect(guard.getStatus().locked).to.equal(false)
    expect(guard.getStatus().recoveryPhase).to.equal('READY')
  })

  it('can seed backend success from persisted validation time', () => {
    const start = Date.parse('2026-06-19T10:00:00.000Z')
    const { SecurePlaybackGuard } = require('../../../src/main/services/secure-playback-guard')
    const guard = new SecurePlaybackGuard({
      now: () => start,
      configProvider: () =>
        makeConfig({
          backendRequiredForPlayback: true,
          playbackLeaseMs: 60000,
          lockAfterOfflineMs: 60000,
        }),
    })

    expect(guard.getStatus().locked).to.equal(true)
    guard.seedBackendSuccess(start - 10000)
    expect(guard.getStatus().locked).to.equal(false)
  })
})
