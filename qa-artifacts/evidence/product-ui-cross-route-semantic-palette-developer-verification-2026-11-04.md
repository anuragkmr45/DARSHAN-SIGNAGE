# Cross-route semantic notices and modal scrim: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Presentation only; API requests, permission gates, data and user actions are unchanged.

- Pairing warnings/copy success, User role-change warning, Media status/compression feedback, chat upload/status notices and Schedule target health use existing semantic light/dark tokens. File-type labels and icons remain, with neutral icon color.
- Dialog, alert-dialog, drawer and sheet overlays use the same Forest scrim token instead of accent-dependent or black overlays. Loading panels no longer blur content.
- CMS `npm run build` and bundle budget passed; full unit suite **283/283** passed. Focused ESLint had zero errors and one existing Fast Refresh warning in `StepScreenSelect.tsx`.
- Representative browser journeys passed **4/4**: chat member confirmation, Media upload sheet, Schedule Queue detail at phone/tablet/desktop widths, and Screen first-time pairing. The [390px Schedule Queue capture](product-ui-schedule-queue/390-list.png) was inspected after regeneration. A second targeted chat browser run passed **1/1**, checking the actual dialog scrim is nontransparent, has no backdrop blur and changes between light and dark modes.
- These are fixture-backed developer checks. Real-service behavior, all mounted dialogs and overlays, keyboard and screen-reader QA, customer accents and physical-player acceptance remain open in the master checklist.
