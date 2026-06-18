# DARSHAN Redesign QA Checklist

## Automated Checks

| Check | Status | Notes |
|---|---:|---|
| CMS build | Passed | `npm run build` completed. |
| CMS lint | Passed | `npm run lint` completed. |
| CMS unit tests | Passed | Final pass `npm run test:unit`: 17 files, 81 tests. |
| CMS runtime config targeted tests | Passed | Final pass `npm run test:unit -- --run src/config/runtimeConfig.test.ts`: 8 tests. |
| Player build | Passed | `npm run build` completed. |
| Player targeted CLI/operator/player-flow/heartbeat tests | Passed | 37 tests passed. |
| Player lint | Blocked | Existing ESLint v9 config issue: no `eslint.config.*`. |
| Player full unit suite | Failed | 234 passing, 12 existing renderer module-loader failures. |

## CMS Manual Browser Checks

| Scenario | Status | Evidence |
|---|---:|---|
| Login page renders | Passed | `after-redesign-screenshots/login.png` |
| Login succeeds with existing local flow | Blocked in final pass | Earlier redesign pass succeeded. Final pass backend returned `401 Unauthorized` / `Invalid token`. |
| Dashboard renders | Passed | `after-redesign-screenshots/dashboard.png` |
| Sidebar navigation renders grouped sections | Passed | Captured across authenticated route screenshots. |
| Sidebar collapse works | Passed | `after-redesign-screenshots/sidebar-collapsed.png` |
| Media page renders | Passed | `after-redesign-screenshots/media-library.png` |
| Schedule page renders | Passed | `after-redesign-screenshots/schedule-queue.png` |
| Layouts page renders | Passed | `after-redesign-screenshots/layouts.png` |
| Screens page renders | Passed | `after-redesign-screenshots/screens.png` |
| Pair-device modal opens | Passed | `after-redesign-screenshots/screens-pair-modal.png` |
| Requests/emergency route renders | Passed | `after-redesign-screenshots/requests.png` |
| Notifications route renders | Passed | `after-redesign-screenshots/notifications.png` |
| Chat/conversations route renders | Passed | `after-redesign-screenshots/chat.png` |
| Settings route renders | Passed | `after-redesign-screenshots/settings.png` |
| Reports route renders | Passed | `after-redesign-screenshots/reports.png` |
| Proof-of-play route renders | Passed | `after-redesign-screenshots/proof-of-play.png` |
| CMS APIs unchanged | Passed by inspection | No API files or endpoint contracts were modified. |
| Protected route redirect | Passed | Final pass `/dashboard` redirected to `/login?redirect=%2Fdashboard`. |
| Runtime config dev fallback | Passed | Final pass clean CMS tab had 0 errors; Vite HTML fallback no longer logs JSON parse error. |

## Player Manual Checks

| Scenario | Status | Evidence |
|---|---:|---|
| OTP screen visual renders | Passed, DOM-only | `after-redesign-screenshots/player-otp-dom-only.png` |
| Pairing IPC/runtime behavior unchanged | Passed by inspection/build | Only `src/renderer/index.html` changed in player. |
| Live Electron launch | Blocked | Final pass `npm run start:dev` failed before window creation: `electron.app` undefined at `requestSingleInstanceLock()`. |
| Kiosk/fullscreen behavior | Not run | No main-process player behavior changed. |

## Accessibility and Responsive Checks

| Check | Status | Notes |
|---|---:|---|
| Text contrast on primary CMS surfaces | Passed by visual review | Dark plum uses white text; cards use dark foreground. |
| Focus rings | Passed by implementation | Theme ring and primitive focus styles updated. |
| Button target sizing | Passed by implementation | Existing button sizes preserved; focus/hover improved. |
| Sidebar collapsed state | Passed | Captured in browser. |
| Tables remain horizontally scrollable | Passed by implementation | Table wrapper still uses `overflow-x-auto`. |
| OTP readability from distance | Passed visually | Larger monospaced pairing code, high-contrast card. |
| Mobile/narrow CMS layout | Partially checked | Responsive classes preserved; full mobile route audit not run. |

## Blocked or Deferred Checks

- Packaged Electron runtime smoke.
- Real player pairing/recovery visual QA inside Electron.
- Full player unit suite due existing renderer module-loader failures.
- Player lint due existing ESLint v9 flat-config migration issue.
- Authenticated CMS route QA in final pass blocked by current backend auth returning `401 Unauthorized`.
- Live Electron OTP verification blocked by dev launch failure before window creation.

## Manual Follow-Up Before Release

- Run packaged player and verify OTP, pairing, recovery, fullscreen, and kiosk behavior.
- Re-run CMS authenticated browser QA with a valid backend user/session.
- Fix or triage the live Electron launch issue before claiming live OTP verification.
- Confirm no visual regressions on the media upload, schedule creation, default media, emergency request, and screen pairing workflows with production-like data.
- Resolve or formally triage player lint and renderer unit failures.
