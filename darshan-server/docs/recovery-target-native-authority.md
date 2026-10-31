# Recovery target native authority foundation (Packet 05B1b3b2a)

Packet 05B1b3b2a adds only the native authority, protocol, lock, and helper
process-lifetime foundation required before a constrained engine adapter could
be installed. Production remains unavailable. The production helper worker
still constructs `UnavailableRecoveryTargetEngine`; there is no engine
selector, signed-role installation wiring, Docker/Podman invocation, daemon
endpoint, credential materialization, decrypt, import, or restore path.

## Native lease authority

`recovery-target-engine-authority.{c,h}` owns the fixed empty
`engine-authority.lock` anchor inode through an open-file-description
`F_OFD_SETLK` write lock. The containing directory and lock inode are validated
by descriptor for exact type, owner, group, mode, link count, device, and
post-lock pathname identity. An existing anchor without valid durable state is
never treated as new. Symlinks, multiple links, substituted inodes,
unsafe owners/modes, corrupt prior records, and lock contention fail closed.
The persistent name is never unlinked or reclaimed using a PID, boot ID,
pathname claim, or stale-owner heuristic. Kernel close/process death releases
the OFD lock.

Supervisor state is never rewritten or truncated in place. Each monotonic
instance/generation/reconciled-generation transition publishes fixed-name
INTENT and COMMIT records through `O_TMPFILE`, no-clobber `linkat`, file fsync,
and directory fsync. A partial or conflicting record fences older mutation;
only the exact pending higher transition can resume. Compile-gated faults after
every link, directory-fsync, write, and file-fsync boundary prove a generation-8
attempt cannot make generation 7 eligible again.

The authority accepts only an unnamed private Unix `SOCK_SEQPACKET`
descriptor, verifies `SO_PEERCRED`, rejects listening/pathname sockets and
non-socket descriptors, and independently compares the request with its fixed
native enrollment. A worker assertion about its UID, channel, installation, or
enrollment is not authority. The compile-gated fixture uses the same kernel
peer and OFD checks with fixture uid/gid ownership.

The additive fixed-order, newline-terminated v2 protocol is bounded to 4096 request
bytes and 1024 result bytes. It has exactly three operations: `INSPECT`,
`PREPARE`, and `STOP_RETAIN`. It binds installation, site, host installation,
operation, recovery generation, target set, opaque target handle, profile,
enrollment, admission, outer envelope, request, authorization, deadline,
supervisor instance, supervisor generation, reconciled generation, and a fresh
128-bit client challenge that cannot be supplied or reused by the caller.
Unknown, missing, reordered, partial, trailing, oversized, noncanonical, or
substituted fields reject before a lease is returned.

Results expose only an opaque session handle, lease-proof digest, authority
instance, supervisor generation, readonly/leased outcome, and reconciliation
flag plus the exact challenge. The native authority durably records every seen
challenge before granting a lease, so a released response cannot be replayed
for an identical request. No caller path, executable, argv, daemon endpoint, environment,
credential value, generic exec/remove operation, or PURGE operation exists.
Mutation requests require both the request and the native enrollment's
authoritative reconciled generation to equal the current supervisor generation.
The persistent record rejects different-instance same/lower-generation rollback
and reconciliation rollback; a higher-generation restart may first obtain only
a reconciliation-required readonly `INSPECT` lease. A later native enrollment
advance can authorize mutation. Peer death can be polled by the supervisor and
closes the captured session descriptors before authority release. Deadline and
cancellation are checked again after native publication work and the
TypeScript client verifies the lease proof over an immutable canonical request
snapshot and exact session token. Release is serialized and scoped to the
lease's captured handle; a stale release cannot clear a newer lease.

`target-native-authority-contracts.ts` is the strict TypeScript mirror and
`target-native-resource-authority.ts` is a narrow descriptor-shaped client for
a future constrained native adapter. Neither is selected by production.
Normal client construction always mints challenges with
`crypto.randomBytes(16)` and reads the real clock. Deterministic clock and
challenge injection is exposed only by the explicitly named `createTestOnly`
in-memory-fixture factory; it is not a runtime configuration or adapter seam.
Accepted engine-journal bytes and state transitions are unchanged.

## Helper process lifetime

The helper listener now matches the accepted relay lifetime design. It is a
child subreaper; parent and child both establish one process group before the
fork gate; the direct-child slot remains retained after direct-child exit while
the group exists; adopted descendants are independently discovered from the
subreaper, fenced by PID plus process-start identity, and reaped even if they
detach with `setsid`; shutdown drains, sends TERM
to the negative PGID, then bounded KILL. Bookkeeping counters reaching zero do
not authorize release: a persistent unknown-descendant state is cleared only
after `waitpid(-1, ...)` returns `ECHILD` and one successful `/proc` child,
PID/start-identity, and process-group sweep affirmatively proves no adopted
descendant or retained group remains. Discovery errors retain known identities
and fail-stop with the authority held; only known matching identities are ever
signaled. Worker exec still
closes unrelated descriptors, drops the capability bounding set and effective
capabilities, clears ambient capabilities, drops uid/gid, and sets
no-new-privileges.

This cleanup proves only process-group termination and reaping. It does not
prove absence of an effect already accepted by a daemon, kernel service, or
remote system. Future mutation replay must use the supervisor instance and
generation fencing plus authoritative reconciliation.

## Exact boundary

Native tests compile locally with a fixture macro and operate only on private
temporary directories, unnamed socketpairs, forked fixture processes, and
synthetic identity bytes. TypeScript tests use scripted in-memory descriptor
channels. No Docker/live service, network/SSH, production key, secret,
decryption, import, restore, application validation, promotion/rollback, hold
release, or production installation is exercised or claimed.

Packet 05B1b3b2b remains the constrained native engine/evidence/attestation
adapter gate. Later recovery-validation work remains responsible for
decrypt/import, authenticated application readiness, restored-data
reconciliation, and promotion/rollback. Packet 05B1b4 remains the signed-role,
source-free installation and service-wiring gate.

Packet 05B1b3b2b1 now adds the separately documented fixed local-fixture
executor and durable materialization foundation. It does not change this
accepted authority protocol or install/select a production engine. Real daemon
credentials/readiness remain Packet 05B1b3b2b2.
