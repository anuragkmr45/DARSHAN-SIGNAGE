# DARSHAN Two-Machine Production Docker Start

Use this runbook for the current local/on-prem validation shape:

- server machine: `192.168.0.6`
- player machine: separate Ubuntu/RPi/AXON/player host on the same LAN

This is production runtime behavior. Do not use Vite, TypeScript runtime runners, or development watchers for the server/CMS runtime evidence path.

For the full five-VM production deployment, use:

```text
docs/runbooks/onprem-production-setup.md
deploy/production/README.md
```

This two-machine runbook is a lab/small-site variation where all server roles share one server machine IP.

## Quick Local Split for Docker Desktop

If you are not building a source-free runtime bundle yet and only want the current repo to run as separate Docker projects on one server machine, use:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
# edit deploy/production/docker/.env only if your server IP is not 192.168.0.6

cp darshan-server/.env.example darshan-server/.env
# edit darshan-server/.env with backend secrets and set:
# DARSHAN_CONFIG_FILE=/app/config/backend.json

cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
# edit darshan-server/config/backend.json with server/CMS/data/observability IPs

cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
# edit darshan-cms/public/config/app-config.json with CMS browser origin

cd darshan-server
docker compose --env-file .env down --remove-orphans

cd ..
bash deploy/production/docker/start-all.sh
```

This starts separate Compose projects:

```text
darshan-data            Postgres + MinIO
darshan-valkey          Valkey
darshan-backend         one backend API container with worker role enabled
darshan-cms-prod        nginx static CMS
darshan-observability   Prometheus + Grafana
```

For a clean reset:

```bash
bash deploy/production/docker/reset-fresh.sh
```

That reset removes Docker volumes. Use it only when you intentionally want to delete local DB/object-store/observability data.

## Service Roles

Use host/VM IPs, not per-container Wi-Fi IPs.

For the current two-machine setup, all server roles may use `192.168.0.6`:

```text
DATA_HOST=192.168.0.6
VALKEY_HOST=192.168.0.6
BACKEND_HOST=192.168.0.6
CMS_HOST=192.168.0.6
OBSERVABILITY_HOST=192.168.0.6
PLAYER_BACKEND_BASE_URL=http://192.168.0.6:3000
```

Future five-VM deployments keep the same Docker role scripts and replace only these host values.

In the five-VM Docker deployment, do not copy every app file to every VM:

| VM | Required files |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player device | installed DARSHAN Player `.deb`, `/etc/darshan/player/config.json` |

`darshan-server/.env` is loaded only by the backend role scripts. Data, Valkey, CMS, and Observability roles use `deploy/production/docker/.env` and do not need backend secrets.

## Canonical Bundle Flow

Build source-free production artifacts on the build machine:

```bash
export RELEASE_ID="production-r1"
export SITE_NAME="local-192-168-0-6"

bash scripts/export/package-server.sh --release "$RELEASE_ID" --deployment-layout production-split
bash scripts/export/package-cms.sh --release "$RELEASE_ID"
```

Assemble the runtime bundle:

```bash
export CMS_PUBLIC_SCHEME="https"
export CMS_PUBLIC_HOST="192.168.0.6"
export BACKEND_PRIVATE_HOST="192.168.0.6"
export BACKEND_DEVICE_HOST="192.168.0.6"
export DATA_PRIVATE_HOST="192.168.0.6"
export VALKEY_PRIVATE_HOST="192.168.0.6"
export OBSERVABILITY_PRIVATE_HOST="192.168.0.6"
export SERVER_PACKAGE_DIR="out/${RELEASE_ID}/server"
export CMS_PACKAGE_DIR="out/${RELEASE_ID}/cms"
export PLAYER_ARTIFACTS_DIR="/path/to/player-artifacts"
export ONPREM_CERT_MODE="generate"

bash scripts/bundle/assemble-runtime-bundle.sh --profile production "$SITE_NAME"
```

Expected generated folders:

```text
dist/onprem/<site>/production/data/
dist/onprem/<site>/production/valkey/
dist/onprem/<site>/production/backend/
dist/onprem/<site>/production/cms/
dist/onprem/<site>/production/observability/
dist/onprem/<site>/production/electron/
```

## Fresh Start Order

Run these folders in this order. A fresh start deletes only the Docker volumes for the role where `down -v` is run.

### 1. Data

```bash
cd "dist/onprem/${SITE_NAME}/production/data"
./load-images.sh
docker compose --env-file .env.production down -v --remove-orphans
./start.sh
./health-check.sh
```

### 2. Valkey

```bash
cd "../valkey"
./load-images.sh
docker compose --env-file .env.production down -v --remove-orphans
./start.sh
./health-check.sh
```

### 3. Backend API + Worker

```bash
cd "../backend"
./load-images.sh
docker compose --env-file .env.production down --remove-orphans
./start.sh
./health-check.sh
```

The backend image contains Node 20 plus ffmpeg, LibreOffice, pg_dump, tar, and optionally Playwright/Chromium when built with `INSTALL_PLAYWRIGHT_CHROMIUM=true`.

### 4. CMS

```bash
cd "../cms"
./load-images.sh
docker compose --env-file .env.production down --remove-orphans
./start.sh
./health-check.sh
```

### 5. Observability

```bash
cd "../observability"
./load-images.sh
docker compose --env-file .env.production down --remove-orphans
./start.sh
./health-check.sh
```

## Health Checks

From the server machine:

```bash
curl -fsS http://192.168.0.6:3000/api/v1/health
curl -fsS http://192.168.0.6:9000/minio/health/live
curl -fsS http://192.168.0.6:9090/-/healthy
```

From the player machine:

```bash
curl -fsS http://192.168.0.6:3000/api/v1/health
```

## Player Config Example

Use the packaged player on the second machine. Build/install the `.deb` first; the `darshan-player` command exists only after package installation.

Ubuntu x64 package:

```bash
cd /opt/signhex/darshan-player
npm install
npm run build
npm run package:linux:x64
find build -type f -name "*.deb" -print
```

Raspberry Pi OS 64-bit / ARM64 package:

```bash
cd /opt/signhex/darshan-player
npm install
npm run build
npm run package:linux:arm64
find build -type f -name "*.deb" -print
```

Install on the player:

```bash
sudo apt update
sudo apt install -y /tmp/darshan-player*.deb
```

Then create `/etc/darshan/player/config.json` and point it at the backend host:

```json
{
  "player": {
    "backend": {
      "baseUrl": "http://192.168.0.6:3000",
      "socketIoUrl": "http://192.168.0.6:3000/socket.io/"
    },
    "realtime": {
      "enabled": true,
      "socketTransport": "websocket",
      "socketAllowPolling": false
    }
  }
}
```

Do not copy player app-data between machines. Pair each physical player normally.

Manual launch after install:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
darshan-player
```

## Troubleshooting

- `relation "roles" does not exist`: backend schema was not pushed. Run backend `./start.sh` after data is healthy.
- `ENOTFOUND hexmon-valkey` or Valkey connection errors: Valkey role is not running or backend `VALKEY_PRIVATE_HOST` is wrong.
- `curl` works on `127.0.0.1` but not `192.168.0.6`: check host firewall and active interface IP.
- CMS loads but routes 404 on refresh: nginx SPA fallback is wrong; use generated CMS bundle nginx config.
- Default media updates only after polling: confirm Valkey health, `REALTIME_SYNC_ENABLED=true`, `OUTBOX_DISPATCH_ENABLED=true`, and worker is running.
