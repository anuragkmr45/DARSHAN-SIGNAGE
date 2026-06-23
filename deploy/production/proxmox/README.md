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
- systemd service units use `ExecStart=` for the service command and `EnvironmentFile=` for env files: https://man7.org/linux/man-pages/man5/systemd.service.5.html and https://man7.org/linux/man-pages/man5/systemd.exec.5.html
- PostgreSQL documents server startup and service-manager integration: https://www.postgresql.org/docs/current/server-start.html
- MinIO documents `/minio/health/live` as a liveness health probe: https://min.io/docs/minio/linux/operations/monitoring/healthcheck-probe.html
- Prometheus static scrape targets and per-job config are configured under `scrape_configs`: https://prometheus.io/docs/prometheus/latest/configuration/configuration/
- Grafana `root_url`/sub-path serving is controlled by server configuration/env equivalents: https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/

## Production Checklist

- Back up CT 201 database/object storage and CT 203 certs before schema changes.
- Generate strong values for `JWT_SECRET`, `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`, `ADMIN_PASSWORD`, and `OBSERVABILITY_METRICS_BEARER_TOKEN`.
- Keep `RUN_PRODUCTION_SEED=false` unless intentionally seeding an empty environment.
- Keep `RUN_PRODUCTION_DB_PUSH=false` after initial bootstrap. The current backend has `db:push` but no `db:migrate` script; repair migration metadata before relying on migrations.
- Confirm firewall rules allow only required traffic from the port map.
- Run `bash deploy/production/proxmox/check-backend-runtime-tools.sh`.
- Run `bash deploy/production/proxmox/health-check.sh`.
