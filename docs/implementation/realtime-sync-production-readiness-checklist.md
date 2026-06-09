# Realtime Sync Production Readiness Checklist

Last updated: 2026-06-09
Updated by: Codex

## Production readiness state

Current state: NOT_PRODUCTION_READY

Reason: Phase 8 tooling, checklists, local static validation, CMS lint fix, dedicated metrics/alerts, and local Valkey fanout implementation exist, but real air-gapped on-prem QA load/chaos execution is blocked by missing on-prem QA endpoints, Valkey topology, and simulator credentials. Node 20 rerun, on-prem proxy smoke, on-prem multi-node Valkey fanout evidence, canary rollback evidence, migration review, retention approval, and alert threshold tuning are still required.

## Required Gates

| Gate | Required evidence | Status |
|---|---|---|
| Node 20 build/test rerun | Backend, Electron, CMS builds and focused tests under Node `>=20 <21` | Open |
| Migration review | `0030`, `0031`, `0032` reviewed on QA-sized DB | Open |
| On-prem dev smoke | `/api/v1/`, CMS, and `/socket.io/` through internal dev endpoints | Open |
| REST proxy smoke | `/api/v1/` through on-prem QA/prod proxy | Open |
| WebSocket proxy smoke | `/socket.io/` upgrade, idle timeout, origin, selected transport, and sticky-session setting if polling is enabled | Open |
| Signed and legacy player socket auth smoke | selected signed canary players connect in signed mode while existing legacy players still connect | Open |
| Valkey connectivity and fanout smoke | backend nodes connect to Valkey and publish/subscribe wake events under the configured namespace | Partial - local Docker Valkey Pub/Sub smoke passed; on-prem HA topology open |
| Multi-node fanout smoke | player socket on node A, command created on node B, Valkey wakes node A, player fetches by REST and ACKs | Partial - local simulated node A/node B Pub/Sub smoke passed; real backend/player evidence open |
| Valkey replay across backend nodes | shared replay cache records fresh signed handshakes and rejects controlled duplicates across node A/node B | Open |
| Valkey outage fallback | Valkey unavailable while `command_outbox`, REST, polling, heartbeat, schedule/default/emergency delivery continue | Open |
| Backend/player realtime smoke | Packaged player through on-prem QA proxy | Open |
| Signed-auth canary rollback drill | player signed auth, optional server signed auth, and replay protection roll back while legacy socket auth and REST fallback remain available | Open |
| Fallback rollback drill | Realtime disabled and publish/default/emergency still update by polling/heartbeat | Open |
| 1,000 player load | current, hybrid, fallback profiles | Open |
| 10,000 player load | current, hybrid, fallback profiles | Open |
| 50,000 player load | current, hybrid, fallback profiles or documented capacity cap | Open |
| Emergency fanout | emergency start/clear under load | Open |
| Reconnect storm | gateway/API remain stable with jitter/backoff | Open |
| Media egress | on-prem object storage/MinIO/internal S3/file-server/cache, no WebSocket or Valkey media | Open |
| PoP/telemetry volume | batching/partitioning plan validated | Open |
| Metrics and alerts | required realtime/failure alerts configured, tested locally, and tuned under QA traffic | Partial - local static validation passed |
| CMS lint | fixed or explicitly waived | Partial - local Node `v24.12.0` lint passed; Node 20 rerun required |
| Operator UI smoke | Delivery tab command/media-cache status reviewed | Open |
| Media/cache report retention | product/DBA approved retention and partitioning policy | Open |

## Latest Runtime Evidence Attempt

Date: 2026-05-24

Result: BLOCKED_BY_ENV

Evidence:

- no on-prem QA endpoint or Valkey environment variables available in the local shell,
- packaged QA server health check reports `postgres` service is not running,
- packaged QA CMS health check returns HTTP 404,
- local backend and `/socket.io/` checks cannot connect to `127.0.0.1:3000`.

See `realtime-sync-phase-8-runtime-evidence.md`.

Latest documentation/static validation after the on-prem/Valkey update on 2026-05-25:

- `bash scripts/verify/validate-realtime-sync-phase7-assets.sh`: passed.
- `bash scripts/verify/validate-realtime-sync-phase8-assets.sh`: passed.
- `bash scripts/verify/validate-observability-assets.sh`: passed after Docker escalation.
- `cd darshan-server && npm run build`: passed after Valkey fanout implementation.
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts`: passed, 19 tests.
- `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts`: passed against temporary local `valkey/valkey:9.0.3-alpine` after sandbox network escalation.

## Production Canary Rule

Production realtime canary is not allowed until all required gates are passed or explicitly waived by a human approver with rollback responsibility.

Signed `/device` socket auth canary uses existing dual-mode flags only:

- Backend `DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true` remains the compatibility posture.
- Backend `DEVICE_SOCKET_SIGNED_AUTH_ENABLED=true` and `DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED=true` remain the signed canary posture.
- Backend `DEVICE_SOCKET_AUTH_REPLAY_FAIL_CLOSED=false` remains the canary posture unless a separate runtime plan approves fail-closed behavior.
- Player `DARSHAN_REALTIME_SIGNED_AUTH_ENABLED=true` applies only to selected canary players.

Sticky-session-only production realtime is not an approved gate outcome. Sticky sessions may be enabled only as a load-balancer compatibility setting when Socket.IO HTTP polling transport remains enabled. Multi-instance notification routing requires Valkey-backed fanout; DB outbox and polling/heartbeat remain the delivery safety net.

## Rollback Rule

Rollback order:

1. `DARSHAN_REALTIME_SIGNED_AUTH_ENABLED=false` on canary players.
2. `DEVICE_SOCKET_SIGNED_AUTH_ENABLED=false` if optional signed auth causes rejects.
3. `DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED=false` if replay protection causes rejects.
4. Keep `DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true` for compatibility.
5. `OUTBOX_DISPATCH_ENABLED=false`
6. `REALTIME_SYNC_ENABLED=false`
7. `DARSHAN_REALTIME_PLAYER_ENABLED=false`
8. Optional: `MEDIA_CACHE_REPORTING_ENABLED=false`
9. Keep REST, polling, heartbeat, command claim/ACK, snapshot/default/emergency fetch, and media cache active.
10. Leave additive DB schema in place.
