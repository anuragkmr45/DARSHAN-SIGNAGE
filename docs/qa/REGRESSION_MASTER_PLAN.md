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
