import {
  FitMode,
  MediaType,
  SnapshotMediaUrlMap,
  SnapshotPresentation,
  SnapshotScheduleItem,
  TimelineItem,
} from '../../common/types'
import { getExtensionFromName, getExtensionFromUrl, normalizeMime } from '../../common/media-compat'
import { hasValidLiveWindowControls, isLiveScheduleCandidate, readLiveOccurrence, type LiveOccurrence } from '../../common/live-playback'

export interface NormalizedScheduleWindow {
  id: string
  presentationId?: string
  presentationName?: string
  startAt?: string
  endAt?: string
  priority: number
  items: TimelineItem[]
  layout?: SnapshotPresentation['layout']
  raw?: SnapshotScheduleItem
  live?: LiveOccurrence
}

export interface ScheduleEvaluationResult {
  activeWindow?: NormalizedScheduleWindow
  items: TimelineItem[]
  nextTransitionAt?: number
}

function inferTypeFromValue(input: {
  mediaType?: string
  contentType?: string
  sourceContentType?: string
  mediaName?: string
  remoteUrl?: string
}): MediaType {
  const normalizedType = input.mediaType?.toLowerCase()
  const normalizedMime = normalizeMime(input.contentType || input.sourceContentType)
  const extension = getExtensionFromName(input.mediaName) || getExtensionFromUrl(input.remoteUrl)

  if (normalizedType === 'url' || normalizedType === 'webpage') return 'url'
  if (normalizedType === 'image' || normalizedMime?.startsWith('image/')) return 'image'
  if (normalizedType === 'video' || normalizedMime?.startsWith('video/')) return 'video'

  if (
    normalizedType === 'pdf' ||
    normalizedMime === 'application/pdf' ||
    extension === 'pdf'
  ) {
    return 'pdf'
  }

  if (
    normalizedType === 'office' ||
    normalizedType === 'document' ||
    normalizedMime?.includes('presentation') ||
    normalizedMime?.includes('powerpoint') ||
    normalizedMime === 'text/csv' ||
    normalizedMime === 'application/msword' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    normalizedMime === 'application/vnd.ms-excel' ||
    normalizedMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    extension === 'ppt' ||
    extension === 'pptx' ||
    extension === 'csv' ||
    extension === 'doc' ||
    extension === 'docx' ||
    extension === 'xls' ||
    extension === 'xlsx'
  ) {
    return 'office'
  }

  if (normalizedType?.startsWith('image/')) return 'image'
  if (normalizedType?.startsWith('video/')) return 'video'
  if (normalizedType?.includes('pdf')) return 'pdf'

  return extension === 'mp4' || extension === 'mov' ? 'video' : 'image'
}

function normalizeFit(value?: string): FitMode {
  if (value === 'cover' || value === 'stretch' || value === 'contain') {
    return value
  }
  return 'contain'
}

function buildTimelineItem(input: {
  id?: string
  mediaId?: string
  mediaName?: string
  mediaType?: string
  contentType?: string
  sourceContentType?: string
  remoteUrl?: string
  durationSeconds?: number
  fit?: string
  muted?: boolean
  loopEnabled?: boolean
  pageNumber?: unknown
  sourceUrl?: string | null
  fallbackUrl?: string | null
  fallbackRevision?: string | null
  fallbackSha256?: string | null
  meta?: Record<string, unknown>
}): TimelineItem | null {
  const mediaId = input.mediaId || input.id
  const remoteUrl = input.remoteUrl
  if (!mediaId || !remoteUrl) {
    return null
  }

  const type = inferTypeFromValue({
    mediaType: input.mediaType,
    contentType: input.contentType,
    sourceContentType: input.sourceContentType,
    mediaName: input.mediaName,
    remoteUrl,
  })
  const explicitPage = input.pageNumber
  const normalizedPage =
    type !== 'pdf'
      ? undefined
      : explicitPage == null
        ? 1
        : typeof explicitPage === 'number' && Number.isSafeInteger(explicitPage) && explicitPage > 0
          ? explicitPage
          : 0

  return {
    id: input.id || mediaId,
    mediaId,
    remoteUrl,
    type,
    displayMs: Math.max(1, Number(input.durationSeconds || 10)) * 1000,
    fit: normalizeFit(input.fit),
    muted: Boolean(input.muted),
    loop: Boolean(input.loopEnabled),
    pageNumber: normalizedPage,
    sha256: type === 'url' ? (input.fallbackSha256 ?? undefined) : undefined,
    transitionDurationMs: 0,
    meta: {
      ...input.meta,
      name: input.mediaName,
      content_type: input.contentType,
      source_content_type: input.sourceContentType,
      source_url: input.sourceUrl ?? undefined,
      fallback_url: input.fallbackUrl ?? undefined,
      fallback_revision: input.fallbackRevision ?? undefined,
      fallback_sha256: input.fallbackSha256 ?? undefined,
    },
  }
}

function sortByOrder<T extends { order?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.order || 0) - (right.order || 0))
}

export function buildWindowItems(
  scheduleItem: SnapshotScheduleItem,
  mediaUrlMap: SnapshotMediaUrlMap,
): TimelineItem[] {
  if (isLiveScheduleCandidate(scheduleItem)) return []
  const presentation = scheduleItem.presentation
  if (!presentation || typeof presentation !== 'object') {
    return []
  }

  const layoutMeta = presentation.layout
    ? {
        layout: presentation.layout,
      }
    : undefined

  const itemsFromPresentation = sortByOrder(presentation.items || [])
    .map((entry) =>
      buildTimelineItem({
        id: entry.id,
        mediaId: entry.media_id,
        mediaName: entry.media?.name,
        mediaType: entry.media?.type,
        contentType: entry.media?.content_type,
        sourceContentType: entry.media?.source_content_type,
        remoteUrl: entry.media_id ? mediaUrlMap[entry.media_id] : undefined,
        sourceUrl: entry.media?.source_url ?? entry.media?.url ?? null,
        fallbackUrl: entry.media?.fallback_url ?? null,
        fallbackRevision: entry.media?.fallback_revision ?? null,
        fallbackSha256: entry.media?.fallback_sha256 ?? null,
        durationSeconds: entry.duration_seconds,
        pageNumber: entry.page_number,
        fit: 'contain',
        muted: true,
        loopEnabled: false,
        meta: {
          ...layoutMeta,
          source: 'schedule',
          presentationId: presentation.id,
          presentationName: presentation.name,
        },
      }),
    )
    .filter(Boolean) as TimelineItem[]

  const itemsFromSlots = sortByOrder(presentation.slots || [])
    .map((entry) =>
      buildTimelineItem({
        id: entry.id,
        mediaId: entry.media_id,
        mediaName: entry.media?.name,
        mediaType: entry.media?.type,
        contentType: entry.media?.content_type,
        sourceContentType: entry.media?.source_content_type,
        remoteUrl: entry.media_id ? mediaUrlMap[entry.media_id] : undefined,
        sourceUrl: entry.media?.source_url ?? entry.media?.url ?? null,
        fallbackUrl: entry.media?.fallback_url ?? null,
        fallbackRevision: entry.media?.fallback_revision ?? null,
        fallbackSha256: entry.media?.fallback_sha256 ?? null,
        durationSeconds: entry.duration_seconds,
        pageNumber: entry.page_number,
        fit: entry.fit_mode,
        muted: entry.audio_enabled === true ? false : true,
        loopEnabled: entry.loop_enabled === true,
        meta: {
          ...layoutMeta,
          source: 'schedule',
          slotId: entry.slot_id,
          presentationId: presentation.id,
          presentationName: presentation.name,
        },
      }),
    )
    .filter(Boolean) as TimelineItem[]

  return [...itemsFromPresentation, ...itemsFromSlots]
}

export function normalizeScheduleWindows(
  scheduleItems: SnapshotScheduleItem[] | undefined,
  mediaUrlMap: SnapshotMediaUrlMap,
  context: { publishId?: string; scheduleId?: string; deviceId?: string } = {},
): NormalizedScheduleWindow[] {
  return (scheduleItems || [])
    .map<NormalizedScheduleWindow | null>((item, index) => {
      if (isLiveScheduleCandidate(item)) {
        if (!hasValidLiveWindowControls(item)) return null
        const live = readLiveOccurrence(item, context)
        return { id: live.itemId, presentationId: live.policy?.fallback.manifest.presentation.id,
          startAt: live.startAt, endAt: live.endAt, priority: live.priority, items: [], live,
          layout: live.policy?.fallback.manifest.presentation.layout as NormalizedScheduleWindow['layout'] }
      }
      const items = buildWindowItems(item, mediaUrlMap)
      return {
        id: item.id || `schedule-window-${index}`,
        presentationId: item.presentation_id || item.presentation?.id,
        presentationName: item.presentation?.name,
        startAt: item.start_at,
        endAt: item.end_at,
        priority: Number(item.priority || 0),
        items,
        layout: item.presentation?.layout,
        raw: item,
      }
    })
    .filter((window): window is NormalizedScheduleWindow => Boolean(window && (window.items.length > 0 || window.live)))
}

export function evaluateScheduleWindows(
  windows: NormalizedScheduleWindow[],
  nowMs: number = Date.now(),
): ScheduleEvaluationResult {
  if (windows.length === 0) {
    return { items: [] }
  }

  const activeWindows = windows
    .filter((window) => {
      const startMs = window.startAt ? Date.parse(window.startAt) : Number.NaN
      const endMs = window.endAt ? Date.parse(window.endAt) : Number.NaN
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false
      return startMs <= nowMs && nowMs < endMs
    })
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority
      const rightStart = right.startAt ? Date.parse(right.startAt) : 0
      const leftStart = left.startAt ? Date.parse(left.startAt) : 0
      return rightStart - leftStart
    })

  const boundaryCandidates = windows.flatMap((window) => {
    const starts = window.startAt ? [Date.parse(window.startAt)] : []
    const ends = window.endAt ? [Date.parse(window.endAt)] : []
    return [...starts, ...ends].filter((value) => Number.isFinite(value) && value > nowMs)
  })

  const nextTransitionAt = boundaryCandidates.length > 0 ? Math.min(...boundaryCandidates) : undefined

  if (activeWindows.length === 0) {
    return {
      items: [],
      nextTransitionAt,
    }
  }

  const activeWindow = activeWindows[0]
  if (!activeWindow) {
    return {
      items: [],
      nextTransitionAt,
    }
  }

  return {
    activeWindow,
    items: activeWindow.items,
    nextTransitionAt,
  }
}
