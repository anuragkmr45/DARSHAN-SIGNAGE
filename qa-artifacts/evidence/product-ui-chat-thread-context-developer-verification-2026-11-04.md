# Product UI Chat thread context: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is developer evidence, not independent human QA or release acceptance.

## Operator behavior

A direct thread link now shows the parent message even when that parent is outside the currently loaded conversation page. The authorized thread REST response includes `rootMessage` separately from cursor-paged replies. Deleted parents remain visible as redacted tombstones without text, attachments or reactions. The CMS prefers this server response over a potentially stale main-timeline copy and still accepts an older response without `rootMessage` when the parent is locally available.

If the thread read fails, the panel shows an error and Retry. It does not claim there are no replies or that the thread is up to date, and it disables reply submission until a successful read. A parent attachment with a supplied filename no longer displays as “Untitled media” while its scoped media lookup is incomplete.

## Evidence

- Dedicated PostgreSQL test database `darshan_thread_context_test`: the full `darshan-server/src/routes/chat.test.ts` suite passed **26/26**. The new route case requests a thread through a reply ID with a cursor beyond all replies and checks canonical root ID, parent text, attachment, reaction, and deleted-parent redaction. The migration reset was limited to this newly named `*_test` database.
- `darshan-cms/tests/chat-navigation.e2e.spec.ts`: full fixture-backed browser suite passed **9/9**. New cases cover an old direct thread link, a failed initial read followed by Retry, and a deleted parent overriding a stale timeline copy. After adding the phone capture, the affected old-link case passed again.
- [390-pixel thread capture](product-ui-chat-thread-context/old-thread-parent-390.png): reviewed for visible parent context, attachment filename, reply state, and controls within the phone width. The content is fixture data.
- Server TypeScript build passed. CMS production build and bundle budget passed; entry JavaScript was 212.4 KiB (67.5 KiB gzip). CMS unit tests passed **277/277**, and focused CMS ESLint and `git diff --check` passed.
- Focused server ESLint remains nonzero because `detachedMediaAssetIds` in `src/db/repositories/chat.ts` was already unused before this packet; existing `any` warnings also remain. The CMS TypeScript check with a config override still reports 116 existing project diagnostics, including duplicate Chat type declarations and existing cursor `pageParam` typings. None were introduced by this packet.

## Remaining verification and known limits

- The browser tests use fixtures; the database test calls the real Fastify route. A matched-build CMS/API journey with independent operators, permission withdrawal, network loss and media access still needs to run.
- Switching conversations still loses an in-progress attachment upload because the Composer instance unmounts. Define and test an upload transfer or cancellation contract before full Chat acceptance.
- Follow-up: [attachment-draft developer verification](product-ui-chat-attachment-drafts-developer-verification-2026-11-04.md) records the later CMS correction and fixture browser tests; real-service upload and access-loss checks remain open.
- At the time of this thread-context packet, main and thread queries started from `afterSeq=0`. The later [chat-history packet](product-ui-chat-history-developer-verification-2026-11-04.md) adds latest/older/anchored pagination; its independent real-service QA remains open.
- Verify the alias route, keyboard/screen-reader behavior, themes and accents, Safari/Android, and narrow-screen safe areas during the full communication regression.
