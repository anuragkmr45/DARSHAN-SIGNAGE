# Runbook Traceability

Last code-truth refresh: 2026-06-28.

This document maps runbooks to source code, deploy files, and current supporting docs. It is a runbook index, not an implementation contract.

## Classification

| Runbook | Classification | Code/deploy source | Current supporting docs | Notes |
|---|---|---|---|---|
| `onprem-production-setup.md` | production/current | `deploy/production/docker/*`, `deploy/production/README.md` | `docs/environments/production/README.md`, `docs/contracts/deployment-config-contracts.md` | Docker-on-VM production. |
| `onprem-two-machine-production-docker.md` | lab/small-site current | `deploy/production/docker/start-all.sh`, role compose files | `docs/environments/production/README.md` | Single server-machine variation only. |
| `onprem-qa-setup.md` | QA current | bundle/export scripts, production Docker role layout | `docs/environments/qa/README.md` | QA uses same role split as production where practical. |
| `onprem-config-management.md` | config current | backend/player/CMS config loaders and examples | `docs/environments/README.md`, `docs/examples/README.md` | JSON config is current; older YAML layout is not current guidance. |
| `player-deployment.md` | player current | `darshan-player/package.json`, `src/common/file-config.ts`, `src/main/index.ts` | `docs/contracts/player-runtime-contracts.md`, `docs/onboarding/player-field-onboarding.md` | Packaged player evidence requires target device. |
| `player-clean-reinstall-reset.md` | player support current | `darshan-player/src/main/services/operator-tools.ts`, `platform-paths.ts` | `docs/governance/data-and-runtime-state-governance.md` | Reset must preserve queues unless explicitly cleared by supported option. |
| `onprem-player-ghost-pairing-recovery.md` | player support current | backend `device-pairing.ts`, player `pairing-service.ts`, `player-flow.ts` | `docs/architecture/player-pairing-identity.md` | Use recovery/reset flows; do not manually recreate identities. |
| `ghost-pairing-onprem-qa-checklist.md` | QA/historical checklist | backend pairing routes, CMS Screens UI, player pairing services | `docs/contracts/player-runtime-contracts.md` | Rows pass only when run against real QA targets. |
| `realtime-sync-qa-prod-hardening.md` | QA/prod hardening | backend realtime/outbox/desired-state services, player realtime services | `docs/contracts/realtime-command-contracts.md` | Realtime is notification-only. |
| `runtime-evidence-collection.md` | runtime evidence current | all product runtimes and Docker roles | `docs/governance/runtime-evidence-governance.md` | Full-product evidence checklist. |
| `product-export-packaging.md` | packaging current | export scripts, bundle scripts | `docs/contracts/deployment-config-contracts.md` | Source-free artifacts where supported. |
| `onprem-bundle-builder.md` | packaging/current | bundle scripts, deploy assets | `docs/environments/production/README.md` | Bundle flow must align to Docker role split. |
| `observability-*.md` | observability current | `deploy/shared/observability/*`, backend metrics/observability routes | `docs/governance/runtime-evidence-governance.md` | Prometheus/Grafana health needs runtime evidence. |

## Feature Coverage

| Feature | Primary runbook | Code source |
|---|---|---|
| Login/auth/session | `runtime-evidence-collection.md`, `onprem-production-setup.md` | `darshan-server/src/routes/auth.ts`, `darshan-cms/src/pages/Auth.tsx` |
| Media upload/render | `runtime-evidence-collection.md`, `onprem-production-setup.md` | backend media routes/S3 utilities, CMS Media page, player cache/renderer files |
| Layout/schedule publish | `runtime-evidence-collection.md`, `realtime-sync-qa-prod-hardening.md` | schedule/layout routes, CMS schedule/layout pages, player snapshot manager |
| Screen pairing/recovery | `onprem-player-ghost-pairing-recovery.md`, `ghost-pairing-onprem-qa-checklist.md` | backend device pairing routes, player pairing services, CMS Screens components |
| Default media | `runtime-evidence-collection.md`, `realtime-sync-qa-prod-hardening.md` | backend settings/default media utilities, CMS Settings, player default media service |
| Emergency takeover | `runtime-evidence-collection.md`, `realtime-sync-qa-prod-hardening.md` | backend emergency/request routes, CMS Requests page, player command/playback services |
| Screenshots | `runtime-evidence-collection.md`, `player-deployment.md` | backend device telemetry, player screenshot service, CMS Screens UI |
| Proof-of-play | `runtime-evidence-collection.md`, `player-clean-reinstall-reset.md` | backend device telemetry/proof routes, player PoP service/spool |
| Chat/notifications | `runtime-evidence-collection.md` | backend chat/notification routes and namespaces, CMS chat/notification pages |
| Observability | `observability-*.md`, `runtime-evidence-collection.md` | backend metrics/observability routes, `deploy/shared/observability/*` |

## Evidence Boundary

Runbooks can describe the correct procedure. They do not prove the procedure passed on a target environment. Browser, packaged player, target media rendering, screenshot capture, PoP replay, realtime latency, Docker VM health, and observability scrape evidence remain `needs runtime verification` until captured.
