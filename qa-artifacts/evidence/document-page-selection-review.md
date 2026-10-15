# Document Page Selection — Architecture And Simulation Review

Review date: 2026-10-15  
Baseline: `release-01` at `8e0bb6f5b93b230c2f08fe377cb52f8eccf729e2`, plus the uncommitted document-page and video-loop reliability implementation in this workspace.
Method: repeated static data-flow review and deterministic checks, followed by a disposable local CMS/API/database/object-store/browser/Linux Electron run. Detailed execution results and screenshots are in `runtime-2026-10-15/runtime-validation.md`. No Windows or representative physical-display test was run.

## Intended behavior

Each presentation occurrence of a document selects one static physical PDF page. The same media may appear more than once and select a different page each time. A missing legacy selection is page 1. There is no automatic page progression.

Accepted document extensions are `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, and `.csv`. PDF uploads are inspected directly. Other accepted document types are converted with LibreOffice and inspected after conversion, so `page_count` describes the final playable PDF rather than source concepts such as worksheets or slides.

## End-to-end flow traced in source

1. Upload completion records the source and leaves every document `PROCESSING`.
2. The `document:convert` worker either keeps a native PDF or converts Office/CSV input, asks PDF.js for the physical `numPages`, and only then writes `READY` plus `media.page_count`. Malformed and encrypted PDFs fail with stable reasons.
3. Schedule Creator creates a client occurrence ID, defaults each document occurrence to page 1, presents a bounded whole-number field, and renders that page in its PDF.js canvas preview and review step.
4. `PUT /api/v1/presentations/:id/slots` validates the layout slot, media readiness, occurrence order, page applicability and page range before replacing all slot rows in one transaction. This prevents a partially updated presentation when an item is invalid.
5. Publish revalidates every stored selection, writes `page_number` into the immutable snapshot, and rejects page >1 for a target player that has not advertised `pdf_page_selection_v1`.
6. Snapshot parsing carries the occurrence page into `TimelineItem`. Missing values normalize to 1; malformed explicit values normalize to an invalid sentinel so rendering fails visibly instead of silently choosing another page.
7. PDF playback checks the requested page against PDF.js `numPages`, renders exactly that page, includes the page in the playlist fingerprint, and emits/logs a render failure if it cannot do so.
8. Proof-of-play carries `page_number` through the player spool, telemetry API/job, database, CMS list and CSV export. The page also participates in server idempotency.

## Compatibility and persistence

Migration `0044_document_page_selection.sql` adds nullable positive integers to media, legacy presentation items, layout-slot items and proof-of-play. Null selection remains compatible as page 1. A dry-run-by-default backfill inspects only READY documents with a missing count; `--apply` is required to write values. Mixed player fleets are protected by the publish capability gate.

## Corner-case simulation

| Case | Source-predicted result | Runtime status |
| --- | --- | --- |
| Legacy null selection | Normalize and snapshot as page 1 | Not Tested |
| Page 1 / final page | Accepted when within final PDF count | Runtime observed for pages 1 and 19 |
| Page 0, negative, fraction, or above count | CMS blocks progression; API rejects | DB-backed API subset passed; full browser-invalid matrix open |
| Count still unknown | Page 1 only; page >1 rejected | Not Tested |
| Same document twice | Independent occurrence IDs and page values survive atomic save | Runtime observed for pages 10 and 19 |
| Native PDF | Remains PROCESSING until PDF.js inspection succeeds | Not Tested |
| Office/CSV input | Count comes from converted `ready.pdf` | Not Tested |
| Password-protected/malformed/zero-page PDF | FAILED with stable inspection reason; cannot be scheduled READY | Not Tested |
| Invalid layout slot / duplicate slot order / non-READY media | Entire replacement rejected; old assignment should remain | DB-backed invalid page/non-document and duplicate-order subset passed |
| Concurrent atomic replacement | Transaction avoids partial row sets; last successful serialized replacement requires DB concurrency verification | Not Tested |
| Publish after media replacement/count drift | Publish revalidation rejects stale out-of-range selection | Not Tested |
| Old player + page 1 | Compatible | Not Tested |
| Old player + page >1 | Publish conflict `UNSUPPORTED_DOCUMENT_PAGE_SELECTION` | Not Tested |
| PDF URL expires or cache misses | Existing retry/cache behavior applies; renderer shows error if no readable PDF | Not Tested |
| Resize/high-DPI/multi-slot PDFs | Contain-fit render; player raster budget bounds two-canvas allocations | Not Tested |
| Playback changes only page | Playlist fingerprint changes and new page should render | Runtime observed across pages 1/10/19 |
| Offline PoP replay | Selected page remains in buffered/spooled event | Not Tested |
| Duplicate PoP for different pages | Different idempotency keys | Runtime observed; 33 rows had 33 distinct keys |
| CMS draft from older version | Restored occurrence gets a client ID and page 1 | Not Tested |
| Non-document with `page_number` | API rejects as not applicable | Not Tested |

## Static verification performed

- Server production/CLI TypeScript build: passed.
- CMS production build and bundle budget: passed; PDF.js is a lazy chunk and worker asset. The full CMS unit suite passed 110 tests, including the source-connected selected-page preview option.
- Player main/renderer build and bundle: passed. The full player unit suite passed 352 tests, its integration suite passed 5 tests, and its fault-injection suite passed 14 tests.
- Server database-free unit suite passed 25 tests, including page validation, PDF inspection, migration-contract, backfill-safety, PoP idempotency, video-loop normalization, presentation resolution and immutable snapshot serialization.
- Player and CMS lint passed with existing warnings and no errors. Server-wide lint still has one pre-existing `prefer-const` error in `darshan-server/src/jobs/index.ts`; it is not in the document-page or video-loop delta.
- A dedicated `darshan_feature_test` database was freshly migrated through all 46 migrations. The focused page/loop server suites passed 9 tests. Broader publish capability, telemetry list/export and migration/backfill matrices remain open.

The exact build, unit, integration, fault and lint outcomes for this working tree are summarized in `runtime-2026-10-15/runtime-validation.md`. The targeted run started disposable local services and a real Electron process; it did not use production infrastructure or a physical Windows/Ubuntu display installation.

The run provides targeted evidence for browser canvas output, DB-backed replacement, publishing, Linux Electron output and PoP persistence. It does not prove Office conversion/backfill, hostile concurrency, mixed old/new fleet behavior, full offline spool replay/export, long-run rendering or supported-platform compatibility.

## Remaining execution gates

Complete the still-open portions of `FILE-03`, `FILE-04`, `FILE-06`, `UI-05`, `API-05`, `API-06`, `DATA-05`, `CONC-06`, `PLAYER-10`, `OBS-03`, `COMP-04`, and `PERF-05` in the approved QA environment. Apply migration/backfill only to a disposable database first. Validate fresh-package Windows and Ubuntu physical output, long-run rendering and mixed-fleet capability gating before release. Review `R-21` through `R-23` before enabling the CMS control for a mixed fleet.
