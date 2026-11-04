# Media Library interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: fixture-backed browser tests plus a matched-service, isolated Docker image journey. Other formats, conversion, failures, and multi-actor journeys remain release QA.

## Operator task and design result

Operators need to find a file by type, understand whether it is ready, preview it, upload a replacement, and safely delete or restore an item when authorized. The page now has a compact task heading, one filtered gallery, per-asset readiness, and explicit Preview/Copy URL/Delete actions. Four duplicate summary-list requests and metric tiles were removed. List failure and empty results are distinct; the deleted-media sheet has its own loading, failure, Retry, and empty states.

The page gates Upload Media on current `create Media` capability and Deleted Media on `manage Media`. Per-record Delete still uses server-provided permissions. The separately committed server correction lets custom roles with effective `manage Media` list and restore, matching the CMS control.

## Browser evidence

The affected Playwright packet passed **15/15** cases in one worker: `media-library-ui.e2e.spec.ts`, `media-document-preview.e2e.spec.ts`, `media-webpage-retirement.e2e.spec.ts`, and `content-ownership.e2e.spec.ts`.

New Media Library cases cover initial list failure and Retry, true empty state, independent per-type pagination, keyboard Enter on Preview, read-only action hiding, invalid and valid upload selection, deleted-list failure/Retry, and 390/820/1440 CSS pixel plus dark-phone layout without document overflow. Existing cases continue to cover converted document page navigation, retired webpage history, owner/creator labels, delete permission flags, administrator and custom-role restore, and neighboring owned-content behavior.

Rendered fixture captures: [phone](product-ui-media-library/media-390.png), [tablet](product-ui-media-library/media-820.png), [desktop](product-ui-media-library/media-1440.png), [dark phone](product-ui-media-library/media-dark-390.png). The images use synthetic assets and do not prove media delivery.

### Matched-service browser check, 2026-11-04

In the signed-in CMS at `https://localhost:18443/media`, the isolated QA account uploaded the existing 22,533-byte PNG `normal-packaged-player-after-stop-fallback-20261103.png` as `UI redesign QA upload 2026-11-04`. The browser selected the file and submitted the Upload Media sheet. The active library increased from six to seven records, and the new IMAGE row displayed Ready, its thumbnail, and the recorded size. Its Preview dialog rendered the uploaded image. The same CMS session soft-deleted the test record: the active count returned to six. Deleted Media listed the record and Restore returned it to the active list at seven. It was then soft-deleted again to keep the active QA library clear; the retained object remains recoverable.

The existing five-page QA PDF also opened from the active Media list and advanced from page one to page two in its preview dialog. This proves the current preview and page controls for that stored fixture, not conversion of a fresh document. An initial upload attempt used a nonexistent fixture path and did not submit a valid file; the retry used a path verified on disk. This was test setup error, not an observed product failure.

## Build and limits

- CMS production build and bundle budget: passed; entry JavaScript 207.0 KiB (66.4 KiB gzip).
- CMS unit suite: 42 files, 271/271 passed.
- Focused ESLint and `git diff --check`: passed.
- The one small-image upload, preview, soft-delete and restore journey above is verified through the running CMS and MinIO. Large images, videos, fresh document conversion, worker readiness, expired URL refresh, deletion blockers, retained-byte/hash comparison after restore, disconnected/retry cases, and concurrent role changes remain open.
- Five accent presets, text zoom, reduced motion, actual mobile browsers, screen reader, and long file names remain open. The gallery uses six records per page to bound preview work; a server-side name search does not yet exist and remains a large-library usability gap.
