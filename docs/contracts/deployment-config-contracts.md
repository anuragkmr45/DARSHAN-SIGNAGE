# Deployment And Config Contracts

Last code-truth audit: 2026-09-05.

## Source-Free Production Composition

The only manually edited source is
`deploy/production/bundles/<site>-<release>.env`. The strict parser rejects
unknown, duplicate, interpolated, placeholder, and unsafe values and derives all
role runtime files. Production requires HTTPS/WSS, backend and MinIO TLS,
CMS-origin MinIO CORS, strict player transport trust, verified Nginx/Prometheus
upstreams, persistent transport/device CAs, and no packaged transport CA key.

Generated role env, CMS runtime JSON, player config, and TLS files are release
outputs. Editing them creates an unsupported configuration split.

This document describes deployment/config contracts visible in the repo. It does not prove a production site is healthy.

## Production Deployment Contract

| Role | Current production path | Runtime contents | Contract notes |
|---|---|---|---|
| Data VM | generated bundle `production/data` | Postgres + MinIO | Owns DB and object storage volumes. |
| Valkey VM | generated bundle `production/valkey` | Valkey | Realtime notification fanout only; not source of truth. |
| Backend VM | generated bundle `production/backend` | backend API plus worker role containers and runtime tools | Backend image must contain Node 20, ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium when enabled; `deploy.sh` owns install/upgrade/adoption dispatch. |
| CMS VM | generated bundle `production/cms` | nginx static CMS image and runtime config | Serves built CMS, SPA fallback, `/api/v1`, `/socket.io`, and `/grafana` proxy paths where configured. |
| Observability VM | generated bundle `production/observability` | Prometheus + Grafana | Consumes generated rules/dashboards/provisioning and protected credential files. |
| Player machines | generated bundle `production/electron` plus production runbooks | packaged Electron installer plus `/etc/darshan/player/config.json` | Player is not a Docker server role; runtime identity/certs/cache stay on the player. |

Proxmox is the hypervisor only. DARSHAN services run inside Docker on normal
Ubuntu Server VMs for production deployment. The checkout-based
`deploy/production/docker/*` tree is retained for compatibility/lab reference
only and must not be treated as the production authority for fresh install,
upgrade, adoption, rollback, or administrator recovery.

## Config Boundary

| Runtime | Secrets / sensitive settings | Non-secret runtime config | Code source of truth |
|---|---|---|---|
| Backend | generated role `secrets/*`, `worker-secrets/*`, DB/object storage/JWT/cert paths; no runtime admin password | generated `.env.production` and cert files mounted by the backend role | `darshan-server/src/config/index.ts`, `src/config/file-config.ts`, generated backend compose |
| CMS | no secrets; all browser-visible | `/config/app-config.json` from `darshan-cms/public/config/app-config.json` | `darshan-cms/src/config/runtimeConfig.ts`, CMS nginx role |
| Player | site config must avoid secrets; certs/tokens/runtime identity stay local runtime state | `/etc/darshan/player/config.json` selected by `DARSHAN_PLAYER_CONFIG_FILE` | `darshan-player/src/common/config.ts`, `src/common/file-config.ts`, `platform-paths.ts` |
| Bundle site | VM IPs, ports, image names/tags, data bootstrap credentials | strict site env parsed into generated role files | `deploy/production/bundles/<site>-<release>.env`, `scripts/bundle/production-bundle-config.mjs` |

## File Placement Contract

| Machine / role | Files required |
|---|---|
| Data VM | generated `production/data` role folder |
| Valkey VM | generated `production/valkey` role folder |
| Backend VM | generated `production/backend` role folder with protected `secrets/*`, `worker-secrets/*`, and cert files |
| CMS VM | generated `production/cms` role folder with built static app and runtime config |
| Observability VM | generated `production/observability` role folder with protected observability secrets |
| Player machine | generated `production/electron` installer/config assets plus installed player package state under `/etc/darshan/player` |

In source-free production, generated files are release artifacts. Operators may
edit only the private site bundle env before generation; editing role
`.env.production`, CMS JSON, player JSON, or TLS files after generation creates
an unsupported split.

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
- Backend `/api/v1/health/live` and `/api/v1/health/ready` from CMS/player network; production readiness evidence must use `/ready`.
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
