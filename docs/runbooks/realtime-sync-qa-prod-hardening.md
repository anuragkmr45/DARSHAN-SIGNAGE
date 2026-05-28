# Enterprise Realtime Sync QA/Prod Hardening Runbook

Last updated: 2026-05-24
Updated by: Codex
Phase: Phase 7 - QA/prod deployment hardening

## Purpose

This runbook hardens deployment controls for the enterprise realtime sync architecture before Phase 8 load/chaos testing and production readiness work. All dev, QA, and production targets are assumed to be air-gapped on-prem/internal networks unless a human records an explicit exception.

It does not introduce new runtime semantics. The approved architecture remains:

- DB tables, `schedule_snapshots`, and `device_commands` are source of truth.
- WebSocket is notification/wake-up only.
- REST APIs are authoritative for commands, snapshots, default media, emergency state, ACK, heartbeat, PoP, desired state, and diagnostics.
- Media is delivered through HTTP/object storage/CDN/local cache, never WebSocket.
- Polling and heartbeat fallback remain mandatory.
- QA/prod enablement must be feature-flagged and rollback-safe.
- On-prem object storage or MinIO is the media egress layer; no public media CDN is assumed.
- Valkey is the approved on-prem cross-node realtime fanout/coordination layer for multi-instance production.

## Non-Goals

- No Phase 8 load, chaos, reconnect storm, or production capacity testing.
- No Phase 9 mobile/TV adapter implementation.
- No WebSocket protocol expansion.
- No Electron realtime/adaptive polling changes.
- No CMS UI changes.
- No migration changes.

## Phase 7 Deployment Controls

Phase 7 adds these deployment controls:

- QA and production realtime sync environment templates.
- Nginx proxy snippet for REST and Socket.IO upgrade paths.
- QA/prod canary and rollback checklist.
- Static validation script for required Phase 7 deployment assets.
- Handoff/status documentation for the Phase 8 gate.

## Feature Flag Policy

Realtime behavior must be enabled in layers. Never enable all flags for the full fleet at once.

| Layer | Backend flag | Player/CMS flag | Default rollout posture |
|---|---|---|---|
| Outbox writes | `COMMAND_OUTBOX_WRITE_ENABLED` | none | Enabled only after additive migrations are applied and reviewed |
| Desired state | `DEVICE_DESIRED_STATE_ENABLED` | player desired-state polling config | Enabled after REST endpoint smoke passes |
| WebSocket gateway | `REALTIME_SYNC_ENABLED` | `DARSHAN_REALTIME_PLAYER_ENABLED` (`HEXMON_REALTIME_SYNC_ENABLED` legacy alias) | Disabled until QA proxy/runtime smoke passes |
| Outbox dispatcher | `OUTBOX_DISPATCH_ENABLED` | none | Disabled until gateway health and rollback are verified |
| Delivery UI | backend APIs | `VITE_REALTIME_DELIVERY_STATUS_UI` | Enabled for QA operators first |
| Media/cache reporting | `MEDIA_CACHE_REPORTING_ENABLED` | `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED`, `VITE_MEDIA_CACHE_STATUS_UI` | Enabled in QA; production requires retention/alerts |
| Realtime bus | `REALTIME_BUS_PROVIDER=valkey`, `VALKEY_URL` | none | Required before multi-instance production realtime |

## QA Recommended Values

Use `docs/environments/qa/realtime-sync.env.example` as the deployment checklist. For QA:

- Enable additive DB write paths after migration review.
- Keep `REALTIME_SYNC_ENABLED=false` until `/socket.io/` proxy smoke passes.
- Keep `OUTBOX_DISPATCH_ENABLED=false` until gateway smoke passes.
- Use a small canary player set before fleet-wide enablement.
- Keep command safety and fallback polling enabled.

## Production Recommended Values

Use `docs/environments/production/realtime-sync.env.example` as the deployment checklist. For production:

- Default realtime WebSocket and dispatcher flags to disabled until QA evidence is accepted.
- Enable by canary group, not by whole fleet.
- Keep polling and heartbeat fallback enabled for every player.
- Keep media/cache reporting enabled only after retention and alerting are defined.
- Record the exact rollback command set in the site handoff.

## Proxy And TLS Requirements

REST and WebSocket paths can share the same internal backend origin, but they must remain semantically separate.

Required reverse-proxy paths:

- `/api/v1/` for authoritative REST.
- `/socket.io/` for notification-only Socket.IO transport.

Required proxy behavior:

- Preserve `Host`, `X-Forwarded-For`, `X-Real-IP`, and `X-Forwarded-Proto`.
- Allow HTTP upgrade on `/socket.io/`.
- Set read/send timeouts greater than the configured WebSocket ping interval and idle timeout.
- Disable proxy buffering for `/socket.io/`.
- Do not cache REST device command, desired-state, heartbeat, ACK, media-cache report, or delivery-status responses.

Use `deploy/shared/realtime-sync-nginx.socketio.conf.template` as the explicit snippet.

## Multi-Instance Backend Rule

The current Phase 3 device connection registry is process-local. A multi-instance on-prem backend deployment must use Valkey-backed fanout/distributed coordination. Do not approve sticky-session-only production realtime.

Required production direction:

- `REALTIME_BUS_PROVIDER=valkey`
- `VALKEY_URL`
- `VALKEY_PUBSUB_ENABLED=true`
- DB `command_outbox`, `device_commands`, `schedule_snapshots`, and `device_desired_state` remain durable source of truth
- Valkey Pub/Sub is non-durable wake fanout only
- Valkey Streams are optional later only if broker-side persisted fanout is explicitly required

Sticky sessions:

- may be enabled for load-balancer compatibility if Socket.IO HTTP polling transport is enabled
- are not sufficient for cross-node notification routing
- must not be the only production multi-instance routing/fanout mechanism

Preferred transport:

- validate WebSocket-only device realtime where possible
- keep `REALTIME_SOCKET_ALLOW_POLLING=false` after validation
- if polling remains enabled, set `REALTIME_SOCKET_REQUIRE_STICKY_SESSIONS=true` and still keep Valkey fanout for multi-node routing

Do not enable full-fleet realtime sync across multiple backend instances until Valkey fanout and fallback behavior are recorded and tested.

## QA Canary Procedure

1. Apply reviewed additive migrations.
2. Start backend with REST, polling, heartbeat, command lifecycle, outbox writes, desired state, and media/cache reporting enabled.
3. Keep `REALTIME_SYNC_ENABLED=false` and `OUTBOX_DISPATCH_ENABLED=false`.
4. Pair one QA player and verify legacy polling/heartbeat command refresh still works.
5. Validate `GET /api/v1/device/:deviceId/desired-state` with device auth.
6. Validate CMS delivery and media/cache status cards with seeded or real data.
7. Enable backend `REALTIME_SYNC_ENABLED=true` for the QA environment.
8. Enable one canary player with `DARSHAN_REALTIME_PLAYER_ENABLED=true`.
9. Verify the player receives notification-only events and fetches commands/state through REST.
10. For multi-node QA, validate Valkey connectivity and fanout before enabling dispatcher.
11. Enable `OUTBOX_DISPATCH_ENABLED=true` for the QA backend.
12. Publish schedule/default/emergency changes and confirm:
    - `command_outbox` rows are dispatched or retryable.
    - player still claims commands through REST.
    - ACKs are stored.
    - fallback polling catches missed notifications.
13. Expand canary only after the smoke checklist passes.

## Phase 8B Air-Gapped On-Prem Runtime Evidence

Phase 8B must use internal/on-prem endpoints and must not require public endpoints or cloud services.

Required evidence:

1. On-prem dev smoke.
2. On-prem QA proxy smoke.
3. On-prem Socket.IO `/device` or `/socket.io/` smoke.
4. On-prem Valkey connectivity and fanout smoke.
5. Multi-node backend/gateway fanout test:
   - player socket connected to node A
   - CMS/API command created on node B
   - Valkey fanout wakes node A
   - player receives `COMMAND_AVAILABLE`
   - player fetches command via REST
   - player ACKs via REST
6. Valkey outage fallback:
   - Valkey unavailable
   - `command_outbox` remains durable
   - player gets command by polling/heartbeat
   - no source-of-truth loss
7. Reconnect storm.
8. Emergency fanout.
9. Publish storm.
10. PoP/media-cache report flood.
11. Canary rollback:
   - disable `OUTBOX_DISPATCH_ENABLED`
   - disable `REALTIME_SYNC_ENABLED`
   - disable `DARSHAN_REALTIME_PLAYER_ENABLED`
   - keep REST/polling/heartbeat/snapshot/default/emergency active.

Production readiness must remain `NOT_PRODUCTION_READY` until these pass or are explicitly waived by a human approver.

## Rollback Procedure

Rollback must not require DB rollback.

1. Set `OUTBOX_DISPATCH_ENABLED=false`.
2. Set `REALTIME_SYNC_ENABLED=false`.
3. Set player `DARSHAN_REALTIME_PLAYER_ENABLED=false` through config management or next installer/config rollout.
4. Keep command polling, heartbeat, snapshot fetch, default media fetch, emergency fetch, and media cache active.
5. Optional: set `MEDIA_CACHE_REPORTING_ENABLED=false` and `DARSHAN_MEDIA_CACHE_REPORTING_ENABLED=false` if report ingestion causes unexpected pressure.
6. Leave additive tables and enum values in place.
7. Record rollback evidence in the phase handoff.

## Smoke Checklist

| Check | Required before production? | Evidence |
|---|---:|---|
| Backend build under Node 20 | yes | command output |
| Electron build under Node 20 | yes | command output |
| CMS build under Node 20 | yes | command output |
| CMS lint fixed or waived | yes | lint output or waiver |
| Additive migrations reviewed on QA-sized DB | yes | migration review note |
| `/api/v1/` through proxy | yes | curl/browser result |
| `/socket.io/` upgrade through proxy | yes | gateway smoke result |
| Valkey fanout decision and connectivity | yes | decision log and Valkey smoke |
| Multi-node node A/node B fanout | yes | command delivery evidence |
| Sticky-session setting if Socket.IO polling is enabled | yes | proxy/LB config evidence |
| Polling/heartbeat fallback with realtime disabled | yes | command delivery evidence |
| Fallback catches missed WebSocket notification | yes | command delivery evidence |
| Media/cache report retention defined | yes | retention note |
| Dedicated metrics/alerts for realtime and media/cache failures | yes | dashboard/alert evidence |

## Phase 8 Gate

Phase 8 may start only after Phase 7 conditions are accepted. Phase 8 owns:

- load tests,
- chaos tests,
- reconnect storm validation,
- emergency fanout validation,
- production readiness signoff,
- final dashboard/alert verification.
