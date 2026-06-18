# DARSHAN Redesign Implementation Report

## Summary

Implemented a safe visual redesign of the DARSHAN CMS and Electron player pairing screen. The work keeps the existing React/Vite/Tailwind/Radix stack, preserves all routes and API contracts, and changes presentation only.

The CMS now uses a warm operational theme based on:

- `#604652` deep plum for primary brand/navigation surfaces.
- `#735557` secondary brand hover/active surfaces.
- `#97866A` muted operational accent in the neutral strategy.
- `#D29F80` warm CTA/focus/pairing accent.

The player OTP screen was redesigned for installer readability and distance viewing, while preserving all renderer element IDs used by the pairing script.

## Files Modified

- `darshan-cms/src/index.css`
- `darshan-cms/src/App.tsx`
- `darshan-cms/src/components/layout/AppSidebar.tsx`
- `darshan-cms/src/components/layout/AppHeader.tsx`
- `darshan-cms/src/pages/Dashboard.tsx`
- `darshan-cms/src/pages/Auth.tsx`
- `darshan-cms/src/components/common/PageHeader.tsx`
- `darshan-cms/src/components/common/EmptyState.tsx`
- `darshan-cms/src/components/dashboard/KPICard.tsx`
- `darshan-cms/src/components/dashboard/StatusBadge.tsx`
- `darshan-cms/src/components/ui/button.tsx`
- `darshan-cms/src/components/ui/card.tsx`
- `darshan-cms/src/components/ui/badge.tsx`
- `darshan-cms/src/components/ui/input.tsx`
- `darshan-cms/src/components/ui/table.tsx`
- `darshan-cms/src/components/ui/dialog.tsx`
- `darshan-player/src/renderer/index.html`

## Design Token and Theme Changes

- Added warm enterprise CSS variables for background, surface, border, primary, secondary, accent, focus ring, sidebar, and semantic status colors.
- Added operational utility classes:
  - `operational-shell`
  - `operational-card`
  - `operational-card-strong`
  - `status-dot`
- Preserved Tailwind/Radix/shadcn-style token usage through existing CSS variables.
- Kept light theme as the primary implementation target.

## CMS Layout, Sidebar, and Header Changes

- App shell now uses the operational background and more consistent content padding.
- Sidebar now groups existing routes into:
  - Operate
  - Create
  - Communicate
  - Admin & Evidence
- All existing route paths, module keys, permission checks, and labels remain present.
- Header now shows route-aware operational context instead of a disabled global search dominating the layout.
- Notification button, account dropdown, and logout behavior are unchanged.

## Dashboard Changes

- Added an operational command-center hero using existing backend-derived data:
  - posture
  - online / total screens
  - long-offline count
  - active scheduled screens
  - last publish time
- Existing KPI cards, queries, mutations, modals, storage preview, observability sections, and schedule report behavior remain intact.
- No fake metrics, charts, or API calls were introduced.

## Shared Component Changes

- Buttons: improved weight, focus, hover, shadow, and destructive/outline treatment.
- Cards: consistent operational card surface, border, and dashboard-scale titles.
- Badges/status chips: clearer dense status presentation, especially offline/destructive states.
- Inputs: stronger focus and disabled state treatment.
- Tables: bordered card-like containers, clearer headers, and calmer row hover.
- Dialogs: softer overlay, card surface, and close button focus/hover polish.
- Page headers and empty states: more consistent operational surfaces.

## Page-Level Changes

- Login/auth page: redesigned as a serious on-prem operations entry screen.
- Dashboard: redesigned as the primary command-center surface.
- Media, schedule, screens, requests, notifications, chat, settings, reports, layouts, and proof-of-play pages inherit the updated shell, page header, primitive, table, card, badge, dialog, and form styling.

## Player OTP Changes

- Redesign is limited to `darshan-player/src/renderer/index.html`.
- Preserved all IDs used by `pairing.ts`, including:
  - `pairing-screen`
  - `pairing-code`
  - `pairing-expiry`
  - `pairing-refresh`
  - `pairing-complete`
  - `pairing-device-id`
  - `device-label`
  - `device-resolution`
  - `device-model`
  - `diagnostics-list`
  - recovery and connectivity elements
- Improved pairing code size, contrast, installer diagnostics, action hierarchy, and recovery overlay styling.
- No IPC, pairing, storage, realtime, or playback code was changed.

## APIs Verified as Unchanged

No API client files, endpoint paths, request payloads, response contracts, backend routes, database schema, auth/session behavior, or realtime protocol were modified.

## Commands Run

| Command | Result | Notes |
|---|---:|---|
| `cd darshan-cms && npm run build` | Pass | Vite build completed; existing chunk-size/browserslist warnings remain. |
| `cd darshan-cms && npm run lint` | Pass | ESLint completed. |
| `cd darshan-cms && npm run test:unit` | Pass | 17 files, 79 tests passed. |
| `cd darshan-player && npm run build` | Pass | Main and renderer builds completed; assets copied. |
| `cd darshan-player && npm run lint` | Blocked | Existing ESLint v9 config issue: missing `eslint.config.*`. |
| `cd darshan-player && npm run test:unit` | Fail | 234 passing, 12 failing in existing renderer module-loader suites. |
| `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/cli.test.ts --spec test/unit/main/operator-tools.test.ts --spec test/unit/services/player-flow.test.ts --spec test/unit/services/heartbeat.test.ts` | Pass | 37 passing. |

## Runtime Verification

CMS dev server:

- Started with `cd darshan-cms && npm run dev -- --host 127.0.0.1 --port 5173`.
- Login route loaded.
- Existing default local login flow succeeded against the local backend/session.
- Authenticated routes loaded:
  - `/dashboard`
  - `/media`
  - `/schedule`
  - `/layouts`
  - `/screens`
  - `/requests`
  - `/notifications`
  - `/chat`
  - `/settings`
  - `/reports`
  - `/proof-of-play`
- Sidebar collapse was verified.
- Screens page pair-device modal was opened and captured.

Player verification:

- Player build passed.
- Live Electron launch was not used for the final screenshot.
- OTP visual was verified with a DOM-only render of the existing renderer HTML. This is visual verification only; the Electron preload/runtime context is not present in that screenshot.

## Screenshot Index

Screenshots are saved in `docs/design-discovery/after-redesign-screenshots/`.

| File | State |
|---|---|
| `login.png` | Redesigned login/auth screen |
| `dashboard.png` | Authenticated operational dashboard |
| `sidebar-collapsed.png` | Collapsed sidebar state |
| `media-library.png` | Media Library route |
| `schedule-queue.png` | Schedule Queue route |
| `layouts.png` | Layouts route |
| `screens.png` | Screens route with Pairing Health surface |
| `screens-pair-modal.png` | Pair Device modal opened from Screens |
| `requests.png` | Requests/emergency route |
| `notifications.png` | Notifications route |
| `chat.png` | Conversations route |
| `settings.png` | Site Settings route |
| `reports.png` | Reports route |
| `proof-of-play.png` | Proof-of-play route |
| `player-otp-dom-only.png` | DOM-only visual render of player OTP screen |
| `browser-console-after-redesign.log` | Browser console evidence; no secrets observed |

## Known Caveats and Blockers

- Player lint remains blocked by the existing ESLint v9 configuration mismatch.
- Full player unit suite still has 12 existing renderer test failures around `pdf-playback` module resolution and ESM/CommonJS loading; targeted core player tests passed.
- CMS dev console reports `CMS runtime config failed to load` because the local dev server returns HTML where JSON runtime config is expected. The app still loaded and authenticated in this local run.
- DOM-only player OTP screenshot logs missing renderer bundle errors because it is not running inside the packaged Electron preload/runtime context.
- No packaged player runtime smoke was performed in this redesign phase.

## Follow-Up Recommendations

- Add a dedicated visual regression path for the CMS shell and player OTP screen.
- Resolve the player ESLint v9 configuration issue.
- Resolve the renderer module-loader failures in the full player unit suite.
- Provide a valid CMS runtime config file in dev/on-prem QA to eliminate repeated console config errors.
- Run packaged Electron player QA after the visual changes, especially pairing, recovery, fullscreen, and kiosk behavior.
