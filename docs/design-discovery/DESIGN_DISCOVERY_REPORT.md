# DARSHAN Design Discovery Report

Last code-truth refresh: 2026-06-28.

This report is a design-discovery view of the current DARSHAN codebase. Code is the source of truth; screenshots and older reports are supporting evidence only. This refresh does not claim new runtime/browser/player evidence.

## Executive Summary

DARSHAN is an operational digital signage platform with a large React CMS, Fastify backend, and Electron player. The design system must preserve high-risk operational flows: pairing, scheduling, default media, emergency takeover, proof-of-play, screenshot capture, chat/notifications, and runtime diagnostics.

The current product shape is documented in:

- `docs/architecture/product-architecture.md`
- `docs/contracts/README.md`
- `docs/contracts/backend-api-contracts.md`
- `docs/contracts/cms-feature-contracts.md`
- `docs/contracts/player-runtime-contracts.md`
- `docs/contracts/realtime-command-contracts.md`

Design work should remain dashboard-first and operational. It must not change backend APIs, auth/session semantics, player pairing, realtime architecture, media transport, command lifecycle, or deployment config behavior.

## Repo And Stack Map

| Area | Folder | Stack / source of truth | Design relevance |
|---|---|---|---|
| Backend | `darshan-server` | Fastify, TypeScript, Drizzle/Postgres, MinIO/S3, pg-boss, Socket.IO, Valkey, Prometheus metrics | Defines REST contracts, realtime notification boundaries, player truth, media/default/schedule state. |
| CMS | `darshan-cms` | React 18, Vite, TypeScript, Tailwind, Radix/shadcn primitives, Redux Toolkit, TanStack Query, React Router, Socket.IO client | Main design surface. Routes are in `src/App.tsx`; API domains are in `src/api/domains/*`. |
| Player | `darshan-player` | Electron 33, TypeScript main/preload/renderer, axios/ws, local cache/state, PDF/webpage playback helpers | OTP/pairing and playback/recovery states require installer-friendly full-screen design. |
| Deploy/config | `deploy`, `docs`, `scripts` | Docker production roles, config examples, runbooks, observability assets | Design docs must not imply runtime evidence or production readiness. |

## Code Sources Audited

| Slice | Primary files |
|---|---|
| Backend/API | `darshan-server/src/server/index.ts`, `src/config/apiEndpoints.ts`, `src/routes/*`, `src/db/schema.ts`, `src/services/*`, `src/jobs/*`, `src/realtime/*`, `src/config/*` |
| CMS | `darshan-cms/src/App.tsx`, `src/api/domains/*`, `src/components/*`, `src/pages/*`, `src/config/runtimeConfig.ts`, `src/lib/*Socket.ts`, `src/hooks/*` |
| Player | `darshan-player/src/main/index.ts`, `src/preload/index.ts`, `src/common/*`, `src/main/services/*`, `src/renderer/*`, `src/main/cli.ts` |
| Contracts | `docs/contracts/*`, `docs/architecture/product-architecture.md` |

## Current Product Surfaces

| Surface | Current capabilities from code | Design risk |
|---|---|---|
| Dashboard | Metrics, health, observability, fleet/media/request summaries, operational panels | Moderate: data is multi-source and degrades independently. |
| Media | Upload/presign/complete, webpage media, list/filter/preview/delete dependency handling | High: upload/delete contracts must not change. |
| Layouts | Layout list and editor, presentation/layout references | High: geometry and schedule composition risk. |
| Schedule | Queue, schedule creator, reservations, publish/takedown, target selection | High: multi-step workflow and mutations. |
| Screens | Fleet overview, groups, pairing health, screen details, screenshot, delivery/cache reports, delete/revoke actions | High: operational and destructive actions. |
| Settings/default media | General/branding/security/appearance, backups/logs, RBAC, default media variants/targets | High: default media affects player playback. |
| Requests/emergency | Request workboard, emergency trigger/status/clear/history | High: emergency safety. |
| Chat/notifications | REST plus browser realtime updates | High: realtime user interaction but REST remains source of truth. |
| Reports/PoP/audit | Reports, audit exports, proof-of-play list/export | Moderate: evidence and compliance surfaces. |
| Admin integrations | API keys, webhooks, SSO config | High for secret-like one-time displays and auth config. |
| Player OTP/runtime | Pairing, recovery, backend validation, diagnostics, playback status, offline/security states | High: preserve IPC and runtime state. |

## UX Audit

| Area | Current finding | Design direction |
|---|---|---|
| Information architecture | Sidebar exposes most product domains at equal weight. | Group around operator workflows: Operate, Create, Communicate, Govern, Admin. Preserve routes and permissions. |
| Dashboard hierarchy | Operational data exists but competing panels can feel equal. | Prioritize fleet health, playback state, pairing/default-media/realtime warnings, recent evidence. No fake numbers/charts. |
| Status visibility | Screens, pairing, emergency, cache/delivery, observability all matter but use varied UI patterns. | Standardize status badge semantics and severity hierarchy. |
| Tables/lists | Many pages use tables/cards with page-local density and action placement. | Standardize table/list density, empty/loading/error states, row actions, destructive confirmation language. |
| Forms/dialogs | shadcn/Radix primitives are a good base, but dialog hierarchy varies. | Keep primitive APIs stable; improve title/body/action hierarchy and focus states. |
| Emergency/destructive actions | Emergency and delete/revoke actions must stay visually distinct. | Use separate danger/emergency colors and confirmation patterns. Do not make emergency look like normal primary CTA. |
| Player OTP | Renderer has full-screen pairing/recovery states but must remain readable from distance. | Improve code readability, backend/environment status, troubleshooting, and recovery copy without changing IPC. |

## Palette Strategy

Use the requested palette as a warm enterprise system, not as status colors:

| Token role | Recommendation |
|---|---|
| `#604652` | Deep brand/sidebar/top-level navigation/accent text. Safe with light text. |
| `#735557` | Secondary brand hover/active surfaces and subdued controls. |
| `#97866A` | Warm operational accent and scheduled/neutral metadata, with contrast checks. |
| `#D29F80` | Warm CTA/highlight/pairing emphasis. Use with dark text, not small white text. |

Supporting neutrals remain required: warm off-white app background, white cards, subtle warm borders, strong dark text, muted text, and visible focus rings.

Status colors must stay semantic and accessible:

- success/online/paired: green or teal
- warning/recovery: amber
- danger/delete/error: red
- emergency: high-contrast red treatment distinct from normal danger
- offline/unknown: neutral gray
- info/scheduled: blue or neutral/taupe where contrast is sufficient

## Runtime Evidence Status

| Evidence | Status |
|---|---|
| Existing screenshots | Historical evidence only; see `SCREENSHOT_INDEX.md`. |
| After-redesign screenshots | Existing local evidence from prior redesign pass; not recaptured in this refresh. |
| Final QA screenshots | Existing final QA artifacts; not recaptured in this refresh. |
| Player OTP | DOM-only screenshots exist; live Electron/package evidence still needs runtime verification. |
| Production readiness | Not claimed. Runtime/browser/package/on-prem evidence remains separate. |

## Known Blockers / Caveats

- Direct production/browser runtime behavior cannot be proven by docs.
- Existing screenshots may be stale after source changes and must be recaptured before another design implementation.
- Player media rendering, screenshot capture, secure offline lock, autostart, and restart/resume require target hardware tests.
- Docker VM deployment health, Socket.IO proxying, Valkey outage fallback, and observability scrapes require runtime evidence.
- Design discovery should use `docs/contracts/**` for current API/player/deployment contracts instead of copying large payload examples.
