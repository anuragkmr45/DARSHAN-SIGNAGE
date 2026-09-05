# DARSHAN Player Deployment Runbook

Last code-truth refresh: 2026-08-23.

For source-free production, use the generated `production/electron/` config,
installer, and transport CA without manually rebuilding the JSON below.

Use this runbook to install or update the DARSHAN Electron player on Ubuntu, Raspberry Pi OS 64-bit, or compatible Linux signage hardware.

For full server-side production setup, see:

```text
docs/runbooks/onprem-production-setup.md
deploy/production/README.md
```

## Supported Player Targets

Recommended production targets:

- Ubuntu x64
- Raspberry Pi OS 64-bit / ARM64
- compatible ARM64 signage boards, such as AXON-class devices, after package validation

Avoid 32-bit Raspberry Pi OS unless it is explicitly tested for the release.

## Production Method

Use a packaged `.deb` install.

Do not run the player from source for production kiosk evidence. Source/dev mode is acceptable only for local engineering checks.

Code sources:

- package scripts: `darshan-player/package.json`
- Electron main runtime: `darshan-player/src/main/index.ts`
- player config loader: `darshan-player/src/common/file-config.ts`
- player paths: `darshan-player/src/common/platform-paths.ts`
- operator CLI: `darshan-player/src/main/cli.ts`

## Build The Package

Build on a machine with the repo checkout and Node 20.

Ubuntu x64:

```bash
cd /opt/signhex/darshan-player
npm install
npm run build
npm run package:linux:x64
```

Raspberry Pi OS 64-bit / ARM64:

```bash
cd /opt/signhex/darshan-player
npm install
npm run build
npm run package:linux:arm64
```

Find the generated package:

```bash
find /opt/signhex/darshan-player/build -type f -name "*.deb" -print
```

The package name usually looks like:

```text
darshan-player_1.0.0_amd64.deb
darshan-player_1.0.0_arm64.deb
```

## Copy To Player Device

Example:

```bash
scp /opt/signhex/darshan-player/build/*.deb hexmon@<PLAYER_IP>:/tmp/
```

Replace `hexmon` and `<PLAYER_IP>` with the real player username and IP.

## Install Or Update

Run on the player machine:

```bash
sudo apt update
sudo apt install -y /tmp/darshan-player*.deb
```

If dependencies need repair:

```bash
sudo apt --fix-broken install
sudo apt install -y /tmp/darshan-player*.deb
```

Verify:

```bash
command -v darshan-player
dpkg -l | grep -i darshan
dpkg -L darshan-player 2>/dev/null | grep '/bin/'
```

If `darshan-player` is not found, the package did not install correctly or the binary name differs from the expected package.

## Player Config File

Create this file on each player:

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
      "baseUrl": "https://backend.site.test:3000",
      "socketIoUrl": "wss://backend.site.test:3000"
    },
    "realtime": {
      "enabled": true,
      "signedAuthEnabled": false,
      "deviceNamespace": "/device",
      "commandSafetyPollMs": 60000,
      "desiredStatePollMs": 300000
    },
    "transportTls": {
      "enabled": true,
      "caPath": "/etc/darshan/transport-ca.crt",
      "strictCertificateValidation": true
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

Use the Backend VM IP in:

```json
"baseUrl": "https://<BACKEND_HOST>:3000"
```

and:

```json
"socketIoUrl": "wss://<BACKEND_HOST>:3000"
```

Do not put device IDs, certificates, private keys, tokens, pairing state, or cache metadata in this config file.

Install the public transport CA at the configured `transportTls.caPath`. This
CA is not the player device certificate and must not be placed in `mtls.caPath`.
Production config rejects HTTP, WS, missing transport trust, and disabled
certificate validation.

Validate JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('/etc/darshan/player/config.json','utf8')); console.log('config json OK')"
```

## Start Manually

If an old instance is running, stop it first:

```bash
pgrep -af 'darshan-player|DARSHAN-Player' || true
pkill -f 'darshan-player|DARSHAN-Player' || true
pgrep -af 'darshan-player|DARSHAN-Player' || echo "player stopped"
```

Start:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player
```

If the player exits immediately, run diagnostics:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player doctor
```

Current packages also discover `/etc/darshan/player/config.json` automatically,
so desktop autostart remains configured after reboot without a shell export.
The env selector is still useful for nonstandard or side-by-side config paths.

## Autostart

Production player machines must autostart the player after reboot.

If using systemd, set the config environment:

```ini
[Service]
Environment="DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json"
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart darshan-player
sudo systemctl status darshan-player
```

If using desktop autostart, verify the desktop entry or wrapper script exports the config selector:

```bash
ls -l ~/.config/autostart/
cat ~/.config/autostart/darshan-player.desktop
```

## Pairing

Start the player and use the OTP screen in CMS.

Expected behavior:

1. Player starts.
2. Player reads `/etc/darshan/player/config.json`.
3. Player contacts Backend VM.
4. OTP/pairing screen appears if not paired.
5. CMS pairing flow approves the player.
6. Player persists identity/runtime state locally.
7. Player begins heartbeat, realtime notification connection, schedule/default-media fetch, and playback.

Do not copy app-data from one player to another. Pair each physical player normally.

## Reboot Behavior

After shutdown/restart:

1. OS boots.
2. Autostart/systemd starts DARSHAN Player.
3. Player loads local runtime identity and cache state.
4. Player validates with backend before treating the paired state as healthy.
5. If backend validates the device, playback and heartbeat resume.
6. If backend is temporarily unavailable and offline grace is valid, cached/offline playback may continue according to config.
7. If backend reports deleted/revoked/env mismatch, the player enters recovery/OTP flow.

Autostart is required. Without autostart, the app will not open by itself after reboot.

## Updating A Player

1. Build a new `.deb`.
2. Copy it to the player.
3. Stop the old running player.
4. Install the new `.deb`.
5. Keep `/etc/darshan/player/config.json` unless changing backend/site.
6. Restart player.
7. Verify `darshan-player doctor`.

Commands:

```bash
pkill -f 'darshan-player|DARSHAN-Player' || true
sudo apt install -y /tmp/darshan-player*.deb
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player doctor
darshan-player
```

## Fresh Re-Pairing

Use this only when intentionally resetting one player identity.

First try the supported CLI:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player reset-pairing --reason="operator requested fresh pairing"
```

Then restart the player and pair again from CMS.

Do not delete proof-of-play, request queues, or media cache unless the operator explicitly wants a full wipe.

## Health Checks

From player:

```bash
curl --fail --show-error --silent \
  --cacert /etc/darshan/player/transport-ca.crt \
  --resolve <BACKEND_CERT_HOSTNAME>:3000:<BACKEND_VM_IP> \
  https://<BACKEND_CERT_HOSTNAME>:3000/api/v1/health/ready
```

Realtime path:

```bash
curl --include --fail --show-error --silent \
  --cacert /etc/darshan/player/transport-ca.crt \
  --resolve <BACKEND_CERT_HOSTNAME>:3000:<BACKEND_VM_IP> \
  "https://<BACKEND_CERT_HOSTNAME>:3000/socket.io/?EIO=4&transport=polling"
```

Player diagnostics:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player doctor
darshan-player pairing-status
```

Diagnostics/log output must not expose credentials, signed URLs, cert PEM, private keys, or tokens.

## Runtime Evidence Boundary

Installing the package and running `doctor` are necessary checks, but they do not by themselves prove production readiness. Browser pairing, packaged autostart, target-device media rendering, screenshot capture, proof-of-play, realtime wake-up, polling fallback, and no-secret support-bundle review must be verified on the target device.

## Troubleshooting

`darshan-player: command not found`:

- install the `.deb`
- verify `command -v darshan-player`
- inspect package files with `dpkg -L darshan-player`

`Unknown player config key`:

- installed package is older than the config file
- rebuild and reinstall the latest `.deb`, or remove unsupported config keys for that installed version

`Invalid player config JSON`:

- JSON syntax error, often a trailing comma after deleting a block
- validate with the `node -e` command above

`sonic boom is not ready yet`:

- old package may have a logger shutdown bug during early exit
- check if another player instance is already running
- install the latest `.deb` built from current source

Player appears offline in CMS:

- verify backend health from the player machine
- verify player config points to Backend VM IP
- verify the player is paired to the expected screen
- run `darshan-player doctor`

Default media changes are delayed:

- verify backend realtime/Valkey/outbox are enabled and healthy
- polling fallback may still eventually apply media, but production realtime should notify quickly

## Security Notes

- Keep `/etc/darshan/player/config.json` non-secret.
- Do not store credentials in player config URLs.
- Do not copy runtime identity state between devices.
- Review support bundles/logs before sharing externally.
- For stolen-device resistant playback, use the secure offline playback policy only after real-device QA.
