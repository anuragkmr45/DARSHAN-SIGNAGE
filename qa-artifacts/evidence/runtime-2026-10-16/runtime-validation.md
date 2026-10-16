# Developer Runtime Validation — 2026-10-16

This is developer evidence from an isolated local environment. It is not an independent QA result, does not mark any test case `Pass`, and is not the final release-candidate run. Source changes were made after parts of this run, so every affected runtime check must be repeated against the frozen QA build.

## Environment and safety

- Manifest: `environment-manifest.md` records current baseline/lock/migration hashes, host tooling, known topology and explicit version gaps. It is partial and must be regenerated for the frozen release candidate.
- Branch: `release-01`; baseline commit before the remaining working-tree changes: `e721c2ab0c8b94af95b6914810a0c6788899e318`.
- Disposable services: API, worker, PostgreSQL, Valkey and S3-compatible object storage, plus a local CMS browser session.
- The object-store substitute was RustFS rather than the exact approved/pinned production MinIO image. Exact-image compatibility remains open.
- Synthetic users, credentials, media and identifiers were used. No production service or data was touched.
- The disposable services and Docker Desktop were stopped after the host approached its memory limit. No runtime process remains active.

### Resource incident

The Linux kernel log records three global OOM events during browser attempts. It killed `chrome-headless` processes in the VS Code user scope at approximately 2.4 GiB, 2.84 GiB and 2.91 GiB resident memory; systemd then reported the corresponding VS Code scope as `oom-kill`. This explains the editor shutdown and invalidates the interrupted browser attempt. It does not establish a product/browser pass or fail.

After cleanup, no DARSHAN API, worker, CMS/Vite, Playwright/Chromium or Electron process remained and Docker Desktop was inactive. An unrelated pre-existing RustFS process/container was intentionally not terminated. Future workstation execution must be sequential and follow the memory guardrails in `09_TEST_DATA_AND_ENVIRONMENT.md` and `13_PRE_QA_DEVELOPMENT_PLAN.md`.

A later process/container audit again found no DARSHAN, Vite, Vitest, Playwright, Chromium or Electron process and no running Docker container. The remaining largest processes belonged to the user's existing Firefox and VS Code sessions and were not terminated. At that checkpoint the 6.2 GiB host had approximately 2.6 GiB available memory and 1.9 GiB free swap, so no browser, Electron, Docker or application runtime was restarted.

At the final low-memory continuation checkpoint there were still no project application/test/browser/Electron processes and no live sub-agents. The 6.2 GiB host had about 2.8 GiB available RAM and 1.6 GiB free swap. The largest processes were user Firefox content processes (about 569 MiB and 517 MiB) and a VS Code renderer (about 500 MiB); they were not terminated. Work therefore remained source-only, with capped TypeScript/lint commands and no application launch.

## Observed developer results

### Ownership and user tombstones

`ownership-runtime-check.mjs` completed and wrote `ownership-runtime-result.json`. Its assertions passed for:

- Media, Layout, Presentation and Schedule role/scope access;
- nested ownership closure;
- creator transfer with stable stored ownership and revoked old authority;
- account tombstoning and repeated-delete idempotency;
- reuse of the scrubbed email and history without old-email disclosure; and
- owning-department delete conflicts with per-resource counts.

The CMS was also opened against the live API. `cms-live-dashboard.png` and `cms-deleted-creator-ownership.png` show the authenticated dashboard and deleted-creator ownership display. These screenshots cover only the pictured paths; they are not proof of the complete browser matrix.

### Document ingestion and page selection

`media-ingestion-runtime-check.mjs` completed and wrote `media-ingestion-runtime-result.json`:

- `.pdf`: READY, 5 pages;
- `.ppt` and `.pptx`: READY, 5 pages each;
- `.doc` and `.docx`: READY, 2 pages each;
- `.xls`, `.xlsx` and `.csv`: READY, 1 page each;
- malformed PDF: FAILED with `DOCUMENT_PDF_INVALID`;
- encrypted PDF: FAILED with `DOCUMENT_PDF_ENCRYPTED`; and
- the short `.mp4` fixture: READY with a decoded duration of 2 seconds.

`presentation-schedule-runtime-check.mjs` completed its prepare and publish phases. The result files record:

- the same PDF saved in two occurrences with pages 2 and 5;
- non-video loop over-posting normalized to false;
- video occurrence loop persisted as true;
- page 6 rejected without replacing the valid assignment;
- a page value on video rejected;
- publication to an incapable player blocked; and
- publication to a capable player preserving pages 2 and 5 and the video loop flag in the immutable snapshot.

### CMS page/loop browser attempt

The current-build CMS page/loop browser script did not complete because the disposable Docker stack stopped during the run. It produced no valid result. The empty generated result file was removed to prevent it from being mistaken for evidence. Selected-page author/review preview and loop-state browser behavior remain open for the frozen build.

## Later low-memory source gates

After the runtime services were stopped, the following checks ran with constrained Node memory and without launching the application:

- server TypeScript production build: passed;
- CMS production build and bundle-budget validation: passed;
- player production build: passed;
- server pure-unit configuration: 50 tests passed across 15 files after adding the mocked login-throttle and webpage-processing suites, media-processing compare-and-set regressions and transitive role-impact coverage to the bounded configuration;
- CMS unit suite: 113 tests passed across 23 files;
- player unit suite: 357 tests passed after adding direct-timeline single-loop retention, authoritative-end cleanup, pause/resume boundary and timer-cancellation regressions;
- player integration suite: 5 tests passed;
- player fault-injection suite: 14 tests passed;
- server, CMS and player blocking-error lint: passed after correcting two no-behavior lint errors;
- `git diff --check`: passed.
- deterministic upload/deletion route races for `INITIALIZING`, delete-first finalization, and finalize-first completion were authored after the runtime shutdown; focused lint and TypeScript compilation passed, but these DB-backed tests were not executed.
- a subsequent authorization pass found and closed a moved-uploader bypass: matching `created_by` alone previously let a newly authenticated department-B identity resume or finalize its old department-A upload. Every upload-session operation now also checks current authority over the Media's stable owner, and the finalization transaction re-reads and locks the current user, role, session and Media before committing. Direct-transfer and transfer-during-finalization DB tests were authored; server TypeScript and focused zero-error lint pass, but PostgreSQL execution remains pending.
- deterministic notification/deletion ordering was authored with PostgreSQL lock barriers and passed focused lint/TypeScript compilation; it was not executed. A focused socket-server suite passed 9/9, including user-room disconnect dispatch to chat, notifications and screens, without launching the application.
- transitive Schedule -> Presentation -> Layout/Media ownership closure was added to assignment and publication; its three cases are included in the current complete 50/50 pure-unit result and its DB route rejection assertion compiles but remains unexecuted.
- custom-role/no-department/pagination and transferred/deleted-requester Schedule Request DB route cases were authored after shutdown; the hourly deleted-upload cleanup path was factored into one production function with a DB-backed object-store failure/recovery/terminal/idempotency test. TypeScript and focused lint pass; none of these database cases has been executed.
- the source audit then closed missing explicit ability checks on Schedule publish-history/status reads and Schedule Request cancellation/administrator transitions. The API catalogue now records those requirements and the previously omitted publish/request take-down and cancel endpoints. Compilation and JSON parsing pass; runtime remains pending.
- the CMS Playwright configuration was corrected to use exactly one worker locally as well as in CI. The PDF canvas preview was hardened so resize notifications cannot overlap PDF.js render work, repeated identical dimensions do not repaint the canvas, and page cleanup also runs on cancelled/error paths. Focused CMS preview/schedule-state units passed 11/11 and focused lint reported no errors (two pre-existing Fast Refresh warnings remain). No browser was launched, so browser memory stability and selected-page canvas output remain pending.
- a player audit found that the direct/legacy timeline could still complete and remount one loop-enabled video at `displayMs`, despite the renderer using native looping. The scheduler now holds that occurrence on one mount until `scheduleWindowEndsAt` or an external authority stops/replaces it, and emits a hard renderer clear when the authoritative end is reached. A later lifecycle pass also found untracked transition timers and pause/resume rebuilding the wrong duration; the scheduler now clears both timer classes and resumes against the original wall-clock boundary. Focused scheduler checks passed 6/6 and the full capped player unit suite passed 357/357. Electron observation remains pending.
- the account-change write audit was completed across all owned-resource mutations. One transaction-scoped guard now covers Layout, Presentation, Schedule, Schedule Request and Media writes, including upload-session state transitions and both finalization paths. Media deletion commits authorization/database state before object-store cleanup and preserves failed cleanup as an orphan-worker retry record. Two real-PostgreSQL row-lock tests were authored for transfer-first and write-first ordering using `pg_blocking_pids`, without timing sleeps. Server TypeScript and focused lint pass with zero errors, and the capped pure-unit suite passes 50/50; the new DB tests remain unexecuted.
- a final privacy/race source pass masked deleted-user email in legacy Request message history and added a DB assertion for retained name plus `status: DELETED` and `email: null`. Upload validation failure now rechecks live session/current authority and conditionally changes only the expected session state in that transaction, so a late size/checksum/promotion error cannot write after transfer or overwrite deletion's `ABORTED` cleanup state. Resumable and legacy finalization now compensate promoted/source objects and provisional storage rows when their guard throws, not only when it returns a conditional conflict; delete-first tests require the post-operation cleanup call. Failed compensation retains its orphan row, and the existing hourly cleanup now retries orphan rows after a two-hour in-flight safety grace period. Delayed-validation regressions were authored for both deletion-first and transfer-first orders, plus cleanup failure/retry/idempotency/fresh-row coverage. Server TypeScript, focused zero-error lint and the bounded 50/50 pure-unit suite pass; the new DB-backed assertions remain unexecuted.
- a final authentication race pass serialized login session issuance with user and role changes: login locks and rechecks the current password/account row before inserting a session. The follow-up inheritance audit found that role edits revoked only directly assigned users even though effective grants may be inherited. Guarded owned-resource writes now share-lock the complete role graph before user/session state; role update takes the complementary graph update lock, rechecks its actor/session, and revokes direct plus transitive inheritor sessions in the same transaction before local socket-room disconnection. Pure graph coverage passes for direct/transitive/cyclic inputs, and DB route coverage now includes a grandchild-role session; the latter remains unexecuted. Capped production build, TypeScript, full/focused zero-error lint and the 50/50 bounded unit suite pass. The earlier DB-configured Vitest attempt did not execute because the safety guard rejected the configured non-test database name `darshan`; this remains an environment refusal, not a product pass or failure.
- the final Schedule Request privacy/closure pass prevents search from matching the synthetic tombstone email while retaining name-based historical discovery. Fully expanded requests now reject an unreadable nested Presentation, Layout or Media instead of silently returning a partial content tree. DB-backed regressions were authored for both behaviors. Capped server TypeScript and focused lint pass with zero errors (existing warnings only); the database cases remain unexecuted.
- a subsequent worker-race audit found that user deletion stopped only `PENDING` Media, while an already-running document conversion, video transcode or webpage capture could later overwrite the row as `READY`. Tombstoning now moves both `PENDING` and `PROCESSING` Media to the deletion cleanup state. Worker success uses a `PROCESSING` compare-and-set, compensates stale produced objects, preserves an idempotent duplicate winner, and failure uses the same conditional state rule. Thumbnail attachment is also conditional. Deleted-media cleanup now includes tracked source, ready and thumbnail objects and clears their references after object cleanup succeeds. Three pure state regressions and four mocked webpage-processing tests pass as part of the 50/50 bounded suite; processing/deletion PostgreSQL and disposable-object-store execution remains pending.
- after the worker and role-graph race changes, the capped production server/CLI build, complete server lint (0 errors; 902 warnings), TypeScript no-emit check, `git diff --check`, JSON parse and the 50/50 bounded pure-unit suite all completed successfully without starting an application service.
- the current player production build (main plus renderer bundle/assets) and CMS production build/bundle budget also passed sequentially under the memory cap. The CMS entry remained 216.8 KiB / 68.6 KiB gzip. No browser or Electron process was launched.
- after the timeline-scheduler changes, the capped player integration suite was repeated at 5/5 and the fault-injection suite at 14/14. These are process-level automated tests, not Electron visual/runtime acceptance.
- the complete player lint was repeated after the scheduler changes and exited with 0 errors and 281 warnings; the warning backlog is not presented as remediated.
- the complete CMS unit suite and lint were repeated after the preview/ownership changes: 113/113 tests passed across 23 files, and lint exited with 0 errors and four Fast Refresh warnings.
- a final documentation/source-contract audit found that the dedicated ownership guide and API catalogue were updated, but the production database lifecycle runbook did not yet contain migration `0045` apply/verification, failure-recovery and old-server rollback instructions, and developer onboarding did not summarize the three feature contracts. Those required documents now cover `0044` before `0045`, legacy ownership limitations, transactional retry rules, the hard-delete endpoint block, stable ownership/permission metadata, all eight supported document extensions, per-occurrence page selection and video-loop authority boundaries. JSON parsing and `git diff --check` pass; this is documentation evidence, not runtime acceptance.

The repository-wide CMS TypeScript project currently has a pre-existing `ignoreDeprecations`/installed-TypeScript mismatch and a broader baseline error list. A bounded diagnostic override reproduced that baseline and did not identify an error in the two changed files; it is not recorded as a passing build gate.

The server still has a large warning backlog. A zero-error lint exit does not mean the warnings were remediated.

## Assigned to QA/deep validation after the fast developer handoff

- Freeze one commit/build and repeat affected automated checks on that immutable revision.
- Rehearse migration `0045` from a pre-migration database, including all backfill classes, interruption/forward recovery, repeat invocation, constraints and unsafe-old-server rollback protection.
- Run deterministic deletion races for REST/session/socket reconnect, notifications, upload initialize/activate/finalize, late validation failure, and object-cleanup failure/retry. Confirm Request message history also masks tombstone email.
- Re-run deterministic two-connection transfer/deactivation races for the shared transaction guard. Layout, Presentation, Schedule, Schedule Request and Media mutations now lock and recheck the live user/session/current actor in their write transaction, including upload-session transitions and finalization. Transfer-first/write-first behavior still requires database evidence before acceptance.
- Complete the CMS browser matrix for ownership labels/actions, duplicate document occurrences, selected-page preview and video Loop On/Off payload/review state.
- Run the current Linux Electron player against the final build: at least three complete video wraps, Loop Off, multi-item advance, every takeover/end boundary, selected-page output, offline/restart behavior and page-aware proof-of-play.
- Run the 30-minute combined stability observation and record CPU/RAM/handles, media/DOM nodes, timers, logs, worker health and proof-of-play uniqueness.
- Validate the approved exact object-store/dependency image or accept the substitute as an explicit release risk.

The user-approved bounded developer smoke is recorded in
`fast-developer-smoke.md`, so independent QA execution may begin. These open
items still block release approval; existing developer evidence remains only
`Partially Tested`, and no QA case is marked `Pass`.
