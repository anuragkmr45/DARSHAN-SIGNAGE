# Realtime Sync Metrics And Alert Validation

Last updated: 2026-06-09
Updated by: Codex

## Metrics and alert validation

Current state: LOCAL_STATIC_VALIDATION

Existing observability covers general backend HTTP, fleet heartbeat freshness, websocket connection count, DB pool usage, pg-boss queue state, S3 operations, host utilization, PostgreSQL availability, MinIO availability, and Grafana/Prometheus health.

Dedicated realtime sync metrics added locally on 2026-05-24:

- `darshan_server_command_outbox_rows`
- `darshan_server_command_outbox_oldest_pending_age_seconds`
- `darshan_server_command_outbox_dispatch_total`
- `darshan_server_device_realtime_auth_total`
- `darshan_server_device_realtime_notifications_total`
- `darshan_server_websocket_notification_payload_too_large_total`
- `darshan_server_device_command_acks_total`
- `darshan_server_device_command_ack_duration_seconds`
- `darshan_server_device_commands_rows`
- `darshan_server_media_cache_reports_total`
- `darshan_server_media_cache_reports_unresolved`
- `darshan_server_realtime_bus_connection_status`
- `darshan_server_realtime_bus_publish_total`
- `darshan_server_realtime_bus_subscribe_failures_total`
- `darshan_server_realtime_bus_node_messages_total`
- `darshan_server_device_node_registry_writes_total`
- `darshan_server_device_node_registry_misses_total`
- `darshan_server_realtime_bus_fallback_total`

Namespace-level realtime observability added in Batch 4:

- `darshan_server_realtime_socket_connections`
- `darshan_server_realtime_socket_connect_total`
- `darshan_server_realtime_socket_disconnect_total`
- `darshan_server_realtime_socket_client_events_total`
- `darshan_server_realtime_socket_server_events_total`
- `darshan_server_realtime_socket_rejects_total`
- `darshan_server_realtime_socket_auth_total`

Signed device socket auth canary observability:

- `darshan_server_device_socket_auth_total{namespace,mode,result,reason}`
- `darshan_server_device_socket_auth_replay_total{namespace,result,reason}`

These metrics must stay low-cardinality. Do not add labels or examples for device identity, nonce, signature material, replay keys, socket IDs, IP addresses, URLs, tokens, raw auth payloads, raw errors, or arbitrary client-provided strings.

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

- `bash scripts/verify/validate-observability-assets.sh` passed after Docker escalation.
- `cd darshan-server && npx vitest run src/observability/metrics.test.ts` passed with 5 tests.
- `cd darshan-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts` passed with 19 tests.
- `cd darshan-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` passed with 2 tests against local Docker Valkey after sandbox escalation.
- `cd darshan-server && npx vitest run src/realtime/device-gateway.test.ts` passed with 4 tests after metrics wiring.
- This is static/local validation only. It does not prove alert usefulness under real QA load, reconnect storms, or media/cache failures.

## Existing Alert Coverage

| Area | Current coverage | Gap |
|---|---|---|
| Backend availability | `DARSHANBackendMetricsUnavailable` | none |
| Backend 5xx | `DARSHANBackendHttp5xxHigh` | route-specific realtime/API alert absent |
| PostgreSQL | `DARSHANPostgresUnavailable` | DB latency/lock pressure alert absent |
| MinIO | `DARSHANMinioMetricsUnavailable` | media egress/cache-hit alert absent |
| Fleet heartbeat | `DARSHANFleetHeartbeatsStalled`, `DARSHANFleetOfflinePlayersHigh` | fallback poll/realtime health split absent |
| Host resources | CPU, memory, filesystem alerts | none for process-specific memory |
| WebSocket connections | metric exists: `darshan_server_websocket_connections`; auth and notification counters added | production thresholds need QA tuning |
| Namespace sockets | connect/disconnect, client/server event, auth, validation, rate-limit, and unauthorized reject counters by namespace | production thresholds need QA tuning |
| Signed device socket auth | signed/legacy auth outcome counters and signed replay counters by namespace, mode, result, and bounded reason | production thresholds and canary pass/fail thresholds need QA tuning |
| Outbox | rows, lag, and dispatch outcome metrics plus alerts added | production thresholds need QA tuning |
| Command ACK | ACK counters/duration and failure ratio alert added | command-type label intentionally omitted to avoid high cardinality |
| Media/cache reports | report counters, unresolved critical gauge, and alert rules added | retention/partitioning still needs human decision |
| Player local queues | player-side ACK/PoP/cache-report queue depth | still missing dedicated player metrics |

## Validation Commands

Run from repo root:

```bash
bash scripts/verify/validate-observability-assets.sh
```

Expected:

```text
[verify] observability assets validated
```

If Docker images are unavailable, record the exact failure and rerun in the QA build environment.

## Realtime Incident Triage Signals

- Auth-reject spike: check `darshan_server_realtime_socket_auth_total{result="failure"}` by `namespace` and `reason`.
- Signed socket auth canary: check `darshan_server_device_socket_auth_total{namespace,mode,result,reason}` for signed and legacy outcomes.
- Signed socket replay canary: check `darshan_server_device_socket_auth_replay_total{namespace,result,reason}` for accepted, rejected, bypassed, and error outcomes.
- Invalid-payload or rate-limit spike: check `darshan_server_realtime_socket_rejects_total` by `namespace`, `event`, and `reason`.
- Namespace outage or reconnect storm: compare `darshan_server_realtime_socket_connect_total`, `darshan_server_realtime_socket_disconnect_total`, and `darshan_server_realtime_socket_connections`.
- Valkey fanout failure: check `darshan_server_realtime_bus_publish_total{provider="valkey",result!="published"}`, `darshan_server_realtime_bus_subscribe_failures_total`, and `darshan_server_realtime_bus_fallback_total`.
- Outbox lag: check `darshan_server_command_outbox_oldest_pending_age_seconds`, `darshan_server_command_outbox_rows{status="PENDING"}`, and `darshan_server_command_outbox_dispatch_total{result="failed"}`.
- Rollback flags for signed auth canary are player `DARSHAN_REALTIME_SIGNED_AUTH_ENABLED=false`, optional server `DEVICE_SOCKET_SIGNED_AUTH_ENABLED=false`, and `DEVICE_SOCKET_AUTH_REPLAY_PROTECTION_ENABLED=false` if replay causes rejects. Keep `DEVICE_SOCKET_LEGACY_AUTH_ALLOWED=true`, REST polling, heartbeat, and command APIs active.
- Realtime rollback flags remain `OUTBOX_DISPATCH_ENABLED=false`, `REALTIME_SYNC_ENABLED=false`, and player `DARSHAN_REALTIME_PLAYER_ENABLED=false`; keep REST polling, heartbeat, and command APIs active.

Signed auth canary bounded reasons to review:

- `authorized`
- `malformed_auth`
- `signature_invalid`
- `signature_expired`
- `signature_unavailable`
- `signed_disabled`
- `legacy_disabled`
- `replay_detected`
- `store_unavailable`
- `store_error`

Canary pass/fail review should compare signed success, legacy success, replay accepted/stored, controlled replay rejection, and store unavailable/error categories without adding high-cardinality labels.

## Production Alert Gate

Production realtime is not approved until:

- observability asset validation passes,
- dedicated outbox/realtime/media-cache alert rules are tested under on-prem QA traffic,
- signed device socket auth and replay metrics are tested during canary with signed and legacy players,
- dashboards show active connections, outbox lag, command ACK latency, fallback polling rate, media/cache failures, heartbeat freshness, and DB capacity.
- `media_cache_reports` retention/partitioning policy is approved.
