# DARSHAN Proxmox LXC Production

This production path runs five Proxmox LXC system containers and does not run Docker inside any LXC.

## Recommended Layout

| CT | Name | IP | Services |
|---:|---|---|---|
| 201 | `darshan-data` | `192.168.1.201` | PostgreSQL, MinIO |
| 202 | `darshan-valkey` | `192.168.1.202` | Valkey |
| 203 | `darshan-backend` | `192.168.1.203` | Node.js API/worker, ffmpeg, LibreOffice, Playwright/Chromium |
| 204 | `darshan-cms-prod` | `192.168.1.204` | nginx static CMS |
| 205 | `darshan-observability` | `192.168.1.205` | Prometheus, Grafana |

## Service Map

| Old Docker project | Docker services | LXC/systemd replacement |
|---|---|---|
| `darshan-data` | `postgres`, `minio` | CT 201 `postgresql`, `minio` |
| `darshan-valkey` | `valkey` | CT 202 `valkey` |
| `darshan-backend` | `api` | CT 203 `darshan-backend` |
| `darshan-cms-prod` | `cms` | CT 204 `nginx` |
| `darshan-observability` | `prometheus`, `grafana` | CT 205 `prometheus`, `grafana-server` |

The service names are configurable in `deploy/production/.env` if your distro packages use names such as `valkey-server`. If your package installs `redis-cli` instead of `valkey-cli`, set `VALKEY_CLI_NAME=redis-cli`.

## Port/IP Map

| From | To | Port | Purpose |
|---|---|---:|---|
| Backend CT 203 | Data CT 201 | `5432` | PostgreSQL |
| Backend CT 203 | Data CT 201 | `9000` | MinIO API |
| Backend CT 203 | Valkey CT 202 | `6379` | Realtime bus |
| CMS/operator/player | Backend CT 203 | `3000` | API and Socket.IO |
| Operator browser | CMS CT 204 | `8080` | CMS UI and nginx proxy |
| Observability CT 205 | Backend CT 203 | `3000` | Prometheus `/metrics` scrape |
| CMS CT 204 | Observability CT 205 | `3000` | Grafana proxied at `/grafana/` |

Keep PostgreSQL, Valkey, MinIO admin, Prometheus, and Grafana restricted by firewall to only the LXCs that need them. Public/LAN access normally goes to CMS `8080` and backend `3000`.

## Data And Backup Map

| Data | Default location | Backup priority |
|---|---|---|
| PostgreSQL database | CT 201 PostgreSQL data directory | Critical |
| MinIO object storage | CT 201 MinIO volume path from `/etc/default/minio` | Critical |
| Valkey append-only data | CT 202 Valkey data directory | Important |
| Backend pairing CA/certs | CT 203 `darshan-server/certs` | Critical identity material |
| Backend env/secrets | host `darshan-server/.env`, CT `/etc/darshan/backend.env` | Critical |
| CMS runtime config | CT 204 `/usr/share/nginx/html/config/app-config.json` | Rebuildable |
| Prometheus TSDB | CT 205 Prometheus data directory | Operational history |
| Grafana DB/state | CT 205 Grafana data directory | Dashboards/settings/users |

`proxmox/reset-fresh.sh` is intentionally disabled. Do not delete CT disks or service data unless you are intentionally destroying the environment after backup.

## Capacity Plan For 16 GiB RAM / 16 Cores / 1 TB Host

This is the bare-minimum production allocation for one Proxmox host running only these five DARSHAN LXCs. It intentionally does not allocate the full host to containers; Proxmox, package caches, logs, snapshots, emergency restores, filesystem free space, and short spikes need room.

Memory and swap are shown in MiB because Proxmox `pct set -memory` and `pct set -swap` use MiB-style values in normal operation. Disk sizes are root filesystem caps; for real production, CT 201 should eventually move MinIO media/object storage to a separate disk or mount point so media growth does not compete with the database and OS.

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
- MinIO's current official AIStor production hardware recommendations target large enterprise object-storage deployments, far above this 16 GiB single-host plan. This DARSHAN plan treats MinIO as a small single-node object store and sizes CT 201 mainly from expected media growth and backup needs. It is not a high-availability MinIO design.

### Recommended Bare-Minimum Allocation

| CT | Role | CPU cores | Memory (MiB) | Swap (MiB) | Root disk | Reason |
|---:|---|---:|---:|---:|---:|---|
| 201 | Data: PostgreSQL + MinIO | 4 | 4096 | 1024 | 650 GB | Main durable database and media/object storage live here. PostgreSQL can use about 1 GB `shared_buffers`; MinIO and Linux page cache use the rest. |
| 202 | Valkey | 1 | 1024 | 512 | 20 GB | Realtime/cache/outbox state should stay small. Configure Valkey `maxmemory` around `700mb` with `maxmemory-policy noeviction`. |
| 203 | Backend API/worker | 4 | 4096 | 1024 | 70 GB | Node build/runtime plus ffmpeg, LibreOffice, Playwright Chromium, uploads, temp files, and logs. |
| 204 | CMS/nginx | 2 | 1024 | 512 | 30 GB | Vite build can use CPU/RAM; nginx runtime is light. |
| 205 | Observability: Prometheus + Grafana | 2 | 3072 | 1024 | 50 GB | Grafana small-tier baseline plus Prometheus TSDB/WAL and dashboards. Set Prometheus retention size to about `40GB`. |
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
pct set 201 -cores 4 -memory 4096 -swap 1024
pct resize 201 rootfs 650G

pct set 202 -cores 1 -memory 1024 -swap 512
pct resize 202 rootfs 20G

pct set 203 -cores 4 -memory 4096 -swap 1024
pct resize 203 rootfs 70G

pct set 204 -cores 2 -memory 1024 -swap 512
pct resize 204 rootfs 30G

pct set 205 -cores 2 -memory 3072 -swap 1024
pct resize 205 rootfs 50G
```

Recommended service settings after allocation:

```conf
# CT 201 PostgreSQL, postgresql.conf
shared_buffers = 1GB
effective_cache_size = 2GB
maintenance_work_mem = 256MB
work_mem = 8MB

# CT 202 Valkey, valkey.conf
maxmemory 700mb
maxmemory-policy noeviction

# CT 205 Prometheus systemd args or package config
--storage.tsdb.retention.time=15d
--storage.tsdb.retention.size=40GB
```

### When To Increase

| Symptom | Increase |
|---|---|
| Backend fails during `npm run build`, webpage capture, PDF capture, LibreOffice conversion, or ffmpeg jobs | CT 203 RAM to 5-6 GB, CPU to 5-6 cores |
| PostgreSQL has slow queries, high cache misses, or MinIO uploads contend with DB I/O | CT 201 RAM to 6 GB and disk/I/O first |
| Media storage reaches 75% of CT 201 disk | Add a dedicated disk/mount for MinIO or enlarge CT 201 |
| Valkey reports OOM or `used_memory_peak` near `maxmemory` | CT 202 RAM to 2 GB and `maxmemory` to about 1400 MB |
| Prometheus/Grafana dashboards are slow or Prometheus disk reaches 80% | CT 205 RAM to 4 GB and disk to 80-100 GB |
| Host memory pressure or swap use appears on Proxmox | Reduce CT memory or add physical RAM; do not starve the host |

If the Proxmox host uses ZFS, reserve more RAM for the host. On a 16 GB host, use a 4 GB host reserve and reduce CT 203 backend to 3 GB until monitoring proves you can give it back.

## Environment Files

Create these files on the Proxmox host:

```bash
cp deploy/production/.env.example deploy/production/.env
cp darshan-server/.env.production.lxc.example darshan-server/.env
cp darshan-cms/.env.production.lxc.example darshan-cms/.env
```

Required production values:

- `deploy/production/.env`: CT IDs, static IPs, public URLs, service names, app paths, start behavior.
- `darshan-server/.env`: secrets and backend runtime URLs. Use `DATABASE_URL=...@192.168.1.201:5432`, `VALKEY_URL=redis://192.168.1.202:6379`, and `MINIO_ENDPOINT=192.168.1.201`.
- `darshan-cms/.env`: public build defaults only. Do not put secrets here.

These files are sourced by bash during deployment. Quote values that contain spaces, `#`, `$`, backticks, or shell metacharacters.

The CMS script also writes runtime config to `/config/app-config.json`, so normal production can change public CMS API/socket URLs without hiding secrets in the JS bundle.

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

- `start.sh`: starts all five CTs in dependency order.
- `start-data.sh`: starts CT 201, restarts `postgresql` and `minio`, checks PostgreSQL TCP and MinIO health.
- `start-valkey.sh`: starts CT 202, restarts Valkey, checks TCP and `valkey-cli ping`.
- `start-backend.sh`: starts CT 203, checks data/Valkey/MinIO, pushes backend env, runs `npm ci`, builds, checks runtime tools, waits for Postgres via `pg_isready`, runs `db:migrate` if the app later adds it, otherwise runs `db:push` only when `RUN_PRODUCTION_DB_PUSH=true`, optionally seeds when `RUN_PRODUCTION_SEED=true`, restarts `darshan-backend`, then checks `/api/v1/health`.
- `start-cms.sh`: starts CT 204, builds CMS, deploys `dist`, writes runtime config and nginx config, reloads nginx, checks HTTP.
- `start-observability.sh`: starts CT 205, writes Prometheus config with LXC IP targets, pushes Prometheus rules and Grafana provisioning/dashboards, configures Grafana subpath env, restarts Prometheus/Grafana, checks health.
- `stop.sh`: shuts CTs down in reverse order without deleting data.

## Bootstrap Outline

Create the five CTs with static IPs first. Example network command shape:

```bash
pct set 201 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.201/24,gw=192.168.1.1
pct set 202 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.202/24,gw=192.168.1.1
pct set 203 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.203/24,gw=192.168.1.1
pct set 204 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.204/24,gw=192.168.1.1
pct set 205 -net0 name=eth0,bridge=vmbr0,ip=192.168.1.205/24,gw=192.168.1.1
```

Inside CT 201:

```bash
apt update
apt install -y postgresql postgresql-client curl ca-certificates
# Install MinIO server binary/package, create minio-user, create the MinIO data path,
# install proxmox/systemd/minio.service to /etc/systemd/system/minio.service,
# and create /etc/default/minio with MINIO_ROOT_USER, MINIO_ROOT_PASSWORD,
# MINIO_VOLUMES, and MINIO_OPTS='--address :9000 --console-address :9001'.
systemctl enable postgresql minio
```

Inside CT 202:

```bash
apt update
apt install -y valkey-server || apt install -y redis-server
# If the service is valkey-server or redis-server, set VALKEY_SERVICE_NAME in deploy/production/.env.
systemctl enable valkey || systemctl enable valkey-server || systemctl enable redis-server
```

Inside CT 203:

```bash
apt update
apt install -y ca-certificates curl ffmpeg libreoffice postgresql-client tar
# Install Node.js 20.x, clone/copy this repo to /opt/darshan/DARSHAN-SIGNAGE,
# create user darshan, install proxmox/systemd/darshan-backend.service,
# then run: cd /opt/darshan/DARSHAN-SIGNAGE/darshan-server && npm ci
npx playwright install --with-deps chromium
systemctl enable darshan-backend
```

Inside CT 204:

```bash
apt update
apt install -y ca-certificates curl nginx
# Install Node.js 20.x and clone/copy this repo to /opt/darshan/DARSHAN-SIGNAGE.
systemctl enable nginx
```

Inside CT 205:

```bash
apt update
apt install -y prometheus
# Install Grafana from the official Grafana package repository for your Debian/Ubuntu release.
systemctl enable prometheus grafana-server
```

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

- Back up CT 201 database/object storage and CT 203 certs before schema changes.
- Generate strong values for `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`, `ADMIN_PASSWORD`, and `OBSERVABILITY_METRICS_BEARER_TOKEN`.
- Keep `RUN_PRODUCTION_SEED=false` unless intentionally seeding an empty environment.
- Keep `RUN_PRODUCTION_DB_PUSH=false` after initial bootstrap. The current backend has `db:push` but no `db:migrate` script; repair migration metadata before relying on migrations.
- Confirm firewall rules allow only required traffic from the port map.
- Run `bash deploy/production/proxmox/check-backend-runtime-tools.sh`.
- Run `bash deploy/production/proxmox/health-check.sh`.
