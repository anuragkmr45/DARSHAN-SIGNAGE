/**
 * Unit tests for Cache Manager
 */

const { expect } = require('chai')
const sinon = require('sinon')
const fs = require('fs')
const path = require('path')
const { createTempDir, cleanupTempDir, calculateHash } = require('../../helpers/test-utils.ts')

describe('Cache Manager', () => {
  let tempDir: string
  let cacheDir: string
  let sandbox: sinon.SinonSandbox
  let originalDarshanPlayerConfigFile: string | undefined
  let originalSignhexPlayerConfigFile: string | undefined

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    originalDarshanPlayerConfigFile = process.env.DARSHAN_PLAYER_CONFIG_FILE
    originalSignhexPlayerConfigFile = process.env.SIGNHEX_PLAYER_CONFIG_FILE
    delete process.env.DARSHAN_PLAYER_CONFIG_FILE
    delete process.env.SIGNHEX_PLAYER_CONFIG_FILE
    tempDir = createTempDir('cache-test-')
    cacheDir = path.join(tempDir, 'cache')
    fs.mkdirSync(cacheDir, { recursive: true })

    // Mock config
    process.env.HEXMON_CONFIG_PATH = path.join(tempDir, 'config.json')
    const testConfig = {
      apiBase: 'https://api-test.darshan.com',
      wsUrl: 'wss://api-test.darshan.com/ws',
      cache: {
        path: cacheDir,
        maxBytes: 10485760, // 10MB for testing
        prefetchConcurrency: 2,
      },
      intervals: {
        heartbeatMs: 300000,
        commandPollMs: 30000,
        schedulePollMs: 300000,
        healthCheckMs: 60000,
        screenshotMs: 300000,
      },
    }
    fs.writeFileSync(process.env.HEXMON_CONFIG_PATH, JSON.stringify(testConfig, null, 2))

    // Other Mocha specs are loaded before this hook and may initialize the
    // process-wide config singleton. Each cache test must use its own fixture.
    require('../../../src/common/config').resetConfigManager()
  })

  afterEach(() => {
    sandbox.restore()
    cleanupTempDir(tempDir)
    delete process.env.HEXMON_CONFIG_PATH

    require('../../../src/common/config').resetConfigManager()

    if (originalDarshanPlayerConfigFile === undefined) {
      delete process.env.DARSHAN_PLAYER_CONFIG_FILE
    } else {
      process.env.DARSHAN_PLAYER_CONFIG_FILE = originalDarshanPlayerConfigFile
    }
    if (originalSignhexPlayerConfigFile === undefined) {
      delete process.env.SIGNHEX_PLAYER_CONFIG_FILE
    } else {
      process.env.SIGNHEX_PLAYER_CONFIG_FILE = originalSignhexPlayerConfigFile
    }

    // Clear module cache
    delete require.cache[require.resolve('../../../src/main/services/cache/cache-manager')]
    delete require.cache[require.resolve('../../../src/common/config')]
  })

  describe('Cache Operations', () => {
    it('should add item to cache', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const mediaId = 'test-file.jpg'
      const testData = Buffer.from('test content')
      const hash = calculateHash(testData)

      // Mock download
      sandbox.stub(cacheManager, 'download' as any).resolves(testData)

      await cacheManager.add(mediaId, `https://example.com/${mediaId}`, hash)

      const exists = await cacheManager.has(mediaId)
      expect(exists).to.be.true
    })

    it('should retrieve cached item', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const mediaId = 'test-file.jpg'
      const testData = Buffer.from('test content')
      const hash = calculateHash(testData)

      // Mock download
      sandbox.stub(cacheManager, 'download' as any).resolves(testData)

      await cacheManager.add(mediaId, `https://example.com/${mediaId}`, hash)
      const filePath = await cacheManager.get(mediaId)

      expect(filePath).to.exist
      expect(fs.existsSync(filePath!)).to.be.true
    })

    it('prevents an in-flight pre-lock download from repopulating the purged cache and permits a fresh retry', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()
      let releaseStaleDownload: (value: Buffer) => void = () => undefined
      const staleDownload = new Promise<Buffer>((resolve) => {
        releaseStaleDownload = resolve
      })
      const freshData = Buffer.from('fresh-authority-content')
      const download = sandbox.stub(cacheManager, 'download' as any)
      download.onFirstCall().returns(staleDownload)
      download.onSecondCall().resolves(freshData)

      const staleWrite = cacheManager.add('secured-video', 'https://example.com/stale.mp4')
      await Promise.resolve()
      cacheManager.invalidatePendingWrites()
      await cacheManager.clear(true)
      const freshWrite = cacheManager.add('secured-video', 'https://example.com/fresh.mp4')
      releaseStaleDownload(Buffer.from('stale-content'))

      let staleError: any
      try {
        await staleWrite
      } catch (error) {
        staleError = error
      }
      await freshWrite

      expect(staleError?.details?.reason).to.equal('CACHE_WRITE_INVALIDATED')
      const cachedPath = await cacheManager.get('secured-video', 'video/mp4')
      expect(fs.readFileSync(cachedPath!)).to.deep.equal(freshData)
      expect(download.callCount).to.equal(2)
    })

    it('should name converted document cache entries from the resolved PDF content type', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()
      const data = Buffer.from('%PDF-1.7 converted document')

      sandbox.stub(cacheManager, 'download' as any).resolves(data)

      await cacheManager.add('converted-document', 'https://example.com/media/download?signature=one', undefined, {
        contentType: 'application/pdf',
      })
      const filePath = await cacheManager.get('converted-document', 'application/pdf')

      expect(filePath).to.match(/converted-document\.pdf$/)
      expect(fs.existsSync(filePath!)).to.equal(true)
    })

    it('should migrate an extensionless legacy PDF cache entry before secure local playback', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()
      const data = Buffer.from('%PDF-1.7 legacy cache')

      sandbox.stub(cacheManager, 'download' as any).resolves(data)

      await cacheManager.add('legacy-document', 'https://example.com/media/download')
      const legacyPath = await cacheManager.get('legacy-document')
      expect(legacyPath).to.not.match(/\.pdf$/)

      const normalizedPath = await cacheManager.get('legacy-document', 'application/pdf')
      expect(normalizedPath).to.match(/legacy-document\.pdf$/)
      expect(fs.existsSync(normalizedPath!)).to.equal(true)
      expect(fs.existsSync(legacyPath!)).to.equal(false)
    })

    it('should verify integrity with SHA-256', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const mediaId = 'test-file.jpg'
      const testData = Buffer.from('test content')
      const correctHash = calculateHash(testData)
      const wrongHash = 'wrong-hash-value'

      // Mock download
      sandbox.stub(cacheManager, 'download' as any).resolves(testData)

      // Should succeed with correct hash
      await cacheManager.add(mediaId, `https://example.com/${mediaId}`, correctHash)
      expect(await cacheManager.has(mediaId)).to.be.true

      // Should fail with wrong hash
      try {
        await cacheManager.add('bad-file.jpg', 'https://example.com/bad-file.jpg', wrongHash)
        expect.fail('Should have thrown integrity error')
      } catch (error: any) {
        expect(error.message).to.include('integrity')
      }
    })

    it('replaces a cached webpage preview when its checksum revision changes', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()
      const original = Buffer.from('original-preview')
      const refreshed = Buffer.from('refreshed-preview')
      sandbox.stub(cacheManager, 'download' as any)
        .onFirstCall().resolves(original)
        .onSecondCall().resolves(refreshed)

      await cacheManager.add('webpage-preview', 'https://example.com/old.png', calculateHash(original))
      const cachedPath = await cacheManager.get('webpage-preview', 'image/png')
      await cacheManager.add('webpage-preview', 'https://example.com/new.png', calculateHash(refreshed), {
        contentType: 'image/png',
      })

      expect(fs.readFileSync(cachedPath!)).to.deep.equal(refreshed)
    })

    it('retains the last successful webpage preview when replacement download fails', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()
      const original = Buffer.from('last-successful-preview')
      const download = sandbox.stub(cacheManager, 'download' as any)
      download.onFirstCall().resolves(original)
      download.onSecondCall().rejects(new Error('preview unavailable'))

      await cacheManager.add('webpage-preview', 'https://example.com/old.png', calculateHash(original), {
        contentType: 'image/png',
      })
      const cachedPath = await cacheManager.get('webpage-preview', 'image/png')

      try {
        await cacheManager.add('webpage-preview', 'https://example.com/new.png', 'f'.repeat(64), {
          contentType: 'image/png',
        })
        expect.fail('Expected replacement download to fail')
      } catch (error: any) {
        expect(error.message).to.include('preview unavailable')
      }

      expect(fs.readFileSync(cachedPath!)).to.deep.equal(original)
      expect(await cacheManager.has('webpage-preview')).to.equal(true)
    })

    it('keeps the selected webpage revision intact while caching a newer revision', async () => {
      const { buildRevisionedCacheKey, getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()
      const previous = Buffer.from('selected-preview-revision')
      const refreshed = Buffer.from('new-preview-revision')
      sandbox.stub(cacheManager, 'download' as any)
        .onFirstCall().resolves(previous)
        .onSecondCall().resolves(refreshed)

      const previousKey = buildRevisionedCacheKey('webpage-preview', 'revision-1')
      const refreshedKey = buildRevisionedCacheKey('webpage-preview', 'revision-2')
      await cacheManager.add(previousKey, 'https://example.com/old.png', calculateHash(previous), { contentType: 'image/png' })
      cacheManager.markNowPlaying(previousKey)
      await cacheManager.add(refreshedKey, 'https://example.com/new.png', calculateHash(refreshed), { contentType: 'image/png' })

      const previousPath = await cacheManager.get(previousKey, 'image/png')
      const refreshedPath = await cacheManager.get(refreshedKey, 'image/png')
      expect(previousPath).not.to.equal(refreshedPath)
      expect(fs.readFileSync(previousPath!)).to.deep.equal(previous)
      expect(fs.readFileSync(refreshedPath!)).to.deep.equal(refreshed)
    })

    it('should evict LRU items when cache is full', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      // Create files that exceed cache size
      const file1 = Buffer.alloc(6 * 1024 * 1024) // 6MB
      const file2 = Buffer.alloc(6 * 1024 * 1024) // 6MB

      sandbox.stub(cacheManager, 'download' as any)
        .onFirstCall().resolves(file1)
        .onSecondCall().resolves(file2)

      await cacheManager.add('file1.jpg', 'https://example.com/file1.jpg', calculateHash(file1))
      await cacheManager.add('file2.jpg', 'https://example.com/file2.jpg', calculateHash(file2))

      // file1 should be evicted
      const has1 = await cacheManager.has('file1.jpg')
      const has2 = await cacheManager.has('file2.jpg')

      expect(has1).to.be.false
      expect(has2).to.be.true
    })

    it('should protect now-playing content from eviction', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const file1 = Buffer.alloc(6 * 1024 * 1024)
      const file2 = Buffer.alloc(6 * 1024 * 1024)

      sandbox.stub(cacheManager, 'download' as any)
        .onFirstCall().resolves(file1)
        .onSecondCall().resolves(file2)

      await cacheManager.add('file1.jpg', 'https://example.com/file1.jpg', calculateHash(file1))
      cacheManager.markNowPlaying('file1.jpg')

      try {
        await cacheManager.add('file2.jpg', 'https://example.com/file2.jpg', calculateHash(file2))
        expect.fail('Should have refused to evict now-playing content')
      } catch (error: any) {
        expect(error.message).to.include('Cache budget exceeded')
      }

      // file1 should NOT be evicted because it's now-playing
      const has1 = await cacheManager.has('file1.jpg')
      expect(has1).to.be.true
    })
  })

  describe('Cache Statistics', () => {
    it('should track cache usage', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const testData = Buffer.alloc(1024 * 1024) // 1MB
      sandbox.stub(cacheManager, 'download' as any).resolves(testData)

      await cacheManager.add('file.jpg', 'https://example.com/file.jpg', calculateHash(testData))

      const stats = await cacheManager.getStats()
      expect(stats.usedBytes).to.be.greaterThan(0)
      expect(stats.itemCount).to.equal(1)
    })

    it('should calculate cache usage percentage', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const testData = Buffer.alloc(5 * 1024 * 1024) // 5MB (50% of 10MB)
      sandbox.stub(cacheManager, 'download' as any).resolves(testData)

      await cacheManager.add('file.jpg', 'https://example.com/file.jpg', calculateHash(testData))

      const stats = await cacheManager.getStats()
      expect(stats.usagePercent).to.be.closeTo(50, 5)
    })
  })

  describe('Cache Cleanup', () => {
    it('should clear cache', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const testData = Buffer.from('test content')
      sandbox.stub(cacheManager, 'download' as any).resolves(testData)

      await cacheManager.add('file.jpg', 'https://example.com/file.jpg', calculateHash(testData))
      await cacheManager.clear()

      const has = await cacheManager.has('file.jpg')
      expect(has).to.be.false
    })

    it('should cleanup on shutdown', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const cleanupSpy = sandbox.spy(cacheManager, 'cleanup')
      await cacheManager.cleanup()

      expect(cleanupSpy.calledOnce).to.be.true
    })
  })

  describe('Prefetch', () => {
    it('should prefetch multiple items', async () => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const cacheManager = getCacheManager()

      const items = [
        { mediaId: 'file1.jpg', url: 'https://example.com/file1.jpg', sha256: calculateHash(Buffer.from('1')) },
        { mediaId: 'file2.jpg', url: 'https://example.com/file2.jpg', sha256: calculateHash(Buffer.from('2')) },
      ]

      sandbox.stub(cacheManager, 'download' as any)
        .onFirstCall().resolves(Buffer.from('1'))
        .onSecondCall().resolves(Buffer.from('2'))

      await cacheManager.prefetch(items)

      expect(await cacheManager.has('file1.jpg')).to.be.true
      expect(await cacheManager.has('file2.jpg')).to.be.true
    })
  })

  describe('Published occurrence pins', () => {
    const owner = (index = 1) => ({ publishId: '10000000-0000-4000-8000-000000000001',
      scheduleItemId: `20000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}` })
    const asset = (cacheKey: string, data = Buffer.from('data')) => ({ cacheKey, sha256: calculateHash(data) })
    const fixture = async (keys: string[], bytes = 4) => {
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const manager = getCacheManager()
      const data = Buffer.alloc(bytes, 7)
      sandbox.stub(manager, 'download').resolves(data)
      for (const key of keys) await manager.add(key, `https://example.com/${key}.png`, calculateHash(data))
      return { manager, data }
    }

    it('protects the union of published pins and now-playing content during eviction', async () => {
      const { manager, data } = await fixture(['a', 'b', 'c'])
      manager.maxBytes = 12
      manager.entries.get('a').lastUsedAt = 1
      manager.entries.get('b').lastUsedAt = 2
      manager.entries.get('c').lastUsedAt = 3
      expect((await manager.pinPublishedOccurrence(owner(), [asset('a', data)])).ready).to.equal(true)
      manager.markNowPlaying('b')
      await manager.add('d', 'https://example.com/d.png', calculateHash(data))
      expect(await manager.has('a')).to.equal(true)
      expect(await manager.has('b')).to.equal(true)
      expect(await manager.has('c')).to.equal(false)
      expect(await manager.has('d')).to.equal(true)
      manager.replaceNowPlaying([])
      await manager.clear(false)
      expect(await manager.has('a')).to.equal(true)
      expect(await manager.has('b')).to.equal(false)
    })

    it('releasing one owner preserves other owners and now-playing protection', async () => {
      const { manager, data } = await fixture(['shared'])
      await manager.pinPublishedOccurrence(owner(1), [asset('shared', data)])
      await manager.pinPublishedOccurrence(owner(2), [asset('shared', data)])
      manager.releasePublishedOccurrence(owner(1))
      await manager.clear(false)
      expect(await manager.has('shared')).to.equal(true)
      manager.markNowPlaying('shared')
      manager.releasePublishedOccurrence(owner(2))
      await manager.clear(false)
      expect(await manager.has('shared')).to.equal(true)
      manager.unmarkNowPlaying('shared')
      await manager.clear(false)
      expect(await manager.has('shared')).to.equal(false)
    })

    it('claims protection before async verification and ordinary clear can run', async () => {
      const { manager, data } = await fixture(['fallback'])
      const pending = manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])
      await manager.clear(false)
      const readiness = await pending
      expect(readiness.ready).to.equal(true)
      expect(readiness.assets[0].localPath).to.be.a('string')
      expect(await manager.has('fallback')).to.equal(true)
    })

    it('rechecks stale eviction candidates after a pin is claimed mid-eviction', async () => {
      const { manager, data } = await fixture(['a', 'b', 'c'])
      manager.maxBytes = 12
      manager.entries.get('a').lastUsedAt = 1
      manager.entries.get('b').lastUsedAt = 2
      manager.entries.get('c').lastUsedAt = 3
      let reached: () => void = () => undefined
      let release: () => void = () => undefined
      const removedFirst = new Promise<void>(resolve => { reached = resolve })
      const continueEviction = new Promise<void>(resolve => { release = resolve })
      const original = manager.removeEntry.bind(manager)
      sandbox.stub(manager, 'removeEntry').callsFake(async (entry: any) => {
        await original(entry)
        if (entry.mediaId === 'a') { reached(); await continueEviction }
      })
      manager.download.resolves(Buffer.alloc(8, 7))
      const adding = manager.add('d', 'https://example.com/d.png')
      await removedFirst
      const pinning = manager.pinPublishedOccurrence(owner(), [asset('b', data)])
      release()
      await Promise.all([adding, pinning])
      expect(await manager.has('b')).to.equal(true)
      expect(await manager.has('c')).to.equal(false)
      expect(await manager.has('d')).to.equal(true)
    })

    it('does not persist missing/corrupt pins or substitute an older cached revision', async () => {
      const { manager, data } = await fixture(['revision.__revision__.old', 'corrupt'])
      const corruptPath = await manager.get('corrupt')
      fs.writeFileSync(corruptPath, Buffer.from('bad!'))
      const readiness = await manager.pinPublishedOccurrence(owner(), [asset('revision.__revision__.new', data), asset('corrupt', data)])
      expect(readiness.ready).to.equal(false)
      expect(readiness.assets.map((result: any) => result.status)).to.deep.equal(['MISSING', 'CORRUPT'])
      await manager.clear(false)
      expect(await manager.has('corrupt')).to.equal(false)
      expect(await manager.has('revision.__revision__.old')).to.equal(false)
      // Failed owners leave no immutable/empty-owner residue.
      await manager.add('repaired', 'https://example.com/repaired.png', calculateHash(data))
      expect((await manager.pinPublishedOccurrence(owner(), [asset('repaired', data)])).ready).to.equal(true)
    })

    it('release or forced security purge cancels pending validation without resurrecting pins', async () => {
      const { manager, data } = await fixture(['fallback'])
      const released = manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])
      manager.releasePublishedOccurrence(owner())
      expect((await released).assets[0].status).to.equal('CANCELLED')
      manager.markNowPlaying('fallback')
      const purged = manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])
      await manager.clear(true)
      expect((await purged).ready).to.equal(false)
      await manager.add('fallback', 'https://example.com/fallback.png', calculateHash(data))
      await manager.clear(false)
      expect(await manager.has('fallback')).to.equal(false)
    })

    it('ignores a released verification failure after a fresh owner claim succeeds', async () => {
      const { manager, data } = await fixture(['fallback'])
      let failOldStat: (error: Error) => void = () => undefined
      const delayed = new Promise<never>((_resolve, reject) => { failOldStat = reject })
      sandbox.stub(fs.promises, 'lstat').callThrough().onFirstCall().returns(delayed)
      const stale = manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])
      manager.releasePublishedOccurrence(owner())
      expect((await manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])).ready).to.equal(true)
      failOldStat(Object.assign(new Error('old file lookup failed'), { code: 'ENOENT' }))
      expect((await stale).assets[0].status).to.equal('CANCELLED')
      await manager.clear(false)
      expect(await manager.has('fallback')).to.equal(true)
    })

    it('reports insufficient capacity rather than evicting every approved fallback asset', async () => {
      const { manager, data } = await fixture(['fallback'])
      manager.maxBytes = data.length
      expect((await manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])).ready).to.equal(true)
      let failure: any
      try { await manager.add('new', 'https://example.com/new.png', calculateHash(data)) }
      catch (error) { failure = error }
      expect(failure?.details?.reason).to.equal('INSUFFICIENT_SPACE')
      expect(await manager.has('new')).to.equal(false)
      expect(fs.readFileSync(await manager.get('fallback'))).to.deep.equal(data)
    })

    it('rejects an on-disk symlink even when its target has the approved checksum', async () => {
      const { manager, data } = await fixture(['fallback'])
      const localPath = await manager.get('fallback')
      const outside = path.join(tempDir, 'outside.png')
      fs.writeFileSync(outside, data)
      fs.unlinkSync(localPath)
      fs.symlinkSync(outside, localPath)
      const readiness = await manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])
      expect(readiness.ready).to.equal(false)
      expect(readiness.assets[0].status).to.equal('UNREADABLE')
      await manager.clear(false)
      expect(fs.readFileSync(outside)).to.deep.equal(data)
      expect(fs.existsSync(localPath)).to.equal(false)
    })

    it('rejects changes to a pinned checksum without evicting or replacing its approved bytes', async () => {
      const { manager, data } = await fixture(['fallback'])
      await manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])
      const localPath = await manager.get('fallback')
      manager.download.resolves(Buffer.from('replacement'))
      let failure: any
      try { await manager.add('fallback', 'https://example.com/replacement.png', calculateHash(Buffer.from('replacement'))) }
      catch (error) { failure = error }
      expect(failure?.details?.reason).to.equal('PINNED_REVISION_CONFLICT')
      expect(fs.readFileSync(localPath)).to.deep.equal(data)
      expect(() => manager.pinPublishedOccurrence(owner(2), [asset('fallback', Buffer.from('different'))])).to.throw()
    })

    it('deduplicates identical claims and rejects conflicting or unsafe inputs without truncation', async () => {
      const { manager, data } = await fixture(['fallback'])
      const first = manager.pinPublishedOccurrence(owner(), [asset('fallback', data), asset('fallback', data)])
      expect(manager.pinPublishedOccurrence(owner(), [asset('fallback', data)])).to.equal(first)
      expect((await first).assets).to.have.length(1)
      for (const assets of [[], [{ cacheKey: '../escape', sha256: calculateHash(data) }],
        [{ cacheKey: 'fallback', sha256: 'unknown' }], [asset('fallback', data), asset('fallback', Buffer.from('different'))]]) {
        expect(() => manager.pinPublishedOccurrence(owner(3), assets)).to.throw()
      }
      expect(() => manager.pinPublishedOccurrence({ publishId: 'not-a-publish', scheduleItemId: 'not-an-item' }, [asset('fallback', data)])).to.throw()
      expect(() => manager.pinPublishedOccurrence(owner(), [asset('different', data)])).to.throw()
    })

    it('verifies all 257 approved assets instead of imposing a new presentation item cap', async () => {
      const data = Buffer.from('fixture')
      const media = path.join(cacheDir, 'media')
      fs.mkdirSync(media, { recursive: true })
      const assets = Array.from({ length: 257 }, (_, index) => asset(`asset-${index}`, data))
      for (const item of assets) fs.writeFileSync(path.join(media, `${item.cacheKey}.png`), data)
      const { getCacheManager } = require('../../../src/main/services/cache/cache-manager')
      const manager = getCacheManager()
      const readiness = await manager.pinPublishedOccurrence(owner(), assets)
      expect(readiness.ready).to.equal(true)
      expect(readiness.assets).to.have.length(257)
      await manager.clear(false)
      expect((await manager.getStats()).entryCount).to.equal(257)
    })

    it('bounds retained owners and clears empty owners after missing-asset verification', async () => {
      const { manager, data } = await fixture([])
      const pending = Array.from({ length: 64 }, (_, index) => manager.pinPublishedOccurrence(owner(index + 1), [asset('missing', data)]))
      expect(() => manager.pinPublishedOccurrence(owner(65), [asset('missing', data)])).to.throw()
      expect((await Promise.all(pending)).every((result: any) => !result.ready)).to.equal(true)
      expect((await manager.pinPublishedOccurrence(owner(65), [asset('missing', data)])).ready).to.equal(false)
    })
  })
})
