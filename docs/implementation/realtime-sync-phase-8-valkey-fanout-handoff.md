# Phase 8 Valkey Fanout Handoff

Last updated: 2026-05-25
Updated by: Codex
Phase: Phase 8 backfill - Valkey fanout/distributed coordination
Approval state: IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME
Production readiness: NOT_PRODUCTION_READY
Phase 9 state: BLOCKED

## Summary

Valkey-backed realtime fanout is now implemented and locally validated as a Phase 8 backfill. The implementation adds a Valkey-compatible Pub/Sub wake bus, short-lived device-to-node registry, gateway node subscription, outbox dispatcher fanout wiring, payload validation, env/config support, metrics, focused unit tests, and a local Valkey integration smoke.

Valkey remains notification-only. REST, polling, heartbeat, `device_commands`, `command_outbox`, `schedule_snapshots`, and `device_desired_state` remain authoritative.

## Implemented Scope

- Runtime node id resolution.
- `REALTIME_BUS_PROVIDER=memory|valkey`.
- `VALKEY_URL` preferred, with `REDIS_URL` as explicit compatibility alias only.
- In-memory realtime bus for dev/single-node.
- Valkey Pub/Sub realtime bus using a small internal RESP client.
- In-memory and Valkey device-node registry.
- Gateway registration, refresh, and unregister of device-node mappings.
- Node-channel subscription and local socket delivery.
- Outbox dispatcher waits for local or Valkey fanout attempt.
- Metrics for Valkey publish, subscribe failures, node messages, registry writes/misses, and fallback.
- Local Valkey integration test using `valkey/valkey:9.0.3-alpine`.

## Out Of Scope

- Phase 9 mobile/TV adapters.
- Valkey Streams.
- Sentinel/cluster discovery logic beyond using a configured `VALKEY_URL` endpoint.
- Production/on-prem QA runtime evidence.
- Public cloud services.
- Media, screenshots, logs, snapshots, PoP, or cache reports over WebSocket or Valkey.

## Tests Passed

- `cd darshan-server && npm run build`
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts`
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts`
- `cd darshan-server && npx vitest run src/observability/metrics.test.ts`
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts`
- `cd darshan-server && npx vitest run src/services/playback-refresh-dispatch.test.ts`
- `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts`

Local Valkey smoke used Docker image `valkey/valkey:9.0.3-alpine` and passed after sandbox network escalation.

## Tests Blocked

- On-prem QA Valkey HA topology validation.
- Real backend node A/node B fanout with player socket on node A and command created on node B.
- Valkey outage fallback with real players/simulators.
- On-prem proxy/TLS/internal CA smoke.
- 1k/10k/50k load, chaos, reconnect storm, emergency fanout, publish storm, and media/cache flood evidence.
- Node 20 rerun; local runtime remains Node `v24.12.0`.

## Risks

- The internal Valkey client covers the limited commands needed for Pub/Sub and device-node mappings. Sentinel/cluster-specific discovery is not implemented; production must provide a reachable Valkey endpoint or HA virtual endpoint through `VALKEY_URL`.
- Valkey Pub/Sub is non-durable; DB outbox and polling/heartbeat fallback must remain mandatory.
- A stale device-node mapping can publish to a node without a local socket; this is safe because REST/polling remains authoritative but must be measured in QA.
- Alert thresholds are not tuned under on-prem QA traffic.

## Rollback

- Set `REALTIME_BUS_PROVIDER=memory`.
- Disable `OUTBOX_DISPATCH_ENABLED`.
- Disable `REALTIME_SYNC_ENABLED`.
- Disable player `DARSHAN_REALTIME_PLAYER_ENABLED`.
- Leave additive code and DB schema in place.
- REST/polling/heartbeat continue to deliver schedule/default/emergency.

## Next Gate

Run Phase 8B on-prem runtime evidence. Phase 9 remains blocked until Phase 8 runtime evidence is accepted or explicitly deferred by a human approver.
