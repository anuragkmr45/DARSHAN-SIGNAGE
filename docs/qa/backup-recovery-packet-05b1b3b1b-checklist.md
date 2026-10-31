# Packet 05B1b3b1b constrained target lifecycle QA checklist

This checkpoint is fake-only. Do not invoke Docker/Podman, Compose, a live
service, network/SSH, production private keys, target secret material,
decryption, import, or restore.

- [x] Define strict canonical bounded resource-admission, fixed lifecycle
  command, sanitized result, and complete authoritative observation v1
  contracts with no caller path/argv/endpoint/environment/secret/generic-exec
  field.
- [x] Add only the scoped `TargetLifecycleResourceAuthority` seam and retain
  the unmistakable `TEST_ONLY_DO_NOT_USE_IN_PRODUCTION` scripted fake.
- [x] Bind every engine record and authority exchange to the exact v2 request,
  canonical outer envelope, authorization, enrollment, execution profile,
  protected inventory, operation/site/host/plan/target/generation/specification
  identities, and verified storage-evidence envelope digests.
- [x] Enforce outer helper -> lifecycle authority -> engine journal lock order,
  recheck cancellation/deadline after awaited calls, and recheck immediately
  before the only effect-capable fake call.
- [x] Publish durable INTENT before mutation and RECEIPT only after complete
  authoritative observation through a bounded append-only hash chain using
  no-clobber hard-link publication and directory fsync.
- [x] Reject unsafe roots/files, noncanonical or noncontiguous names, checksum
  and transition changes, unstable inode/device/link/mode/owner/size/time
  metadata, exact-duplicate disagreement, conflicting pending intents, and
  retained incomplete publication evidence.
- [x] Model PREPARE as admitted existing allocation/credential references,
  internal network, PostgreSQL create, MinIO create, PostgreSQL start, MinIO
  start, then complete ready verification against the accepted two-container
  profile. Do not claim initdb, shellless health, or authenticated readiness.
- [x] Keep INSPECT read-only and require matching durable terminal receipt plus
  fresh authority truth for READY or STOPPED_RETAINED.
- [x] Stop exact MinIO then PostgreSQL for STOP_RETAIN and retain network,
  containers, data, allocation, and credential references.
- [x] Reject RETIRE definitely before authority, journal, stop, removal,
  quarantine, or PURGE effect.
- [x] Reconcile an exact pending intent conservatively: adopt exact owned
  observed state, retry only after reliable absence, and retain ambiguous state
  for incomplete, foreign, configuration-mismatched, or possibly effected
  work.
- [x] Keep the production worker/native listener/factory byte-unchanged,
  unavailable, selector-free, and install-wiring-free.
- [x] Add direct constrained-engine normal, every-step crash/restart,
  lost-response, foreign/configuration mismatch, stale-head, exact replay,
  expiry/cancellation-after-await, missing-terminal-receipt, contradictory
  authority truth, mutation-count, script-exhaustion, and secret-sentinel
  executable coverage.
- [x] Add the full genuine disposable Ed25519 v2/v4 gateway/helper PREPARE ->
  INSPECT -> STOP_RETAIN integration and separately sign a disposition-v2
  RETIRE rejection from the actual PREPARE response digest/helper sequence.
- [x] Correct the independent-review findings: pending PREPARE/STOP_RETAIN
  helper reconciliation observes under the original signed operation; caller,
  outer-envelope, installed, storage and journal identities are exact; signed
  freshness is rechecked after awaits and before effects/receipts; retained
  resource identities cannot be replaced under the same handle/configuration;
  every action group has one immutable request/binding; receipts match their
  exact INTENT; post-effect pre-dispatch failures remain ambiguous; and INSPECT
  performs no journal repair, unlink, append, or lock-file cleanup.
- [x] Add repository regressions for all eight independent reproducers, genuine
  gateway lost-response replay for PREPARE and STOP_RETAIN, byte-for-byte
  readonly direct/gateway inspection, resource replacement, receipt mismatch,
  post-await expiry/no-effect, ambiguity after prior effect, fail-closed lock
  preservation/contention, and actual inode/size/mtime/ctime instability.
- [x] Correct the second independent rereview: late START_MINIO and
  STOP_POSTGRES lost responses now append the exact pending receipt and
  terminal VERIFY intent/receipt before helper success; admission identity is
  immutable across the whole action group; and lock ownership is published
  from an already identified owner inode so same-invocation initialization
  failures clean only that inode.
- [x] Add genuine signed late-loss gateway replay plus following standalone
  INSPECT, changed-admission crash/restart, live-owner EACCES/EIO, exact
  initialization cleanup/retry, and published dead-owner fail-closed
  regressions.
- [x] Apply the final fake-only lock boundary: remove all automatic JavaScript
  stale-owner detection, claim links, reclaim hooks, and reclaim/unlink paths.
  Any existing fixed lock, including dead, wrong-boot/start, malformed,
  multi-link, or abandoned-owner evidence, is preserved byte/inode/link exact
  and returns `RECOVERY_LOCK_HELD`; publication `EEXIST` never retries or
  reclaims. Concurrent absent-lock publication permits one winner and one held
  contender, while normal return, callback error, and initialization failure
  clean only the invocation's own inode. A native OFD lock is a prerequisite
  before this fake-only lifecycle can be enabled beyond the checkpoint.
- [ ] Run privileged/live engine, credential materialization, decrypt/import,
  restored-data validation, promotion/rollback, release, load/soak, topology,
  RPO/RTO, and production drills (deferred release gates).

Packet 05B1b3b2 remains the decrypt/import and recovery-validation integration
gate. Packet 05B1b4 remains signed-role/source-free installation wiring.

All review finding rounds above are developer-corrected. A fresh independent
GPT-6.1 Sol ultra rereview passed 70/70 focused tests and 345/345 full recovery
tests with no open P1/P2 finding, so this fake-only checkpoint is accepted.
The unchecked privileged/live item remains a later release gate and is not
implied by this acceptance.
