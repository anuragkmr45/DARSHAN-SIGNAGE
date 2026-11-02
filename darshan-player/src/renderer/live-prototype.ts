import { LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client'
import type { RemoteParticipant, RemoteTrack, RemoteTrackPublication } from 'livekit-client'
import type { LivePrototypeBridge, LivePrototypeGrant, LivePrototypeObservation } from '../common/live-prototype'

declare global { interface Window { livePrototype: LivePrototypeBridge } }

setLogLevel(LogLevel.silent)
const video = document.getElementById('live-video') as HTMLVideoElement
const status = document.getElementById('live-status') as HTMLElement
let grant: LivePrototypeGrant | null = null
let room: Room | undefined
let disposed = false
let firstFrame = false
const tracks = new Set<RemoteTrack>()
const audioTracks = new Set<RemoteTrack>()
const audioElements = new Map<RemoteTrack, HTMLMediaElement>()

function report(kind: LivePrototypeObservation['kind']): void {
  if (!grant || disposed) return
  window.livePrototype.report({ kind, run_id: grant.run_id, generation: grant.generation })
}

function dispose(): void {
  if (disposed) return
  disposed = true
  for (const element of audioElements.values()) { element.pause(); element.srcObject = null; element.remove() }
  audioElements.clear()
  video.pause()
  video.srcObject = null
  for (const track of tracks) { track.detach(); track.stop() }
  tracks.clear()
  audioTracks.clear()
  void room?.disconnect(true)
}

function fail(kind: 'failed' | 'disconnected'): void {
  report(kind)
  dispose()
}

function playAudio(track: RemoteTrack): void {
  if (!firstFrame || disposed || audioElements.has(track)) return
  const audio = track.attach()
  audio.autoplay = true
  document.body.appendChild(audio)
  audioElements.set(track, audio)
  void audio.play().then(() => report('audio-playing')).catch(() => report('audio-unavailable'))
}

function allowed(publication: RemoteTrackPublication, participant: RemoteParticipant): boolean {
  return participant.identity === grant?.presenter_identity &&
    [Track.Source.ScreenShare, Track.Source.ScreenShareAudio, Track.Source.Microphone].includes(publication.source)
}

function subscribe(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
  publication.setSubscribed(allowed(publication, participant))
}

async function start(): Promise<void> {
  grant = await window.livePrototype.grant()
  if (!grant?.ticket) { status.textContent = 'Content unavailable — no current admission'; return }
  room = new Room({ adaptiveStream: false, dynacast: false, reconnectPolicy: { nextRetryDelayInMs: () => null } })
  room.on(RoomEvent.TrackPublished, subscribe)
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (disposed || !allowed(publication, participant)) { publication.setSubscribed(false); track.detach(); return }
    tracks.add(track)
    if (track.kind === Track.Kind.Video && publication.source === Track.Source.ScreenShare) {
      track.attach(video)
      video.muted = true
      video.playsInline = true
      const rendered = (): void => {
        if (disposed || firstFrame) return
        firstFrame = true
        status.textContent = 'Live video rendering'
        report('first-frame')
        for (const audio of audioTracks) playAudio(audio)
      }
      video.requestVideoFrameCallback(rendered)
      void video.play().catch(() => fail('failed'))
    } else if (track.kind === Track.Kind.Audio) {
      audioTracks.add(track)
      playAudio(track)
    } else { publication.setSubscribed(false); track.detach() }
  })
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    tracks.delete(track)
    audioTracks.delete(track)
    const element = audioElements.get(track)
    if (element) { element.pause(); element.srcObject = null; element.remove(); audioElements.delete(track) }
    if (track.kind === Track.Kind.Video) fail('disconnected')
    else report('audio-unavailable')
  })
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant.identity === grant?.presenter_identity) fail('disconnected')
  })
  room.on(RoomEvent.Reconnecting, () => fail('disconnected'))
  room.on(RoomEvent.SignalReconnecting, () => fail('disconnected'))
  room.on(RoomEvent.Disconnected, () => fail('disconnected'))
  // This loop-1 harness proves direct local ICE only; it must not consult a
  // public STUN server. Private TURN/routed networking are separate gates.
  await room.connect(grant.signal_url, grant.ticket, { autoSubscribe: false, maxRetries: 0, rtcConfig: { iceServers: [] } })
  if (disposed) { await room.disconnect(true); return }
  report('connected')
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) subscribe(publication, participant)
  }
}

window.addEventListener('beforeunload', dispose)
void start().catch(() => fail('failed'))
