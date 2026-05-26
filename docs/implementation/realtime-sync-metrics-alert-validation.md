# Realtime Sync Metrics And Alert Validation

Last updated: 2026-05-25
Updated by: Codex

## Metrics and alert validation

Current state: LOCAL_STATIC_VALIDATION

Existing observability covers general backend HTTP, fleet heartbeat freshness, websocket connection count, DB pool usage, pg-boss queue state, S3 operations, host utilization, PostgreSQL availability, MinIO availability, and Grafana/Prometheus health.

Dedicated realtime sync metrics added locally on 2026-05-24:

- `signhex_server_command_outbox_rows`
- `signhex_server_command_outbox_oldest_pending_age_seconds`
- `signhex_server_command_outbox_dispatch_total`
- `signhex_server_device_realtime_auth_total`
- `signhex_server_device_realtime_notifications_total`
- `signhex_server_websocket_notification_payload_too_large_total`
- `signhex_server_device_command_acks_total`
- `signhex_server_device_command_ack_duration_seconds`
- `signhex_server_device_commands_rows`
- `signhex_server_media_cache_reports_total`
- `signhex_server_media_cache_reports_unresolved`
- `signhex_server_realtime_bus_connection_status`
- `signhex_server_realtime_bus_publish_total`
- `signhex_server_realtime_bus_subscribe_failures_total`
- `signhex_server_realtime_bus_node_messages_total`
- `signhex_server_device_node_registry_writes_total`
- `signhex_server_device_node_registry_misses_total`
- `signhex_server_realtime_bus_fallback_total`

Dedicated Prometheus recording/alert rules added locally:

- realtime outbox pending rows and oldest pending age
- outbox dispatch failure rate
- websocket notification payload too-large rate
- fallback command poll claim rate
- device command ACK failure ratio
- media/cache ERROR/CRITICAL report rate
- unresolved CRITICAL media/cache report alert
- device command dead-letter/expired alert
- realtime auth failure alert
- Valkey publish failure rate alert
- Valkey fallback rate alert

Latest validation attempt:

- `bash signhex-platform/scripts/verify/validate-observability-assets.sh` passed after Docker escalation.
- `cd signhex-server && npx vitest run src/observability/metrics.test.ts` passed with 5 tests.
- `cd signhex-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts` passed with 19 tests.
- `cd signhex-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` passed with 2 tests against local Docker Valkey after sandbox escalation.
- `cd signhex-server && npx vitest run src/realtime/device-gateway.test.ts` passed with 4 tests after metrics wiring.
- This is static/local validation only. It does not prove alert usefulness under real QA load, reconnect storms, or media/cache failures.

## Existing Alert Coverage

| Area | Current coverage | Gap |
|---|---|---|
| Backend availability | `SignhexBackendMetricsUnavailable` | none |
| Backend 5xx | `SignhexBackendHttp5xxHigh` | route-specific realtime/API alert absent |
| PostgreSQL | `SignhexPostgresUnavailable` | DB latency/lock pressure alert absent |
| MinIO | `SignhexMinioMetricsUnavailable` | media egress/cache-hit alert absent |
| Fleet heartbeat | `SignhexFleetHeartbeatsStalled`, `SignhexFleetOfflinePlayersHigh` | fallback poll/realtime health split absent |
| Host resources | CPU, memory, filesystem alerts | none for process-specific memory |
| WebSocket connections | metric exists: `signhex_server_websocket_connections`; auth and notification counters added | production thresholds need QA tuning |
| Outbox | rows, lag, and dispatch outcome metrics plus alerts added | production thresholds need QA tuning |
| Command ACK | ACK counters/duration and failure ratio alert added | command-type label intentionally omitted to avoid high cardinality |
| Media/cache reports | report counters, unresolved critical gauge, and alert rules added | retention/partitioning still needs human decision |
| Player local queues | player-side ACK/PoP/cache-report queue depth | still missing dedicated player metrics |

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
- dedicated outbox/realtime/media-cache alert rules are tested under on-prem QA traffic,
- dashboards show active connections, outbox lag, command ACK latency, fallback polling rate, media/cache failures, heartbeat freshness, and DB capacity.
- `media_cache_reports` retention/partitioning policy is approved.
