# Player Field Onboarding

## What The Player Is

DARSHAN Player is an Electron app. It pairs to the backend, validates its runtime identity, fetches schedule/default-media state over REST, caches media locally, emits heartbeat/proof-of-play/screenshot evidence, and uses Socket.IO only as a wake-up notification channel.

Code references:

- Main runtime: `darshan-player/src/main/index.ts`
- Preload IPC: `darshan-player/src/preload/index.ts`
- Config loader: `darshan-player/src/common/file-config.ts`
- Pairing: `darshan-player/src/main/services/pairing-service.ts`
- Runtime state: `darshan-player/src/main/services/device-state-store.ts`, `src/common/platform-paths.ts`
- Playback: `snapshot-manager.ts`, `settings/default-media-service.ts`, renderer files

## Site Config

Player site config belongs on the player device:

```bash
/etc/darshan/player/config.json
```

The runtime must be launched with:

```bash
DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

Do not put device identity, cert private keys, tokens, pairing state, media cache data, proof-of-play queues, request queues, or logs into the site config.

## Package Install Flow

Use the packaged player for production-style testing:

1. Build the `.deb` for the target architecture from the source checkout.
2. Copy the package to the player device.
3. Install with the OS package manager.
4. Place `/etc/darshan/player/config.json`.
5. Ensure autostart or systemd passes `DARSHAN_PLAYER_CONFIG_FILE`.
6. Start the player.
7. Pair from CMS using the player OTP screen.

Dev mode is only for development checks and does not replace packaged-player evidence.

## Expected Restart Behavior

After OS or app restart, the player loads local runtime state and then validates against backend when reachable. If backend validation succeeds, heartbeat/realtime/snapshot/default-media flows resume. If backend is temporarily unavailable and policy allows offline playback within the configured grace, cached content may continue. If backend reports revoked/deleted/environment mismatch, recovery or fresh pairing is required.

Exact behavior on a target player remains `needs runtime verification`.

## Field Checks

- `darshan-player doctor`
- `darshan-player pairing-status`
- CMS Screens page online/offline status after heartbeat.
- Pairing/recovery status in CMS Pair Device or Pairing Health UI.
- Default media and scheduled content display.
- Screenshot capture from CMS.
- Logs/doctor output reviewed for no secrets before sharing.

## When To Escalate

Escalate to engineering when:

- player is paired but backend shows persistent offline after network/power checks,
- screenshot capture fails on a target OS/display stack,
- media renders incorrectly for a supported type,
- default media/schedule refresh only works by polling when realtime should wake it,
- doctor output shows config parse, certificate, pairing, or runtime dependency errors,
- logs contain credentialed URLs or secret-looking data.
