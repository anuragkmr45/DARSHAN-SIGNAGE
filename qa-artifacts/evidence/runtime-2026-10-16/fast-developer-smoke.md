# Fast Developer Smoke Handoff — 2026-10-16

This is bounded developer evidence, not an independent QA result or release
approval. The user shortened the developer gate to a 10–15 minute, low-resource
smoke check and assigned deep runtime validation to QA.

## Safety and scope

- Branch/worktree: `release-01` with uncommitted feature and QA-artifact changes.
- No application service, Docker container, PostgreSQL, object store, browser,
  Playwright, or Electron process was started.
- Every Node command was sequential, capped with
  `NODE_OPTIONS=--max-old-space-size=768`, and protected by a timeout.
- A pre-check found no earlier project test/runtime process.

## Results executed in this smoke

| Area | Command scope | Result |
| --- | --- | --- |
| Repository and QA integrity | `git diff --check`; parse QA/API JSON; parse the three QA CSV files | Passed. Six JSON files parsed. Risk register: 29 rows/11 columns. Test catalogue: 96 rows/23 columns. Traceability: 120 rows/9 columns. No blank Expected Result. Statuses remain 22 `Partially Tested`, 74 `Not Tested`, 0 `Pass`. |
| Server compile | `npx tsc --noEmit` | Passed under the memory cap. |
| Server bounded logic | `vitest` with `vitest.unit.config.ts`, one fork | 15 files passed; 50/50 tests passed. Includes ownership, tombstone migration text/contract, document-page validation/counting, video-loop normalization, worker compare-and-set, schedule ownership closure and role inheritance impact. |
| CMS focused logic | `MediaPreview.test.ts`, `scheduleCreatorState.test.ts`, `access.test.ts`, one fork | 3 files passed; 18/18 tests passed. Covers selected-page preview helpers/state, occurrence page/loop state and fail-closed ownership/action helpers. |
| Player focused logic | PDF playback, scheduled-video lifecycle, playback engine and timeline scheduler unit files | 33/33 tests passed. Covers physical-page validation, page-aware playlist/PoP behavior, native loop configuration, one mounted loop occurrence, bounded play/stall recovery, cleanup and authoritative schedule-end behavior. |

The CMS run emitted only the package's stale `baseline-browser-mapping` data
notice. It did not affect the test exit status and is not treated as product
runtime evidence.

## Intended feature behavior handed to QA

- Ownership remains attached to organization/department/restricted custody;
  deleting or moving a creator does not reassign the asset. A tombstone retains
  safe attribution while credentials and the old email are unavailable.
- Page selection belongs to each document occurrence. Supported inputs are
  `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, and `.csv`;
  Office/CSV inputs are converted to PDF. Valid pages are integers from 1
  through final `page_count`; a legacy/null value means page 1.
- Video looping belongs to each video occurrence. Loop On repeats complete
  native video cycles on one mounted occurrence until schedule or higher
  authority ends it; Loop Off plays once. Internal wraps do not create duplicate
  occurrence starts.

## Explicitly not executed

Database-backed routes and migrations, migration `0045` rehearsal, real upload
and notification races, object-store cleanup, live sockets, CMS browser output,
Linux Electron rendering, installation/platform coverage, security/load work,
and soak/stability testing were not executed in this smoke. Their expected
results remain in the master catalogue and must be checked by QA. No case was
marked `Pass`.

## Recommended QA smoke order

1. `AUTHZ-07`
2. `DATA-06`
3. `CONC-07`
4. `UI-07`
5. `UI-05`, `API-06`, `PLAYER-08`, `PLAYER-10`, `OBS-03`, `COMP-04`
6. `API-07`, `PLAYER-11`, `PLAYER-12`, `OBS-04`

