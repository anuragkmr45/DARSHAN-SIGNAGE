# Ghost Pairing GP-3 Handoff: CMS Orphan/Revoke/Reclaim Visibility

## Summary

GP-3 exposes backend ghost-pairing diagnostics in CMS and adds an admin revoke action. Operators can now see orphan device certificates, orphan pairing records, orphan heartbeats, and orphan commands from the Screens page. Reclaim is intentionally shown as unavailable because safe reclaim requires a future fresh-pairing workflow.

## Scope Implemented

- CMS Pairing Health panel on the Screens page for admin-like users.
- Safe backend identity labels in Pairing Health: environment, deployment id, server id.
- Orphan counts and bounded row samples with reason codes.
- Admin revoke confirmation and API call from CMS for both visible screen cards and orphan diagnostic rows.
- Backend `POST /api/v1/device-pairing/:deviceId/revoke`.
- Orphan API response reason codes and `server_identity`.
- Player old-backend missing pairing-status regression test.

## Out of Scope

- Installer or package uninstall app-data wipe.
- Blind reclaim or reassignment of copied local identity.
- Clone/duplicate identity detection.
- Mobile/TV support.
- Realtime architecture changes.
- Full reinstall/delete/orphan/clone E2E matrix.

## Files Changed

- `darshan-server/src/config/apiEndpoints.ts`
- `darshan-server/src/routes/device-pairing.ts`
- `darshan-server/src/routes/device-pairing.test.ts`
- `darshan-server/src/services/device-pairing-orphan-service.ts`
- `darshan-cms/src/api/domains/devicePairing.ts`
- `darshan-cms/src/api/endpoints.ts`
- `darshan-cms/src/api/queryKeys.ts`
- `darshan-cms/src/api/types.ts`
- `darshan-cms/src/components/screens/PairingHealthPanel.tsx`
- `darshan-cms/src/pages/Screens.tsx`
- `darshan-player/test/unit/services/player-flow.test.ts`
- `docs/architecture/player-pairing-identity.md`
- `docs/implementation/ghost-pairing-production-hardening.md`
- `docs/implementation/ghost-pairing-task-register.md`
- `docs/implementation/ghost-pairing-decision-log.md`
- `docs/implementation/ghost-pairing-test-plan.md`
- `docs/implementation/ghost-pairing-phase-gp1-handoff.md`
- `docs/implementation/ghost-pairing-phase-gp2-handoff.md`
- `docs/implementation/ghost-pairing-phase-gp3-handoff.md`
- `docs/implementation/realtime-sync-open-risks.md`

## APIs Added/Changed

### `GET /api/v1/device-pairing/orphans`

Changed to include:

- `server_identity`
- per-row reason codes:
  - `ORPHANED_CERTIFICATE`
  - `ORPHANED_PAIRING`
  - `ORPHANED_HEARTBEAT`
  - `ORPHANED_COMMAND`

The response remains bounded and excludes certificate PEM, private keys, raw tokens, signed URLs, and full certificate serials.

### `POST /api/v1/device-pairing/:deviceId/revoke`

Admin-only endpoint. Requires `manage DevicePairing`, `delete Screen`, or `manage all`.

Request:

```json
{
  "reason": "admin_revoked_stale_pairing",
  "note": "optional admin note"
}
```

Behavior:

- Marks active device certificate rows revoked.
- Retires open pairing records for the device id.
- Does not delete the screen.
- Writes an audit log event.
- Returns safe counts and server identity labels.

## Env Vars Added/Changed

None in GP-3.

## Tests Run

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/routes/device-pairing.test.ts`
- `cd darshan-server && npx vitest run src/routes/device-telemetry-auth.test.ts`
- `cd darshan-server && npx vitest run src/routes/device-pairing-recovery.test.ts`
- `cd darshan-server && npx vitest run src/routes/screens.test.ts`
- `cd darshan-cms && npm run build`
- `cd darshan-cms && npm run lint`
- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`

## Test Results

Passed:

- Backend build.
- Device pairing route tests, including orphan report safety and revoke behavior.
- Device telemetry auth/pairing-status tests.
- Device pairing recovery tests.
- CMS build.
- CMS lint.
- Player build.
- Player flow tests, including old-backend missing pairing-status endpoint regression.

## Failed Tests

- `cd darshan-server && npx vitest run src/routes/screens.test.ts` still fails one known reporting assertion:
  - `src/routes/screens.test.ts:1066`
  - expected `metricsBody.schedules.active_screens_now >= 1`, got `0`

This is tracked as reporting-surface debt and is not introduced by GP-3.

## Blocked Tests

- No DB/runtime tests were blocked in this GP-3 pass.
- Browser/E2E verification of the new CMS Pairing Health panel was not run.
- On-prem QA validation with a real orphaned/revoked player was not run.

## Known Risks

- Reclaim is disabled and deferred; GP-3 does not implement admin-approved reclaim.
- No installer wipe or clean reinstall runbook yet.
- Clone/copy app-data duplicate identity detection remains open.
- No full E2E reinstall/delete/orphan/clone matrix yet.
- `screens.test.ts` reporting assertion remains failing.
- Full suite/load/runtime evidence is still required before production readiness.

## Rollback Plan

Revert the GP-3 backend route/API additions, CMS Pairing Health panel/API wiring, player old-backend regression test, and GP-3 docs. Reverting removes CMS orphan visibility and revoke, but it does not change existing pairing, heartbeat, snapshot, schedule, default media, emergency, or polling fallback flows.

## QA Checklist

- Open Screens page as an admin user and confirm Pairing Health is visible.
- Confirm server identity labels match the expected backend environment.
- Seed or create orphan certificate/pairing/heartbeat/command rows and confirm they appear without PEM/private keys/tokens/full serials.
- Revoke a stale pairing from a screen card and an orphan diagnostic row; confirm the screen is not deleted.
- Confirm the player receives pairing revoked/invalid on next validation and returns to pairing required.
- Confirm Reclaim is disabled and cannot attach an old local identity.

## Production Checklist

- Deploy backend before CMS/player changes.
- Set unique server identity labels for each on-prem environment.
- Validate revoke and orphan visibility against QA devices.
- Keep reset-pairing operator command documented until GP-4 runbook lands.
- Do not approve production until GP-4, GP-5, GP-6, and runtime QA evidence are complete or explicitly deferred by product/security.

## Next Phase Readiness

GP-4 can start after independent verification of GP-3, with the condition that production readiness remains blocked.

## Recommendation

APPROVE_WITH_CONDITIONS
