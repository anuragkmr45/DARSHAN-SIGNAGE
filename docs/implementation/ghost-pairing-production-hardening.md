# Ghost Pairing Production Hardening

Status: GP-6 E2E/permutation evidence matrix recorded on 2026-06-16.

## Problem

A player reinstalled on the same physical machine can retain local app data. If the local identity is stale, copied, orphaned, or points at a different backend, the player must not show "paired successfully" or "no content assigned" unless backend pairing truth confirms the screen/device is valid and CMS-visible.

## Product Policy

- Fresh reinstall defaults to new player / pairing required.
- Previous local identity is not enough to be paired.
- Backend pairing-status is authoritative.
- Player paired/no-content UI is blocked until backend validation succeeds.
- Explicit admin-approved reclaim is the only supported reclaim path.
- Offline playback is allowed only for a recently validated same identity.
- CMS orphan/revoke/reclaim visibility is GP-3.
- Installer/on-prem reset runbook is GP-4.
- Clone/duplicate identity warning-mode detection is GP-5.
- Full reinstall/delete/orphan/clone E2E coverage is GP-6.

## Implemented In GP-1 / GP-1.1

- Authenticated `GET /api/v1/device/:deviceId/pairing-status`.
- Safe server identity labels in config and pairing-status response.
- Optional environment/deployment header mismatch detection.
- Explicit stale status mapping for invalid token, missing screen, revoked pairing, and orphan credential.
- Admin-only orphan detection API at `GET /api/v1/device-pairing/orphans`.
- Full certificate serial redacted from pairing completion logging.

## Implemented In GP-2

- Player treats persisted identity as `LOCAL_IDENTITY_PRESENT` until backend validation succeeds.
- Cached playback/no-content UI is gated behind backend validation or recent offline validation.
- Stale pairing statuses force recovery and clear identity-bound snapshot/default-media state.
- `reset-pairing` operator command is available.
- Offline grace is allowed for recently validated same identity.
- Old-backend missing pairing-status endpoint regression is covered; player preserves local identity and enters recovery-required instead of wiping credentials.

## Implemented In GP-3

- CMS Screens page exposes Pairing Health diagnostics for orphan device certificates, pairings, heartbeats, and commands.
- CMS Pairing Health shows backend server identity labels to help catch environment mismatch.
- Admins can revoke a stale pairing from CMS; revoke marks active device certificates revoked and retires open pairing codes without deleting the screen.
- Reclaim is intentionally visible but disabled; safe reclaim remains a future fresh-pairing workflow.

## Implemented In GP-4

- `darshan-player --pairing-status` prints local pairing/validation diagnostics without certificate contents, private keys, or tokens.
- `darshan-player reset-pairing --dry-run` reports the reset target plan without deleting files.
- `darshan-player reset-pairing --clear-cache` explicitly clears media cache targets while preserving request queue/proof-of-play data.
- Operator diagnostics redact certificate serial/fingerprint values to suffixes.
- Clean reinstall and ghost-pairing recovery runbooks document the CMS revoke plus local reset sequence.
- Normal upgrade/uninstall behavior is documented as identity-preserving unless an operator explicitly resets.

## Implemented In GP-5

- Player generates a persistent install instance id and a per-launch runtime session id.
- Player sends redacted-safe session metadata through heartbeat and pairing-status.
- Backend records active identity session leases in `screens.device_info.identity_sessions`.
- Backend detects duplicate active runtime sessions for the same device id after restart grace and reports warning-mode conflicts.
- Pairing-status includes `duplicateIdentity` conflict summaries while preserving `VALID`/`VALID_NO_CONTENT` in warn mode.
- Heartbeat responses can include duplicate conflict summaries without breaking heartbeat fallback.
- CMS Pairing Health shows duplicate identity conflict counts, affected devices/screens, active sessions, redacted suffixes/hashes, and revoke guidance.
- `reset-pairing` clears install instance metadata.

## Implemented In GP-6

- Full E2E/permutation matrix created at `docs/implementation/ghost-pairing-e2e-matrix.md`.
- CMS API-domain unit coverage added for Pairing Health orphan report and revoke endpoint wiring.
- Targeted backend/player/CMS build and test commands were run and recorded in `docs/implementation/ghost-pairing-phase-gp6-handoff.md`.
- Browser Pairing Health QA and packaged on-prem runtime smoke are explicitly marked as not run rather than claimed.
- On-prem QA checklist created at `docs/runbooks/ghost-pairing-onprem-qa-checklist.md`.

## Conditions Before Production Approval

- GP-3 browser/on-prem QA must verify real orphan/revoke scenarios.
- GP-4 on-prem QA must verify dry-run/reset with the packaged player.
- GP-5 on-prem QA must verify duplicate-session runtime smoke.
- GP-6 matrix rows marked browser/manual/on-prem must be executed and attached as evidence.
- Backend-first rollout must be followed.
- Full suite, load, and runtime evidence remain required before production signoff.
- Latest on-prem runtime evidence attempt on 2026-06-16 is `BLOCKED_BY_ENV`; required `ONPREM_*` QA inputs are missing and local Node is `v24.12.0` instead of supported `>=20 <21`.

## Resolved Reporting Test Debt

`darshan-server/src/routes/screens.test.ts` now passes the `/api/v1/metrics/overview` assertion for `active_screens_now`. The metric was updated to count active published direct/group schedule targets plus the existing heartbeat/current-schedule fallback. Targeted backend build, screen route, device telemetry auth, and device pairing tests passed on 2026-06-16.

## Approval Position

GP-1 through GP-6 are implementation-complete with conditions pending independent verification of GP-6, packaged/on-prem runtime evidence, browser Pairing Health QA, and Node 20 rerun. The 2026-06-16 production readiness review is `NOT_PRODUCTION_READY` because runtime evidence is blocked by missing on-prem QA inputs. This is not full production approval.
