# Recovery target credential provisioning and admission

Packet `05B1b3b2b2a` is a credential-only checkpoint. It does not start an
engine, bootstrap a service, evaluate readiness, import data, or make a target
selectable. The production helper still constructs
`UnavailableRecoveryTargetEngine`; there is no credential-authority selector.

## Fixed authority boundary

The native API accepts retained directory descriptors and an already acquired
native `PREPARE` session. It accepts no pathname, filename, owner, group, mode,
credential value, encoding policy, executable, environment, or generic role.
The protected credential directory is physically separate from data/source
repositories. In production it must be root-controlled mode `0700`; the
compile-gated fixture substitutes its effective numeric owner only so it can
run without privilege.

`rtca_open_context` validates the exact immutable PREPARE frame and acquired
session, recomputes the canonical semantic digest, and domain-hashes the full
executed scope wire. That complete wire digest must equal the request digest in
the verified PREPARE frame, so operation/target/generation, profile/template,
allocation/ledger, policy, authorization/envelope, previous journal head,
deadline/challenge, authority instance, supervisor generation, and all three
distinct role handles are bound before any scope or credential effect. It also
checks a bounded process-local live-session witness containing the random lease
proof, creator PID, authority identity, and kernel peer-socket cookie. An
independent reopen lock probe must see the candidate OFD's active write lock,
while the candidate must see it as its own. Released/reopened, copied, forked,
unlocked, peer-replaced, or ordinary same-inode descriptors therefore reject
before creating the scope anchor. Release and peer-death cleanup first claim
the exact registry witness, peer cookie, authority identity, and locking OFD
under the registry lock; stale copies and naturally reused descriptor numbers
cannot close a newer lease. Registry PID/entry access and fork reset use one
synchronized discipline. Credential and journal roots must also be
physically distinct. Existing root topology and every bounded fixed-order
journal record/transition are reconciled exactly before any credential can be
created; orphan or conflicting records leave zero new effect.
Signed absolute expiry is enforced with nanosecond realtime and a fixed
monotonic deadline at every pre/post-effect boundary; retries do not reset it.
The fixed single-link mode-`0600` anchor uses `F_OFD_SETLK`. A peer hangup
cancels the scope. Directory scans use independent open descriptions and reject
every foreign name, symlink, non-regular entry, link alias, or mode change.

The sole mutation is `rtca_provision_fixed_roles`. It uses kernel `getrandom`
and fixed encodings to create exactly:

- `POSTGRES_PASSWORD`: 48 random bytes, lowercase hexadecimal, newline;
- `MINIO_ROOT_PASSWORD`: 48 random bytes, lowercase hexadecimal, newline;
- `MINIO_ROOT_USER`: fixed `darshan_` prefix plus 16 random bytes in lowercase
  hexadecimal, newline.

Production numeric ownership is fixed natively (`999:999` for PostgreSQL and
`1000:1000` for MinIO), with final mode `0400`. Publication is descriptor
relative and exclusive: unnamed temporary inode, bounded complete write,
protected provenance xattr, numeric ownership, final mode, file fsync,
`linkat(AT_EMPTY_PATH)`, and parent fsync. The process disables core dumps and
wipes transient random/value buffers. Values and value-derived digests never
enter records, return structures, logs, argv, or environment.

## State and replay

The native state is monotonic:

`ABSENT -> INTENT -> FILES_DURABLE -> ADMITTED`.

Records and the admission receipt are fixed-order, bounded, no-clobber files.
Every retry reopens the exact role inode with `O_NOFOLLOW`, checks single-link
mode/owner/provenance, recomputes descriptor identity, fsyncs the file,
recomputes and compares physical identity, fsyncs the credential directory,
and reverifies both protected directory identities before acknowledging replay.
A file or directory fsync failure, including after the final role link, remains
retryable and never permits rotation or a duplicate publication.
A scope-specific random HMAC key is stored only as protected scope-anchor
xattr, and each role inode carries only its protected raw HMAC-SHA256 content
commitment. Replay verifies exact role length/encoding and that private keyed
commitment before and after fsync. Neither the key nor the commitment is placed
in admission, journal records, logs, errors, argv, environment, or QA evidence.
Creation and every existing-anchor replay reopen and validate the exact
single-link anchor/xattr/identity, fsync the anchor, fsync the journal
directory, and reverify identity and key xattr before the key may be used.
Failures before or after either durability boundary fail closed and remain
retryable without regenerating an already published role.
Peer/session/deadline freshness is rechecked after each durability boundary and
immediately before any `ADMITTED` result.
A role linked before a crash is never unlinked, truncated, overwritten,
rotated, or regenerated. A pre-existing role is adopted only when its protected
provenance equals the exact executed scope. Partial roles/evidence are retained
for reconciliation. Foreign or changed files fail closed.

The admission receipt contains only operation/allocation/ledger/policy/request/
authorization/authority digests, opaque authority handles, and physical
device/inode/mount/owner/mode identities. `profile-v3` and
`resource-admission-v2` reference the exact receipt/descriptors and distinguish
`UNAVAILABLE` from `FULLY_ENROLLED`; both keep dispatch/materialization/lifecycle
disabled. Accepted profile-v2 remains `UNAVAILABLE`, `valuePresent:false`, and
`dispatchEnabled:false` byte-for-byte.

The TypeScript verifier/store is test-only contract validation. Production
materialization and secret ownership remain native-only. Generated descriptor
identities exist only downstream of the provision scope; they do not alter
evidence-v2, specification-v2, target-set-v2, attestation, plan-v4, or accepted
materialization-v2 records.

## Deferred gates

Docker/daemon selection, START, bootstrap, authenticated readiness, STOP,
RETIRE, decrypt/import/restore, real-host enrollment, promotion, rollback,
topology, load/soak, and RPO/RTO evidence are unavailable and deferred.
