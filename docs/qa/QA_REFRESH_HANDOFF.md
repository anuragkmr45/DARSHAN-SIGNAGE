# QA Refresh Handoff

Last code-truth refresh: 2026-06-28.

## Summary

`docs/qa/**` was refreshed as a documentation-only QA layer. The refresh adds a current QA index, traceability map, full-product QA matrix, runtime evidence checklist, and this handoff. Existing QA inventory, regression plan, tracker, and prompt-pack files were preserved with current status notes and corrected stale route/security claims where code had changed.

## Files Updated

| File | Change |
|---|---|
| `docs/qa/README.md` | Added current QA index, evidence policy, production QA boundary, and supporting doc links. |
| `docs/qa/QA_TRACEABILITY.md` | Added feature-domain to code/test/QA artifact map. |
| `docs/qa/FULL_PRODUCT_QA_MATRIX.md` | Added scenario matrix across backend, CMS, player, realtime, deployment, observability, and no-secret QA. |
| `docs/qa/RUNTIME_EVIDENCE_QA_CHECKLIST.md` | Added runtime evidence checklist with explicit `needs runtime verification` status. |
| `docs/qa/QA_REFRESH_HANDOFF.md` | Added this handoff. |
| `docs/qa/FEATURE_INVENTORY.md` | Updated evidence/status vocabulary, added refresh note, corrected stale CMS route guard/search/request/API-key/webhook/SSO notes. |
| `docs/qa/REGRESSION_MASTER_PLAN.md` | Added current Docker-on-VM QA boundary and refreshed environment notes. |
| `docs/qa/QA_REGRESSION_TRACKER.md` | Added current tracker status note so historical verified rows are not mistaken for new runtime evidence. |
| `docs/qa/DARSHAN_MASTER_CODEX_PROMPT_PACK.md` | Added historical/reference banner and current path note. |

## Audit Slices Completed

| Slice | Sources checked |
|---|---|
| Backend API/DB | `darshan-server/src/server/index.ts`, `src/config/apiEndpoints.ts`, route files/tests, DB/repository references through existing code-truth docs. |
| Backend runtime/deployment | runtime/bootstrap/config docs and `deploy/production/docker/*` role files. |
| CMS | `darshan-cms/src/App.tsx`, API domains, hooks, pages/components, current code-truth docs. |
| Player | `darshan-player/src/preload/index.ts`, service tree, renderer/runtime files through current code-truth docs. |
| Cross-product | implementation, runbook, support, governance, architecture, and contracts traceability docs. |
| Stale/no-secret | Scans over `docs/qa` for stale Proxmox/config/production-readiness/secret-like claims. |

## Runtime Evidence Status

No runtime evidence was produced by this refresh. Browser CMS QA, packaged player QA, target-device media rendering, screenshot capture, Socket.IO/Valkey latency, PoP replay, observability scrape health, and support-bundle no-secret review remain `needs runtime verification`.

## Known Gaps

- The QA docs are code-truth aligned but do not replace executable test runs.
- Historical April 2026 tracker rows remain preserved as historical QA evidence.
- Existing screenshots/logs are not revalidated by this pass.
- Runtime values, secrets, and target IPs are intentionally omitted.

## Verification Run

- `find docs/qa -maxdepth 3 -type f | sort`
- Source scans for backend route registration, endpoint constants, CMS routes/API domains, player IPC/services/config, Docker role files, and realtime/runtime evidence docs.
- Stale/no-secret scans over `docs/qa`.
- `git diff --check -- docs/qa`

## Recommendation

Use `docs/qa/README.md` as the entrypoint for QA planning. Use `FULL_PRODUCT_QA_MATRIX.md` for test design and `RUNTIME_EVIDENCE_QA_CHECKLIST.md` for target-environment evidence collection. Do not claim production readiness until runtime evidence is captured and reviewed.
