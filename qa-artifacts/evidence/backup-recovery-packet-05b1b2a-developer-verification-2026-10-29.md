# Backup recovery Packet 05B1b2a developer verification — 2026-10-29

## Scope and safety boundary

Implemented the Data-host native helper listener, native lifetime instance
authority, compiled one-shot Node worker, and fixed local stdio bridge. All
execution was limited to temporary local Unix sockets, deterministic fake or
unavailable engines, compiled native fixtures, and protected temporary files.
No Docker, live/system service, SSH, external network, decrypt, import,
restore, production private key, or privileged installation was run.

## Implemented boundary

- The no-argument native supervisor is the only helper-socket pathname writer.
  Paths, identities, pinned Node/worker, site, installation and digests are
  compile/install-time values. Protected ancestors use `openat2` no-symlink and
  no-magiclink resolution. Existing entries fail closed and are never unlinked.
- `SO_PEERCRED` requires the exact bridge uid. Backlog and live children are
  four. Each stream gets one child with stdin/stdout only, closed descriptors,
  cleared groups, helper uid/gid, NNP, and fixed `execve` argv/environment.
- Blocked TERM/INT drive synchronous shutdown: stop admission, bounded drain,
  TERM/KILL/reap, then exact no-clobber socket preservation plus fsync.
- A protected OFD-locked authority file is held from pre-bind through final
  preservation. Its strict fsynced record binds random token, site,
  installation, policy/listener digests, boot identity, pid and start ticks.
- Only the exact strict prior-token helper lock with safe metadata and no live
  pid may be reconciled. It is retained with `RENAME_NOREPLACE` plus fsync;
  legacy, corrupt, live, unsafe and unbound state stops startup.
- The journal supports a native authority token and production-required mode
  while preserving historical tokenless fixtures. The one-shot worker enforces
  one 64 KiB newline+EOF request, bounded idle/5-second frame/action deadlines,
  and one 128 KiB response. Production returns stable
  `TARGET_NOT_INSTALLED`; only tests inject the deterministic fake engine.
- The no-argument stdio bridge connects only to its compiled local socket and
  has bounded request/response, timeout, stdout/stderr and exit behavior.

## Verification results

- Strict C11 `-O2 -Wall -Wextra -Werror`: passed for both native sources.
- Compiled listener/bridge fixture suite: **13/13 passed** (round-trip and child
  identity, peer rejection, authority contention, hung-child drain/reap,
  stale/legacy lock behavior, crash evidence, unsafe parent, corrupt record).
- New worker/journal: **5/5**; accepted foundation: **45/45**; accepted
  trust/transport plus installed identity: **50/50**.
- Full serialized recovery: **240/240**, **16/16 files**.
- Backend and scripts TypeScript no-emit, touched ESLint, backend build, strict
  native compile and diff whitespace checks: passed.

## Explicit untested native branches

The local fixture does not prove privileged root-to-distinct-uid/group drops,
supplementary-group clearing under the final production capability mask,
user-namespace capability permutations, fork/exec allocation failure,
`getrandom`/fsync/close-range kernel failure, sustained accept-flood fairness,
all four children simultaneously active, socket/authority mount replacement,
hardlink and no-clobber collision exhaustion, real TERM/INT delivery at every
instruction boundary, or a real service-manager/PID-1 environment. These are
fail-closed code paths and remain explicit QA/release gates.

## Later gates

05B1b2b owns Backend SSH/forced command; 05B1b3 owns Docker/engine and target
resource effects; 05B1b4 owns systemd, signed-role/source-free bundle and
verifier integration. Decrypt/import, reconciliation, validation,
promotion/rollback, hold release, live topology, RPO/RTO, load/failover and
production rehearsal remain open.

## Independent-review correction loop

The first result was rejected with four P2 findings and one P3 hardening
finding. The corrected result remains subject to independent rereview.

- Pending TERM/INT is now consumed after authority fsync before bind, before
  each admission, immediately before fork and after fork. A child gate prevents
  exec before the post-fork decision. Deterministic authority and fork boundary
  pauses prove no worker runs after the tested pending signal.
- The stdio bridge is nonblocking end to end, handles EINPROGRESS with SO_ERROR,
  uses one absolute monotonic deadline through connect and stdout, and suppresses
  SIGPIPE. A deliberately 4 KiB undrained stdout pipe proves bounded failure.
- Production loads a fixed protected canonical installed identity and checks
  site, installation, policy, helper role and engine profile against both the
  native-fixed identity and every envelope before and under the journal lock.
  Foreign identity leaves no journal directory or fake-engine effect.
- Authority token and helper UUID parsing use direct byte predicates. NUL and
  nonhex substitution at every token/UUID hex position, plus short/extra
  authority bytes, fail unchanged.
- Existing authority entries are validated without chmod/chown; only a new
  O_EXCL file is initialized. Child capability bounding, permitted, effective,
  inheritable and ambient sets are explicitly cleared before exec.
- Production engine injection was removed. Any future effectful adapter is
  gated on AbortSignal-aware bounded abort-and-join. Response output shares the
  action completion deadline.

## Second independent-review correction loop

- Production factory comparison now uses an explicit identity projection; the
  config format is independently enforced by the strict schema. The real
  factory succeeds with protected canonical identity/keyring fixtures and
  rejects site, host, policy, role, profile, enrolled specification-root and
  format mismatches before any request or state.
- SIGPIPE is ignored before fork, the child pid enters the bounded child table
  before any fallible gate operation, and gate EPIPE enters normal stopped
  cleanup. A deterministic child-before-gate exit proves controlled exit 78,
  bounded reap, no orphan and preserved socket evidence.
- The strict outer envelope now carries the enrolled specification-root
  identity. The controller derives it from its fixed canonical root and the
  helper verifies it at screen and lock. It is not a directory-content digest;
  signed bundle content verification remains the explicit 05B1b4 gate.

## Independent acceptance closeout

Independent rereview **ACCEPTED** Packet 05B1b2a with no open P1 or P2
findings. The accepted local evidence is:

- native listener/bridge adversarial fixtures: **13/13**;
- production one-shot worker/factory fixtures: **5/5**;
- target trust, authorization and transport fixtures: **50/50**;
- accepted target foundation fixtures: **45/45**.

The original production-factory identity-comparison reproducer and the
child-before-gate/SIGPIPE reproducer both pass in the final code. The enrolled
specification-root identity is carried by the strict public envelope and
checked during both gateway authorization passes. Verification of the actual
installed root's directory-content digest remains Packet 05B1b4 and is not
claimed by this acceptance.

The accepted Packet 05A2c2 retained socket-evidence operability P3 remains
open: privileged retention, archival and cleanup policy for `.closed.*`
evidence still requires release-operability closeout. Packet 05B1b2b remains
open for Backend SSH/forced-command relay; Packet 05B1b3 for Docker/engine and
real target resource effects; Packet 05B1b4 for systemd, signed-role,
source-free bundle and installed-content verification. Decrypt/import,
application reconciliation, validation, promotion/rollback, successful hold
release, live topology, RPO/RTO, load/stress/soak, failover and production
rehearsal also remain explicit later gates.
