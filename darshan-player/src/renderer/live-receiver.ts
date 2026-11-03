import { LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client'
import type { RemoteParticipant, RemoteTrack, RemoteTrackPublication } from 'livekit-client'
import type { LiveReceiverBridge, LiveReceiverGrant, LiveReceiverObservation } from '../common/live-runtime'
import { LiveReceiverLeaseClock } from './live-receiver-lease'
declare global { interface Window { liveReceiver: LiveReceiverBridge } }
setLogLevel(LogLevel.silent)
const video = document.getElementById('live-video') as HTMLVideoElement
let grant: LiveReceiverGrant | null = null
let room: Room | undefined
let disposed = false
let activated = false
let firstFrame = false
let heartbeat: ReturnType<typeof setInterval> | undefined
let leaseClock: LiveReceiverLeaseClock | undefined
const tracks = new Set<RemoteTrack>()
const audio = new Map<RemoteTrack, HTMLMediaElement | undefined>()
function current(): boolean { return !disposed && leaseClock?.isAuthorized() === true }
function report(kind: LiveReceiverObservation['kind']): void { if (grant && !disposed && (current() || ['failed', 'disconnected'].includes(kind))) window.liveReceiver.report({ view_epoch: grant.view_epoch, kind }) }
function cleanup(): void {
  if (disposed) return
  disposed = true
  leaseClock?.stop()
  if (heartbeat) clearInterval(heartbeat)
  for (const element of audio.values()) if (element) { element.pause(); element.srcObject = null; element.remove() }
  audio.clear(); video.pause(); video.srcObject = null
  video.style.display = 'none'
  const unavailable = document.getElementById('live-unavailable')
  if (unavailable) unavailable.style.display = 'grid'
  for (const track of tracks) { track.detach(); track.stop() }
  tracks.clear(); void room?.disconnect(true)
}
function fail(kind: 'failed' | 'disconnected'): void { report(kind); cleanup() }
function allowed(publication: RemoteTrackPublication, participant: RemoteParticipant): boolean {
  if (!current() || participant.identity !== grant?.presenter_participant_id) return false
  return publication.source === Track.Source.ScreenShare ||
    (publication.source === Track.Source.Microphone && grant.microphone) ||
    (publication.source === Track.Source.ScreenShareAudio && grant.screen_share_audio)
}
function subscribe(publication: RemoteTrackPublication, participant: RemoteParticipant): void { publication.setSubscribed(!disposed && allowed(publication, participant)) }
function playAudio(track: RemoteTrack): void {
  if (!firstFrame || !activated || !current() || audio.get(track)) return
  const element = track.attach()
  element.autoplay = true; audio.set(track, element); document.body.appendChild(element)
  void element.play().then(() => { if (!disposed && activated) report('audio-ready') }).catch(() => report('audio-degraded'))
}
window.liveReceiver.onActivate(() => {
  if (!current() || !firstFrame) return
  activated = true
  for (const track of audio.keys()) playAudio(track)
})
async function start(): Promise<void> {
  const started = performance.now()
  grant = await window.liveReceiver.grant()
  if (!grant || disposed) { cleanup(); return }
  leaseClock = new LiveReceiverLeaseClock({ viewEpoch: grant.view_epoch, request: () => window.liveReceiver.lease(), expired: () => fail('failed') })
  leaseClock.start(started, grant.lease_remaining_ms)
  if (!current()) { cleanup(); return }
  room = new Room({ adaptiveStream: false, dynacast: false, reconnectPolicy: { nextRetryDelayInMs: () => null } })
  room.on(RoomEvent.TrackPublished, subscribe)
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (disposed || !allowed(publication, participant)) { publication.setSubscribed(false); track.detach(); return }
    tracks.add(track)
    if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
      track.attach(video); video.muted = true; video.playsInline = true
      video.requestVideoFrameCallback(() => {
        if (!current() || firstFrame || video.videoWidth <= 0 || video.videoHeight <= 0) return
        firstFrame = true; report('first-frame')
      })
      void video.play().catch(() => fail('failed'))
    } else if (track.kind === Track.Kind.Audio && publication.source !== Track.Source.ScreenShare) {
      audio.set(track, undefined); playAudio(track)
    } else { publication.setSubscribed(false); track.detach() }
  })
  room.on(RoomEvent.TrackUnsubscribed, track => {
    tracks.delete(track)
    const element = audio.get(track)
    if (element) { element.pause(); element.srcObject = null; element.remove() }
    audio.delete(track)
    if (track.kind === Track.Kind.Video) fail('disconnected')
    else report('audio-degraded')
  })
  room.on(RoomEvent.ParticipantDisconnected, participant => { if (participant.identity === grant?.presenter_participant_id) fail('disconnected') })
  room.on(RoomEvent.Reconnecting, () => fail('disconnected'))
  room.on(RoomEvent.SignalReconnecting, () => fail('disconnected'))
  room.on(RoomEvent.Disconnected, () => fail('disconnected'))
  // Initial release uses direct private-LAN ICE. Never fall back to public
  // STUN/TURN; routed/private TURN is an explicit later deployment gate.
  await room.connect(grant.signaling.url, grant.signaling.ticket, { autoSubscribe: false, maxRetries: 0, rtcConfig: { iceServers: [] } })
  if (!current()) { cleanup(); await room.disconnect(true); return }
  report('connected')
  heartbeat = setInterval(() => report('heartbeat'), 1000)
  for (const participant of room.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) subscribe(publication, participant)
}
window.addEventListener('beforeunload', cleanup)
void start().catch(() => fail('failed'))
