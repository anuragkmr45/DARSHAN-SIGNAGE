import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { capturePrototypeEvidence } from '../../../src/main/live-prototype/evidence'

describe('Live prototype private pixel evidence', () => {
  let directory: string
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmWQAAAAASUVORK5CYII=', 'base64')
  beforeEach(function () {
    if (!process.getuid) this.skip()
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'darshan-live-evidence-test-'))
    fs.chmodSync(directory, 0o700)
  })
  afterEach(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }) })

  it('writes unique private PNG artifacts without overwriting existing files', async () => {
    const first = await capturePrototypeEvidence(directory, 'first-frame', async () => png, () => true)
    const second = await capturePrototypeEvidence(directory, 'fallback', async () => png, () => true)
    expect(first).not.to.equal(second)
    expect(path.basename(first!)).to.match(/^\d+-first-frame-[a-f0-9-]+\.png$/)
    expect(fs.readFileSync(first!).equals(png)).to.equal(true)
    expect(fs.statSync(first!).mode & 0o777).to.equal(0o600)
    expect(fs.readdirSync(directory)).to.have.length(2)
  })

  it('does not capture unless opted in or save a superseded surface', async () => {
    let captured = false
    await capturePrototypeEvidence(undefined, 'fallback', async () => { captured = true; return png }, () => true)
    expect(captured).to.equal(false)
    let current = true
    const result = await capturePrototypeEvidence(directory, 'first-frame', async () => { current = false; return png }, () => current)
    expect(result).to.equal(undefined)
    expect(fs.readdirSync(directory)).to.deep.equal([])
  })

  it('rejects invalid capture bytes and a directory whose privacy changed', async () => {
    let invalid = false
    try { await capturePrototypeEvidence(directory, 'first-frame', async () => Buffer.from('not pixels'), () => true) } catch { invalid = true }
    expect(invalid).to.equal(true)
    fs.chmodSync(directory, 0o755)
    let denied = false
    try { await capturePrototypeEvidence(directory, 'fallback', async () => png, () => true) } catch { denied = true }
    expect(denied).to.equal(true)
    expect(fs.readdirSync(directory)).to.deep.equal([])
  })

  it('cannot use an arbitrary event string as an output path', async () => {
    let denied = false
    try { await capturePrototypeEvidence(directory, '../unsafe' as 'first-frame', async () => png, () => true) } catch { denied = true }
    expect(denied).to.equal(true)
    expect(fs.readdirSync(directory)).to.deep.equal([])
  })
})
