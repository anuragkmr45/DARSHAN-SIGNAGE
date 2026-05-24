# Enterprise Realtime Sync Open Risks

Last updated: 2026-05-24
Updated by: Codex

## Active Phase 1 And Phase 2 Risks

| Risk | Severity | Status | Evidence | Required action |
|---|---|---|---|---|
| Migration not reviewed on QA-sized DB | Medium | Open | Migration uses normal index creation and enum additions | Apply/review on QA-like database before production. |
| Node version mismatch | Medium | Open | Actual Node `v24.12.0`; package engines require `>=20 <21` | Re-run builds/tests under Node 20 before QA signoff. |
| Parallel DB-mutating backend tests interfere | Medium | Open | Combined `playback-refresh-dispatch + settings + emergency` run had one emergency assertion failure; isolated reruns passed | Run DB-mutating integration files isolated or add per-file DB isolation. |
| npm audit vulnerabilities | Medium | Open | Dependency install reported vulnerabilities in prior run | Track separately; do not block Phase 1 unless exploitable in changed path. |
| Dedicated realtime/outbox metrics missing | High | Open | Phase 3 has logs and registry stats, but no complete metrics/alerting for active connections, auth failures, outbox lag, or dispatch failures | Add metrics before QA/prod realtime enablement. |
| In-memory device connection registry | High | Open | Phase 3 registry is process-local | Validate sticky sessions in QA or add Redis/NATS/distributed routing before multi-instance production. |
| QA WebSocket proxy/sticky-session behavior unverified | High | Open | Gateway tests use local Socket.IO client, not nginx/load balancer | Validate `/socket.io/` upgrade, origin policy, idle timeout, and sticky sessions in QA. |
| Electron scoped Socket.IO transport needs QA runtime/proxy validation | High | Open | Raw backend gateway smoke passed, but Phase 4 uses existing `ws` dependency with scoped Socket.IO/Engine.IO framing, not `socket.io-client` | Run packaged backend/player integration smoke through QA proxy and decide whether to replace with `socket.io-client` before production. |
| Desired state missing tenant/org scope if required | High | Open | Phase 2 desired-state table is keyed by `screen_id`; no tenant/org column added | Confirm tenancy before multi-tenant QA/prod rollout. |
| Local `db:push` shows unrelated drift statements | Medium | Open | Phase 2 local push included existing Drizzle default/index drift statements | Use reviewed additive migration for QA/prod, not local push output. |
| CMS lint has pre-existing failures | Medium | Open | `npm run lint` fails in files outside Phase 5/6 changed paths: `LiveScreenMirror.tsx`, `EmergencyTakeoverModal.tsx`, and `tests/settings-default-media.e2e.spec.ts` | Fix or explicitly waive before full QA approval. |
| Phase 5 UI lacks browser/E2E verification | Medium | Open | CMS production build passed, but no browser visual smoke or E2E was run for the new Delivery tab | Run screen details Delivery tab visual review and E2E smoke before QA signoff. |
| CMS dependency audit findings | Medium | Open | `npm ci` in `signhex-nexus-core` reported 18 vulnerabilities | Triage in dependency hardening work; do not conflate with Phase 5 code behavior. |
| Media/cache report retention undefined | High | Open | Phase 6 adds durable `media_cache_reports` without TTL, partitioning, or archival | Define retention/partitioning before production; validate on QA-like failure volume. |
| Media/cache failure metrics/alerts missing | High | Open | Phase 6 adds report storage and CMS visibility, but no dashboard or alert rules | Add metrics/alerts in Phase 7/8 before production enablement. |
| CMS media/cache failure card lacks visual/E2E verification | Medium | Open | CMS build passed, but no browser smoke was run for the new card | Run screen details Delivery tab visual/E2E smoke with seeded failure rows. |
| Phase 7 static hardening is not runtime QA validation | High | Open | Phase 7 adds env/proxy/runbook/static validation assets only | Run actual QA proxy smoke, canary rollback drill, and backend/player realtime smoke before production enablement. |
| Sticky-session versus distributed registry decision still open | High | Open | Phase 3 connection registry is process-local; Phase 7 docs require a decision | Choose sticky sessions for single-instance/canary or implement Redis/NATS/distributed routing before multi-instance production. |
| Phase 8 real load/chaos execution missing | High | Open | Phase 8 added load model and chaos plan, but no QA/staging target was available for execution | Execute 1k/10k/50k load profiles and chaos suite before production readiness. |
| Production readiness not approved | Critical | Open | `realtime-sync-production-readiness-checklist.md` state is `NOT_PRODUCTION_READY`; runtime evidence attempt is blocked by missing QA/staging target | Do not start production canary or Phase 9 mobile adapters without accepted Phase 8 runtime evidence or explicit human deferral. |
| QA/staging runtime evidence unavailable | Critical | Open | Packaged QA server health check reports `postgres` not running; localhost backend/socket checks cannot connect; no QA/staging endpoint env vars are present | Provide QA/staging endpoints, simulator credentials, and approved load/chaos window. |

Latest Phase 1 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-1-handoff.md`.
Latest Phase 2 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-2-handoff.md`.
Latest Phase 3 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-3-handoff.md`.
Latest Phase 4 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-4-handoff.md`.
Latest Phase 5 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-5-handoff.md`.
Latest Phase 6 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-6-handoff.md`.
Latest Phase 7 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-7-handoff.md`.
Latest Phase 8 handoff: `signhex-platform/docs/implementation/realtime-sync-phase-8-handoff.md`.
Latest Phase 8 runtime evidence attempt: `signhex-platform/docs/implementation/realtime-sync-phase-8-runtime-evidence.md`.

## Architecture Risks For Later Phases

| Risk | Severity | Mitigation |
|---|---|---|
| WebSocket accidentally becomes source of truth | Critical | Enforce notification-only protocol and REST pull tests. |
| Polling fallback removed or weakened | Critical | Keep fallback tests in every phase. |
| Outbox dispatcher sends stale/duplicate notifications | High | Phase 3 dispatcher claims rows atomically and sends notification-only payloads; Phase 8 load/chaos must validate duplicate/missed-notification behavior. |
| Large fleet reconnect storm | High | Add jitter/backoff/rate limits before gateway rollout. |
| PoP/telemetry unbatched at scale | High | Add batching/partitioning before large fleet production. |
| Log/screenshot result visibility incomplete | Medium | Use HTTP/object storage status metadata; do not send large payloads over WebSocket. |

## Closed Risks

| Risk | Closure evidence |
|---|---|
| `TAKE_SCREENSHOT` backend/player mismatch | Closed by Electron normalization: `command-processor.ts` converts `TAKE_SCREENSHOT` to `SCREENSHOT`. |
| Backend DB tests blocked | Closed by local Docker Postgres plus schema push; `npx vitest run src/routes/device-telemetry-commands.test.ts` reported 11 passing. |
| `RESYNC` backend/player mismatch | Closed by adding Electron `RESYNC` command type and handler as a REST refresh/resync alias; targeted command tests reported 14 passing. |
| Refresh command creation lacks status history | Closed by routing playback refresh command creation through `createDeviceCommands`; playback refresh dispatch test verifies creation history entries. |
| Phase 2 outbox rows accumulate with no dispatcher | Closed by Phase 3 `outbox-dispatcher.ts`; disconnected devices remain retryable through `PENDING` rows. |
| Phase 4 not independently approved | Closed by independent verification pass on 2026-05-24; player build/tests, backend gateway test, and raw gateway smoke passed. |
| Media/cache failures invisible to CMS | Closed by Phase 6 `media_cache_reports`, device/CMS REST APIs, Electron reporter, and CMS Delivery tab failure card; focused tests passed. |
| QA/prod realtime flag and proxy guidance missing | Closed at documentation-control level by Phase 7 env examples, Nginx snippet, hardening runbook, static validator, and handoff; runtime QA smoke remains open. |
| Load/chaos/readiness plan missing | Closed at tooling/docs level by Phase 8 load model, load/chaos plan, production readiness checklist, QA canary evidence template, metrics/alert validation, static validator, and handoff; real runtime evidence remains open. |
