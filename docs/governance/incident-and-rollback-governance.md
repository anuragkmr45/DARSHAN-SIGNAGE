# Incident And Rollback Governance

Last code-truth refresh: 2026-06-28.

This document defines governance rules for incidents, emergency controls, rollback, recovery, and evidence capture.

## Evidence Sources

| Incident area | Source of truth |
|---|---|
| Emergency/takeover | `darshan-server/src/routes/emergency.ts`, `darshan-cms/src/components/requests/EmergencyTakeoverModal.tsx`, player command processing services |
| Command/realtime rollback | `darshan-server/src/services/command-lifecycle-service.ts`, `command-outbox-service.ts`, `outbox-dispatcher.ts`, `darshan-player/src/main/services/command-processor.ts`, realtime services |
| Player recovery/reset | `darshan-player/src/main/services/pairing-service.ts`, `player-flow.ts`, `operator-tools.ts`, `cli.ts` |
| Config rollback | backend/CMS/player config loaders and `docs/runbooks/onprem-config-management.md` |
| Docker rollback | `deploy/production/docker/stop-all.sh`, role compose files, `deploy/production/docker/README.md` |
| Observability incidents | `deploy/shared/observability/*`, `docs/runbooks/observability-*` |

## Incident Classes

| Incident | Primary owner | First response | Evidence required |
|---|---|---|---|
| Backend API down | Backend/platform/ops | Check backend container, DB, MinIO, Valkey, runtime dependencies | health, logs after redaction, container state, DB/storage checks |
| CMS unavailable | CMS/platform/ops | Check CMS nginx container, runtime config, API/socket proxy | browser/network evidence after no-secret review |
| Player offline | Player/support/backend | Check heartbeat, pairing-status, config, network, device logs | player doctor/pairing-status redacted output, backend screen state |
| Realtime latency/failure | Backend/platform/player/CMS | Confirm REST/polling path, Valkey, Socket.IO proxy, command outbox | command desired-state/ACK evidence, socket and polling evidence |
| Default media not updating | Backend/CMS/player | Check CMS assignment, backend desired state/outbox, player fetch/realtime/polling | backend response, command/desired-state evidence, player behavior |
| Emergency active/stuck | Backend/CMS/player/ops | Use emergency status/clear routes and verify player behavior | audit logs, command state, CMS status, player screen evidence |
| Media rendering failure | Backend/player/support | Check media object URL/cache/player renderer/runtime tools | media metadata, cache/logs redacted, screen evidence |
| Observability failure | Platform/ops | Check Prometheus/Grafana containers, scrape config, CMS `/grafana` proxy | health/scrape logs, dashboard/rule status |

## Rollback Rules

| Rollback | Governance rule |
|---|---|
| Realtime rollback | Disable realtime/outbox dispatch where configured, but keep REST polling, heartbeat, command APIs, and DB state intact. |
| Config rollback | Revert selectors/config files. Do not delete runtime state unless a reset runbook explicitly requires it. |
| Backend Docker rollback | Roll back image/compose/env with DB compatibility review. Validate `/api/v1/health`, worker/all-role behavior, DB, MinIO, Valkey. |
| CMS Docker rollback | Roll back static image/runtime config. Validate `/`, nested routes, `/api/v1`, `/socket.io`, and `/grafana` proxy paths. |
| Player rollback | Install prior package if compatible. Preserve identity/certs/cache/queues unless destructive recovery is approved. |
| Data rollback | Requires DBA/platform approval. DB and MinIO must remain consistent. |
| Observability rollback | Preserve Prometheus/Grafana volumes unless reset is approved; validate scrape and dashboard load. |

## Evidence Capture Rules

- Capture exact time, target host/device, command, expected result, actual result, and blocker.
- Redact secrets and credentialed URLs before sharing.
- Save browser screenshots only after checking for sensitive config/network data.
- Save player doctor/log/support data only after no-secret review.
- Do not treat a local reproduction as production evidence unless it ran on the stated production-like target.
- Do not claim recovery success until the affected user-visible flow is verified: CMS view, backend health/state, and player behavior where applicable.

## Emergency Governance

- Emergency/takeover is an operational control, not a design or scheduling shortcut.
- Trigger/clear actions must remain auditable through backend state and audit logs.
- Emergency rollback must confirm CMS status and player display state.
- Emergency evidence must not expose sensitive messages, site names, screen identifiers, or operator identities beyond the approved audience.

## Player Recovery Governance

- If backend says pairing is invalid, revoked, deleted, or environment-mismatched, player recovery behavior must be driven by code-backed pairing-status flow.
- If backend is temporarily unavailable, offline/cache behavior depends on player security/offline config and last validation state.
- Manual app-data deletion is destructive and must not be the default recovery path.
- Re-pairing an existing physical screen should use approved recovery/OTP flow and preserve evidence queues unless explicitly cleared.

