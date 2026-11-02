# Operator membership across departments

`users.department_id` remains the **primary** department. It is the value in
existing API responses and signed JWTs, and it owns newly created Media,
Layouts, Presentations and Schedules. The `user_additional_departments` table
adds explicit relationships for operators only. There is one application role
and no active-department switch.

An operator assigned to primary A and additional B/C can discover active users
whose current assigned department sets overlap A/B/C, and can read permitted
department content in A/B/C. D is outside the operator's scope. Existing
action-specific grants still apply: membership alone cannot create a User,
manage a department, mutate another author's Media/Layout/Presentation, or
publish a Schedule without the applicable permission. Organization and
restricted ownership keep their existing behavior. Existing content keeps its
stored owner scope and department when a creator's primary changes.

Only an actor with global `manage User` can assign additional departments.
Department managers still manage operators by the **target's primary**
department. A primary change in the new CMS retains the former primary as an
additional department by default; the manager can remove it explicitly. The
server rejects an old-client primary change that would duplicate an existing
additional assignment with `409 PRIMARY_DEPARTMENT_CONFLICT` rather than
silently dropping access.

## API and compatibility

Create, invite and update accept optional `additional_department_ids: string[]`.
Omitting it on PATCH preserves the current assignments; `[]` removes them.
Responses retain scalar `department_id` and add `department_ids`,
`additional_department_ids`, and `departments` (id/name/`is_primary`).
Additional IDs are returned in stable ID order after the primary. Existing
clients can ignore the additive fields. Invalid duplicates, nonexistent
departments, primary repeated as additional, missing primary, and non-operator
assignments return `422 INVALID_DEPARTMENT_MEMBERSHIP`.

Membership replacement and primary/role changes commit together under a
target-user row lock. All target sessions are deleted in the same transaction;
the server broadcasts invalidation after commit. A fresh login resolves current
membership from PostgreSQL. Ownership-sensitive writes lock the user, recheck
the session, and resolve current membership before the write. Existing custom
role `$user.department_id` conditions continue to mean **primary**; they do
not implicitly expand to additional departments. Requests already in flight
before a membership change can complete under their existing transaction or
read snapshot; subsequent requests with the revoked session are rejected.

Department deletion counts primary and additional user relationships and
returns `409 DEPARTMENT_IN_USE`; the foreign key also restricts a concurrent
delete/assignment race. Tombstoning an operator removes their additional
membership rows but retains content ownership/history.

Chat discovery, new DMs, invitations and mentions use current shared
membership. A sender can select Media from a currently assigned department
only when the Media permission allows it. A recipient who remains in an
existing conversation can keep opening a file previously shared in a message
there after losing the source department. That recipient cannot newly discover
users or open the source Media Library entry through the removed department.
Conversation membership and message reference remain the authority for the
shared-file endpoint; a deleted message or deleted/unready Media is unavailable.
New file bookmarks record that the sender was authorized at share time and
remain readable through conversation membership after later department changes.
Older bookmarks without that proof retain the prior creator-scope check.

Operator and general User search run on the server before pagination, so
accounts beyond the current page can be found. Department search covers the
complete paginated department list, including operators attached through
additional memberships.

## Verification boundary

The migration is additive and existing primary-only users need no backfill.
Upgrade all API and worker nodes before enabling the new CMS form. Older CMS
builds can list/login and make unrelated user PATCH requests without erasing
additional memberships. The dated developer evidence is in
`qa-artifacts/evidence/operator-multi-department-developer-verification-2026-11-03.md`.
Independent security, multi-node, large-directory and release QA remain
separate from developer verification.
