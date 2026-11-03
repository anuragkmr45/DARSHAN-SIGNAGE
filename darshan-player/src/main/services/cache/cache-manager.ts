import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { getConfigManager } from '../../../common/config'
import { getLogger } from '../../../common/logger'
import { CacheEntry, CacheStats, CacheError } from '../../../common/types'
import { atomicWrite, calculateBufferHash, calculateFileHash, ensureDir, sanitizeFilename } from '../../../common/utils'
import { reportMediaCacheFailure, type MediaCacheReportSource } from '../media-cache-reporter'
import { createTransportHttpsAgent } from '../network/transport-tls'

const logger = getLogger('cache-manager')

interface PrefetchItem {
  mediaId: string
  url: string
  sha256?: string
  contentType?: string
  source?: MediaCacheReportSource
  snapshotId?: string
  scheduleId?: string
  defaultMediaVersion?: string
  playbackMode?: 'normal' | 'emergency' | 'default' | 'offline' | 'empty'
}

export interface CacheAddContext {
  contentType?: string
  source?: MediaCacheReportSource
  snapshotId?: string
  scheduleId?: string
  defaultMediaVersion?: string
  playbackMode?: 'normal' | 'emergency' | 'default' | 'offline' | 'empty'
}

const CACHE_REVISION_SEPARATOR = '.__revision__.'

/**
 * Keep content revisions as distinct cache entries. This lets a player finish
 * using the selected revision while a newer webpage preview downloads.
 */
export function buildRevisionedCacheKey(mediaId: string, revision?: string | null): string {
  const normalized = revision?.trim()
  return normalized ? `${mediaId}${CACHE_REVISION_SEPARATOR}${normalized}` : mediaId
}

export type ResolvedCacheEntry = {
  cacheKey: string
  localPath: string
}

export type PublishedCachePinOwner = { publishId: string; scheduleItemId: string }
export type CachePinAsset = { cacheKey: string; sha256: string }
export type CachePinAssetReadiness = {
  cacheKey: string
  status: 'READY' | 'MISSING' | 'CORRUPT' | 'UNREADABLE' | 'CHANGED' | 'CANCELLED'
  localPath?: string
}
export type CachePinReadiness = { ready: boolean; assets: CachePinAssetReadiness[] }
type CachePinOwnerState = {
  assets: CachePinAsset[]
  fingerprint: string
  protectedKeys: Set<string>
  pending?: Promise<CachePinReadiness>
}
// Internal leak guard, not a presentation/asset limit. The live coordinator
// needs only the current and next published occurrence and must release owners.
const MAX_CACHE_PIN_OWNERS = 64
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export class CacheManager {
  private cacheDir: string
  private maxBytes: number
  private prefetchConcurrency: number
  private entries = new Map<string, CacheEntry>()
  private nowPlaying = new Set<string>()
  private publishedPins = new Map<string, CachePinOwnerState>()
  private inFlight = new Map<string, Promise<void>>()
  private writeGeneration = 0
  private httpsAgent: ReturnType<typeof createTransportHttpsAgent>

  constructor() {
    const config = getConfigManager().getConfig()
    this.cacheDir = path.join(config.cache.path, 'media')
    this.maxBytes = config.cache.maxBytes
    this.prefetchConcurrency = Math.max(1, config.cache.prefetchConcurrency)
    this.httpsAgent = createTransportHttpsAgent(config.transportTls)

    ensureDir(this.cacheDir)
    this.loadExistingEntries()

    logger.info({ cacheDir: this.cacheDir, maxBytes: this.maxBytes }, 'Cache manager initialized')
  }

  /**
   * Load any existing files from disk into the in-memory index.
   */
  private loadExistingEntries(): void {
    if (!fs.existsSync(this.cacheDir)) {
      return
    }

    const files = fs.readdirSync(this.cacheDir)
    for (const file of files) {
      const filePath = path.join(this.cacheDir, file)
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        continue
      }

      const mediaId = file.split('.').slice(0, -1).join('.') || file
      const entry: CacheEntry = {
        mediaId,
        sha256: '',
        size: stats.size,
        lastUsedAt: stats.mtimeMs,
        localPath: filePath,
        status: 'ready',
      }
      this.entries.set(mediaId, entry)
    }
  }

  private getFilePath(mediaId: string, url?: string, contentType?: string): string {
    const safeId = sanitizeFilename(mediaId)
    const ext = this.getContentTypeExtension(contentType) || this.getFileExtension(url)
    return path.join(this.cacheDir, `${safeId}${ext}`)
  }

  private getContentTypeExtension(contentType?: string): string {
    const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
    if (normalized === 'application/pdf') return '.pdf'
    if (normalized === 'image/jpeg') return '.jpg'
    if (normalized === 'image/png') return '.png'
    if (normalized === 'image/webp') return '.webp'
    if (normalized === 'video/mp4') return '.mp4'
    if (normalized === 'video/quicktime') return '.mov'
    return ''
  }

  private getFileExtension(url?: string): string {
    if (!url) {
      return ''
    }

    try {
      const parsed = new URL(url)
      const ext = path.extname(parsed.pathname)
      return ext || ''
    } catch {
      const ext = path.extname(url)
      return ext || ''
    }
  }

  private getUsedBytes(): number {
    let total = 0
    for (const entry of this.entries.values()) {
      total += entry.size
    }
    return total
  }

  private async evictIfNeeded(sizeNeeded: number): Promise<boolean> {
    if (sizeNeeded > this.maxBytes && this.maxBytes > 0) {
      logger.warn({ sizeNeeded, maxBytes: this.maxBytes }, 'Item exceeds cache capacity, skipping eviction')
      return false
    }

    let available = this.maxBytes - this.getUsedBytes()
    if (available >= sizeNeeded) {
      return true
    }

    const candidates = Array.from(this.entries.values())
      .filter((entry) => !this.isProtected(entry.mediaId))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    for (const entry of candidates) {
      if (available >= sizeNeeded) {
        break
      }
      // A pin can be claimed while an earlier removal's Promise yields. Never
      // rely only on the candidate list assembled before that claim.
      if (!this.isProtected(entry.mediaId)) await this.removeEntry(entry)
      available = this.maxBytes - this.getUsedBytes()
    }

    if (available < sizeNeeded) {
      logger.warn(
        { sizeNeeded, available, protected: Array.from(this.nowPlaying) },
        'Not enough space to evict without touching protected content'
      )
      return false
    }

    return true
  }

  private async removeEntry(entry: CacheEntry): Promise<void> {
    if (this.entries.get(entry.mediaId) !== entry || this.isProtected(entry.mediaId)) return
    if (fs.existsSync(entry.localPath)) {
      fs.unlinkSync(entry.localPath)
    }
    this.entries.delete(entry.mediaId)
    this.prunePinKey(entry.mediaId)
  }

  private async download(url: string): Promise<Buffer> {
    try {
      const response = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        ...(this.httpsAgent ? { httpsAgent: this.httpsAgent } : {}),
      })
      return Buffer.from(response.data)
    } catch (error: any) {
      const status = error?.response?.status
      logger.error({ url, status, error }, 'Failed to download cache item')

      if (status === 401 || status === 403) {
        throw new CacheError('Presigned URL expired', { url, status, reason: 'URL_EXPIRED' })
      }

      throw new CacheError('Failed to download cache item', { url, status })
    }
  }

  async add(mediaId: string, url: string, sha256?: string, context: CacheAddContext = {}): Promise<void> {
    if (await this.has(mediaId)) {
      const cached = this.entries.get(mediaId)
      if (!sha256 || cached?.sha256 === sha256) {
        return
      }
    }

    const existingInFlight = this.inFlight.get(mediaId)
    if (existingInFlight) {
      try {
        await existingInFlight
      } catch (error) {
        if (!(error instanceof CacheError) || error.details?.['reason'] !== 'CACHE_WRITE_INVALIDATED') {
          throw error
        }
      }
      const cached = this.entries.get(mediaId)
      if (cached && await this.has(mediaId) && (!sha256 || cached.sha256 === sha256)) {
        return
      }
    }

    const operation = this.addInternal(mediaId, url, sha256, context, this.writeGeneration)
    this.inFlight.set(mediaId, operation)

    try {
      await operation
    } finally {
      this.inFlight.delete(mediaId)
    }
  }

  private async addInternal(
    mediaId: string,
    url: string,
    sha256?: string,
    context: CacheAddContext = {},
    writeGeneration: number = this.writeGeneration
  ): Promise<void> {
    try {
      const data = await this.download(url)
      this.assertWriteGeneration(writeGeneration, mediaId)
      const hash = calculateBufferHash(data)

      if (sha256 && hash !== sha256) {
        throw new CacheError('Cache item failed integrity validation', { expected: sha256, actual: hash })
      }
      this.assertPinnedHash(mediaId, hash)

      const canStore = await this.evictIfNeeded(data.length)
      if (!canStore) {
        throw new CacheError('Cache budget exceeded and protected items prevented eviction', {
          reason: 'INSUFFICIENT_SPACE',
          mediaId,
          sizeNeeded: data.length,
        })
      }
      this.assertWriteGeneration(writeGeneration, mediaId)

      const filePath = this.getFilePath(mediaId, url, context.contentType)
      this.assertPinnedHash(mediaId, hash)
      // atomicWrite currently writes/renames synchronously before its Promise
      // yields. The pin/hash check and publication therefore cannot interleave.
      await atomicWrite(filePath, data)
      if (writeGeneration !== this.writeGeneration) {
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true })
        }
        this.assertWriteGeneration(writeGeneration, mediaId)
      }

      const entry: CacheEntry = {
        mediaId,
        sha256: sha256 || hash,
        size: data.length,
        lastUsedAt: Date.now(),
        localPath: filePath,
        status: 'ready',
      }

      this.entries.set(mediaId, entry)
      logger.info({ mediaId, size: data.length }, 'Cached item added')
    } catch (error) {
      if (error instanceof CacheError && error.details?.['reason'] === 'CACHE_WRITE_INVALIDATED') {
        logger.info({ mediaId }, 'Discarded cache write invalidated by playback security lock')
        throw error
      }
      void reportMediaCacheFailure({
        mediaId,
        url,
        error,
        source: context.source || 'CACHE',
        snapshotId: context.snapshotId,
        scheduleId: context.scheduleId,
        defaultMediaVersion: context.defaultMediaVersion,
        playbackMode: context.playbackMode,
      })
      throw error
    }
  }

  private assertWriteGeneration(writeGeneration: number, mediaId: string): void {
    if (writeGeneration !== this.writeGeneration) {
      throw new CacheError('Cache write invalidated by playback security lock', {
        reason: 'CACHE_WRITE_INVALIDATED',
        mediaId,
      })
    }
  }

  invalidatePendingWrites(): void {
    this.writeGeneration += 1
  }

  async has(mediaId: string): Promise<boolean> {
    const entry = this.entries.get(mediaId)
    if (entry && fs.existsSync(entry.localPath)) {
      entry.lastUsedAt = Date.now()
      return true
    }

    const safeId = sanitizeFilename(mediaId)
    const files = fs.existsSync(this.cacheDir) ? fs.readdirSync(this.cacheDir) : []
    const match = files.find((file) => file === safeId || file.startsWith(`${safeId}.`))
    if (match) {
      const filePath = path.join(this.cacheDir, match)
      const stats = fs.statSync(filePath)
      this.entries.set(mediaId, {
        mediaId,
        sha256: '',
        size: stats.size,
        lastUsedAt: Date.now(),
        localPath: filePath,
        status: 'ready',
      })
      return true
    }

    this.entries.delete(mediaId)
    this.prunePinKey(mediaId)
    return false
  }

  async get(mediaId: string, contentType?: string): Promise<string | undefined> {
    const exists = await this.has(mediaId)
    if (!exists) {
      return undefined
    }

    const entry = this.entries.get(mediaId)
    if (!entry) return undefined

    const preferredExtension = this.getContentTypeExtension(contentType)
    if (!preferredExtension || entry.localPath.toLowerCase().endsWith(preferredExtension)) {
      return entry.localPath
    }

    const normalizedPath = path.join(this.cacheDir, `${sanitizeFilename(mediaId)}${preferredExtension}`)
    try {
      if (fs.existsSync(normalizedPath)) {
        if (entry.localPath !== normalizedPath && fs.existsSync(entry.localPath)) {
          fs.unlinkSync(entry.localPath)
        }
      } else {
        await fs.promises.rename(entry.localPath, normalizedPath)
      }
      entry.localPath = normalizedPath
      return normalizedPath
    } catch (error) {
      logger.warn({ mediaId, localPath: entry.localPath, normalizedPath, error }, 'Failed to normalize cached media extension')
      return entry.localPath
    }
  }

  async resolveRevisioned(
    mediaId: string,
    revision?: string | null,
    contentType?: string
  ): Promise<ResolvedCacheEntry | undefined> {
    const requestedKey = buildRevisionedCacheKey(mediaId, revision)
    const requestedPath = await this.get(requestedKey, contentType)
    if (requestedPath) return { cacheKey: requestedKey, localPath: requestedPath }

    if (revision) {
      const prefix = `${mediaId}${CACHE_REVISION_SEPARATOR}`
      const candidates = Array.from(this.entries.values())
        .filter((entry) => entry.mediaId.startsWith(prefix))
        .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
      for (const candidate of candidates) {
        const candidatePath = await this.get(candidate.mediaId, contentType)
        if (candidatePath) return { cacheKey: candidate.mediaId, localPath: candidatePath }
      }

      // Compatibility for caches populated before revision-aware keys existed.
      const legacyPath = await this.get(mediaId, contentType)
      if (legacyPath) return { cacheKey: mediaId, localPath: legacyPath }
    }

    return undefined
  }

  async prefetch(items: PrefetchItem[]): Promise<void> {
    if (items.length === 0) {
      return
    }

    const concurrency = Math.max(1, this.prefetchConcurrency)
    let index = 0

    const worker = async (): Promise<void> => {
      while (true) {
        const currentIndex = index
        if (currentIndex >= items.length) {
          break
        }
        index += 1

        const current = items[currentIndex]
        if (!current) {
          break
        }

        try {
          await this.add(current.mediaId, current.url, current.sha256, {
            contentType: current.contentType,
            source: current.source || 'PREFETCH',
            snapshotId: current.snapshotId,
            scheduleId: current.scheduleId,
            defaultMediaVersion: current.defaultMediaVersion,
            playbackMode: current.playbackMode,
          })
        } catch (error) {
          logger.warn({ mediaId: current.mediaId, error }, 'Failed to prefetch item')
        }
      }
    }

    const workers: Promise<void>[] = []
    for (let i = 0; i < concurrency; i++) {
      workers.push(worker())
    }

    await Promise.all(workers)
  }

  markNowPlaying(mediaId: string): void {
    this.nowPlaying.add(mediaId)
  }

  unmarkNowPlaying(mediaId: string): void {
    this.nowPlaying.delete(mediaId)
  }

  replaceNowPlaying(mediaIds: string[]): void {
    this.nowPlaying = new Set(mediaIds.filter(Boolean))
  }

  private pinOwnerKey(owner: PublishedCachePinOwner): string {
    if (!owner || typeof owner.publishId !== 'string' || typeof owner.scheduleItemId !== 'string' ||
        !UUID.test(owner.publishId) || !UUID.test(owner.scheduleItemId)) {
      throw new CacheError('Invalid published cache pin owner', { reason: 'INVALID_PIN_OWNER' })
    }
    return `${owner.publishId.toLowerCase()}:${owner.scheduleItemId.toLowerCase()}`
  }

  private normalizePinAssets(assets: CachePinAsset[]): CachePinAsset[] {
    if (!Array.isArray(assets) || assets.length === 0) throw new CacheError('Cache pins require exact local assets', { reason: 'INVALID_PIN_ASSET' })
    const unique = new Map<string, CachePinAsset>()
    for (const asset of assets) {
      if (!asset || typeof asset.cacheKey !== 'string' || !asset.cacheKey || asset.cacheKey.length > 255 ||
          asset.cacheKey === '.' || asset.cacheKey === '..' || sanitizeFilename(asset.cacheKey) !== asset.cacheKey ||
          typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
        throw new CacheError('Invalid exact cache pin asset', { reason: 'INVALID_PIN_ASSET' })
      }
      const normalized = { cacheKey: asset.cacheKey, sha256: asset.sha256.toLowerCase() }
      if (unique.has(asset.cacheKey) && unique.get(asset.cacheKey)!.sha256 !== normalized.sha256) {
        throw new CacheError('Conflicting checksums for one cache key', { reason: 'PIN_ASSET_HASH_CONFLICT' })
      }
      unique.set(asset.cacheKey, normalized)
    }
    return [...unique.values()]
  }

  private isPinned(cacheKey: string): boolean {
    return [...this.publishedPins.values()].some(owner => owner.protectedKeys.has(cacheKey))
  }

  private isProtected(cacheKey: string): boolean {
    return this.nowPlaying.has(cacheKey) || this.isPinned(cacheKey)
  }

  private assertPinnedHash(cacheKey: string, sha256: string): void {
    for (const owner of this.publishedPins.values()) {
      if (owner.protectedKeys.has(cacheKey) && owner.assets.find(asset => asset.cacheKey === cacheKey)?.sha256 !== sha256) {
        throw new CacheError('Pinned content requires its approved checksum', { reason: 'PINNED_REVISION_CONFLICT', cacheKey })
      }
    }
  }

  private prunePinKey(cacheKey: string): void {
    for (const [key, owner] of this.publishedPins) {
      owner.protectedKeys.delete(cacheKey)
      if (!owner.pending && owner.protectedKeys.size === 0) this.publishedPins.delete(key)
    }
  }

  /**
   * Claim protection synchronously, then verify every exact local asset with
   * streamed SHA-256. The result never substitutes a URL or older revision.
   */
  pinPublishedOccurrence(owner: PublishedCachePinOwner, assets: CachePinAsset[]): Promise<CachePinReadiness> {
    const key = this.pinOwnerKey(owner)
    const normalized = this.normalizePinAssets(assets)
    const fingerprint = JSON.stringify([...normalized].sort((a, b) => a.cacheKey.localeCompare(b.cacheKey)))
    const previous = this.publishedPins.get(key)
    if (previous && previous.fingerprint !== fingerprint) {
      throw new CacheError('Published occurrence pin assets are immutable until released', { reason: 'PIN_OWNER_ASSETS_CHANGED' })
    }
    if (previous?.pending) return previous.pending
    if (!previous && this.publishedPins.size >= MAX_CACHE_PIN_OWNERS) {
      throw new CacheError('Release inactive published cache pin owners before adding another', { reason: 'PIN_OWNER_LIMIT' })
    }
    for (const asset of normalized) this.assertPinnedHash(asset.cacheKey, asset.sha256)
    const state: CachePinOwnerState = previous ?? { assets: normalized, fingerprint, protectedKeys: new Set<string>() }
    state.protectedKeys = new Set(normalized.map(asset => asset.cacheKey))
    this.publishedPins.set(key, state)
    const operation = this.verifyPinOwner(key, state).finally(() => {
      if (state.pending === operation) state.pending = undefined
      if (this.publishedPins.get(key) === state && state.protectedKeys.size === 0) this.publishedPins.delete(key)
    })
    state.pending = operation
    return operation
  }

  releasePublishedOccurrence(owner: PublishedCachePinOwner): void {
    this.publishedPins.delete(this.pinOwnerKey(owner))
  }

  private async verifyPinOwner(key: string, state: CachePinOwnerState): Promise<CachePinReadiness> {
    const assets: CachePinAssetReadiness[] = new Array(state.assets.length)
    let index = 0
    const worker = async (): Promise<void> => {
      while (index < state.assets.length) {
        const current = index++
        const asset = state.assets[current]!
        assets[current] = this.publishedPins.get(key) === state
          ? await this.verifyPinAsset(key, state, asset)
          : { cacheKey: asset.cacheKey, status: 'CANCELLED' }
      }
    }
    // Follow the existing prefetch concurrency policy; never impose a smaller
    // asset-count limit than valid presentations, or open one stream per item.
    await Promise.all(Array.from({ length: Math.min(state.assets.length, this.prefetchConcurrency, 10) }, () => worker()))
    if (this.publishedPins.get(key) !== state) {
      return { ready: false, assets: state.assets.map(asset => ({ cacheKey: asset.cacheKey, status: 'CANCELLED' })) }
    }
    state.protectedKeys = new Set(assets.filter(asset => asset.status === 'READY').map(asset => asset.cacheKey))
    return { ready: assets.every(asset => asset.status === 'READY'), assets }
  }

  private async verifyPinAsset(key: string, owner: CachePinOwnerState, asset: CachePinAsset): Promise<CachePinAssetReadiness> {
    const result = (status: CachePinAssetReadiness['status']): CachePinAssetReadiness => ({ cacheKey: asset.cacheKey, status })
    const entry = this.entries.get(asset.cacheKey)
    if (!entry) return result('MISSING')
    try {
      const before = await fs.promises.lstat(entry.localPath)
      const relative = path.relative(await fs.promises.realpath(this.cacheDir), await fs.promises.realpath(entry.localPath))
      if (!before.isFile() || before.isSymbolicLink() || !relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return result('UNREADABLE')
      const checksum = await calculateFileHash(entry.localPath)
      const after = await fs.promises.lstat(entry.localPath)
      if (this.publishedPins.get(key) !== owner) return result('CANCELLED')
      if (this.entries.get(asset.cacheKey) !== entry || before.dev !== after.dev || before.ino !== after.ino ||
          before.size !== after.size || before.mtimeMs !== after.mtimeMs || after.isSymbolicLink()) return result('CHANGED')
      if (checksum !== asset.sha256) { this.prunePinKey(asset.cacheKey); return result('CORRUPT') }
      entry.lastUsedAt = Date.now()
      return { cacheKey: asset.cacheKey, status: 'READY', localPath: entry.localPath }
    } catch (error) {
      // A released/cleared owner's late I/O error must not unpin a new claim
      // for the same occurrence or a newly downloaded replacement entry.
      if (this.publishedPins.get(key) === owner && this.entries.get(asset.cacheKey) === entry) {
        this.prunePinKey(asset.cacheKey)
      }
      return result((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'MISSING' : 'UNREADABLE')
    }
  }

  async clear(force: boolean = false): Promise<void> {
    if (force) {
      this.publishedPins.clear()
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true })
      }
      ensureDir(this.cacheDir)
      this.entries.clear()
      this.nowPlaying.clear()
      return
    }

    for (const [mediaId, entry] of this.entries) {
      if (this.isProtected(mediaId)) {
        continue
      }

      if (fs.existsSync(entry.localPath)) {
        fs.unlinkSync(entry.localPath)
      }
      this.entries.delete(mediaId)
    }
  }

  async getStats(): Promise<CacheStats & { usagePercent: number; itemCount: number }> {
    let usedBytes = 0
    let quarantinedCount = 0

    for (const entry of this.entries.values()) {
      usedBytes += entry.size
      if (entry.status === 'quarantined') {
        quarantinedCount++
      }
    }

    const totalBytes = this.maxBytes
    const freeBytes = Math.max(0, totalBytes - usedBytes)
    const entryCount = this.entries.size
    const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0

    return {
      totalBytes,
      usedBytes,
      freeBytes,
      entryCount,
      quarantinedCount,
      usagePercent,
      itemCount: entryCount,
    }
  }

  async cleanup(): Promise<void> {
    await this.clear(false)
  }
}

let cacheManager: CacheManager | null = null

export function getCacheManager(): CacheManager {
  if (!cacheManager) {
    cacheManager = new CacheManager()
  }
  return cacheManager
}
