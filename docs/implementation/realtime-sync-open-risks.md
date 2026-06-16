# Enterprise Realtime Sync Open Risks

Last updated: 2026-06-16
Updated by: Codex

## Active Phase 1 And Phase 2 Risks

| Risk | Severity | Status | Evidence | Required action |
|---|---|---|---|---|
| Migration not reviewed on QA-sized DB | Medium | Open | Migration uses normal index creation and enum additions | Apply/review on QA-like database before production. |
| Node version mismatch | Medium | Open | Actual Node `v24.12.0`; package engines require `>=20 <21` | Re-run builds/tests under Node 20 before on-prem QA signoff. |
| Parallel DB-mutating backend tests interfere | Medium | Open | Combined `playback-refresh-dispatch + settings + emergency` run had one emergency assertion failure; isolated reruns passed | Run DB-mutating integration files isolated or add per-file DB isolation. |
| npm audit vulnerabilities | Medium | Open | Dependency install reported vulnerabilities in prior run | Track separately; do not block Phase 1 unless exploitable in changed path. |
| Dedicated realtime/outbox metrics need QA tuning | Medium | Open | Phase 8 continuation added metrics and alerts, and local Prometheus validation passed; no QA traffic threshold tuning has run | Tune alert thresholds during on-prem QA load/chaos. |
| In-memory device connection registry | High | Mitigated locally, open for on-prem | Phase 8 backfill implemented Valkey device-node registry and fanout; real on-prem node A/node B runtime evidence is missing | Validate Valkey-backed fanout/distributed coordination before multi-instance production. Sticky sessions are allowed only if Socket.IO HTTP polling transport is enabled. |
| On-prem QA WebSocket proxy and transport behavior unverified | High | Open | Gateway tests use local Socket.IO client, not nginx/load balancer | Validate `/socket.io/` upgrade, origin policy, idle timeout, selected transport, and sticky-session setting in on-prem QA. |
| Electron scoped Socket.IO transport needs on-prem QA runtime/proxy validation | High | Open | Raw backend gateway smoke passed, but Phase 4 uses existing `ws` dependency with scoped Socket.IO/Engine.IO framing, not `socket.io-client` | Run packaged backend/player integration smoke through on-prem QA proxy and decide whether to replace with `socket.io-client` before production. |
| Desired state missing tenant/org scope if required | High | Open | Phase 2 desired-state table is keyed by `screen_id`; no tenant/org column added | Confirm tenancy before multi-tenant QA/prod rollout. |
| Local `db:push` shows unrelated drift statements | Medium | Open | Phase 2 local push included existing Drizzle default/index drift statements | Use reviewed additive migration for QA/prod, not local push output. |
| CMS lint needs Node 20 rerun | Medium | Open | `npm run lint` now passes locally under Node `v24.12.0`; Node 20 is not available in this workspace | Rerun CMS lint/build under Node `>=20 <21` before on-prem QA signoff. |
| Phase 5 UI lacks browser/E2E verification | Medium | Open | CMS production build passed, but no browser visual smoke or E2E was run for the new Delivery tab | Run screen details Delivery tab visual review and E2E smoke before on-prem QA signoff. |
| CMS dependency audit findings | Medium | Open | `npm ci` in `darshan-cms` reported 18 vulnerabilities | Triage in dependency hardening work; do not conflate with Phase 5 code behavior. |
| Media/cache report retention undefined | High | Open | Phase 6 adds durable `media_cache_reports` without TTL, partitioning, or archival | Define retention/partitioning before production; validate on QA-like failure volume. |
| Media/cache failure alert thresholds unproven | Medium | Open | Phase 8 continuation added metrics and alert rules; no QA media/cache failure traffic has tuned thresholds | Validate during on-prem QA chaos/media-failure tests. |
| CMS media/cache failure card lacks visual/E2E verification | Medium | Open | CMS build passed, but no browser smoke was run for the new card | Run screen details Delivery tab visual/E2E smoke with seeded failure rows. |
| Phase 7 static hardening is not runtime QA validation | High | Open | Phase 7 adds env/proxy/runbook/static validation assets only | Run actual on-prem QA proxy smoke, canary rollback drill, and backend/player realtime smoke before production enablement. |
| Valkey-backed fanout implementation and validation | High | Implemented locally, open for on-prem | Local code and Docker Valkey Pub/Sub smoke passed; no on-prem multi-node evidence exists | Validate node A/node B delivery and fallback in on-prem QA. |
| Valkey availability and HA topology | High | Open | On-prem Valkey mode, TLS/auth, namespace, memory policy, and HA topology are not yet provided | Provide `VALKEY_URL`, mode, TLS/auth, namespace, HA topology, and failure-drill approval. |
| Air-gapped deployments cannot assume public push | Medium | Open | Fully air-gapped networks cannot rely on public FCM/APNs/cloud push | Treat mobile push as optional; use foreground/kiosk WebSocket plus REST/polling fallback unless a private push/MDM mechanism is approved. |
| On-prem DNS/TLS/internal CA not validated for Electron | High | Open | Player/proxy runtime smoke has not run against internal DNS and certificates | Validate Electron trust chain, internal CA install path, websocket upgrade, and media endpoint certificates. |
| Valkey Pub/Sub is non-durable | Medium | Open | Pub/Sub cannot be sole delivery mechanism | Keep `command_outbox`, `device_commands`, desired state, REST fetch, polling, and heartbeat fallback mandatory. |
| Valkey outage fallback unproven | High | Open | No QA fanout outage drill has run | Stop Valkey in on-prem QA and verify schedule/default/emergency delivery still occurs through polling/heartbeat. |
| Multi-node node A/node B fanout unproven | High | Open | No active multi-node on-prem QA target is available | Connect player to node A, create command on node B, verify Valkey wake on node A, REST fetch, and ACK. |
| Air-gapped artifact supply chain | High | Open | Production cannot pull packages/images from public internet | Mirror or pre-bundle Node packages, Docker images, Electron/player artifacts, and observability images. |
| Node 20 runtime inside air-gapped environment | Medium | Open | Local validation used Node `v24.12.0`; target is `>=20 <21` | Provide Node 20 runtime in on-prem dev/QA/prod and rerun builds/tests. |
| On-prem object storage/media endpoint behavior | High | Open | Media/cache/runtime evidence has not validated MinIO/internal S3/file-server URLs | Validate internal signed URL behavior, cache headers, range requests, TLS, and player cache fallback. |
| Phase 8 real load/chaos execution missing | High | Open | Phase 8 added load model and chaos plan, but no on-prem QA target was available for execution | Execute 1k/10k/50k load profiles and chaos suite before production readiness. |
| Production readiness not approved | Critical | Open | `realtime-sync-production-readiness-checklist.md` state is `NOT_PRODUCTION_READY`; runtime evidence attempt is blocked by missing on-prem QA target | Do not start production canary or Phase 9 mobile adapters without accepted Phase 8 runtime evidence or explicit human deferral. |
| On-prem QA runtime evidence unavailable | Critical | Open | Packaged QA server health check reports `postgres` not running; localhost backend/socket checks cannot connect; 2026-06-16 ghost-pairing evidence attempt found all required `ONPREM_*` QA inputs missing | Provide on-prem QA endpoints, Valkey topology, simulator credentials, and approved load/chaos window. |
| Ghost pairing CMS operator visibility needs runtime QA | High | Implemented locally, open for on-prem | GP-3 added CMS Pairing Health orphan visibility, admin revoke, backend revoke API, and disabled reclaim guidance; no browser/on-prem orphan runtime evidence exists yet | Validate orphan visibility and revoke on an on-prem QA player/backend/CMS deployment. |
| Ghost pairing clean reinstall/reset needs packaged QA smoke | High | Implemented locally, open for on-prem | GP-4 added pairing-status, reset dry-run/cache policy, and clean reinstall runbooks; no packaged Ubuntu player reset smoke has run yet | Run packaged player `--pairing-status`, `reset-pairing --dry-run`, reset, CMS revoke, and re-pair flow on on-prem QA hardware. |
| Ghost pairing duplicate identity detection needs on-prem runtime QA | High | Implemented locally, open for on-prem | GP-5 added install/runtime session metadata, backend session lease conflict detection, and CMS Pairing Health duplicate conflict visibility; no two-player/cloned runtime smoke has run yet | Run two packaged players or cloned app-data simulator against on-prem QA and verify warning-mode conflict, CMS visibility, revoke, reset, and conflict resolution. |
| Ghost pairing browser/on-prem runtime evidence missing | High | Open | GP-6 created the E2E/permutation matrix and targeted local automated evidence; 2026-06-16 evidence attempt was BLOCKED_BY_ENV because the required on-prem QA URLs, media/Valkey/Prometheus inputs, simulator credentials, and Node 20 runtime were unavailable | Execute `docs/runbooks/ghost-pairing-onprem-qa-checklist.md` and attach evidence before production approval. |
| Ghost pairing reporting assertion previously failing | Medium | Closed 2026-06-16 | `darshan-server/src/routes/screens.test.ts` now passes; `/api/v1/metrics/overview` `active_screens_now` counts active published direct/group schedule targets plus heartbeat/current-schedule fallback | Keep route/reporting regression suite green. |
| Ghost pairing backend-first rollout required | High | Open | Player validation depends on backend `/api/v1/device/:deviceId/pairing-status`; old backend must not cause player identity wipe | Deploy backend first, validate endpoint, then deploy GP-2 player validation and monitor stale/recovery events. |
| CONFIG_ARCHITECTURE_PENDING | High | Backend mitigated by CONFIG-1; player mitigated by CONFIG-2/CONFIG-2.1; open for CMS/runtime evidence | CONFIG-1 added optional backend JSON config loading with env overrides and redacted diagnostics. CONFIG-2 added optional player-specific JSON site config loading, environment/deployment headers, and redacted player diagnostics while preserving runtime config behavior. CONFIG-2.1 redacts credentialed URL userinfo, query strings, and fragments from player diagnostics. CMS runtime config loader remains pending. | Implement CMS runtime config alignment in CONFIG-3. Keep secrets in env/secrets files and existing env compatibility during migration. |
| CONFIG_RUNTIME_VALIDATION_PENDING | High | Open | Local listeners were discovered on expected ports, but health checks to `192.168.0.5` and localhost backend failed during CONFIG-0; no runtime config evidence was claimed. | Provide valid on-prem QA endpoints and Node 20 runtime, then rerun browser/on-prem evidence using a recorded config profile. |

Latest Phase 1 handoff: `docs/implementation/realtime-sync-phase-1-handoff.md`.
Latest Phase 2 handoff: `docs/implementation/realtime-sync-phase-2-handoff.md`.
Latest Phase 3 handoff: `docs/implementation/realtime-sync-phase-3-handoff.md`.
Latest Phase 4 handoff: `docs/implementation/realtime-sync-phase-4-handoff.md`.
Latest Phase 5 handoff: `docs/implementation/realtime-sync-phase-5-handoff.md`.
Latest Phase 6 handoff: `docs/implementation/realtime-sync-phase-6-handoff.md`.
Latest Phase 7 handoff: `docs/implementation/realtime-sync-phase-7-handoff.md`.
Latest Phase 8 handoff: `docs/implementation/realtime-sync-phase-8-handoff.md`.
Latest Phase 8 runtime evidence attempt: `docs/implementation/realtime-sync-phase-8-runtime-evidence.md`.

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
| Load/chaos/readiness plan missing | Closed at tooling/docs level by Phase 8 load model, load/chaos plan, production readiness checklist, on-prem QA canary evidence template, metrics/alert validation, static validator, and handoff; real runtime evidence remains open. |
| Dedicated realtime/outbox/media-cache metrics missing | Closed at local/static validation level by Phase 8 metrics additions in `darshan-server/src/observability/metrics.ts`, Prometheus rules, and passing `metrics.test.ts` plus `validate-observability-assets.sh`. |
| Valkey fanout implementation missing | Closed at local implementation level by `realtime-bus.ts`, `device-node-registry.ts`, `realtime-fanout.ts`, gateway/outbox wiring, metrics, and passing local Valkey Pub/Sub integration smoke. On-prem runtime evidence remains open. |
| CMS lint has pre-existing failures | Closed locally by fixing lint issues in `LiveScreenMirror.tsx`, `EmergencyTakeoverModal.tsx`, and `tests/settings-default-media.e2e.spec.ts`; `npm run lint` exits 0 under Node `v24.12.0`. Node 20 rerun remains open. |
