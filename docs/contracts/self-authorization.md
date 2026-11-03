# Current user's CMS visibility permissions

`GET /api/v1/auth/authorization` requires the current authenticated user session,
and accepts no user/role selector. It returns only that user's identity, own role
ID/name, current primary/additional department IDs and server-evaluated coarse
capability pairs. It does not require `read Role`, return a role directory or
grant a new permission. `/roles` keeps its separate authorization checks.

The endpoint shares the existing role-graph, user and session locks and builds
the actual effective CASL ability on that transaction. Canonical server action
and subject metadata enumerates visibility pairs; inheritance, `manage/all`,
inverted-rule precedence and the existing ADMIN Branding exception are evaluated
on the server. Conditional positive rules may permit showing a feature, but
they remain conditional in actual resource authorization. No conditions are
flattened into unconditional resource grants or interpreted in the browser.

CMS `useAuthorization` queries this self endpoint rather than the first 100 roles.
The cache key contains the user ID and a non-secret in-memory API session
generation, never a JWT, API key or cookie. Login/logout, API-key replacement and
rehydration advance the existing generation before Redux notifies consumers;
normal JWT refresh retains it. The API client aborts/fences old requests and the
self-response user ID is checked. The hook supplies no prior-account placeholder
and fails closed on a failed authorization read. Backend row-bound permission,
ownership, department and current-session checks remain the final authority.
