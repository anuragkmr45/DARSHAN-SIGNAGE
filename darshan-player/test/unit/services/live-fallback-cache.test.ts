const { expect } = require('chai')
const { createHash } = require('crypto')
const fs = require('fs')
const path = require('path')
const sinon = require('sinon')
const { createTempDir, cleanupTempDir } = require('../../helpers/test-utils')
const { LIVE_IDS, liveFixture } = require('../../helpers/live-fixtures')
const { readLiveOccurrence } = require('../../../src/common/live-playback')
const { LiveFallbackCache, hashLiveFallbackAssetSet } = require('../../../src/main/services/live-fallback-cache')

describe('Exact LIVE fallback adapter', () => {
  let dir, fixture, occurrence, cache, service
  beforeEach(() => {
    dir = createTempDir('live-fallback-adapter-')
    fixture = liveFixture()
    occurrence = readLiveOccurrence(fixture.item, { publishId: LIVE_IDS.publish, scheduleId: LIVE_IDS.schedule, deviceId: LIVE_IDS.device })
    cache = { pinPublishedOccurrence: sinon.stub().callsFake(async (_owner, assets) => {
      const rows = assets.map(asset => {
        const localPath = path.join(dir, asset.cacheKey)
        const valid = fs.existsSync(localPath) && createHash('sha256').update(fs.readFileSync(localPath)).digest('hex') === asset.sha256
        return { ...asset, ready: valid, ...(valid ? { localPath } : {}) }
      })
      return { ready: rows.every(asset => asset.ready), assets: rows }
    }), ensureApprovedAsset: sinon.stub().callsFake(async (_owner, asset) => { fs.writeFileSync(path.join(dir, asset.cache_key), fixture.bytes) }), releasePublishedOccurrence: sinon.spy() }
    service = new LiveFallbackCache(cache, 2)
  })
  afterEach(() => cleanupTempDir(dir))
  it('repairs corrupt same-size bytes and reports the business media ID with the immutable cache key', async () => {
    fs.writeFileSync(path.join(dir, fixture.asset.cache_key), Buffer.alloc(fixture.bytes.length, 'x'))
    const result = await service.prepare(occurrence)
    expect(result.ready).to.equal(true)
    expect(cache.ensureApprovedAsset.calledOnce).to.equal(true)
    expect(result.items[0].mediaId).to.equal(LIVE_IDS.media)
    expect(result.items[0].meta.cache_key).to.equal(fixture.asset.cache_key)
    expect(result.items[0].remoteUrl).to.equal(undefined)
    expect(result.proof.ready).to.equal(true)
  })
  it('accepts verified local bytes with no remotely available URL', async () => {
    fs.writeFileSync(path.join(dir, fixture.asset.cache_key), fixture.bytes)
    occurrence.downloads = []
    expect((await service.prepare(occurrence)).ready).to.equal(true)
    expect(cache.ensureApprovedAsset.called).to.equal(false)
  })
  it('does not reuse initial readiness after approved bytes become corrupt on disk', async () => {
    fs.writeFileSync(path.join(dir, fixture.asset.cache_key), fixture.bytes)
    expect((await service.prepare(occurrence, { download: false })).ready).to.equal(true)
    fs.writeFileSync(path.join(dir, fixture.asset.cache_key), Buffer.alloc(fixture.bytes.length, 'x'))
    const rechecked = await service.prepare(occurrence, { download: false })
    expect(rechecked.ready).to.equal(false)
    expect(rechecked.proof).to.equal(undefined)
    expect(rechecked.items).to.deep.equal([])
  })
  it('rejects exact SHA bytes whose approved size does not match', async () => {
    fs.writeFileSync(path.join(dir, fixture.asset.cache_key), fixture.bytes)
    occurrence.policy.fallback.manifest.assets[0].size += 1
    expect((await service.prepare(occurrence, { download: false })).ready).to.equal(false)
  })
  it('withholds readiness for any unavailable dependency and never releases another lifecycle claim on failure', async () => {
    const dependency = { ...fixture.asset, id: LIVE_IDS.source, cache_key: `live_${'b'.repeat(64)}_image`, sha256: 'b'.repeat(64) }
    occurrence.policy.fallback.manifest.assets.push(dependency)
    occurrence.policy.fallback.manifest.assets[0].dependencies = [dependency.id]
    cache.ensureApprovedAsset.rejects(new Error('Network unavailable'))
    expect((await service.prepare(occurrence)).ready).to.equal(false)
    expect(cache.releasePublishedOccurrence.called).to.equal(false)
  })
  it('cancels without creating a partial readiness proof', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await service.prepare(occurrence, { signal: controller.signal })
    expect(result.ready).to.equal(false)
    expect(result.proof).to.equal(undefined)
    expect(cache.ensureApprovedAsset.called).to.equal(false)
  })
  it('keeps content-deduplicated aliases in canonical evidence without requiring duplicate cache files', async () => {
    const asset = occurrence.policy.fallback.manifest.assets[0]
    occurrence.policy.fallback.manifest.assets.push({ ...asset, id: LIVE_IDS.source })
    fs.writeFileSync(path.join(dir, fixture.asset.cache_key), fixture.bytes)
    // The real cache pins a union of keys, not duplicate byte copies.
    cache.pinPublishedOccurrence.callsFake(async () => ({ ready: true, assets: [{ cacheKey: asset.cache_key, sha256: asset.sha256, ready: true, localPath: path.join(dir, asset.cache_key) }] }))
    expect((await service.prepare(occurrence)).ready).to.equal(true)
    const expected = createHash('sha256').update(JSON.stringify([
      { asset_id: asset.id, cache_key: asset.cache_key, sha256: asset.sha256, size: asset.size, content_type: asset.content_type },
      { asset_id: LIVE_IDS.source, cache_key: asset.cache_key, sha256: asset.sha256, size: asset.size, content_type: asset.content_type },
    ])).digest('hex')
    expect(hashLiveFallbackAssetSet(occurrence.policy.fallback.manifest.assets)).to.equal(expected)
    expect(hashLiveFallbackAssetSet([...occurrence.policy.fallback.manifest.assets].reverse())).to.equal(expected)
  })
})
