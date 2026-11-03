import { LocalAudioTrack, LocalVideoTrack, LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client';
import type { LiveAdmissionGrant } from '@/api/liveRuntimeTypes';

setLogLevel(LogLevel.silent); // SDK diagnostics can contain transient signaling credentials.
export interface PresenterCapture { display: MediaStream; microphone?: MediaStream }
export interface PresenterConnection {
  publish(grant: LiveAdmissionGrant, capture: PresenterCapture, authorized: () => boolean): Promise<void>;
  close(): Promise<void>;
}
export interface PresenterMedia {
  display(audio: boolean): Promise<MediaStream>;
  microphone(): Promise<MediaStream>;
  connection(events: { connected: () => void; published: () => void; disconnected: () => void; audioDegraded: () => void }): PresenterConnection;
}
export function stopPresenterCapture(capture?: PresenterCapture): void {
  const tracks = new Set([...(capture?.display.getTracks() ?? []), ...(capture?.microphone?.getTracks() ?? [])]);
  for (const track of tracks) { try { track.stop(); } catch { /* Continue stopping every owned track. */ } }
}
export const browserPresenterMedia: PresenterMedia = {
  // Call directly from the button handler before the controller's first await.
  display: audio => navigator.mediaDevices.getDisplayMedia({ video: true, audio }),
  microphone: () => navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
  connection: events => {
    const room = new Room({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: false,
      reconnectPolicy: { nextRetryDelayInMs: () => null } });
    let closed = false;
    const close = async () => { if (closed) return; closed = true; await room.disconnect(false); };
    const lost = () => { if (!closed) { events.disconnected(); void close().catch(() => undefined); } };
    room.on(RoomEvent.Reconnecting, lost); room.on(RoomEvent.SignalReconnecting, lost); room.on(RoomEvent.Disconnected, lost);
    room.on(RoomEvent.TrackPublished, publication => publication.setSubscribed(false));
    room.on(RoomEvent.TrackSubscribed, (track, publication) => { publication.setSubscribed(false); track.detach(); });
    return {
      close,
      publish: async (grant, capture, authorized) => {
        if (closed || !grant.signaling || !authorized()) throw new Error('PRESENTER_CONNECTION_CANCELLED');
        const signaling = grant.signaling;
        await room.connect(signaling.url, signaling.ticket, { autoSubscribe: false, maxRetries: 0, rtcConfig: { iceServers: [] } });
        const current = () => !closed && authorized();
        if (!current()) { await close(); return; }
        events.connected();
        if (!current()) { await close(); return; }
        const video = capture.display.getVideoTracks()[0];
        if (!video || video.readyState !== 'live') throw new Error('PRESENTER_CAPTURE_ENDED');
        // SDK 2.23.0 constructors explicitly mark these as user-provided; it
        // may not release/reacquire a device behind the owner's generation.
        await room.localParticipant.publishTrack(new LocalVideoTrack(video, undefined, true), {
          source: Track.Source.ScreenShare, name: 'DARSHAN screen', simulcast: false, videoCodec: 'vp8' });
        if (!current()) { await close(); return; }
        for (const [tracks, source, allowed] of [
          [capture.display.getAudioTracks(), Track.Source.ScreenShareAudio, grant.screen_share_audio],
          [capture.microphone?.getAudioTracks() ?? [], Track.Source.Microphone, grant.microphone],
        ] as const) {
          for (const track of tracks) {
            if (track.readyState !== 'live') continue;
            if (!allowed) { track.stop(); continue; }
            if (!current()) { await close(); return; }
            try { await room.localParticipant.publishTrack(new LocalAudioTrack(track, undefined, true), { source }); }
            catch { if (current()) events.audioDegraded(); else { await close(); return; } }
            if (!current()) { await close(); return; }
          }
        }
        if (current()) events.published(); else await close();
      },
    };
  },
};
