# DARSHAN Component Inventory

This inventory covers reusable CMS components and the player pairing renderer. Risk reflects redesign risk, not code quality.

Risk legend:
- `Safe visual`: presentation-only or primitive styling change.
- `Moderate`: visual component with local state, query state, or routing implications.
- `High`: controls business workflow, permissions, destructive action, upload, pairing, realtime, schedule, or recovery.

## Layout and Navigation

| Path | Component | Used By | Visual Role | Current Style | Redesign Risk | Primitive Candidate |
|---|---|---|---|---|---|---|
| `darshan-cms/src/components/layout/AppSidebar.tsx` | `AppSidebar` | Authenticated shell | Navigation/sidebar | Tailwind + shadcn sidebar + lucide icons | Moderate | Yes, app shell navigation |
| `darshan-cms/src/components/layout/AppHeader.tsx` | `AppHeader` | Authenticated shell | Topbar, notifications, user menu | Tailwind + Radix dropdown/avatar | Moderate | Yes, topbar |
| `darshan-cms/src/components/ui/sidebar.tsx` | `Sidebar*` | Shell/sidebar | Sidebar primitive | shadcn/Radix-style Tailwind | Safe visual | Yes |
| `darshan-cms/src/components/common/PageHeader.tsx` | `PageHeader` | Screens and pages | Page title/actions | Tailwind | Safe visual | Yes |
| `darshan-cms/src/components/common/PageNavigation.tsx` | `PageNavigation` | Multi-page flows | Secondary navigation | Tailwind | Safe visual | Yes |

## Common Feedback and Display

| Path | Component | Purpose | Current Style | Redesign Risk | Primitive Candidate |
|---|---|---|---|---|---|
| `darshan-cms/src/components/common/StatCard.tsx` | `StatCard` | Generic stat display | Card + icon + text | Safe visual | Yes |
| `darshan-cms/src/components/dashboard/KPICard.tsx` | `KPICard` | Dashboard KPI cards | Card wrapper, status accenting | Safe visual | Yes |
| `darshan-cms/src/components/dashboard/StatusBadge.tsx` | `StatusBadge` | Dashboard status labels | Badge styles | Safe visual | Yes |
| `darshan-cms/src/components/dashboard/ContentTypeBadge.tsx` | `ContentTypeBadge` | Media/content type labels | Badge + icon | Safe visual | Yes |
| `darshan-cms/src/components/common/EmptyState.tsx` | `EmptyState` | Empty list/page state | Tailwind text/icon | Safe visual | Yes |
| `darshan-cms/src/components/common/LoadingIndicator.tsx` | `LoadingIndicator` | Inline loading | Tailwind | Safe visual | Yes |
| `darshan-cms/src/components/common/GlobalLoader.tsx` | `GlobalLoader` | Global pending state | App-level overlay/indicator | Moderate | Yes |
| `darshan-cms/src/components/common/ConfirmDialog.tsx` | `ConfirmDialog` | Confirm destructive/important actions | Dialog primitive wrapper | Moderate | Yes |
| `darshan-cms/src/components/common/SearchBar.tsx` | `SearchBar` | Search field wrapper | Input + icon | Safe visual | Yes |
| `darshan-cms/src/components/common/MediaPreview.tsx` | `MediaPreview` | Media preview surface | Conditional media rendering | Moderate | Yes, but keep content logic |

## UI Primitives

The `darshan-cms/src/components/ui/**` directory is a shadcn/Radix-style primitive layer. Important primitives include:

| Primitive Group | Files | Role | Redesign Risk |
|---|---|---|---|
| Actions | `button.tsx`, `toggle.tsx`, `toggle-group.tsx` | Buttons and toggle controls | Safe visual, but verify disabled/focus states |
| Forms | `input.tsx`, `textarea.tsx`, `select.tsx`, `checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `slider.tsx`, `label.tsx`, `form.tsx`, `input-otp.tsx` | Form controls | Safe visual to moderate due validation layout |
| Surfaces | `card.tsx`, `dialog.tsx`, `drawer.tsx`, `sheet.tsx`, `popover.tsx`, `hover-card.tsx`, `alert.tsx`, `alert-dialog.tsx` | Cards/modals/drawers/alerts | Safe visual to moderate |
| Data | `table.tsx`, `pagination.tsx`, `chart.tsx`, `progress.tsx`, `badge.tsx`, `skeleton.tsx` | Tables, charts, badges, loading | Safe visual |
| Navigation | `tabs.tsx`, `breadcrumb.tsx`, `navigation-menu.tsx`, `menubar.tsx`, `command.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `tooltip.tsx` | Tabs, menus, tooltips | Safe visual to moderate |
| Layout | `accordion.tsx`, `collapsible.tsx`, `scroll-area.tsx`, `separator.tsx`, `resizable.tsx`, `aspect-ratio.tsx`, `carousel.tsx` | Structural primitives | Safe visual to moderate |

Recommendation: keep the primitive API stable and implement future redesign through CSS variables, Tailwind classes, and wrapper composition rather than changing primitive props.

## Dashboard Components

| Path | Component | Purpose | Used By | Redesign Risk |
|---|---|---|---|---|
| `dashboard/ActiveScheduledTimelineModal.tsx` | `ActiveScheduledTimelineModal` | Active schedule timeline details | Dashboard | Moderate |
| `dashboard/AllScreensDetailsModal.tsx` | `AllScreensDetailsModal`, `ScreenSummaryCard` | Screen fleet detail modal | Dashboard | Moderate |
| `dashboard/OnlineScreensDetailsModal.tsx` | `OnlineScreensDetailsModal`, `PreviewCard` | Online screen modal | Dashboard | Moderate |
| `dashboard/ScheduleReportModal.tsx` | `ScheduleReportModal` | Schedule report breakdown | Dashboard | Moderate |
| `dashboard/LiveScreenMirror.tsx` | `LiveScreenMirror` | Live media/screen preview | Dashboard | High, content rendering logic |

Design note: dashboard currently mixes top-level KPIs, observability, system health, media management actions, and pending requests. A redesign should define a clearer priority order before restyling individual cards.

## Screens and Pairing Components

| Path | Component | Purpose | Redesign Risk | Notes |
|---|---|---|---|---|
| `screens/PairingHealthPanel.tsx` | `PairingHealthPanel` | Orphan/duplicate/backend identity diagnostics | High | Operational safety UI; keep API and no-secret handling. |
| `screens/PairDeviceModal.tsx` | `PairDeviceModal` | Generate pairing codes and guide player pairing | High | Controls pairing flow. Visual changes must preserve code/expiry/status clarity. |
| `screens/ScreenDetailsModal.tsx` | `ScreenDetailsModal` | Telemetry, delivery, commands, screenshot/status | High | Many API dependencies and action buttons. |
| `screens/ScreenHealthDashboard.tsx` | `ScreenHealthDashboard` | Health summary | Moderate | Good candidate for status card primitives. |
| `screens/ScheduleTimelineGraph.tsx` | `ScheduleTimelineGraph` | Schedule visualization | Moderate | Needs responsive testing. |
| `screens/BulkActionsBar.tsx` | `BulkActionsBar` | Bulk screen/group actions | High | Can affect many screens. |
| `screens/CreateGroupModal.tsx`, `UpdateGroupModal.tsx` | Group modals | Screen grouping | Moderate | Form/dialog consistency. |
| `screens/FrameLayoutEditor.tsx` | `FrameLayoutEditor` | Layout frame editing | High | Layout geometry logic. |

## Schedule Components

| Path | Component | Purpose | Redesign Risk |
|---|---|---|---|
| `schedule-creator/StepLayoutSelect.tsx` | `StepLayoutSelect` | Choose layout in schedule wizard | High |
| `schedule-creator/StepMediaAssign.tsx` | `StepMediaAssign`, `SlotMediaPreview` | Assign media to layout slots | High |
| `schedule-creator/StepScreenSelect.tsx` | `StepScreenSelect` | Choose target screens/groups | High |
| `schedule-creator/StepScheduleDetails.tsx` | `StepScheduleDetails` | Timing/repeat details | High |
| `schedule-creator/StepReview.tsx` | `StepReview`, `LayoutPreview`, `MediaDetailsCard` | Review before submit | High |
| `schedule/RequestDetailDrawer.tsx` | `RequestDetailDrawer` | Schedule queue details | Moderate |

Design note: redesign should preserve the wizard mental model but reduce visual fragmentation. The schedule flow is one of the highest-risk areas because it composes multiple mutation chains.

## Requests, Emergency, Chat, and Notifications

| Path | Component | Purpose | Redesign Risk |
|---|---|---|---|
| `requests/KanbanBoard.tsx` | `KanbanBoard` | Request status workboard | Moderate |
| `requests/EmergencyTakeoverModal.tsx` | `EmergencyTakeoverModal` | Emergency/instant takeover action | High |
| `requests/RequestDetailDrawer.tsx` | `RequestDetailDrawer` | Request details | Moderate |
| `requests/ComprehensiveDetailDrawer.tsx` | `ComprehensiveDetailDrawer` | Expanded request details | Moderate |
| `requests/RejectReasonModal.tsx` | `RejectReasonModal` | Rejection reason capture | Moderate |
| `chat/ConversationList.tsx` | `ConversationList` | Conversation navigation | Moderate |
| `chat/MessageList.tsx` | `MessageList` | Virtualized/loaded messages | High |
| `chat/MessageItem.tsx` | `MessageItem` | Message display/actions | Moderate |
| `chat/Composer.tsx` | `Composer` | Message composition | High |
| `chat/AttachmentPicker.tsx` | `AttachmentPicker` | Attach media/files | High |
| `chat/ChatStatusBanner.tsx` | `ChatStatusBanner` | Realtime/offline state | Moderate |
| `chat/CreateConversationModal.tsx`, `InviteMembersModal.tsx`, `ConversationSettingsPanel.tsx`, `ThreadPanel.tsx`, `PinsPanel.tsx`, `BookmarksPanel.tsx`, `ModerationControls.tsx` | Chat modals/panels | Chat administration and thread utilities | Moderate to high |

## Admin and Settings Components

| Path | Component | Purpose | Redesign Risk |
|---|---|---|---|
| `settings/DefaultMediaSection.tsx` | `DefaultMediaSection` | Global/target default media assignment | High |
| `settings/RolesPermissionsTab.tsx` | `RolesPermissionsTab` | RBAC management | High |
| `settings/AppSettingsBootstrap.tsx` | `AppSettingsBootstrap` | Applies branding/appearance settings | Moderate |
| `users/InviteUserForm.tsx`, `UserForm.tsx`, `UserCard.tsx`, `InvitationCard.tsx`, `DeleteUserDialog.tsx` | User management | Invite/edit/display/delete users | Moderate to high |
| `operators/OperatorFormDialog.tsx`, `DeleteOperatorDialog.tsx` | Operator management | Operator CRUD | Moderate |
| `departments/DepartmentCard.tsx`, `DepartmentFormDialog.tsx`, `DeleteDepartmentDialog.tsx`, `TransferScreensDialog.tsx` | Department management | Departments and screen transfer | Moderate to high |

## Player Pairing Renderer

| Path | Component/Module | Purpose | Current Style | Redesign Risk | Primitive Candidate |
|---|---|---|---|---|---|
| `darshan-player/src/renderer/index.html` | Pairing/recovery/playback DOM | Static UI shell for playback, default media, pairing, recovery, diagnostics | Inline CSS, purple gradient pairing screen | Moderate | Yes, player pairing screen layout |
| `darshan-player/src/renderer/pairing.ts` | `PairingScreen` class | Renders pairing, recovery, connectivity states from main process status | Imperative DOM updates | High | Keep behavior, redesign DOM/CSS carefully |
| `darshan-player/src/renderer/player.ts` | Playback renderer | Main playback UI/status receiver | Renderer event handling | High | Do not mix with pairing redesign unless needed |
| `darshan-player/src/renderer/default-media-player.ts` | Default media playback | Default fallback media rendering | Renderer media handling | High | Out of redesign scope except visual fallback state |
| `darshan-player/src/renderer/pdf-playback.ts` | PDF rendering | PDF worker/render handling | Renderer media handling | High | Do not redesign logic |
| `darshan-player/src/renderer/webpage-playback.ts` | Webpage rendering | Webview safety and readiness logic | Renderer media handling | High | Do not redesign logic |

Player OTP redesign should target hierarchy, spacing, color, code readability, status banners, and troubleshooting copy while preserving IPC actions:
- `refresh-pairing`
- `completePairing`
- `retry-recovery`
- `re-pair`

## Recommended Design-System Primitives

Create or standardize these primitives in a future implementation phase:

| Primitive | Reason |
|---|---|
| `AppShell` | Unify sidebar/topbar/content spacing and responsive behavior. |
| `PageHeader` | Consistent title, subtitle, actions, filters, breadcrumbs. |
| `OperationalCard` | Dense dashboard/status card with state, metric, trend, and action slot. |
| `StatusBadge` | Shared statuses: online, offline, warning, danger, emergency, scheduled, paired, unpaired. |
| `DataTable` | Unified empty/loading/error/table actions for media/screens/reports. |
| `ActionDialog` | Safe destructive/operational confirmation patterns. |
| `UploadDropzone` | Media upload with validation/progress/error states. |
| `ScheduleTimeline` | Reusable schedule preview/timeline visuals. |
| `DeviceHealthPanel` | Screen/player status, pairing status, last seen, environment identity. |
| `PlayerPairingScreen` | Player-specific full-screen pairing/recovery design, implemented without changing IPC contracts. |
