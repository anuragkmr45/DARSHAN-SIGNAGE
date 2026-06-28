# Player Troubleshooting

Last code-truth refresh: 2026-06-28.

## Source References

| Area | Code/source |
|---|---|
| Main runtime | `darshan-player/src/main/index.ts` |
| Config | `darshan-player/src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts` |
| Pairing/state | `src/main/services/pairing-service.ts`, `device-state-store.ts`, `player-flow.ts`, `cert-manager.ts` |
| Network/realtime | `src/main/services/network/http-client.ts`, `request-queue.ts`, `websocket-client.ts`, `realtime-service.ts` |
| Playback | `snapshot-manager.ts`, `settings/default-media-service.ts`, `common/playback-policy.ts`, renderer files |
| Evidence | `pop-service.ts`, `screenshot-service.ts`, heartbeat/metrics services |
| CLI | `src/main/cli.ts`, `src/main/services/operator-tools.ts` |

## First Checks

Run on the player device:

```bash
darshan-player doctor
darshan-player pairing-status
```

Do not paste raw output publicly until it is reviewed for secrets. URL-like diagnostics should be redacted by code, but operator screenshots and log bundles still require manual review.

## Config Problems

Expected player site config:

```bash
/etc/darshan/player/config.json
```

Expected selector:

```bash
DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

Common issues:

- invalid JSON, often from trailing commas after deleting a block,
- unsupported keys in an older installed player package,
- backend URL points to wrong VM/IP,
- Socket.IO URL path mismatch,
- config file readable only by the wrong OS user.

Config is non-secret deployment data only. Runtime identity, certs, pairing state, media cache, PoP spool, and request queues are not config.

## Pairing And Recovery

If the player shows OTP:

1. Use CMS Screens -> Pair Device.
2. Enter the OTP shown on the player.
3. Confirm the screen appears after pairing and heartbeat.

If the player was deleted/revoked or moved between environments:

- use the recovery/fresh pairing flow from CMS and player UI;
- do not manually edit runtime identity unless engineering gives a controlled recovery command;
- do not wipe app-data unless the reset runbook explicitly calls for it.

Code references: backend `device-pairing.ts`, player `pairing-service.ts`, `player-flow.ts`.

## Online/Offline Status

CMS online/offline state depends on backend heartbeat state. If the screen is powered on but CMS shows offline:

1. Confirm player is running.
2. Confirm backend base URL is reachable from the player machine.
3. Run `pairing-status`.
4. Confirm heartbeat endpoint succeeds or request queue is not accumulating.
5. Check backend health and logs for device telemetry failures.

Relevant player code: `telemetry/heartbeat.ts`, `telemetry-service.ts`, `network/http-client.ts`, `network/request-queue.ts`.

## Realtime Not Updating

Realtime is notification-only. If default media or schedule changes do not update quickly:

1. Confirm REST endpoints return the updated desired/default-media state.
2. Confirm Socket.IO `/device` connects.
3. Confirm Valkey/outbox/desired-state services are running on the backend side.
4. Confirm polling fallback eventually updates.

If polling updates but realtime does not, triage backend/outbox/Valkey/proxy before changing player fetch logic.

## Playback Problems

For scheduled/default media problems:

- video/image/PDF/office/webpage rendering depends on renderer code and local OS capabilities;
- media files should be fetched over HTTP/object storage and local cache, not socket;
- schedule resume behavior is code-backed but target-device verification is still required;
- single non-looping scheduled content should not be assumed verified without device testing.

Relevant code: `snapshot-manager.ts`, `settings/default-media-service.ts`, `common/playback-policy.ts`, `renderer/player.ts`, `renderer/default-media-player.ts`, `renderer/pdf-playback.ts`, `renderer/webpage-playback.ts`.

## Screenshot Problems

Screenshot capture depends on Electron and the target display stack. If CMS cannot capture:

1. Confirm the player is online and paired.
2. Confirm the screenshot request reaches the player.
3. Check player screenshot queue/upload behavior.
4. Verify on the target OS/display driver.

Relevant code: `screenshot-service.ts`, backend `device-telemetry.ts`.

## Reset Safety

Do not delete player runtime folders casually. The player runtime contains identity, certs, cache, request queue, proof-of-play spool, logs, and progress state. Use `docs/runbooks/player-clean-reinstall-reset.md` for controlled reset guidance.
