import * as fs from 'fs'
import * as path from 'path'
import { getConfigManager } from '../../common/config'
import { getLogger } from '../../common/logger'
import type { PlaybackProgressEntry, PlaybackProgressIdentity } from '../../common/playback-policy'
import { matchesPlaybackProgressIdentity, shouldUsePersistedProgress } from '../../common/playback-policy'
import { atomicWrite, ensureDir } from '../../common/utils'

const logger = getLogger('playback-progress-store')
const PLAYBACK_PROGRESS_SCHEMA_VERSION = 1
const MAX_PROGRESS_ENTRIES = 64
const DEFAULT_PROGRESS_FRESH_MS = 10 * 60 * 1000

interface PlaybackProgressFile {
  schemaVersion: number
  entries: PlaybackProgressEntry[]
}

let singleton: PlaybackProgressStore | undefined

export function getPlaybackProgressPath(cachePath: string = getConfigManager().getConfig().cache.path): string {
  return path.join(cachePath, 'playback-progress.json')
}

export function getPlaybackProgressStore(): PlaybackProgressStore {
  if (!singleton) {
    singleton = new PlaybackProgressStore()
  }
  return singleton
}

export function resetPlaybackProgressStoreForTests(): void {
  singleton = undefined
}

export class PlaybackProgressStore {
  private readonly filePath: string

  constructor(filePath: string = getPlaybackProgressPath()) {
    this.filePath = filePath
    ensureDir(path.dirname(this.filePath), 0o755)
  }

  getPath(): string {
    return this.filePath
  }

  readAll(): PlaybackProgressEntry[] {
    return this.readFile().entries
  }

  getLatest(
    expected?: PlaybackProgressIdentity,
    options: { nowMs?: number; progressFreshMs?: number } = {},
  ): PlaybackProgressEntry | null {
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now()
    const progressFreshMs = options.progressFreshMs ?? DEFAULT_PROGRESS_FRESH_MS
    const entries = this.readAll()
      .filter((entry) => matchesPlaybackProgressIdentity(entry, expected))
      .filter((entry) => shouldUsePersistedProgress(entry, expected, nowMs, progressFreshMs))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))

    return entries[0] ?? null
  }

  async record(payload: unknown): Promise<PlaybackProgressEntry | null> {
    const entry = sanitizeProgressEntry(payload)
    if (!entry) {
      return null
    }

    const current = this.readFile()
    const nextEntries = upsertProgressEntry(current.entries, entry).slice(0, MAX_PROGRESS_ENTRIES)
    await atomicWrite(
      this.filePath,
      JSON.stringify(
        {
          schemaVersion: PLAYBACK_PROGRESS_SCHEMA_VERSION,
          entries: nextEntries,
        },
        null,
        2,
      ),
    )

    return entry
  }

  clear(): void {
    if (!fs.existsSync(this.filePath)) {
      return
    }

    fs.rmSync(this.filePath, { force: true })
  }

  private readFile(): PlaybackProgressFile {
    if (!fs.existsSync(this.filePath)) {
      return emptyProgressFile()
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      const entries = Array.isArray(parsed?.entries)
        ? parsed.entries
            .map((entry: unknown) => sanitizeProgressEntry(entry))
            .filter((entry: PlaybackProgressEntry | null): entry is PlaybackProgressEntry => Boolean(entry))
        : []

      return {
        schemaVersion: PLAYBACK_PROGRESS_SCHEMA_VERSION,
        entries,
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to read playback progress; ignoring corrupt progress file')
      return emptyProgressFile()
    }
  }
}

export function sanitizeProgressEntry(payload: unknown): PlaybackProgressEntry | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const positionMs = safeNonNegativeInteger(record['positionMs'])
  if (positionMs === null) {
    return null
  }

  const updatedAt = sanitizeIsoTimestamp(record['updatedAt']) ?? new Date().toISOString()
  const itemDisplayMs = safePositiveInteger(record['itemDisplayMs'])

  return {
    scheduleId: sanitizeId(record['scheduleId']),
    snapshotId: sanitizeId(record['snapshotId']),
    sceneId: sanitizeId(record['sceneId']),
    slotId: sanitizeId(record['slotId']),
    itemId: sanitizeId(record['itemId']),
    mediaId: sanitizeId(record['mediaId']),
    scheduleStartsAt: sanitizeIsoTimestamp(record['scheduleStartsAt']),
    scheduleEndsAt: sanitizeIsoTimestamp(record['scheduleEndsAt']),
    itemDisplayMs: itemDisplayMs ?? undefined,
    positionMs,
    completed: record['completed'] === true,
    updatedAt,
  }
}

function upsertProgressEntry(entries: PlaybackProgressEntry[], entry: PlaybackProgressEntry): PlaybackProgressEntry[] {
  const entryKey = progressKey(entry)
  const withoutExisting = entries.filter((candidate) => progressKey(candidate) !== entryKey)
  return [entry, ...withoutExisting]
}

function progressKey(entry: PlaybackProgressIdentity): string {
  return [
    entry.scheduleId || '',
    entry.snapshotId || '',
    entry.sceneId || '',
    entry.slotId || '',
    entry.itemId || '',
    entry.mediaId || '',
  ].join('|')
}

function emptyProgressFile(): PlaybackProgressFile {
  return {
    schemaVersion: PLAYBACK_PROGRESS_SCHEMA_VERSION,
    entries: [],
  }
}

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 256 || /[?#]|:\/\/|@/.test(trimmed)) {
    return null
  }

  return trimmed
}

function sanitizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const timestampMs = Date.parse(value)
  if (!Number.isFinite(timestampMs)) {
    return null
  }

  return new Date(timestampMs).toISOString()
}

function safeNonNegativeInteger(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null
  }
  return Math.round(numeric)
}

function safePositiveInteger(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null
  }
  return Math.round(numeric)
}
