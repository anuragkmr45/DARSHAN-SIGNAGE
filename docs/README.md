# DARSHAN Documentation Index

Last documentation index refresh: 2026-06-28.

This is the main navigation page for DARSHAN documentation. Use it to find the right document before editing code, deploying, testing, supporting a screen, or collecting production evidence.

## Ground Rules

- Code is the source of truth. Docs explain the code; they do not override backend APIs, CMS routes, player behavior, schemas, env handling, or deployment scripts.
- Documentation does not approve DARSHAN for production use. Production acceptance requires runtime evidence from the target backend, CMS, player devices, Docker VMs, browser QA, media rendering, screenshots, proof-of-play, observability, and no-secret review.
- Do not add sensitive values to docs. Never commit real auth values, URLs with embedded credentials, signed URLs, cert PEMs, private keys, full serials, or unreviewed logs/support bundles.
- Current production deployment is Docker-on-VM. Proxmox is only the hypervisor; DARSHAN services run inside Docker on normal Ubuntu Server VMs.
- Historical phase handoffs are preserved as evidence. Use current architecture, contracts, environment, examples, runbooks, QA, governance, onboarding, and support docs first.

## Start Here

| Need | Open first | Notes |
|---|---|---|
| Understand the full product architecture | [architecture/product-architecture.md](architecture/product-architecture.md) | Whole-product map from code truth. |
| Understand repo layout and ownership | [architecture/repository-topology.md](architecture/repository-topology.md) | Folders, apps, and boundaries. |
| Check backend/CMS/player contracts | [contracts/README.md](contracts/README.md) | Index for API, CMS, player, realtime, and deployment contracts. |
| Deploy production on five Docker VMs | [../deploy/production/README.md](../deploy/production/README.md), [runbooks/onprem-production-setup.md](runbooks/onprem-production-setup.md) | Use Docker-on-VM production path. |
| Operate the production Docker roles | [support/production-docker-support.md](support/production-docker-support.md), [../deploy/production/docker/README.md](../deploy/production/docker/README.md) | Support and role-level operations. |
| Configure backend/CMS/player | [environments/README.md](environments/README.md), [examples/README.md](examples/README.md), [runbooks/onprem-config-management.md](runbooks/onprem-config-management.md) | Env/config boundaries and safe examples. |
| Install or update player devices | [runbooks/player-deployment.md](runbooks/player-deployment.md), [onboarding/player-field-onboarding.md](onboarding/player-field-onboarding.md) | Packaged player, config, and field setup. |
| Troubleshoot a player or screen | [support/player-troubleshooting.md](support/player-troubleshooting.md), [support/screen-operations-runbook.md](support/screen-operations-runbook.md) | Pairing, offline, playback, screenshots, and state. |
| Run QA or regression planning | [qa/README.md](qa/README.md), [qa/FULL_PRODUCT_QA_MATRIX.md](qa/FULL_PRODUCT_QA_MATRIX.md) | Full-product QA map. |
| Collect runtime evidence | [qa/RUNTIME_EVIDENCE_QA_CHECKLIST.md](qa/RUNTIME_EVIDENCE_QA_CHECKLIST.md), [runbooks/runtime-evidence-collection.md](runbooks/runtime-evidence-collection.md) | Evidence required before claims. |
| Understand governance rules | [governance/README.md](governance/README.md) | Change, security, evidence, data, and rollback governance. |
| Onboard a new engineer/operator | [onboarding/README.md](onboarding/README.md) | Codebase and role-specific onboarding paths. |
| Review UI redesign discovery | [design-discovery/DESIGN_DISCOVERY_REPORT.md](design-discovery/DESIGN_DISCOVERY_REPORT.md) | Design audit, screenshots, components, and QA notes. |

## Folder Map

| Folder | Meaning | Use when |
|---|---|---|
| [architecture](architecture/) | System architecture, feature maps, failure modes, scaling limits, config architecture, command lifecycle, realtime, and player identity. | You need to understand how DARSHAN works internally. |
| [contracts](contracts/) | Code-derived contracts for backend APIs, CMS routes/features, player runtime, realtime/commands, and deployment/config. | You need to know what must not break during changes. |
| [design-discovery](design-discovery/) | CMS/player design discovery, redesign reports, screenshots, component inventory, final QA/design audits. | You are doing UI/UX redesign, audit, or visual QA. |
| [environments](environments/) | Environment model for development, QA, production, and config/runtime boundaries. | You need to decide where env values, JSON config, and runtime settings belong. |
| [examples](examples/) | Safe non-secret backend/CMS/player config examples and on-prem config sets. | You need a template, not a filled secret file. |
| [governance](governance/) | Rules for ownership, change control, security/secrets, runtime evidence, state, incidents, and rollback. | You need release, security, audit, or operational decision rules. |
| [implementation](implementation/) | Current implementation traceability plus historical phase handoffs and evidence notes. | You need background on CONFIG, realtime, ghost-pairing, secure offline, or phase history. |
| [onboarding](onboarding/) | Engineer/operator onboarding for codebase, backend/CMS/player, production Docker, and player field work. | You are joining the project or setting up an operator/engineer workflow. |
| [qa](qa/) | Feature inventory, regression plan, QA tracker, traceability, full QA matrix, and runtime evidence checklist. | You need to plan or execute verification. |
| [runbooks](runbooks/) | Step-by-step operational procedures for production, QA, config, player deployment/reset/recovery, observability, packaging, and runtime evidence. | You need to do an operational task. |
| [support](support/) | Support playbooks for CMS operators, players, production Docker, screens, runtime evidence, and no-secret review. | You need to diagnose or support a live issue. |

## Current Source-Of-Truth Docs

| Area | Current docs |
|---|---|
| Whole product architecture | [architecture/product-architecture.md](architecture/product-architecture.md) |
| Repository topology | [architecture/repository-topology.md](architecture/repository-topology.md) |
| Backend/API/CMS/player contracts | [contracts/README.md](contracts/README.md) |
| Production Docker-on-VM deployment | [../deploy/production/README.md](../deploy/production/README.md), [../deploy/production/docker/README.md](../deploy/production/docker/README.md) |
| Config/env boundaries | [architecture/onprem-config-architecture.md](architecture/onprem-config-architecture.md), [environments/README.md](environments/README.md), [examples/README.md](examples/README.md) |
| Realtime and commands | [architecture/enterprise-realtime-sync.md](architecture/enterprise-realtime-sync.md), [contracts/realtime-command-contracts.md](contracts/realtime-command-contracts.md) |
| Player identity and recovery | [architecture/player-pairing-identity.md](architecture/player-pairing-identity.md), [contracts/player-runtime-contracts.md](contracts/player-runtime-contracts.md) |
| Implementation traceability | [implementation/IMPLEMENTATION_TRACEABILITY.md](implementation/IMPLEMENTATION_TRACEABILITY.md) |
| Runbook traceability | [runbooks/RUNBOOK_TRACEABILITY.md](runbooks/RUNBOOK_TRACEABILITY.md) |
| QA traceability | [qa/QA_TRACEABILITY.md](qa/QA_TRACEABILITY.md) |
| Runtime evidence rules | [governance/runtime-evidence-governance.md](governance/runtime-evidence-governance.md), [qa/RUNTIME_EVIDENCE_QA_CHECKLIST.md](qa/RUNTIME_EVIDENCE_QA_CHECKLIST.md) |

## Production Deployment Path

For production, start with:

1. [../deploy/production/README.md](../deploy/production/README.md)
2. [../deploy/production/docker/README.md](../deploy/production/docker/README.md)
3. [runbooks/onprem-production-setup.md](runbooks/onprem-production-setup.md)
4. [support/production-docker-support.md](support/production-docker-support.md)

Current production roles:

| Role | Runs |
|---|---|
| Data VM | Postgres and MinIO |
| Valkey VM | Valkey |
| Backend VM | Backend API container with all-role worker behavior and runtime tools |
| CMS VM | nginx static CMS container |
| Observability VM | Prometheus and Grafana |

Player devices are separate from server VMs. Use [runbooks/player-deployment.md](runbooks/player-deployment.md) and configure the player with `/etc/darshan/player/config.json`.

## Historical And Evidence Docs

Many files in [implementation](implementation/) are phase handoffs, risk logs, historical evidence, or verification notes. They are useful for context, but they are not the current operational entrypoint unless cross-linked from current architecture, contracts, QA, governance, support, or runbook docs.

Examples:

- `config-phase-*` files document config migration phases.
- `ghost-pairing-*` files document player pairing hardening phases.
- `realtime-sync-*` files document realtime/outbox/Valkey phases.
- runtime-evidence files only prove what they explicitly say was run, on the stated target, at that time.

When historical docs conflict with current code or current Docker-on-VM docs, use code and current docs first.

## Editing Rules

- Keep docs code-truth based. Cite implementation, deploy files, tests, or current traceability docs for factual claims.
- Mark runtime-only claims as `needs runtime verification` until real evidence exists.
- Keep examples non-secret and placeholder-only.
- Do not replace detailed folder READMEs with this file; this file is the map, not the full procedure.
- Preserve historical evidence unless it is actively misleading; prefer adding status notes over deleting phase history.
