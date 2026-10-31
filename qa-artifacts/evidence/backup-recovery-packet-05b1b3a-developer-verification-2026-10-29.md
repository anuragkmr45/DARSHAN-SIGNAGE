# Backup recovery Packet 05B1b3a developer verification — 2026-10-29

## Safety boundary

Verification used canonical JSON fixtures, generated disposable Ed25519 test
keys, ordinary temporary directories behind a compile-time-only native test
gate, and local child processes. It did not mount a filesystem, invoke Docker
or another container engine, access a live network or SSH service, load a
production private key, decrypt data, import a backup, or restore data.

Production continues to instantiate `UnavailableRecoveryTargetEngine`. This
packet cannot emit READY, STOPPED_RETAINED, or RETIRED effects; the public
checkpoint remains `TARGET_NOT_INSTALLED`.

## Implemented evidence and authority

- Five strict canonical signed public-evidence formats cover host policy,
  engine profile, storage inventory, protection inventory, and capacity.
  Envelope content addresses include the signature. U64 values are canonical
  decimal strings. Public verification checks Ed25519 trust, key/document
  revocation, validity, canonical ordering, and exact site/host/operation/
  generation/target-set/specification/release bindings.
- The protected loader accepts only `<sha256>.json` directly beneath the fixed
  enrolled owner-only root and reuses the stable-inode, no-follow, bounded
  protected-file reader. The five-document DAG has one exact capacity root,
  four exact leaf dependencies, no extra edges/cycles, consistent time and
  revocation order, matching authority/profile identities, and conservative
  admission arithmetic.
- Installed identity v2 binds evidence, allocation-ledger/control, active,
  quarantine and pool root identities, storage-authority identity, and host
  mode. V1 remains exactly readable for historical audit but cannot construct
  an effect-eligible storage context. The native listener passes every v2
  identity as a fixed value and retains them in its OFD authority record.
- Engine calls now carry the strict request, original authorization-envelope
  bytes, authorization digest, absolute deadline, and AbortSignal. The worker
  no longer races an effect promise against a timer; it aborts through the
  adapter contract. Production remains the bounded fail-before-effect adapter.
- The strict C storage library exposes fixed operations/components and
  compile-time uid/gid/modes, never caller paths or identity values. It provides
  checked conservative capacity, 256-bit nonces, full target-set allocation
  names, root-owned OFD authority, exact allocation-tree validation, kernel
  SHA-256 checked append-only no-clobber ledger records, bounded hash-chain
  validation, pending-temp retention, and ledger-derived same-device no-clobber
  quarantine with source/destination verification and both-parent fsync.
- Production enrolled-root probing rejects unsafe ownership/mode, read-only and
  non-ext4/XFS candidates, then deliberately returns `ENOTSUP`: this portable
  implementation cannot prove a stable filesystem UUID plus enforced quota and
  does not fake either. Disposable ordinary directories are admitted only when
  `TARGET_STORAGE_AUTHORITY_TESTING` is compiled in.
- Static scan confirms the production storage C module has no unlink, rmdir,
  remove, system/exec, or PURGE call/operation.

## Three verification loops

### Normal loop

- New TypeScript authority/evidence tests: **7/7 passed**.
- Existing one-shot production-worker tests, updated for installed identity v2
  and retained unavailable engine: **5/5 passed**.
- Strict native storage fixture: **1/1 Node test passed**, containing **28/28
  C checks** for capacity, overflow, nonce/name, compile gate, exact tree,
  unexpected symlink/hardlink/FIFO/socket/device/nested-object gates, repeatable
  offset-independent validation, canonical ledger transitions, initial-receipt
  rejection, hash-chain/no-clobber, ENOSPC/rename pending evidence, conflict,
  ledger-authorized quarantine, marker binding, and exact replay.

### Adversarial loop

- Native storage source compiled in both test-gated and production modes with
  `-std=c11 -O2 -Wall -Wextra -Werror`: **passed**.
- Protected content-address mismatch, signature/key revocation, v1 effect
  refusal, v2 missing field, u64 overflow, arbitrary native request field, and
  caller-supplied quarantine authority cases: **passed** in the 7 storage tests.
- Existing native helper/listener/forced-command regression after authority-v2
  enrollment: **14/14 passed**.
- Touched TypeScript ESLint with zero warnings, production-cli no-emit, scripts
  no-emit, tracked whitespace check, and static no-delete/PURGE scan: **passed**.

### Regression loop

- Full serialized recovery regression: **261/261 tests passed across 18/18
  files**.
- Backend `npm run build`: **passed**.

## Native correction closeout

The independent review's five native P2 reproducers are closed. Directory
walks use independently opened `openat(fd, ".")` descriptions whose dev/inode
match the retained descriptor, so validation is repeatable and never advances
the caller offset. Allocation markers are exact canonical target-set/nonce/
basename records; allocation and component owner/mode/device/mount identities
are checked and the pre-engine component trees must be empty.

Ledger entries now use the same fixed canonical line protocol in C and
TypeScript. Stable bounded reads prove size+1 EOF, no embedded NUL, unchanged
metadata, canonical re-encoding, filename sequence/digest, previous digest and
the fixed INTENT/RECEIPT transition table. Exact final records are checked
before pending creation; exact replay returns the unchanged receipt, conflicts
fail, and retained pending records are ambiguous. Quarantine accepts no caller
boolean, digest, path, uid/gid or executable authority: it derives only from
the exact contiguous pre-engine ALLOCATE receipt, appends RETIRE_INTENT, verifies
the source, uses no-clobber rename, reopens/verifies the destination and source
absence, fsyncs both parents, and appends the receipt. Completed quarantine
replay revalidates retained state and returns the same receipt.

The second rereview's identity and parent-binding findings are also closed.
Every record carries installed/site/host/policy/profile/specification/evidence,
target-set/nonce/basename/marker, reservation id/bytes/inodes, request/body/
authorization, source and active/quarantine parent identities. One explicit
immutable comparator is used by validation and append; the fixture changes each
field independently and proves rejection before a pending name appears.
Completed and fresh quarantine both require exact owner/mode/dev/ino/mount
parent identities, and the receipt binds the destination dev/ino/mount.
Filename parsing is positional rather than `sscanf`: fixed width, decimal
digits, lowercase hex, exact suffix, canonical reconstruction, and full-byte
comparison are required; width, case, suffix, trailing-byte and uppercase-hex
negative fixtures fail closed.

## Explicit limits and release gates

The local fixture does not prove privileged root-to-service uid/gid behavior,
real dedicated mount identity, stable filesystem UUID acquisition, project
quota enforcement, mountinfo replacement races, read-only remount races,
every nested submount/alias topology, device-full kernel behavior beyond the
injected ENOSPC branch, every fsync/rename crash interleaving, or sustained
ledger/load/soak behavior. Production correctly refuses enrollment while the
UUID/quota proof is unavailable.

No Docker/Podman target engine, container/volume/network creation, target
startup, secret injection, decrypt/import/restore, application reconciliation,
validation, promotion, rollback, successful hold release, deletion, or PURGE
authority is installed. Privileged dedicated-filesystem fixtures, real
filesystem/quota probes, source-free role integration, live topology, RPO/RTO,
load/stress/soak, failover, and production rehearsal remain explicit future
gates.

## Independent acceptance closeout

Independent rereview **ACCEPTED** Packet 05B1b3a with no open P1 or P2
findings. The accepted corrected evidence is:

- strict native storage authority fixture: **28/28 checks**;
- focused storage/worker TypeScript suites: **12/12 tests**;
- immutable-binding matrix: **25/25 individual field mutations rejected**
  before pending, ledger, or rename mutation;
- strict filename/record fixtures: **10/10 malformed variants rejected**,
  including width, case, suffix, trailing bytes, uppercase hex, noncanonical
  body, initial receipt, orphan/mismatched transition, and pending ambiguity;
- the original shared-directory-offset, quarantine-authority, unsafe-tree,
  ledger-schema/transition, and exact-replay reproducers are all rejected or
  reconciled with the reviewed definite result.

Remaining P3 coverage is explicitly open for privileged root-to-distinct-user
execution, real dedicated mount and mount-replacement behavior, complete
`statx`/mount-id portability, stable filesystem UUID and quota enforcement,
read-only remount races, exhaustive kernel ENOSPC/fsync/rename crash ordering,
and live load/soak behavior. Production still uses
`UnavailableRecoveryTargetEngine` and cannot publish READY,
STOPPED_RETAINED, or RETIRED target effects. Packet 05B1b3b remains open for
the next engine/resource authority scope; Packet 05B1b4 remains open for
signed-role/source-free packaging and installed-content integration. Live
topology, RPO/RTO, failover, decrypt/import/restore, reconciliation,
validation, promotion/rollback, successful hold release, and production
rehearsal remain release gates.
