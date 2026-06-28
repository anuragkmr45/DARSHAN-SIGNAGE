# DARSHAN Component Inventory

Last code-truth refresh: 2026-06-28.

This inventory maps current CMS/player design surfaces from code. Risk reflects redesign risk, not code quality.

Risk legend:

- `Safe visual`: styling/token/spacing changes with stable props and behavior.
- `Moderate`: component has local state, routing, query state, or modal interactions.
- `High`: component controls business workflows, auth, pairing, realtime, uploads, schedules, emergency, destructive actions, evidence, or runtime player behavior.

## Shell And Navigation

| Path | Component / module | Role | Design risk | Notes |
|---|---|---|---|---|
| `darshan-cms/src/components/layout/AppSidebar.tsx` | `AppSidebar` | Primary authenticated navigation | Moderate | Preserve routes/module visibility. |
| `darshan-cms/src/components/layout/AppHeader.tsx` | `AppHeader` | Topbar, user menu, notifications | Moderate | Preserve logout/session and notification behavior. |
| `darshan-cms/src/components/ui/sidebar.tsx` | Sidebar primitives | Sidebar layout/collapse primitives | Safe visual | Keep primitive API stable. |
| `darshan-cms/src/components/common/PageHeader.tsx` | `PageHeader` | Page title/action area | Safe visual | Good design-system primitive. |
| `darshan-cms/src/components/common/PageNavigation.tsx` | `PageNavigation` | Secondary page navigation | Safe visual | Useful for tabs/section navigation. |

## Shared UI Primitives

| Group | Representative files | Role | Design risk |
|---|---|---|---|
| Actions | `button.tsx`, `toggle.tsx`, `toggle-group.tsx` | Buttons/toggles | Safe visual; verify disabled/focus states. |
| Forms | `input.tsx`, `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `slider.tsx`, `label.tsx`, `form.tsx`, `input-otp.tsx` | Inputs/form controls | Safe visual to moderate. |
| Surfaces | `card.tsx`, `dialog.tsx`, `drawer.tsx`, `sheet.tsx`, `popover.tsx`, `alert.tsx`, `alert-dialog.tsx` | Cards/modals/drawers/alerts | Safe visual to moderate. |
| Data | `table.tsx`, `pagination.tsx`, `chart.tsx`, `progress.tsx`, `badge.tsx`, `skeleton.tsx` | Tables, badges, loading, charts | Safe visual. |
| Navigation | `tabs.tsx`, `breadcrumb.tsx`, `dropdown-menu.tsx`, `navigation-menu.tsx`, `menubar.tsx`, `command.tsx`, `tooltip.tsx` | Tabs/menus/tooltips | Safe visual to moderate. |
| Layout | `accordion.tsx`, `collapsible.tsx`, `scroll-area.tsx`, `separator.tsx`, `resizable.tsx`, `aspect-ratio.tsx`, `carousel.tsx` | Layout primitives | Safe visual to moderate. |

## Common Display And Feedback

| Path | Component | Purpose | Risk | Primitive candidate |
|---|---|---|---|---|
| `components/common/StatCard.tsx` | `StatCard` | Generic metric card | Safe visual | Yes |
| `components/dashboard/KPICard.tsx` | `KPICard` | Dashboard KPI | Safe visual | Yes |
| `components/dashboard/StatusBadge.tsx` | `StatusBadge` | Status labels | Safe visual | Yes |
| `components/dashboard/ContentTypeBadge.tsx` | `ContentTypeBadge` | Media/content type labels | Safe visual | Yes |
| `components/common/EmptyState.tsx` | `EmptyState` | Empty state | Safe visual | Yes |
| `components/common/LoadingIndicator.tsx` | `LoadingIndicator` | Inline loading | Safe visual | Yes |
| `components/common/GlobalLoader.tsx` | `GlobalLoader` | App-level loading | Moderate | Yes |
| `components/common/ConfirmDialog.tsx` | `ConfirmDialog` | Confirm destructive/important actions | Moderate | Yes |
| `components/common/SearchBar.tsx` | `SearchBar` | Search input wrapper | Safe visual | Yes |
| `components/common/MediaPreview.tsx` | `MediaPreview` | Media preview surface | Moderate | Yes, but keep rendering logic |

## Feature Components

| Feature area | Representative components | Purpose | Design risk |
|---|---|---|---|
| Dashboard | `ActiveScheduledTimelineModal`, `AllScreensDetailsModal`, `OnlineScreensDetailsModal`, `ScheduleReportModal`, `LiveScreenMirror` | Operational KPI/detail/preview surfaces | Moderate to high; live mirror/content rendering is high. |
| Screens and pairing | `PairingHealthPanel`, `PairDeviceModal`, `ScreenDetailsModal`, `ScreenHealthDashboard`, `ScheduleTimelineGraph`, `BulkActionsBar`, group modals | Fleet health, pairing, screenshots, delivery status, groups, destructive/revoke actions | High |
| Schedule creator/queue | `StepLayoutSelect`, `StepMediaAssign`, `StepScreenSelect`, `StepScheduleDetails`, `StepReview`, request drawers | Multi-step scheduling and approval workflow | High |
| Media/layout authoring | `MediaLibrary` page components, layout editor/frame components | Upload, preview, layout geometry | High |
| Requests/emergency | `KanbanBoard`, `EmergencyTakeoverModal`, request detail/reject drawers | Requests and emergency operations | Moderate to high; emergency is high. |
| Chat | `ConversationList`, `MessageList`, `MessageItem`, `Composer`, `AttachmentPicker`, `ChatStatusBanner`, settings/thread/pins/bookmarks/moderation panels | Real-time collaboration and attachments | Moderate to high. |
| Notifications | notification page/header components/hooks | Inbox and unread state | Moderate |
| Settings/admin | `DefaultMediaSection`, `RolesPermissionsTab`, `AppSettingsBootstrap`, user/operator/department dialogs/cards | Default media, RBAC, settings, admin CRUD | Moderate to high; default media/RBAC high. |
| Reports/PoP | reports and proof-of-play page components | Evidence/reporting/export surfaces | Moderate |
| Integrations | API key, webhook, SSO pages/components | Secret-like and auth-related admin flows | High |

## Player Renderer Components

| Path | Component/module | Purpose | Risk | Notes |
|---|---|---|---|---|
| `darshan-player/src/renderer/index.html` | Renderer DOM/CSS shell | Pairing/recovery/playback/default-media surfaces | Moderate | Visual changes only; no external font/network dependencies. |
| `darshan-player/src/renderer/pairing.ts` | Pairing screen class | OTP, recovery, connectivity/status rendering | High | Preserve IPC actions and status semantics. |
| `darshan-player/src/renderer/player.ts` | Main playback renderer | Schedule/layout media playback and active playback reporting | High | Do not redesign logic as part of visual pass. |
| `darshan-player/src/renderer/default-media-player.ts` | Default media renderer | Fallback media playback | High | Keep default media behavior. |
| `darshan-player/src/renderer/pdf-playback.ts` | PDF playback | PDF rendering | High | Rendering/runtime behavior must be tested on target. |
| `darshan-player/src/renderer/webpage-playback.ts` | Webpage playback | Webpage render/readiness/safety | High | Avoid exposing credentialed URLs in logs. |

## Recommended Design-System Primitives

| Primitive | Purpose |
|---|---|
| `AppShell` | Consistent sidebar/topbar/content layout and responsive behavior. |
| `PageHeader` | Shared title, description, actions, filters, and optional breadcrumbs. |
| `OperationalCard` | Dense metric/status/action card for dashboard and screen details. |
| `StatusBadge` | Shared status vocabulary: online, offline, paired, unpaired, scheduled, warning, danger, emergency. |
| `DataTable` | Unified loading/empty/error/table/action pattern. |
| `ActionDialog` | Consistent destructive/emergency/revoke confirmation. |
| `UploadDropzone` | Media upload progress/validation/error surface. |
| `ScheduleTimeline` | Schedule preview/timeline pattern for screen and schedule pages. |
| `DeviceHealthPanel` | Pairing/heartbeat/realtime/default-media diagnostic panel. |
| `PlayerPairingScreen` | Full-screen OTP/recovery design implemented without IPC changes. |

## Redesign Guardrails

- Keep primitive props compatible.
- Keep route paths and guards unchanged.
- Keep player IPC channels unchanged.
- Keep media/schedule/pairing/default-media/emergency behavior untouched.
- Treat screenshots as evidence labels, not as current truth unless recaptured.
