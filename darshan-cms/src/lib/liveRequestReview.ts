import { ApiError, apiClient } from '@/api/apiClient';
import { endpoints } from '@/api/endpoints';
import { schedulesApi } from '@/api/domains/schedules';
import type { FrozenLivePolicy, LiveFallbackPreview } from '@/api/liveTypes';
import type { ScheduleRequestListItem } from '@/api/types';
import { preparedLivePreview } from './liveFallbackPreview';

export interface LiveRequestFallbackPreview extends LiveFallbackPreview {
  request_id: string; schedule_item_id: string; approval_fingerprint: string;
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, current: unknown) => current && typeof current === 'object' && !Array.isArray(current)
  ? Object.fromEntries(Object.entries(current).sort(([left], [right]) => left.localeCompare(right))) : current);
export function validateRequestFallbackPreview(response: LiveRequestFallbackPreview, requestId: string,
  fingerprint: string, policy: FrozenLivePolicy): LiveRequestFallbackPreview {
  if (response.request_id !== requestId || response.schedule_item_id !== policy.schedule_item_id ||
      response.approval_fingerprint !== fingerprint || response.preparation_id !== policy.fallback.preparation_id ||
      response.presentation_id !== policy.fallback.manifest.presentation.id || response.source_fingerprint !== policy.fallback.source_fingerprint ||
      canonical(response.manifest) !== canonical(policy.fallback.manifest)) throw new Error('The preview does not match this request’s frozen approval. Reload the request.');
  preparedLivePreview(response);
  return response;
}
export const requestFallbackPreview = (requestId: string, policy: FrozenLivePolicy) => apiClient.request<LiveRequestFallbackPreview>({
  path: `${endpoints.scheduleRequests.base}/${encodeURIComponent(requestId)}/live-items/${encodeURIComponent(policy.schedule_item_id)}/fallback-preview`, method: 'GET',
});
export const reloadScheduleRequest = (requestId: string) => apiClient.request<ScheduleRequestListItem>({
  path: `${endpoints.scheduleRequests.base}/${encodeURIComponent(requestId)}`, method: 'GET', query: { include: 'all' },
});
export async function recheckRequestLivePolicy(request: ScheduleRequestListItem) {
  const approval = request.live_approval;
  // Historical review remains available after library edits. It is not a new
  // approval and must not be labelled stale merely because a draft changed.
  if (!approval || !['PENDING', 'APPROVED'].includes(request.status)) return;
  const scheduleId = approval.items[0]?.schedule_id;
  if (!scheduleId) throw new ApiError({ status: 409, code: 'LIVE_APPROVAL_STALE', message: 'The stored live review is invalid. Cancel and resubmit it.' });
  try {
    const current = await schedulesApi.livePreflight({ schedule_id: scheduleId, fallback_preparation_ids: approval.fallback_preparation_ids });
    if (current.approval_fingerprint !== approval.approval_fingerprint) throw new ApiError({ status: 409, code: 'LIVE_APPROVAL_STALE',
      message: 'Current live policy differs from this frozen review. Cancel and resubmit for fresh approval.' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422 && error.code?.startsWith('LIVE_')) throw new ApiError({ status: 409,
      code: 'LIVE_APPROVAL_STALE', message: 'A reviewed live source, fallback or target is no longer eligible. Cancel and resubmit for fresh approval.', details: { reason: error.code } });
    throw error;
  }
}
export function requestActionFailure(error: unknown, live: boolean) {
  const message = error instanceof Error ? error.message : 'The action could not be completed. Please retry.';
  const stale = live && error instanceof ApiError && error.status === 409 && error.code?.startsWith('LIVE_');
  return { message, stale: Boolean(stale), code: error instanceof ApiError ? error.code : undefined };
}
/** Approval can commit even when the later publish fails. Reflect the committed
 * response before attempting publish, so retry offers Publish, not Approve. */
export async function approveThenPublish<T>(approve: () => Promise<T>, publish: () => Promise<unknown>, approved: (result: T) => void) {
  const result = await approve(); approved(result); return publish();
}
