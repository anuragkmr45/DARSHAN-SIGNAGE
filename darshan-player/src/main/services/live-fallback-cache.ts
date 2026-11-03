import { createHash } from 'crypto'
import { pathToFileURL } from 'url'
import * as fs from 'fs'
import type { LiveFallbackAsset, LiveOccurrence } from '../../common/live-playback'
import type { TimelineItem } from '../../common/types'
import { getCacheManager, type CacheManager, type CachePinReadiness, type PublishedCachePinOwner } from './cache/cache-manager'

export type LiveFallbackReadinessProof = { preparation_id: string; source_fingerprint: string; asset_set_sha256: string; ready: true }
export type PreparedLiveFallback = { ready: boolean; items: TimelineItem[]; reason?: string; proof?: LiveFallbackReadinessProof }

/** Wire-identical to Backend hashLiveFallbackAssetSet; includes dependencies. */
export function hashLiveFallbackAssetSet(assets: ReadonlyArray<Pick<LiveFallbackAsset, 'id' | 'cache_key' | 'sha256' | 'size' | 'content_type'>>): string {
  const rows = [...assets].sort((a, b) => a.id.toLowerCase() < b.id.toLowerCase() ? -1 : a.id.toLowerCase() > b.id.toLowerCase() ? 1 : 0)
    .map(asset => ({ asset_id: asset.id.toLowerCase(), cache_key: asset.cache_key, sha256: asset.sha256, size: asset.size, content_type: asset.content_type }))
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex')
}
export function liveCacheOwner(occurrence: Pick<LiveOccurrence, 'publishId' | 'itemId'>): PublishedCachePinOwner {
  return { publishId: occurrence.publishId, scheduleItemId: occurrence.itemId }
}

/** Caller owns occurrence lifetime. A late failed preparation never releases a
 * fresh claim with the same owner IDs; only the lifecycle coordinator releases. */
export class LiveFallbackCache {
  constructor(private readonly cache: CacheManager = getCacheManager(), private readonly concurrency = 2) {}

  async prepare(occurrence: LiveOccurrence, options: { signal?: AbortSignal; download?: boolean } = {}): Promise<PreparedLiveFallback> {
    if (!occurrence.policy || occurrence.invalidReason) return { ready: false, items: [], reason: 'INVALID_LIVE_FALLBACK' }
    const owner = liveCacheOwner(occurrence)
    const manifest = occurrence.policy.fallback.manifest
    const assets = manifest.assets.map(asset => ({ cacheKey: asset.cache_key, sha256: asset.sha256 }))
    try {
      if (options.signal?.aborted) return { ready: false, items: [], reason: 'FALLBACK_CANCELLED' }
      let readiness = await this.cache.pinPublishedOccurrence(owner, assets)
      let exact = await this.exactSizes(occurrence, readiness)
      if (!exact && options.download !== false) {
        const byId = new Map(occurrence.downloads.map(download => [download.asset_id, download]))
        let index = 0
        const worker = async (): Promise<void> => {
          while (index < manifest.assets.length && !options.signal?.aborted) {
            const asset = manifest.assets[index++]!
            try {
              await this.cache.ensureApprovedAsset(owner, asset, byId.get(asset.id)?.url, { signal: options.signal })
            } catch {
              // Keep collecting exact readiness. A failed remote fetch cannot
              // substitute source bytes or silently authorize a partial graph.
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(manifest.assets.length, Math.max(1, Math.min(10, this.concurrency))) }, () => worker()))
        readiness = await this.cache.pinPublishedOccurrence(owner, assets)
        exact = await this.exactSizes(occurrence, readiness)
      }
      if (options.signal?.aborted || !exact) return { ready: false, items: [], reason: options.signal?.aborted ? 'FALLBACK_CANCELLED' : 'FALLBACK_NOT_READY' }
      return { ready: true, items: this.timeline(occurrence, readiness), proof: {
        preparation_id: occurrence.policy.fallback.preparation_id,
        source_fingerprint: occurrence.policy.fallback.source_fingerprint,
        asset_set_sha256: hashLiveFallbackAssetSet(manifest.assets), ready: true,
      } }
    } catch { return { ready: false, items: [], reason: 'FALLBACK_NOT_READY' } }
  }

  release(occurrence: Pick<LiveOccurrence, 'publishId' | 'itemId'>): void {
    this.cache.releasePublishedOccurrence(liveCacheOwner(occurrence))
  }

  private async exactSizes(occurrence: LiveOccurrence, readiness: CachePinReadiness): Promise<boolean> {
    if (!readiness.ready) return false
    const expected = new Map<string, number>()
    for (const asset of occurrence.policy!.fallback.manifest.assets) {
      if (expected.has(asset.cache_key) && expected.get(asset.cache_key) !== asset.size) return false
      expected.set(asset.cache_key, asset.size)
    }
    for (const asset of readiness.assets) {
      if (!asset.localPath) return false
      const stat = await fs.promises.lstat(asset.localPath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.get(asset.cacheKey)) return false
    }
    return readiness.assets.length === expected.size
  }

  private timeline(occurrence: LiveOccurrence, readiness: CachePinReadiness): TimelineItem[] {
    const policy = occurrence.policy!
    const manifest = policy.fallback.manifest
    const byId = new Map(manifest.assets.map(asset => [asset.id, asset]))
    const local = new Map(readiness.assets.map(asset => [asset.cacheKey, asset.localPath]))
    return [...manifest.presentation.items].sort((a, b) => a.order - b.order).map(entry => {
      const asset = byId.get(entry.asset_id)!, localPath = local.get(asset.cache_key)
      if (!localPath) throw new Error('Exact fallback dependency unavailable')
      const duration = (entry.duration_seconds ?? 10) * 1000
      if (!Number.isSafeInteger(duration) || duration < 1) throw new Error('Invalid approved fallback duration')
      return {
        id: entry.id, mediaId: asset.media_id, type: asset.render_type, localPath,
        localUrl: pathToFileURL(localPath).toString(), sha256: asset.sha256,
        displayMs: duration, fit: entry.fit_mode ?? 'contain', muted: entry.audio_enabled !== true,
        loop: entry.loop_enabled === true, transitionDurationMs: 0,
        ...(asset.render_type === 'pdf' ? { pageNumber: entry.page_number ?? 1 } : {}),
        meta: { source: 'schedule', liveFallback: true, cache_key: asset.cache_key, content_type: asset.content_type,
          presentationId: manifest.presentation.id, ...(entry.slot_id ? { slotId: entry.slot_id } : {}) },
      }
    })
  }
}
