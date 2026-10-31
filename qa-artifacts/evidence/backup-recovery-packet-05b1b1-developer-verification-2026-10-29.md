# Backup recovery Packet 05B1b1 developer verification — 2026-10-29

## Scope and safety boundary

Implemented only the trust/transport checkpoint: an operation-bound canonical
target specification, strict outer authorization envelope, public-key-only
gateway with locked authoritative checks, bounded Unix client/pure framing
gate, additive operator config v3, and production controller seam.

No Docker daemon, live service, external network, SSH, native privileged
listener, decrypt, import, restore, database, object store, production private
key, target credential, systemd, signed-role, or bundle operation was invoked.
The one transport integration fixture used a temporary local Unix socket only.

## Implemented contracts

- `darshan-recovery-target-specification-v1` strictly binds operation ID,
  generation, host installation, topology, six accepted preparation evidence
  digests, and domain-separated target logical/release identity digests. It
  excludes plan SHA and targetSetId. Plan-v3 construction verifies the complete
  specification and hashes its canonical bytes into the existing
  `targetSpecificationSha256` field before using the unchanged targetSetId
  formula and unchanged plan-v3 serialized shape.
- Historical opaque plan-v3 parsing remains intact. The production controller
  and gateway require the matching full specification, so such a plan cannot
  PREPARE through the new production seam without it.
- `darshan-recovery-target-authorization-envelope-v1` carries the unchanged
  helper request, full signed admission or disposition, canonical full plan,
  public plan/preparation identity, and full target specification. The entire
  canonical envelope is capped at 64 KiB. The helper request's authorization
  digest is the SHA-256 of the exact canonical signed body, not the signature
  envelope.
- The gateway has public verification only. It rechecks trust, revocation,
  activation/expiry, action/type, plan/source/release/target/specification,
  site/operation/host/generation/policy, and target-set bindings under the
  helper journal lock before mutation. A disposition additionally requires
  the exact locked READY state, no pending action, helper sequence, and
  prepared receipt. Admission cannot authorize STOP_RETAIN/RETIRE.
- Pending reconciliation is fail-closed: the original request ID/body stays
  pinned and its original authorization must remain active. Expiry between the
  cheap screen and locked check, or before a restart reconciliation, produces
  no new engine effect.
- Unix framing is exactly one canonical newline plus EOF, with the existing
  64 KiB request, 128 KiB response, four-connection, and five-second
  incomplete-frame limits. The action deadline is separate. Client errors
  distinguish cancellation, timeout, disconnect, and lost response before or
  after dispatch.
- Operator config v3 adds only one fixed relay socket, separate public
  specification/authorization roots, one public authorization keyring, and an
  explicit bounded action deadline. The controller derives operation-specific
  filenames and exposes no arbitrary host, SSH, image, mount, engine, or
  credential options. Missing journal/source-hold dependencies fail closed.

## Verification results

- New trust/transport adversarial suite: **48/48 passed**.
- Accepted target foundation: **45/45 passed**.
- Accepted operator workflow: **41/41 passed**.
- Accepted recovery journal: **32/32 passed**.
- Focused target/gateway/operator/journal aggregate: **166/166 passed**, **4/4 files**.
- Full serialized recovery regression: **233/233 passed**, **15/15 files**.
- TypeScript no-emit (`tsconfig.json`): passed.
- Touched recovery ESLint with zero warnings: passed.
- Backend build (`npm run build`): passed.
- Diff whitespace checks: passed.

The tests cover specification operation binding/non-circularity, canonical and
unknown/duplicate rejection, envelope digest and outer strictness, wrong trust,
revocation, expiry, authorization type/action confusion, locked expiry with
zero effect, pinned pending replay after expiry, exact disposition INSPECT
against READY sequence/receipt, framing oversize/multiframe/trailing/incomplete,
and local Unix round-trip/lost-response classification. Existing suites retain
malicious helper response identity checks, crash/replay and locked journal
races.

## Independent-review correction loop

Independent review rejected the initial result with four P2 and two P3
findings. All six were reproduced and corrected; acceptance still requires the
independent rereview.

1. Locked disposition verification now distinguishes a pristine new mutation
   from an exact durable pending/completed/rejected request. Full signature,
   trust, expiry, body digest, original PREPARE receipt and expected sequence
   remain mandatory. Exact request ID/body/auth matches may reconcile or replay
   without forcing STOPPED_RETAINED/RETIRED/STOPPING back to READY. Changed
   request/body/auth fails closed. Both actions pass all five intent/effect/
   receipt crash hooks, exact replay after lost completion, and retained
   definite-rejection INSPECT through the real gateway.
2. The five-second timer is now an absolute incomplete-frame timer beginning
   only with the first response/request byte. Connection idle before framing is
   governed by the separate action deadline. A local response beginning at
   5.2 seconds succeeds under a ten-second action deadline; partial framing and
   newline-without-EOF fail after the absolute frame window. Before/after
   dispatch cancellation and action timeout classifications are covered.
3. INSPECT now uses a read-only helper-journal lock held across authoritative
   authorization, stable state snapshot and engine observation. It creates no
   state and advances no sequence. A barrier race proves STOP admission cannot
   enter during inspection and the state bytes remain identical.
4. The production controller canonicalizes and digest-verifies the complete
   plan, checks config site, targetSet derivation, and the complete target
   specification against plan/preparation before invoking TargetWorkflow.
   Operation, generation, host, topology, all six evidence families, logical
   target, release target, opaque historical digest, site and targetSet
   regressions prove zero recovery-journal bytes and zero transport dispatch.
5. Per-read abort listeners are removed in `finally`; aborted/incomplete
   iterators receive `return()` when available. Byte-by-byte reads do not grow
   signal listeners.
6. Initial helper state creation moved after locked authoritative
   authorization. Expired screening and a validly signed but state-invalid
   first mutation leave no `target-sets/` directory or journal state.

## Second independent-review correction

The first correction rereview found one remaining P2 mismatch between immutable
preparation evidence and a later retry sequence. It is corrected; acceptance
still requires independent rereview.

- The prepared receipt is immutable evidence that PREPARE produced READY for
  the exact target identity. Its canonical digest and READY response identity
  are verified, but its historical helper sequence is no longer required to
  equal a later disposition decision's current expected sequence.
- A definite pre-effect STOP_RETAIN/RETIRE rejection now durably restores the
  prior proven stable READY helper lifecycle while retaining the rejection
  response/replay evidence and incremented helper sequence. Ambiguous outcomes
  remain STOPPING/RECONCILIATION_REQUIRED with the exact request pinned.
- A fresh disposition separately requires stable READY, the current helper
  sequence, and the exact immutable prepared receipt. Exact pending/replay
  continues to use its original signed body and request digest.
- Full workflow tests now pass through RecoveryTargetWorkflow, the envelope
  transport, and the public gateway for both actions: PREPARE receipt at
  sequence 2, definite rejection/no-effect resolution to READY at sequence 4,
  old-sequence and changed-receipt rejection, fresh externally signed
  sequence-4 success, duplicate replay without duplicate effect, and ambiguous
  fresh-decision denial.

## Third independent-review correction

The second rereview found that the bounded helper replay ledger could evict the
immutable successful PREPARE receipt after enough no-effect disposition
attempts. The no-format-change correction pins exactly one canonical successful
PREPARE-to-READY replay entry and retains it alongside the newest 127 ordinary
entries. Total replay remains at most 128.

- Pin eligibility requires an exact successful PREPARE response, READY state,
  no pending action, definite effect evidence, matching current target identity,
  and canonical receipt digest. Failed, malformed, or foreign PREPARE responses
  never pin.
- Later disposition receipts no longer replace the prepared receipt pointer.
  STOPPED_RETAINED and RETIRED targets retain the preparation evidence because
  the target still exists; PURGE remains deferred.
- Decode rejects missing, duplicate, mismatched, or foreign pinned PREPARE
  evidence. Completed mutation replay remains subject to the ordinary newest
  127 non-pinned policy.
- Both STOP_RETAIN and RETIRE pass 129 definite rejection/read-only resolution
  attempts. The ledger remains exactly 128 entries with one PREPARE pin; stale,
  changed-receipt, and expired decisions fail; a fresh current-sequence
  decision succeeds; and its exact completed request replays without another
  effect.

## Explicit limitations and later gates

This checkpoint does not install a native listener, relay or SSH bridge and
does not prove privileged pathname ownership. The pure gateway publishes the
four-connection limit, but no native accept-loop integration is claimed. Real
five-second partial-frame and delayed-first-byte timing are covered on
temporary local Unix sockets; exhaustive kernel scheduling orders and native
supervisor signal behavior remain outside this pure seam.

Native privileged listeners/relay, real Docker/engine and target filesystem/
volume/network adapters, credentials, systemd/signed-role/bundle packaging,
decrypt/import, application reconciliation, validation, promotion, rollback,
successful-restore hold release, live topology, RPO/RTO, load/stress/soak,
failover, and production rehearsal remain Packet 05B1b2+ or later release
gates.

## Independent acceptance closeout

Independent rereview **ACCEPTED** Packet 05B1b1 with no remaining P1 or P2
findings and no new P3 finding. The accepted trust/transport adversarial result
is **48/48**; the focused target/gateway/operator/journal aggregate remains
**166/166**, and the full serialized recovery result remains **233/233** across
15/15 files.

The acceptance evidence is intentionally temporary-fixture bounded. For each
of STOP_RETAIN and RETIRE, automation completed 129 definite pre-effect
rejection plus read-only resolution cycles. The helper replay ledger remained
exactly 128 entries: one canonical pinned PREPARE-to-READY receipt and the
newest 127 ordinary entries. Fresh current-sequence disposition and exact
completed replay succeeded without duplicate effect. Duplicate and foreign
pinned-receipt corruption failed decode; stale sequence, changed receipt,
expired authorization, and ambiguous fresh retry failed closed.

The previously accepted Packet 05A2c2 P3 remains open: retained `.closed.*`
socket evidence still needs an explicit privileged retention, archival, and
cleanup procedure. Packet 05B1b2+ also remains open for the privileged native
target listener/relay and pathname lifecycle, any SSH bridge, real Docker/
engine and target filesystem/volume/network adapters, credentials and secret
injection, systemd/signed-role/bundle/source-free packaging, decrypt/import,
application reconciliation, validation, promotion/rollback, successful-
restore hold release, and live topology, RPO/RTO, load/stress/soak, failover,
and production rehearsal evidence.
