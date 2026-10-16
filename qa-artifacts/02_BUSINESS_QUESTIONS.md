# Business Questions

Status: SOURCE-BEHAVIOR ANSWERED FOR ALL 20 TOPICS. User-approved rules are identified separately. This file keeps the original questions as a decision/provenance log, not as requests for QA or the user to rediscover code behavior. Use `12_CODE_BASELINE_EXPECTATIONS.md` for concise current-code expectations and `05_TEST_CASES.csv` for blank actual results.

Source behavior for all BQ-001 through BQ-020 has been recorded. A question's remaining `TBD` means business approval or an actual site target is missing, not that code behavior is unknown. QA can characterize the implementation now; release acceptance for an undecided policy remains separate. Do not include passwords, keys, production tokens or customer data.

Unless a section says otherwise, historical observed behavior refers to its dated static baseline. BQ-002/003/006/007/008/009 were refreshed through source commit `8f66d8f`; their combined review is `evidence/authorization-session-requests-review.md`. Source references are repository-relative. These refreshed areas have build/bounded-test evidence but no new application runtime; migration, deterministic races, multi-process sockets and final frozen-candidate execution remain unverified. Earlier PDF/video and ownership runtime is separately linked.

## Batch 1: Core Behavior And Scope

### BQ-001: Document Playback

Question: Should a PDF or Office document converted to PDF display only its first page, allow an author-selected static page, or automatically show every page/slide?

Why this changes testing: A player showing only page 1 can be either correct or a blocking feature defect. Duration and page progression affect scheduling and PoP expectations.

Observed implementation updated 2026-10-15: scheduling stores one selected physical page per occurrence, previews and player playback render that page, and Office/CSV conversion produces the PDF whose physical page count sets the valid range. There is no automatic progression. Legacy missing values mean page 1.

Evidence: `darshan-player/src/renderer/pdf-playback.ts::render`; `darshan-server/src/jobs/index.ts` document conversion handler; `darshan-server/src/utils/libreoffice-conversion.ts`.

Choices: resolved to author-selected static page per occurrence, defaulting to page 1; all-page progression remains out of scope.

Affected areas: UC-006, UC-009, UC-017, UC-020; BR-017, BR-051; document fixtures, timing, renderer and UAT.

Answer: superseded by the user feature request on 2026-10-15: let the author choose the page while scheduling and show that page in preview and playback. The selection is static per occurrence; page 1 remains the compatibility default.

Resolution: RESOLVED. Author-selected static page playback per scheduling occurrence is the acceptance requirement; page 1 is only the legacy/default selection. Automatic progression through later pages is not required. Successful conversion/rendering, timing and error handling still require verification; this answer is not a test result.

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

Observed implementation: `standard`, `secure`, `high_security` and backend-required settings exist. Playback lease/grace and optional purge are separate from pairing-validation freshness. Production configuration must select the intended policy; defaults are not business approval.

Evidence: `darshan-player/src/common/offline-security-policy.ts::evaluateSecurePlaybackState`; `darshan-player/src/main/services/player-flow.ts`; `darshan-player/src/main/services/secure-playback-guard.ts`; `darshan-player/src/main/services/snapshot-manager.ts`.

Choices: availability-first cached playback subject to valid identity; security lock after an agreed interval; distinct approved profiles for different sites.

Affected areas: UC-014, UC-017, UC-019, UC-028; BR-027, BR-030, BR-031, BR-053; network isolation, recovery, emergency and privacy.

Answer: "lock". Business source: user answer BQ-004, 2026-09-24.

Follow-up answer, 2026-09-24: "2min and erase cash file, yes emergency should stop too". The user also requested checking actual code behavior.

Resolution: RESOLVED for intended behavior. Lock after two minutes of backend outage, remove cached media as part of locking and stop emergency playback as well (BR-053, BR-069). Do not extend cache deletion to identity/certificates/queued evidence without a requirement. Execution timing tolerance and purge-completion budget are not invented.

Code comparison: default standard mode disables secure locking and purge interval 0 disables purging; generated production player config omits overrides for these options. Secure-mode timing combines lease and grace, so 120,000 ms in the lock field alone does not enforce two minutes from physical disconnection. Lock branches suppress emergency content too; targeted media purge exists but needs failure/repopulation verification. See `evidence/policy-behavior-review.md::BQ-004`.

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

Question: Which webpages must this release support: public HTTPS pages, private intranet HTTPS pages, or pages needing an interactive login/SSO/session? When a live page fails or changes, is its captured preview an acceptable fallback, and is there a maximum acceptable preview age?

Why this changes testing: An isolated view and allowlist do not provide user-session login or guarantee that a captured page remains current. Egress and fallback fixtures depend on the promised use cases.

Observed implementation: Backend capture and player native views have network restrictions, isolated web content, bounded readiness/crash recovery and fallback handling. HTTP is blocked by the production policy.

Evidence: `darshan-server/src/utils/webpage-url-policy.ts`; `darshan-server/src/utils/webpage-capture.ts`; `darshan-player/src/main/services/webpage-view-manager.ts`; `darshan-player/src/main/services/webpage-network-policy.ts`; `darshan-player/src/renderer/webpage-playback.ts`.

Affected areas: UC-007, UC-017; BR-018, BR-058; redirects, dependent resource hosts, offline fallback and compatibility.

Answer received 2026-09-25: public HTTPS is conditional on allowlists, ports, DNS and trust; private HTTPS additionally needs an allowed private CIDR; HTTP is not allowed by production policy. Capture does not automate login or inherit CMS sessions. Player cookies can persist but do not establish unattended authentication. Recognized failures show a captured preview when supplied, otherwise "Live webpage unavailable"; the renderer has no preview-age rejection and may treat a visible login/error page as ready.

Resolution: ANSWERED AS IMPLEMENTATION BASELINE (BR-018). Record fixtures and limitations from `evidence/content-runtime-review.md::BQ-011`; do not promise login-required content works. The required webpage classes and business acceptance/maximum age of fallback content remain TBD under BR-058. Playback locking after backend loss remains governed separately by confirmed BR-053, even if a webpage preview is available.

Code-baseline expected result for QA: Allowed public HTTPS pages may load/capture only when host, port, DNS/address, network and certificate checks pass. Private HTTPS additionally needs an allowed CIDR; denied destinations and production HTTP are blocked. Capture does not authenticate to a protected page or import a CMS session, and a visible login/error page can pass the basic readiness probe. When native playback fails, an available captured preview is shown even while the backend is reachable; without one, the player says `Live webpage unavailable`. The renderer has no maximum-preview-age check. A fallback image URL is not proof that its image actually loaded. This characterizes code, not an approved promise to display stale or login-protected content.

### BQ-012: Competing Default Media

Question: If a screen belongs to two groups with different default media for its aspect ratio, which group wins, or should the second conflicting assignment be rejected?

Why this changes testing: Different assignment order can change what the viewer sees without an explicit priority presented to the operator.

Observed implementation: Screen overrides group; group overrides aspect/global. The matching group assignment is selected using the first stored match.

Evidence: `darshan-server/src/utils/default-media.ts::resolveDefaultMediaForScreen`; `darshan-cms/src/components/settings/DefaultMediaSection.tsx`.

Affected areas: UC-015, UC-018; BR-026, BR-059; group changes, fallback determinism and concurrency.

Answer received 2026-09-25: precedence is SCREEN -> first eligible saved GROUP -> ASPECT_RATIO -> GLOBAL -> NONE. Multiple-group selection follows saved assignment-array order, not explicit priority. Updating group A through the CMS filters its old assignment and appends the replacement, so [A, B] can become [B, A] and change the winner.

Resolution: ANSWERED AS IMPLEMENTATION BASELINE (BR-026), supported by resolver/CMS array operations in `evidence/content-runtime-review.md::BQ-012`. Include the order-changing edit as a regression characterization and risk. The user described, but did not explicitly approve, that business outcome; BR-059 remains TBD. Do not invent priority or conflict rejection as an existing requirement.

Code-baseline expected result for QA: The resolver selects the first eligible READY, aspect-matching SCREEN assignment, then the first eligible saved GROUP assignment whose group contains the screen, then ASPECT_RATIO, GLOBAL and NONE. With overlapping eligible groups saved as `[A, B]`, A wins. Changing A through the CMS removes and appends A, making `[B, A]`; B then wins. Overlap is not rejected and there is no explicit group priority. This is the current algorithm, not business approval of order-sensitive display changes.

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

Code answer, 2026-09-25: Production backups are enabled at a configured interval and the check runs hourly. Weekly archive copies log records, while the 30-day old-log deletion handler and off-host pruning function have no non-test callers found. Prometheus retention defaults to 30d and is configurable. Media, chat, screenshots and PoP use distinct lifecycles. See `evidence/operational-behavior-review.md::BQ-015`. These settings and unused handlers do not prove effective retention or any legal policy.

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

Code answer, 2026-09-25: The managed upgrade is a maintenance flow: verify compatibility and signed restore evidence, stop API/worker, migrate forward, start/check, mark active. There is no automatic database downgrade. Compatibility generation does not prove semantic compatibility. See `evidence/operational-behavior-review.md::BQ-018`.

Human input still needed: Approved RPO, RTO, planned downtime, deployed release/schema/player baseline and mixed-version support window. No actual production VM or recovery rehearsal was accessed. Identify release IDs only, not credentials.

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

## Answer And Resolution Log

| Batch | Questions | Status | Business source |
| --- | --- | --- | --- |
| 1 | BQ-001, BQ-005, BQ-006 | Resolved for stated release scope | User answers, 2026-09-24 |
| Document-page delta | BQ-001 | Superseded: occurrence-level static page selection; legacy defaults to page 1 | User request, 2026-10-15 |
| 1 follow-up | BQ-002, BQ-003 | Core rules resolved; separate edge-policy limits documented | User follow-up answers, 2026-09-24 |
| 1 follow-up | BQ-004 | Two-minute lock, media erasure, emergency stop confirmed | User follow-up answer, 2026-09-24 |
| 2a | BQ-008 | Fixed built-ins/custom-role customization confirmed | User answer, 2026-09-24 |
| 2a | BQ-009 | Immediate withdrawal recorded as the intended acceptance rule; implementation gap retained | Latest user follow-up, 2026-09-24 |
| 2b | BQ-010 | Self-approval and direct administrator publish confirmed | User answer, 2026-09-25 |
| 2b | BQ-007, BQ-011..BQ-013 | Code-derived answers recorded for characterization; unapproved policy expectations remain TBD | User answers and source review, 2026-09-25 |
| Ownership delta | BQ-007, BQ-020 | Stable organization/original-department ownership and permanent user tombstones confirmed; account portion resolved; directory and Media/chat recycle policy remain separate | User product decision and source implementation, 2026-10-16 |
| 2c | BQ-014 | Code behavior recorded; reporting meaning/timezone pending human input | Source review, 2026-09-25 |
| 3 | BQ-015..BQ-020 | Code behavior recorded; site policies and actual target state pending human input | Source review, 2026-09-25 |

No question asks the user to discover implementation details that can be inspected locally. Answers define intended outcomes, release scope and operational commitments. Existing evidence of a behavior remains available even when the user chooses a different requirement.
