# Authorization, Ownership, Emergency, Requests And Session Review

Reviewed: 2026-10-16  
Code baseline: `release-01` through `8f66d8f`  
Method: multi-pass source review, production builds and focused bounded automated tests. The application, browser, database migrations, Docker stack and Electron player were not started for this change set.

## QA Acceptance Matrix

| Area | Expected behavior | Primary source evidence | Runtime status |
| --- | --- | --- | --- |
| Last active SUPER_ADMIN | Deleting, disabling or demoting the last active direct system-role SUPER_ADMIN returns `409 LAST_ACTIVE_SUPER_ADMIN`. Removing one is allowed when another active direct SUPER_ADMIN exists. Concurrent removals serialize on the SUPER_ADMIN role row. Recovery CLI follows the same rule. | `darshan-server/src/auth/super-admin-invariant.ts`; user repository; recovery CLI | Not Tested |
| People/operator directory | Without global `manage User`, list/detail/invite/chat participant surfaces expose active non-deleted self/same-department users only. Cross-department direct IDs are hidden as not-found and SQL applies scope before count/pagination. Global User managers may see all departments. | `src/rbac/user-directory.ts`; user repository; users/invite/chat/conversation routes | Not Tested |
| Media ownership | A permitted same-department user can read. Only the creator or an actor with global `manage Media` can update/delete. Other departments and restricted SUPER_ADMIN content are denied. | `src/rbac/content-ownership.ts`; media routes | Not Tested |
| Layout ownership | A permitted same-department user can read. Only the creator or an actor with global `manage Layout` can update/delete. Other departments and restricted SUPER_ADMIN content are denied. | ownership helper; layout routes | Not Tested |
| Presentation ownership | Creator, permitted same-department users and global managers can read; cross-department users are denied. Only creator/global manager may mutate. Nested Layout/Media must be readable and scope-compatible. | ownership helper; presentation routes | Not Tested |
| Schedule ownership | Permitted users in the owning department may manage the Schedule using action-specific permissions; other departments are denied. Schedule Requests inherit Schedule ownership. | ownership helper; schedule and schedule-request routes | Not Tested |
| Administrator-created templates/content | `ADMIN` creates `ORGANIZATION` content shared for permitted reads and admin-managed mutation. `SUPER_ADMIN` creates `RESTRICTED` content visible/manageable only through global subject permission. | `ownershipForNewContent` | Not Tested |
| Custom roles | Effective permissions, inheritance and record conditions decide access even when role names differ. Role-name gates remain only for protected built-in hierarchy/content classification. | RBAC resolver; feature routes/CMS; authorization role-gate test | Not Tested |
| Emergency trigger/status/history | `manage Emergency` permits direct-screen, group and global scope. A delegate with conditional `update Screen` may use only explicitly selected authorized direct screens; no group/global delegation. READY/readable Media is required. | emergency authorization helper and route | Not Tested |
| Emergency clear | A global controller may clear any authorized emergency. A delegate may clear only an emergency whose complete target is direct screens all currently authorized for that delegate. Group/global/mixed/out-of-scope targets are denied. | `canAccessEmergencyTarget`; clear transaction | Not Tested |
| General Requests | `/api/v1/requests` is not registered; CMS page/navigation/client, reports and webhook choices are absent. Legacy tables can remain. `/api/v1/schedule-requests` remains registered. | commit `6734ccd`; requests-disabled unit test | Not Tested |
| Immediate session removal | User disable/delete, password reset/change, role/department change and affected role-permission/inheritance edits revoke sessions at commit. Every API node receives an invalidation broadcast, disconnects local user rooms and protected socket actions reverify the stored token. Old REST/socket access is rejected. | user/role routes and repositories; session invalidation; socket-session; realtime bus | Not Tested |

## Multi-Pass Corner Cases

1. Identity/concurrency: one versus two active SUPER_ADMIN accounts; self versus other; two concurrent removals; inactive/deleted accounts; direct system role versus a custom role with the same name; API and recovery CLI.
2. Directory/privacy: null department, moved user, inactive/deleted user, self record, search/filter/count/page boundaries, guessed IDs, invite lists, DM/group creation and existing conversation membership.
3. Ownership: creator, same-department peer, permitted custom role, read-only role, other department, ADMIN and SUPER_ADMIN; moved/deleted creator; organization/department/restricted/legacy rows; list/detail/mutation/reference/delete; forged nested IDs.
4. Scheduling: every action grant independently, draft/pending/approved/published/cancelled states, same-department peer, Schedule Request lifecycle, stale revision and concurrent account/permission change.
5. Emergency: conditional screen grants, mixed authorized/unauthorized screen list, group/global attempt by delegate, permission revoked during trigger/clear, READY/unready/cross-scope Media, already-cleared idempotency and scoped status/history.
6. Sessions: multiple tabs and namespaces, multiple API nodes, Valkey unavailable, direct/transitive inherited-role edit, password/account mutation races, a socket connected before commit and protected actions immediately after commit.
7. Disabled Requests: route discovery/404, direct URL, stale client bookmark, reports/webhooks, OpenAPI/config registration, and explicit confirmation that Schedule Requests still work.

## Developer Verification

- Server production build: passed.
- CMS production build: passed; existing Browserslist/baseline-data warnings remain non-blocking.
- Focused authorization/ownership/emergency/Requests suite: 6 files, 18 tests passed.
- Realtime bus suite after adding it to the bounded unit configuration: 1 file, 9 tests passed, including simulated two-node session-invalidation broadcast.
- Earlier ownership batch: 14 focused tests passed; server and CMS builds passed.

These checks prove compilation and bounded contracts, not deployed behavior. QA must execute the matrix above using `05_TEST_CASES.csv`, record `Actual Result`, link evidence and file defects for any mismatch.

## Known Execution Boundaries

- No application process, browser, Docker service, database migration, live Valkey cluster, multi-process API deployment or Electron player was started for this authorization change set.
- In-memory two-subscriber broadcast is not proof of cross-host Valkey delivery latency or disconnect convergence.
- Static role-gate scanning prevents the reviewed role-name patterns from returning, but cannot prove every future dynamic authorization path.
- UI visibility is convenience only; direct API denial is the acceptance authority.
