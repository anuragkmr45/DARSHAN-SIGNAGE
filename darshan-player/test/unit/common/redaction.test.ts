const { expect } = require('chai')

describe('diagnostic URL redaction', () => {
  it('removes URL userinfo from absolute URLs', () => {
    const { redactUrlForDiagnostics } = require('../../../src/common/redaction')

    const redacted = redactUrlForDiagnostics('https://user:password@backend.internal:3000/api')

    expect(redacted).to.equal('https://backend.internal:3000/api')
    expect(redacted).not.to.contain('user')
    expect(redacted).not.to.contain('password')
  })

  it('removes query strings and fragments from absolute URLs', () => {
    const { redactUrlForDiagnostics } = require('../../../src/common/redaction')

    const redacted = redactUrlForDiagnostics('https://backend.internal:3000/api?token=abc&password=def#secret')

    expect(redacted).to.equal('https://backend.internal:3000/api')
    expect(redacted).not.to.contain('token')
    expect(redacted).not.to.contain('abc')
    expect(redacted).not.to.contain('password')
    expect(redacted).not.to.contain('def')
    expect(redacted).not.to.contain('secret')
  })

  it('does not echo invalid raw URL input', () => {
    const { redactUrlForDiagnostics } = require('../../../src/common/redaction')

    const redacted = redactUrlForDiagnostics('not a url with password=secret')

    expect(redacted).to.equal('[invalid-url-redacted]')
    expect(redacted).not.to.contain('password=secret')
  })

  it('preserves useful host and path details for normal URLs', () => {
    const { redactUrlForDiagnostics } = require('../../../src/common/redaction')

    expect(redactUrlForDiagnostics('http://192.168.0.5:3000/api')).to.equal('http://192.168.0.5:3000/api')
  })

  it('redacts relative request paths without preserving query strings', () => {
    const { redactUrlOrPathForDiagnostics } = require('../../../src/common/redaction')

    expect(redactUrlOrPathForDiagnostics('/api/v1/device/heartbeat?token=abc#secret')).to.equal(
      '/api/v1/device/heartbeat'
    )
  })

  it('recursively redacts URL-like log payload fields', () => {
    const { sanitizeLogPayloadForDiagnostics } = require('../../../src/common/redaction')

    const payload = sanitizeLogPayloadForDiagnostics({
      liveUrl: 'https://user:password@backend.internal:3000/page?token=abc#secret',
      nested: {
        expected: 'https://user:password@backend.internal:3000/a?password=def',
        actual: 'https://user:password@backend.internal:3000/b?access_key=ghi#fragment',
      },
      label: 'keep-this-label',
    })
    const serialized = JSON.stringify(payload)

    expect(payload.liveUrl).to.equal('https://backend.internal:3000/page')
    expect(payload.nested.expected).to.equal('https://backend.internal:3000/a')
    expect(payload.nested.actual).to.equal('https://backend.internal:3000/b')
    expect(payload.label).to.equal('keep-this-label')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('def')
    expect(serialized).not.to.contain('ghi')
    expect(serialized).not.to.contain('fragment')
  })

  it('redacts URL substrings inside log messages and errors', () => {
    const { sanitizeLogPayloadForDiagnostics } = require('../../../src/common/redaction')

    const payload = sanitizeLogPayloadForDiagnostics({
      message: 'Failed loading https://user:password@backend.internal:3000/page?token=abc#secret.',
      error: new Error('Fetch failed for https://user:password@backend.internal:3000/api?password=def#fragment'),
    })
    const serialized = JSON.stringify(payload)

    expect(payload.message).to.contain('https://backend.internal:3000/page')
    expect(payload.error.message).to.contain('https://backend.internal:3000/api')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('def')
    expect(serialized).not.to.contain('fragment')
  })

  it('does not echo invalid URL-like log payload fields', () => {
    const { sanitizeLogPayloadForDiagnostics } = require('../../../src/common/redaction')

    const payload = sanitizeLogPayloadForDiagnostics({
      url: 'not a url with password=secret',
    })

    expect(payload.url).to.equal('[invalid-url-redacted]')
  })

  it('preserves non-URL source labels while redacting URL source values', () => {
    const { sanitizeLogPayloadForDiagnostics } = require('../../../src/common/redaction')

    const payload = sanitizeLogPayloadForDiagnostics({
      source: 'request-queue',
      mediaSource: 'https://user:password@backend.internal/media.mp4?token=abc#secret',
    })
    const serialized = JSON.stringify(payload)

    expect(payload.source).to.equal('request-queue')
    expect(payload.mediaSource).to.equal('https://backend.internal/media.mp4')
    expect(serialized).not.to.contain('user')
    expect(serialized).not.to.contain('password')
    expect(serialized).not.to.contain('token')
    expect(serialized).not.to.contain('abc')
    expect(serialized).not.to.contain('secret')
  })
})
