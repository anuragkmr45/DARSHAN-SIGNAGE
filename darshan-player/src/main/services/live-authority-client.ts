import { randomUUID } from 'crypto'
import { readLiveOccurrence, sameLivePolicy, type LiveOccurrence } from '../../common/live-playback'
import type { LiveAdmissionGrant, LiveAdmissionIdentity, LiveAdmissionPending, LiveRunSummary, LiveRuntimeState } from '../../common/live-runtime'
import { DeviceApiError } from '../../common/types'
import { getConfigManager } from '../../common/config'
import { getHttpClient } from './network/http-client'
import type { LiveFallbackReadinessProof } from './live-fallback-cache'
import { createTransportHttpsAgent } from './network/transport-tls'

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function invalid(): never { throw new LiveAuthorityError('INVALID_LIVE_AUTHORITY') }
function row(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const valueRow = value as Record<string, unknown>
  if (Object.keys(valueRow).some(key => !allowed.includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(valueRow, key))) invalid()
  return valueRow
}
function id(value: unknown): string { if (typeof value !== 'string' || !UUID.test(value)) invalid(); return value.toLowerCase() }
function integer(value: unknown, minimum = 1): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid(); return value }
function time(value: unknown): string { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) invalid(); return value }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value }
function string(value: unknown): string { if (typeof value !== 'string' || value.length < 1 || value.length > 8192 || /[\r\n]/.test(value)) invalid(); return value }
function version(value: unknown): string | null { return value === null ? null : string(value) }
function isLocal(hostname: string): boolean { return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(hostname.toLowerCase()) }
export class LiveAuthorityError extends Error {
  constructor(readonly code: string, readonly status?: number) { super('Live authority unavailable'); this.name = 'LiveAuthorityError' }
  get isIdentityFailure(): boolean { return this.status === 401 || this.status === 403 }
}
export type LiveAuthorityRequest = (method: 'GET' | 'POST', pathname: string, body: unknown, signal: AbortSignal) => Promise<unknown>
export type LiveDiscoveredOccurrence = { occurrence: LiveOccurrence; state?: LiveRuntimeState }
export type LiveDiscovery = { server_now: string; authority_epoch: string; live_version: string | null;
  current: LiveDiscoveredOccurrence | null; next: LiveDiscoveredOccurrence | null; blockedWindows: LiveOccurrence[] }
const defaultRequest: LiveAuthorityRequest = async (method, pathname, body, signal) => {
  const client = getHttpClient()
  const trust = getConfigManager().getConfig().transportTls
  const options = { retry: false, timeout: 1500, signal, maxRedirects: 0,
    httpsAgent: createTransportHttpsAgent({ ...trust, strictCertificateValidation: true }) }
  return method === 'GET' ? await client.get(pathname, options) : await client.post(pathname, body, options)
}
function validateBase(base: string, development: boolean): void {
  let url: URL
  try { url = new URL(base) } catch { invalid() }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(development && url.protocol === 'http:' && isLocal(url.hostname)))) invalid()
}
export function validateLiveSignalUrl(value: unknown, development = false): string {
  let url: URL
  try { url = new URL(string(value)) } catch { invalid() }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/') ||
      (url.protocol !== 'wss:' && !(development && url.protocol === 'ws:' && isLocal(url.hostname)))) invalid()
  return url.origin
}
const identityFields = ['version', 'authority_epoch', 'server_now', 'live_version', 'occurrence_id', 'publish_id', 'schedule_item_id', 'run_id', 'generation', 'admission_id', 'role', 'participant_id', 'presenter_participant_id', 'presenter_user_id', 'microphone', 'screen_share_audio']

/** Authenticated REST is authoritative. Every call has one hard total deadline;
 * transport retries and SDK reconnect cannot manufacture an extended lease. */
export class LiveAuthorityClient {
  private epoch?: string
  readonly runtimeSessionId: string
  constructor(private readonly deviceId: string, private readonly options: {
    request?: LiveAuthorityRequest; development?: boolean; apiBase?: string; runtimeSessionId?: string
  } = {}) {
    this.deviceId = id(deviceId)
    this.runtimeSessionId = id(options.runtimeSessionId ?? randomUUID())
    validateBase(options.apiBase ?? getConfigManager().getConfig().apiBase, options.development === true)
  }
  resetEpoch(): void { this.epoch = undefined }
  private base(): string { return `/api/v1/device/${this.deviceId}` }
  private async request(method: 'GET' | 'POST', pathname: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 1500)
    // Race also fences injected/stalled transport implementations which ignore
    // cancellation. The caller's generation fence rejects every late callback.
    let rejectAbort: (() => void) | undefined
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new LiveAuthorityError('LIVE_AUTHORITY_TIMEOUT'))
      if (controller.signal.aborted) rejectAbort()
      else controller.signal.addEventListener('abort', rejectAbort, { once: true })
    })
    try {
      if (controller.signal.aborted) { await cancelled }
      return await Promise.race([(this.options.request ?? defaultRequest)(method, pathname, body, controller.signal), cancelled])
    }
    catch (error) {
      if (error instanceof LiveAuthorityError) throw error
      if (error instanceof DeviceApiError) throw new LiveAuthorityError(String(error.code), error.status)
      throw new LiveAuthorityError('LIVE_AUTHORITY_UNAVAILABLE')
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
    }
  }
  async authenticateEpoch(signal?: AbortSignal): Promise<string> {
    const nonce = randomUUID()
    const value = row(await this.request('POST', `${this.base()}/live-authority-epoch`, { nonce }, signal), ['version', 'nonce', 'epoch_id', 'server_now'])
    if (value['version'] !== 1 || id(value['nonce']) !== nonce) invalid()
    time(value['server_now'])
    this.epoch = id(value['epoch_id'])
    return this.epoch
  }
  private checkEpoch(value: unknown): string { const epoch = id(value); if (epoch !== this.epoch) throw new LiveAuthorityError('LIVE_AUTHORITY_EPOCH_CHANGED'); return epoch }
  async state(occurrence: LiveOccurrence, signal?: AbortSignal): Promise<LiveRuntimeState> {
    if (!this.epoch) await this.authenticateEpoch(signal)
    const query = new URLSearchParams({ publish_id: occurrence.publishId, schedule_item_id: occurrence.itemId, runtime_session_id: this.runtimeSessionId })
    return this.readState(await this.request('GET', `${this.base()}/live-state?${query}`, undefined, signal), occurrence)
  }
  private readState(raw: unknown, occurrence: LiveOccurrence): LiveRuntimeState {
    const value = row(raw, ['version', 'authority_epoch', 'server_now', 'live_version', 'availability', 'occurrence_id', 'publish_id', 'schedule_id', 'schedule_item_id', 'start_at', 'end_at', 'screen_ids', 'control_revision', 'enabled', 'policy_status', 'policy', 'run'])
    const availability = value['availability'] as LiveRuntimeState['availability']
    const screenIds = this.audience(value['screen_ids'])
    const policyStatus = value['policy_status']
    if (value['version'] !== 1 || !['READY', 'NOT_RUNNING', 'PREPARING', 'STOPPING', 'DISABLED', 'ENDED', 'EMERGENCY', 'UNAVAILABLE'].includes(availability) ||
      id(value['publish_id']) !== occurrence.publishId || id(value['schedule_id']) !== occurrence.scheduleId || id(value['schedule_item_id']) !== occurrence.itemId ||
      Date.parse(time(value['start_at'])) !== Date.parse(occurrence.startAt) || Date.parse(time(value['end_at'])) !== Date.parse(occurrence.endAt) ||
      !['VALID', 'INVALID'].includes(String(policyStatus)) || (policyStatus === 'VALID' && (!occurrence.policy || !sameLivePolicy(value['policy'], occurrence.policy)))) invalid()
    let run: LiveRunSummary | null = null
    if (value['run'] !== null) {
      const item = row(value['run'], ['id', 'generation', 'state', 'node_instance_id', 'presenter_participant_id', 'created_at', 'stopped_at', 'owns_current_attempt'])
      const runId = id(item['id']), state = item['state'] as LiveRunSummary['state']
      if (!['PREPARING', 'RUNNING', 'STOPPING', 'STOPPED'].includes(state) || item['presenter_participant_id'] !== `presenter_${runId}`) invalid()
      run = { id: runId, generation: integer(item['generation']), state, node_instance_id: id(item['node_instance_id']),
        presenter_participant_id: String(item['presenter_participant_id']), created_at: time(item['created_at']),
        stopped_at: item['stopped_at'] === null ? null : time(item['stopped_at']), owns_current_attempt: bool(item['owns_current_attempt']) }
    }
    return { version: 1, authority_epoch: this.checkEpoch(value['authority_epoch']), server_now: time(value['server_now']), live_version: version(value['live_version']),
      availability, occurrence_id: id(value['occurrence_id']), publish_id: occurrence.publishId, schedule_item_id: occurrence.itemId,
      schedule_id: occurrence.scheduleId, start_at: occurrence.startAt, end_at: occurrence.endAt, screen_ids: screenIds,
      control_revision: integer(value['control_revision']), enabled: bool(value['enabled']), policy_status: policyStatus as 'VALID' | 'INVALID',
      policy: policyStatus === 'VALID' ? occurrence.policy! : null, run }
  }
  private audience(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.length > 25) invalid()
    const ids = value.map(id)
    if (new Set(ids).size !== ids.length || !ids.includes(this.deviceId)) invalid()
    return ids
  }
  async discover(signal?: AbortSignal): Promise<LiveDiscovery> {
    if (!this.epoch) await this.authenticateEpoch(signal)
    const value = row(await this.request('GET', `${this.base()}/live-occurrences?runtime_session_id=${this.runtimeSessionId}`, undefined, signal), ['version', 'authority_epoch', 'server_now', 'live_version', 'current', 'next', 'blocked_windows'])
    if (value['version'] !== 1) invalid()
    const serverNow = time(value['server_now']), now = Date.parse(serverNow)
    const parseEntry = (raw: unknown, current: boolean): LiveDiscoveredOccurrence | null => {
      if (raw === null) return null
      const entry = row(raw, ['state', 'item'])
      const state = entry['state'] as Record<string, unknown> | null
      const occurrence: LiveOccurrence = entry['item'] === null
        ? { publishId: id(state?.['publish_id']), scheduleId: id(state?.['schedule_id']), itemId: id(state?.['schedule_item_id']), startAt: time(state?.['start_at']), endAt: time(state?.['end_at']), priority: 0, downloads: [], invalidReason: 'INVALID_LIVE_POLICY' } satisfies LiveOccurrence
        : readLiveOccurrence(entry['item'], { publishId: id(state?.['publish_id']), scheduleId: id(state?.['schedule_id']), deviceId: this.deviceId })
      if (Date.parse(occurrence.endAt) <= now || (current ? Date.parse(occurrence.startAt) > now : Date.parse(occurrence.startAt) <= now)) invalid()
      const parsed = this.readState(state, occurrence)
      if (parsed.policy_status === 'INVALID') { occurrence.policy = undefined; occurrence.downloads = []; occurrence.invalidReason = 'INVALID_LIVE_POLICY' }
      return { occurrence, state: parsed }
    }
    if (!Array.isArray(value['blocked_windows'])) invalid()
    const blockedWindows = value['blocked_windows'].map(input => {
      const window = row(input, ['occurrence_id', 'publish_id', 'schedule_id', 'schedule_item_id', 'start_at', 'end_at', 'screen_ids'])
      id(window['occurrence_id']); this.audience(window['screen_ids'])
      const start = time(window['start_at']), end = time(window['end_at'])
      if (!(Date.parse(start) <= now && now < Date.parse(end))) invalid()
      return { publishId: id(window['publish_id']), scheduleId: id(window['schedule_id']), itemId: id(window['schedule_item_id']), startAt: start, endAt: end,
        priority: 0, downloads: [], invalidReason: 'CONFLICTING_LIVE_WINDOWS' } satisfies LiveOccurrence
    })
    if (blockedWindows.length && value['current'] !== null) invalid()
    return { server_now: serverNow, authority_epoch: this.checkEpoch(value['authority_epoch']), live_version: version(value['live_version']),
      current: parseEntry(value['current'], true), next: parseEntry(value['next'], false), blockedWindows }
  }
  private identity(value: Record<string, unknown>, occurrence: LiveOccurrence, run: { id: string; generation: number }): LiveAdmissionIdentity {
    const policy = occurrence.policy
    if (!policy || value['version'] !== 1 || value['role'] !== 'receiver' || id(value['publish_id']) !== occurrence.publishId || id(value['schedule_item_id']) !== occurrence.itemId ||
      id(value['run_id']) !== run.id || integer(value['generation']) !== run.generation || id(value['presenter_user_id']) !== policy.presenter_user_id ||
      value['presenter_participant_id'] !== `presenter_${run.id}` || value['microphone'] !== policy.microphone || value['screen_share_audio'] !== policy.screen_share_audio) invalid()
    const admissionId = id(value['admission_id'])
    // The server derives participant identity; it must remain bound to this
    // receiver admission and cannot impersonate the approved presenter.
    const participant = string(value['participant_id'])
    if (participant !== `receiver_${this.deviceId}_${this.runtimeSessionId}`) invalid()
    return { version: 1, authority_epoch: this.checkEpoch(value['authority_epoch']), server_now: time(value['server_now']), live_version: version(value['live_version']),
      occurrence_id: id(value['occurrence_id']), publish_id: occurrence.publishId, schedule_item_id: occurrence.itemId, run_id: run.id,
      generation: run.generation, admission_id: admissionId, role: 'receiver', participant_id: participant,
      presenter_participant_id: String(value['presenter_participant_id']), presenter_user_id: policy.presenter_user_id,
      microphone: policy.microphone, screen_share_audio: policy.screen_share_audio }
  }
  async create(occurrence: LiveOccurrence, run: { id: string; generation: number }, proof: LiveFallbackReadinessProof, signal?: AbortSignal): Promise<LiveAdmissionPending> {
    const value = row(await this.request('POST', `${this.base()}/live-admissions`, { publish_id: occurrence.publishId, schedule_item_id: occurrence.itemId,
      runtime_session_id: this.runtimeSessionId, request_id: randomUUID(), run_id: run.id, generation: run.generation, fallback: proof }, signal), [...identityFields, 'status', 'retry_after_ms'])
    if (!['PREPARING', 'READY'].includes(String(value['status'])) || value['retry_after_ms'] !== 500) invalid()
    return { ...this.identity(value, occurrence, run), status: value['status'] as LiveAdmissionPending['status'], retry_after_ms: 500 }
  }
  async grant(action: 'ticket' | 'renew', occurrence: LiveOccurrence, admission: LiveAdmissionIdentity, proof: LiveFallbackReadinessProof, signal?: AbortSignal): Promise<LiveAdmissionGrant> {
    const value = row(await this.request('POST', `${this.base()}/live-admissions/${admission.admission_id}/${action}`, { request_id: randomUUID(), runtime_session_id: this.runtimeSessionId,
      run_id: admission.run_id, generation: admission.generation, fallback: proof }, signal), [...identityFields, 'status', 'lease_ms', 'window_remaining_ms', 'renew_after_ms', 'signaling'], [...identityFields, 'status', 'lease_ms', 'window_remaining_ms', 'renew_after_ms'])
    const identity = this.identity(value, occurrence, { id: admission.run_id, generation: admission.generation })
    if (identity.admission_id !== admission.admission_id || identity.occurrence_id !== admission.occurrence_id || identity.participant_id !== admission.participant_id ||
      value['status'] !== 'AUTHORIZED' || integer(value['lease_ms']) > 10000 || value['renew_after_ms'] !== 3000 ||
      (action === 'renew' && value['signaling'] !== undefined) || (action === 'ticket' && value['signaling'] === undefined)) invalid()
    let signaling: LiveAdmissionGrant['signaling']
    if (value['signaling'] !== undefined) {
      const signalRow = row(value['signaling'], ['url', 'ticket'])
      signaling = { url: validateLiveSignalUrl(signalRow['url'], this.options.development === true), ticket: string(signalRow['ticket']) }
    }
    return { ...identity, status: 'AUTHORIZED', lease_ms: integer(value['lease_ms']), window_remaining_ms: integer(value['window_remaining_ms']), renew_after_ms: 3000, ...(signaling ? { signaling } : {}) }
  }
  async observe(admission: LiveAdmissionIdentity, observation: { sequence: number; connection: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'; subscription: 'NONE' | 'SUBSCRIBING' | 'SUBSCRIBED'; frame: 'NONE' | 'READY'; audio: 'NONE' | 'READY' | 'DEGRADED' | 'MUTED'; fallback_ready: boolean; fallback_reason: string | null }, signal?: AbortSignal): Promise<void> {
    await this.request('POST', `${this.base()}/live-admissions/${admission.admission_id}/observations`, { runtime_session_id: this.runtimeSessionId,
      run_id: admission.run_id, generation: admission.generation, ...observation }, signal)
  }
}
