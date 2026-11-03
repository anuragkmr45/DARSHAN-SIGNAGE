import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveAdmissionGrant } from '@/api/liveRuntimeTypes';
const sdk = vi.hoisted(() => ({ rooms: [], wrappers: [] }));
vi.mock('livekit-client', () => ({
  LogLevel: { silent: 'silent' }, setLogLevel: vi.fn(),
  RoomEvent: { Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting', Disconnected: 'disconnected', TrackPublished: 'trackPublished', TrackSubscribed: 'trackSubscribed' },
  Track: { Source: { ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio', Microphone: 'microphone' } },
  LocalVideoTrack: class { constructor(readonly track: MediaStreamTrack, _constraints: unknown, readonly provided: boolean) { sdk.wrappers.push(this); } },
  LocalAudioTrack: class { constructor(readonly track: MediaStreamTrack, _constraints: unknown, readonly provided: boolean) { sdk.wrappers.push(this); } },
  Room: class { events = new Map(); connect = vi.fn(async () => {}); disconnect = vi.fn(async () => {}); localParticipant = { publishTrack: vi.fn(async () => {}) };
    constructor(readonly options: unknown) { sdk.rooms.push(this); } on(event: string, callback: (...values: unknown[]) => void) { this.events.set(event, callback); return this; } },
}));
import { browserPresenterMedia, stopPresenterCapture } from './livePresenterMedia';
const track = (kind: string) => ({ kind, readyState: 'live', stop: vi.fn() }) as unknown as MediaStreamTrack;
const stream = (tracks: MediaStreamTrack[]) => ({ getTracks: () => tracks, getVideoTracks: () => tracks.filter(value => value.kind === 'video'), getAudioTracks: () => tracks.filter(value => value.kind === 'audio') }) as MediaStream;
const grant = { signaling: { url: 'wss://media.example.test', ticket: 'synthetic-private-ticket' }, microphone: true, screen_share_audio: true } as LiveAdmissionGrant;
const deferred = () => { let resolve!: () => void; return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() }; };
describe('bounded presenter LiveKit adapter', () => {
  beforeEach(() => { sdk.rooms = []; sdk.wrappers = []; });
  const setup = () => { const events = { connected: vi.fn(), published: vi.fn(), disconnected: vi.fn(), audioDegraded: vi.fn() };
    const connection = browserPresenterMedia.connection(events); return { events, connection, room: sdk.rooms[sdk.rooms.length - 1] }; };
  it('uses no public ICE server, automatic reconnect, camera, data or remote subscription and publishes only owned approved sources', async () => {
    const { events, connection, room } = setup(), video = track('video'), captured = track('audio'), microphone = track('audio');
    await connection.publish(grant, { display: stream([video, captured]), microphone: stream([microphone]) }, () => true);
    expect(room.options).toMatchObject({ stopLocalTrackOnUnpublish: false, reconnectPolicy: { nextRetryDelayInMs: expect.any(Function) } });
    expect(room.options.reconnectPolicy.nextRetryDelayInMs({ retryCount: 1 })).toBeNull();
    expect(room.connect).toHaveBeenCalledWith(grant.signaling.url, grant.signaling.ticket, {
      autoSubscribe: false,
      maxRetries: 0,
      websocketTimeout: 3000,
      peerConnectionTimeout: 3000,
      rtcConfig: { iceServers: [] },
    });
    expect(room.localParticipant.publishTrack.mock.calls.map(call => call[1].source)).toEqual(['screen_share', 'screen_share_audio', 'microphone']);
    expect(sdk.wrappers.every(wrapper => wrapper.provided === true)).toBe(true); expect(events.published).toHaveBeenCalledOnce();
    const publication = { setSubscribed: vi.fn() }, remote = { detach: vi.fn() }; room.events.get('trackPublished')(publication); room.events.get('trackSubscribed')(remote, publication);
    expect(publication.setSubscribed).toHaveBeenCalledWith(false); expect(remote.detach).toHaveBeenCalledOnce();
    await connection.close(); expect(room.disconnect).toHaveBeenCalledWith(false); expect(video.stop).not.toHaveBeenCalled();
  });
  it('stops a late connection before publishing if authority expires while signaling is pending', async () => {
    const { events, connection, room } = setup(), connecting = deferred(); let allowed = true; room.connect.mockReturnValue(connecting.promise);
    const promise = connection.publish(grant, { display: stream([track('video')]) }, () => allowed); allowed = false; connecting.resolve(); await promise;
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled(); expect(events.connected).not.toHaveBeenCalled(); expect(room.disconnect).toHaveBeenCalledWith(false);
  });
  it('rechecks ownership after the connected callback and after a delayed video publish before any audio or acknowledgement', async () => {
    const first = setup(); let allowed = true; first.events.connected.mockImplementation(() => { allowed = false; });
    await first.connection.publish(grant, { display: stream([track('video')]) }, () => allowed); expect(first.room.localParticipant.publishTrack).not.toHaveBeenCalled();
    const second = setup(), publishing = deferred(); allowed = true; second.room.localParticipant.publishTrack.mockReturnValueOnce(publishing.promise);
    const promise = second.connection.publish(grant, { display: stream([track('video'), track('audio')]) }, () => allowed);
    await Promise.resolve(); allowed = false; publishing.resolve(); await promise;
    expect(second.room.localParticipant.publishTrack).toHaveBeenCalledOnce(); expect(second.events.published).not.toHaveBeenCalled(); expect(second.room.disconnect).toHaveBeenCalledWith(false);
  });
  it('never publishes a forbidden audio source and reports optional audio publication failure separately from video', async () => {
    const { events, connection, room } = setup(), forbidden = track('audio'); room.localParticipant.publishTrack.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Synthetic audio failure'));
    await connection.publish({ ...grant, screen_share_audio: false }, { display: stream([track('video'), forbidden]), microphone: stream([track('audio')]) }, () => true);
    expect(forbidden.stop).toHaveBeenCalledOnce(); expect(room.localParticipant.publishTrack.mock.calls.map(call => call[1].source)).toEqual(['screen_share', 'microphone']);
    expect(events.audioDegraded).toHaveBeenCalledOnce(); expect(events.published).toHaveBeenCalledOnce();
  });
  it('reports only a fixed safe reason when SDK signaling fails', async () => {
    const { connection, room } = setup();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const error = Object.assign(new Error('private-ticket-must-not-appear'), { name: 'ConnectionError', reason: 5 });
      room.connect.mockRejectedValueOnce(error);
      await expect(connection.publish(grant, { display: stream([track('video')]) }, () => true)).rejects.toBe(error);
      expect(warning).toHaveBeenCalledWith('DARSHAN_PRESENTER_SIGNAL_FAILED', 'TIMEOUT', 'UNCLASSIFIED');
    } finally { warning.mockRestore(); }
  });
  it('turns an SDK reconnect into one owner-controlled disconnect and never preserves a reusable SDK token reconnect', async () => {
    const { events, connection, room } = setup(); room.events.get('reconnecting')(); room.events.get('signalReconnecting')();
    expect(events.disconnected).toHaveBeenCalledOnce(); expect(room.disconnect).toHaveBeenCalledWith(false);
    await expect(connection.publish(grant, { display: stream([track('video')]) }, () => true)).rejects.toThrow('CANCELLED'); expect(room.connect).not.toHaveBeenCalled();
  });
  it('stops every owned display/audio track exactly once even when another stop throws', () => {
    const video = track('video'), audio = track('audio'); vi.mocked(video.stop).mockImplementation(() => { throw new Error('Synthetic stop failure'); });
    stopPresenterCapture({ display: stream([video, audio]), microphone: stream([audio]) });
    expect(video.stop).toHaveBeenCalledOnce(); expect(audio.stop).toHaveBeenCalledOnce();
  });
});
