# Master Human QA Checklist

Baseline: `release-01` / `e721c2ab0c8b94af95b6914810a0c6788899e318` plus the 2026-10-16 deleted-user ownership working-tree delta. This remains the master plan; earlier targeted PDF/video Linux evidence is in `evidence/runtime-2026-10-15/runtime-validation.md`, while partial ownership developer runtime plus source/build/unit evidence is in `evidence/runtime-2026-10-16/runtime-validation.md` and `evidence/deleted-user-ownership-review.md`. Execute remaining work only on authorized isolated test environments. Each checkbox names detailed rows in `05_TEST_CASES.csv`; record actual status, evidence and defect IDs there. `01_BUSINESS_RULES.md` defines requirement provenance; an implemented rule is not automatically an approved acceptance rule.

## Identity, Access And Privacy

- [ ] `AUTHN-01..04`, `CONC-07`: login, throttle/fail-closed behavior, invite/activation, token idle refresh, logout, password reset and immediate withdrawal across REST and live sockets. Deleted, transferred, disabled, role-changed and password-reset user paths revoke target sessions; verify disconnect/reconnect, moved-uploader denial and both transaction orders for an ownership-sensitive write already in flight, and separately cover role-definition/recovery-CLI changes. Race deletion against document conversion, video transcode, webpage capture and thumbnail generation before and after the worker READY compare-and-set. Expected: account-change-first rejects/stops without reactivation and compensates produced objects; write/worker-first finishes before the account change commits and retains its stable owner/content.
- [ ] `AUTHZ-01`: SUPER_ADMIN manages all account roles while deletion of **every** SUPER_ADMIN is blocked. Last-active demotion/disablement remains a BQ-002 edge decision.
- [ ] `AUTHZ-02`: built-in roles cannot be renamed/edited at runtime; custom grants, assignment, inheritance, conditions and persistence work.
- [ ] `AUTHZ-03`: a role with `update Screen` can open the CMS workflow and trigger/clear explicitly selected valid screens with audited actor/targets; missing permission, invalid IDs and delegated non-screen scope are rejected. The current CMS/API mismatch remains tracked as R-04 and must not be accepted as the expected result.
- [ ] `AUTHZ-04..05`, `AUTHZ-07`, `SEC-01`: operator-directory name/email visibility plus the stable Media/Layout/Presentation/Schedule matrix for organization, department and restricted owners. Exercise creator, peer, DEPARTMENT lead, moved/deleted creator, other department, custom role, ADMIN and SUPER_ADMIN through list/detail/mutation/nested-reference/direct API paths. The old Presentation gap is closed in source but must be runtime-proven; directory privacy remains a separate BQ-007 decision.
- [ ] `UI-07`: delete confirmation, deleted-creator marker, stable owner label, non-disclosure of the old email, and server-driven action visibility are consistent across Media, Layout, Schedule Creator, Schedule Queue and Request Detail.
- [ ] `AUTHZ-06`: exposed general Requests routes receive security/exposure review despite the workboard's functional exclusion. Schedule approval requests remain in scope.
- [ ] `SEC-02`, `DEP-06`: certificate identity, WSS/HTTPS, metrics gating, signer trust, CSRF/origin/secret leakage and role filesystem access. Verify actual firewall separately.

## Content Authoring And Media

- [ ] `FILE-01..03`: supported/unsupported MIME, 500 MiB production cap, hashing, multipart resume, exact object size/parts, retries, conversion tools and worker failure.
- [ ] `FILE-03`, `FILE-04`, `FILE-06`: native PDF and converted `.ppt/.pptx/.doc/.docx/.xls/.xlsx/.csv` stay PROCESSING until final-PDF page inspection; encrypted/malformed output fails; valid page counts match the playable PDF.
- [ ] `UI-05`, `API-05`, `API-06`, `DATA-05`, `CONC-06`: each occurrence defaults to page 1, accepts only an in-range integer, can reuse one document with different pages, previews the chosen page, saves atomically, freezes it in the snapshot, and handles legacy nulls.
- [ ] `PLAYER-08`, `PLAYER-10`, `COMP-04`, `PERF-05`: the selected page—not always page 1—renders with correct contain fit on approved browsers/displays; page-only updates refresh playback; multi-slot/high-DPI PDFs remain within the raster budget; do not expect all-page progression.
- [ ] `UI-06`, `API-07`: Loop video is occurrence-specific, visible in author/review/request views, survives draft/API/publish round trips, defaults legacy values to Off, normalizes non-video over-posting to false, and rejects duplicate explicit same-slot order without a partial replacement.
- [ ] `PLAYER-11`: a loop-enabled single video repeats complete native media cycles on one mounted element and active identity until schedule end; Loop Off plays once; item display duration does not remount the successful single item.
- [ ] `PLAYER-12`: late join/restart uses decoded-duration modulo; rejected play, load/decode error, stall and unexpected end recover visibly and within bounds; multiple slots remain independent; multi-item slots advance; video plus selected-PDF playback and every takeover/end path clean up safely.
- [ ] `FILE-05`: delete permission, reference conflict, soft/hard object removal, partial S3 failure, chat cleanup and no accidental recycle promise; BQ-020 recoverability is TBD.
- [ ] `FUN-01..02`, `UI-01`: layout bounds/slots, presentation timing/order/fit/audio, CMS form validation and error recovery.
- [ ] `FUN-08`, `PLAYER-09`: public/private HTTPS policy, redirects, resource hosts, invalid trust, login/error page readiness, preview fallback and crash recovery. The code has no preview-age gate or login handoff; required page classes/acceptable preview age remain BQ-011.
- [ ] `FUN-12`, `API-04`: API key, SSO and webhook **management** only. Validate admin permissions, persistence and explicit outbound Test action. Actual SSO login, API-key business authentication and automatic webhook event delivery are outside this release.

## Scheduling, Screens And Player

- [ ] `FUN-03..05`, `CONC-01`, `DATA-02`: half-open intervals, concrete-screen group overlap, holds, stale revisions, administrator self-approval, direct publishing, cancellation, takedown, replay and transaction/outbox consistency.
- [ ] `FUN-06`: screen > first saved eligible group > aspect > global > none. Saved `[A,B]` selects A, then editing A in CMS can make `[B,A]` select B; whether that change is acceptable remains BQ-012.
- [ ] `FUN-07`, `CONC-03`: emergency READY media/message capability, selected targets, severity/recency ordering, duplicate key, clear/expiry, offline policy and safe fallback.
- [ ] `PLAYER-01..02`, `API-02`: device pairing/recovery/revocation, signed REST/WSS, snapshot 304/404 and convergence through polling when wake-ups fail.
- [ ] `API-03`, `PLAYER-06`, `CONC-05`: command lease/ACK, screenshot, display selection, expiration and nonrepeated destructive commands.
- [ ] `PLAYER-03..04`: two-minute production outage lock, emergency stop, cached media erase, identity/PoP preservation, purge failure and offline restart.
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
