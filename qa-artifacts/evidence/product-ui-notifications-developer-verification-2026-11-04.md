# Notifications interface: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: fixture-backed CMS developer verification. This does not establish real multi-account or production acceptance.

## Contract checked before editing

- The `/notifications` route requires CMS `read Notification` access. The server's list and mark-read endpoints authenticate and enforce notification ownership; they do not require a separate update grant.
- The current server creates direct-message, mention, and thread-reply notifications with conversation IDs. An older or other non-chat record can still be displayed and marked read, without implying a destination.
- List, pagination, read state, and unread totals come from REST. Realtime notifications only trigger count/list refresh.

## Browser journeys

`darshan-cms/tests/notifications.e2e.spec.ts` passed **6/6** cases with one Playwright worker against a running CMS with controlled API fixtures:

1. Server totals, page 2, non-chat Mark read, Mark all read, and thread deep link.
2. Initial list failure shown as failure, then Retry loads real records.
3. A failed single-read action leaves the record unread and can be retried; a failed read update does not stop a thread link from opening, and a visible toast reports the remaining unread state.
4. Failed Mark all read remains visible and retryable; after success, the Unread filter returns to its valid first page and shows the empty state.
5. A stale separate counter of zero does not override the list's row-derived unread total of 55 or disable Mark all read.
6. Layout at 390, 820, and 1440 CSS pixels, plus dark mode at 390, with no document-level horizontal overflow.

Rendered captures: [phone](product-ui-notifications/notifications-390.png), [tablet](product-ui-notifications/notifications-820.png), [desktop](product-ui-notifications/notifications-1440.png), [dark phone](product-ui-notifications/notifications-dark-390.png). They show fixture content and are visual evidence only.

## Build and checks

- `npm run build` and bundle budget: passed; entry JavaScript 207.0 KiB (66.4 KiB gzip).
- `npm run test:unit`: 42 files, 271 tests passed.
- Focused ESLint for the changed page and browser suite: passed.
- `git diff --check`: passed before documentation capture; rerun at packet commit.

## Remaining acceptance work

- Run the real CMS with two accounts against the actual server and verify direct message, mention, thread reply, notification count, mark one/all, and opened conversation destinations. Exercise owner denial and realtime reconnect.
- Exercise live backend failures, stale list refresh, deletion of a linked conversation/message, notification data without a destination, and repeated clicks while a read request is pending.
- Review keyboard and screen reader navigation, 200% text zoom, reduced motion, all five accent presets, actual mobile browsers, and long localized text.
