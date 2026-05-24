# Realtime Sync Production Readiness Checklist

Last updated: 2026-05-24
Updated by: Codex

## Production readiness state

Current state: NOT_PRODUCTION_READY

Reason: Phase 8 tooling and checklists exist, but real QA load/chaos execution, Node 20 rerun, QA proxy smoke, canary rollback evidence, migration review, and dedicated metrics/alerts are still required.

## Required Gates

| Gate | Required evidence | Status |
|---|---|---|
| Node 20 build/test rerun | Backend, Electron, CMS builds and focused tests under Node `>=20 <21` | Open |
| Migration review | `0030`, `0031`, `0032` reviewed on QA-sized DB | Open |
| REST proxy smoke | `/api/v1/` through QA/prod proxy | Open |
| WebSocket proxy smoke | `/socket.io/` upgrade, idle timeout, origin, sticky-session behavior | Open |
| Backend/player realtime smoke | Packaged player through QA proxy | Open |
| Fallback rollback drill | Realtime disabled and publish/default/emergency still update by polling/heartbeat | Open |
| 1,000 player load | current, hybrid, fallback profiles | Open |
| 10,000 player load | current, hybrid, fallback profiles | Open |
| 50,000 player load | current, hybrid, fallback profiles or documented capacity cap | Open |
| Emergency fanout | emergency start/clear under load | Open |
| Reconnect storm | gateway/API remain stable with jitter/backoff | Open |
| Media egress | object storage/CDN/cache, no WebSocket media | Open |
| PoP/telemetry volume | batching/partitioning plan validated | Open |
| Metrics and alerts | required realtime/failure alerts configured and tested | Open |
| CMS lint | fixed or explicitly waived | Open |
| Operator UI smoke | Delivery tab command/media-cache status reviewed | Open |

## Production Canary Rule

Production realtime canary is not allowed until all required gates are passed or explicitly waived by a human approver with rollback responsibility.

## Rollback Rule

Rollback order:

1. `OUTBOX_DISPATCH_ENABLED=false`
2. `REALTIME_SYNC_ENABLED=false`
3. `HEXMON_REALTIME_SYNC_ENABLED=false`
4. Optional: `MEDIA_CACHE_REPORTING_ENABLED=false`
5. Keep REST, polling, heartbeat, command claim/ACK, snapshot/default/emergency fetch, and media cache active.
6. Leave additive DB schema in place.
