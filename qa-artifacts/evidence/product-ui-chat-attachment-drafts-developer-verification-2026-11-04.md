# Chat attachment drafts: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. This is local developer evidence, not independent human QA or release acceptance.

## Expected operator behavior

An unsent attachment belongs to the conversation where it was selected or uploaded. Switching to another chat or the phone chat list must not discard it or attach it to the wrong chat. A file awaiting server verification cannot be sent as if it were READY. A failed Composer upload remains visible until the operator clears it; Send explains the blocking state. A revoked conversation must not keep its staged Composer visible.

## Change and evidence

- The CMS retains only Composers with staged attachments or uploads while another conversation is selected. Inactive Composers are hidden and disabled; an open attachment picker closes on navigation. Text drafts remain keyed by conversation as before. Object URLs are released when the Composer is eventually cleared or unmounted.
- Both direct Composer uploads and uploads started inside the attachment picker report pending state. `queued`, `uploading` and `processing` block Send. A failed direct upload also blocks Send until cleared, so the user cannot mistake an incomplete file for an attachment. Clearing completed/failed uploads no longer revokes a preview still used by a pending upload.
- A `403`/`404`, banned or removed-access result discards that conversation's staged Composer and draft. The server remains authoritative for send and media access.
- `darshan-cms/tests/chat-navigation.e2e.spec.ts` passed **11/11** in one Chromium worker. New browser cases cover selecting an existing file, switching A → B → A, phone list navigation, a delayed media verification response, disabled Send during verification, and successful readiness after returning to A. API and storage responses in these cases are fixtures.
- The isolated local QA CMS at `https://localhost:18445` accepted the existing test administrator and opened Dashboard and Conversations. That running build currently has no conversations for this account, so it was not used to validate the new attachment behavior. The new branch's CMS production build and bundle-budget check passed (entry JavaScript 212.4 KiB, 67.5 KiB gzip); the updated UI behavior was exercised in the current-source fixture browser suite.
- CMS unit tests passed **277/277** across 44 files. Focused ESLint for the four changed CMS source/test files and `git diff --check` passed.

## Remaining checks

- Run two real signed-in operators with actual MinIO uploads and delayed conversion/verification. Switch chats and phone list while an upload is in flight, then verify one attachment on the intended conversation only. Check revoked membership, browser refresh, network interruption and a failed file with a real backend.
- At the time of this attachment-draft packet, message history started at `afterSeq=0`. The later [chat-history packet](product-ui-chat-history-developer-verification-2026-11-04.md) adds latest/older/anchored pagination; independent matched-service QA remains open.
- Run independent screen-reader, keyboard, mobile safe-area, Safari/Android, and permissions checks on the frozen candidate.
