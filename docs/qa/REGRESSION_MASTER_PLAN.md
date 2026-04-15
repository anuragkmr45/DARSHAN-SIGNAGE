# Regression Master Plan

This plan defines the phased QA discovery and regression program for the current multi-repo Signhex workspace. It is intentionally code-anchored: repo entrypoints, test harnesses, manifests, and runtime scripts determine scope and sequencing.

## Test Phases

| Phase | Wave | Primary Objective | Primary Surfaces | Core Outputs |
| --- | --- | --- | --- | --- |
| `Phase 1` | Access/Admin | Establish trusted baseline for authentication, sessions, RBAC, users, departments, and core settings before broader feature execution. | `signhex-server/src/routes/auth.ts`, `users.ts`, `departments.ts`, `roles.ts`, `permissions.ts`, `settings.ts`; `signhex-nexus-core/src/pages/Auth.tsx`, `Users.tsx`, `Departments.tsx`, `Settings.tsx` | Confirmed inventory rows, smoke coverage map, and first-pass access/admin defect list. |
| `Phase 2` | Content/Scheduling | Validate authoring and publishing paths for media, layouts, schedules, requests, reservations, emergency takeover, and default media. | `signhex-server/src/routes/media.ts`, `layouts.ts`, `presentations.ts`, `schedules.ts`, `schedule-requests.ts`, `schedule-reservations.ts`, `emergency.ts`, `settings.ts`; `signhex-nexus-core/src/pages/MediaLibrary.tsx`, `Layouts.tsx`, `ScheduleQueue.tsx`, `ScheduleCreator.tsx`, `Requests.tsx` | Execution-ready coverage matrix for content and scheduling plus defect backlog linked to `PH2-*` IDs. |
| `Phase 3` | Fleet/Player Runtime | Validate screen management, pairing, telemetry, playback, commands, screenshots, proof-of-play, and offline recovery across backend and player. | `signhex-server/src/routes/screens.ts`, `screen-groups.ts`, `device-pairing.ts`, `device-telemetry.ts`, `proof-of-play.ts`; `signage-screen/src/main/index.ts`, `src/main/services`; `signhex-nexus-core/src/pages/Screens.tsx` | Cross-stack runtime coverage, environment notes for real device validation, and defect backlog linked to `PH3-*` IDs. |
| `Phase 4` | Communications/Reporting/Ops | Validate collaboration, reporting, security/ops surfaces, and deployment/observability readiness. | `signhex-server/src/routes/requests.ts`, `notifications.ts`, `conversations.ts`, `chat.ts`, `reports.ts`, `audit-logs.ts`, `api-keys.ts`, `webhooks.ts`, `sso-config.ts`, `metrics.ts`, `observability.ts`; `signhex-platform/manifests`; `signhex-platform/deploy` | Coverage map for communications/reporting/ops and environment fidelity gaps linked to `PH4-*` IDs. |
| `Phase 5` | Robustness-Only Fixes | Re-test and close logged defects without expanding scope. | `QA_REGRESSION_TRACKER.md`; targeted source/test paths referenced by defect rows | Verified fixes, no-scope-creep enforcement, and closeout evidence. |

## Environments

| Environment | Verified Anchors | Purpose | Notes |
| --- | --- | --- | --- |
| Local backend stack | `signhex-server/docker-compose.yml`; `signhex-server/docker-compose.dev.yml`; `signhex-server/.env.qa.example` | Bring up API, Postgres, and MinIO for backend-backed regression and data seeding. | Use for route-level verification, seed execution, and local API smoke tests. |
| Local CMS | `signhex-nexus-core/package.json`; `signhex-nexus-core/vite.config.ts`; `signhex-nexus-core/vitest.config.ts`; `signhex-nexus-core/playwright.config.ts` | Execute CMS unit and e2e coverage against local or pointed backend. | `playwright.config.ts` supports local dev server or external `E2E_BASE_URL`. |
| Local player | `signage-screen/package.json`; `signage-screen/src/main/index.ts`; `signage-screen/.mocharc.json` | Exercise Electron runtime, pairing, telemetry, and offline/runtime behavior. | Use for unit, integration, fault-injection, and performance suites. |
| QA artifact-driven environment | `signhex-platform/manifests/qa/versions.example.yaml`; `signhex-platform/deploy/qa`; `signhex-platform/docs/runbooks/onprem-qa-setup.md` | Validate release-candidate artifacts in the same topology expected for QA promotion. | Treat manifests as the release pin source, not local source checkouts. |
| Production-like reference environment | `signhex-platform/manifests/production/versions.example.yaml`; `signhex-platform/deploy/production`; `signhex-platform/docs/runbooks/onprem-production-setup.md` | Compare QA findings against production promotion rules and environment constraints. | Used for gate validation and rollout-readiness checks, not exploratory feature discovery. |

## Test Harnesses And Commands

| Area | Verified Commands / Harnesses | Why It Matters |
| --- | --- | --- |
| Backend | `cd signhex-server && npm test`; `cd signhex-server && npx vitest run`; `cd signhex-server && npm run test:default-media` | Confirms route/service behavior and existing focused coverage such as default media. |
| CMS | `cd signhex-nexus-core && npm run test:unit`; `cd signhex-nexus-core && npm run test:chat-e2e`; `cd signhex-nexus-core && npm run test:default-media` | Covers unit logic and browser-level e2e flows already present in the repo. |
| Player | `cd signage-screen && npm test`; `cd signage-screen && npm run test:integration`; `cd signage-screen && npm run test:fault`; `cd signage-screen && npm run test:performance`; `cd signage-screen && npm run test:default-media` | Provides runtime, reliability, offline, and performance coverage for the device layer. |
| Deploy/Ops | `bash signhex-platform/scripts/export/package-all.sh --release <tag> --electron-platform linux`; `bash signhex-platform/scripts/bundle/assemble-runtime-bundle.sh <site-name>` | Validates artifact-driven promotion and bundle assembly assumptions used by QA and production. |

## Regression Execution Baseline

This baseline turns the verified repo anchors into an execution order for regression startup. It is additive to the phase tables above and is intended to normalize readiness checks, seed expectations, and tracker handling before feature-by-feature execution begins.

### Environment Status

| Area | Status | Details | Commands |
| --- | --- | --- | --- |
| `backend` | `ready` | Evidence: `signhex-server/docker-compose.yml`, `docker-compose.dev.yml`, `.env.qa.example`, `scripts/check-services.ts`, `scripts/seed.ts`, `vitest.config.ts`, `scripts/api-test-report.ts`.<br>Local Postgres and MinIO readiness is repo-backed.<br>`npm test` is a live API smoke wrapper, not the primary unit harness, and it requires admin credentials. | `cd signhex-server && cp .env.qa.example .env`<br>`cd signhex-server && npm install`<br>`cd signhex-server && docker compose up -d postgres minio`<br>`cd signhex-server && npm run check`<br>`cd signhex-server && npm run seed`<br>`cd signhex-server && npx vitest run`<br>`cd signhex-server && npm run test:default-media`<br>`cd signhex-server && npm run dev:watch`<br>`cd signhex-server && API_BASE_URL=http://127.0.0.1:3000 ADMIN_EMAIL=<admin-email> ADMIN_PASSWORD=<admin-password> npm test` |
| `cms` | `partial` | Evidence: `signhex-nexus-core/vitest.config.ts`, `playwright.config.ts`, `tests/*.e2e.spec.ts`.<br>Unit harness is ready.<br>Playwright is present but depends on browser install plus backend and auth setup for the full suite.<br>`test:chat-e2e` is misnamed and actually runs the Playwright suite via the shared config.<br>`test:default-media` is mock-backed and can run without a live backend. | `cd signhex-nexus-core && npm install`<br>`cd signhex-nexus-core && npm run test:unit`<br>`cd signhex-nexus-core && npx playwright install --with-deps chromium`<br>`cd signhex-nexus-core && VITE_API_BASE_URL=http://127.0.0.1:3000 E2E_ADMIN_EMAIL=<admin-email> E2E_ADMIN_PASSWORD=<admin-password> npm run test:chat-e2e`<br>`cd signhex-nexus-core && npm run test:default-media` |
| `player` | `ready` | Evidence: `signage-screen/.mocharc.json`, `src/main/services/operator-tools.ts`, `test/unit`, `test/integration`, `test/fault-injection`, `test/performance`.<br>`npm test` covers unit and integration only.<br>Fault and performance remain separate required passes.<br>`npm run doctor` is a real readiness probe for config, pairing, display, cache, and autostart state. | `cd signage-screen && npm install`<br>`cd signage-screen && npm run doctor`<br>`cd signage-screen && npm test`<br>`cd signage-screen && npm run test:default-media`<br>`cd signage-screen && npm run test:fault`<br>`cd signage-screen && npm run test:performance` |
| `deploy` | `partial` | Evidence: `signhex-platform/scripts/export/package-server.sh`, `package-cms.sh`, `package-all.sh`, `scripts/bundle/assemble-runtime-bundle.sh`, `docs/runbooks/onprem-qa-setup.md`, `deploy/qa`, `manifests/qa/versions.example.yaml`.<br>Artifact and bundle scripts are present.<br>QA deployment depends on external release artifacts and QA VM topology, so it is not locally self-sufficient.<br>The baseline should use the runbook-backed export flow, not only the older generic `package-all.sh` shortcut. | `export RELEASE_ID=<release-id>`<br>`bash signhex-platform/scripts/export/package-server.sh --release "$RELEASE_ID" --deployment-layout production-split`<br>`bash signhex-platform/scripts/export/package-cms.sh --release "$RELEASE_ID"`<br>`export SITE_NAME=<site-name>`<br>`export QA_DATA_HOST=<qa-data-ip>`<br>`export QA_BACKEND_HOST=<qa-backend-ip>`<br>`export QA_BACKEND_DEVICE_HOST=<qa-backend-device-ip>`<br>`export QA_CMS_HOST=<qa-cms-ip>`<br>`export SERVER_PACKAGE_DIR="out/${RELEASE_ID}/server"`<br>`export CMS_PACKAGE_DIR="out/${RELEASE_ID}/cms"`<br>`export PLAYER_ARTIFACTS_DIR=<player-artifacts-dir>`<br>`bash signhex-platform/scripts/bundle/assemble-runtime-bundle.sh --profile qa "$SITE_NAME"` |

### Seed And Data Preconditions

- Backend seed uses `signhex-server/scripts/seed.ts` and must create the admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- Non-admin user coverage must exist before `RG-4` because CMS authz and RBAC checks need more than the seeded admin.
- The media library must include at least one `READY` image, video, document/PDF-like asset, and default-media candidate before `RG-5`.
- At least one paired screen with valid certificate history is required before `RG-6`.
- Chat, notification, API key, webhook, and SSO sample data are required before `RG-7`.
- Player fixtures under `signage-screen/test/fixtures` are harness fixtures only and do not replace backend or CMS seed data.

### Phase Order

| Phase | Goal | Entry Requirements | Exit Requirements |
| --- | --- | --- | --- |
| `RG-0` | Workspace And Tracker Baseline | All three QA docs are present.<br>`signhex-server`, `signhex-nexus-core`, `signage-screen`, and `signhex-platform` are available locally.<br>Node 20 and Docker are available. | Environment statuses are recorded.<br>Tracker workflow is locked for execution.<br>Known defects `REG-0001` through `REG-0009` are listed as the starting backlog. |
| `RG-1` | Backend Local Stack Readiness | `.env` is materialized from `.env.qa.example`.<br>Docker is available. | Postgres and MinIO are healthy.<br>Seed succeeds.<br>Backend Vitest and default-media suites are runnable.<br>Live API smoke command is documented with required auth env. |
| `RG-2` | CMS Unit/E2E Readiness | `RG-1` is complete.<br>The backend is reachable at `http://127.0.0.1:3000`.<br>Playwright browser installation is complete. | CMS unit suite is runnable.<br>The local dev-server-backed Playwright path is confirmed.<br>Admin credential requirement is documented.<br>Mocked default-media spec and the full Playwright suite are clearly separated. |
| `RG-3` | Player Harness Readiness | Node and npm are available.<br>Player config and test fixture path are understood. | `doctor`, unit, integration, fault, performance, and default-media commands are all mapped.<br>`npm test` scope is explicitly documented as unit and integration only. |
| `RG-4` | Phase 1 Access/Admin Regression | `RG-1` and `RG-2` are complete.<br>Seeded admin and non-admin accounts are available. | Auth, session, RBAC, users, departments, and settings smoke coverage is executed.<br>Pre-existing `REG-0001` and `REG-0002` are revalidated instead of duplicated.<br>No open current-phase `blocker` or `critical` issue remains. |
| `RG-5` | Phase 2 Content/Scheduling Regression | `RG-4` is stable.<br>Media, layout, schedule, and default-media seed set exists. | Media, layouts, scheduling, requests, reservations, emergency, and default-media flows are mapped to runnable tests and manual checks.<br>Pre-existing `REG-0006` is revalidated.<br>No open `blocker` against Phase 2 surfaces remains. |
| `RG-6` | Phase 3 Fleet/Player Runtime Regression | `RG-3` is complete.<br>At least one paired device or reproducible player fixture path is available.<br>Publish path is stable from `RG-5`. | Pairing, telemetry, playback, commands, screenshots, proof-of-play, and offline recovery are executed across backend, player, and CMS return paths.<br>Pre-existing `REG-0008` and `REG-0009` are revalidated.<br>No open `blocker` against Phase 3 surfaces remains. |
| `RG-7` | Phase 4 Communications, Reporting, And QA Artifact Readiness | `RG-6` is stable.<br>Report and chat seed data are available.<br>Release artifact inputs are available for QA bundle validation. | Communications, reporting, and ops surfaces are executed.<br>The artifact-driven QA bundle path is verified as runnable from the documented commands.<br>Pre-existing `REG-0003`, `REG-0004`, `REG-0005`, and `REG-0007` are revalidated.<br>Deploy readiness gaps are recorded as environment blockers if unresolved. |
| `RG-8` | Phase 5 Robustness Revalidation And Closeout | Discovery across `RG-4` through `RG-7` is substantially complete. | Only tracker-backed fixes are retested.<br>Rows move through `fixed-pending-qa` to `verified`.<br>No scope expansion occurs beyond existing tracker items. |

### Tracker Workflow During Regression

- `REG-0001` through `REG-0009` are the known starting defect set and must be revalidated in the matching `RG-*` phase instead of being re-filed.
- Known defect mapping for baseline execution is: `RG-4` revalidates `REG-0001` and `REG-0002`; `RG-5` revalidates `REG-0006`; `RG-6` revalidates `REG-0008` and `REG-0009`; `RG-7` revalidates `REG-0003`, `REG-0004`, `REG-0005`, and `REG-0007`.
- New defects discovered during execution continue at `REG-0010`.
- Use `blocked` only for environment or dependency issues that stop the current `RG-*` phase.
- Every new defect row must reference canonical IDs from `FEATURE_INVENTORY.md` and the active regression phase.
- Phase exits must respect the existing plan gates: unresolved `blocker` or `critical` issues in the current phase stop progression.
- `RG-8` may update only previously logged tracker rows.

### Execution Notes

| Date | RG Phase | Outcome | Notes |
| --- | --- | --- | --- |
| `2026-04-15` | `RG-4` | `executed-with-open-defects` | Backend Phase 1 route coverage passed for auth, login throttle, RBAC policy, users, invites, departments, roles/permissions, and backup deletion after test-harness seeding was expanded to include `SUPER_ADMIN`. CMS unit coverage passed for `access` and `authorization` helpers. `REG-0001` and `REG-0002` were revalidated, and `REG-0010` was created for a CMS/backend RBAC contract mismatch in user-target management. No `blocker` or `critical` defect was confirmed in this phase. |
| `2026-04-15` | `RG-5` | `executed-with-open-defects` | Backend Phase 2 route coverage passed in isolated fresh-database runs for media, media completion, ready-list repair, layouts, schedules, publish, schedule-request filters, reservations, emergency, settings, screens, and device-auth fallback/default-media paths. The earlier combined-suite failures were traced to test-harness contamination from repeated fixed-user seeding and shared command/state rows, not to new product regressions. CMS unit coverage passed for `mediaUploadFlow` and `scheduleQuickPresets`. Existing mock-backed Playwright specs for default media and scheduling/emergency no longer match the current UI flow and remain harness debt rather than confirmed product defects. `REG-0006` was revalidated with a focused failing auth-contract test, and no new in-scope `blocker` or `critical` defect was confirmed in this phase. |
| `2026-04-15` | `RG-6` | `executed-with-open-defects` | Player integration, default-media, fault-injection, and performance suites passed. Full player `npm test` on this machine's unsupported Node `v24.12.0` reported a cert-manager suite-contamination failure that disappeared in isolation and a cache-manager expectation that no longer matches the implemented now-playing eviction rule, so neither was logged as a product regression. Backend runtime route coverage passed in isolated fresh-database runs for pairing, recovery, device auth, runtime snapshot, screen refresh, commands, and proof-of-play. `src/routes/screens.test.ts` still has a `/api/v1/metrics/overview` assertion failure that belongs to the reporting surface and should be revisited in `RG-7`. CMS Playwright fleet specs for `screens.e2e` and `dashboard-online-screens.e2e` no longer match the current mocked data sources and selectors, so they remain harness debt rather than confirmed product bugs. `REG-0008` and `REG-0009` were revalidated, including a focused failing command-ack regression assertion, and no new in-scope `blocker` or `critical` defect was confirmed in this phase. |
| `2026-04-15` | `RG-7` | `executed-with-open-defects` | Backend Phase 4 route coverage passed on an isolated scratch database for notifications, notification unread sync, conversations, chat REST and realtime behavior, schedule and report summaries, audit-log PDF export, observability, metrics, and security-event ingestion after correcting local regression-environment schema drift that did not reflect current code contracts. `src/routes/reports-export.test.ts` still contains a stale proof-of-play fixture that omits the now-required `idempotency_key`, so its remaining failure was treated as harness debt rather than a confirmed product defect. Focused backend regression coverage was added for API keys, webhooks, and SSO config lifecycle in `src/routes/admin-ops-contracts.test.ts`. `REG-0003`, `REG-0004`, `REG-0005`, and `REG-0007` were revalidated, and `REG-0011` was created because the authenticated CMS `/requests` route currently renders `null` even though the backend request workflow remains live. Deploy-readiness scripts for server packaging, CMS packaging, and QA runtime-bundle assembly were verified as runnable via their checked-in help paths, but full artifact-driven QA execution remains environment-partial until release artifacts and QA hosts are available. |
| `2026-04-15` | `Integrated Sweep` | `executed-with-open-defects` | Integrated workflow regression for `INT-001` through `INT-009` passed on targeted backend and player surfaces for pairing and recovery, publish activation, refresh fanout, screenshot persistence, heartbeat state reflection, proof-of-play ingest and replay, offline queue recovery, and no-content versus default-media fallback. The targeted player workflow suite finished `87` passing with `1` failing assertion that revalidated `REG-0009`, and isolated backend reruns for `schedules.publish.test.ts` and `schedule-reservations.test.ts` passed once they were cloned from the aligned scratch database instead of replaying the drifted raw migration chain. CMS return-path validation stayed partial: `screens.e2e.spec.ts` still misses the current `/api/v1/screens?include_summary=true&include_media=true` list contract in its mocks, and `settings-default-media.e2e.spec.ts` still expects the default-media panel to be visible without selecting the `Default Media` settings tab, so both remain harness debt rather than confirmed product defects. No new integrated regression defect was confirmed; the open integrated mismatches remain `REG-0008` and `REG-0009`. |

## Data / Seed Needs

- Backend bootstrap data from `signhex-server/scripts/seed.ts`.
- Admin and non-admin user accounts that exercise role/permission boundaries.
- Department hierarchy and screen ownership assignments.
- Sample media files that cover image, video, document, and default-media fallback cases.
- Layouts, presentations, schedules, publishes, and schedule reservations that exercise queue and availability logic.
- Emergency types and at least one active/clear cycle scenario.
- Paired screen/device fixture with valid certificate and pairing history.
- Chat/conversation sample data including attachments, threads, pins, and bookmarks.
- API key, webhook, and SSO configuration data for security/ops surface validation.
- Player fixtures from `signage-screen/test/fixtures/device-state.json` and `signage-screen/test/fixtures/test-config.json`.
- Observability inputs for Prometheus/Grafana-backed checks referenced by `signhex-platform/deploy/shared/observability`.

## Entry / Exit Criteria

### Global Entry Criteria

- The target branch or workspace state is known and the repos needed for the phase are available locally.
- The environment for the current phase is bootable with the required secrets/config placeholders resolved.
- The feature inventory section for the phase exists and has starter rows linked to code evidence.

### Per-Phase Exit Criteria

| Phase | Exit Criteria |
| --- | --- |
| `Phase 1` | Inventory complete for access/admin capabilities, baseline smoke paths pass, and no open `blocker` or `critical` defects remain against `PH1-*`. |
| `Phase 2` | Content and scheduling flows are inventoried and executable, publish/emergency/default-media cases are covered, and no open `blocker` defects remain against `PH2-*`. |
| `Phase 3` | Pairing, telemetry, playback, screenshot, command, and proof-of-play coverage is complete across backend and player, and no open `blocker` defects remain against `PH3-*`. |
| `Phase 4` | Communications, reporting, observability, and deployment verification surfaces are inventoried with executable checks, and no open `blocker` defects remain against `PH4-*`. |
| `Phase 5` | Only logged regression fixes and revalidation remain, every accepted fix maps to an existing tracker row, and all completed fixes are moved to `verified`. |

## Gates For Moving To The Next Phase

- Gate to `Phase 2`: `Phase 1` inventory rows are materially complete, login/RBAC/user baseline is stable enough to support broader CMS and API execution, and outstanding access/admin defects do not invalidate later results.
- Gate to `Phase 3`: `Phase 2` scheduling and publishing paths are stable enough that runtime validation can trust authored content and publish state.
- Gate to `Phase 4`: `Phase 3` pairing/runtime flows are stable enough that communications, reporting, and observability findings are not dominated by device bootstrap noise.
- Gate to `Phase 5`: Defect discovery is substantially complete for Phases 1 through 4, and remaining work is fix-and-retest rather than net-new coverage expansion.

## Repo Map

| Area | Paths | Why It Matters |
| --- | --- | --- |
| `cms` | `signhex-nexus-core/src/App.tsx`; `signhex-nexus-core/src/pages`; `signhex-nexus-core/src/components`; `signhex-nexus-core/tests` | Defines user-facing routes, page boundaries, navigation modules, and current UI/e2e coverage. |
| `backend` | `signhex-server/src/server/index.ts`; `signhex-server/src/routes`; `signhex-server/src/services`; `signhex-server/src/config/apiEndpoints.ts` | Defines the authoritative API surface, route registration, and backend service seams. |
| `player` | `signage-screen/src/main/index.ts`; `signage-screen/src/main/services`; `signage-screen/test` | Defines pairing, playback, telemetry, offline behavior, and player regression surfaces. |
| `db` | `signhex-server/src/db/schema.ts`; `signhex-server/src/db/repositories`; `signhex-server/drizzle` | Canonical schema and persistence anchors for evidence and data validation. |
| `tests` | `signhex-server/vitest.config.ts`; `signhex-nexus-core/vitest.config.ts`; `signhex-nexus-core/playwright.config.ts`; `signage-screen/.mocharc.json` | Test harness entrypoints that shape how regression is executed and reported. |
| `deploy` | `signhex-platform/manifests/qa`; `signhex-platform/manifests/production`; `signhex-platform/deploy`; `signhex-server/docker-compose.yml`; `signhex-server/docker-compose.dev.yml` | Defines environment topology, promotion inputs, and local verification paths. |

## Next-Phase Inputs

1. Backend route handlers and route tests in `signhex-server/src/routes`, starting with auth/user/settings and then scheduling/runtime paths.
2. CMS pages, shared components, and Playwright specs in `signhex-nexus-core/src` and `signhex-nexus-core/tests`, with emphasis on gaps where backend capability exists but UI trace is still shallow.
3. Player services and test suites in `signage-screen/src/main/services` and `signage-screen/test`, especially command handling, offline replay, screenshot capture, and telemetry loops.
4. Deployment manifests, bundle scripts, and environment runbooks in `signhex-platform/manifests`, `signhex-platform/deploy`, and `signhex-platform/docs/runbooks`.
