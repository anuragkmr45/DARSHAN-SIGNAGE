import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, apiClient } from '@/api/apiClient';
import { schedulesApi } from '@/api/domains/schedules';
import type { FrozenLivePolicy } from '@/api/liveTypes';
import { LiveRequestReview } from '@/components/live/LiveRequestReview';
import { RequestDetailDrawer } from '@/components/schedule/RequestDetailDrawer';
import type { ScheduleRequestListItem } from '@/api/types';
import { approveThenPublish, recheckRequestLivePolicy, reloadScheduleRequest, requestActionFailure, requestFallbackPreview,
  validateRequestFallbackPreview, type LiveRequestFallbackPreview } from './liveRequestReview';

const permission = vi.hoisted(() => ({ grants: new Set<string>() }));
vi.mock('@/hooks/useAuthorization', () => ({ useAuthorization: () => ({ isLoading: false,
  can: (action: string, resource: string) => permission.grants.has(`${action}:${resource}`) }) }));

const id = (digit: number) => `00000000-0000-4000-8000-${String(digit).padStart(12, '0')}`;
function fixture() {
  const policy: FrozenLivePolicy = { version: 1, source_kind: 'LIVE', schedule_id: id(1), schedule_item_id: id(2), schedule_revision: 1,
    live_session_id: id(3), presenter_user_id: id(4), policy_revision: 2, microphone: false, screen_share_audio: true,
    start_at: '2050-01-01T00:00:00.000Z', end_at: '2050-01-01T01:00:00.000Z', priority: 0, screen_ids: [id(5)], screen_group_ids: [],
    fallback: { preparation_id: id(6), source_fingerprint: 'a'.repeat(64), manifest: { version: 1, presentation: { id: id(7), layout: null,
      items: [{ id: id(8), asset_id: id(9), order: 0 }] }, assets: [{ id: id(9), media_id: id(10), storage_object_id: id(11),
        bucket: 'immutable-fallbacks', object_key: `live-fallbacks/v1/sha256/${'b'.repeat(64)}.png`, sha256: 'b'.repeat(64), size: 64,
        content_type: 'image/png', render_type: 'image', representation: 'SOURCE', dependencies: [], cache_key: `live_${'b'.repeat(64)}_image` }] } } };
  const requestId = id(12), fingerprint = 'c'.repeat(64);
  const preview: LiveRequestFallbackPreview = { request_id: requestId, schedule_item_id: policy.schedule_item_id, approval_fingerprint: fingerprint,
    preparation_id: policy.fallback.preparation_id, presentation_id: policy.fallback.manifest.presentation.id, source_fingerprint: policy.fallback.source_fingerprint,
    manifest: policy.fallback.manifest, checked_at: '2050-01-01T00:00:00.000Z', downloads: [{ asset_id: id(9), sha256: 'b'.repeat(64), size: 64,
      content_type: 'image/png', cache_key: `live_${'b'.repeat(64)}_image`, url: 'https://media.example.test/frozen.png?synthetic=1', expires_at: '2050-01-01T00:15:00.000Z' }] };
  return { policy, requestId, fingerprint, preview };
}
describe('request-bound live review', () => {
  it('accepts only exact frozen request/item/policy/manifest and transport descriptors', () => {
    const data = fixture(); expect(validateRequestFallbackPreview(data.preview, data.requestId, data.fingerprint, data.policy)).toBe(data.preview);
    for (const mutation of [
      (value: LiveRequestFallbackPreview) => { value.request_id = id(90); },
      (value: LiveRequestFallbackPreview) => { value.schedule_item_id = id(90); },
      (value: LiveRequestFallbackPreview) => { value.approval_fingerprint = '0'.repeat(64); },
      (value: LiveRequestFallbackPreview) => { value.preparation_id = id(90); },
      (value: LiveRequestFallbackPreview) => { value.manifest.presentation.items[0].duration_seconds = 99; },
      (value: LiveRequestFallbackPreview) => { value.downloads[0].sha256 = '0'.repeat(64); },
    ]) { const changed = structuredClone(data.preview); mutation(changed); expect(() => validateRequestFallbackPreview(changed, data.requestId, data.fingerprint, data.policy)).toThrow(); }
  });
  it('keeps persistent stale409 diagnostics distinct from permission/transport failures', () => {
    const stale = new ApiError({ status: 409, code: 'LIVE_APPROVAL_STALE', message: 'Review changed' });
    expect(requestActionFailure(stale, true)).toMatchObject({ stale: true, code: 'LIVE_APPROVAL_STALE' });
    expect(requestActionFailure(stale, false).stale).toBe(false);
    expect(requestActionFailure(new ApiError({ status: 403, message: 'Denied' }), true)).toMatchObject({ stale: false, message: 'Denied' });
  });
  it('reflects a committed approval before a failed publish, without retrying or inventing a publish', async () => {
    const order: string[] = [], publish = vi.fn(async () => { order.push('publish'); throw new Error('Synthetic publish outage'); });
    await expect(approveThenPublish(async () => { order.push('approve'); return { status: 'APPROVED' }; }, publish,
      result => { order.push(result.status); })).rejects.toThrow('Synthetic publish outage');
    expect(order).toEqual(['approve', 'APPROVED', 'publish']); expect(publish).toHaveBeenCalledOnce();
    const untouched = vi.fn(); await expect(approveThenPublish(async () => { throw new Error('Denied'); }, publish, untouched)).rejects.toThrow('Denied');
    expect(untouched).not.toHaveBeenCalled(); expect(publish).toHaveBeenCalledOnce();
  });
  it('reload rechecks current eligibility for pending approvals without replacing frozen policy or reapproving history', async () => {
    const data = fixture(), approval = { version: 1 as const, approval_fingerprint: data.fingerprint, fallback_preparation_ids: {}, items: [data.policy] };
    const request = { id: data.requestId, status: 'PENDING', live_approval: approval } as ScheduleRequestListItem;
    const current = vi.spyOn(schedulesApi, 'livePreflight').mockResolvedValue({ schedule_id: data.policy.schedule_id, schedule_revision: 1, items: [data.policy], approval_fingerprint: '0'.repeat(64) });
    try {
      await expect(recheckRequestLivePolicy(request)).rejects.toMatchObject({ status: 409, code: 'LIVE_APPROVAL_STALE' });
      expect(request.live_approval).toBe(approval); expect(approval.approval_fingerprint).toBe(data.fingerprint);
      current.mockRejectedValueOnce(new ApiError({ status: 422, code: 'LIVE_PLAYER_UNSUPPORTED', message: 'Unsupported' }));
      await expect(recheckRequestLivePolicy({ ...request, status: 'APPROVED' })).rejects.toMatchObject({ status: 409, code: 'LIVE_APPROVAL_STALE', details: { reason: 'LIVE_PLAYER_UNSUPPORTED' } });
      current.mockClear(); await recheckRequestLivePolicy({ ...request, status: 'PUBLISHED' }); expect(current).not.toHaveBeenCalled();
    } finally { current.mockRestore(); }
  });
  it('uses the runtime API client for request-bound preview and authoritative expanded reload', async () => {
    const data = fixture(), request = vi.spyOn(apiClient, 'request').mockResolvedValue(data.preview);
    try {
      await requestFallbackPreview(data.requestId, data.policy); await reloadScheduleRequest(data.requestId);
      expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: 'GET', path: expect.stringContaining(`/schedule-requests/${data.requestId}/live-items/${data.policy.schedule_item_id}/fallback-preview`) }));
      expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: 'GET', query: { include: 'all' } }));
    } finally { request.mockRestore(); }
  });
  it('renders frozen LIVE policy, concrete audience and a separate historical fallback without mutable library preview', () => {
    const data = fixture(), markup = renderToStaticMarkup(createElement(LiveRequestReview, { requestId: data.requestId, approval: {
      version: 1, approval_fingerprint: data.fingerprint, fallback_preparation_ids: { [data.policy.fallback.manifest.presentation.id]: data.policy.fallback.preparation_id }, items: [data.policy] } }));
    expect(markup).toContain('Frozen LIVE approval'); expect(markup).toContain('1 distinct approved screens'); expect(markup).toContain('maximum 25');
    expect(markup).toContain('Microphone off'); expect(markup).toContain('Captured audio allowed'); expect(markup).toContain(data.policy.presenter_user_id);
    expect(markup).toContain('Historical frozen files'); expect(markup).toContain('Preview approved fallback'); expect(markup).not.toContain('synthetic=1');
  });
  it('keeps request review actions permission-based and blocks approval of a LIVE request missing its frozen review', () => {
    const data = fixture(), request = { id: data.requestId, status: 'PENDING', schedule_items: [{ id: data.policy.schedule_item_id, source_kind: 'LIVE' }],
      live_approval: { version: 1, approval_fingerprint: data.fingerprint, fallback_preparation_ids: {}, items: [data.policy] } } as ScheduleRequestListItem;
    const render = (value: ScheduleRequestListItem) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() },
      createElement(RequestDetailDrawer, { request: value, onClose: vi.fn() })));
    const buttons = (markup: string): string[] => Array.from(markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []);
    permission.grants.clear();
    const reader = render(request); expect(reader).toContain('Frozen LIVE approval');
    expect(buttons(reader).filter(button => button.includes('Approve')).every(button => /\sdisabled(?:=|[\s>])/.test(button))).toBe(true);
    permission.grants.add('approve:ScheduleRequest'); permission.grants.add('publish:ScheduleRequest');
    const approver = render(request); expect(buttons(approver).filter(button => button.includes('Approve')).every(button => !/\sdisabled(?:=|[\s>])/.test(button))).toBe(true);
    const missing = render({ ...request, live_approval: null });
    expect(missing).toContain('no valid frozen approval'); expect(buttons(missing).filter(button => button.includes('Approve')).every(button => /\sdisabled(?:=|[\s>])/.test(button))).toBe(true);
    expect(/\sdisabled(?:=|[\s>])/.test(buttons(missing).find(button => button.includes('Reject')) ?? '')).toBe(false);
    permission.grants.clear();
  });
});
