# Player Runtime Contracts

Last code-truth audit: 2026-06-28.

The Electron player contract is implemented across main process services, a preload bridge, renderer playback/pairing code, and local runtime state. The backend player-facing REST contract is described in `backend-api-contracts.md`; realtime/command behavior is described in `realtime-command-contracts.md`.

## Runtime Boundary

| Contract area | Code source of truth | Data/API dependency | Consumers | Verification status |
|---|---|---|---|---|
| Electron lifecycle, kiosk/window policy | `darshan-player/src/main/index.ts`, `src/main/runtime-mode.ts` | Electron app/window/session APIs | Player main/renderer | Code-backed; target OS/window-manager behavior needs runtime verification. |
| Preload bridge | `darshan-player/src/preload/index.ts` | IPC channels exposed as `window.darshan` and legacy `window.hexmon` | Renderer | Code-backed. |
| Player config loader | `src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts` | env, optional player JSON config, legacy runtime paths | Player main/common | Code-backed and test-backed. |
| Logging/redaction | `src/common/logger.ts`, `src/common/redaction.ts`, `main/services/log-shipper.ts` | local log files, support/log upload bundles | Operator tools/backend upload | Code-backed; support bundles still require human no-secret review. |
| Pairing/certs/state | `main/services/pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts` | pairing APIs, device cert files, local state | Player main/backend | Code-backed; real pairing requires backend/CMS runtime. |
| Player flow state machine | `main/services/player-flow.ts`, `common/types.ts`, renderer pairing UI | backend pairing-status, snapshot/default-media services | Player main/renderer | Code-backed; live startup/recovery needs packaged-device QA. |
| HTTP and request queue | `main/services/network/http-client.ts`, `request-queue.ts`, `offline-replay-budgets.ts` | backend REST APIs, local queue files | Player main/backend | Code-backed; replay under network outage needs runtime verification. |
| Realtime client | `main/services/realtime-service.ts`, `network/websocket-client.ts` | Socket.IO `/device`, desired-state/commands REST | Player main/backend realtime | Code-backed; LAN/proxy behavior needs runtime verification. |
| Command processor | `main/services/command-processor.ts` | commands and ACK REST endpoints | Player main/backend | Code-backed. |
| Snapshot and schedule playback | `main/services/snapshot-manager.ts`, `snapshot-parser.ts`, `snapshot-evaluator.ts`, `renderer/player.ts`, `common/playback-policy.ts` | device snapshot REST, media cache | Player main/renderer | Code-backed; media rendering needs target hardware QA. |
| Default media playback | `main/services/settings/default-media-service.ts`, `renderer/default-media-player.ts` | device default-media REST, local cache metadata | Player main/renderer | Code-backed; realtime assignment latency needs runtime verification. |
| Media cache/reporting | `main/services/cache/cache-manager.ts`, `media-cache-reporter.ts`, `media-cache-purge.ts` | object URLs, cache files, media-cache-report REST | Player main/backend/CMS | Code-backed; disk-full/URL-expired tests need runtime evidence. |
| Proof-of-play | `main/services/pop-service.ts`, renderer `player-active-playback` IPC | proof-of-play REST, local spool | Player main/backend/CMS | Code-backed; no fake crash backfill by design. |
| Screenshots | `main/services/screenshot-service.ts` | Electron capture APIs, screenshot REST, queue | Player main/backend/CMS | Needs OS/display-driver runtime verification. |
| Heartbeat/metrics/health | `main/services/telemetry/heartbeat.ts`, `telemetry-service.ts`, `health-server.ts`, `player-metrics.ts`, `system-stats.ts` | heartbeat REST, local metrics/health | Player main/backend/CMS | Code-backed; CMS online status depends on backend receipt. |
| Secure/offline playback policy | `common/offline-security-policy.ts`, `main/services/secure-playback-guard.ts`, `common/player-content-source.ts` | pairing validation freshness, config, lifecycle events | Player main/renderer | Code-backed; theft/network-switch behavior needs real-device QA. |
| Operator CLI | `main/cli.ts`, `main/services/operator-tools.ts`, `cli-runner.ts` | local runtime state, backend diagnostics | Operator | Code-backed and covered by targeted tests. |

## Config Versus Runtime State

| Category | Location / selector | Must contain | Must not contain |
|---|---|---|---|
| Player site config | `/etc/darshan/player/config.json` selected by `DARSHAN_PLAYER_CONFIG_FILE` | non-secret backend URL, Socket.IO URL, environment labels, polling/realtime intervals, cache limits, diagnostics flags | device id, cert private keys, tokens, pairing state, proof-of-play, request queue, media files |
| Runtime identity state | paths resolved by `platform-paths.ts` and `config.ts` | device id, pairing validation state, cert metadata, install/runtime session ids | committed config examples or docs |
| Cache/evidence state | player cache paths | media cache, snapshot/default-media metadata, request queue, PoP spool, screenshots/logs | source-controlled config |

## Renderer IPC Contract

| IPC surface | Code source of truth | Purpose |
|---|---|---|
| `config:get` / `config:set` and legacy aliases | `main/index.ts`, `preload/index.ts` | Renderer/operator config access where supported. |
| `pairing-request`, `pairing-status`, `pairing-complete`, `submit-pairing` | `main/index.ts`, `pairing-service.ts`, `renderer/pairing.ts` | OTP pairing and validation. |
| `default-media:get`, `default-media:changed` | `main/index.ts`, default-media service, preload | Default media fetch/update. |
| `media:read-pdf` | `main/index.ts`, renderer PDF playback | PDF render support. |
| `get-player-state`, `get-device-info`, `get-diagnostics`, `get-health` | `main/index.ts`, service diagnostics | Local diagnostics and UI state. |
| `player-active-playback` | `main/index.ts`, renderer playback, PoP service | Active playback reporting for heartbeat/PoP. |
| `player-playback-progress`, `player-playback-resume-state` | `main/index.ts`, `playback-progress-store.ts` | Mid-schedule restart/resume state. |
| `renderer-log` | `main/index.ts`, redaction/logger | Sanitized renderer-to-main logging. |

## Player Runtime Guarantees

- Local identity alone is not pairing authority; backend pairing-status validation gates paired runtime except valid offline grace behavior.
- Media moves through HTTP/object storage/local cache, not Socket.IO.
- Socket.IO wakes REST fetches; missed notifications recover through polling/desired-state.
- Proof-of-play after crash/power loss is not backfilled as fake continuous playback.
- Reset-pairing clears identity-bound state and playback progress, while preserving media cache, request queue, PoP spool, logs, and screenshots unless explicit cache clearing is requested.

## Runtime Verification Required

- packaged player autostart on each target OS image
- fullscreen/kiosk behavior on Ubuntu/RPi/AXON hardware
- video/PDF/office/webpage rendering
- screenshot capture
- LAN backend/CMS/Socket.IO connectivity and outage recovery
- secure offline lock behavior under real network switch/theft scenarios
