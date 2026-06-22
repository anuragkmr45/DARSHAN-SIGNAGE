# DARSHAN Production Docker Split

This folder starts the server-side DARSHAN roles as separate Docker Compose projects so Docker Desktop does not show everything under the single `darshan-server` project.

It is for the current two-machine setup:

- Machine A: server roles on `192.168.0.6`
- Machine B: packaged player only

Future LXC/VM deployments use the same role split. Change only the host values in `deploy/production/.env.local` or your deployment config.

## Role Split

| Role | Compose project | Services |
|---|---|---|
| Data / VM1 | `darshan-data` | Postgres, MinIO |
| Valkey | `darshan-valkey` | Valkey |
| Backend | `darshan-backend` | API container with worker role enabled, ffmpeg, LibreOffice, pg_dump, tar, Playwright/Chromium |
| CMS | `darshan-cms-prod` | nginx static CMS |
| Observability | `darshan-observability` | Prometheus, Grafana |

Docker Desktop may still show multiple services inside the data and observability projects because Postgres/MinIO and Prometheus/Grafana are separate containers. That is expected. The important fix is that data, Valkey, backend, CMS, and observability are no longer one `darshan-server` Compose project.

## Same Machine Now, Multiple Machines Later

This deployment uses host/LAN IPs, not per-container IPs.

Current one-server setup:

```text
DATA_HOST=192.168.0.6
VALKEY_HOST=192.168.0.6
BACKEND_HOST=192.168.0.6
CMS_HOST=192.168.0.6
OBSERVABILITY_HOST=192.168.0.6
SIGNHEX_ENVIRONMENT_NAME=production
SIGNHEX_DEPLOYMENT_ID=site-a
SIGNHEX_SERVER_ID=backend-a
```

That works when all server roles run on one machine and Docker publishes ports on that host.

Future multi-machine/LXC/VM setup:

```text
DATA_HOST=<postgres-minio-vm-ip>
VALKEY_HOST=<valkey-lxc-ip>
BACKEND_HOST=<backend-lxc-ip>
CMS_HOST=<cms-lxc-ip>
OBSERVABILITY_HOST=<observability-vm-ip>
```

The scripts and compose files stay the same. Only `.env.local` changes.

Required network rules between hosts:

| From | To | Port | Purpose |
|---|---:|---:|---|
| Backend | Data host | `5432` | Postgres |
| Backend | Data host | `9000` | MinIO API |
| Backend | Valkey host | `6379` | realtime notification bus |
| CMS/browser/player | Backend host | `3000` | REST API and Socket.IO |
| Browser/operators | CMS host | `8080` or production HTTP/HTTPS port | CMS UI |
| Observability | Backend host | `3000` | metrics scrape |
| Observability | Data host | `9000` | MinIO metrics/health |

Use stable LAN IPs or internal DNS names. Do not use Docker container IPs because they change.

For a true source-free production install, use the bundle/export flow. These `deploy/production/*.sh` scripts are repo-based convenience scripts and need this repo plus `darshan-server/.env` available on the host where they run.

## One-Time Setup

Run from the repo root:

```bash
cd /Users/anuragkumar/Desktop/signhex
cp deploy/production/.env.example deploy/production/.env.local
```

Edit `.env.local` only if your server IP is not `192.168.0.6`.

Keep real secrets in `darshan-server/.env`. Do not put database passwords, MinIO secret keys, JWT secrets, private keys, tokens, or cert material in `.env.local`.

The helper scripts require `deploy/production/.env.local`. Non-secret host and port values come from that file:

```text
DATA_HOST
VALKEY_HOST
BACKEND_HOST
CMS_HOST
OBSERVABILITY_HOST
SIGNHEX_ENVIRONMENT_NAME
SIGNHEX_DEPLOYMENT_ID
SIGNHEX_SERVER_ID
POSTGRES_HOST_PORT
MINIO_HOST_PORT
MINIO_CONSOLE_PORT
VALKEY_HOST_PORT
API_HOST_PORT
CMS_HTTP_PORT
PROMETHEUS_PORT
GRAFANA_PORT
GRAFANA_ROOT_URL
INSTALL_PLAYWRIGHT_CHROMIUM
```

`darshan-server/.env` is still used for backend secrets and backend runtime settings.

The backend identity values are also used by player pairing validation. They must match the player config:

```text
SIGNHEX_ENVIRONMENT_NAME == player.environment.name
SIGNHEX_DEPLOYMENT_ID == player.environment.deploymentId
SIGNHEX_SERVER_ID == player.environment.expectedServerId
```

If these values do not match, a newly paired player can immediately enter recovery with `ENVIRONMENT_MISMATCH`, stop sending heartbeats, and leave CMS commands such as screenshot/default-media refresh pending.

## Fresh Start

Stop the old combined project first:

```bash
cd /Users/anuragkumar/Desktop/signhex
cd darshan-server
docker compose --env-file .env down --remove-orphans
```

Start the split production stack:

```bash
cd /Users/anuragkumar/Desktop/signhex
bash deploy/production/start-all.sh
```

This script:

1. builds the CMS static app with `npm run build`,
2. starts Postgres and MinIO,
3. starts Valkey,
4. runs backend `db:push` and `seed`,
5. starts one backend API container in `DARSHAN_PROCESS_ROLE=all`,
6. starts nginx CMS,
7. starts Prometheus and Grafana.

## Start One Role at a Time

Use this when you want to see and control each Compose project separately in Docker Desktop:

```bash
cd /Users/anuragkumar/Desktop/signhex

bash deploy/production/start-data.sh
bash deploy/production/start-valkey.sh
bash deploy/production/start-backend.sh
bash deploy/production/start-cms.sh
bash deploy/production/start-observability.sh
```

Expected Docker Desktop grouping:

```text
darshan-data
  postgres-1
  minio-1

darshan-valkey
  valkey-1

darshan-backend
  api-1

darshan-cms-prod
  cms-1

darshan-observability
  prometheus-1
  grafana-1
```

The backend role intentionally runs one backend container in `DARSHAN_PROCESS_ROLE=all`. That single container serves APIs, login/auth, player endpoints, Socket.IO notification handling, and background worker jobs.

## Full Fresh Reset

This removes Docker volumes for the split production stack.

```bash
bash deploy/production/reset-fresh.sh
```

Use this only when you intentionally want a clean database and clean object storage.

## Health Check

```bash
cd /Users/anuragkumar/Desktop/signhex
bash deploy/production/health-check.sh
```

Expected endpoints:

```bash
curl -fsS http://192.168.0.6:3000/api/v1/health
curl -fsS http://192.168.0.6:9000/minio/health/live
curl -fsS http://192.168.0.6:9090/-/healthy
```

## Player Package Install

Linux does not have one universal "Play Store" like Android. For DARSHAN player, the production-style path is to build a Linux package, copy it to the player machine, install it with `apt`/`dpkg`, then configure the backend URL.

Recommended first step: use `.deb` packages. Later, this can be upgraded to a private apt repository for easier fleet updates.

Build for Ubuntu x64:

```bash
cd /Users/anuragkumar/Desktop/signhex/darshan-player
npm run package:linux:x64
```

Build for Raspberry Pi OS 64-bit or another Linux ARM64 board:

```bash
cd /Users/anuragkumar/Desktop/signhex/darshan-player
npm run package:linux:arm64
```

Copy the generated `.deb` from the player release output folder, usually `darshan-player/release/` or `darshan-player/dist/`, to the player machine.

Install on the player machine:

```bash
sudo apt update
sudo apt install -y ./darshan-player*.deb
```

If package dependencies need repair:

```bash
sudo apt --fix-broken install
```

Raspberry Pi guidance:

- Use 64-bit Raspberry Pi OS.
- Avoid 32-bit Raspberry Pi OS unless it has been explicitly built and tested.
- For AXON or other ARM boards, use the ARM64 package only when the board is running a 64-bit Linux desktop stack compatible with Electron.

App-store-like options for later:

- Simple on-prem: `.deb` file install.
- Better fleet update path: private apt repository.
- Possible but more work: Snap or Flatpak.
- Air-gapped deployments: keep `.deb` files on USB/internal file server.

## Player Machine Config

Use the packaged player on the second machine and point it at the backend host. The production env example also records these non-secret reference values:

```text
PLAYER_BACKEND_BASE_URL=http://192.168.0.6:3000
PLAYER_SOCKET_IO_URL=http://192.168.0.6:3000/socket.io/
PLAYER_CONFIG_FILE_PATH=/etc/darshan/player/config.json
```

Create the player config file on the player machine:

```bash
sudo mkdir -p /etc/darshan/player
sudo nano /etc/darshan/player/config.json
```

Example:

```json
{
  "player": {
    "environment": {
      "name": "production",
      "deploymentId": "site-a",
      "expectedServerId": "backend-a"
    },
    "runtime": {
      "mode": "production"
    },
    "backend": {
      "baseUrl": "http://192.168.0.6:3000",
      "socketIoUrl": "http://192.168.0.6:3000/socket.io/"
    },
    "realtime": {
      "enabled": true,
      "signedAuthEnabled": false,
      "deviceNamespace": "/device",
      "commandSafetyPollMs": 60000,
      "desiredStatePollMs": 300000
    },
    "polling": {
      "heartbeatMs": 30000,
      "commandPollMs": 5000,
      "snapshotPollMs": 300000,
      "defaultMediaPollMs": 300000
    },
    "pairing": {
      "offlineValidationGraceMs": 604800000,
      "backendFirstRolloutMode": true
    },
    "security": {
      "offlinePlaybackPolicy": "secure",
      "backendRequiredForPlayback": true,
      "networkSwitchGraceMs": 30000,
      "playbackLeaseMs": 120000,
      "lockAfterOfflineMs": 120000,
      "purgeCacheAfterOfflineMs": 0,
      "showSecurityLockScreen": true
    },
    "duplicateIdentity": {
      "enabled": true,
      "enforcement": "warn"
    },
    "cache": {
      "maxBytes": 10737418240
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
```

Make the installed player use that file. The player reads the config file path from this environment variable:

```bash
DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

For one terminal/manual production launch:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player
```

For a persistent player machine setup, add the config selector to the desktop-session environment before launching the player:

```bash
echo 'DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json' | sudo tee -a /etc/environment
```

Then log out and log back in, or reboot the player machine. After login, start the player once:

```bash
darshan-player
```

In `qa` or `production` runtime mode, the player manages XDG autostart for the logged-in desktop session. Verify it after first launch:

```bash
darshan-player doctor
ls -l ~/.config/autostart/darshan-player.desktop
cat ~/.config/autostart/darshan-player.desktop
```

On the next reboot/login, the desktop session should start `darshan-player` automatically and inherit `DARSHAN_PLAYER_CONFIG_FILE` from `/etc/environment`.

If the site uses a systemd service instead of desktop-session autostart, add the config selector to the service environment and restart the service:

```bash
sudo systemctl edit darshan-player
```

Use this drop-in:

```ini
[Service]
Environment="DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json"
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart darshan-player
sudo systemctl status darshan-player
```

### Player shutdown / restart behavior

If a player machine loses power or is shut down, the expected production behavior is:

1. The operating system boots.
2. The desktop session starts.
3. The DARSHAN player starts again through XDG autostart when `runtime.mode` is `qa` or `production`, or through the installed service if the site uses the systemd deployment path.
4. The player reads `/etc/darshan/player/config.json` through `DARSHAN_PLAYER_CONFIG_FILE`.
5. The player loads its local runtime state from the app-data/runtime folder. This includes the previous device id, certificate paths, cached snapshot/default-media metadata, last validated pairing status, and queued offline data.
6. Before showing paired/no-content as a success state, the player validates the stored identity with the backend pairing-status API.

Result by condition:

| Restart condition | Expected behavior |
|---|---|
| Backend reachable and pairing still valid | Player validates pairing, sends heartbeat, reconnects realtime, refreshes desired state/snapshot/default media, and returns to normal playback. |
| Backend reachable but screen deleted, revoked, invalid, orphaned, or environment-mismatched | Player clears identity-bound state and returns to fresh pairing/OTP recovery. |
| Backend temporarily unreachable and the same identity was validated recently | Player may continue cached/offline playback within `player.pairing.offlineValidationGraceMs`, then retries backend validation with backoff. |
| Backend unreachable and the identity was never validated, or offline grace expired | Player does not claim paired/no-content success; it stays in validation-required/recovery until backend validation succeeds. |
| Pairing was pending before shutdown and the code is still valid | Player resumes pairing-status polling for that code. |
| Pairing was pending before shutdown and the code expired | Player requests a new fresh pairing code. |

The restart path intentionally does not auto-wipe app-data just because the machine rebooted. Clean identity reset is an explicit operator action using `darshan-player reset-pairing`.

### Secure Offline Playback Lock

Normal offline grace is designed for resilience during short backend/network outages. Sites that need theft-resistant behavior can enable an additional playback lock in `player.security`.

When `player.security.offlinePlaybackPolicy` is `secure` or `high_security`, or `player.security.backendRequiredForPlayback` is `true`:

- each successful backend pairing-status/heartbeat grants a short playback lease;
- transient network loss enters a configured grace window;
- after the lease/grace expires, scheduled/default media playback is stopped and the player shows a full-screen DARSHAN backend-validation warning;
- heartbeat/retry paths continue in the background;
- once backend validation succeeds again, playback unlocks and returns to the current valid schedule/default media;
- no backend API, CMS API, DB schema, pairing protocol, or realtime architecture changes are required.

Optional cache purge is separate. `player.security.purgeCacheAfterOfflineMs` defaults to `0`, which means media cache purge is disabled. If set to a positive value, the player deletes only media cache targets (`media`, `objects`, `quarantine`, legacy `cache-index.db`) after the long-offline timeout. It preserves logs, screenshots, proof-of-play spool, and request queue data. Do not enable purge until the site has tested recovery and operator procedures on the real player device.

Suggested production starting point:

```json
"security": {
  "offlinePlaybackPolicy": "secure",
  "backendRequiredForPlayback": true,
  "networkSwitchGraceMs": 30000,
  "playbackLeaseMs": 120000,
  "lockAfterOfflineMs": 120000,
  "purgeCacheAfterOfflineMs": 0,
  "showSecurityLockScreen": true
}
```

For stricter theft resistance after on-device testing, lower the lease/grace values or use `offlinePlaybackPolicy: "high_security"` with a positive `purgeCacheAfterOfflineMs`. Keep the first production rollout conservative and verify the AVITA LAP/RPi/AXON behavior before enabling purge.

Scheduled playback after restart is wall-clock aligned:

| Active scheduled media at restart | Expected behavior after validation |
|---|---|
| Multi-item schedule/layout | Player computes the currently active timed item from the schedule start time and shows that item, not always item 1. |
| Video still inside its timed item duration | Player seeks to the wall-clock-correct timestamp and continues playback. |
| Single scheduled video with `loop=true` | Player resumes at the modulo timestamp and continues looping. |
| Single scheduled video with `loop=false` and elapsed time greater than item duration | Player does not replay from `0`; it holds near the final frame until the schedule/default-media transition. |
| Crash or power loss | Player does not create fake proof-of-play completion/backfill. Restart creates a new playback instance only when playback is active again. |

The updated player package stores a small `playback-progress.json` fallback in the cache path for schedules without a usable start anchor. The file contains only non-secret identifiers and timing numbers. It must not contain media URLs, signed URLs, tokens, certificates, or private keys. Schedule wall-clock state takes precedence whenever the backend snapshot includes a schedule start time.

To get this behavior on an existing screen such as AVITA LAP, install the updated player package on the device and restart the player. Backend/CMS changes are not required for the resume feature, but the player still needs the normal backend validation gate before scheduled playback is shown.

Legacy env URL overrides are still supported for compatibility:

```bash
HEXMON_API_BASE=http://192.168.0.6:3000
HEXMON_WS_URL=http://192.168.0.6:3000
```

Prefer `DARSHAN_PLAYER_CONFIG_FILE` for production because it keeps non-secret runtime values in one auditable file.

Do not put these in the player config file:

- device IDs,
- pairing codes,
- cert PEMs,
- private keys,
- tokens,
- passwords,
- app-data paths copied from another player,
- proof-of-play queues,
- request queues,
- media cache metadata.

Do not copy player app-data between physical machines. Pair each player normally.

## Player Config Key Reference

The player config file is JSON only and must have a top-level `player` object. Unknown keys fail fast. Secret-looking keys such as `password`, `token`, `secret`, `private`, `credential`, `jwt`, `certificate`, `api_key`, or `access_key` are rejected. URLs with embedded username/password are also rejected.

Environment variables override values from the config file. This is useful for emergency overrides but should not be the normal production path.

| Key | Type | Meaning |
|---|---|---|
| `player.environment.name` | string | Human-readable environment label, for example `production`, `qa`, or `store-1`. Sent safely for backend environment checks/diagnostics. |
| `player.environment.deploymentId` | string | Site or deployment identifier, for example `site-a`. Helps operators confirm the player is pointed at the intended backend. |
| `player.environment.expectedServerId` | string | Expected backend/server identity label. Used for mismatch diagnostics where supported. |
| `player.runtime.mode` | `dev`, `qa`, `production` | Runtime mode. Use `production` on real player machines. Production/QA modes enable stricter kiosk/debug-surface behavior. |
| `player.backend.baseUrl` | URL | Backend REST API base URL. Example: `http://192.168.0.6:3000`. Must be `http` or `https` and must not include credentials. |
| `player.backend.socketIoUrl` | URL | Socket.IO endpoint URL. `http`/`https` values are accepted and normalized internally to `ws`/`wss`. Example: `http://192.168.0.6:3000/socket.io/`. |
| `player.realtime.enabled` | boolean | Enables realtime notification connection. REST/DB remains source of truth and media still moves through HTTP/object storage/local cache. |
| `player.realtime.signedAuthEnabled` | boolean | Enables signed realtime auth only if backend is configured for it. Leave `false` unless explicitly deployed. |
| `player.realtime.deviceNamespace` | string | Socket.IO namespace for device notifications. Current default is `/device`. |
| `player.realtime.commandSafetyPollMs` | number | Safety polling interval used even when realtime is enabled. Minimum accepted value is `10000`. |
| `player.realtime.desiredStatePollMs` | number | Desired-state fallback polling interval. Minimum accepted value is `30000`. |
| `player.polling.heartbeatMs` | number | Heartbeat interval in milliseconds. Minimum accepted by config file is `10000`. |
| `player.polling.commandPollMs` | number | Command polling interval in milliseconds. Minimum accepted by config file is `5000`. |
| `player.polling.snapshotPollMs` | number | Schedule/snapshot polling interval in milliseconds. Minimum accepted by config file is `10000`. |
| `player.polling.defaultMediaPollMs` | number | Default-media polling interval in milliseconds. Minimum accepted by config file is `10000`. |
| `player.pairing.offlineValidationGraceMs` | number | How long a previously validated identity may continue offline. Example `604800000` is 7 days. |
| `player.pairing.backendFirstRolloutMode` | boolean | Keeps old-backend rollout safety. Leave `true` unless there is a documented migration reason. |
| `player.security.offlinePlaybackPolicy` | `standard`, `secure`, `high_security` | Additional playback lock policy. `standard` preserves normal offline grace. `secure`/`high_security` require recent backend validation for visible playback. |
| `player.security.backendRequiredForPlayback` | boolean | When `true`, visible playback is gated by the secure playback lease even if policy is `standard`. |
| `player.security.networkSwitchGraceMs` | number | Minimum grace window for legitimate network changes before security lock. |
| `player.security.playbackLeaseMs` | number | How long a successful backend validation keeps playback allowed before backend contact is required again. |
| `player.security.lockAfterOfflineMs` | number | Grace window after backend contact is lost before playback is locked. Effective grace is the larger of this value and `networkSwitchGraceMs`. |
| `player.security.purgeCacheAfterOfflineMs` | number | Optional media-cache purge timeout after backend loss. `0` disables purge. Purge preserves logs, PoP spool, and request queues. |
| `player.security.showSecurityLockScreen` | boolean | Shows the full-screen backend-validation warning while locked. Keep `true` for production operators. |
| `player.duplicateIdentity.enabled` | boolean | Enables duplicate/cloned identity detection metadata handling. |
| `player.duplicateIdentity.enforcement` | `warn`, `block` | Duplicate identity mode. Keep `warn` for production unless block mode has been separately approved and tested. |
| `player.cache.maxBytes` | number | Maximum local media cache size in bytes. Example `10737418240` is 10 GiB. |
| `player.diagnostics.showEnvironmentIdentity` | boolean | Shows safe environment/deployment identity in diagnostics/operator output. Does not print secrets. |

Currently unsupported in the JSON config file:

- `socketTransport`
- `socketAllowPolling`
- certificates/private keys/tokens/secrets
- cache path
- device identity/pairing state

If those unsupported keys are added, the player config loader will reject the file.

## Backend Runtime Tools

The renderer/media tools are installed inside the backend Docker image/container. They are not installed into the host `darshan-server/` folder and they may not exist on the Mac host.

The live backend container should have:

- `ffmpeg`
- `libreoffice`
- `pg_dump`
- `tar`
- Playwright Node module
- Playwright Chromium executable for webpage capture

```bash
cd /Users/anuragkumar/Desktop/signhex
bash deploy/production/check-backend-runtime-tools.sh
```

You can also verify the currently running backend container directly:

```bash
docker exec darshan-backend-api-1 sh -lc '
command -v ffmpeg
command -v libreoffice
command -v pg_dump
command -v tar
node -e "const { chromium } = require(\"playwright\"); console.log(chromium.executablePath())"
'
```

Expected result shape:

```text
/usr/bin/ffmpeg
/usr/bin/libreoffice
/usr/bin/pg_dump
/usr/bin/tar
/ms-playwright/chromium-*/chrome-linux/chrome
```

Full verification previously passed against `darshan-backend-api-1`:

```text
ffmpeg: /usr/bin/ffmpeg
libreoffice: /usr/bin/libreoffice
pg_dump: /usr/bin/pg_dump
tar: /usr/bin/tar
playwright module: OK
chromium executable: /ms-playwright/chromium-1208/chrome-linux/chrome
playwright chromium launch: OK
```

## Browser Inspect / Source / Network Hardening

For the CMS running in a normal browser, it is not technically possible to fully block DevTools, the Network tab, or the Sources tab. A user who controls the browser can open DevTools from the browser menu or OS shortcuts.

The production hardening here does the enforceable parts:

- CMS production build explicitly disables source maps.
- CMS nginx returns `404` for `*.map` files.
- CMS build output should not contain `.map` files.
- The frontend backend URL/IP can still be visible by design; it is not a secret.
- Real secrets must never be placed in frontend env, JS bundles, localStorage, screenshots, or network responses.
- Backend auth/RBAC remains the real security boundary.

For the Electron player, production/kiosk mode is stricter:

- app menu is removed,
- DevTools are disabled on the BrowserWindow,
- context-menu inspect is blocked,
- DevTools/source-view shortcuts are blocked,
- stale source maps/declaration files are removed from player `dist` during build.

Useful verification commands:

```bash
cd /Users/anuragkumar/Desktop/signhex

find darshan-cms/dist -type f -name '*.map' -print
find darshan-player/dist -type f \( -name '*.map' -o -name '*.d.ts' \) -print
```

Both commands should print nothing after a production build.

## Notes

- Backend runtime tools are inside the backend Docker image, not separate ffmpeg/libreoffice containers and not host-level installs.
- Valkey is a separate container/project and backend connects to it through the host-published `6379` port.
- Media stays HTTP/object-storage/local-cache based. Socket.IO remains notification-only.
- Login is backend API plus CMS UI. There is no separate login container.
