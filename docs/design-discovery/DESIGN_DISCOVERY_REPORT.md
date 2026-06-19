# DARSHAN Design Discovery Report

## Executive Summary

DARSHAN is a substantial operational digital signage CMS plus Electron player. The CMS already has broad functionality: dashboard, media library, layouts, screen pairing/health, schedule queue and wizard, requests, chat, notifications, settings/default media, reports, proof-of-play, users/operators/departments, API keys, webhooks, and SSO.

The redesign should not be treated as a marketing refresh. This is an operations console. The highest-value direction is a calm, dense, dashboard-first interface that lets admins answer: what is playing, which screens need attention, what changed recently, what is scheduled next, and whether pairing/realtime/default media health is safe.

The current UI uses a dark maroon sidebar, white cards, Tailwind/shadcn primitives, lucide icons, and many page-local layouts. The component foundation is workable, but hierarchy and consistency vary by page. Future redesign should start with tokens and shell structure, then standardize cards, tables, badges, modals, forms, and screen health indicators before page-by-page polish.

## Repo and Stack Map

| Area | Folder | Stack | Notes |
|---|---|---|---|
| CMS/frontend | `darshan-cms` | React 18, Vite, TypeScript, Tailwind, Radix/shadcn-style components, Redux Toolkit, redux-persist, TanStack Query, React Router, lucide, socket.io-client, Sonner/toast | Main redesign target. Routes live in `src/App.tsx`; API layer in `src/api/**`. |
| Electron player | `darshan-player` | Electron 33, TypeScript, renderer HTML/TS, axios, electron-log/electron-store, pdfjs, MinIO client, ws | OTP/pairing screen target. Runtime behavior must remain unchanged. |
| Backend | `darshan-server` | Fastify, TypeScript, Drizzle/Postgres, Socket.IO, pg-boss/outbox, MinIO/S3, prom-client, ffmpeg/libreoffice integration | Source of truth. Redesign must not change backend behavior. |
| Deployment/docs | `deploy`, `docs`, `scripts` | Docker/on-prem profiles, runbooks, config evidence | Used for local runtime discovery only. |

## Scripts and Commands

CMS:
- `npm run dev` - Vite dev server, configured for port 8080 by default.
- `npm run build` - production build.
- `npm run lint` - ESLint.
- `npm run test:unit` - Vitest.
- `npm run preview` - Vite preview.

Player:
- `npm run build` - main + renderer build.
- `npm run start:dev` - prepare and launch Electron in development.
- `npm run pairing-status`, `npm run doctor`, `npm run reset-pairing`, `npm run clear-cache` - operator CLI.
- `npm run package:*` - Electron packages.
- `npm run test:unit`, `npm run test:integration`, `npm run test:default-media`.

Backend:
- `npm run dev`, `npm run dev:watch`.
- `npm run build`, `npm run start`, `npm run start:api`, `npm run start:worker`.
- `npm run seed`, `npm run doctor:runtime`, `npm run reset:data`.
- Targeted route tests through Vitest.

## Environment Surface

Only variable names were recorded. Secret values were not written to reports.

Key CMS variables:
- `VITE_API_BASE_URL`
- `VITE_WS_BASE_URL`
- `VITE_WS_URL`
- `VITE_CMS_ENVIRONMENT_NAME`
- `VITE_CMS_DEPLOYMENT_ID`
- `VITE_CMS_ID`
- `VITE_CMS_RUNTIME_CONFIG_PATH`

Key backend variables:
- Auth/session: `JWT_SECRET`, `JWT_EXPIRY`, `CSRF_ENABLED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- Database/storage: `DATABASE_URL`, `POSTGRES_*`, `MINIO_*`
- Runtime dependencies: `FFMPEG_PATH`, `LIBREOFFICE_PATH`, `PG_DUMP_PATH`, `TAR_PATH`
- Realtime/outbox: `REALTIME_SYNC_ENABLED`, `DARSHAN_REALTIME_SYNC_ENABLED`, `OUTBOX_DISPATCH_ENABLED`, `COMMAND_OUTBOX_WRITE_ENABLED`, `DEVICE_DESIRED_STATE_ENABLED`, `REALTIME_BUS_PROVIDER`, `VALKEY_*`, `REALTIME_*`
- Pairing/identity: `DEVICE_AUTH_MODE`, `DUPLICATE_IDENTITY_*`, `DEVICE_SESSION_*`, `SIGNHEX_ENVIRONMENT_NAME`, `SIGNHEX_DEPLOYMENT_ID`, `SIGNHEX_SERVER_ID`
- Observability: `OBSERVABILITY_*`

Key player variables are managed in `darshan-player/src/common/config.ts` and include API/ws base URLs, environment labels, realtime flags, polling intervals, offline validation grace, cache paths, logs, pairing, mTLS/cert paths, and diagnostics. Device identity, certs, tokens, pairing state, caches, and request queues are runtime state, not design config.

## Run Results

| Check | Result | Notes |
|---|---|---|
| Backend health | Passed | `http://192.168.0.7:3000/api/v1/health` returned OK. |
| CMS nginx route | Blocked for direct routes | `http://192.168.0.7:8080/login?redirect=%2F` returned nginx 404. |
| CMS Vite dev | Passed | Launched with `VITE_API_BASE_URL=http://192.168.0.7:3000 VITE_WS_BASE_URL=http://192.168.0.7:3000 npm run dev -- --host 127.0.0.1 --port 5173`. |
| CMS login | Passed | Authenticated with local backend. Credentials were not printed. |
| CMS screenshots | Passed | Authenticated screenshots captured for major pages and selected modals/states. |
| Player screenshot | Partial | Static renderer pairing screen captured with DOM-only state injection. No live Electron runtime capture. |
| CMS build | Passed | `npm run build`; Vite warned about large bundle and stale browsers data. |
| CMS lint | Passed | `npm run lint`. |
| Player build | Passed | `npm run build`; generated renderer assets copied. |

## Screenshots

See `docs/design-discovery/SCREENSHOT_INDEX.md` for the complete screenshot list and evidence notes.

## Current UX Audit

### Information Architecture

The app exposes almost every major feature as a primary sidebar item. This is complete but not very task-oriented. Dashboard, Media, Layouts, Screens, Schedule, Conversations, Notifications, Operators, Departments, Users, Reports, and Settings all sit at the same hierarchy level. For operators, the likely daily tasks are screens health, media readiness, schedule state, requests, default media, and emergency action; admin-only areas should feel secondary.

Recommendation: group sidebar sections by workflow:
- Operate: Dashboard, Screens, Schedule Queue, Emergency/Requests.
- Create: Media Library, Layouts, Schedule Creator.
- Communicate: Conversations, Notifications.
- Govern: Reports & Logs, Proof of Play.
- Admin: Users, Operators, Departments, Settings, API Keys, Webhooks, SSO.

### Visual Hierarchy

The dashboard currently shows KPI cards first, then observability, pending requests, and system health. This is a good base, but all cards have similar weight. Operational warnings such as unavailable Prometheus, offline screens, pairing health, and emergency state need clearer severity.

The sidebar is visually dominant because of the deep maroon block. It communicates brand, but it overpowers page content and creates a one-note theme. The redesign should keep a strong sidebar but make the main surface quieter and more structured.

### Navigation and Header

The disabled global search field occupies high-value header space. If search is unavailable, use a compact disabled affordance or remove it until functional. Header notification and profile controls are clear, but the topbar does not expose environment/deployment identity even though that matters for on-prem diagnosis.

### Component Consistency

The primitive layer is consistent, but page composition varies:
- Dashboard cards, report cards, media cards, screen cards, and settings cards use similar containers but different density and heading rules.
- Empty states are not always action-oriented.
- Tables/lists have inconsistent density and action placement.
- Modal dialogs vary in hierarchy and button emphasis.

### Color and Token Problems

Current colors are maroon-heavy, with gradients and shadows. Status colors exist as tokens, which is good. The redesign should use the requested palette semantically and add a full neutral scale. Do not use brand colors for all statuses.

### Typography, Spacing, Radius, Shadows

Current typography is readable but sometimes oversized for operational panels. Cards use generous white space that reduces density on dashboard and screens. Radius is generally `0.625rem`; future cards should stay restrained at 8px or less unless primitives already require otherwise. Shadows should be quieter for dashboard/data surfaces.

### Accessibility

Positive:
- Many controls use Radix primitives.
- Password visibility button has aria-label.
- Sidebar buttons have tooltips when collapsed.

Risks:
- Sidebar active indicator is a thin vertical bar plus color; collapsed state needs keyboard/focus verification.
- Some pages lack clear `h1` evidence in screenshot, especially Notifications and Chat.
- Disabled global search may confuse screen reader users because it is visually prominent but unavailable.
- Palette `#735557` and `#97866A` need contrast checks before use as text.
- Player OTP letter spacing is large; it is readable on a large screen but may be harder to copy accurately at smaller widths.

### Responsiveness

The shell uses responsive padding and sidebar primitives. Captures were desktop only. Schedule creator, screens grids, settings tabs, and chat panes need tablet/narrow QA after redesign.

### Loading, Empty, Error States

The app has loading indicators, skeletons, empty states, and toasts. The main improvement is content quality and consistency: empty states should name the next step, errors should say what operator can do, and loading should avoid moving core layouts.

## Palette Strategy

Requested palette:
- `#604652` - deep plum
- `#735557` - muted plum/brown
- `#97866A` - warm taupe
- `#D29F80` - warm sand/copper

Theme direction:
- Premium
- Calm
- Operational
- Warm enterprise
- Dashboard-first

Semantic mapping:

| Semantic Role | Recommended Color |
|---|---|
| App background | `#F8F6F3` or neutral warm off-white |
| Main surface/card | `#FFFFFF` |
| Elevated surface | `#FFFDFC` |
| Sidebar background | `#604652` |
| Sidebar active item | `#D29F80` accent rail with light text surface |
| Sidebar hover | `#735557` |
| Topbar | White or very light neutral with plum text |
| Primary action | `#604652` for serious admin actions; `#D29F80` for constructive CTA accents |
| Secondary action | White/neutral with `#735557` border/text |
| Borders | Warm neutral `#E5DDD5` |
| Muted surface | `#F1ECE7` |
| Text primary | `#211A1D` |
| Text secondary | `#6E6264` |
| Scheduled state | `#97866A` with accessible dark text |
| Emergency state | Separate red, not brand palette |
| Online/success | Separate green |
| Offline | Neutral gray/slate |
| Warning | Amber |
| Danger/delete | Red |
| Paired | Green/teal |
| Unpaired/recovery | Amber/red depending severity |

Supporting neutral scale:
- Background: `#F8F6F3`
- Surface: `#FFFFFF`
- Elevated: `#FFFDFC`
- Muted: `#F1ECE7`
- Border: `#E5DDD5`
- Muted text: `#6E6264`
- Primary text: `#211A1D`

Status colors:
- Success/online: `#16805A`
- Warning: `#B7791F`
- Danger/emergency: `#C2413B`
- Info: `#2563A8`
- Offline: `#687076`

Contrast risks:
- `#D29F80` is too light for small white text. Use it as background/accent with dark text or as icon/accent on white.
- `#97866A` should not be used for small muted text on light surfaces without contrast testing.
- `#735557` can work for text on white, but should be tested for smaller labels.
- `#604652` is safe for white text and strong sidebar surfaces.

Light theme should be first. Dark theme can stay optional because the current app has `.dark` tokens, but the operational QA burden is higher.

## Recommended CMS Redesign Direction

### Home/Dashboard Structure

Recommended dashboard sections:
1. Fleet health strip: total screens, online, offline, pairing issues, emergency state.
2. Playback status: active schedules now, next publish, no-content screens, default media fallback.
3. Operational warnings: Pairing Health, orphan/duplicate identities, environment mismatch, unreachable observability.
4. Media readiness: processing failed, storage, missing/default media.
5. Recent activity: proof-of-play, audit logs, recent admin actions.
6. Requests requiring attention: pending approvals, rejected/pending emergency.

### Sidebar

Use grouped navigation with lucide icons:
- Operate
- Create
- Communicate
- Govern
- Admin

Keep collapse support. Use icon tooltips. Active state should combine background, accent rail, text weight, and icon color. Avoid tiny text-only cues.

### Page Shell

Every page should use:
- Page title and concise subtitle.
- Primary action area at top right.
- Filter/search row below header when needed.
- Content region with consistent grid/table spacing.
- Page-level loading/error/empty pattern.

### Components

- Cards: use 8px radius or less; keep dashboard cards dense.
- Tables: consistent row height, status badges, actions aligned right.
- Badges: shared status palette, not page-local colors.
- Buttons: primary, secondary, destructive, ghost, icon-only with tooltips.
- Modals: title, risk explanation, primary/secondary actions, destructive color only for destructive actions.
- Forms: labels above fields, helper/error text, clear required state.
- Upload zones: clear supported types, size limits, progress, and retry.
- Schedule/timeline: make time windows, conflicts, and target counts visually explicit.
- Device health: show last seen, pairing status, environment, content state, current/next schedule.
- Emergency: use a distinct red emergency pattern, confirmation, and active banner.

### Player OTP Screen

Recommended redesign:
- Replace purple gradient with brand-aligned full-screen layout using `#604652` and warm neutral surfaces.
- Make pairing code the dominant element, with grouped digits and high contrast.
- Show backend/environment/deployment identity if already available in status/diagnostics.
- Keep device label/resolution/model, but move them into a compact diagnostics strip.
- Add clear status states: waiting for admin, confirmed, provisioning, offline/retrying, recovery required.
- Keep reset/re-pair affordance only where it already exists in behavior.
- Do not change IPC action names or pairing flow.

## Future Implementation Batches

| Batch | Likely Files | Outcome | Risk | Verification |
|---|---|---|---|---|
| 1. Theme foundation | `darshan-cms/src/index.css`, Tailwind tokens, shared status helpers | New palette, neutral scale, status colors | Low to moderate | Visual smoke, contrast checks, build/lint. |
| 2. Shell/sidebar/topbar | `AppSidebar`, `AppHeader`, sidebar primitives | Grouped navigation, better header, environment identity if already available | Moderate | Login, route navigation, collapsed sidebar, permissions. |
| 3. Dashboard/home | `Dashboard`, dashboard components | Operational dashboard hierarchy | Moderate | Dashboard data states, empty/error, exports/actions unaffected. |
| 4. Shared components | common/ui wrappers | Unified cards, buttons, tables, badges, forms, dialogs | Moderate | All major pages, keyboard/focus, responsive. |
| 5. Page polish | Media, Schedule, Screens, Settings, Reports, Chat, Requests | Consistent page-level UX | Moderate to high | Page-specific flows, API mutations, upload/schedule/pairing/default media. |
| 6. Player OTP | `renderer/index.html`, pairing styles, possibly renderer pairing text only | New pairing/recovery visual hierarchy | High | Electron launch, pairing flow, recovery/offline states, CLI unchanged. |
| 7. QA/accessibility | Test/playwright docs and manual checklist | Regression confidence | Low | Build/lint/tests, desktop/tablet/mobile, keyboard, contrast. |

## Verification Checklist for Redesign Phase

Commands:
- `cd darshan-cms && npm run build`
- `cd darshan-cms && npm run lint`
- `cd darshan-player && npm run build`
- Run targeted CMS unit/e2e tests if touched.
- Run player unit tests if player renderer or pairing state is touched.

Manual CMS scenarios:
- Login.
- Navigate every sidebar item.
- Dashboard loads and errors are readable.
- Media upload/list/delete still works.
- Layout create/edit opens.
- Schedule creator all steps still work.
- Screens list, Pair Device modal, Pairing Health, revoke dialog still work.
- Settings Default Media assignment still works.
- Emergency/takeover controls remain unchanged.
- Notifications/chat still render and realtime indicators still work.

Manual player scenarios:
- OTP screen loads.
- Pairing code readable at screen distance.
- Refresh/provision buttons still call existing IPC.
- Recovery and offline banners render.
- Reset/re-pair affordance only where behavior already supports it.

Responsive and accessibility:
- Desktop 1440px.
- Laptop 1280px.
- Tablet 768px.
- Narrow/mobile only if CMS claims support.
- Keyboard navigation and focus visible.
- Contrast for every status and primary action.
- OTP code readable and not clipped.

## Blockers and Non-Design Findings

- CMS nginx SPA fallback is not configured for direct routes. This should be fixed in deployment config, not design implementation.
- Vite dev runtime config path returned HTML fallback for `/config/app-config.json`. This should be handled by local runtime config setup if runtime config screenshots are needed.
- Live Electron player was not launched during discovery; player pairing screenshot is DOM-only visual evidence.
- Emergency takeover modal was not captured during this pass because the captured Requests page exposed a disabled emergency button and no modal opened.
