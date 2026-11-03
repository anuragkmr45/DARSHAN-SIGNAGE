const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const path = require('path')
const http = require('http')
const { randomUUID } = require('crypto')
const { createTempDir, cleanupTempDir, calculateHash } = require('../../helpers/test-utils.ts')

describe('Approved immutable cache assets', () => {
  let temp: string
  let manager: any
  let sandbox: sinon.SinonSandbox
  let server: any
  let base: string
  let requests: number
  let handler: (request: any, response: any) => void
  let sockets: Set<any>
  let old: Record<string, string | undefined>
  const owner = () => ({ publishId: randomUUID(), scheduleItemId: randomUUID() })
  const descriptor = (body: Buffer) => ({ cache_key: `live_${calculateHash(body)}_image`, sha256: calculateHash(body), size: body.length, content_type: 'image/png' })
  const outcome = (promise: Promise<any>) => promise.then(value => ({ value }), error => ({ error }))
  const reason = async (promise: Promise<any>) => (await outcome(promise)).error?.details?.reason
  const stages = () => {
    const root = manager.approvedStagingRoot(false)?.directory
    return root ? fs.readdirSync(root).filter((name: string) => name !== 'owner.json') : []
  }
  const reply = (response: any, body: Buffer) => { response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length }); response.end(body) }
  const untilRequest = () => new Promise<any>(resolve => { handler = (_request, response) => { response.writeHead(200, { 'Content-Type': 'image/png' }); response.write(Buffer.from('a')); resolve(response) } })

  beforeEach(async () => {
    sandbox = sinon.createSandbox()
    old = Object.fromEntries(['DARSHAN_PLAYER_CONFIG_FILE', 'SIGNHEX_PLAYER_CONFIG_FILE', 'HEXMON_CONFIG_PATH'].map(key => [key, process.env[key]]))
    delete process.env.DARSHAN_PLAYER_CONFIG_FILE
    delete process.env.SIGNHEX_PLAYER_CONFIG_FILE
    temp = createTempDir('approved-cache-')
    process.env.HEXMON_CONFIG_PATH = path.join(temp, 'config.json')
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify({ apiBase: 'http://127.0.0.1:1', wsUrl: 'ws://127.0.0.1:1', cache: { path: path.join(temp, 'cache'), maxBytes: 10485760, prefetchConcurrency: 2 } }))
    require('../../../src/common/config').resetConfigManager()
    const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
    manager = new CacheManager()
    requests = 0
    sockets = new Set()
    handler = (_request, response) => { response.writeHead(503); response.end() }
    server = http.createServer((request: any, response: any) => { requests += 1; handler(request, response) })
    server.on('connection', (socket: any) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}/approved.png`
  })

  afterEach(async () => {
    await manager.clear(true)
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(resolve))
    sandbox.restore()
    require('../../../src/common/config').resetConfigManager()
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    cleanupTempDir(temp)
  })

  async function seed(body: Buffer) {
    const asset = descriptor(body)
    const stub = sandbox.stub(manager, 'download').resolves(body)
    await manager.add(asset.cache_key, base, asset.sha256, { contentType: asset.content_type })
    stub.restore()
    return { asset, file: await manager.get(asset.cache_key) }
  }

  function abandonedStage(overrides: Record<string, unknown> = {}) {
    const root = manager.approvedStagingRoot(true).directory
    const id = randomUUID()
    const directory = path.join(root, id)
    fs.mkdirSync(directory, { mode: 0o700 })
    const dead = require('child_process').spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' })
    expect(dead.status).to.equal(0)
    const marker = { kind: 'DARSHAN_APPROVED_CACHE_STAGE', version: 1, stage_id: id, process_id: dead.pid, process_token: randomUUID(), created_at: Date.now() - 10 * 60_000, ...overrides }
    fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify(marker), { mode: 0o600 })
    fs.writeFileSync(path.join(directory, randomUUID() + '.part'), 'partial', { mode: 0o600 })
    return { directory, marker, root }
  }

  it('repairs corrupt bytes even when the indexed approved SHA still matches', async () => {
    const body = Buffer.from('approved')
    const { asset, file } = await seed(body)
    const first = owner()
    await manager.pinPublishedOccurrence(first, [{ cacheKey: asset.cache_key, sha256: asset.sha256 }])
    fs.writeFileSync(file, Buffer.from('corrupt!'))
    expect((await manager.pinPublishedOccurrence(first, [{ cacheKey: asset.cache_key, sha256: asset.sha256 }])).assets[0].status).to.equal('CORRUPT')
    expect(manager.entries.get(asset.cache_key).sha256).to.equal(asset.sha256)
    handler = (_request, response) => reply(response, body)
    const repaired = await manager.ensureApprovedAsset(first, asset, base)
    expect(fs.readFileSync(repaired.localPath)).to.deep.equal(body)
    expect(requests).to.equal(1)
    expect(stages()).to.deep.equal([])
    await manager.clear(false)
    expect(fs.existsSync(repaired.localPath)).to.equal(true)
    manager.releasePublishedOccurrence(first)
    await manager.clear(false)
    expect(fs.existsSync(repaired.localPath)).to.equal(false)
  })

  it('rehashes local bytes and succeeds without any remote URL', async () => {
    const body = Buffer.from('already-local')
    const { asset, file } = await seed(body)
    const first = owner(), second = owner()
    expect((await manager.ensureApprovedAsset(first, asset, undefined, { idleTimeoutMs: 1, totalTimeoutMs: 1000 })).localPath).to.equal(file)
    expect((await manager.ensureApprovedAsset(second, asset, 'http://127.0.0.1:1/unreachable', { idleTimeoutMs: 1, totalTimeoutMs: 1000 })).localPath).to.equal(file)
    manager.releasePublishedOccurrence(first)
    await manager.clear(false)
    expect(fs.existsSync(file)).to.equal(true)
    manager.releasePublishedOccurrence(second)
    await manager.clear(false)
    expect(fs.existsSync(file)).to.equal(false)
    expect(requests).to.equal(0)
  })

  it('retains old bytes on hash mismatch and leaves no ready claim or stage', async () => {
    const body = Buffer.from('approved')
    const { asset, file } = await seed(body)
    fs.writeFileSync(file, Buffer.from('corrupt!'))
    handler = (_request, response) => reply(response, Buffer.from('wrong!!!'))
    expect(await reason(manager.ensureApprovedAsset(owner(), asset, base))).to.equal('APPROVED_HASH_MISMATCH')
    expect(fs.readFileSync(file).toString()).to.equal('corrupt!')
    expect(stages()).to.deep.equal([])
    expect(manager.approvedOwners.size).to.equal(0)
    expect(manager.approvedReservedBytes).to.equal(0)
  })

  for (const mode of ['truncated', 'oversize', 'wrong-length', 'wrong-mime', 'encoded', 'redirect']) {
    it(`rejects ${mode} HTTP representation without publishing a partial asset`, async () => {
      const body = Buffer.from('approved')
      const asset = descriptor(body)
      handler = (_request, response) => {
        if (mode === 'redirect') { response.writeHead(302, { Location: base + '?redirected=true' }); response.end(); return }
        const headers: Record<string, unknown> = { 'Content-Type': mode === 'wrong-mime' ? 'text/plain' : 'image/png' }
        if (mode === 'wrong-length') headers['Content-Length'] = body.length + 1
        if (mode === 'encoded') headers['Content-Encoding'] = 'gzip'
        response.writeHead(200, headers)
        response.end(mode === 'truncated' ? body.subarray(0, 3) : mode === 'oversize' ? Buffer.concat([body, Buffer.from('!')]) : body)
      }
      const result = await outcome(manager.ensureApprovedAsset(owner(), asset, base))
      expect(result.error?.details?.reason).to.be.oneOf(['APPROVED_SIZE_MISMATCH', 'APPROVED_RESPONSE_MISMATCH', 'APPROVED_TRANSFER_FAILED'])
      expect(await manager.has(asset.cache_key)).to.equal(false)
      expect(manager.approvedOwners.size).to.equal(0)
      expect(manager.approvedReservedBytes).to.equal(0)
      expect(stages()).to.deep.equal([])
      expect(requests).to.equal(1)
    })
  }

  it('cleans active streaming work before returning caller cancellation', async () => {
    const asset = descriptor(Buffer.from('approved'))
    const received = untilRequest()
    const abort = new AbortController()
    const pending = outcome(manager.ensureApprovedAsset(owner(), asset, base, { signal: abort.signal }))
    await received
    abort.abort()
    expect((await pending).error?.details?.reason).to.equal('APPROVED_ASSET_CANCELLED')
    expect(stages()).to.deep.equal([])
    expect(manager.approvedReservedBytes).to.equal(0)
    expect(manager.approvedOwners.size).to.equal(0)
  })

  it('bounds an active stalled response with the total request deadline', async () => {
    const received = untilRequest()
    const started = Date.now()
    const pending = outcome(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base, { totalTimeoutMs: 100 }))
    await received
    expect((await pending).error?.details?.reason).to.equal('APPROVED_ASSET_CANCELLED')
    expect(Date.now() - started).to.be.lessThan(1000)
    expect(stages()).to.deep.equal([])
  })

  it('allows a steadily progressing body to take longer than its idle timeout', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      let index = 0
      const timer = setInterval(() => {
        response.write(body.subarray(index, ++index))
        if (index === body.length) { clearInterval(timer); response.end() }
      }, 30)
      response.once('close', () => clearInterval(timer))
    }
    const started = Date.now()
    const result = await manager.ensureApprovedAsset(owner(), asset, base, { idleTimeoutMs: 100, totalTimeoutMs: 1500 })
    expect(Date.now() - started).to.be.greaterThan(100)
    expect(fs.readFileSync(result.localPath)).to.deep.equal(body)
    expect(stages()).to.deep.equal([])
  })

  it('aborts genuine body inactivity independently of a generous total budget', async () => {
    const received = untilRequest()
    const pending = outcome(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base, { idleTimeoutMs: 50, totalTimeoutMs: 1500 }))
    await received
    expect((await pending).error?.details?.reason).to.equal('APPROVED_TRANSFER_IDLE')
    expect(stages()).to.deep.equal([])
    expect(manager.approvedReservedBytes).to.equal(0)
  })

  it('enforces the total budget even while body bytes keep making progress', async () => {
    const body = Buffer.alloc(100, 7), asset = descriptor(body)
    handler = (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      const timer = setInterval(() => response.write(body.subarray(0, 1)), 5)
      response.once('close', () => clearInterval(timer))
    }
    expect(await reason(manager.ensureApprovedAsset(owner(), asset, base, { idleTimeoutMs: 100, totalTimeoutMs: 80 }))).to.equal('APPROVED_ASSET_CANCELLED')
    expect(await manager.has(asset.cache_key)).to.equal(false)
    expect(stages()).to.deep.equal([])
    expect(manager.approvedOwners.size).to.equal(0)
  })

  it('rejects invalid total and idle budgets before allocating or requesting', async () => {
    const asset = descriptor(Buffer.from('approved'))
    for (const options of [{ totalTimeoutMs: 0 }, { totalTimeoutMs: 1_800_001 }, { totalTimeoutMs: 1.5 },
      { idleTimeoutMs: 0 }, { idleTimeoutMs: 30_001 }, { idleTimeoutMs: Number.NaN }]) {
      expect(await reason(manager.ensureApprovedAsset(owner(), asset, base, options))).to.equal('INVALID_APPROVED_TIMEOUT')
    }
    expect(requests).to.equal(0)
    expect(manager.approvedOwners.size).to.equal(0)
  })

  it('fences a released owner and permits a new claim with the same occurrence ID', async () => {
    const body = Buffer.from('approved')
    const asset = descriptor(body), first = owner()
    const received = untilRequest()
    const stale = outcome(manager.ensureApprovedAsset(first, asset, base))
    await received
    manager.releasePublishedOccurrence(first)
    handler = (_request, response) => reply(response, body)
    const fresh = await manager.ensureApprovedAsset(first, asset, base)
    expect((await stale).error?.details?.reason).to.equal('APPROVED_ASSET_CANCELLED')
    expect(fs.readFileSync(fresh.localPath)).to.deep.equal(body)
    await manager.clear(false)
    expect(fs.existsSync(fresh.localPath)).to.equal(true)
    expect(stages()).to.deep.equal([])
  })

  it('fences a forced purge and does not let its old cleanup remove fresh bytes', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    const received = untilRequest()
    const stale = outcome(manager.ensureApprovedAsset(owner(), asset, base))
    await received
    await manager.clear(true)
    handler = (_request, response) => reply(response, body)
    const fresh = await manager.ensureApprovedAsset(owner(), asset, base)
    expect((await stale).error?.details?.reason).to.be.oneOf(['APPROVED_ASSET_CANCELLED', 'CACHE_WRITE_INVALIDATED'])
    expect(fs.readFileSync(fresh.localPath)).to.deep.equal(body)
    expect(stages()).to.deep.equal([])
  })

  it('serializes identical repairs while preserving independent owner protection', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    const first = owner(), second = owner()
    handler = (_request, response) => reply(response, body)
    const [one, two] = await Promise.all([manager.ensureApprovedAsset(first, asset, base), manager.ensureApprovedAsset(second, asset, base)])
    expect(one.localPath).to.equal(two.localPath)
    expect(requests).to.equal(1)
    manager.releasePublishedOccurrence(first)
    await manager.clear(false)
    expect(fs.existsSync(two.localPath)).to.equal(true)
    expect((await manager.pinPublishedOccurrence(second, [{ cacheKey: asset.cache_key, sha256: asset.sha256 }])).ready).to.equal(true)
    manager.releasePublishedOccurrence(second)
    await manager.clear(false)
    expect(fs.existsSync(two.localPath)).to.equal(false)
  })

  it('cancels a queued owner promptly without interrupting the other owner transfer', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    const received = untilRequest()
    const first = manager.ensureApprovedAsset(owner(), asset, base)
    const response = await received
    const started = Date.now()
    expect(await reason(manager.ensureApprovedAsset(owner(), asset, base, { totalTimeoutMs: 25 }))).to.equal('APPROVED_ASSET_CANCELLED')
    expect(Date.now() - started).to.be.lessThan(500)
    response.end(body.subarray(1))
    expect(fs.readFileSync((await first).localPath)).to.deep.equal(body)
    expect(requests).to.equal(1)
  })

  it('reserves logical capacity during streaming and preserves unrelated now-playing bytes', async () => {
    const prior = Buffer.from('stay'), current = Buffer.from('approved')
    const seedStub = sandbox.stub(manager, 'download').resolves(prior)
    await manager.add('ordinary', base)
    manager.markNowPlaying('ordinary')
    seedStub.restore()
    manager.maxBytes = prior.length + current.length
    const received = untilRequest()
    const pending = manager.ensureApprovedAsset(owner(), descriptor(current), base)
    const response = await received
    expect(await reason(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('different')), base))).to.equal('INSUFFICIENT_SPACE')
    response.end(current.subarray(1))
    const result = await pending
    expect(fs.readFileSync(result.localPath)).to.deep.equal(current)
    expect(fs.readFileSync(await manager.get('ordinary'))).to.deep.equal(prior)
    expect((await manager.getStats()).usedBytes).to.equal(manager.maxBytes)
    expect(manager.approvedReservedBytes).to.equal(0)
  })

  it('requires physical staging capacity before making an HTTP request', async () => {
    sandbox.stub(fs.promises, 'statfs').resolves({ bavail: 0, bsize: 4096 })
    expect(await reason(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base))).to.equal('INSUFFICIENT_DISK_SPACE')
    expect(requests).to.equal(0)
    expect(manager.approvedReservedBytes).to.equal(0)
    expect(stages()).to.deep.equal([])
  })

  it('closes a rejected HTTP response that keeps sending a body', async () => {
    let closed: Promise<void> = Promise.resolve()
    handler = (_request, response) => {
      closed = new Promise(resolve => response.once('close', resolve))
      response.writeHead(503, { 'Content-Type': 'image/png' })
      response.write(Buffer.from('unavailable'))
    }
    expect(await reason(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base))).to.equal('APPROVED_TRANSFER_FAILED')
    await Promise.race([closed, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Rejected response stayed open')), 500))])
    expect(stages()).to.deep.equal([])
  })

  it('rejects conflicting descriptors without disturbing another verified owner', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    handler = (_request, response) => reply(response, body)
    const first = owner()
    const result = await manager.ensureApprovedAsset(first, asset, base)
    expect(await reason(manager.ensureApprovedAsset(owner(), { ...asset, size: asset.size + 1 }, base))).to.equal('APPROVED_DESCRIPTOR_CONFLICT')
    await manager.clear(false)
    expect(fs.readFileSync(result.localPath)).to.deep.equal(body)
    expect(manager.approvedOwners.size).to.equal(1)
    expect(requests).to.equal(1)
  })

  it('reclaims a marked dead-process stage on restart and preserves uncertain paths', () => {
    const dead = abandonedStage()
    const alive = abandonedStage({ process_id: process.pid })
    const recent = abandonedStage({ created_at: Date.now() })
    const wrongMode = abandonedStage()
    fs.chmodSync(wrongMode.directory, 0o755)
    const unknown = path.join(dead.root, 'user-material')
    fs.mkdirSync(unknown, { mode: 0o700 })
    fs.writeFileSync(path.join(unknown, 'keep.txt'), 'keep')
    const linked = path.join(dead.root, randomUUID())
    fs.symlinkSync(unknown, linked)
    const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
    new CacheManager()
    expect(fs.existsSync(dead.directory)).to.equal(false)
    for (const directory of [alive.directory, recent.directory, wrongMode.directory, unknown, linked]) expect(fs.existsSync(directory)).to.equal(true)
    expect(fs.readFileSync(path.join(unknown, 'keep.txt')).toString()).to.equal('keep')
  })

  it('bounds crash recovery removals and leaves unknown contents inside marked stages alone', () => {
    const original = abandonedStage()
    const owned = [original.directory]
    for (let index = 0; index < 23; index += 1) {
      const id = randomUUID(), directory = path.join(original.root, id)
      fs.mkdirSync(directory, { mode: 0o700 })
      fs.writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({ ...original.marker, stage_id: id }), { mode: 0o600 })
      owned.push(directory)
    }
    const unexpected = path.join(original.root, randomUUID())
    const id = path.basename(unexpected)
    fs.mkdirSync(unexpected, { mode: 0o700 })
    fs.writeFileSync(path.join(unexpected, 'owner.json'), JSON.stringify({ ...original.marker, stage_id: id }), { mode: 0o600 })
    fs.writeFileSync(path.join(unexpected, 'user-content.txt'), 'keep', { mode: 0o600 })
    const first = manager.reconcileApprovedStages()
    expect(first.removed).to.equal(20)
    expect(first.scanned).to.be.at.most(100)
    expect(owned.filter(directory => fs.existsSync(directory))).to.have.length(4)
    expect(manager.reconcileApprovedStages().removed).to.equal(4)
    expect(fs.readFileSync(path.join(unexpected, 'user-content.txt')).toString()).to.equal('keep')
  })

  it('preserves an active stage even if its marker is older than the recovery grace', async () => {
    const received = untilRequest()
    const abort = new AbortController()
    const pending = outcome(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base, { signal: abort.signal }))
    await received
    const root = manager.approvedStagingRoot(false).directory
    const stage = path.join(root, stages()[0])
    const file = path.join(stage, 'owner.json')
    const marker = JSON.parse(fs.readFileSync(file, 'utf8'))
    marker.created_at = Date.now() - 10 * 60_000
    fs.writeFileSync(file, JSON.stringify(marker))
    const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
    new CacheManager()
    expect(fs.existsSync(stage)).to.equal(true)
    abort.abort()
    expect((await pending).error?.details?.reason).to.equal('APPROVED_ASSET_CANCELLED')
    expect(stages()).to.deep.equal([])
  })

  it('reserves outstanding physical staging bytes across simultaneous downloads', async () => {
    sandbox.stub(fs.promises, 'statfs').resolves({ bavail: 12, bsize: 1 })
    const one = Buffer.from('approved'), two = Buffer.from('second!!')
    const received = untilRequest()
    const first = manager.ensureApprovedAsset(owner(), descriptor(one), base)
    const response = await received
    expect(await reason(manager.ensureApprovedAsset(owner(), descriptor(two), base + '?second'))).to.equal('INSUFFICIENT_DISK_SPACE')
    expect(requests).to.equal(1)
    response.end(one.subarray(1))
    await first
    expect(manager.approvedPhysicalReservations.size).to.equal(0)
    expect(stages()).to.deep.equal([])
  })

  it('recovers after initialization stopped before exclusive pointer publication', async () => {
    const link = sandbox.stub(fs, 'linkSync').throws(Object.assign(new Error('filesystem unavailable'), { code: 'ENOTSUP' }))
    expect(await reason(manager.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base))).to.equal('APPROVED_STAGE_PUBLISH_UNSUPPORTED')
    link.restore()
    const media = path.join(temp, 'cache', 'media')
    const unknown = path.join(media, '.approved-staging-root-' + randomUUID())
    fs.mkdirSync(unknown, { mode: 0o700 })
    const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
    const restarted = new CacheManager()
    const body = Buffer.from('approved')
    handler = (_request, response) => reply(response, body)
    const result = await restarted.ensureApprovedAsset(owner(), descriptor(body), base)
    expect(fs.readFileSync(result.localPath)).to.deep.equal(body)
    expect(fs.existsSync(unknown)).to.equal(true)
    expect(restarted.reconcileApprovedStages(Date.now() + 10 * 60_000).removed).to.equal(1)
    expect(fs.existsSync(unknown)).to.equal(true)
    expect(restarted.approvedStagingRoot(false)).to.exist
  })

  it('preserves an unknown preexisting canonical pointer without adopting or overwriting it', async () => {
    const pointer = path.join(temp, 'cache', 'media', '.approved-staging-owner.json')
    fs.writeFileSync(pointer, 'user material', { mode: 0o600 })
    const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
    const restarted = new CacheManager()
    expect(await reason(restarted.ensureApprovedAsset(owner(), descriptor(Buffer.from('approved')), base))).to.equal('APPROVED_STAGE_UNSAFE')
    await restarted.clear(false)
    expect(fs.readFileSync(pointer).toString()).to.equal('user material')
    expect(requests).to.equal(0)
  })

  it('selects a concurrent exclusive-link winner without replacing its pointer', () => {
    const originalLink = fs.linkSync
    let winner: string | undefined
    const link = sandbox.stub(fs, 'linkSync').callsFake((source: string, target: string) => {
      link.restore()
      const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
      const other = new CacheManager()
      winner = other.approvedStagingRoot(true).directory
      return originalLink(source, target)
    })
    const selected = manager.approvedStagingRoot(true)
    expect(selected.directory).to.equal(winner)
    const pointer = path.join(temp, 'cache', 'media', '.approved-staging-owner.json')
    expect(fs.statSync(pointer).ino).to.equal(fs.statSync(path.join(winner!, 'owner.json')).ino)
    expect(manager.reconcileApprovedStages(Date.now() + 10 * 60_000).removed).to.equal(1)
    expect(manager.approvedStagingRoot(false).directory).to.equal(winner)
  })

  it('excludes staging metadata from reconstructed media, ordinary clearing and cache pressure', async () => {
    const body = Buffer.from('approved'), first = owner()
    handler = (_request, response) => reply(response, body)
    await manager.ensureApprovedAsset(first, descriptor(body), base)
    const initial = manager.approvedStagingRoot(false)
    const pointer = path.join(temp, 'cache', 'media', '.approved-staging-owner.json')
    manager.releasePublishedOccurrence(first)
    manager.maxBytes = 12
    sandbox.stub(manager, 'download').resolves(Buffer.alloc(12, 1))
    await manager.add('ordinary', base)
    expect((await manager.getStats()).entryCount).to.equal(1)
    const { CacheManager } = require('../../../src/main/services/cache/cache-manager')
    const restarted = new CacheManager()
    expect((await restarted.getStats()).entryCount).to.equal(1)
    expect(await restarted.has('.approved-staging-owner')).to.equal(false)
    expect(await restarted.has('.approved-staging-owner.json')).to.equal(false)
    expect(await restarted.has('.APPROVED-STAGING-OWNER.JSON')).to.equal(false)
    expect(await reason(restarted.add('.APPROVED-STAGING-OWNER', base + '.json'))).to.equal('CACHE_INTERNAL_KEY')
    await restarted.clear(false)
    expect(fs.existsSync(pointer)).to.equal(true)
    expect(restarted.approvedStagingRoot(false).directory).to.equal(initial.directory)
    expect(fs.statSync(pointer).ino).to.equal(initial.marker.ino)
  })

  it('keeps the configured stream limit and wakes a remaining waiter after another waiter cancels', async () => {
    manager.prefetchConcurrency = 1
    const one = Buffer.from('approved'), two = Buffer.from('second!!'), three = Buffer.from('third!!!')
    const received = untilRequest()
    const first = manager.ensureApprovedAsset(owner(), descriptor(one), base)
    const response = await received
    const abort = new AbortController()
    const second = outcome(manager.ensureApprovedAsset(owner(), descriptor(two), base + '?second', { signal: abort.signal }))
    const third = manager.ensureApprovedAsset(owner(), descriptor(three), base + '?third')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(requests).to.equal(1)
    expect(manager.approvedActive).to.equal(1)
    abort.abort()
    expect((await second).error?.details?.reason).to.equal('APPROVED_ASSET_CANCELLED')
    handler = (_request, next) => reply(next, three)
    response.end(one.subarray(1))
    expect(fs.readFileSync((await first).localPath)).to.deep.equal(one)
    expect(fs.readFileSync((await third).localPath)).to.deep.equal(three)
    expect(requests).to.equal(2)
    expect(manager.approvedActive).to.equal(0)
    expect(manager.approvedWaiters.size).to.equal(0)
    expect(stages()).to.deep.equal([])
  })

  it('streams a multi-chunk body and checks its exact descriptor before publication', async () => {
    const body = Buffer.alloc(1024 * 1024, 37), asset = descriptor(body)
    handler = async (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' })
      for (let offset = 0; offset < body.length; offset += 16384) {
        if (!response.write(body.subarray(offset, offset + 16384))) await new Promise(resolve => response.once('drain', resolve))
      }
      response.end()
    }
    const result = await manager.ensureApprovedAsset(owner(), asset, base)
    expect(calculateHash(fs.readFileSync(result.localPath))).to.equal(asset.sha256)
    expect(fs.statSync(result.localPath).size).to.equal(body.length)
    expect(stages()).to.deep.equal([])
    expect(manager.approvedReservedBytes).to.equal(0)
  })

  it('does not overwrite a newer entry installed while the transfer was in flight', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    const received = untilRequest()
    const stale = outcome(manager.ensureApprovedAsset(owner(), asset, base))
    const response = await received
    const file = path.join(temp, 'cache', 'media', asset.cache_key + '.png')
    fs.writeFileSync(file, body)
    const replacement = { mediaId: asset.cache_key, localPath: file, size: body.length, sha256: asset.sha256, lastUsedAt: Date.now(), status: 'ready' }
    manager.entries.set(asset.cache_key, replacement)
    response.end(body.subarray(1))
    expect((await stale).error?.details?.reason).to.equal('APPROVED_CACHE_CHANGED')
    expect(manager.entries.get(asset.cache_key)).to.equal(replacement)
    expect(fs.readFileSync(file)).to.deep.equal(body)
    const fresh = await manager.ensureApprovedAsset(owner(), asset)
    expect(fresh.localPath).to.equal(file)
    expect(stages()).to.deep.equal([])
  })

  it('serializes legacy writers and rejects a conflicting replacement of owned approved bytes', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    const received = untilRequest()
    const first = manager.ensureApprovedAsset(owner(), asset, base)
    const response = await received
    const other = Buffer.from('different')
    sandbox.stub(manager, 'download').resolves(other)
    const conflicting = outcome(manager.add(asset.cache_key, base, calculateHash(other), { contentType: 'image/png' }))
    response.end(body.subarray(1))
    const result = await first
    expect((await conflicting).error?.details?.reason).to.equal('PINNED_REVISION_CONFLICT')
    expect(fs.readFileSync(result.localPath)).to.deep.equal(body)
  })

  it('rejects unsafe paths, wrong canonical hashes and unprepared HLS without touching user files', async () => {
    const body = Buffer.from('approved'), asset = descriptor(body)
    for (const bad of [{ ...asset, cache_key: '../escape' }, { ...asset, sha256: 'a'.repeat(64) }, { ...asset, cache_key: `live_${asset.sha256}_hls`, content_type: 'application/x-mpegurl' }]) {
      expect(await reason(manager.ensureApprovedAsset(owner(), bad, base))).to.equal('INVALID_APPROVED_ASSET')
    }
    const outside = path.join(temp, 'outside.png')
    fs.writeFileSync(outside, body)
    fs.symlinkSync(outside, path.join(temp, 'cache', 'media', asset.cache_key + '.png'))
    expect(await reason(manager.ensureApprovedAsset(owner(), asset, base))).to.equal('APPROVED_CACHE_PATH_UNSAFE')
    expect(fs.readFileSync(outside)).to.deep.equal(body)
    expect(requests).to.equal(0)
  })
})
