import type { TimelineItem } from './types'

export type PlaybackResumeSource = 'wall-clock' | 'persisted' | 'initial'

export interface PlaybackProgressIdentity {
  scheduleId?: string | null
  snapshotId?: string | null
  sceneId?: string | null
  slotId?: string | null
  itemId?: string | null
  mediaId?: string | null
}

export interface PlaybackProgressEntry extends PlaybackProgressIdentity {
  scheduleStartsAt?: string | null
  scheduleEndsAt?: string | null
  itemDisplayMs?: number
  positionMs: number
  completed?: boolean
  updatedAt: string
}

export interface PlaybackResumeInput {
  items: Array<Pick<TimelineItem, 'id' | 'displayMs' | 'loop' | 'mediaId' | 'objectKey'>>
  startsAt?: string | null
  serverTimeOffsetMs?: number
  nowMs?: number
  persisted?: PlaybackProgressEntry | null
  expected?: PlaybackProgressIdentity
  progressFreshMs?: number
}

export interface PlaybackResumeDecision {
  index: number
  remainingMs: number
  elapsedMsInItem: number
  seekMs: number
  autoplay: boolean
  completed: boolean
  source: PlaybackResumeSource
}

const DEFAULT_REMAINING_MS = 1000
const MIN_REMAINING_MS = 250
const DEFAULT_PROGRESS_FRESH_MS = 10 * 60 * 1000
const FINAL_FRAME_BACKOFF_MS = 250

export function shouldRepeatScheduledItem(itemCount: number, item?: Pick<TimelineItem, 'loop'> | null): boolean {
  return itemCount > 1 || item?.loop === true
}

export function resolveScheduledResumePosition(input: PlaybackResumeInput): PlaybackResumeDecision {
  const items = input.items
  if (items.length === 0) {
    return initialDecision()
  }

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now()
  const startsAtMs = parseTimestampMs(input.startsAt)
  if (startsAtMs !== null) {
    const elapsedMs = Math.max(0, nowMs + safeNumber(input.serverTimeOffsetMs, 0) - startsAtMs)
    return resolveFromElapsed(items, elapsedMs, 'wall-clock')
  }

  const persisted = input.persisted
  if (persisted && shouldUsePersistedProgress(persisted, input.expected, nowMs, input.progressFreshMs)) {
    const persistedIndex = findPersistedItemIndex(items, persisted)
    if (persistedIndex >= 0) {
      const item = items[persistedIndex]
      const durationMs = getItemDurationMs(item)
      const elapsedMsInItem = Math.min(Math.max(0, persisted.positionMs), durationMs)
      const completed = persisted.completed === true || elapsedMsInItem >= durationMs
      return {
        index: persistedIndex,
        remainingMs: completed ? DEFAULT_REMAINING_MS : Math.max(MIN_REMAINING_MS, durationMs - elapsedMsInItem),
        elapsedMsInItem,
        seekMs: completed ? getFinalFrameSeekMs(durationMs) : elapsedMsInItem,
        autoplay: !completed,
        completed,
        source: 'persisted',
      }
    }
  }

  return {
    ...initialDecision(),
    remainingMs: getItemDurationMs(items[0]),
  }
}

export function shouldUsePersistedProgress(
  persisted: PlaybackProgressEntry,
  expected?: PlaybackProgressIdentity,
  nowMs: number = Date.now(),
  progressFreshMs: number = DEFAULT_PROGRESS_FRESH_MS,
): boolean {
  const updatedAtMs = parseTimestampMs(persisted.updatedAt)
  if (updatedAtMs === null || nowMs - updatedAtMs > progressFreshMs) {
    return false
  }

  return matchesPlaybackProgressIdentity(persisted, expected)
}

export function matchesPlaybackProgressIdentity(
  persisted: PlaybackProgressIdentity,
  expected?: PlaybackProgressIdentity,
): boolean {
  if (!expected) {
    return true
  }

  const keys: Array<keyof PlaybackProgressIdentity> = [
    'scheduleId',
    'snapshotId',
    'sceneId',
    'slotId',
    'itemId',
    'mediaId',
  ]

  return keys.every((key) => {
    const expectedValue = normalizeIdentityValue(expected[key])
    if (expectedValue === null) {
      return true
    }
    return normalizeIdentityValue(persisted[key]) === expectedValue
  })
}

export function clampVideoSeekSeconds(targetMs: number, mediaDurationSeconds?: number, itemDisplayMs?: number): number {
  const targetSeconds = Math.max(0, safeNumber(targetMs, 0) / 1000)
  const mediaLimitSeconds =
    Number.isFinite(mediaDurationSeconds) && Number(mediaDurationSeconds) > 0
      ? Number(mediaDurationSeconds)
      : Number.isFinite(itemDisplayMs) && Number(itemDisplayMs) > 0
        ? Number(itemDisplayMs) / 1000
        : Number.NaN

  if (!Number.isFinite(mediaLimitSeconds)) {
    return targetSeconds
  }

  return Math.min(targetSeconds, Math.max(0, mediaLimitSeconds - FINAL_FRAME_BACKOFF_MS / 1000))
}

function resolveFromElapsed(
  items: Array<Pick<TimelineItem, 'id' | 'displayMs' | 'loop' | 'mediaId' | 'objectKey'>>,
  elapsedMs: number,
  source: PlaybackResumeSource,
): PlaybackResumeDecision {
  if (items.length === 1 && items[0]?.loop !== true) {
    const durationMs = getItemDurationMs(items[0])
    const completed = elapsedMs >= durationMs
    const elapsedMsInItem = Math.min(elapsedMs, durationMs)

    return {
      index: 0,
      remainingMs: completed ? DEFAULT_REMAINING_MS : Math.max(MIN_REMAINING_MS, durationMs - elapsedMsInItem),
      elapsedMsInItem,
      seekMs: completed ? getFinalFrameSeekMs(durationMs) : elapsedMsInItem,
      autoplay: !completed,
      completed,
      source,
    }
  }

  const totalDurationMs = items.reduce((sum, item) => sum + getItemDurationMs(item), 0)
  if (totalDurationMs <= 0) {
    return initialDecision(source)
  }

  const cycleOffsetMs = elapsedMs % totalDurationMs
  let consumedMs = 0
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (!item) {
      continue
    }
    const durationMs = getItemDurationMs(item)
    if (cycleOffsetMs < consumedMs + durationMs) {
      const elapsedMsInItem = cycleOffsetMs - consumedMs
      return {
        index,
        remainingMs: Math.max(MIN_REMAINING_MS, durationMs - elapsedMsInItem),
        elapsedMsInItem,
        seekMs: elapsedMsInItem,
        autoplay: true,
        completed: false,
        source,
      }
    }
    consumedMs += durationMs
  }

  return initialDecision(source)
}

function findPersistedItemIndex(
  items: Array<Pick<TimelineItem, 'id' | 'displayMs' | 'loop' | 'mediaId' | 'objectKey'>>,
  persisted: PlaybackProgressEntry,
): number {
  return items.findIndex((item) => {
    if (persisted.itemId && item.id === persisted.itemId) {
      return true
    }
    if (persisted.mediaId && (item.mediaId === persisted.mediaId || item.objectKey === persisted.mediaId)) {
      return true
    }
    return false
  })
}

function initialDecision(source: PlaybackResumeSource = 'initial'): PlaybackResumeDecision {
  return {
    index: 0,
    remainingMs: DEFAULT_REMAINING_MS,
    elapsedMsInItem: 0,
    seekMs: 0,
    autoplay: true,
    completed: false,
    source,
  }
}

function getItemDurationMs(item?: Pick<TimelineItem, 'displayMs'>): number {
  return Math.max(1, safeNumber(item?.displayMs, DEFAULT_REMAINING_MS))
}

function getFinalFrameSeekMs(durationMs: number): number {
  return Math.max(0, durationMs - FINAL_FRAME_BACKOFF_MS)
}

function parseTimestampMs(value?: string | null): number | null {
  if (!value) {
    return null
  }

  const timestampMs = Date.parse(value)
  return Number.isFinite(timestampMs) ? timestampMs : null
}

function safeNumber(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeIdentityValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
