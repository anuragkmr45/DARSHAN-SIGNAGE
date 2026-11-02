# Chat and notifications: developer verification (2026-11-03)

## Scope and environment

Tested the current source on a local CMS preview and API connected to an isolated `darshan_chat_runtime_test` PostgreSQL database, MinIO, Valkey, and a Docker conversion worker. Two departments and separate operator accounts were used. Browser checks used independent Chromium contexts so sender and recipient sessions were simultaneous. No production data or deployed VM was changed.

The schema has no organization/tenant entity. `ORGANIZATION` is a content ownership scope within one installation, so a second organization would require a separate deployment and database. The supported local separation test used two departments.

## Findings and corrections

- A cross-department operator could submit another department's media ID directly to an open forum. The server now checks actual media ownership scope and sender read permission before accepting message attachments or file bookmarks. A legacy file bookmark cannot resolve media if its creator lacks current media-read scope.
- A recipient's already-open conversation received a socket message without attachment rows and displayed the text alone. The CMS now fetches the new message through REST before adding it to the timeline or thread. The socket remains a notification, and REST supplies the authoritative attachment data.
- Chat readers now resolve shared files through a conversation-scoped endpoint that checks conversation membership/access, bans, an undeleted message or file bookmark reference, and READY media. The ordinary Media Library endpoint remains subject to media ownership policy.
- Mention notifications are limited to directory-visible users who can still read the conversation and are not banned.
- Notification read-all and creation are serialized on the recipient row so a concurrently created unread notification is not erased from the badge count. The CMS uses the server's global unread count, loads beyond the first page, refreshes on socket count changes, and marks ordinary notifications as read when opened.

## Developer verification

- Server TypeScript build: passed.
- Focused server chat, attachment authorization, notification, and notifier suites on the isolated test database: **40/40 passed**.
- CMS production build and bundle budget: passed.
- CMS unit suite: **148/148 passed**.
- Separate live browser sessions: message appeared in the recipient's open conversation without refresh; recipient notification appeared; six varied file attachments appeared with View actions and opened in the wide preview.
- Browser upload through the chat composer: PNG, PDF, DOCX, XLSX, PPTX, CSV, and MP4 were exercised; five office/CSV/video fixtures reached READY through the worker. The file picker rejected an unsupported `.exe`. A malformed DOCX failed conversion as expected.
- The live chat browser suite covered sending, a thread reply, reaction, edit/delete, attachment upload, and share link. The notification deep-link case was skipped because that test account had no suitable notification at that moment. The focused notification browser test covers list pagination, unread count, and opening an ordinary notification.
- `git diff --check`: passed.

## Remaining QA

This is developer verification on one machine. A separate deployment is needed to test organization isolation. Repeat simultaneous-account, notification, attachment conversion, and large-file checks on the packaged artifact and target VMs. No production or multi-node result is claimed here.
