# Packet 05B1b3b2a native authority foundation QA checklist

This checkpoint is native-fixture and scripted-client only. Do not invoke an
engine, live service, network/SSH, production private key, target secret,
decrypt, import, or restore operation.

- [x] Own one validated protected persistent inode with `F_OFD_SETLK`; never
  use PID/pathname stale detection, reclaim, unlink, or repair.
- [x] Reject unsafe root/lock modes, symlink, multiple links, corrupt record,
  post-lock inode substitution, wrong owner in production, and contention.
- [x] Prove independent OFD descriptions contend, process crash releases, and
  one session retains the lease until release or verified peer death.
- [x] Keep the OFD anchor empty and immutable; reject an existing anchor with
  no valid state. Publish monotonic INTENT/COMMIT state without in-place
  truncate/overwrite, and fail closed at every link/write/file-fsync/
  directory-fsync crash boundary without rolling generation 8 back to 7.
- [x] Require an unnamed private Unix `SOCK_SEQPACKET` descriptor plus kernel
  `SO_PEERCRED`; reject wrong peer expectation and non-socket descriptors.
- [x] Independently validate fixed enrolled installation, site, host, profile,
  enrollment, admission, authority instance, and supervisor generation.
- [x] Bind exact operation/generation/target/outer-envelope/request/
  authorization/deadline/reconciliation identities in one fixed bounded
  canonical protocol; reject partial, trailing, oversized, reordered,
  noncanonical, expired, and substituted requests/results.
- [x] Return only opaque session/lease proof and sanitized fixed status. Expose
  no path, executable, argv, endpoint, environment, credential value, generic
  exec/remove, or PURGE surface.
- [x] Mint and bind a non-caller-overridable 128-bit challenge per acquisition,
  persist seen challenges natively, reject reuse/released-response replay, and
  scope serialized idempotent release to the lease's immutable handle.
- [x] Canonically parse and freeze the request before dispatch; caller mutation
  during await cannot change deadline, operation, binding, or proof checks.
- [x] Require current-generation reconciliation for future mutation while
  permitting readonly reconciliation observation after a monotonic supervisor
  restart. Reject requester-only reconciliation claims, same/lower-generation
  instance rollback, and native reconciliation rollback.
- [x] Preserve accepted engine-journal bytes/state machine and leave the
  constrained production engine/evidence/attestation selector absent.
- [x] Make helper listener a subreaper; establish process groups on both sides
  of the gate; retain group slots after direct-child exit; reap adopted
  descendants, including `setsid` escapees, by PID/start identity; TERM then
  bounded KILL groups and adopted PIDs; require affirmative `ECHILD` plus a
  successful discovery/identity/group sweep before lifetime-authority release.
- [x] Persist unknown-descendant state across reap/discovery errors, retain all
  known identities, signal only exact known identities, and fail-stop with the
  listener authority held until a nested detached child can be discovered,
  killed, reaped, and negatively proven absent.
- [x] Preserve privilege/capability/no-new-privileges and inherited-descriptor
  closure behavior. Do not infer daemon effect absence from child cleanup.
- [x] Cover cancellation at admission, callback/worker death, TERM-resistant
  descendant, orphan reaping, FD closure, readonly operation, supervisor
  restart fencing, secret-sentinel exclusion, and no production selector.
- [x] Fresh independent rereview after the final affirmative child-liveness
  correction pass found no open P1/P2. Independent focused reruns passed
  native helper 18/18 and TypeScript 16/16.
- [ ] Live engine, credential, decrypt/import/restore, restored-data validation,
  promotion/rollback, release, topology, load/soak, RPO/RTO, and production
  rehearsal (deferred release gates).

The checked boundary is synthetic/native-fixture evidence only. Packet
05B1b3b2b remains responsible for any constrained adapter selection and real
engine/evidence/attestation integration; production remains unavailable.
