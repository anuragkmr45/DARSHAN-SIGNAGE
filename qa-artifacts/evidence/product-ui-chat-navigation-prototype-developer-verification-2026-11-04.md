# Product UI chat navigation prototype: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`, based on `release-01` at `1697249`.

Status: prototype developer verification. This is not communication-feature or release acceptance.

## Task and expected behavior

Operators need to find a chat, distinguish unread items, read messages, enter a thread, and return without mixing or losing text drafts. Narrow layouts should show one working surface at a time. The server remains authoritative for membership, messages, unread counts, and moderation.

## Browser evidence

- `darshan-cms/tests/chat-navigation.e2e.spec.ts`: fixture-backed signed-in CMS at 390, 820, and 1440 CSS pixels. Tests navigate through list, conversation and thread, retain independent conversation and thread text drafts, and verify the phone Back actions.
- The same journey verifies server-driven unread-count refresh after a read receipt, contextual message actions, deletion confirmation/cancellation, failed-edit draft retention, and absence of dead controls in the thread panel.
- The desktop journey verifies a simultaneous list and message view. Screenshots: [phone list](product-ui-chat-navigation/phone-list-390.png), [phone conversation](product-ui-chat-navigation/phone-conversation-390.png), [phone thread](product-ui-chat-navigation/phone-thread-390.png), [tablet list](product-ui-chat-navigation/tablet-list-820.png), [desktop split view](product-ui-chat-navigation/desktop-split-1440.png).

All API responses in this browser suite are fixtures. They validate the client workflow and layout only.

## Local validation

- `npx playwright test tests/chat-navigation.e2e.spec.ts tests/chat-attachment-access.e2e.spec.ts tests/notifications.e2e.spec.ts`: 4 browser cases passed with one worker.
- `npm run test:unit`: 42 files and 271 tests passed.
- `npm run build` and bundle budget: passed; entry JavaScript 220.2 KiB (69.7 KiB gzip).
- Focused ESLint and `git diff --check`: passed.

## Gaps before communication packet acceptance

- Switching conversations during attachment upload removes that Composer instance. In-progress attachment drafts and upload progress are not preserved; test and implement a safe transfer or cancellation policy.
- An old thread deep link may not show its root message if the root is outside the current main-message window; the thread endpoint currently returns replies and root ID only.

Follow-up: [thread-context developer verification](product-ui-chat-thread-context-developer-verification-2026-11-04.md) records the later server and CMS correction for the deep-link root. The bullet above describes the original prototype limit.
- Run real-service multi-account chat, notification, membership, moderation, archive/restore, attachment formats, disconnected/reconnect, and permissions journeys through the CMS.
- Check both themes, five accents, mobile keyboard and safe areas, text zoom, reduced motion, and physical Safari/Android behavior.
