# Confirmed Business Rule Reconciliation

Date: 2026-10-21  
Application-source baseline: `release-01` at
`db137152cdb8eda7ecf1f836df33e0373b9fc278`  
Method: static, read-only comparison of every rule in
`01_BUSINESS_RULES.md::Confirmed Business Rules` against the current tracked
source. No application or test process was run for this reconciliation.

## Meaning Of Status

- `SOURCE_ALIGNED`: current source contains the required control/flow. This is
  not runtime proof and does not make the QA case Pass.
- `PARTIAL_CONFLICT`: part of the confirmed behavior exists, but at least one
  current source path contradicts the expected result.
- `NOT_IMPLEMENTED`: the confirmed result is absent from the current source or
  current source explicitly implements a different result.

## Result

| Status | Count | Rule IDs |
| --- | ---: | --- |
| `SOURCE_ALIGNED` | 37 | BR-001..005, BR-051, BR-053..057, BR-067..069, BR-083..090, BR-092..101, BR-103..107 |
| `PARTIAL_CONFLICT` | 3 | BR-070, BR-071, BR-091 |
| `NOT_IMPLEMENTED` | 1 | BR-102 |
| **Total confirmed rules reviewed** | **41** | Every row in the confirmed-rule section |

Ranges above are only compact notation. The individual comparison below is the
auditable record.

## Rule-By-Rule Comparison

| Rule | Current source comparison | Status | Current evidence and QA meaning |
| --- | --- | --- | --- |
| BR-001 | PostgreSQL-backed commands, outbox, desired state and snapshots remain authoritative; realtime delivers wake-up/notification data and player polling/REST paths remain. | `SOURCE_ALIGNED` | `README.md::Architecture Guardrails`; `darshan-server/src/services/command-lifecycle-service.ts`; `darshan-server/src/services/command-outbox-service.ts`; `darshan-server/src/realtime/device-gateway.ts`; player snapshot/command services. Exercise realtime loss and REST recovery at runtime. |
| BR-002 | Device realtime rejects media-byte payload fields, while the player downloads/caches media outside the socket channel. | `SOURCE_ALIGNED` | `darshan-server/src/realtime/device-gateway.ts::assertNotificationPayloadAllowed`; `darshan-player/src/main/services/cache/cache-manager.ts`. Runtime payload/large-object rejection remains unexecuted in this reconciliation. |
| BR-003 | Reservation overlap uses half-open comparisons and expands group targets to concrete screens; the database exclusion supports active ownership. | `SOURCE_ALIGNED` | `darshan-server/src/services/scheduling/reservation-service.ts::isOverlap`; `darshan-server/drizzle/migrations/0021_schedule_reservations.sql`; `docs/contracts/scheduling-and-emergency-spec.md::Conflict rule`. Concurrency still needs QA execution. |
| BR-004 | Snapshot/playback resolution preserves emergency before schedule before default before NONE, with the secure lock able to suppress all playback authority. | `SOURCE_ALIGNED` | `darshan-server/src/screens/playback.ts`; `darshan-player/src/common/player-content-source.ts`; `darshan-player/src/main/services/snapshot-manager.ts`. Verify transition timing on a player. |
| BR-005 | PoP closes clean sessions but does not synthesize continuous playback across crash/power gaps. | `SOURCE_ALIGNED` | `darshan-player/src/main/services/pop-service.ts`; `docs/governance/data-and-runtime-state-governance.md`; `docs/architecture/player-pairing-identity.md`. Crash/power evidence remains a runtime case. |
| BR-051 | One occurrence carries one static 1-based document page; missing legacy selection resolves to page 1 and the renderer does not auto-progress. | `SOURCE_ALIGNED` | `darshan-server/src/utils/document-page-selection.ts`; `darshan-cms/src/components/schedule-creator/StepMediaAssign.tsx`; `darshan-player/src/renderer/pdf-playback.ts`. |
| BR-083 | CMS persists the video loop flag and the scheduled-video lifecycle sets native loop behavior while authority/session-generation cleanup enforces stop boundaries. | `SOURCE_ALIGNED` | `darshan-cms/src/components/schedule-creator/StepMediaAssign.tsx`; `darshan-player/src/common/playback-policy.ts::shouldRepeatScheduledItem`; `darshan-player/src/renderer/scheduled-video-lifecycle.ts`; `darshan-player/src/renderer/player.ts`. |
| BR-054 | API-key, SSO and webhook management surfaces exist; no SSO login callback, API-key request authenticator or automatic business-event webhook dispatcher is registered. Explicit webhook test delivery remains a real exposed action. | `SOURCE_ALIGNED` | `darshan-server/src/server/index.ts`; API-key/SSO/webhook routes and matching CMS pages. Test management persistence/authorization and webhook Test security, not excluded integrations. |
| BR-055 | General Requests route/page/client/repository source is absent and not registered; Schedule Requests remains registered. | `SOURCE_ALIGNED` | `darshan-server/src/server/index.ts`; `darshan-cms/src/AuthenticatedAppShell.tsx`; `darshan-server/src/deployment/requests-disabled.unit.test.ts`; static inventory shows zero `/api/v1/requests*` and ten `/api/v1/schedule-requests*` routes. Probe built artifacts later. |
| BR-053 | Secure policy calculates the 120-second authenticated-success lease, suppresses authorities and invokes media-only purge while preserving identity/evidence queues. | `SOURCE_ALIGNED` | `darshan-player/src/common/offline-security-policy.ts`; `darshan-player/src/main/services/secure-playback-guard.ts`; `darshan-player/src/main/services/player-flow.ts`; `darshan-player/src/main/services/media-cache-purge.ts`. Exact time/purge behavior still needs target execution. |
| BR-067 | User deactivation, demotion and tombstone paths share a transactionally locked last-active-SUPER_ADMIN check; recovery uses the same invariant. | `SOURCE_ALIGNED` | `darshan-server/src/auth/super-admin-invariant.ts::lockUserAndAssertSuperAdminSurvives`; `darshan-server/src/db/repositories/user.ts`; `darshan-server/src/deployment/admin-recovery.ts`. Concurrent removal needs DB execution. |
| BR-068 | Global `manage Emergency` permits all scopes; delegates are evaluated through conditional `update Screen` and are limited to authorized direct screens for trigger/status/clear. | `SOURCE_ALIGNED` | `darshan-server/src/rbac/emergency-authorization.ts`; `darshan-server/src/routes/emergency.ts`; `darshan-cms/src/pages/ScheduleQueue.tsx`; `darshan-cms/src/components/requests/EmergencyTakeoverModal.tsx`. |
| BR-069 | Ordinary reachability is distinct from authenticated backend success and cannot itself renew or clear the secure lease. | `SOURCE_ALIGNED` | `darshan-player/src/main/services/secure-playback-guard.ts`; `darshan-player/src/main/services/player-flow.ts`. Network-boundary timing remains a runtime case. |
| BR-070 | Global `manage User` grants global directory scope and can manage custom-role/OPERATOR accounts across departments. However, a custom role with this grant cannot administer every protected system-role target; those paths still require built-in role-name hierarchy, while SUPER_ADMIN can target all roles. | `PARTIAL_CONFLICT` | `darshan-server/src/routes/users.ts`; `darshan-server/src/routes/users-invite.ts`; `darshan-server/src/rbac/policy.ts::canManageUserRoleTarget`, `canManageUserRecord`. The confirmed phrase “across departments and role types” is broader than current custom-role behavior. |
| BR-071 | System roles cannot be deleted, but current API/UI allow SUPER_ADMIN to edit all built-in roles and ADMIN to edit DEPARTMENT/OPERATOR; startup synchronization later restores defaults. Built-ins are therefore not fixed at mutation time. | `PARTIAL_CONFLICT` | `darshan-server/src/routes/roles.ts`; `darshan-server/src/rbac/policy.ts::canManageSystemRole`; `darshan-server/src/rbac/system-roles.ts::syncSystemRolePermissions`; `darshan-cms/src/components/settings/RolesPermissionsTab.tsx`. Expected result should reject built-in-role permission/name edits immediately. |
| BR-056 | User/password/role mutations revoke stored sessions and publish invalidation; role mutations calculate affected users; protected socket handling revalidates sessions. | `SOURCE_ALIGNED` | `darshan-server/src/auth/jwt.ts`; `darshan-server/src/auth/mutation-authorization.ts`; `darshan-server/src/realtime/session-invalidation.ts`; user/invite/role routes and socket-session guards. Cross-node propagation/races remain runtime tests. |
| BR-057 | Schedule approval/publish uses action-specific ability checks and contains no self-approval prohibition; direct publish remains available to a permitted administrator. | `SOURCE_ALIGNED` | `darshan-server/src/routes/schedule-requests.ts`; `darshan-server/src/routes/schedules.ts`; `darshan-server/src/routes/schedule-publish-helper.ts`. |
| BR-084 | User deletion tombstones the row, scrubs access-bearing fields, revokes sessions and preserves stable historical identity/foreign-key references. | `SOURCE_ALIGNED` | `darshan-server/src/db/repositories/user.ts::tombstone`; `darshan-server/src/routes/users.ts`; migration `darshan-server/drizzle/migrations/0045_deleted_user_content_ownership.sql`. |
| BR-085 | New ownership classification is restricted for SUPER_ADMIN, organization-wide for ADMIN/global subject managers and department-owned otherwise; migration 0046 corrects migrated SUPER_ADMIN content to restricted. | `SOURCE_ALIGNED` | `darshan-server/src/rbac/content-ownership.ts::ownershipForNewContent`; migrations `0045_deleted_user_content_ownership.sql` and `0046_super_admin_restricted_content.sql`. |
| BR-086 | Central content policy enforces ability plus scope; Media/Layout/Presentation mutation is creator/global-manager only, while Schedule allows same-department permitted mutation. | `SOURCE_ALIGNED` | `darshan-server/src/rbac/content-ownership.ts::canReadContentResource`, `canManageContentResource`; Media/Layout/Presentation/Schedule routes. Direct and nested route coverage remains mandatory. |
| BR-087 | Presentation routes apply ownership and nested-reference checks; schedule creation/update/publish checks referenced Presentation access and scope compatibility. | `SOURCE_ALIGNED` | `darshan-server/src/routes/presentations.ts`; `darshan-server/src/routes/schedules.ts`; `darshan-server/src/rbac/content-ownership.ts::canReferenceContentResource`. |
| BR-088 | Schedule Request authorization resolves through the Schedule stable owner and retained ownership fields rather than dynamically reassigning to the requester's current department. | `SOURCE_ALIGNED` | `darshan-server/src/routes/schedule-requests.ts`; schedule/request repositories; ownership migration and tombstone paths. Lifecycle behavior after deletion still needs DB/API execution. |
| BR-089 | Tombstone commit revokes sessions, suppresses deleted recipients, aborts unfinished upload state and uses compare-and-set worker updates/cleanup retry so late jobs cannot reactivate deletion-stopped Media. | `SOURCE_ALIGNED` | `darshan-server/src/db/repositories/user.ts::tombstone`; `darshan-server/src/routes/users.ts`; `darshan-server/src/jobs/index.ts`; notification and media-upload repositories. Race outcomes remain runtime tests. |
| BR-090 | Server responses include stable ownership/creator status and action permissions; CMS renders deleted/inactive creator labels and the deletion dialog explains retained work; department deletion returns in-use counts. | `SOURCE_ALIGNED` | `darshan-server/src/rbac/content-ownership.ts::contentResponseMetadata`, `resolveContentOwnershipViews`; `darshan-cms/src/lib/access.ts`; `darshan-cms/src/components/users/DeleteUserDialog.tsx`; `darshan-server/src/routes/departments.ts`. |
| BR-091 | Tombstones and cross-department records are filtered. Direct user access, invite listings and chat participant checks enforce active visibility for non-global actors. The primary Users/Operators list, however, does not force `is_active=true` unless the caller supplies it, and Operators does not supply it. | `PARTIAL_CONFLICT` | `darshan-server/src/rbac/user-directory.ts`; `darshan-server/src/db/repositories/user.ts::list`, `listInvites`; `darshan-cms/src/pages/Operators.tsx`; `darshan-cms/src/hooks/chat/useChatQueries.ts`. Expected active-only behavior is not uniform. |
| BR-092 | Effective grants, inheritance and record conditions drive normal feature access; current static guard protects against feature-level custom-role name gates. Role-name checks remain in the stated protected hierarchy/new-owner exceptions. | `SOURCE_ALIGNED` | `darshan-server/src/rbac/index.ts`; `darshan-server/src/rbac/content-ownership.ts`; `darshan-server/src/rbac/authorization-role-gates.unit.test.ts`; `darshan-cms/src/hooks/useAuthorization.ts`. Runtime conditional/inherited-role cases remain. |
| BR-093 | Schedule and Schedule Request mutations use action-specific abilities inside current-authorization transactions plus stable-owner and lifecycle checks. | `SOURCE_ALIGNED` | `darshan-server/src/routes/schedules.ts`; `darshan-server/src/routes/schedule-requests.ts`; `darshan-server/src/auth/mutation-authorization.ts`. |
| BR-094 | Current registrations and source inventory confirm the disabled general Requests surface and retained Schedule Requests surface. | `SOURCE_ALIGNED` | Same current evidence as BR-055; legacy request tables remain a data-retention/exposure test target only. |
| BR-095 | Emergency mutations re-evaluate current authorization, require readable READY media, and scope status/history/clear through the same target helper. | `SOURCE_ALIGNED` | `darshan-server/src/routes/emergency.ts`; `darshan-server/src/rbac/emergency-authorization.ts`; `darshan-server/src/auth/mutation-authorization.ts`. |
| BR-096 | Session invalidation publishes through the realtime bus, disconnects local rooms and protected socket actions re-check the original access token/session. | `SOURCE_ALIGNED` | `darshan-server/src/realtime/session-invalidation.ts`; realtime bus/socket-session and chat/notification/screens namespaces. Multi-node loss/reconnect remains a runtime case. |
| BR-097 | Server and player share explicit webpage URL policy for schemes/hosts/ports/DNS/CIDR; source defaults deny HTTP while generated production configuration enables approved HTTP/80 and HTTPS/443. | `SOURCE_ALIGNED` | `darshan-server/src/utils/webpage-url-policy.ts`; player webpage policy/view manager; `scripts/bundle/production-bundle-config.mjs`; bundle assembly. Actual site allowlists remain environment evidence. |
| BR-098 | Capture uses a fresh context and the player uses nonpersistent isolation/cancels login mechanisms; URL userinfo and HTTP authentication are rejected. | `SOURCE_ALIGNED` | `darshan-server/src/utils/webpage-capture.ts`; `darshan-server/src/utils/webpage-url-policy.ts`; `darshan-player/src/main/services/webpage-view-manager.ts`. |
| BR-099 | Initial URL, redirects and dependent navigations are revalidated rather than inheriting trust from the first hop. | `SOURCE_ALIGNED` | `darshan-server/src/utils/webpage-capture.ts`; `darshan-server/src/utils/webpage-url-policy.ts`; player webpage navigation policy/view manager. DNS rebinding and redirect chains require isolated network tests. |
| BR-100 | Preview refresh uses token/compare-and-set ownership; failed capture preserves the last successful revision/object and player fallback/cache keys are revision-aware. | `SOURCE_ALIGNED` | migration `0047_webpage_preview_refresh.sql`; `darshan-server/src/jobs/index.ts`; `darshan-server/src/routes/media.ts`; snapshot/default serializers; `darshan-player/src/main/services/settings/default-media-service.ts`. |
| BR-101 | Group default assignment stores priority 0–100; resolver orders priority descending and target ID ascending; omitted update priority is preserved and settings writes use expected revision/advisory locking. | `SOURCE_ALIGNED` | `darshan-server/src/utils/default-media.ts`; settings routes/repository; migration `0047_webpage_preview_refresh.sql`; CMS default-media settings components. |
| BR-102 | With source `NONE`, the renderer builds a text card saying “No content assigned yet.” No approved packaged company fallback image or variant-selection path is present. | `NOT_IMPLEMENTED` | `darshan-player/src/renderer/default-media-player.ts::renderEmptyState`; `darshan-player/src/main/services/settings/default-media-service.ts`. This remains a release blocker until the business supplies/approves the asset contract and implementation exists. |
| BR-103 | Player validates requested PDF page against decoded count, renders explicit Unavailable on mismatch, emits page-specific failure context and CMS restoration retains invalid state for correction. | `SOURCE_ALIGNED` | `darshan-player/src/renderer/pdf-playback.ts`; `darshan-player/src/renderer/player.ts`; CMS schedule restoration/validation helpers. Exact UI/log wording needs QA observation. |
| BR-104 | Scheduled-video failure disposes failed media and the renderer holds the Unavailable state until the original item boundary before normal advancement. | `SOURCE_ALIGNED` | `darshan-player/src/renderer/scheduled-video-lifecycle.ts`; `darshan-player/src/renderer/player.ts`; timeline scheduling helpers. |
| BR-105 | Single-item failed video retry is duration-derived, clamped to 1–30 seconds and guarded by one lifecycle/session generation so every authority/disposal change cancels stale work. | `SOURCE_ALIGNED` | `darshan-player/src/renderer/scheduled-video-lifecycle.ts`; `darshan-player/src/renderer/player.ts`. Timer leak/retry behavior still needs runtime observation. |
| BR-106 | Timeline and renderer have an explicit authority end/disposal path that pauses/removes video and selects the next authority. Source structure supports a hard boundary, but the 250 ms display/audio target cannot be proven statically. | `SOURCE_ALIGNED` | player timeline scheduler, playback engine, snapshot manager and renderer lifecycle. Treat <=250 ms as an execution threshold, not a source-proven fact. |
| BR-107 | Security recovery is single-flight: validate identity, force current snapshot, synchronize current media/apply authority and then unlock; invalid identity and failed snapshot follow distinct bounded paths. | `SOURCE_ALIGNED` | `darshan-player/src/main/services/player-flow.ts`; `secure-playback-guard.ts`; `snapshot-manager.ts`; cache manager. Backend-return scenarios remain target-network tests. |

## Confirmed-Rule Conflicts To Carry Forward

1. `BR-070` — global User permission is not sufficient for a custom role to
   manage every protected system-role target.
2. `BR-071` — built-in roles are still editable through permitted API/UI paths;
   restart-time reset is not immutability.
3. `BR-091` — Users/Operators management lists can expose inactive
   same-department accounts to non-global viewers.
4. `BR-102` — no-Schedule/no-default still renders text instead of the required
   company fallback image; the approved asset contract is also missing.

These are implementation/documentation conflicts, not new business questions.
The corresponding tests and risks must retain the confirmed expected result.

## Downstream Catalogue Drift Identified For Step 2B

- BR-008 overstates active-only filtering for the primary user/operator list.
- BR-025 describes an older emergency parent-gate/target-check gap that current
  source has closed.
- BR-037 describes deleted general Requests handlers and files as current.
- BR-048 and BR-049 repeat questions already settled by BR-085..092.
- BR-052 still labels resolved access decisions as needing confirmation.

Those rows are intentionally listed here so Step 2B can correct their evidence
state without losing historical provenance.
