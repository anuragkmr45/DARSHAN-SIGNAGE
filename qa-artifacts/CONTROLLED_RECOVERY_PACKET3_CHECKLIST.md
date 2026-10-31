# Controlled Recovery Packet 3 Checklist

Status: developer fixture implementation; not QA or release approval.

## Developer contract

- [x] Immutable release-01/0055 and release-02/0056 prefixes preserved; release-03/0057 explicitly enrolled.
- [x] Latest verified success and latest failure are independent.
- [x] Active stage, attempt, heartbeat, lease, retry and deadline are projected without raw errors or paths.
- [x] Stable overdue/stuck/capacity/retry/retention alert codes exist.
- [x] Only trusted local V2 DATABASE/OBJECTS/CONFIGURATION ciphertext is downloadable.
- [x] Download uses fresh authorization, exact source trust, fd identity/hash verification, bounded streaming, abort handling and audit.
- [x] Legacy/unverified/changed sources fail closed; no arbitrary path/range/plaintext/decrypt surface exists.
- [x] Recovery report import is strict, canonical, signed, site-bound, time-bound, idempotent and sequence anti-rollback.
- [x] CMS/API read only the DB projection and never privileged recovery roots/Docker.
- [x] CMS has no recovery/promotion/acceptance/rollback mutation.
- [x] Metrics and alerts use bounded label-free backup identities.
- [x] Packet 3 QA cases `BKP-33..36`, rules `BR-137..140` and risks `R-58..59` are mapped.

## QA / release gates

- [ ] Live canonical repository stream, slow-client/backpressure, disconnect and source-replacement rehearsal.
- [ ] Browser authorization/account-switch/download/report/runbook flow.
- [ ] Prometheus rule syntax plus fire/clear evaluation against real scrapes.
- [ ] Deployment report signing/key custody and concurrent import rehearsal.
- [ ] Disposable Docker recovered application, promotion and rollback flow.
- [ ] Split-host topology, production sizing, RTO/maintenance, load/soak/failover, fleet/browser/Windows/physical-display gates.
