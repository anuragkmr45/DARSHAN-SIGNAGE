# Packet 05B1b3b2b1 fixed native executor/materialization QA checklist

## Contract and isolation

- [x] New executor, materialization-v2, profile-v2, inspect-v2/v3, and client files are additive; accepted v1 bytes are unchanged.
- [x] Production worker/factory/installer remain unavailable and contain no native selector.
- [x] Context parses and retains the exact acquired b3b2a frame, verifies its lease proof/session fields, and uses the complete protected `tra:v1` role map.
- [x] No generic path, argv, environment, daemon endpoint, credential value, or generic exec field exists.
- [x] B1 allows only inspect, internal-network create, PostgreSQL create, and MinIO create.
- [x] Start/bootstrap/READY/stop/remove/PURGE are rejected.

## Native execution and materialization

- [x] Executable/config/assets/binds are descriptor verified before and after use.
- [x] Test ELF uses descriptor execution, fixed argv, sanitized locale-only environment, and no inherited PATH/proxy/auth context.
- [x] The effective minimum authority/command deadline, cancellation, peer death, session/fencing, join, and negative descendant liveness are checked before and after every effect boundary.
- [x] Durable INTENT precedes create; RECEIPT requires authoritative complete observation.
- [x] Strict fixed-field parsing, contiguous hash chain, transition table, no-clobber publication, fsync, bounded records/bytes/inodes, exact replay, and orphan/duplicate/stale/conflict rejection are covered.
- [x] After-link replay verifies and fsyncs the exact record and directory before acknowledgement; fsync faults fail closed and retry without duplicates.
- [x] Lost response adopts only one exact owned/configured/consumed/daemon-provenance resource.

## Inspection/profile behavior

- [x] Profile v2 fixes Docker executable/config/daemon/image/platform/config/runtime/security/network/assets fields.
- [x] Synthetic fixture identity cannot become a production executable default; unresolved real identities remain unavailable.
- [x] Bootstrap source states are represented while dispatch remains disabled.
- [x] Inspect v2 separates lifecycle state from configuration; inspect v3 binds the exact command/authority evidence and fixes readiness to `NOT_EVALUATED`.
- [x] Complete enumeration and reliable-absence rules reject partial, trailing, overflow, foreign, and mismatch projections.
- [x] Create accepts only exact `CREATED` evidence with enrolled daemon/image/configuration, fixed ownership, and an empty consumer set after cleanup.
- [x] EOF plus nonzero, signaled, or unknown direct-child status cannot publish COMPLETE even when cleanup succeeds.
- [x] Canonical/self-hashed records reject invalid operation/role pairs and invalid COMPLETE/AMBIGUOUS payloads during scan.

## Evidence limits

- [x] Native test uses only temporary owner-only directories, socketpairs, local fixture processes, and synthetic non-secret identities.
- [x] No Docker daemon/live service/network/SSH/production key/decrypt/import/restore was used.
- [ ] Independent reviewer confirms no P1/P2 finding.
- [ ] Packet 05B1b3b2b2 credential/readiness/real-daemon gate completes.
- [ ] Packet 05B1b4 signed-role installation and production wiring completes.

