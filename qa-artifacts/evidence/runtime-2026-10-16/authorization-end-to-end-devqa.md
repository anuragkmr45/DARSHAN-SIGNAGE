# Authorization And Playback Developer-QA Closure — 2026-10-16/17

This report records the developer verification started on 2026-10-16 and
reconciled on 2026-10-17 for `release-01` through source/test commit `a01804c`.
It is evidence for QA planning and defect prevention; it is not an independent
QA pass or a release approval.

## Scope

The repeated developer loops covered the affected contracts for:

- last-active `SUPER_ADMIN` protection and immediate session withdrawal;
- same-department directory and Media/Layout/Presentation/Schedule ownership;
- ADMIN organization content versus SUPER_ADMIN restricted content;
- permission-driven custom roles and delegated emergency control;
- disabled general Requests with retained Schedule Requests;
- deleted-user ownership migration, upload cleanup and authorization races;
- per-occurrence document page selection and native video looping;
- the CMS surfaces and player lifecycle that expose those values.

The code was treated as the implementation source of truth. Business acceptance
still comes from the approved rules and the expected results in
`05_TEST_CASES.csv`.

## Isolated Environment And Safety

- A disposable PostgreSQL 15 database named `darshan_test` and disposable
  Valkey 8 instance were used on non-default local ports.
- The migration runner reset only the dedicated `_test` database and applied
  all 48 migrations.
- A disposable MinIO process was used while starting the built API for the HTTP
  smoke. No credentials from this run are retained in the repository.
- Unrelated HRMS PostgreSQL/Valkey and RustFS containers were identified first
  and were not stopped, reset or modified.
- Browser automation used one Playwright worker inside a 1.4 GiB user memory
  scope. Browser and Electron work were not run concurrently.
- All DARSHAN developer-QA containers and application processes were stopped
  after the run.

## Execution Results

| Layer | Developer result | What it established |
| --- | --- | --- |
| Server production compile | Passed | The final server source compiles after the multipart compensation fix. |
| Server focused unit contracts | 19 files, 67 tests passed in the broad affected run; final post-fix selection 11 files, 37 tests passed | Ownership, role gates, emergency authorization, Requests absence, document-page validation/migration helpers, Schedule closure and video-loop normalization. |
| Server DB-backed affected routes | Expanded affected run reached 92 passing tests; final post-fix convergence run passed 7 files, 65 tests | Real PostgreSQL route behavior for ownership, users, roles, emergency, upload sessions, migration `0045`, cleanup retry/terminal behavior and session-related mutations. |
| Migration rehearsal | 2 tests passed | Upgrade through `0045`, mapping/constraints/references, repeat invocation, forced transactional failure and forward recovery. The test now stops at the intended migration boundary rather than accidentally applying `0046`. |
| CMS unit/build | 23 files, 113 tests passed; production build passed | Authoring state, permission helpers and selected-page/loop payload behavior compile and remain green. |
| CMS Playwright | 6 tests passed with one worker | Ownership labels/actions and scheduling/emergency author-review flow, including page 2/page 5 and Loop On. Two ambiguous test locators were corrected; these were test defects, not product failures. |
| Player production build | Passed | Current player compiles with the selected-page and native-loop paths. |
| Player complete automated set | 357 unit, 5 integration, 8 performance and 14 fault tests passed (384 total) | Selected PDF page rendering, occurrence lifecycle, native loop completion/restart, pause/resume, stalls, concurrent slots, stale callback cleanup, schedule/takeover boundaries and PoP behavior. |
| Changed-file lint | Server and CMS: zero errors | Server reported only existing `no-explicit-any` warnings outside the changed logic; CMS changed tests were warning-free. |
| Built API process smoke | Passed | Live health and login; `/api/v1/users` `200`; `/api/v1/requests` `404`; `/api/v1/schedule-requests` `200`; last active SUPER_ADMIN disable `409 LAST_ACTIVE_SUPER_ADMIN`; blocked actor session remained valid; disabling an operator invalidated that old token immediately (`/auth/me` changed from `200` to `401`). |

## Multi-Loop Findings And Corrections

### Loop 1 — Contract alignment

The first database run exposed stale tests rather than product defects:

- Media/Layout/Presentation tests still expected department leads to mutate
  peer-owned content. They now assert creator/global-manager mutation while
  retaining same-department permitted reads. Schedule tests retain
  action-specific same-department management.
- SUPER_ADMIN-created Media tests expected organization scope. They now assert
  the approved restricted/private classification.
- The two-SUPER_ADMIN test issued an elevated token without creating the second
  database account. It now creates a real surviving active SUPER_ADMIN and
  session.
- Role tests now assert the actual normalized response name and standard error
  envelope.

### Loop 2 — Real implementation defect

Deletion/session revocation could win after multipart object-store creation but
before upload-session activation. The authorization guard then threw, bypassing
the existing `activated === false` compensation path and leaving the newly
created multipart upload open.

`darshan-server/src/routes/media.ts` now aborts that multipart upload for both
authorization exceptions and conditional activation failures. The original
error is rethrown after best-effort compensation, so authorization behavior and
the HTTP response remain authoritative.

### Loop 3 — Shared-database and bounded-batch behavior

The cleanup regression initially assumed it owned every eligible row in the
shared integration database. Other upload cases legitimately contributed rows,
and the production job intentionally handles a bounded batch. The test now:

- uses relative times rather than a date that can become stale;
- asserts its own rows and the required lower bounds during failure/recovery;
- explicitly drains a large test-only batch across the two-hour terminal
  window before checking a no-op rerun;
- fixes the fresh-orphan clock so the age assertion is deterministic.

Production cleanup limits and behavior were not weakened to satisfy the test.
The final combined rerun passed.

### Loop 4 — UI and full-player regression

The first Playwright attempt found duplicated accessible text in the application
shell and two legitimate `Loop On` labels. The checks were scoped to the main
page heading and intended first label, then passed 6/6. The full player suite
also passed, including repeated native video cycles and stop/cleanup boundaries.

## Catalogue Integrity

`05_TEST_CASES.csv` was parsed after the run:

- 102 data rows and 23 columns;
- no blank Test ID, objective, preconditions, test data, steps, Expected Result,
  priority, risk, design evidence, dependency or status field;
- 22 rows remain `Partially Tested` and 80 remain `Not Tested`;
- blank Actual Result, Execution Evidence and Defect ID cells on unexecuted
  cases are intentional QA-owned fields, not missing expected behavior.

The risk register contains 34 data rows and the traceability matrix contains 131
data rows. Both parsed successfully with their declared headers.

## Remaining Independent QA And Release Work

The implementation is ready to hand to QA, but release approval still requires
the following evidence on the frozen candidate:

1. Two real API processes with live Socket.IO clients must prove cross-node
   disconnect and protected-action rejection after user/password/role/
   department/permission changes, including a controlled Valkey failure.
2. Concurrent last-SUPER_ADMIN removal and the stopped-backend recovery CLI path
   need deterministic runtime evidence.
3. The full people-directory matrix still needs browser/API checks for invite
   and chat pickers, guessed IDs, pagination totals, inactive/deleted people and
   global `manage User` exception behavior.
4. Real object-store outage/retry and multipart residue inspection remain
   required. The developer regressions use controlled storage mocks, while the
   HTTP smoke only proved the built API could start against MinIO.
5. Current Linux Electron visual playback, Windows packaging/hardware coverage,
   fresh install/reboot, accessibility, long soak, security assessment,
   backup/restore and production deployment remain release gates.
6. Site-owned SLO/capacity, RPO/RTO, retention, platform and network decisions
   listed in the business questions still require human approval.

QA should execute the exact steps and Expected Result in `05_TEST_CASES.csv`,
write observations only in `Actual Result`, attach sanitized evidence, and file
a Defect ID whenever actual behavior differs. Developer automation must not be
copied into those fields as an independent QA result.
