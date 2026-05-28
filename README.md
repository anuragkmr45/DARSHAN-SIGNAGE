# Signhex Monorepo

This repository is the unified source and platform workspace for the Signhex digital signage system.

It contains:

- `signhex-server/` - backend/API server, database schema, migrations, device APIs, CMS APIs, command lifecycle, realtime notification gateway, telemetry, proof-of-play, default media, emergency/takeover, and reservations/conflicts.
- `signhex-nexus-core/` - CMS/admin frontend for schedules, presentations, layouts, media assignment, default media, emergency/takeover, publish, monitoring, and screen operations.
- `signage-screen/` - Electron signage player used on physical screens.
- `docs/`, `deploy/`, `scripts/`, `standards/`, `manifests/`, and `assets/` - platform architecture, on-prem deployment, observability, release, QA, support, and implementation tracking material formerly maintained in `signhex-platform`.

## Architecture Guardrails

The enterprise realtime sync architecture is documented in:

- `ENTERPRISE_REALTIME_SYNC_CODEX_RUNBOOK.md`
- `docs/architecture/enterprise-realtime-sync.md`
- `docs/implementation/realtime-sync-project-status.md`
- `docs/implementation/realtime-sync-phase-approval-log.md`

Current fixed rules:

- DB tables, `schedule_snapshots`, `device_commands`, `command_outbox`, and `device_desired_state` are source of truth.
- WebSocket is notification/wake-up only.
- REST APIs are authoritative for data fetch and ACK.
- Media is delivered through HTTP/on-prem object storage/internal media endpoints/local cache, never WebSocket or Valkey.
- Polling and heartbeat fallback are mandatory.
- Valkey is on-prem cross-node wake fanout only; it is not durable truth.
- QA and production behavior must be feature-flagged and rollback-safe.

## Repository Layout

```text
signage-screen/        Electron signage player
signhex-server/        Backend/API server
signhex-nexus-core/    CMS/admin frontend
docs/                  Architecture, contracts, environments, implementation status, QA, runbooks
deploy/                On-prem deployment and observability templates
scripts/               Bootstrap, bundle, export, load, release, and verification helpers
standards/             Repository, CI/CD, observability, and security standards
manifests/             QA/production version pins and release records
assets/                Diagrams, templates, and non-product assets
```

## Common Commands

Backend:

```bash
cd signhex-server
npm run build
npx vitest run
```

CMS:

```bash
cd signhex-nexus-core
npm run lint
npm run build
```

Electron player:

```bash
cd signage-screen
npm run build
npm run test:unit
```

Platform validation:

```bash
bash scripts/verify/validate-realtime-sync-phase7-assets.sh
bash scripts/verify/validate-realtime-sync-phase8-assets.sh
bash scripts/verify/validate-observability-assets.sh
```

## On-Prem Deployment

Primary runbooks:

- `docs/runbooks/onprem-qa-setup.md`
- `docs/runbooks/onprem-production-setup.md`
- `docs/runbooks/realtime-sync-qa-prod-hardening.md`
- `docs/runbooks/onprem-bundle-builder.md`
- `docs/runbooks/product-export-packaging.md`

## Realtime Sync Status

Phase 8 is locally implemented and tested, including Valkey fanout backfill, but production readiness remains blocked until real air-gapped on-prem runtime evidence is accepted.

Phase 9 mobile/TV adapters remain blocked until the Phase 8 gate is accepted or explicitly deferred by a human approver.

## Commit Rules

- Do not commit generated bundles, `build/`, `dist/`, `out/`, runtime temp files, or `.DS_Store`.
- Do not commit secrets, real certificates, production `.env` values, or customer data.
- Keep architecture, task, approval, risk, test, and handoff docs when cleaning up old prompts or planning material.
- Keep migrations additive and rollback-documented.
