# Ghost Pairing Task Register

Status: GP-6 E2E/permutation evidence matrix recorded on 2026-06-16.

| ID | Scope | Status | Evidence | Remaining work |
|---|---|---|---|---|
| GP-0 | Record reinstall identity policy, state machine, loopholes, and phased plan | Complete | `docs/architecture/player-pairing-identity.md`, `docs/implementation/ghost-pairing-decision-log.md` | Keep updated as GP-3 to GP-6 land. |
| GP-1 | Backend pairing truth endpoint | Complete with conditions | `GET /api/v1/device/:deviceId/pairing-status` in `darshan-server/src/routes/device-telemetry.ts` | Production rollout still requires full runtime/E2E evidence. |
| GP-1.1 | Cleanup missing backend/docs items from independent review | Complete with conditions | Environment mismatch, orphan API, serial redaction, docs added | `screens.test.ts` reporting assertion remains triaged. |
| GP-2 | Electron startup validation and reset/re-pair behavior | Complete with conditions | `LOCAL_IDENTITY_PRESENT`, backend validation gate, reset command in `darshan-player` | Needs backend-first rollout and runtime device smoke. |
| GP-3 | CMS orphan/revoke/reclaim visibility | Complete with conditions | CMS Pairing Health panel, admin revoke endpoint/UI, disabled reclaim placeholder | Needs browser/runtime QA with real orphan/revoke scenarios; safe reclaim remains deferred. |
| GP-4 | Installer/on-prem reset runbook | Complete with conditions | Clean reset runbooks, `pairing-status`, reset dry-run, explicit cache policy | Needs packaged-player/on-prem smoke and independent verification. |
| GP-5 | Clone/duplicate identity detection | Complete with conditions | Install/runtime session metadata, backend session lease tracking, CMS duplicate conflict visibility | Needs on-prem duplicate-session smoke; non-concurrent clone limitation remains documented. |
| GP-6 | Full E2E/permutation tests | Complete with conditions | `docs/implementation/ghost-pairing-e2e-matrix.md`, `docs/implementation/ghost-pairing-phase-gp6-handoff.md`, targeted backend/player/CMS tests | Browser Pairing Health QA, packaged player on-prem smoke, and known reporting assertion remain before production readiness. |

## Loophole Status

| Loophole | Status | Notes |
|---|---|---|
| Uninstall leaves app-data identity | Mitigated, not eliminated | GP-2 no longer trusts local identity before validation; GP-4 documents clean reset. Automatic uninstall wipe remains intentionally unsupported. |
| Old local identity shows paired/no-content before validation | Fixed by GP-2 | Player gates paired/no-content behind backend validation or recent offline validation. |
| Old token/cert after normal screen delete | Mitigated by current delete cleanup and pairing-status mapping | Normal delete removes credentials; orphan rows are detected separately. |
| Heartbeat/snapshot accepted for missing/deleted screen | Mitigated | Device auth requires screen row; missing screen maps to stale pairing errors. |
| CMS cannot show orphan devices | Mitigated by GP-3 | CMS Pairing Health panel consumes the orphan API and exposes bounded diagnostic rows. |
| Environment mismatch | Backend implemented, player consumption partial | Optional headers return `ENVIRONMENT_MISMATCH`; rollout docs require same backend identity. |
| DB reset/manual orphan state | Mitigated | Orphan API detects key orphan categories. |
| Reclaim workflow | Deferred | GP-3 and GP-5 show disabled reclaim guidance; safe admin-approved reclaim still requires a future fresh-pairing workflow. |
| Clone/copy app-data duplicate identity | Mitigated, needs E2E | GP-5 detects concurrent duplicate runtime sessions in warn mode and exposes them in CMS. Non-concurrent clones may not be detected until both connect during the lease window. |
| Full E2E coverage | Mitigated with conditions | GP-6 matrix and targeted automated evidence exist; browser/on-prem runtime rows remain required before production readiness. |
