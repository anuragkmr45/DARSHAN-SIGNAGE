# Phase 5 Handoff: CMS Command And Delivery Status UI

Last updated: 2026-05-24
Updated by: Codex
Repo path: `/Users/anuragkumar/Desktop/signhex`
Branch: `release-01`
Approval state: `APPROVED_WITH_CONDITIONS`

## Summary

Phase 5 added per-screen command and delivery visibility for operators. The backend now exposes a read-only delivery aggregation endpoint, and the CMS screen details modal now has a feature-flagged Delivery tab.

No WebSocket, Electron realtime, mobile, media/cache failure reporting, outbox write, command claim, heartbeat, or polling behavior changed in this phase.

## Implemented Scope

- Added `GET /api/v1/screens/:id/delivery-status`.
- Aggregated command lifecycle counts, recent commands, desired-state versions, command outbox status, publish delivery summary, and emergency delivery summary.
- Added backend test coverage for the delivery status endpoint.
- Added CMS endpoint mapping, query key, response types, and API client method.
- Added a Delivery tab to `ScreenDetailsModal.tsx`.
- Added UI rollback switch: `VITE_REALTIME_DELIVERY_STATUS_UI=false`.

## Out Of Scope

- Phase 6 media/cache failure reporting.
- Fleet/group-level delivery dashboards.
- New DB migrations.
- WebSocket protocol changes.
- Electron RealtimeService/adaptive polling changes.
- Mobile/TV player work.
- Production rollout.

## Files Changed

- `signhex-server/src/config/apiEndpoints.ts`
- `signhex-server/src/routes/screens.ts`
- `signhex-server/src/routes/device-telemetry-commands.test.ts`
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
- `signhex-platform/docs/implementation/realtime-sync-phase-5-handoff.md`

## Tests Run

| Command | Result | Notes |
|---|---|---|
| `cd signhex-server && npm run build` | Passed | TypeScript build completed under Node `v24.12.0`. |
| `cd signhex-server && npx vitest run src/routes/device-telemetry-commands.test.ts` | Passed, 13 tests | Includes delivery status API aggregation coverage. |
| `cd signhex-nexus-core && npm ci` | Passed after escalation | Required npm cache/log access; reported 18 existing audit findings. |
| `cd signhex-nexus-core && npm run build` | Passed | Vite production build completed. |
| `cd signhex-nexus-core && npm run lint` | Failed outside Phase 5 changed files | Existing lint issues in `LiveScreenMirror.tsx`, `EmergencyTakeoverModal.tsx`, and `tests/settings-default-media.e2e.spec.ts`. |

## Blocked Or Deferred Tests

- Browser visual review of the new Delivery tab was not run.
- CMS E2E for publish/emergency delivery visibility was not run.
- Node 20 rerun is required before QA signoff; local Node is `v24.12.0` while server/player engines require `>=20 <21`.

## Architecture Compliance

- WebSocket remains notification-only.
- REST remains authoritative for command, desired-state, publish, emergency, and outbox visibility.
- Media and snapshots are not sent through WebSocket.
- Polling and heartbeat fallback remain unchanged.
- No new migration was added.
- UI rollback is available through `VITE_REALTIME_DELIVERY_STATUS_UI=false`.

## Risks

- Existing CMS lint failures must be resolved or waived before full QA approval.
- The Delivery tab is per-screen and does not replace a fleet/group delivery dashboard.
- Publish delivery summary is bounded by recent command rows and active snapshot matching.
- Dependency install reported existing audit findings.

## Rollback

- Set `VITE_REALTIME_DELIVERY_STATUS_UI=false` to hide the CMS tab.
- Leave `GET /api/v1/screens/:id/delivery-status` unused if needed.
- No database rollback is required.
- Existing player polling, heartbeat, realtime, command ACK, and outbox behavior are unchanged.

## Required Independent Verification

Before Phase 6 is treated as fully unblocked:

1. Review the Phase 5 backend endpoint response shape.
2. Review `ScreenDetailsModal.tsx` visually in a browser with realistic command/outbox data.
3. Rerun CMS build and targeted browser/E2E smoke.
4. Decide whether the existing CMS lint failures block Phase 6 or are tracked separately.

## Recommendation

Phase 5 is conditionally approved. Phase 6 can start only after accepting the documented conditions. QA/prod realtime enablement remains blocked until Node 20 rerun, QA proxy/runtime smoke, dedicated metrics, and CMS UI verification are complete.
