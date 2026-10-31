# Implemented Business Rule Reconciliation — Part 1

Date: 2026-10-21  
Application-source baseline: `release-01` at
`db137152cdb8eda7ecf1f836df33e0373b9fc278`  
Scope: all 16 implemented Access/Content rules and all 14 implemented
Scheduling/Device rules in `01_BUSINESS_RULES.md` (30 rules total).  
Method: static, read-only comparison against current tracked source. No
application, service or test process was run.

## Meaning Of Catalogue Action

- `KEPT_CURRENT`: the existing rule description accurately characterized the
  current source at this baseline.
- `CORRECTED_STALE`: the catalogue contained an outdated, overbroad or
  ambiguous statement; the rule row was rewritten to match current source.

These actions assess the accuracy of the **implemented-behavior catalogue**.
They do not assert that the implementation satisfies a confirmed business rule
and they do not make any QA test Pass.

## Result

| Catalogue action | Count | Rule IDs |
| --- | ---: | --- |
| `KEPT_CURRENT` | 25 | BR-006, BR-009..020, BR-021, BR-023..024, BR-026..034 |
| `CORRECTED_STALE` | 5 | BR-007, BR-008, BR-022, BR-025, BR-072 |
| **Total reviewed** | **30** | Every row in the two scoped implemented-rule sections |

Two corrected descriptions intentionally retain known implementation conflicts:
BR-007 conflicts with confirmed BR-070 for a custom role holding global
`manage User`, and BR-008 conflicts with confirmed BR-091 because the primary
Users/Operators list can include inactive same-department accounts. BR-022 and
BR-025 were stale descriptions of gaps that current source has closed. BR-072
now distinguishes dated developer evidence from independent QA acceptance.

## Rule-By-Rule Comparison

| Rule | Current source finding | Catalogue action | Evidence and QA carry-forward |
| --- | --- | --- | --- |
| BR-006 | Four built-in roles coexist with effective CASL grants and additional resource/target policy. | `KEPT_CURRENT` | `darshan-server/src/rbac/system-roles.ts::SYSTEM_ROLE_NAMES`; `darshan-server/src/rbac/index.ts::defineAbilityFor`; `darshan-server/src/rbac/policy.ts`. Test UI and direct API decisions separately. |
| BR-007 | Effective User grants do not replace protected built-in-role hierarchy. SUPER_ADMIN can target all roles; global managers can cross departments for OPERATOR/custom-role accounts but a custom-role holder cannot target protected SUPER_ADMIN/ADMIN/DEPARTMENT accounts. | `CORRECTED_STALE` | `darshan-server/src/routes/users.ts`; `darshan-server/src/routes/users-invite.ts`; `darshan-server/src/rbac/policy.ts::canManageUserRoleTarget`, `canManageUserRecord`; last-admin invariant in `darshan-server/src/auth/super-admin-invariant.ts`. Preserve the BR-070 conflict. |
| BR-008 | Content ownership is centralized, while directory filtering is not uniformly active-only: tombstones/cross-department rows are filtered, but the primary list requires an explicit `is_active=true` query to exclude inactive accounts. | `CORRECTED_STALE` | `darshan-server/src/rbac/content-ownership.ts`; `darshan-server/src/db/repositories/user.ts::list`, `listInvites`; `darshan-server/src/routes/users.ts`; `darshan-cms/src/pages/Operators.tsx`. Preserve the BR-091 conflict. |
| BR-009 | Ability resolution follows grants, inheritance and record conditions; the static feature-surface guard allows only the documented role-name exceptions. | `KEPT_CURRENT` | `darshan-server/src/rbac/index.ts`; `darshan-server/src/rbac/authorization-role-gates.unit.test.ts`; `darshan-server/src/rbac/policy.ts`. Existing test-file presence is evidence of intent, not an execution result. |
| BR-010 | Token verification joins the stored session and active non-deleted user; relevant user/password/role mutations revoke sessions and broadcast invalidation, while protected socket actions reverify. | `KEPT_CURRENT` | `darshan-server/src/auth/jwt.ts::verifyAccessToken`; user/invite/role routes; `darshan-server/src/realtime/session-invalidation.ts`; `darshan-server/src/realtime/socket-session.ts`. Cross-node timing/races remain runtime cases. |
| BR-011 | Login throttle identity is the normalized email plus request IP. The store can report unavailable and the route denies login when fail-closed configuration is enabled. | `KEPT_CURRENT` | `darshan-server/src/routes/auth.ts`; `darshan-server/src/auth/login-throttle.ts`. QA must test the configured Valkey/fail-closed profile, not assume all profiles behave alike. |
| BR-012 | Password entry paths use configured strength validation and Argon2id; invites expire and activation clears token metadata; recovery is a separate CLI/deployment path. | `KEPT_CURRENT` | `darshan-server/src/auth/password.ts`; `darshan-server/src/schemas/user.ts`; `darshan-server/src/routes/users-invite.ts`; `darshan-server/src/routes/users-activate.ts`; `darshan-server/src/deployment/admin-recovery.ts`. |
| BR-013 | The server accepts 13 explicit MIME types: JPEG/PNG/WebP, MP4/QuickTime, PDF, legacy/current PowerPoint, CSV, legacy/current Word and legacy/current Excel. Size validation uses configured MiB; production fixes it at 500. | `KEPT_CURRENT` | `darshan-server/src/schemas/media.ts::allowedContentTypes`, `createUploadSessionSchema`; `scripts/bundle/production-bundle-config.mjs`. Proxy/object-store limits still need environment verification. |
| BR-014 | Upload sessions are actor/idempotency-key scoped, choose single or multipart flow, verify authoritative size and SHA-256, promote staged bytes, and retain explicit session states. | `KEPT_CURRENT` | `darshan-server/src/routes/media.ts`; `darshan-server/src/db/repositories/media-upload-session.ts`; `darshan-cms/src/lib/mediaUploadFlow.ts`. Exercise resume, duplicate and interrupted finalization later. |
| BR-015 | Delete checks ability, stable ownership and usage references. Soft delete retains a FAILED metadata row with object references cleared; hard delete removes the row; both attempt storage cleanup. | `KEPT_CURRENT` | `darshan-server/src/routes/media.ts` delete handler; `darshan-server/src/db/repositories/media.ts::getUsageSummary`. This is not a source-proven restore feature. |
| BR-016 | Upload completion does not imply READY for video/document/webpage media; bounded worker jobs perform transcode/thumbnail, document conversion or webpage capture and record failure states. | `KEPT_CURRENT` | `darshan-server/src/routes/media.ts`; `darshan-server/src/jobs/index.ts`; `darshan-server/src/utils/media-processing.ts`. Worker/object-store recovery remains executable QA. |
| BR-017 | PDF playback defaults a missing occurrence page to 1, validates the requested 1-based page against decoded `numPages`, fits it, caps aggregate raster pixels and emits explicit failure information without auto-progression. | `KEPT_CURRENT` | `darshan-player/src/renderer/player.ts::renderPDF`; `darshan-player/src/renderer/pdf-playback.ts::PdfPlaybackController`. Physical rendering remains unproven here. |
| BR-018 | Current webpage implementation reflects confirmed BR-097..100: policy-controlled HTTP/HTTPS, unsupported login mechanisms, per-hop validation and revisioned latest-preview fallback. | `KEPT_CURRENT` | Server/player webpage policy and capture/view managers; `qa-artifacts/evidence/webpage-default-priority-review.md`. The row remains a compatibility cross-reference, not a competing requirement. |
| BR-019 | Layout API enforces a nonempty slot collection, unique IDs, normalized coordinate/size bounds and optional-field types; read/mutation also uses ownership policy. | `KEPT_CURRENT` | `darshan-server/src/routes/layouts.ts::validateLayoutSpec`; `darshan-cms/src/pages/LayoutEditor.tsx`; `darshan-server/src/rbac/content-ownership.ts`. |
| BR-020 | Presentation occurrence/slot models retain order, optional positive duration, fit/audio/loop properties and player repeat/resume policy, including single-item final-frame behavior. | `KEPT_CURRENT` | `darshan-server/src/routes/presentations.ts`; `darshan-player/src/common/playback-policy.ts`; player renderer lifecycle. Exact media timing is a runtime case. |
| BR-072 | Presentation list/detail/mutation/item/slot paths now combine ability, stable ownership and nested-resource checks. Dated developer API/browser evidence exists; independent QA acceptance remains open. | `CORRECTED_STALE` | `darshan-server/src/routes/presentations.ts`; `darshan-server/src/rbac/content-ownership.ts`; `qa-artifacts/evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md`. |
| BR-021 | Request submission acquires HELD reservations with expiry/token/revision; approval rejects expired/stale holds and promotes them to RESERVED; active reservations block incompatible schedule edits. | `KEPT_CURRENT` | `darshan-server/src/services/scheduling/reservation-service.ts`; `darshan-server/src/routes/schedule-requests.ts`. Concurrency needs database execution. |
| BR-022 | Approval/publish is action-permission based, not an admin-name gate. Publish creates snapshot/publish/reservation state transactionally, rejects conflicts, and returns the existing publish for a valid retry. Self-approval is not prohibited. | `CORRECTED_STALE` | `darshan-server/src/routes/schedule-requests.ts::withRequestMutationAuthorization`; `darshan-server/src/routes/schedules.ts::authorizeScheduleMutation`; `darshan-server/src/routes/schedule-publish-helper.ts`; reservation service. Aligns with BR-057/093. |
| BR-023 | Reject/cancel/takedown release or transition reservations/publishes and dispatch playback refresh; TAKEN_DOWN retains stored history. | `KEPT_CURRENT` | `darshan-server/src/services/scheduling/reservation-service.ts`; schedule/request routes; `darshan-server/src/services/playback-refresh-dispatch.ts`. Verify player removal timing later. |
| BR-024 | Emergency trigger requires exactly one target scope, READY/readable media where used, idempotency, deterministic severity/scope/time/ID winner ordering and durable transition reconciliation. | `KEPT_CURRENT` | `darshan-server/src/routes/emergency.ts`; `darshan-server/src/screens/playback.ts`; `darshan-server/src/db/repositories/emergency.ts`; `darshan-server/src/services/emergency-transition-outbox.ts`. |
| BR-025 | Both CMS entry points permit global managers or screen-update delegates. Delegates may act only on direct screens they can update; group/global control requires global Emergency management, and status/history/clear reuse the boundary. | `CORRECTED_STALE` | `darshan-server/src/rbac/emergency-authorization.ts`; `darshan-server/src/routes/emergency.ts`; `darshan-cms/src/pages/ScheduleQueue.tsx`; `darshan-cms/src/components/requests/EmergencyTakeoverModal.tsx`. Aligns with BR-068/095. |
| BR-026 | Default resolution remains direct Screen, then competing Group by priority descending/target ID ascending, then aspect ratio, global and none. Omitted group priority is preserved during update. | `KEPT_CURRENT` | `darshan-server/src/utils/default-media.ts`; `darshan-server/src/routes/settings.ts`; CMS default-media settings. This row cross-references confirmed BR-101. |
| BR-027 | Startup distinguishes absent/partial/stale identity, confirmed pairing, recoverable transport loss and explicit revocation; destructive recovery clears identity-bound content rather than treating every outage alike. | `KEPT_CURRENT` | `darshan-player/src/main/services/player-flow.ts`; `darshan-player/src/main/services/pairing-service.ts`; `darshan-server/src/routes/device-pairing.ts`. Offline/revocation timing needs target execution. |
| BR-028 | Device REST and socket paths support signed identity; production legacy compatibility is bounded. Socket nonce/replay/clock checks are distinct from REST signature checks and transport TLS trust. | `KEPT_CURRENT` | `darshan-server/src/utils/device-request-auth.ts`; `darshan-server/src/middleware/device-auth.ts`; `darshan-server/src/realtime/device-socket-auth.ts`; player certificate/transport services. |
| BR-029 | Commands persist priority, expiry, attempts, lease and delivery token plus history/ACK state; player polling/retry/seen-command handling remains alongside realtime wake-up. | `KEPT_CURRENT` | `darshan-server/src/services/command-lifecycle-service.ts`; `darshan-server/src/services/command-outbox-service.ts`; `darshan-player/src/main/services/command-processor.ts`. Replay/lease races remain runtime tests. |
| BR-030 | Snapshot refresh uses representation caching and generation cancellation. A confirmed 404 clears scheduled content; transient failure may build from a cached snapshot. | `KEPT_CURRENT` | `darshan-player/src/main/services/snapshot-manager.ts::refreshSnapshot`, `buildPlaylist`. Test stale response ordering and authority changes on a player. |
| BR-031 | Development/standard configuration can favor availability, while production bundle/examples select secure playback. Secure effective deadline is the 120-second authenticated-success lease; legacy grace fields cannot extend it, and lock suppresses authorities and purges configured media cache only. | `KEPT_CURRENT` | `darshan-player/src/common/offline-security-policy.ts`; `darshan-player/src/main/services/player-flow.ts`; bundle configuration; secure-lock implementation note. Exact boundary/purge remains executable QA. |
| BR-032 | QA and production runtime policies are fullscreen/kiosk, frameless/noninteractive with hidden cursor; development is not locked. | `KEPT_CURRENT` | `darshan-player/src/main/runtime-mode.ts::getRuntimeWindowPolicy`; `darshan-player/src/main/index.ts`. Native OS observation is still required. |
| BR-033 | Electron display inventory drives output dimensions/orientation and preferred-output selection; missing, duplicate and Wayland cases fall back/report state and backend state is revisioned. | `KEPT_CURRENT` | `darshan-player/src/common/display-profile.ts`; `darshan-player/src/main/services/display-manager.ts`; `darshan-server/src/services/screen-display-state-service.ts`. Multi-display hardware remains untested here. |
| BR-034 | PoP buffers at most 100 events/512 KiB in memory, spools at most 32 files and 50 events/file, and derives a 2% disk budget clamped to 1–16 MiB. Budget enforcement drops oldest files and records loss; media purge excludes the PoP spool. | `KEPT_CURRENT` | `darshan-player/src/main/services/offline-replay-budgets.ts`; `darshan-player/src/main/services/pop-service.ts`; `darshan-player/src/main/services/media-cache-purge.ts`. This is bounded best effort, not confirmed loss tolerance. |

## Findings Carried To Later Steps

1. BR-007 and BR-008 must continue to point to confirmed-rule conflicts
   BR-070 and BR-091; an accurate implementation description must not replace
   the intended expected result.
2. BR-022 and BR-025 no longer describe current defects. Related cases should
   test the action/ownership and delegated-screen controls now present.
3. BR-072 has developer evidence only. Human QA Status must remain independent.
4. Runtime-sensitive claims in these rules—transactions, propagation, timing,
   player display, object storage, worker recovery and physical-device behavior—
   remain unproven by this static reconciliation.
