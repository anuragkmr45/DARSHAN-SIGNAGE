# Packet 05B1b3a storage authority QA checklist

- [ ] Reject non-canonical, oversized, expired, future, revoked, incorrectly
  signed, renamed, or wrong-kind evidence.
- [ ] Reject DAG cycles, undeclared dependencies, binding disagreement, time
  inversion, release/specification mismatch, or storage-authority mismatch.
- [ ] Prove v1 installed identity remains readable and effect-ineligible; prove
  every v2 storage identity field is required and native-fixed.
- [ ] Exercise u64 overflow/underflow and full byte/inode reservation arithmetic;
  keep control-ledger capacity independent.
- [ ] Reject request-supplied paths, uid/gid/modes/executables and unsupported
  components/operations.
- [ ] In disposable compile-gated fixtures, reject unexpected objects, symlinks,
  hardlinks, devices, FIFOs, sockets, submount/foreign-device roots, read-only
  roots, and no-quota/unproven UUID production roots.
- [ ] Exercise allocation-name entropy, no-clobber collisions, intent/receipt
  durability, crash-stage pending evidence, bounded ledger corruption, ENOSPC,
  fsync/rename failures, and exact replay without double reservation.
- [ ] Prove quarantine authority derives only from the validated pre-engine
  ledger receipt; reject caller booleans/digests/paths. Verify same-filesystem,
  no-clobber, destination identity, source absence, and both-parent fsync.
- [ ] Static scan production native storage code for deletion/PURGE APIs.
- [ ] Confirm production still returns `TARGET_NOT_INSTALLED` and cannot publish
  READY, STOPPED_RETAINED, or RETIRED.
- [ ] Run no mount, Docker, live network/SSH, private production key, decrypt,
  import, or restore operation during local verification.
