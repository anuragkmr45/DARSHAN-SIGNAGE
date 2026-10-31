# Controlled Docker Recovery — Packet 2

Status: developer fixture implementation. No Docker daemon, live service, network, SSH, key, decrypt, import, restore, or production target was used.

## Release boundary

Packet 1 remains immutable at `release-01` / `0055_backup_deletion_idempotency_bindings.sql`. Packet 2 is a separately approved target:

- release: `release-02`
- target: `darshan-server-release-02-controlled`
- terminal migration: `0056_recovery_runtime_authority.sql`
- ledger fingerprint: `69b84a7d0bdebf17df6bec95f907791d586cc9558ec33fb18b79eb41b6e62a2b`

The native engine remains unavailable (`ENOTSUP`) and is not selected by this workflow.

The current application release uses a separately installed `release-03` / `0057_controlled_recovery_report_projection.sql` controlled profile at `/etc/darshan/controlled-recovery/profile.release-03.json`. Do not edit or replace the immutable release-01 profile. An older source may enter this path only when the reviewed compatibility assessment classifies it as an enrolled checksum-identical forward-compatible prefix; unsupported/future/changed sources fail closed.

## Required sequence

1. Complete Packet 1 through `DATA_VALIDATED` on exact proven recovery targets.
2. Run `reconcile` using the installed Packet 2 adapter. This deletes restored human sessions, quarantines active certificates, retires unused pairing codes, cancels device commands and recovered jobs, suppresses both durable outboxes, reconciles transient backup/upload state, and rebuilds present-time schedule/default/emergency authority.
3. Review individual pairings with exact generation, screen, and certificate identities. A review reason and injected operator authorization are mandatory. Quarantine returns `RECOVERY_PAIRING_REVIEW_REQUIRED`; it is not revocation.
4. Run `validate-app`. Every fixed case must pass in the isolated fixture: login/session rejection, permissions, media, PDF page, video loop, layout/presentation, schedule, default, reviewed unexpired emergency, chat attachment, PoP, screenshot readback, and offline webpage fixture.
5. Inspect `status` and the latest `report`; state must be `AWAITING_PROMOTION` and all source/target/profile/configuration hashes must still match.
6. Invoke `promote` separately with the exact operation/report confirmations and approval identity. Promotion captures protected prior pointers, uses fixed lock order, fences and proves all previous writers stopped, rechecks present-time authority, applies only the installed overlay, and keeps the write freeze.
7. Either `accept` under the same write freeze or `rollback` to the exact retained prior pointers/original targets. After writes resume, automatic lossless rollback is refused; preserve new data and make an explicit divergence decision.

## Generation handshake

An approved signed player sends a fresh HELLO recovery nonce. The server returns a one-use challenge bound to site, generation, screen, certificate, nonce, expiry, and server challenge. Only the matching certificate signature consumes it. HELLO advertisement alone never resets counters. Acceptance consumes the receipt, cancels old-generation in-flight commands, and resets server version authority. The player persists the receipt and generation while retaining certificate identity and media cache. Old-generation replies are ignored before same-generation stale-version checks. Legacy credentials require re-pairing during an active generation.

Fresh challenges for the already stored generation do not reset server or player counters. New commands store the active generation inside their creation transaction and responses serialize that stored binding. Legacy `NULL` or different-generation commands are cancelled before first claim and cannot be relabeled current; acknowledgements must carry the same stored/current generation.

Recovered pairing quarantine is an identity-preserving wait state. `RECOVERY_PAIRING_REVIEW_REQUIRED` must survive HTTP/socket normalization and player bootstrap; do not delete the certificate, device identity or reusable media cache. After exact approval, a fresh bootstrap retry proceeds with the retained identity.

## Still pending

- Disposable Docker E2E with representative content and application flows.
- Production split-host private/TLS/firewall proof; a local bridge is not proof.
- Production-sized timing, four-hour RTO, two-hour maintenance, scale/soak/failover, fleet/browser/Windows/physical display checks, and rollback rehearsal.
- Actual production approval and activation of the injected deployment adapter.
