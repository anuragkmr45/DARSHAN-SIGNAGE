# DARSHAN Proxmox LXC Production

This production path runs five Proxmox LXC system containers and does not run Docker inside any LXC.

## Recommended Layout

| CT | Name | IP | Services |
|---:|---|---|---|
| 100 | `DARSHAN-DATA` | `192.168.1.100` | PostgreSQL, MinIO |
| 101 | `DARSHAN-SERVER` | `192.168.1.101` | Node.js API/worker, ffmpeg, LibreOffice, Playwright/Chromium |
| 102 | `DARSHAN-CMS` | `192.168.1.102` | nginx static CMS |
| 103 | `DARSHAN-VALKEY` | `192.168.1.103` | Valkey |
| 104 | `DARSHAN-OBSERVABILITY` | `192.168.1.104` | Prometheus, Grafana |

## Service Map

| Old Docker project | Docker services | LXC/systemd replacement |
|---|---|---|
| `darshan-data` | `postgres`, `minio` | CT 100 `postgresql`, `minio` |
| `darshan-backend` | `api` | CT 101 `darshan-backend` |
| `darshan-cms-prod` | `cms` | CT 102 `nginx` |
| `darshan-valkey` | `valkey` | CT 103 `valkey` |
| `darshan-observability` | `prometheus`, `grafana` | CT 104 `prometheus`, `grafana-server` |

The service names are configurable in `deploy/production/.env` if your distro packages use names such as `valkey-server`. If your package installs `redis-cli` instead of `valkey-cli`, set `VALKEY_CLI_NAME=redis-cli`.

The Proxmox scripts are host-side orchestration scripts. Run them on the Proxmox node from the repository root; they use `pct start`, `pct exec`, `pct push`, and `pct shutdown` to control existing LXCs. They do not create CTs, install Debian/Ubuntu packages, create PostgreSQL users/databases, clone the repo into app CTs, or initialize MinIO credentials. Do those bootstrap tasks first, then use these scripts to publish config, build apps, restart services, and run health checks.

## Docker Parity Contract

The Proxmox LXC path is the production path, but it must provide the same DARSHAN runtime capabilities as the Docker path. Docker achieves this with images; Proxmox achieves this with OS packages, copied app files, and systemd services.

| Capability | Docker production path | Proxmox LXC production path | Verification |
|---|---|---|---|
| PostgreSQL | `postgres:15-alpine` container | CT 100 `postgresql` service | `systemctl is-active postgresql`; TCP `5432`; backend `pg_isready` |
| MinIO | `minio/minio` container | CT 100 `minio` service from `proxmox/systemd/minio.service` | `/minio/health/live` |
| Valkey | `valkey/valkey:7-alpine` container | CT 103 `valkey`, `valkey-server`, or `redis-server` service | TCP `6379`; `VALKEY_CLI_NAME ping` |
| Backend app | custom `darshan-server-api:production` image | CT 101 `darshan-backend` systemd service | `/api/v1/health` |
| Backend Node runtime | `node:20-bookworm` image base | Node.js 20 installed in CT 101 | `check-backend-runtime-tools.sh` validates major version `20` |
| ffmpeg | installed in backend Dockerfile | `ffmpeg` package in CT 101 | `command -v ffmpeg` |
| LibreOffice | installed in backend Dockerfile | `libreoffice` package in CT 101 | `command -v libreoffice` or `command -v soffice` |
| pg_dump | `postgresql-client` in backend Dockerfile | `postgresql-client` in CT 101 | `command -v pg_dump` |
| tar | installed in backend Dockerfile | `tar` package in CT 101 | `command -v tar` |
| Playwright Chromium | optional Docker build arg `INSTALL_PLAYWRIGHT_CHROMIUM=true` | `npx playwright install --with-deps chromium` into `/ms-playwright` | launch Chromium headless from CT 101 |
| API + worker role | `DARSHAN_PROCESS_ROLE=all` in API container | systemd unit sets `DARSHAN_PROCESS_ROLE=all` | default-media refresh, outbox, desired-state jobs run from backend service |
| CMS static UI | `nginx:1.27-alpine` container | CT 102 `nginx` service | CMS HTTP and SPA refresh |
| CMS API/socket proxy | nginx template in Docker CMS | `proxmox/nginx/darshan-cms.conf.template` | `/api/v1`, `/socket.io`, `/grafana` proxy paths |
| Prometheus | `prom/prometheus` container | CT 104 `prometheus` service | `/-/healthy` |
| Grafana | `grafana/grafana` container | CT 104 `grafana-server` service | `/grafana/api/health` |

Run this after backend setup to confirm backend runtime parity:

```bash
bash deploy/production/proxmox/check-backend-runtime-tools.sh
```

Run this after all five LXCs are started to confirm service parity:

```bash
bash deploy/production/proxmox/health-check.sh
```

Do not run Docker inside the Proxmox LXCs for DARSHAN production. If an operator wants image-based behavior, use `deploy/production/docker` instead of `deploy/production/proxmox`.

## Port/IP Map

| From | To | Port | Purpose |
|---|---|---:|---|
| Backend CT 101 | Data CT 100 | `5432` | PostgreSQL |
| Backend CT 101 | Data CT 100 | `9000` | MinIO API |
| Backend CT 101 | Valkey CT 103 | `6379` | Realtime bus |
| CMS/operator/player | Backend CT 101 | `3000` | API and Socket.IO |
| Operator browser | CMS CT 102 | `8080` | CMS UI and nginx proxy |
| Observability CT 104 | Backend CT 101 | `3000` | Prometheus `/metrics` scrape |
| Observability CT 104 | Data CT 100 | `9000` | MinIO metrics scrape |
| Operator/maintenance | Data CT 100 | `9001` | Optional MinIO console |
| Operator/maintenance | Observability CT 104 | `9090` | Prometheus health/UI |
| CMS CT 102 | Observability CT 104 | `3000` | Grafana proxied at `/grafana/` |

Keep PostgreSQL, Valkey, MinIO admin, Prometheus, and Grafana restricted by firewall to only the LXCs that need them. Public/LAN access normally goes to CMS `8080` and backend `3000`.

## Data And Backup Map

| Data | Default location | Backup priority |
|---|---|---|
| PostgreSQL database | CT 100 PostgreSQL data directory | Critical |
| MinIO object storage | CT 100 MinIO volume path from `/etc/default/minio` | Critical |
| Valkey append-only data | CT 103 Valkey data directory | Important |
| Backend pairing CA/certs | CT 101 `darshan-server/certs` | Critical identity material |
| Backend env/secrets | host `darshan-server/.env`, CT `/etc/darshan/backend.env` | Critical |
| Backend JSON config | host `BACKEND_CONFIG_SOURCE`, CT `BACKEND_CONFIG_PATH` | Rebuildable, but keep the site-edited source |
| CMS runtime config | generated by `start-cms.sh`, CT `/usr/share/nginx/html/config/app-config.json` | Rebuildable |
| Prometheus TSDB | CT 104 Prometheus data directory | Operational history |
| Grafana DB/state | CT 104 Grafana data directory | Dashboards/settings/users |

`proxmox/reset-fresh.sh` is intentionally disabled. Do not delete CT disks or service data unless you are intentionally destroying the environment after backup.

## Capacity Plan For 16 GiB RAM / 16 Cores / 1 TB Host

This is the bare-minimum production allocation for one Proxmox host running only these five DARSHAN LXCs. It intentionally does not allocate the full host to containers; Proxmox, package caches, logs, snapshots, emergency restores, filesystem free space, and short spikes need room.

Memory and swap are shown in MiB because Proxmox `pct set -memory` and `pct set -swap` use MiB-style values in normal operation. Disk sizes are root filesystem caps; for real production, CT 100 should eventually move MinIO media/object storage to a separate disk or mount point so media growth does not compete with the database and OS.

### Calculation Rules

Use these formulas first, then adjust after monitoring real usage:

```text
Total RAM            = 16 GiB = 16384 MiB

Host RAM reserve     = round_up_to_1024(max(2048 MiB, 15% of total RAM))
                     = round_up_to_1024(max(2048, 16384 * 0.15))
                     = round_up_to_1024(2458)
                     = 3072 MiB

RAM available to LXCs = 16384 MiB - 3072 MiB
                      = 13312 MiB

Host CPU reserve      = max(2 cores, ceil(10% of total cores))
                      = max(2, ceil(16 * 0.10))
                      = 2 cores

CPU cap budget for LXCs = 16 cores - 2 cores
                        = 14 cores

Host/free storage reserve = max(120 GB, 18% of disk)
                          = max(120, 1000 * 0.18)
                          = 180 GB

Storage available to LXCs = 1000 GB - 180 GB
                          = 820 GB
```

Why these rules:

- PostgreSQL recommends `shared_buffers` around 25% of RAM as a reasonable starting value on a dedicated database server with at least 1 GB RAM, while leaving room for OS cache. With a 4096 MiB data CT, set PostgreSQL `shared_buffers` around `1GB`.
- Prometheus documents the storage formula `retention_time_seconds * ingested_samples_per_second * bytes_per_sample`, with an average of 1-2 bytes per sample, and recommends keeping retention size at most 80-85% of the allocated Prometheus disk.
- Grafana's official small deployment baseline is 2 CPU cores, 2-4 GB memory, and 10-20 GB disk for Grafana itself. Because this CT also runs Prometheus, allocate 3072 MiB RAM and 50 GB disk.
- Valkey keeps data in memory. Size it from peak memory, not average memory, and cap it with `maxmemory` so the host is not surprised by cache growth.
- Playwright documents `npx playwright install --with-deps chromium` for browser plus OS dependencies, and browser binaries alone take hundreds of MB before OS packages, Node modules, LibreOffice, ffmpeg temp files, and build output. Backend therefore gets 4096 MiB and 70 GB even in the bare-minimum plan.
- MinIO's current official AIStor production hardware recommendations target large enterprise object-storage deployments, far above this 16 GiB single-host plan. This DARSHAN plan treats MinIO as a small single-node object store and sizes CT 100 mainly from expected media growth and backup needs. It is not a high-availability MinIO design.

### Recommended Bare-Minimum Allocation

| CT | Role | CPU cores | Memory (MiB) | Swap (MiB) | Root disk | Reason |
|---:|---|---:|---:|---:|---:|---|
| 100 | Data: PostgreSQL + MinIO | 4 | 4096 | 1024 | 650 GB | Main durable database and media/object storage live here. PostgreSQL can use about 1 GB `shared_buffers`; MinIO and Linux page cache use the rest. |
| 101 | Backend API/worker | 4 | 4096 | 1024 | 70 GB | Node build/runtime plus ffmpeg, LibreOffice, Playwright Chromium, uploads, temp files, and logs. |
| 102 | CMS/nginx | 2 | 1024 | 512 | 30 GB | Vite build can use CPU/RAM; nginx runtime is light. |
| 103 | Valkey | 1 | 1024 | 512 | 20 GB | Realtime/cache/outbox state should stay small. Configure Valkey `maxmemory` around `700mb` with `maxmemory-policy noeviction`. |
| 104 | Observability: Prometheus + Grafana | 2 | 3072 | 1024 | 50 GB | Grafana small-tier baseline plus Prometheus TSDB/WAL and dashboards. Set Prometheus retention size to about `40GB`. |
| Host/unallocated | Proxmox reserve | 3 effective spare cores | 3072 | host-managed | 180 GB | Host OS, logs, package cache, snapshots, backups, emergency restore space, and short spikes. |

Totals:

```text
LXC memory = 4096 + 1024 + 4096 + 1024 + 3072 = 13312 MiB
Host reserve = 3072 MiB
Total memory = 16384 MiB

LXC CPU caps = 4 + 1 + 4 + 2 + 2 = 13 cores
Host/spare   = 3 cores effective headroom from a 16-core host

LXC disk = 650 + 20 + 70 + 30 + 50 = 820 GB
Host/free disk = 180 GB
Total disk = 1000 GB
```

If the Proxmox UI shows GiB instead of decimal GB, a 1 TB disk appears as about 931 GiB. Use the same percentages rather than the exact decimal numbers:

```text
Host/free reserve ~= 0.18 * 931 GiB = 168 GiB
LXC disk budget   ~= 931 - 168 = 763 GiB
```

Scale the table by multiplying each disk allocation by `763 / 820 = 0.93`. That gives roughly: data `605GiB`, Valkey `18GiB`, backend `65GiB`, CMS `28GiB`, observability `47GiB`.

Do not set all CT memory to "unlimited". Fixed memory caps make failures easier to diagnose and preserve the host reserve.

### Proxmox Commands

Use these as the resource caps after CT creation. Replace `local-lvm` and rootfs names with your storage pool/layout.

```bash
pct set 100 -cores 4 -memory 4096 -swap 1024
pct resize 100 rootfs 650G

pct set 101 -cores 4 -memory 4096 -swap 1024
pct resize 101 rootfs 70G

pct set 102 -cores 2 -memory 1024 -swap 512
pct resize 102 rootfs 30G

pct set 103 -cores 1 -memory 1024 -swap 512
pct resize 103 rootfs 20G

pct set 104 -cores 2 -memory 3072 -swap 1024
pct resize 104 rootfs 50G
```

These commands set or update the configured resources. They do not verify resources:

- `pct set <ctid> -cores ... -memory ... -swap ...` changes the LXC config for CPU, RAM, and swap limits.
- `pct resize <ctid> rootfs ...` changes the root filesystem size for that CT. It is normally used to grow the disk; do not run it casually on a CT that already has important data without a backup.
- To verify afterward, use `pct config <ctid>`, the Proxmox UI, and inside-CT checks such as `df -h`.

Recommended service settings after allocation:

```conf
# CT 100 PostgreSQL, postgresql.conf
shared_buffers = 1GB
effective_cache_size = 2GB
maintenance_work_mem = 256MB
work_mem = 8MB

# CT 103 Valkey, valkey.conf
maxmemory 700mb
maxmemory-policy noeviction

# CT 104 Prometheus systemd args or package config
--storage.tsdb.retention.time=15d
--storage.tsdb.retention.size=40GB
```

### When To Increase

| Symptom | Increase |
|---|---|
| Backend fails during `npm run build`, webpage capture, PDF capture, LibreOffice conversion, or ffmpeg jobs | CT 101 RAM to 5-6 GB, CPU to 5-6 cores |
| PostgreSQL has slow queries, high cache misses, or MinIO uploads contend with DB I/O | CT 100 RAM to 6 GB and disk/I/O first |
| Media storage reaches 75% of CT 100 disk | Add a dedicated disk/mount for MinIO or enlarge CT 100 |
| Valkey reports OOM or `used_memory_peak` near `maxmemory` | CT 103 RAM to 2 GB and `maxmemory` to about 1400 MB |
| Prometheus/Grafana dashboards are slow or Prometheus disk reaches 80% | CT 104 RAM to 4 GB and disk to 80-100 GB |
| Host memory pressure or swap use appears on Proxmox | Reduce CT memory or add physical RAM; do not starve the host |

If the Proxmox host uses ZFS, reserve more RAM for the host. On a 16 GB host, use a 4 GB host reserve and reduce CT 101 backend to 3 GB until monitoring proves you can give it back.

## Environment Files

Create the editable host-side files from the repository root on the Proxmox node:

```bash
cp deploy/production/.env.example deploy/production/.env
cp darshan-server/.env.example darshan-server/.env
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
cp darshan-cms/.env.example darshan-cms/.env
```

Then edit `deploy/production/.env` for the five CT IDs/IPs, service names, public/proxy URLs, and script controls. If you copied the backend config to `darshan-server/config/backend.json`, set:

```bash
BACKEND_CONFIG_SOURCE=darshan-server/config/backend.json
BACKEND_CONFIG_PATH=/etc/darshan/server/config.json
```

Do not use `deploy/production/.env.local` for the Proxmox path. That file belongs to the Docker-style local production path and commonly sets all role hosts to one LAN IP. Proxmox needs `deploy/production/.env` with CT IDs and the five LXC IPs.

Do not create LXC-specific app env templates. `darshan-server/.env.example` and `darshan-cms/.env.example` are the only app env examples. The feature flags and software behavior should match Docker; only host/IP values, service names, and secrets change for the target topology.

For production, keep `darshan-server/.env` short and set the config selector to the path that will exist inside CT 101:

```bash
DARSHAN_CONFIG_FILE=/etc/darshan/server/config.json
```

The backend config file stores non-secret runtime settings such as environment labels, CORS/socket origins, realtime behavior, media endpoint, observability URLs, and limits. Secrets and sensitive URLs such as `DATABASE_URL`, `VALKEY_URL`, `JWT_SECRET`, admin bootstrap credentials, MinIO credentials, certificate paths, and bearer tokens stay in `darshan-server/.env`.

Required production values:

- `deploy/production/.env`: CT IDs, static IPs, public URLs, service names, app paths, generated config paths, and start behavior. It must include `SIGNHEX_ENVIRONMENT_NAME`, `SIGNHEX_DEPLOYMENT_ID`, and `SIGNHEX_SERVER_ID`.
- `darshan-server/.env`: secrets, sensitive URLs, and `DARSHAN_CONFIG_FILE`. Use `DATABASE_URL=...@192.168.1.100:5432` and `VALKEY_URL=redis://192.168.1.103:6379` unless your site uses different CT IPs or Valkey auth/TLS.
- `BACKEND_CONFIG_SOURCE`: host-side JSON file with non-secret backend config. `start-backend.sh` copies it to `BACKEND_CONFIG_PATH` inside CT 101.
- `darshan-cms/.env`: optional public build fallback values only. If this file exists, `start-cms.sh` pushes it into `$CMS_APP_DIR/.env` before `npm run build`. Do not put secrets here.

These files are sourced by bash during deployment. Quote values that contain spaces, `#`, `$`, backticks, or shell metacharacters.

Generated outputs are written under `deploy/production/.generated/proxmox` by default, or under `DARSHAN_PROXMOX_GENERATED_DIR` if you override it:

- `cms-app-config.json`, pushed by `start-cms.sh` to `$CMS_WEB_ROOT/config/app-config.json`
- `darshan-cms.conf`, pushed by `start-cms.sh` to `$CMS_NGINX_CONFIG_PATH`
- `prometheus.yml`, pushed by `start-observability.sh` to `$PROMETHEUS_CONFIG_PATH`
- `grafana-darshan.conf`, pushed by `start-observability.sh` as a systemd drop-in for Grafana

Do not hand-edit those generated files for normal production changes. Edit `deploy/production/.env`, `darshan-server/.env`, `BACKEND_CONFIG_SOURCE`, or the templates under `deploy/production/proxmox` and `deploy/shared`.

## Scripts

Run from the repository root on the Proxmox host:

```bash
bash deploy/production/proxmox/start.sh
bash deploy/production/proxmox/health-check.sh
bash deploy/production/proxmox/stop.sh
```

Role-by-role startup:

```bash
bash deploy/production/proxmox/start-data.sh
bash deploy/production/proxmox/start-valkey.sh
bash deploy/production/proxmox/start-backend.sh
bash deploy/production/proxmox/start-cms.sh
bash deploy/production/proxmox/start-observability.sh
```

What the scripts do:

- `start.sh`: loads the production env, requires backend secrets, then runs data, Valkey, backend, CMS, and observability startup in dependency order.
- `start-data.sh`: starts CT 100, restarts `POSTGRES_SERVICE_NAME` and `MINIO_SERVICE_NAME`, checks PostgreSQL TCP and MinIO liveness.
- `start-valkey.sh`: starts CT 103, restarts `VALKEY_SERVICE_NAME`, checks TCP, then runs `$VALKEY_CLI_NAME ping` inside the Valkey CT.
- `start-backend.sh`: starts CT 101, waits for PostgreSQL, MinIO, and Valkey, pushes `darshan-server/.env` to `BACKEND_ENV_PATH`, pushes `BACKEND_CONFIG_SOURCE` to `BACKEND_CONFIG_PATH` when the source file exists, optionally runs `npm ci`, runs `npm run build`, optionally installs Playwright Chromium/deps to `/ms-playwright`, validates runtime tools, waits for `pg_isready`, runs `db:migrate` if the package adds that script, otherwise runs `db:push` only when `RUN_PRODUCTION_DB_PUSH=true`, optionally runs `npm run seed`, restarts `BACKEND_SERVICE_NAME`, and checks `/api/v1/health`.
- `check-backend-runtime-tools.sh`: starts CT 101 if needed and validates Node 20, npm, `ffmpeg`, LibreOffice or `soffice`, `pg_dump`, `tar`, and a headless Playwright Chromium launch.
- `start-cms.sh`: starts CT 102, optionally pushes `darshan-cms/.env` into the CMS app dir, optionally runs `npm ci`, runs `npm run build`, replaces `$CMS_WEB_ROOT` with the built `dist`, renders browser-visible runtime config, renders nginx config, tests nginx, reloads or restarts `CMS_SERVICE_NAME`, and checks HTTP.
- `start-observability.sh`: starts CT 104, renders Prometheus config with LXC static targets and optional metrics bearer token, pushes shared Prometheus rules and Grafana provisioning/dashboards from `deploy/shared`, writes a Grafana systemd drop-in for `/grafana/`, restarts Prometheus/Grafana, and checks both health endpoints.
- `health-check.sh`: verifies all five CTs are running, all configured systemd services are active, and the expected TCP/HTTP endpoints respond.
- `stop.sh`: shuts CTs down in reverse order without deleting data.
- `reset-fresh.sh`: exits with an error by design. It is a reminder to back up or intentionally destroy CT data through explicit Proxmox/service procedures.

## Bootstrap Outline

Run these scripts as root or as an operator with Proxmox `pct` privileges on the Proxmox host. The host needs the repository checkout because the scripts read local env/config/templates and push selected files into CTs. CT 101 and CT 102 also need the repository copied or cloned to `REMOTE_REPO_DIR` because the backend and CMS builds run inside those CTs.

Create the five CTs with static IPs first. Example network command shape:

```bash
pct set 100 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.100/24,gw=192.168.1.1
pct set 101 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.101/24,gw=192.168.1.1
pct set 102 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.102/24,gw=192.168.1.1
pct set 103 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.103/24,gw=192.168.1.1
pct set 104 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.104/24,gw=192.168.1.1
```

Inside CT 100:

```bash
apt update
apt install -y postgresql postgresql-client curl ca-certificates
# Install MinIO server binary/package, create minio-user, create the MinIO data path,
# install proxmox/systemd/minio.service to /etc/systemd/system/minio.service,
# and create /etc/default/minio with MINIO_ROOT_USER, MINIO_ROOT_PASSWORD,
# MINIO_VOLUMES, and MINIO_OPTS='--address :9000 --console-address :9001'.
systemctl daemon-reload
systemctl enable postgresql minio
```

Create the PostgreSQL database/user referenced by `DATABASE_URL` before `start-backend.sh`. The backend creates required MinIO buckets at runtime, so the configured MinIO credentials must be allowed to create and read/write those buckets.

Inside CT 103:

```bash
apt update
apt install -y valkey-server || apt install -y redis-server
# If the service is valkey-server or redis-server, set VALKEY_SERVICE_NAME and VALKEY_CLI_NAME in deploy/production/.env.
systemctl enable valkey || systemctl enable valkey-server || systemctl enable redis-server
```

Inside CT 101:

```bash
apt update
apt install -y ca-certificates curl ffmpeg libreoffice postgresql-client tar
# Install Node.js 20.x and npm.
# Clone/copy this repo to /opt/darshan/DARSHAN-SIGNAGE.
# Create user/group darshan.
# Install proxmox/systemd/darshan-backend.service to /etc/systemd/system/darshan-backend.service.
systemctl daemon-reload
systemctl enable darshan-backend
```

The supplied `darshan-backend.service` uses these defaults:

```text
WorkingDirectory=/opt/darshan/DARSHAN-SIGNAGE/darshan-server
EnvironmentFile=/etc/darshan/backend.env
PORT=3000
PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
User=darshan
Group=darshan
```

Keep those defaults or edit the installed unit when changing `BACKEND_APP_DIR`, `BACKEND_ENV_PATH`, `API_HOST_PORT`, or `BACKEND_SERVICE_NAME`. `start-backend.sh` handles `npm ci`, `npm run build`, Playwright Chromium install when `INSTALL_PLAYWRIGHT_CHROMIUM=true`, file ownership for the `darshan` user, schema/bootstrap, and service restart.

Inside CT 102:

```bash
apt update
apt install -y ca-certificates curl nginx
# Install Node.js 20.x and npm.
# Clone/copy this repo to /opt/darshan/DARSHAN-SIGNAGE.
systemctl enable nginx
```

`start-cms.sh` builds from `$CMS_APP_DIR`, deploys the built `dist` to `$CMS_WEB_ROOT`, and writes the generated CMS runtime config and nginx config. If you change `CMS_HTTP_PORT`, let the script render the nginx config from `deploy/production/proxmox/nginx/darshan-cms.conf.template`.

Inside CT 104:

```bash
apt update
apt install -y prometheus
# Install Grafana from the official Grafana package repository for your Debian/Ubuntu release.
systemctl enable prometheus grafana-server
```

`start-observability.sh` overwrites the configured Prometheus config path and Grafana provisioning paths with generated/shared files. Keep any site-specific observability customizations in `deploy/shared` or in separately documented files that are not managed by this script.

## Research Sources

These scripts follow the documented service model from the platform tools:

- Proxmox `pct` manual: `pct start`, `pct exec`, `pct push`, and `pct shutdown` are the host-side LXC control commands: https://pve.proxmox.com/pve-docs/pct.1.html
- Proxmox VE system requirements and host planning guidance: https://pve.proxmox.com/pve-docs/pve-admin-guide.html#system_requirements
- systemd service units use `ExecStart=` for the service command and `EnvironmentFile=` for env files: https://man7.org/linux/man-pages/man5/systemd.service.5.html and https://man7.org/linux/man-pages/man5/systemd.exec.5.html
- PostgreSQL documents server startup and service-manager integration: https://www.postgresql.org/docs/current/server-start.html
- MinIO documents `/minio/health/live` as a liveness health probe: https://min.io/docs/minio/linux/operations/monitoring/healthcheck-probe.html
- MinIO AIStor hardware requirements show enterprise object-storage targets far above this small single-node plan: https://docs.min.io/aistor/reference/aistor-server/requirements/
- Prometheus static scrape targets and per-job config are configured under `scrape_configs`: https://prometheus.io/docs/prometheus/latest/configuration/configuration/
- Prometheus local storage sizing and retention-size guidance: https://prometheus.io/docs/prometheus/latest/storage/
- Grafana `root_url`/sub-path serving is controlled by server configuration/env equivalents: https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/
- Grafana minimum and small-tier hardware guidance: https://grafana.com/docs/grafana/latest/setup-grafana/installation/
- PostgreSQL memory/resource guidance: https://www.postgresql.org/docs/current/runtime-config-resource.html
- Valkey memory allocation and `maxmemory` guidance: https://valkey.io/topics/memory-optimization/
- Playwright browser/dependency install guidance: https://playwright.dev/docs/browsers

## Production Checklist

- Back up CT 100 database/object storage and CT 101 certs before schema changes.
- Generate strong values for `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`, `ADMIN_PASSWORD`, and `OBSERVABILITY_METRICS_BEARER_TOKEN`.
- Confirm `deploy/production/.env`, `darshan-server/.env`, and `BACKEND_CONFIG_SOURCE` contain site-edited values rather than unmodified examples.
- Confirm the installed `darshan-backend.service` matches `BACKEND_APP_DIR`, `BACKEND_ENV_PATH`, `API_HOST_PORT`, and `BACKEND_SERVICE_NAME` if you changed those defaults.
- Confirm PostgreSQL database/user and MinIO credentials exist before running `start-backend.sh`; the backend can create buckets only when the MinIO policy allows it.
- Keep `RUN_PRODUCTION_SEED=false` unless intentionally seeding an empty environment.
- Keep `RUN_PRODUCTION_DB_PUSH=false` after initial bootstrap. The current backend has `db:push` but no `db:migrate` script; repair migration metadata before relying on migrations.
- Confirm firewall rules allow only required traffic from the port map.
- Run `bash deploy/production/proxmox/check-backend-runtime-tools.sh`.
- Run `bash deploy/production/proxmox/health-check.sh`.
