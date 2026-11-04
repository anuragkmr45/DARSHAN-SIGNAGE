# CMS exceptional states: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This packet only changes visual presentation for the existing production inspection lock and invalid runtime configuration. It does not change the lock trigger, authentication, API behavior, or runtime configuration.

- CMS `npm run build` and bundle budget passed after the change. Focused ESLint on touched files passed.
- `auth-cookie.e2e.spec.ts` invalid-runtime-config case passed **1/1**: login remained blocked before API access and the operator guidance remained visible.
- The default local `.env` has `VITE_ENABLE_PRODUCTION_LOCKDOWN=false`, so a temporary local build set that build flag to `true` for visual verification. With a localhost-only runtime fixture and no operator credentials, Chromium opened Login, pressed F12, and rendered the real lock. The panel was RGB `(255,255,255)` on a page RGB `(248,248,243)` with no document horizontal overflow at 1280×800. [Rendered lock evidence](product-ui-cream-forest-checkpoint/production-lock-1280.png) was inspected. The standard build was restored afterward without editing `.env`.

Real production policy review, assistive-technology checks, and mobile viewport inspection remain open. The screenshot uses only local fixture data.
