# Ghost Pairing On-Prem QA Checklist

Status: GP-6 manual/browser/runtime checklist recorded on 2026-06-16.

Use this checklist for actual on-prem QA. Do not mark any row passed unless it was run against a real backend/CMS/player target.

## Preconditions

- Backend is deployed before the player build that requires pairing-status validation.
- `DUPLICATE_IDENTITY_ENFORCEMENT=warn`.
- CMS can reach the same backend that players use.
- Test operators have admin permission for Screens and Device Pairing.
- Player machine has the packaged app installed.
- Record backend environment, deployment id, server id, CMS URL, backend URL, and player hostname.

## Browser Pairing Health QA

1. Open CMS Screens.
2. Confirm Pairing Health panel is visible for an admin.
3. Confirm backend environment/deployment/server identity is visible.
4. Confirm no cert PEM, private key, raw token, signed URL, full serial, raw MAC address, or raw hardware id is rendered.
5. Seed or create an orphan diagnostic state in QA only.
6. Refresh Pairing Health.
7. Confirm orphan counts and rows are visible with reason code and safe suffixes/counts only.
8. Confirm Reclaim is disabled or informational.
9. Revoke a stale/orphaned pairing from the UI.
10. Confirm the screen is not deleted by revoke.

## Packaged Player Clean Reinstall QA

1. Pair the player to the backend.
2. Confirm CMS Screens shows the screen.
3. Confirm player reaches paired runtime only after backend validation.
4. Stop the player.
5. Simulate reinstall by uninstalling/reinstalling without wiping app data.
6. Start the player.
7. Confirm it validates backend status before paired/no-content UI.
8. Revoke pairing in CMS.
9. Restart the player.
10. Confirm player enters pairing-required/recovery state.
11. Stop the player.
12. Run:

```bash
darshan-player --pairing-status
darshan-player reset-pairing --dry-run
darshan-player reset-pairing --reason=onprem_gp6_clean_reinstall
```

13. Start the player.
14. Pair as a new screen.
15. Confirm CMS shows the new/expected screen.
16. Confirm request queue and proof-of-play spool were not silently deleted.

## Environment Mismatch QA

1. Configure a player with a known wrong backend environment/deployment header or wrong backend URL in QA.
2. Start the player.
3. Confirm backend pairing-status returns `ENVIRONMENT_MISMATCH`.
4. Confirm player does not show paired/no-content.
5. Correct the player backend configuration.
6. Restart and verify normal validation.

## Duplicate Identity QA

1. Pair one packaged player and confirm healthy state.
2. Stop it and copy its app-data/runtime identity to a second QA player machine or isolated runtime directory.
3. Start both players against the same backend.
4. Wait longer than `DEVICE_SESSION_RESTART_GRACE_MS`.
5. Confirm pairing-status remains valid in warn mode and includes duplicate warning metadata.
6. Confirm CMS Pairing Health shows one duplicate identity conflict.
7. Confirm evidence is limited to install/runtime suffixes, hashed machine/IP/user-agent signals, player version, source, and timestamps.
8. Stop the stale/copied player.
9. Revoke pairing in CMS if the identity is no longer trusted.
10. Run local reset-pairing on the copied machine.
11. Pair it as a new screen.
12. Confirm the duplicate conflict resolves after the session lease expires.

## Old Backend Rollout QA

1. In a safe QA environment only, run a player build against an older backend without `/api/v1/device/:deviceId/pairing-status`.
2. Confirm the player does not wipe local cert/config solely because the endpoint is missing.
3. Confirm it enters validation-required/recovery state.
4. Restore backend-first deployment order before production rollout.

## Evidence To Attach

- Test date, operator, backend commit, player artifact version, CMS build version.
- Screenshots of CMS Pairing Health before/after orphan and duplicate tests.
- Redacted player `--pairing-status` output.
- Revoke action audit/log reference.
- Player logs showing recovery after revoke, without secrets.
- Confirmation that proof-of-play/request queue data was preserved.

## Stop Conditions

Stop the QA run and escalate if:

- CMS renders a PEM, private key, raw token, signed URL, full cert serial, raw MAC address, or raw hardware id.
- `reset-pairing` deletes request queue/proof-of-play spool without explicit approval.
- Old-backend endpoint 404 wipes credentials.
- A player shows paired/no-content before backend validation.
- Duplicate identity block mode is enabled unexpectedly.
