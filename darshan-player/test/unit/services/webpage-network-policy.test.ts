const { expect } = require('chai')
const {
  assertPlayerWebpageUrlAllowed,
  hostMatches,
  ipMatchesCidr,
} = require('../../../src/main/services/webpage-network-policy.ts')

const baseSecurity = {
  csp: "default-src 'self'",
  allowedDomains: [],
  disableEval: true,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}

async function expectPolicyFailure(promise: Promise<unknown>, message: string) {
  try {
    await promise
    throw new Error('Expected webpage policy to reject the URL')
  } catch (error) {
    expect((error as Error).message).to.equal(message)
  }
}

describe('Webpage Network Policy', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  after(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('matches wildcard hosts only on DNS label boundaries', () => {
    expect(hostMatches('screen.example.com', '*.example.com')).to.equal(true)
    expect(hostMatches('deep.screen.example.com', '*.example.com')).to.equal(true)
    expect(hostMatches('example.com', '*.example.com')).to.equal(false)
    expect(hostMatches('evil-example.com', '*.example.com')).to.equal(false)
  })

  it('matches IPv4, IPv6, and IPv4-mapped IPv6 CIDRs correctly', () => {
    expect(ipMatchesCidr('192.168.29.64', '192.168.29.0/24')).to.equal(true)
    expect(ipMatchesCidr('192.168.30.1', '192.168.29.0/24')).to.equal(false)
    expect(ipMatchesCidr('fd00::10', 'fd00::/8')).to.equal(true)
    expect(ipMatchesCidr('::ffff:192.168.29.64', '::ffff:0:0/96')).to.equal(true)
  })

  it('allows an explicitly configured public HTTPS endpoint', async () => {
    const parsed = await assertPlayerWebpageUrlAllowed('https://8.8.8.8/', 'navigation', {
      ...baseSecurity,
      allowedDomains: ['8.8.8.8'],
      webpageAllowedPorts: [443],
    })
    expect(parsed.protocol).to.equal('https:')
  })

  it('requires explicit CIDR permission for private addresses', async () => {
    const denied = assertPlayerWebpageUrlAllowed('https://192.168.29.64/', 'navigation', {
      ...baseSecurity,
      allowedDomains: ['192.168.29.64'],
    })
    await expectPolicyFailure(denied, 'Private webpage address is not allowlisted')

    const parsed = await assertPlayerWebpageUrlAllowed('https://192.168.29.64/', 'navigation', {
      ...baseSecurity,
      allowedDomains: ['192.168.29.64'],
      webpageAllowedCidrs: ['192.168.29.0/24'],
    })
    expect(parsed.hostname).to.equal('192.168.29.64')
  })

  it('always blocks loopback, including IPv4-mapped IPv6', async () => {
    for (const address of ['127.0.0.1', '[::1]', '[::ffff:7f00:1]']) {
      const denied = assertPlayerWebpageUrlAllowed(`https://${address}/`, 'navigation', {
        ...baseSecurity,
        allowedDomains: [address.replace(/^\[|\]$/g, '')],
        webpageAllowedCidrs: ['0.0.0.0/0', '::/0'],
      })
      await expectPolicyFailure(denied, 'Webpage resolved to a prohibited address')
    }
  })

  it('rejects credentials, production HTTP, unexpected ports, metadata, and link-local addresses', async () => {
    const cases = [
      ['https://user:secret@8.8.8.8/', 'URL credentials are prohibited'],
      ['http://8.8.8.8/', 'URL scheme is prohibited'],
      ['https://8.8.8.8:8443/', 'URL port is prohibited'],
      ['https://169.254.169.254/', 'Webpage resolved to a prohibited address'],
      ['https://[fe80::1]/', 'Webpage resolved to a prohibited address'],
    ] as const
    for (const [url, message] of cases) {
      await expectPolicyFailure(assertPlayerWebpageUrlAllowed(url, 'navigation', {
        ...baseSecurity,
        allowedDomains: [new URL(url).hostname.replace(/^\[|\]$/g, '')],
        webpageAllowedCidrs: ['0.0.0.0/0', '::/0'],
      }), message)
    }
  })

  it('uses a distinct subresource allowlist and catches a later private DNS answer', async () => {
    const secured = {
      ...baseSecurity,
      allowedDomains: ['screen.example.test'],
      webpageResourceDomains: ['cdn.example.test'],
    }
    await assertPlayerWebpageUrlAllowed(
      'https://cdn.example.test/app.js',
      'resource',
      secured,
      async () => ['203.0.113.9'],
    )
    await expectPolicyFailure(assertPlayerWebpageUrlAllowed(
      'https://screen.example.test/app.js',
      'resource',
      secured,
      async () => ['203.0.113.9'],
    ), 'Webpage host is not allowlisted')
    await expectPolicyFailure(assertPlayerWebpageUrlAllowed(
      'https://screen.example.test/',
      'navigation',
      secured,
      async () => ['10.0.0.5'],
    ), 'Private webpage address is not allowlisted')
  })
})
