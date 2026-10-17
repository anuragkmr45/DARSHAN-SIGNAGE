import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { getConfigManager } from '../../../common/config'
import { getLogger } from '../../../common/logger'
import { CacheEntry, CacheStats, CacheError } from '../../../common/types'
import { atomicWrite, calculateBufferHash, ensureDir, sanitizeFilename } from '../../../common/utils'
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

export class CacheManager {
  private cacheDir: string
  private maxBytes: number
  private prefetchConcurrency: number
  private entries = new Map<string, CacheEntry>()
  private nowPlaying = new Set<string>()
  private inFlight = new Map<string, Promise<void>>()
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
      .filter((entry) => !this.nowPlaying.has(entry.mediaId))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    for (const entry of candidates) {
      if (available >= sizeNeeded) {
        break
      }
      await this.removeEntry(entry)
      available = this.maxBytes - this.getUsedBytes()
    }

    if (available < sizeNeeded) {
      logger.warn(
        { sizeNeeded, available, protected: Array.from(this.nowPlaying) },
        'Not enough space to evict without touching now-playing items'
      )
      return false
    }

    return true
  }

  private async removeEntry(entry: CacheEntry): Promise<void> {
    if (fs.existsSync(entry.localPath)) {
      fs.unlinkSync(entry.localPath)
    }
    this.entries.delete(entry.mediaId)
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
      await existingInFlight
      const cached = this.entries.get(mediaId)
      if (!sha256 || cached?.sha256 === sha256) {
        return
      }
    }

    const operation = this.addInternal(mediaId, url, sha256, context)
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
    context: CacheAddContext = {}
  ): Promise<void> {
    try {
      const data = await this.download(url)
      const hash = calculateBufferHash(data)

      if (sha256 && hash !== sha256) {
        throw new CacheError('Cache item failed integrity validation', { expected: sha256, actual: hash })
      }

      const canStore = await this.evictIfNeeded(data.length)
      if (!canStore) {
        throw new CacheError('Cache budget exceeded and protected items prevented eviction', {
          reason: 'INSUFFICIENT_SPACE',
          mediaId,
          sizeNeeded: data.length,
        })
      }

      const filePath = this.getFilePath(mediaId, url, context.contentType)
      await atomicWrite(filePath, data)

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

  async clear(force: boolean = false): Promise<void> {
    if (force) {
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true })
      }
      ensureDir(this.cacheDir)
      this.entries.clear()
      this.nowPlaying.clear()
      return
    }

    for (const [mediaId, entry] of this.entries) {
      if (this.nowPlaying.has(mediaId)) {
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
