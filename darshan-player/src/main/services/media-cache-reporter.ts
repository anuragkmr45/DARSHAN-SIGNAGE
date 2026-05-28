import { createHash } from 'crypto'
import { getLogger } from '../../common/logger'
import { getConfigManager } from '../../common/config'
import { CacheError, PlaybackMode } from '../../common/types'
import { getHttpClient } from './network/http-client'
import { getRequestQueue } from './network/request-queue'
import { getPairingService } from './pairing-service'

const logger = getLogger('media-cache-reporter')

export type MediaCacheReportEventType =
  | 'URL_EXPIRED'
  | 'DOWNLOAD_FAILED'
  | 'CHECKSUM_MISMATCH'
  | 'DISK_FULL'
  | 'CACHE_EVICTION_FAILED'
  | 'CACHE_WRITE_FAILED'
  | 'CACHE_MISS'
  | 'PLAYBACK_ERROR'
  | 'UNKNOWN'

export type MediaCacheReportSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'
export type MediaCacheReportSource =
  | 'SNAPSHOT'
  | 'DEFAULT_MEDIA'
  | 'EMERGENCY'
  | 'PLAYBACK'
  | 'PREFETCH'
  | 'CACHE'
  | 'RENDERER'

export interface MediaCacheReportInput {
  eventType?: MediaCacheReportEventType
  severity?: MediaCacheReportSeverity
  source?: MediaCacheReportSource
  mediaId?: string
  error?: unknown
  errorCode?: string
  httpStatus?: number
  message?: string
  cacheKey?: string
  url?: string
  snapshotId?: string
  scheduleId?: string
  defaultMediaVersion?: string
  playbackMode?: PlaybackMode
  attemptCount?: number
  metadata?: Record<string, unknown>
  reportedAt?: string
}

export interface MediaCacheReportResult {
  sent: boolean
  queued: boolean
  disabled?: boolean
  skipped?: boolean
  id?: string
}

function sanitizeUrl(url?: string): { url_host?: string; url_path_hash?: string } {
  if (!url) {
    return {}
  }

  try {
    const parsed = new URL(url)
    return {
      url_host: parsed.host,
      url_path_hash: createHash('sha256').update(`${parsed.pathname}${parsed.search}`).digest('hex'),
    }
  } catch {
    return {
      url_path_hash: createHash('sha256').update(url).digest('hex'),
    }
  }
}

function normalizeError(input: MediaCacheReportInput): {
  eventType: MediaCacheReportEventType
  errorCode?: string
  httpStatus?: number
  message?: string
  metadata?: Record<string, unknown>
} {
  const error = input.error
  const details =
    error instanceof CacheError && error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>)
      : {}

  const reason = typeof details['reason'] === 'string' ? details['reason'] : undefined
  const status = typeof details['status'] === 'number' ? details['status'] : input.httpStatus
  const message =
    input.message ||
    (error instanceof Error ? error.message : typeof error === 'string' ? error : undefined) ||
    'Media/cache failure'

  let eventType = input.eventType
  if (!eventType) {
    if (reason === 'URL_EXPIRED' || status === 401 || status === 403) {
      eventType = 'URL_EXPIRED'
    } else if (reason === 'INSUFFICIENT_SPACE') {
      eventType = 'DISK_FULL'
    } else if (message.toLowerCase().includes('integrity')) {
      eventType = 'CHECKSUM_MISMATCH'
    } else {
      eventType = 'DOWNLOAD_FAILED'
    }
  }

  return {
    eventType,
    errorCode: input.errorCode || reason || (status ? `HTTP_${status}` : undefined),
    httpStatus: status,
    message,
    metadata: {
      ...(input.metadata ?? {}),
      ...(Object.keys(details).length > 0
        ? {
            cache_error_details: details,
          }
        : {}),
    },
  }
}

export async function reportMediaCacheFailure(input: MediaCacheReportInput): Promise<MediaCacheReportResult> {
  const config = getConfigManager().getConfig()
  if (config.observability.enabled === false || config.observability.mediaCacheReportingEnabled === false) {
    return { sent: false, queued: false, disabled: true }
  }

  const deviceId = getPairingService().getDeviceId()
  if (!deviceId) {
    logger.debug({ mediaId: input.mediaId }, 'Skipping media/cache report without paired device id')
    return { sent: false, queued: false, skipped: true }
  }

  const normalized = normalizeError(input)
  const urlFields = sanitizeUrl(input.url)
  const payload = {
    event_type: normalized.eventType,
    severity: input.severity || 'ERROR',
    source: input.source || 'CACHE',
    media_id: input.mediaId,
    error_code: normalized.errorCode,
    http_status: normalized.httpStatus,
    message: normalized.message,
    cache_key: input.cacheKey || input.mediaId,
    url_host: urlFields.url_host,
    url_path_hash: urlFields.url_path_hash,
    snapshot_id: input.snapshotId,
    schedule_id: input.scheduleId,
    default_media_version: input.defaultMediaVersion,
    playback_mode: input.playbackMode,
    attempt_count: input.attemptCount,
    metadata: normalized.metadata,
    reported_at: input.reportedAt || new Date().toISOString(),
  }
  const url = `/api/v1/device/${encodeURIComponent(deviceId)}/media-cache-report`

  try {
    const response = await getHttpClient().post<{ id?: string }>(url, payload, {
      retry: false,
    })
    return { sent: true, queued: false, id: response?.id }
  } catch (error) {
    const queued = await getRequestQueue().enqueue({
      method: 'POST',
      url,
      data: payload,
      maxRetries: 10,
    })
    logger.warn(
      {
        mediaId: input.mediaId,
        eventType: payload.event_type,
        queued,
        error,
      },
      'Queued media/cache failure report after immediate send failed'
    )
    return { sent: false, queued }
  }
}
