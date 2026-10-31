# Controlled Recovery Packet 2 — QA Checklist

Environment for completed items: developer-only scripted adapters and filesystem fixtures, 2026-10-30. No live infrastructure.

| Case | Expected result | Status |
|---|---|---|
| Immutable compatibility | release-01 stays at 0055; release-02 separately binds 0056 | Developer passed |
| Reconciliation | all required state/queue classes run once per operation+generation on exact owned targets | Developer passed |
| Notification semantics | in-app history preserved; no nonexistent email/webhook queue claimed | Developer passed |
| HTTP/signed/legacy quarantine | stable review-required result without revocation meaning | Developer passed |
| Pairing review | exact identities, reason, and authorization required | Developer passed |
| Generation proof | exact proof accepted once; replay/expiry/mismatch rejected | Developer passed |
| Player adoption | obsolete work/counters reset; identity/cache retained | Developer passed |
| App validation | every fixed case required; missing case fails | Developer passed |
| Promotion/rollback | exact binding/fence/write-freeze/prior pointers enforced | Developer passed |
| Crash boundaries | reconcile/validate/awaiting phases resume around intent/result | Developer passed |
| Docker and split topology | real isolated services and fixed private TLS topology | Pending explicit gate |
| RTO/load/production rehearsal | measured release evidence | Pending QA |

## Final review corrections

| Case | Expected result | Status / evidence |
|---|---|---|
| Current release admission | separate release-03/0057 profile accepts current source; enrolled older source needs reviewed forward compatibility; unsupported source denied | Developer fixture passed |
| Concurrent resume | lock spans observe/intent/effect/reobserve/result; destructive adapter dispatches once; loser gets BUSY | Developer fixture passed |
| Torn journal tail | only incomplete final frame recovers; complete bad hash/interior corruption fail | Developer fixture passed |
| Producer archive shape | root and trailing-slash directories accepted; malicious variants denied | Developer fixture passed |
| Quarantine bootstrap | player retains identity/cache and succeeds after approval | Developer fixture passed; live signed HTTP/socket pending |
| Same-generation reconnect | same generation preserves counters; changed generation resets | Developer fixtures passed; PostgreSQL integration pending |
| Command generation | transaction-selected binding persists; old/NULL claim and reply are rejected | Developer contract passed; PostgreSQL integration pending |
| Missing success alert | absent/nonpositive timestamp fires and fresh success clears | Static evaluator passed; `promtool` pending |
