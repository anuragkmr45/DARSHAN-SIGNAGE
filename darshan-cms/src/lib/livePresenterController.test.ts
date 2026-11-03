import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/apiClient';
import type { LiveAdmissionGrant, LiveRuntimeOccurrence, LiveRuntimePreflight } from '@/api/liveRuntimeTypes';
import { LivePresenterController } from './livePresenterController';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = Date.parse('2050-01-01T00:00:00.000Z');
class OwnedTrack extends EventTarget { readyState = 'live'; stop = vi.fn(() => { this.readyState = 'ended'; }); constructor(readonly kind: 'video' | 'audio') { super(); } }
const stream = (tracks: OwnedTrack[]) => ({ getTracks: () => tracks, getVideoTracks: () => tracks.filter(track => track.kind === 'video'), getAudioTracks: () => tracks.filter(track => track.kind === 'audio') }) as unknown as MediaStream;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
describe('presenter capture, authority and asynchronous ownership', () => {
  let controller: LivePresenterController, session: boolean, wallOffset: number, epoch: string, row: LiveRuntimeOccurrence, api, media, displays: OwnedTrack[], connections;
  const readyRow = (): LiveRuntimeOccurrence => ({ id: id(1), publish_id: id(2), schedule_item_id: id(3), live_session_id: id(4),
    start_at: new Date(base - 1000).toISOString(), end_at: new Date(base + 120000).toISOString(), control_revision: 3, enabled: true,
    item_fingerprint: 'a'.repeat(64), presenter_user_id: id(5), microphone: false, screen_share_audio: true, screen_ids: [id(6)], run: null,
    can_start: true, can_stop: false, can_manage: false });
  const preflight = (): LiveRuntimePreflight => ({ version: 1, occurrence_id: row.id, authority_epoch: epoch,
    control_revision: row.control_revision, item_fingerprint: row.item_fingerprint, checked_at: new Date(base + Date.now()).toISOString(),
    business_eligible: row.can_start, media_ready: row.can_start, capacity_ready: row.can_start, ready: row.can_start,
    reason: row.can_start ? 'READY' : 'OCCURRENCE_UNAVAILABLE' });
  function identity() { return { version: 1 as const, authority_epoch: epoch, server_now: new Date(base + Date.now()).toISOString(), live_version: null,
    occurrence_id: row.id, publish_id: row.publish_id, schedule_item_id: row.schedule_item_id, run_id: row.run!.id, generation: row.run!.generation,
    admission_id: id(200 + row.run!.generation), role: 'presenter' as const, participant_id: `presenter_${row.run!.id}`, presenter_participant_id: `presenter_${row.run!.id}`,
    presenter_user_id: id(5), microphone: row.microphone, screen_share_audio: row.screen_share_audio }; }
  function grant(ticket = true): LiveAdmissionGrant { return { ...identity(), status: 'AUTHORIZED', lease_ms: 10000,
    window_remaining_ms: base + 120000 - (base + Date.now()), renew_after_ms: 3000, ...(ticket ? { signaling: { url: 'wss://media.example.test', ticket: 'synthetic-private-ticket' } } : {}) }; }
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 }); session = true; wallOffset = 0; epoch = id(7); row = readyRow(); displays = []; connections = [];
    let generation = 0;
    api = { epoch: vi.fn(async nonce => ({ version: 1, nonce, epoch_id: epoch, server_now: new Date(base + Date.now()).toISOString() })),
      get: vi.fn(async () => structuredClone(row)), preflight: vi.fn(async () => structuredClone(preflight())),
      start: vi.fn(async () => { generation++; row = { ...row, control_revision: row.control_revision + 1, can_start: false, can_stop: true,
        run: { id: id(100 + generation), generation, state: 'RUNNING', node_instance_id: id(8), presenter_participant_id: `presenter_${id(100 + generation)}`,
          created_at: new Date(base).toISOString(), stopped_at: null, owns_current_attempt: true } }; return { ...structuredClone(row), idempotent: false }; }),
      stop: vi.fn(async () => { row = { ...row, control_revision: row.control_revision + 1, run: row.run ? { ...row.run, state: 'STOPPING' } : null }; return { ...structuredClone(row), idempotent: false }; }),
      createPresenterAdmission: vi.fn(async () => ({ ...identity(), status: 'READY', retry_after_ms: 500 })), ticket: vi.fn(async () => grant()), renew: vi.fn(async () => grant(false)),
      observe: vi.fn(async (_id, input) => ({ accepted: true, sequence: input.sequence, server_received_at: new Date(base).toISOString() })) };
    media = { display: vi.fn(() => { const track = new OwnedTrack('video'); displays.push(track); return Promise.resolve(stream([track])); }), microphone: vi.fn(),
      connection: vi.fn(events => { const connection = { events, close: vi.fn(async () => {}), publish: vi.fn(async () => { events.connected(); events.published(); }) }; connections.push(connection); return connection; }) };
    controller = new LivePresenterController({ actorId: id(5), occurrenceId: id(1), media, api, now: () => Date.now(), wall: () => base + Date.now() + wallOffset,
      runtimeSessionId: id(9), isSessionCurrent: () => session });
  });
  afterEach(() => { controller.dispose(); vi.clearAllTimers(); vi.useRealTimers(); });
  const choose = () => controller.choose({ microphone: false, capturedAudio: false });
  async function begin() { await controller.load(); await choose(); await controller.start(); }
  it('opens the chooser synchronously from the gesture and keeps long local preview separate from publishing', async () => {
    await controller.load(); const picked = choose(); expect(media.display).toHaveBeenCalledOnce(); await picked;
    await vi.advanceTimersByTimeAsync(20000); expect(displays[0].readyState).toBe('live'); expect(api.start).not.toHaveBeenCalled(); expect(media.connection).not.toHaveBeenCalled();
    controller.localFrame(controller.getSnapshot().captureGeneration); expect(controller.getSnapshot()).toMatchObject({ localFrame: true, publishAcknowledged: false, mediaConnected: false });
  });
  it('does not open the native chooser when no trusted media node is ready', async () => {
    api.preflight.mockResolvedValueOnce({ ...preflight(), media_ready: false, capacity_ready: false, ready: false, reason: 'MEDIA_UNAVAILABLE' });
    await controller.load();expect(controller.getSnapshot()).toMatchObject({phase:'IDLE',preflight:{ready:false,reason:'MEDIA_UNAVAILABLE'}});
    expect(controller.getSnapshot().message).toContain('No trusted media node');await choose();expect(media.display).not.toHaveBeenCalled();
    await controller.load();await choose();expect(media.display).toHaveBeenCalledOnce();
  });
  it('requires a fresh clock sample before opening capture after a slow epoch response', async () => {
    api.epoch.mockImplementationOnce(async nonce => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return { version: 1, nonce, epoch_id: epoch, server_now: new Date(base + Date.now()).toISOString() };
    });
    const loading = controller.load(); await vi.advanceTimersByTimeAsync(3000); await loading;
    expect(controller.getSnapshot().phase).toBe('ERROR');
    await choose(); expect(media.display).not.toHaveBeenCalled();
    await controller.load(); expect(controller.getSnapshot().phase).toBe('IDLE');
    await choose(); expect(media.display).toHaveBeenCalledOnce();
  });
  it('does not shorten an established window on a slow eligibility reload while publishing', async () => {
    await begin();
    api.epoch.mockImplementationOnce(async nonce => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return { version: 1, nonce, epoch_id: epoch, server_now: new Date(base + Date.now()).toISOString() };
    });
    const loading = controller.load(); await vi.advanceTimersByTimeAsync(3000); await loading;
    expect(displays[0].readyState).toBe('live');
    expect(controller.getSnapshot().phase).toBe('PUBLISHING');
  });
  it('fails closed when occurrence and preflight revision or fingerprint do not bind', async () => {
    api.preflight.mockResolvedValueOnce({ ...preflight(), control_revision: row.control_revision + 1 });
    await controller.load();expect(controller.getSnapshot().phase).toBe('STALE');await choose();expect(media.display).not.toHaveBeenCalled();
  });
  it('keeps Start authoritative when media becomes unavailable after a ready preflight', async () => {
    await controller.load();await choose();api.start.mockRejectedValueOnce(new ApiError({status:503,code:'LIVE_MEDIA_UNAVAILABLE',message:'Synthetic race'}));
    await controller.start();expect(controller.getSnapshot()).toMatchObject({phase:'ERROR',capture:true,pendingStart:true});expect(media.connection).not.toHaveBeenCalled();
  });
  it('stops a late chooser result after close without requesting any run', async () => {
    await controller.load(); const picker = deferred<MediaStream>(); media.display.mockReturnValue(picker.promise);
    const selecting = choose(); controller.dispose(); const track = new OwnedTrack('video'); picker.resolve(stream([track])); await selecting;
    expect(track.readyState).toBe('ended'); expect(api.start).not.toHaveBeenCalled(); expect(media.connection).not.toHaveBeenCalled();
  });
  it('owns screen tracks during a pending microphone prompt and stops late microphone tracks too', async () => {
    row.microphone = true; await controller.load(); const mic = deferred<MediaStream>(); media.microphone.mockReturnValue(mic.promise);
    const selecting = controller.choose({ microphone: true, capturedAudio: false }); await Promise.resolve(); await Promise.resolve();
    await controller.stop(); expect(displays[0].readyState).toBe('ended'); const audio = new OwnedTrack('audio'); mic.resolve(stream([audio])); await selecting;
    expect(audio.readyState).toBe('ended'); expect(api.start).not.toHaveBeenCalled();
  });
  it('uses the full fresh identity before publication and stops all owned tracks before SDK close on expiry', async () => {
    await begin(); expect(controller.getSnapshot()).toMatchObject({ phase: 'PUBLISHING', publishAcknowledged: true, mediaConnected: true });
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('synthetic-private-ticket');
    api.renew.mockRejectedValue(new ApiError({ status: 503, message: 'Offline' }));
    connections[0].close.mockImplementation(async () => { expect(displays[0].readyState).toBe('ended'); });
    await vi.advanceTimersByTimeAsync(10200); expect(displays[0].readyState).toBe('ended'); expect(controller.getSnapshot().phase).toBe('EXPIRED');
  });
  it('consumes delayed ticket time instead of starting a fresh lease on receipt', async () => {
    const ticket = deferred<LiveAdmissionGrant>(); api.ticket.mockReturnValue(ticket.promise);
    await controller.load(); await choose(); const starting = controller.start(); await vi.advanceTimersByTimeAsync(1000);
    ticket.resolve({ ...grant(), lease_ms: 3000 }); await starting; api.renew.mockRejectedValue(new ApiError({ status: 503, message: 'Offline' }));
    await vi.advanceTimersByTimeAsync(2200); expect(displays[0].readyState).toBe('ended');
  });
  it('keeps captured video through a slow renewal inside a verified schedule window', async () => {
    row.end_at = new Date(base + 60000).toISOString();
    await begin();
    await vi.advanceTimersByTimeAsync(53000);
    expect(displays[0].readyState).toBe('live');
    api.renew.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { ...grant(false), window_remaining_ms: 60000 - Date.now() };
    });
    await vi.advanceTimersByTimeAsync(5500);
    expect(displays[0].readyState).toBe('live');
  });
  it('retries a lost Start with exactly the original command', async () => {
    api.start.mockRejectedValueOnce(new ApiError({ status: 503, message: 'Lost response' })); await controller.load(); await choose(); await controller.start();
    expect(controller.getSnapshot().pendingStart).toBe(true); expect(displays[0].readyState).toBe('live'); await controller.start();
    expect(api.start.mock.calls[0][1]).toEqual(api.start.mock.calls[1][1]); expect(api.start.mock.calls[0][1].expected_authority_epoch).toBe(id(7));
    expect(controller.getSnapshot().publishAcknowledged).toBe(true);
  });
  it('never extends the original startup bound or replaces capture for an unresolved Start', async () => {
    api.start.mockRejectedValue(new ApiError({ status: 503, message: 'Lost response' })); await controller.load(); await choose(); await controller.start();
    await vi.advanceTimersByTimeAsync(9000); await choose(); expect(media.display).toHaveBeenCalledOnce(); await controller.start();
    expect(api.start.mock.calls[0][1]).toEqual(api.start.mock.calls[1][1]);
    await vi.advanceTimersByTimeAsync(1200); expect(displays[0].readyState).toBe('ended'); expect(controller.getSnapshot().phase).toBe('EXPIRED');
    await controller.start(); await choose(); expect(api.start).toHaveBeenCalledTimes(2); expect(media.display).toHaveBeenCalledOnce();
  });
  it('does not resurrect a stopped idempotent Start receipt or publish an audio-policy mismatch', async () => {
    const original = api.start.getMockImplementation(); api.start.mockImplementationOnce(async () => { const result = await original(); return { ...result, idempotent: true, run: { ...result.run, state: 'STOPPED' } }; });
    await begin(); expect(displays[0].readyState).toBe('ended'); expect(media.connection).not.toHaveBeenCalled();
    row = { ...row, can_start: true, run: { ...row.run!, state: 'STOPPED' } }; await controller.reviewNewAttempt(); await choose();
    api.ticket.mockImplementationOnce(async () => ({ ...grant(), microphone: true })); await controller.start();
    expect(displays[1].readyState).toBe('ended'); expect(media.connection).not.toHaveBeenCalled();
  });
  it('keeps exact Stop identity after a lost response while capture has already stopped', async () => {
    await begin(); api.stop.mockRejectedValueOnce(new ApiError({ status: 503, message: 'Lost stop' })); await controller.stop();
    expect(displays[0].readyState).toBe('ended'); expect(controller.getSnapshot().pendingStop).toBe(true); await controller.stop();
    expect(api.stop.mock.calls[0][1]).toEqual(api.stop.mock.calls[1][1]); expect(controller.getSnapshot().pendingStop).toBe(false);
  });
  it('fences delayed Stop A from overwriting a newly reviewed and publishing run B', async () => {
    await begin(); const runA = row.run!.id, pending = deferred<LiveRuntimeOccurrence & { idempotent: boolean }>();
    api.stop.mockReturnValueOnce(pending.promise); const stopping = controller.stop();
    row = { ...row, control_revision: row.control_revision + 1, can_start: true, run: { ...row.run!, state: 'STOPPED' } };
    const oldAck = { ...structuredClone(row), idempotent: true }; await controller.reviewNewAttempt(); await choose(); await controller.start();
    const runB = row.run!.id; expect(runB).not.toBe(runA); pending.resolve(oldAck); await stopping;
    expect(controller.getSnapshot().occurrence.run.id).toBe(runB); expect(controller.getSnapshot().phase).toBe('PUBLISHING'); expect(displays[1].readyState).toBe('live');
  });
  it('stops a late acknowledged Start by its exact run after local cancellation, without publishing', async () => {
    const pending = deferred<LiveRuntimeOccurrence & { idempotent: boolean }>(); const original = api.start.getMockImplementation();
    api.start.mockReturnValue(pending.promise); await controller.load(); await choose(); const starting = controller.start(); await Promise.resolve(); await Promise.resolve();
    await controller.stop(); const result = await original(); pending.resolve(result); await starting; await Promise.resolve();
    expect(displays[0].readyState).toBe('ended'); expect(media.connection).not.toHaveBeenCalled(); expect(api.stop).toHaveBeenCalledWith(id(1), expect.objectContaining({ run_id: result.run.id, generation: result.run.generation, expected_authority_epoch: id(7) }));
  });
  it('rejects a changed epoch or foreign grant before joining media and never silently resets authority', async () => {
    await controller.load(); await choose(); epoch = id(50); await controller.start(); expect(displays[0].readyState).toBe('ended'); expect(api.start).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('STALE'); expect(media.connection).not.toHaveBeenCalled();
  });
  it('ends a pending chooser at the approved window and stops its late returned tracks', async () => {
    row.end_at = new Date(base + 1000).toISOString(); await controller.load(); const picker = deferred<MediaStream>(); media.display.mockReturnValue(picker.promise);
    const selecting = choose(); await vi.advanceTimersByTimeAsync(1200); const video = new OwnedTrack('video'); picker.resolve(stream([video])); await selecting;
    expect(video.readyState).toBe('ended'); expect(controller.getSnapshot().phase).toBe('EXPIRED'); expect(api.start).not.toHaveBeenCalled();
  });
  it('reports capture audio ending truthfully without stopping healthy video', async () => {
    row.microphone = true; const audio = new OwnedTrack('audio'); media.microphone.mockResolvedValue(stream([audio]));
    await controller.load(); await controller.choose({ microphone: true, capturedAudio: false }); await controller.start();
    expect(controller.getSnapshot().microphonePresent).toBe(true); audio.stop(); audio.dispatchEvent(new Event('ended'));
    expect(controller.getSnapshot()).toMatchObject({ microphonePresent: false, audioDegraded: true }); expect(displays[0].readyState).toBe('live');
  });
  it('keeps media-only reconnect bounded to30s while fresh authority remains valid', async () => {
    await begin(); connections[0].events.disconnected(); api.ticket.mockRejectedValue(new ApiError({ status: 503, message: 'Media unavailable' }));
    await vi.advanceTimersByTimeAsync(29000); expect(displays[0].readyState).toBe('live'); expect(api.renew.mock.calls.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(1400); expect(displays[0].readyState).toBe('ended'); expect(controller.getSnapshot().phase).toBe('EXPIRED');
  });
  it('does not let a late old connection failure disconnect a newer publishing connection', async () => {
    let reject!: (error: Error) => void; const oldPublish = new Promise<void>((_resolve, fail) => { reject = fail; });
    media.connection.mockImplementationOnce(events => { const connection = { events, close: vi.fn(async () => {}), publish: vi.fn(() => oldPublish) }; connections.push(connection); return connection; });
    await controller.load(); await choose(); const starting = controller.start(); await vi.advanceTimersByTimeAsync(1);
    connections[0].events.disconnected(); await vi.advanceTimersByTimeAsync(500); expect(connections.length).toBe(2); expect(controller.getSnapshot().phase).toBe('PUBLISHING');
    reject(new Error('Late connection A failure')); await starting; expect(connections[1].close).not.toHaveBeenCalled(); expect(controller.getSnapshot().phase).toBe('PUBLISHING');
  });
  it('rejects late SDK publication and fail-closes a clock/suspend gap or session change', async () => {
    const publishing = deferred<void>(); media.connection.mockImplementation(events => { const connection = { events, close: vi.fn(async () => {}), publish: vi.fn(async () => { await publishing.promise; events.published(); }) }; connections.push(connection); return connection; });
    await controller.load(); await choose(); const starting = controller.start(); await vi.advanceTimersByTimeAsync(1);
    wallOffset = 5000; await vi.advanceTimersByTimeAsync(200); publishing.resolve(); await starting;
    expect(displays[0].readyState).toBe('ended'); expect(controller.getSnapshot().publishAcknowledged).toBe(false); expect(controller.getSnapshot().phase).toBe('EXPIRED');
    session = false; await vi.advanceTimersByTimeAsync(200); expect(displays[0].readyState).toBe('ended');
  });
});
