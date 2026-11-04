# Schedule Queue interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. The approved visual direction is applied to the Queue list and filter hierarchy.

## Behavior checked

- Create Schedule appears only when the actor has every effective grant required by this wizard's reads and writes. The direct `/schedule/new` URL explains missing access without a write.
- Search is always visible; date field, local-day range and sort are disclosed under Filters. Reversed dates block queries and show a correction. Search/filter changes clear stale tab-count fallbacks and selected request detail.
- Initial list failure shows Retry rather than an empty queue. Status-summary failure is separately visible. Request selection supports keyboard Enter/Space, and a successful list refresh updates or closes its selected row.
- A published-screen snapshot is described as backend current state. It is not presented as player receipt or displayed playback evidence. Snapshot load failure has a visible Retry path. Initial list/summary errors use inline feedback without duplicate load-failed toasts.
- Group-only and mixed-target published requests no longer silently inspect the first direct Screen. The operator chooses the target and, for a multi-member group, a current member before a device snapshot is requested. Group membership comes from REST, is explicitly current rather than a frozen publication audience, and has failure/Retry and refresh controls. A Screen Group read grant is required to load its membership.

## Developer evidence

- `darshan-cms/tests/schedule-queue-ui.e2e.spec.ts`: six fixture-backed browser cases passed for read-only and creator access, direct URL denial, failure/Retry, keyboard selection, stale-count prevention, published snapshot wording, date behavior and 390/820/1440 layouts.
- [Phone list](product-ui-schedule-queue/390-list.png), [expanded phone filters](product-ui-schedule-queue/390-filters.png), and [desktop list](product-ui-schedule-queue/1440-list.png) were inspected. The list appears below a compact search/filter row on phone and stays within the viewport.
- One combined run of the new Queue suite and existing schedule creator/emergency browser suite passed 8/8 with one worker. CMS production build and bundle budget, CMS unit suite 272/272, focused lint and `git diff --check` passed.
- The snapshot choice extension passed nine Queue browser cases, including group-only failed-membership recovery, explicit multi-target selection and denied Screen Group membership. CMS production build/bundle budget and all 272 CMS unit tests passed. These are fixture-backed browser checks, not a deployed player or real-service confirmation.

## Review-action safety extension

- The app's QueryClient retries mutations once by default. Request approval, rejection, publication, combined approval/publication and take-down now set `retry: false` so an uncertain response cannot cause an automatic second write.
- Confirm dialogs keep the operator's note on failure, disable another confirmation, and offer a fresh server read before retry. Display preflight blocks additional actions while it runs. Successful actions close the dialog only after the response. If approval commits but publication fails, the UI preserves Approved and directs the operator to publish separately.
- Five added fixture browser cases passed for one-write failure/reload/retry, lost response after committed approval, partial combined publication, take-down failure/reload/retry, and selection during a held preflight. The previous twelve-case Queue/creator/emergency browser run passed 14/14; the lost-response and held-preflight cases ran separately. The real two-operator journey remains a separate validation gate.
- Final CMS production build and bundle budget, 272/272 CMS unit tests, focused lint and `git diff --check` passed after the request-selection guard.

## Remaining release QA

These browser cases use fixture REST responses. Run real actor and two-operator request creation, approval, publication and take-down through the CMS and installed player. Check stale dialog, permission withdrawal, group and multi-screen snapshots including changed membership, player acknowledgement and proof-of-play separately. Confirm browser-local date interpretation for remote operators and site policy; current UI uses the operator's local day because request timestamps are also rendered locally. Complete keyboard/screen-reader, zoom, touch, and production-size queue checks. Human QA sign-off is separate.

## Cancellation and history extension, 2026-11-04

The backend already supported `POST /schedule-requests/:id/cancel` for pending or approved requests, releasing reservations, but the CMS had no cancel control. It also omitted `CANCELLED` from Queue tabs and from the summary count, so a cancelled request disappeared from the operator's history. The drawer now shows **Cancel Request** only with the effective `update ScheduleRequest` grant, confirms that publication will stop and held screen time will be released, and uses one request without automatic retry. An uncertain response blocks another action until the operator reloads the request. The Queue now has a Cancelled tab and count from the authoritative API. Search transitions hide old rows before a new query resolves; this corrects a real 350ms debounce race that closed a confirmation opened from a stale row.

Focused fixture browser cases passed for pending and approved cancellation, kept-request dismissal, Cancelled history, read-only absence, uncertain response with one write, and stale-search row hiding. The complete Schedule Queue browser suite passed **17/18** on its first run; the remaining date-filter test used an ambiguous `To` label that also matched pager links. After changing its selector to the exact date-field label, that case passed **1/1**. No application defect was found in that case. The current-source server filter suite passed **3/3** on a fresh dedicated 65-migration `darshan_ui_schedule_20261104_test` database, including filtered Cancelled list/count. The CMS unit suite passed **276/276**. Focused CMS and server lint completed with no errors (six existing server `no-explicit-any` warnings). Both CMS and server builds passed; the CMS bundle budget passed.

A matched-build temporary CMS/API instance at `https://localhost:18446` used that isolated database. At 390 CSS pixels, an administrator searched for the seeded QA request, opened the confirmation, cancelled through CMS, and found it under **Cancelled 1** with no repeat cancel action. Read-only database inspection confirmed `CANCELLED`. The exact QA request and schedule were then removed, and only the temporary API/proxy were stopped; the existing live-broadcast stack was unchanged. [The dialog-only confirmation capture](product-ui-schedule-queue/cancel-confirm-real-390.png) contains no private account data. This real journey used a seeded request without an actual reservation, so reservation release under load and two-operator races remain separate QA.
