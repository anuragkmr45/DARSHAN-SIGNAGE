# Player Pairing Identity

Status: GP-6 E2E/permutation evidence matrix recorded on 2026-06-16.

## Decision

Fresh reinstall defaults to a new player and pairing is required by default. A previous local identity is not enough to claim paired state. Reuse of a previous player identity is allowed only when the backend validates the pairing and the screen remains CMS-visible; explicit admin-approved reclaim is the only supported future path for attaching a new install to an existing screen identity.

The backend pairing-status contract is the source of truth. The player must not show paired or no-content UI until the backend validates the local identity, except for offline playback using the same identity that was validated recently.

## Current Local Identity Risk

The Electron player can preserve runtime identity across uninstall because app data and runtime state can survive package removal. That persisted state may include device id, certificate metadata, CA/cert/key paths, pairing validation metadata, snapshots, default-media metadata, and cached playback state.

Local app data is operational cache only. It is not an authority for pairing validity.

## Target State Machine

Current states that can exist in the product:

- `UNPAIRED`
- `LOCAL_IDENTITY_PRESENT`
- `PAIRED_LOCAL_ONLY`
- `PAIRED_BACKEND_VALID`
- `PAIRED_BACKEND_ORPHANED`
- `PAIRED_SCREEN_DELETED`
- `PAIRED_ENV_MISMATCH`
- `PAIRED_NO_CONTENT`
- `CONTENT_ASSIGNED`
- `PAIRING_INVALID_REPAIR_REQUIRED`

Target production states:

- `UNPAIRED`
- `PAIRING_REQUIRED`
- `PAIRING_IN_PROGRESS`
- `LOCAL_IDENTITY_PRESENT`
- `PAIRED_VALID`
- `PAIRED_NO_CONTENT`
- `PAIRING_STALE_FORCE_RESET`
- `PAIRING_REVOKED_FORCE_RESET`
- `DEVICE_RECLAIM_REQUIRED`
- `BACKEND_REPAIR_REQUIRED`
- `ENVIRONMENT_MISMATCH`
- `OFFLINE_USING_LAST_VALID_PAIRING`

## Backend Pairing Truth Contract

Authenticated endpoint:

```txt
GET /api/v1/device/:deviceId/pairing-status
```

This endpoint requires device authentication. It must not rely on the legacy unauthenticated `/device-pairing/status` route.

Implemented statuses:

- `VALID`: authenticated device, screen exists, and active/default/emergency/snapshot content is available.
- `VALID_NO_CONTENT`: authenticated device and visible screen exist, but no content is assigned.
- `INVALID_TOKEN`: credentials are missing, invalid, expired, malformed, or signature validation fails.
- `SCREEN_NOT_FOUND`: authenticated identity cannot map to a visible screen.
- `PAIRING_REVOKED`: device credential exists but is revoked.
- `ORPHANED_CREDENTIAL`: credential exists but the referenced screen row is missing.
- `ENVIRONMENT_MISMATCH`: optional player environment/deployment headers disagree with backend identity.

Deferred statuses:

- `SCREEN_DELETED`: there is no soft-delete screen state today. Normal delete removes credentials and can map to `INVALID_TOKEN`, `SCREEN_NOT_FOUND`, or `ORPHANED_CREDENTIAL` depending on remaining rows.
- `RECLAIM_REQUIRED`: deferred until the admin reclaim workflow.
- `BACKEND_REPAIR_REQUIRED`: deferred until a richer backend consistency model is introduced.

Responses must not expose private keys, certificate PEM, raw tokens, signed URLs, or full certificate serials/fingerprints.

## Server Identity

The backend exposes safe labels in pairing status:

- `environment`
- `deploymentId`
- `serverId`
- `serverTime`

Configured through:

- `SIGNHEX_ENVIRONMENT_NAME`
- `SIGNHEX_DEPLOYMENT_ID`
- `SIGNHEX_SERVER_ID`

Players may send optional headers:

- `x-signhex-environment-name`
- `x-signhex-deployment-id`
- `x-darshan-environment-name`
- `x-darshan-deployment-id`

If present and mismatched, pairing status returns `409 ENVIRONMENT_MISMATCH`. Absence of these headers remains backward compatible for older players.

## Phase Boundaries

- GP-1: backend pairing truth, environment mismatch, orphan detection.
- GP-2: Electron startup validation and reset/re-pair behavior.
- GP-3: CMS orphan visibility and admin revoke, with reclaim visible but disabled.
- GP-4: installer and on-prem reset runbook, plus explicit reset tooling dry-run/cache policy.
- GP-5: clone/duplicate identity warning-mode detection and admin visibility.
- GP-6: full reinstall/delete/orphan/clone E2E matrix and targeted automated evidence, with browser/on-prem runtime rows explicitly classified.

## GP-5 Duplicate Identity Policy

Duplicate player identity detection is layered and warning-first. It does not use hardware fingerprint as the source of truth and it does not auto-revoke live players by default.

The player now maintains:

- an install instance id, persisted in local device state and cleared by `reset-pairing`.
- a runtime session id, generated on every app launch.

The player sends safe session metadata through pairing-status and heartbeat. The backend records active leases in the screen `device_info.identity_sessions` JSON state, hashes/redacts sensitive evidence, and reports a duplicate identity conflict when the same device id has multiple active runtime sessions beyond the restart grace window.

Default controls:

- `DUPLICATE_IDENTITY_DETECTION_ENABLED=true`
- `DUPLICATE_IDENTITY_ENFORCEMENT=warn`
- `DEVICE_SESSION_LEASE_MS=300000`
- `DEVICE_SESSION_RESTART_GRACE_MS=120000`

In `warn` mode, pairing-status remains `VALID` or `VALID_NO_CONTENT` and includes `duplicateIdentity` details for CMS/admin diagnostics. Existing playback is not disrupted. In `block` mode, pairing-status can return a reclaim-required duplicate conflict and the player enters recovery according to GP-2 rules.

CMS Pairing Health exposes duplicate identity conflicts with bounded, redacted evidence: install/runtime suffixes, hashed machine/IP/user-agent signals, player version, source, and timestamps. Admin resolution uses existing revoke plus local reset-pairing. Reclaim remains disabled until a future fresh-pairing reclaim flow exists.

Limitations:

- Non-concurrent cloned installs may not be detected until more than one copy connects during the active lease window.
- A quick restart is intentionally not flagged until sessions age past the restart grace.
- GP-6 must still provide full clone/reinstall/delete/orphan E2E evidence.

## GP-6 Evidence Policy

GP-6 classifies each scenario as automated, browser-required, manual/on-prem-required, blocked, or deferred. The canonical matrix lives in:

- `docs/implementation/ghost-pairing-e2e-matrix.md`

Automated GP-6 coverage exercises backend pairing truth, revoke, orphan reporting, duplicate identity warnings, player startup validation, old-backend rollout safety, reset tooling, offline grace, and no-secret response/CLI behavior.

Browser/on-prem evidence remains mandatory before production readiness:

- CMS Pairing Health visual and action smoke.
- Packaged player clean reinstall/reset/revoke/re-pair smoke.
- Two-player copied app-data duplicate identity smoke.
- Runtime log/snapshot no-secret review.

## GP-4 Reset And Reinstall Policy

Normal upgrades preserve identity. Normal uninstall is not a reliable clean identity wipe because Electron app data, legacy Linux config/certs/cache, or service-user runtime data can survive package removal.

Clean reinstall requires explicit operator action:

```bash
darshan-player --pairing-status
darshan-player reset-pairing --dry-run
darshan-player reset-pairing --reason=clean_reinstall
```

`reset-pairing` clears local device id, certificate artifacts, certificate metadata, pairing validation state, cached snapshot metadata, and cached default-media metadata. It preserves media cache, logs, screenshots, proof-of-play spool, and offline request queue by default.

`reset-pairing --clear-cache` additionally clears media cache targets only. It still preserves proof-of-play and request queue data.

Detailed operator steps live in:

- `docs/runbooks/player-clean-reinstall-reset.md`
- `docs/runbooks/onprem-player-ghost-pairing-recovery.md`

## Rollout Rule

Deploy backend pairing-status before enabling GP-2 player validation. If a new player is deployed before the backend supports pairing-status, it must not clear identity solely because the endpoint is missing. Backend-first rollout is required for production and air-gapped on-prem sites.
