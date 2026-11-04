# Chat uncertain-send developer verification — 2026-11-04

## Defect and correction

The CMS default React Query policy retries mutations once. Chat sends inherited that policy even though the send endpoint has no idempotency key and creates a new database sequence for every POST. If the server committed a message but its response was lost, the automatic retry could therefore create a duplicate.

`useSendChatMessage` now sets `retry: false`. A failed or uncertain send stays in the conversation as a failed pending item with its text and attachments intact. Only the existing labeled **Retry** action sends the message again. Other mutations keep their existing policies.

## Focused verification

| Check | Result |
| --- | --- |
| Fixture browser: failed send remains visible with Retry | Passed |
| Fixture browser: wait beyond the former retry delay | Exactly one POST |
| Fixture browser: operator selects Retry | Exactly one additional POST |
| Focused lint for changed hook and browser test | Passed |
| Complete Chat navigation browser file, one Chromium worker | 14/14 passed |

## Evidence boundary

The fixture deliberately returns `503` and counts requests, so it proves CMS retry behavior but cannot reproduce a response lost after a real database commit. Human QA must repeat the case against a matched disposable deployment, inspect the persisted conversation sequence before deciding whether to retry, and verify behavior with two actors and a reconnecting realtime channel. A future server idempotency-key contract would provide stronger exactly-once protection; this bounded fix prevents the current known automatic duplicate path.
