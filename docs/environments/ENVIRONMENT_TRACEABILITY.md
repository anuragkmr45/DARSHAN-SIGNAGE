# DARSHAN Environment Traceability

Last code-truth refresh: 2026-06-28.

This table maps environment behavior to code/deployment sources. It is intended to prevent environment docs from drifting into guesses.

| Behavior / contract | Code or deployment source | Environment owner | Notes |
|---|---|---|---|
| Backend runtime role selection | `darshan-server/src/runtime/process-role.ts`, `darshan-server/src/index.ts` | Backend | CLI `--role` wins, then `DARSHAN_PROCESS_ROLE`, then legacy `HEXMON_PROCESS_ROLE`, then `all`. |
| Backend shared startup dependencies | `darshan-server/src/runtime/bootstrap.ts` | Backend | All roles validate runtime tools, initialize DB, S3/MinIO, pg-boss, and buckets. |
| Backend API + worker in one production container | `deploy/production/docker/backend/docker-compose.yml` | Backend VM | Compose sets `DARSHAN_PROCESS_ROLE=all`; container command is `npm start`. |
| Backend config file selector | `darshan-server/src/config/file-config.ts`, backend compose | Backend VM | `DARSHAN_CONFIG_FILE` preferred; Docker default is `/app/config/backend.json`. |
| Backend env schema | `darshan-server/src/config/index.ts` | Backend VM | App env holds secrets, sensitive URLs, and emergency overrides. |
| Backend config JSON shape | `darshan-server/src/config/file-config.ts`, `darshan-server/config/backend.production.example.json` | Backend VM | Non-secret config sections: environment, http, realtime, valkey, duplicateIdentity, security, deviceSocketAuth, commands, outbox, media, observability, limits. |
| Runtime tools | `darshan-server/src/utils/runtime-dependencies.ts`, backend Dockerfile, `check-backend-runtime-tools.sh` | Backend VM | ffmpeg, LibreOffice, pg_dump, tar, and optional Playwright Chromium need runtime validation. |
| Pairing CA files | `deploy/production/docker/ensure-backend-certs.sh`, backend compose volume, device-pairing route | Backend VM | Script generates only when both CA files are missing; partial state fails. |
| Data services | `deploy/production/docker/data/docker-compose.yml`, `start-data.sh` | Data VM | Postgres and MinIO are separate containers with named volumes. |
| Valkey service | `deploy/production/docker/valkey/docker-compose.yml`, `start-valkey.sh` | Valkey VM | Valkey supports realtime fanout/wake behavior; DB remains source of truth. |
| Backend remote dependency wait | `deploy/production/docker/start-backend.sh` | Backend VM | Waits for Postgres TCP, MinIO health, and Valkey TCP before building/starting backend. |
| CMS runtime config loading | `darshan-cms/src/config/runtimeConfig.ts` | CMS VM/browser | Runtime JSON loads from `/config/app-config.json` unless overridden by `VITE_CMS_RUNTIME_CONFIG_PATH`; values are browser-visible. |
| CMS production image | `deploy/production/docker/cms/Dockerfile`, `cms/docker-compose.yml`, `start-cms.sh` | CMS VM | nginx static app with mounted runtime config. |
| CMS proxy dependency | `deploy/production/docker/cms/docker-compose.yml`, nginx template | CMS VM | CMS container gets `BACKEND_HOST`, `BACKEND_PORT`, `GRAFANA_HOST`, `GRAFANA_PORT` from Docker env. |
| Observability config generation | `deploy/production/docker/lib.sh`, `observability/docker-compose.yml` | Observability VM | Prometheus config generated from role env; shared rules/dashboards mounted from `deploy/shared`. |
| Player site config selector | `darshan-player/src/common/file-config.ts` | Player device | `DARSHAN_PLAYER_CONFIG_FILE` preferred; `SIGNHEX_PLAYER_CONFIG_FILE` alias. |
| Player site config allowed top-level | `darshan-player/src/common/file-config.ts` | Player device | Top-level must be `player`; unknown keys fail fast; secret-looking keys rejected. |
| Player runtime state paths | `darshan-player/src/common/platform-paths.ts` | Player device | Runtime root, config, cache, and cert dir are separate from site config. Legacy Linux `/etc/darshan/config.json` is import/compatibility state, not the preferred site config path. |
| Player dev/start/package scripts | `darshan-player/package.json` | Player development and release | Dev mode is not packaged-player evidence; package scripts produce OS artifacts. |
| Development backend local compose | `darshan-server/docker-compose.yml`, `docker-compose.dev.yml` | Development | Local support stack differs from production five-role Docker-on-VM layout. |
| Development CMS | `darshan-cms/package.json` | Development | Vite dev and build scripts. |
| QA parity | `deploy/qa/README.md`, production Docker role files | QA | QA should mirror production role split and config layout. |
| Version manifests | `manifests/qa/versions.example.yaml`, `manifests/production/versions.example.yaml` | QA/production release process | Examples pin artifact/image versions; docs do not prove deployment health. |
| Realtime env examples | `docs/environments/qa/realtime-sync.env.example`, `docs/environments/production/realtime-sync.env.example` | QA/production canary planning | Compatibility/canary checklists only; not primary Docker env source. |

## Runtime Verification Needed

| Area | Why docs cannot prove it |
|---|---|
| Docker role health | Requires actual VM/container startup and network reachability. |
| Backend runtime tools | Requires running the backend image on the Backend VM. |
| CMS browser behavior | Requires browser QA against the deployed CMS origin. |
| Socket.IO realtime latency | Requires live backend, Valkey, CMS/player clients, and network conditions. |
| Player package behavior | Requires installing the package on target hardware and running pairing/playback tests. |
| Media rendering | Video/PDF/office/webpage behavior depends on OS, codecs, runtime tools, cache, and media URLs. |

