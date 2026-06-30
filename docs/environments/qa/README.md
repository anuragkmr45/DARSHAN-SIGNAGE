# DARSHAN QA Environment

Last code-truth refresh: 2026-06-28.

QA should mirror the production Docker-on-VM role split closely enough to catch runtime and deployment regressions before promotion.

## Source Evidence

| Contract | Code / file source |
|---|---|
| QA deployment policy | `deploy/qa/README.md` |
| Production role parity | `deploy/production/docker/*/docker-compose.yml`, `deploy/production/docker/start-*.sh` |
| QA artifact pinning | `manifests/qa/versions.example.yaml` |
| Realtime canary checklist | `docs/environments/qa/realtime-sync.env.example` |

## QA Topology

| QA role | Production equivalent | Required runtime |
|---|---|---|
| QA data VM | Data VM | Postgres + MinIO Docker containers |
| QA Valkey VM | Valkey VM | Valkey Docker container |
| QA backend VM | Backend VM | backend image with API + worker role and runtime tools |
| QA CMS VM | CMS VM | nginx static CMS image and runtime config |
| QA observability VM | Observability VM | Prometheus + Grafana |
| QA player devices | Production player devices | packaged player artifact and site config |

QA should use the same file placement as production:

| Target | Files |
|---|---|
| Data VM | `deploy/production/docker/.env` adapted for QA hosts |
| Valkey VM | `deploy/production/docker/.env` adapted for QA hosts |
| Backend VM | `deploy/production/docker/.env`, `darshan-server/.env`, `darshan-server/config/backend.json`, backend cert files |
| CMS VM | `deploy/production/docker/.env`, `darshan-cms/public/config/app-config.json` |
| Observability VM | `deploy/production/docker/.env` |
| Player device | `/etc/darshan/player/config.json` plus installed player package |

## QA Config Rules

- Keep app secrets in backend env on the QA Backend VM only.
- Keep Docker host IPs, ports, image names, and data bootstrap credentials in the Docker role env.
- Keep browser-visible CMS endpoint labels in `app-config.json`.
- Keep non-secret backend runtime behavior in `backend.json`.
- Keep player site endpoint labels in `/etc/darshan/player/config.json`; device identity and certs stay runtime-local.

## Required QA Coverage

QA must validate:

- backend API health and auth,
- Postgres and MinIO reachability from backend,
- Valkey reachability from backend,
- backend runtime tools: ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium when enabled,
- CMS nginx SPA fallback and `/api/v1`, `/socket.io`, `/grafana` proxy paths,
- CMS login and main route refresh,
- player package install/start on target architecture,
- pairing, heartbeat, default media, schedule publish, screenshot, proof-of-play, and offline/polling fallback,
- Socket.IO notification path plus polling fallback,
- observability health and scrape status,
- no-secret review for logs, browser network payloads, screenshots, player diagnostics, and support bundles.

## Realtime Canary File

`docs/environments/qa/realtime-sync.env.example` is a compatibility/canary checklist for realtime and load-test gates. It is not the primary Docker role env source. The primary QA role env is still the production Docker env shape adapted to QA hosts.

## Promotion Boundary

QA evidence can support promotion only when it is captured from actual QA runtime. These docs and examples do not claim runtime evidence.

