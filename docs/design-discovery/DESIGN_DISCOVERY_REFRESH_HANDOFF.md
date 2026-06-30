# DARSHAN Design Discovery Refresh Handoff

Last code-truth refresh: 2026-06-28.

## Summary

`docs/design-discovery/**` was refreshed from the current codebase and current contract/architecture documentation. This was a documentation-only pass. No application code, APIs, routes, schemas, auth behavior, player runtime behavior, deployment scripts, or screenshots were changed.

## Scope Implemented

- Refreshed the core design-discovery report, flow map, component inventory, API/feature contract summary, and screenshot index.
- Added `CODE_TRUTH_TRACEABILITY.md` to connect feature domains to backend, CMS, player, API, and screenshot evidence.
- Added this handoff to record audited slices, stale evidence handling, verification, and remaining gaps.
- Labeled existing screenshot evidence as historical, after-redesign, final-QA, DOM-only, or needs recapture.

## Files Updated

| File | Change |
|---|---|
| `docs/design-discovery/DESIGN_DISCOVERY_REPORT.md` | Reframed as code-truth discovery summary with stack map, surfaces, UX audit, palette strategy, and runtime evidence boundary. |
| `docs/design-discovery/PRODUCT_FLOW_MAP.md` | Rebuilt route map from CMS routes and cross-product flows from backend/player domains. |
| `docs/design-discovery/COMPONENT_INVENTORY.md` | Updated CMS/player component inventory and redesign risk categories. |
| `docs/design-discovery/API_FEATURE_CONTRACTS.md` | Aligned design guardrails with backend endpoint registry, CMS API domains, player IPC/services, and `docs/contracts/**`. |
| `docs/design-discovery/SCREENSHOT_INDEX.md` | Reclassified screenshot evidence and recapture requirements. |
| `docs/design-discovery/CODE_TRUTH_TRACEABILITY.md` | Added feature-by-feature traceability table. |
| `docs/design-discovery/DESIGN_DISCOVERY_REFRESH_HANDOFF.md` | Added refresh handoff and verification record. |

## Audit Slices Completed

| Slice | Sources checked | Result |
|---|---|---|
| Backend/API | `darshan-server/src/server/index.ts`, `src/config/apiEndpoints.ts`, `src/routes/*`, related services/jobs/realtime/config docs | Major backend domains are represented in discovery docs and traceability. |
| CMS product | `darshan-cms/src/App.tsx`, `src/api/domains/*`, pages/components/runtime config/realtime hooks from existing reports and scans | Route map and UI risk mapping refreshed. |
| Player runtime | `darshan-player/src/main/index.ts`, preload, common config, services, renderer files | OTP/pairing/playback/cache/PoP/screenshot/offline/reset/restart domains represented. |
| Design/component | CMS shell/shared primitives/feature components and player renderer files | Component inventory updated around design-system primitives and high-risk behavior. |
| Evidence/screenshots | `docs/design-discovery/screenshots`, `after-redesign-screenshots`, `final-qa-screenshots` | Existing artifacts preserved and labeled; no new evidence claimed. |

## Stale Evidence Handling

- Existing screenshots were not deleted or overwritten.
- Original discovery screenshots are marked `historical-before-redesign`.
- Redesign screenshots are marked `after-redesign-local`.
- Final QA screenshots/logs are marked `final-qa-local`.
- Player OTP screenshots remain `dom-only` unless live Electron/package evidence is captured later.
- No screenshot is treated as production runtime evidence.

## Verification Run

Planned verification for this refresh:

- `rg` scans for CMS routes, CMS API domains, backend route registration, backend route files, and player services.
- Cross-check against `docs/contracts/**` and `docs/architecture/product-architecture.md`.
- `git diff --check`.
- Stale-claim scan for old repo names, old config paths, removed production-deployment wording, and fake runtime evidence.

Final command results are reported in the assistant response for this task.

## Blocked / Not Re-run

- Browser screenshots were not recaptured.
- Live Electron/player screenshots were not recaptured.
- Production Docker deployment was not run.
- On-prem runtime, packaged player, realtime latency, target-device playback, screenshot capture, and observability scrape evidence remain separate runtime verification work.

## Runtime Evidence Status

`NOT_CLAIMED`. This documentation refresh does not change production readiness.

## Risks

- Code may continue to evolve after this refresh; design docs should be treated as a dated code-truth snapshot.
- Some feature behavior is only fully verifiable with real backend/CMS/player runtime and target hardware.
- Existing screenshots may be stale and should be recaptured before another visual implementation phase.

## Recommendation

`DESIGN_DISCOVERY_REFRESH_COMPLETE_WITH_RUNTIME_GAPS`.

Use these docs for the next UI planning pass, but require fresh browser/player screenshots and runtime checks before claiming current visual or production evidence.
