import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import sinon from 'sinon'
import { assertLivePrototypeMode, loadLivePrototypeConfig, parseLivePrototypeArgument, preparePrototypeProfile, validatePrototypeEvidenceDirectory } from '../../../src/main/live-prototype/config'
import { validatePrototypeGrant } from '../../../src/main/live-prototype/authority'

describe('Live prototype private configuration', () => {
  let directory: string
  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-prototype-config-test-')) })
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })
  const config = { authority_url: 'http://127.0.0.1:19000/authority', renewal_token: 'private-fixture-token', receiver_session_id: 'receiver-1' }
  const write = (value: unknown, mode = 0o600): string => {
    const file = path.join(directory, 'private.json')
    fs.writeFileSync(file, JSON.stringify(value), { mode })
    return file
  }
  it('requires one explicit configuration argument', () => {
    expect(parseLivePrototypeArgument(['electron', '.'])).to.equal(undefined)
    expect(parseLivePrototypeArgument(['--live-prototype', '/tmp/private.json'])).to.equal(path.resolve('/tmp/private.json'))
    expect(() => parseLivePrototypeArgument(['--live-prototype'])).to.throw()
    expect(() => parseLivePrototypeArgument(['--live-prototype=a', '--live-prototype=b'])).to.throw()
  })
  it('cannot enter prototype mode in QA, production or an unspecified runtime', () => {
    expect(() => assertLivePrototypeMode('dev')).not.to.throw()
    for (const mode of [undefined, 'qa', 'production', 'development']) expect(() => assertLivePrototypeMode(mode)).to.throw()
  })
  it('accepts a private loopback authority without exposing a renderer secret', () => {
    expect(loadLivePrototypeConfig(write(config))).to.deep.equal({ ...config, fallback_path: undefined })
  })
  it('rejects remote authorities, embedded credentials and unknown config keys', () => {
    for (const value of [
      { ...config, authority_url: 'http://192.168.1.5/authority' },
      { ...config, authority_url: 'http://user:secret@localhost/authority' },
      { ...config, renewal_token: 'short' },
      { ...config, fallback_url: 'https://example.test/asset.png' },
      { ...config, fallback_path: 'https://example.test/asset.png' },
    ]) expect(() => loadLivePrototypeConfig(write(value))).to.throw()
  })
  it('rejects world-readable secret files on Unix', function () {
    if (process.platform === 'win32') this.skip()
    expect(() => loadLivePrototypeConfig(write(config, 0o644))).to.throw()
  })
  it('accepts only an owned private temporary directory for optional screenshot evidence', function () {
    if (!process.getuid) this.skip()
    const evidence = path.join(directory, 'evidence')
    fs.mkdirSync(evidence, { mode: 0o700 })
    expect(loadLivePrototypeConfig(write({ ...config, evidence_dir: evidence })).evidence_dir).to.equal(fs.realpathSync(evidence))
    for (const invalid of ['relative/path', '/', os.homedir(), os.tmpdir(), '/etc/darshan', '/var/lib/darshan']) {
      expect(() => validatePrototypeEvidenceDirectory(invalid)).to.throw()
    }
    fs.chmodSync(evidence, 0o755)
    expect(() => validatePrototypeEvidenceDirectory(evidence)).to.throw()
    fs.chmodSync(evidence, 0o700)
    const link = path.join(directory, 'evidence-link')
    fs.symlinkSync(evidence, link)
    expect(() => validatePrototypeEvidenceDirectory(link)).to.throw()
  })
  it('rejects unbounded grants and insecure nonloopback signaling', () => {
    const grant = { run_id: 'run-1', admission_id: 'admission-1', presenter_identity: 'presenter-1', generation: 1,
      signal_url: 'ws://127.0.0.1:19001', ticket: 'one-use-fixture-ticket', lease_ms: 10000, window_remaining_ms: 60000 }
    expect(validatePrototypeGrant(grant).signal_url).to.equal('ws://127.0.0.1:19001')
    for (const change of [{ lease_ms: 10001 }, { generation: 0 }, { window_remaining_ms: 0 },
      { signal_url: 'ws://192.168.1.5:19001' }, { signal_url: 'wss://example.test/?token=secret' }]) {
      expect(() => validatePrototypeGrant({ ...grant, ...change })).to.throw()
    }
  })
  it('does not forward unknown authority fields or secrets through the grant boundary', () => {
    const grant = validatePrototypeGrant({ run_id: 'run-1', admission_id: 'admission-1', presenter_identity: 'presenter-1', generation: 1,
      signal_url: 'ws://127.0.0.1:19001', ticket: 'one-use-fixture-ticket', lease_ms: 10000, window_remaining_ms: 60000,
      renewal_token: 'private-fixture-value', server_secret: 'private-fixture-value' })
    expect(Object.keys(grant).sort()).to.deep.equal(['admission_id', 'generation', 'lease_ms', 'presenter_identity', 'run_id', 'signal_url', 'ticket', 'window_remaining_ms'])
  })
  it('creates a private owned profile and refuses symlinks or shared existing profiles', function () {
    if (!process.getuid) this.skip()
    const id = `profile-test-${randomUUID()}`
    const profile = path.join(fs.realpathSync(os.tmpdir()), `darshan-live-prototype-${id}`)
    try {
      expect(preparePrototypeProfile(id)).to.equal(profile)
      expect(fs.statSync(profile).mode & 0o777).to.equal(0o700)
      fs.chmodSync(profile, 0o755)
      expect(() => preparePrototypeProfile(id)).to.throw('Unsafe prototype profile')
      fs.rmdirSync(profile)
      fs.symlinkSync(directory, profile)
      expect(() => preparePrototypeProfile(id)).to.throw('Unsafe prototype profile')
      expect(() => preparePrototypeProfile('../escape')).to.throw('Invalid receiver session')
    } finally { fs.rmSync(profile, { force: true, recursive: true }) }
  })
  it('rejects an existing profile owned by another Unix user', function () {
    if (!process.getuid) this.skip()
    const id = `profile-test-${randomUUID()}`
    const profile = preparePrototypeProfile(id)
    const stat = fs.lstatSync(profile)
    const foreign = Object.create(stat, { uid: { value: process.getuid() + 1 } })
    const stub = sinon.stub(require('fs'), 'lstatSync').returns(foreign)
    try { expect(() => preparePrototypeProfile(id)).to.throw('Unsafe prototype profile') }
    finally { stub.restore(); fs.rmSync(profile, { force: true, recursive: true }) }
  })
})
