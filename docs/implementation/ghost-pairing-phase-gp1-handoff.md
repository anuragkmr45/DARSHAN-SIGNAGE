# Ghost Pairing GP-1 Handoff: Backend Pairing Truth

## Summary

GP-1 adds backend pairing truth for Electron player identity validation. GP-1.1 completes the missing documentation and backend cleanup needed before GP-3 CMS orphan visibility starts.

## Scope Implemented

- Authenticated `GET /api/v1/device/:deviceId/pairing-status`.
- Safe server identity labels: `SIGNHEX_ENVIRONMENT_NAME`, `SIGNHEX_DEPLOYMENT_ID`, `SIGNHEX_SERVER_ID`.
- Optional environment/deployment header mismatch detection.
- Explicit status mapping for valid, no-content, invalid token, missing screen, revoked credential, orphan credential, and environment mismatch.
- Admin-only orphan detection endpoint: `GET /api/v1/device-pairing/orphans`.
- Admin-only pairing revoke endpoint: `POST /api/v1/device-pairing/:deviceId/revoke`.
- Full certificate serial redaction in pairing completion logs.

## Out Of Scope

- CMS orphan/revoke/reclaim UI.
- Installer app-data wipe.
- Admin reclaim implementation.
- Clone/duplicate identity detection.
- Full E2E reinstall/delete/orphan/clone matrix.

## APIs Added Or Changed

### `GET /api/v1/device/:deviceId/pairing-status`

Requires device authentication with user tokens disabled.

Implemented statuses:

- `VALID`
- `VALID_NO_CONTENT`
- `INVALID_TOKEN`
- `SCREEN_NOT_FOUND`
- `PAIRING_REVOKED`
- `ORPHANED_CREDENTIAL`
- `ENVIRONMENT_MISMATCH`

Deferred statuses:

- `SCREEN_DELETED`: no soft-delete screen state exists; normal delete removes credentials and maps through current missing/invalid/orphan paths.
- `RECLAIM_REQUIRED`: deferred to admin-approved reclaim workflow.
- `BACKEND_REPAIR_REQUIRED`: deferred until richer backend consistency state exists.

### `GET /api/v1/device-pairing/orphans`

Requires CMS/admin bearer auth and `read DevicePairing` permission. Returns bounded orphan counts and rows for:

- device certificates referencing missing screens
- device pairings referencing missing screens
- heartbeats referencing missing screens
- device commands referencing missing screens

The response excludes private keys, PEM, raw tokens, signed URLs, and full certificate serials.

GP-3 extends the response with reason codes and safe `server_identity` labels.

### `POST /api/v1/device-pairing/:deviceId/revoke`

Requires CMS/admin bearer auth and `manage DevicePairing`, `delete Screen`, or `manage all` permission. It revokes active device certificates and retires open pairing codes for the target device/screen id without deleting the screen. After revocation, pairing-status returns `PAIRING_REVOKED` when the screen row still exists and the revoked credential is presented.

## Env Vars Added

- `SIGNHEX_ENVIRONMENT_NAME`
- `SIGNHEX_DEPLOYMENT_ID`
- `SIGNHEX_SERVER_ID`

## Migrations

None. GP-1.1 uses existing tables and additive route/service code.

## Tests Run

- `cd darshan-server && npm run build`: passed.
- `cd darshan-server && npx vitest run src/routes/device-telemetry-auth.test.ts`: passed.
- `cd darshan-server && npx vitest run src/routes/device-pairing.test.ts`: passed.
- `cd darshan-server && npx vitest run src/routes/device-pairing-recovery.test.ts`: passed.
- `cd darshan-server && npx vitest run src/routes/screens.test.ts`: failed one known reporting assertion at `src/routes/screens.test.ts:1066`.

## Failed Tests

`src/routes/screens.test.ts` still expects `metricsBody.schedules.active_screens_now >= 1` but receives `0`. This is tracked as reporting-surface regression debt in `docs/qa/REGRESSION_MASTER_PLAN.md`; isolated run shows all other screens route tests pass.

## Rollout Safety

Backend pairing-status must be deployed before GP-2 player validation is enabled. If the player is deployed before the backend supports the endpoint, it must not clear identity solely because the endpoint is missing. Recommended rollout:

1. Deploy backend pairing-status and orphan detection.
2. Validate pairing-status with a known player identity.
3. Deploy player startup validation.
4. Monitor stale/recovery/orphan events.
5. Start GP-3 CMS visibility work.

## Known Risks

- CMS orphan/revoke/reclaim UI is not implemented yet.
- On-prem clean reinstall/reset runbook is not implemented yet.
- Clone/copy app-data duplicate identity detection is not implemented yet.
- Full E2E reinstall/delete/orphan/clone coverage is not implemented yet.
- Full backend suite/load/runtime evidence has not been run in this GP-1.1 pass.

## Rollback Plan

Revert the GP-1.1 route/service/test/docs changes. Existing pairing, heartbeat, snapshot, commands, and default-media flows use the same device auth path and should continue to operate without the orphan endpoint.

## Recommendation

APPROVE_WITH_CONDITIONS. GP-3 CMS orphan/revoke/reclaim visibility can start, but production approval remains blocked on GP-3 through GP-6, backend-first rollout, and runtime evidence.
