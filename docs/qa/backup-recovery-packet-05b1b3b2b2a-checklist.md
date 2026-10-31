# Packet 05B1b3b2b2a credential provisioning/admission QA checklist

## Developer fixture boundary

- [x] Add scope-v1, journal-v1, admission-v1, profile-v3, and
  resource-admission-v2 without editing accepted v1/v2 schemas or records.
- [x] Verify the domain-separated fixed-line semantic encoding and executed
  native wire digests;
  the TS golden wire is accepted by the strict fixed-order native parser.
- [x] Verify Ed25519 PREPARE authorization, expiry, request, target,
  generation, challenge, profile, allocation/ledger, policy, and authority
  bindings before provisioning. Recompute the complete domain-separated scope
  wire and semantic digests; reject every effect-authorizing field substitution
  before the scope anchor exists.
- [x] Acquire an OFD provisioning-only scope over retained descriptors and
  reject contention, peer death, unsafe parents, links, foreign names, stale
  heads, changed physical identities, an ordinary same-inode FD substituted for
  the acquired OFD, aliased role handles, and a deadline exceeded by one ns.
- [x] Require an active process-local acquired-session witness, independent
  lock-owner probe, creator PID, peer socket cookie, live peer, and exact lease
  proof. Released/reopened, copied, forked, and peer-replaced sessions leave no
  scope effect. Claim the exact live registry witness and locking OFD before
  any release/peer-death close; reject stale copies after natural FD reuse and
  permit only one concurrent release claimant. Synchronize PID/registry/fork
  reset state and exercise it under ThreadSanitizer.
- [x] Reject aliased credential/journal roots and malformed or orphan journal
  topology before creating the scope anchor or any credential file. Validate
  exact existing state records and transitions before provisioning.
- [x] Generate only the three fixed roles with native CSPRNG and fixed
  role-specific encoding/length/ownership/mode rules.
- [x] Publish no-clobber with complete bounded writes, provenance, file fsync,
  link, parent fsync, and exact durable replay.
- [x] Preserve `ABSENT -> INTENT -> FILES_DURABLE -> ADMITTED`; retain partial
  publication and adopt it only by exact protected provenance without rotation.
  Adoption fsyncs and reverifies the exact file and containing directory before
  acknowledgement, including final-role post-link retry paths.
- [x] On anchor creation and every existing-anchor replay, validate the exact
  protected anchor/xattr/identity, fsync the anchor and journal directory, then
  reverify both before using the private commitment key. Failures around either
  fsync remain retryable and cannot skip durability proof.
- [x] Validate fixed per-role content length/encoding and a native keyed private
  content commitment stored only in protected xattrs. Content mutation cannot
  reconcile as admitted; no commitment appears in public evidence.
- [x] Return only opaque handles, descriptor identities, numeric owner/mode,
  and durable binding digests. Do not expose secret bytes or derived digests.
- [x] Disable core dumps and wipe transient native value/random buffers.
- [x] Keep profile-v2 unavailable and production selector-free. Profile-v3 and
  resource-admission-v2 never enable materialization or lifecycle.

## Developer verification

- [x] Compile-gated native credential fixture passed **73/73** inner checks;
  engine-authority predecessor passed **46/46**.
- [x] Focused TypeScript credential contracts/admission passed **5/5**.
- [x] Full serialized recovery regression passed **403/403** across **25/25**
  files; all native predecessor suites passed.
- [x] Four relevant TypeScript no-emit configurations, touched lint, and build.
- [x] Strict production/non-test native compilation and static security scans.
- [x] Independent reviewer rechecked the completed corrections for full-scope
  binding, adoption durability, precise expiry, OFD proof, nonzero journal
  heads, distinct role handles, descriptor semantics, live-session witness,
  root disjointness, journal preflight, private content integrity, reconcile
  freshness, exact PREPARE request digest equality, anchor replay durability,
  exact-claim release under FD reuse, and registry race freedom. Result: local
  fixture accepted with no open P1/P2/P3 findings; all **28/28** native Node
  subtests and **403/403** recovery tests passed independently.

## Deferred release gates

- [ ] Real root-owned host enrollment and fixed service numeric identities.
- [ ] Docker/daemon/start/bootstrap/authenticated readiness/stop/retire.
- [ ] Decrypt/import/restore, application validation, promotion/rollback.
- [ ] Full topology, fleet, load/stress/soak, RPO/RTO, and production rehearsal.

No Docker/live service/network/SSH/production key/real credential/decrypt/import/
restore operation is permitted by this developer fixture.
