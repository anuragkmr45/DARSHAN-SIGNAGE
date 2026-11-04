# Live Broadcasts page: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Status: fixture-backed page checks plus real isolated CMS/API source and live-request lifecycle. This does not establish running-service media or independent human QA acceptance.

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

- Verify player receipt and playback after a real publish; verify actor permissions and an expired or changed draft. The matched-build CMS approval/publication path passed in the isolated journey below.
- Exercise source create, edit, disable and delete with additional actors, stale revision, concurrent operator and response loss; verify the server's blocker categories and no duplicate write. The local admin happy path alone does not close this item.
- Exercise runtime reporting-window pagination, presenter capture/Stop and administrative disable/re-enable with actual backend authority, then observe the packaged player frame, audio, fallback and emergency behavior.
- Run the independent `LIVE-01..20` matrix, representative cross-VM media/network and load checks, keyboard/screen reader, 200% zoom, dark/accent themes and physical displays. Fixture screenshots do not close those gates.

## Live Window duration correction and real check, 2026-11-04

The running CMS on the existing isolated stack reached step 3 at 390 CSS pixels after selecting an enabled source, preparing the existing image fallback to READY, and selecting the QA player screen. A 10:00–11:30 local window displayed **“1 hour(s)”**, omitting the remaining 30 minutes. The shared Schedule Details component now shows every nonzero day, hour and minute part with singular/plural wording, checks invalid dates, and announces duration updates politely. This affects ordinary Schedule and Live Event authoring display only; server window authority is unchanged.

After rebuilding the CMS, the same real browser journey displayed **“1 hour, 30 minutes”** with no dialog overflow. The draft was closed without Review, Submit or publication. [The dialog-only 390px capture](product-ui-live-page/live-window-duration-real-390.png) contains no account credentials. Focused rendered-component cases passed **3/3** for partial hours, day/hour/minute ranges and invalid windows. The full CMS unit suite passed **43 files, 276/276**; the production build and bundle budget passed; focused Live page plus Scheduling/Emergency browser regression passed **10/10** with one worker. Those fixture browser runs refreshed the three tracked Live page viewport captures. This is developer verification, not approval or live playback evidence.

## Real live authoring and cancellation, 2026-11-04

**Passed, developer scope:** A fresh signed-in browser at 390 CSS pixels used the built CMS at `https://localhost:18445` and the existing isolated 2026-11-03 QA API. It selected an enabled QA source, prepared the existing image presentation to `READY`, selected the QA Screen, entered a 10 November 2026 14:00–14:30 India-time window, and opened the frozen Review. The Review showed one concrete approved Screen, presenter and audio policy, and a prepared fallback image item. The browser acknowledged the review, submitted one request for approval, found that request in Schedule Queue, and cancelled it there. The Review, Submit and Cancel responses were all HTTP 200. Read-only database inspection found request `80b4486c-f163-479b-9df9-9cffe6340dc7` in `CANCELLED`, its Screen reservation in `CANCELLED` with `released_at`, and the live occurrence in `CANCELLED` with `released_at`; both release reasons were `request-cancelled-by-admin`. The cancelled record is named `UI-LIVE-REGRESSION-1793753725239` in the isolated `darshan_live_20261103_test` database.

**Retained QA history:** A transaction attempted to remove only this uniquely identified test record after cancellation. PostgreSQL rejected deletion of its approved fallback asset with `Approved live fallback assets are immutable`, and the entire transaction rolled back. The cancelled request, occurrence and reservation were left as inactive historical QA records; the immutable policy trigger was not bypassed. They do not hold current screen time. A separate post-fix Review-only draft was removed with exact-ID and no-reference preconditions.

**Review clarity correction:** The real Review initially displayed timestamps without a timezone and omitted the source name. The CMS now names the source and offline fallback, labels the time zone explicitly, maps the Chromium `Asia/Calcutta` alias to `Asia/Kolkata` for new scheduling, shows the audience count and uses separate short Start/End labels. A post-build real Review-only pass displayed `Time zone: Asia/Kolkata`; a fixture-backed browser journey checks the final concise rendering, one review write and one submission write at that timezone. [The final 390px summary capture](product-ui-live-page/live-review-summary-390.png) uses fixture data and contains no account credentials. The complete affected Live page plus Scheduling/Emergency browser run passed **11/11** at one worker; after the final summary layout change, the focused Review journey passed again. The ordinary Scheduling/Emergency browser suite passed **2/2** after shared timezone normalization. The full CMS unit suite passed **277/277**. The final production build and bundle budget passed; entry JavaScript measured 212.3 KiB (67.4 KiB gzip).

**Still open from this journey:** It did not start a presenter, send media to a player, verify proof-of-play, or test cross-VM behavior. The QA API process was the existing isolated build rather than a newly rebuilt server artifact. The matched current-server publication check below closes that one gap; packaged-player delivery, two-actor, stale review, permission withdrawal, and human QA remain open.

## Matched-build approval, publication and take-down, 2026-11-04

**Passed, developer scope:** A temporary current-source API on `127.0.0.1:18146` and the current built CMS on `https://localhost:18446` used the already running isolated PostgreSQL/MinIO/Valkey QA services. A fresh 390-pixel browser submitted the reviewed future live event; a fresh desktop browser opened the request in Schedule Queue, approved it, reopened it from the Approved tab, and published it. Review, Submit, Approve and Publish each returned HTTP 200. Read-only PostgreSQL inspection found request `1b8d1f4a-b051-4fa1-a0cd-d261c2b04a1a` and its screen reservation/live occurrence in `PUBLISHED`, publish `994fd008-a8d2-421b-83c0-9c5ab3864cf3` in `ACTIVE`, and immutable snapshot `346446c5-116d-4d69-a10c-85861a08b32f`. The publish target remained `PENDING`; this run proves the server accepted publication, not that a player received or displayed media. The scheduled window was 10 November 2026 14:00–14:30 IST, so no current playback was expected.

The same browser reopened the Published request and used **Take Down Schedule**. The response was HTTP 200. Read-only inspection found request and publish in `TAKEN_DOWN`, reservation and live occurrence in `RELEASED` with reason `request-taken-down-by-admin`. The immutable historical records remain in the isolated QA database under `UI-LIVE-REGRESSION-1793754754509`, but no future screen time remains reserved. The publish target's original delivery status remains `PENDING` in history; the report and delivery meaning of that status after take-down still needs review.

This checks one administrator's UI path with matched current CMS/server code and a real database. It does not establish notification delivery, player receipt, live frame/audio, fallback, concurrent actor behavior, or human acceptance. The native media node was not started for this future-window metadata check.
