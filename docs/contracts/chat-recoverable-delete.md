# Recoverable Chat Delete Contract

`DELETE /api/v1/chat/messages/:id` sets a message deletion marker. It preserves the body in the row and a deletion revision, plus attachment associations and object bytes. Ordinary message/thread responses and the delete response show a tombstone with no body or attachments. `DELETE /api/v1/chat/conversations/:id` marks the conversation `DELETED` and retains messages, memberships, revisions, pins, bookmarks, reactions, receipts, moderation, attachments and media.

Old queued chat-media cleanup jobs become safe no-ops. Completed Media and chat objects are retained; aborted upload staging and never-accepted temporary objects may still be removed. Previously deleted objects may be unrecoverable.

Current ADMIN or SUPER_ADMIN users with effective `manage Conversation` permission can list deleted conversations and messages through `GET /api/v1/chat/deleted/conversations?page=N` and `/api/v1/chat/deleted/messages?page=N` (pages of 100, starting at 1) and restore them with `POST /api/v1/chat/conversations/:id/restore` and `/api/v1/chat/messages/:id/restore`. The CMS chat page exposes the same controls. Restore preserves IDs, checks attachment objects and conflicting direct-conversation associations, and is idempotent. A deleted conversation must be restored before one of its messages. List, delete and restore actions are audited.
