const { expect } = require('chai')

const { buildDevelopmentEnvironment } = require('../../../scripts/start-dev.js')

describe('start-dev launcher environment', () => {
  it('isolates development runs from installed site player config by default', () => {
    const env = buildDevelopmentEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      DARSHAN_PLAYER_CONFIG_FILE: '/etc/darshan/config.json',
      SIGNHEX_PLAYER_CONFIG_FILE: '/etc/darshan/player/config.json',
      SIGNHEX_ENVIRONMENT_NAME: 'production',
      SIGNHEX_DEPLOYMENT_ID: 'site-a',
      SIGNHEX_EXPECTED_SERVER_ID: 'backend-a',
    })

    expect(env).not.to.have.property('ELECTRON_RUN_AS_NODE')
    expect(env).not.to.have.property('DARSHAN_PLAYER_CONFIG_FILE')
    expect(env).not.to.have.property('SIGNHEX_PLAYER_CONFIG_FILE')
    expect(env.NODE_ENV).to.equal('development')
    expect(env.DARSHAN_RUNTIME_MODE).to.equal('dev')
    expect(env.DARSHAN_RUNTIME_ROOT).to.match(/darshan-player[/\\]\.runtime[/\\]dev-player$/)
    expect(env.HEXMON_RUNTIME_ROOT).to.equal(env.DARSHAN_RUNTIME_ROOT)
    expect(env.DARSHAN_ENVIRONMENT_NAME).to.equal('development')
    expect(env.DARSHAN_DEPLOYMENT_ID).to.equal('local')
    expect(env.DARSHAN_EXPECTED_SERVER_ID).to.equal('darshan-api')
  })

  it('allows explicit developer API targets while keeping a development identity', () => {
    const env = buildDevelopmentEnvironment({
      DARSHAN_API_BASE_URL: 'http://192.168.29.64:3000',
      DARSHAN_WS_URL: 'ws://192.168.29.64:3000/ws',
      DARSHAN_REALTIME_WS_URL: 'ws://192.168.29.64:3000/ws',
    })

    expect(env.DARSHAN_API_BASE_URL).to.equal('http://192.168.29.64:3000')
    expect(env.DARSHAN_WS_URL).to.equal('ws://192.168.29.64:3000/ws')
    expect(env.DARSHAN_REALTIME_WS_URL).to.equal('ws://192.168.29.64:3000/ws')
    expect(env.DARSHAN_ENVIRONMENT_NAME).to.equal('development')
    expect(env.DARSHAN_DEPLOYMENT_ID).to.equal('local')
  })

  it('allows an explicit developer runtime root for repeated local pairing tests', () => {
    const env = buildDevelopmentEnvironment({
      DARSHAN_RUNTIME_ROOT: '/tmp/custom-darshan-dev-runtime',
    })

    expect(env.DARSHAN_RUNTIME_ROOT).to.equal('/tmp/custom-darshan-dev-runtime')
    expect(env.HEXMON_RUNTIME_ROOT).to.equal('/tmp/custom-darshan-dev-runtime')
  })

  it('can intentionally preserve an installed site profile for profile-specific tests', () => {
    const env = buildDevelopmentEnvironment({
      DARSHAN_DEV_USE_SITE_CONFIG: 'true',
      DARSHAN_PLAYER_CONFIG_FILE: '/etc/darshan/config.json',
    })

    expect(env.DARSHAN_PLAYER_CONFIG_FILE).to.equal('/etc/darshan/config.json')
  })
})
