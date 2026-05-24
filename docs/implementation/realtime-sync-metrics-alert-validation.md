# Realtime Sync Metrics And Alert Validation

Last updated: 2026-05-24
Updated by: Codex

## Metrics and alert validation

Current state: PARTIAL

Existing observability covers general backend HTTP, fleet heartbeat freshness, websocket connection count, DB pool usage, pg-boss queue state, S3 operations, host utilization, PostgreSQL availability, MinIO availability, and Grafana/Prometheus health.

Dedicated realtime sync metrics still needed before production enablement:

- outbox lag by status and age,
- outbox dispatch attempts/failures,
- device realtime auth failures,
- notification payload size rejection count,
- command ACK latency by type/reason,
- command dead-letter count,
- fallback polling rate,
- desired-state stale reconciliation count,
- media/cache failure count by code,
- media/cache report ingest failure count,
- player ACK/PoP/cache-report local queue depth.

## Existing Alert Coverage

| Area | Current coverage | Gap |
|---|---|---|
| Backend availability | `SignhexBackendMetricsUnavailable` | none |
| Backend 5xx | `SignhexBackendHttp5xxHigh` | route-specific realtime/API alert absent |
| PostgreSQL | `SignhexPostgresUnavailable` | DB latency/lock pressure alert absent |
| MinIO | `SignhexMinioMetricsUnavailable` | media egress/cache-hit alert absent |
| Fleet heartbeat | `SignhexFleetHeartbeatsStalled`, `SignhexFleetOfflinePlayersHigh` | fallback poll/realtime health split absent |
| Host resources | CPU, memory, filesystem alerts | none for process-specific memory |
| WebSocket connections | metric exists: `signhex_server_websocket_connections` | alert threshold absent |
| Outbox | DB table exists | lag/failure metrics and alerts absent |
| Media/cache reports | DB table and CMS API exist | metrics/alerts/retention absent |

## Validation Commands

Run from repo root:

```bash
bash signhex-platform/scripts/verify/validate-observability-assets.sh
```

Expected:

```text
[verify] observability assets validated
```

If Docker images are unavailable, record the exact failure and rerun in the QA build environment.

## Production Alert Gate

Production realtime is not approved until:

- observability asset validation passes,
- dedicated outbox/realtime/media-cache alert rules are added or explicitly waived,
- alert rules are tested with `promtool`,
- dashboards show active connections, outbox lag, command ACK latency, fallback polling rate, media/cache failures, heartbeat freshness, and DB capacity.
