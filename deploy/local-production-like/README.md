# DARSHAN Local Production-Like Docker Split

This folder starts the server-side DARSHAN roles as separate Docker Compose projects so Docker Desktop does not show everything under the single `darshan-server` project.

It is for the current two-machine setup:

- Machine A: server roles on `192.168.0.6`
- Machine B: packaged player only

Future LXC/VM deployments use the same role split. Change only the host values in `deploy/local-production-like/.env.local` or your deployment config.

## Role Split

| Role | Compose project | Services |
|---|---|---|
| Data / VM1 | `darshan-data` | Postgres, MinIO |
| Valkey | `darshan-valkey` | Valkey |
| Backend | `darshan-backend` | API container with worker role enabled, ffmpeg, LibreOffice, pg_dump, tar, Playwright/Chromium |
| CMS | `darshan-cms-prod` | nginx static CMS |
| Observability | `darshan-observability` | Prometheus, Grafana |

Docker Desktop may still show multiple services inside the data and observability projects because Postgres/MinIO and Prometheus/Grafana are separate containers. That is expected. The important fix is that data, Valkey, backend, CMS, and observability are no longer one `darshan-server` Compose project.

## One-Time Setup

Run from the repo root:

```bash
cd /Users/anuragkumar/Desktop/signhex
cp deploy/local-production-like/.env.example deploy/local-production-like/.env.local
```

Edit `.env.local` only if your server IP is not `192.168.0.6`.

Keep real secrets in `darshan-server/.env`. Do not put database passwords, MinIO secret keys, JWT secrets, private keys, tokens, or cert material in `.env.local`.

The helper scripts require `deploy/local-production-like/.env.local`. Non-secret host and port values come from that file:

```text
DATA_HOST
VALKEY_HOST
BACKEND_HOST
CMS_HOST
OBSERVABILITY_HOST
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

## Fresh Start

Stop the old combined project first:

```bash
cd /Users/anuragkumar/Desktop/signhex
cd darshan-server
docker compose --env-file .env down --remove-orphans
```

Start the split production-like stack:

```bash
cd /Users/anuragkumar/Desktop/signhex
bash deploy/local-production-like/start-all.sh
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

bash deploy/local-production-like/start-data.sh
bash deploy/local-production-like/start-valkey.sh
bash deploy/local-production-like/start-backend.sh
bash deploy/local-production-like/start-cms.sh
bash deploy/local-production-like/start-observability.sh
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

This removes Docker volumes for the split local stack.

```bash
bash deploy/local-production-like/reset-fresh.sh
```

Use this only when you intentionally want a clean database and clean object storage.

## Health Check

```bash
cd /Users/anuragkumar/Desktop/signhex
bash deploy/local-production-like/health-check.sh
```

Expected endpoints:

```bash
curl -fsS http://192.168.0.6:3000/api/v1/health
curl -fsS http://192.168.0.6:9000/minio/health/live
curl -fsS http://192.168.0.6:9090/-/healthy
```

## Player Machine Config

Use the packaged player on the second machine and point it at Machine A:

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

Do not copy player app-data between physical machines. Pair each player normally.

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
bash deploy/local-production-like/check-backend-runtime-tools.sh
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

## Notes

- Backend runtime tools are inside the backend Docker image, not separate ffmpeg/libreoffice containers and not host-level installs.
- Valkey is a separate container/project and backend connects to it through the host-published `6379` port.
- Media stays HTTP/object-storage/local-cache based. Socket.IO remains notification-only.
- Login is backend API plus CMS UI. There is no separate login container.
