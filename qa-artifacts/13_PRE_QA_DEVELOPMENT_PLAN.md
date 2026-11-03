# Pre-QA Development Completion Plan

> **Beta6 delivery/availability/observability checkpoint — 2026-11-02:** exact
> publish/snapshot acknowledgement, renderer-linked PoP, server-received
> availability, truthful observability summaries, player mTLS scrape support
> and Grafana proxy fixes have focused developer and packaged Linux AppImage
> evidence through `6a34b2f`. Exact results and the five-VM/physical-player
> boundary are in
> `evidence/dashboard-observability-report-developer-verification-2026-11-02.md`.
> This checkpoint extends rather than erases the historical plan below.

> **Requirements 19-24 checkpoint — 2026-10-21:** PDF invalid-page,
> corrupt-video retry/boundary, universal schedule hard-stop and secure recovery
> implementation plus automated component gates are complete in the working
> tree based on `d8281db`. The current CMS flow and two Linux Electron runtime
> passes are complete. Exact evidence is in
> `evidence/playback-recovery-developer-verification-2026-10-21.md`. Therefore
> the older “ready for independent QA” checkpoint below is historical and does
> not describe the current working tree.

> **Webpage/default-priority closure — 2026-10-17:** policy-controlled HTTP and
> HTTPS, unsupported login mechanisms, per-hop redirect validation,
> latest-success revisioned previews, manual/24-hour refresh and deterministic
> group priority are implemented in the working tree based on `c680c0a`.
> Focused server real-PostgreSQL tests, server unit/policy tests, CMS one-worker
> browser tests, player full unit/fault suites and all three builds passed.
> Exact evidence and independent-QA limits are in
> `evidence/webpage-default-priority-developer-verification-2026-10-17.md`.

> **Final developer closure — 2026-10-17:** the later multi-loop developer-QA
> cycle completed the affected PostgreSQL/migration suites, built-API smoke,
> CMS browser flow and full player automation. It found and fixed the multipart
> authorization-revocation cleanup race, then passed the post-fix build and
> affected reruns. Exact results and remaining independent-QA gates are in
> `evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md`. Earlier
> “pending/unexecuted” entries below are retained as the original plan/history
> and are superseded where the closure report records execution.

> **Superseding decision — 2026-10-16:** the user limited the remaining developer
> gate to a 10–15 minute low-resource smoke check and assigned the deeper
> database, migration, browser, Electron, concurrency, security/load and soak
> work below to QA/release validation. That smoke is complete and recorded in
> `evidence/runtime-2026-10-16/fast-developer-smoke.md`. The detailed plan below
> remains the QA/reference backlog; it is no longer a blocker to beginning QA.

Plan date: 2026-10-16  
Target branch: `release-01`  
Scope: deleted-user ownership, document page selection, video looping, authorization/session/Requests, webpage playback/preview refresh, and default priority
Purpose: finish implementation and developer verification before handing the build to independent QA. This plan is not QA approval, and a developer result must not be recorded as a QA `Pass`.

## Release Outcome

The build is ready to enter QA only when all three feature contracts are implemented across database, API, CMS, player, telemetry and migration paths; automated suites are green; the disposable runtime rehearsal is complete; remaining limitations are documented; and QA receives a fixed commit/build identifier with expected results for every assigned case.

## Current Development Checkpoint

Checkpoint date: 2026-10-21
Overall state: **requirements 19-24 developer verification complete;
independent QA and release gates remain — not release-approved**

| Workstream | Current evidence | Remaining before QA |
| --- | --- | --- |
| Deleted-user ownership and tombstones | Stable ownership/tombstone behavior, affected DB/API tests, migration `0045` upgrade/repeat/failure/recovery and CMS ownership browser checks passed. Multipart creation now compensates when revocation wins before upload-session activation. | QA repeats the matrix on the frozen candidate and completes real object-store outage, two-node socket and remaining deterministic concurrency cases. |
| Document page selection | CMS/API/player implementation, supported-format ingestion/publication, selected pages 2/5, CMS author/review browser checks and full player automation passed; earlier Linux Electron runtime evidence is retained. | QA validates the frozen build on approved physical targets, all-target update/connect capability, offline replay and Windows. |
| Video looping | Occurrence-level publication and CMS Loop On review passed; player build plus all 384 unit/integration/performance/fault tests passed for native wraps, loop-off, multi-item, resume/stall and authority-boundary cleanup. | QA observes the frozen build on physical Linux/Windows targets and completes the long resource-growth soak. |
| Runtime stack | Current production server image starts successfully against isolated PostgreSQL, Valkey and S3-compatible storage; API/worker health and live CMS authentication have been exercised. A production logger packaging defect was fixed and regression-tested. | Validate with the exact approved object-store/dependency image or retain an explicit release risk; complete player pairing, restart/offline recovery and the 30-minute combined stability observation. |
| Authorization/session/Requests | Implemented through `a01804c`; focused unit/DB/API/browser checks passed. The built API returned `409` for last-active SUPER_ADMIN disable, `404` for general Requests, `200` for Schedule Requests and rejected a disabled user's old token immediately. | QA runs `AUTHN-04`, `AUTHZ-01..03`, `AUTHZ-06`, `AUTHZ-08..13` and `CONC-07`, especially two API nodes/live sockets, recovery CLI and the complete directory-picker matrix. |
| Webpage playback and preview refresh | Server/player policy, release HTTP configuration, per-hop redirect checks, login cancellation, migration `0047`, manual/due refresh, revision serialization/cache and controlled renderer fallback are implemented; bounded automated gates passed. | QA runs `WEB-01..06`, `FUN-08`, `PLAYER-09` with real controlled HTTP/HTTPS/DNS/auth/redirect fixtures, object-store faults and a packaged player. |
| Default priority | CMS/API priority `0..100`, legacy zero, deterministic resolver, preservation on media-only edits, expected revision and PostgreSQL advisory-lock serialization are implemented; route and CMS conflict tests passed. | QA runs `FUN-06`, `DEF-01..03` with overlapping groups, two real clients and end-player observation. |
| Requirements 19-24 playback/recovery | Focused CMS/player/server tests, complete player unit/integration/fault/performance suites, component builds, disposable API/worker ingestion, current-player pairing, and two Linux Electron journeys passed. | Independent QA runs the approved platform/physical-display/audio matrix, Windows coverage, capacity and soak; fleet deployment proves every player upgraded and connected once. |
| QA package | All 116 case rows have the required planning fields, including Expected Result; the 140-row traceability matrix and developer reports are linked from `README.md`. | Leave independent QA fields unclaimed, complete the current runtime evidence, assign owners to remaining site-policy decisions, and bind the handoff to one immutable release build. |

Evidence already collected is developer evidence only. It may justify `Partially Tested`; it must not be converted to an independent QA `Pass`.

The latest no-application static checkpoint passed the server TypeScript compile and the complete bounded server pure-unit suite: **50/50 tests across 15 files**. The configuration now includes the mocked auth-throttle and webpage-processing route/job suites, media-processing compare-and-set regressions, and transitive role-impact coverage. No Docker service, database, API, worker, browser automation or Electron player was started for that checkpoint.

## Open Development Work Register

These are the concrete remaining tasks. They are ordered so that a later task does not validate code that an earlier task may still change.

| ID | Change or verification target | Required developer result | Blocking evidence |
| --- | --- | --- | --- |
| `DEV-OWN-01` | **Source implemented; DB/runtime verification pending.** Presentation detail/items/slots, Schedule item expansion and Schedule Requests reuse `contentResponseMetadata` for nested Media/Layout/Presentation/Schedule objects. Resumable upload-session and legacy presign Media creation paths now return the same metadata, including PENDING Media. DB-backed route assertions cover nested and upload response shapes; they must run once isolated PostgreSQL is intentionally restarted. | Creator/peer/lead/other-department/admin responses neither leak inaccessible children nor omit the ownership/action metadata needed by CMS. Contract and DB/API tests cover direct and expanded routes. | `AUTHZ-07`, `SEC-01`; direct JSON captures from the frozen build. |
| `DEV-OWN-02` | **Upload, background-processing and notification race automation authored; DB/runtime execution and remaining live cases pending.** Controlled object-store barriers cover deletion during multipart `INITIALIZING`, deletion after promotion but before finalization commit, deletion after finalization commit but before response cleanup, validation failure after deletion already marked the upload `ABORTED`, validation failure after department transfer, department transfer while finalization is paused, and delete-first legacy PENDING finalization. Tombstoning now also stops `PROCESSING` Media. Document conversion, video transcode and webpage capture commit READY only through a `PROCESSING` compare-and-set; deletion-first results are compensated, duplicate-worker winners are not deleted, failure callbacks cannot overwrite the deletion reason, and stale thumbnails cannot attach to failed Media. Partial source/ready/thumbnail references are included in retry cleanup. Upload-session read/resume/part/complete/abort/idempotent-retry authority requires the original creator plus current management of the Media's stable owner; the final transaction locks and re-reads current user, role, session and Media. If a guarded commit throws because deletion/transfer won, promoted/source objects and provisional storage rows are compensated. Failed deletes retain retryable storage rows, and the hourly cleanup observes a two-hour grace for generic orphans. Pure compare-and-set and mocked webpage regressions pass; PostgreSQL/S3 execution remains pending. The final production-caller audit found one notification-insertion entry point: it takes a recipient share lock and rechecks active/non-deleted state, while tombstoning takes the conflicting update lock. A PostgreSQL advisory/row-lock test forces notification-first and deletion-first orders. A focused socket unit test passes for disconnecting the authenticated user room across chat, notifications and screens. | Delete/transfer-first prevents new authority or READY media, removes any object promoted/observed after an earlier cleanup attempt and retains the authoritative terminal state; duplicate worker delivery cannot delete the winning READY object; failed compensation is retried; finalize-first retains a valid completed asset under stable ownership; a moved creator cannot resume an old-department upload even with a new token; notification-first commits before deletion or deletion-first rejects the notification without creating its unread counter; all sessions/reconnects fail after commit; one deletion audit exists; cleanup converges. | `AUTHN-04`, `CONC-07`, `REL-02`; DB rows, worker state transitions, socket observations, object listings and retry logs. |
| `DEV-OWN-03` | **DB/API coverage authored; execution pending.** The route suite now covers a read-only custom role, a custom-role creator with update permission, a custom role without a department, filtered pagination totals, direct publish-history/status reads and Schedule Request cancellation. The audit found and closed two route gaps: publish-history/status now require Schedule read ability as well as ownership, and cancellation plus administrator request transitions now require ScheduleRequest update ability. TypeScript and focused lint pass; run it when isolated PostgreSQL is intentionally restarted. | Read ability never becomes mutation authority; creator authority still requires the owning department; no-department creation is denied; list totals/counts describe only rows visible to that actor; publish/request subroutes enforce ability and ownership together. | `AUTHZ-07`, `API-05`, `DATA-02`; route responses and database row counts. |
| `DEV-OWN-04` | **Lifecycle coverage authored; DB/runtime execution pending.** The route suite now moves and tombstones a Schedule Request's requester, denies the moved requester, verifies deleted attribution privacy and allows the original owning department lead to cancel. The hourly cleanup path now calls one exported production worker function; its DB test injects object-store deletion failure, recovery, terminal marking and an idempotent no-op. Use the supported single-backend production topology; if multi-instance browser Socket.IO is introduced, distributed user disconnect becomes a separate prerequisite. | Request access/control continues from the Schedule's stable owner rather than the requester's current account; deleted attribution remains private; failed object cleanup stays pending and later converges to a final marker without reviving Media. | `AUTHZ-07`, `AUTHN-04`, `CONC-07`, `REL-02`; request states, tombstone metadata, worker logs and object listings. |
| `DEV-OWN-05` | **Shared guard and deterministic tests are authored; DB execution remains.** `withCurrentMutationAuthorization` locks and re-reads the current user, access session and role in the same transaction as each guarded resource write. It now covers Layout create/update/delete; Presentation create/update/delete and item/slot replacement; Schedule create/update/item/publish/take-down/target updates; Schedule Request create/edit/approve/publish/reject/cancel/take-down; and Media creation, upload-session create/activate/claim/expiry/abort/finalize, legacy finalization and deletion. Media object deletion occurs only after the authorized database mutation commits; failed deletion retains a `storage_objects` record for the existing orphan-cleanup worker. Upload validation failure also uses an expected-state transaction, preserving a deletion-won `ABORTED` state. Two PostgreSQL tests use real row locks plus `pg_blocking_pids` barriers to prove transfer-first rejection and write-first completion without sleeps. Capped TypeScript and focused lint report zero errors; run the new transaction tests and existing upload-race suites when isolated PostgreSQL can be restarted. No runtime result is claimed yet. | Transfer/deactivation-first makes the old request fail without a row/state change; write-first commits before the account change and retains the original stable owner; no stale token can write after the change commit; every affected route uses the same guard or a reviewed equivalent; terminal deletion state and failed object cleanup remain retryable and cannot be overwritten by a late validator. | `AUTHN-04`, `AUTHZ-07`, `CONC-07`; transaction-order tests, DB state and cleanup-worker evidence. |
| `DEV-OWN-06` | **Account/role session race source fix and tests authored; DB/socket execution pending.** Login session issuance locks and rechecks the live user/password hash before inserting the session. Owned-resource writes lock the complete effective-role graph before user/session state; role updates take the complementary update lock, recheck the current actor/session in that transaction, update the role and revoke sessions for users assigned directly or through transitive inheritance, then disconnect local chat/notification/screen rooms. Pure direct/transitive/cyclic role-impact tests pass; deterministic PostgreSQL old-password/login and role-update revocation tests, including a grandchild role, are authored but unexecuted. TypeScript, production build, focused/full zero-error lint and the bounded 50/50 unit suite pass. The recovery CLI runbook requires stopped/restarted backend instances because a separate process cannot directly disconnect Socket.IO clients. | Account/role-change-first prevents session issuance or mutation from stale authority; write/login-first completes before the waiting change and is then revoked as applicable; parent-role edits revoke descendant-role sessions; role-definition changes leave no committed old-effective-role session and disconnect affected local sockets; supported CLI recovery leaves no pre-recovery live backend process. | `AUTHN-04`, `CONC-07`; transaction barriers, session rows and live REST/socket clients in a dedicated `*_test` database. |
| `DEV-MIG-01` | **Rehearsal automation expanded; DB execution pending.** The integration test now seeds administrator, valid department, no-department, transferred-before-migration, missing-creator and nullable-creator records across all four tables; checks mapping, constraints, index presence, owner check enforcement, department/creator restrictions, tombstone references and repeat invocation; and uses a second clone to force transactional failure followed by forward recovery. Build/lint pass. | Deterministic organization/department/restricted mapping, valid checks/FKs/indexes, retained creator references, physical delete rejection, no duplicate effects, documented human review for unknowable historical departments. | `DATA-06`, `BKP-03`; schema queries, row counts and migration logs. |
| `DEV-CMS-01` | **Mocked tests authored; execution pending.** `content-ownership.e2e.spec.ts` covers Media/Layouts ownership labels, active/inactive/deleted/unknown creator display, permission-flag fail-closed behavior, a stale allowed action receiving server `403`, user-delete explanation/focus/Escape behavior, and Schedule Queue/Request Detail nested ownership plus page/loop labels. The scheduling test asserts deleted-creator privacy and selected pages 2/5 plus Loop On in review/payload. Playwright discovery and CMS blocking-error lint pass without launching a browser. Browser execution, draft restore/reorder and one live CMS-to-API flow remain. | CMS sends the correct per-occurrence payload, restores it after save/reorder, displays page/loop/ownership consistently and never enables an action denied by the server. | `UI-05..07`, `API-05`, `API-07`; Playwright result plus sanitized screenshots. |
| `DEV-DOC-01` | Re-run current Linux player with native and converted documents, duplicate page 2/5 occurrences, capable/incapable targets, offline cache and spooled/replayed proof-of-play. Include resize/high-DPI/multi-slot cancellation. | Selected page is identical in CMS, stored occurrence, snapshot, display and PoP; legacy null is page 1; invalid page is visible and never silently substituted; resources remain bounded. | `PLAYER-08`, `PLAYER-10`, `OBS-03`, `COMP-04`, `PERF-05`. |
| `DEV-VID-01` | Run Loop On and Loop Off in current Linux Electron. Cover one and many items/slots, short/equal/long duration, late join, restart/offline, rejection/decode/stall recovery, schedule end and emergency/default/secure-lock/shutdown replacement. | Loop On makes at least three complete native wraps on one mounted occurrence; Loop Off plays once; multi-item timing advances; every authority boundary stops old picture/audio and pending callbacks; PoP remains occurrence-based. | `PLAYER-11`, `PLAYER-12`, `OBS-04`; recording, logs and DOM/media/timer counters. |
| `DEV-STAB-01` | Run the final API, worker, CMS and player together for at least 30 minutes on the approved isolated topology, including selected PDFs, looping videos, conversion work, reconnect and one controlled takeover. | No unexplained CPU/RAM/handle/DOM/timer/object/queue growth, replay storm, duplicate audio or duplicate PoP. Health and worker heartbeat remain valid. | `PERF-04..06`, `REL-01..02`, `OBS-01`. |
| `DEV-RC-01` | Freeze one clean commit, build artifacts from it, record hashes/configuration/migration level and repeat all affected automated gates. Remove or exclude generated scratch outputs and reconcile every document to the same revision. | Clean synchronized `release-01` release candidate; reproducible evidence; no stale/empty result presented as a pass; QA-owned result fields remain blank. | Release manifest, commit/build hashes, `git status`, complete gate report and approved exceptions. |
| `DEV-WEB-01` | Freeze and deploy migration `0047`, identical server/player webpage policy and preview-refresh configuration before publishing new webpage media. | HTTP decision and allowlists are explicit; every hop is enforced; latest-success revision identity survives success/failure and reaches snapshot/default/player cache. | `WEB-01..06`, `FUN-08`, `PLAYER-09`; migration/config manifest and real controlled-fixture evidence. |
| `DEV-DEF-01` | Freeze priority/revision schema and run two-client settings plus overlapping-group playback on the candidate. | Priority remains within `0..100`, winner is deterministic, edits preserve omitted priority and stale writes return `409` without losing local input. | `FUN-06`, `DEF-01..03`; DB rows, responses, CMS and player evidence. |

An implementation change in any row reopens all later rows that depend on it. The current disposable stack is intentionally stopped; warn the workstation owner before beginning `DEV-OWN-02` through `DEV-STAB-01`, because those tasks start database, object-store, browser or Electron processes.

## Resource-Safe Execution Plan

The 2026-10-16 interruption was a host-memory failure, not an application assertion failure. Linux killed three `chrome-headless` processes in the VS Code user scope after they reached approximately 2.4–2.91 GiB RSS, which also stopped VS Code. The failed/empty browser result is not evidence.

For this 6.2 GiB workstation:

1. Keep the current static/build/unit phase at `NODE_OPTIONS=--max-old-space-size=768` and do not launch Docker, a browser or Electron while normal desktop usage leaves less than 4 GiB available.
2. Restart the disposable PostgreSQL/Valkey/object-store/API tier only after warning the workstation owner. Run migration and DB/API cases with no browser or Electron process.
3. Stop unneeded API/worker processes, then run Playwright with exactly one worker and no project-level parallelism. Close and verify the browser process before any Electron run.
4. Run Linux Electron/player scenarios separately. Browser and Electron must never overlap on this host.
5. Monitor available memory, swap and largest-process RSS. Do not start below 4 GiB available; abort below 2 GiB available, below 1 GiB free swap, or when one browser process exceeds 1.5 GiB RSS without a stable plateau.
6. Move the combined 30-minute API/worker/CMS/player stability run to the approved QA host or VM topology with measured headroom. Do not force that concurrency onto this workstation merely to close the checklist.
7. After every phase, prove all DARSHAN/Playwright/Chromium/Electron/Vite processes exited. Leave unrelated user applications and unrelated containers untouched.

Source guardrails now enforce one Playwright worker for local and CI runs. `MediaPreview` also serializes PDF.js canvas work across resize notifications and skips same-size repainting. These reduce avoidable pressure but do not replace the pending measured browser/Electron stability run.

These are host-safety controls. Product performance/capacity thresholds still require the separate BQ-017 workload decision.

## Required Delivery Order

Development must complete the remaining work in this dependency order:

1. **Freeze contracts:** approve the three behavior sections below and prevent unrelated scope changes.
2. **Finish implementation:** close ownership lifecycle/race behavior, document conversion/page propagation and player loop lifecycle gaps.
3. **Complete migrations:** rehearse `0044` and `0045` from realistic legacy data, including a deliberately interrupted attempt and supported forward recovery.
4. **Run automated gates:** final server, CMS and player lint/build/unit/integration/browser suites on the same source revision.
5. **Run the isolated product journey:** real API, worker, object store, browser CMS and Linux Electron player with synthetic data and no mocked application APIs.
6. **Run resilience and stability checks:** schedule boundaries, takeovers, restart/offline recovery, failed conversions, deleted-user races and a minimum 30-minute observation.
7. **Reconcile documentation:** API/operator/migration documentation and every QA artifact must describe the behavior actually present in the release candidate.
8. **Create the release candidate:** record commit, image/package hashes, migration baseline, known exceptions and reproducible evidence; then freeze that build for QA.

If a step changes product code, all later steps that depend on that code must be repeated. Evidence from an older build cannot close a final-build gate.

## Fixed Product Behavior

### Deleted users and content ownership

- Deleting a user disables access; it does not delete the user's Media, Layouts, Presentations or Schedules.
- No asset is automatically reassigned to another person. Operational ownership is stored independently as `ORGANIZATION`, `DEPARTMENT`, or `RESTRICTED`.
- Administrator-created content belongs to the organization. Department-created content remains with the department that owned it when it was created. Unmappable legacy content is restricted to administrators.
- The original `created_by` identifier and display name remain for history. The account becomes a tombstone: credentials and private email are scrubbed, sessions are removed, the old email may be reused, and historical UI displays the creator as deleted.
- Moving or deleting the creator must not change stored asset ownership. A department that still owns content cannot be deleted until its owned content is handled.
- Admins can manage all scopes. A department lead can manage its department content. A normal department user can manage only content they created while still belonging to the owning department. Organization and restricted content are administrator-managed.

### Document page selection

- Supported document upload extensions are `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, and `.csv`. Office/CSV sources are converted to a playable PDF before page counting and playback.
- A schedule author chooses one positive whole-number page for each document occurrence. The same document can appear more than once with different selected pages.
- A missing legacy value means page 1. A selected page does not automatically advance to later pages.
- CMS assignment and review previews, the saved presentation, immutable schedule snapshot, player canvas and proof-of-play must all use the same selected page.
- Page 0, negative, fractional, above-count, non-document and stale values must be rejected without partially replacing the previous valid assignment.
- A schedule using page greater than 1 must not publish to a player that lacks `pdf_page_selection_v1`; page 1 remains the compatibility default.

### Video looping

- `Loop video` is occurrence-specific and is valid only for video media.
- When enabled, the video repeats complete native media cycles while that occurrence remains active. It stops at the occurrence/schedule boundary or when emergency, secure-lock, default-content, shutdown or another higher-authority scene takes over.
- In a multi-item slot, looping must not prevent the slot from advancing at that occurrence's configured interval. Independent slots loop independently.
- Loop-off video plays once and holds its completed frame/state until the occurrence changes; it must not restart because the schedule remains active.
- Retries, stalls, decode failures, offline resume and cleanup must be bounded. A loop must not create duplicate DOM nodes, duplicate audio, replay storms, stale callbacks or a new proof-of-play occurrence for every native wrap.

## Phase 1 — Freeze Scope And Baseline

Development work:

1. Preserve the existing working-tree changes and record the exact source commit used as the base.
2. Review the complete diff for accidental changes outside the three features and required compatibility/test repairs.
3. Keep lint changes behavior-neutral. The prior `src/jobs/index.ts:211` `prefer-const` error and the new unused test variable were corrected; server, CMS and player now pass blocking-error lint, while the warning backlog remains tracked separately.
4. Confirm migrations are ordered and present in the production migration manifest: document page selection in `0044`, ownership/tombstones in `0045`.
5. Do not add a second authorization, page-validation or loop implementation. Extend the existing centralized ownership policy, document page normalization and player lifecycle.

Developer gate:

- `git diff --check` passes.
- Server, CMS and player blocking-error lint exits successfully; warnings are reported as technical debt rather than hidden.
- Every changed file is attributable to a stated requirement, migration, test or QA evidence update.
- The branch and working tree are backed up or committed before destructive migration/runtime rehearsal.

## Phase 2 — Finish Ownership And Tombstone Implementation

Database and migration work:

1. Finalize `users.deleted_at` and `users.deleted_by` tombstone columns and stable ownership columns/checks/indexes for Media, Layout, Presentation and Schedule.
2. Backfill deterministically:
   - admin-like creator -> `ORGANIZATION`;
   - creator with a valid current department -> `DEPARTMENT` plus that department ID;
   - missing/invalid mapping -> `RESTRICTED`.
3. Preserve creator foreign keys and make department ownership references restrictive. Document that legacy data cannot reconstruct a department held only at creation time if the creator moved before migration.
4. Verify migration repeatability through the supported ledger and define forward recovery. Do not run an old hard-delete server against the new tombstone schema.

Server work:

1. Keep create/read/manage/list rules in `src/rbac/content-ownership.ts` and apply them consistently to all four resource types and nested Presentation/Schedule references.
2. Ensure create operations capture stable owner fields once; later user transfer/deletion must not recalculate them.
3. Make DELETE-user transactional for session removal, credential/email scrubbing, upload/media state changes and one audit record. Keep external object cleanup retryable after commit.
4. Block all authentication, reset, activation, invite and normal directory paths for tombstones. Disconnect existing REST/socket authority immediately when a user is deleted, disabled, transferred, or materially changed.
5. Serialize ownership-sensitive writes against account changes with one transaction-scoped session/current-actor guard. Transfer/deactivation-first must reject the stale write; write-first may finish before the account change commits. Apply the guard to Layout, Presentation and Schedule create/update/delete/item/slot/request mutations and any Media path not already protected by an equivalent user/content lock.
6. Return server-computed ownership labels and `can_update`/`can_delete` flags. Historical endpoints may resolve a deleted creator but must not expose the old email. This includes audit history, Schedule Requests and the legacy `/requests/:id/messages` projection.
7. Protect upload initialization/finalization and notification creation against deletion races. Exactly one legal result must win, and orphan cleanup must converge.

CMS work:

1. Use server permission flags for actions; do not recreate ownership policy in the browser.
2. Show organization, department, restricted and deleted-creator labels wherever resources are selected or reviewed.
3. Explain in deletion dialogs that access and unfinished uploads stop while existing content remains with its current organization/department owner.
4. Keep deleted users out of normal user/operator lists and do not offer restore or person-to-person reassignment in this release.

Automated coverage:

- Unit: scope normalization, creation ownership, read/manage/reference closure, deleted display metadata.
- DB/API: every resource x owner scope x actor class x list/detail/create/update/delete matrix.
- Lifecycle: creator transfer, deletion, repeated deletion, email reuse, schedule-request/history continuity, department-delete conflict counts.
- Concurrency: session/socket revocation, upload initialize/finalize versus deletion, notification versus deletion, cleanup retry.
- Migration: apply through `0044`, seed every legacy mapping class, apply `0045`, validate rows/constraints/indexes/tombstones, rerun ledger, and prove physical user deletion is rejected.

Exit condition:

- The complete ownership matrix passes in automation; the legacy migration rehearsal passes on a disposable database; no deleted credential/email is observable; and all four resource types retain stable custody and historical attribution.

## Phase 3 — Finish Document Page Selection

Ingestion and persistence work:

1. Confirm native PDF inspection and Office/CSV conversion store the page count of the final playable PDF before media becomes `READY`.
2. Preserve `page_number` per presentation occurrence through create/update, request views, schedule resolution, immutable snapshot and telemetry.
3. Keep atomic slot replacement: one invalid occurrence rejects the entire update and leaves the previous assignment unchanged.

CMS work:

1. Show the page input only for documents, default to page 1, limit it to positive integers and use the known page count when available.
2. Render the selected page in assignment preview, review, request details and schedule queue displays.
3. Keep duplicated document occurrences independent when adding, reordering, saving and restoring a draft.

Player and compatibility work:

1. Render exactly `page_number` with PDF.js and fail visibly on an invalid explicit value rather than silently showing another page.
2. Include the page in the playlist fingerprint, resume/cache identity where applicable, diagnostics and proof-of-play idempotency.
3. Preserve legacy null -> page 1 and enforce the publish capability gate for page greater than 1.

Automated coverage:

- Boundary matrix: page 1, last page, zero, negative, fraction, above count, unknown count and non-document over-posting.
- Duplicate occurrence and reorder/save/restore matrix.
- Native, converted, malformed, encrypted and conversion-failure documents.
- Before page >1, verify every target has the updated player and has connected once to report capability; verify publish blocks while any report is missing.
- Offline cached playback and spooled/replayed page-aware proof-of-play.
- Resize, high-DPI and simultaneous multi-slot rendering within the canvas memory budget.

Exit condition:

- The page chosen in CMS is the page persisted, published, rendered and reported; invalid changes are atomic; and page >1 cannot publish until every updated target has reported capability.

## Phase 4 — Finish Video Looping

CMS and API work:

1. Keep `loop_enabled` on each video occurrence, including draft restore, reorder, review, request and snapshot paths.
2. Hide or normalize the flag to `false` for non-video media at both API and snapshot boundaries.
3. Ensure the option is readable and keyboard-operable and the review state clearly says Loop On or Loop Off.

Player work:

1. Keep one mounted video element and one occurrence/playback identity while native looping wraps.
2. Use decoded media duration for late-join modulo seek; handle unknown/zero/infinite duration safely.
3. Bound `play()` retries, readiness timeouts, stall watchdogs and recovery timers.
4. Treat an unexpected `ended` event on a native-loop video as a controlled runtime fault, not an unbounded manual replay loop.
5. Make disposal idempotent and cancel media listeners, timers, fade/audio state, progress reporting and pending asynchronous callbacks at every boundary/takeover.

Automated coverage:

- Loop on: at least three complete wraps on one stable element.
- Loop off: one play only.
- Duration shorter/equal/longer than the configured item interval.
- Same video in two occurrences with different loop flags.
- Multiple slots, mixed video/PDF/image content and independent mute/audio state.
- Late join, process restart and offline resume.
- Play rejection, corrupt media, decode error, pre-ready error, post-start error, 10-second stall and recovery.
- Schedule end during load/retry/seek/stall/fade and all emergency/default/secure-lock/shutdown takeovers.
- Verify proof-of-play is occurrence-based, not wrap-based, and verify no material DOM/handle/RAM/CPU growth during a soak.

Exit condition:

- A loop-enabled video completes repeated full cycles only for its active occurrence, advances/stops at every required boundary, and leaves no hidden media, duplicated audio, timers or retry storm.

## Phase 5 — Repository-Wide Developer Verification

Run in this order so cheap failures stop the process early:

1. Format/diff checks and feature lint.
2. Server, CMS and player production builds.
3. Pure unit suites.
4. Server DB-backed integration suite against a fresh isolated PostgreSQL database.
5. CMS browser automation for page selection, duplicate occurrences, preview, ownership labels and loop payload/state.
6. Player integration, performance and fault-injection suites.
7. Migration `0044` and `0045` rehearsal from a pre-migration synthetic data set.
8. Repository-wide lint, recording only the approved existing server exception and all warning counts.

Failure policy:

- A failed new or affected test blocks handoff.
- A flaky result is a failure until its source is understood and the case passes repeatedly.
- Do not change an expected result merely to match current behavior; resolve the defect or obtain a documented business decision.

## Phase 6 — Disposable Runtime Rehearsal

Environment:

- Use isolated PostgreSQL, Valkey and S3-compatible object storage with synthetic credentials and data only.
- Start separate API and worker roles with the actual runtime dependencies, then start the CMS and Linux Electron player against that stack.
- Do not use production databases, buckets, accounts, tokens or endpoints.
- If the pinned production dependency image cannot be obtained, record the substitute and keep exact-image validation open; a compatible substitute is not proof of the production image.

End-to-end journeys:

1. Create departments and users for admin, department lead, creator, peer, moved creator and other department.
2. Upload a short valid H.264 video, native multi-page PDF, Office document and deliberately corrupt files; wait for real worker outcomes.
3. Create resources in organization/department scopes, build a layout/presentation, select different pages for duplicate document occurrences and enable loop for one video occurrence.
4. Preview and publish, pair the Electron player, observe at least three loop wraps, exact selected pages, schedule boundary, takeover cleanup and proof-of-play.
5. Delete/transfer creators while sessions, sockets and upload/finalization activity exist; verify immediate access loss, stable ownership, tombstone UI/history, email reuse and cleanup convergence.
6. Restart API, worker, CMS and player; verify persisted state, cache/offline behavior and recovery.
7. Run a minimum 30-minute combined stability observation and capture health, worker heartbeat, logs, CPU/RAM/handles, DOM/video-node count and PoP uniqueness.

Required evidence:

- Exact commit/build/package hashes and environment topology.
- Sanitized commands/configuration, database queries, API responses and timestamps.
- Screenshots or recordings for CMS preview and Electron output.
- Logs for conversion, publish, playback, takeover, deletion, cleanup and restart.
- Clear distinction between observed results, source-predicted results and remaining untested platform cases.

Exit condition:

- All scripted journeys meet their expected outcomes without unexplained errors or resource growth. Any substitute dependency, unavailable platform or partial scenario remains an explicit release risk rather than being marked passed.

## Phase 7 — Documentation And QA Handoff

Development documentation:

1. Update API contracts for tombstone DELETE response, ownership/permission metadata, `page_number`, `loop_enabled` and related error codes.
2. Update onboarding/operator guidance so user deletion is described as account tombstoning, not physical deletion or asset transfer.
3. Add migration order, backup, forward-recovery and rollback guard instructions. An older server that physically deletes users must not be used after `0045` unless deletion is disabled.
4. Record supported extensions, conversion behavior, page default/range behavior, loop boundaries and all-target update/connect capability evidence.

QA package completion:

1. Ensure every row in `05_TEST_CASES.csv` has Test ID, objective, preconditions, test data, steps, expected result, priority, Risk Level and Evidence. Leave Actual Result, execution evidence and Defect ID for QA unless a row explicitly records dated developer evidence as `Partially Tested`.
2. Ensure every checklist item either states its expected outcome directly or references a test-case ID that contains it.
3. Synchronize business rules, risks, traceability, security, performance/reliability, environment, smoke/regression/UAT and release-readiness documents.
4. Add a dated developer-validation report. Never translate source review or developer automation into independent QA approval.
5. Hand QA a fixed commit/build, migration baseline, seeded-data recipe, credentials through the approved secret channel, supported platform matrix and list of known exceptions.

Exit condition:

- No required test field or expected result is blank; all cross-references resolve; evidence is reproducible; open risks/questions have named human owners; and the release candidate is immutable during QA except through a controlled new build.

## Final Pre-QA Go/No-Go Gate

Development may hand the build to QA only when all answers below are **Yes**:

- [ ] Are the three feature contracts above approved and unchanged?
- [ ] Are migrations `0044` and `0045` rehearsed from realistic pre-migration data with recovery evidence?
- [ ] Do server, CMS and player builds and affected automated suites pass on the final commit?
- [ ] Does the ownership matrix pass for all four resource types, scopes and actors?
- [ ] Does a selected document page survive CMS -> API -> DB -> snapshot -> player -> PoP?
- [ ] Does a loop-enabled video repeat full cycles and stop/advance at every boundary without leaked playback state?
- [ ] Do allowed HTTP/HTTPS pages load while login mechanisms and every unapproved redirect/navigation are blocked, with the latest successful preview retained through refresh failure?
- [ ] Does explicit group priority produce the deterministic winner and reject one of two same-revision saves without silent overwrite?
- [ ] Did the isolated browser/Electron runtime and 30-minute stability rehearsal complete without unexplained errors?
- [ ] Are exact production dependency images and supported OS/display targets either verified or explicitly open as release-blocking risks?
- [ ] Does every QA test have a usable expected result, data recipe and evidence requirement?
- [ ] Is the handoff tied to a fixed commit/build with no Critical/High defect lacking an approved disposition?

Until every required gate is satisfied, the correct state is **development validation in progress**, not QA-ready and not release-approved.

## Live broadcast implementation delta — 2026-11-03

This new delta uses [live implementation loops](../docs/plans/live-broadcast-implementation-loops.md) and
[accepted contract](../docs/contracts/live-broadcast.md). It does not reuse the older scope-limited
10–15 minute smoke exception as completion for the new feature.

| Loop | Current state | Closure gate |
| --- | --- | --- |
| 0 baseline | In progress | Current CMS/real-player ordinary playback/emergency/offline baseline and isolated inventory |
| 1 capture/enforcement | Prototype evidence recorded; gate open | Real capture/SFU/Electron evidence and tmpfs watchdog checks exist; native capture/audio matrix, current packaged receiver runtime and production host actuation still need closure |
| 2 reservations | API/database/fallback foundations in progress | Source authoring, frozen policy/capacity and immutable preparation have focused developer checks; full request/direct publication wiring and CMS journeys remain |
| 3 authority | Not executed | Idempotency/generations/current permissions/epoch/reconciliation with actual media faults |
| 4 player | Verified cache-pin primitive; integration not executed | Same ordinary installed DARSHAN player scheduled live source and normal pairing/cache/emergency integration; deadline/fallback/precedence/cleanup journeys |
| 5 CMS | Not executed | Every real visible control and denied/stale/multiple-session path |
| 6 deployment | Not executed | Offline sixth role, TLS/transports, disable/update/restore/rollback |
| 7 handoff | Not executed | Stable-packet regression, dated artifacts and concrete independent human checks |

Each loop is inspect→implement→focused checks→actual application→fault→fix→
repeat affected paths→evidence→commit. A failure blocks that loop. Resource-
bounded local verification is not 250-player/Windows/physical/network approval.
Developer ledger: [evidence/live-broadcast-developer-verification-2026-11-03.md](evidence/live-broadcast-developer-verification-2026-11-03.md); human cases remain Not Tested.
