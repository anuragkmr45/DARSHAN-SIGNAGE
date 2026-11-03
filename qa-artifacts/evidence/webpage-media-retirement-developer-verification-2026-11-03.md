# Webpage Media retirement — developer verification, 2026-11-03

## Scope and decision

The user retired webpage Media before the first production deployment. Live broadcasts provide scheduled real time content. The database `WEBPAGE` enum and historical columns remain for nondestructive migration and audit history; old rows cannot be newly assigned, restored, captured, or played. Reports and Audit Logs PDF export moved from Playwright Chromium to LibreOffice.

This is developer evidence on branch `codex/remove-webpage-media-20261103`, not independent QA or release sign-off. The current local Docker application still uses its prior images until a new artifact is built and deployed.

## Code paths checked

- CMS Media library, media preview, Schedule and default-media pickers, deleted-media restore.
- Media API create/restore/refresh, presentation and publish validation, emergency/default/live-fallback validation, device-facing URL resolution and worker scheduling.
- Player snapshot cache, media compatibility, renderer and default-media paths; Electron webview support is disabled.
- Backend Docker/runtime scripts, source-free bundle config, webhook Test IP policy, Reports and Audit Logs PDF routes.

## Developer results

| Check | Result |
| --- | --- |
| Server focused unit: runtime dependencies, resolved media, PDF conversion, webhook Test, production commands, live fallback and media processing state | 80 passed |
| Database-backed Media route: create/restore WEBPAGE, old preview refresh route | 3 passed against dedicated `darshan_webpage_test` PostgreSQL database; 410, 410 and 404 observed; deleted historical row unchanged |
| Database-backed Reports and Audit Logs PDF exports | 2 passed; both returned HTTP 200 and valid PDF headers |
| Player compatibility/config/default-media tests | 36 passed |
| Player snapshot/cache/playback regression after retirement cache fix | 91 passed |
| Player snapshot-manager test, including no old URL/preview prefetch | 14 passed |
| CMS unit tests for device snapshot, preview and live fallback | 11 passed |
| Broader CMS unit regression | 267 passed across 41 test files |
| CMS browser flow with historical WEBPAGE row | 1 passed in Playwright Chromium: no Add Webpage, no Refresh preview, no fetched/rendered old preview |
| Server TypeScript build | passed |
| Player build | passed after the final snapshot-manager cache change |
| CMS production build and bundle budget | passed |
| Source-free bundle config suite | 17 passed |
| Real LibreOffice conversion and visual sample | valid PDF; summary and rows readable after changing browser CSS cards to a table |
| Backend Docker image | built `darshan-webpage-retired-qa:20261103`; nonroot isolated container converted HTML to PDF, and `/ms-playwright` plus `/app/node_modules/playwright` were absent |
| Bundle config and shell validation | 17/17 config tests; shell syntax and `git diff --check` passed |

The webhook Test address policy was extracted into `network-address-policy.ts`; the 27 webhook tests are included in the server focused count. The first database test attempt was blocked by the dedicated-test-database guard before execution; no application database was reset. The following runs used a new `darshan_webpage_test` database.

## Remaining independent QA

- Execute `RET-01..03` on frozen backend/CMS/player artifacts. Cover permissions, new presentation/schedule/default/emergency/live fallback references, old direct API clients, offline player restart, and absence of network requests to retired URLs.
- Export empty and populated Reports and Audit Logs PDFs in the final backend container. Inspect long names, Unicode, multiple pages, row alignment, completeness and concurrent exports. Measure timeout/large report behavior.
- Inspect the final backend image for absence of Playwright Chromium, and verify `soffice` runs as the nonroot account. Check source-free bundle packaging and fresh QA deployment.
- Run physical Ubuntu and Windows packaged-player display checks; local tests do not prove what a human sees on a device.
