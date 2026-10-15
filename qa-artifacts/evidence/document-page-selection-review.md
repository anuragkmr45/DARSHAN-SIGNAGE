# Document Page Selection — Architecture And Simulation Review

Review date: 2026-10-15  
Baseline: `release-01` at `607440c12a8b476149253aac77bbbdcf3c1d960b`, plus the uncommitted feature implementation in this workspace.  
Method: repeated static data-flow review, TypeScript production builds, and isolated database-free unit tests. No application, browser, Electron process, Docker service, queue worker, database migration, integration database, or physical display was started.

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
| Page 1 / final page | Accepted when within final PDF count | Not Tested |
| Page 0, negative, fraction, or above count | CMS blocks progression; API rejects | Not Tested |
| Count still unknown | Page 1 only; page >1 rejected | Not Tested |
| Same document twice | Independent occurrence IDs and page values survive atomic save | Not Tested |
| Native PDF | Remains PROCESSING until PDF.js inspection succeeds | Not Tested |
| Office/CSV input | Count comes from converted `ready.pdf` | Not Tested |
| Password-protected/malformed/zero-page PDF | FAILED with stable inspection reason; cannot be scheduled READY | Not Tested |
| Invalid layout slot / duplicate slot order / non-READY media | Entire replacement rejected; old assignment should remain | Not Tested |
| Concurrent atomic replacement | Transaction avoids partial row sets; last successful serialized replacement requires DB concurrency verification | Not Tested |
| Publish after media replacement/count drift | Publish revalidation rejects stale out-of-range selection | Not Tested |
| Old player + page 1 | Compatible | Not Tested |
| Old player + page >1 | Publish conflict `UNSUPPORTED_DOCUMENT_PAGE_SELECTION` | Not Tested |
| PDF URL expires or cache misses | Existing retry/cache behavior applies; renderer shows error if no readable PDF | Not Tested |
| Resize/high-DPI/multi-slot PDFs | Contain-fit render; player raster budget bounds two-canvas allocations | Not Tested |
| Playback changes only page | Playlist fingerprint changes and new page should render | Not Tested |
| Offline PoP replay | Selected page remains in buffered/spooled event | Not Tested |
| Duplicate PoP for different pages | Different idempotency keys | Not Tested |
| CMS draft from older version | Restored occurrence gets a client ID and page 1 | Not Tested |
| Non-document with `page_number` | API rejects as not applicable | Not Tested |

## Static verification performed

- Server normal and production/CLI TypeScript builds: passed.
- CMS production build and bundle budget: passed; PDF.js is a lazy chunk and worker asset.
- Player main/renderer build and bundle: passed.
- Server database-free page validation, PDF inspection, migration-contract, backfill-safety and PoP-idempotency tests: 21 passed.
- CMS normalization/preview-helper tests: 8 passed.
- Player PDF/snapshot/fingerprint/offline-cache/PoP-page subsets: 54 passed.
- The server DB-backed test harness refused the configured non-test database as designed. Atomic presentation replacement, publish capability/snapshot, telemetry persistence, and PoP list/export tests were authored but not run.

These checks prove compilation and selected pure logic only. They are not evidence that conversion, transactions, migrations, publishing, real browser canvas output, native player output, offline replay, PoP persistence, or backfill works in a deployed environment.

## Remaining execution gates

Run `FILE-03`, `FILE-04`, `FILE-06`, `UI-05`, `API-05`, `API-06`, `DATA-05`, `CONC-06`, `PLAYER-10`, `OBS-03`, `COMP-04`, and `PERF-05` in the isolated QA environment described by the test-data plan. Apply the migration only to a disposable database first. Validate Windows and Ubuntu physical output before release. Review `R-21` through `R-23` before enabling the CMS control for a mixed fleet.
