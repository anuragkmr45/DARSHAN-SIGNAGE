# Final Route QA

Date: 2026-06-18

## Environment

- CMS dev server: `http://127.0.0.1:5173`
- Backend health: `http://127.0.0.1:3000/api/v1/health` returned `{"status":"ok"}`
- Browser automation: Playwright MCP

## Results

| Route / Scenario | Status | Screenshot | Notes |
|---|---:|---|---|
| Public landing `/` | Passed | `final-qa-screenshots/login.png` | Existing landing page still renders. Not part of redesign scope. |
| Login `/login` | Passed visually | `final-qa-screenshots/auth-login.png` | Redesigned login renders. |
| Keyboard focus on login | Passed | `final-qa-screenshots/login-keyboard-focus.png` | Focus ring visible on reachable controls. |
| Protected route redirect `/dashboard` unauthenticated | Passed | `final-qa-screenshots/protected-route-login-redirect.png` | Redirected to `/login?redirect=%2Fdashboard`. |
| Authenticated login submit | Blocked | N/A | Backend returned `401 Unauthorized` with toast `Invalid token`. |
| Authenticated dashboard | Blocked in final pass | Prior: `after-redesign-screenshots/dashboard.png` | Final pass could not authenticate. Prior redesign verification loaded it successfully. |
| Media route | Blocked in final pass | Prior: `after-redesign-screenshots/media-library.png` | Auth blocked final live route pass. |
| Schedule route | Blocked in final pass | Prior: `after-redesign-screenshots/schedule-queue.png` | Auth blocked final live route pass. |
| Layouts route | Blocked in final pass | Prior: `after-redesign-screenshots/layouts.png` | Auth blocked final live route pass. |
| Screens route and Pair Device modal | Blocked in final pass | Prior: `after-redesign-screenshots/screens.png`, `screens-pair-modal.png` | Auth blocked final live route pass. |
| Requests, notifications, chat, settings, reports, proof-of-play | Blocked in final pass | Prior screenshots available | Auth blocked final live route pass. |

## Console Findings

- Clean CMS login tab: 0 errors, 2 React Router future warnings.
- Auth submit: backend request returned `401 Unauthorized`.
- The previous CMS runtime config JSON parse error did not reproduce after the fallback fix.

