# Media upload and preview: developer verification (2026-11-02)

## Scope

Local Docker CMS at `http://127.0.0.1:18091/media`, local API, PostgreSQL, and MinIO. This is developer verification, not production or physical-display QA.

## Observed behavior

- The authenticated upload-policy API returned 13 MIME types, matching the accepted server schema.
- A real browser submitted a valid PDF whose browser-provided type was `application/octet-stream`. The CMS displayed “PDF document”, sent `application/pdf` in the upload session, and the server completed the upload. The asset then reached READY and rendered on its card and in the detail modal.
- A READY XLSX record displayed its source format as Excel (.xlsx), explained that screen playback uses converted PDF, and rendered its first page in both locations. A real image rendered and a video loaded metadata without error.
- The local Nginx gateway returned `application/javascript` for the PDF.js `.mjs` worker. The production CMS Nginx template passed `nginx -t` after substitution.
- The document browser test verified that navigating from page 1 to page 2 changes the canvas pixels and that the detail view obtains a fresh media URL. The existing webpage-preview browser test also passed.
- A converted document was delivered with `Content-Type: application/pdf` and an inline filename ending in `.pdf`.

## Automated checks

- Server TypeScript build: passed.
- Server focused route and filename tests on an isolated `darshan_media_upload_test` PostgreSQL database: 21/21 passed.
- CMS production build and bundle budget: passed.
- CMS unit suite: 148/148 passed.
- Focused CMS browser tests for document and webpage preview: 2/2 passed.
- `git diff --check`: passed.

The full CMS `tsc` remains outside the passing gate because the repository currently has a TypeScript 5.9/`ignoreDeprecations: 6.0` configuration mismatch and 125 existing project errors when the setting is overridden. The only reported error in the touched Media Library file is its pre-existing `Tabs` callback typing.

## Remaining QA

Confirm the same flow on the packaged release and target CMS VM, including a large document and the deployed Nginx configuration. No production VM was available in this session.
