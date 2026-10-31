# Controlled Recovery Packet 3 — monitoring, ciphertext download and report projection

Status: developer fixture implementation. Packet 3 does not start, resume, promote, accept or roll back recovery. Native production recovery remains unavailable / `ENOTSUP` and unselected.

## Backup monitoring

The Backup settings surface distinguishes the latest publication-read-back verified success from the latest failed run. It separately shows any active run stage, attempt, heartbeat, lease, retry and deadline. Stable alert codes cover overdue verified success, stuck attempts, repository capacity, exhausted retries and retention failures. Capacity is reported only after the configured local repository identity is re-established; an absent/replaced mount is `UNAVAILABLE`, never healthy fallback storage.

## Encrypted artifact download

Only users with an unconditional `download Backup` grant may request a single `DATABASE`, `OBJECTS` or `CONFIGURATION` artifact. The API re-authorizes the current session, reloads the exact run, reopens the canonical repository read-only, verifies the durable broker journal, retained policy and manifest signatures, publication receipt, run/manifest identity and ciphertext hashes, then hashes the opened single-link mode-0600 fd again before streaming it. Responses are ciphertext-only, `no-store`, `nosniff`, and audited with bounded identities, size and digest.

Legacy off-host, unverified, unavailable, ambiguous or changed sources are not served. There is no arbitrary path, run root, plaintext/configuration extraction, HTTP range synthesis or server-side decryption. A client abort destroys the fd-backed stream. Operators should use a resumable external transfer process only after a future reviewed range contract; this release intentionally returns a complete stream or failure.

## Recovery report import

The CMS/API never reads the protected recovery journal/workspace or Docker. Release engineering creates a secret-free canonical `darshan-controlled-recovery-projection-v1` envelope signed by the pinned deployment Ed25519 authority. It binds sequence, operation, site, report digest, source run/manifest, profile/configuration digests, release/schema/target, generation, state, data/application/promotion/rollback results, pending gates and timestamps.

Import on the Backend deployment host:

```text
npm run controlled-recovery:import-report -- \
  --envelope /approved/protected/recovery-projection.json \
  --keyring /approved/protected/recovery-report-public-keyring.json \
  --site-id approved-site
```

Both files must be protected regular files owned by the invoking deployment identity. The command accepts no endpoint, Docker argument, recovery root or shell fragment. Exact replay is idempotent. A different envelope for an existing operation and a lower/equal site sequence are rejected. Legacy `restore-evidence-v2` verification remains a distinct compatible contract and is not silently reinterpreted as Packet 3 evidence.

Imports must run through the shipped command transaction. A transaction-scoped,
site-derived advisory lock serializes competing imports before the sequence
check, so concurrent lower/equal projections cannot both become authoritative.

## Operator recovery instructions

Use Packet 1/2 commands and their installed fixed deployment profile for recovery. The CMS provides status, ciphertext downloads, a report summary and this runbook only; there is no browser recovery wizard or API mutation for restore, promotion, acceptance or rollback.

## Pending gates

Live repository download/backpressure/cancellation, audit failure behavior, Prometheus rule evaluation and CMS operator-browser tests remain pending. Disposable Docker application validation, split-host private/TLS topology, representative content, promotion/rollback rehearsal, production sizing, four-hour RTO/two-hour maintenance, scale/soak/failover and platform checks also remain pending and are not developer-passed.
