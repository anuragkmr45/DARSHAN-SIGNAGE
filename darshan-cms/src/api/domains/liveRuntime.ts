import { z } from 'zod';
import { ApiError, apiClient } from '../apiClient';
import { endpoints } from '../endpoints';
import { createUuid } from '@/lib/uuid';
import { liveUuidSchema, liveRuntimeOccurrenceSchema, liveRuntimeListSchema, liveRuntimePreflightSchema, liveEpochResponseSchema,
  liveStartInputSchema, liveControlInputSchema, liveStopInputSchema, liveAdmissionActionInputSchema,
  livePresenterAdmissionInputSchema, liveAdmissionPendingSchema, liveAdmissionGrantSchema, liveObservationInputSchema,
  liveObservationResultSchema, type LiveRuntimeListParams, type LiveStartInput, type LiveStopInput, type LiveControlInput,
  type LivePresenterAdmissionInput, type LiveAdmissionActionInput, type LiveObservationInput, type LiveRuntimeActionResult,
  type LiveRuntimeOccurrence, type LiveRuntimePreflight, type LiveEpochResponse, type LiveRuntimeList, type LiveAdmissionGrant, type LiveAdmissionPending, type LiveObservationResult } from '../liveRuntimeTypes';

const paths = endpoints.liveRuntime;
const invalid = (request = false) => new ApiError({ status: request ? 422 : 502, code: request ? 'LIVE_REQUEST_INVALID' : 'LIVE_RESPONSE_INVALID',
  message: request ? 'The live request is invalid. Reload and review the current state.' : 'The live response could not be verified. Reload before continuing.' });
function parse<T>(schema: z.ZodTypeAny, value: unknown, request = false): T { const result = schema.safeParse(value); if (!result.success) throw invalid(request); return result.data as T; }
const id = (value: string) => parse<string>(liveUuidSchema, value, true);
const listInput = z.object({ runtime_session_id: liveUuidSchema.optional(), page: z.number().int().positive(), page_size: z.number().int().min(1).max(100),
  from: z.string().datetime({ offset: true }), until: z.string().datetime({ offset: true }) }).strict().refine(value => Date.parse(value.until) > Date.parse(value.from) && Date.parse(value.until) - Date.parse(value.from) <= 366 * 86_400_000);
async function fresh<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 1500): Promise<T> {
  const controller = new AbortController(), cancel = () => controller.abort();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  let abort: () => void = () => {};
  const failed = new Promise<never>((_, reject) => { abort = () => reject(new ApiError({ status: 408, code: 'LIVE_AUTHORITY_TIMEOUT', message: 'Fresh live authority could not be confirmed. Retry only after checking the current state.' }));
    if (controller.signal.aborted) abort(); else controller.signal.addEventListener('abort', abort, { once: true }); });
  const timer = setTimeout(cancel, timeoutMs);
  try { return await Promise.race([operation(controller.signal), failed]); }
  catch (error) {
    // Never surface a raw backend/transport message which might accidentally
    // include a signaling URL, ticket or authorization header.
    if (error instanceof ApiError && ['LIVE_RESPONSE_INVALID', 'LIVE_REQUEST_INVALID', 'LIVE_AUTHORITY_TIMEOUT'].includes(error.code ?? '')) throw error;
    throw new ApiError({ status: error instanceof ApiError ? error.status : 503,
      code: error instanceof ApiError && /^[A-Z0-9_]{1,80}$/.test(error.code ?? '') ? error.code : 'LIVE_AUTHORITY_UNAVAILABLE',
      message: 'Fresh live authority was not confirmed. Check current state before retrying.' });
  }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', abort); controller.abort(); }
}
async function action(path: string, payload: unknown, expectedId: string, signal?: AbortSignal): Promise<LiveRuntimeActionResult> {
  const raw = await apiClient.request({ path, method: 'POST', body: payload, signal });
  if (!raw || typeof raw !== 'object' || typeof (raw as { idempotent?: unknown }).idempotent !== 'boolean') throw invalid();
  const { idempotent, ...summary } = raw as Record<string, unknown> & { idempotent: boolean };
  const result = parse<LiveRuntimeOccurrence>(liveRuntimeOccurrenceSchema, summary);
  if (result.id !== expectedId) throw invalid();
  return { ...result, idempotent };
}
async function grant(kind: 'ticket' | 'renew', admissionId: string, input: LiveAdmissionActionInput, signal?: AbortSignal): Promise<LiveAdmissionGrant> {
  const body = parse<LiveAdmissionActionInput>(liveAdmissionActionInputSchema, input, true), target = id(admissionId);
  return fresh(async current => {
    const result = parse<LiveAdmissionGrant>(liveAdmissionGrantSchema, await apiClient.request({ path: paths[kind](target), method: 'POST', body, signal: current, timeoutMs: 1500 }));
    if (result.admission_id !== target || result.run_id !== body.run_id || result.generation !== body.generation ||
      (kind === 'ticket' ? !result.signaling : result.signaling !== undefined)) throw invalid();
    return result; // Response-only credentials. Never put grants in query/storage/log state.
  }, signal);
}
export const liveRuntimeApi = {
  epoch: (nonce: string, signal?: AbortSignal) => fresh(async current => {
    const expected = id(nonce), result = parse<LiveEpochResponse>(liveEpochResponseSchema, await apiClient.request({ path: paths.epoch, method: 'POST', body: { nonce: expected }, signal: current, timeoutMs: 1500 }));
    if (result.nonce !== expected) throw invalid(); return result;
  }, signal),
  list: async (params: LiveRuntimeListParams, signal?: AbortSignal) => {
    const expected = parse<LiveRuntimeListParams>(listInput, params, true);
    const result = parse<LiveRuntimeList>(liveRuntimeListSchema, await apiClient.request({ path: paths.occurrences, method: 'GET', query: { ...expected }, signal }));
    if (result.page !== expected.page || result.page_size !== expected.page_size || Date.parse(result.from) !== Date.parse(expected.from) ||
        Date.parse(result.until) !== Date.parse(expected.until) || result.total < result.items.length || new Set(result.items.map(item => item.id)).size !== result.items.length) throw invalid();
    return result;
  },
  get: async (occurrenceId: string, runtimeSessionId?: string, signal?: AbortSignal) => {
    const target = id(occurrenceId), result = parse<LiveRuntimeOccurrence>(liveRuntimeOccurrenceSchema, await apiClient.request({ path: paths.occurrence(target), method: 'GET', query: runtimeSessionId ? { runtime_session_id: id(runtimeSessionId) } : undefined, signal }));
    if (result.id !== target) throw invalid(); return result;
  },
  preflight: (occurrenceId: string, runtimeSessionId?: string, signal?: AbortSignal) => fresh(async current => {
    const target = id(occurrenceId), result = parse<LiveRuntimePreflight>(liveRuntimePreflightSchema,
      await apiClient.request({ path: paths.preflight(target), method: 'GET',
        query: runtimeSessionId ? { runtime_session_id: id(runtimeSessionId) } : undefined, signal: current, timeoutMs: 2500 }));
    if (result.occurrence_id !== target) throw invalid();
    return result;
  }, signal, 2500),
  start: (occurrenceId: string, input: LiveStartInput, signal?: AbortSignal) => action(paths.start(id(occurrenceId)), parse(liveStartInputSchema, input, true), id(occurrenceId), signal),
  stop: (occurrenceId: string, input: LiveStopInput, signal?: AbortSignal) => action(paths.stop(id(occurrenceId)), parse(liveStopInputSchema, input, true), id(occurrenceId), signal),
  enable: (occurrenceId: string, input: LiveControlInput, signal?: AbortSignal) => action(paths.enable(id(occurrenceId)), parse(liveControlInputSchema, input, true), id(occurrenceId), signal),
  createPresenterAdmission: async (runId: string, input: LivePresenterAdmissionInput, signal?: AbortSignal) => {
    const target = id(runId), result = parse<LiveAdmissionPending>(liveAdmissionPendingSchema, await apiClient.request({ path: paths.presenterAdmission(target), method: 'POST', body: parse(livePresenterAdmissionInputSchema, input, true), signal }));
    if (result.run_id !== target) throw invalid(); return result;
  },
  ticket: (admissionId: string, input: LiveAdmissionActionInput, signal?: AbortSignal) => grant('ticket', admissionId, input, signal),
  renew: (admissionId: string, input: LiveAdmissionActionInput, signal?: AbortSignal) => grant('renew', admissionId, input, signal),
  observe: async (admissionId: string, input: LiveObservationInput, signal?: AbortSignal) => {
    const body = parse<LiveObservationInput>(liveObservationInputSchema, input, true), result = parse<LiveObservationResult>(liveObservationResultSchema, await apiClient.request({ path: paths.observations(id(admissionId)), method: 'POST', body, signal }));
    if (result.sequence !== body.sequence) throw invalid(); return result;
  },
};
export interface LiveAdminIntent { readonly occurrenceId: string; readonly kind: 'STOP' | 'ENABLE'; readonly body: Readonly<LiveControlInput> }
export function createLiveAdminIntent(occurrence: LiveRuntimeOccurrence, kind: LiveAdminIntent['kind'], reason: string, expectedAuthorityEpoch: string): LiveAdminIntent {
  return Object.freeze({ occurrenceId: occurrence.id, kind, body: Object.freeze(parse<LiveControlInput>(liveControlInputSchema, {
    request_id: createUuid(), expected_authority_epoch: expectedAuthorityEpoch, expected_control_revision: occurrence.control_revision, reason,
    ...(occurrence.run ? { run_id: occurrence.run.id, generation: occurrence.run.generation } : {}),
  }, true)) });
}
export const sendLiveAdminIntent = (intent: LiveAdminIntent) => intent.kind === 'STOP'
  ? liveRuntimeApi.stop(intent.occurrenceId, { ...intent.body, mode: 'ADMIN' })
  : liveRuntimeApi.enable(intent.occurrenceId, { ...intent.body });
