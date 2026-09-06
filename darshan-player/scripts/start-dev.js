/**
 * Launch the Electron player in an isolated development profile.
 *
 * Development runs often happen on machines that also have a packaged
 * production/QA player installed. Those installs can publish process-level
 * environment such as DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/config.json.
 * If the dev launcher inherits that site profile, pairing can appear to
 * "accept" the OTP and then immediately return to the OTP screen because
 * the authenticated bootstrap correctly detects an environment mismatch.
 */

const { spawn } = require('child_process')
const path = require('path')

const DEV_DEFAULTS = {
  NODE_ENV: 'development',
  DARSHAN_RUNTIME_MODE: 'dev',
  DARSHAN_RUNTIME_ROOT: path.resolve(__dirname, '..', '.runtime', 'dev-player'),
  DARSHAN_API_BASE_URL: 'http://127.0.0.1:3000',
  DARSHAN_WS_URL: 'ws://127.0.0.1:3000/ws',
  DARSHAN_REALTIME_WS_URL: 'ws://127.0.0.1:3000/ws',
  DARSHAN_ENVIRONMENT_NAME: 'development',
  DARSHAN_DEPLOYMENT_ID: 'local',
  DARSHAN_EXPECTED_SERVER_ID: 'darshan-api',
  DARSHAN_REALTIME_PLAYER_ENABLED: 'true',
  DARSHAN_REALTIME_SIGNED_AUTH_ENABLED: 'false',
}

const SITE_CONFIG_KEYS = ['DARSHAN_PLAYER_CONFIG_FILE', 'SIGNHEX_PLAYER_CONFIG_FILE']

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function applyDefault(env, key, value) {
  if (!hasText(env[key])) {
    env[key] = value
  }
}

function buildDevelopmentEnvironment(inputEnv = process.env) {
  const env = { ...inputEnv }

  delete env.ELECTRON_RUN_AS_NODE

  if (env.DARSHAN_DEV_USE_SITE_CONFIG !== 'true') {
    for (const key of SITE_CONFIG_KEYS) {
      delete env[key]
    }
  }

  for (const [key, value] of Object.entries(DEV_DEFAULTS)) {
    applyDefault(env, key, value)
  }

  applyDefault(env, 'HEXMON_RUNTIME_ROOT', env.DARSHAN_RUNTIME_ROOT)

  applyDefault(env, 'SIGNHEX_ENVIRONMENT_NAME', env.DARSHAN_ENVIRONMENT_NAME)
  applyDefault(env, 'SIGNHEX_DEPLOYMENT_ID', env.DARSHAN_DEPLOYMENT_ID)
  applyDefault(env, 'SIGNHEX_EXPECTED_SERVER_ID', env.DARSHAN_EXPECTED_SERVER_ID)

  return env
}

function launch() {
  const env = buildDevelopmentEnvironment(process.env)
  const electronBin = process.platform === 'win32' ? 'electron.cmd' : 'electron'
  const child = spawn(electronBin, ['.'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  child.on('error', error => {
    console.error('[start-dev] Failed to launch Electron:', error)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

if (require.main === module) {
  launch()
}

module.exports = {
  buildDevelopmentEnvironment,
}
