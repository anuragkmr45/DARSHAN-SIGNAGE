# Backup recovery Packet 05B1a QA checklist

Packet 05B1a is testable only with the deterministic fake target engine and
protected temporary filesystem fixtures. Do not run Docker, live services,
decrypt/import/restore, private-key runtime operations, or network tests for
this packet.

## Required automated evidence

- Exact historical plan v1/v2 and journal v1-v4 fields still decode with their
  prior meaning; unknown fields and new target phases in legacy versions fail.
- Plan v3 target-set digest is stable, domain separated, and excludes its own
  `targetSetId`; every preparation evidence digest is bound.
- Admission/disposition signatures reject wrong key, site, host, plan, target
  generation, action, body, expiry, revocation, duplicates, noncanonical JSON,
  and unknown fields.
- Protocol request/response bounds, canonical encoding, identity matching,
  stable error codes, and unknown fields are covered.
- Fake-engine prepare/inspect/stop-retain/retire, exact duplicate replay,
  concurrent duplicate coalescing, request-body conflict, helper restart,
  lost response, and ambiguous-effect reconciliation are covered.
- Exact PREPARE and disposition request IDs/body digests must survive workflow
  restart. Pending owned retries reconcile before original expected-sequence
  checks. Run every intent/effect/receipt crash hook for PREPARE, STOP_RETAIN,
  and RETIRE with non-null disposition sequences.
- Source release must fail for preparation intent, dispatched/unknown effect,
  hold invalidation after READY, lost PREPARE response, and failed local READY
  completion. It may proceed only after exact online ABSENT proof or a matching
  signed STOPPED_RETAINED/RETIRED receipt and online terminal truth.
- Inject target-sets and target-directory parent-fsync failures and prove no
  engine callback occurs. Reject wrong owner/mode and canonical replay ledgers
  with mismatched response identity or nonmonotonic helper sequence.
- Journal intent/effect/receipt ordering, READY receipt binding, helper
  sequence, target disposition, hold invalidation, pre-import release guard,
  and offline/online truth behavior are covered without app-DB migration.
- Serialized recovery regression tests, typecheck, lint for touched modules,
  and production build must pass before handoff.
- INSPECT must leave helper sequence and journal bytes unchanged. Repeat online
  status before STOP/RETIRE and race status with disposition; the signed
  prepared receipt/state/sequence and fresh pre-disposition inspection must
  remain authoritative.
- Inject definite pre-effect engine rejection for PREPARE, STOP_RETAIN, and
  RETIRE. Require retained terminal replay/no-effect evidence and a fresh
  sequence-bound request (plus a newly signed disposition decision) after the
  prerequisite is restored. Prove ambiguous outcomes reject a fresh body and
  stay pinned to the original request.
- Treat target-controller completion as untrusted. Resume must reread the
  locked operation journal and reject foreign operation/plan/target returns,
  malformed returns, unchanged journals, missing receipts, and controller
  failures. Success must be built only from durable journal evidence plus
  exact broker/helper truth.
- Crash immediately after persisting PREPARE, STOP_RETAIN, and RETIRE definite
  rejection evidence. Restart must issue only INSPECT, preserve the original
  evidence across failed/invalid inspection and failed resolution writes, and
  never repeat the engine effect. Concurrent retries must serialize. Exact
  cached rejection recording is a no-op; any changed request/error/sequence/
  state/receipt conflicts.

## Explicitly open 05B1b/live gates

- privileged native helper/relay and protected production transport;
- real Docker/engine adapter, target filesystems, volumes, and networks;
- signed-role/runtime bundle assembly and source-free verifier updates;
- target credentials and secret injection boundaries;
- decrypt, import, application reconciliation, validation, promotion,
  rollback, and successful-restore source-hold release;
- live topology, RPO/RTO, load/stress/soak, failover, and production rehearsal.
