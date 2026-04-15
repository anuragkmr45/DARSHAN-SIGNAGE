# QA Regression Tracker

This tracker is the system of record for defects found during phased feature discovery and regression execution.

## Usage Rules

- Create one row per confirmed defect.
- Allocate bug IDs sequentially as `REG-0001`, `REG-0002`, and so on. Do not reserve IDs in advance.
- `Feature IDs Affected` must reference canonical IDs from `FEATURE_INVENTORY.md`.
- `Evidence` should point to concrete artifacts such as source files, tests, screenshots, logs, manifests, console output, or captured payloads.
- Phase 5 work is robustness-only: it may fix only defects already logged in this file.

## Bug Flow

`new` -> `triaged` -> `in-progress` -> `fixed-pending-qa` -> `verified`

Alternate states:

- `blocked` for dependencies or environment issues that prevent progress
- `deferred` for accepted backlog items that will not be fixed in the current regression wave

## Locked Vocabulary

### Severity

| Value | Meaning |
| --- | --- |
| `blocker` | Testing cannot proceed or release should stop. |
| `critical` | High business or operational risk with no acceptable workaround. |
| `major` | Significant functional break or degraded workflow with partial workaround. |
| `minor` | Narrow issue, cosmetic defect, or low-impact behavioral gap. |

### Layer

| Value | Meaning |
| --- | --- |
| `cms` | React CMS or browser-only client behavior. |
| `backend` | Fastify API, services, or server-side orchestration. |
| `player` | Electron player runtime, preload, or local device services. |
| `db` | Schema, migrations, persistence rules, or data correctness. |
| `deploy` | Environment assembly, manifests, packaging, or runtime deployment assets. |
| `cross-cutting` | More than one layer is materially involved. |

### Risk Type

| Value | Meaning |
| --- | --- |
| `functional` | Wrong behavior, broken workflow, or missing result. |
| `data-integrity` | Corrupted, lost, duplicated, or stale data. |
| `security` | Auth, authz, secret handling, or trust-boundary risk. |
| `performance` | Slow path, unstable latency, or resource overuse. |
| `availability` | Outage, startup failure, unrecoverable runtime issue, or health degradation. |
| `usability` | Misleading UX, inaccessible state, or avoidable operator error. |
| `observability` | Missing, misleading, or unusable diagnostics/monitoring evidence. |

### Fix Scope

| Value | Meaning |
| --- | --- |
| `cms` | React CMS only. |
| `backend` | Fastify/backend only. |
| `player` | Electron player only. |
| `db` | Schema or persistence layer only. |
| `deploy` | Deployment/manifests/scripts only. |
| `cross-repo` | Changes span multiple repos or runtime surfaces. |
| `docs-only` | Documentation/runbook/test-plan clarification only. |

### Status

| Value | Meaning |
| --- | --- |
| `new` | Defect captured and awaiting triage. |
| `triaged` | Severity, layer, risk, and scope agreed. |
| `in-progress` | A fix is being implemented. |
| `blocked` | Work cannot proceed due to dependency or environment blocker. |
| `fixed-pending-qa` | Candidate fix exists and needs regression verification. |
| `verified` | QA has reproduced the fix and closed the defect. |
| `deferred` | Explicitly postponed beyond the current wave. |

## Main Tracker

| Bug ID | Title | Phase Found | Feature IDs Affected | Severity | Layer | Repro Steps | Expected | Actual | Evidence | Risk Type | Fix Scope | Owner | Status | Commit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `REG-0001` | Sensitive authenticated CMS routes lack per-module route guards | `Phase 1 - Access/Admin` | `CMS-001`, `CMS-041`, `CMS-042`, `CMS-043`, `CMS-044` | `major` | `cms` | 1. Sign in with an authenticated user who lacks admin or reporting modules. 2. Navigate directly to `/proof-of-play`, `/api-keys`, `/webhooks`, or `/sso-config`. 3. Observe that the page renders instead of being blocked by route authz. | Sensitive or module-scoped CMS routes should redirect or deny access before rendering when the user lacks the required module permission. | These routes sit inside the authenticated shell without `moduleKey`, `allowRoles`, or explicit permission guards, so route-level authz is skipped after login. | `signhex-nexus-core/src/App.tsx:AuthenticatedAppShell`; `signhex-nexus-core/src/components/auth/ProtectedRoute.tsx:ProtectedRoute`; `signhex-nexus-core/src/lib/access.ts:canAccessModule` | `security` | `cms` |  | `new` |  | Revalidated during `RG-4` on `2026-04-15` against the current authenticated route tree. This finding is specific to missing frontend route guards. Backend permission enforcement was not re-verified in this pass. |
| `REG-0002` | Global header search input is rendered but has no behavior | `Phase 1 - Access/Admin` | `CMS-004` | `minor` | `cms` | 1. Open any authenticated CMS page. 2. Type into the header search input and press Enter. 3. Observe that no filtering, navigation, or search request occurs. | A visible global search affordance should trigger a search workflow, navigate to results, or clearly indicate that search is unavailable. | `AppHeader` renders an `Input` with placeholder text only; no state, submit handler, routing, or search side effect is attached. | `signhex-nexus-core/src/components/layout/AppHeader.tsx:AppHeader` | `usability` | `cms` |  | `new` |  | Revalidated during `RG-4` on `2026-04-15` against the current shell header. The control is prominent and looks fully interactive. |
| `REG-0003` | Webhooks admin page is a local-state prototype instead of a persisted webhook UI | `Phase 4 - Communications/Reporting/Ops` | `CMS-043`, `PH4-WEBH-008` | `major` | `cms` | 1. Open `/webhooks`. 2. Create, test, retry, or delete a webhook. 3. Reload the page. | Webhook changes should load from and persist through the webhook API, and delivery history should reflect backend state. | The page seeds `webhooks` and `deliveryLogs` from local component state, mutates them in memory, simulates retries with `setTimeout`, and never calls `webhooksApi`. Changes disappear on reload. | `signhex-nexus-core/src/pages/Webhooks.tsx:Webhooks`; `signhex-nexus-core/src/api/domains/webhooks.ts:webhooksApi` | `functional` | `cms` |  | `new` |  | The repo already contains a webhook API domain client that the current page does not use. Revalidated during `RG-7` on `2026-04-15`; the page still seeds hard-coded rows, mutates local arrays only, and never reaches the checked-in webhook client. |
| `REG-0004` | SSO configuration page simulates save and test instead of using the SSO API | `Phase 4 - Communications/Reporting/Ops` | `CMS-044`, `PH4-SSO-009` | `major` | `cms` | 1. Open `/sso-config`. 2. Enter provider values. 3. Click `Test Connection` or `Save Configuration`. 4. Reload the page. | SSO settings should load, persist, and deactivate through the SSO API, and connection tests should exercise a real backend path. | The page keeps all configuration in local state, uses `setTimeout` to fake a successful connection test, and does not call `ssoApi`; all changes reset on reload. | `signhex-nexus-core/src/pages/SsoConfig.tsx:SsoConfig`; `signhex-nexus-core/src/api/domains/ssoConfig.ts:ssoApi` | `functional` | `cms` |  | `new` |  | The page currently behaves like a prototype while the repo already contains an SSO API client. Revalidated during `RG-7` on `2026-04-15`; the route still simulates both save and connection test entirely in component state. |
| `REG-0005` | API key list response envelope does not match the live CMS admin page contract | `Phase 4 - Communications/Reporting/Ops` | `CMS-042`, `BE-033`, `PH4-APIK-007` | `major` | `cross-cutting` | 1. Sign in to the CMS and open `/api-keys`. 2. The page calls `apiKeysApi.list()` and treats the result as `ApiKey[]`. 3. The backend returns `{ items, total, page, limit }` from `GET /api/v1/api-keys`. 4. The page then reads `.length` and `.map` on that object. | The backend list contract and the checked-in CMS domain client/page should agree on a paginated envelope or a raw array so the table renders reliably. | The CMS client is typed as `ApiKey[]`, but the backend returns a paginated object. The current page memoizes that object as an array and will mis-handle or crash when it tries to iterate it. | `signhex-server/src/routes/api-keys.ts:apiKeyRoutes`; `signhex-server/src/db/repositories/api-key.ts:ApiKeyRepository`; `signhex-nexus-core/src/api/domains/apiKeys.ts:apiKeysApi`; `signhex-nexus-core/src/pages/ApiKeys.tsx:ApiKeys` | `functional` | `cross-repo` |  | `new` |  | This is a concrete request/response contract mismatch, not a missing UI implementation. Revalidated during `RG-7` on `2026-04-15`; a focused backend regression test confirmed the list route still returns the paginated envelope while the current CMS page/client still expect a raw array. |
| `REG-0006` | Default-media settings read endpoints are publicly readable without authentication | `Phase 2 - Content/Scheduling` | `CMS-031`, `BE-015`, `PH2-DFMED-009` | `major` | `backend` | 1. Send unauthenticated `GET` requests to `/api/v1/settings/default-media`, `/api/v1/settings/default-media/variants`, or `/api/v1/settings/default-media/targets`. 2. Observe that the routes return current fallback-media data instead of `401` or `403`. | Settings-scoped default-media reads should require authenticated org-settings access, or callers should be redirected to the device-scoped fallback endpoints that already enforce device or user auth. | The three settings read routes are mounted without any auth precondition. They can return resolved media metadata and target-assignment data to an anonymous caller. | `signhex-server/src/routes/settings.ts:settingsRoutes`; `signhex-server/src/utils/default-media.ts`; `signhex-server/src/routes/device-telemetry.ts:deviceTelemetryRoutes`; `signhex-server/src/routes/settings-default-media-auth.test.ts` | `security` | `backend` |  | `new` |  | Revalidated during `RG-5` on `2026-04-15` with a focused regression test that expects `401` for the three settings read endpoints and currently receives `200`. The backend already has authenticated device-specific fallback routes, so the unauthenticated settings reads appear to be an authz gap rather than an intentional public API. |
| `REG-0007` | Webhook test endpoint reports success without attempting any outbound delivery | `Phase 4 - Communications/Reporting/Ops` | `CMS-043`, `BE-034`, `PH4-WEBH-008` | `major` | `backend` | 1. Create a webhook through `POST /api/v1/webhooks`. 2. Call `POST /api/v1/webhooks/:id/test`. 3. Watch for outbound traffic, delivery logs, or state changes. | A webhook test should perform a real delivery attempt, or explicitly fail with an unsupported/not-implemented result so operators are not told the target was tested successfully. | The route only loads the stored row and returns `{ success: true, attempted: target_url }`. It does not enqueue, dispatch, sign, or record any delivery attempt. | `signhex-server/src/routes/webhooks.ts:webhookRoutes`; `signhex-server/src/db/repositories/webhook.ts:WebhookRepository`; `signhex-server/src/routes/admin-ops-contracts.test.ts` | `functional` | `backend` |  | `new` |  | The current CMS page is still a prototype, but the backend route itself already claims to be a delivery test surface. Revalidated during `RG-7` on `2026-04-15` with focused lifecycle coverage that confirmed the test route returns success without changing webhook delivery status or attempting outbound work. |
| `REG-0008` | Scheduled transition durations are emitted but not applied in the active renderer playback path | `Phase 3 - Fleet/Player Runtime` | `PL-021`, `PL-024`, `PH3-PLAY-008`, `INT-002`, `INT-003` | `minor` | `player` | 1. Publish or load a scheduled playlist with at least two items and non-zero `transitionDurationMs`. 2. Let the active item advance to the next one. 3. Observe the renderer behavior at the switch point. | A configured scheduled transition should animate opacity or an equivalent visual transition for the requested duration in the active renderer path. | The scheduler and playback engine emit `transition-start` with a duration, and the renderer stores that duration, but `showElement()` and the scene-slot renderer only toggle opacity and delayed removal. They never set `style.transition` on scheduled elements, so the switch is effectively abrupt. | `signage-screen/src/main/services/playback/timeline-scheduler.ts:scheduleNext`; `signage-screen/src/main/services/playback/playback-engine.ts:handleTransitionStart`; `signage-screen/src/renderer/player.ts:startTransition`; `signage-screen/src/renderer/player.ts:showElement`; `signage-screen/src/main/services/playback/transition-manager.ts:TransitionManager` | `functional` | `player` |  | `new` |  | A standalone `TransitionManager` exists and is tested, but the active renderer playback path does not call it. Revalidated during `RG-6` on `2026-04-15` by tracing the active renderer path: `startTransition()` stores the pending duration, but `showElement()` still flips opacity without assigning any CSS transition. Revalidated again during the integrated workflow sweep on `2026-04-15` against the `INT-002` publish-activation path and the `INT-003` refresh fanout path; isolated publish and reservation backend reruns passed, so the remaining mismatch stays in the active renderer transition handling. |
| `REG-0009` | Command acknowledgement records delivery but drops the actual device execution outcome | `Phase 3 - Fleet/Player Runtime` | `INT-006`, `BE-023`, `PL-028`, `PH3-CMD-005` | `major` | `cross-cutting` | 1. Queue two non-refresh commands of the same type for a paired device within the player rate-limit window, such as two screenshot commands. 2. Let the player ingest both commands. 3. The second command is rate-limited locally and `acknowledgeCommand()` is still called with `success: false`. 4. Inspect the backend command row after the ack request. | Backend-visible command state should distinguish successful execution from rate-limited, skipped, or failed execution so operators and later automation can tell whether the side effect actually happened. | The player keeps a local `CommandResult`, but the ack request body only sends `delivery_token`. The backend ack route then updates the command row to `ACKNOWLEDGED` without any execution-result field, so a rate-limited or failed command becomes indistinguishable from a successful one once the lease is acked. | `signage-screen/src/main/services/command-processor.ts:processCommand`; `signage-screen/src/main/services/command-processor.ts:acknowledgeCommand`; `signhex-server/src/routes/device-telemetry.ts:deviceTelemetryRoutes`; `signhex-server/src/db/schema.ts:deviceCommands`; `signhex-server/src/routes/device-telemetry-commands.test.ts`; `signage-screen/test/unit/services/command-processor.test.ts` | `functional` | `cross-repo` |  | `new` |  | There is no first-class CMS command console today, but publish, screenshot, emergency, and default-media refresh flows all depend on this contract when command side effects are inferred from backend-visible state. Revalidated during `RG-6` on `2026-04-15` with a focused failing regression assertion that expects `acknowledgeCommand()` to include `success` and `error` details but currently sees only `delivery_token` in the outbound ack payload. Revalidated again during the integrated workflow sweep on `2026-04-15` by rerunning the targeted player command-processor coverage and confirming the same failing assertion while the isolated backend command route coverage still passed, which keeps the mismatch squarely in the cross-layer ack contract. |
| `REG-0010` | CMS user-management target rules are narrower than the backend RBAC contract | `Phase 1 - Access/Admin` | `PH1-RBAC-003`, `PH1-USER-004`, `PH1-INVITE-005`, `CMS-026`, `CMS-027`, `CMS-028`, `BE-003`, `BE-004` | `major` | `cross-cutting` | 1. Sign in as `SUPER_ADMIN` or `ADMIN`. 2. Open the CMS users, invite, or operators flows. 3. The CMS uses `canManageUserTarget()` to decide which role targets can be created or managed. 4. Compare that with the backend `canManageUserRoleTarget()` and `canManageUserRecord()` checks used by `/api/v1/users*` and `/api/v1/users/invite*`. | The CMS role-target ladder and the backend user-management RBAC policy should agree so the UI exposes every allowed management action and blocks every forbidden one. | The backend allows `SUPER_ADMIN` to manage `ADMIN` and `OPERATOR`, and allows `ADMIN` to manage `DEPARTMENT` and `OPERATOR`. The current CMS helper only allows `SUPER_ADMIN -> ADMIN` and `ADMIN -> DEPARTMENT`, so some backend-permitted user and invite actions are hidden or blocked in the UI. | `signhex-nexus-core/src/lib/access.ts:canManageUserTarget`; `signhex-nexus-core/src/lib/access.test.ts`; `signhex-server/src/rbac/policy.ts:canManageUserRoleTarget`; `signhex-server/src/rbac/policy.ts:canManageUserRecord`; `signhex-server/src/routes/users.ts:userRoutes`; `signhex-server/src/routes/users-invite.ts:userInviteRoutes` | `functional` | `cross-repo` |  | `new` |  | Confirmed during `RG-4` on `2026-04-15` by comparing the live frontend target filter with the backend route policy. This is a contract mismatch, not a missing API capability. |
| `REG-0011` | Generic requests admin route is wired into the CMS shell but renders no usable surface | `Phase 4 - Communications/Reporting/Ops` | `PH4-WREQ-001` | `major` | `cms` | 1. Sign in to the CMS. 2. Navigate to `/requests` from the shell route or direct URL. 3. Observe the main content area. | The generic requests surface should render a persisted requests workboard or clearly state that the feature is unavailable. | The page exports a placeholder component that returns `null`, while the earlier request-workboard implementation is fully commented out. The backend request routes remain live, but the CMS route renders no list, create flow, detail surface, or empty state. | `signhex-nexus-core/src/App.tsx:AuthenticatedAppShell`; `signhex-nexus-core/src/pages/Requests.tsx:Requests`; `signhex-server/src/routes/requests.ts:requestRoutes` | `functional` | `cms` |  | `new` |  | Confirmed during `RG-7` on `2026-04-15`. This is not a missing backend capability; the CMS route is present in the authenticated shell but intentionally renders nothing. |

## Robustness-Only Fixes

Phase 5 is reserved for stability, hardening, and regression-only fixes. A Phase 5 item is valid only if all of the following are true:

- the originating defect already exists in the `Main Tracker`
- the defect references one or more earlier feature IDs from Phases 1 through 4
- the fix does not expand product scope beyond the affected feature
- the post-fix validation is recorded by moving the tracker row to `fixed-pending-qa` and then `verified`
