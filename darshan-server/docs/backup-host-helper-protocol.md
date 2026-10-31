# Backup broker protocol v2 (Packet 3 bounded implementation)

## Security boundary

The production target is a separate `backup-broker` container made from the
offline backend image. It owns the local repository, dedicated Ed25519 signing
key, signed capsule policy/active marker and immutable pre-encrypted
`configuration.tar.age`. It has no network, Docker socket or host PID access.
The worker receives a writable spool, the private Unix-socket mount, the public
age recipient and the manifest verification key ring. The API receives none of
those mounts. The private age identity remains outside all application VMs.

The image now ships `npm run start:backup-broker` and the pinned, single-file,
dependency-free `/usr/local/libexec/darshan-backup-bridge`. The bridge only
transports protocol-v2 JSON to `DARSHAN_BACKUP_BROKER_SOCKET`; it rejects other
protocol versions, unknown operation names and generic `path`, `command` or
`payload` fields. It does not run a shell or accept a destination/source path.

The broker creates a private Unix socket with an explicit mode (production
contract: `0660`) and optional uid/gid. Node's standard `net.Socket` API does
not expose Linux `SO_PEERCRED`, so this bounded implementation relies on a
private socket bind mount plus filesystem owner/group/mode. Per-connection
kernel peer-credential inspection remains a production hardening gate unless a
small reviewed native transport is introduced.

Packet 5A2c2 adds an optional second listener to the same service rather than a
second broker or authority. Its recovery allowlist is exactly the four restore
hold operations. Forbidden operations are rejected after strict parsing but
before request identity, replay, hooks, queue, authority, or journal work, so a
request id rejected there creates no replay state and remains usable on the
main endpoint. The recovery listener is capped at 8 KiB, four concurrent
accepted connections, and a five-second incomplete-frame timeout. Both socket
paths are bound transactionally and tracked by exact device/inode identity.
Each server binds the fixed `.broker-bind` name inside its canonical owner-only
parent, publishes the same socket inode at the public name, then immediately
unlinks the private name. Close proves the private name is still absent before
calling Node; a recreated file/socket/symlink fails stopped without unlink or
authority release. Shared readiness prevents processing until both
listeners and metadata are complete. Shutdown closes both acceptors, drains
accepted request promises (including disconnected clients) and the journal
queue while retaining authority, then removes only exact owned sockets and
releases authority.

## Framing and bounds

One connection carries exactly one UTF-8 JSON object followed by one newline
and a client write-half-close. The broker uses `allowHalfOpen`, waits for EOF,
then rejects missing/trailing/second frames before async work; the response side
remains open until the bounded operation completes.
Requests are at most 2 MiB (including a policy-bound manifest-v2 payload capped by its parser
at 1 MiB); responses are at most 24 MiB (the encrypted capsule is capped at 16
MiB at broker startup). Unknown/missing fields,
duplicate JSON object names, invalid UTF-8, trailing content and a second frame
are rejected. DESCRIBE/SELECT/INSPECT controls have an immutable future RFC-3339
deadline no more than 60 seconds from broker receipt; mutating PREPARE/COMMIT/
QUARANTINE operations may use the immutable backup attempt deadline up to four
hours. Disconnect before frame EOF cannot dispatch;
socket error/full close and the immutable deadline abort in-flight work.

Every request binds protocol version 2, fixed operation, exact lowercase RFC
4122 version-1-through-8/variant-8,9,a,b UUID request id, exact helper version
and signed-policy SHA-256, site/repository identity and immutable deadline. The
same exact UUID contract applies to repository, run, attempt, capture, operation,
owner, and fence fields in requests and responses; uppercase, nil, version-0/
version-9, and invalid-variant aliases fail parsing. Run-scoped operations
additionally bind run, attempt and capture UUIDs
plus positive capture generation. Capsule selection binds expected capsule
generation and digest. Publication operations separately bind the canonical
unsigned manifest SHA-256 and final signed manifest SHA-256 used by the existing
repository/DB publication format. The broker
derives all paths; there is no command, arbitrary path or arbitrary signing
payload operation.

## Fixed operations

- `DESCRIBE` returns active capsule identity, exact bounded configuration
  contract and the retained public Ed25519 verification key ring.
- `SELECT_CAPSULE` returns only the already-encrypted capsule plus a signed
  active marker.
- `PREPARE_PUBLICATION` carries a bounded manifest-v2 payload. The broker uses
  the existing strict parser, requires `signature: null` and byte-for-byte
  canonical unsigned serialization, re-hashes it, binds repository/site/run/
  attempt/capture/generation plus release, age key and the exact active capsule
  descriptor (policy digest, capsule generation and encrypted-inventory digest),
  artifact, requires exactly `database/database.tar.age`,
  `objects/objects.tar.age`, and `configuration/configuration.tar.age` with no
  duplicate kind, `OTHER`, missing or extra artifact, then signs those canonical
  manifest bytes with Ed25519. A raw
  caller-chosen digest is never a signing input.
- `COMMIT_PUBLICATION`, `INSPECT_PUBLICATION` and
  `QUARANTINE_PUBLICATION` operate on that already-bound identity/digest.
- `INSPECT_RESTORE_HOLD` binds the complete site/repository/run/attempt/capture/
  generation/manifest/operation/owner/fence identity and returns only the exact
  operation id, manifest digest, and `ABSENT`, `ACTIVE`, `UNCERTAIN`, or
  `RELEASED`. A durable record under the same operation id with any changed
  identity fails with `BROKER_LIFECYCLE_FENCE_CONFLICT`; it is never reported
  as absent. It does not return aggregate hold counts or inspect repository
  artifacts.

Exact request-id replay returns byte-identical output. Changed request content
fails with `BROKER_REPLAY_CONFLICT`; a changed publication digest fails with
`BROKER_PUBLICATION_CONFLICT`.

Replay responses and publication state are stored under the validated repository
in a strict, repository-owned journal. Updates use a same-filesystem temporary
file, file fsync, atomic rename and directory fsync. A run id has one immutable
attempt/capture claim. State moves only `ABSENT -> PREPARED -> COMMITTED` or
`PREPARED -> QUARANTINED`; terminal states never regress. Exact completed replay
is served before deadline re-evaluation, covering a response lost at timeout.
Stateless DESCRIBE/SELECT/INSPECT reads are not written to the durable
request journal, so polling and large capsule reads cannot grow its bounded
snapshot. Immutable DESCRIBE and SELECT are served from startup state without
queuing behind a long publication mutation; repository-backed INSPECT remains
serialized with journal mutations. Mutating operations retain exact durable replay; large mutation
responses are reconstructed from the immutable journal plus verified repository
evidence and checked against the stored response digest.

Exact restore-hold inspection is also a non-replay, non-mutating socket read,
but it is deliberately queue-serialized with broker journal mutations. Its
read-only loader never creates or repairs `broker-journal`; an absent journal is
empty hold truth and produces `ABSENT`, while an unsafe/corrupt existing journal
fails closed. The response therefore has a transaction-order point relative to
acquire/release/uncertain/deletion work without reading physical backup content.
This broker query is independent of Packet 5A2a's stable file-snapshot discovery,
which remains read-only and does not claim serialization with broker writes.

## Capsule policy

The public signed v2 capsule descriptor binds site/repository identity, capsule
generation, creation time, ciphertext size/hash, release/deployment/
compatibility generations, age recipient key id, a fixed production contract
id, the encrypted inventory SHA-256 and the exact ordered deployed-role set.
Broker startup verifies the actual capsule size and digest. Secret paths,
per-secret content hashes, restore ownership/mode and size limits are kept
inside `configuration.tar.age`; they are not exposed by this public descriptor.
The encrypted inventory itself enforces the finite production contract and
excludes private age identity, release/manifest signing keys,
recovery-attestation keys and repository/prior-backup content while permitting
required runtime TLS private keys. Tests use a synthetic encrypted fixture.

## Current integration boundary

This slice implements and tests protocol, broker service, bridge, policy,
durable journal and a broker repository adapter. The adapter reads only
deterministic database/object ciphertext names below the identity-derived
read-only spool path, rejects symlinks/special files/hard links, verifies
device/owner/mode/stable inode/size/hash, copies into broker-owned incomplete
storage, supplies the active capsule, and reuses the existing fsync/read-back/
atomic-publication format. Attempt paths use an identity-derived deterministic
nonce; a retry validates and reuses an exact completed prepared tree or safely
recreates only its validated broker-owned partial tree. COMMIT first reconciles
verified repository truth, including identity, signed digest, artifacts and
receipt, so a crash after rename/receipt but before journal update converges.
Each prepared/published run also contains the canonical signed public capsule
descriptor as `configuration-policy.json`; it is metadata, not a fourth
artifact. The manifest remains exactly three encrypted artifacts and binds the
descriptor digest, capsule generation and encrypted-inventory digest. Repository
read-back verifies descriptor file safety and exact bytes against the externally
trusted startup descriptor, manifest binding, and configuration capsule
size/hash. COMMIT and committed INSPECT return the canonical signed manifest and
descriptor, durable intent and receipt, repository-relative paths and a
read-back-verified flag. INSPECT
fails closed when repository truth disagrees with journal state. Spool leaves are
opened nonblocking/no-follow, fstat type and declared size are checked before
streaming, and reads are capped at expected size plus one byte. Uncertain partial
prepared evidence is preserved for explicit reconciliation rather than deleted.
The brokered Packet-3 worker orchestrator constructs manifest v2 and validates
descriptor-bound publication evidence. Generated production compose is
intentionally not switched here.

Before activation, bundle generation must create/mount deployment policy,
capsule, policy trust, private signing key and retained public key ring; add a
`network_mode: none` broker with repository RW/spool RO/socket RW; change worker
to spool RW/socket/public trust only; and prove API has none of these mounts.
Worker spool production, broker service/mount wiring, crash fault injection at
every fsync/rename boundary and DB-0051 completion integration remain before a
production topology claim.

Protocol v2 now also has narrow, identity-bound lifecycle operations for
repository retention truth, restore holds, whole-run deletion, reconciliation,
and terminal staging cleanup. The worker supplies identifiers and stable
operation/owner/fence tokens, never a repository path. SQL retention is a
projection: the broker journal remains authoritative for holds, deletion
progress, and tombstones. Broker startup and lifecycle inspection open the
repository with zero publication reserve so low space cannot disable safe
deletion. `PREPARE_PUBLICATION` separately rechecks configured reserve plus the
bounded incoming ciphertext sizes immediately before repository writes.

`CLEANUP_STAGING` remains a broker-only callable primitive and is deliberately
not scheduled by Packet 4C1. Periodic invocation requires a durable SQL cleanup
operation/fence proving the exact attempt is terminal or revoked after
publication reconciliation. Missing database truth, unresolved publication,
unknown ownership, invalid clock, or unavailable broker authority must preserve
staging; age alone is never cleanup authority.
