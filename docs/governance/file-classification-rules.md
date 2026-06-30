# File Classification Rules

Last code-truth refresh: 2026-06-28.

Use these rules before adding, moving, or committing files. They are based on the current DARSHAN runtime split: backend, CMS, player, Docker-on-VM deployment, and player devices.

## Evidence Sources

| Classification area | Code / deploy source |
|---|---|
| Backend env/config boundary | `darshan-server/.env.example`, `darshan-server/src/config/index.ts`, `darshan-server/src/config/file-config.ts`, `darshan-server/config/backend.production.example.json` |
| CMS runtime config boundary | `darshan-cms/.env.example`, `darshan-cms/src/config/runtimeConfig.ts`, `darshan-cms/public/config/app-config.example.json` |
| Player config/runtime state boundary | `darshan-player/src/common/config.ts`, `darshan-player/src/common/file-config.ts`, `darshan-player/src/common/platform-paths.ts`, `darshan-player/src/main/services/*` |
| Production Docker files | `deploy/production/README.md`, `deploy/production/docker/*`, `docs/environments/production/README.md` |
| Config examples | `docs/examples/README.md`, `scripts/verify/validate-onprem-config-examples.sh` |

## Keep In Service Source Trees

Keep files in `darshan-server`, `darshan-cms`, or `darshan-player` when they answer how that service is built, tested, typed, configured by code, or run locally.

| Location | Belongs there | Does not belong there |
|---|---|---|
| `darshan-server` | backend source, tests, migrations, Dockerfile, backend `.env.example`, backend non-secret config examples | production `.env`, real certs/keys, production DB dumps, operator-specific runtime data |
| `darshan-cms` | React source, tests, nginx/static build assets, CMS `.env.example`, browser-visible runtime config example | browser secrets, filled production runtime config with private hostnames, built `dist` as source-of-truth |
| `darshan-player` | Electron source, tests, packaging scripts, player config examples, static audit docs | installed app data, pairing state, device certs, cache, PoP queue, request queue, built installers |

## Keep In Root Docs / Deploy

Use root-level docs and deploy folders for cross-service behavior, environment topology, operator guidance, and governance.

| Location | Belongs there |
|---|---|
| `docs/architecture` | code-backed architecture and failure/scaling behavior |
| `docs/contracts` | backend/CMS/player/realtime/deployment contracts |
| `docs/environments` | development, QA, production environment models |
| `docs/examples` | non-secret config examples and profile bundles |
| `docs/governance` | ownership, change control, secret handling, evidence gates, incident/rollback governance |
| `docs/runbooks` | operator procedures, recovery, install, troubleshooting |
| `deploy/production/docker` | Docker role compose files, start/stop/health/reset scripts, role-specific deployment README |
| `deploy/shared` | nginx/observability assets used by active Docker roles |

## Runtime File Placement

| Runtime file | Correct placement | Governance rule |
|---|---|---|
| Backend Docker config | `darshan-server/config/backend.json`, mounted as `/app/config/backend.json` | Non-secret config only; selected by `DARSHAN_CONFIG_FILE=/app/config/backend.json` in Docker. |
| Backend direct-host config | `/etc/darshan/server/config.json` | Compatibility path only; not the Docker backend path. |
| Backend secrets | backend `.env` or secret store on Backend VM | Keep DB URLs, JWT/admin secrets, MinIO secrets, Valkey auth, cert paths out of committed JSON. |
| CMS runtime config | `darshan-cms/public/config/app-config.json`, served as `/config/app-config.json` | Browser-visible only; no secrets or credentialed URLs. |
| Player site config | `/etc/darshan/player/config.json` | Non-secret deployment config only; selected by `DARSHAN_PLAYER_CONFIG_FILE`. |
| Player runtime state | Electron user-data/cache/runtime directories | Contains device identity, certs, cache, queues, PoP spool, logs; do not commit. |
| Docker volumes | Docker-managed volumes on role VMs | Postgres, MinIO, Valkey, Prometheus, and Grafana data require backup/restore governance. |

## Never Commit

- real `.env` files or filled secret templates
- database URLs with real passwords
- JWT/admin passwords, API keys, bearer tokens, signed URLs, session tokens
- MinIO/Valkey/Postgres credentials
- private keys, PEM blocks, cert private material, pairing CA keys
- production inventories, customer LAN IP maps, serial numbers, full device identifiers
- generated deployment bundles, built installers, Docker image archives, packaged `.deb`/`.rpm`/`.dmg`/`.exe`
- DB dumps, MinIO exports, player app-data, media cache, request queues, proof-of-play queues, screenshots, logs/support bundles

## Example And Documentation Rules

- Examples must be placeholders or non-secret sample values only.
- JSON config examples must match current loaders: backend `file-config.ts`, CMS `runtimeConfig.ts`, player `file-config.ts`.
- If a doc uses `/etc/darshan/server/config.json`, it must label it as direct-host compatibility, not Docker production.
- If a doc uses `/etc/darshan/player/config.json`, it must say this is player site config, not runtime identity state.
- Runtime evidence screenshots/logs may be documented only after no-secret review.
