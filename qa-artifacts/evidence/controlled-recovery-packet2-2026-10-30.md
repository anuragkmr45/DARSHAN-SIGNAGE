# Controlled Recovery Packet 2 — Developer Evidence

Date: 2026-10-30

No Docker/live service/network/SSH/credential/key/decrypt/import/restore operation was performed. All effectful boundaries use injected or scripted fixtures. The native engine remains unavailable/`ENOTSUP` and was not selected.

Implemented: additive 0056 authority migration, separate release-02 metadata, reconciliation and review contracts, stable quarantine, signed one-use generation handshake, player persistence/stale protection, isolated application validator, explicit promotion/accept/rollback, extended journal/report states, controlled CLI verbs, and fixed split-host profile contract.

## Final fixture verification

- Server controlled-recovery suite: 28 files, 480 tests passed.
- Packet 1 + Packet 2 + compatibility focused run: 71 tests passed.
- Direct JWT and device-admission predecessors: 6 tests passed.
- Player unit suite: 380 tests passed.
- Player recovery-focused unit run: 28 tests passed.
- Player lifecycle integration suite: 5 tests passed.
- Player fault-injection suite: 14 tests passed.
- Server and player production builds passed.
- Recovery-test TypeScript, production recovery CLI TypeScript, and script TypeScript checks passed with no emit.
- New Packet 2 modules passed ESLint with zero warnings. The wider touched-file lint run has no errors but retains 36 pre-existing `no-explicit-any` warnings in older gateway/route/service files.
- Native wire-format predecessor: 1 synthetic parity test passed; this does not select or make the native engine available.
- `screens:dry-run` could not complete because the deliberately absent local fixture dependency at `127.0.0.1:9000` refused the connection. No service was started and no remote endpoint was contacted.

Developer results do not claim Docker E2E, production topology, RTO, scale, production readiness, application-validation execution against a live recovered stack, promotion, acceptance, or rollback rehearsal. Those remain explicit gates.

## Final independent-review correction addendum

Eight P2 findings were corrected without activating the frozen native engine: separate release-03/0057 admission with reviewed forward compatibility; operation-wide execution locking; incomplete-tail journal recovery; producer archive compatibility; identity/cache-preserving quarantine; same-generation counter preservation; transaction-bound command generations and acknowledgements; and nonpositive-timestamp backup alerting.

Final corrected fixture results: focused server **6 files / 76 tests passed**; player quarantine approval **1/1 passed**; targeted command predecessor **2/2 passed**; full recovery regression **28 files / 485 tests passed**; server build, player main build, server app/scripts/recovery-test typechecks passed. The earlier Packet 2 count remains historical evidence from before the review corrections. PostgreSQL-backed route/socket/command integration, Docker, production topology, real Prometheus `promtool`, activation, promotion and rollback remain pending.

The final player predecessor boundary also passed: full unit **381/381**, integration **5/5**, and fault-injection **14/14**. Focused server lint completed with zero errors and 28 inherited `no-explicit-any` warnings; focused player lint completed with zero errors and one inherited missing-return-type warning. The targeted private-key/AWS-key/credential-assignment scan returned no findings, and `git diff --check` was clean. `promtool` is unavailable, so only the bounded static fire/clear evaluator is developer-proven.

One mistakenly invoked repository smoke command attempted to contact the absent local API fixture and failed before exercising recovery behavior; it started no service and is not counted as evidence. Database-backed HTTP/socket/command integration remains pending under the no-live-service constraint.

The final six-file rerun initially exposed a fixture-only race: the concurrent journal assertion could run before its lock-holder callback signalled acquisition. The fixture now waits on that explicit barrier; the immediate rerun passed **6/6 files, 76/76 tests**. No product behavior changed after the single 485-test full recovery regression.

## Bounded-verification P2 follow-up

Three remaining findings were corrected. Lock ownership is now prepared in a durable temporary file and atomically published by exclusive hard link, so no ownerless live claim is exposed; legacy incomplete directory claims fail closed. Stale reclaimers serialize on a separately atomically published reclaim identity, re-read the exact stale bytes and liveness before unlink, and conditionally release only their own byte-identical claims. Deterministic fixtures cover mkdir-before-owner publication and two synchronized reclaimers with exactly one effect owner.

Runtime `RECOVERY_PAIRING_REVIEW_REQUIRED` is classified before generic forbidden/invalid-credential handling. A running player moves to identity-preserving review wait, retains certificate/device/fingerprint/cache, and resumes `PAIRED_RUNTIME` after approval. Report v4 now derives a current release from durable `approvedReleaseId`; historical release-01 Packet 2 operations retain the explicit release-02 application-target mapping.

Final results after these behavior changes: focused Packet 1/2 **2 files / 73 tests passed**; focused running-player quarantine **1/1 passed**; full recovery regression **28 files / 488 tests passed**; player unit **382/382**, integration **5/5**, fault injection **14/14**. Server build, player main build, server app/recovery-test/scripts no-emit checks passed. Focused lint completed with zero errors (seven inherited Packet 2 `no-explicit-any` warnings and one inherited player missing-return-type warning). The first focused server attempt passed all assertions but reported one unhandled loser promise; the fixture attached `allSettled` before releasing the deterministic barrier, and the clean rerun passed 73/73. No Docker/live/network/SSH/key/decrypt/import/restore/promotion/rollback action was performed.
