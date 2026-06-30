# Player Flow Contract

Last code-truth audit: 2026-06-28.

This document records the current desktop Electron player flow from code. It intentionally avoids stale example payloads; route-local schemas and player TypeScript types remain the exact field source of truth.

## Source Files

| Flow area | Code source of truth |
|---|---|
| Main lifecycle and IPC | `darshan-player/src/main/index.ts`, `darshan-player/src/preload/index.ts` |
| Config and paths | `darshan-player/src/common/config.ts`, `file-config.ts`, `platform-paths.ts`, `types.ts` |
| Pairing and certificates | `darshan-player/src/main/services/pairing-service.ts`, `cert-manager.ts`, `device-state-store.ts` |
| Player state machine | `darshan-player/src/main/services/player-flow.ts` |
| HTTP/replay/realtime | `network/http-client.ts`, `network/request-queue.ts`, `network/websocket-client.ts`, `realtime-service.ts` |
| Playback | `snapshot-manager.ts`, `snapshot-parser.ts`, `settings/default-media-service.ts`, renderer playback files |
| Telemetry/evidence | `telemetry/heartbeat.ts`, `pop-service.ts`, `screenshot-service.ts`, `media-cache-reporter.ts`, `log-shipper.ts` |
| Backend routes | `darshan-server/src/config/apiEndpoints.ts`, `routes/device-pairing.ts`, `routes/device-telemetry.ts` |

## Flow 1: First Launch / Unpaired

1. Main process starts, loads config and platform paths.
2. Device state is loaded from local runtime storage.
3. If no usable local identity/certificate exists, player enters pairing-required behavior.
4. Renderer pairing UI uses preload IPC to request pairing status/code.
5. Pairing service calls backend device-pairing request/status/complete endpoints.
6. Successful pairing persists identity/cert metadata locally.

Contract rule: pairing codes and cert material are runtime state. They must not be committed in config examples or support docs.

## Flow 2: Startup With Local Identity

1. Player loads local device id, cert metadata, cached snapshot/default-media metadata, queues, and config.
2. Pairing service calls authenticated backend pairing-status.
3. If backend returns valid paired state, player starts heartbeat, realtime, command polling, snapshot/default-media refresh, telemetry, and playback.
4. If backend indicates revoked/orphaned/screen missing/environment mismatch, player enters hard recovery/OTP flow.
5. If backend is temporarily unavailable after recent validation, offline grace or secure-lock policy determines whether cached playback may continue.

Contract rule: local identity is not backend authority.

## Flow 3: Schedule / Default Media Playback

1. Snapshot manager fetches `GET /api/v1/device/:deviceId/snapshot?include_urls=true`.
2. Snapshot parser normalizes schedule/layout/media data into playback items.
3. Cache manager prefetches/downloads media over HTTP/object storage URLs.
4. Renderer plays emergency, schedule, default media, offline, or empty states according to player flow and playback policy.
5. Active playback reporting flows back to main process for heartbeat/proof-of-play.

Contract rule: media never moves through Socket.IO. Socket.IO can only wake a REST refresh.

## Flow 4: Realtime Wake And Command Execution

1. Realtime service connects to Socket.IO `/device`.
2. Player sends HELLO metadata.
3. Backend sends wake notifications such as `COMMAND_AVAILABLE` or `RESYNC_REQUIRED`.
4. Player fetches desired state and commands by REST.
5. Command processor executes commands locally and ACKs via REST.
6. If realtime is disconnected or disabled, command/snapshot/default-media polling continues.

Contract rule: duplicate notifications are safe because command execution is driven by durable command ids and REST fetches.

## Flow 5: Telemetry And Evidence

| Evidence flow | Player source | Backend endpoint group |
|---|---|---|
| Heartbeat | `telemetry/heartbeat.ts` | `/api/v1/device/heartbeat` |
| Proof-of-play | `pop-service.ts` | `/api/v1/device/proof-of-play` |
| Screenshot | `screenshot-service.ts` | `/api/v1/device/screenshot` and screenshot policy/result endpoints |
| Media cache reports | `media-cache-reporter.ts` | `/api/v1/device/:deviceId/media-cache-report` |
| Logs/support uploads | `log-shipper.ts`, `operator-tools.ts` | backend upload/log support paths |

Contract rule: crash/power loss does not create fake proof-of-play continuity. Restart creates new evidence after validation/resume.

## Flow 6: Reset / Clean Reinstall

Operator CLI entrypoint:

```bash
darshan-player --pairing-status
darshan-player reset-pairing --dry-run
darshan-player reset-pairing --reason=clean_reinstall
```

Source: `darshan-player/src/main/cli.ts`, `darshan-player/src/main/services/operator-tools.ts`.

Reset clears identity-bound state and playback progress. It preserves media cache, logs, screenshots, proof-of-play spool, and request queues unless an explicit cache-clear option is used.

## Flow 7: Runtime Config

Preferred production player config selector:

```bash
DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

The selected JSON may include backend URLs, Socket.IO URL, environment labels, realtime/polling intervals, pairing grace, duplicate identity mode, cache limit, and diagnostics flags supported by `file-config.ts`. It must not include cert private material, tokens, device identity, pairing state, media cache, or proof-of-play data.

## Needs Runtime Verification

These behaviors are code-backed but not proven by documentation:

- packaged player startup after OS reboot
- fullscreen/kiosk behavior on target OS images
- video/PDF/office/webpage playback on target hardware
- screenshot capture on real display driver stack
- Socket.IO behavior through production nginx and LAN
- secure offline lock behavior during network switch/theft simulation
- proof-of-play replay after real network outage and power loss
