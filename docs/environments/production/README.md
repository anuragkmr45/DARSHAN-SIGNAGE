# DARSHAN Production Environment

Last code-truth refresh: 2026-06-28.

Production uses Docker role deployments on normal VMs. Proxmox is the hypervisor only; DARSHAN services run in Docker containers inside Ubuntu Server VMs.

## Source Evidence

| Contract | Code / file source |
|---|---|
| Production overview | `deploy/production/README.md`, `deploy/production/docker/README.md` |
| Role env loader | `deploy/production/docker/lib.sh` |
| Role startup | `deploy/production/docker/start-data.sh`, `start-valkey.sh`, `start-backend.sh`, `start-cms.sh`, `start-observability.sh` |
| Compose roles | `deploy/production/docker/*/docker-compose.yml` |
| Backend env/config | `darshan-server/.env.example`, `darshan-server/config/backend.production.example.json`, backend config loaders |
| CMS runtime config | `darshan-cms/public/config/app-config.example.json`, CMS runtime config loader |
| Player config | `darshan-player/src/common/file-config.ts`, `docs/runbooks/player-deployment.md` |

## Five-VM Role Layout

| VM | Role | Docker project | Containers | Ports from env |
|---|---|---|---|---|
| VM1 | Data | `darshan-data` | `postgres`, `minio` | `POSTGRES_HOST_PORT`, `MINIO_HOST_PORT`, `MINIO_CONSOLE_PORT` |
| VM2 | Valkey | `darshan-valkey` | `valkey` | `VALKEY_HOST_PORT` |
| VM3 | Backend | `darshan-backend` | `api` with `DARSHAN_PROCESS_ROLE=all` | `API_HOST_PORT` |
| VM4 | CMS | `darshan-cms-prod` | `cms` nginx static app | `CMS_HTTP_PORT` |
| VM5 | Observability | `darshan-observability` | `prometheus`, `grafana` | `PROMETHEUS_PORT`, `GRAFANA_PORT` |

Containers do not receive LAN/Wi-Fi IPs directly. VM host IPs expose container ports.

## Required Files Per Production Target

| Target | Required files | Notes |
|---|---|---|
| Data VM | `deploy/production/docker/.env` | Needs Postgres/MinIO bootstrap values. |
| Valkey VM | `deploy/production/docker/.env` | Needs host/port/image values. |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files | Backend role scripts load backend app env plus Docker env. |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` | `darshan-cms/.env` is only a build-time fallback, not the primary runtime source. |
| Observability VM | `deploy/production/docker/.env` | `start-observability.sh` generates Prometheus config from Docker env. |
| Player device | installed player package, `/etc/darshan/player/config.json` | Player is not a Docker server role. |

## Production Docker Env

Create on every server VM:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
```

This file is read by `deploy/production/docker/lib.sh`.

Required classes of values:

| Class | Examples |
|---|---|
| Role hosts | `DATA_HOST`, `VALKEY_HOST`, `BACKEND_HOST`, `CMS_HOST`, `OBSERVABILITY_HOST` |
| Ports | `POSTGRES_HOST_PORT`, `MINIO_HOST_PORT`, `VALKEY_HOST_PORT`, `API_HOST_PORT`, `CMS_HTTP_PORT`, `PROMETHEUS_PORT`, `GRAFANA_PORT` |
| Images | `POSTGRES_IMAGE`, `MINIO_IMAGE`, `VALKEY_IMAGE`, `BACKEND_IMAGE`, `CMS_IMAGE`, `PROMETHEUS_IMAGE`, `GRAFANA_IMAGE` |
| Data bootstrap | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` |
| Build/runtime toggles | `INSTALL_PLAYWRIGHT_CHROMIUM`, `RUN_PRODUCTION_DB_PUSH`, `RUN_PRODUCTION_SEED` |
| CMS/player public paths | `CMS_RUNTIME_CONFIG_SOURCE`, `PLAYER_BACKEND_BASE_URL`, `PLAYER_SOCKET_IO_URL`, `PLAYER_CONFIG_FILE_PATH` |

`MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` must match between Data VM and Backend VM because MinIO uses them as root credentials and backend uses them to access object storage.

## Backend VM App Env

Create only on Backend VM:

```bash
cp darshan-server/.env.example darshan-server/.env
```

For Docker production, use:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
DARSHAN_ENV=production
DARSHAN_PROCESS_ROLE=all
```

Do not use `DARSHAN_CONFIG_FILE=/etc/darshan/server/config.json` for Docker production. That is a direct-host install path, not the backend container mount path.

Backend app env holds:

- `JWT_SECRET`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- `CA_CERT_PATH` and `CA_KEY_PATH`
- optional metrics bearer token
- optional runtime tool overrides
- emergency env overrides

The backend compose builds `DATABASE_URL` from the Docker role env and passes MinIO credentials from the Docker role env.

## Backend JSON Config

Create only on Backend VM:

```bash
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
```

Important production IP mapping:

| Backend config field | Use |
|---|---|
| `http.appPublicBaseUrl` | CMS public origin, normally `http://<CMS_HOST>:<CMS_HTTP_PORT>` unless HTTPS/proxy is added. |
| `http.corsOrigins[]` | Same CMS browser origin(s). |
| `http.socketAllowedOrigins[]` | Same CMS browser origin(s). |
| `media.endpoint` | Data VM MinIO API origin, normally `http://<DATA_HOST>:<MINIO_HOST_PORT>`. |
| `observability.prometheusUrl` | Observability VM Prometheus origin, normally `http://<OBSERVABILITY_HOST>:<PROMETHEUS_PORT>`. |

Do not put credentials, query strings, fragments, tokens, or passwords in backend JSON config. The backend loader rejects secret-looking keys and credentialed URLs.

## CMS Runtime Config

Create only on CMS VM:

```bash
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
```

Production values should point at the CMS public origin when CMS nginx proxies backend and Socket.IO:

```json
{
  "cms": {
    "environment": {
      "name": "production",
      "deploymentId": "site-a",
      "cmsId": "cms-a"
    },
    "api": {
      "baseUrl": "http://<CMS_HOST>:<CMS_HTTP_PORT>"
    },
    "realtime": {
      "socketBaseUrl": "http://<CMS_HOST>:<CMS_HTTP_PORT>",
      "socketTransports": ["websocket"]
    },
    "diagnostics": {
      "showEnvironmentIdentity": true
    }
  }
}
```

CMS runtime config is browser-visible. Do not put secrets in it.

## Player Site Config

Create on each player machine, not on server VMs:

```text
/etc/darshan/player/config.json
```

Select it in the player environment:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

Point the player at the backend API/Socket.IO origin:

```json
{
  "player": {
    "environment": {
      "name": "production",
      "deploymentId": "site-a",
      "expectedServerId": "backend-a"
    },
    "backend": {
      "baseUrl": "http://<BACKEND_HOST>:<API_HOST_PORT>",
      "socketIoUrl": "http://<BACKEND_HOST>:<API_HOST_PORT>/socket.io/"
    },
    "runtime": {
      "mode": "production"
    },
    "realtime": {
      "enabled": true,
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

Current player source also supports `player.security` in the player site config, but only updated packages containing that loader will accept it. Older installed player packages may reject unknown keys.

## Role Startup Order

Run on each VM:

```bash
bash deploy/production/docker/start-data.sh
bash deploy/production/docker/start-valkey.sh
bash deploy/production/docker/start-backend.sh
bash deploy/production/docker/start-cms.sh
bash deploy/production/docker/start-observability.sh
```

For five VMs, run only the role script for that VM. `start-all.sh` is single-host lab convenience only.

## Runtime Evidence Boundary

These docs do not prove production readiness. Production evidence still requires live role health checks, browser CMS QA, packaged player QA, player pairing/default-media/schedule/realtime tests, observability scrape checks, and no-secret review.

