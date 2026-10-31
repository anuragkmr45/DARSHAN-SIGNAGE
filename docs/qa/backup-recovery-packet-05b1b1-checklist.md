# Backup recovery Packet 05B1b1 QA checklist

This checkpoint is limited to canonical trust contracts, a public-key-only
authorization gateway, a bounded Unix client/pure server framing seam, and
protected temporary/local Unix fixtures. Do not run Docker, a live service,
network/SSH, decrypt, import, restore, production private keys, or privileged
listener operations.

## Required automated evidence

- A target specification is strict, canonical, operation-bound, and rejects
  duplicate/unknown/noncanonical input. Its hash changes for a different
  operation ID and feeds the unchanged targetSetId formula without circularity.
- Production plan-v3 construction requires the full matching specification;
  wrong operation/host/generation/topology/evidence/release identity fails
  before plan or journal intent. Historical opaque v3 remains readable only.
- The outer envelope keeps the helper request unchanged, is at most 64 KiB,
  binds exact public plan/preparation/specification identity, and rejects auth
  type confusion, wrong action/site/host/plan/spec/key, revocation, expiry,
  duplicate/unknown fields, noncanonical JSON, and trailing bytes.
- `authorizationSha256` is the digest of the exact canonical signed admission
  or decision body. There is no production signing/private-key API.
- Signature/expiry/action checks run again under the helper journal lock before
  mutation. Race state, sequence, pending action, and prepared receipt; no
  stale disposition may mutate.
- Distinguish a new STOP_RETAIN/RETIRE from exact durable replay. Run both
  actions through every intent/effect/receipt crash hook, lost response,
  completion-write loss, and definite-rejection resolution. Exact original
  request/body/auth/receipt/sequence may reconcile; any changed value fails.
- Treat the PREPARE receipt as immutable READY issuance evidence, not as the
  current helper sequence forever. After definite no-effect rejection, require
  helper READY at the incremented sequence and a newly signed decision binding
  that sequence plus the unchanged prepared receipt. Old sequence, changed
  receipt, and ambiguous fresh retry must fail.
- Exceed the 128-entry helper replay bound with both disposition actions. Keep
  exactly one canonical successful PREPARE pin plus the newest 127 ordinary
  entries; then prove fresh current-sequence disposition and exact completed
  replay still work. Duplicate, failed, mismatched, and foreign PREPARE pin
  candidates must fail closed.
- Disposition INSPECT is narrow: it proves only its exact READY receipt and
  sequence before its exact STOP_RETAIN or RETIRE. Admission cannot be confused
  for a disposition mutation.
- An authorization expiring between screen and lock produces no engine effect.
  A pending request whose original authorization expired remains pinned with
  its original ID/body digest and receives no reconciliation effect.
- Unix framing accepts exactly one canonical newline plus EOF. Cover request
  and response bounds, oversized/slow/incomplete/multi-frame/trailing input,
  four-connection admission, separate action timeout, cancellation and
  disconnect before/after dispatch, lost response, and malicious response
  identity.
- The five-second incomplete-frame clock starts on the first byte, not connect.
  Prove a first response at 5.2 seconds succeeds under a ten-second action
  deadline; partial bytes and newline-without-EOF fail five seconds later.
- Hold a read-only helper lock across authorized INSPECT, state snapshot and
  engine observation. Race STOP intent/effect/completion/rejection and prove a
  coherent response with byte-identical journal state.
- Before TargetWorkflow intent, controller validation must reject every
  operation/site/host/generation/topology/evidence/logical-target/release/spec
  digest/targetSet mismatch with zero journal bytes and zero transport calls.
- Config v1/v2 remain byte/schema compatible. Config v3 permits only the fixed
  relay/public roots/keyring/deadline fields. Missing controller dependencies
  fail closed as not installed.
- Run focused normal tests, adversarial trust/transport/race tests, then the
  serialized recovery regression, typecheck, touched lint, build, diff check,
  and evidence review.

## Explicit later gates

- privileged/native Unix listener and pathname lifecycle;
- SSH bridge or live network transport;
- real Docker/engine and target filesystem/volume/network adapters;
- target credentials and secret injection;
- systemd, signed role, bundle and source-free packaging;
- decrypt/import, application reconciliation, validation, promotion, rollback,
  successful-restore hold release, and live topology/RPO/RTO/load/failover drill.
