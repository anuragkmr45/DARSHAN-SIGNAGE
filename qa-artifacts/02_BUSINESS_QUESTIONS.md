# Business Questions

Status: SOURCE-BEHAVIOR ANSWERED FOR THE ORIGINAL 20 TOPICS; BQ-021 REMAINS OPEN FOR SSO DELEGATION POLICY; BQ-022/023/024 PENDING-INVITE LOGIN, LOST-LINK RECOVERY AND INVITE-CREDENTIAL EXPOSURE ARE ANSWERED. User-approved rules are identified separately. This file keeps questions as a decision/provenance log, not as requests for QA or the user to rediscover code behavior. Use `12_CODE_BASELINE_EXPECTATIONS.md` for concise current-code expectations and `05_TEST_CASES.csv` for blank actual results.

Source behavior for all BQ-001 through BQ-020 has been recorded. A question's remaining `TBD` means business approval or an actual site target is missing, not that code behavior is unknown. QA can characterize the implementation now; release acceptance for an undecided policy remains separate. Do not include passwords, keys, production tokens or customer data.

## First Human Decision Gate

Step 2C confirmed eight answers; the P01 SSO audit added a ninth before the linked
acceptance results can be finalized. Everything the repository can answer is
already recorded below; the human only needs to supply these product/site
choices.

| Order | ID | Simple answer needed |
| ---: | --- | --- |
| 1 | BQ-013 | Is any proof-of-play loss acceptable? If yes, state the minimum offline duration or maximum loss the business accepts. |
| 2 | BQ-014 | Should “uptime” mean current online screens or historical availability? State the reporting timezone and what counts as completed playback. |
| 3 | BQ-015 | State how long each data class must be kept and any legal-hold or mandatory-erasure rule. |
| 4 | BQ-016 | List supported Windows/Ubuntu versions, CMS browsers, player hardware/displays and any accessibility standard. |
| 5 | BQ-017 | State expected fleet/users/uploads/media volumes plus measurable latency, error-rate and display-delay targets. |
| 6 | BQ-018 | State RPO, RTO, allowed maintenance downtime, starting deployed versions and the allowed mixed-version period. |
| 7 | BQ-019 | State permitted internet egress, which endpoints may leave the trusted LAN, and whether HTTP inside private role networks is approved. |
| 8 | BQ-020 | Should deleted Media or chat attachments be recoverable? If yes, state the recycle/undelete period for each. |
| 9 | BQ-021 | Must SSO access be organization-wide only, or may a custom role view/deactivate one provider? If delegated, may that role see its client secret? |

Answer one row at a time or as a batch. “No requirement” is a valid explicit
decision where appropriate; silence is not approval of the current code.

Unless a section says otherwise, historical observed behavior refers to its
dated static baseline. BQ-002/003/006/007/008/009 were refreshed through source
commit `a01804c`; their combined review is
`evidence/authorization-session-requests-review.md`. Source references are
repository-relative. These areas have developer build, database/migration,
built-API, browser and player evidence in the dated closure report; independent
QA, multi-process live sockets and the remaining release matrix are still
unverified. The 2026-10-21 playback/recovery implementation and two current
Linux Electron passes are recorded in
`evidence/playback-recovery-developer-verification-2026-10-21.md`.

## Batch 1: Core Behavior And Scope

### BQ-001: Document Playback

Question: Should a PDF or Office document converted to PDF display only its first page, allow an author-selected static page, or automatically show every page/slide?

Why this changes testing: A player showing only page 1 can be either correct or a blocking feature defect. Duration and page progression affect scheduling and PoP expectations.

Observed implementation updated 2026-10-17: scheduling stores one selected physical page per occurrence, previews and player playback render that page, and Office/CSV conversion produces the PDF whose physical page count sets the valid range. There is no automatic progression. Legacy missing values mean page 1. A restored invalid selection remains visible and blocks progression. Page >1 is blocked until every concrete target has updated, connected and reported `pdf_page_selection_v1`. A post-publish decoded-count mismatch shows exact `Unavailable` and never substitutes another page.

Evidence: `darshan-player/src/renderer/pdf-playback.ts::render`; `darshan-server/src/jobs/index.ts` document conversion handler; `darshan-server/src/utils/libreoffice-conversion.ts`.

Choices: resolved to author-selected static page per occurrence, defaulting to page 1; all-page progression remains out of scope.

Affected areas: UC-006, UC-009, UC-017, UC-020; BR-017, BR-051; document fixtures, timing, renderer and UAT.

Answer: superseded by the user feature request on 2026-10-15: let the author choose the page while scheduling and show that page in preview and playback. The selection is static per occurrence; page 1 remains the compatibility default.

Resolution: RESOLVED. Author-selected static page playback per scheduling occurrence is the acceptance requirement; page 1 is only the legacy/default selection. All release players are upgraded and connect once before page >1 rollout; mixed-version playback is not accepted. Invalid selections fail explicitly without substitution. Successful conversion/rendering and physical-platform behavior still require QA verification; this answer is not a test result.

### BQ-002: Administrator Hierarchy

Question: Is it intentional that SUPER_ADMIN can manage ADMIN and OPERATOR accounts but cannot manage DEPARTMENT or other SUPER_ADMIN accounts through the normal user-management APIs? Or should SUPER_ADMIN manage every role, with any last-super-admin/self-deletion restrictions stated explicitly?

Why this changes testing: Role names alone suggest a hierarchy that the current policy does not implement. The expected allow/deny matrix must come from an approved policy.

Observed implementation, refreshed 2026-10-16: global `manage User` participates in account administration, while protected system-role hierarchy remains explicit. A repository-level transaction locks the SUPER_ADMIN role row and blocks delete/disable/demotion only when the target is the last active direct SUPER_ADMIN. The recovery CLI calls the same invariant.

Evidence: `darshan-server/src/rbac/policy.ts::canManageUserRoleTarget`, `canManageUserRecord`; `darshan-server/src/routes/users.ts`; `darshan-cms/src/lib/access.ts::canManageUserTarget`.

Choices: keep the current division; unrestricted SUPER_ADMIN with explicit safeguards; provide a different actor-to-target matrix.

Affected areas: UC-003, UC-004; BR-006, BR-007, BR-052; create/invite/edit/disable/delete/reset and direct API authorization.

Answer: "yes deleting super admin shoudl be blocked". Business source: user answer BQ-002, 2026-09-24.

Latest decision, 2026-10-16: block deleting, disabling and demoting the **last active SUPER_ADMIN**. Removing one is allowed when another active direct SUPER_ADMIN remains.

Resolution: RESOLVED under BR-067/070. Expected QA result: the last removal returns `409 LAST_ACTIVE_SUPER_ADMIN`; one of two may be removed; two concurrent removals cannot both commit; global User managers administer other user types subject to permission and hierarchy checks. See `AUTHZ-01` and `evidence/authorization-session-requests-review.md`.

### BQ-003: Emergency Authority

Question: Should emergency trigger/clear be restricted to ADMIN and SUPER_ADMIN, or should custom roles be allowed through a specific delegated permission? If delegated, which permission and target scope should authorize it?

Why this changes testing: Emergency takeover is safety-sensitive. A role that can manage an ordinary screen may not be intended to override site-wide content.

Observed implementation, refreshed 2026-10-16: `manage Emergency` is the global controller. Otherwise conditional `update Screen` is evaluated on every target record. Delegates can use only explicit direct screens; group/global/mixed targets are denied. Trigger/clear recheck permission transactionally, while status/history are scoped to authorized emergencies.

Evidence: `darshan-server/src/routes/emergency.ts::requireEmergencyAdmin`; `darshan-cms/src/lib/access.ts::canManageEmergency`.

Choices: named admins only; explicit Emergency permission with defined scope; Screen-update delegation is intentional.

Affected areas: UC-004, UC-019; BR-025, BR-052; UI/API parity, global/group/screen targets and privilege escalation.

Answer: "delegated users too". Business source: user answer BQ-003, 2026-09-24.

Follow-up answer, 2026-09-24: "screen-management permission sufficient, all selected screens". The user also requested checking actual code behavior.

Latest decision: delegates control and clear only emergencies on screens they may manage; ADMIN/SUPER_ADMIN or any role with `manage Emergency` controls groups/global emergencies.

Resolution: RESOLVED under BR-068/095. Expected QA result is recorded in `AUTHZ-03`; source/build/unit evidence exists, but CMS/API/player runtime remains Not Tested.

### BQ-004: Offline Playback Policy

Question: For the production acceptance baseline, should a previously validated player continue cached playback when the backend is unreachable, or lock after a defined outage? State the permitted outage duration and whether cached media must ever be purged. Should cached emergency content follow the same lock policy?

Why this changes testing: Continuing playback and stopping playback are opposite expected outcomes. A backend outage is not equivalent to explicit device revocation.

Observed implementation, refreshed 2026-10-17: `standard`, `secure`, `high_security` and backend-required settings exist. Generated production player bundles and checked examples select secure/backend-required playback. In secure mode the deadline is exactly the last authenticated backend success plus 120 seconds; legacy grace settings remain parseable but cannot extend it. Lock stops every authority and purges only media cache. While locked, reachability begins one ordered recovery but does not directly unlock.

Evidence: `darshan-player/src/common/offline-security-policy.ts::evaluateSecurePlaybackState`; `darshan-player/src/main/services/player-flow.ts`; `darshan-player/src/main/services/secure-playback-guard.ts`; `darshan-player/src/main/services/snapshot-manager.ts`.

Choices: availability-first cached playback subject to valid identity; security lock after an agreed interval; distinct approved profiles for different sites.

Affected areas: UC-014, UC-017, UC-019, UC-028; BR-027, BR-030, BR-031, BR-053; network isolation, recovery, emergency and privacy.

Answer: "lock". Business source: user answer BQ-004, 2026-09-24.

Follow-up answer, 2026-09-24: "2min and erase cash file, yes emergency should stop too". The user also requested checking actual code behavior.

Resolution: RESOLVED under BR-053/069/107. Lock exactly 120 seconds after the last authenticated backend success, stop schedule/default/emergency playback, and remove only media-cache content while preserving identity, certificates, logs, PoP and request queues. Runtime observation tolerance is at most one second. Recovery validates identity, force-fetches a fresh snapshot, synchronizes/checks current media, applies current authority and only then unlocks. Snapshot failure remains locked with bounded 2–30 second retry; invalid identity enters pairing recovery; stale cached authority never resumes.

Code comparison: the implementation now matches this contract in focused automation, generated production configuration and checked examples. Two real Electron runs passed the 119/120-second timing, media-purge/identity-preservation check and changed-authority recovery; see `evidence/playback-recovery-developer-verification-2026-10-21.md`.

### BQ-005: Real Integration Scope

Question: For this release, must SSO actually sign users in, issued API keys actually authenticate API calls, and subscribed business events actually deliver webhooks? Identify each as required now or configuration/management-only for this release.

Why this changes testing: Saving an integration configuration is not the same as successfully using the integration. Required-but-unimplemented paths must be release gaps, not omitted tests.

Observed implementation: Persisted configuration/management APIs and CMS pages exist. Webhook test-send performs an actual outbound request. In the inspected server registration/call sites, no complete SSO authorization/callback login flow, API-key request authentication consumer or automatic business-event webhook dispatcher was found.

Evidence: `darshan-server/src/server/index.ts`; `darshan-server/src/routes/auth.ts`; `darshan-server/src/routes/api-keys.ts`; `darshan-server/src/db/repositories/api-key.ts`; `darshan-server/src/routes/sso-config.ts`; `darshan-server/src/routes/webhooks.ts`; `darshan-cms/src/pages/SsoConfig.tsx`, `Webhooks.tsx`, `ApiKeys.tsx`.

Choices: require all three runtime integrations; require a specified subset; acceptance is limited to persisted administration and explicit webhook test delivery.

Affected areas: UC-002, UC-025; BR-039, BR-054; integration environments, negative/security cases and release scope.

Answer: "only management screens". Business source: user answer BQ-005, 2026-09-24.

Resolution: RESOLVED for release scope. Test integration administration UI, its backing management APIs, persistence, validation and access control. Actual SSO login, API-key-authenticated business calls and automatic business-event webhook delivery are not release requirements. Do not mark their absence as a functional release defect. If the explicit webhook Test action remains exposed, account for its outbound-request behavior and security; do not infer approval of automatic delivery.

### BQ-006: General Requests Workboard

Question: What should the separate `/requests` workboard do: an admin-only support tracker, department-scoped requests, or a wider approval workflow? Specify who can see/comment on another person's request and the valid status sequence. This is separate from schedule approval requests.

Why this changes testing: Its visibility and terminal state are contradictory across layers, so either privacy tests or functional workflow tests can otherwise get the wrong expected result.

Observed implementation, refreshed 2026-10-16: general Request server registration, route/repository modules, CMS page/client/navigation and report/webhook surfaces are removed. Legacy tables remain for compatibility. Schedule Requests remain a separate registered feature.

Evidence: `darshan-cms/src/AuthenticatedAppShell.tsx`; `darshan-cms/src/pages/Requests.tsx`; `darshan-server/src/routes/requests.ts`; `darshan-server/src/db/repositories/request.ts`; `darshan-server/src/db/schema.ts::requestStatusEnum`.

Choices: narrowly scoped tracker with defined visibility/states; governed approval workflow with defined transitions; outside current release scope but exposed routes still require security review.

Affected areas: UC-023; BR-037, BR-055; role/owner matrix, status transitions, attachments, reporting and UAT.

Answer: "Requests feature is out of scope for this release." Business source: user answer BQ-006, 2026-09-24.

Latest decision: disable the out-of-scope general Requests APIs for this release.

Resolution: RESOLVED under BR-055/094. Expected QA result: every former general Requests URL and UI/client/report/webhook entry is absent/not-found, legacy rows are not exposed, and Schedule Requests still work. See `AUTHZ-06`.

## Batch 2: Access, Content And Evidence Policy

### BQ-007: Sharing And Department Boundaries

Question: Should operators be able to discover operators in other departments? For media, layouts, presentations and schedules, which actions are permitted on another author's content within the same department, across departments, and on ADMIN/SUPER_ADMIN-owned content?

Why this changes testing: Department membership is not a uniform privacy boundary in the current implementation. A per-resource action matrix is needed, not an assumption that every record is either global or private.

Observed implementation, refreshed 2026-10-16: Media, Layout, Presentation and Schedule persist `ORGANIZATION`, `DEPARTMENT` or `RESTRICTED` ownership and use centralized policy. User/operator/invite/chat participant directories now apply active same-department visibility before pagination unless the actor has global `manage User`.

Evidence: `darshan-server/src/rbac/content-ownership.ts`; content repositories/routes; migration `0045_deleted_user_content_ownership.sql`; `darshan-cms/src/lib/access.ts`; `evidence/deleted-user-ownership-review.md`.

Affected areas: UC-003..UC-012, UC-024; BR-008, BR-047, BR-048, BR-052, BR-085..BR-090; horizontal authorization, nested references, search/list counts, attribution and exports.

Historical answer received 2026-09-25 (superseded for the four content resources on 2026-10-16): the user supplied the then-current per-resource implementation matrix and explicitly distinguished the presentation authorization gap from intended unrestricted sharing. Media/layout reads allowed same-department plus ADMIN-owned content; ordinary deletion/editing was creator-oriented; Schedule access was department-derived; and basic Presentation handlers omitted guards. OPERATOR directory access included operators' names/emails across departments, whereas DEPARTMENT was restricted to its own operators.

Latest decisions: non-global users see people only in their department; Media/Layout permit same-department read but creator/global-manager edit/delete; Presentation permits creator and same-department permitted access with creator/global-manager mutation; Schedule permits same-department permitted management with action-specific grants; other departments are denied. ADMIN-created content is organization-shared while SUPER_ADMIN-created content is restricted/private.

Resolution: RESOLVED under BR-085..093. Detailed Expected Results are in `AUTHZ-08..13`. Deleting/transferring the creator does not change stable owner scope/department or published playback.

### BQ-008: Saved Role Customizations

Question: Must edits to built-in role permissions survive API restarts and upgrades, or are built-in roles deliberately fixed with persistent customization allowed only in custom roles? Must custom roles work in workflows currently restricted by role name?

Why this changes testing: A permission change that succeeds in the UI but disappears after restart can be correct policy or a serious defect.

Observed implementation, refreshed 2026-10-16: feature routes and CMS controls use effective CASL permissions; inherited and conditional grants are resolved. A recursive regression test rejects feature-level custom-role name gates. Role-name identity remains only for protected system-role hierarchy and content ownership classification.

Evidence: `darshan-server/src/routes/roles.ts`; `darshan-server/src/rbac/system-roles.ts`; `darshan-server/src/server/index.ts`; `darshan-cms/src/components/settings/RolesPermissionsTab.tsx`.

Affected areas: UC-004, UC-027; BR-009, BR-049, BR-052; persistence, authorization and upgrade regression.

Answer, 2026-09-24: "built-in roles stay fixed and customization use only custom roles"; check actual code behavior.

Resolution: RESOLVED under BR-071/092. Custom-role permissions decide access everywhere regardless of role display name; protected system-role hierarchy remains identity-based. Runtime inheritance/condition/session-withdrawal coverage is `AUTHZ-02`.

Follow-up answer, 2026-10-22: if startup finds a canonical built-in role name with `is_system=false`, **stop for administrator review**. Do not automatically set `is_system=true` or install built-in grants. A genuine `is_system=true` built-in may have its permission drift repaired. This is a confirmed business/security rule under BR-071; test it separately as `AUTHZ-16`.

### BQ-009: Existing Sessions After Account Changes

Question: When an account is disabled, its password is reset, or its role/department changes, must all existing REST and realtime sessions lose old access immediately, within an agreed delay, or only at expiry/new login?

Why this changes testing: Session revocation latency changes the expected result for direct API calls, open browser tabs and already-connected sockets.

Observed implementation, refreshed 2026-10-16: account/password and direct/transitive role-permission changes revoke affected sessions transactionally. Invalidation broadcasts through the realtime bus to all API nodes, disconnects local user rooms, and protected socket actions reverify the stored handshake token before proceeding. Login issuance locks and rechecks current user/password/role. The recovery CLI remains an operational restart case.

Evidence: `darshan-server/src/auth/jwt.ts::verifyAccessToken`; `darshan-server/src/db/repositories/user.ts::tombstone`; `darshan-server/src/routes/users.ts`; shared user rooms in the chat/notification/screen namespaces; `evidence/deleted-user-ownership-review.md`.

Affected areas: UC-002..UC-004, UC-021; BR-010, BR-011, BR-012, BR-056; authentication, horizontal/vertical authorization and concurrency.

Answer, 2026-09-24: "prefered immediately, within a specified delay"; check actual code behavior.

Latest follow-up, 2026-09-24: "Immediate access withdrawal"; the user describes its absence from ordinary account updates, token refresh and existing socket connections.

Resolution: RESOLVED under BR-056/096. Immediately after commit, old REST and socket access must fail on every node. Bounded in-memory broadcast testing passed; multi-node Valkey, failure and in-flight runtime cases remain `AUTHN-04`/`CONC-07`.

Planning note: distinguish operations already in flight before the change from operations authorized after it. Record measured propagation and any residual-access window during future execution; do not invent an accepted delay. This review did not execute a session or socket test.

### BQ-010: Independent Approval

Question: May an administrator approve and publish a schedule request they created, or must a different authorized person approve it? Is the separately documented direct-admin-publish operation an intentional exception?

Why this changes testing: An admin role check does not prove separation of duties.

Observed implementation: Approval/publish restrict to admin-like actors, validate reservation state and version, but do not visibly reject the creator as approver. Direct admin publish is explicitly documented and implemented.

Evidence: `darshan-server/src/routes/schedule-requests.ts`; `darshan-server/src/routes/schedules.ts`; `docs/contracts/scheduling-and-emergency-spec.md::Direct admin publish`.

Affected areas: UC-010, UC-011; BR-021, BR-022, BR-057; workflow, audit and UAT.

Answer received 2026-09-25: "yes an administrator approve their own schedule request. yes direct administrator publishing remain allowed".

Resolution: CONFIRMED_BUSINESS_RULE (BR-057). Administrator self-approval and direct administrator publication are permitted. Do not fail a test solely because the author and approver match; role, reservation, revision, conflict, content readiness and audit checks remain independently applicable. This does not grant an ordinary operator permission to approve or publish.

### BQ-011: Supported Webpages And Failure Display

Question: Which webpages and fallback behavior does this release support?

Final answer received 2026-10-17: allow ordinary HTTP as well as HTTPS through an explicit policy; do not support login-required pages; allow redirects only while every hop remains on approved destinations; always use the latest successful preview when live display fails. Capture may be refreshed manually and automatically every 24 hours by default. A failed refresh must not replace the last successful preview.

Implemented behavior: source defaults keep HTTP disabled, while the release bundle explicitly enables HTTP and ports 80/443. Server capture and player navigation validate scheme, host, port, DNS result and CIDR on the initial URL and subsequent hops. Embedded credentials and HTTP-auth login are denied; the player uses a nonpersistent isolated partition. Successful captures create a new revision/checksum; failed attempts retain the former successful preview. Player caches are revision-aware and can use the newest older cached revision if the selected revision is temporarily unavailable.

Evidence: `darshan-server/src/utils/webpage-url-policy.ts`; `darshan-server/src/jobs/index.ts`; `darshan-server/src/routes/media.ts`; migration `0047`; `darshan-player/src/main/services/webpage-network-policy.ts`; `darshan-player/src/main/services/webpage-view-manager.ts`; `darshan-player/src/main/services/cache/cache-manager.ts`; `darshan-player/src/renderer/webpage-playback.ts`; `evidence/webpage-default-priority-review.md`.

Resolution: CONFIRMED_BUSINESS_RULES BR-097..100. BQ-011 is closed. HTTP is a deliberate deployment choice and must be presented as cleartext-risk acceptance, not equivalent transport security. A login/error page remains a content-quality fixture for QA, but login automation/session import is explicitly outside scope.

QA expected result: an allowed HTTP or HTTPS fixture loads; a disallowed scheme/host/port/address or any redirect to one is blocked; credentialed/basic-auth pages never receive credentials; manual and due refresh publish a new revision only after a successful capture; failure leaves the prior revision usable; a missing/corrupt preview produces a controlled unavailable state rather than a broken image or crash.

### BQ-012: Competing Default Media

Question: If a screen belongs to competing groups, which default wins and what happens during edits?

Final answer received 2026-10-17: add explicit numeric group priority. Editing an assignment without changing priority must not change priority.

Implemented behavior: direct SCREEN wins. Otherwise, eligible matching GROUP assignments are sorted by integer priority descending and then target ID ascending for a stable tie. ASPECT_RATIO and GLOBAL follow. Priority accepts `0..100`; legacy/missing values normalize to `0`. CMS exposes the value. Settings use an expected revision, and a transaction-scoped advisory lock ensures concurrent saves from one revision produce one success and one `409`, including the first save.

Evidence: `darshan-server/src/utils/default-media.ts`; `darshan-server/src/routes/settings.ts`; `darshan-cms/src/components/settings/DefaultMediaSection.tsx`; `darshan-cms/src/api/domains/settings.ts`; `evidence/webpage-default-priority-review.md`.

Resolution: CONFIRMED_BUSINESS_RULE BR-101. BQ-012 is closed.

QA expected result: higher eligible GROUP priority wins regardless of array order; equal priority always chooses ascending target ID; a direct SCREEN assignment still wins; media/order-only edits preserve priority; invalid priorities reject atomically; concurrent stale saves never silently overwrite the winning save.

### BQ-013: Proof-Of-Play Completeness

Question: Is proof-of-play best-effort operational telemetry, or must every recorded playback event survive until reconnection without loss? State the maximum offline retention interval and whether any loss is acceptable after the local storage limit is reached. The two-minute lock stops subsequent playback; it does not settle retention of events already recorded before locking.

Why this changes testing: Current queue bounds deliberately trade evidence retention for finite device storage. Contractual/audit evidence cannot be assessed with a best-effort expectation by default.

Observed implementation: Memory/spool budgets are bounded; old spool records can be dropped with discard metrics. Actual crash gaps are not fabricated as playback.

Evidence: `darshan-player/src/main/services/pop-service.ts`; `darshan-player/src/main/services/offline-replay-budgets.ts`; `darshan-server/src/jobs/device-telemetry.ts`; `docs/governance/data-and-runtime-state-governance.md`.

Affected areas: UC-020, UC-024, UC-028; BR-005, BR-034, BR-060; soak/outage/storage/recovery and report completeness.

Answer received 2026-09-25: retention is bounded best effort: memory 100 events/512 KiB; pending spool 32 files, up to 50 events each; byte budget 2% of configured cache capacity clamped to 1-16 MiB. Old pending files are removed on overflow with discard counters. No fixed hours/days retention or age TTL is implemented; crash/write failures can lose events. The media-lock purge does not delete pop-spool.

Resolution: ANSWERED AS IMPLEMENTATION BASELINE (BR-034). Test budget enforcement, discard reporting, replay and preservation across the specific media purge without claiming a guaranteed retained-event count or duration. `evidence/content-runtime-review.md::BQ-013` distinguishes pending/inflight files and memory durability. Acceptable business loss/retention duration remains TBD under BR-060; absence of a code guarantee does not itself approve evidence loss.

Code-baseline expected result for QA: Up to 100 events/512 KiB remain in memory before overflow is spooled; pending spool files hold at most 50 events each, with a 32-file and 1-16 MiB derived byte budget. Oldest pending files are discarded when limits are exceeded, with discard counters; successful replay removes local batches. Abrupt crashes, failed writes and overflow can lose evidence. No fixed offline-hours/days promise or age TTL exists. The media-cache purge used by secure lock leaves already-spooled PoP files intact. This is bounded best effort, not a lossless acceptance criterion.

### BQ-014: Reporting Definitions

Question: Should the displayed screen uptime metric mean the percentage of screens online now, or actual availability over a chosen time period? Which timezone defines a reporting day, and should PoP summaries distinguish successful/completed, interrupted and failed playback?

Why this changes testing: These choices change calculation fixtures, denominator rules, empty-data results and daily totals after offline replay.

Observed implementation: `screen_uptime_percent` is ACTIVE/(ACTIVE+OFFLINE), not a duration calculation. PoP daily grouping uses database `date(created_at)` and count-based summaries.

Evidence: `darshan-server/src/routes/reports.ts` summary/trends; `darshan-server/src/routes/proof-of-play.ts` grouped queries.

Affected areas: UC-020, UC-024; BR-038, BR-061; calculations, timezones and report/export parity.

Code answer, 2026-09-25: `screen_uptime_percent` is the current ACTIVE/(ACTIVE+OFFLINE) percentage rounded to two decimals, null if neither exists. PoP COMPLETED means `ended_at IS NOT NULL`; INCOMPLETE means null. Daily grouping uses PostgreSQL `date(created_at)` with no explicit site timezone; PDF dates are UTC and CMS timestamps use the browser locale. See `evidence/operational-behavior-review.md::BQ-014`.

Human input still needed: Is the current screen-state percentage acceptable as a field named uptime, or must historical availability be reported? Which reporting-day timezone and completion definition should QA accept? Mark these expected outcomes TBD until answered.

## Batch 3: Operational Acceptance

### BQ-015: Retention And Privacy

Question: What are the required retention periods for media, chat/messages/attachments, screenshots, proof-of-play, audit/auth/system logs, metrics and off-host backups? Are any records subject to legal hold or mandatory erasure?

Why this changes testing: Cleanup/archive/deletion expectations and backup restore expectations depend on data-class policy, not just default cron values.

Observed implementation: Data is split across DB, S3 and player queues; log archive/cleanup and backup retention mechanisms differ. Production backup cadence is release policy rather than an optional CMS preference.

Evidence: `darshan-server/src/jobs/index.ts`; `darshan-server/src/utils/settings.ts::applyProductionBackupSchedule`; `darshan-server/src/utils/backup-runs.ts`; `darshan-server/src/deployment/backup-contract.ts`; `darshan-player/src/main/services/pop-service.ts`.

Affected areas: UC-020..UC-024, UC-028; BR-045, BR-062; data lifecycle, privacy, volume and DR.

Code answer, refreshed 2026-10-28: Backup/recovery Packet 1 requires production retention of at least 30 days and a deployment-owned daily `HH:mm`/IANA-timezone schedule with one automatic local-date identity. That is configuration/coordination, not effective retention. Local archive publication, encryption and retention enforcement remain later packets. Retained legacy off-host settings, the 30-day old-log deletion handler and off-host pruning function do not prove every required lifecycle executes. Prometheus retention remains separately configurable, and Media, chat, screenshots and PoP use distinct lifecycles. See `evidence/operational-behavior-review.md::BQ-015` and `evidence/backup-recovery-packet-01-developer-verification-2026-10-28.md`. No legal policy is inferred.

Human input still needed: Approved retention and legal-hold/erasure rules by data class. This cannot be chosen from current cleanup code; use TBD until the site owner specifies it.

### BQ-016: Supported Client Matrix

Question: Which exact browser/OS versions and player hardware/architectures must be release-supported? Include Ubuntu display system where relevant, Windows versions, display count/resolutions/rotation/DPI and any mandatory accessibility standard or assistive technology.

Why this changes testing: Package targets and test-runner choices do not establish contractual support. Physical playback, autostart and monitor behavior require the actual target matrix.

Observed implementation: Player packaging includes Windows/Linux and a macOS command, while its description emphasizes Windows/Ubuntu. CMS browser-test config only selects Chromium. Player has primary/pinned display selection and Wayland-unverified reporting.

Evidence: `darshan-player/package.json`; `darshan-player/src/main/services/display-manager.ts`; `darshan-player/src/main/runtime-mode.ts`; `darshan-cms/playwright.config.ts`; `docs/environments/player-platform-support.md`.

Affected areas: UC-006..UC-009, UC-017, UC-029; BR-063; compatibility/accessibility/UAT. The previously requested fullscreen behavior is already included, not being asked again.

Code/document answer, 2026-09-25: Windows x64 NSIS and Ubuntu deb/AppImage desktop-session player paths are declared production; macOS is development-only. Linux x64/arm64 packaging scripts exist. The Ubuntu static audit targets 22.04+ and differentiates X11 from degraded Wayland. CMS Playwright has only Chromium. See `evidence/operational-behavior-review.md::BQ-016`; none of this is native acceptance execution.

Human input still needed: Exact Windows builds, mandatory CMS browser versions, real player hardware/displays and accessibility target if required. Use the documented platform matrix as the starting scope, with narrower site-specific acceptance TBD.

### BQ-017: Workload And Acceptance Targets

Question: For the supplied VM sizes, what normal/peak workload and measurable performance targets must be supported?

Required inputs: total/online players; concurrent CMS users and uploads; media library size and total bytes; typical/max file and document size; conversion/capture concurrency; simultaneous webpage slots; chat traffic; screenshot/heartbeat rates; publish/emergency fanout. State accepted API p95/p99/error rate and end-to-end publish/emergency display delay, including fallback operation.

Why this changes testing: Load, stress, spike, soak and resource limits cannot get meaningful pass/fail thresholds from VM RAM/CPU alone.

Observed implementation: There are bounded payloads, caches, job retries, queue limits and resource-policy fields, but configured ceilings and historical test constants are not approved site SLOs.

Evidence: `scripts/bundle/production-bundle-config.mjs`; `darshan-server/src/jobs/index.ts`; `darshan-server/src/services/command-lifecycle-service.ts`; `darshan-player/src/main/services/offline-replay-budgets.ts`; user's five-VM resource table.

Affected areas: all core journeys; BR-064; performance/load/stress/spike/soak, capacity, observability and release readiness.

Code answer, 2026-09-25: The builder checks approved measured capacity evidence containing `max_players` and reviewed limits; the capacity template's sample 500 is not site evidence. Resource ceilings, queue bounds and five VM sizes do not establish throughput or p95/p99. See `evidence/operational-behavior-review.md::BQ-017`.

Human input still needed: Actual approved capacity evidence/profile or site workload, plus numerical response/propagation targets. The plan can describe load, stress, spike and soak methods; pass thresholds remain TBD. No load will be executed in this task.

### BQ-018: Recovery And Update Commitments

Question: What maximum data-loss window (RPO), maximum recovery time (RTO), and maintenance downtime are acceptable? Which currently deployed backend/schema/player versions must be supported for update/adoption, and how long may mixed compatible versions remain in use?

Why this changes testing: Backup availability is not proof of meeting a recovery deadline; an old-image rollback may be incompatible with migrated data. Upgrade baselines determine fixtures and restore scenarios.

Observed implementation: Managed upgrades stop API/worker and require independently signed restore evidence; legacy adoption uses fingerprints/ticket; restore uses a clean isolated target. Compatibility generation is checked, but that is not a complete supported-version policy.

Evidence: `scripts/bundle/assemble-runtime-bundle.sh::write_backend_lifecycle_scripts`, `write_compatibility_check`; `darshan-server/src/deployment/migration-ledger.ts`; `darshan-server/scripts/restore-offhost-backup.ts`; `darshan-server/src/deployment/restore-evidence.ts`.

Affected areas: UC-001, UC-014, UC-027, UC-028; BR-044, BR-045, BR-065; release, migrations, partial updates, rollback and DR.

Code answer, refreshed 2026-10-28: The managed upgrade remains a maintenance flow: verify compatibility and signed restore evidence, stop API/worker, migrate forward, start/check, mark active. Packets 1 and 2 coordinate and seal a bounded consistent capture. Packet 3 adds tested configuration-capsule, deterministic packaging, pinned native `age`, signed-manifest, atomic-publication and crash-reconciliation primitives. The worker now injects a pinned helper policy and publication inspector, but the actual privileged helper/cross-role capsule is not shipped, so production deployment is still incomplete and fails startup when helper policy is absent/invalid. There is no automatic database downgrade, local-retention service, clean local restore/promotion workflow or full-topology recovery proof. See `evidence/operational-behavior-review.md::BQ-018` and the three dated backup/recovery developer-verification reports.

Confirmed product targets: run a backup at least once every 24 hours, keep backups at least 30 days, automatically remove copies older than the approved retention period, restore service within 4 hours, and allow no more than 2 hours of planned maintenance downtime. These are acceptance targets, not evidence that the current implementation meets them.

Human input still needed: the maximum accepted data-loss window (RPO; a 24-hour schedule alone does not prove a 24-hour RPO), the exact daily time/timezone, deployed release/schema/player baseline and any supported mixed-version window. No actual production VM or recovery rehearsal was accessed. Identify release IDs only, not credentials.

### BQ-019: Network And Trust Acceptance Boundary

Question: Is the production site fully air-gapped or allowed outbound access to approved webpages and the explicit webhook Test action? Are any CMS/player/monitoring endpoints exposed outside the trusted LAN, and is HTTP inside a role's private Docker network an approved exception to cross-VM TLS? A working identity-provider login is excluded by BQ-005 and is not a required environment dependency.

Why this changes testing: The allowed network paths, denied egress, browser trust and required security controls differ materially across these deployment models.

Observed implementation: Generated cross-VM application and monitoring links verify TLS, with HTTP exporter hops inside role networks; webpage egress has allowlists; external integrations need actual reachable dependencies if required.

Evidence: `scripts/bundle/assemble-runtime-bundle.sh` proxy/metrics-gateway generation; `darshan-server/src/utils/webpage-url-policy.ts`; `darshan-server/src/routes/webhooks.ts`; `darshan-player/src/main/services/network/transport-tls.ts`.

Affected areas: UC-005, UC-007, UC-013, UC-025..UC-028; BR-066; security, integrations, certificates, offline installation and observability.

Code answer, 2026-09-25: Production generates TLS for cross-VM application and monitoring paths; several local proxy/exporter hops inside role networks use HTTP. Webpage and explicit webhook-test egress depend on allowlists. The runbook gives intended firewall source/port paths, but checked-in code cannot prove the VMs' actual rules. See `evidence/operational-behavior-review.md::BQ-019`.

Human input still needed: The site's approved external egress, LAN/public exposure and acceptance of private-role-network HTTP. No private key or secret is needed.

### BQ-020: Meaning Of Delete

Question: Should a user-facing media delete be recoverable through a recycle bin/undelete window, or immediately remove stored files once reference checks allow it? Does the same recoverability requirement apply to chat attachments and deleted accounts?

Why this changes testing: A retained DB row alone does not preserve a deleted file. Recovery expectations must match both storage and metadata behavior.

Observed implementation, refreshed 2026-10-16: Media's soft-delete path still retains metadata but attempts to delete object data and marks it FAILED. References can prevent deletion, and chat cleanup remains separate. Account deletion is now a permanent tombstone: it retains identity/history and stable content ownership, scrubs email/credentials, revokes access and stops incomplete uploads. It does not provide restore or automatically transfer assets to a person.

Evidence: `darshan-server/src/routes/media.ts` delete handler; `darshan-server/src/db/repositories/media.ts`; `darshan-server/src/jobs/index.ts`; `darshan-server/src/db/repositories/user.ts::tombstone`; migration `0045`; `evidence/deleted-user-ownership-review.md`.

Affected areas: UC-003, UC-005, UC-008..UC-012, UC-021, UC-028; BR-015, BR-062, BR-084..090; destructive actions, retention, attribution, referential integrity and recovery.

Code answer, 2026-09-25: Media soft delete still attempts object deletion and retains a FAILED row without storage pointers; hard delete removes both where possible. In-use checks can block deletion. Unreferenced chat media has a separate asynchronous cleanup path. No universal recycle-bin route is demonstrated. See `evidence/operational-behavior-review.md::BQ-020`.

Account-deletion decision received 2026-10-16: deleted accounts are not user-restorable and are not physically removed while referenced history exists; retained content stays with its original department/organization and no automatic person-to-person reassignment occurs. The original display name remains for history, but the old email is not shown. This resolves the account portion under BR-084..090.

Human input still needed: whether a user-facing recycle/undelete period is required for independently deleted Media and chat attachments. Do not apply the account-tombstone decision to those object-deletion workflows.

### BQ-021: SSO Configuration Delegation Granularity

Question: Must SSO configuration access always be organization-wide through unconditional `read`/`update SsoConfig` grants, or should a custom role be able to view or deactivate only a named provider record? If record-limited access is required, should its client secret be returned to that reader?

Why this changes testing: The current list exposes active-provider configuration, including its client secret, while upsert changes the organization-wide active provider. A record condition has no safe meaning for the full list or provider replacement; permitting individual-provider delegation would need an explicit detail/deactivate contract and secret-display policy.

Observed implementation, 2026-10-22: the P01 source now requires unconditional effective SSO read/update for list, upsert and deactivate. The CMS route guard and mutation controls use the same subject-wide rule. This is a fail-closed implementation choice, not a user-confirmed delegation policy. The API/browser scenarios are authored but not run.

Evidence: `darshan-server/src/routes/sso-config.ts`; `darshan-server/src/db/repositories/sso-config.ts`; `darshan-cms/src/hooks/useAuthorization.ts`; `darshan-cms/src/pages/SsoConfig.tsx`.

Choices: keep unconditional organization-wide SSO administration (current fail-closed behavior); or design separate record-scoped endpoints and secret-redaction rules before permitting narrower delegation.

Affected areas: UC-004; BR-009/092; `AUTHZ-14`; SSO API, CMS route/form and credential confidentiality.

Answer: TBD — NEEDS_BUSINESS_CONFIRMATION. Until answered, QA verifies the current fail-closed behavior but does not claim that SSO delegation policy is product-approved.

### BQ-022: Pending Invitation Login

Question: May a newly invited user sign in with the temporary password before using the activation link, or must activation happen first? If immediate temporary-password login is allowed, should the invitation remain PENDING and expirable after successful login?

Why this changes testing: The answer determines whether a manager-visible credential can create a session before the invitee proves possession of the activation token. It also determines the expected status and account-recovery flow after an invite expires.

Observed implementation before the answer, 2026-10-22: invite creation stores a generated password hash and PENDING token metadata, while the users table defaults `is_active=true`. Login checked password and `is_active`, but not invite status or expiry, so possession of the temporary password appeared sufficient to log in before activation. The activation endpoint also requires the user to be active. An older feature inventory calls new invites “dormant,” which conflicted with the route/schema behavior; no live login was run. The current uncommitted implementation adds invitation-state checks at password login, token/session verification and mutation reauthorization. Its offline unit checks pass, but the database-backed lifecycle test has not run.

Evidence: `darshan-server/src/routes/users-invite.ts::userInviteRoutes`; `darshan-server/src/routes/auth.ts::authRoutes`; `darshan-server/src/routes/users-activate.ts::userActivateRoutes`; `darshan-server/src/db/schema.ts::users`; `docs/qa/FEATURE_INVENTORY.md::BE-004`.

Choices: require token activation before any login (recommended; needs an explicit pending-invite login check and lifecycle tests); or allow immediate temporary-password login and define when PENDING becomes ACTIVATED.

Affected areas: UC-002/003; BR-012; `AUTHN-03`; invitation API, account state and CMS onboarding.

Answer: The user selected **No—require activation first**, 2026-10-22. A PENDING or expired invitation must not create a session from its temporary password. Activation must consume the token and set the invitee's chosen new password before login. This is a confirmed business rule (BR-108), not proof of runtime compliance.

### BQ-023: Lost One-Time Invitation Link

Question: If the manager closes the one-time link before sharing it, may a permitted manager generate a replacement link for the still-PENDING account, invalidating the old token?

Why this changes testing: The current invite API rejects the existing email on a second invite and the invitation list deliberately omits tokens. Without replacement, an invitee can be stranded after an accidental close or failed delivery.

Observed implementation: The user chose a one-time copyable manager link instead of automatic email. The CMS shows the link after creation and, in the current uncommitted source, adds a confirmation-based replacement action for pending/expired invitations. The server rotates the token under a row lock, rechecks actor authority and returns the new token once. The old token no longer matches the account. The route/browser regressions are authored but not runtime-executed.

Evidence: `darshan-cms/src/pages/Users.tsx`; `darshan-server/src/routes/users-invite.ts`.

Choices: allow authorized replacement with old-token invalidation; or require a separate administrator recovery procedure.

Affected areas: UC-002/003; BR-108; `AUTHN-03`; pending invitation lifecycle and credential safety.

Answer: The user selected **Yes, add replacement link**, 2026-10-22. A permitted manager may replace a still-PENDING invitation (including one whose token expired); the old link becomes invalid and the new link is shown once. Activated, disabled and deleted accounts are not eligible. This is a confirmed business rule, not proof of runtime compliance.

### BQ-024: Temporary Password In Invitation Response

Question: Since activation is mandatory, should `POST /api/v1/users/invite` stop returning an unused temporary password to the manager, or retain that response field for a documented compatibility need?

Why this changes testing: The temporary password cannot sign in but is still a credential-like secret exposed by the API, while the CMS uses only the activation token. Removing it changes the API contract; retaining it requires a clear reason and handling policy.

Observed implementation before the answer: invite creation generated, hashed and returned `temp_password`, but the CMS invitation flow neither declared nor used that field and pending login was denied by BR-108. A repository-wide source scan found no invite consumer outside database-backed denial tests. This is separate from the authorized **reset-password** response: Operators display that generated reset password, so BQ-024 does not remove the reset-password field.

Evidence: `darshan-server/src/routes/users-invite.ts`; `darshan-cms/src/api/domains/users.ts`; `darshan-server/src/auth/invite-state.ts`.

Choices: remove the invite-create field and store a high-entropy, unreturned placeholder hash until activation (recommended); or retain it temporarily for a specifically identified external API consumer, never treating it as a login method. The reset-password response is unchanged in either choice.

Affected areas: UC-002/003; BR-108; `AUTHN-03`; API compatibility and secret exposure.

Answer: The user selected **remove the invite temporary password**, 2026-10-27. `POST /api/v1/users/invite` returns only the one-time activation credential and invite metadata. The server stores a high-entropy, unreturned placeholder hash until activation replaces it with the invitee's chosen password. The separate authorized reset-password response is unchanged. This is confirmed product behavior; PostgreSQL/API/browser execution remains a separate developer and QA gate.

### BQ-025: Deleting A Screen Still Targeted By A Schedule

Question: What should happen when an administrator deletes a Screen that is still directly listed in a current or future Schedule item (or an active Emergency selector)?

Why this changes testing: Schedule targets are JSON arrays rather than foreign keys. Silently removing the last direct Screen ID can produce an empty target list, and current playback filtering treats an item with no Screen/group targets as global. A cleanup intended for one decommissioned Screen could therefore make content eligible on every Screen.

Observed implementation: Screen deletion removes reservations, publish targets, group membership, default-media targets and operational/device rows. It does not rewrite `schedule_items.screen_ids`, immutable publish snapshots or Emergency selector JSON. Consequently, a deleted ID can remain in authoring state, while automatically pruning it would be unsafe under the current empty-means-global rule. The latest source explicitly cleans non-foreign-key command/display/telemetry rows but deliberately does not invent a Schedule/Emergency policy.

Evidence: `darshan-server/src/routes/screens.ts` DELETE handler; `darshan-server/src/db/schema.ts::scheduleItems,publishTargets,emergencies`; `darshan-server/src/routes/screens.ts::filterItemsForScreen`; `darshan-server/src/screens/playback.ts` target filtering.

Choices: block deletion while any active/current/future mutable Schedule item or active Emergency directly targets the Screen, returning actionable reference counts (recommended; preserve immutable publish/history snapshots); or define a transactional retarget/removal rule that can never convert the item to global scope. Allowing stale mutable targets is not recommended.

Affected areas: UC-015/017/019; BR-013/029/033; `AUTHZ-19`, `DATA-02`, `CONC-07`; Screen deletion, Schedule authoring/publish and Emergency targeting.

Answer: TBD — NEEDS_BUSINESS_CONFIRMATION. Until answered, QA must treat deleting a still-targeted Screen as release-blocking ambiguity and verify that no deletion path broadens content to all Screens.

### BQ-026: Deleting A Screen Group Still In Use

Question: What should happen when an administrator deletes a Screen Group that is still referenced by a current/future Schedule item, active publish, active Emergency, or group-targeted default-media assignment?

Why this changes testing: Group membership and all four target references are stored without a foreign key. Current deletion removes the group and memberships and refreshes the former member Screens, but it does not rewrite Schedule/Emergency/default-media JSON or historical publish targets. The stale group ID does not become global by itself, yet current playback/default behavior can stop without an explicit operator decision and unusable references remain.

Observed implementation: group create/update/delete and member-device serialization are now transactional in source. Deletion still intentionally leaves target references untouched because pruning the last Schedule group target could produce the same empty-target/global ambiguity as BQ-025, while rewriting immutable snapshots would corrupt history.

Evidence: `darshan-server/src/routes/screen-groups.ts`; `darshan-server/src/db/repositories/screen-group.ts`; `darshan-server/src/db/schema.ts::scheduleItems,publishTargets,emergencies,settings`; `darshan-server/src/routes/settings.ts`.

Choices: block deletion and return counts/identifiers until mutable active references are retargeted or cleared (recommended); allow deletion only through an explicit force workflow that records exactly which mutable references become inactive; or silently leave stale references (not recommended). Immutable publish/history snapshots remain unchanged in every choice.

Affected areas: UC-018/019/024; BR-023/068/092/101; `AUTHZ-19`, `DATA-02`, `DEF-01..03`, `CONC-07`; playback refresh and operator messaging.

Answer: TBD — NEEDS_BUSINESS_CONFIRMATION. Recommended: transactionally block ordinary deletion while any mutable current/future Schedule, active publish, active Emergency or group-default assignment references the group; return actionable counts, require the operator to resolve them, and preserve immutable history.

### BQ-027: Local Backup Trust, Configuration And Failure Domain — RESOLVED

Question: For `LOCAL_FILESYSTEM` production backup, which authority may sign,
publish and delete backups; which VM roles must contribute recovery configuration;
must an independent encrypted copy exist outside the Backend VM/site; and what exact
daily time/timezone and failure domains are promised?

Why this changes testing: The worker currently needs write access to the repository,
but giving a network-facing application process deletion and signing authority lets one
compromise destroy earlier copies or sign misleading evidence. A Backend-only capsule
cannot recreate secrets and deployment state owned by Data, CMS, Valkey and
Observability roles. A local repository also disappears with its host/site unless a
separate copy exists.

Observed implementation, refreshed 2026-10-28: Packet 3 provides strict capsule
validation, deterministic encrypted packages, a signed-manifest interface, atomic
publication, database fencing, restart reconciliation and offline discovery. The
production worker now negotiates a pinned helper policy and injects its configuration
contract, signer/verifier and publication inspector. The source still does not ship the
actual privileged helper/service, exact cross-role capsule producer or an independent-
copy implementation, so production deployment remains incomplete and fails at startup
when the configured helper is absent or invalid.

Evidence: `darshan-server/src/utils/backup-runs.ts::runFullBackup`;
`darshan-server/src/jobs/index.ts`; `darshan-server/src/backups/local-backup-orchestrator.ts`;
`evidence/backup-recovery-packet-03-developer-verification-2026-10-28.md`.

Confirmed answer (current backup/recovery goal):

1. Use a narrow deployment/host helper on the Backend host. The API receives no
   unrestricted host or Docker access. Implement it as a root-owned Unix-socket broker
   or equivalently isolated fixed-operation helper that accepts only structured
   site/run/attempt/capture operations—never arbitrary commands, paths or signing.
2. Use a dedicated Ed25519 manifest-signing key, separate from the public `age`
   recipient/private recovery identity, release-signing key and recovery-attestation
   key. Keep the private `age` identity outside all application VMs.
3. Include the versioned recovery configuration required to reconstruct every deployed
   role (Data, Backend, CMS, Valkey and Observability), with secrets staged through the
   deployment/rotation process rather than read across VMs by the worker.
4. Require an independent encrypted copy outside the Backend VM/shared site when the
   deployment promises shared-host/shared-disk/whole-site recovery. The local repository
   covers Data-VM loss only while the Backend backup disk survives.
5. Deployment must supply the daily time/timezone, repository identity/device/owner and
   capacity, age recipient/key ID, manifest trust/key-rotation data, exact configuration
   inventory/source locations and the site failure-domain promise. The 4-hour RTO,
   2-hour planned-maintenance limit and 30-day minimum retention are already confirmed.

Answer: RESOLVED — CONFIRMED BUSINESS/ARCHITECTURE RULE. Remaining values are
site/deployment inputs and measured release evidence; they are not permission to weaken
the narrow helper, key separation, encryption, retention or failure-domain rules.

## Answer And Resolution Log

| Batch | Questions | Status | Business source |
| --- | --- | --- | --- |
| 1 | BQ-001, BQ-005, BQ-006 | Resolved for stated release scope | User answers, 2026-09-24 |
| Document-page delta | BQ-001 | Superseded: occurrence-level static page selection; legacy defaults to page 1 | User request, 2026-10-15 |
| Document playback follow-up | BQ-001 | All players updated/connected before page >1; invalid runtime page is Unavailable without substitution | User requirements 19-20, 2026-10-17 |
| 1 follow-up | BQ-002, BQ-003 | Core rules resolved; separate edge-policy limits documented | User follow-up answers, 2026-09-24 |
| 1 follow-up | BQ-004 | Exact authenticated-success +120s deadline, targeted media purge, all-authority stop and ordered fresh recovery confirmed | User requirement 24, 2026-10-17 |
| 2a | BQ-008 | Fixed built-ins/custom-role customization confirmed | User answer, 2026-09-24 |
| P01 startup follow-up | BQ-008 | Canonical built-in name with `is_system=false` stops startup for review; no automatic promotion | User answer, 2026-10-22 |
| 2a | BQ-009 | Immediate withdrawal recorded as the intended acceptance rule; implementation gap retained | Latest user follow-up, 2026-09-24 |
| 2b | BQ-010 | Self-approval and direct administrator publish confirmed | User answer, 2026-09-25 |
| Access/content follow-up | BQ-007 | Ownership, directory and template-sharing policy resolved under BR-048 and BR-084..093 | User decisions, 2026-10-16 |
| Web/default follow-up | BQ-011..BQ-012 | Resolved under BR-097..101 | User decisions, 2026-10-17 |
| PoP characterization | BQ-013 | Code behavior recorded; acceptable evidence loss/offline retention pending human input | Source review, refreshed 2026-10-21 |
| Ownership delta | BQ-007, BQ-020 | Stable organization/original-department ownership and permanent user tombstones confirmed; account portion resolved; directory and Media/chat recycle policy remain separate | User product decision and source implementation, 2026-10-16 |
| P01 SSO permission audit | BQ-021 | Current unconditional-only SSO access is implemented fail-closed; product delegation granularity remains unanswered | Source/contract review, 2026-10-22 |
| P01 invitation audit | BQ-022 | Activation-before-login confirmed; prior source gap addressed in current uncommitted code, runtime still pending | User answer and source/contract review, 2026-10-22 |
| P01 invitation delivery | BQ-023..024 | One-time manager copyable link and replacement confirmed; invite-create temporary-password response removed while reset-password remains unchanged | User answers and source/contract review, 2026-10-22 and 2026-10-27 |
| P01 Screen lifecycle audit | BQ-025 | Direct Schedule/Emergency target behavior on Screen deletion is unresolved; block-while-live is recommended because empty targets mean global | Source/contract review, 2026-10-27 |
| P01 Screen Group lifecycle audit | BQ-026 | Schedule/publish/Emergency/default references on group deletion are unresolved; block-while-active is recommended and immutable history must remain unchanged | Source/contract review, 2026-10-27 |
| Backup/recovery Packet 3 trust gate | BQ-027 | Resolved: narrow Backend host helper, separated keys, cross-role recovery configuration, conditional independent copy and deployment-supplied schedule/failure-domain inputs | Confirmed backup/recovery goal and source/developer evidence review, 2026-10-28 |
| 2c | BQ-014 | Code behavior recorded; reporting meaning/timezone pending human input | Source review, 2026-09-25 |
| 3 | BQ-015..BQ-020 | Code behavior recorded; seven site/product answers remain, with account deletion already resolved inside BQ-020 | Source review, refreshed 2026-10-21 |

No question asks the user to discover implementation details that can be inspected locally. Answers define intended outcomes, release scope and operational commitments. Existing evidence of a behavior remains available even when the user chooses a different requirement.
