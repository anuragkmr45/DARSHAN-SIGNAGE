# Deployment And Config Contracts

Last code-truth audit: 2026-06-28.

This document describes deployment/config contracts visible in the repo. It does not prove a production site is healthy.

## Production Deployment Contract

| Role | Current production path | Runtime contents | Contract notes |
|---|---|---|---|
| Data VM | `deploy/production/docker/data` | Postgres + MinIO | Owns DB and object storage volumes. |
| Valkey VM | `deploy/production/docker/valkey` | Valkey | Realtime notification fanout only; not source of truth. |
| Backend VM | `deploy/production/docker/backend` | backend API/all-role container with worker behavior and runtime tools | Backend image must contain Node 20, ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium when enabled. |
| CMS VM | `deploy/production/docker/cms` | nginx static CMS image and runtime config | Serves built CMS, SPA fallback, `/api/v1`, `/socket.io`, and `/grafana` proxy paths where configured. |
| Observability VM | `deploy/production/docker/observability` | Prometheus + Grafana | Consumes shared rules/dashboards/provisioning. |
| Player machines | `darshan-player/package.json`, production runbooks | packaged Electron `.deb` plus `/etc/darshan/player/config.json` | Player is not a Docker server role. |

Proxmox is the hypervisor only. DARSHAN services run inside Docker on normal Ubuntu Server VMs for production deployment.

## Config Boundary

| Runtime | Secrets / sensitive settings | Non-secret runtime config | Code source of truth |
|---|---|---|---|
| Backend | `darshan-server/.env`, Docker role env, DB/object storage/JWT/admin/cert paths | `darshan-server/config/backend.json` mounted as `/app/config/backend.json` in Docker | `darshan-server/src/config/index.ts`, `src/config/file-config.ts`, backend compose |
| CMS | no secrets; all browser-visible | `/config/app-config.json` from `darshan-cms/public/config/app-config.json` | `darshan-cms/src/config/runtimeConfig.ts`, CMS nginx role |
| Player | site config must avoid secrets; certs/tokens/runtime identity stay local runtime state | `/etc/darshan/player/config.json` selected by `DARSHAN_PLAYER_CONFIG_FILE` | `darshan-player/src/common/config.ts`, `src/common/file-config.ts`, `platform-paths.ts` |
| Docker site | VM IPs, ports, image names/tags, data bootstrap credentials | role env shared by scripts | `deploy/production/docker/.env.example`, role scripts |

## File Placement Contract

| Machine / role | Files required |
|---|---|
| Data VM | `deploy/production/docker/.env` |
| Valkey VM | `deploy/production/docker/.env` |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend pairing CA/cert files generated or supplied for the site |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player machine | `/etc/darshan/player/config.json` plus installed player package |

In Docker production, backend `DARSHAN_CONFIG_FILE` should resolve inside the container, normally `/app/config/backend.json`.

## Runtime Tool Contract

| Tool | Used by | Source evidence | Runtime verification |
|---|---|---|---|
| ffmpeg | media/video processing | backend `utils/runtime-dependencies.ts`, media utilities, Docker tool check | run backend container tool check on Backend VM |
| LibreOffice | office/document conversion | runtime dependency validation, document processing paths | run backend container tool check and real document render smoke |
| pg_dump | backups | settings/backup utilities and runtime dependency validation | run backup smoke only on a safe target |
| tar | archive/backup support | runtime dependency validation | run backend tool check |
| Playwright Chromium | webpage capture | webpage capture utilities and Docker build options | run webpage capture smoke on target container |

## Runtime Evidence Required

- `docker compose config` and role startup on each production VM.
- Backend `/api/v1/health` from CMS/player network.
- MinIO and Postgres health from backend VM.
- Valkey ping from backend VM.
- CMS browser login and nested route refresh from operator workstation.
- Socket.IO `/device` connection from packaged player.
- Default-media assignment and schedule publish reaching the player through realtime or polling fallback.
- Prometheus and Grafana health/scrape checks.
- Runtime no-secret review for logs, screenshots, support bundles, browser network payloads, and player diagnostics.

## Non-Contract Items

- Docs/examples do not prove deployment health.
- Source checkout paths do not define production runtime paths unless a Docker role mounts them.
- Player config does not contain runtime identity, cert private material, tokens, media cache, or proof-of-play queue.
