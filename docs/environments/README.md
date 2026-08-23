# DARSHAN Environment Architecture

Last code-truth refresh: 2026-08-23.

This folder documents DARSHAN environments from code and deployment files. Code, compose files, and runtime config loaders are the source of truth. These docs do not prove that any runtime is healthy.

## Source Evidence

| Slice | Code / file source |
|---|---|
| Backend runtime | `darshan-server/src/index.ts`, `src/runtime/bootstrap.ts`, `src/runtime/process-role.ts`, `src/config/index.ts`, `src/config/file-config.ts` |
| Backend deployment | `darshan-server/Dockerfile`, `darshan-server/docker-compose.yml`, `deploy/production/docker/backend/docker-compose.yml`, `deploy/production/docker/start-backend.sh` |
| CMS runtime | `darshan-cms/src/config/runtimeConfig.ts`, `darshan-cms/.env.example`, `darshan-cms/public/config/app-config.example.json` |
| CMS deployment | `deploy/production/docker/cms/Dockerfile`, `deploy/production/docker/cms/docker-compose.yml`, `deploy/production/docker/start-cms.sh` |
| Player runtime | `darshan-player/src/common/config.ts`, `src/common/file-config.ts`, `src/common/platform-paths.ts`, `src/main/index.ts`, `src/main/services/*`, `src/preload/index.ts`, `src/renderer/*` |
| Production Docker roles | `deploy/production/docker/lib.sh`, role `docker-compose.yml` files, role `start-*.sh` scripts |
| Version manifests | `manifests/qa/versions.example.yaml`, `manifests/production/versions.example.yaml` |

## Environment Map

| Environment | Purpose | Runtime model | Documentation |
|---|---|---|---|
| Development | Local developer feedback and component/API work | Source-run backend/CMS/player plus optional local Docker support services | `docs/environments/development.md` |
| QA | Release-candidate validation with production-like topology | Docker-on-VM role split matching production | `docs/environments/qa/README.md` |
| Production | On-prem operation | Docker role deployments on normal VMs; Proxmox is hypervisor only | `docs/environments/production/README.md` |
| Player device | Screen/player runtime | Packaged Electron app on Ubuntu/RPi/AXON/other supported target, not a server Docker role | `docs/runbooks/player-deployment.md`, `docs/contracts/player-runtime-contracts.md` |

## Current Production Role Contract

The source-free variant generates these roles from one private build-machine
env and uses verified HTTPS/WSS between CMS, backend, MinIO, players, and
Prometheus. The direct config inputs below remain for checkout-based workflows.

Production uses host or VM IPs, not per-container LAN IPs.

| Role | Docker folder | Compose project | Containers | Owns |
|---|---|---|---|---|
| Data VM | `deploy/production/docker/data` | `darshan-data` | `postgres`, `minio` | Postgres and MinIO Docker volumes |
| Valkey VM | `deploy/production/docker/valkey` | `darshan-valkey` | `valkey` | Valkey append-only Docker volume |
| Backend VM | `deploy/production/docker/backend` | `darshan-backend` | `api` | API, worker behavior, runtime tools, pairing CA files |
| CMS VM | `deploy/production/docker/cms` | `darshan-cms-prod` | `cms` | nginx static CMS and browser runtime config mount |
| Observability VM | `deploy/production/docker/observability` | `darshan-observability` | `prometheus`, `grafana` | Prometheus/Grafana Docker volumes |

## File And Config Boundary

| Runtime target | Required files | What belongs there | Code source |
|---|---|---|---|
| Docker site roles | `deploy/production/docker/.env` | VM IPs, ports, image names/tags, Docker data bootstrap credentials, role toggles | `deploy/production/docker/lib.sh` |
| Backend app | `darshan-server/.env` on Backend VM only | backend secrets, sensitive URLs, config selectors, emergency env overrides | `darshan-server/src/config/index.ts` |
| Backend non-secret config | `darshan-server/config/backend.json`, mounted as `/app/config/backend.json` in Docker | environment labels, public CMS origin, realtime tuning, Valkey mode, command/outbox timings, media endpoint, observability URLs | `darshan-server/src/config/file-config.ts` |
| CMS runtime config | `darshan-cms/public/config/app-config.json`, served as `/config/app-config.json` | browser-visible API/socket URL and CMS labels | `darshan-cms/src/config/runtimeConfig.ts` |
| Player site config | `/etc/darshan/player/config.json` selected by `DARSHAN_PLAYER_CONFIG_FILE` | non-secret backend/socket URLs, environment labels, polling/realtime/cache/security policy | `darshan-player/src/common/file-config.ts` |
| Player runtime state | Electron user-data runtime root and cache/certs paths | device identity, certs, pairing state, media cache, proof-of-play/request queues, logs | `darshan-player/src/common/platform-paths.ts`, player services |

## Environment Rules

- Keep secrets and sensitive URLs in env or secret stores.
- Keep non-secret runtime/deployment behavior in JSON config files where loaders support it.
- Do not put browser secrets in CMS env or CMS runtime config. CMS config is visible to users.
- In Docker production, backend `DARSHAN_CONFIG_FILE` must be container-visible, normally `/app/config/backend.json`.
- Direct host paths such as `/etc/darshan/server/config.json` are not the Docker production backend path.
- Player `/etc/darshan/player/config.json` is a non-secret site config. It is not the same as legacy player runtime config `/etc/darshan/config.json`.
- Runtime health, browser QA, packaged player QA, realtime latency, and target-device playback require live evidence outside these docs.

## Documentation Files In This Folder

| File | Purpose |
|---|---|
| `development.md` | Development environment contract from scripts and config loaders. |
| `qa/README.md` | QA environment contract and release gates. |
| `production/README.md` | Production Docker-on-VM environment contract. |
| `ENVIRONMENT_TRACEABILITY.md` | Feature-by-feature environment traceability table with code references. |
| `ENVIRONMENT_REFRESH_HANDOFF.md` | Audit slices, changes, verification, and remaining gaps for this refresh. |
| `qa/realtime-sync.env.example` | Realtime canary/compatibility checklist, not the primary QA env source. |
| `production/realtime-sync.env.example` | Realtime canary/compatibility checklist, not the primary production env source. |

## Non-Goals

- These docs do not replace `deploy/production/README.md` or role scripts.
- These docs do not claim production readiness.
- These docs do not validate runtime health.
- These docs do not authorize deleting app/runtime state or resetting player identity.
