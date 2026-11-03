/**
 * Snapshot Parser - Normalize device snapshot payloads into playback items
 */

import { DeviceSnapshot, FitMode, MediaType, SnapshotMediaUrlMap, TimelineItem } from '../../common/types'
import { getLogger } from '../../common/logger'
import { NormalizedScheduleWindow, normalizeScheduleWindows } from './snapshot-evaluator'
import { hasValidLiveWindowControls, isLiveScheduleCandidate } from '../../common/live-playback'

const logger = getLogger('snapshot-parser')

export interface NormalizedSnapshot {
  publishId?: string
  snapshotId?: string
  scheduleId?: string
  scheduleTimezone?: string | null
  contentState: 'scheduled' | 'default' | 'empty'
  serverTime?: string
  items: TimelineItem[]
  scheduleWindows: NormalizedScheduleWindow[]
  emergencyItem?: TimelineItem
  emergencyExpiresAt?: string | null
  defaultItem?: TimelineItem
  mediaUrlMap: SnapshotMediaUrlMap
  fetchedAt: string
  raw?: unknown
  invalidLiveControls?: boolean
  emergencyActive?: boolean
}

function inferTypeFromUrl(url?: string): MediaType {
  if (!url) {
    return 'image'
  }

  const lower = url.toLowerCase()
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/.test(lower)) {
    return 'video'
  }
  if (/\.(pdf)(\?|#|$)/.test(lower)) {
    return 'pdf'
  }
  if (/\.(jpg|jpeg|png|gif|webp)(\?|#|$)/.test(lower)) {
    return 'image'
  }
  return 'image'
}

function normalizeFit(fit?: string): FitMode {
  if (fit === 'cover' || fit === 'stretch' || fit === 'contain') {
    return fit
  }
  return 'contain'
}

function normalizeMediaType(value?: string): MediaType {
  if (!value) {
    return 'image'
  }

  const normalized = value.toLowerCase()
  if (normalized === 'image') return 'image'
  if (normalized === 'video') return 'video'
  if (normalized === 'pdf') return 'pdf'
  if (normalized === 'document') return 'office'
  if (normalized === 'office') return 'office'
  if (normalized === 'url') return 'url'
  if (normalized === 'webpage') return 'url'
  if (normalized === 'message') return 'message'
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized.includes('pdf')) return 'pdf'
  if (
    normalized.includes('spreadsheet') ||
    normalized.includes('excel') ||
    normalized.includes('msword') ||
    normalized.includes('wordprocessingml') ||
    normalized.includes('presentation') ||
    normalized.includes('powerpoint') ||
    normalized === 'text/csv'
  ) {
    return 'office'
  }
  return inferTypeFromUrl(value)
}

function normalizeItem(
  input: any,
  mediaUrlMap: SnapshotMediaUrlMap,
  options: { emergency?: boolean } = {},
): TimelineItem | null {
  if (!input || typeof input !== 'object') {
    return null
  }

  const isEmergencyMessage = input.kind === 'MESSAGE' && typeof input.message === 'string'
  const mediaId = input.media_id || input.mediaId || input.id
  const contentType = typeof input.content_type === 'string' ? input.content_type : undefined
  const sourceContentType = typeof input.source_content_type === 'string' ? input.source_content_type : undefined
  const explicitType = isEmergencyMessage ? 'message' : normalizeMediaType(input.type || input.media_type)
  const type: MediaType =
    explicitType === 'message'
      ? 'message'
      : explicitType === 'url'
      ? 'url'
      : normalizeMediaType(contentType || sourceContentType || input.type || input.media_type || input.source_url || input.url || input.media_url)
  const remoteUrl =
    type === 'url'
      ? input.url || input.source_url || input.media_url || (mediaId ? mediaUrlMap[mediaId] : undefined)
      : input.media_url || input.url || (mediaId ? mediaUrlMap[mediaId] : undefined)
  const displayMs =
    Number(input.display_ms ?? input.displayMs ?? input.duration_ms ?? input.durationMs ?? 10000) || 10000
  const fit = normalizeFit(input.fit || input.fit_mode)
  const muted = Boolean(input.muted ?? false)
  const transitionDurationMs = Number(input.transition_ms ?? input.transitionDurationMs ?? 0) || 0
  const requestedLoop = input.loop ?? input.loop_enabled
  const loop = type === 'video' && requestedLoop === true
  const explicitPage = input.page_number ?? input.pageNumber
  const pageNumber =
    type !== 'pdf'
      ? undefined
      : explicitPage == null
        ? 1
        : typeof explicitPage === 'number' && Number.isSafeInteger(explicitPage) && explicitPage > 0
          ? explicitPage
          : 0

  const id = input.id || mediaId || `item-${Math.random().toString(36).slice(2, 8)}`

  return {
    id,
    mediaId: mediaId || id,
    type,
    remoteUrl,
    displayMs,
    fit,
    muted,
    loop,
    pageNumber,
    sha256:
      type === 'url'
        ? typeof input.fallback_sha256 === 'string'
          ? input.fallback_sha256
          : typeof input.fallback_media_sha256 === 'string'
            ? input.fallback_media_sha256
            : input.sha256
        : input.sha256,
    meta: {
      ...(input.meta && typeof input.meta === 'object' ? input.meta : {}),
      source_url: typeof input.source_url === 'string' ? input.source_url : undefined,
      fallback_url:
        typeof input.fallback_url === 'string'
          ? input.fallback_url
          : type === 'url' && typeof input.media_url === 'string'
            ? input.media_url
            : undefined,
      fallback_revision:
        typeof input.fallback_revision === 'string'
          ? input.fallback_revision
          : typeof input.fallback_media_revision === 'string'
            ? input.fallback_media_revision
            : undefined,
      fallback_sha256:
        typeof input.fallback_sha256 === 'string'
          ? input.fallback_sha256
          : typeof input.fallback_media_sha256 === 'string'
            ? input.fallback_media_sha256
            : undefined,
      name: typeof input.name === 'string' ? input.name : undefined,
      message: options.emergency && typeof input.message === 'string' ? input.message : undefined,
      emergency_message: options.emergency && typeof input.message === 'string' ? input.message : undefined,
      severity: options.emergency && typeof input.severity === 'string' ? input.severity : undefined,
      emergency_version: options.emergency && typeof input.version === 'string' ? input.version : undefined,
      expires_at: options.emergency && typeof input.expires_at === 'string' ? input.expires_at : undefined,
      content_type: contentType,
      source_content_type: sourceContentType,
    },
    transitionDurationMs,
  }
}

function extractMediaUrlMap(payload: DeviceSnapshot): SnapshotMediaUrlMap {
  const map: SnapshotMediaUrlMap = {}

  const rawMap = payload.media_urls || payload.mediaUrls
  if (rawMap && typeof rawMap === 'object') {
    for (const [key, value] of Object.entries(rawMap)) {
      if (typeof value === 'string') {
        map[key] = value
      }
    }
  }

  if (Array.isArray(payload.media)) {
    for (const entry of payload.media) {
      const mediaId = entry.media_id || entry.mediaId
      const type = normalizeMediaType(entry.type || entry.media_type)
      const url = type === 'url' ? entry.url || entry.source_url || entry.media_url : entry.url || entry.media_url
      if (mediaId && url) {
        map[mediaId] = url
      }
    }
  }

  return map
}

/** Persist only immutable validated LIVE fields, never signed downloads or
 * unexpected credential-bearing policy fields. Ordinary snapshot data stays compatible. */
function sanitizeLiveSnapshot(raw: unknown, windows: NormalizedScheduleWindow[]): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const wrapper = raw as Record<string, unknown>
  const nested = wrapper['snapshot'] && typeof wrapper['snapshot'] === 'object' ? 'snapshot'
    : wrapper['data'] && typeof wrapper['data'] === 'object' ? 'data' : undefined
  const payload = (nested ? wrapper[nested] : wrapper) as Record<string, unknown>
  const schedule = payload['schedule'] && typeof payload['schedule'] === 'object' ? payload['schedule'] as Record<string, unknown> : undefined
  const byId = new Map(windows.filter(window => window.live).map(window => [window.id, window.live!]))
  const cleanItem = (input: unknown): unknown => {
    if (!isLiveScheduleCandidate(input)) return input
    const row = input as Record<string, unknown>
    const live = typeof row['id'] === 'string' ? byId.get(row['id'].toLowerCase()) : undefined
    if (!live) return { source_kind: 'LIVE' }
    if (!live.policy) return { id: live.itemId, source_kind: 'LIVE', start_at: live.startAt, end_at: live.endAt,
      priority: live.priority, presentation: null, live_fallback_policy_status: 'INVALID' }
    const policy = live.policy
    return { id: live.itemId, presentation_id: policy.fallback.manifest.presentation.id, source_kind: 'LIVE', live_session_id: policy.live_session_id,
      start_at: live.startAt, end_at: live.endAt, priority: live.priority, screen_ids: policy.screen_ids,
      screen_group_ids: policy.screen_group_ids, resolved_screen_ids: policy.screen_ids, live_policy: policy, presentation: null }
  }
  const clean = { ...payload,
    ...(schedule ? { schedule: { ...schedule, items: Array.isArray(schedule['items']) ? schedule['items'].map(cleanItem) : schedule['items'] } } : {}),
    ...(Array.isArray(payload['items']) ? { items: payload['items'].map(cleanItem) } : {}),
  }
  return nested ? { ...wrapper, [nested]: clean } : clean
}

export function parseSnapshotResponse(raw: unknown, context: { deviceId?: string } = {}): NormalizedSnapshot {
  const wrapper = raw as any
  const payloadCandidate = wrapper?.snapshot || wrapper?.data || raw
  const payload =
    payloadCandidate && typeof payloadCandidate === 'object'
      ? payloadCandidate
      : wrapper && typeof wrapper === 'object'
        ? {}
        : payloadCandidate

  if (!payload || typeof payload !== 'object') {
    throw new Error('Snapshot payload is not an object')
  }

  const snapshot = payload as DeviceSnapshot
  const rootDefaultMedia =
    wrapper?.snapshot && typeof wrapper === 'object' ? wrapper.default_media ?? snapshot.default_media : snapshot.default_media
  const rootEmergency =
    wrapper?.snapshot && typeof wrapper === 'object' ? wrapper.emergency ?? snapshot.emergency : snapshot.emergency
  const mediaCarrier =
    wrapper?.snapshot && typeof wrapper === 'object'
      ? {
          ...snapshot,
          media_urls: wrapper.media_urls ?? snapshot.media_urls,
          mediaUrls: wrapper.mediaUrls ?? snapshot.mediaUrls,
          media: wrapper.media ?? snapshot.media,
          default_media: rootDefaultMedia,
          emergency: rootEmergency,
        }
      : snapshot
  const mediaUrlMap = extractMediaUrlMap(mediaCarrier as DeviceSnapshot)

  const schedule = snapshot.schedule
  const scheduleItems = Array.isArray(schedule?.items) ? schedule.items : []
  const publishId = typeof wrapper?.publish?.publish_id === 'string' ? wrapper.publish.publish_id
    : typeof wrapper?.publish_id === 'string' ? wrapper.publish_id : snapshot.publish_id
  const expectedDeviceId = typeof wrapper?.device_id === 'string' && context.deviceId && wrapper.device_id.toLowerCase() !== context.deviceId.toLowerCase() ? undefined : context.deviceId
  const hasTimedWindowPayload = scheduleItems.some((item) => {
    if (!item || typeof item !== 'object') {
      return false
    }

    return Boolean(item.presentation || item.presentation_id || item.start_at || item.end_at)
  })

  const itemsSource = hasTimedWindowPayload ? snapshot.items : scheduleItems.length > 0 ? scheduleItems : snapshot.items
  const items = (itemsSource || [])
    .filter((item) => !isLiveScheduleCandidate(item))
    .map((item) => normalizeItem(item, mediaUrlMap))
    .filter(Boolean) as TimelineItem[]
  const scheduleWindows = normalizeScheduleWindows(scheduleItems, mediaUrlMap, { publishId, scheduleId: schedule?.id, deviceId: expectedDeviceId })
  const invalidLiveControls = scheduleItems.some(item => isLiveScheduleCandidate(item) && !hasValidLiveWindowControls(item)) ||
    (Array.isArray(snapshot.items) && snapshot.items.some(isLiveScheduleCandidate))

  const emergencyInput = rootEmergency
  const responseServerTime = typeof wrapper?.server_time === 'string' ? Date.parse(wrapper.server_time) : Number.NaN
  const effectiveNow = Number.isFinite(responseServerTime) ? responseServerTime : Date.now()
  const emergencyExpired =
    typeof emergencyInput?.expires_at === 'string' && Number.isFinite(Date.parse(emergencyInput.expires_at))
      ? Date.parse(emergencyInput.expires_at) <= effectiveNow
      : false
  const emergencyActive =
    !emergencyExpired &&
    emergencyInput &&
    (emergencyInput.active === true || emergencyInput.is_active === true || Boolean(emergencyInput.media_url || emergencyInput.url))
  const emergencyCandidate = emergencyActive
    ? normalizeItem(emergencyInput, mediaUrlMap, { emergency: true }) || undefined
    : undefined
  const emergencyItem = emergencyCandidate && (emergencyCandidate.remoteUrl ||
    (emergencyCandidate.type === 'message' && typeof emergencyCandidate.meta?.['emergency_message'] === 'string'))
    ? emergencyCandidate : undefined

  const defaultInput = rootDefaultMedia
  const defaultItem = defaultInput ? normalizeItem(defaultInput, mediaUrlMap) || undefined : undefined

  const normalized: NormalizedSnapshot = {
    publishId,
    snapshotId: snapshot.id || snapshot.snapshot_id || wrapper?.publish?.snapshot_id,
    scheduleId: schedule?.id,
    scheduleTimezone: schedule?.timezone ?? null,
    contentState:
      wrapper?.content_state === 'scheduled' || wrapper?.content_state === 'default' || wrapper?.content_state === 'empty'
        ? wrapper.content_state
        : snapshot.schedule || scheduleItems.length > 0 || items.length > 0
          ? 'scheduled'
          : defaultItem
            ? 'default'
            : 'empty',
    serverTime: typeof wrapper?.server_time === 'string' ? wrapper.server_time : undefined,
    items,
    scheduleWindows,
    emergencyItem,
    emergencyActive: Boolean(emergencyActive),
    invalidLiveControls,
    emergencyExpiresAt: emergencyExpired ? null : emergencyInput?.expires_at ?? null,
    defaultItem,
    mediaUrlMap,
    fetchedAt: snapshot.fetched_at || snapshot.generated_at || new Date().toISOString(),
    raw: sanitizeLiveSnapshot(raw, scheduleWindows),
  }

  logger.debug(
    {
      snapshotId: normalized.snapshotId,
      publishId: normalized.publishId,
      scheduleId: normalized.scheduleId,
      contentState: normalized.contentState,
      itemCount: normalized.items.length,
      scheduleWindowCount: normalized.scheduleWindows.length,
      hasEmergency: Boolean(normalized.emergencyItem),
      hasDefault: Boolean(normalized.defaultItem),
    },
    'Snapshot parsed'
  )

  return normalized
}
