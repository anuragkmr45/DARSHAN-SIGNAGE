# DARSHAN Governance

Last code-truth refresh: 2026-06-28.

This folder defines governance rules for DARSHAN code, deployment, runtime evidence, secrets, data/state, incidents, and rollback. The source code and active Docker deployment files are authoritative; governance docs explain how to control changes safely.

## Evidence Policy

Every governance claim must be traceable to code or deploy files:

| Field | Meaning |
|---|---|
| Governance area | Ownership, security, evidence, release, runtime state, or incident behavior being governed. |
| Source of truth | Code, config loader, route file, player service, Docker role, or existing architecture/contract doc. |
| Runtime owner | Backend, CMS, Player, Docker role, support, security, or ops owner. |
| Verification status | Code-backed, docs-backed, test-backed, or `needs runtime verification`. |

If source inspection cannot prove behavior on real VMs, player hardware, browser sessions, network topology, or observability targets, the doc must say `needs runtime verification`.

## Governance Documents

| Document | Purpose |
|---|---|
| `access-control-and-ownership.md` | Repo/runtime ownership, approval expectations, product access-control boundaries, operator boundaries. |
| `file-classification-rules.md` | Where source, config, secrets, runtime state, Docker data, and examples belong. |
| `change-control-and-release-governance.md` | PR/review expectations, promotion gates, release evidence, rollback evidence, production blockers. |
| `security-and-secret-governance.md` | Secret/config boundary, CMS browser visibility, player identity, certs, redaction, support-bundle review. |
| `runtime-evidence-governance.md` | Evidence rules for Node 20, browser QA, packaged player QA, health checks, media, realtime, screenshots, PoP, observability. |
| `data-and-runtime-state-governance.md` | Data ownership, Docker volumes, player local state, reset/delete rules, backup/restore ownership. |
| `incident-and-rollback-governance.md` | Emergency, realtime rollback, player recovery, config rollback, deployment rollback, evidence capture. |

## Primary Source References

| Source | Use |
|---|---|
| `docs/architecture/product-architecture.md` | Whole-product code-truth architecture map. |
| `docs/contracts/README.md` | Backend/CMS/player/realtime/deployment contract index. |
| `docs/environments/README.md` | Environment and Docker-on-VM role contract. |
| `deploy/production/README.md` | Production deployment procedure and evidence boundary. |
| `deploy/production/docker/*` | Active production Docker role scripts and compose files. |
| `darshan-server/src/server/index.ts` | Backend route registration and middleware source. |
| `darshan-cms/src/App.tsx` | CMS route tree and protected-route source. |
| `darshan-player/src/main/index.ts` | Player main runtime source. |

## Current Governance Baseline

- Code is authoritative; docs do not define new APIs, schemas, routes, auth behavior, player behavior, or deployment roles.
- Production uses Docker role deployments on normal VMs; Proxmox is the hypervisor only.
- REST/DB/object storage remain source of truth. Socket.IO is notification/wake-up only.
- Secrets stay in env/secret stores/runtime state. Non-secret runtime config uses JSON only where current loaders support it.
- CMS runtime config is browser-visible and must never contain secrets.
- Player device identity, certs, pairing state, media cache, request queue, proof-of-play queue, logs, and screenshots are runtime state, not committed config.
- Production readiness must not be claimed from docs, examples, deploy scripts, or local-only tests.

## Runtime Evidence Boundary

The following always require live evidence:

- Node 20 build/test validation on the approved runtime line.
- Browser CMS QA against deployed CMS origin.
- Packaged player install/autostart/pair/reset/re-pair tests on target hardware.
- Docker role health across the actual VM/LAN topology.
- Socket.IO/Valkey notification behavior and polling fallback.
- Media rendering for video, image, PDF, office, and webpage content.
- Screenshot capture and proof-of-play behavior under real device conditions.
- Prometheus/Grafana scrape and alert validity.
- No-secret review of logs, support bundles, screenshots, browser network payloads, and doctor output.

## Non-Goals

- These docs do not replace architecture, contracts, environment, runbook, or deployment docs.
- These docs do not authorize production readiness.
- These docs do not authorize destructive resets, DB wipes, cache wipes, or player identity deletion.
- These docs do not change behavior.

