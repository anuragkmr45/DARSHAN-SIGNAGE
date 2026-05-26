# Phase 8 Handoff: Load, Chaos, And Production Readiness

Last updated: 2026-05-25
Updated by: Codex
Phase: Phase 8 - Load, chaos, and production readiness
Approval state: IMPLEMENTED_LOCAL_TESTED_BLOCKED_BY_ONPREM_RUNTIME
Production readiness state: NOT_PRODUCTION_READY

## Summary

Phase 8 added load modeling, chaos test planning, production readiness gates, on-prem QA canary evidence templates, metrics/alert validation notes, static validation, dedicated observability metrics/alerts, and status updates. The follow-up on-prem architecture update clarified that all runtime evidence must use internal air-gapped endpoints and Valkey-backed multi-node fanout, not public staging/cloud services or sticky-session-only routing. The Phase 8 backfill now implements local Valkey Pub/Sub fanout and device-node mapping. It did not implement mobile/TV adapters, WebSocket source-of-truth changes, Electron realtime changes, CMS UI changes, source-of-truth changes, or migrations.

## Implemented Scope

- Added deterministic load model script for current, fallback, and hybrid-healthy profiles.
- Added load and chaos execution plan for 1,000, 10,000, and 50,000 player profiles.
- Added production readiness checklist with required gates.
- Added on-prem QA canary evidence template.
- Added metrics and alert validation document with current coverage and gaps.
- Added dedicated backend metrics and Prometheus alerts for outbox lag/dispatch, realtime auth/notifications, websocket payload-size rejection, command ACK latency/failures, fallback polling, terminal command rows, and media/cache failures.
- Added `media_cache_reports` retention decision plan.
- Added Valkey Pub/Sub fanout and device-node registry backfill for multi-node wake routing.
- Added static Phase 8 asset validation script.
- Updated realtime sync project status, task register, approval log, test plan, risk register, implementation runbook, scaling docs, and failure-mode docs.

## Out Of Scope

- Real 1k/10k/50k fleet execution in this local session.
- on-prem QA proxy chaos execution.
- Production canary.
- Phase 9 mobile/TV adapters.
- Source-of-truth changes, migrations, or production rollout.
- Valkey Streams or broker-side durable fanout.
- Sentinel/cluster discovery beyond a configured `VALKEY_URL` endpoint.
- Retention/partitioning automation for `media_cache_reports`.

## Files Added

- `signhex-platform/scripts/load/realtime-sync-load-model.mjs`
- `signhex-platform/scripts/verify/validate-realtime-sync-phase8-assets.sh`
- `signhex-platform/docs/implementation/realtime-sync-load-and-chaos-plan.md`
- `signhex-platform/docs/implementation/realtime-sync-production-readiness-checklist.md`
- `signhex-platform/docs/implementation/realtime-sync-qa-canary-evidence.md`
- `signhex-platform/docs/implementation/realtime-sync-metrics-alert-validation.md`
- `signhex-platform/docs/implementation/realtime-sync-phase-8-handoff.md`
- `signhex-platform/docs/implementation/realtime-sync-media-cache-report-retention-plan.md`
- `signhex-platform/docs/implementation/realtime-sync-valkey-fanout-implementation.md`
- `signhex-platform/docs/implementation/realtime-sync-phase-8-valkey-fanout-handoff.md`

## Files Updated For Observability Continuation

- `signhex-server/src/observability/metrics.ts`
- `signhex-server/src/observability/index.ts`
- `signhex-server/src/observability/metrics.test.ts`
- `signhex-server/src/realtime/device-gateway.ts`
- `signhex-server/src/services/outbox-dispatcher.ts`
- `signhex-server/src/routes/device-telemetry.ts`
- `signhex-platform/deploy/shared/observability/prometheus/rules/alerts.yml`
- `signhex-platform/deploy/shared/observability/prometheus/rules/recording-rules.yml`
- `signhex-platform/deploy/shared/observability/prometheus/tests/rules.test.yml`
- `signhex-server/src/realtime/realtime-node.ts`
- `signhex-server/src/realtime/valkey-resp-client.ts`
- `signhex-server/src/realtime/realtime-bus.ts`
- `signhex-server/src/realtime/device-node-registry.ts`
- `signhex-server/src/realtime/realtime-fanout.ts`
- `signhex-server/src/realtime/realtime-bus.test.ts`
- `signhex-server/src/realtime/valkey-realtime-bus.integration.test.ts`

## Validation

Run:

```bash
bash signhex-platform/scripts/verify/validate-realtime-sync-phase8-assets.sh
node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json
node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json
node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json
```

Latest local results from 2026-05-24:

- `bash signhex-platform/scripts/verify/validate-realtime-sync-phase8-assets.sh`: passed.
- `node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 60 --json`: passed; modeled total RPS `240`.
- `node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 60 --json`: passed; modeled total RPS `566.67`.
- `node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 60 --json`: passed; modeled total RPS `12000`.
- `bash signhex-platform/scripts/verify/validate-observability-assets.sh`: passed after Docker escalation and image pulls.
- `cd signhex-server && npx vitest run src/observability/metrics.test.ts`: passed, 5 tests.
- `cd signhex-server && npx vitest run src/realtime/device-gateway.test.ts`: passed, 4 tests.
- `cd signhex-server && npx vitest run src/routes/device-telemetry-media-cache-report.test.ts`: passed, 1 test.
- `cd signage-screen && npx mocha --config .mocharc.json --spec test/unit/services/media-cache-reporter.test.ts`: passed, 2 tests.
- `cd signhex-nexus-core && npm run lint`: passed.
- `cd signhex-server && npm run build`: passed under local Node `v24.12.0`.
- `cd signage-screen && npm run build`: passed under local Node `v24.12.0`.
- `cd signhex-nexus-core && npm run build`: passed under local Node `v24.12.0`.
- `cd signhex-server && npx vitest run src/realtime/realtime-bus.test.ts`: passed, 8 tests.
- `cd signhex-server && npx vitest run src/realtime/realtime-bus.test.ts src/realtime/device-gateway.test.ts src/observability/metrics.test.ts src/services/playback-refresh-dispatch.test.ts`: passed, 19 tests.
- `cd signhex-server && npx vitest run src/services/playback-refresh-dispatch.test.ts`: passed, 2 tests.
- `cd signhex-server && VALKEY_URL=redis://127.0.0.1:6381 npx vitest run src/realtime/valkey-realtime-bus.integration.test.ts`: passed, 2 tests, using temporary local `valkey/valkey:9.0.3-alpine` after sandbox network escalation.
- `bash signhex-platform/scripts/verify/validate-realtime-sync-phase7-assets.sh`: passed again on 2026-05-25 after on-prem/Valkey documentation update.
- `bash signhex-platform/scripts/verify/validate-realtime-sync-phase8-assets.sh`: passed again on 2026-05-25 after on-prem/Valkey documentation update.
- `bash signhex-platform/scripts/verify/validate-observability-assets.sh`: passed again on 2026-05-25 after Docker escalation.

Blocked local results:

- Real 1k/10k/50k load execution: blocked by unavailable on-prem QA target and simulator credential set.
- Chaos execution: blocked by unavailable on-prem QA target.
- on-prem QA canary rollback drill: blocked by unavailable on-prem QA deployment target.
- Node 20 validation: blocked because local Node is `v24.12.0`.

Runtime evidence attempt:

- Recorded in `signhex-platform/docs/implementation/realtime-sync-phase-8-runtime-evidence.md`.
- Packaged QA server health check is blocked because `postgres` is not running.
- Packaged QA CMS health check is blocked by HTTP 404.
- Local backend and Socket.IO smoke checks are blocked because nothing is listening on `127.0.0.1:3000`.
- No on-prem QA endpoint variables or simulator credentials are available in the local environment.
- No `VALKEY_URL`, Valkey topology, or multi-node on-prem QA target is available in the local environment.
- Local Docker Valkey smoke is not a substitute for on-prem Valkey HA/runtime evidence.

## Conditions Carried Forward

- Rerun backend, Electron, and CMS builds/tests under Node `>=20 <21`.
- Rerun CMS lint under Node `>=20 <21`; local Node `v24.12.0` lint now passes.
- Review migrations on QA-sized data.
- Run QA `/api/v1/` and `/socket.io/` proxy smoke.
- Run on-prem Valkey connectivity and Pub/Sub fanout smoke.
- Run multi-node node A/node B fanout: player socket on node A, command created on node B, Valkey wakes node A, player fetches through REST, player ACKs.
- Run Valkey outage fallback drill and verify `command_outbox`, polling, heartbeat, schedule/default/emergency delivery remain authoritative.
- Run packaged backend/player realtime smoke through on-prem QA proxy.
- Run on-prem QA canary rollback drill.
- Execute real 1k/10k/50k load profiles or document a lower production capacity cap.
- Execute chaos scenarios against on-prem QA.
- Tune dedicated outbox/realtime/media-cache/fallback metrics and alerts against on-prem QA traffic.
- Approve `media_cache_reports` retention/partitioning.

## Phase 9 Gate

Phase 9 mobile/TV player adapters remain blocked until Phase 8 runtime evidence is accepted or explicitly deferred by a human approver. The backend contract remains platform-neutral, but mobile/TV implementation must not begin from unproven production-readiness assumptions.

Air-gapped mobile/TV note: public FCM/APNs/cloud push is not baseline. Future players must rely on foreground/kiosk WebSocket plus REST and polling/heartbeat fallback unless an on-prem private push/MDM mechanism or explicit non-air-gapped exception is approved.
