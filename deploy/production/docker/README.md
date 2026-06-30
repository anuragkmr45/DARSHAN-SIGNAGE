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

Create only the files needed for the VM role you are setting up:

```bash
# Every server-side VM:
cp deploy/production/docker/.env.example deploy/production/docker/.env

# Backend VM only:
cp darshan-server/.env.example darshan-server/.env
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json

# CMS VM only:
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
```

| VM | Required local files |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player devices | `/etc/darshan/player/config.json` |

Keep env files short:

- `deploy/production/docker/.env`: VM IPs, ports, image tags, Docker data bootstrap values
- `darshan-server/.env`: backend secrets, sensitive URLs, config selector; Backend VM only
- `darshan-cms/public/config/app-config.json`: browser-visible CMS runtime config; CMS VM only

The production Docker env must include the bootstrap credentials used by the data containers:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-postgres-password>
POSTGRES_DB=darshan
MINIO_ACCESS_KEY=<strong-minio-access-key>
MINIO_SECRET_KEY=<strong-minio-secret-key>
```

`MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` are also passed to the backend container so the API can read/write object storage. Use the same values on the Data VM and Backend VM.

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

## Backend Pairing CA

The backend role needs `darshan-server/certs/ca.crt` and `darshan-server/certs/ca.key` for player pairing certificate issuance.

`start-backend.sh` runs:

```bash
bash deploy/production/docker/ensure-backend-certs.sh
```

The helper never overwrites existing certs. It generates a fresh CA only when both files are missing. If only one file is present, it fails so an operator can restore the missing file or intentionally remove both for a fresh environment.

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
docker compose --env-file deploy/production/docker/.env -f deploy/production/docker/<role>/docker-compose.yml down
```

For the backend role, include backend secrets if you run Docker Compose manually:

```bash
docker compose --env-file darshan-server/.env --env-file deploy/production/docker/.env -f deploy/production/docker/backend/docker-compose.yml down
```

Or use:

```bash
bash deploy/production/docker/stop.sh
```

`reset-fresh.sh` deletes Docker volumes and is intentionally separate.
