# DARSHAN Docker Production

This is the canonical production deployment path. It runs DARSHAN as Docker Compose roles on five Proxmox VMs or compatible Linux VMs.

## Roles

| Role folder | Compose project | Containers | Run on |
|---|---|---|---|
| `data` | `darshan-data` | `postgres`, `minio` | Data VM |
| `valkey` | `darshan-valkey` | `valkey` | Valkey VM |
| `backend` | `darshan-backend` | `api` | Backend VM |
| `cms` | `darshan-cms-prod` | `cms` | CMS VM |
| `observability` | `darshan-observability` | `prometheus`, `grafana` | Observability VM |

Use host/VM IPs in `.env`; do not assign LAN IPs to individual containers.

## Config Files

Create local files:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
cp darshan-server/.env.example darshan-server/.env
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
cp darshan-cms/.env.example darshan-cms/.env
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
```

Keep env files short:

- `deploy/production/docker/.env`: VM IPs, ports, image tags, Docker data bootstrap values
- `darshan-server/.env`: secrets, sensitive URLs, config selector
- `darshan-cms/.env`: browser build/runtime selector fallbacks

Keep non-secret runtime behavior in JSON:

- `darshan-server/config/backend.json`
- `darshan-cms/public/config/app-config.json`

For Docker production, set this in `darshan-server/.env`:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

The backend compose mounts `darshan-server/config` at `/app/config:ro`.

## Role Commands

Run one command per VM role.

```bash
# Data VM
bash deploy/production/docker/start-data.sh

# Valkey VM
bash deploy/production/docker/start-valkey.sh

# Backend VM
bash deploy/production/docker/start-backend.sh

# CMS VM
bash deploy/production/docker/start-cms.sh

# Observability VM
bash deploy/production/docker/start-observability.sh
```

Role health checks:

```bash
bash deploy/production/docker/health-check.sh data
bash deploy/production/docker/health-check.sh valkey
bash deploy/production/docker/health-check.sh backend
bash deploy/production/docker/health-check.sh cms
bash deploy/production/docker/health-check.sh observability
```

Network health check from any host that can reach all VM IPs:

```bash
bash deploy/production/docker/health-check.sh network
```

`start-all.sh` and `stop-all.sh` are for single-host lab validation only.

## Backend Schema And Seed

`start-backend.sh` does not modify schema or seed data by default.

Set these only when intentionally bootstrapping or updating the database:

```env
RUN_PRODUCTION_DB_PUSH=true
RUN_PRODUCTION_SEED=true
```

## CMS Image

The CMS role builds a production nginx image from the CMS source checkout. Runtime URLs are read from the mounted CMS runtime config file:

```env
CMS_RUNTIME_CONFIG_SOURCE=../../../../darshan-cms/public/config/app-config.json
```

Changing VM IPs should normally require editing the runtime config and restarting the CMS container, not changing source code.

## Stop And Reset

Stop one role on its VM:

```bash
docker compose --env-file deploy/production/docker/.env --env-file darshan-server/.env -f deploy/production/docker/<role>/docker-compose.yml down
```

Or use:

```bash
bash deploy/production/docker/stop.sh
```

`reset-fresh.sh` deletes Docker volumes and is intentionally separate.
