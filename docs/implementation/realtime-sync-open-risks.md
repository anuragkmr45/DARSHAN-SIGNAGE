# Enterprise Realtime Sync Open Risks

Last updated: 2026-05-24
Updated by: Codex

## Active Phase 1 Risks

| Risk | Severity | Status | Evidence | Required action |
|---|---|---|---|---|
| Backend DB tests blocked | High | Open | `npx vitest run src/routes/device-telemetry-commands.test.ts` failed with Postgres `ECONNREFUSED` | Start/configure Postgres and rerun backend command tests. |
| `RESYNC` backend/player mismatch | High | Open | Backend accepts `RESYNC`; Electron `rg RESYNC src test` returned no matches | Add Electron handler/alias or block/defer backend `RESYNC`. |
| Refresh command creation lacks status history | Medium | Open | `createPlaybackRefreshCommands` inserts directly into `device_commands` | Route through lifecycle service or explicitly defer creation history. |
| Migration not reviewed on QA-sized DB | Medium | Open | Migration uses normal index creation and enum additions | Apply/review on QA-like database before production. |
| Node version mismatch | Medium | Open | Actual Node `v24.12.0`; package engines require `>=20 <21` | Re-run builds/tests under Node 20 before approval. |
| npm audit vulnerabilities | Medium | Open | Dependency install reported vulnerabilities in prior run | Track separately; do not block Phase 1 unless exploitable in changed path. |

## Architecture Risks For Later Phases

| Risk | Severity | Mitigation |
|---|---|---|
| WebSocket accidentally becomes source of truth | Critical | Enforce notification-only protocol and REST pull tests. |
| Polling fallback removed or weakened | Critical | Keep fallback tests in every phase. |
| Outbox not transactional with command/state writes | High | Add transaction rollback tests in Phase 2. |
| Desired state missing tenant/org scope if required | High | Resolve tenancy before Phase 2 schema freeze. |
| Large fleet reconnect storm | High | Add jitter/backoff/rate limits before gateway rollout. |
| PoP/telemetry unbatched at scale | High | Add batching/partitioning before large fleet production. |
| Media/cache failures invisible to CMS | Medium | Phase 6 media/cache status reporting. |

## Closed Risks

| Risk | Closure evidence |
|---|---|
| `TAKE_SCREENSHOT` backend/player mismatch | Closed by Electron normalization: `command-processor.ts` converts `TAKE_SCREENSHOT` to `SCREENSHOT`. |

