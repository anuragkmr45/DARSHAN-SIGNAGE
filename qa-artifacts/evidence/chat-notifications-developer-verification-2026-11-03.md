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

## Three simultaneous CMS sessions (follow-up)

Ran the built CMS in three independent browser origins against the isolated test database: two operators in department A and one in department B. These were signed-in, interactive CMS sessions with the chat and notification pages open concurrently. No production user or message was used.

- Department A operators exchanged DM text in both directions, including Hindi and emoji, without reloading either page. Concurrent group sends arrived once each in the timeline; rapid double-click of Send created one message.
- A newly created private group appeared in the invited operator's sidebar without reload. The department B operator could neither discover it nor open its direct link. A newly created open forum appeared to the department B operator without reload, who could post there; this is the intended installation-wide forum scope.
- Typing appeared in the other session and cleared when the draft was removed. A reaction and an edited message appeared in the other session. A group mention generated a notification; its link focused the message. Notification counts changed after a new DM and after Mark all read.
- A DM thread reply generated a **New thread reply** notification. Opening it displayed the thread and reply, rather than an empty main timeline. Deleting the latest forum message replaced the other operator's sidebar preview with a tombstone without reload.
- The sender selected a DOCX and CSV using the CMS file chooser. The isolated Docker worker converted both to READY PDF previews. The recipient saw both attachments on the live DM without reloading and opened the converted CSV as a rendered canvas. Earlier browser checks also covered PNG, PDF, XLSX, PPTX, MP4, unsupported `.exe`, and a corrupt DOCX failure.
- A private-group owner with ordinary operator permissions saw an Archive button, but the server correctly returned 403 because archive requires global `manage Conversation`. The CMS control was aligned with that server policy. The owner still sees the settings that owner policy permits.
- When the isolated API was stopped during conversation navigation, the page showed a fetch error. After restart, a new **Retry** control reopened the group without a page reload; socket reconnect also invalidates stale conversation data. The API interruption expired the short-lived browser sessions during a longer run, so the three operators signed in again using test credentials.
- Mention text in the chat sidebar now resolves to a readable name. New notification snippets use `@you` for the recipient, and the CMS renders older stored UUID snippets as `@you` or `@User`. A self-mention is displayed as text rather than a non-working "Open DM" button.
- Repeated forum *titles* in the QA sidebar were investigated: the isolated database contains five separate records with each title, created by repeated test fixtures; this was not duplicate rendering of a single conversation ID.

These checks support BR-035/036 and FUN-09/10 for the tested local cases. They do not establish production, separate-installation organization isolation, a full moderator/member-removal journey, network partition recovery, or measured concurrency at scale. The dedicated human matrix is `CHAT-01..08` in `05_TEST_CASES.csv`; all eight retain `Not Tested` and empty QA Actual Result/Execution Evidence fields. The three local CMS sessions used separate origins in one browser, so QA must repeat with independent profiles and the approved browser matrix.

## Remaining QA

This is developer verification on one machine. A separate deployment is needed to test organization isolation. Repeat simultaneous-account, notification, attachment conversion, and large-file checks on the packaged artifact and target VMs. No production or multi-node result is claimed here.
