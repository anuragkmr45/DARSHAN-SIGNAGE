# Roles and permissions: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. Visual direction approved 2026-11-04.

## Behavior checked

- Built-in roles are listed read-only; a direct API update returns `409` and leaves the stored row unchanged. Custom-role permissions remain editable.
- A custom actor with `read OrgSettings` and `read Role` can view the API's built-in roles without a role-name-specific CMS filter. New/Edit/Delete controls follow current Role action grants.
- The form requires a role name and complete, non-duplicate action/resource pairs. Blank descriptions are omitted so the request matches the server schema. Custom-role deletion requires the exact name; a failed request retains the dialog and record. Create/update/delete do not automatically retry uncertain responses.
- Initial metadata/list failure offers Retry. Metadata failure disables role editing instead of offering a partially populated form.

## Developer evidence

- `darshan-cms/tests/settings-roles-ui.e2e.spec.ts`: 4/4 fixture-backed browser cases passed. A targeted visual rerun passed at 390, 820 and 1440 CSS pixels with no horizontal overflow. [Phone dialog](product-ui-roles/390-dialog.png) and [desktop dialog](product-ui-roles/1440-dialog.png) were inspected.
- `darshan-server/src/routes/roles-permissions.test.ts`: 7/7 passed against the dedicated `darshan_users_ui_test` PostgreSQL database, including direct built-in update rejection and an unchanged row.
- CMS production build and bundle budget passed. Server TypeScript build passed. CMS unit suite passed 272/272. Focused CMS lint and `git diff --check` passed.
- One packet-boundary browser run of Roles, Settings, Default Media and admin stabilization passed 17/17 with one worker.

## Remaining release QA

These browser tests use fixture API responses, not a two-operator running site. Human QA must verify a real custom-role create/edit/reload, session withdrawal across API and realtime, role assignment, update/delete blockers, restart/upgrade behavior, permission withdrawal while the dialog is open, concurrent edits, inheritance cycles and more than 100 roles. The present Roles list requests only the first 100, and its inheritance choices are drawn from that page; this needs a separate pagination/search packet before claiming large-role-site support. Keyboard, screen-reader and production deployment checks remain open.
