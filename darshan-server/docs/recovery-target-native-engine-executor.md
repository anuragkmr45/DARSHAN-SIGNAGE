# Recovery target native executor/materialization foundation (Packet 05B1b3b2b1)

Packet 05B1b3b2b1 is a fixed, local-fixture-only executor and durable
materialization checkpoint below the accepted b3b2a native authority. It is
not selected by the recovery worker, factory, installer, or production bundle.
Those surfaces still construct `UnavailableRecoveryTargetEngine`; no runtime
selector or installation path exists.

## Acquired context and fixed effect surface

The native context parses and retains the exact immutable request frame already
acquired by b3b2a, recomputes its session lease proof, and requires the matching
live OFD-backed session plus the complete protected 16-role
`tra:v1` handle map. It independently binds operation, target, generation,
profile, admission, authority instance, and supervisor generation. It never
accepts a caller session token, digest override, executable path, argv,
environment, daemon endpoint, credential value, or generic command.

The b1 allowlist is only readonly target inspection, internal-network create,
PostgreSQL create, and MinIO create. Create requires the already admitted
credential-reference roles; the fixture contains fixed non-secret identities,
never values. Start, bootstrap, readiness verification, stop, remove, network
remove, and PURGE fail closed until the b2 credential/readiness packet.

Profile v2 fixes the executable/config/daemon/image/platform/config,
entrypoint/argv/environment, security, tmpfs, resources, logging, internal
network, labels, data mappings, and four config/bootstrap assets. Bootstrap
source states distinguish fresh, complete, and partial, but dispatch is always
false. Real executable, daemon, image, security, and asset identities may
remain null and the profile's enrollment state remains `UNAVAILABLE`.
Synthetic fixture hashes cannot coexist with a production executable digest
and are never production defaults.

Descriptors for the executable, client configuration, assets, and retained
binds are checked before and after use for type, owner, group, mode,
device/inode/mount identity, content where applicable, allocation-ledger head,
and disjointness. Test execution uses `execveat(AT_EMPTY_PATH)` on the retained
ELF descriptor with only fixed argv and a fresh three-entry C-locale
environment. There is no inherited PATH, HOME, proxy, plugin, auth-helper, or
caller context. Non-test dispatch returns unavailable and therefore cannot
contact Docker.

The effective deadline is the minimum of the acquired authority deadline and
the command deadline; a command can never extend the lease. Deadline,
cancellation, peer liveness, authority instance/generation, and
descriptor stability are checked around publication, launch, inspection, and
join. The fixture is a process-group child of a subreaper; shutdown uses TERM,
KILL, adopted-descendant discovery, reaping, and affirmative `ECHILD`/negative
group liveness before the OFD session can be released. Cleanup proof is
separate from command success: a timed-out command may be ambiguous while its
successfully reaped context is safely joined; uncertain cleanup retains the
authority for an explicit retryable cancel/join. This proves local
process cleanup only. Once a daemon could have accepted work, the effect is
still ambiguous until authoritative observation.

EOF is not process success. A complete projection can authorize a receipt only
after the direct child is affirmatively reaped with exit status zero. Nonzero,
signaled, or unknown direct-child status fails closed without a COMPLETE
receipt, even when descendant cleanup was independently proven.

## Durable materialization and inspection

The native materialization-v2 journal is an owner-only, same-device descriptor root. It scans at
most 256 single-link mode-0600 records and 4 MiB, validates canonical sequence
and hash-chain continuity, and publishes with `O_TMPFILE`, file fsync,
no-clobber `linkat`, and directory fsync. An INTENT containing the exact
operation/target/generation/role/handle/profile/admission/command/nonce/head is
durable before create. Its strict fixed-field parser rejects unknown/trailing
data and enforces one contiguous transition table: each receipt has one exact
pending intent, and each intent has at most one terminal receipt. Exact intent
or receipt replay is accepted; orphan, duplicate, conflicting, or stale
publication fails closed.

If publication fails after `linkat` but before directory durability is
acknowledged, exact replay reopens and verifies the record, fsyncs that record
and the containing directory, and only then returns success. An fsync fault
remains retryable and never creates a duplicate INTENT or RECEIPT.

A RECEIPT is eligible only after complete authoritative enumeration and carries
the actual resource, image/config, effective configuration, ownership labels,
consumer set, and daemon provenance. IDs remain null before observation and an
ambiguous receipt cannot invent them. Lost-response adoption requires one and
only one complete resource with the exact nonce, fixed ownership labels,
configuration, consumers, and daemon identity; foreign, multiple, replaced,
incomplete, or nonce-colliding candidates remain ambiguous.

Inspect v2 remains the additive state vocabulary. The executor consumes
inspect-v3, which additionally binds the exact authority request and command
hash/operation/role/handle/nonce/materialization head. It reports `ABSENT`,
`CREATED`, `STOPPED`, `RUNNING`, or `ERROR`, while
configuration is independently `MATCH`, `MISMATCH`, or `INCOMPLETE`.
Readiness is fixed to `NOT_EVALUATED`, so `READY` is impossible in b1. Reliable
absence requires complete container/network/mount/consumer/daemon enumeration.
A create receipt additionally requires the exact enrolled daemon, image,
configuration, resource-ID syntax, ownership-label digest, nonce, and consumer
set; a bare match token is never sufficient. The TypeScript client also
requires exact `CREATED` state and no foreign consumers. Canonical journal
records are rescanned for operation/role and role-specific terminal-payload
semantics in addition to schema, self-hash, and chain validity.

## Exact evidence boundary and roadmap

The native test compiles a harmless fixed ELF and uses only private temporary
directories, unnamed socketpairs, forked fixture processes, synthetic hashes,
and non-secret fixed identities. It does not start Docker/Podman/Compose, open
a daemon or network/SSH service, use a production key, materialize a credential
value, decrypt, import, restore, validate an application, release a hold, or
perform promotion/rollback.

Packet 05B1b3b2b2 remains responsible for admitted credential materialization,
start/bootstrap, authenticated readiness, stop/reconciliation, and any real
daemon adapter evidence. Packet 05B1b4 remains the signed-role/source-free
installation and production wiring gate. Live topology, load/soak, failover,
RPO/RTO, and production rehearsal remain release gates.

