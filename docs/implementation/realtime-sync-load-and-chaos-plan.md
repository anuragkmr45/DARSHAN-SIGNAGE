# Realtime Sync Load And Chaos Plan

Last updated: 2026-05-24
Updated by: Codex
Phase: Phase 8 - Load, chaos, and production readiness

## Scope

This plan defines Phase 8 load and chaos validation for the enterprise realtime sync architecture.

Architecture rules:

- DB, `schedule_snapshots`, and `device_commands` remain source of truth.
- WebSocket is notification-only.
- REST remains authoritative for commands, snapshots, default media, emergency, ACK, heartbeat, desired state, PoP, and diagnostics.
- Media never goes over WebSocket.
- Polling and heartbeat fallback remain mandatory.
- Rollback remains feature-flag based.

## Load Profiles

Use `signhex-platform/scripts/load/realtime-sync-load-model.mjs` for deterministic RPS and volume modeling.

Required modeled profiles:

| Profile | Players | Purpose |
|---|---:|---|
| Current polling | 1,000 / 10,000 / 50,000 | Size fallback capacity and current behavior |
| Hybrid healthy | 1,000 / 10,000 / 50,000 | Size WebSocket-healthy safety polling |
| Fallback polling | 1,000 / 10,000 / 50,000 | Prove WebSocket outage remains survivable |
| Emergency fanout | 1,000 / 10,000 / 50,000 | Size command/outbox/REST fetch spike |
| Publish storm | 1,000 / 10,000 / 50,000 | Size schedule/default refresh fanout |
| PoP flood | 1,000 / 10,000 / 50,000 | Size telemetry batching/partitioning |
| Media egress | variable | Size object storage/CDN/cache warmup |

Example commands:

```bash
node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile current --players 1000 --duration-seconds 300
node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile hybrid-healthy --players 10000 --duration-seconds 300
node signhex-platform/scripts/load/realtime-sync-load-model.mjs --profile fallback --players 50000 --duration-seconds 300
```

## Execution Requirements

Real load execution requires a QA or staging deployment with:

- reviewed migrations `0030`, `0031`, and `0032` applied,
- feature flags documented and rollback-tested,
- `/api/v1/` REST path available,
- `/socket.io/` proxy upgrade available for realtime profiles,
- device credentials or a simulator credential strategy,
- Prometheus/Grafana available,
- DB metrics, backend metrics, object-storage metrics, and host metrics scraped.

## Pass Criteria

For each load profile:

- p95 REST latency remains below the product SLO.
- error rate remains below 1% for non-chaos runs.
- command ACK latency stays within publish/emergency SLO.
- outbox lag drains after fanout.
- heartbeat ingestion does not starve command claim/ACK.
- fallback polling recovers missed WebSocket notifications.
- DB CPU, locks, connections, and disk IO remain within capacity.
- media egress is served by object storage/CDN/cache, not backend/WebSocket.

## Chaos Scenarios

| ID | Scenario | Expected behavior | Required evidence |
|---|---|---|---|
| CH-001 | Disable WebSocket gateway | Players use polling/heartbeat fallback and still update | publish/default/emergency evidence |
| CH-002 | Stop outbox dispatcher | Commands remain durable and are claimed by polling | command/outbox status evidence |
| CH-003 | Restart backend during publish | Players retry REST and reconcile desired state | no lost command/snapshot evidence |
| CH-004 | Temporarily block DB | Players keep cached playback; queued ACK/PoP/cache reports retry after recovery | player queue and recovery evidence |
| CH-005 | Drop `/socket.io/` upgrade at proxy | WebSocket unhealthy, fallback poll active | fallback rate and command delivery evidence |
| CH-006 | Player offline during publish | Desired-state REST catches up on reconnect | stale-to-current reconciliation evidence |
| CH-007 | Media URL expires | Player reports URL expiry and refreshes authoritative REST state | media-cache report evidence |
| CH-008 | Disk full/cache write failure | Player reports `DISK_FULL`/cache error and continues available playback | CMS media/cache evidence |
| CH-009 | Emergency fanout while players reconnect | Emergency priority commands win and fallback catches missed wakes | emergency latency evidence |
| CH-010 | Reconnect storm | Gateway/API remain stable or rate limits/backoff protect service | connection/CPU/API evidence |

## Blocked In Local Session

Actual 1k/10k/50k fleet simulation, QA proxy chaos, and production-readiness signoff are blocked in this local Codex session because no QA deployment target, player credential set, or broker/proxy topology is available.
