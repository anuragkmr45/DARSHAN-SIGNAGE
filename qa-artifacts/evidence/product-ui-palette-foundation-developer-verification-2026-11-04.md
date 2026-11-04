# Cream-and-forest CMS foundation: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. The user approved the revised palette for the **whole CMS and player-owned states** after reviewing the representative visual checkpoint on 2026-11-04. This packet implements the CMS foundation and public entry; it does not complete the player or every route.

## Code and behavior

- The shared CMS tokens now use the approved cream canvas, forest sidebar, neutral content panels, stronger input boundary, 12px-or-larger sidebar captions, five single-active accent values, and derived dark tokens. The persisted `emerald` value is labeled **Forest**; new server settings default to it. Existing saved accent choices are preserved.
- A public, no-store `GET /api/v1/settings/public-appearance` returns only site theme, accent, app name and approved branding image URLs. The private settings endpoint still requires an operator session. CMS startup requests the public response without credentials before rendering, applies the site theme/accent, and falls back to cream/Forest if unavailable. It replaces any stale locally stored theme before mounting the theme provider.
- Home, Login and activation use the shared site brand. Authenticated settings updates continue to refresh the shared appearance. The forest sidebar gives logos a neutral backing. A real browser inspection found the old `NavLink` class callback was being rendered as literal text; the fix computes active routes before passing the link to the sidebar wrapper. Inactive, hover and selected link colors are now explicit.
- Uploaded media, authored layouts and player playback surfaces were not modified in this packet.

## Checks passed

- Server `npm run build`; Settings route suite against dedicated `darshan_users_ui_test`: **10/10**, including public response shape, `Cache-Control: no-store`, no-auth read, and `401` on the private appearance endpoint.
- CMS production build and bundle budget: passed; entry JavaScript **214.7 KiB** (68.5 KiB gzip). CMS unit suite: **45 files, 283/283**.
- Browser packet regression: **30/30** across public appearance, Settings, and Screens, including public routes with saved dark/Blue theme, stale-theme fallback, sidebar current route/hover, five accents in two appearances, failed fleet counts, pairing health, permissions, details, deletion blockers and OTP recovery.
- Rendered CSS checks covered 15 token pairs in each light/dark × five-accent combination. The text pairs met 4.5:1 and input boundaries met 3:1. The built local CMS at `https://localhost:18445` showed exact page RGB `(248,248,243)` and forest sidebar RGB `(37,60,50)`, a readable selected Screen link, and no horizontal overflow at 1440px. That local backend is an older build, so its public appearance endpoint was unavailable; startup correctly used the Forest fallback, then the saved authenticated Crimson site accent after login.
- Focused CMS lint: zero errors. Public appearance parsing also rejects credential-bearing and executable branding URLs. Focused server lint: zero errors and two pre-existing `any` warnings in `settings.ts`. `git diff --check`: passed.

## Remaining validation

The public saved-theme browser cases use fixture responses; the local matched-service runtime still has an older backend image. Verify the public endpoint, saved dark mode, logo URLs and a real Settings save together after the candidate server image is deployed. Complete all other CMS routes, player-owned states, Windows/Ubuntu packaged player checks, customer-logo variants, text zoom, screen reader, physical displays, and human QA. No release branch merge or push is implied by this developer evidence.
