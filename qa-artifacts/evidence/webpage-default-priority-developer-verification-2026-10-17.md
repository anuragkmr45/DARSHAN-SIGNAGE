# Webpage And Default-Priority Developer Verification

Date: 2026-10-17

Baseline: uncommitted `release-01` working tree based on `c680c0a`
Classification: developer evidence only; not an independent QA Pass

## Verified Before Final Reconciliation

- Server focused PostgreSQL routes/policy/default tests: 22 passed, including
  concurrent same-revision settings writes and manual preview refresh.
- Server focused pure unit/migration tests: 8 passed, including the automatic
  due batch and migration `0047` contract.
- CMS unit suite: 113 passed.
- CMS stale-conflict browser scenario passed after asserting the actual `409`,
  retained local priority and successful explicit retry.
- Player complete unit suite: 363 passed.
- Player fault-injection suite: 14 passed.
- Release bundle configuration tests: 13 passed.
- Player build and the feature-focused server/CMS builds passed during the
  implementation cycle.

## Final Working-Tree Gates

The final rerun table is completed only with command output from this exact
working tree. Human QA fields remain unchanged regardless of these results.

| Gate | Result |
| --- | --- |
| Server production build | PASS — `npm run build` |
| CMS production build and bundle budget | PASS — `npm run build` |
| Player production build | PASS — `npm run build` |
| CMS two-spec one-worker Playwright scenarios | PASS across the earlier four-scenario run plus the focused stale-conflict rerun (5 scenarios total). A combined final rerun was deliberately not launched because the workstation had only 2.5 GiB available and 323 MiB free swap after a prior host OOM. |
| Server feature unit and PostgreSQL suites | PASS before the final authorization-claim tightening — 7 focused job/migration unit tests plus 22 focused policy/default/settings/media API tests on real PostgreSQL. After the one-transaction race fix, the server build passed and the refresh route returned the expected `202`; the final three-case file was interrupted after two passed by the artificial 768 MiB Vitest heap limit during teardown, so that interrupted run is not claimed as a pass. No application assertion failed. |
| Migration `0047` application on disposable PostgreSQL | PASS — columns were removed from the disposable `darshan_test` database, the SQL migration was applied, and all four columns plus `media_webpage_preview_due_idx` were verified |
| Release-bundle configuration suite | PASS — 13/13 Node tests |
| Player automated regression | PASS earlier in this implementation cycle — 363 unit and 14 fault-injection tests; no player source changed after those runs, and the final player build passed |
| CMS unit regression | PASS earlier in this implementation cycle — 113 tests; no CMS source changed after that run, and the final CMS build passed |
| `git diff --check` and QA CSV validation | PASS — no whitespace errors; risk/test/trace CSV files have uniform column counts; all 111 test rows have every required planning field and Expected Result; IDs are unique |

The final code review also moved manual refresh authorization and the refresh
claim into the same mutation transaction. This closes an account/ownership
change window without adding a second policy path. The post-change TypeScript
build passed. Because available host memory fell below the documented safe
threshold, the interrupted Vitest rerun was not retried with a larger heap and
is left for the frozen-candidate QA run.

## Explicitly Not Claimed

- No production or customer system was used.
- No real external login, internal host or credential was probed.
- No packaged Electron player or physical display was run for this feature.
- No full Chromium-capture plus real object-store fault matrix, fleet load,
  mixed-version rollout, security assessment or soak was completed.
- The branch is not yet a frozen release candidate and build hashes are not yet
  recorded.

The exact disposable PostgreSQL container used for the final route/migration
checks was stopped and removed. Generated Playwright `test-results` output was
also removed; only intended source, test, migration, documentation and evidence
files remain in the working tree.

These remaining items are assigned to `WEB-01..06`, `DEF-01..03`, `FUN-06`,
`FUN-08`, `PLAYER-09` and the release-readiness checklist.
