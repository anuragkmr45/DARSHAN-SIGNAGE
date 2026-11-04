# Chat API Catalog (V1)

`/api/v1/chat` is the primary chat domain (REST source of truth, Socket.IO fanout/transient only).

## Conversations
- `POST /api/v1/chat/dm`
- `POST /api/v1/chat/conversations`
- `GET /api/v1/chat/conversations`
- `PATCH /api/v1/chat/conversations/:id`
- `POST /api/v1/chat/conversations/:id/archive`
- `POST /api/v1/chat/conversations/:id/unarchive`
- `DELETE /api/v1/chat/conversations/:id`
- `POST /api/v1/chat/conversations/:id/moderation`

## Membership
- `POST /api/v1/chat/conversations/:id/invite`
- `GET /api/v1/chat/conversations/:id/members` (chat admins only; active group/forum members, no password or token fields)
- `POST /api/v1/chat/conversations/:id/members/remove`

## Messages
- `GET /api/v1/chat/conversations/:id/messages`
- `GET /api/v1/chat/conversations/:id/thread/:parentMessageId`
- `GET /api/v1/chat/conversations/:id/attachments/:mediaId`
- `POST /api/v1/chat/conversations/:id/messages`
- `PATCH /api/v1/chat/messages/:id`
- `DELETE /api/v1/chat/messages/:id`
- `POST /api/v1/chat/messages/:id/reactions`
- `POST /api/v1/chat/conversations/:id/read`

## Security and lifecycle notes
- All `/chat/*` routes enforce JWT + session/JTI revocation checks.
- Senders can attach only readable `READY` media in their current ownership scope, with a limit of ten per message. File bookmarks use the same check. A user moved to another department cannot keep attaching media from the former department. Missing or deleted media cannot be attached.
- A conversation reader can resolve an attachment through the chat attachment endpoint only while an undeleted message or a file bookmark in that conversation references it. For a file bookmark without a message attachment, the server also rechecks the bookmark creator's current media-read scope; this prevents legacy unauthorized bookmarks from exposing another department's media. The endpoint applies conversation access and ban checks, then returns a short-lived CMS media URL. It does not widen the normal Media Library list or `GET /media/:id` access.
- Mention notifications are sent only to directory-visible users who can still read the conversation and are not banned. Pasted IDs outside those rules cannot receive a private snippet.
- `chat:inbox:changed` is a refresh hint for newly created DMs, groups, forums and member changes. The CMS refetches its conversation list through REST. Closed-group hints go only to members; a new open-forum hint carries no conversation identifier and can go to all connected chat clients. A removed or banned user's socket leaves the conversation room immediately.
- The CMS periodically refetches the conversation list while open so a missed socket hint is eventually repaired. Deleted messages remain in storage for authorized recovery, but normal conversation-list responses clear their text and the CMS shows a tombstone preview.
- `ARCHIVED` conversations are read-only for content mutations.
- `DELETED` conversations are hidden from normal list/access flows.

## Legacy compatibility
- `/api/v1/conversations/*` DM routes are compatibility shims over `chat_*` DM data.
- New DM writes should use `/api/v1/chat/*` endpoints.
