# DARSHAN Runbooks

Last code-truth refresh: 2026-08-23.

This folder is the operator-facing procedure layer for DARSHAN. The codebase and active deploy files are authoritative; runbooks explain how to operate the system safely.

## Source Of Truth

| Area | Source |
|---|---|
| Whole-product architecture | `docs/architecture/product-architecture.md` |
| Product contracts | `docs/contracts/README.md` |
| Environment model | `docs/environments/README.md` |
| Config examples | `docs/examples/README.md` |
| Governance and evidence rules | `docs/governance/README.md` |
| Implementation map | `docs/implementation/IMPLEMENTATION_TRACEABILITY.md` |
| Support playbooks | `docs/support/README.md` |
| Production deploy tree | `deploy/production/README.md`, `deploy/production/docker/*` |

## Runbook Index

| Runbook | Use |
|---|---|
| `onprem-production-setup.md` | Five-VM Docker production setup and role startup. |
| `onprem-two-machine-production-docker.md` | Single server-machine plus separate player lab/small-site Docker shape. |
| `onprem-qa-setup.md` | QA runtime bundle and on-prem QA topology. |
| `onprem-config-management.md` | Config/env boundary and site config preparation. |
| `player-deployment.md` | Build, install, configure, autostart, update, and diagnose packaged player. |
| `player-clean-reinstall-reset.md` | Controlled player identity reset and clean reinstall. |
| `onprem-player-ghost-pairing-recovery.md` | Pairing recovery and duplicate/orphan identity triage. |
| `ghost-pairing-onprem-qa-checklist.md` | Manual/browser/runtime QA checklist for pairing hardening. |
| `realtime-sync-qa-prod-hardening.md` | Realtime canary, rollback, and QA/prod hardening controls. |
| `realtime-delivery-verification.md` | WebSocket-first delivery, source-free provenance, fallback, and acceptance evidence. |
| `runtime-evidence-collection.md` | Full-product runtime evidence and no-secret review procedure. |
| `source-free-production-bundle-deployment.md` | Canonical one-file build flow; generated production VM files require no manual edits. |
| `product-export-packaging.md` | Source-free product export packaging. |
| `onprem-bundle-builder.md` | Runtime bundle assembly. |
| `observability-*.md` | Observability install, upgrade, incident, rollback, networking, backup, and offline images. |
| `RUNBOOK_TRACEABILITY.md` | Code/deploy traceability and classification for all runbooks. |
| `RUNBOOK_REFRESH_HANDOFF.md` | Handoff for this docs-only refresh. |

## Operating Rules

- Use Docker role deployments on Ubuntu Server VMs for production. Proxmox is the hypervisor only.
- Backend Docker config selector must resolve inside the container, normally `/app/config/backend.json`.
- CMS runtime config is browser-visible `/config/app-config.json`; never put secrets there.
- Player site config is `/etc/darshan/player/config.json`; runtime identity/certs/cache/queues stay in player app data.
- Source-free production is generated only from `deploy/production/bundles/<site>-<release>.env`; do not also edit source or target role config.
- Production browser/API/player/media/scrape transport uses verified HTTPS/WSS with separate transport and device CAs.
- Media moves through HTTP/object storage/local cache, not Socket.IO.
- REST/DB/object storage remain source of truth. Socket.IO is notification-only.
- Do not wipe DB, object storage, player app-data, certs, cache, request queue, or PoP spool unless the specific runbook says to and the operator approves.
- Do not claim production readiness from docs, local tests, or Docker health alone.

## Runtime Evidence Boundary

The following must be tested on real targets before they are treated as verified:

- browser CMS QA,
- packaged player install/autostart/pair/reset/re-pair,
- video/image/PDF/office/webpage rendering,
- screenshot capture,
- proof-of-play queue/replay,
- Socket.IO/Valkey latency and polling fallback,
- Prometheus/Grafana scrape and alert health,
- no-secret review of logs, screenshots, browser payloads, player doctor output, and support bundles.
