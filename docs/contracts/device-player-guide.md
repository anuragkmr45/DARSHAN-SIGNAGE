# Device Player Implementation Guide

Last code-truth audit: 2026-06-28.

This guide describes the current DARSHAN player/device behavior from code. It is not a standalone OpenAPI schema. For endpoint groups, see `docs/contracts/backend-api-contracts.md`; for runtime internals, see `docs/contracts/player-runtime-contracts.md`; for realtime/command behavior, see `docs/contracts/realtime-command-contracts.md`.

## Source Of Truth

| Area | Code source of truth |
|---|---|
| Backend player endpoints | `darshan-server/src/config/apiEndpoints.ts`, `darshan-server/src/routes/device-telemetry.ts`, `darshan-server/src/routes/device-pairing.ts` |
| Device auth | `darshan-server/src/middleware/device-auth.ts`, `darshan-server/src/utils/device-request-auth.ts`, `darshan-server/src/realtime/device-socket-auth.ts` |
| Player runtime | `darshan-player/src/main/services/player-flow.ts`, `pairing-service.ts`, `command-processor.ts`, `realtime-service.ts`, `snapshot-manager.ts`, `settings/default-media-service.ts` |
| Renderer playback | `darshan-player/src/renderer/player.ts`, `default-media-player.ts`, `pdf-playback.ts`, `webpage-playback.ts`, `darshan-player/src/common/playback-policy.ts` |
| Local runtime state | `darshan-player/src/common/platform-paths.ts`, `darshan-player/src/main/services/device-state-store.ts`, `cert-manager.ts`, `playback-progress-store.ts` |

## Boot And Pairing Contract

1. Player loads local runtime paths, config, device state, certificates, cache metadata, and queues.
2. If no valid local identity exists, the player requests or displays OTP pairing state through pairing service and renderer pairing UI.
3. Pairing uses backend device-pairing endpoints:
   - `POST /api/v1/device-pairing/request`
   - `GET /api/v1/device-pairing/status`
   - `POST /api/v1/device-pairing/complete`
   - recovery/admin endpoints where applicable
4. If local identity exists, the player calls authenticated pairing-status:
   - `GET /api/v1/device/:deviceId/pairing-status`
5. The player must not treat local files alone as pairing authority. Backend status or valid offline grace is required before paired runtime success.

Runtime evidence required: packaged player pairing against a real backend/CMS deployment.

## Playback Fetch Contract

The player pulls authoritative playback state by REST:

| Resource | Endpoint | Player source | Notes |
|---|---|---|---|
| Snapshot | `GET /api/v1/device/:deviceId/snapshot?include_urls=true` | `snapshot-manager.ts`, `snapshot-parser.ts` | Returns latest publish/snapshot/default/emergency context for the device. |
| Default media | `GET /api/v1/device/:deviceId/default-media` | `settings/default-media-service.ts` | Used when no active schedule/emergency wins. |
| Desired state | `GET /api/v1/device/:deviceId/desired-state` | `realtime-service.ts` | Reconciles missed notifications and stale local state. |
| Commands | `GET /api/v1/device/:deviceId/commands` | `command-processor.ts` | Durable command intent; may be woken by Socket.IO. |

The backend may also expose CMS-authenticated screen/group snapshot endpoints for admin/operator surfaces, but the player runtime path is the device endpoint.

## Media And Rendering Contract

- Media bytes move through HTTP/object storage/local cache, not Socket.IO.
- The player cache manager downloads/preloads media from URLs received through snapshot/default-media data.
- Renderer playback supports image, video, PDF/document/webpage paths according to renderer and helper code.
- Layout and slot behavior is derived from normalized snapshots and playback policy helpers, not from this document.
- Emergency content has higher priority than normal schedule/default media when backend state says it is active.

Runtime evidence required: actual target hardware must render video, image, PDF, office/document, and webpage assets.

## Realtime Refresh Contract

Socket.IO `/device` is a wake channel only:

1. Player connects through `realtime-service.ts`.
2. Backend sends events such as `COMMAND_AVAILABLE`, `RESYNC_REQUIRED`, `SERVER_TIME`, or `ERROR`.
3. Player responds by fetching commands, desired state, snapshot, or default media over REST.
4. If Socket.IO is unavailable, polling/heartbeat fallback remains the recovery path.

Never send media bytes, screenshots, logs, full snapshots, or proof-of-play batches through realtime messages.

## Telemetry And Evidence Contract

| Evidence | Endpoint group | Player source | Notes |
|---|---|---|---|
| Heartbeat | `POST /api/v1/device/heartbeat` | `telemetry/heartbeat.ts` | CMS online state depends on backend receiving heartbeats. |
| Proof-of-play | `/api/v1/device/proof-of-play` | `pop-service.ts` | Crash/power loss does not create fake continuous playback evidence. |
| Screenshot | `/api/v1/device/screenshot`, screenshot policy/result paths | `screenshot-service.ts` | Capture depends on OS/Electron display support. |
| Media cache report | `POST /api/v1/device/:deviceId/media-cache-report` | `media-cache-reporter.ts`, `cache-manager.ts` | Reports sanitized metadata, not signed URL values. |
| Logs/support data | log upload/support paths | `log-shipper.ts`, `operator-tools.ts`, `redaction.ts` | URL-like emitted fields are redacted. |

## Restart And Offline Contract

- Reboot is not reinstall. The player reloads local state and revalidates identity.
- If backend validates the same identity, playback/heartbeat/realtime/default-media/snapshot flows start.
- If backend is temporarily unavailable after recent validation, offline grace may allow cached playback.
- Secure offline policy can stop visible playback after a shorter backend-validation lease when configured.
- If identity is revoked, orphaned, missing, or environment-mismatched, the player enters recovery/OTP behavior.
- Scheduled playback resume is schedule-aligned where snapshot timing supports it; exact seek/render behavior still needs target-device testing.

## Reset Contract

`darshan-player reset-pairing` clears identity-bound state and playback progress. By default it preserves media cache, logs, screenshots, proof-of-play spool, and request queues. `--clear-cache` clears media cache targets only.

Source: `darshan-player/src/main/cli.ts`, `darshan-player/src/main/services/operator-tools.ts`.

## Known Runtime Verification Gaps

- live packaged player on each target OS and CPU architecture
- fullscreen/kiosk/autostart behavior
- LAN Socket.IO proxy behavior
- media rendering on target display drivers
- screenshot capture
- offline/reconnect queues under real network outage
- no-secret review for logs, diagnostics, screenshots, and support bundles
