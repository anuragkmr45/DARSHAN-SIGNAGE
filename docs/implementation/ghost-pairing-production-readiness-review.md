# Ghost Pairing Production Readiness Review

Status: NOT_PRODUCTION_READY
Date/time: 2026-06-16 14:27 IST
Reviewer: Codex

## Summary

Ghost Pairing GP-1 through GP-6 have local automated evidence and remain APPROVED_WITH_CONDITIONS. This production-readiness review cannot approve production because real browser/on-prem packaged runtime evidence was not collected. The required on-prem QA inputs are missing, and the available local Node runtime is `v24.12.0` rather than the supported `>=20 <21` line.

## Evidence Reviewed

- `docs/implementation/ghost-pairing-e2e-matrix.md`
- `docs/implementation/ghost-pairing-phase-gp6-handoff.md`
- `docs/runbooks/ghost-pairing-onprem-qa-checklist.md`
- `docs/runbooks/player-clean-reinstall-reset.md`
- `docs/runbooks/onprem-player-ghost-pairing-recovery.md`
- `docs/implementation/realtime-sync-open-risks.md`
- `ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md`
- `docs/implementation/ghost-pairing-onprem-qa-evidence.md`

## Runtime Evidence Status

| Area | Status | Reason |
|---|---|---|
| Browser CMS Pairing Health QA | BLOCKED_BY_ENV | No `ONPREM_QA_CMS_BASE_URL` or `ONPREM_QA_BACKEND_BASE_URL`. |
| Packaged player smoke | BLOCKED_BY_ENV | No packaged QA player target or backend/pairing inputs. |
| Reinstall/app-data persistence smoke | BLOCKED_BY_ENV | No packaged player machine or backend target. |
| Duplicate cloned identity smoke | MANUAL_ONPREM_REQUIRED | Requires two test machines or isolated runtime roots; none provided. |
| Environment mismatch smoke | BLOCKED_BY_ENV | No safe QA target for mismatch configuration. |
| Runtime no-secret review | BLOCKED_BY_ENV | No browser network artifacts, runtime logs, player CLI output, or screenshots. |
| Node 20 validation | BLOCKED_BY_ENV | Local Node is `v24.12.0`; supported target is `>=20 <21`. |
| Config architecture | CONFIG_BACKEND_JSON_LOADER_READY / CONFIG_PLAYER_JSON_ALIGNMENT_READY / CMS_RUNTIME_CONFIG_READY / PROFILE_SETS_READY / RUNTIME_VALIDATION_PENDING | CONFIG-1 added optional backend JSON config loading with env override compatibility. CONFIG-2 added optional player-specific JSON site config loading while preserving runtime config behavior. CONFIG-2.3 closed remaining player URL emission gaps. CONFIG-3 added optional CMS browser runtime JSON config with Vite fallback. CONFIG-4 added dev/QA/prod profile sets and static validation. Runtime validation remains blocked by missing on-prem inputs and Node 20. |
| CONFIG-5A runtime readiness | BLOCKED_BY_ENV | `docs/implementation/config-phase-5a-readiness-handoff.md` records local listener discovery, failed health checks, missing Node 20, missing packaged player artifact, and readiness script `MISSING_INPUT`. |

## Local Test Status

The known `screens.test.ts` reporting assertion was rerun locally under Node `v24.12.0`:

```bash
cd darshan-server && npx vitest run src/routes/screens.test.ts
```

Result:

- Test file: 1 passed.
- Tests: 19 passed.

This confirms the reporting fix is still green locally, but it is not a substitute for Node 20 or packaged runtime evidence.

## Production Blockers

- Browser CMS Pairing Health QA has not run.
- Packaged player fresh pair, revoke, reset, reinstall, and re-pair smoke has not run.
- Duplicate cloned identity smoke has not run.
- Environment mismatch smoke has not run.
- Runtime no-secret review has not run.
- Node 20 build/test validation has not run.
- On-prem media/Valkey/Prometheus/proxy evidence is unavailable.
- Config runtime validation has not run with site-specific backend/player/CMS profile sets.
- CMS optional runtime config loader is implemented locally but browser/on-prem validation has not run.
- Backend/player/CMS config runtime validation with real on-prem site config has not run.
- CONFIG-5A readiness remains blocked: local health checks failed, Node 20 was not found, packaged player artifact was not found, and required runtime env inputs are missing.

## Required Inputs Before Approval

- `ONPREM_QA_BACKEND_BASE_URL`
- `ONPREM_QA_CMS_BASE_URL`
- `ONPREM_QA_SOCKET_IO_URL` if realtime socket validation is in scope
- `ONPREM_POSTGRES_URL` or packaged QA DB access if DB validation is in scope
- `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH` or an approved test pairing workflow
- `ONPREM_MEDIA_ENDPOINT` if content/default media is tested
- `ONPREM_VALKEY_URL` if realtime fanout is tested
- `ONPREM_PROMETHEUS_URL` or log path if metrics/log validation is tested
- Internal CA/TLS trust details if HTTPS is used
- Node `>=20 <21` runtime or packaged runtime version evidence
- Packaged player artifact and QA Linux player machine
- Second player machine or isolated runtime root for duplicate identity smoke

## Recommendation

DO_NOT_APPROVE_PRODUCTION. Continue with on-prem evidence collection only after the required QA environment inputs, supported Node/runtime, and a recorded site config profile are available. Keep `DUPLICATE_IDENTITY_ENFORCEMENT=warn` unless separately approved.
