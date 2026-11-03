# Core CMS prototype captures

Status: fixture-backed developer visual evidence, not real-service QA or design approval.

At branch `codex/darshan-product-ui-redesign-20261103`, the Dashboard, Screens, and Schedule prototypes rendered at 1440, 820, and 390 CSS pixels without document-level horizontal overflow. The nine captures in `product-ui-core-prototypes/` preserve the current result for review.

Visible follow-up before design approval:

- Dashboard's observability, system, and machine status now use separated sections; the fleet summary remains one segmented control. Screens retains one bordered working list.
- Screens now has one Pair Device action and compact Screen Group/pairing-code disclosures. The updated Screens captures replace the earlier long phone page.
- The earlier full-page Schedule capture put its heading above the app shell because document scroll was not reset before capture. Resetting document scroll corrected the capture. Cancel now stays beside the Schedule heading at 390 pixels.

After these refinements, the Dashboard browser suite passed 7/7 and the Schedule/emergency browser suite passed 2/2 with one Chromium worker. The CMS unit suite passed 271/271, the production build and bundle budget passed, and focused ESLint passed. The first broader Schedule run exposed an immediate assertion on an asynchronous save payload; the test now waits for that request, and the full suite passed on rerun.

A subsequent Dashboard workflow review found that the Media Storage detail said “Hard Delete” while the server forbids permanent deletion and the CMS API sent a normal recoverable delete request. The control now uses per-record `permissions.can_delete`, explains that an administrator can restore the media, and calls the normal DELETE path. A fixture-backed browser case verified a permitted row, a denied row, and no `hard` query parameter. The expanded Dashboard suite passed 8/8; CMS unit tests passed 271/271, production build and bundle budget passed, and focused ESLint passed. Real-service authorization and restore are still pending.

The next focused pass checked media-list access and failure states. A Dashboard-only role sees aggregate usage without a false empty file list and makes no Media list request. A failed list shows an inline retry, which returns to a genuine empty state after the fixture recovers. The expanded Dashboard browser suite passed **10/10**; the CMS unit suite passed **271/271**, production build and bundle budget passed, and focused ESLint passed. Real-service denial and recovery remain pending.

These observations do not override the already recorded functional and real-service regression work.
