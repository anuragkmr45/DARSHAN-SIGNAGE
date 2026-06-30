# Ghost Pairing GP-6 Handoff: E2E / Permutation Matrix

## Summary

GP-6 creates the full ghost-pairing E2E/permutation evidence matrix and adds one missing CMS API-domain test for Pairing Health orphan/revoke wiring. The high-value backend and player lifecycle paths are automated through targeted route/unit suites. Browser and packaged on-prem runtime evidence are explicitly marked as not run.

This is not production approval.

## Scope Implemented

- Created `docs/implementation/ghost-pairing-e2e-matrix.md`.
- Created `docs/runbooks/ghost-pairing-onprem-qa-checklist.md`.
- Added CMS API-domain unit coverage for Pairing Health orphan report and revoke endpoint wiring.
- Re-ran targeted backend, player, and CMS build/test commands.
- Re-ran `screens.test.ts`; the previously known `active_screens_now` reporting failure is now fixed and passing.
- Updated ghost-pairing status docs and open-risk tracking for GP-6.
- Recorded the 2026-06-16 on-prem runtime evidence attempt as blocked by missing `ONPREM_*` inputs and unavailable Node 20 runtime.

## Out of Scope

- Browser Pairing Health visual QA.
- Packaged Ubuntu player runtime QA.
- Two-player cloned app-data smoke against a real backend.
- Production readiness signoff.
- Mobile/TV work.
- Realtime architecture changes.
- Duplicate identity block-mode rollout.

## Files Changed

- `darshan-cms/src/api/domains/devicePairing.test.ts`
- `docs/implementation/ghost-pairing-e2e-matrix.md`
- `docs/implementation/ghost-pairing-phase-gp6-handoff.md`
- `docs/runbooks/ghost-pairing-onprem-qa-checklist.md`
- `docs/architecture/player-pairing-identity.md`
- `docs/implementation/ghost-pairing-production-hardening.md`
- `docs/implementation/ghost-pairing-task-register.md`
- `docs/implementation/ghost-pairing-decision-log.md`
- `docs/implementation/ghost-pairing-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `darshan-server/src/routes/metrics.ts` (post-GP-6 reporting reliability fix)
- `docs/implementation/ghost-pairing-onprem-qa-evidence.md`
- `docs/implementation/ghost-pairing-production-readiness-review.md`

## APIs Added/Changed

None.

## Env Vars Added/Changed

None.

## Tests Run

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/routes/device-telemetry-auth.test.ts`
- `cd darshan-server && npx vitest run src/routes/device-pairing.test.ts`
- `cd darshan-server && npx vitest run src/routes/device-pairing-recovery.test.ts`
- `cd darshan-server && npx vitest run src/routes/screens.test.ts`
- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts`
- `cd darshan-cms && npm run build`
- `cd darshan-cms && npm run lint`
- `cd darshan-cms && npx vitest run src/api/domains/devicePairing.test.ts`
- `node --input-type=module -e "<on-prem input presence check>"`
- `node --version` via the same input presence check (`v24.12.0`)

## Test Results

Passed:

- Backend build.
- Device telemetry auth route tests.
- Device pairing route tests.
- Device pairing recovery tests.
- Player build.
- Player flow tests.
- Player CLI parser tests.
- Player operator reset tooling tests.
- Player heartbeat tests.
- CMS build.
- CMS lint.
- CMS device pairing API-domain tests.
- Screen route/reporting tests.

Failed:

- None in the targeted local commands recorded for this reporting update.

## Blocked Tests

None of the targeted local commands were blocked.

Not run:

- Browser Pairing Health visual QA.
- Packaged Ubuntu player clean reinstall/reset smoke.
- Two-player copied app-data duplicate identity runtime smoke.
- On-prem environment mismatch smoke.
- Runtime log/snapshot no-secret review.
- Node 20 build/test validation.

Blocked:

- Browser/on-prem runtime evidence is blocked by missing `ONPREM_QA_BACKEND_BASE_URL`, `ONPREM_QA_CMS_BASE_URL`, `ONPREM_QA_SOCKET_IO_URL`, `ONPREM_POSTGRES_URL`, `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH`, `ONPREM_MEDIA_ENDPOINT`, `ONPREM_VALKEY_URL`, and `ONPREM_PROMETHEUS_URL`.
- Supported Node validation is blocked because the available runtime is `v24.12.0`; target is `>=20 <21`.

## Known Risks

- GP-specific automated evidence is broad, but it is still not a substitute for packaged runtime QA.
- CMS Pairing Health browser behavior is only build/lint/API-wiring validated.
- Duplicate identity detection remains warning-mode and lease-based; non-concurrent clones are only detectable when multiple copies connect within the lease window.
- Browser/on-prem runtime evidence remains open.
- Production readiness review remains `NOT_PRODUCTION_READY`.

## Rollback Plan

Revert the GP-6 docs, CMS domain test file, and the `darshan-server/src/routes/metrics.ts` reporting fix if this update must be backed out. No schema, env, player behavior, or CMS production behavior changes are introduced by GP-6 itself.

## QA Checklist

- Run the browser Pairing Health checklist in `docs/runbooks/ghost-pairing-onprem-qa-checklist.md`.
- Run packaged player pairing-status, reset dry-run, reset, pair, revoke, and re-pair smoke.
- Run copied app-data two-player smoke until a duplicate identity warning appears in CMS.
- Verify backend-first rollout with a player against a backend that has pairing-status.
- Confirm `DUPLICATE_IDENTITY_ENFORCEMENT=warn`.

## Production Checklist

- Keep `screens.test.ts` passing for the `active_screens_now` reporting regression.
- Complete browser Pairing Health QA.
- Complete packaged on-prem player smoke.
- Complete two-player copied app-data smoke.
- Run Node 20 build/test verification.
- Attach runtime no-secret review artifacts.
- Keep production readiness state blocked until runtime evidence is attached.

## Next Phase Readiness

Production readiness review can start only as a conditional review. It must not approve production until browser/on-prem/runtime evidence is completed.

## Recommendation

APPROVE_GP6_WITH_CONDITIONS
