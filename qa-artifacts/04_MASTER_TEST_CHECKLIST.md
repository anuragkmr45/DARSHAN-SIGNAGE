# Master Human QA Checklist

Baseline: beta6 observability/delivery candidate
`codex/dashboard-observability-report-audit-20261102` at developer-evidence tip
`6a34b2f`. Playback/recovery evidence is in
`evidence/playback-recovery-developer-verification-2026-10-21.md`; beta6
delivery/availability/observability evidence is in
`evidence/dashboard-observability-report-developer-verification-2026-11-02.md`.
OTP renewal developer evidence is in
`evidence/otp-pairing-renewal-developer-verification-2026-11-02.md`.
Chat/notification local developer evidence is in
`evidence/chat-notifications-developer-verification-2026-11-03.md`;
`CHAT-01..08` are still human QA work.
Focused developer runs passed, while human QA fields remain unexecuted.
Execute remaining work only on authorized isolated test environments. Each checkbox names detailed rows in
`05_TEST_CASES.csv`; QA records actual status, evidence and defects there.

## Identity, Access And Privacy

- [ ] `AUTHN-01..04`, `CONC-07`: login/invite/expiry/logout plus immediate post-commit withdrawal after disable/delete, password, role, department and direct/transitive permission changes. Verify REST, protected socket actions, disconnect/reconnect and two API nodes. Expected: old sessions and sockets cannot perform the next protected action after commit; already-running work is reported separately.
- [ ] `AUTHZ-01`: deleting, disabling or demoting the last active direct SUPER_ADMIN returns `409 LAST_ACTIVE_SUPER_ADMIN`; one of two may be removed; concurrent removals and recovery CLI never reduce the active count below one.
- [ ] `AUTHZ-02`: custom-role access follows effective actions, subjects, inheritance and record conditions rather than role display name; built-in roles remain fixed in CMS and direct API, including after restart/upgrade; permission edits invalidate direct and transitive affected sessions. Test role-list loading/Retry, metadata failure, incomplete/duplicate grants, system-role update rejection without mutation, custom-role delete blockers, concurrent editors, more than 100 roles, and permission withdrawal in a running CMS.
- [ ] `AUTHZ-03`: delegate trigger/status/history/clear is limited to explicitly authorized direct Screens; group/global/mixed targets are denied. `manage Emergency` controls all scopes. Media must be READY/readable and authorization is rechecked transactionally.
- [ ] `AUTHZ-08`: user/operator/invite/chat participant discovery is active, non-deleted and shared-current-membership before pagination/counting unless the actor has global `manage User`; hidden direct IDs return not-found. Primary-only users retain their existing single-department result.
- [ ] `AUTHZ-08`: a Department-only reader must not receive User roster requests or match Department search by operator name/email. A permitted User reader opens a department and sees paginated primary and additional operators, including inactive state. Verify withdrawn User permission closes the roster and direct API search no longer reveals names.
- [ ] `AUTHZ-09`: on Operators, independently verify read-only, create-only, update-only and delete-only User grants. Create/edit primary and additional department assignments through CMS, then verify server policy for cross-department targets, stale edits and immediate session invalidation after membership change.
- [ ] `AUTHN-05`: reset an operator password through CMS. Confirm the one-time value remains available until the operator dismisses it, Copy failure permits manual selection, closing clears it, old sessions and credentials stop working, and the new credential works. Repeat with an update-denied role and network failure.
- [ ] `AUTHN-06`: through two real CMS browser sessions, create an invitation, manually hand off its one-time code, activate at `/activate`, and sign in. Before activation, confirm the account cannot sign in. Check seven-day expiry, configured password policy, wrong/mismatched password, replay and simultaneous activation; list responses must omit the code. Close the code before copying, then renew it and confirm the old code fails. Repeat with a scoped creator, hidden other-department invitation, permission withdrawal, response loss, clipboard denial and an expired code.
- [ ] `AUTHZ-14..18`: primary plus multiple additional departments, invalid combinations, manager limits, invitation and old PATCH compatibility, session withdrawal, content ownership, chat message and validated-bookmark retention, legacy-bookmark behavior, races, old CMS and CMS relationship views pass against a disposable migrated PostgreSQL site. Record direct browser/API/DB evidence separately from source assertions.
- [ ] `AUTHZ-09..11`: Media and Layout same-department permitted read plus creator/global-manager mutation; Presentation creator/permitted-same-department/global read plus creator/global mutation; all cross-department and incompatible nested references are denied.
- [ ] `AUTHZ-12`: permitted same-department users manage Schedules/Schedule Requests only with the exact create/update/delete/approve/publish grant and valid lifecycle state; other departments are denied.
- [ ] `AUTHZ-13`: `ADMIN`-created content is organization-shared and globally managed; `SUPER_ADMIN`-created content is restricted/private; creation scope stays stable after creator transfer/deletion.
- [ ] `UI-07`: delete confirmation, deleted-creator marker, stable owner label, non-disclosure of the old email, and server-driven action visibility are consistent across Media, Layout, Schedule Creator, Schedule Queue and Request Detail.
- [ ] `AUTHZ-06`: all general Requests server/CMS/client/report/webhook surfaces are absent and old URLs return not-found; legacy rows are not exposed; Schedule Requests remain registered and functional.
- [ ] `SEC-02`, `DEP-06`: certificate identity, WSS/HTTPS, metrics gating, signer trust, CSRF/origin/secret leakage and role filesystem access. Verify actual firewall separately.

## Content Authoring And Media

- [ ] `FILE-01..03`: supported/unsupported MIME, 500 MiB production cap, hashing, multipart resume, exact object size/parts, retries, conversion tools and worker failure.
- [ ] `FILE-03`, `FILE-04`, `FILE-06`: native PDF and converted `.ppt/.pptx/.doc/.docx/.xls/.xlsx/.csv` stay PROCESSING until final-PDF page inspection; encrypted/malformed output fails; valid page counts match the playable PDF.
- [ ] `UI-05`, `API-05`, `API-06`, `DATA-05`, `CONC-06`: each occurrence defaults to page 1, accepts only an in-range integer, can reuse one document with different pages, previews the chosen page, saves atomically, freezes it in the snapshot, and handles legacy nulls. A restored value made invalid by a refreshed page count remains visible and blocks progression; it is never silently clamped.
- [ ] `API-06`, `COMP-04`: every release player is updated and connects once to report `pdf_page_selection_v1`; page >1 remains blocked until every concrete target reports it. Mixed-version playback is not an accepted rollout mode; page 1 remains compatible when capability data is absent.
- [ ] `PLAYER-08`, `PLAYER-10`, `COMP-04`, `PERF-05`: the selected page—not always page 1—renders with correct contain fit on approved browsers/displays; page-only updates refresh playback; multi-slot/high-DPI PDFs remain within the raster budget. A post-publish page mismatch shows exact heading `Unavailable`, emits safe structured context and never renders a substitute page.
- [ ] `UI-06`, `API-07`: Loop video is occurrence-specific, visible in author/review/request views, survives draft/API/publish round trips, defaults legacy values to Off, normalizes non-video over-posting to false, and rejects duplicate explicit same-slot order without a partial replacement.
- [ ] `PLAYER-11`: a loop-enabled single video repeats complete native media cycles on one mounted element and active identity until schedule end; Loop Off plays once; item display duration does not remount the successful single item; display and audio stop within 250 ms of the hard boundary.
- [ ] `PLAYER-12..14`: rejected play, load/decode error, stall and unexpected end produce one exact `Unavailable` state. A multi-item frame advances at its original wall-clock boundary. A one-item layout/fullscreen frame retries the same item at `clamp(duration, 1–30 seconds)` with one timer/attempt, cancelled by every authority change or disposal.
- [ ] `PLAYER-15`: loop/non-loop, one/many item, one/many slot and failing/retrying media all stop at the server-adjusted schedule end within 250 ms; completion records authority end, no display/audio/timer/callback survives, and the next authority is selected without a zero-delay loop.
- [ ] `FILE-05`: delete permission, reference conflict, soft/hard object removal, partial S3 failure, chat cleanup and no accidental recycle promise; BQ-020 recoverability is TBD.
- [ ] `FUN-01..02`, `UI-01`: layout bounds/slots, presentation timing/order/fit/audio, CMS form validation and error recovery.
- [ ] `FUN-08`, `PLAYER-09`, `WEB-01..06`: policy-controlled HTTP/HTTPS, every redirect/navigation hop, resource hosts, DNS/CIDR rebinding, invalid trust, unsupported login mechanisms, manual/24-hour refresh, latest-success preservation, revision propagation/cache fallback, corrupt preview and crash recovery. Expected: no unapproved destination or credentials are used, and refresh failure never replaces the last successful preview.
- [ ] `FUN-12`, `API-04`: SSO routes remain disabled. API-key creation/rotation are absent in CMS and return `409 API_KEY_AUTH_UNAVAILABLE` without mutation; retained keys can be listed/revoked under effective grants. Validate webhook administration and explicit outbound Test action. Actual SSO login, API-key business authentication and automatic webhook event delivery are outside this release.

## Scheduling, Screens And Player

- [ ] `FUN-03..05`, `UI-02`: in the real Schedule Queue, verify read-only versus complete creator grants, direct `/schedule/new` denial, search/date/sort/status counts, local-day boundaries, reversed date rejection, pagination, failed/Retry and stale refresh, keyboard row opening, selection refresh after another operator changes a request, and correct explanation that the backend snapshot does not prove player receipt or display. For direct multi-Screen, group-only, mixed and changed-membership publishes, choose a specific Screen; confirm the snapshot request uses its ID, membership permission/failure/Retry and current-versus-published wording. Repeat approve/reject/publish/combined approve-publish/take-down through the detail view with server permissions and two actors. Simulate a response lost after commit: verify one write per confirmation, retained note, forced reload before retry, and Approved state when only the second step of combined publication failed. Switch request selection while display preflight is pending; a late result must not publish either target.
- [ ] `FUN-03..05`, `UI-02`: from a Schedule Queue request, preview referenced IMAGE, VIDEO and PDF Media through the on-demand authorized Media detail URL. Verify loading, denied/deleted/unavailable and transient failure states, retry after failure, selected PDF page, and no stale preview after switching requests. The list response must not be treated as if it already contains a signed playback URL.
- [ ] `FUN-03..05`, `CONC-01`, `DATA-02`: half-open intervals, concrete-screen group overlap, holds, stale revisions, administrator self-approval, direct publishing, cancellation, takedown, replay and transaction/outbox consistency.
- [ ] `FUN-06`, `DEF-01..03`: eligible screen > group priority descending > target ID ascending tie-break > aspect > global > none. Priority is integer `0..100`, legacy/missing is `0`, non-priority edits preserve it, and concurrent same-revision writes yield one success plus one `409` without silent overwrite.
- [ ] `DEF-04`, `PLAYER-05`: with no active Schedule or eligible Screen/Group/aspect/global default, show the approved standard company fallback image online and offline on every supported display. Expected: a visible fitted image, never a blank or text-only idle card. The 2026-10-17 developer runtime failed this expectation.
- [ ] `FUN-07`, `CONC-03`: emergency READY media/message capability, selected targets, severity/recency ordering, duplicate key, clear/expiry, offline policy and safe fallback.
- [ ] `PLAYER-01..02`, `PLAYER-17`, `API-02`: device pairing/recovery/revocation, stable Device ID on OTP renewal, immediate old-code invalidation, idempotent timeout/restart recovery, visible OS hostname and server-time countdown on Ubuntu/Windows, legacy expiry rollover, signed REST/WSS, snapshot 304/404 and convergence through polling when wake-ups fail.
- [ ] `API-03`, `PLAYER-06`, `CONC-05`: command lease/ACK, screenshot, display selection, expiration and nonrepeated destructive commands.
- [ ] `SEC-01`, `UI-02`, `PLAYER-06`: with a custom role limited to Screen A, open Screen A's inspector and confirm View only versus record-authorized Edit, preferred output and Take Snapshot. Directly request Screen B's detail, status, heartbeat history, commands, cache reports, delivery and display state, then PATCH/selection/screenshot settings/capture; each must deny access without changing a row or queuing a command. Repeat after permission withdrawal while the inspector is open, and verify a permitted physical-player display/snapshot command reaches the intended Screen.
- [ ] `SEC-01`, `UI-02`: with real custom roles scoped to one Screen and one Screen Group, compare Dashboard site-wide KPI values with its readable All/Online/Active Scheduled drill-downs; query aspect ratios, overview, timeline and no-ID `screens:sync` directly. No other Screen, Group name or hidden member may appear. Remove Screen/Group grants during an open dialog and connected socket; refresh, reconnect and direct REST must converge to current access. Measure a large mixed-membership fleet and verify the operator understands the count difference.
- [ ] `UI-02`, `FUN-03..05`: keep an ended publish without current or upcoming items, then inspect the real Screens list and the Overview, Now Playing and Status tabs. The player may be Online and in standby, but no surface may say playback is awaiting that ended schedule or show its past end as a current booking. The historical publish name must remain identifiable as the latest published schedule. Repeat with an active item and an upcoming-only item; their booking end and next-window wording must remain correct after refresh and at the schedule boundary.
- [ ] `UI-02`: in Dashboard Total Screens and Online Screens drill-downs, compare an active/online Screen with ended-only, active, upcoming-only and no publish states against the Screen detail and server response. The `Inactive` badge must follow the Screen's actual status, not a missing optional field. Retained publishes must be labeled as history, no past end may appear as a current booking, and unknown player playback must read “No playback reported.” Repeat after heartbeat loss, reconnect, record-permission withdrawal, refresh and at the schedule boundary; confirm the cards do not claim physical playback from a heartbeat alone.
- [ ] `UI-02`: with a Dashboard-only role, confirm Schedule Report remains available and New Request is absent. With complete creator grants, confirm New Request opens the creator and the ordinary submit journey still works. The fixture browser suite passed 11/11 on 2026-11-04; the real restricted-role journey remains open.
- [ ] `PLAYER-03..04`, `PLAYER-16`: the secure deadline is exactly 120 seconds after the last authenticated success; reachability-only heartbeat cannot renew or unlock it. Lock stops schedule/default/emergency and purges only media cache. Recovery is single-flight and ordered identity validation -> forced fresh snapshot -> current-media sync/check -> authority apply -> unlock; stale authority never resumes.
- [ ] `PLAYER-05`, `COMP-01..03`: fullscreen kiosk, display choice/orientation/DPI, real Windows x64 and Ubuntu desktop packages, X11/Wayland difference, CMS browsers. Site hardware/browser/accessibility matrix remains BQ-016.
- [ ] `PLAYER-05`, `UI-02`: on packaged Ubuntu and Windows players, inspect production scheduled/default/standby and cached-offline playback on a physical display. Connection, snapshot, mode and backend banners must not cover ordinary content; startup/pairing/recovery, active emergency and security lock must remain legible. With an invalid site configuration, confirm the player shows its hostname and setup reason without suggesting an OTP exists, then verify normal pairing after correction and restart. Check fullscreen, portrait and high-DPI outputs, verify the Forest icon in the Ubuntu/Windows installer, launcher and window switcher, and confirm QA/dev diagnostics remain available only through their intended controls.

## Collaboration, Evidence And Reports

- [ ] `FUN-09`, `CHAT-01..03`: use three independently signed-in CMS browser profiles across two departments. Create a DM, invite-only closed group and open forum while recipients keep chat open; check live discovery, outsider direct-link denial, concurrent send, edit/delete tombstones, reaction/thread/pin/bookmark and unique database sequence. As owner, chat admin and moderator, open the closed-group Members tab and remove a named ordinary member after confirmation; ensure ordinary members, self, conversation owners and system admins have no removal control. Check that an open forum cannot falsely claim revoked access after membership removal and that a custom site-wide Conversation manager cannot be removed as a revocation substitute. Check stale authorization and an archived room. Keep the removed closed-group member's socket and second tab open; prove REST, socket and stale CMS access stop immediately. The CMS control has fixture browser coverage only until this real-actor journey passes.
- [ ] `CHAT-04..05`: exercise mute/ban/expiry, archive/unarchive and owner versus global/custom-role permissions from CMS and direct API. Upload, convert, share and preview every accepted chat file class; forge cross-department media IDs, revoke access and inspect object/signed-URL behavior. Archive must be read-only and failed conversion must never be offered as READY.
- [ ] `CHAT-04..05`, `UI-02`: with actual object storage and two real CMS profiles, start an attachment upload in Chat A, switch to Chat B and the phone chat list, then return to A before and after server verification. The file and upload state must stay with A; Send must wait for READY, failed uploads must be explained and clearable, and a send or access withdrawal during the switch must not attach a file to B. Repeat after browser refresh and network interruption. Local fixture browser coverage is recorded in `evidence/product-ui-chat-attachment-drafts-developer-verification-2026-11-04.md` only.
- [ ] `CHAT-01..03`, `UI-02`: with more than 100 messages and 100 thread replies in a matched CMS/API deployment, open each conversation at the latest messages, load older history without gaps or duplicates, follow deep links to an old main message and an exact old thread reply, and reconnect after missed realtime events. Local fixture and focused database checks cover the new cursor path; independent real-service and multi-actor verification remain open.
- [ ] `FUN-10`, `CHAT-06..07`, `CONC-04`: DM/mention/thread notifications must target only entitled users and open exact visible content. Use at least 55 notifications, two tabs for one recipient, read-all concurrent with creation, out-of-order/duplicate delivery and DB/API/UI comparison; count and read cursor never regress or cross users.
- [ ] `CHAT-08`: interrupt API, WSS and Valkey separately during navigation, invitation, send and read. Verify explicit error/Retry, socket reconnect plus REST-authoritative refresh, the documented polling bound, no duplicate/stale private content, session expiry and revocation on two API nodes. Local developer evidence covers only bounded cases; human execution fields remain open.
- [ ] `CHAT-08`, `CONC-04`: lose the response after the server commits a chat send. The CMS must issue one POST per operator action, retain an explicit failed/unknown pending item, and send again only after the operator chooses Retry. Compare the conversation and database sequence before retry so an already-committed first send is not duplicated. Fixture browser coverage proves automatic retry is disabled; matched-service response-loss and multi-actor verification remain open.
- [ ] `DATA-04`, `PLAYER-07`: actual PoP duration, deduplication, 100-event/512-KiB memory and 32-file/derived-byte spool budgets, discard counters, replay and media-purge preservation. The code does not guarantee lossless offline evidence; acceptable loss remains BQ-013.
- [ ] `OBS-03`: selected document page remains intact through live telemetry, offline spool/replay, idempotency, PoP database/list/CMS and CSV export; non-document/legacy rows remain compatible.
- [ ] `OBS-03`: verify completed, interrupted and legacy-unknown PoP outcomes from packaged player through ingest/worker/database/CMS/CSV. A row with `ended_at` and `completed=false` must remain Incomplete. Check renamed/deleted Screen and Media labels, exact IDs, date boundaries, 50-row paging, export size, network retry and withdrawal of `read ProofOfPlay`; do not equate a player report with physical display observation.
- [ ] `OBS-04`: internal native loop cycles retain one active occurrence identity, failures and boundary reasons are diagnosable once without signed URL/secret leakage, and PoP meaning is explicitly characterized before acceptance.
- [ ] `FUN-11`, `UI-04`: verify server-received availability end to end: ONLINE at receipt, estimated outage at last receipt +90 seconds or immediate explicit OFFLINE/ERROR, recovery at the next receipt, backend/pre-first-heartbeat UNKNOWN, Never seen, known-time denominator and Asia/Kolkata daily buckets. Keep the legacy current ACTIVE fraction visibly separate. Verify assigned, exact publish/snapshot applied, fresh reported playback and publish-linked renderer PoP as distinct evidence levels; no UI/export may claim physical-display proof.
- [ ] `FUN-11`, `UI-04`: as Report-only, Audit-only, PoP-only, full-admin and denied actors, verify `/reports` tabs, REST requests, PDF snapshot sections and conditional recent PoP/CSV. Select 1/7/30-day availability and confirm the snapshot PDF does not imply that filter applies. Test PDF text/visual layout, current audit-filter export, page/reset, stale refresh, permission withdrawal and large result memory/latency on a production-like dataset.
- [ ] `UI-02..03`: route/action visibility, direct URL permission enforcement, keyboard/focus/labels/errors and assistive technology against the BQ-016 target.
- [ ] `UI-02..03`: in Settings at phone width, use category list → detail → All settings with keyboard and touch; verify focus returns to the prior category, unsaved drafts stay in their section, Branding and Roles vanish when their read grants are withdrawn, and no hidden category content becomes actionable. Repeat at the 640px boundary, tablet and desktop with long labels, text zoom, dark theme and all five accents. Fixture browser coverage exists; matched-service permission withdrawal and assistive-technology checks remain open.
- [ ] `UI-02..03`: the cream-and-forest palette checkpoint was approved for the whole CMS and player-owned states on 2026-11-04; verify the implemented public Home/Login/activation, authenticated shell, dense Screens and Schedule review, and player pairing/recovery/standby in the built application at 390/820/1440 widths. Check saved appearance on public routes, five single-active CMS accents with Forest default, fixed Forest player-owned states, dark/light customer logos, semantic statuses, text zoom, reduced motion, 4.5:1 text, 3:1 control boundaries, and no overlays on authored playback. The isolated design study passed sampled contrast and overflow checks; production integration remains open.

## Data, Operations And Release

- [ ] `DATA-01..03`, `DATA-06`, `DEP-03`: migrations/checksums/order, tombstone/ownership backfill and constraints, transactional publish/emergency data, object-backed snapshots and no partial success.
- [ ] `DATA-05`: migration `0044`, dry-run/apply backfill, nullable legacy semantics, positive checks and rollback compatibility are verified on a disposable database/object store before production rollout.
- [ ] `DATA-06`: migration `0045` maps administrator creators to organization, valid original departments to department, and missing/invalid mappings to restricted; tombstone identity/email reuse/creator references survive; department deletion reports ownership counts; repeat migration and unsafe old-server rollback are handled on a disposable legacy copy.
- [ ] `DATA-06`, `UI-04`: create/edit a Department, block deletion with primary/additional users and owned Media/Layout/Presentation/Schedule, inspect exact blocker counts, then move all references and delete. Repeat with a concurrent new owner and with permission withdrawal while the confirmation is open. Confirm 409 leaves every record unchanged and the CMS never claims success before the server commits.
- [ ] `CONC-07`: deletion/transfer/disablement/demotion races with REST/session/socket reconnect, ordinary ownership-sensitive writes, notification creation, multipart/legacy upload create/activate/finalize, object cleanup failure/retry and every schedule lifecycle state. Exactly one legal commit order wins, no stale authority or incomplete Media becomes effective, retained work stays with its stable owner, and cleanup converges without account reactivation.
- [ ] `DEP-01..07`: signed role/transfer verification, malicious archive rejection, five-VM first install, resumability, source-free content, compatibility, backend-only update, legacy adoption, low disk, TLS and operational acceptance.
- [ ] `BKP-01..03`: actual full backup, contract buckets including logs-auth, independent clean restore, hashes, signed evidence, archive safety, failed migration recovery and old/new schema compatibility. Measure BQ-018 RPO ≤24 hours, RTO ≤4 hours and maintenance ≤2 hours; broader data-class retention remains BQ-015.
- [ ] `OBS-01..02`: liveness versus readiness, worker heartbeat, dependency failures, metrics/auth/TLS/alert evaluation and log redaction. Populate site-local player file-discovery with both players, enforce mTLS and the observability-only port-3300 firewall, prove Prometheus target state, machine/player telemetry, alert transitions and CMS `/grafana/` health/login/drill-down links. Empty or failed inventories must show unavailable/down truthfully, never fabricated fleet totals.
- [ ] `REL-01..02`: Valkey/WSS outage fallback, API/worker outage, retry/restart, idempotent processing and convergence without silently using stale content.
- [ ] `PERF-01..04`, `PERF-06`: execute the BQ-017 gate—500 connected players, 40 CMS users, five concurrent 500 MiB uploads and a five-minute 1,000-player spike—plus saturation/stress, reconnect/emergency, multi-day soak and long-running video loops on isolated representative hardware. No representative five-VM performance execution has occurred.
- [ ] `BKP-01`, `PERF-04`: compare actual archive/retention behavior with required data-class lifetimes. A configured retention value is not evidence that pruning runs. BQ-015/020 remain business inputs.

## Case Design Rules

For each applicable scenario, capture happy path plus invalid input, boundary, unauthorized actor, duplicate action, interruption/retry, stale state, dependency outage, and post-recovery consistency. The detailed case rows identify the highest-risk combinations, avoiding duplicate cases for every Cartesian product. Use a real physical player for display/audio/fullscreen assertions and an isolated recovery target for destructive rehearsal. Never run the release or backup tests against the production database.

Business source and code answer can disagree. Mark observed behavior separately from intended acceptance, file a defect for confirmed-rule conflicts, and leave genuinely unapproved business outcomes as `TBD - NEEDS_BUSINESS_CONFIRMATION (BQ-nnn)`.

## Live broadcast implementation delta — 2026-11-03

- [ ] In the current CMS build, sign in as a complete live Schedule author, a source-only creator, a read-only operator and a denied user. Verify the primary Schedule action, secondary source creation, source View/Edit/Delete grants, disabled-source filter, search/paging, stale-filter and error/Retry states. Run at phone, tablet and desktop widths with keyboard and 200% text zoom. Confirm a stale dialog, lost write response, revoked permission and server blocker never show a false success. The fixture-backed Live page packet is developer evidence only; do this against real services before acceptance.
- [ ] From a real live event draft with no eligible source, create a source, assign a presenter, return to the same draft and select it; repeat with existing draft choices, Cancel, network failure with an uncertain write, permission withdrawal and a source created by another operator. Verify no stacked dialog, no duplicate POST, authoritative refreshed source list and a visible Back/Next/Save footer at 390 pixels and on a short display. Do not treat the local single-admin source lifecycle as independent QA approval.

- [ ] `LIVE-01..06`: real CMS author/hold/approve/request/direct-publish and
  presenter start/stop flows; current custom roles/departments, frozen audience,
  same-size member change, 25/26 targets, 10/11 overlaps, duplicate starts/tabs.
  With no trusted/accepting media node or safe capacity, confirm the panel shows
  the exact preflight state and cannot open the native capture chooser. After a
  ready preflight, make media unavailable before Start and confirm Start still
  rejects without publishing.
- [ ] `LIVE-07..10`: real packaged receiver frame/audio truth, verified pinned
  fallback, missing/corrupt Content unavailable, start/end boundaries,
  three-second renewal/ten-second cutoff, emergency/security and resume cleanup.
- [ ] `LIVE-11..14`: original/refreshed ticket/token replay, already flowing SFU
  media removal, API/DB/worker/Valkey/media partitions, supervisor/watchdog,
  delayed cleanup, runtime-capacity retention and renderer/static-slide cases.
- [ ] `LIVE-15..18`: trusted CMS HTTPS/browser/Electron paths, blocked media
  transport, offline package/update/rollback/restore epoch, actual supported OS/
  browser/audio and representative 1x25/5x25/10x25 load/soak.
- [ ] `LIVE-19..20`: ordered/fresh diagnostics, log redaction and complete
  existing schedule/default/emergency/pairing/cache/delivery/PoP regression.

Final `LIVE-01..20` acceptance must exercise a scheduled live event/media source
inside the same ordinary installed DARSHAN player, including normal pairing,
lifecycle, cache and emergency transitions. A developer-only prototype or
separate receiver application cannot close those integrated cases.

### Independent human execution and site gates

- [ ] `LIVE-09`, `LIVE-12`: while video and optional audio are visibly playing,
  cut Backend authority renewal without stopping the player or Media VM.
  Confirm renewal normally occurs about every three seconds, both video and
  audio stop within ten seconds of lost authority, and a late REST response
  cannot extend playback. Restore Backend; require fresh current authority
  before live resumes. Record trigger, last valid renewal, visible/audio stop
  timestamps, fallback state and recovery.
- [ ] `LIVE-10`, `LIVE-14`: trigger an emergency on one live receiver and clear
  it while the window is active; keep another receiver unaffected. The affected
  display and audio switch to emergency with no live image or sound underneath.
  After clear, live may return only after fresh admission for the current run;
  a secure/identity lock or ended window must prevent return. Record both
  screens, audio, authority and cleanup.
- [ ] `LIVE-06`, `LIVE-11..13`: revoke the presenter's session or permission
  during publication, replay original/refreshed admission, race a second tab,
  and interrupt then restore signaling/media. Revoked or replayed identities
  cannot reconnect or displace a legitimate peer; already flowing media stops
  within the authority bound. A media-only interruption may reconnect for up
  to 30 seconds only while authority and window remain valid. Record room and
  admission state before/after, with no stale run resurrection.
- [ ] `LIVE-01`, `LIVE-06`, `LIVE-17`: keep a real presenter capture active while
  the CMS tab is hidden or browser minimized, using ordinary browser settings.
  Verify frame/audio continuity when permitted, truthful degraded status when
  capture stops, and no duplicate publication after foregrounding, reload or
  a second tab. Test native chooser cancellation and a late picker result after
  authority expires. Record the selected source, browser/OS, visible player
  output, audio and capture/room cleanup.
- [ ] `LIVE-11..13`, `LIVE-15`: on the representative Media VM, fail the
  controller, supervisor and host witness separately, including a management
  partition and an SFU removal timeout. Prove already flowing media stops
  within the authority bound or the node isolates; while removal is uncertain,
  capacity remains occupied and no new admission is granted. Verify a healthy
  node is not falsely isolated under the approved sustained load. Record
  watchdog/host timing, Media process and room state, player display/audio,
  Backend reconciliation and recovery steps.
- [ ] Run **each** `LIVE-01..20` row in `05_TEST_CASES.csv` against one frozen
  source commit and CMS/Backend/Media/player artifact set (with signed role
  manifests where required). For each row,
  record tester, UTC time, environment, artifact hashes, expected versus actual
  result, screenshots/video/logs and defect ID or explicit N/A reason. Only the
  independent tester may change its `Not Tested` result.
- [ ] `LIVE-15`: from the actual CMS and player machines on different VMs,
  prove trusted HTTPS/WSS and WebRTC ICE media reachability through the approved
  firewall/UDP/TCP/TURN routes. Record DNS names, certificate trust outcomes,
  selected candidate/transport and denied wrong-host/expired certificates or
  blocked paths. A same-host Docker bridge success does not satisfy this gate.
- [ ] `LIVE-17`: on installed Ubuntu and Windows players and actual Chrome/Edge
  presenter browsers, verify real screen/window/tab selection, permission
  cancellation, video, optional audio and visible physical-display output.
  Record each supported or unsupported source/track combination; do not infer
  a Chrome/Edge result from Chromium or a human-visible result from telemetry.
- [ ] `LIVE-18`: on the approved six-VM topology, measure 1×25, 5×25 and
  10 concurrent broadcasts × 25 receivers (250 total), then 26th receiver and
  11th overlap rejection. Capture source-to-display delay, readability/audio,
  CPU/RAM/GPU/NIC, bandwidth, errors, reconnect bursts and soak/cleanup.
- [ ] `LIVE-16`: install/update/feature-disable and restore a production-sized
  copy into an isolated target; rotate the external authority epoch, prove old
  rooms/tickets cannot resume, verify new player authority and compare DB/object
  counts, hashes and RPO/RTO evidence. Never rehearse against production data.

For every fault record trigger, visible display, audio, allowed recovery and
cleanup. [evidence/live-broadcast-developer-verification-2026-11-03.md](evidence/live-broadcast-developer-verification-2026-11-03.md) is an in-progress developer ledger;
all new human cases remain Not Tested.


Current developer coverage for LIVE-02..05/08/19 includes the final62-check/4-file packet (25 publishing/read/authoring,20
source/reference ACL and17 pure delivery/read-model checks) plus55 supporting running-service checks with15 verified downloads.
Source-page browser observations are separate. Repeat through the actual CMS
publishing and ordinary-player workflow; all checkboxes above remain open.
See [publication evidence](evidence/live-publication-authorization-developer-verification-2026-11-03.md).

The 2026-11-04 redesign developer pass completed a real isolated CMS author
Review → Submit → Queue Cancel journey and verified the Screen and live
reservations released in PostgreSQL. The [page evidence](evidence/product-ui-live-page-developer-verification-2026-11-04.md)
records the immutable cancelled QA fixture and the corrected source, fallback,
audience and timezone summary. This does not close any unchecked human `LIVE-01..20`
row, approval/publication, or player-delivery gate.

## Runtime and authoring developer checkpoint — 2026-11-03

The packet is **implemented in source, default OFF, and locally developer-verified**. It is not beta acceptance or release approval. The earlier presenter-preflight increment passed 37/37 PostgreSQL/Fastify runtime cases and 31/31 focused CMS API/controller/panel cases; the later rebuilt real CMS → packaged-player repeat and final regression are recorded in the [dated developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md). [Runtime/authoring evidence](evidence/live-runtime-authoring-developer-verification-2026-11-03.md) retains its original source/build scope; an older SFU/prototype result cannot validate a later build. All `LIVE-01..20` remain **Not Tested** and QA-owned execution/result/defect/sign-off fields remain unchanged.

For LIVE-01..06 include the actual create-only operator review consent, required library permissions, conditional old/proposed Schedule and Item checks, exact response-loss retries, stale two-tab drafts and same-account/new-session capture disposal. For LIVE-19 distinguish server-current receiver observations from retained last reports and physical output; preserve Unknown for stale/future timestamps, pending/revoked or replaced runtime, missing reports, inactive publication and changed authority. Current source and automation exist; retain every unchecked human execution item above.

Later local developer evidence now includes a real CMS capture/Start, the ordinary
packaged Linux player's decoded test-source screenshot, Stop and verified normal
fallback screenshot, plus an explicit same-window restart. See the [dated
developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md).
The final observation-refresh packaged build then completed a separate scheduled
CMS → native capture → Media → player frame journey. Receiver `READY` receipts
remained fresh through the last six seconds, and the run ended 296 ms before
the immutable boundary, within the agreed one-second tolerance. A fresh player
snapshot showed standby after the window; that test screen has no site default.
The earlier explicit Stop/fallback evidence remains separate. See the same
[dated developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md).
Physical audio/display, supported browser/OS matrix, cross-VM operation,
capacity and independent QA remain unchecked.
