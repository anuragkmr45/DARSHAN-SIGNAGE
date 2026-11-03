# Public entry and sign-in: developer verification

Status: redesign-branch developer evidence with fixture-backed browser checks. Real-service sign-in and independent human QA are still required.

## Task and safety contract

- User task: enter the local DARSHAN workspace or understand why sign-in failed.
- Information priority: one Sign In action; then email, password, inline failure and administrator help.
- Primary action: Sign In (or Open Workspace if an identity has already been restored). Secondary action: Back to introduction. Password visibility is a local field control.
- Optional disclosure: none. Failed credentials, rate limiting, and unavailable service remain adjacent to the form.
- Safety retained: cookie-aware login/CSRF handling, safe post-login redirect, invalid runtime configuration boundary, and the server's eight-character password minimum. The UI does not advertise self-service signup, trial, demo, or password reset actions that do not exist.

## Rendered and browser evidence

- `npx playwright test tests/entry-auth.e2e.spec.ts tests/auth-cookie.e2e.spec.ts`: **4/4 passed**, one Chromium worker. The tests cover 390/820/1440 CSS-pixel widths without horizontal overflow, the single entry path, 401 and 429 feedback, preserved fields, password visibility, cookie-only session restore, safe redirect, logout, and invalid runtime configuration.
- A focused rerun after moving Back to introduction beneath the form passed **1/1** and produced the captures below.
- The cookie-session browser suite passed again **2/2** after adding the restored-user Home → Open Workspace journey. Focused ESLint passed for the two pages and their browser tests.
- The lockout message now uses the server-provided `retry_after_seconds` when present, so a multi-minute lockout is not described as “a moment.” Its focused browser case passed **1/1**.
- The CMS production build and bundle-budget gate passed. The unit suite passed **42 files, 271/271**.
- The project TypeScript check reports **126 existing errors**, none in the two changed pages. The command used the installed-compiler override `--ignoreDeprecations 5.0` because the repository config specifies an incompatible value.
- Rendered captures: [Home 390](product-ui-entry/home-390.png), [Home 820](product-ui-entry/home-820.png), [Home 1440](product-ui-entry/home-1440.png), [Sign-in 390](product-ui-entry/sign-in-390.png), [Sign-in 820](product-ui-entry/sign-in-820.png), [Sign-in 1440](product-ui-entry/sign-in-1440.png), [Sign-in dark 390](product-ui-entry/sign-in-dark-390.png).
- The desktop and phone captures were inspected for heading hierarchy, form visibility, action placement, readable error space, and absence of promotional dead ends. The dark phone capture retained readable fields and button contrast.

## Remaining verification

- Sign in against the rebuilt candidate CMS and server with real accounts, including invalid credentials, lockout, an inactive user, cookie restoration, an expired session, and network failure.
- Check mobile keyboard/zoom behavior, keyboard-only focus, both themes and all saved accent presets on the actual deployment, plus nontechnical user comprehension.
- This evidence does not establish production readiness or replace the full cross-route regression.
