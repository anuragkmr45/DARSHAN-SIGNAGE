# Backup recovery Packet 05B1b3b2a developer verification — 2026-10-29

## Result and exact boundary

Implemented the native authority/locking/private-channel and helper
process-lifetime foundation. Production remains unavailable and selector-free:
`recovery-target-helper-worker.ts` still constructs
`UnavailableRecoveryTargetEngine`. Accepted engine-journal code and bytes were
not edited. No Docker/Podman/Compose, daemon, live/network/SSH service,
production private key, credential value, decrypt, import, or restore operation
was invoked.

The native fixture is compile-gated and uses temporary owner-only directories,
unnamed Unix socketpairs, forked local fixture processes, and synthetic fixed
identities. The TypeScript client tests are scripted in-memory descriptor
fixtures. Neither boundary is production installation evidence.

## Implemented foundation

- A persistent single-link mode-0600 empty authority anchor is held by
  `F_OFD_SETLK`. Directory and inode owner/group/mode/device/identity are
  checked before and after lock. Existing empty anchors without a valid state
  fail closed. Monotonic state uses no-clobber O_TMPFILE INTENT/COMMIT records
  with file/directory fsync rather than in-place truncate or overwrite. The
  implementation contains no unlink,
  rename-based reclaim, PID/boot stale detection, or pathname claim protocol.
- The capability channel is an unnamed non-listening Unix `SOCK_SEQPACKET`
  descriptor with kernel `SO_PEERCRED`. Native code independently compares the
  exact enrollment and request bindings; worker claims cannot authorize it.
- The bounded fixed-order protocol includes exact installation/site/host,
  operation/recovery generation/target, profile/enrollment/admission,
  outer-envelope/request/authorization, deadline, authority-instance,
  supervisor-generation, reconciled-generation, and fresh 128-bit challenge
  bindings. Seen challenges are durable and cannot be reused. Sanitized output
  contains only an opaque session, lease proof, fixed authority identity and
  status.
- Mutation is fenced until the native enrollment and exact request both reach
  the current supervisor generation. The persistent record rejects
  same/lower-generation instance rollback and reconciliation rollback.
  Readonly inspection can advance a monotonic restart while reporting
  reconciliation required. A peer-death path closes retained session and OFD
  authority descriptors. Native and TypeScript paths recheck deadline/
  cancellation after awaited or publication work, and the client verifies the
  lease proof over the immutable parsed request frame/session token before
  acceptance. Release is serialized and compares the lease's immutable handle
  before clearing active state.
- The helper listener is now a child subreaper and manages per-worker process
  groups across direct-child exit. Shutdown drains, signals negative PGIDs with
  TERM then KILL, and independently discovers adopted descendants by PID/start
  identity, including detached `setsid` children. Authority release requires
  affirmative `waitpid(-1) == ECHILD` plus a successful child-discovery,
  identity, and group-liveness sweep; zero bookkeeping counters are not proof.
  Discovery errors persist an unknown-descendant fail-stop state while known
  identities remain retained, and only exact known identities are signaled.
  It kills/reaps descendants and proves negative liveness before release.
  Capability clearing, privilege drop,
  no-new-privileges, and close-range behavior remain.
- Process cleanup is not evidence that an already accepted daemon/kernel/remote
  effect did not happen. Any future mutation requires authoritative
  reconciliation under the restart fence.

## Developer verification

- Native engine-authority fixture: **37/37 checks passed** under
  `-std=c11 -O2 -Wall -Wextra -Werror`.
- Native helper listener: **18/18 Node subtests passed**, including attached,
  detached, and nested detached TERM-resistant descendants, injected discovery
  failure after parent reaping, affirmative negative-liveness proof, orphan
  reaping, and inherited-FD closure.
- TypeScript native-authority contract/client: **16/16 tests passed**.
- App, scripts, production-CLI, and explicit recovery-test TypeScript no-emit:
  **passed**.
- Full serialized recovery regression: **361/361 passed across 22/22 files**.
- Native predecessor regression: storage-authority **1/1** and relay **6/6**
  Node subtests passed.
- Touched TypeScript ESLint with `--max-warnings=0`: **passed**.
- Backend `npm run build`: **passed**.
- Strict standalone C compilation for the new authority and hardened helper
  listener under `-std=c11 -O2 -Wall -Wextra -Werror`: **passed**.
- Touched whitespace, forbidden authority-surface, secret/private-key sentinel,
  unavailable-production-selector, and static no-unlink checks: **passed**.

Accepted predecessor evidence remains byte-identical at:

- 05B1a: `81d83a487627bfcbe21c193b77004dc69826a9cdb5db0c34351df1a944acae06`
- 05B1b1: `f4510808fc8e7e949048eeab114eb4dc892860152d9592be7832fe374f144ccf`
- 05B1b2a: `997d991f7555307e4b4252fd0b253d76c2166c313bc257842959910e6e775f8e`
- 05B1b2b: `309ca639511a75acd9dd924f0ca1707e2fd34e807d073271cae0a97dd091e9b3`
- 05B1b3a: `41a596e60c2a1fce78a14f1e19fe42752b2b5164d2de902494c56fc48bf55115`
- 05B1b3b0: `0890dde083320677c42050162c7182b2ac9a3be532136ed2ae144d677b5e0fd0`
- 05B1b3b1a: `81fb223e71bba859e821371400fd817cf32f8a5f6bb540f2547732bd822d6e17`
- 05B1b3b1b: `a5c0efc93d9e1985f79395218405792d2ba65c0d9b1502b921e9b5883b20204b`

The accepted constrained-engine/journal files were not edited. Their retained
verification digests are `0c15a6ec…` for the constrained engine,
`a5bb3a30…` for the journal, `dedc4572…` for the constrained-engine tests, and
`de9cfead…` for the journal tests.

## Independent review and acceptance status

The first independent review reported four P2 findings: a same-generation
exact-response replay was not rejected by the TypeScript client; post-acquire
cancellation and failed release could lose the only live session handle;
deadline freshness was not rechecked after awaited/native publication work;
and the prior persistent instance/generation record was parsed but not used to
prevent restart rollback or requester-only reconciliation.

All four were corrected with direct regressions. The client now recomputes the
native lease proof over the exact encoded frame and session token, releases a
known post-acquire handle on failure, retains failed-release state for explicit
retry, and invalidates an unknown-handle private descriptor. Both layers recheck
deadline/cancellation after their await/publication boundary. The native record
now enforces monotonic instance/generation/reconciled-generation transitions
and requires native enrollment reconciliation before mutation.

A fresh independent rereview ran the corrected native and TypeScript suites
(**34/34** and **13/13**) and found no remaining P1/P2 at that stage.

A subsequent root ultra review identified five additional P2s: the durable
record still had an empty/truncate crash window; lease release was not scoped
to one immutable handle under stale/concurrent calls; adopted `setsid`
descendants could escape the original PGID; the client consulted the caller's
mutable request after await; and identical released responses lacked a fresh
single-use acquisition challenge.

The final correction replaces in-place state with durable v2 INTENT/COMMIT
publication and eight injected crash boundaries, adds exact per-handle release
serialization, freezes a canonically parsed request before dispatch, adds a
client-minted/native-seen 128-bit v2 challenge, and independently tracks
detached adopted descendants by PID/start identity. A new independent read-only
rereview ran native authority **37/37**, TypeScript **16/16**, and helper native
**17/17**, and found **no open P1/P2** at that stage.

Final acceptance review then identified one helper-lifetime P2: after the last
tracked adopted parent was reaped, a child-discovery error could leave zero
bookkeeping counters and allow authority release without affirmative kernel
child-liveness proof. The helper now persists unknown-descendant state and
holds authority until `ECHILD` plus a successful discovery/identity/group sweep.
A deterministic regression reparents a nested detached TERM-resistant child at
the injected discovery-error boundary, proves the competing listener remains
fenced, restores discovery, and verifies the child is killed/reaped before
exit. Normal TypeScript construction also retains mandatory CSPRNG challenge
minting; deterministic mint/clock injection is restricted to the explicitly
test-only fixture factory. A fresh final-state independent rereview confirmed
every parent path after authority acquisition, including early signal and bind
failure, enters the shared affirmative negative-liveness proof before authority
close; it found **no open P1/P2** and independently reran helper **18/18** and
TypeScript **16/16**. Packet
05B1b3b2a is accepted only for the local native/process fixture and scripted
client foundation described above.

Packet 05B1b3b2b remains the constrained native engine/evidence/attestation
adapter gate. Decrypt/import, authenticated
application readiness, restored-data reconciliation/validation,
promotion/rollback, release, live topology, load/soak, RPO/RTO, failover, and
production rehearsal remain later gates and are not claimed.
