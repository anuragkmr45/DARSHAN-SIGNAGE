# Ghost Pairing GP-2 Handoff: Electron Startup Validation

## Summary

GP-2 makes the player treat persisted local identity as untrusted until the backend confirms that the device pairing is valid and maps to a visible screen. Cached playback is restored only after backend validation succeeds, or when the backend is unreachable and the same device identity was validated recently.

## Scope Implemented

- Added authenticated backend pairing truth endpoint: `GET /api/v1/device/:deviceId/pairing-status`.
- Added safe backend identity labels: `SIGNHEX_DEPLOYMENT_ID`, `SIGNHEX_ENVIRONMENT_NAME`, `SIGNHEX_SERVER_ID`.
- Added Electron startup state `LOCAL_IDENTITY_PRESENT`.
- Added Electron offline state `OFFLINE_USING_LAST_VALID_PAIRING`.
- Added persisted pairing-validation metadata in `device-state.json`.
- Blocked paired/default/no-content rendering during boot, validation, and recovery states.
- Added operator reset command: `darshan-player reset-pairing` or `npm run reset-pairing`.
- Added old-backend safety regression: a missing pairing-status endpoint enters recovery-required and preserves identity instead of wiping credentials.

## Out of Scope

- CMS orphan-device UI.
- Installer app-data wipe.
- Admin reclaim workflow.
- Hardware-fingerprint identity authority.
- Schema migrations or destructive cleanup.

## APIs Added

### `GET /api/v1/device/:deviceId/pairing-status`

Requires existing device authentication headers/signature. Valid responses contain no secrets.

Valid statuses:

- `VALID`
- `VALID_NO_CONTENT`

Invalid/stale statuses are returned through the normal API error envelope:

- `INVALID_TOKEN`
- `SCREEN_NOT_FOUND`
- `PAIRING_REVOKED`
- `ORPHANED_CREDENTIAL`
- `ENVIRONMENT_MISMATCH`

Deferred backend statuses:

- `SCREEN_DELETED`
- `RECLAIM_REQUIRED`
- `BACKEND_REPAIR_REQUIRED`

## Env Vars Added

- `SIGNHEX_DEPLOYMENT_ID`
- `SIGNHEX_ENVIRONMENT_NAME`
- `SIGNHEX_SERVER_ID`

## QA Checklist

- Start player with no identity: fresh pairing is requested.
- Start player with valid identity: backend pairing status is called before playback.
- Start player with deleted/revoked identity: local identity-bound cache is cleared and fresh pairing is requested.
- Start player offline after recent successful validation: cached playback continues.
- Start player offline without prior validation: paired/no-content UI is not shown.
- Run `darshan-player reset-pairing` and confirm pairing identity plus identity-bound playback state are cleared.

## Production Checklist

- Set unique server identity labels for each on-prem environment.
- Confirm players and CMS point to the same backend before testing pairing.
- Confirm normal screen delete invalidates device auth.
- Confirm operators know the reset command for stale local identity recovery.
- Confirm backend pairing-status exists before player validation is enabled; missing endpoint must not wipe player identity.

## Independent Verification Notes

- GP-0/GP-1 documentation now exists under root `docs/`.
- Backend pairing-status now returns `VALID`, `VALID_NO_CONTENT`, `SCREEN_NOT_FOUND`, `PAIRING_REVOKED`, `INVALID_TOKEN`, `ORPHANED_CREDENTIAL`, and `ENVIRONMENT_MISMATCH`.
- `SCREEN_DELETED`, `RECLAIM_REQUIRED`, and `BACKEND_REPAIR_REQUIRED` are intentionally deferred because the current schema has no soft-delete screen state and no admin reclaim workflow.
- Server identity labels are reported by the backend, and optional environment/deployment headers now return `409 ENVIRONMENT_MISMATCH` when they disagree.
- Backend orphan detection is available through `GET /api/v1/device-pairing/orphans`; CMS UI remains GP-3.
- Backend-first rollout remains mandatory.

## Recommendation

APPROVE_WITH_CONDITIONS: GP-2 startup validation is implemented and GP-1.1 provides the backend/doc cleanup needed for GP-3 to start. Conditions remain: GP-3 CMS orphan/revoke/reclaim visibility, GP-4 installer/on-prem reset runbook, GP-5 clone/duplicate identity detection, GP-6 E2E reinstall/delete/orphan/clone coverage, backend-first rollout, and production runtime evidence.
