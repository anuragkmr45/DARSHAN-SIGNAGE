# DARSHAN Player

Production-grade Windows and Ubuntu Electron digital signage player with offline-first architecture, mTLS authentication, and comprehensive telemetry.

For on-prem deployment and support, start with the canonical runbooks in the `DARSHAN monorepo root` repo:

- product export packaging: `docs/runbooks/product-export-packaging.md`
- QA: `docs/runbooks/onprem-qa-setup.md`
- Production: `docs/runbooks/onprem-production-setup.md`
See [PLATFORM_SUPPORT.md](./PLATFORM_SUPPORT.md) for the current production and development support matrix.
For Windows-specific audit status and native validation steps, see:

- [docs/windows-compatibility-audit.md](./docs/windows-compatibility-audit.md)
- [docs/windows-feature-validation-matrix.md](./docs/windows-feature-validation-matrix.md)
- [docs/windows-runtime-validation-checklist.md](./docs/windows-runtime-validation-checklist.md)
For Ubuntu-specific audit status and native validation steps, see:

- [docs/ubuntu-compatibility-audit.md](./docs/ubuntu-compatibility-audit.md)
- [docs/ubuntu-feature-validation-matrix.md](./docs/ubuntu-feature-validation-matrix.md)
- [docs/ubuntu-runtime-validation-checklist.md](./docs/ubuntu-runtime-validation-checklist.md)

Supported on-prem production contract:

- player devices connect directly to `http://<backend-ip>:3000`
- `wsUrl` should be `ws://<backend-ip>:3000/ws`
- no DNS is required in the supported air-gapped profile
- if no backend IP is configured in `qa` or `production`, the player now stays open and shows a configuration-required state instead of guessing an IP

Runtime-bundle contract:

- target player machines receive only generated installers and config templates
- do not copy the player source tree to QA or production devices
- the unified bundle builder stages prebuilt Windows and Ubuntu installers from `PLAYER_ARTIFACTS_DIR`
- use `scripts/export/package-electron.sh` to create the per-platform distributable folders
- build Electron installers on a native builder for the target platform

## Features

### Core Capabilities
- **Offline-First Architecture**: Continues operation without constant connectivity
- **mTLS Authentication**: Secure device authentication with certificate pinning
- **Content Cache**: LRU cache with SHA-256 integrity verification and resume support
- **Multi-Format Support**: Images (jpg, png, avif, webp), Video (mp4, mov), PDF, URLs
- **Scheduling Engine**: Immutable schedule snapshots with prefetching
- **Emergency Override**: High-priority interrupt system
- **Proof-of-Play**: Comprehensive playback tracking with offline spooling
- **Telemetry & Health**: System metrics, heartbeats, and health endpoints
- **Device Commands**: Remote control via device-command polling; publish refresh is command-driven
- **Power Management**: DPMS control and scheduled on/off times

### Security
- Strict Content Security Policy (CSP)
- Renderer process sandboxing with Node.js disabled
- Context isolation enabled
- Domain allowlist for remote content
- PII redaction in logs
- Secure file permissions (0600 for secrets)
- mTLS with pinned CA

### Reliability
- Single-instance enforcement
- Crash auto-restart with bounded exponential backoff
- Atomic file writes
- Journal-safe operations
- Graceful degradation on network loss
- WebSocket → HTTP polling fallback

## Architecture

```
src/
├── main/           # Main process (orchestration)
│   ├── index.ts
│   ├── services/   # Core services
│   │   ├── cache/
│   │   ├── network/
│   │   ├── telemetry/
│   │   ├── playback/
│   │   ├── commands/
│   │   └── power/
│   └── managers/   # High-level managers
├── renderer/       # Renderer process (UI)
│   ├── index.html
│   ├── player.ts
│   └── pairing.ts
├── preload/        # Preload scripts (IPC bridge)
│   └── index.ts
└── common/         # Shared code
    ├── types.ts
    ├── config.ts
    ├── logger.ts
    └── utils.ts
```

## Installation

### Prerequisites
- Windows 10/11 desktop session or Ubuntu 22.04+ desktop session
- Node.js 20 LTS and npm 9+ for source builds
- 10GB+ free disk space for cache

### From Package
Windows:
```powershell
DARSHAN-Player-Setup.exe
```

Ubuntu:
```bash
sudo dpkg -i darshan-player_1.0.0_amd64.deb
# or run the AppImage directly
./DARSHAN-Player-1.0.0.AppImage
```

### From Source
```bash
git clone https://github.com/darshan/signage-player.git
cd signage-player
npm install
npm run build
npm run package:linux
# or
npm run package:win
# or on macOS
npm run package:mac
```

## Configuration

Configuration is loaded from (in order of precedence):
1. Environment variables (`DARSHAN_*`; `HEXMON_*` remains a legacy alias)
2. The configured `DARSHAN_CONFIG_PATH` / `SIGNAGE_CONFIG_PATH` / `HEXMON_CONFIG_PATH`
3. The per-user Electron app-data directory
4. Built-in defaults

On Linux, legacy `/etc/darshan`, `/var/lib/darshan`, and `/var/cache/darshan` state is imported once into the app-data runtime root when no explicit override paths are set.

### Example Configuration

```json
{
  "apiBase": "http://10.20.0.20:3000",
  "wsUrl": "ws://10.20.0.20:3000/ws",
  "deviceId": "",
  "runtime": {
    "mode": "production"
  },
  "mtls": {
    "enabled": true,
    "autoRenew": true,
    "renewBeforeDays": 30
  },
  "cache": {
    "maxBytes": 10737418240,
    "prefetchConcurrency": 3,
    "bandwidthBudgetMbps": 50
  },
  "intervals": {
    "heartbeatMs": 60000,
    "commandPollMs": 5000,
    "schedulePollMs": 300000,
    "healthCheckMs": 60000
  },
  "log": {
    "level": "info",
    "shipPolicy": "batch",
    "rotationSizeMb": 100,
    "rotationIntervalHours": 24,
    "compressionEnabled": true
  },
  "power": {
    "dpmsEnabled": true,
    "preventBlanking": true,
    "scheduleEnabled": false,
    "onTime": "08:00",
    "offTime": "18:00"
  },
  "security": {
    "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    "allowedDomains": [],
    "disableEval": true,
    "contextIsolation": true,
    "nodeIntegration": false,
    "sandbox": true
  }
}
```

`runtime.mode` only supports `dev`, `qa`, and `production`.

- `dev`: windowed app, no kiosk lock, keyboard and mouse remain available
- `qa`: fullscreen kiosk with mouse and keyboard input blocked
- `production`: fullscreen kiosk with mouse and keyboard input blocked

### Environment Variables

All player-owned configuration options can be set via preferred `DARSHAN_` environment variables. Existing `HEXMON_` variables remain supported as one-release compatibility aliases.

```bash
export DARSHAN_API_BASE_URL="http://10.20.0.20:3000"
export DARSHAN_WS_URL="ws://10.20.0.20:3000/ws"
export DARSHAN_DEVICE_ID="device-12345"
export DARSHAN_RUNTIME_MODE="qa"
export DARSHAN_MTLS_ENABLED="true"
export DARSHAN_CACHE_MAX_BYTES="10737418240"
export DARSHAN_LOG_LEVEL="debug"
```

## Schedule refresh model

- The player learns schedule timing from `GET /api/v1/device/:deviceId/snapshot`.
- After a schedule is published, the backend queues a `REFRESH` device command for affected screens.
- The player polls device commands, fetches a fresh snapshot immediately, and then uses its local schedule boundary timer to switch at the exact `start_at`.
- The checked-in raw `wsUrl` setting is not the authoritative publish-to-screen path for playback updates in the current runtime.

## Device Pairing

On first run, the player displays a pairing screen:

1. Enter the 6-character pairing code from the admin dashboard
2. Player generates ECDSA (P-256) CSR locally
3. Sends pairing request to backend: `POST /api/v1/device-pairing/complete`
4. Receives device certificate and configuration
5. Stores certificate with 0600 permissions
6. Switches to mTLS for all subsequent requests

### Manual Pairing

```bash
# Choose a writable cert directory. The packaged player defaults to the
# per-user runtime root, or you can set DARSHAN_MTLS_CERT_DIR explicitly.
export DARSHAN_MTLS_CERT_DIR="${HOME}/.config/DARSHAN Player/certs"
mkdir -p "${DARSHAN_MTLS_CERT_DIR}"

# Generate CSR
openssl ecparam -name prime256v1 -genkey -noout -out "${DARSHAN_MTLS_CERT_DIR}/client.key"
openssl req -new -key "${DARSHAN_MTLS_CERT_DIR}/client.key" -out /tmp/client.csr

# Submit pairing request
curl -X POST http://10.20.0.20:3000/api/v1/device-pairing/complete \
  -H "Content-Type: application/json" \
  -d '{"pairing_code":"ABC123","csr":"<CSR_CONTENT>"}'

# Save certificate
echo "<CERT_CONTENT>" > "${DARSHAN_MTLS_CERT_DIR}/client.crt"
echo "<CA_CONTENT>" > "${DARSHAN_MTLS_CERT_DIR}/ca.crt"
chmod 600 "${DARSHAN_MTLS_CERT_DIR}"/*
```

## Usage

### Starting the Player

```bash
# Packaged install
darshan-player

# Operator commands
darshan-player doctor
darshan-player pair request
darshan-player pair submit ABC123
darshan-player clear-cache
darshan-player collect-logs

# Development mode
npm run start:dev
```

`npm run start:dev` launches Electron through `scripts/start-dev.js`. The launcher uses an isolated
development runtime root at `darshan-player/.runtime/dev-player`, defaults to
`development/local/darshan-api`, and ignores installed site config selectors such as
`DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/config.json` by default. This prevents a source-tree dev
run from accidentally pairing with a production/QA site identity and then returning to the OTP
screen after bootstrap validation.

For LAN development against a different local backend, override only the endpoint values:

```bash
DARSHAN_API_BASE_URL=http://192.168.29.64:3000 \
DARSHAN_WS_URL=ws://192.168.29.64:3000/ws \
DARSHAN_REALTIME_WS_URL=ws://192.168.29.64:3000/ws \
npm run start:dev
```

To intentionally test an installed site profile from source, opt in explicitly:

```bash
DARSHAN_DEV_USE_SITE_CONFIG=true npm run start:dev
```

Autostart is managed at the user-session level:

- Windows: login item registration
- Ubuntu: XDG autostart desktop entry

### Health Check

```bash
curl http://127.0.0.1:3300/healthz
```

The local health and metrics server stays bound to `127.0.0.1` by default. Remote scraping is disabled unless `observability.allowRemoteAccess` is explicitly turned on in the player config.

Response:
```json
{
  "status": "healthy",
  "appVersion": "1.0.0",
  "uptime": 3600,
  "lastScheduleSync": "2025-01-01T12:00:00Z",
  "cacheUsage": {
    "totalBytes": 10737418240,
    "usedBytes": 5368709120,
    "freeBytes": 5368709120,
    "entryCount": 42,
    "quarantinedCount": 0
  },
  "lastErrors": [],
  "systemStats": {
    "cpuUsage": 25.5,
    "memoryUsage": 450000000,
    "memoryTotal": 8000000000,
    "diskUsage": 50000000000,
    "diskTotal": 100000000000,
    "uptime": 3600
  },
  "timestamp": "2025-01-01T12:00:00Z"
}
```

### Diagnostics Overlay

Press `Ctrl+Shift+D` to toggle the diagnostics overlay showing:
- Device ID and IP address
- WebSocket connection state
- Last schedule sync time
- Cache usage percentage
- Command queue status
- Current screen mode

### Metrics Exposure

`/metrics` now exposes Prometheus-native `darshan_player_*` families for heartbeat outcomes, queue backlog, cache usage, player state, screenshot uploads, command processing, and host resource snapshots.

Safe defaults:

- `observability.enabled=true`
- `observability.metricsEnabled=true`
- `observability.bindAddress=127.0.0.1`
- `observability.port=3300`
- `observability.allowRemoteAccess=false`

Use direct player scraping only on approved management networks. If direct scrape is not required, keep the default localhost binding and rely on backend summaries in the CMS.

## API Contracts

### Backend Endpoints

- `POST /api/v1/device-pairing/complete` - Device pairing
- `POST /api/v1/device/heartbeat` - Telemetry heartbeat
- `POST /api/v1/device/proof-of-play` - Proof-of-play events
- `POST /api/v1/device/screenshot` - Screenshot upload
- `GET /api/v1/device/:deviceId/commands` - Poll for commands
- `POST /api/v1/device/:deviceId/commands/:cmdId/ack` - Command acknowledgment
- `GET /api/v1/device/:deviceId/schedule` - Fetch schedule snapshot
- `GET /api/v1/device/:deviceId/emergency` - Check emergency override
- `POST /api/v1/device/logs` - Upload log bundles

### WebSocket Messages

```typescript
// Emergency override
{
  "type": "emergency",
  "payload": {
    "id": "emergency-123",
    "active": true,
    "content": { /* TimelineItem */ }
  }
}

// Device command
{
  "type": "command",
  "payload": {
    "id": "cmd-456",
    "type": "SCREENSHOT",
    "payload": {}
  }
}

// Schedule update notification
{
  "type": "schedule_update",
  "payload": {
    "scheduleId": "schedule-789",
    "version": 2
  }
}
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Lint
npm run lint
npm run lint:fix

# Format
npm run format
npm run format:check

# Test
npm run test
npm run test:watch

# Package
npm run package          # All formats
npm run package:deb      # .deb only
npm run package:appimage # AppImage only
```

## Performance Targets

- Cold start → first frame: ≤5s (warm cache)
- CPU usage: <40% p95 during image playback
- RAM usage: <500MB p95
- Timeline jitter: ≤100ms p95
- Cache integrity errors: 0
- Download success rate: ≥99.9%

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues and solutions.

## Security

See [SECURITY.md](./SECURITY.md) for security considerations and reporting vulnerabilities.

## License

Apache-2.0

## Support

For support, please contact support@darshan.com or visit https://docs.darshan.com
