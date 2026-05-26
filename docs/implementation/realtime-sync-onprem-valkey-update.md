# Realtime Sync On-Prem Valkey Update

Last updated: 2026-05-25
Updated by: Codex
Status: DOCUMENTATION_AND_LOCAL_IMPLEMENTATION_UPDATED

## Decision Summary

All dev, QA, and production realtime sync evidence and rollout planning is air-gapped on-prem by default. Public internet, public DNS, public media CDN, public object storage, public cloud push, and public staging endpoints are not baseline dependencies.

For multi-instance production realtime, SignHex uses Valkey-backed fanout/distributed coordination. Sticky sessions are allowed only as a load-balancer compatibility setting when Socket.IO HTTP polling transport is enabled. Sticky-session-only production realtime is not approved.

Valkey Pub/Sub is wake-notification fanout only. DB `device_commands`, `command_outbox`, `schedule_snapshots`, and `device_desired_state` remain the durable source of truth. If broker-side persisted fanout is required later, Valkey Streams can be reviewed, but the DB outbox remains the durability layer.

Local backend fanout implementation was added on 2026-05-25. See `realtime-sync-valkey-fanout-implementation.md` and `realtime-sync-phase-8-valkey-fanout-handoff.md`.

## Document Classification

| Path | Classification | Action |
|---|---|---|
| `ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md` | needs Valkey replacement, air-gapped runtime caveats | Updated with on-prem rules, Valkey preference, sticky-session-only prohibition, and public push caveat. |
| `docs/runbooks/onprem-qa-setup.md` | already on-prem, needed Valkey caveat | Updated to remove public broker assumptions and require Valkey fanout for multi-node realtime validation. |
| `docs/runbooks/onprem-production-setup.md` | already on-prem, needed Valkey caveat | Updated to treat Valkey as internal on-prem fanout and reject sticky-session-only production realtime. |
| `docs/runbooks/realtime-sync-qa-prod-hardening.md` | needed wording change, Valkey replacement, sticky-session-only removal | Updated with Phase 8B air-gapped runtime evidence and Valkey node A/node B fanout requirements. |
| `docs/environments/qa/realtime-sync.env.example` | needed Valkey replacement and on-prem inputs | Updated with `ONPREM_*`, `VALKEY_*`, transport flags, and `REDIS_URL` compatibility alias. |
| `docs/environments/production/realtime-sync.env.example` | needed Valkey replacement and on-prem inputs | Updated with production `ONPREM_*`, `VALKEY_*`, transport flags, and `REDIS_URL` compatibility alias. |
| `deploy/shared/realtime-sync-nginx.socketio.conf.template` | needed sticky-session-only removal | Updated to state Valkey fanout is required for multi-node notification routing. |
| `docs/implementation/realtime-sync-decision-log.md` | needed ADR | Added ADR-0022 for air-gapped on-prem Valkey fanout and sticky-session-only rejection. |
| `docs/implementation/realtime-sync-project-status.md` | needed wording change | Updated blockers, risks, inputs, and next steps for on-prem endpoints and Valkey runtime evidence. |
| `docs/implementation/realtime-sync-open-risks.md` | needed risk replacement | Updated Redis/NATS/sticky-only risks to Valkey HA, Valkey outage fallback, internal DNS/TLS, artifact supply chain, and on-prem media endpoint risks. |
| `docs/implementation/realtime-sync-phase-approval-log.md` | needed gate update | Updated Phase 8 conditions with Valkey fanout and outage-fallback evidence requirements. |
| `docs/implementation/realtime-sync-phase-8-runtime-evidence.md` | needed Phase 8B rewrite | Updated runtime evidence plan for air-gapped on-prem dev/QA/prod endpoints, Valkey, node A/node B fanout, fallback, and canary rollback. |
| `docs/implementation/realtime-sync-phase-8-handoff.md` | needed handoff update | Updated carried-forward conditions for Valkey fanout and air-gapped mobile/TV constraints. |
| `docs/implementation/realtime-sync-production-readiness-checklist.md` | needed readiness gates | Updated required gates for on-prem proxy, Valkey fanout, node A/node B routing, Valkey outage fallback, and internal media. |
| `docs/implementation/realtime-sync-qa-canary-evidence.md` | needed environment fields | Updated evidence template with `ONPREM_*`, `VALKEY_*`, transport, and node A/node B checks. |
| `docs/implementation/realtime-sync-test-plan.md` | needed test updates | Updated runtime test requirements for on-prem proxy, Valkey fanout, and polling-only sticky-session rules. |
| `docs/implementation/realtime-sync-permutation-test-matrix.md` | needed failure permutations | Added multi-node Valkey fanout and updated mobile public push assumptions. |
| `docs/architecture/enterprise-realtime-sync.md` | needed architecture update | Updated component diagram, deployment notes, and multi-instance fanout section for Valkey. |
| `docs/architecture/scaling-and-payload-limits.md` | needed payload caveat | Updated to state Valkey carries wake notifications only and never media/full snapshots. |
| `docs/architecture/failure-modes.md` | needed Valkey failure mode | Updated Valkey outage behavior and Phase 8 blocked evidence language. |
| `docs/architecture/mobile-tv-player-strategy.md` | needed air-gapped mobile update | Updated to make public FCM/APNs non-baseline and require foreground/kiosk WebSocket plus REST/polling fallback. |
| `docs/architecture/player-contract.md` | needed mobile push caveat | Updated background wake strategy for air-gapped mode. |
| `signhex-server/src/realtime/*` | needed implementation | Added Valkey-compatible Pub/Sub fanout, device-node registry, gateway/outbox wiring, and focused tests. |

## Required On-Prem Inputs

- `ONPREM_DEV_BACKEND_BASE_URL`, `ONPREM_DEV_CMS_BASE_URL`, `ONPREM_DEV_SOCKET_IO_URL`
- `ONPREM_QA_BACKEND_BASE_URL`, `ONPREM_QA_CMS_BASE_URL`, `ONPREM_QA_SOCKET_IO_URL`
- `ONPREM_PROD_BACKEND_BASE_URL`, `ONPREM_PROD_CMS_BASE_URL`, `ONPREM_PROD_SOCKET_IO_URL`
- `ONPREM_NETWORK_NAME`, `ONPREM_DNS_ZONE`, `ONPREM_TLS_MODE`, `ONPREM_CA_CERT_PATH`, `ONPREM_PROXY_TYPE`, `ONPREM_LB_MODE`
- `VALKEY_URL`, `VALKEY_MODE`, `VALKEY_TLS_ENABLED`, `VALKEY_AUTH_REQUIRED`, `VALKEY_CA_CERT_PATH`, `VALKEY_NAMESPACE`, `VALKEY_PUBSUB_ENABLED`, `VALKEY_STREAMS_ENABLED`, `VALKEY_MAXMEMORY_POLICY`, `VALKEY_HA_TOPOLOGY`
- `ONPREM_POSTGRES_URL`, `ONPREM_MINIO_OR_OBJECT_STORAGE_ENDPOINT`, `ONPREM_MEDIA_BASE_URL`, `ONPREM_MEDIA_STORAGE_MODE`
- `ONPREM_DEVICE_SIMULATOR_CREDENTIAL_POOL_PATH`, `ONPREM_LOAD_TEST_MAX_PLAYERS`, `ONPREM_LOAD_TEST_PROFILES_ALLOWED`, `ONPREM_LOAD_TEST_WINDOW`, `ONPREM_CHAOS_TEST_WINDOW`, `ONPREM_ALLOWED_FAILURE_INJECTIONS`
- `ONPREM_PROMETHEUS_URL`, `ONPREM_GRAFANA_URL`, `ONPREM_ALERTMANAGER_URL`, `ONPREM_METRICS_AUTH_MODE`, `ONPREM_LOG_AGGREGATION_TARGET`

## Production Readiness Impact

Production readiness remains `NOT_PRODUCTION_READY`.

Phase 8 implementation state is now `IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME`. Phase 8 remains blocked for production readiness until on-prem runtime evidence is produced. Phase 9 remains `BLOCKED` until Phase 8 evidence is accepted or explicitly deferred by a human approver.
