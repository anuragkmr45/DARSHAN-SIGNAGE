# Screen detail permissions: developer verification (2026-11-04)

## Scope and decision

The Screen inspector must remain useful to an operator who can read a Screen but cannot change that record. A conditional `Screen` grant must not expose another Screen's diagnostics or allow a direct API write to that Screen. The selected Screen's current server authorization is authoritative; a browser capability alone does not decide record access.

The user also confirmed two adjacent admin decisions this turn: API-key creation remains hidden until inbound scoped authentication is designed, and invitations use a manually shared one-time activation code. Both behaviors were already implemented in this branch before this packet; this packet did not change them.

## Source change

- `GET /screens/:id` adds `can_update` evaluated against the selected record under current user/session/role authorization. Existing `readAuthorizedScreen` callers retain the same read contract.
- Recent commands, media/cache reports, delivery status, display state and heartbeat history now require `read Screen` on the selected record, matching the other detail endpoints.
- PATCH, display selection, screenshot policy and screenshot capture require `update Screen` on the selected record under a locked current authorization context. Their writes run in the same transaction. The display selection and `SET_ACTIVE_DISPLAY` command commit or roll back together. The display request holds a Screen key-share lock to avoid a lock-order deadlock with player display-profile projection while preventing concurrent deletion.
- The CMS hides Edit, the preferred-output selector and Take Snapshot unless both the current Screen response says `can_update: true` and the actor has the effective update capability. It shows `View only` otherwise; current diagnostic data remains readable.

## Executed checks

| Check | Result | What it covers |
|---|---|---|
| Isolated database `screens.test.ts` and `screen-display-state-service.test.ts` | 24/24 passed | Conditional role allowed one Screen; second Screen returned 403 for detail, status, heartbeats, commands, cache reports, delivery and display; PATCH, selection, screenshot policy/capture returned 403; no target row, command or display state changed. Existing display selection and profile ordering passed. |
| Screen operator Playwright suite | 20/20 passed | Detail/list rendering, permission-gated inspector, fleet filtering, groups, pairing, deletion, observability and recovery fixture journeys. |
| Targeted view-only Playwright rerun after final badge and screenshot | 1/1 passed | View only label, readable Overview/Snapshot, absent Edit/selector/Take Snapshot. |
| CMS unit suite | 277/277 passed | Existing component, hooks and API utility regression. |
| Server TypeScript build; CMS production build and bundle budget; `git diff --check` | Passed | Compile, production bundle and patch hygiene. |

The fixture browser capture [view-only-inspector.png](product-ui-screen-detail-permissions/view-only-inspector.png) shows the selected Snapshot tab with current information and no write action. The capture is local fixture evidence, not a live player or production result.

## Remaining independent QA

- Sign in as two real conditional-role operators against the matched CMS/API build, including a permission withdrawal while an inspector is open. Confirm the server still denies stale write controls and refresh recovers to View only.
- Exercise the display command and screenshot request with a paired physical player; verify delivered command, resulting display selection/capture, and any player capability failure.
- Run the full Screen detail tab matrix at desktop/phone/keyboard and with backend disconnection. The present browser test covers the view-only boundary and existing list/detail responsiveness, not every tab state.
- Review broader Screen aggregate endpoints (`overview`, schedule timeline and aspect-ratio list) separately for record-scope filtering; this packet closes the selected-record detail and write paths.
