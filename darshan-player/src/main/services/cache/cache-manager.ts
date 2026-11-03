import axios from 'axios'
import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { performance } from 'perf_hooks'
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
 * using the selected revision while a newer media object downloads.
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
/** Exact immutable descriptor from an approved live fallback manifest. */
export type ApprovedCacheAsset = { cache_key: string; sha256: string; size: number; content_type: string }
type ApprovedCacheOwner = {
  assets: Map<string, ApprovedCacheAsset>
  ready: Set<string>
  requests: Map<AbortController, string>
}
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
const APPROVED_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  'application/pdf': '.pdf',
}
const APPROVED_PROCESS_TOKEN = randomUUID()
const ACTIVE_APPROVED_STAGES = new Map<string, string>()
const ACTIVE_APPROVED_ROOTS = new Map<string, string>()
const APPROVED_ROOT_POINTER = '.approved-staging-owner.json'
const APPROVED_ROOT_PREFIX = '.approved-staging-root-'
const STAGE_GRACE_MS = 5 * 60_000
type ApprovedStageMarker = { kind: 'DARSHAN_APPROVED_CACHE_STAGE'; version: 1; stage_id: string; process_id: number; process_token: string; created_at: number }
type ApprovedRootMarker = Omit<ApprovedStageMarker, 'kind' | 'stage_id'> & { kind: 'DARSHAN_APPROVED_CACHE_STAGE_ROOT'; root_id: string }

export class CacheManager {
  private cacheDir: string
  private maxBytes: number
  private prefetchConcurrency: number
  private entries = new Map<string, CacheEntry>()
  private nowPlaying = new Set<string>()
  private publishedPins = new Map<string, CachePinOwnerState>()
  private inFlight = new Map<string, Promise<void>>()
  private approvedOwners = new Map<string, ApprovedCacheOwner>()
  private approvedReservedBytes = 0
  private approvedActive = 0
  private approvedWaiters = new Map<symbol, () => void>()
  private approvedPhysicalReservations = new Map<symbol, { size: number; written: () => number }>()
  private approvedRootCandidates = new Set<string>()
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
    this.reconcileApprovedStages()

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
      if (file.toLowerCase().startsWith(APPROVED_ROOT_PREFIX)) { this.approvedRootCandidates.add(file); continue }
      if (file.toLowerCase() === APPROVED_ROOT_POINTER) continue
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

    const required = (): number => sizeNeeded + this.approvedReservedBytes
    let available = this.maxBytes - this.getUsedBytes()
    if (available >= required()) {
      return true
    }

    const candidates = Array.from(this.entries.values())
      .filter((entry) => !this.isProtected(entry.mediaId))
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    for (const entry of candidates) {
      if (available >= required()) {
        break
      }
      // A pin can be claimed while an earlier removal's Promise yields. Never
      // rely only on the candidate list assembled before that claim.
      if (!this.isProtected(entry.mediaId)) await this.removeEntry(entry)
      available = this.maxBytes - this.getUsedBytes()
    }

    if (available < required()) {
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
    if (this.approvedInternalName(mediaId)) throw this.approvedError('CACHE_INTERNAL_KEY')
    const generation = this.writeGeneration
    await this.mutateKey(mediaId, async () => {
      this.assertWriteGeneration(generation, mediaId)
      if (await this.has(mediaId)) {
        const cached = this.entries.get(mediaId)
        if (!sha256 || cached?.sha256 === sha256) return
      }
      await this.addInternal(mediaId, url, sha256, context, generation)
    })
  }

  /** Serialize publication/renames for one key, including legacy writers. */
  private async mutateKey<T>(cacheKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.inFlight.get(cacheKey)
    const operation = previous ? previous.then(work, work) : work()
    const barrier = operation.then(() => undefined, () => undefined)
    this.inFlight.set(cacheKey, barrier)
    try { return await operation }
    finally { if (this.inFlight.get(cacheKey) === barrier) this.inFlight.delete(cacheKey) }
  }

  private approvedError(reason: string, cacheKey?: string): CacheError {
    return new CacheError('Approved cache asset unavailable', { reason, ...(cacheKey ? { cacheKey } : {}) })
  }

  private privateOwned(stat: fs.Stats, directory: boolean): boolean {
    return !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()) &&
      (!process.getuid || (stat.uid === process.getuid() && (stat.mode & 0o777) === (directory ? 0o700 : 0o600)))
  }

  private sameInode(left: fs.Stats, right: fs.Stats): boolean { return left.dev === right.dev && left.ino === right.ino }

  private writeStageMarker(file: string, value: object): void {
    const fd = fs.openSync(file, 'wx', 0o600)
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd) }
    finally { fs.closeSync(fd) }
  }

  private syncApprovedDirectory(directory: string): void {
    // Windows does not expose POSIX directory fsync; the marker file itself is
    // flushed before the NTFS hard-link publication, which remains exclusive.
    if (process.platform === 'win32') return
    const fd = fs.openSync(directory, fs.constants.O_RDONLY)
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  }

  private readStageMarker(file: string): { value: Record<string, unknown>; stat: fs.Stats } {
    const before = fs.lstatSync(file)
    if (!this.privateOwned(before, false) || before.size > 2048) throw this.approvedError('APPROVED_STAGE_UNSAFE')
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    try {
      const opened = fs.fstatSync(fd)
      if (!this.sameInode(before, opened) || opened.size > 2048) throw this.approvedError('APPROVED_STAGE_UNSAFE')
      const bytes = Buffer.alloc(2049)
      const length = fs.readSync(fd, bytes, 0, bytes.length, 0)
      if (length > 2048 || fs.fstatSync(fd).size !== opened.size) throw this.approvedError('APPROVED_STAGE_UNSAFE')
      const value = JSON.parse(bytes.subarray(0, length).toString('utf8')) as Record<string, unknown>
      const after = fs.lstatSync(file)
      if (!value || typeof value !== 'object' || Array.isArray(value) || !this.sameInode(opened, after) || after.isSymbolicLink() || after.size !== opened.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw this.approvedError('APPROVED_STAGE_UNSAFE')
      return { value, stat: after }
    } finally { fs.closeSync(fd) }
  }

  private approvedInternalName(name: string): boolean {
    const normalized = name.toLowerCase()
    return normalized === APPROVED_ROOT_POINTER || normalized === APPROVED_ROOT_POINTER.slice(0, -5) || normalized.startsWith(APPROVED_ROOT_PREFIX)
  }

  private rootMarker(value: Record<string, unknown>): ApprovedRootMarker {
    const marker = value as unknown as ApprovedRootMarker
    if (Object.keys(value).length !== 6 || marker.kind !== 'DARSHAN_APPROVED_CACHE_STAGE_ROOT' || marker.version !== 1 ||
        !UUID.test(marker.root_id) || !UUID.test(marker.process_token) || !Number.isSafeInteger(marker.process_id) || marker.process_id < 1 ||
        !Number.isFinite(marker.created_at) || marker.created_at < 0) throw this.approvedError('APPROVED_STAGE_UNSAFE')
    return marker
  }

  private inactiveApprovedProcess(marker: Pick<ApprovedStageMarker, 'process_id' | 'process_token'>, directory: string, id: string, active: Map<string, string>): boolean {
    if (marker.process_id === process.pid && marker.process_token === APPROVED_PROCESS_TOKEN) return active.get(directory) !== id
    try { process.kill(marker.process_id, 0); return false }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
  }

  private approvedStagingRoot(create: boolean): { directory: string; stat: fs.Stats; marker: fs.Stats } | undefined {
    const cache = fs.lstatSync(this.cacheDir)
    if (!cache.isDirectory() || cache.isSymbolicLink() || (process.getuid && (cache.uid !== process.getuid() || (cache.mode & 0o022) !== 0))) throw this.approvedError('APPROVED_STAGE_UNSAFE')
    const pointer = path.join(this.cacheDir, APPROVED_ROOT_POINTER)
    const read = (): { directory: string; stat: fs.Stats; marker: fs.Stats } | undefined => {
      let published: ReturnType<CacheManager['readStageMarker']>
      try { published = this.readStageMarker(pointer) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw this.approvedError('APPROVED_STAGE_UNSAFE') }
      const expected = this.rootMarker(published.value)
      const directory = path.join(this.cacheDir, APPROVED_ROOT_PREFIX + expected.root_id)
      const stat = fs.lstatSync(directory)
      const marker = this.readStageMarker(path.join(directory, 'owner.json'))
      if (!this.privateOwned(stat, true) || !this.sameInode(published.stat, marker.stat) || JSON.stringify(published.value) !== JSON.stringify(marker.value)) throw this.approvedError('APPROVED_STAGE_UNSAFE')
      return { directory, stat, marker: marker.stat }
    }
    const existing = read()
    if (existing || !create) return existing
    const id = randomUUID()
    const name = APPROVED_ROOT_PREFIX + id
    const directory = path.join(this.cacheDir, name)
    fs.mkdirSync(directory, { mode: 0o700 })
    this.approvedRootCandidates.add(name)
    ACTIVE_APPROVED_ROOTS.set(directory, id)
    try {
      const file = path.join(directory, 'owner.json')
      this.writeStageMarker(file, { kind: 'DARSHAN_APPROVED_CACHE_STAGE_ROOT', version: 1, root_id: id,
        process_id: process.pid, process_token: APPROVED_PROCESS_TOKEN, created_at: Date.now() } satisfies ApprovedRootMarker)
      this.syncApprovedDirectory(directory)
      this.syncApprovedDirectory(this.cacheDir)
      // File hard-link creation publishes exclusively on Linux and NTFS. A
      // directory rename could overwrite an unknown empty directory on POSIX.
      try { fs.linkSync(file, pointer) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw this.approvedError('APPROVED_STAGE_PUBLISH_UNSUPPORTED')
      }
      this.syncApprovedDirectory(this.cacheDir)
      const winner = read()
      if (!winner) throw this.approvedError('APPROVED_STAGE_UNSAFE')
      return winner
    } finally { ACTIVE_APPROVED_ROOTS.delete(directory) }
  }

  private reconcileApprovedRoots(nowMs: number, result: { scanned: number; removed: number; preserved: number }): void {
    for (const name of this.approvedRootCandidates) {
      if (result.scanned >= 100 || result.removed >= 20) break
      result.scanned += 1
      const candidate = path.join(this.cacheDir, name)
      try {
        const stat = fs.lstatSync(candidate)
        if (!this.privateOwned(stat, true)) throw new Error()
        const record = this.readStageMarker(path.join(candidate, 'owner.json'))
        const marker = this.rootMarker(record.value)
        if (name !== APPROVED_ROOT_PREFIX + marker.root_id && !new RegExp(`^${APPROVED_ROOT_PREFIX}${marker.root_id}\\.reap-[a-f0-9-]{36}$`).test(name)) throw new Error()
        const canonical = path.join(this.cacheDir, APPROVED_ROOT_POINTER)
        let pointer: fs.Stats | undefined
        try { pointer = fs.lstatSync(canonical) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        if (pointer && this.sameInode(pointer, record.stat)) continue
        if (nowMs - marker.created_at < STAGE_GRACE_MS || !this.inactiveApprovedProcess(marker, candidate, marker.root_id, ACTIVE_APPROVED_ROOTS)) throw new Error()
        const children = fs.opendirSync(candidate)
        try { if (children.readSync()?.name !== 'owner.json' || children.readSync()) throw new Error() } finally { children.closeSync() }
        const after = this.readStageMarker(path.join(candidate, 'owner.json'))
        if (!this.sameInode(stat, fs.lstatSync(candidate)) || !this.sameInode(record.stat, after.stat) || JSON.stringify(record.value) !== JSON.stringify(after.value)) throw new Error()
        try { if (this.sameInode(fs.lstatSync(canonical), after.stat)) continue } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const quarantineName = APPROVED_ROOT_PREFIX + marker.root_id + '.reap-' + randomUUID()
        const quarantine = path.join(this.cacheDir, quarantineName)
        fs.renameSync(candidate, quarantine)
        this.approvedRootCandidates.delete(name)
        this.approvedRootCandidates.add(quarantineName)
        if (!this.sameInode(stat, fs.lstatSync(quarantine)) || !this.sameInode(record.stat, this.readStageMarker(path.join(quarantine, 'owner.json')).stat)) throw new Error()
        fs.rmSync(quarantine, { recursive: true })
        this.approvedRootCandidates.delete(quarantineName)
        result.removed += 1
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.approvedRootCandidates.delete(name)
        else result.preserved += 1
      }
    }
  }

  /** Bounded crash recovery; unknown, live, unmarked or changed paths survive. */
  reconcileApprovedStages(nowMs = Date.now()): { scanned: number; removed: number; preserved: number } {
    const result = { scanned: 0, removed: 0, preserved: 0 }
    this.reconcileApprovedRoots(nowMs, result)
    let root: ReturnType<CacheManager['approvedStagingRoot']>
    try { root = this.approvedStagingRoot(false) } catch { return result }
    if (!root) return result
    let stream: fs.Dir
    try { stream = fs.opendirSync(root.directory) } catch { return result }
    try {
      let entry: fs.Dirent | null
      while (result.scanned < 100 && result.removed < 20 && (entry = stream.readSync())) {
        result.scanned += 1
        if (entry.name === 'owner.json') continue
        const stage = path.join(root.directory, entry.name)
        try {
          const stat = fs.lstatSync(stage)
          if (!this.privateOwned(stat, true)) throw new Error()
          const { value, stat: markerStat } = this.readStageMarker(path.join(stage, 'owner.json'))
          const marker = value as unknown as ApprovedStageMarker
          if (Object.keys(value).length !== 6 || marker.kind !== 'DARSHAN_APPROVED_CACHE_STAGE' || marker.version !== 1 ||
              !UUID.test(marker.stage_id) || !UUID.test(marker.process_token) ||
              !Number.isSafeInteger(marker.process_id) || marker.process_id < 1 ||
              !Number.isFinite(marker.created_at) || nowMs - marker.created_at < STAGE_GRACE_MS ||
              (entry.name !== marker.stage_id && !new RegExp(`^\\.reap-${marker.stage_id}-[a-f0-9-]{36}$`).test(entry.name))) throw new Error()
          if (!this.inactiveApprovedProcess(marker, stage, marker.stage_id, ACTIVE_APPROVED_STAGES)) throw new Error()
          // A service stage contains one marker and at most one regular .part.
          // Unexpected files/directories are never recursively removed.
          const children = fs.opendirSync(stage)
          try {
            let child: fs.Dirent | null, count = 0
            while ((child = children.readSync())) {
              count += 1
              if (count > 2 || (child.name !== 'owner.json' && !/^[a-f0-9-]{36}\.part$/.test(child.name)) ||
                  !this.privateOwned(fs.lstatSync(path.join(stage, child.name)), false)) throw new Error()
            }
          } finally { children.closeSync() }
          const rootNow = fs.lstatSync(root.directory)
          const markerNow = this.readStageMarker(path.join(stage, 'owner.json'))
          if (!this.sameInode(root.stat, rootNow) || rootNow.isSymbolicLink() ||
              !this.sameInode(root.marker, fs.lstatSync(path.join(root.directory, 'owner.json'))) ||
              !this.sameInode(root.marker, fs.lstatSync(path.join(this.cacheDir, APPROVED_ROOT_POINTER))) ||
              !this.sameInode(stat, fs.lstatSync(stage)) || !this.sameInode(markerStat, markerNow.stat) || JSON.stringify(markerNow.value) !== JSON.stringify(value)) throw new Error()
          const quarantine = path.join(root.directory, `.reap-${marker.stage_id}-${randomUUID()}`)
          fs.renameSync(stage, quarantine)
          const claimed = fs.lstatSync(quarantine)
          const claimedMarker = this.readStageMarker(path.join(quarantine, 'owner.json'))
          if (!this.sameInode(stat, claimed) || claimed.isSymbolicLink() || !this.sameInode(markerStat, claimedMarker.stat) || JSON.stringify(claimedMarker.value) !== JSON.stringify(value)) throw new Error()
          fs.rmSync(quarantine, { recursive: true })
          result.removed += 1
        } catch { result.preserved += 1 }
      }
    } finally { stream.closeSync() }
    return result
  }

  private validateApprovedAsset(asset: ApprovedCacheAsset): ApprovedCacheAsset {
    const match = typeof asset?.cache_key === 'string' ? /^live_([a-f0-9]{64})_(image|video|pdf)$/.exec(asset.cache_key) : null
    const mime = typeof asset?.content_type === 'string' ? asset.content_type.toLowerCase() : ''
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf' : 'hls'
    if (!match || match[1] !== asset.sha256 || match[2] !== kind || !APPROVED_MIME_EXTENSIONS[mime] ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0) throw this.approvedError('INVALID_APPROVED_ASSET')
    return { ...asset, content_type: mime }
  }

  private assertOwnerCapacity(key: string): void {
    if (!this.publishedPins.has(key) && !this.approvedOwners.has(key) &&
        new Set([...this.publishedPins.keys(), ...this.approvedOwners.keys()]).size >= MAX_CACHE_PIN_OWNERS) {
      throw this.approvedError('PIN_OWNER_LIMIT')
    }
  }

  private async approvedSlot(signal: AbortSignal): Promise<() => void> {
    const limit = Math.min(this.prefetchConcurrency, 10)
    while (this.approvedActive >= limit) {
      await new Promise<void>((resolve, reject) => {
        const key = Symbol()
        const cleanup = (): void => { this.approvedWaiters.delete(key); signal.removeEventListener('abort', aborted) }
        const aborted = (): void => { cleanup(); reject(this.approvedError('APPROVED_ASSET_CANCELLED')) }
        this.approvedWaiters.set(key, () => { cleanup(); resolve() })
        signal.addEventListener('abort', aborted, { once: true })
        if (signal.aborted) aborted()
      })
    }
    if (signal.aborted) {
      this.approvedWaiters.values().next().value?.()
      throw this.approvedError('APPROVED_ASSET_CANCELLED')
    }
    this.approvedActive += 1
    return () => {
      this.approvedActive -= 1
      this.approvedWaiters.values().next().value?.()
    }
  }

  /**
   * Verify actual local bytes or repair precisely one approved CAS key. No
   * general revision substitution, arbitrary path removal or metadata-only hit.
   * The successful claim stays protected until releasePublishedOccurrence().
   */
  async ensureApprovedAsset(
    owner: PublishedCachePinOwner, input: ApprovedCacheAsset, url?: string,
    options: { signal?: AbortSignal; totalTimeoutMs?: number; idleTimeoutMs?: number } = {},
  ): Promise<ResolvedCacheEntry> {
    const startedAt = performance.now()
    const asset = this.validateApprovedAsset(input)
    const ownerKey = this.pinOwnerKey(owner)
    const totalTimeoutMs = options.totalTimeoutMs ?? 600_000
    const idleTimeoutMs = options.idleTimeoutMs ?? 30_000
    const totalDeadline = startedAt + totalTimeoutMs
    if (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > 1_800_000 ||
        !Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1 || idleTimeoutMs > 30_000) throw this.approvedError('INVALID_APPROVED_TIMEOUT')
    this.assertOwnerCapacity(ownerKey)
    const existingPin = this.publishedPins.get(ownerKey)
    if (existingPin && !existingPin.assets.some(item => item.cacheKey === asset.cache_key && item.sha256 === asset.sha256)) {
      throw this.approvedError('PIN_OWNER_ASSETS_CHANGED', asset.cache_key)
    }
    this.assertPinnedHash(asset.cache_key, asset.sha256)
    for (const claimed of this.approvedOwners.values()) {
      const previous = claimed.assets.get(asset.cache_key)
      if (previous && (previous.size !== asset.size || previous.content_type !== asset.content_type)) {
        throw this.approvedError('APPROVED_DESCRIPTOR_CONFLICT', asset.cache_key)
      }
    }
    const state = this.approvedOwners.get(ownerKey) ?? { assets: new Map(), ready: new Set(), requests: new Map() }
    this.approvedOwners.set(ownerKey, state)
    const controller = new AbortController()
    const cancel = (): void => controller.abort()
    const generation = this.writeGeneration
    state.assets.set(asset.cache_key, asset)
    state.requests.set(controller, asset.cache_key)
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    const timer = setTimeout(cancel, Math.max(0, totalDeadline - performance.now()))
    const current = (): void => {
      this.assertWriteGeneration(generation, asset.cache_key)
      if (controller.signal.aborted || performance.now() >= totalDeadline || this.approvedOwners.get(ownerKey) !== state || !state.requests.has(controller)) {
        throw this.approvedError('APPROVED_ASSET_CANCELLED', asset.cache_key)
      }
      this.assertPinnedHash(asset.cache_key, asset.sha256)
    }
    let entered = false
    const abortable = <T>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      // A queued caller can cancel promptly. An active caller awaits stream and
      // private-stage cleanup before its cancellation is returned.
      const aborted = (): void => { if (!entered) reject(this.approvedError('APPROVED_ASSET_CANCELLED', asset.cache_key)) }
      controller.signal.addEventListener('abort', aborted, { once: true })
      operation.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', aborted))
      if (controller.signal.aborted) aborted()
    })
    try {
      return await abortable(this.mutateKey(asset.cache_key, async () => {
        entered = true
        current()
        const release = await this.approvedSlot(controller.signal)
        try {
          current()
          const result = await this.repairApprovedAsset(asset, url, controller.signal, current, idleTimeoutMs)
          current()
          state.ready.add(asset.cache_key)
          return result
        } finally { release() }
      }))
    } catch (error) {
      if (error instanceof CacheError) throw error
      throw this.approvedError(controller.signal.aborted ? 'APPROVED_ASSET_CANCELLED' : 'APPROVED_CACHE_FAILED', asset.cache_key)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', cancel)
      state.requests.delete(controller)
      if (!state.ready.has(asset.cache_key) && ![...state.requests.values()].includes(asset.cache_key)) state.assets.delete(asset.cache_key)
      if (this.approvedOwners.get(ownerKey) === state && state.assets.size === 0 && state.requests.size === 0) this.approvedOwners.delete(ownerKey)
    }
  }

  private async repairApprovedAsset(asset: ApprovedCacheAsset, url: string | undefined, signal: AbortSignal, current: () => void, idleTimeoutMs: number): Promise<ResolvedCacheEntry> {
    const cacheKey = asset.cache_key
    const directory = await fs.promises.lstat(this.cacheDir)
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw this.approvedError('APPROVED_CACHE_PATH_UNSAFE', cacheKey)
    const target = path.join(this.cacheDir, cacheKey + APPROVED_MIME_EXTENSIONS[asset.content_type])
    await this.has(cacheKey)
    const before = this.entries.get(cacheKey)
    if (before && before.localPath !== target) throw this.approvedError('APPROVED_CACHE_PATH_CONFLICT', cacheKey)
    let stamp: fs.Stats | undefined
    try { stamp = await fs.promises.lstat(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw this.approvedError('APPROVED_CACHE_PATH_UNREADABLE', cacheKey) }
    if (stamp && (!stamp.isFile() || stamp.isSymbolicLink())) throw this.approvedError('APPROVED_CACHE_PATH_UNSAFE', cacheKey)
    const sameFile = (left: fs.Stats, right: fs.Stats): boolean => left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    const assertUnchanged = (): void => {
      current()
      const dir = fs.lstatSync(this.cacheDir)
      if (!dir.isDirectory() || dir.isSymbolicLink() || dir.dev !== directory.dev || dir.ino !== directory.ino || this.entries.get(cacheKey) !== before) throw this.approvedError('APPROVED_CACHE_CHANGED', cacheKey)
      let now: fs.Stats | undefined
      try { now = fs.lstatSync(target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw this.approvedError('APPROVED_CACHE_CHANGED', cacheKey) }
      if (stamp ? !now || !sameFile(stamp, now) || now.isSymbolicLink() : Boolean(now)) throw this.approvedError('APPROVED_CACHE_CHANGED', cacheKey)
    }
    if (stamp?.size === asset.size) {
      const hash = createHash('sha256')
      const handle = await fs.promises.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
      const file = handle.createReadStream({ highWaterMark: 64 * 1024, autoClose: false })
      const stop = (): void => { file.destroy(this.approvedError('APPROVED_ASSET_CANCELLED', cacheKey)) }
      signal.addEventListener('abort', stop, { once: true })
      try {
        if (!sameFile(stamp, await handle.stat())) throw this.approvedError('APPROVED_CACHE_CHANGED', cacheKey)
        for await (const chunk of file) { current(); hash.update(chunk) }
      } finally { signal.removeEventListener('abort', stop); file.destroy(); await handle.close() }
      assertUnchanged()
      if (hash.digest('hex') === asset.sha256) {
        this.entries.set(cacheKey, { mediaId: cacheKey, localPath: target, size: asset.size, sha256: asset.sha256, lastUsedAt: Date.now(), status: 'ready' })
        return { cacheKey, localPath: target }
      }
    }
    assertUnchanged()
    // An old successful claim cannot remain ready after actual-byte corruption
    // or disappearance. Pending repairs retain protection, never false readiness.
    this.prunePinKey(cacheKey)
    current()
    let parsed: URL
    try { if (!url) throw new Error(); parsed = new URL(url) } catch { throw this.approvedError('APPROVED_DOWNLOAD_UNAVAILABLE', cacheKey) }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) throw this.approvedError('INVALID_APPROVED_URL', cacheKey)
    if (asset.size > this.maxBytes) throw this.approvedError('INSUFFICIENT_SPACE', cacheKey)
    // Reserve the committed-size delta; physical staging needs the whole body.
    const reserved = Math.max(0, asset.size - (before?.size ?? 0))
    this.approvedReservedBytes += reserved
    const physical = Symbol()
    this.approvedPhysicalReservations.set(physical, { size: asset.size, written: () => 0 })
    let stage: string | undefined
    let response: import('stream').Readable | undefined
    const transfer = new AbortController()
    const abortTransfer = (): void => transfer.abort()
    let idleTimer: NodeJS.Timeout | undefined
    let idleExpired = false
    let idleDeadline = 0
    const progress = (): void => {
      const now = performance.now()
      if (idleDeadline && now >= idleDeadline) {
        idleExpired = true
        transfer.abort()
        throw this.approvedError('APPROVED_TRANSFER_IDLE', cacheKey)
      }
      idleDeadline = now + idleTimeoutMs
      if (idleTimer) idleTimer.refresh()
      else idleTimer = setTimeout(() => { idleExpired = true; transfer.abort() }, idleTimeoutMs)
    }
    try {
      if (!await this.evictIfNeeded(0)) throw this.approvedError('INSUFFICIENT_SPACE', cacheKey)
      current()
      const remaining = [...this.approvedPhysicalReservations.values()].reduce((sum, reservation) => sum + Math.max(0, reservation.size - reservation.written()), 0)
      const disk = await fs.promises.statfs(this.cacheDir)
      if (disk.bavail * disk.bsize < remaining) throw this.approvedError('INSUFFICIENT_DISK_SPACE', cacheKey)
      assertUnchanged()
      this.reconcileApprovedStages()
      const root = this.approvedStagingRoot(true)!
      const stageId = randomUUID()
      stage = path.join(root.directory, stageId)
      fs.mkdirSync(stage, { mode: 0o700 })
      ACTIVE_APPROVED_STAGES.set(stage, stageId)
      this.writeStageMarker(path.join(stage, 'owner.json'), { kind: 'DARSHAN_APPROVED_CACHE_STAGE', version: 1,
        stage_id: stageId, process_id: process.pid, process_token: APPROVED_PROCESS_TOKEN, created_at: Date.now() } satisfies ApprovedStageMarker)
      const staged = path.join(stage, randomUUID() + '.part')
      current()
      signal.addEventListener('abort', abortTransfer, { once: true })
      if (signal.aborted) abortTransfer()
      // Admission authority has its own short lease. These timers bound only
      // artifact preparation, including a progressing large allowed download.
      progress()
      const request = await axios.get<import('stream').Readable>(url, {
        responseType: 'stream', timeout: 0, signal: transfer.signal, maxRedirects: 0, decompress: false,
        headers: { 'Accept-Encoding': 'identity' }, ...(this.httpsAgent ? { httpsAgent: this.httpsAgent } : {}),
      })
      response = request.data
      progress() // Real completed response headers, not a synthetic keepalive.
      const type = String(request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
      const encoding = String(request.headers['content-encoding'] ?? 'identity').toLowerCase()
      const length = request.headers['content-length']
      if (type !== asset.content_type || encoding !== 'identity' || (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) !== asset.size))) {
        throw this.approvedError('APPROVED_RESPONSE_MISMATCH', cacheKey)
      }
      const hash = createHash('sha256')
      let size = 0
      const measure = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
        try {
          current()
          if (idleExpired) throw this.approvedError('APPROVED_TRANSFER_IDLE', cacheKey)
          size += chunk.length
          if (size > asset.size) throw this.approvedError('APPROVED_SIZE_MISMATCH', cacheKey)
          if (chunk.length > 0) progress()
          hash.update(chunk)
          callback(null, chunk)
        } catch (error) { callback(error as Error) }
      } })
      const writer = fs.createWriteStream(staged, { flags: 'wx', mode: 0o600, highWaterMark: 64 * 1024 })
      this.approvedPhysicalReservations.set(physical, { size: asset.size, written: () => writer.bytesWritten })
      await pipeline(response, measure, writer, { signal: transfer.signal })
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = undefined
      if (size !== asset.size) throw this.approvedError('APPROVED_SIZE_MISMATCH', cacheKey)
      if (hash.digest('hex') !== asset.sha256) throw this.approvedError('APPROVED_HASH_MISMATCH', cacheKey)
      const handle = await fs.promises.open(staged, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      assertUnchanged()
      // No await between the final identity fence, atomic replacement and index.
      fs.renameSync(staged, target)
      this.entries.set(cacheKey, { mediaId: cacheKey, localPath: target, size: asset.size, sha256: asset.sha256, lastUsedAt: Date.now(), status: 'ready' })
      return { cacheKey, localPath: target }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const rejected = error.response?.data as { destroy?: () => void } | undefined
        rejected?.destroy?.()
      }
      if (error instanceof CacheError) throw error
      if (signal.aborted) throw this.approvedError('APPROVED_ASSET_CANCELLED', cacheKey)
      if (idleExpired) throw this.approvedError('APPROVED_TRANSFER_IDLE', cacheKey)
      throw this.approvedError('APPROVED_TRANSFER_FAILED', cacheKey)
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      signal.removeEventListener('abort', abortTransfer)
      transfer.abort()
      response?.destroy()
      this.approvedReservedBytes -= reserved
      this.approvedPhysicalReservations.delete(physical)
      if (stage) {
        ACTIVE_APPROVED_STAGES.delete(stage)
        await fs.promises.rm(stage, { recursive: true, force: true })
      }
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
    if (this.approvedInternalName(mediaId)) return false
    const entry = this.entries.get(mediaId)
    if (entry && fs.existsSync(entry.localPath)) {
      entry.lastUsedAt = Date.now()
      return true
    }

    const safeId = sanitizeFilename(mediaId)
    const files = fs.existsSync(this.cacheDir) ? fs.readdirSync(this.cacheDir) : []
    const match = files.find((file) => !this.approvedInternalName(file) && (file === safeId || file.startsWith(`${safeId}.`)))
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
    return await this.mutateKey(mediaId, () => this.getInternal(mediaId, contentType))
  }

  private async getInternal(mediaId: string, contentType?: string): Promise<string | undefined> {
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
    return [...this.publishedPins.values()].some(owner => owner.protectedKeys.has(cacheKey)) ||
      [...this.approvedOwners.values()].some(owner => owner.assets.has(cacheKey))
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
    for (const owner of this.approvedOwners.values()) {
      if (owner.assets.has(cacheKey) && owner.assets.get(cacheKey)?.sha256 !== sha256) {
        throw new CacheError('Pinned content requires its approved checksum', { reason: 'PINNED_REVISION_CONFLICT', cacheKey })
      }
    }
  }

  private prunePinKey(cacheKey: string): void {
    for (const [key, owner] of this.publishedPins) {
      owner.protectedKeys.delete(cacheKey)
      if (!owner.pending && owner.protectedKeys.size === 0) this.publishedPins.delete(key)
    }
    for (const [key, owner] of this.approvedOwners) {
      owner.ready.delete(cacheKey)
      if (![...owner.requests.values()].includes(cacheKey)) owner.assets.delete(cacheKey)
      if (owner.assets.size === 0 && owner.requests.size === 0) this.approvedOwners.delete(key)
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
    this.assertOwnerCapacity(key)
    const approved = this.approvedOwners.get(key)
    if (approved && [...approved.assets].some(([cacheKey, descriptor]) => !normalized.some(asset => asset.cacheKey === cacheKey && asset.sha256 === descriptor.sha256))) {
      throw this.approvedError('PIN_OWNER_ASSETS_CHANGED')
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
    const key = this.pinOwnerKey(owner)
    this.publishedPins.delete(key)
    const approved = this.approvedOwners.get(key)
    this.approvedOwners.delete(key)
    for (const controller of approved?.requests.keys() ?? []) controller.abort()
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
      this.invalidatePendingWrites()
      this.publishedPins.clear()
      const owners = [...this.approvedOwners.values()]
      this.approvedOwners.clear()
      for (const owner of owners) for (const controller of owner.requests.keys()) controller.abort()
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
