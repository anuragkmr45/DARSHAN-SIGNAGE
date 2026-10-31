# Controlled Recovery Packet 3 — Developer Evidence

Date: 2026-10-30

No Docker, live service, network, SSH, real credential/key, decrypt, import, restore, promotion or rollback operation was performed. Tests use source fixtures and injected adapters only. Production native recovery remains unavailable / `ENOTSUP` and unselected.

Implemented: release-03/0057 recovery-report projection; independent backup health; trusted ciphertext-only download admission and audit; canonical signed anti-rollback report import; reduced CMS monitoring/download/report surface; bounded backup metrics and Prometheus alerts; Packet 3 runbook and QA mappings.

## Developer verification results

- `npx vitest run --config vitest.unit.config.ts` over the backup repository/publication/retention, source selection, migration, release, report, download and monitoring predecessors: **12 files / 75 tests passed**.
- `npm run test:unit` in `darshan-cms`: **31 files / 160 tests passed**.
- `npx vitest run --config vitest.unit.config.ts src/recovery`: **28 files / 480 tests passed**. This was the single full Packet 3 recovery regression.
- Final report/migration/release focused rerun after site advisory-lock serialization: **3 files / 11 tests passed**. Final Packet 3 release/download/report/alert subset: **5 files / 15 tests passed**.
- `node --test scripts/bundle/production-bundle-config.test.mjs` plus assembler shell syntax: **16/16 passed**.
- Recovery container runner predecessor: **16/16 passed**. The first combined adversarial run then found **21/21 failures** because the frozen release-01 runtime incorrectly required 0055 to remain the whole ledger terminal after 0057 was added. The helper was corrected to verify/package only its immutable 0055 prefix; its dedicated adversarial rerun then passed **21/21** and proves 0056/0057 are excluded.
- Server build, server app/scripts/production-CLI typechecks, CMS app typecheck, CMS production build and bundle-budget check passed. Packet 3 server modules and CMS files passed focused lint. Whole `settings.ts` still reports two pre-existing `no-explicit-any` warnings at lines 311 and 418; neither line was introduced or changed by Packet 3.
- Playwright enumerated **6** backup operator-browser cases without starting a service. Execution is pending because the approved task forbids starting services.
- Packet 3 static alert contract test passed. `promtool` is not installed locally, so real Prometheus rule evaluation remains pending.
- Migration `0057` file SHA-256 is `ada7cf00635fc02b428ea63a8cb3c2419ae1b61c43dd39e76b038bc8a8bfb2a7`; reviewed release-03 migration-manifest fingerprint is `05561d3b1c8cac7fa57f6d47503835d23c2b88f7886203ab9c8207238762c438`.
- Packet 3 targeted scans found **0** embedded private-key blocks and **0** credential-bearing URLs. `git diff --check` passed.

## Not executed / residual gates

No Docker, live service, network, SSH, real credential/key, decrypt, import, restore, promotion or rollback operation was performed. Screens dry-run was not started because its database/object-store/service prerequisites are not locally available under the no-service constraint. Pending gates are live repository slow-client/backpressure/cancellation/replacement and audit-failure behavior, actual operator-browser download/account-switch flow, `promtool` fire/clear evaluation, concurrent deployment import against PostgreSQL, disposable Docker E2E and recovered application validation, split-host private/TLS topology, promotion/rollback rehearsal, scale/soak/failover and measured RTO/maintenance.

## Final independent-review correction addendum

The Packet 3 no-success alert now includes `last_verified_success_timestamp_seconds <= 0`. A bounded static evaluator proves absent and zero timestamps fire, a fresh timestamp clears, and overdue age fires. Focused alert tests are included in the final **6 files / 76 tests** correction run. Real `promtool` validation remains pending because it is not installed; no Prometheus service was started. The single post-correction full recovery regression passed **28 files / 485 tests**.

Final static recheck: the targeted private-key/AWS-key/credential-assignment scan returned no findings and `git diff --check` was clean.
