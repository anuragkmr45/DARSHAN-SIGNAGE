# Release Readiness Checklist

This is a release gate, not a current sign-off. Record owner, date,
build/release ID, evidence and decision for each item. The authorization/session
review is `evidence/authorization-session-requests-review.md`; the final
developer cycle added real-PostgreSQL, built-API, browser and full-player
automated evidence in
`evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md`. These results
do not replace independent QA, platform, security, recovery, soak or deployment
gates.

**Current candidate override (2026-11-03):** Webpage Media and backend Playwright Chromium are retired before first production deployment. Historical checked webpage evidence below records prior builds only. `WEB-01..06` and `PLAYER-09` webpage preview acceptance are superseded by `RET-01..03`; preserve other requirements named on the same lines. See `evidence/webpage-media-retirement-developer-verification-2026-11-03.md`.

The beta6 delivery, availability, observability and packaged-player record is
`evidence/dashboard-observability-report-developer-verification-2026-11-02.md`.
It proves the bounded developer scenarios listed there, not the real five-VM
network, real player scrape inventory, physical displays, capacity or restore
gates.

The webpage/default-priority developer review and exact bounded commands are in
`evidence/webpage-default-priority-review.md` and
`evidence/webpage-default-priority-developer-verification-2026-10-17.md`.
The later live requirements 1-18 run is in
`evidence/runtime-2026-10-17/runtime-validation.md`; 1-17 passed the bounded
developer scenarios and requirement 18 failed.

Requirements 19-24 source/automated verification and two current Linux
Electron runtime passes are recorded in
`evidence/playback-recovery-developer-verification-2026-10-21.md`. This is
developer evidence, not an independent QA or release pass.

## Current Targeted Feature Evidence

- [ ] **Groups 1–4 candidate gate:** Screen/Group deletion blocker and connected-player five-second runtime evidence, SSO absence/local login and private egress checks, recoverable Media/chat delete/restore including object hashes, 30-day Data VM backup capacity, and the five-VM load/recovery measurements in `evidence/groups-1-4-release-gates-2026-11-01.md` must all pass against frozen artifacts before merging or releasing the packet. Developer focused tests alone are not sign-off.
- [ ] **Data VM loss risk:** Same-VM backups do not meet the ≤24-hour RPO for VM/disk loss. Record explicit owner acceptance or add independent storage before release. Never mark universal disaster recovery passed.
- [ ] **Chat/notifications gate:** Execute `FUN-09..10`, `CONC-04` and `CHAT-01..08` on the frozen candidate in three independently signed-in browser profiles across two departments. Record allowed and denied member/media access, CMS membership removal and immediate withdrawal, moderation/archive, staged attachment switching and verification, long-history pagination, notification/cursor race, API/WSS recovery and source-of-truth DB/API/UI comparison. The CMS member-removal and attachment-draft controls have local developer coverage; independent real-service proof is still required. See `evidence/chat-notifications-developer-verification-2026-11-03.md` and `evidence/product-ui-chat-attachment-drafts-developer-verification-2026-11-04.md`.
- [ ] **API-key issuance hold:** On the frozen CMS/API candidate, confirm Create and Rotate are absent even for a grant-bearing administrator, direct authenticated requests return `409 API_KEY_AUTH_UNAVAILABLE` without changing records, retained keys list without hashes/secrets, and authorized Revoke succeeds. Developer evidence: `evidence/product-ui-api-keys-policy-developer-verification-2026-11-04.md`.

- [x] Disposable Linux CMS/API/Electron flow demonstrated independent PDF pages, video Loop On/Off, multiple items, simultaneous slots, corrupt-media advance, schedule hard stop, cached offline restart/recovery, take-down and page-aware PoP persistence.
- [x] CMS/server/player focused tests and builds passed; Linux AppImage and amd64 `.deb` were created with recorded hashes.
- [x] Deleted-user ownership source/build checks, affected DB-backed routes and migration `0045` upgrade/repeat/failure/recovery rehearsal passed on disposable PostgreSQL. This is developer evidence only; the complete QA matrix and release recovery gate remain open.
- [x] Authorization/session/Requests developer verification passed server/CMS/player builds, focused unit/integration suites, six CMS browser cases and built-API HTTP checks. A multipart authorization-revocation cleanup defect was fixed and the final affected server rerun passed 65/65. Multi-process live sockets remain open.
- [ ] `AUTHN-04`, `AUTHZ-01..03`, `AUTHZ-06`, `AUTHZ-08..13` require independent QA runtime evidence; bounded developer checks do not mark these cases Pass.
- [ ] `AUTHZ-07`, `DATA-06`, `CONC-07` and `UI-07` require independent QA runtime evidence; no Pass/Actual Result may be inferred from the checked developer items above.
- [ ] Fresh-machine installation/reboot tests for the generated Linux packages remain pending.
- [ ] Windows x64 package/install/kiosk/playback and supported physical display matrix remain pending.
- [ ] Long soak, approved performance limits, physical-player secure lock/cache purge/recovery, all-player update-and-connect capability deployment, accessibility and full product/security regression remain pending.
- [x] Server, CMS and player blocking-error lint exits successfully. The two no-behavior errors found during the review were corrected; the existing warning backlog remains technical debt and is not represented as remediated.
- [x] Webpage/default-priority focused developer gates passed: real-PostgreSQL settings/media routes, migration unit, server policy/jobs/default resolver, one-worker CMS flows, player full unit and fault suites, builds and release-bundle configuration.
- [x] Live built-API/worker/Chromium developer flow exercised requirements 1-17 successfully, including real webpage capture, denied redirect reachability, retained failed-refresh preview and rendered preview fallback. This is partial developer evidence only.
- [x] Requirements 19-24 focused player/CMS/server automation, complete player unit/integration/fault/performance suites, component builds and static QA traceability passed at the recorded working-tree baseline. This does not replace independent QA.
- [x] Requirements 19-24 developer runtime gate passed twice with the real Linux Electron player: selected/invalid PDF pages, corrupt-video progression/retry cancellation, 41/18 ms hard stops and 120,144/120,146 ms secure lock/fresh-authority recovery. Independent QA remains open.
- [ ] **BLOCKER — BR-102 / DEF-04 / R-38:** the no-Schedule/no-default path must show the approved standard company fallback image. Current runtime returns `NONE` and renders a text-only `No content assigned yet` card.
- [ ] `RET-01..03`, `DEF-01..03` and `FUN-06` require independent QA on the frozen candidate: webpage creation/reference denial and inert historical rows, packaged player unavailable state, and Reports/Audit Logs PDF content and layout after the LibreOffice change.

## Build And Environment

- [ ] Signed site/release manifest, installer and role archives verify against the independently pinned key; provenance and compatibility generation match. `DEP-01`, `DEP-05`.
- [ ] Approved real capacity evidence matches site/release, workload and resource policy; sample template values are never accepted as measured evidence. `PERF-01`, `DEP-02`; BQ-017.
- [ ] Transfer, staging, Docker, release, worker scratch, database, MinIO and off-host storage have measured free capacity for the entire update and backup; low space rejects before partial activation. `DEP-02`, `BKP-01`.
- [ ] Actual VM firewall rules and certificate trust match the approved network boundary. `DEP-06`, `SEC-02`; BQ-019.
- [ ] The documented client/platform matrix and physical displays have native package, kiosk, autostart, portrait/landscape and content evidence. `COMP-01..03`, `PLAYER-05`; BQ-016.

## Data And Recovery

- [ ] Nonempty database and all contracted object classes, including logs-auth and log archives, are in off-host backup manifest and restore to an isolated clean target with verified counts/hashes. `DATA-03`, `BKP-01..02`.
- [ ] Recovery evidence is fresh, signed by the separate authority and tied to this site/release policy. The recorded measured RPO/RTO meet the approved BQ-018 thresholds.
- [ ] Retention/deletion obligations for DB records, media, chat, screenshots, logs, metrics and backups have owners and evidence. Do not infer compliance from a config field or unused cleanup function. `BKP-01`, `PERF-04`; BQ-015/020.
- [ ] If upgrading, forward migration baseline, backup/restore plan, downtime window and compatible client/player versions are approved. Failed migration leaves a controlled state; no old image is started against unreviewed schema. `DEP-03`, `BKP-03`; BQ-018.
- [ ] Migration `0045` is rehearsed on a disposable legacy-data copy for organization/valid-department/restricted/missing/nullable and pre-migration-transferred creator classes, constraints/indexes, tombstone references, repeat invocation and recovery. The developer PostgreSQL rehearsal passed these technical paths; QA/release still needs frozen-candidate evidence, human acceptance of unknowable historical departments and a rollback decision that disables physical deletion on an older server. `DATA-06`, `BKP-03`; R-25/R-29.
- [ ] Migration `0047` remains in the historical schema chain. Verify fresh install and upgrade/reapply preserve old rows without starting retired webpage capture jobs. `DEP-03`, `BKP-03`; R-36.
- [ ] An interrupted first install resumes correctly, old release stop script cannot stop the new active role, and stable volumes/site identity are preserved. `DEP-05`, `DEP-07`.

## Product And Security

- [ ] All release `P0` cases pass with execution evidence and reviewed defects. Open Critical/High risks in `03_RISK_REGISTER.csv` have explicit disposition; no source-only finding is counted as a passed runtime test.
- [ ] Last-active SUPER_ADMIN protection passes delete/disable/demotion, one-versus-two account, concurrent removal and recovery CLI paths. Custom roles follow effective direct/inherited/conditional permissions regardless of name. `AUTHZ-01..02`; R-03/R-30/R-33.
- [ ] Immediate withdrawal passes after disable/delete, password, role, department and direct/transitive permission changes across REST, protected socket actions and at least two API nodes. Distinguish already-running work and Valkey failure. `AUTHN-04`, `CONC-07`; R-01.
- [ ] People directories pass active-only shared-current-department filtering across users/operators/invites/chat pickers, guessed IDs, totals and pagination, with global `manage User` as the only global-directory exception. Primary-only users retain same-department behavior. `AUTHZ-08`; R-31.
- [ ] Operator additional membership passes `AUTHZ-14..18`: one primary remains scalar/JWT/owner; assigned A/B/C access and D denial; global-only assignment; old CMS PATCH preservation; role/tombstone cleanup; transactional session withdrawal and mutation races; continuing access to already shared chat message files and validated file bookmarks but no removed-department library/discovery; legacy bookmarks without share proof have an explicit release disposition; migration/reapply and department deletion concurrency. Review the dated developer artifact, then capture independent human QA results; R-43.
- [ ] Media/Layout/Presentation creator mutation, permitted same-department read, Schedule same-department action-specific management, cross-department denial, nested closure and ADMIN organization versus SUPER_ADMIN restricted classification pass for every actor/scope. `AUTHZ-09..13`; R-02/R-25/R-26/R-27/R-32.
- [ ] User tombstone/email reuse/list exclusion/history display, owning-department deletion counts, UI confirmation/labels/action flags, no deleted-email disclosure, upload/finalization and PROCESSING-worker commit orders, duplicate-worker safety, non-reactivation and retryable source/ready/thumbnail object cleanup pass with evidence. `DATA-06`, `CONC-07`, `REL-02`, `UI-07`; R-25/R-28.
- [ ] Delegated emergencies are accessible in CMS and constrained to authorized direct Screens for trigger/status/history/clear; global Emergency managers control group/global targets; READY/readable media and transaction-time recheck pass. An exact 120-second authenticated-backend outage still stops every authority and erases only media cache. `AUTHZ-03`, `PLAYER-03..04`, `PLAYER-16`.
- [ ] Migration `0044` is rehearsed; the document page-count backfill dry-run is reviewed before apply; malformed/encrypted failures are resolved; rollback retains nullable compatibility columns until affected snapshots/PoP age out. `DATA-05`, `FILE-06`.
- [ ] Media upload, conversion, selected-page CMS preview, immutable snapshot, capable-player playback, page-aware PoP, retired webpage rejection, chat and reports pass smoke/UAT on actual target hardware. `10_SMOKE_REGRESSION_UAT.md`.
- [ ] Historical availability and delivery evidence pass on the frozen candidate: 90-second server-received outage threshold, immediate explicit OFFLINE/ERROR, next-heartbeat recovery, backend/pre-first-heartbeat UNKNOWN, Never seen, known-time denominator and Asia/Kolkata buckets. Assigned, exact publish/snapshot application, fresh reported playback and publish-linked renderer PoP remain separate; no surface claims human-visible proof. `FUN-11`, `UI-04`, `PLAYER-07`; R-10.
- [ ] Observability uses the approved site-local player inventory and PKI. Both real players scrape over mTLS from the observability VM only, machine/player target and fleet totals match Prometheus, CMS `/grafana/` health/login/drill-down works, and empty/down/unreachable states remain truthful. `OBS-01..02`, `DEP-06`; R-10/R-20.
- [ ] Video-only loop selection survives CMS draft/review/request and API/snapshot round trips; a short video completes at least three native cycles on one mounted occurrence, coexists with the selected PDF page, and stops at every hard boundary. Corrupt multi-item video shows `Unavailable` until its original boundary; a failed only-item frame retries once per clamped 1–30 second interval; no hidden audio, timer storm, stale callback or resource growth occurs. `UI-06`, `API-07`, `PLAYER-11..15`, `OBS-04`, `PERF-06`; R-24/R-40/R-41.
- [ ] Every target player is updated, has connected once and has advertised `pdf_page_selection_v1`; schedules using page >1 are blocked until that prerequisite is complete. Page 1 remains compatible while capability data is absent, but mixed-version playback is not an accepted release mode. `API-06`, `COMP-04`; R-22.
- [ ] Post-publish PDF page mismatch and CMS stale-page restoration meet BR-103: CMS preserves/blocks the invalid value; player shows exact `Unavailable`, emits safe requested/actual context, and never renders a substitute page. `UI-05`, `PLAYER-10`; R-39.
- [ ] Secure recovery meets BR-107: locked heartbeat only reports reachability/starts one recovery; identity validation, forced fresh snapshot, current-content sync/check and authority apply precede unlock; invalid identity re-pairs, snapshot failure remains locked with bounded retry, and stale authority never resumes. `PLAYER-03..04`, `PLAYER-16`; R-05/R-42.
- [ ] New site configuration contains no `WEBPAGE_*` or Playwright Chromium settings; the backend image contains no Playwright browser runtime, and old preview jobs/routes cannot run. `RET-01..03`; R-35/R-36.
- [ ] Default priority `0..100`, deterministic tie-break, direct-Screen precedence, legacy zero, edit preservation and two-writer stale conflict pass on the frozen database/CMS/player build. `FUN-06`, `DEF-01..03`; R-37.
- [ ] The approved standard company fallback asset is versioned in the release, resolves when no Schedule/default is eligible, renders online/offline on packaged physical players and survives restart/cache damage as specified. `DEF-04`, `PLAYER-05`; R-38.
- [ ] General Requests old URLs/OpenAPI/CMS/client/report/webhook surfaces are absent and legacy rows are not exposed; Schedule Requests still pass smoke. `AUTHZ-06`; R-18/R-34.
- [ ] Human policies remaining for BQ-013/015/016/017/018/019 and BQ-020 Media/chat recycle behavior are answered or accepted as explicit limits. BQ-014 availability/delivery semantics are closed by BR-038/061 but still require the execution evidence above; BQ-011/012 are closed by BR-097..101. A remaining TBD affecting recovery, capacity or critical playback cannot be silently converted to Pass.

## Decision Record

| Field | Human completion |
| --- | --- |
| Release and source commit | Pending |
| Site / environment and role generations | Pending |
| QA case evidence location | Pending |
| Approved capacity profile and workload | Pending |
| Restore rehearsal, RPO and RTO evidence | Pending |
| Open defects and risk exceptions | Pending |
| Product/security/operations approvers | Pending |
| Decision: Go / No-go / Conditional with owner and date | Pending |

## Live broadcast implementation delta — 2026-11-03

- [ ] LiveKit/adapted media-engine gate proves every signaling reconnect and
  original/refreshed replay denied after withdrawal, existing media terminated,
  legitimate connection preserved on duplicate/replay and supervisor/watchdog
  isolation when removal cannot be confirmed (`LIVE-06`, `LIVE-11..13`).
- [ ] Real CMS request/direct publish, frozen per-item audiences, current
  permissions and constrained scheduled/runtime capacity pass concurrent tests
  (`LIVE-01..06`). No old CMS/player silently mutates/displays unsupported live.
- [ ] The scheduled live event/media source runs in the same ordinary installed
  DARSHAN player with normal pairing/lifecycle/cache/emergency; no separate
  receiver app or developer-only prototype is accepted as the final feature.
- [ ] Real packaged player meets 3s renewal/10s video-and-audio cutoff, 1s local
  live end, verified pinned fallback/Content unavailable and emergency/security/
  resume behavior (`LIVE-07..10`, `LIVE-14`).
- [ ] Sixth role signed/offline artifacts, trusted CMS HTTPS and player Chromium
  trust, firewall/UDP/TURN, feature disable, update/rollback and rotated external
  restore epoch are rehearsed (`LIVE-15..16`).
- [ ] Windows/actual Chrome/Edge matrix, physical display/audio,
  whole-machine sleep with separate Backend and cross-VM fault evidence are
  complete (`LIVE-15..17`).
- [ ] Representative 1x25,5x25,10x25, simultaneous transitions/reconnect and soak
  evidence supports the agreed six-VM deployment hardware; report unmet
  resources rather than reducing limits or assuming seamless failover
  (`LIVE-18`). Existing BQ-017/RPO/RTO gates still apply.
- [ ] Fresh truthful diagnostics, sanitized audit, stable-packet regression and
  independent human `LIVE-01..20` results bind to frozen commits/artifact hashes
  (`LIVE-19..20`). Existing unrelated blockers remain open.
- [ ] QA has independently executed and signed **all 20** `LIVE-01..20` case
  rows on the frozen candidate, with per-case actual results and linked
  evidence. Developer screenshots and automation remain supporting evidence.
- [ ] Cross-VM CMS/Backend/Media/player TLS trust and signaling/media ICE paths,
  Windows and Ubuntu installed players, physical display and optional audio,
  measured 10 broadcasts × 25 receivers, and isolated production-sized restore
  each have passing, artifact-bound QA records. An unrun item is a release
  blocker, not an implicit pass from the local live-frame result.

Current status is in progress; no new item above is a pass. See [evidence/live-broadcast-developer-verification-2026-11-03.md](evidence/live-broadcast-developer-verification-2026-11-03.md).


Capability-gated publication and its supporting API/DB/MinIO checks now exist.
Live runtime is default OFF. Source now includes the normal-player coordinator,
Backend authority, CMS controls/reports and optional signed sixth-role bundle
path. This paragraph is the earlier publication-only checkpoint; the later
dated developer ledger records local integrated capture and a packaged-player
frame. Native host/platform/site acceptance, production artifact installation
and independent acceptance remain unfinished verification gates.
This packet cannot be released as the completed live feature, and no checkbox
above is closed by developer source/fixture evidence.
See [publication evidence](evidence/live-publication-authorization-developer-verification-2026-11-03.md).

## Runtime and authoring developer checkpoint — 2026-11-03

The packet is **implemented in source, default OFF, and locally developer-verified**. It is not beta acceptance or release approval. The [dated developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md) binds the final real CMS/packaged-player run, screenshots, timings and local regression results. Earlier [runtime/authoring evidence](evidence/live-runtime-authoring-developer-verification-2026-11-03.md) retains its original source/build scope; an older SFU/prototype result cannot validate a later build. All `LIVE-01..20` remain **Not Tested** and QA-owned execution/result/defect/sign-off fields remain unchanged.

The final local current-source integration and regression are recorded in the dated ledger. The earlier synthetic-screen CMS success, route/component automation and signed fixtures alone do not close any item above. Do not ship this packet as completed LIVE until physical frame/audio, current Backend/media/host-readiness/death witness, production artifacts, supported platforms, cross-VM/10×25/restore and independent acceptance are evidenced or explicitly dispositioned by responsible humans.

Later developer verification has now shown native tab capture through the real
CMS and a decoded live image on the ordinary packaged Linux player, followed by
Stop, visible fallback and an explicit restart. The [developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md)
binds the private build and sanitized screenshots. This closes the earlier
*absence of any local live frame* but does not close the release gate: the
final observation-refresh packaged build and low-load end timing were then
verified in a separate one-screen window. Its receiver stayed `READY` six
seconds before the boundary; it stopped 296 ms early, within the one-second
tolerance, and the player showed standby after the window. Physical
audio/display, cross-VM ICE/TLS/firewall, capacity/soak, restore and
independent QA remain.
