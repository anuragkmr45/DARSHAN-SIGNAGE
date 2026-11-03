/** Immutable scheduled LIVE data. Runtime tickets/leases never belong here. */
export type LiveJson = null | boolean | number | string | LiveJson[] | { [key: string]: LiveJson }
export type LiveFallbackAsset = {
  id: string; media_id: string; storage_object_id: string; bucket: string; object_key: string
  sha256: string; size: number; content_type: string; render_type: 'image' | 'video' | 'pdf'
  representation: string; dependencies?: string[]; cache_key: string
}
export type LiveFallbackEntry = {
  id: string; slot_id?: string; order: number; asset_id: string; duration_seconds?: number
  page_number?: number; fit_mode?: 'contain' | 'cover' | 'stretch'; audio_enabled?: boolean; loop_enabled?: boolean
}
export type LiveFallbackManifest = {
  version: 1
  presentation: { id: string; layout?: { id: string; aspect_ratio: string; spec: LiveJson } | null; items: LiveFallbackEntry[] }
  assets: LiveFallbackAsset[]
}
export type FrozenLivePolicy = {
  version: 1; source_kind: 'LIVE'; schedule_id: string; schedule_item_id: string; schedule_revision: number
  live_session_id: string; presenter_user_id: string; policy_revision: number; microphone: boolean; screen_share_audio: boolean
  start_at: string; end_at: string; priority: number; screen_ids: string[]; screen_group_ids: string[]
  fallback: { preparation_id: string; source_fingerprint: string; manifest: LiveFallbackManifest }
}
export type LiveFallbackDownload = { asset_id: string; cache_key: string; sha256: string; size: number; content_type: string; url: string; expires_at?: string }
export type LiveOccurrence = {
  publishId: string; scheduleId: string; itemId: string; startAt: string; endAt: string; priority: number
  policy?: FrozenLivePolicy; downloads: LiveFallbackDownload[]; invalidReason?: string
}
export type LivePlaybackPhase = 'UNAVAILABLE' | 'PREPARING_FALLBACK' | 'FALLBACK' | 'CONNECTING' | 'LIVE' | 'SUSPENDED'
export type LivePlaybackStatus = {
  phase: LivePlaybackPhase; reason?: string; publishId?: string; scheduleItemId?: string
  runId?: string; generation?: number; admissionId?: string; fallbackReady: boolean
}

/** JSON object property order is not part of the immutable policy contract. */
export function sameLivePolicy(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]]
  while (pending.length) {
    const [a, b] = pending.pop()!
    if (a === b) continue
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
    const aKeys = Object.keys(a).sort(), bKeys = Object.keys(b).sort()
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) return false
    for (const key of aKeys) pending.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]])
  }
  return true
}

// Match the Backend's z.string().uuid() wire contract, including legacy UUIDs.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA = /^[a-f0-9]{64}$/
const MIME_KIND: Record<string, LiveFallbackAsset['render_type']> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video', 'application/pdf': 'pdf',
}
function fail(): never { throw new Error('Invalid immutable live policy') }
function object(value: unknown, keys: string[], required = keys): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !keys.includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(row, key))) fail()
  return row
}
function uuid(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase() }
function text(value: unknown): string { if (typeof value !== 'string' || !value || value.trim() !== value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) fail(); return value }
function integer(value: unknown, minimum = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(); return value }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') fail(); return value }
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail()
  return value
}
function digest(value: unknown): string { if (typeof value !== 'string' || !SHA.test(value)) fail(); return value }
function ids(value: unknown, nonempty = false): string[] {
  if (!Array.isArray(value) || (nonempty && !value.length)) fail()
  const result = value.map(uuid)
  if (new Set(result).size !== result.length) fail()
  return result
}
const UNSAFE_JSON_KEYS = new Set(['ticket', 'token', 'access_token', 'refresh_token', 'renewal_token', 'signal_url', 'authorization', 'cookie', 'password', 'secret', 'credentials', 'source_url', 'download_url', 'playback_url', 'presigned_url'])
function cloneLayout(value: unknown): LiveJson {
  const validPrimitive = (item: unknown): item is null | boolean | number | string => {
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item)
    return typeof item === 'string' && !/^https?:\/\/.*[?&](?:x-amz-|x-goog-|signature=|sig=|token=|access_token=)/i.test(item)
  }
  if (validPrimitive(value)) return value
  if (!value || typeof value !== 'object') fail()
  const target: LiveJson[] | Record<string, LiveJson> = Array.isArray(value) ? [] : Object.create(null)
  const pending: Array<{ source: object; target: LiveJson[] | Record<string, LiveJson>; leaving?: boolean }> = [{ source: value, target }]
  const ancestors = new Set<object>()
  while (pending.length) {
    const node = pending.pop()!
    if (node.leaving) { ancestors.delete(node.source); continue }
    if (ancestors.has(node.source) || (!Array.isArray(node.source) && ![Object.prototype, null].includes(Object.getPrototypeOf(node.source)))) fail()
    ancestors.add(node.source)
    pending.push({ ...node, leaving: true })
    for (const [key, child] of Object.entries(node.source)) {
      if (UNSAFE_JSON_KEYS.has(key.toLowerCase())) fail()
      if (validPrimitive(child)) (node.target as Record<string, LiveJson>)[key] = child
      else {
        if (!child || typeof child !== 'object') fail()
        const copy: LiveJson[] | Record<string, LiveJson> = Array.isArray(child) ? [] : Object.create(null)
        ;(node.target as Record<string, LiveJson>)[key] = copy
        pending.push({ source: child, target: copy })
      }
    }
  }
  return target
}

export function readLiveFallbackManifest(value: unknown, presentationId: string): LiveFallbackManifest {
  const row = object(value, ['version', 'presentation', 'assets'])
  if (row['version'] !== 1 || !Array.isArray(row['assets']) || !row['assets'].length) fail()
  const presentation = object(row['presentation'], ['id', 'layout', 'items'], ['id', 'items'])
  if (uuid(presentation['id']) !== uuid(presentationId) || !Array.isArray(presentation['items']) || !presentation['items'].length) fail()
  const assets = row['assets'].map((input): LiveFallbackAsset => {
    const asset = object(input, ['id', 'media_id', 'storage_object_id', 'bucket', 'object_key', 'sha256', 'size', 'content_type', 'render_type', 'representation', 'dependencies', 'cache_key'], ['id', 'media_id', 'storage_object_id', 'bucket', 'object_key', 'sha256', 'size', 'content_type', 'render_type', 'representation', 'cache_key'])
    const sha256 = digest(asset['sha256']), contentType = text(asset['content_type'])
    const renderType = MIME_KIND[contentType]
    if (!renderType || renderType !== asset['render_type'] || asset['cache_key'] !== `live_${sha256}_${renderType}`) fail()
    const key = text(asset['object_key']), bucket = text(asset['bucket']), representation = text(asset['representation'])
    const prefix = `live-fallbacks/v1/sha256/${sha256}.`
    if (!key.startsWith(prefix) || !/^[a-z0-9]+$/.test(key.slice(prefix.length)) || /[:/?#]/.test(bucket) || !/^[a-z0-9_]+$/i.test(representation)) fail()
    return { id: uuid(asset['id']), media_id: uuid(asset['media_id']), storage_object_id: uuid(asset['storage_object_id']), bucket, object_key: key,
      sha256, size: integer(asset['size'], 1), content_type: contentType, render_type: renderType, representation,
      ...(asset['dependencies'] !== undefined ? { dependencies: ids(asset['dependencies']) } : {}), cache_key: String(asset['cache_key']) }
  })
  const byId = new Map(assets.map(asset => [asset.id, asset]))
  if (byId.size !== assets.length) fail()
  const items = presentation['items'].map((input): LiveFallbackEntry => {
    const entry = object(input, ['id', 'slot_id', 'order', 'asset_id', 'duration_seconds', 'page_number', 'fit_mode', 'audio_enabled', 'loop_enabled'], ['id', 'order', 'asset_id'])
    const assetId = uuid(entry['asset_id']), asset = byId.get(assetId)
    if (!asset || (entry['page_number'] !== undefined && asset.render_type !== 'pdf')) fail()
    if (entry['fit_mode'] !== undefined && !['contain', 'cover', 'stretch'].includes(String(entry['fit_mode']))) fail()
    return { id: uuid(entry['id']), order: integer(entry['order']), asset_id: assetId,
      ...(entry['slot_id'] !== undefined ? { slot_id: text(entry['slot_id']) } : {}),
      ...(entry['duration_seconds'] !== undefined ? { duration_seconds: integer(entry['duration_seconds'], 1) } : {}),
      ...(entry['page_number'] !== undefined ? { page_number: integer(entry['page_number'], 1) } : {}),
      ...(entry['fit_mode'] !== undefined ? { fit_mode: entry['fit_mode'] as LiveFallbackEntry['fit_mode'] } : {}),
      ...(entry['audio_enabled'] !== undefined ? { audio_enabled: bool(entry['audio_enabled']) } : {}),
      ...(entry['loop_enabled'] !== undefined ? { loop_enabled: bool(entry['loop_enabled']) } : {}) }
  })
  if (new Set(items.map(item => item.id)).size !== items.length) fail()
  // Closed, reachable dependency DAG; iterative traversal has no depth/item cap.
  const state = new Map<string, number>()
  for (const item of items) {
    const pending = [{ id: item.asset_id, leaving: false }]
    while (pending.length) {
      const next = pending.pop()!
      if (next.leaving) { state.set(next.id, 2); continue }
      if (state.get(next.id) === 2) continue
      if (state.get(next.id) === 1) fail()
      const asset = byId.get(next.id)
      if (!asset) fail()
      state.set(next.id, 1); pending.push({ ...next, leaving: true })
      for (const dependency of asset.dependencies ?? []) pending.push({ id: dependency, leaving: false })
    }
  }
  if (state.size !== assets.length) fail()
  let layout: LiveFallbackManifest['presentation']['layout']
  if (presentation['layout'] === null) layout = null
  else if (presentation['layout'] !== undefined) {
    const input = object(presentation['layout'], ['id', 'aspect_ratio', 'spec'])
    layout = { id: uuid(input['id']), aspect_ratio: text(input['aspect_ratio']), spec: cloneLayout(input['spec']) }
  }
  return { version: 1, presentation: { id: uuid(presentation['id']), items, ...(layout !== undefined ? { layout } : {}) }, assets }
}

export function isLiveScheduleCandidate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return item['source_kind'] === 'LIVE' || item['live_policy'] !== undefined || item['live_session_id'] != null
}
export function hasValidLiveWindowControls(value: unknown): boolean {
  try {
    const item = value as Record<string, unknown>
    uuid(item['id']); instant(item['start_at']); instant(item['end_at'])
    integer(item['priority'], Number.MIN_SAFE_INTEGER)
    return Date.parse(String(item['start_at'])) < Date.parse(String(item['end_at']))
  } catch { return false }
}
export function readLiveOccurrence(value: unknown, context: { publishId?: string; scheduleId?: string; deviceId?: string }): LiveOccurrence {
  if (!hasValidLiveWindowControls(value)) fail()
  const input = value as Record<string, unknown>
  const result: LiveOccurrence = { publishId: (context.publishId ?? '').toLowerCase(), scheduleId: (context.scheduleId ?? '').toLowerCase(), itemId: uuid(input['id']),
    startAt: instant(input['start_at']), endAt: instant(input['end_at']), priority: integer(input['priority'], Number.MIN_SAFE_INTEGER), downloads: [] }
  try {
    uuid(result.publishId); uuid(result.scheduleId)
    const row = object(input, ['id', 'presentation_id', 'source_kind', 'live_session_id', 'start_at', 'end_at', 'priority', 'screen_ids', 'screen_group_ids', 'resolved_screen_ids', 'live_policy', 'presentation', 'live_fallback_downloads', 'live_fallback_download_status', 'live_fallback_policy_status'], ['id', 'presentation_id', 'source_kind', 'live_session_id', 'start_at', 'end_at', 'priority', 'screen_ids', 'screen_group_ids', 'resolved_screen_ids', 'live_policy', 'presentation'])
    const policy = object(row['live_policy'], ['version', 'source_kind', 'schedule_id', 'schedule_item_id', 'schedule_revision', 'live_session_id', 'presenter_user_id', 'policy_revision', 'microphone', 'screen_share_audio', 'start_at', 'end_at', 'priority', 'screen_ids', 'screen_group_ids', 'fallback'])
    if (row['source_kind'] !== 'LIVE' || row['presentation'] !== null || policy['version'] !== 1 || policy['source_kind'] !== 'LIVE' || row['live_fallback_policy_status'] !== undefined) fail()
    const fallback = object(policy['fallback'], ['preparation_id', 'source_fingerprint', 'manifest'])
    const parsed: FrozenLivePolicy = { version: 1, source_kind: 'LIVE', schedule_id: uuid(policy['schedule_id']), schedule_item_id: uuid(policy['schedule_item_id']),
      schedule_revision: integer(policy['schedule_revision'], 1), live_session_id: uuid(policy['live_session_id']), presenter_user_id: uuid(policy['presenter_user_id']),
      policy_revision: integer(policy['policy_revision'], 1), microphone: bool(policy['microphone']), screen_share_audio: bool(policy['screen_share_audio']),
      start_at: instant(policy['start_at']), end_at: instant(policy['end_at']), priority: integer(policy['priority'], Number.MIN_SAFE_INTEGER), screen_ids: ids(policy['screen_ids'], true), screen_group_ids: ids(policy['screen_group_ids']),
      fallback: { preparation_id: uuid(fallback['preparation_id']), source_fingerprint: digest(fallback['source_fingerprint']), manifest: readLiveFallbackManifest(fallback['manifest'], uuid(row['presentation_id'])) } }
    if (parsed.screen_ids.length > 25 || parsed.schedule_id !== result.scheduleId.toLowerCase() || parsed.schedule_item_id !== result.itemId || parsed.live_session_id !== uuid(row['live_session_id']) ||
        parsed.priority !== result.priority || Date.parse(parsed.start_at) !== Date.parse(result.startAt) || Date.parse(parsed.end_at) !== Date.parse(result.endAt) ||
        JSON.stringify(parsed.screen_ids) !== JSON.stringify(ids(row['resolved_screen_ids'], true)) || JSON.stringify(parsed.screen_group_ids) !== JSON.stringify(ids(row['screen_group_ids'])) ||
        !parsed.screen_ids.includes(uuid(context.deviceId))) fail()
    ids(row['screen_ids'])
    result.policy = parsed
    // Transport failure cannot revoke an already verified local artifact.
    try {
      if (row['live_fallback_download_status'] !== 'AVAILABLE' || !Array.isArray(row['live_fallback_downloads'])) throw new Error()
      const assets = new Map(parsed.fallback.manifest.assets.map(asset => [asset.id, asset]))
      const downloads = row['live_fallback_downloads'].map((entry): LiveFallbackDownload => {
        const download = object(entry, ['asset_id', 'cache_key', 'sha256', 'size', 'content_type', 'url', 'expires_at'], ['asset_id', 'cache_key', 'sha256', 'size', 'content_type', 'url'])
        const id = uuid(download['asset_id']), asset = assets.get(id), url = new URL(text(download['url']))
        if (!asset || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || download['cache_key'] !== asset.cache_key || download['sha256'] !== asset.sha256 || download['size'] !== asset.size || download['content_type'] !== asset.content_type) fail()
        return { asset_id: id, cache_key: asset.cache_key, sha256: asset.sha256, size: asset.size, content_type: asset.content_type, url: url.toString(),
          ...(download['expires_at'] !== undefined ? { expires_at: instant(download['expires_at']) } : {}) }
      })
      if (downloads.length !== assets.size || new Set(downloads.map(download => download.asset_id)).size !== assets.size) throw new Error()
      result.downloads = downloads
    } catch { result.downloads = [] }
  } catch { result.invalidReason = 'INVALID_LIVE_POLICY' }
  return result
}
