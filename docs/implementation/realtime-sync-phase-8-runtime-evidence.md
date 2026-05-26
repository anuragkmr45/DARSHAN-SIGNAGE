# Phase 8 Runtime Evidence Attempt

Last updated: 2026-05-25
Updated by: Codex
Phase: Phase 8 - Load, chaos, and production readiness
Evidence state: IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME
Production readiness state: NOT_PRODUCTION_READY
Phase 9 state: BLOCKED

## Summary

The requested Phase 8 runtime evidence was attempted from `/Users/anuragkumar/Desktop/signhex`. Local Valkey fanout implementation and local Docker Valkey Pub/Sub smoke were completed. Real air-gapped on-prem QA load, chaos, canary rollback, proxy/runtime smoke, on-prem Valkey HA fanout smoke, and production-readiness evidence could not be executed because no active on-prem QA deployment target, on-prem Valkey endpoint/topology, or simulator credential pool is available in this workspace/session.

No Phase 9 mobile/TV adapters were implemented. No migrations, Electron realtime behavior, CMS UI, source-of-truth behavior, or deployment behavior was changed. Runtime source changes made during the local continuation pass were additive observability metrics and notification-only Valkey fanout over the existing DB outbox/gateway path.

## Commands Attempted

| Command | Result | Evidence | Classification |
|---|---|---|---|
| `find signhex-platform/out -maxdepth 4 -type f` | Passed | Found old QA artifact package folders under `signhex-platform/out/2026-04-15-artifact-qa` | DISCOVERY_ONLY |
| `printenv ... rg '^(ONPREM|VALKEY|SIGNHEX|HEXMON|REALTIME|BACKEND|CMS|DATABASE|OUTBOX|COMMAND|DEVICE|MEDIA|VITE)'` | Passed | Only `COMMAND_MODE` was present in the local session; no on-prem endpoint, Valkey, or simulator variables were available | BLOCKED_BY_ENV |
| `./health-check.sh` in `signhex-platform/out/2026-04-15-artifact-qa/server` | Failed | `service "postgres" is not running` | BLOCKED_BY_ENV |
| `./health-check.sh` in `signhex-platform/out/2026-04-15-artifact-qa/cms` | Failed | `curl: (22) The requested URL returned error: 404` | BLOCKED_BY_ENV |
| `curl -fsS -i http://127.0.0.1:3000/api/v1/health` | Failed | `Failed to connect to 127.0.0.1 port 3000` | BLOCKED_BY_ENV |
| `curl -fsS -i http://127.0.0.1:80/api/v1/health` | Failed | `Failed to connect to 127.0.0.1 port 80` | BLOCKED_BY_ENV |
| `curl -fsS -i 'http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling'` | Failed | `Failed to connect to 127.0.0.1 port 3000` | BLOCKED_BY_ENV |
| `bash signhex-platform/scripts/verify/validate-realtime-sync-phase8-assets.sh` | Passed | `[phase8] realtime sync load/chaos/readiness assets validated from /Users/anuragkumar/Desktop/signhex` | LOCAL_STATIC_VALIDATION |
| `node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json` | Passed | Modeled total RPS `240` | MODEL_ONLY |
| `node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json` | Passed | Modeled total RPS `566.67` | MODEL_ONLY |
| `node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json` | Passed | Modeled total RPS `12000` | MODEL_ONLY |
| `bash signhex-platform/scripts/verify/validate-observability-assets.sh` | Passed after Docker escalation | Prometheus config/rules, Alertmanager config, dashboard JSON, compose config, and helper smoke checks passed | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npx vitest run src/observability/metrics.test.ts` | Passed | 5 tests passed | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npx vitest run src/realtime/device-gateway.test.ts` | Passed | 4 tests passed after metrics wiring | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts` | Passed | 1 test passed after media/cache report metrics wiring | LOCAL_STATIC_VALIDATION |
| `cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts` | Passed | 2 tests passed | LOCAL_STATIC_VALIDATION |
| `cd signhex-nexus-core && npm run lint` | Passed | ESLint exited 0 after local lint fixes | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npm run build` | Passed | Backend TypeScript build exited 0 under Node `v24.12.0` | LOCAL_STATIC_VALIDATION |
| `cd signage-screen && npm run build` | Passed | Player main/renderer build exited 0 under Node `v24.12.0` | LOCAL_STATIC_VALIDATION |
| `cd signhex-nexus-core && npm run build` | Passed | CMS Vite build exited 0 under Node `v24.12.0` with existing chunk-size warning | LOCAL_STATIC_VALIDATION |
| `node -v` | Passed | `v24.12.0` | ENV_RISK |
| `bash signhex-platform/scripts/verify/validate-realtime-sync-phase7-assets.sh` | Passed on 2026-05-25 | `[phase7] realtime sync deployment hardening assets validated` | LOCAL_STATIC_VALIDATION |
| `bash signhex-platform/scripts/verify/validate-realtime-sync-phase8-assets.sh` | Passed on 2026-05-25 | `[phase8] realtime sync load/chaos/readiness assets validated from /Users/anuragkumar/Desktop/signhex` | LOCAL_STATIC_VALIDATION |
| `bash signhex-platform/scripts/verify/validate-observability-assets.sh` | Passed on 2026-05-25 after Docker escalation | Prometheus config/rules, Alertmanager config, dashboard JSON, compose config, and helper smoke checks passed | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npm run build` | Passed on 2026-05-25 | `tsc && tsc-alias` exited 0 under local Node `v24.12.0` | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npx vitest run src/realtime/realtime-bus.test.ts` | Passed on 2026-05-25 | 8 tests passed | LOCAL_STATIC_VALIDATION |
| `cd signhex-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts` | Passed on 2026-05-25 | 19 tests passed | LOCAL_STATIC_VALIDATION |
| `docker run --rm -d --name signhex-valkey-fanout-test -p 127.0.0.1:6381:6379 valkey/valkey:9.0.3-alpine` | Passed on 2026-05-25 | Temporary local Valkey container started from already available local image | LOCAL_INTEGRATION_SETUP |
| `cd signhex-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` | Blocked on first sandboxed attempt | Local sandbox denied loopback TCP with `connect EPERM 127.0.0.1:6381`; rerun with explicit sandbox network escalation passed | BLOCKED_BY_SANDBOX |
| `cd signhex-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts` | Passed on 2026-05-25 after sandbox network escalation | 2 tests passed; node B wake reached node A subscriber through Valkey Pub/Sub; unavailable endpoint fallback returned null instead of throwing | LOCAL_INTEGRATION_VALIDATION |
| `docker stop signhex-valkey-fanout-test` | Passed on 2026-05-25 after Docker escalation | Temporary Valkey container stopped | LOCAL_CLEANUP |

## Runtime Evidence Not Produced

| Required evidence | Status | Blocker |
|---|---|---|
| 1,000 player load execution | BLOCKED_BY_ENV | no active on-prem QA backend and no simulator credential pool |
| 10,000 player load execution | BLOCKED_BY_ENV | no active on-prem QA backend and no simulator credential pool |
| 50,000 player load execution | BLOCKED_BY_ENV | no active on-prem QA backend and no simulator credential pool |
| WebSocket reconnect storm | BLOCKED_BY_ENV | no active on-prem QA gateway/proxy target |
| Emergency fanout under load | BLOCKED_BY_ENV | no active on-prem QA backend/player fleet |
| Publish storm under load | BLOCKED_BY_ENV | no active on-prem QA backend/player fleet |
| PoP flood | BLOCKED_BY_ENV | no simulator credential pool and no telemetry load runner |
| on-prem QA canary rollback drill | BLOCKED_BY_ENV | no active on-prem QA deployment target |
| `/socket.io/` proxy/runtime smoke | BLOCKED_BY_ENV | no active backend/proxy listener |
| On-prem Valkey connectivity and fanout smoke | BLOCKED_BY_ENV | local Docker Valkey smoke passed, but no on-prem `VALKEY_URL` or Valkey HA topology is provided |
| Multi-node node A/node B fanout | BLOCKED_BY_ENV | local simulated node A/node B Pub/Sub smoke passed, but no real multi-node on-prem QA target and Valkey topology are provided |
| Valkey outage fallback drill | BLOCKED_BY_ENV | no on-prem Valkey target and no player/API fleet |
| chaos suite | BLOCKED_BY_ENV | no active on-prem QA environment |

## Phase 8B: Air-Gapped On-Prem Runtime Evidence

Phase 8B replaces public-staging assumptions with internal on-prem evidence. Production readiness must stay `NOT_PRODUCTION_READY` until these pass or are explicitly waived by a human approver:

| Required Phase 8B test | Status | Required evidence |
|---|---|---|
| On-prem dev smoke | BLOCKED_BY_ENV | `ONPREM_DEV_BACKEND_BASE_URL`, `ONPREM_DEV_CMS_BASE_URL`, and `ONPREM_DEV_SOCKET_IO_URL` health checks |
| On-prem QA proxy smoke | BLOCKED_BY_ENV | `/api/v1/` and `/socket.io/` through the selected internal proxy/load balancer |
| On-prem Socket.IO smoke | BLOCKED_BY_ENV | `/device` or `/socket.io/` HELLO/HELLO_ACK through internal DNS/TLS |
| On-prem Valkey connectivity and fanout smoke | BLOCKED_BY_ENV | backend nodes can connect to `VALKEY_URL`, publish/subscribe under `VALKEY_NAMESPACE`, and report health |
| Multi-node backend/gateway fanout | BLOCKED_BY_ENV | player socket on node A, command created on node B, Valkey wakes node A, player fetches REST command, player ACKs |
| Valkey unavailable fallback | BLOCKED_BY_ENV | `command_outbox` remains durable and polling/heartbeat delivers schedule/default/emergency while Valkey is unavailable |
| Reconnect storm | BLOCKED_BY_ENV | jitter/backoff, gateway metrics, fallback polling rate, and no source-of-truth loss |
| Emergency fanout | BLOCKED_BY_ENV | emergency start/clear latency and fallback behavior under load |
| Publish storm | BLOCKED_BY_ENV | outbox lag, REST fetch, command ACK, and player jitter under group publish |
| PoP/media-cache report flood | BLOCKED_BY_ENV | ingestion, batching/queueing, DB pressure, and alert behavior |
| Canary rollback | BLOCKED_BY_ENV | disable `OUTBOX_DISPATCH_ENABLED`, `REALTIME_SYNC_ENABLED`, and `HEXMON_REALTIME_SYNC_ENABLED`; REST/polling/heartbeat/snapshot/default/emergency remain active |

## Production Readiness Decision

Production readiness is not approved.

Reason:

- Static validation and load modeling passed.
- Real runtime evidence is missing.
- Dedicated realtime/outbox/media-cache/fallback metrics and alerts are locally implemented and statically validated, but not tuned under on-prem QA traffic.
- Node 20 validation is still required because local Node is `v24.12.0`.
- CMS lint now passes locally under Node `v24.12.0`; Node 20 lint/build validation is still required.
- `media_cache_reports` retention/partitioning is documented as a decision plan, but a human/product retention decision is still required.

## Phase 9 Decision

Phase 9 is not approved.

Mobile/TV adapters must remain blocked until one of these happens:

1. Real Phase 8 on-prem QA runtime evidence passes and is accepted.
2. A human approver explicitly defers Phase 8 runtime evidence and accepts the risk in the approval log.

## Required Inputs To Unblock

- `ONPREM_DEV_BACKEND_BASE_URL`, `ONPREM_DEV_CMS_BASE_URL`, `ONPREM_DEV_SOCKET_IO_URL`.
- `ONPREM_QA_BACKEND_BASE_URL`, `ONPREM_QA_CMS_BASE_URL`, `ONPREM_QA_SOCKET_IO_URL`.
- `ONPREM_PROD_BACKEND_BASE_URL`, `ONPREM_PROD_CMS_BASE_URL`, `ONPREM_PROD_SOCKET_IO_URL`.
- `ONPREM_NETWORK_NAME`, `ONPREM_DNS_ZONE`, `ONPREM_TLS_MODE`, `ONPREM_CA_CERT_PATH`, `ONPREM_PROXY_TYPE`, `ONPREM_LB_MODE`.
- `VALKEY_URL`, `VALKEY_MODE`, `VALKEY_TLS_ENABLED`, `VALKEY_AUTH_REQUIRED`, `VALKEY_CA_CERT_PATH`, `VALKEY_NAMESPACE`, `VALKEY_PUBSUB_ENABLED`, `VALKEY_STREAMS_ENABLED`, `VALKEY_MAXMEMORY_POLICY`, `VALKEY_HA_TOPOLOGY`.
- `ONPREM_POSTGRES_URL`, `ONPREM_MINIO_OR_OBJECT_STORAGE_ENDPOINT`, `ONPREM_MEDIA_BASE_URL`, `ONPREM_MEDIA_STORAGE_MODE`.
- `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH`, `ONPREM_LOAD_TEST_MAX_PLAYERS`, `ONPREM_LOAD_TEST_PROFILES_ALLOWED`, `ONPREM_LOAD_TEST_WINDOW`, `ONPREM_CHAOS_TEST_WINDOW`, `ONPREM_ALLOWED_FAILURE_INJECTIONS`.
- `NODE_VERSION=20.x`, `ONPREM_MIGRATION_REVIEW_TARGET`, `MEDIA_CACHE_REPORT_RETENTION_DAYS`, `MEDIA_CACHE_REPORT_AGGREGATE_RETENTION_DAYS`.
- `ONPREM_PROMETHEUS_URL`, `ONPREM_GRAFANA_URL`, `ONPREM_ALERTMANAGER_URL`, `ONPREM_METRICS_AUTH_MODE`, `ONPREM_LOG_AGGREGATION_TARGET`.
