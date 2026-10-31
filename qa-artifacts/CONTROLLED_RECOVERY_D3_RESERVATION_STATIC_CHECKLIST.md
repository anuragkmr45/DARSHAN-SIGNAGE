# D3 reservation static review

- [x] Pure production transaction helper; public default request behavior retained.
- [x] Caller-owned transaction and explicit-pool lock/heartbeat/stage/failure seams; original SQL fences retained.
- [x] Separate disabled profile/schema/DDL outside application ledger; no installed command.
- [x] Real protected prerequisites and explicit TLS PG-only factory; real transactional pg-boss adapter, no installed fake enqueue or ordinary jobs.
- [x] Immutable operation/source/data/seal/key/capsule/run binding, rollback/conflicts/concurrency/retry/fences and read-only status.
- [x] Narrow validated control/backup metadata projection; stale/business data remains sealed; future D3 dump exclusion.
- [ ] Independent static review accepted.
- [ ] Disposable PostgreSQL catalog/pg-boss transaction/dump integration accepted (not executed here).
- [ ] Retained source readiness and seed/seal accepted; separately enabled live capsule accepted.
- [ ] Native worker/broker/capture/publication enrolled and accepted.
- [ ] Reservation/capture/broker/whole-run gates enabled in a later reviewed packet (currently false).

See [the runbook](../docs/runbooks/controlled-recovery-d3-reservation-static.md) and packet evidence. Fake transports satisfy no live acceptance item.

Final static verification: 477 distinct focused/predecessor tests pass, including D1–D4 enrollment regressions; scripts, application and recovery-test typechecks pass; server build and focused lint pass; 64 packet/9 runtime/21 template hashes match. Dedicated SQL integration remains unrun. See the reservation evidence/hash inventory for exact files and commands.
