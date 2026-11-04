# Live Broadcasts page: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Status: fixture-backed page-entry and source-list verification. This does not establish running-service media or independent human QA acceptance.

## Contract traced

- The CMS route accepts an actor with an effective Live Broadcast read, create or publish grant. The Schedule wizard itself requires the full Schedule/Item/Request create and related read grants. Creating a reusable source requires `create LiveBroadcast`; the library GET requires `read LiveBroadcast`.
- The source list and detail are REST data. Record `permissions` control Edit/Delete and the server receives expected revision on a write. The existing published-occurrence controls use a fresh backend authority epoch; a list row alone does not prove player frames.
- This packet changes page task priority and source-list layout. It does not change publication, capture, admission, player or fallback semantics.

## Rendered browser journeys

`darshan-cms/tests/live-page-ui.e2e.spec.ts` ran with one Playwright worker against the running Vite CMS and controlled API responses:

1. A custom actor with complete grants opened Schedule live event as the primary action, closed it, then opened New live source from the library without sending a source write.
2. A read-only actor saw a source-list failure as an error, used Retry, viewed the resulting source and sent no Edit/Delete request.
3. The live page and source row rendered at 390, 820 and 1440 CSS pixels without document-level horizontal overflow. A visual review of the first phone capture caught an unnecessary pager with a clipped Next control; the page now hides single-page controls and wraps multi-page runtime controls.
4. A 26-result runtime fixture showed both pager buttons fully within the 390-pixel viewport.

Captures: [phone](product-ui-live-page/live-390.png), [tablet](product-ui-live-page/live-820.png), [desktop](product-ui-live-page/live-1440.png), [phone runtime pager](product-ui-live-page/live-runtime-pagination-390.png). These contain fixture content only.

The server-render page suite checks five permission/query cases. The existing source and runtime component suites were updated for the compact labeled row and conditional pager, preserving their per-record grant and truthful-state assertions.

## Checks and limits

- CMS production build and bundle budget: passed after the final visual correction; entry JavaScript 212.3 KiB (67.4 KiB gzip).
- Live page browser cases: 4/4 passed after the visual correction.
- Full CMS unit suite: 42 files, 273 tests passed. Two assertions tied to the prior View label and always-visible pager were updated to the intended behavior.
- Focused ESLint over changed CMS components and test files: passed.
- `git diff --check`: passed before packet commit.
- The isolated real CMS is available locally, but the browser session is still at sign-in. No real authenticated service journey is claimed here.

## Remaining acceptance work

- Complete the four-step Schedule wizard in the real CMS, including fallback preparation, author review, Submit, approval and publication; verify actor permissions and an expired or changed draft.
- Exercise source create, edit, disable and delete with real API records, stale revision, concurrent operator and response loss; verify the server's blocker categories and no duplicate write.
- Exercise runtime reporting-window pagination, presenter capture/Stop and administrative disable/re-enable with actual backend authority, then observe the packaged player frame, audio, fallback and emergency behavior.
- Run the independent `LIVE-01..20` matrix, representative cross-VM media/network and load checks, keyboard/screen reader, 200% zoom, dark/accent themes and physical displays. Fixture screenshots do not close those gates.
