const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')

describe('logger URL redaction', () => {
  let previousNodeEnv
  let logDir

  beforeEach(() => {
    previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-logger-redaction-'))
  })

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv
    const { destroyAllLoggers } = require('../../../src/common/logger')
    destroyAllLoggers()
    fs.rmSync(logDir, { recursive: true, force: true })
    delete require.cache[require.resolve('../../../src/common/logger')]
  })

  function readLogs() {
    const files = fs.readdirSync(logDir).filter((file) => file.endsWith('.log'))
    return files.map((file) => fs.readFileSync(path.join(logDir, file), 'utf8')).join('\n')
  }

  it('redacts credentialed URLs in message strings and structured payloads', () => {
    const { getLogger } = require('../../../src/common/logger')
    const logger = getLogger(`logger-redaction-${Date.now()}`, logDir)

    logger.info(
      'Fetching https://user:password@backend.internal:3000/api?token=abc#secret failed'
    )
    logger.warn(
      { uploadUrl: 'https://user:password@backend.internal:3000/logs?password=def#fragment' },
      'Uploading to https://user:password@backend.internal:3000/logs?access_key=ghi#fragment'
    )

    const output = readLogs()

    expect(output).to.contain('https://backend.internal:3000/api')
    expect(output).to.contain('https://backend.internal:3000/logs')
    expect(output).not.to.contain('user')
    expect(output).not.to.contain('password')
    expect(output).not.to.contain('token')
    expect(output).not.to.contain('access_key')
    expect(output).not.to.contain('abc')
    expect(output).not.to.contain('def')
    expect(output).not.to.contain('ghi')
    expect(output).not.to.contain('secret')
    expect(output).not.to.contain('fragment')
  })
})
