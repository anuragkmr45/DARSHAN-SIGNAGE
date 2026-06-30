# QA Traceability

Last code-truth refresh: 2026-06-28.

This document maps QA coverage areas to implementation evidence, tests, and runtime evidence needs. It is a QA index, not an API contract.

## Feature Domain Map

| Domain | Backend source | CMS source | Player source | Existing test anchors | QA artifact |
|---|---|---|---|---|---|
| Auth, session, RBAC | `darshan-server/src/routes/auth.ts`, `users.ts`, `roles.ts`, `permissions.ts`, `darshan-server/src/auth/*`, `src/rbac/*` | `darshan-cms/src/pages/Auth.tsx`, `components/auth/ProtectedRoute.tsx`, `hooks/useAuthorization.ts`, `lib/access.ts` | not applicable | `darshan-server/src/routes/auth.test.ts`, `darshan-server/src/routes/users.test.ts`, CMS access tests where present | `FEATURE_INVENTORY.md` `PH1-*`; `FULL_PRODUCT_QA_MATRIX.md` |
| Users, departments, operators | `darshan-server/src/routes/users*.ts`, `departments.ts`, repositories | `pages/Users.tsx`, `Operators.tsx`, `Departments.tsx` | not applicable | user, invite, department route tests | `FEATURE_INVENTORY.md` `PH1-USER-*`, `PH1-DEPT-*` |
| Media and storage | `darshan-server/src/routes/media.ts`, S3 utilities, media processing jobs | `pages/MediaLibrary.tsx`, `api/domains/media.ts`, media preview/upload helpers | cache manager and renderer playback paths | media route tests, CMS media tests where present, player renderer/cache tests | `FEATURE_INVENTORY.md` `PH2-MEDIA-001`; runtime checklist for target rendering |
| Layouts, schedules, reservations, publish | schedule/layout/presentation routes, reservation service, publish helper | `pages/Layouts.tsx`, `LayoutEditor.tsx`, `ScheduleQueue.tsx`, `ScheduleCreator.tsx` | snapshot manager, playback policy, playback engine, renderer | schedule, publish, reservation tests; player snapshot/playback tests | `FEATURE_INVENTORY.md` `PH2-*`, `INT-002`, `INT-003` |
| Default media | settings routes, screens default-media route, device default-media route | `components/settings/DefaultMediaSection.tsx` | default-media service and renderer | backend default-media tests, CMS e2e, player default-media tests | `FEATURE_INVENTORY.md` `PH2-DFMED-009`; runtime checklist |
| Emergency and requests | emergency, requests, schedule-request routes | `pages/Requests.tsx`, emergency modal, request components | command processing and playback refresh response | emergency and schedule-request tests | `FEATURE_INVENTORY.md` `PH2-EMERG-008`, `PH4-WREQ-001` |
| Screens, groups, pairing | screens, screen-groups, device-pairing, device-telemetry routes | `pages/Screens.tsx`, screen components, Pair Device modal | pairing service, player flow, cert manager, device-state store | pairing, screens, screen-groups tests; player pairing integration | `FEATURE_INVENTORY.md` `PH3-*`, `INT-001` |
| Realtime and commands | device gateway, screens/chat/notifications namespaces, command services, outbox dispatcher | realtime hooks for screens, chat, notifications | realtime service, command processor, request queue | command, realtime namespace, heartbeat tests | `FEATURE_INVENTORY.md` `PH3-CMD-005`, `INT-003`, `INT-006` |
| Heartbeat, screenshots, PoP | device telemetry, proof-of-play, screenshot routes | dashboard/screen detail and proof pages | heartbeat, screenshot service, PoP service, request queue | heartbeat, screenshot, PoP tests | `FEATURE_INVENTORY.md` `PH3-DTEL-*`, `PH3-SHOT-*`, `PH3-POP-*` |
| Chat, notifications, conversations | chat, conversations, notifications routes and namespaces | `pages/Conversations.tsx`, `Notifications.tsx`, chat components/hooks | not applicable | chat/conversation/notification tests and CMS chat e2e | `FEATURE_INVENTORY.md` `PH4-NOTIF-*`, `PH4-CHAT-*` |
| Reports, audit, API keys, webhooks, SSO | reports, audit logs, API keys, webhooks, SSO, security-events routes | `Reports.tsx`, `ProofOfPlay.tsx`, `ApiKeys.tsx`, `Webhooks.tsx`, `SsoConfig.tsx` | not applicable except PoP/reporting sources | reports, audit, admin-ops tests | `FEATURE_INVENTORY.md` `PH4-RPT-*` through `PH4-SSO-*` |
| Observability | metrics and observability routes, observability services | dashboard/observability surfaces | player health server/metrics where enabled | observability/metrics tests, Prometheus rule tests | `FEATURE_INVENTORY.md` `PH4-OBS-010`; runtime checklist |
| Docker production deployment | production Docker role scripts and compose files | CMS nginx image/runtime config | packaged player config/install docs | compose validation and role health checks when run | `REGRESSION_MASTER_PLAN.md`; `RUNTIME_EVIDENCE_QA_CHECKLIST.md` |

## QA Evidence Status Rules

| Status | Meaning |
|---|---|
| `confirmed-by-code` | The implementation path exists and cites code, schema, deploy, or tests. |
| `needs-runtime-verification` | Code path exists, but the behavior depends on target services, browser, package, device, network, media, or observability runtime evidence. |
| `historical/stale` | Preserved tracker or prompt-pack content from a prior pass; do not use as current proof without rechecking code. |
| `deferred-gap` | Known QA gap or robustness bucket with no current passing evidence requirement. |

## Runtime Evidence Boundary

The QA docs do not prove production readiness. Production-facing evidence still requires actual target runs for browser CMS QA, packaged player install/autostart, player media rendering, screenshot capture, Socket.IO/Valkey wake latency, proof-of-play replay, observability scrape health, and no-secret review.
