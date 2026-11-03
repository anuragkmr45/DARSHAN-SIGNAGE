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

## Remaining release QA

These browser cases use fixture REST responses. Run real actor and two-operator request creation, approval, publication and take-down through the CMS and installed player. Check stale dialog, permission withdrawal, group and multi-screen snapshots including changed membership, player acknowledgement and proof-of-play separately. Confirm browser-local date interpretation for remote operators and site policy; current UI uses the operator's local day because request timestamps are also rendered locally. Complete keyboard/screen-reader, zoom, touch, and production-size queue checks. Human QA sign-off is separate.
