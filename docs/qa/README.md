# DARSHAN QA Documentation

Last code-truth refresh: 2026-06-28.

This folder is the QA planning and regression layer for DARSHAN. Code is authoritative. Existing docs, screenshots, and historical tracker entries are useful context, but a QA claim is current only when it cites implementation, tests, deployment files, or current code-truth docs.

## Evidence Policy

- Backend behavior must trace to `darshan-server/src/server/index.ts`, `darshan-server/src/config/apiEndpoints.ts`, `darshan-server/src/routes/*`, `darshan-server/src/services/*`, `darshan-server/src/db/schema.ts`, or backend tests.
- CMS behavior must trace to `darshan-cms/src/App.tsx`, `darshan-cms/src/api/domains/*`, `darshan-cms/src/pages/*`, `darshan-cms/src/components/*`, runtime config, hooks, or CMS tests.
- Player behavior must trace to `darshan-player/src/main/index.ts`, `darshan-player/src/preload/index.ts`, `darshan-player/src/common/*`, `darshan-player/src/main/services/*`, renderer files, CLI/operator tools, or player tests.
- Deployment QA must trace to `deploy/production/docker/*`, `deploy/production/README.md`, `deploy/shared/*`, manifests, or current environment/runbook docs.
- Runtime-only outcomes must be marked `needs runtime verification` until they are actually run on the stated backend/CMS/player/VM/device target.
- QA artifacts must not include real secrets, credentialed URLs, tokens, cert PEMs, private keys, signed URLs, full serials, or unreviewed log/support bundle content.

## Current QA Files

| File | Purpose | Status |
|---|---|---|
| `FEATURE_INVENTORY.md` | Code-traced feature inventory and integrated workflow map. | Current with historical notes preserved where labeled. |
| `REGRESSION_MASTER_PLAN.md` | Phased regression program and execution order. | Current; Docker-on-VM production is the deployment reference. |
| `QA_REGRESSION_TRACKER.md` | Defect system of record. | Historical April 2026 rows are preserved; new defects continue from the next unused `REG-*` ID. |
| `FULL_PRODUCT_QA_MATRIX.md` | Full-product QA scenario matrix by domain. | Current planning checklist. |
| `RUNTIME_EVIDENCE_QA_CHECKLIST.md` | Evidence checklist for target-runtime proof. | Current; does not claim evidence. |
| `QA_TRACEABILITY.md` | Mapping from feature domains to code, tests, and QA docs. | Current index. |
| `DARSHAN_MASTER_CODEX_PROMPT_PACK.md` | Historical broad QA prompt pack. | Preserved reference, not the current execution contract. |
| `QA_REFRESH_HANDOFF.md` | Summary of this code-truth refresh. | Current handoff. |

## Current Production QA Boundary

Production QA follows the Docker-on-VM model:

- data VM: Postgres and MinIO,
- Valkey VM: Valkey,
- backend VM: backend API/all-role worker container with runtime tools,
- CMS VM: nginx static CMS container,
- observability VM: Prometheus and Grafana.

Proxmox is the hypervisor only. LXC/systemd production guidance is historical and must not be used for new QA acceptance unless explicitly labeled compatibility.

For Docker production, backend JSON config is mounted as `/app/config/backend.json`. Player site config belongs on player devices at `/etc/darshan/player/config.json`.

## Supporting Code-Truth Docs

- `docs/architecture/product-architecture.md`
- `docs/contracts/README.md`
- `docs/implementation/IMPLEMENTATION_TRACEABILITY.md`
- `docs/runbooks/RUNBOOK_TRACEABILITY.md`
- `docs/support/README.md`
- `docs/governance/runtime-evidence-governance.md`
