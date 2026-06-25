# DARSHAN Production Deployment

Production now uses Docker role deployments on normal Proxmox VMs. Proxmox is only the hypervisor; DARSHAN services run in Docker containers inside the VMs.

Use:

```bash
deploy/production/docker
```

Do not use legacy LXC/systemd scripts for DARSHAN production.

## Production Topology

| VM | Role | Docker project | Main containers |
|---|---|---|---|
| VM 1 | Data | `darshan-data` | `postgres`, `minio` |
| VM 2 | Valkey | `darshan-valkey` | `valkey` |
| VM 3 | Backend | `darshan-backend` | `api` with API + worker role |
| VM 4 | CMS | `darshan-cms-prod` | `cms` nginx static app |
| VM 5 | Observability | `darshan-observability` | `prometheus`, `grafana` |

Containers do not receive LAN/Wi-Fi IPs directly. Configure the VM IPs in `deploy/production/docker/.env`; Docker publishes container ports through each VM.

## First-Time Setup

On each VM, install Docker Engine and Docker Compose, then place the repository checkout or release bundle on the VM.

Create the shared production inputs:

```bash
cp deploy/production/docker/.env.example deploy/production/docker/.env
cp darshan-server/.env.example darshan-server/.env
cp darshan-server/config/backend.production.example.json darshan-server/config/backend.json
cp darshan-cms/.env.example darshan-cms/.env
cp darshan-cms/public/config/app-config.example.json darshan-cms/public/config/app-config.json
```

Edit `deploy/production/docker/.env` on every VM and set:

- `DATA_HOST`
- `VALKEY_HOST`
- `BACKEND_HOST`
- `CMS_HOST`
- `OBSERVABILITY_HOST`
- role ports
- image names/tags
- Docker data bootstrap values

Edit `darshan-server/.env` for secrets, sensitive URLs, and config selectors. For Docker production, set:

```env
DARSHAN_CONFIG_FILE=/app/config/backend.json
```

Edit `darshan-server/config/backend.json` and `darshan-cms/public/config/app-config.json` for non-secret deployment labels, URLs, realtime flags, media endpoint, and observability URLs.

## Start One Role Per VM

Run only the script for the VM's assigned role.

Data VM:

```bash
bash deploy/production/docker/start-data.sh
bash deploy/production/docker/health-check.sh data
```

Valkey VM:

```bash
bash deploy/production/docker/start-valkey.sh
bash deploy/production/docker/health-check.sh valkey
```

Backend VM:

```bash
bash deploy/production/docker/start-backend.sh
bash deploy/production/docker/check-backend-runtime-tools.sh
bash deploy/production/docker/health-check.sh backend
```

CMS VM:

```bash
bash deploy/production/docker/start-cms.sh
bash deploy/production/docker/health-check.sh cms
```

Observability VM:

```bash
bash deploy/production/docker/start-observability.sh
bash deploy/production/docker/health-check.sh observability
```

From any VM or operator workstation that can reach all service IPs:

```bash
bash deploy/production/docker/health-check.sh network
```

`start-all.sh` remains only for single-host lab checks where all roles intentionally run on one machine.

## Backend Runtime Tools

The backend Docker image includes or validates:

- Node 20
- ffmpeg
- LibreOffice
- `pg_dump`
- `tar`
- Playwright Chromium when `INSTALL_PLAYWRIGHT_CHROMIUM=true`

The backend container runs `DARSHAN_PROCESS_ROLE=all`, so API routes, Socket.IO notifications, default-media refresh jobs, desired-state updates, telemetry persistence, backups, and worker jobs run from the same backend container.

## Volumes And Backups

Back up these Docker volumes before destructive maintenance:

| Role | Volume | Contents |
|---|---|---|
| Data | `postgres_data` | PostgreSQL database |
| Data | `minio_data` | uploaded media and object storage |
| Valkey | `valkey_data` | Valkey append-only data |
| Observability | `prometheus_data` | Prometheus time series |
| Observability | `grafana_data` | Grafana state |

`reset-fresh.sh` is destructive and removes Docker volumes. Use it only when intentionally wiping an environment.

## Production Evidence

This deployment migration does not mark DARSHAN production-ready by itself. Production readiness still requires real browser QA, packaged player evidence, on-prem runtime evidence, and Node/runtime validation.
