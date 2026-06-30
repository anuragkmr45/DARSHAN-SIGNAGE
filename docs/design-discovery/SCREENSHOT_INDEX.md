# DARSHAN Design Discovery Screenshot Index

Last evidence refresh: 2026-06-28.

No new screenshots were captured in this code-truth refresh. Existing images/logs are indexed below with evidence status.

Status legend:

- `historical-before-redesign`: original discovery screenshot; useful for comparison, not current proof.
- `after-redesign-local`: screenshot from prior redesign implementation pass; not recaptured now.
- `final-qa-local`: screenshot/log from prior final QA pass; not recaptured now.
- `dom-only`: renderer HTML/static DOM evidence, not live Electron/package evidence.
- `needs-recapture`: should be recaptured before new design implementation or production claims.

## Original Discovery Screenshots

| File | Page/state | Status | Notes |
|---|---|---|---|
| `docs/design-discovery/screenshots/cms-login.png` | CMS login | historical-before-redesign | Actual route at capture time; do not treat as current UI proof. |
| `docs/design-discovery/screenshots/cms-dashboard.png` | Dashboard | historical-before-redesign | Authenticated local Vite capture. |
| `docs/design-discovery/screenshots/cms-sidebar-collapsed.png` | Collapsed sidebar | historical-before-redesign | Useful for sidebar behavior comparison. |
| `docs/design-discovery/screenshots/cms-media-library.png` | Media Library | historical-before-redesign | Upload/filter/list surface. |
| `docs/design-discovery/screenshots/cms-schedule-queue.png` | Schedule Queue | historical-before-redesign | Queue and schedule panel. |
| `docs/design-discovery/screenshots/cms-schedule-creator.png` | Schedule Creator | historical-before-redesign | Wizard route. |
| `docs/design-discovery/screenshots/cms-layouts.png` | Layouts | historical-before-redesign | Layout list/editor entry. |
| `docs/design-discovery/screenshots/cms-screens.png` | Screens | historical-before-redesign | Screens/pairing health shell. |
| `docs/design-discovery/screenshots/cms-pair-device-modal.png` | Pair Device modal | historical-before-redesign | Pairing modal visual evidence only. |
| `docs/design-discovery/screenshots/cms-requests.png` | Requests | historical-before-redesign | Workboard surface. |
| `docs/design-discovery/screenshots/cms-notifications.png` | Notifications | historical-before-redesign | Inbox surface. |
| `docs/design-discovery/screenshots/cms-chat.png` | Chat/conversations | historical-before-redesign | Chat empty/select state. |
| `docs/design-discovery/screenshots/cms-settings.png` | Settings | historical-before-redesign | General settings tab. |
| `docs/design-discovery/screenshots/cms-settings-default-media.png` | Settings Default Media | historical-before-redesign | Default media tab; operationally sensitive. |
| `docs/design-discovery/screenshots/cms-reports.png` | Reports | historical-before-redesign | Reports/logs summary. |
| `docs/design-discovery/screenshots/cms-proof-of-play.png` | Proof of Play | historical-before-redesign | PoP page. |
| `docs/design-discovery/screenshots/player-pairing-static.png` | Player pairing | dom-only | Static renderer HTML with injected state; not live Electron evidence. |

## After-Redesign Screenshots

| File | Page/state | Status |
|---|---|---|
| `after-redesign-screenshots/login.png` | Login | after-redesign-local |
| `after-redesign-screenshots/dashboard.png` | Dashboard | after-redesign-local |
| `after-redesign-screenshots/sidebar-collapsed.png` | Sidebar collapsed | after-redesign-local |
| `after-redesign-screenshots/media-library.png` | Media | after-redesign-local |
| `after-redesign-screenshots/schedule-queue.png` | Schedule queue | after-redesign-local |
| `after-redesign-screenshots/layouts.png` | Layouts | after-redesign-local |
| `after-redesign-screenshots/screens.png` | Screens | after-redesign-local |
| `after-redesign-screenshots/screens-pair-modal.png` | Pair modal | after-redesign-local |
| `after-redesign-screenshots/requests.png` | Requests | after-redesign-local |
| `after-redesign-screenshots/notifications.png` | Notifications | after-redesign-local |
| `after-redesign-screenshots/chat.png` | Chat | after-redesign-local |
| `after-redesign-screenshots/settings.png` | Settings | after-redesign-local |
| `after-redesign-screenshots/reports.png` | Reports | after-redesign-local |
| `after-redesign-screenshots/proof-of-play.png` | Proof of Play | after-redesign-local |
| `after-redesign-screenshots/player-otp-dom-only.png` | Player OTP | dom-only |
| `after-redesign-screenshots/browser-console-after-redesign.log` | Browser console log | after-redesign-local |

## Final QA Screenshots / Logs

| File | Page/state | Status |
|---|---|---|
| `final-qa-screenshots/auth-login.png` | Login/auth | final-qa-local |
| `final-qa-screenshots/login.png` | Login | final-qa-local |
| `final-qa-screenshots/login-keyboard-focus.png` | Login focus | final-qa-local |
| `final-qa-screenshots/protected-route-login-redirect.png` | Protected route redirect | final-qa-local |
| `final-qa-screenshots/player-otp-dom-only.png` | Player OTP | dom-only |
| `final-qa-screenshots/cms-console-clean.log` | CMS console log | final-qa-local |
| `final-qa-screenshots/player-dom-console.log` | Player DOM console | dom-only |

## Recapture Requirements

Before another visual implementation phase, recapture:

- current CMS login, dashboard, sidebar expanded/collapsed
- media, layouts, schedule queue, schedule creator
- screens, Pair Device modal, Pairing Health, screen details if backend data exists
- settings default media
- requests/emergency, chat, notifications, reports, proof-of-play
- player OTP using live Electron if possible; DOM-only if Electron remains blocked and explicitly labeled

Do not use screenshots as production runtime evidence unless they are captured from the actual deployed target with secrets reviewed.
