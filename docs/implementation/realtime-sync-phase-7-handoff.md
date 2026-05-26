# Phase 7 Handoff: QA/Prod Deployment Hardening

Last updated: 2026-05-24
Updated by: Codex
Phase: Phase 7 - QA/prod deployment hardening
Approval state: APPROVED_WITH_CONDITIONS

## Summary

Phase 7 adds deployment controls for QA/prod rollout of the existing enterprise realtime sync architecture. It does not implement Phase 8 load/chaos testing, Phase 9 mobile adapters, WebSocket semantic changes, Electron realtime changes, CMS UI changes, or migrations.

## Implemented Scope

- Added QA/prod realtime sync deployment hardening runbook.
- Added QA realtime sync environment checklist.
- Added production realtime sync environment checklist.
- Added explicit Nginx REST and Socket.IO proxy snippet.
- Added static validation script for Phase 7 deployment assets.
- Updated realtime sync project status, task register, approval log, test plan, open risks, and architecture docs.

## Out Of Scope

- Load tests.
- Chaos tests.
- Reconnect storm validation.
- Emergency fanout validation.
- Mobile/TV player implementation.
- Production enablement.
- Distributed registry or Valkey fanout implementation.

## Files Added

- `signhex-platform/docs/runbooks/realtime-sync-qa-prod-hardening.md`
- `signhex-platform/docs/environments/qa/realtime-sync.env.example`
- `signhex-platform/docs/environments/production/realtime-sync.env.example`
- `signhex-platform/deploy/shared/realtime-sync-nginx.socketio.conf.template`
- `signhex-platform/scripts/verify/validate-realtime-sync-phase7-assets.sh`
- `signhex-platform/docs/implementation/realtime-sync-phase-7-handoff.md`

## Files Updated

- `signhex-platform/docs/implementation/realtime-sync-project-status.md`
- `signhex-platform/docs/implementation/realtime-sync-task-register.md`
- `signhex-platform/docs/implementation/realtime-sync-phase-approval-log.md`
- `signhex-platform/docs/implementation/realtime-sync-test-plan.md`
- `signhex-platform/docs/implementation/realtime-sync-open-risks.md`
- `signhex-platform/docs/implementation/realtime-sync-implementation-runbook.md`
- `signhex-platform/docs/implementation/realtime-sync-decision-log.md`
- `signhex-platform/docs/implementation/realtime-sync-remaining-phase-control-plan.md`
- `signhex-platform/docs/architecture/enterprise-realtime-sync.md`
- `signhex-platform/docs/architecture/failure-modes.md`
- `signhex-platform/docs/runbooks/onprem-qa-setup.md`
- `signhex-platform/docs/runbooks/onprem-production-setup.md`

## Validation

Run:

```bash
bash signhex-platform/scripts/verify/validate-realtime-sync-phase7-assets.sh
```

Expected:

```text
[phase7] realtime sync deployment hardening assets validated
```

Latest result: passed on 2026-05-24.

Additional compile evidence from 2026-05-24:

- `cd signhex-server && npm run build`: passed under local Node `v24.12.0`.
- `cd signage-screen && npm run build`: passed under local Node `v24.12.0`.
- `cd signhex-nexus-core && npm run build`: passed under local Node `v24.12.0`.
- `cd signhex-nexus-core && npm run lint`: failed due existing lint issues outside Phase 7 changed files.

## Conditions Carried Forward

- Rerun backend, Electron, and CMS builds/tests under Node `>=20 <21`.
- Review migrations `0030`, `0031`, and `0032` on QA-sized data.
- Validate QA `/socket.io/` proxy upgrade, idle timeout, and sticky-session behavior.
- Run packaged player/backend realtime smoke through QA proxy.
- Resolve or explicitly waive existing CMS lint failures.
- Define `media_cache_reports` retention/partitioning and dedicated metrics/alerts.
- Decide Valkey/distributed registry before multi-instance production realtime enablement.

## Rollback

Rollback is feature-flag based:

1. Set `OUTBOX_DISPATCH_ENABLED=false`.
2. Set `REALTIME_SYNC_ENABLED=false`.
3. Set `HEXMON_REALTIME_SYNC_ENABLED=false`.
4. Optionally set `MEDIA_CACHE_REPORTING_ENABLED=false` and `HEXMON_MEDIA_CACHE_REPORTING_ENABLED=false`.
5. Leave additive DB schema and enum values in place.
6. Keep polling, heartbeat, REST command claim/ACK, snapshot/default/emergency fetch, and media cache active.

## Phase 8 Gate

Phase 8 may start only after Phase 7 conditions are accepted. Phase 8 must focus on load, chaos, reconnect storm, emergency fanout, and production readiness validation. It must not implement mobile/TV adapters.
