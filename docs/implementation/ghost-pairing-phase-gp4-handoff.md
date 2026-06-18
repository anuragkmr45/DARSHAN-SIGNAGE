# Ghost Pairing GP-4 Handoff: Installer / On-Prem Reset Runbook

## Summary

GP-4 makes clean player reinstall and stale-pairing recovery deterministic for on-prem operators. It adds explicit player diagnostics, reset dry-run behavior, an optional media-cache clearing flag, and runbooks for clean reinstall and ghost-pairing recovery.

This is not production approval. GP-5 clone/duplicate identity detection, GP-6 E2E coverage, and on-prem runtime QA remain required.

## Scope Implemented

- `darshan-player --pairing-status` operator diagnostic command.
- `darshan-player reset-pairing --dry-run`.
- `darshan-player reset-pairing --clear-cache`.
- Reset output lists preserved request/proof/log paths.
- Operator diagnostics redact certificate serial/fingerprint values to suffixes.
- Support bundle certificate metadata is written as redacted metadata.
- Clean reinstall runbook.
- On-prem ghost-pairing recovery runbook.
- GP status docs updated to record GP-4 policy.

## Out of Scope

- Automatic app-data wipe during normal uninstall or upgrade.
- Installer checkbox or package-manager purge workflow.
- Clone/duplicate app-data detection.
- Admin-approved reclaim implementation.
- Mobile/TV support.
- Realtime architecture changes.
- Full reinstall/delete/orphan/clone E2E matrix.

## Files Changed

- `darshan-player/package.json`
- `darshan-player/src/main/cli.ts`
- `darshan-player/src/main/services/operator-tools.ts`
- `darshan-player/test/unit/main/cli.test.ts`
- `darshan-player/test/unit/main/operator-tools.test.ts`
- `docs/runbooks/player-clean-reinstall-reset.md`
- `docs/runbooks/onprem-player-ghost-pairing-recovery.md`
- `docs/architecture/player-pairing-identity.md`
- `docs/implementation/ghost-pairing-production-hardening.md`
- `docs/implementation/ghost-pairing-task-register.md`
- `docs/implementation/ghost-pairing-decision-log.md`
- `docs/implementation/ghost-pairing-test-plan.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `docs/implementation/ghost-pairing-phase-gp4-handoff.md`

## APIs Added/Changed

None. GP-4 is player operator tooling and documentation only.

## Env Vars Added/Changed

None.

## Tests Run

- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts --spec test/unit/main/operator-tools.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`

## Test Results

Passed:

- Player build.
- CLI parser tests.
- Operator reset tests:
  - dry-run does not delete identity/cache files.
  - default reset clears identity-bound state and preserves media cache/request queue/proof spool.
  - `--clear-cache` clears media/object/quarantine/cache-index targets and preserves request queue/proof spool/logs.
- Player flow tests.

## Failed Tests

None in the GP-4 targeted player tests run so far.

Known separate failure remains:

- `darshan-server/src/routes/screens.test.ts` reporting assertion for `active_screens_now`.

## Blocked Tests

- No local GP-4 player tests were blocked.
- Packaged Ubuntu player smoke was not run in this workspace.
- Browser/on-prem QA for CMS revoke plus local reset was not run.
- Full reinstall/delete/orphan/clone E2E matrix remains GP-6.

## Known Risks

- Normal uninstall can preserve Electron app data. This is intentional; operators must run explicit reset for clean reinstall.
- Existing Linux `postremove.sh` can remove all data when an operator explicitly confirms. The GP-4 runbooks do not rely on package uninstall as the reset mechanism.
- Pending request/proof-of-play queues are preserved; support must decide separately if those can be discarded.
- Clone/copy app-data duplicate identity remains open for GP-5.
- Production readiness remains blocked by GP-5, GP-6, and runtime QA evidence.

## Rollback Plan

Revert the GP-4 player CLI/operator-tools changes, the new operator-tools tests, the package script alias, and the GP-4 docs/runbooks. Reverting removes dry-run/status/cache reset tooling and documentation, but does not alter backend pairing truth, CMS orphan visibility, device heartbeat, snapshot, default media, emergency, or polling fallback flows.

## QA Checklist

- On packaged Ubuntu player, run `darshan-player --pairing-status`.
- Run `darshan-player reset-pairing --dry-run` and verify target paths.
- Revoke a visible screen pairing from CMS, then run local reset.
- Restart player and pair as a new screen.
- Confirm CMS Screens shows the new screen.
- Confirm Pairing Health shows no stale orphan for the reset identity.
- Repeat with `--clear-cache` and confirm proof/request queue files are preserved.
- Confirm normal upgrade does not clear identity.

## Production Checklist

- Backend pairing-status deployed before GP-2/GP-4 player rollout.
- CMS Pairing Health and revoke verified in QA.
- Player reset commands verified under the same OS user/service account that runs the player.
- Internal support runbook distributed to on-prem operators.
- Backup/restore process for player runtime root documented by site operations.
- GP-5 clone/duplicate identity detection completed or explicitly risk-accepted.
- GP-6 E2E matrix completed or explicitly risk-accepted.

## Next Phase Readiness

GP-5 can start after independent verification of GP-4. Production readiness remains blocked.

## Recommendation

APPROVE_WITH_CONDITIONS
