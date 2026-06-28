# Implementation Docs Refresh Handoff

## Summary

Refreshed implementation, onboarding, and support documentation from the current codebase and current code-truth architecture/contracts. This pass is documentation-only and does not change app behavior, APIs, schemas, auth, player behavior, deployment scripts, or runtime configuration behavior.

## Scope Implemented

- Added current `docs/implementation` index.
- Added implementation traceability across backend, CMS, player, deployment, historical implementation docs, and runtime evidence boundaries.
- Added onboarding entrypoints for codebase, product runtimes, production Docker-on-VM, and player field work.
- Added support entrypoints for screen operations, player troubleshooting, CMS operator support, production Docker support, and runtime/no-secret evidence review.
- Updated the screen operations runbook to replace stale single-source references with current code-truth references while preserving operational guidance.

## Files Changed

| File | Purpose |
|---|---|
| `docs/implementation/README.md` | Current index and reading rules for historical implementation docs. |
| `docs/implementation/IMPLEMENTATION_TRACEABILITY.md` | Code-backed product-domain implementation map. |
| `docs/implementation/IMPLEMENTATION_REFRESH_HANDOFF.md` | This handoff. |
| `docs/onboarding/README.md` | Onboarding index. |
| `docs/onboarding/codebase-tour.md` | Repo/runtime tour for new contributors. |
| `docs/onboarding/backend-cms-player-onboarding.md` | Developer onboarding across the three app runtimes. |
| `docs/onboarding/production-docker-on-vm-onboarding.md` | Operator onboarding for Docker production VMs. |
| `docs/onboarding/player-field-onboarding.md` | Field onboarding for packaged player devices. |
| `docs/support/README.md` | Support playbook index. |
| `docs/support/screen-operations-runbook.md` | Updated screen operations guidance. |
| `docs/support/player-troubleshooting.md` | Player troubleshooting playbook. |
| `docs/support/cms-operator-support.md` | CMS operator support playbook. |
| `docs/support/production-docker-support.md` | Docker production support playbook. |
| `docs/support/runtime-evidence-and-no-secret-review.md` | Runtime evidence and no-secret review playbook. |

## Audit Slices

| Slice | Source checked | Result |
|---|---|---|
| Backend | `darshan-server/src/server/index.ts`, route files, runtime/config/realtime/service references | Backend domains mapped in `IMPLEMENTATION_TRACEABILITY.md`. |
| CMS | `darshan-cms/src/App.tsx`, API domains, pages, auth guards, runtime config, realtime hooks | CMS route and operator domains mapped. |
| Player | `darshan-player/src/main/index.ts`, preload IPC, common config/types, services, renderer files | Player runtime/service domains mapped. |
| Deployment/config | `deploy/production/README.md`, `deploy/production/docker/*`, environment/example/governance docs | Docker-on-VM model documented as current production direction. |
| Historical docs | Existing CONFIG, ghost-pairing, realtime-sync, and secure-offline docs | Historical docs classified instead of overwritten. |

## Runtime Evidence Status

`needs runtime verification`.

This refresh did not run live browser, packaged player, Docker VM, media rendering, screenshot, Socket.IO/Valkey latency, or observability evidence. It must not be used to claim production readiness.

## Verification Commands And Results

| Command | Result |
|---|---|
| `find docs/implementation docs/onboarding docs/support -maxdepth 2 -type f \| sort` | Passed; target folder inventory completed. |
| `rg -n "await fastify.register\|setupDeviceRealtimeGateway\|startOutboxDispatcher\|fastify.get\\('/api/v1/health'" darshan-server/src/server/index.ts` | Passed; backend route registration, health, device gateway, and outbox startup source confirmed. |
| `rg -n "<Route\|ProtectedRoute\|moduleKey\|requirePermissions" darshan-cms/src/App.tsx` | Passed; CMS route and guard source confirmed. |
| `rg -n "ipcMain\|ipcRenderer\|contextBridge\|DARSHAN_PLAYER_CONFIG_FILE\|pairing-\|default-media\|player-active-playback\|player-playback-progress\|renderer-log\|screenshot\|heartbeat\|Socket.IO\|socket" darshan-player/src/main darshan-player/src/preload darshan-player/src/common darshan-player/src/renderer` | Passed; player IPC/config/pairing/playback/evidence/realtime references confirmed. |
| Stale-reference and secret-pattern scan over `docs/implementation`, `docs/onboarding`, and `docs/support` | Completed; remaining matches are historical `NOT_PRODUCTION_READY`/negative-readiness statements or historical runtime-evidence terminology, not new current guidance. |
| `git diff --check -- docs/implementation docs/onboarding docs/support` | Passed. |

## Known Gaps

- Historical implementation phase docs still contain older phase language by design. Use this folder's README and traceability map first.
- Runtime evidence remains separate from docs and must be captured on real targets.
- Support procedures intentionally avoid destructive DB/player reset steps unless explicitly routed to the correct runbook.

## Recommendation

Use `docs/implementation/IMPLEMENTATION_TRACEABILITY.md` as the current implementation map, and treat phase handoffs as historical evidence unless a current architecture/contract/environment doc explicitly cross-links them.
