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

  it('does not lock playback when secure mode is disabled', () => {
    const { SecurePlaybackGuard } = require('../../../src/main/services/secure-playback-guard')
    const guard = new SecurePlaybackGuard({
      now: () => Date.parse('2026-06-19T10:00:00.000Z'),
      configProvider: () => makeConfig({ offlinePlaybackPolicy: 'standard' }),
    })

    guard.markBackendFailure('unit')

    expect(guard.getStatus().enabled).to.equal(false)
    expect(guard.getStatus().locked).to.equal(false)
  })

  it('locks when the secure grace timer expires and unlocks on backend success', () => {
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

    clock.tick(3100)
    expect(guard.getStatus().locked).to.equal(true)
    expect(changes.some((status) => status.locked === true)).to.equal(true)

    guard.markBackendSuccess('unit-reconnect')
    expect(guard.getStatus().locked).to.equal(false)
  })

  it('emits purge-requested after high-security purge timeout', () => {
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
    clock.tick(3001)

    expect(guard.getStatus().locked).to.equal(true)
    expect(guard.getStatus().purgeDue).to.equal(true)
    expect(purgeEvents.length).to.equal(1)
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
