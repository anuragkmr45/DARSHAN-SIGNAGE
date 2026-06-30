# Phase 6 Handoff: Failure Observability And Media/Cache Status

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/darshan`
Branch: `release-01`
Approval state: `APPROVED_WITH_CONDITIONS`

## Summary

Phase 6 added REST-based media/cache failure reporting and per-screen CMS visibility. The player reports cache/download failures using REST and queues failed report sends through the existing request queue. The backend stores report metadata durably, and the CMS Delivery tab shows recent media/cache failures.

No WebSocket semantics, Electron realtime/adaptive polling, mobile adapters, or deployment hardening were changed.

## Implemented Scope

- Added additive `media_cache_reports` table and indexes.
- Added device endpoint `POST /api/v1/device/:deviceId/media-cache-report`.
- Added CMS endpoint `GET /api/v1/screens/:id/media-cache-reports/recent`.
- Added backend flag `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED`.
- Added Electron `media-cache-reporter.ts`.
- Wired cache manager, snapshot prefetch, and default media cache hydration failure paths.
- Sanitized media URLs to host plus path hash; full signed URLs are not stored.
- Added player flag `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED`.
- Added CMS media/cache failure list to the Delivery tab behind `VITE_MEDIA_CACHE_STATUS_UI`.

## Out Of Scope

- Phase 7 QA/prod deployment hardening.
- WebSocket changes.
- Electron RealtimeService/adaptive polling changes.
- Mobile/TV work.
- Large log/screenshot result visibility.
- Production dashboards/alerts.
- Retention/partitioning automation.

## Files Changed

- `darshan-server/drizzle/migrations/0032_media_cache_failure_reporting.sql`
- `darshan-server/src/db/schema.ts`
- `darshan-server/src/services/media-cache-report-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/screens.ts`
- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.example`
- `darshan-server/src/routes/device-telemetry-media-cache-report.test.ts`
- `darshan-player/src/main/services/media-cache-reporter.ts`
- `darshan-player/src/main/services/cache/cache-manager.ts`
- `darshan-player/src/main/services/settings/default-media-service.ts`
- `darshan-player/src/main/services/snapshot-manager.ts`
- `darshan-player/src/common/config.ts`
- `darshan-player/src/common/types.ts`
- `darshan-player/test/unit/services/media-cache-reporter.test.ts`
- `darshan-player/test/unit/services/cache-manager.test.ts`
- `darshan-player/test/unit/services/default-media-service.test.ts`
- `darshan-cms/src/api/endpoints.ts`
- `darshan-cms/src/api/queryKeys.ts`
- `darshan-cms/src/api/types.ts`
- `darshan-cms/src/api/domains/screens.ts`
- `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-task-register.md`
- `docs/implementation/realtime-sync-phase-approval-log.md`
- `docs/implementation/realtime-sync-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/architecture/player-contract.md`
- `docs/architecture/failure-modes.md`
- `docs/architecture/enterprise-realtime-sync.md`

## Tests Run

| Command | Result | Notes |
|---|---|---|
| `cd darshan-server && npm run build` | Passed | TypeScript build completed under Node `v24.12.0`. |
| `cd darshan-server && DRIZZLE_STRICT=false npm run db:push` | Passed after escalation | Applied local test schema; production must use reviewed migration. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` | Passed, 1 test | Covers device ingest and CMS read endpoint. |
| `cd darshan-server && npx vitest run src/routes/device-telemetry-commands.test.ts src/routes/device-telemetry-media-cache-report.test.ts` | Passed, 14 tests | Confirms command route remains compatible. |
| `cd darshan-player && npm run build` | Passed | Main and renderer build completed. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts --spec test/unit/services/cache-manager.test.ts --spec test/unit/services/default-media-service.test.ts` | Passed, 18 tests | Covers reporting, queue fallback, cache behavior, and default media caching. |
| `cd darshan-cms && npm run build` | Passed | Vite build completed with existing chunk/browser-data warnings. |
| `cd darshan-cms && npm run lint` | Failed outside Phase 6 changed files | Existing lint issues remain in unrelated files. |

## Architecture Compliance

- WebSocket remains notification-only.
- REST remains authoritative.
- Media and snapshots are not sent through WebSocket.
- Full media URLs and signed query strings are not stored in failure reports.
- Polling and heartbeat fallback remain unchanged.
- Phase 6 is rollback-safe through feature flags.

## Risks

- `media_cache_reports` needs retention/partitioning before production.
- Media/cache failure metrics and alerts are not complete.
- CMS visual/E2E review has not been run.
- CMS lint still fails from pre-existing issues outside Phase 6 changed paths.
- Node 20 rerun is required before QA signoff.

## Rollback

- Backend: set `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false`.
- Player: set `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false`.
- CMS: set `VITE_MEDIA_CACHE_STATUS_UI=false`.
- Leave `0032_media_cache_failure_reporting.sql` in place if applied.
- Existing REST polling, heartbeat, snapshot, default media, emergency, command ACK, and WebSocket notification behavior remain active.

## Recommendation

Phase 6 is conditionally approved. Stop at the Phase 7 gate until the user accepts Phase 6 conditions and explicitly asks for QA/prod deployment hardening.
