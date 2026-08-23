const { expect } = require('chai')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  createTransportHttpsAgent,
  loadTransportCertificateAuthority,
} = require('../../../src/main/services/network/transport-tls')

describe('transport TLS trust', () => {
  it('uses Node trust defaults when private transport trust is disabled', () => {
    const config = { enabled: false, caPath: '', strictCertificateValidation: true }
    expect(loadTransportCertificateAuthority(config)).to.equal(undefined)
    expect(createTransportHttpsAgent(config)).to.equal(undefined)
  })

  it('loads the configured CA and keeps certificate validation enabled', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-transport-tls-'))
    const caPath = path.join(directory, 'transport-ca.crt')
    fs.writeFileSync(caPath, 'test-ca')
    const config = { enabled: true, caPath, strictCertificateValidation: true }

    expect(loadTransportCertificateAuthority(config).toString()).to.equal('test-ca')
    const agent = createTransportHttpsAgent(config)
    expect(agent.options.rejectUnauthorized).to.equal(true)
    expect(agent.options.ca.toString()).to.equal('test-ca')
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('fails closed when enabled CA material cannot be read', () => {
    expect(() =>
      loadTransportCertificateAuthority({
        enabled: true,
        caPath: '/missing/transport-ca.crt',
        strictCertificateValidation: true,
      })
    ).to.throw(/Unable to read transport TLS CA/)
  })
})
