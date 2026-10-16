# Deleted Users and Stable Content Ownership

This document is the API, operator, and migration contract for deleted-user tombstones introduced by migration `0045_deleted_user_content_ownership.sql`.

## Product behavior

- Deleting a user disables that identity; it does not physically delete the user row or automatically transfer work to another person.
- The original user ID, first and last name, role, department, and historical foreign-key references remain available for attribution.
- Email, password, invite metadata, sessions, and other access-bearing account state are scrubbed or revoked.
- The original email can be assigned to a new account. The new account receives a different user ID and does not inherit historical ownership.
- Normal user, operator, invite, login, activation, reset, and administrator-recovery lookups exclude tombstones.
- Historical responses may show the retained name and `DELETED` status, but must return `email: null` or omit email.
- Every `SUPER_ADMIN` account is protected from deletion.

## Stable ownership model

Media, Layout, Presentation, and Schedule rows store ownership separately from `created_by`:

| `owner_scope` | `owner_department_id` | Meaning |
| --- | --- | --- |
| `ORGANIZATION` | `null` | Administrator-created organization content. Readable to an actor with the relevant read ability; managed by an administrator with the relevant mutation ability. |
| `DEPARTMENT` | Department UUID | Content permanently assigned to the creator's department at creation/backfill time. |
| `RESTRICTED` | `null` | Legacy content that cannot be mapped safely. Administrator-only. |

Changing or deleting a creator never rewrites `created_by`, `owner_scope`, or `owner_department_id`. Schedule Requests inherit access and operational control from the Schedule's stored ownership instead of the requester's current department.

Nested references obey visibility closure:

- An organization parent may reference only organization content.
- A department parent may reference organization content or content owned by the same department.
- A restricted parent is administrator-only and may reference any scope.
- Cross-department and narrower-child assignments are rejected before the write. Atomic slot replacement leaves the previous complete assignment unchanged when any proposed occurrence is invalid.
- Schedule-item creation resolves the selected Presentation's Layout and every Media occurrence and rejects any incompatible descendant before inserting the item. Publication repeats the same centralized closure check so legacy/directly corrupted rows cannot enter an immutable player snapshot.

## Response contract

Owned-resource list/detail/create/update responses return server-derived metadata. Media created through either the resumable upload-session API or the legacy direct-presign API follows the same rule; upload-session responses embed the current PENDING/PROCESSING/READY/FAILED Media with this metadata instead of omitting authorization context until completion.

```json
{
  "created_by": "user-uuid",
  "ownership": {
    "scope": "DEPARTMENT",
    "department_id": "department-uuid",
    "department_name": "Marketing",
    "creator": {
      "id": "user-uuid",
      "display_name": "Former User",
      "status": "DELETED"
    }
  },
  "permissions": {
    "can_update": true,
    "can_delete": true
  }
}
```

Creator status is one of `ACTIVE`, `INACTIVE`, `DELETED`, or `UNKNOWN`. Clients must use `permissions` for action availability and must not infer authorization from `created_by`. Schedule responses currently return `can_delete: false` because the API has no Schedule delete operation.

Expanded Presentation detail/item/slot, Schedule item, and Schedule Request resources use the same ownership and permission contract for nested Media, Layout, Presentation and Schedule objects. Incompatible or unreadable nested content rejects the response and is never exposed.

## `DELETE /api/v1/users/:id`

The operation is idempotent. A successful response has this shape:

```json
{
  "message": "User deleted successfully",
  "id": "user-uuid",
  "deleted_at": "2026-10-16T00:00:00.000Z",
  "already_deleted": false,
  "aborted_uploads": 2,
  "cleaned_uploads": 2
}
```

A repeated authorized call returns HTTP `200`, `already_deleted: true`, and does not create a second deletion audit event.

The database transaction:

1. locks the target user;
2. aborts unfinished resumable uploads and marks creator-owned `PENDING` or
   `PROCESSING` Media for cleanup so a late converter/transcoder/capture worker
   cannot reactivate it;
3. deletes every session;
4. replaces the email with `deleted+<user-id>@deleted.invalid`;
5. replaces the password hash, sets `is_active = false`, clears invite metadata, and records `deleted_at`/`deleted_by`;
6. inserts one `USER_DELETED` audit record.

After commit, the API disconnects the user's chat, notification, and screen
sockets and attempts object-store cleanup. Background processors may commit
`READY` only while the row is still `PROCESSING`; if deletion wins, stale
source/ready/thumbnail output is compensated and the deletion failure reason is
preserved. Failed object deletion keeps enough database state for retry. The
hourly cleanup retries deleted-user objects and generic orphan rows after the
applicable grace period, oldest first and in bounded batches; failed retries
remain queued and successful retries clear object references. Completed Media
and immutable published snapshots are retained.

## Migration `0045`

### Preconditions

1. Back up the database and object-store metadata using the approved deployment procedure.
2. Stop writers or place the release in its approved maintenance mode.
3. Run `npm run migration:plan` from the new server build.
4. Confirm `0044_document_page_selection.sql` is applied and only the expected later migrations are pending.
5. Do not start the new server before `0045` is applied.

### Backfill

For each existing Media, Layout, Presentation, and Schedule:

- creator role `ADMIN` or `SUPER_ADMIN` becomes `ORGANIZATION`;
- a creator with a currently valid department becomes `DEPARTMENT` using that department;
- missing creator, missing role, no department, or otherwise unmappable data remains `RESTRICTED`.

Legacy rows did not store creation-time department ownership. If a creator transferred before migration, `0045` can only use the department present at migration time. Review these mappings on the disposable migration rehearsal and correct them through an approved forward migration before production rollout if necessary.

### Apply and verify

Run:

```bash
cd darshan-server
npm run migration:plan
npm run migration:apply
npm run migration:plan
```

Verify:

- the ledger records `0045_deleted_user_content_ownership.sql` once and reports no pending migration on the final plan;
- all four owned tables have valid scope/department combinations;
- owner indexes and restrictive department foreign keys exist;
- creator references prevent physical deletion of referenced users;
- list/detail APIs return ownership and permissions for synthetic actors from both departments;
- a tombstoned creator still resolves by ID/name and never exposes the original email.

The migration runner applies each migration transactionally. If an attempt is interrupted or fails, inspect the ledger and schema before retrying; do not manually mark `0045` as applied. Retry the normal migration command only after confirming that the failed transaction rolled back, or ship an explicitly reviewed forward-fix migration if any external/manual action left partial state.

## Rollback restriction

Automatic database downgrade is unsupported. The additive columns may remain during an application rollback, but an older server that physically deletes users must not run after `0045` unless `DELETE /api/v1/users/*` is blocked at the gateway and operator access to user deletion is disabled. A later forward release may remove that guard only after it preserves tombstones and stable ownership.

## Operator checklist

- Before deletion, confirm the target is not a `SUPER_ADMIN` and communicate that access and unfinished uploads stop immediately.
- Do not promise person-to-person reassignment; content remains with its organization/department scope.
- After deletion, verify the user disappears from normal directories, existing sessions fail, and history shows `Created by <name> (Deleted)` without email.
- If cleanup counts differ, inspect worker logs and the upload-session/media failure reason; do not delete retained READY content manually.
- A department cannot be deleted while it has users or owns Media, Layouts, Presentations, or Schedules. The conflict response contains per-resource counts.

## Source anchors

- `drizzle/migrations/0045_deleted_user_content_ownership.sql`
- `src/rbac/content-ownership.ts`
- `src/db/repositories/user.ts :: tombstone()`
- `src/routes/users.ts :: DELETE /api/v1/users/:id`
- `src/routes/media.ts`
- `src/routes/layouts.ts`
- `src/routes/presentations.ts`
- `src/routes/schedules.ts`
- `src/routes/schedule-requests.ts`
