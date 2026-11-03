import { LocalAudioTrack, LocalVideoTrack, LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client';
import type { LiveAdmissionGrant } from '@/api/liveRuntimeTypes';

setLogLevel(LogLevel.silent); // SDK diagnostics can contain transient signaling credentials.
const PRESENTER_CONNECTION_STAGE_TIMEOUT_MS = 3000;
const SAFE_CONNECTION_REASONS = ['NOT_ALLOWED', 'SERVER_UNREACHABLE', 'INTERNAL_ERROR', 'CANCELLED',
  'LEAVE_REQUEST', 'TIMEOUT', 'WEBSOCKET', 'SERVICE_NOT_FOUND'] as const;
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
        // The controller owns retry and obtains a new single-use ticket for every
        // attempt. Keep both SDK stages below the ten-second authority lease so a
        // stalled stage cannot consume the whole thirty-second recovery window.
        try {
          await room.connect(signaling.url, signaling.ticket, {
            autoSubscribe: false,
            maxRetries: 0,
            websocketTimeout: PRESENTER_CONNECTION_STAGE_TIMEOUT_MS,
            peerConnectionTimeout: PRESENTER_CONNECTION_STAGE_TIMEOUT_MS,
            rtcConfig: { iceServers: [] },
          });
        } catch (error) {
          const sdk = error && typeof error === 'object' ? error as { name?: unknown; reason?: unknown; message?: unknown; context?: { status?: unknown } } : null;
          const reason = sdk?.name === 'ConnectionError' && typeof sdk.reason === 'number' && Number.isInteger(sdk.reason)
            && sdk.reason >= 0 && sdk.reason < SAFE_CONNECTION_REASONS.length ? SAFE_CONNECTION_REASONS[sdk.reason] : 'OTHER';
          const detail = typeof sdk?.message === 'string' && /could not establish (?:pc|PC) connection/i.test(sdk.message)
            ? 'RTC_CONNECTION' : typeof sdk?.context?.status === 'number' && sdk.context.status >= 500
              ? 'UPSTREAM_5XX' : 'UNCLASSIFIED';
          // The SDK error text/context may contain the single-use ticket.
          console.warn('DARSHAN_PRESENTER_SIGNAL_FAILED', reason, detail);
          throw error;
        }
        const current = () => !closed && authorized();
        if (!current()) { await close(); return; }
        events.connected();
        if (!current()) { await close(); return; }
        const video = capture.display.getVideoTracks()[0];
        if (!video || video.readyState !== 'live') throw new Error('PRESENTER_CAPTURE_ENDED');
        // SDK 2.23.0 constructors explicitly mark these as user-provided; it
        // may not release/reacquire a device behind the owner's generation.
        try {
          await room.localParticipant.publishTrack(new LocalVideoTrack(video, undefined, true), {
            source: Track.Source.ScreenShare, name: 'DARSHAN screen', simulcast: false, videoCodec: 'vp8' });
        } catch (error) {
          console.warn('DARSHAN_PRESENTER_VIDEO_PUBLISH_FAILED');
          throw error;
        }
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
