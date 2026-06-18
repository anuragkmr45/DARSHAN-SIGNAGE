# Ghost Pairing Test Plan

Status: GP-6 E2E/permutation evidence matrix recorded on 2026-06-16.

## Backend Unit And Route Tests

Required coverage:

- Pairing status returns `VALID` for an authenticated screen with content.
- Pairing status returns `VALID_NO_CONTENT` for an authenticated visible screen without assigned content.
- Pairing status returns `INVALID_TOKEN` for missing/invalid credentials.
- Pairing status returns `PAIRING_REVOKED` for revoked credentials.
- Pairing status returns `SCREEN_NOT_FOUND` when identity cannot map to a visible screen.
- Pairing status returns `ORPHANED_CREDENTIAL` when a credential row exists but the screen row is missing.
- Pairing status returns `ENVIRONMENT_MISMATCH` when optional environment/deployment headers mismatch.
- Orphan detection returns bounded results and does not expose PEM/private keys/tokens/full serials.
- Normal pairing and recovery flows remain backward compatible.

Current targeted evidence:

- `cd darshan-server && npm run build`: passed.
- `cd darshan-server && npx vitest run src/routes/device-telemetry-auth.test.ts`: passed.
- `cd darshan-server && npx vitest run src/routes/device-pairing.test.ts`: passed.
- `cd darshan-server && npx vitest run src/routes/device-pairing-recovery.test.ts`: passed.
- `cd darshan-server && npx vitest run src/routes/screens.test.ts`: failed one known reporting assertion at `src/routes/screens.test.ts:1066`.

GP-3 added backend coverage:

- Orphan API response includes reason codes and safe server identity without full serial, PEM, private keys, or tokens.
- Admin revoke endpoint marks active device certificates revoked, retires open pairing records, keeps the screen row, and causes pairing-status to return `PAIRING_REVOKED`.

GP-5 added backend coverage:

- Duplicate runtime session service records the first active session.
- Repeated heartbeat for the same runtime session is idempotent.
- Quick restart inside the restart grace does not create a conflict.
- Two mature active runtime sessions for one device create a warning-mode conflict.
- Stale sessions expire and conflicts can resolve.
- Pairing-status remains `VALID_NO_CONTENT` in warn mode while returning a redacted duplicate identity summary.
- Pairing Health/orphan API includes duplicate identity conflict counts and bounded samples without raw install/runtime ids, IPs, or hardware observations.

## Electron Tests

Required coverage:

- Startup with local identity enters `LOCAL_IDENTITY_PRESENT`.
- Backend `VALID` enters paired runtime.
- Backend `VALID_NO_CONTENT` shows no-content only after validation.
- `SCREEN_NOT_FOUND`, `PAIRING_REVOKED`, `ORPHANED_CREDENTIAL`, `INVALID_TOKEN`, and `ENVIRONMENT_MISMATCH` force recovery.
- Backend unreachable with recent validation enters `OFFLINE_USING_LAST_VALID_PAIRING`.
- Backend unreachable without prior validation does not show paired/no-content.
- Reset pairing clears identity-bound snapshot/default-media/runtime state.

Current targeted evidence from GP-2 handoff:

- `cd darshan-player && npm run build`: passed during GP-2 verification.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`: passed during GP-2 verification.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts`: passed during GP-2 verification.

Current GP-3 targeted evidence:

- `cd darshan-player && npm run build`: passed.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`: passed, including old-backend missing pairing-status endpoint regression.

Current GP-4 targeted evidence:

- `cd darshan-player && npm run build`: passed.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts --spec test/unit/main/operator-tools.test.ts`: passed.
- Reset dry-run preserves identity and cache files.
- Default reset clears identity-bound cert/snapshot/default-media state while preserving media cache and request/proof queues.
- Reset with `--clear-cache` clears media/object/quarantine/cache-index targets while preserving request/proof queues and logs.

Current GP-5 targeted evidence:

- `cd darshan-player && npm run build`: passed.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`: passed, including warn-mode duplicate identity playback.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts`: passed.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts`: passed, including redacted install/runtime session diagnostics and install instance reset.
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts`: passed, including heartbeat install/runtime session metadata.

## CMS Tests

Required coverage:

- Pairing Health panel renders orphan counts and rows from `GET /api/v1/device-pairing/orphans`.
- Pairing Health panel displays backend environment/deployment/server labels.
- Revoke confirmation from visible screen cards and orphan diagnostic rows calls `POST /api/v1/device-pairing/:deviceId/revoke`, refreshes pairing health, and does not expose secrets.
- Reclaim action remains disabled until the safe reclaim phase.

Current GP-3 targeted evidence:

- `cd darshan-cms && npm run build`: passed.
- `cd darshan-cms && npm run lint`: passed.

Current GP-5 targeted evidence:

- `cd darshan-cms && npm run build`: passed.
- `cd darshan-cms && npm run lint`: passed.
- Pairing Health rendering is build/lint checked for duplicate identity cards, revoke action reuse, disabled reclaim guidance, and redacted session evidence.

Browser/component tests are still required before production approval.

Current GP-6 targeted evidence:

- `cd darshan-cms && npx vitest run src/api/domains/devicePairing.test.ts`: added and passed, covering Pairing Health orphan report and revoke endpoint wiring.

## GP-6 E2E / Permutation Matrix

The canonical matrix is:

- `docs/implementation/ghost-pairing-e2e-matrix.md`

Automated rows cover:

- Pairing-status valid/no-content/stale status separation.
- Screen delete/revoke stale pairing behavior.
- Reinstall with preserved app-data through player startup validation tests.
- Reset dry-run/default/clear-cache behavior.
- Environment mismatch.
- Old-backend missing endpoint rollout safety.
- Orphan API redaction and counts.
- Duplicate identity warning-mode detection and redaction.
- Offline grace and never-validated identity behavior.
- CLI/API no-secret checks.

Rows still requiring browser or on-prem evidence:

- CMS Pairing Health visual rendering and revoke action smoke.
- Packaged player clean reinstall/reset/revoke/re-pair.
- Two-player copied app-data duplicate warning smoke.
- Runtime log/snapshot no-secret review.
- On-prem environment mismatch smoke.

## Production Acceptance Criteria

- No player shows paired unless backend validates visible screen/device state.
- Valid no-content remains distinct from stale or invalid pairing.
- Deleted/revoked/orphaned identity cannot fetch valid no-content.
- CMS can locate or repair orphaned device state after GP-3.
- Reinstall behavior is deterministic and documented.
- Backend-first rollout is followed.
- Clean reinstall/reset operator flow is documented and verified by targeted player tests.
- Duplicate active runtime sessions are visible in CMS Pairing Health without raw sensitive identifiers.
- GP-6 matrix rows are complete or risk-accepted with explicit human signoff.
