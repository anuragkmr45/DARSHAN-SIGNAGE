# Code-Derived Expectations For QA

Baseline: beta6 delivery/availability/observability developer-evidence tip
`6a34b2f`, source-reviewed through 2026-11-02. These are code expectations,
**not independent QA proof**. The webpage/default delta is reviewed in
`evidence/webpage-default-priority-review.md`; developer commands are in
`evidence/webpage-default-priority-developer-verification-2026-10-17.md`.
The current playback/recovery delta is recorded in
`evidence/playback-recovery-developer-verification-2026-10-21.md`; two current
Linux Electron runtime passes are recorded and independent QA remains pending.
The current beta6 delta is recorded in
`evidence/dashboard-observability-report-developer-verification-2026-11-02.md`;
its five-VM, real-player and physical-display gates remain pending.
Catalogue cases remain `Not Tested` or `Partially Tested` until QA records its
own result.

The current operator-membership delta adds `user_additional_departments` and
an additive API/CMS contract while preserving the primary scalar field and
ownership. Current assigned departments affect permitted reads, directory
discovery, and new chat file sharing; existing message attachments and new
bookmarks with recorded share authorization remain conversation-scoped after a
source membership is removed. Legacy file bookmarks without share proof can
lose access after removal and require a release decision under `AUTHZ-16`.
Old PATCH requests that omit additional IDs preserve them; a
primary/additional collision returns
`409 PRIMARY_DEPARTMENT_CONFLICT`. Source and developer results are in
`docs/governance/operator-multi-department-membership.md` and the dated
verification artifact; independent `AUTHZ-14..18` execution remains open.

When a user-confirmed rule disagrees with code, report the observed difference against that rule even if the software behaves exactly as this sheet predicts. For code-only topics, report the observed behavior and its risk; do not call an insecure behavior a security pass merely because it matches source. Site-specific commitments without a value in code remain unscored until the release owner supplies an acceptance target.

| Topic | Expected from current code, to verify | Requirement or scope boundary | QA cases |
| --- | --- | --- | --- |
| Deleted user and content ownership (BR-084..090) | DELETE tombstones the account, scrubs email/credentials/invite metadata, revokes sessions, disconnects user sockets, aborts unfinished uploads and preserves stable identity/history. Media/Layout/Presentation/Schedule store organization, original-department or restricted ownership independently of `created_by`. Central ability+owner checks cover CRUD, nested Presentation/Schedule references and Schedule Requests. CMS returns stable owner, creator status and server action flags. | User-confirmed 2026-10-16: never auto-transfer assets to another person; department/organization custody and historical creator remain; old email is hidden; unfinished uploads cannot become playable; existing published playback is unchanged. No restore/reassignment UI. Runtime/migration/race verification is still required. | `AUTHZ-07`, `DATA-06`, `CONC-07`, `UI-07` |
| Video failure, loop and boundary (BR-083/104..106) | CMS/API keep loop occurrence-specific. Player uses one native-loop element and decoded-duration modulo. A corrupt multi-item video is disposed, shows `Unavailable`, and advances only at its original boundary. A failed only-item layout/fullscreen frame retries at clamp(duration,1–30 seconds) with one timer/attempt bound to the current authority generation. Every schedule end clips the timeline and disposes display/audio/callbacks immediately. | Loop On repeats complete cycles while active. Schedule end is universal and must clear within 250 ms. Every snapshot/emergency/default/security/disposal authority change cancels retries; Windows/physical runtime and soak remain. | `FUN-02`, `UI-06`, `API-07`, `PLAYER-11..15`, `OBS-04`, `PERF-06` |
| BQ-001 Documents | Native and converted documents remain PROCESSING until PDF.js obtains the final physical page count. Each occurrence stores one selected page (legacy default 1); CMS preview, immutable snapshot, player fingerprint/rendering and PoP carry it end to end. Page >1 is blocked until every concrete updated target reports `pdf_page_selection_v1`. A restored value made invalid remains visible/blocked; runtime mismatch shows exact `Unavailable` and never substitutes a page. | Accepted document extensions are `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.csv`. All release players are upgraded and connect once; mixed-version playback is not an accepted mode. | `FILE-03`, `FILE-04`, `FILE-06`, `UI-05`, `API-05`, `API-06`, `DATA-05`, `CONC-06`, `PLAYER-10`, `OBS-03`, `COMP-04`, `PERF-05` |
| BQ-002 User hierarchy | The repository transaction locks the SUPER_ADMIN role and prevents delete/disable/demotion of the last active direct SUPER_ADMIN with `LAST_ACTIVE_SUPER_ADMIN`; one of multiple active accounts may be removed. Global User managers can administer user types subject to this invariant. | Matches the latest confirmed last-active-SUPER_ADMIN rule; concurrency and recovery CLI need runtime proof. | `AUTHZ-01` |
| BQ-003 Emergency delegation | `manage Emergency` grants global/group/direct control. Conditional `update Screen` delegates can trigger/view/clear only emergencies composed entirely of explicitly authorized direct screens. Group/global/mixed delegation is denied; mutation authorization is rechecked transactionally. | Matches the selected-screen delegate and scoped-clear rules; CMS/API/player runtime remains. | `AUTHZ-03`, `FUN-07` |
| BQ-004 Offline lock/recovery | Generated production player bundles and checked examples configure secure/backend-required playback. The secure deadline is exactly last authenticated backend success + 120 seconds; legacy grace keys cannot extend it. Lock stops schedule/default/emergency and purges only media cache. While locked, heartbeat only marks reachability and starts one recovery; identity validation, forced fresh snapshot, current-content sync/check and authority apply occur before unlock. Snapshot failure stays locked with 2–30 second retry; invalid identity re-pairs; fresh-authority media failure shows `Unavailable`. | Matches confirmed requirements 22/24. Identity/certificates/logs/PoP/request queues are preserved and stale cached authority cannot resume. Two real 120-second Linux Electron recovery journeys passed; independent QA remains. | `PLAYER-03`, `PLAYER-04`, `PLAYER-16` |
| BQ-005 Integrations | Management UI/API persists SSO, API-key and webhook settings; explicit webhook Test can make an outbound request. No complete SSO login, API-key request-authentication or automatic event delivery path was found in the inspected registrations. | Management only is user-confirmed release scope; exposed Test-action security still matters. | `FUN-12`, `API-04` |
| BQ-006 General Requests | The general Requests route is not registered and its CMS page/client/navigation, report counts and webhook choices are removed. Legacy database tables remain. Schedule Requests remain registered. | Matches the release-scope decision; built-route and Schedule Request runtime smoke remain. | `AUTHZ-06`, `SEC-01` |
| BQ-007 Sharing and directory | Media/Layout allow permitted same-department reads with creator/global-manager mutation. Presentation has the same mutation rule plus nested scope closure. Schedule permits action-specific same-department management. ADMIN-created content is organization-shared; SUPER_ADMIN-created content is restricted. Non-global user/operator/invite/chat directories show active same-department people only; global `manage User` is the exception. | Matches the confirmed resource and directory matrix; runtime actor/action coverage remains. | `AUTHZ-08..13`, `SEC-01`, `UI-07` |
| BQ-008 Custom roles | Feature access uses effective CASL action/subject/record permissions, inheritance and conditions rather than custom role names. Role-name identity remains for protected system-role hierarchy and content classification. | Matches the custom-role rule; static regression passed and runtime conditional/inheritance coverage remains. | `AUTHZ-02` |
| BQ-009 Access withdrawal | Account/password and direct/transitive permission changes revoke affected sessions transactionally. Invalidation is broadcast across API nodes, local user rooms disconnect, and each protected socket action re-verifies its stored token/session. | Core withdrawal is source-implemented; live multi-node propagation, Valkey failure and in-flight boundaries remain runtime work. | `AUTHN-04`, `AUTHZ-02`, `CONC-07` |
| BQ-010 Schedule approval | Admin-like approval/publish path does not reject a request because its author is the approver; direct admin publish is implemented. Other hold/revision/conflict checks still apply. | Self-approval and direct admin publishing are user-confirmed. | `FUN-04`, `CONC-01` |
| BQ-011 Webpages | Policy-controlled HTTP and HTTPS use the same scheme/host/port/DNS/CIDR checks on the initial URL and every redirect/navigation. Source defaults disable HTTP; release config explicitly enables it. URL credentials, HTTP authentication and persistent login profiles are unsupported. Manual and 24-hour due refresh publish a new revision/checksum only after success; failure preserves the last successful preview. Snapshots/defaults propagate revision identity and the player caches by revision with older-valid fallback. | Confirmed by BR-097..100. HTTP remains cleartext risk; login-required content is out of scope. Real controlled-network/object-store/physical-player execution remains. | `FUN-08`, `PLAYER-09`, `WEB-01..06` |
| BQ-012 Default media | Eligible SCREEN wins, then eligible GROUP by priority descending and target ID ascending, then ASPECT_RATIO, GLOBAL, NONE. Priority is integer `0..100`; legacy/missing is `0`; media/order edits that omit priority preserve it. Settings expected revision plus a transaction advisory lock yields one commit and one `409` for competing same-revision saves. When the resolver reaches NONE, current player code renders a text-only `No content assigned yet` state. | Priority behavior matches BR-101. **Conflict with BR-102:** no Schedule/default must show the approved standard company image, not the current text-only state. | `FUN-06`, `DEF-01..04`, `PLAYER-05` |
| BQ-013 Proof of play | Memory buffer is bounded to 100 events/512 KiB; pending spool to 32 files, 50 events/file and 2% of cache capacity clamped to 1-16 MiB. Old pending files can be discarded with counters. Abrupt crash/write errors can lose events; media-lock purge leaves already-spooled files intact. No offline-time guarantee exists. | Code characterization only; matching these bounds does not prove lossless evidence. | `PLAYER-07`, `DATA-04`, `PERF-04` |
| BQ-014 Reporting | Historical availability uses server-received heartbeats, a 90-second stale threshold, backend readiness gaps as unknown, and uptime over known time only. Never-seen Screens remain unknown and display `Never seen`; daily buckets use `Asia/Kolkata`. Assigned, player-applied, reporting-playback and publish-linked PoP are distinct evidence levels. The legacy `screen_uptime_percent` remains compatibility-only and `current_screen_active_percent` names its current-state meaning. | PoP is player-reported evidence, not proof of physical pixels. Bounded replay can still lose evidence under the BQ-013 contract. | `FUN-11`, `UI-04`, `OBS-03`, `PLAYER-07` |
| BQ-015 Retention | Production backup check runs hourly against configured `BACKUP_INTERVAL_HOURS`; weekly log archive copies records. A 30-day old-log deletion handler and off-host prune function exist but no non-test caller was found. Prometheus retention defaults to configurable 30d. | Configured values are not legal retention policy or proof that deletion occurs. | `BKP-01`, `PERF-04` |
| BQ-016 Platforms | Packaging/docs target Windows x64 NSIS and Ubuntu desktop deb/AppImage; macOS is development-only. Ubuntu audit targets 22.04+ with X11 primary and Wayland degraded. CMS automated browser config has a Chromium project. | Package/test targets are not proof of native support on the site's exact devices/browsers. | `COMP-01`, `COMP-02`, `COMP-03`, `UI-03` |
| BQ-017 Capacity | Bundle configuration requires approved measured capacity evidence with site/release/profile/`max_players` and enforces configured container limits. The template's 500-player entry is only sample data. | No actual fleet size, load profile, p95/p99 or propagation deadline can be derived from VM sizes or template values. | `PERF-01`, `PERF-02`, `PERF-03` |
| BQ-018 Updates/recovery | Managed backend upgrade checks signed restore/compatibility evidence, stops API/worker, applies forward migrations, restarts/checks readiness and marks release active. No automatic schema downgrade exists. | Code does not establish the deployed baseline or measured RPO/RTO/downtime. | `DEP-03`, `BKP-02`, `BKP-03` |
| BQ-019 Network/TLS | Generated cross-VM application paths use TLS; some local role-network exporter/proxy hops use HTTP. Webpage and explicit webhook-Test egress depend on allowlists/configuration. | Checked-in firewall instructions cannot prove actual VM exposure, approved egress or site trust policy. | `DEP-06`, `SEC-02`, `API-04` |
| BQ-020 Delete | Media soft/hard delete and chat cleanup remain separate object-removal workflows. User deletion now retains a permanent tombstone with stable name/ID/history, scrubs access-bearing identity data, preserves content `created_by`, and does not transfer or delete completed content. Incomplete upload cleanup is abort/fail/retry based. | Account behavior is user-confirmed with no restore/reassignment promise. A retained Media row is still not an undelete feature; Media/chat recycle periods remain undecided. | `FILE-05`, `BKP-01`, `DATA-06`, `CONC-07`, `UI-07` |

## Source Detail

- Access/content rules: `darshan-server/src/rbac/content-ownership.ts`; `darshan-server/src/routes/users.ts`, `media.ts`, `layouts.ts`, `presentations.ts`, `schedules.ts`, `schedule-requests.ts`; migration `0045`; `evidence/deleted-user-ownership-review.md`. `evidence/content-runtime-review.md` remains historical for behavior not superseded by the 2026-10-16 decision.
- Webpages/defaults/PoP: `darshan-server/src/utils/webpage-url-policy.ts`, `jobs/index.ts`, `routes/settings.ts`, `default-media.ts`; migration `0047`; `darshan-cms/src/pages/MediaLibrary.tsx`, `components/settings/DefaultMediaSection.tsx`; player webpage policy/view/cache/renderer services; PoP replay budget services.
- All other topic-specific anchors: `02_BUSINESS_QUESTIONS.md`, `evidence/policy-behavior-review.md`, and `evidence/operational-behavior-review.md`.

## Inputs That Code Cannot Supply

Release owners, not QA observation, must provide actual site-specific target values where acceptance depends on them: approved fleet/workload and latency targets; RPO/RTO and maintenance allowance; data-class retention/legal-hold and recoverability policy; exact supported player hardware, OS/browser/accessibility matrix; and real site network exposure/egress policy. The current code behavior above is the starting characterization for all other topics. If product owners choose a different rule, record that decision against its BQ/BR ID before scoring acceptance. QA should leave actual behavior blank until execution; no human is being asked to rediscover source behavior.

## Live broadcast implementation delta — 2026-11-03

Starting-source checkpoint `499bcdf`: schedule items require presentation_id;
there is no LIVE source/receiver. Reservations expand groups, but hold reuse
checks schedule revision/count; snapshots and summaries filter current group
membership; cache protection concerns currently playing items; delivery Success
acknowledges a cached/applied snapshot. These are discoverable baseline facts,
not the accepted live contract and not live runtime evidence.

The final source target is a scheduled live event/media source in the same
ordinary installed DARSHAN player and normal pairing/lifecycle/cache/emergency.
A temporary developer prototype establishes only the media gate; its first-frame
event does not establish completed production lifecycle integration.

The implementation target is `BR-109..116` and [live contract](../docs/contracts/live-broadcast.md).
Loop 0 baseline application evidence and loop 1 prototype evidence are recorded;
their remaining gates stay open. Commit `e634150` adds a private tmpfs watchdog
requirement and verified occurrence cache pins. Player regression passed 428
unit / 5 integration / 21 fault checks; those pins are not yet integrated into
normal-player live playback. Direct host pidfd signalling remains unverified in
the production service context. The current scheduling foundation adds
migrations 0057/0058, live-source CRUD, LIVE draft fields, immutable asynchronous
fallback preparation and shared screen/live reservation services. Its 39-case
database/API packet and 68-case focused unit packet pass, as do the server build
and real local queued image/PDF/video preparation checks. Publication packet
`8041a50` connects frozen request/direct snapshots, current read ACL before URL
signing, group provenance and normalized reference guards. The actual service
verifier passed55 supporting checks/15 SHA downloads; publishing/read+authoring
passed the final62-check/4-file packet (25 publication/authoring,20 ACL and17
pure frozen-reader checks). Source
UI observations and final build details are in [publication evidence](evidence/live-publication-authorization-developer-verification-2026-11-03.md).
Normal-player live capability remains withheld: production run/admission
control, complete CMS workflow and the same-player coordinator are unfinished.
These foundations do not establish the complete CMS-to-player journey.
Update this checkpoint with each verified packet. Do not mark human cases Pass.

Current delta ledger: [evidence/live-broadcast-developer-verification-2026-11-03.md](evidence/live-broadcast-developer-verification-2026-11-03.md); cases `LIVE-01..20`.
