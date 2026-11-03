import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = { request: vi.fn() };
import { ApiError, apiClient } from '@/api/apiClient';
import { createLiveAdminIntent, liveRuntimeApi, sendLiveAdminIntent } from './liveRuntime';
import type { LiveAdmissionGrant, LiveRuntimeOccurrence, LiveRuntimePreflight } from '../liveRuntimeTypes';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2050-01-01T00:00:00.000Z';
const occurrence = (): LiveRuntimeOccurrence => ({ id: id(1), publish_id: id(2), schedule_item_id: id(3), live_session_id: id(4),
  start_at: now, end_at: '2050-01-01T01:00:00.000Z', control_revision: 3, enabled: true, item_fingerprint: 'a'.repeat(64),
  presenter_user_id: id(5), microphone: false, screen_share_audio: true, screen_ids: [id(6)], run: null, can_start: true, can_stop: false, can_manage: false });
const grant = (): LiveAdmissionGrant => ({ version: 1, authority_epoch: id(7), server_now: now, live_version: null,
  occurrence_id: id(1), publish_id: id(2), schedule_item_id: id(3), run_id: id(8), generation: 1, admission_id: id(9), role: 'presenter',
  participant_id: `presenter_${id(8)}`, presenter_participant_id: `presenter_${id(8)}`, presenter_user_id: id(5), microphone: false, screen_share_audio: true,
  status: 'AUTHORIZED', lease_ms: 10000, window_remaining_ms: 60000, renew_after_ms: 3000,
  signaling: { url: 'wss://media.example.test:18780', ticket: 'synthetic-private-ticket' } });
const action = { request_id: id(10), runtime_session_id: id(11), run_id: id(8), generation: 1 };
const preflight = (): LiveRuntimePreflight => ({ version: 1, occurrence_id: id(1), authority_epoch: id(7), control_revision: 3,
  item_fingerprint: 'a'.repeat(64), checked_at: now, business_eligible: true, media_ready: true, capacity_ready: true,
  ready: true, reason: 'READY' });
describe('validated live runtime API', () => {
  beforeEach(() => { fixture.request.mockReset(); vi.spyOn(apiClient, 'request').mockImplementation(fixture.request); }); afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  it('uses one bounded page and exact explicit reporting window, rejecting wrong-page and unbounded responses', async () => {
    const params = { page: 2, page_size: 25, from: now, until: '2050-01-08T00:00:00.000Z' };
    const response = { ...params, total: 26, items: [occurrence()] }; fixture.request.mockResolvedValue(response);
    expect(await liveRuntimeApi.list(params)).toEqual(response);
    expect(fixture.request).toHaveBeenCalledWith(expect.objectContaining({ path: '/live-occurrences', method: 'GET', query: params }));
    fixture.request.mockResolvedValue({ ...response, page: 1 }); await expect(liveRuntimeApi.list(params)).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
    await expect(liveRuntimeApi.list({ ...params, page_size: 101 })).rejects.toMatchObject({ code: 'LIVE_REQUEST_INVALID' });
  });
  it('authenticates a fresh random epoch nonce and rejects a replayed/wrong echo', async () => {
    fixture.request.mockResolvedValue({ version: 1, nonce: id(10), epoch_id: id(7), server_now: now });
    expect((await liveRuntimeApi.epoch(id(10))).epoch_id).toBe(id(7));
    await expect(liveRuntimeApi.epoch(id(11))).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
  });
  it('accepts only a bound, internally consistent and identity-free runtime preflight', async () => {
    fixture.request.mockResolvedValue(preflight());
    expect(await liveRuntimeApi.preflight(id(1), id(11))).toEqual(preflight());
    expect(fixture.request).toHaveBeenCalledWith(expect.objectContaining({ path: `/live-occurrences/${id(1)}/preflight`, method: 'GET',
      query: { runtime_session_id: id(11) }, timeoutMs: 2500 }));
    for (const changed of [{ occurrence_id: id(50) }, { ready: false }, { reason: 'MEDIA_UNAVAILABLE' },
      { business_eligible: false }, { node_instance_id: id(99) }]) {
      fixture.request.mockResolvedValue({ ...preflight(), ...changed });
      await expect(liveRuntimeApi.preflight(id(1), id(11))).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
    }
  });
  it('validates presenter identity, admission/run binding, lease bounds and query-free trusted WSS', async () => {
    fixture.request.mockResolvedValue(grant()); expect((await liveRuntimeApi.ticket(id(9), action)).signaling.ticket).toBe('synthetic-private-ticket');
    for (const changes of [{ role: 'receiver' }, { admission_id: id(50) }, { generation: 2 }, { participant_id: 'foreign' }, { lease_ms: 10001 },
      { signaling: { url: 'http://media.example.test', ticket: 'synthetic-private-ticket' } },
      { signaling: { url: 'wss://media.example.test/?token=synthetic-private-ticket', ticket: 'synthetic-private-ticket' } }]) {
      fixture.request.mockResolvedValue({ ...grant(), ...changes });
      await expect(liveRuntimeApi.ticket(id(9), action)).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
    }
  });
  it('requires ticket credentials only for TICKET and never exposes raw credential-bearing backend errors', async () => {
    fixture.request.mockResolvedValue(grant()); await expect(liveRuntimeApi.renew(id(9), action)).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
    const { signaling: _signaling, ...renewed } = grant(); fixture.request.mockResolvedValue(renewed);
    expect((await liveRuntimeApi.renew(id(9), action)).signaling).toBeUndefined();
    await expect(liveRuntimeApi.ticket(id(9), action)).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
    fixture.request.mockRejectedValue(new ApiError({ status: 503, code: 'LIVE_MEDIA_UNAVAILABLE', message: 'wss://secret/?ticket=synthetic-private-ticket' }));
    await expect(liveRuntimeApi.ticket(id(9), action)).rejects.toMatchObject({ code: 'LIVE_MEDIA_UNAVAILABLE', message: 'Fresh live authority was not confirmed. Check current state before retrying.' });
  });
  it('hard-bounds a hung fresh authority call including a transport that ignores cancellation', async () => {
    vi.useFakeTimers(); fixture.request.mockReturnValue(new Promise(() => {}));
    const result = liveRuntimeApi.epoch(id(10)).catch(error => error); await vi.advanceTimersByTimeAsync(1501);
    expect(await result).toMatchObject({ status: 408, code: 'LIVE_AUTHORITY_TIMEOUT' }); expect(fixture.request).toHaveBeenCalledOnce();
  });
  it('keeps exactly the same revision, reason and idempotency key on administrative retry', async () => {
    const row = occurrence(), intent = createLiveAdminIntent(row, 'STOP', ' Approved shutdown ', id(7));
    fixture.request.mockRejectedValueOnce(new Error('Synthetic lost response')).mockResolvedValue({ ...row, enabled: false, idempotent: true });
    await expect(sendLiveAdminIntent(intent)).rejects.toThrow('Synthetic lost response'); await sendLiveAdminIntent(intent);
    const bodies = fixture.request.mock.calls.map(([request]) => request.body); expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({ request_id: intent.body.request_id, expected_control_revision: 3, reason: 'Approved shutdown', expected_authority_epoch: id(7), mode: 'ADMIN' });
    const next = createLiveAdminIntent({ ...row, control_revision: 4 }, intent.kind, intent.body.reason, id(7));
    expect(next.body.request_id).not.toBe(intent.body.request_id); expect(intent.body.expected_control_revision).toBe(3); expect(next.body.expected_control_revision).toBe(4);
  });
  it('does not silently refresh a pending administrative epoch after restore rejection', async () => {
    const intent = createLiveAdminIntent(occurrence(), 'ENABLE', 'Explicit restart approval', id(7));
    fixture.request.mockRejectedValue(new ApiError({ status: 409, code: 'LIVE_AUTHORITY_EPOCH_CHANGED', message: 'Authority restored' }));
    await expect(sendLiveAdminIntent(intent)).rejects.toMatchObject({ code: 'LIVE_AUTHORITY_EPOCH_CHANGED' });
    expect(fixture.request).toHaveBeenCalledOnce();
    expect(fixture.request.mock.calls[0][0]).toMatchObject({ path: '/live-occurrences/' + id(1) + '/enable', body: { expected_authority_epoch: id(7), request_id: intent.body.request_id } });
    expect(intent.body.expected_authority_epoch).toBe(id(7));
    const reviewed = createLiveAdminIntent(occurrence(), intent.kind, intent.body.reason, id(50));
    expect(reviewed.body.expected_authority_epoch).toBe(id(50)); expect(reviewed.body.request_id).not.toBe(intent.body.request_id);
  });
  it('rejects malformed actions, foreign occurrence responses and mismatched observation acknowledgements', async () => {
    expect(() => liveRuntimeApi.stop(id(1), { request_id: id(10), expected_control_revision: 3, reason: 'Stop', mode: 'PRESENTER' } as never)).toThrow();
    fixture.request.mockResolvedValue({ ...occurrence(), id: id(40), idempotent: false });
    await expect(liveRuntimeApi.enable(id(1), { request_id: id(10), expected_authority_epoch: id(7), expected_control_revision: 3, reason: 'Enable' })).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
    fixture.request.mockResolvedValue({ accepted: true, sequence: 2, server_received_at: now });
    await expect(liveRuntimeApi.observe(id(9), { runtime_session_id: id(11), run_id: id(8), generation: 1, sequence: 1, connection: 'CONNECTED', subscription: 'NONE', frame: 'NONE', audio: 'NONE', fallback_ready: false, fallback_reason: null })).rejects.toMatchObject({ code: 'LIVE_RESPONSE_INVALID' });
  });
});
