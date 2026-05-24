# Phase 6 Handoff: Failure Observability And Media/Cache Status

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/signhex`
Branch: `release-01`
Approval state: `APPROVED_WITH_CONDITIONS`

## Summary

Phase 6 added REST-based media/cache failure reporting and per-screen CMS visibility. The player reports cache/download failures using REST and queues failed report sends through the existing request queue. The backend stores report metadata durably, and the CMS Delivery tab shows recent media/cache failures.

No WebSocket semantics, Electron realtime/adaptive polling, mobile adapters, or deployment hardening were changed.

## Implemented Scope

- Added additive `media_cache_reports` table and indexes.
- Added device endpoint `POST /api/v1/device/:deviceId/media-cache-report`.
- Added CMS endpoint `GET /api/v1/screens/:id/media-cache-reports/recent`.
- Added backend flag `MEDIA_CACHE_REPORTING_ENABLED`.
- Added Electron `media-cache-reporter.ts`.
- Wired cache manager, snapshot prefetch, and default media cache hydration failure paths.
- Sanitized media URLs to host plus path hash; full signed URLs are not stored.
- Added player flag `HEXMON_MEDIA_CACHE_REPORTING_ENABLED`.
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

- `signhex-server/drizzle/migrations/0032_media_cache_failure_reporting.sql`
- `signhex-server/src/db/schema.ts`
- `signhex-server/src/services/media-cache-report-service.ts`
- `signhex-server/src/routes/device-telemetry.ts`
- `signhex-server/src/routes/screens.ts`
- `signhex-server/src/config/apiEndpoints.ts`
- `signhex-server/src/config/index.ts`
- `signhex-server/.env.example`
- `signhex-server/.env.qa.example`
- `signhex-server/src/routes/device-telemetry-media-cache-report.test.ts`
- `signage-screen/src/main/services/media-cache-reporter.ts`
- `signage-screen/src/main/services/cache/cache-manager.ts`
- `signage-screen/src/main/services/settings/default-media-service.ts`
- `signage-screen/src/main/services/snapshot-manager.ts`
- `signage-screen/src/common/config.ts`
- `signage-screen/src/common/types.ts`
- `signage-screen/test/unit/services/media-cache-reporter.test.ts`
- `signage-screen/test/unit/services/cache-manager.test.ts`
- `signage-screen/test/unit/services/default-media-service.test.ts`
- `signhex-nexus-core/src/api/endpoints.ts`
- `signhex-nexus-core/src/api/queryKeys.ts`
- `signhex-nexus-core/src/api/types.ts`
- `signhex-nexus-core/src/api/domains/screens.ts`
- `signhex-nexus-core/src/components/screens/ScreenDetailsModal.tsx`
- `signhex-platform/docs/implementation/realtime-sync-project-status.md`
- `signhex-platform/docs/implementation/realtime-sync-task-register.md`
- `signhex-platform/docs/implementation/realtime-sync-phase-approval-log.md`
- `signhex-platform/docs/implementation/realtime-sync-test-plan.md`
- `signhex-platform/docs/implementation/realtime-sync-open-risks.md`
- `signhex-platform/docs/architecture/player-contract.md`
- `signhex-platform/docs/architecture/failure-modes.md`
- `signhex-platform/docs/architecture/enterprise-realtime-sync.md`

## Tests Run

| Command | Result | Notes |
|---|---|---|
| `cd signhex-server && npm run build` | Passed | TypeScript build completed under Node `v24.12.0`. |
| `cd signhex-server && DRIZZLE_STRICT=false npm run db:push` | Passed after escalation | Applied local test schema; production must use reviewed migration. |
| `cd signhex-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` | Passed, 1 test | Covers device ingest and CMS read endpoint. |
| `cd signhex-server && npx vitest run src/routes/device-telemetry-commands.test.ts src/routes/device-telemetry-media-cache-report.test.ts` | Passed, 14 tests | Confirms command route remains compatible. |
| `cd signage-screen && npm run build` | Passed | Main and renderer build completed. |
| `cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts --spec test/unit/services/cache-manager.test.ts --spec test/unit/services/default-media-service.test.ts` | Passed, 18 tests | Covers reporting, queue fallback, cache behavior, and default media caching. |
| `cd signhex-nexus-core && npm run build` | Passed | Vite build completed with existing chunk/browser-data warnings. |
| `cd signhex-nexus-core && npm run lint` | Failed outside Phase 6 changed files | Existing lint issues remain in unrelated files. |

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

- Backend: set `MEDIA_CACHE_REPORTING_ENABLED=false`.
- Player: set `HEXMON_MEDIA_CACHE_REPORTING_ENABLED=false`.
- CMS: set `VITE_MEDIA_CACHE_STATUS_UI=false`.
- Leave `0032_media_cache_failure_reporting.sql` in place if applied.
- Existing REST polling, heartbeat, snapshot, default media, emergency, command ACK, and WebSocket notification behavior remain active.

## Recommendation

Phase 6 is conditionally approved. Stop at the Phase 7 gate until the user accepts Phase 6 conditions and explicitly asks for QA/prod deployment hardening.
