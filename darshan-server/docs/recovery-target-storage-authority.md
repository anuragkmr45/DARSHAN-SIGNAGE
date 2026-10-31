# Recovery target storage authority (Packet 05B1b3a)

Packet 05B1b3a establishes allocation authority but deliberately does not install
an effectful recovery engine. Production continues to construct only
`UnavailableRecoveryTargetEngine`; PREPARE/INSPECT return
`TARGET_NOT_INSTALLED`, and no public READY, STOPPED_RETAINED, or RETIRED effect
can originate from this packet.

## Retained evidence and installed identity

Host policy, engine profile, storage inventory, protection inventory, and
capacity evidence are strict canonical JSON carried in Ed25519 public-key-only
envelopes. Their content address is the SHA-256 of the complete envelope,
including signature. Numeric capacity and native identity fields use canonical
unsigned 64-bit decimal strings. Capacity evidence is the only DAG root and
names the exact other four envelope digests. Verification binds every document
to the same site, host installation, operation, target set, generation, target
specification, and target release, and checks order, validity, key/document
revocation, and cross-document identities.

The protected evidence loader reads only `<lowercase-sha256>.json` directly
beneath its enrolled owner-only root through the existing bounded, no-follow,
stable-inode reader. It never accepts a caller path. Installed identity v2 adds
the evidence, ledger/control, active, quarantine, and pool root identities,
storage-authority identity, and host mode. Historical v1 remains parseable for
audit compatibility but is effect-ineligible. Production startup now requires
v2 to match every native fixed identity value.

## Native storage boundary

The C interface accepts fixed operations and POSTGRES/MINIO components only;
it accepts no path, executable, uid, gid, or mode from a request. Allocation
basenames contain the full target-set digest and a 256-bit `getrandom` nonce.
Capacity uses checked `f_bavail * f_frsize` bytes and `f_favail` inodes and
subtracts the full outstanding reservation totals. Control capacity is separate
evidence.

Production enrolled-root validation accepts only root-owned, mode-0700,
writable ext4/XFS candidates. Because this portable checkpoint cannot prove a
stable filesystem UUID and enforced quota from descriptor-relative probes, it
then fails closed with `ENOTSUP`; it never invents support. A compile-time test
mode permits disposable ordinary directories and is absent from production
builds.

The authority uses a root-owned single-link mode-0600 OFD lock. Allocation
trees have one marker and fixed postgres/minio directories. Ledger entries are
bounded, fsynced, no-clobber records whose pending names remain evidence on an
ambiguous failure. The quarantine entry point accepts no boolean, caller digest,
or path authority. It derives the exact allocation solely from a validated
contiguous ledger ending in an ALLOCATE receipt at FILESYSTEM_ALLOCATED, appends
RETIRE_INTENT, verifies source and destination identity, fsyncs both parents,
and appends the receipt. A future post-engine stop-proof record type is not
installed. There is no deletion or PURGE operation.

## Deliberate deferrals

Reliable production filesystem UUID/quota probes, privileged mount fixtures,
real storage enrollment, Docker/Podman/container effects, database/object-store startup,
decrypt/import/restore, application reconciliation, validation, promotion,
rollback, and successful hold release remain later packets/release gates. No
mount, Docker, live network, SSH, private production key, decrypt, import, or
restore action is part of this checkpoint.

## Acyclic operation identity (Packet 05B1b3b0)

Effect eligibility uses an additive chain. Stable host-policy, engine-profile,
storage-inventory, and protection-inventory v2 bodies have no operation,
generation, target-set, specification, attestation, or plan backreferences.
Capacity-v2 points to the four complete signed-envelope digests and adds the
operation/generation identity. Specification-v2 points to those four digests
and the capacity envelope. targetSetId-v2 is derived only from the canonical
specification digest and operation/generation/host tuple. A separately signed
operation attestation binds that target set and every upstream digest; plan-v4
and authorization-v2 are downstream of the attestation.

The gateway verifies the complete public-key chain under the target-helper lock
and loads evidence only from protected content-addressed files before journal
creation or adapter invocation. Historical evidence-v1 and plan-v3 remain
strict readable formats; an installed identity-v2 rejects their INSPECT and
mutation requests as `RECOVERY_TARGET_EFFECT_INELIGIBLE`. Accepted historical
bytes are never reinterpreted.

The locked v2 context also requires the inventory's ACTIVE, QUARANTINE, POOL,
and CONTROL path identities to equal the four installed root identities,
requires specification topology, host-policy mode, and installed host mode to
match exactly, and requires every inventory filesystem type to appear in the
signed policy allowlist. Authorization, attestation, evidence validity,
cancellation, and action deadline are checked again after evidence loading and
immediately before dispatch.

If an ambiguous action enters reconciliation, the helper repeats freshness
checks after the awaited engine inspection and immediately before any retry
effect under the same lock. Expiry or cancellation leaves the retained pending
journal unchanged. The service computes one effective deadline per request;
screening, locked checks, the deadline AbortSignal timer, reconciliation,
dispatch, and engine context all receive that same value, including callers
that rely on the bounded default.

The current production worker intentionally lacks the v2 evidence loader and
attestation keyring wiring, so it returns
`RECOVERY_TARGET_EFFECT_INELIGIBLE` before reaching the separately retained
`UnavailableRecoveryTargetEngine`. Installing those source-free artifacts is
Packet 05B1b4 scope; `TARGET_NOT_INSTALLED` is not the current v2 worker result.
