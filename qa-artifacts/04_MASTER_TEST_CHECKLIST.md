# Master Human QA Checklist

Baseline: uncommitted `release-01` working tree based on `d8281db`. Playback
recovery developer evidence is in
`evidence/playback-recovery-developer-verification-2026-10-21.md`; two Linux
Electron developer runs passed, while human QA fields remain unexecuted.
Execute remaining work only on authorized isolated test environments. Each checkbox names detailed rows in
`05_TEST_CASES.csv`; QA records actual status, evidence and defects there.

## Identity, Access And Privacy

- [ ] `AUTHN-01..04`, `CONC-07`: login/invite/expiry/logout plus immediate post-commit withdrawal after disable/delete, password, role, department and direct/transitive permission changes. Verify REST, protected socket actions, disconnect/reconnect and two API nodes. Expected: old sessions and sockets cannot perform the next protected action after commit; already-running work is reported separately.
- [ ] `AUTHZ-01`: deleting, disabling or demoting the last active direct SUPER_ADMIN returns `409 LAST_ACTIVE_SUPER_ADMIN`; one of two may be removed; concurrent removals and recovery CLI never reduce the active count below one.
- [ ] `AUTHZ-02`: custom-role access follows effective actions, subjects, inheritance and record conditions rather than role display name; protected system-role hierarchy remains enforced; permission edits invalidate affected sessions.
- [ ] `AUTHZ-03`: delegate trigger/status/history/clear is limited to explicitly authorized direct Screens; group/global/mixed targets are denied. `manage Emergency` controls all scopes. Media must be READY/readable and authorization is rechecked transactionally.
- [ ] `AUTHZ-08`: user/operator/invite/chat participant discovery is active, non-deleted and same-department before pagination/counting unless the actor has global `manage User`; hidden direct IDs return not-found.
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
- [ ] `FUN-12`, `API-04`: API key, SSO and webhook **management** only. Validate admin permissions, persistence and explicit outbound Test action. Actual SSO login, API-key business authentication and automatic webhook event delivery are outside this release.

## Scheduling, Screens And Player

- [ ] `FUN-03..05`, `CONC-01`, `DATA-02`: half-open intervals, concrete-screen group overlap, holds, stale revisions, administrator self-approval, direct publishing, cancellation, takedown, replay and transaction/outbox consistency.
- [ ] `FUN-06`, `DEF-01..03`: eligible screen > group priority descending > target ID ascending tie-break > aspect > global > none. Priority is integer `0..100`, legacy/missing is `0`, non-priority edits preserve it, and concurrent same-revision writes yield one success plus one `409` without silent overwrite.
- [ ] `DEF-04`, `PLAYER-05`: with no active Schedule or eligible Screen/Group/aspect/global default, show the approved standard company fallback image online and offline on every supported display. Expected: a visible fitted image, never a blank or text-only idle card. The 2026-10-17 developer runtime failed this expectation.
- [ ] `FUN-07`, `CONC-03`: emergency READY media/message capability, selected targets, severity/recency ordering, duplicate key, clear/expiry, offline policy and safe fallback.
- [ ] `PLAYER-01..02`, `API-02`: device pairing/recovery/revocation, signed REST/WSS, snapshot 304/404 and convergence through polling when wake-ups fail.
- [ ] `API-03`, `PLAYER-06`, `CONC-05`: command lease/ACK, screenshot, display selection, expiration and nonrepeated destructive commands.
- [ ] `PLAYER-03..04`, `PLAYER-16`: the secure deadline is exactly 120 seconds after the last authenticated success; reachability-only heartbeat cannot renew or unlock it. Lock stops schedule/default/emergency and purges only media cache. Recovery is single-flight and ordered identity validation -> forced fresh snapshot -> current-media sync/check -> authority apply -> unlock; stale authority never resumes.
- [ ] `PLAYER-05`, `COMP-01..03`: fullscreen kiosk, display choice/orientation/DPI, real Windows x64 and Ubuntu desktop packages, X11/Wayland difference, CMS browsers. Site hardware/browser/accessibility matrix remains BQ-016.

## Collaboration, Evidence And Reports

- [ ] `FUN-09..10`, `CONC-04`: DM/group/forum membership, moderation, attachments, message order, notifications, unread counters and reconnect.
- [ ] `DATA-04`, `PLAYER-07`: actual PoP duration, deduplication, 100-event/512-KiB memory and 32-file/derived-byte spool budgets, discard counters, replay and media-purge preservation. The code does not guarantee lossless offline evidence; acceptable loss remains BQ-013.
- [ ] `OBS-03`: selected document page remains intact through live telemetry, offline spool/replay, idempotency, PoP database/list/CMS and CSV export; non-document/legacy rows remain compatible.
- [ ] `OBS-04`: internal native loop cycles retain one active occurrence identity, failures and boundary reasons are diagnosable once without signed URL/secret leakage, and PoP meaning is explicitly characterized before acceptance.
- [ ] `FUN-11`, `UI-04`: current online fraction versus historical uptime, null/zero denominator, PoP ended_at status, UTC/database/browser timezone differences, filters and PDF export. Reporting meaning/day remains BQ-014.
- [ ] `UI-02..03`: route/action visibility, direct URL permission enforcement, keyboard/focus/labels/errors and assistive technology against the BQ-016 target.

## Data, Operations And Release

- [ ] `DATA-01..03`, `DATA-06`, `DEP-03`: migrations/checksums/order, tombstone/ownership backfill and constraints, transactional publish/emergency data, object-backed snapshots and no partial success.
- [ ] `DATA-05`: migration `0044`, dry-run/apply backfill, nullable legacy semantics, positive checks and rollback compatibility are verified on a disposable database/object store before production rollout.
- [ ] `DATA-06`: migration `0045` maps administrator creators to organization, valid original departments to department, and missing/invalid mappings to restricted; tombstone identity/email reuse/creator references survive; department deletion reports ownership counts; repeat migration and unsafe old-server rollback are handled on a disposable legacy copy.
- [ ] `CONC-07`: deletion/transfer/disablement/demotion races with REST/session/socket reconnect, ordinary ownership-sensitive writes, notification creation, multipart/legacy upload create/activate/finalize, object cleanup failure/retry and every schedule lifecycle state. Exactly one legal commit order wins, no stale authority or incomplete Media becomes effective, retained work stays with its stable owner, and cleanup converges without account reactivation.
- [ ] `DEP-01..07`: signed role/transfer verification, malicious archive rejection, five-VM first install, resumability, source-free content, compatibility, backend-only update, legacy adoption, low disk, TLS and operational acceptance.
- [ ] `BKP-01..03`: actual full off-host backup, contract buckets including logs-auth, independent clean restore, hashes, signed evidence, archive safety, failed migration recovery and old/new schema compatibility. RPO/RTO and retention remain BQ-015/018.
- [ ] `OBS-01..02`: liveness versus readiness, worker heartbeat, dependency failures, metrics/auth/TLS/alert evaluation and log redaction.
- [ ] `REL-01..02`: Valkey/WSS outage fallback, API/worker outage, retry/restart, idempotent processing and convergence without silently using stale content.
- [ ] `PERF-01..04`, `PERF-06`: plan baseline load, saturation/stress, reconnect/emergency spike, multi-day soak, and long-running multi-slot video loops on isolated representative hardware. No performance execution occurred; fleet size, SLO and accepted loss thresholds remain BQ-017.
- [ ] `BKP-01`, `PERF-04`: compare actual archive/retention behavior with required data-class lifetimes. A configured retention value is not evidence that pruning runs. BQ-015/020 remain business inputs.

## Case Design Rules

For each applicable scenario, capture happy path plus invalid input, boundary, unauthorized actor, duplicate action, interruption/retry, stale state, dependency outage, and post-recovery consistency. The detailed case rows identify the highest-risk combinations, avoiding duplicate cases for every Cartesian product. Use a real physical player for display/audio/fullscreen assertions and an isolated recovery target for destructive rehearsal. Never run the release or backup tests against the production database.

Business source and code answer can disagree. Mark observed behavior separately from intended acceptance, file a defect for confirmed-rule conflicts, and leave genuinely unapproved business outcomes as `TBD - NEEDS_BUSINESS_CONFIRMATION (BQ-nnn)`.
