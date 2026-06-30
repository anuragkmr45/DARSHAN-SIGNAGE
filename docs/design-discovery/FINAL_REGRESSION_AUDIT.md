# Final Regression Audit

Date: 2026-06-18

## Summary

The redesign diff remains presentation-focused. No backend API files, endpoint definitions, database schema, auth/session handlers, CMS API domain clients, player pairing services, player storage keys, or realtime protocol files were changed.

One small frontend-only fix was added during final QA: CMS runtime config loading now falls back to build-time config when the default `/config/app-config.json` path returns Vite HTML in local dev. Explicit non-JSON runtime config paths still fail clearly.

## Changed Files

| File | Classification | Risk | Notes |
|---|---|---:|---|
| `darshan-cms/src/App.tsx` | Layout/component | Low | App shell classes and spacing only; routes unchanged. |
| `darshan-cms/src/components/common/EmptyState.tsx` | Visual-only | Low | Empty-state surface styling only. |
| `darshan-cms/src/components/common/PageHeader.tsx` | Visual-only | Low | Header shell styling and eyebrow text. |
| `darshan-cms/src/components/dashboard/KPICard.tsx` | Visual-only | Low | Card hierarchy and status cue styling. |
| `darshan-cms/src/components/dashboard/StatusBadge.tsx` | Visual-only | Low | Badge styling only. |
| `darshan-cms/src/components/layout/AppHeader.tsx` | Layout/component | Low | Route-aware title and existing logout/notification actions preserved. |
| `darshan-cms/src/components/layout/AppSidebar.tsx` | Layout/component | Medium | Existing nav items regrouped; route paths, module keys, permissions preserved. |
| `darshan-cms/src/components/ui/badge.tsx` | Visual-only | Low | Class variants only. |
| `darshan-cms/src/components/ui/button.tsx` | Visual-only | Low | Class variants only. |
| `darshan-cms/src/components/ui/card.tsx` | Visual-only | Low | Class variants only. |
| `darshan-cms/src/components/ui/dialog.tsx` | Visual/accessibility | Low | Overlay/content styling and close-button hover/focus style only. |
| `darshan-cms/src/components/ui/input.tsx` | Visual-only | Low | Input border/focus styling only. |
| `darshan-cms/src/components/ui/table.tsx` | Visual-only | Low | Table wrapper/header/row styling only. |
| `darshan-cms/src/config/runtimeConfig.ts` | Frontend config fallback | Medium | Dev-only default path HTML fallback improved; no production config semantics changed for explicit paths. |
| `darshan-cms/src/config/runtimeConfig.test.ts` | Test | Low | Adds fallback regression tests. |
| `darshan-cms/src/index.css` | Theme foundation | Low | CSS variables, shell/card utilities, focus ring and token polish. |
| `darshan-cms/src/pages/Auth.tsx` | Visual-only | Low | Login layout styling only; submit handlers/defaults unchanged. |
| `darshan-cms/src/pages/Dashboard.tsx` | Visual/data presentation | Medium | Uses existing query data only; no new API calls or fake values. |
| `darshan-player/src/renderer/index.html` | Visual-only player OTP | Low | OTP screen HTML/CSS styling only; existing IDs and renderer script hooks preserved. |

## API / Feature Contract Status

- CMS API client files under `darshan-cms/src/api/**`: unchanged.
- Backend endpoints and request/response contracts: unchanged.
- Auth/session behavior: unchanged.
- Route definitions: unchanged.
- Player pairing protocol, IPC, storage keys, certificate handling, realtime behavior, polling/offline fallback: unchanged.
- Media transport remains HTTP/object storage/cache; no socket media transport added.

## Suspicious Changes

No suspicious API/data-contract changes were found. The only state-adjacent change is the CMS runtime config fallback, which is limited to browser config bootstrapping and covered by tests.

## Fixes Applied During Final QA

- Replaced nonstandard Tailwind opacity classes in redesigned CMS files with deterministic values.
- Added safe fallback for local Vite HTML response at the default CMS runtime config path.
- Added two unit tests for that runtime config behavior.

