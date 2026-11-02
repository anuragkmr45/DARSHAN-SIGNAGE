# Operator multi-department membership: developer verification (2026-11-03)

## Scope and environment

This is developer verification of BR-108 and `AUTHZ-14..18`, not independent QA
sign-off. Work was done on `codex/chat-notifications-runtime-20261103` in the
DARSHAN-SIGNAGE checkout. An isolated Docker stack on loopback ports supplied
PostgreSQL, Valkey, MinIO, the built API/worker, and two built CMS origins for
separate administrator and operator browser sessions. A pre-feature CMS build
from the branch base was run against the updated API on a third origin. No
production VM, player, existing local deployment, or release artifact changed.

## Verified behavior

- PostgreSQL migration `0055` added additional operator memberships. Migration
  `0056` records validated file-bookmark shares. The managed migration ledger
  applied `0056` with no pending migrations; direct repeated SQL application
  reported the column already present and completed successfully.
- API/DB tests verified primary-only compatibility; A plus B/C membership;
  invalid and duplicate assignments; filtered users/departments and distinct
  pagination; global-only assignment; stable primary ownership; role and user
  tombstone cleanup; department deletion; old PATCH preservation; session
  revocation; chat discovery and message/bookmark file retention. A transaction
  barrier exercised both lock orders for content creation versus membership
  removal. A second barrier exercised department deletion versus assignment.
- The current CMS created Runtime QA A/B/C and an operator with A primary and
  B additional. The operator appeared on both department cards with the
  correct relationship badges and not under C. An operator on a later page was
  found through server-side search. The running API produced A/B Layout,
  Presentation and Schedule fixtures owned by each creator's primary; an A+B
  account listed A/B but not C and direct C resource IDs returned 403/404.
- In separate browser sessions, the operator signed in once and saw A and B
  layouts while C remained absent. The administrator switched its primary to
  B with A retained as additional. A refresh rejected the old session; a new
  login worked. A layout created in the CMS then stored B ownership in
  PostgreSQL, while the earlier A layout retained A ownership. Removing A
  revoked the session, removed A from the layout list, and a copied A Layout
  API URL returned `FORBIDDEN`.
- The operator uploaded a real PNG through the CMS; the Media card showed
  `READY` and B ownership. The operator sent it as an attachment in a direct
  message with a B colleague. After restoring A primary/B additional and then
  removing B, a fresh login still opened the image in the existing chat. The
  source Media Library omitted it, its copied Media API URL returned
  `FORBIDDEN`, and the new-chat picker no longer offered the B colleague.
  PostgreSQL-backed route tests separately verified that a new bookmark with
  recorded share authorization retains conversation access. Legacy file
  bookmarks without that proof retain the old creator-scope check and can stop
  opening after the creator loses the source department. This legacy case was
  not exercised as a direct browser journey and remains a release QA risk.
- The pre-feature CMS logged in against the new API, listed the operator using
  scalar `department_id`, and saved an unrelated name change. The new CMS and
  read-only PostgreSQL inspection still showed A primary and B additional
  afterward. This demonstrates old-client additive response and omitted-field
  PATCH compatibility on the tested build.
- A stale browser sent a revoked token on a new login attempt; this initially
  caused `401`. The login path was corrected, covered by a regression test,
  and rechecked through the live operator CMS after a membership change.
- The rebuilt Users page searched the whole 272-user test directory and found
  a target absent from page one. For a test operator with an additional
  department, selecting `DEPARTMENT` displayed the warning that saving would
  remove additional assignments and end sessions. The role edit was cancelled.

## Automated results

- Server TypeScript build: passed. Focused operator suite: 13/13. Auth route
  suite: 11/11. Chat route suite: 24/24. Operator policy unit suite: 4/4.
- CMS production build and bundle budget: passed. CMS unit suite: 148/148.
  Focused lint on changed CMS surfaces: passed. The focused Chromium browser
  suite passed 6/6 for the form, primary switch, stale conflict, relationship
  badges, server-side searches beyond page one, and the role-change warning.
- The broader server run passed 81/81 tests across operator, auth, chat, users,
  content ownership and policy suites. Two stale content-ownership test cases
  were corrected to exercise recoverable Media deletion and assert that
  `?hard=true` returns `400 MEDIA_HARD_DELETE_DISABLED`.
- `git diff --check`: passed at the verification stage. The full CMS project
  TypeScript baseline contains unrelated pre-existing errors; the production
  build and touched-file lint were used as the relevant gates.

## Remaining release QA

Independent QA must execute and record `AUTHZ-14..18`, including two API nodes,
network partitions, large directories, custom roles, concurrent upload
finalization and Schedule mutation, old-client versions used at the site, and
administrator workflow variants. A real user still needs to review the CMS
wording and role-change warning. QA must also decide whether the conservative
legacy-bookmark behavior is acceptable for already deployed conversations.
The source branch was not pushed or merged.

Independent QA release gates remain open until measured evidence is recorded
in the master checklist.
