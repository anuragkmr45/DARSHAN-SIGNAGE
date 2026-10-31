# Recovery foundation, isolated runtime, and target lifecycle (Packets 5A1 through 5B1a)

Packet 5A1 is a read-only recovery preflight and durable control-plane foundation. It does not provision targets, decrypt archives, import PostgreSQL/objects/configuration, reconcile application state, or promote services.

Packet 5A2a exposes only `discover` and `plan`. These commands do not acquire a restore hold, invoke the broker protocol, provision a target, decrypt data, connect to PostgreSQL/S3, import state, or promote services. The only permitted command-side write is the operator-selected, exclusive recovery plan output.

Packet 5A2b1 adds protocol and journal foundations only. It does not add an
operator hold command, runtime wrapper, target mutation, decrypt/import,
promotion, or live restore.

Packet 5A2b2b adds only reviewed, explicit pre-import closure of an exact
operation. `release` means an irreversible abort of that pre-import operation
followed by release of its exact hold. `abandon` irreversibly closes the same
operation and marks its exact hold uncertain/protected. `SOURCE_VERIFIED` never
means an import or restore completed. Packet 5A2c1 adds only the isolated
compiled runtime/import/cancellation boundary. Target mutation and a
successful-restore release gate remain Packet 5B work.

## Contracts

- Supported source classifications are `LOCAL_FILESYSTEM_V2`, `LOCAL_FILESYSTEM_V1_HELPER`, and `LEGACY_OFF_HOST`. Only an exactly trusted and compatible local source can be fully eligible. Legacy input can be classified but is never promoted to local full-recovery eligibility.
- Recovery operation, plan, run, owner, and fence identities are RFC 4122 UUIDs. Evidence digests are lowercase SHA-256. Plan bytes use canonical UTF-8 JSON with a trailing newline; the plan digest is over those exact bytes.
- Historical journal v1-v4 permits only `PLANNED -> SOURCE_HELD -> SOURCE_VERIFIED`. Journal v5 adds `TARGETS_PREPARED`, but only for plan v3 with an immutable target binding and an exact READY receipt. Every completion requires a prior durable intent.
- Recovery modules import no application configuration, database, S3, server, API, realtime, or job runtime. Migration manifest types, loaders, errors, and fingerprints live in the pure `deployment/migration-manifest` module; compatibility never value-imports the PostgreSQL/advisory-lock ledger, reads `DATABASE_URL`, adopts a ledger, or runs migrations.

## Protected journal

The caller supplies a pre-provisioned canonical `0700` root. Operations live under `operations/<operation UUID>/journal.json`; journal and lock files are `0600`, single-link regular files on the root filesystem. Journal/lock reads use bounded expected-size-plus-one descriptor loops and stable before/after identity checks, so concurrent growth is rejected without an unbounded `readFile` allocation. Writes use a sibling exclusive temporary file, file `fsync`, atomic rename, and parent-directory `fsync`. The envelope checksum detects malformed, truncated, or internally changed state.

Mutations acquire the site lock before the operation lock. Locks are exclusive owner records and are never stolen merely because time elapsed. A failed initial write removes only its exact newly-created empty operation directory, and failed lock initialization removes only the exact inode it created. Sequence, owner, fence, site, plan ID, and plan digest are checked on every mutation; the decoded operation ID must match its directory. Journal state contains identifiers, digests, phases, timestamps, and stable `RECOVERY_*` failure codes only; URLs, private keys, credential-like fields, and secret-like fields are rejected.

Packet 5A1/5A2b1 does not reclaim a lock after proving its process died. A process death after durable lock creation can therefore require later operator recovery/protocol work. If the first lock `fstat` fails, the file descriptor is closed but the unproven pathname is intentionally preserved; it cannot be safely unlinked without inode identity. Tests prove reopening durable journal state only after locks are absent; they do not prove automatic stale-lock recovery.

### Packet 5A2b1 scoped operation and failure evidence

`RecoveryJournal.withOperation` takes the site lock and then the exact operation
lock once, validates operation path, sequence, owner, fence, site, plan id, and
plan digest, and keeps both locks for the entire async callback. Broker calls and
source verification may therefore run inside one scope. The scoped object
serializes every accepted read and mutation through one per-scope queue,
advances its sequence guard after each durable write, and rejects new work as
soon as the callback settles. It drains accepted work while both locks remain
held and propagates accepted task failure even when the callback did not await
it, so no accepted write can run after lock release. Existing
short mutation methods remain available and use the same primitives; a competing
instance or nested short call receives `RECOVERY_LOCK_HELD` instead of waiting
or reacquiring the lock. Normal return and callback throw release the exact
operation and site locks. Abrupt process death is different: durable lock files
remain fail-closed and are not stolen by age or PID observation.

Packet 5A2b1 recovery operation journals wrote `darshan-recovery-operation-v3`. It keeps
v2's exact nullable failure disposition `DEFINITE_PRE_EFFECT` or
`AMBIGUOUS_EXTERNAL_EFFECT` and adds nullable
`lastReconciliationEvidenceSha256`. A definite failure clears `pendingPhase`;
an ambiguous external effect is valid only with a durable pending intent and
preserves it. Ordinary phase completion rejects ambiguity. Only explicit
`resolveAmbiguousPhase(target, evidenceSha256)` may atomically complete that
intent, clear ambiguity, and retain the bounded nonsecret evidence digest.
The v1 and v2 decoders each accept only their exact historical field set;
duplicate keys, noncanonical order/whitespace, missing trailing newline,
invalid UTF-8, and trailing data fail before checksum/version normalization.
Exact valid v1/v2 state normalizes to v3 and is written as v3 on its next
mutation; old state is not silently reinterpreted.

The broker's `INSPECT_RESTORE_HOLD` request carries the complete publication and
lifecycle tuple. It returns exact `ABSENT|ACTIVE|UNCERTAIN|RELEASED` truth for
that operation only, without aggregate counts or repository artifact reads.
It is queue-serialized with broker mutations but does not create/repair journal
paths or write request-id replay bookkeeping. Reusing an operation id with any
changed identity is a stable lifecycle-fence conflict, never absence.

## Source and trust

Recovery opens an already provisioned repository read-only. It checks canonical path, mount device, inode, uid, gid, exact modes, repository marker, single-link metadata, site, and repository UUID. Repository metadata is read through a bounded `O_NOFOLLOW|O_NONBLOCK` descriptor with a growth sentinel and before/after descriptor and pathname identity checks. Published run directories are validated before contained reads and again after verification. Intent and receipt files are protected bounded descriptor reads and must be duplicate-free canonical protocol JSON. Discovery/verification never calls the repository directory creation helper.

Selection requires an exact run UUID and signed-manifest digest plus the matching durable broker publication record. There is no latest selection, fallback, repair, or silent descriptor refresh. Per-run `configuration-policy.json` is verified by the retained deployment-policy keyring; the signed manifest is verified by the retained manifest keyring and bound to publication intent/receipt, site, repository, run, capture, policy, and capsule. Intent artifact descriptors must exactly equal the signed ordered descriptors, and every signed ciphertext is read and verified. Empty, missing, extra, reordered, duplicate, or mismatched intent entries fail closed. An embedded/decrypted signing key is never accepted as root trust.

`ACQUIRE_RESTORE_HOLD` uses the same historical per-run verifier. Capsule/key rotation therefore does not invalidate an older retained backup when its old policy and manifest verification keys remain explicitly trusted. The broker journal and mutation authority remain the only hold/deletion authority.

## Packet 5A2b2a operator workflow

The protected `darshan-recovery-operator-config-v2` extends the discovery/plan
configuration with exact broker transport metadata and a protected recovery
journal root. The v1 format remains accepted by `discover` and `plan`; commands
that can enter or inspect an operation (`hold`, `verify-source`, `resume`, and
`status`) require v2. Secrets are not accepted as CLI values or written to the
operation journal. Production transport checks the configured path is an
existing canonical non-symlink Unix socket with broker mode `0660` beneath a
canonical non-world-writable directory before every request.

`hold` reads the exact plan and expected digest, then revalidates the exact
publication, retained trust, compatibility, and release-owned target before it
creates operation evidence. It durably records `SOURCE_HELD` intent before one
atomic broker acquire using the journal's immutable operation/owner/fence
identity. A pre-dispatch failure or authoritative exact broker error is
definite. Any dispatched request without a trustworthy authoritative outcome is
ambiguous, including timeout, connection close, abort, oversized or malformed
response, response-identity mismatch, or a valid but wrong-operation response.
The command never releases a hold.

`verify-source` holds the site and operation journal locks across an exact
ACTIVE inspection, complete source revalidation, a second exact ACTIVE
inspection, and the local `SOURCE_VERIFIED` transition. Changed or corrupt
source evidence leaves the hold active. Read failures are definite; they are not
misclassified as ambiguous mutation effects.

`resume` reconciles a pending hold through exact inspection. ACTIVE is completed
only with canonical evidence bound to the inspected request, response, and plan;
ABSENT permits a retry with the same immutable lifecycle identity and a fresh
request identity/deadline. RELEASED and UNCERTAIN are fail-safe terminal review
conditions and are never reacquired. Pending source verification is repeated
between exact ACTIVE inspections before completion or evidence-bound resolution.

`status --offline` reports only exact plan and local journal truth and performs
no repository or broker access. Online status adds one exact read-only broker
inspection. Both forms omit owner and fence identities. There is no TTL, latest
source fallback, automatic release, abandon, restore, decrypt, import, target
provisioning, or promotion behavior in this packet.

## Compatibility and planning

`src/recovery/recovery-compatibility-registry.json` is the reviewed release-owned registry. Production runtime uses a compiled TypeScript mirror because clean `tsc` outputs neither copy JSON nor provide portable Node 20/22 JSON import semantics. A drift test parses the JSON through the exact registry validator and requires equality with the compiled mirror. The registry binds a release/source format/capsule compatibility generation to its terminal migration and backup ledger fingerprint. The fingerprint uses the same sorted length-delimited algorithm as backup capture: `length:id:checksum;` for every ledger row.

The source ledger must be a contiguous checksum-identical prefix of the explicitly supplied target migration manifest. Unsupported release/format, missing migration, future migration, changed checksum/fingerprint, manifest-policy release mismatch, and legacy ineligibility are stable `RECOVERY_*` outcomes. A successful decision feeds the read-only canonical plan builder; no target mutation occurs.

## Operational boundary

Production wiring must later provide the protected journal root, retained trust keyrings/publication evidence, migration manifest, and broker hold request. Packet 5A1 does not start the application and is not evidence of a live restore.

## Packet 5B1a target-lifecycle foundation

Plan `darshan-recovery-plan-v3` is additive. It preserves the exact v2 source,
release target, and compatibility identity, then binds a target preparation
generation, host installation UUID, topology mode, and retained SHA-256
evidence for host policy, helper role, engine profile, protection inventory,
capacity, storage inventory, and target specification. `targetSetId` is
SHA-256 over a domain separator and the canonical preparation identity with
`targetSetId` omitted; it therefore has no circular self-input. Exact v1/v2
meaning is unchanged, and old plans cannot prepare targets.

Journal `darshan-recovery-operation-v5` exactly decodes and normalizes v1-v4.
It adds an immutable target binding, READY receipt digest, helper sequence,
reconciliation digest, signed-disposition receipt, and an explicit
`importStarted: false` foundation guard. `TARGETS_PREPARED` commits only after
durable intent, exact READY response, and a second exact ACTIVE source-hold
check. Once a target exists, pre-import source release requires a signed
target disposition whose receipt proves `STOPPED_RETAINED` or `RETIRED`.
Historical no-target release/abandon behavior is unchanged.

The v5 journal also retains an explicit target-effect status and the exact
PREPARE request ID, canonical request digest, admission ID/digest, expected
helper sequence, and dispatch status before helper dispatch. Any preparation
intent or unknown/ambiguous dispatch blocks source release. A v3 release with
local `NONE_PROVEN` still requires online helper proof of `ABSENT`; a disposed
target requires exact online truth matching its retained disposition receipt.
Release rechecks that target truth immediately before broker mutation dispatch;
a changed result leaves the source hold active and the reviewed closure pending.
Restart reconstructs and resends the exact PREPARE request, allowing the helper
to reconcile its owned pending action before evaluating the request's original
expected sequence.

STOP_RETAIN and RETIRE likewise retain the signed decision identity and digest,
exact helper request ID/body/authorization digest, expected sequence, and
intent-before-dispatch status. Delivery loss or a local completion-write
failure retries the exact owned request. Exact terminal replay is idempotent;
an arbitrary new STOP against `STOPPED_RETAINED` or RETIRE against `RETIRED`
is rejected.

Target admission and disposition inputs are bounded, duplicate-free canonical
JSON signed with domain-separated Ed25519 payloads. Runtime code accepts only
retained external public keyrings; it contains no private signing-key loader.
Verification rejects unknown fields, duplicate/noncanonical action lists,
wrong key/site/host/plan/target generation/body, revoked keys, inactive time
windows, and unauthorized actions.

The target-helper v1 protocol caps requests at 64 KiB and responses at
128 KiB and publishes the reviewed four-connection/five-second service
constants for Packet 5B1b. The 5B1a helper core is pure and stores no app-DB
state. Its protected journal uses owner-only directories, no-follow
single-link files, exclusive locks, file fsync, atomic rename, and directory
fsync. It records request intent before engine effects, coalesces exact
concurrent request IDs, rejects request-ID body conflicts, retains helper
sequence/pending action, and reconciles ambiguous/lost responses by exact
engine inspection. The only adapter is a deterministic in-memory fake used by
tests.

Packet 5B1a does not provide a privileged host relay, Unix listener, native
filesystem helper, Docker adapter, real target volumes/networks, target
credentials, decrypt/import, application reconciliation, promotion, rollback,
or production bundle/role packaging. Those remain explicitly open for 5B1b
and later live-gate packets. Offline status reports target truth as unknown;
online status requires signed INSPECT admission and exact response binding.

Helper journal ownership is explicitly bound to configured uid/gid and exact
0700/0600 modes. State reads are descriptor-bounded to the observed size plus
one and revalidate descriptor and pathname identity. Replay responses are
schema-validated and bound back to request, operation, site, host, plan, target
generation, and monotonic helper sequence. Creation of `target-sets/` and each
target-set directory is followed by fsync of its containing parent before any
engine callback. Proven lock initialization failures close descriptors and
remove only the exact created inode; unproven identities remain fail-closed.

INSPECT is read-only with respect to the helper journal: it returns the
current helper sequence and exact engine truth without acquiring a mutation
lock, advancing the sequence, or writing replay state. Before a new
STOP_RETAIN or RETIRE intent, the recovery workflow holds the operation lock,
performs a fresh exact INSPECT, and binds the signed expected READY state,
prepared receipt, helper sequence, target identity, inspection receipt, and
engine evidence into the durable disposition intent. Repeated or concurrent
online status calls therefore cannot make an otherwise valid disposition
stale.

A terminal helper rejection that proves `DEFINITE_PRE_EFFECT` is retained with
its request, receipt, error, helper sequence, and observed state. Only a fresh
same-sequence INSPECT proving exact `ABSENT` for PREPARE or exact `READY` for
disposition closes that rejected intent into the bounded evidence history.
The next attempt must use a fresh request ID and, for disposition, a newly
signed decision bound to the refreshed sequence. Ambiguous outcomes remain
pinned to the original request and cannot be replaced. Exact PREPARE no-effect
proof restores `NONE_PROVEN`, allowing later reviewed source closure only
after the operator's independent online ABSENT check.

If the process stops after persisting a definite rejection but before its
inspection or resolution write, restart does not redispatch the rejected
PREPARE/STOP_RETAIN/RETIRE request. It first matches the retained request or
decision digest, issues only read-only INSPECT, and resolves only exact
same-sequence ABSENT/READY proof. An identical cached rejection record is an
idempotent no-op; a changed request digest, receipt, sequence, state, or error
cannot overwrite the original evidence.

The operator target controller is an effect driver, not an authority source.
After it returns, resume rereads and locks the exact recovery journal, validates
operation/plan/target binding plus `TARGETS_PREPARED`, receipt, helper sequence,
effect status, and completed request invariants, then rechecks ACTIVE broker
truth and READY helper truth. Controller return data is ignored; missing,
foreign, malformed, or unchanged local evidence cannot produce success.

## 5A2a protected operator inputs

The operator config and retained public keyrings are canonical, duplicate-free JSON in pre-existing canonical absolute paths. Files must be owner-matched `0600`, single-link regular files. Reads use `O_NOFOLLOW|O_NONBLOCK`, a declared-size-plus-one sentinel, and stable descriptor/path identity checks. Config is capped at 64 KiB and each public keyring at 1 MiB. The strict config schema contains repository identity, public keyring paths, and release target identity only; database/S3 URLs, passwords, private keys, and unknown fields are rejected. Keyring entries are parsed as public Ed25519 keys.

The broker journal snapshot accessor is separate from the broker's mutating `inspect/query/load` path. It requires the existing protected repository, `broker-journal` directory, and `state.json`; it never creates or repairs them, takes a lock, or acquires mutation authority. The state file and containing directory are revalidated around a bounded strict parse. This proves only a stable file snapshot, not serialization with a concurrent broker transaction.

Journal snapshots must be canonical strict JSON and every UUID key/reference must use lowercase RFC 4122 form with version 1–8 and variant 8/9/a/b. This includes repository, run, attempt, capture, operation, owner, and fence identities. Publication and tombstone keys equal `run_id`, while hold, deletion, and staging-cleanup keys equal `operation_id`. Uppercase singletons, nil/version-0/version-9/bad-variant UUIDs, aliases, case-variant duplicate semantic UUIDs, and key/record mismatches are corruption and are rejected at parse/storage and again before pagination or exact source selection.

## Discovery and reviewed plan v2

`discover` returns deterministic run-UUID-ordered pages of committed publication candidates. The cursor is an exact run UUID and the limit is 1–100. Results are explicitly `candidateOnly`; they do not imply full trust, compatibility, or restore eligibility. Deletion claims, tombstones, active/uncertain holds, and conflicting lifecycle tuples are classified conservatively. No “latest” source is selected.

`plan` requires an exact run UUID and lowercase signed-manifest SHA-256. It rejects absent, quarantined, tombstoned, deletion-claimed, conflicting, unsupported legacy, changed, or untrusted sources. It runs the 5A1 retained-key verification and compatibility checks, validates the checked-in migration ledger against the compiled `release-01` recovery target identity, and re-reads lifecycle evidence after artifact verification. It does not acquire a hold.

The resulting `darshan-recovery-plan-v2` binds site, repository, run, attempt, capture, capture generation, signed manifest digest, source schema/release identity, release-owned target ID, target release, terminal migration, and target migration-manifest digest. A single shared descriptor helper hashes every v2 source identity field, including the opaque repository-descriptor digest; builders and parsers reject any tuple/digest incoherence. v1 remains unchanged.

## Packet 05B1b1 target trust and fixture transport checkpoint

New production-authored plan v3 inputs use the strict canonical
`darshan-recovery-target-specification-v1`. The specification is bound to one
operation ID and contains the preparation generation, host installation UUID,
topology, host policy, helper role, engine profile, protection inventory,
capacity evidence, storage inventory, and domain-separated target logical and
release identity digests. It deliberately excludes both `planSha256` and
`targetSetId`, so its canonical SHA-256 can be placed in the unchanged plan-v3
preparation tuple before the existing target-set formula is evaluated. Two
operation IDs therefore produce different specification and target-set
digests without circular hashing. Historical opaque plan-v3 files remain
readable; the production controller/gateway cannot PREPARE them without the
matching full specification.

The helper wire boundary is now
`darshan-recovery-target-authorization-envelope-v1`. It carries the unchanged
helper request, one complete signed admission or disposition authorization,
the canonical target specification, and exact public plan/preparation
identity. The helper request's `authorizationSha256` is the SHA-256 of the
exact canonical signed body (admission or decision), not of its signature
envelope. The complete request remains capped at 64 KiB, responses at 128 KiB,
and Unix framing is exactly one canonical newline followed by EOF. Unknown,
duplicate, noncanonical, trailing, multi-frame, and oversized input fails
closed.

The production gateway contains only public Ed25519 verification. It checks
key membership, revocation, activation/expiry, exact action, site, operation,
plan, source descriptor, release target, generation, host, policy,
specification, and target-set bindings. Admission is accepted only for
PREPARE/INSPECT. STOP_RETAIN and RETIRE require their exact signed disposition;
that disposition may authorize only the read-only INSPECT needed for its
evidence and its one named mutation. The cheap pre-journal screen is not an
authority: verification is repeated under the helper journal lock against the
current state. A fresh disposition must match exact READY, no pending action,
helper sequence, and prepared receipt immediately before mutation. An exact
durable pending, completed, or definitely rejected request instead revalidates
its original request ID/body/auth digest, PREPARE receipt, and expected
sequence; it may reconcile or replay without reinterpreting a later terminal
state as a fresh admission. INSPECT holds a read-only journal lock across this
authorization, the stable state snapshot, and engine observation without
creating state or advancing sequence.

The PREPARE receipt remains immutable issuance evidence: its digest and exact
READY target identity are verified, while its historical helper sequence is
not reused as the current sequence after later no-effect evidence. A definite
pre-effect disposition rejection restores the prior stable READY lifecycle,
retains its rejection replay, and advances helper sequence. A newly signed
decision binds that current sequence separately. Ambiguous effects never take
this path and remain pinned for exact reconciliation.

The helper replay ledger remains bounded to 128 entries. Exactly one canonical
successful PREPARE-to-READY response is pinned as immutable preparation
evidence; the other 127 slots retain the newest ordinary responses in sequence
order. Failed or identity-mismatched PREPARE responses cannot pin, and multiple
pin candidates make the journal corrupt. Later STOP_RETAIN/RETIRE receipts do
not replace the prepared receipt pointer. Completed disposition responses keep
normal rolling-ledger semantics.

Pending requests retain their original request ID/body digest. This checkpoint
uses the conservative reconciliation policy: the original authorization must
still be active at locked reconciliation time. Expiry allows no new effect and
leaves the pending request pinned for explicit operator handling; a replacement
request or silently extended policy is not admitted.

Operator config v3 is additive. It binds one fixed relay socket, separate
public specification/authorization roots, one public authorization keyring,
and an explicit action deadline. The default controller derives only fixed
operation-specific filenames inside those roots. It exposes no arbitrary
socket, host, SSH, image, mount, engine, or credential option and fails closed
when its journal/source-hold dependencies are not installed. The bounded Unix
client and pure framing/server gate publish four-connection and five-second
incomplete-frame limits plus a separate action deadline and explicit
before/after-dispatch cancellation, timeout, disconnect, and lost-response
classes. The five-second absolute clock begins only when the first frame byte
arrives; pre-byte connection/action idle time is governed by the action
deadline. The controller validates the canonical plan digest, config site,
targetSet derivation, and full specification before workflow intent or
transport dispatch.

This is not the privileged listener or live target implementation. Native
pathname ownership/listening, SSH relay, real Docker/filesystem/volume/network
adapters, target credentials, systemd/signed-role/bundle packaging, decrypt,
import, application reconciliation, validation, promotion, rollback, and live
topology/rehearsal evidence remain later 05B1b2+ gates.

The output parent must already be a canonical owner-only `0700` directory. Recovery preflight has an explicit Linux/Node 20 host contract: it opens that directory with `O_DIRECTORY|O_NOFOLLOW` and creates the strict basename through `/proc/self/fd/<parent-fd>/<basename>`, so a renamed/replaced original parent cannot redirect creation. The `0600` file is created once with `O_EXCL|O_NOFOLLOW`, file-fsynced, and read back through its descriptor with an expected-size-plus-one bound. Exact bytes/digest and stable dev/inode/link/size/uid/gid/mode/mtime/ctime are checked before and after fsync of the already-open parent descriptor, while the original canonical pathname must continue to name the same inode. The returned digest is computed from verified readback bytes. Node 20 exposes no safe `unlinkat`-by-directory-fd operation, so any failure after exclusive creation preserves the inode for operator review rather than risking deletion of a pathname replacement. Existing output is never overwritten. Plan reads are bounded and require canonical bytes plus the caller-supplied digest.

Development commands are `npm run recovery -- ...`, `npm run recovery:discover -- ...`, and `npm run recovery:plan -- ...`. These npm/tsx aliases are non-production conveniences. The source-free production build includes the compiled recovery runtime, recovery metadata, and checked-in `drizzle/migrations` release assets, but it intentionally publishes no npm production-runtime alias: npm injects additional environment variables and therefore cannot satisfy the runtime's exact environment contract. Until Packet 5A2c2 provides the reviewed pre-Node launcher, the native runtime is invoked directly only under the reviewed six-variable environment. The CLI imports neither dotenv nor application config and returns a bounded `darshan-recovery-cli-result-v1` JSON envelope in `--json` mode. Filesystem paths, causes, stacks, public-key material, and raw operator values are not returned.

Top-level `--help`/`-h` is valid only as the sole argument. Help mixed with `--json` or command arguments is rejected through the normal versioned JSON/error contract; malformed UUIDs, digests, and limits are input-category failures.

## Packet 5A2c1 compiled runtime boundary

The compiled production recovery entrypoint enters only through
`dist-cli/scripts/recovery-runtime.js`. Before dynamically importing the CLI it
sets umask `0077` and validates immutable `darshan-recovery-runtime-v1`
metadata: Linux/x64, exact Node 20, exact effective
uid/gid `1000:1000`, the eight existing pre-import commands, and fixed
`/var/tmp/darshan-recovery-runtime` ownership/mode/path/capacity. Its private
`home` and `tmp` children must also be canonical `0700` directories.

The process environment is an exact allowlist: `PATH` is
`/usr/local/bin:/usr/bin:/bin`, `LANG` and `LC_ALL` are `C.UTF-8`, `TZ` is
`UTC`, and `HOME`/`TMPDIR` are the fixed private scratch children. Node flags,
loader variables, application/database/object-store/PG/AWS/proxy variables,
private-key/decrypt options, and arbitrary commands fail closed without echoing
values. JavaScript validation cannot undo `NODE_OPTIONS`, `LD_PRELOAD`, or
other loader state already applied before Node starts. Packet 5A2c2 must
therefore generate a host launcher that uses `env -i`, supplies only the exact
allowlist, and validates the pre-Node executable/image boundary.

First `SIGINT`/`SIGTERM` aborts the invocation and propagates one
`AbortSignal` through CLI, preflight, protected repository reads, trust
verification, workflows, and broker transport. A second signal or five-second
grace expiry fail-stops with exit 130. Cancellation before broker dispatch is
definite. Cancellation after a mutation is dispatched retains its durable
intent and is classified ambiguous for supported status/resume reconciliation;
the runtime never releases a hold or reclaims a journal lock automatically.

The production build emits a canonical
`dist-cli/recovery-runtime-manifest.json` binding the fixed release/target and
compatibility identity, Linux/x64/Node/uid/gid contract, entrypoint and complete
compiled-output-confined import-closure hashes, exact reviewed builtin and bare
dependency sets, the reviewed `zod` version/package/tree bytes, strict
package-lock identity, and every migration SQL and reviewed Drizzle metadata
asset digest. Static, side-effect, re-export, and literal dynamic imports are
AST-parsed; nonliteral dynamic imports, unknown builtins/packages, source-tree
escapes, symlinks/hardlinks, and application/effect modules fail closed. The
verifier independently recomputes the canonical manifest rather than trusting
recorded paths/hashes. Manifest output uses an exclusive no-follow temporary
file, descriptor identity checks, fsync, and an anchored atomic rename. The
build and native smoke reject closure drift, TypeScript/tsx, dotenv,
PostgreSQL/drizzle, AWS/S3, API/server, jobs, and realtime startup imports.

## Packet 5A2c2 production container boundary

The one backup broker process may bind a second recovery-only Unix listener.
That endpoint admits exactly `INSPECT_RESTORE_HOLD`, `ACQUIRE_RESTORE_HOLD`,
`RELEASE_RESTORE_HOLD`, and `MARK_RESTORE_HOLD_UNCERTAIN`. Admission occurs
immediately after strict frame parsing and before identity checks, hooks,
replay/reconstruction, authority checks, queueing, or journal access. It uses
an 8 KiB frame ceiling, four accepted connections, and a five-second absolute
incomplete-frame timeout. The main listener and its authority record/hash are
unchanged; both sockets share one service, journal, queue, adapter, readiness,
and drain lifecycle.

Production binds the recovery socket at
`/var/lib/darshan/<site>/recovery-broker-socket` on the Backend host and
`/run/darshan-recovery-broker` in the broker/recovery container. The broker has
RW access, recovery commands have RO access, and workers receive only the main
socket. Socket parents are `root:1000` mode `0710`; sockets are `1000:1000`
mode `0660`. A narrow native supervisor starts as root with only
`CHOWN`, `SETGID`, `SETUID`, and `KILL`, validates both protected parents, binds
both
filesystem sockets transactionally, then passes listening FDs 3 and 4 to the
single Node broker after dropping permanently to `1000:1000`. Node never owns
or closes a filesystem Unix pathname. The non-group-writable root-owned parent
is the writer-exclusion boundary, so the broker uid cannot recreate or swap an
entry between proof and cleanup. The supervisor never unlinks: on orderly close
or startup rollback it identity-checks and atomically renames an exact socket
with `RENAME_NOREPLACE` to collision-resistant `.closed.*` evidence. Replacements,
symlinks, non-sockets, and crash orphans are retained and make the next startup
fail closed for explicit operator reconciliation. `KILL` is retained only by
the supervisor so its root process can forward TERM/INT to the uid-1000 child;
the child loses all capabilities during the uid/gid drop. TERM/INT are blocked
before setup and fork. The parent synchronously waits for and forwards them
alongside nonblocking child reaping, while the child unblocks them only before
exec, so there is no check-to-wait signal gap.
`STARTING` holds accepted sockets without parsing until both listeners and
metadata are ready. Shutdown tracks
request promises after disconnect and explicitly drains the journal queue
before socket removal or authority release. The stale-socket connect probe is
also bounded and retains an unproven entry.

The generated Backend-host runner never uses Compose, npm, tsx, eval, a shell,
or sourced environment. It admits the signed role manifest's exact immutable
Docker image ID under one fixed site-wide container name, verifies the exact
CID, and cleans up only that same stopped CID. An admission nonce label allows
an interrupted create to clean up only its own exact stopped container. Docker
itself receives a fixed scrubbed environment, explicit local daemon endpoint,
and isolated operator-owned config directory. The generated create command
overrides the image entrypoint with `/usr/bin/env`; its arguments start `-i`,
the exact six c1 variables, `/usr/local/bin/node`, and
`/app/dist-cli/scripts/recovery-runtime.js`. It is uid/gid `1000:1000`,
read-only, networkless, capability-free, `no-new-privileges`, bounded by
explicit CPU/memory/PID/log/tmpfs/free-space policy, and has no Docker socket,
device, host namespace, application secret, private age identity, active
capsule, signing key, target volume, host root, main broker socket, or spool.
All Docker controls and execution are bounded. Signals are installed before
create, first request bounded stop, and repeated signals escalate to fixed
kill. After any cancellation racing an asynchronous start, the runner awaits
the start result, re-verifies name/CID/admission label/state, and performs a
second bounded stop or kill if the container became running. Stdout and stderr have separate ceilings and bounded durable evidence is
written before exact-CID cleanup. The signed role transfers its pinned host
Node binary, and the boundary binds SHA-256 digests for that binary, the
launcher, shared boundary library, and stable c1 runtime manifest. The runner
accepts only a canonical bounded root-owned, docker-group-readable mode-0640
boundary manifest. Installation keeps all runner executables/configuration
root-owned and non-group-writable; only the packaged uid-1000 docker-group
operator can execute them. Host preparation executes the pinned binary and
requires its target identity to be Linux x64 Node.js 20, which also proves its
dynamic loader/libraries are usable on that host.

Mount profiles are static: discovery gets repository and separate public trust
RO; planning adds only its plan output directory RW; hold/verify/resume add plan
RO, journal RW and recovery socket RO; online status has plan/journal/socket RO
without repository or keyrings; offline status omits the socket; release and
abandon have plan/review RO plus journal RW and recovery socket RO. Recovery
public keyrings are separate mode-0600 files in separate mode-0700 roots. The
canonical `darshan-recovery-container-boundary-v1` manifest is distinct from
the stable c1 compiled-runtime manifest.

Target preparation, decrypt/import, reconciliation, validation, promotion,
rollback, and successful-restore release remain Packet 5B. The legacy root
recovery role is not this c2 runner and remains outside this boundary. A plan
or `SOURCE_VERIFIED` state is review evidence only, never authorization or
proof of a live restore.

## Packet 5A2b2b reviewed disposition

Recovery journals now mutate as `darshan-recovery-operation-v4`. Exact v1, v2,
and v3 schemas reject unknown fields and normalize in memory without rewriting;
the next mutation writes v4. V4 retains existing phases and adds one nullable
hold disposition containing the decision identity, closure/action, pending or
confirmed state, protected review and retained-evidence digests, review time,
observed exact broker status/evidence, confirmation time/failure, and any prior
decision digest. Normal hold, verification, failure, and resume mutations reject
a closed operation. A confirmed abandonment may only be superseded by a new,
separately reviewed release whose record hashes the exact prior decision.

`release` and `abandon` require a protected canonical review file and the
literal exact operation UUID again on the command line. The review binds its
decision/action/closure, operation, plan digest, source-descriptor digest,
expected journal sequence, expected exact hold status, canonical review time,
and retained review-evidence digest. It has no free text, filesystem paths,
owner/fence values, or secret-bearing fields. Both commands inspect exact truth
under the scoped journal lock, durably close the operation before any broker
mutation, then inspect again. Release confirms only `RELEASED`; abandonment
confirms only `UNCERTAIN`; `ABSENT` is never proof of either terminal outcome.
Every unsuccessful acknowledgement remains closed and pending because the
broker may have persisted its effect. Repeating the same decision reconciles by
exact inspection and never reacquires a hold. A confirmed abandonment continues
to protect retention/deletion until a separately reviewed release supersedes it.

Development commands are `npm run recovery:release -- ...` and
`npm run recovery:abandon -- ...`; production uses the compiled entrypoint directly
under the reviewed environment, with required `--config-file`, `--plan-file`,
`--plan-sha256`, `--review-file`, `--review-sha256`, and
`--confirm-operation-id`. Safe results expose bounded closure status only.

### Audited orphan-lock break glass

No command automatically reclaims a site or operation lock. Host administration
may quarantine a proven orphan only after externally blocking all new recovery
commands, proving the correct host and PID namespace, proving every recorded
owner process is stopped, and preserving the exact lock and journal bytes plus
device/inode/uid/gid/mode/link/timestamp evidence. Age and `kill -0` alone are
insufficient. An administrator may then rename only the proven exact lock inode
into a protected evidence quarantine on the same filesystem and fsync both
directories. They must not unlink a path selected only by name or wildcard.
Afterward, run a supported `status` inspection and obtain a new review before
any mutation; never infer release or absence from lock removal.
