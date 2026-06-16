# Ghost Pairing Decision Log

## ADR: Player Reinstall And Identity Reclaim Policy

Date: 2026-06-16

Status: Accepted for GP-1.1 and later hardening phases.

### Context

Electron app data can survive uninstall. A stale local identity can make a reinstalled player appear paired even when the backend/CMS no longer has a visible screen record, or when the player and CMS are pointed at different environments.

### Decision

Fresh reinstall defaults to a new player and pairing required. Local app data alone is not proof of pairing. Backend pairing-status is authoritative. The player must not show paired or no-content UI until backend validation succeeds, except for offline playback by the same identity that was recently validated.

Reuse of an old identity requires backend-valid pairing. If explicit reuse or reclaim is needed, it must be an admin-approved workflow, not an automatic machine-fingerprint claim.

### Consequences

- Backend pairing-status must distinguish valid no-content from invalid/stale pairing.
- Player startup must treat persisted identity as local-only until validation.
- CMS must later expose orphan/revoke/reclaim workflows.
- On-prem rollout must deploy backend pairing-status before player validation.
- Clone/copy app-data cases remain a future hardening phase.

### Deferred Decisions

- Whether deleted screens are recoverable.
- Whether orphan credentials count against screen licensing.
- How admin-approved reclaim is approved and audited.
- Whether installer uninstall should offer or require app-data wipe.
- Duplicate identity policy for cloned disks or copied app data.

## Decision: GP-3 Revoke And Reclaim Boundary

Date: 2026-06-16

Status: Accepted for GP-3.

### Decision

CMS may revoke a stale pairing by device/screen id. Revoke invalidates active credentials and outstanding pairing codes, but it does not delete the screen and does not attach any local player identity to a different screen.

Reclaim remains disabled in GP-3. Admin-approved reclaim must use a future fresh-pairing or recovery flow and must not blindly trust copied app data, old certificates, hardware fingerprint, or an orphan credential.

### Consequences

- Operators can force a stale/orphaned player back to pairing required.
- The CMS can show that reclaim is intentionally unavailable rather than silently hiding the production gap.
- GP-5 must define the safe reclaim/duplicate identity policy before production approval.

## Decision: GP-4 Clean Reinstall And Reset Policy

Date: 2026-06-16

Status: Accepted for GP-4.

### Decision

Normal upgrades preserve player identity. Normal uninstall is not treated as a clean identity reset. A clean reinstall requires explicit operator action using CMS revoke when applicable and the local `reset-pairing` command.

The reset command clears identity-bound local state and certificates. It preserves media cache, logs, screenshots, proof-of-play spool, and offline request queues by default. Operators may pass `--clear-cache` to remove downloaded media cache, but request/proof queues remain preserved.

### Consequences

- Operators have a deterministic clean reinstall path without relying on package-manager uninstall behavior.
- Accidental package upgrades do not force unnecessary re-pairing.
- Proof-of-play/request queue data is protected from silent reset loss.
- Clone/duplicate identity detection remains a separate GP-5 decision.

## Decision: GP-5 Duplicate Identity Detection Policy

Date: 2026-06-16

Status: Accepted for GP-5 warning-mode hardening.

### Decision

Duplicate identity detection uses layered runtime signals rather than hardware fingerprint alone. The player maintains a persistent install instance id and generates a fresh runtime session id for every launch. The backend records active session leases per device id and opens a duplicate identity conflict only when multiple runtime sessions remain active beyond the restart grace window.

Default enforcement is warning-only:

- `DUPLICATE_IDENTITY_DETECTION_ENABLED=true`
- `DUPLICATE_IDENTITY_ENFORCEMENT=warn`
- `DEVICE_SESSION_LEASE_MS=300000`
- `DEVICE_SESSION_RESTART_GRACE_MS=120000`

Warning mode does not auto-revoke or block playback. It keeps valid pairing-status responses valid and exposes redacted duplicate identity evidence in CMS Pairing Health. Block mode is available through configuration, but production use requires explicit rollout approval and tests.

### Consequences

- Admins can see likely copied app-data or cloned-disk conflicts and use existing revoke plus local reset-pairing to remediate.
- Quick restarts and heartbeat retries are not treated as conflicts.
- Non-concurrent clones may not be detected until multiple copies connect during the session lease window.
- Safe reclaim remains disabled until a future fresh-pairing reclaim workflow exists.
- GP-6 must still add full clone/reinstall/delete/orphan E2E coverage.

## Decision: GP-6 Evidence Classification Policy

Date: 2026-06-16

Status: Accepted for GP-6.

### Decision

GP-6 records a full E2E/permutation matrix with honest evidence classification. Automated route/unit/build evidence may approve the implementation with conditions, but browser Pairing Health behavior, packaged player clean reinstall/reset, two-player copied app-data duplicate warning, and on-prem environment mismatch smoke must remain manual/on-prem/browser-required until actually executed.

### Consequences

- Production readiness cannot be approved by docs-only or unit-only evidence.
- Browser and on-prem rows must not be marked passed without attached runtime evidence.
- The known `screens.test.ts` reporting assertion remains visible as reporting debt instead of being hidden inside GP-6.
- Future production readiness review can start only as a conditional review.
