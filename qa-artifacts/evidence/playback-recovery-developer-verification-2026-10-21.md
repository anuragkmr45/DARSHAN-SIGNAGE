# Playback And Secure-Recovery Developer Verification — 2026-10-21

## Status And Baseline

- Scope: requirements 19–24 (PDF capability/error behavior, corrupt-video handling, one-item retry, schedule hard stop and post-lock recovery).
- Branch/base: uncommitted `release-01` working tree based on `d8281db`.
- Product commits: `9bfb6b5` (`fix(player): make document and video playback failures deterministic`) and `91e3141` (`fix(player): enforce schedule boundaries and secure reconnect validation`). QA evidence is committed separately under `test(qa): add playback recovery regression coverage and evidence`.
- Result: implementation, affected automated regression, current CMS Playwright coverage, and two real Linux Electron runtime passes are complete.
- Runtime baseline: disposable loopback-only PostgreSQL, Valkey, RustFS S3-compatible storage, built API/worker, CMS, and a paired Electron player. The resource launch gate passed before application startup.
- Classification: developer evidence only. It is not an independent QA pass, release approval, physical-device result or soak result.

No customer data, production identity or production storage was used. Credentials, pairing code and certificate fingerprint from the disposable run are intentionally omitted.

## Implemented Contract

| Requirement | Current implementation contract | Primary source anchors | Developer state |
| --- | --- | --- | --- |
| 19 | Page >1 remains blocked until every concrete target reports `pdf_page_selection_v1`; page 1 remains compatible with missing capability information. All release players must be updated and connect once; mixed-version operation is not accepted. | server schedule publish helper/tests; player capability reporting/snapshot evaluation | Focused automated gate passed; fleet deployment proof pending |
| 20 | CMS preserves an invalid restored page after page-count refresh and blocks progression. Runtime mismatch produces `DOCUMENT_PAGE_OUT_OF_RANGE`, exact visible heading `Unavailable`, safe requested/actual context and no alternate-page render. | `scheduleCreatorState.ts`; `StepMediaAssign.tsx`; `pdf-playback.ts`; `player-layout-helpers.ts`; `player.ts` | Automated and repeated Electron visual proof passed |
| 21 | Failed corrupt video is disposed immediately and shows `Unavailable`. In a multi-item frame it remains failed only until the original absolute item boundary, then the current wall-clock item continues. | `scheduled-video-lifecycle.ts`; `player.ts`; `player-layout-helpers.ts` | Automated and repeated Electron corrupt-fixture timing passed |
| 22 | A failed only-item layout/fullscreen frame retries the same item at `clamp(item duration, 1–30 seconds)`, with one attempt/timer bound to the current playback generation and cancelled by authority/disposal/shutdown changes. | `scheduled-video-lifecycle.ts`; `player.ts`; layout tests | Fake-clock coverage and repeated Electron bounded-DOM/cancellation checks passed |
| 23 | Every occurrence is clipped to schedule end. Deadline completion reports `authorityEnded`, clears active media/timers/listeners and immediately re-evaluates the next authority without repeated expired-boundary loops. Runtime target is display/audio clear within 250 ms. | `timeline-scheduler.ts`; `playback-engine.ts`; `snapshot-manager.ts`; renderer | Electron measurements passed at 41 ms and 18 ms |
| 24 | Secure deadline is exactly last authenticated backend success + 120 seconds. Lock stops schedule/default/emergency and purges only media cache. Locked heartbeat marks reachability and starts one recovery; it cannot unlock directly. Normal snapshot refresh/cache writes are suppressed while locked; only the ordered recovery refresh may synchronize current content. Recovery orders identity validation, forced fresh snapshot, current-content sync/check, authority apply, then READY. | offline security policy; secure guard; heartbeat; PlayerFlow; snapshot/cache managers; generated production bundle and examples | Repeated real 119/120-second lock and fresh-authority recovery passed |

## Automated Developer Verification

Commands were executed sequentially with the repository's package scripts and targeted Vitest files. Environment-specific database URLs and credentials are redacted.

| Component/gate | Result |
| --- | --- |
| Player focused affected suites | 104 tests passed before the final cache-lock adversarial pass; the final cache/default-media/snapshot/PlayerFlow/guard gate then passed 65 tests |
| Player complete unit suite | 373 tests passed after the final locked-default-media repair |
| Player integration suite | 5 tests passed |
| Player fault-injection suite | 14 tests passed |
| Player performance/timing suite | 8 tests passed |
| Player build | Passed three times, including after the final locked-default-media repair |
| Production bundle configuration contract | 13 tests passed; bundle assembler shell syntax passed |
| Player lint | Complete repository lint previously had 0 errors and 285 pre-existing warnings; the final changed-source lint had 0 errors and 25 warning-class findings |
| Player format check | Repository-wide check remains red because 34 pre-existing source files are unformatted; no unrelated bulk formatting was performed |
| CMS focused schedule-state tests | 10 tests passed |
| CMS complete unit suite, serialized | 23 files / 115 tests passed |
| CMS scheduling Playwright flow | 2 tests passed with one Chromium worker; invalid restored page stayed visible, `aria-invalid` was set, Next remained blocked and correction to page 2 succeeded |
| CMS build and bundle-budget check | Passed |
| CMS lint | Passed with 0 errors and 4 existing Fast Refresh warnings |
| Server focused document publish/page tests | 9 tests passed |
| Server unit suite | 70 tests passed |
| Server build | Passed again after the final isolated-fixture corrections |
| Server lint | Existing 4 errors remain in untouched `jobs/index.ts`, `routes/chat.ts` and `routes/schedule-requests.ts`; no new affected-file lint error was observed |
| Server full integration first attempt | 115 files / 605 tests passed; four stale fixture/expectation failures were found and corrected, then the parallel worker exhausted memory |
| Server full integration serialized attempt | 33 files / 344 tests passed before the 1 GiB Vitest worker exhausted its heap; one portable timestamp assertion was then corrected. This attempt was not recorded as a suite pass. |
| Server bounded clean-database regression | All 121 discovered test files passed using capped workers and repeated resets of only `darshan_playback_test`; no production or developer database was used |
| Corrected server regression files | Migration-ledger, Screen priority, Chat, Conversation, deleted-user migration, notification-race role seeding, media-ready mock expectation and Media ADMIN-role fixture files all passed after correction |

The two monolithic server attempts are not recorded as suite passes because their long-lived workers ended with memory failures. Complete file coverage was subsequently obtained by resetting the dedicated test database between bounded batches and isolated route files; all 121 discovered files passed.

## Actual Disposable-Stack Verification

The completed run used uniquely named, loopback-only PostgreSQL, Valkey and RustFS S3-compatible storage, the built API/worker, CMS on `127.0.0.1:55173`, and the current Electron package with a disposable identity. The database name ended in `_test`; all identities and media were synthetic. Credentials, pairing material and raw logs were excluded from evidence.

- All 49 migrations applied. Real PDF and H.264 fixtures passed API/presigned-storage/worker ingestion and reached `READY`; the labeled PDF reported five pages.
- The real player paired and registered `pdf_page_selection_v1` in screen capability state before page >1 publication.
- Duplicate document occurrences visibly rendered `DOCUMENT PAGE 2` and then `DOCUMENT PAGE 5`. A post-publish isolated page-6 mutation displayed exact `Unavailable` context and did not substitute another page. The focused visible journey passed twice.
- A checksum-valid but decode-corrupt video displayed `Unavailable`; the following PDF began at the original wall-clock item boundary. Measured scenario completion was 6,461 ms and 6,495 ms including publish/fetch latency.
- A one-item corrupt frame retained one unavailable surface with no concurrent video-node growth. Snapshot replacement and emergency takeover prevented stale retry content from reappearing.
- A 20-second looping video scheduled for an 8-second authority window was disposed 41 ms and 18 ms after the server schedule boundary, both within the 250 ms target.
- With the API process suspended immediately after a fresh authenticated heartbeat, content remained visible at 119 seconds. The lock appeared at 120,144 ms and 120,146 ms from that heartbeat. At lock, media payload files were absent while five certificate/identity files and the snapshot/progress/proof/request metadata remained.
- While locked, the isolated snapshot was changed from document page 2 to page 5. Restoring the API kept playback locked until identity validation, forced snapshot fetch, content synchronization and authority application completed; the current authority then resumed. This passed twice.

Machine-readable results and selected visual evidence are under `qa-artifacts/evidence/runtime-2026-10-21/`.

## Repair Loops Completed

1. PDF loop: retained invalid CMS state instead of clamping; added structured player error and a shared unavailable surface; focused tests passed.
2. Video loop: unified failure classification for load/play/decode/stall/unexpected end; preserved multi-item wall-clock boundary; added bounded one-item retry and generation cancellation; focused tests passed.
3. Schedule loop: clipped every occurrence to schedule end, propagated `authorityEnded`, removed the 250 ms reevaluation delay for already-due boundaries and guarded repeated expired-boundary evaluation; fake-clock tests passed.
4. Security loop: removed additive secure grace, separated locked reachability from authenticated success/unlock, implemented ordered single-flight recovery phases and updated production examples/documentation; focused tests passed.
5. Regression loop: corrected four stale server test fixtures/expectations discovered by the broad integration attempt; corrected files passed individually.
6. Final adversarial loop: repaired non-loop one-item retry so it makes a real zero-second playback attempt after the original duration, preserved one-item retry metadata when the renderer is restored, made recovery phases follow fetch then content synchronization, emitted the secure policy from generated production player bundles, and preserved the PDF error line break. The affected 104-test gate, then-current full 370-test player unit suite, player build and bundle contract passed.
7. Server-harness loop: a serialized whole-suite attempt showed that one long-lived Vitest worker still exceeds a 1 GiB heap on this workstation. It also exposed a migration rehearsal assertion that assumed a driver-specific `Date` result; the assertion now accepts either supported timestamp representation while still proving a valid non-null deletion time. That isolated rehearsal passes 1 file / 2 tests after correction; the later bounded clean-database sweep completed the remaining server coverage.
8. Cache-lock adversarial loop: normal polling/realtime snapshot and default-media refreshes are now refused while security-locked, the explicit recovery refresh is the only allowed content-sync path, and a write generation prevents a pre-lock in-flight download from repopulating purged media. The recovery can retry the same cache key with fresh authority. The final focused 65-test gate, complete 373-test player unit suite and player build passed after this repair.
9. Server isolation loop: the complete 121-file server surface was rerun with a capped worker and clean `darshan_playback_test` reset between bounded batches/files. This exposed three order-dependent harness defects: a notification-race test assumed roles seeded by another file, a webpage-preview mock assertion tried to diff a transactional executor until Vitest exhausted its heap, and a Media ADMIN fixture omitted the system role's `manage Media` grant. Their full affected files passed after correction, followed by the remaining clean-database file sweep and server build.

## Remaining Independent-QA Gates

Developer verification is complete for the Linux disposable environment. This is still not an independent QA approval. QA must execute the detailed `API-06`, `UI-05`, `PLAYER-03..04`, `PLAYER-10..16`, `COMP-04` and `OBS-04` cases on the approved target matrix. Windows, physical displays/audio, accessibility, capacity, long soak, production deployment, and proof that every fleet player was upgraded and connected once remain QA/release responsibilities.
