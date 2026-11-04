# Live Broadcasts page: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Status: fixture-backed page-entry checks plus a limited real CMS and API source lifecycle. This does not establish running-service media or independent human QA acceptance.

## Contract traced

- The CMS route accepts an actor with an effective Live Broadcast read, create or publish grant. The Schedule wizard itself requires the full Schedule/Item/Request create and related read grants. Creating a reusable source requires `create LiveBroadcast`; the library GET requires `read LiveBroadcast`.
- The source list and detail are REST data. Record `permissions` control Edit/Delete and the server receives expected revision on a write. The existing published-occurrence controls use a fresh backend authority epoch; a list row alone does not prove player frames.
- This packet changes page task priority, source-list layout and the wizard-to-source handoff. It does not change publication, capture, admission, player or fallback semantics. Webpage Media was retired before first production deployment, so the old wizard fallback sentence was stale.

## Rendered browser journeys

`darshan-cms/tests/live-page-ui.e2e.spec.ts` ran with one Playwright worker against the running Vite CMS and controlled API responses:

1. A custom actor with complete grants opened Schedule live event as the primary action, closed it, then opened New live source from the library without sending a source write.
2. A read-only actor saw a source-list failure as an error, used Retry, viewed the resulting source and sent no Edit/Delete request.
3. The live page and source row rendered at 390, 820 and 1440 CSS pixels without document-level horizontal overflow. A visual review of the first phone capture caught an unnecessary pager with a clipped Next control; the page now hides single-page controls and wraps multi-page runtime controls.
4. A 26-result runtime fixture showed both pager buttons fully within the 390-pixel viewport.
5. An empty source step opened source creation without stacking dialogs. A successful create returned to the same draft and refreshed the enabled-source selector.
6. Cancelling source creation retained the draft's previously selected source. A 503 response required the operator to close and verify the library instead of reporting success or sending an automatic second write.
7. A 390-pixel phone and 640×360 short viewport kept Back, Next and Save visible while the wizard's step body scrolled.

Fixture captures: [phone](product-ui-live-page/live-390.png), [tablet](product-ui-live-page/live-820.png), [desktop](product-ui-live-page/live-1440.png), [phone runtime pager](product-ui-live-page/live-runtime-pagination-390.png), [phone wizard](product-ui-live-page/live-wizard-390x844.png), [short wizard](product-ui-live-page/live-wizard-640x360.png).

The [real CMS phone wizard capture](product-ui-live-page/live-wizard-real-cms-390.png) was taken from the final built candidate with a dialog-only screenshot, leaving private account details outside the artifact. It shows the source setup path, current fallback wording and visible footer; it is a single-admin developer observation.

The server-render page suite checks five permission/query cases. The existing source and runtime component suites were updated for the compact labeled row and conditional pager, preserving their per-record grant and truthful-state assertions.

## Real isolated CMS and API journey

The built candidate CMS at `https://localhost:18445` and existing isolated QA API were exercised through a fresh Playwright browser with the local QA admin credential read only from the ignored private file. No credential, token or screenshot from the private account is committed. The first read-only pass signed in, loaded three existing QA sources and opened the four-step live wizard. This exposed the stale webpage fallback sentence and missing source-creation path.

After rebuilding, the browser created a uniquely named QA source **through the wizard**, returned to the same draft, selected that source, closed the draft, saw it in the refreshed library, opened its detail, edited its description, reopened it to confirm persistence, deleted it through CMS and confirmed absence after a page reload. The created test record was removed. A separate 390-pixel run selected an existing source, opened and cancelled the source form, then confirmed the original draft choice remained and the document had no horizontal overflow. Neither run published a schedule or started media.

One preliminary test run stopped at a browser selector that matched both the modal X and footer Close. The source created in that run was deleted through CMS before the repeat. This was a test harness selector issue, not a product failure.

## Checks and limits

- CMS production build and bundle budget: passed after the final sticky-footer change; entry JavaScript 212.3 KiB (67.4 KiB gzip).
- Live page browser cases: 8/8 passed against the final code, including source handoff, uncertain response and compact wizard.
- Full CMS unit suite: 42 files, 273 tests passed. Two assertions tied to the prior View label and always-visible pager were updated to the intended behavior.
- Focused ESLint over changed CMS components and test files: passed.
- `git diff --check`: passed before packet commit.
- A real single-admin CMS/API source lifecycle passed. This is local developer verification, not a two-actor permission, full schedule or media run.

## Remaining acceptance work

- Complete the four-step Schedule wizard in the real CMS, including fallback preparation, author review, Submit, approval and publication; verify actor permissions and an expired or changed draft.
- Exercise source create, edit, disable and delete with additional actors, stale revision, concurrent operator and response loss; verify the server's blocker categories and no duplicate write. The local admin happy path alone does not close this item.
- Exercise runtime reporting-window pagination, presenter capture/Stop and administrative disable/re-enable with actual backend authority, then observe the packaged player frame, audio, fallback and emergency behavior.
- Run the independent `LIVE-01..20` matrix, representative cross-VM media/network and load checks, keyboard/screen reader, 200% zoom, dark/accent themes and physical displays. Fixture screenshots do not close those gates.
