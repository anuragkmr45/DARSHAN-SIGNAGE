# Full Product QA Matrix

Last code-truth refresh: 2026-06-28.

This matrix is execution guidance for QA. It intentionally separates code-backed checks from runtime evidence that still needs a real target.

## Access, Admin, And Settings

| Scenario | Code sources | Existing automated anchors | Manual/runtime checks | Evidence status |
|---|---|---|---|---|
| Login, logout, current user, session refresh | `darshan-server/src/routes/auth.ts`, `src/auth/*`, `darshan-cms/src/pages/Auth.tsx` | `darshan-server/src/routes/auth.test.ts` | Browser login/logout/session expiry from deployed CMS origin | `needs-runtime-verification` |
| RBAC and route guards | `darshan-server/src/rbac/*`, `roles.ts`, `permissions.ts`, `darshan-cms/src/App.tsx`, `ProtectedRoute.tsx` | RBAC and CMS authz tests where present | Direct navigation checks for each guarded route using least-privileged users | `needs-runtime-verification` |
| Users, invites, operators, departments | `users*.ts`, `departments.ts`, `pages/Users.tsx`, `Operators.tsx`, `Departments.tsx` | users, invite, department route tests | Create/edit/delete/invite flows in browser; verify denied actions remain hidden and rejected by backend | `needs-runtime-verification` |
| Site settings, backups, logs, default runtime labels | `routes/settings.ts`, settings components/hooks | settings and backup tests | Browser settings save/reload, backup run/history, logs visibility without secrets | `needs-runtime-verification` |

## Content, Scheduling, And Playback Setup

| Scenario | Code sources | Existing automated anchors | Manual/runtime checks | Evidence status |
|---|---|---|---|---|
| Media upload, ready state, delete rules | `routes/media.ts`, media repositories/S3 utilities, `MediaLibrary.tsx`, media upload helpers | media route tests, CMS media tests where present | Upload image/video/PDF/office/webpage candidates; verify ready/error/delete behavior | `needs-runtime-verification` |
| Layout create/edit and validation | `routes/layouts.ts`, `LayoutEditor.tsx`, layout components | layout route tests | Browser create/edit/delete layout, overlap validation, preview | `needs-runtime-verification` |
| Schedule create, reservation preview, publish, take-down | `routes/schedules.ts`, `schedule-publish-helper.ts`, reservation service, schedule pages/components | schedule/publish/reservation tests | CMS publish to real paired screen; verify active schedule and take-down behavior | `needs-runtime-verification` |
| Schedule requests and generic requests | `schedule-requests.ts`, `requests.ts`, `Requests.tsx` | schedule-request tests | Browser request workboard, schedule request approval/rejection/cancel/publish | `needs-runtime-verification` |
| Default media assignment | settings/screen/device default-media routes, `DefaultMediaSection.tsx`, player default-media service | backend, CMS, and player default-media tests | Assign default media in CMS and verify player update through realtime and polling fallback | `needs-runtime-verification` |
| Emergency takeover | `routes/emergency.ts`, emergency modal, command/playback refresh paths | emergency tests, scheduling emergency e2e where current | Trigger/clear emergency on real screen and verify audit/state/playback recovery | `needs-runtime-verification` |

## Fleet, Player Runtime, And Device Evidence

| Scenario | Code sources | Existing automated anchors | Manual/runtime checks | Evidence status |
|---|---|---|---|---|
| Pair, recover, revoke/reset player | `routes/device-pairing.ts`, `PairDeviceModal.tsx`, player pairing service, player flow, cert manager | backend pairing tests, player pairing integration | Packaged player OTP/pair/recover/re-pair on target hardware | `needs-runtime-verification` |
| Heartbeat and online/offline state | device telemetry routes, screen-state refresh, CMS realtime hooks, player heartbeat | heartbeat/device telemetry tests | CMS online/offline transition after player start, disconnect, reconnect | `needs-runtime-verification` |
| Realtime command/default-media wake and polling fallback | device gateway, outbox/desired-state/command services, player realtime and command processor | command/realtime tests | Measure player update latency with Socket.IO enabled; then verify polling fallback | `needs-runtime-verification` |
| Schedule playback and restart/resume | snapshot manager, playback policy, playback progress store, renderer/player files | playback-policy, snapshot, renderer, player-flow tests | Start/restart player mid-schedule and compare wall-clock-correct item/video position | `needs-runtime-verification` |
| Media rendering on target device | renderer player/default-media/PDF/webpage paths, cache manager | renderer/cache tests | Real player renders video, image, PDF, office fallback/converted document, webpage/cached preview | `needs-runtime-verification` |
| Screenshots | screenshot routes, CMS screen detail, player screenshot service/request queue | screenshot service and device telemetry tests | Capture from target display, upload, CMS preview refresh, retry behavior | `needs-runtime-verification` |
| Proof-of-play | device telemetry/proof routes, PoP service/spool, reports/PoP pages | backend and player PoP tests | Verify playback start/end evidence, queue/replay, no fake continuous playback after crash | `needs-runtime-verification` |
| Reset/reinstall/cache/queue behavior | player operator tools, platform paths, cache, request queue, PoP spool | operator, queue, cache, PoP tests | Clean reinstall/reset paths preserve or clear only documented state | `needs-runtime-verification` |

## Communications, Reporting, And Integrations

| Scenario | Code sources | Existing automated anchors | Manual/runtime checks | Evidence status |
|---|---|---|---|---|
| Notifications and unread counters | notifications routes/repositories/namespace, notifications page/hook | notifications tests | Browser unread/read/read-all and realtime badge updates | `needs-runtime-verification` |
| Chat/conversations/threads/attachments | chat and conversation routes/namespaces, chat pages/components/hooks | chat/conversation route tests, CMS chat e2e | Multi-user browser chat, attachments, threads, pins/bookmarks, moderation | `needs-runtime-verification` |
| Reports, audit logs, proof export | reports, audit, proof routes, report pages | reports/audit/proof tests | Browser filters/exports and no-secret review of generated outputs | `needs-runtime-verification` |
| API keys, webhooks, SSO config | API key, webhook, SSO route/domain/page files | admin-ops tests | Create/rotate/revoke API key; webhook bounded test; SSO config save/deactivate | `needs-runtime-verification` |
| Client security events | security-events route and CMS security boundary | security-events tests | Browser production-lockdown event path if enabled | `needs-runtime-verification` |

## Deployment, Config, Observability, And No-Secret QA

| Scenario | Code/deploy sources | Existing automated anchors | Manual/runtime checks | Evidence status |
|---|---|---|---|---|
| Data VM | `deploy/production/docker/data/docker-compose.yml`, `start-data.sh` | compose config when run | Postgres and MinIO health from backend VM and data VM | `needs-runtime-verification` |
| Valkey VM | `deploy/production/docker/valkey/docker-compose.yml`, `start-valkey.sh` | compose config when run | `PING`, backend connection, no `ENOTFOUND` logs | `needs-runtime-verification` |
| Backend VM | backend Docker compose/start scripts, runtime tool checker, backend config loader | backend build/tests when run | `/api/v1/health`, DB init, MinIO buckets, Valkey, ffmpeg, LibreOffice, pg_dump, tar, Playwright Chromium | `needs-runtime-verification` |
| CMS VM | CMS Dockerfile/nginx config/runtime config | CMS build/tests when run | `/`, nested route refresh, `/config/app-config.json`, `/api/v1`, `/socket.io`, `/grafana` proxy behavior | `needs-runtime-verification` |
| Observability VM | observability compose, Prometheus/Grafana shared assets | Prometheus rule tests | Prometheus healthy, Grafana health, backend scrape, dashboard/rule load | `needs-runtime-verification` |
| No-secret review | redaction utilities, logger/operator tools, support/runbook docs | redaction/operator tests | Logs, doctor output, support bundles, screenshots, browser payloads reviewed before sharing | `needs-runtime-verification` |
