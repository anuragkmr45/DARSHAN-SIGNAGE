# Runbooks Refresh Handoff

## Summary

Refreshed `docs/runbooks/**` as the operator-facing procedural layer for the current codebase and Docker-on-VM production model. This pass is documentation-only.

## Scope Implemented

- Added runbook index.
- Added runbook traceability map.
- Added full-product runtime evidence collection runbook.
- Added this handoff.
- Reframed production/config/player runbooks around current Docker config boundaries and runtime evidence rules.
- Added code-truth source references to QA, pairing recovery, packaging, bundle, and realtime hardening runbooks.

## Files Changed

| File | Purpose |
|---|---|
| `docs/runbooks/README.md` | Current runbook index and operating rules. |
| `docs/runbooks/RUNBOOK_TRACEABILITY.md` | Maps runbooks to code/deploy source and feature coverage. |
| `docs/runbooks/runtime-evidence-collection.md` | Full-product evidence and no-secret review procedure. |
| `docs/runbooks/RUNBOOK_REFRESH_HANDOFF.md` | This handoff. |
| Existing runbooks listed in git diff | Updated only within `docs/runbooks` to align with current Docker/config/player guidance. |

## Verification Run

| Check | Result |
|---|---|
| `find docs/runbooks -maxdepth 2 -type f \| sort` | Passed; runbook inventory completed. |
| Backend route/realtime scan against `darshan-server/src/server/index.ts` | Passed; route registration, health endpoint, device realtime gateway, and outbox startup confirmed. |
| CMS route/guard scan against `darshan-cms/src/App.tsx` | Passed; route tree and protected-route guards confirmed. |
| Player IPC/config/pairing/playback/evidence scan | Passed; preload IPC, config selectors, pairing, default-media, playback progress, screenshot, heartbeat, and request-queue references confirmed. |
| Docker role/shared observability file scan | Passed; production role compose/scripts and shared observability assets confirmed. |
| Stale/no-secret scan over `docs/runbooks` | Passed for strict stale/secret patterns after updates. Remaining production-readiness language is negative/evidence-gate language only. |
| `git diff --check -- docs/runbooks` | Passed. |

## Runtime Evidence Status

`needs runtime verification`.

This refresh does not run live Docker VMs, browser CMS QA, packaged player QA, media rendering, screenshot capture, PoP replay, realtime latency, or observability scrape validation.

## Recommendation

Use `docs/runbooks/README.md` as the entrypoint for operators and `docs/runbooks/RUNBOOK_TRACEABILITY.md` as the coverage map. Continue treating legacy phase-specific runbooks as historical unless they are explicitly classified as current in the traceability map.
