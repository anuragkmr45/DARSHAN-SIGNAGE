const { expect } = require('chai')
const tls = require('tls')
const forge = require('node-forge')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createHash, X509Certificate } = require('crypto')
const { createLiveCertificateVerifier, probeLiveTlsLeaf } = require('../../../src/main/services/network/live-session-tls')

describe('Scoped live gateway TLS trust', function () {
  this.timeout(10000)
  let key, ca, caPem, leafKey, dir
  function certificate(subject, issuer, issuerKey, options = {}) {
    const cert = forge.pki.createCertificate()
    cert.publicKey = options.ca ? key.publicKey : leafKey.publicKey
    cert.serialNumber = options.expired ? '03' : options.name === 'wrong.example.test' ? '04' : options.ca ? '01' : '02'
    cert.validity.notBefore = new Date(Date.now() - 86400000)
    cert.validity.notAfter = new Date(Date.now() + 86400000)
    if (options.expired) { cert.validity.notBefore = new Date(Date.now() - 172800000); cert.validity.notAfter = new Date(Date.now() - 86400000) }
    cert.setSubject([{ name: 'commonName', value: subject }])
    cert.setIssuer(issuer ? issuer.subject.attributes : cert.subject.attributes)
    cert.setExtensions(options.ca ? [{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]
      : [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: options.name ? [{ type: 2, value: options.name }] : [{ type: 7, ip: '127.0.0.1' }] }])
    cert.sign(issuerKey, forge.md.sha256.create())
    return cert
  }
  before(() => {
    key = forge.pki.rsa.generateKeyPair(2048)
    leafKey = forge.pki.rsa.generateKeyPair(2048)
    ca = certificate('Private site root', null, key.privateKey, { ca: true })
    caPem = forge.pki.certificateToPem(ca)
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-session-tls-'))
    fs.writeFileSync(path.join(dir, 'ca.pem'), caPem, { mode: 0o600 })
  })
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  async function withServer(options, check) {
    const cert = forge.pki.certificateToPem(certificate('Private gateway', ca, key.privateKey, options))
    const server = tls.createServer({ key: forge.pki.privateKeyToPem(leafKey.privateKey), cert }, socket => socket.on('error', () => {}))
    server.on('tlsClientError', () => {})
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try { await check(server.address().port, cert) }
    finally { await new Promise(resolve => server.close(resolve)) }
  }
  it('validates the real pinned endpoint with private CA and exact peer leaf DER', async () => {
    await withServer({}, async (port, cert) => {
      const controller = new AbortController()
      const expected = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex')
      expect(await probeLiveTlsLeaf('127.0.0.1', port, Buffer.from(caPem), controller.signal)).to.equal(expected)
      const verifier = createLiveCertificateVerifier(`wss://127.0.0.1:${port}`, { enabled: true, caPath: path.join(dir, 'ca.pem'), strictCertificateValidation: true }, controller.signal)
      expect(await new Promise(resolve => verifier({ hostname: '127.0.0.1', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID', certificate: { data: cert } }, resolve))).to.equal(0)
    })
  })
  it('rejects wrong SAN host and expired certificates using standard TLS validation', async () => {
    for (const options of [{ name: 'wrong.example.test' }, { expired: true }]) await withServer(options, async port => {
      let failed = false
      try { await probeLiveTlsLeaf('127.0.0.1', port, Buffer.from(caPem), new AbortController().signal) } catch { failed = true }
      expect(failed).to.equal(true)
    })
  })
  it('rejects a foreign CA even when the gateway name and certificate encoding look valid', async () => {
    const foreign = certificate('Foreign root', null, key.privateKey, { ca: true })
    await withServer({}, async port => {
      let failed = false
      try { await probeLiveTlsLeaf('127.0.0.1', port, Buffer.from(forge.pki.certificateToPem(foreign)), new AbortController().signal) } catch { failed = true }
      expect(failed).to.equal(true)
    })
  })
  it('requires a complete valid intermediate chain instead of accepting a matching leaf encoding alone', async () => {
    const intermediate = certificate('Private intermediate', ca, key.privateKey, { ca: true })
    const leaf = forge.pki.certificateToPem(certificate('Private gateway', intermediate, key.privateKey))
    const intermediatePem = forge.pki.certificateToPem(intermediate)
    for (const complete of [false, true]) {
      const server = tls.createServer({ key: forge.pki.privateKeyToPem(leafKey.privateKey), cert: complete ? leaf + intermediatePem : leaf }, socket => socket.on('error', () => {}))
      server.on('tlsClientError', () => {})
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      let accepted = false
      try { await probeLiveTlsLeaf('127.0.0.1', server.address().port, Buffer.from(caPem), new AbortController().signal); accepted = true }
      catch { /* Missing intermediates must fail standard chain validation. */ }
      finally { await new Promise(resolve => server.close(resolve)) }
      expect(accepted).to.equal(complete)
    }
  })
  it('denies a Chromium peer leaf swap and cancels late verified responses from a disposed view', async () => {
    await withServer({}, async (_port, cert) => {
      let done
      const pending = new Promise(resolve => { done = resolve })
      const controller = new AbortController()
      const verifier = createLiveCertificateVerifier('wss://127.0.0.1:9443', { enabled: true, caPath: path.join(dir, 'ca.pem'), strictCertificateValidation: true }, controller.signal, () => pending)
      const result = new Promise(resolve => verifier({ hostname: '127.0.0.1', verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID', certificate: { data: cert } }, resolve))
      done('f'.repeat(64))
      expect(await result).to.equal(-2)
      const cancelled = new AbortController()
      cancelled.abort()
      const stale = createLiveCertificateVerifier('wss://127.0.0.1:9443', { enabled: false, caPath: '', strictCertificateValidation: true }, cancelled.signal)
      expect(await new Promise(resolve => stale({ hostname: '127.0.0.1', verificationResult: 'net::OK', certificate: { data: cert } }, resolve))).to.equal(-2)
    })
  })
  it('preserves normal OS trust and never extends the exception to a foreign host', async () => {
    const verifier = createLiveCertificateVerifier('wss://127.0.0.1:9443', { enabled: false, caPath: '', strictCertificateValidation: true }, new AbortController().signal)
    expect(await new Promise(resolve => verifier({ hostname: '127.0.0.1', verificationResult: 'net::OK', certificate: { data: '' } }, resolve))).to.equal(-3)
    expect(await new Promise(resolve => verifier({ hostname: 'foreign.example.test', verificationResult: 'net::OK', certificate: { data: '' } }, resolve))).to.equal(-2)
  })
})
