# Production Docker-On-VM Onboarding

## Production Model

Production uses Docker role deployments on normal Ubuntu Server VMs. Proxmox is only the hypervisor.

| VM role | Main files | Purpose |
|---|---|---|
| Data | `deploy/production/docker/data/docker-compose.yml`, `start-data.sh` | Postgres and MinIO. |
| Valkey | `deploy/production/docker/valkey/docker-compose.yml`, `start-valkey.sh` | Realtime notification bus. |
| Backend | `deploy/production/docker/backend/docker-compose.yml`, `start-backend.sh` | Backend API/all-role runtime with worker behavior and runtime tools. |
| CMS | `deploy/production/docker/cms/*`, `start-cms.sh` | Built CMS served by nginx. |
| Observability | `deploy/production/docker/observability/*`, `start-observability.sh` | Prometheus and Grafana. |

Use `deploy/production/README.md` for the detailed production procedure.

## File Placement

| Target | Required files |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player machine | installed player package, `/etc/darshan/player/config.json` |

Docker production backend config must be container-visible as `/app/config/backend.json`. Do not use `/etc/darshan/server/config.json` as the Docker backend config path.

## Startup Order

1. Data VM.
2. Valkey VM.
3. Backend VM.
4. CMS VM.
5. Observability VM.
6. Player devices.

The backend depends on data and Valkey. CMS depends on backend reachability for useful operator flows. Observability can start after or before backend, but scrape health is only meaningful once targets are running.

## Runtime Tools

The backend Docker image must include:

- `ffmpeg`
- LibreOffice
- `pg_dump`
- `tar`
- Playwright Chromium when webpage capture is enabled

The code path validating these is `darshan-server/src/utils/runtime-dependencies.ts`; the deployment helper is `deploy/production/docker/check-backend-runtime-tools.sh`.

## Evidence Boundary

Docker containers being up is not production readiness. Runtime evidence still needs:

- backend health and DB/object storage/Valkey reachability,
- CMS browser login and route QA,
- packaged player install/autostart/pairing tests,
- default media and schedule playback,
- Socket.IO wake-up and polling fallback tests,
- screenshot and proof-of-play evidence,
- Prometheus/Grafana scrape and alert review,
- no-secret log/support bundle review.
