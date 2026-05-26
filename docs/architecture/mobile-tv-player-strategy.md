# Mobile And TV Player Strategy

Last updated: 2026-05-23
Updated by: Codex
Status: Phase 0 platform strategy

## Purpose

This document defines how the shared player contract applies across Electron, Android TV, Android, iOS/iPadOS, tvOS, and browser/signage OS players.

## Shared Strategy

All players must implement:

- device registration/auth
- REST authoritative fetch
- notification-only realtime wake-up where possible
- heartbeat
- command ACK
- proof-of-play
- local cache
- offline startup
- desired-state reconciliation
- media/cache failure reporting

## Air-Gapped On-Prem Constraint

In fully air-gapped deployments, public FCM/APNs and cloud push services cannot be assumed.

Baseline player behavior for on-prem environments:

- foreground/kiosk WebSocket wake-up where the app is active
- REST authoritative fetch for commands, snapshots, default media, emergency, ACK, heartbeat, and telemetry
- polling/heartbeat fallback when WebSocket or Valkey fanout is unavailable
- on-prem/internal media delivery through MinIO, internal S3-compatible storage, file server, or another approved intranet endpoint
- no media, full snapshots, screenshots, logs, or PoP batches over WebSocket or Valkey

Push notification support is optional and environment-specific. It requires an approved on-prem MDM/private push mechanism or a documented non-air-gapped exception.

## Electron Strategy

Electron is the first production runtime.

Recommended behavior:

- use WebSocket while app is running
- keep heartbeat active every configured interval
- use adaptive polling based on WebSocket health
- cache media to disk with LRU eviction
- support screenshot, log upload, reboot where OS permissions allow
- support layout rendering and webpage assets
- report cache/disk failures

Renderer limits:

- default max concurrent video: 1 unless explicitly tested
- layout slots may mix images/documents/webpages; multiple simultaneous videos require capability declaration

## Android TV Strategy

Android TV should behave like a foreground signage device.

Recommended behavior:

- foreground WebSocket when app is active
- on-prem private push only if the customer provides an approved mechanism; otherwise rely on foreground WebSocket plus REST/polling fallback
- WorkManager or foreground service for background sync only where allowed
- local media cache in app-private storage or external storage if managed
- renderer based on ExoPlayer/WebView/native image views

Limits:

- max concurrent video should default to 1
- WebView performance varies by device
- background execution may be restricted by OEM policies

## Android Mobile Strategy

Android mobile/tablet may not always be foreground signage.

Recommended behavior:

- WebSocket when foreground
- on-prem private push only if available; public FCM is not baseline for air-gapped deployments
- WorkManager for deferred fetch/cache tasks
- foreground service only for active signage playback mode
- storage quota must be capability-reported

Limits:

- background downloads are OS-managed and may be delayed
- screenshots may require platform-specific permission or may be unsupported
- reboot command usually unsupported outside managed-device mode

## iOS/iPadOS Strategy

iOS/iPadOS has strict background limits.

Recommended behavior:

- WebSocket only while foreground/active
- APNs only when the deployment has an approved non-air-gapped exception or private push mechanism; not baseline in fully air-gapped mode
- background fetch is best-effort, not guaranteed
- media downloads use URLSession background downloads where possible
- local cache uses app sandbox

Limits:

- remote reboot unsupported
- screenshots may be unsupported or restricted
- long-running background playback requires kiosk/supervised deployment strategy

## tvOS Strategy

tvOS may be relevant for Apple TV signage, but background and management constraints are stricter.

Recommended behavior:

- WebSocket while foreground
- APNs only when the deployment has an approved non-air-gapped exception or private push mechanism
- REST desired-state reconciliation on foreground/resume
- cache only within tvOS storage limits

Limits:

- local storage may be purged by OS
- remote reboot unsupported
- screenshots/log collection may be restricted

## Browser / Signage OS Strategy

Browser players can use:

- WebSocket while tab/app is active
- service worker cache where supported
- periodic REST reconciliation where allowed
- browser storage APIs

Limits:

- storage quotas vary widely
- autoplay and codec policies vary
- screenshot/reboot commands generally unsupported
- background execution cannot be assumed

## Foreground WebSocket Behavior

Foreground players should:

- connect after auth/bootstrap
- send HELLO with capabilities
- respond to ping/pong
- treat all messages as wake-up only
- REST-fetch authoritative state
- reconnect with exponential backoff and jitter

## Background Push Behavior

Mobile push adapters are optional and environment-specific. When available, they should consume the same outbox event types as WebSocket dispatch:

- `COMMAND_AVAILABLE`
- `SNAPSHOT_CHANGED`
- `DEFAULT_MEDIA_CHANGED`
- `EMERGENCY_CHANGED`
- `DESIRED_STATE_CHANGED`

Push payloads must be small and contain no media or authoritative snapshot payload.

In fully air-gapped deployments, Phase 9 must assume no public push service and must keep foreground WebSocket, REST reconciliation, and polling/heartbeat fallback as the baseline.

## Background Downloads

Background downloads are platform-specific:

- Electron: app-managed downloads
- Android TV/Android: WorkManager or foreground service depending mode
- iOS/iPadOS: URLSession background downloads where allowed
- tvOS: limited and purgeable
- browser: service worker/cache API where supported

Players must report incomplete or failed prefetches.

## Capability Negotiation

Players must report:

- platform family
- app version
- protocol version
- supported commands
- supported media types
- max concurrent video
- layout support
- screenshot support
- log upload support
- remote reboot support
- push support
- cache max bytes
- offline startup support

## Remote Command Support Matrix

| Command | Electron | Android TV | Android mobile | iOS/iPadOS | tvOS | Browser |
|---|---|---|---|---|---|---|
| `REFRESH` | Yes | Yes | Yes | Yes | Yes | Yes |
| `RESYNC` | Yes | Yes | Yes | Yes | Yes | Yes |
| `TAKE_SCREENSHOT` | Yes | Maybe | Maybe | Restricted | Restricted | No |
| `SET_SCREENSHOT_INTERVAL` | Yes | Maybe | Maybe | Restricted | Restricted | No |
| `CLEAR_CACHE` | Yes | Yes | Yes | Yes | Yes | Maybe |
| `PING` | Yes | Yes | Yes | Yes | Yes | Yes |
| `REBOOT` | Maybe | Managed devices only | Managed devices only | No | No | No |
| `TEST_PATTERN` | Requires renderer implementation | Yes | Yes | Yes | Yes | Yes |

`Maybe` means platform support depends on OS permissions, app deployment mode, and device management policy.
