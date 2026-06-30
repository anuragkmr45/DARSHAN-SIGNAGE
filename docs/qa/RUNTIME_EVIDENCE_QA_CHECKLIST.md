# Runtime Evidence QA Checklist

Last code-truth refresh: 2026-06-28.

This checklist records what must be collected before QA can call a behavior verified in a real environment. It does not claim that any item has passed.

## Evidence Recording Rules

For every executed check, record:

- date and operator,
- target host/device and role,
- exact command or browser/player action,
- sanitized result,
- failures and blockers,
- screenshots/log snippets only after no-secret review.

Do not include secrets, credentialed URLs, signed URLs, tokens, cert PEMs, private keys, full serials, or unreviewed logs.

## Required Target Inputs

| Input | Required for | Status if missing |
|---|---|---|
| Data VM address and credentials | DB/MinIO health and backend config | `blocked` |
| Valkey VM address | realtime/outbox fanout | `blocked` for realtime evidence |
| Backend VM address | API, worker, player, CMS API calls | `blocked` |
| CMS VM address | browser QA and same-origin proxy checks | `blocked` |
| Observability VM address | Prometheus/Grafana evidence | `blocked` |
| Node 20 path where local builds are required | build/test evidence | `blocked` |
| Packaged player artifact | player install/autostart evidence | `blocked` |
| Target player device/RPi/AXON/Ubuntu machine | pairing/playback/screenshot evidence | `blocked` |
| Admin and non-admin test users | auth/RBAC/browser QA | `blocked` |
| Test media set | media rendering and schedule/default-media evidence | `blocked` |

## Backend And Data Evidence

| Check | Expected evidence | Code/deploy source | Status |
|---|---|---|---|
| Data role health | Postgres reachable, MinIO live, volumes mounted | `deploy/production/docker/data/*` | `needs runtime verification` |
| Backend API health | `GET /api/v1/health` returns ok from backend VM and CMS proxy | `darshan-server/src/server/index.ts` | `needs runtime verification` |
| Runtime tools | ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium available in backend container | `deploy/production/docker/check-backend-runtime-tools.sh`, runtime dependency code | `needs runtime verification` |
| DB bootstrap | schema push/migrations and seed path completed intentionally | backend start script and DB code | `needs runtime verification` |
| MinIO buckets | runtime buckets created and media upload works | S3 utilities and backend bootstrap | `needs runtime verification` |

## CMS Browser Evidence

| Check | Expected evidence | Code source | Status |
|---|---|---|---|
| Login/logout/session | Admin login, route refresh, logout | `darshan-cms/src/pages/Auth.tsx`, backend auth routes | `needs runtime verification` |
| Route guard matrix | least-privileged users denied from guarded routes | `darshan-cms/src/App.tsx`, `ProtectedRoute.tsx` | `needs runtime verification` |
| Core pages | dashboard, media, schedule, layouts, screens, settings, reports, requests, chat/notifications load | CMS route tree and API domains | `needs runtime verification` |
| Same-origin proxy | CMS origin serves `/api/v1`, `/socket.io`, `/grafana` as configured | CMS nginx Docker config | `needs runtime verification` |
| No browser secret leak | network payloads/screenshots reviewed | config/runtime security docs | `needs runtime verification` |

## Player Evidence

| Check | Expected evidence | Code source | Status |
|---|---|---|---|
| Package install | `.deb` installs on target OS and starts app | `darshan-player/package.json`, production docs | `needs runtime verification` |
| Config selection | player uses `/etc/darshan/player/config.json` and doctor reports redacted diagnostics | player config/doctor/operator tools | `needs runtime verification` |
| Autostart | reboot starts player without manual launch | autostart service and player startup code | `needs runtime verification` |
| Pair/recover/re-pair | OTP and recovery flows work against backend | pairing services and backend pairing routes | `needs runtime verification` |
| Online/offline heartbeat | CMS online state follows heartbeat after start, disconnect, reconnect | heartbeat and screens realtime code | `needs runtime verification` |
| Playback | video/image/PDF/webpage/default-media/schedule render on target device | renderer/player/default-media/cache code | `needs runtime verification` |
| Restart/resume | mid-schedule restart resumes to schedule-correct item/position | playback policy/progress store/renderer | `needs runtime verification` |
| Screenshot | target display capture uploads and appears in CMS | screenshot service and routes | `needs runtime verification` |
| PoP | playback evidence persists and replay is honest after restart/offline | PoP service and backend proof routes | `needs runtime verification` |

## Realtime And Observability Evidence

| Check | Expected evidence | Code/deploy source | Status |
|---|---|---|---|
| Socket.IO `/device` | player connects with realtime enabled | realtime gateway/player realtime service | `needs runtime verification` |
| Valkey fanout | publish/default-media/emergency commands wake player without polling-only delay | outbox/Valkey/device desired-state services | `needs runtime verification` |
| Polling fallback | player still updates when socket unavailable | player command/snapshot/default-media polling code | `needs runtime verification` |
| Prometheus | backend metrics scrape succeeds | metrics routes and shared Prometheus config | `needs runtime verification` |
| Grafana | Grafana health and dashboard provisioning pass | shared Grafana provisioning | `needs runtime verification` |
| Alert review | rules load and are manually reviewed | shared alert/rule assets | `needs runtime verification` |
