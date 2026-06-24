# Ghost Pairing GP-5 Handoff: Clone / Duplicate Identity Detection

## Summary

GP-5 adds warning-mode duplicate player identity detection for copied app-data and cloned paired images. The player sends safe install/runtime session metadata, the backend tracks active session leases per device id, and CMS Pairing Health exposes duplicate identity conflicts with redacted evidence and revoke/reset guidance.

This is not production approval. GP-6 E2E coverage and on-prem two-player runtime evidence remain required.

## Scope Implemented

- Persistent player install instance id in local device state.
- Per-launch runtime session id.
- Pairing-status and heartbeat session metadata headers/payload fields.
- Backend duplicate identity session service using active leases in `screens.device_info.identity_sessions`.
- Warning-mode duplicate conflict detection after restart grace.
- Pairing-status `duplicateIdentity` summary in warn mode without breaking valid playback.
- Heartbeat duplicate conflict summary without removing polling/heartbeat fallback.
- Pairing Health duplicate conflict counts and bounded samples.
- CMS duplicate conflict cards with redacted install/runtime suffixes and hashed machine/IP/user-agent evidence.
- Existing revoke action reused for duplicate conflict remediation.
- Reclaim remains disabled.
- GP-5 docs, runbooks, and risk register updates.

## Out of Scope

- Full GP-6 reinstall/delete/orphan/clone E2E matrix.
- Automatic app-data wipe.
- Automatic duplicate auto-revoke.
- Production block enforcement rollout.
- Safe admin-approved reclaim implementation.
- Mobile/TV support.
- Realtime architecture changes.

## Files Changed

- `darshan-server/src/services/device-identity-session-service.ts`
- `darshan-server/src/services/device-pairing-orphan-service.ts`
- `darshan-server/src/routes/device-telemetry.ts`
- `darshan-server/src/routes/device-telemetry-auth.test.ts`
- `darshan-server/src/routes/device-pairing.test.ts`
- `darshan-server/src/config/index.ts`
- `darshan-server/.env.example`
- `darshan-server/.env.example`
- `darshan-player/src/common/types.ts`
- `darshan-player/src/main/services/device-state-store.ts`
- `darshan-player/src/main/services/pairing-service.ts`
- `darshan-player/src/main/services/telemetry/heartbeat.ts`
- `darshan-player/src/main/services/operator-tools.ts`
- `darshan-player/test/unit/services/player-flow.test.ts`
- `darshan-player/test/unit/services/heartbeat.test.ts`
- `darshan-player/test/unit/main/operator-tools.test.ts`
- `darshan-cms/src/api/types.ts`
- `darshan-cms/src/components/screens/PairingHealthPanel.tsx`
- `docs/architecture/player-pairing-identity.md`
- `docs/implementation/ghost-pairing-production-hardening.md`
- `docs/implementation/ghost-pairing-task-register.md`
- `docs/implementation/ghost-pairing-decision-log.md`
- `docs/implementation/ghost-pairing-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/runbooks/player-clean-reinstall-reset.md`
- `docs/runbooks/onprem-player-ghost-pairing-recovery.md`
- `docs/implementation/ghost-pairing-phase-gp5-handoff.md`

## Migrations

None. GP-5 stores bounded duplicate identity session state in existing `screens.device_info` JSON.

## APIs Added/Changed

- `GET /api/v1/device/:deviceId/pairing-status` now accepts optional safe session headers and can include `duplicateIdentity`.
- `POST /api/v1/device/heartbeat` accepts optional install/runtime session metadata and can return `duplicate_identity`.
- `GET /api/v1/device-pairing/orphans` now includes `counts.duplicate_identity_conflicts` and `duplicate_identity.conflicts`.

No new CMS admin action is required; existing revoke is reused.

## Env Vars Added/Changed

- `DUPLICATE_IDENTITY_DETECTION_ENABLED=true`
- `DUPLICATE_IDENTITY_ENFORCEMENT=warn`
- `DEVICE_SESSION_LEASE_MS=300000`
- `DEVICE_SESSION_RESTART_GRACE_MS=120000`

`warn` is the default. `block` mode exists for explicit future rollout only and must not be enabled without production approval.

## Tests Run

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/routes/device-telemetry-auth.test.ts`
- `cd darshan-server && npx vitest run src/routes/device-pairing.test.ts`
- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts`
- `cd darshan-cms && npm run build`
- `cd darshan-cms && npm run lint`

## Test Results

Passed:

- Server build.
- Device telemetry auth tests, including duplicate session detection, false-positive quick restart protection, pairing-status warn mode, and redaction.
- Device pairing tests, including Pairing Health duplicate conflict report redaction.
- Player build.
- Player flow tests, including warn-mode duplicate identity preservation and old-backend rollout safety.
- CLI parser tests.
- Operator tooling tests, including redacted session diagnostics and reset clearing install instance metadata.
- Heartbeat tests, including install/runtime session metadata payload.
- CMS build and lint.

## Failed Tests

None in the GP-5 targeted tests listed above.

Known separate failure remains:

- `darshan-server/src/routes/screens.test.ts` reporting assertion for `active_screens_now`.

## Blocked Tests

- No GP-5 targeted tests were blocked.
- No browser Pairing Health visual smoke was run.
- No on-prem two-player or cloned app-data runtime smoke was run.
- Full GP-6 E2E matrix remains pending.

## Known Risks

- Non-concurrent clones may not be detected until multiple copies connect within the active lease window.
- Warning mode does not block playback or revoke automatically.
- Block mode is config-gated but not approved for production rollout.
- Session evidence is diagnostic, not legal or hardware identity proof.
- Duplicate state is stored in `screens.device_info`; very large fleet behavior needs runtime QA.

## Rollback Plan

Revert the GP-5 service, route integrations, env examples, player session metadata changes, CMS Pairing Health duplicate UI, tests, and docs. Existing GP-1 through GP-4 pairing truth, startup validation, revoke, and reset flows remain valid after rollback.

## QA Checklist

- Start one packaged player and confirm no duplicate conflict.
- Start a second copied app-data player with the same device id and different runtime session.
- Wait beyond `DEVICE_SESSION_RESTART_GRACE_MS`.
- Confirm pairing-status includes duplicate warning while remaining valid in warn mode.
- Confirm CMS Pairing Health shows the duplicate conflict.
- Revoke stale pairing in CMS.
- Run local `reset-pairing` on the reused machine.
- Pair as a new screen.
- Confirm conflict resolves after the lease expires.

## Production Checklist

- Keep `DUPLICATE_IDENTITY_ENFORCEMENT=warn` unless block mode is explicitly approved.
- Validate duplicate detection with real packaged players in on-prem QA.
- Validate CMS Pairing Health browser behavior.
- Confirm no raw certs, tokens, full serials, MAC addresses, or raw hardware identifiers are exposed.
- Complete GP-6 E2E matrix or obtain explicit risk acceptance.

## Next Phase Readiness

GP-6 can start after independent verification of GP-5. Production readiness remains blocked by GP-6 and runtime QA evidence.

## Recommendation

APPROVE_WITH_CONDITIONS
