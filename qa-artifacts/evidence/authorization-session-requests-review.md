# Authorization, Ownership, Emergency, Requests And Session Review

Reviewed: 2026-10-17
Code baseline: `release-01` through `a01804c`
Method: multi-pass source review followed by unit, real-PostgreSQL integration,
production-build, built-API HTTP, one-worker browser and full player automated
developer verification. Exact results and limitations are in
`runtime-2026-10-16/authorization-end-to-end-devqa.md`. These remain developer
results; the QA catalogue is not marked Pass.

## QA Acceptance Matrix

| Area | Expected behavior | Primary source evidence | Runtime status |
| --- | --- | --- | --- |
| Last active SUPER_ADMIN | Deleting, disabling or demoting the last active direct system-role SUPER_ADMIN returns `409 LAST_ACTIVE_SUPER_ADMIN`. Removing one is allowed when another active direct SUPER_ADMIN exists. Concurrent removals serialize on the SUPER_ADMIN role row. Recovery CLI follows the same rule. | `darshan-server/src/auth/super-admin-invariant.ts`; user repository; recovery CLI | Developer DB/API checks passed; concurrent removal and recovery CLI remain QA pending |
| People/operator directory | Without global `manage User`, list/detail/invite/chat participant surfaces expose active non-deleted self/same-department users only. Cross-department direct IDs are hidden as not-found and SQL applies scope before count/pagination. Global User managers may see all departments. | `src/rbac/user-directory.ts`; user repository; users/invite/chat/conversation routes | Developer contracts passed; complete invite/chat/browser matrix remains QA pending |
| Media ownership | A permitted same-department user can read. Only the creator or an actor with global `manage Media` can update/delete. Other departments and restricted SUPER_ADMIN content are denied. | `src/rbac/content-ownership.ts`; media routes | Developer DB/API and CMS checks passed; QA pending |
| Layout ownership | A permitted same-department user can read. Only the creator or an actor with global `manage Layout` can update/delete. Other departments and restricted SUPER_ADMIN content are denied. | ownership helper; layout routes | Developer DB/API and CMS checks passed; QA pending |
| Presentation ownership | Creator, permitted same-department users and global managers can read; cross-department users are denied. Only creator/global manager may mutate. Nested Layout/Media must be readable and scope-compatible. | ownership helper; presentation routes | Developer DB/API closure checks passed; QA pending |
| Schedule ownership | Permitted users in the owning department may manage the Schedule using action-specific permissions; other departments are denied. Schedule Requests inherit Schedule ownership. | ownership helper; schedule and schedule-request routes | Developer unit/DB/API checks passed; QA pending |
| Administrator-created templates/content | `ADMIN` creates `ORGANIZATION` content shared for permitted reads and admin-managed mutation. `SUPER_ADMIN` creates `RESTRICTED` content visible/manageable only through global subject permission. | `ownershipForNewContent` | Developer DB/API checks passed; QA pending |
| Custom roles | Effective permissions, inheritance and record conditions decide access even when role names differ. Role-name gates remain only for protected built-in hierarchy/content classification. | RBAC resolver; feature routes/CMS; authorization role-gate test | Developer unit/DB/API checks passed; QA pending |
| Emergency trigger/status/history | `manage Emergency` permits direct-screen, group and global scope. A delegate with conditional `update Screen` may use only explicitly selected authorized direct screens; no group/global delegation. READY/readable Media is required. | emergency authorization helper and route | Developer unit/DB/API and browser checks passed; QA pending |
| Emergency clear | A global controller may clear any authorized emergency. A delegate may clear only an emergency whose complete target is direct screens all currently authorized for that delegate. Group/global/mixed/out-of-scope targets are denied. | `canAccessEmergencyTarget`; clear transaction | Developer unit/DB/API checks passed; QA pending |
| General Requests | `/api/v1/requests` is not registered; CMS page/navigation/client, reports and webhook choices are absent. Legacy tables can remain. `/api/v1/schedule-requests` remains registered. | commit `6734ccd`; requests-disabled unit test | Developer unit and built-API HTTP checks passed; QA pending |
| Immediate session removal | User disable/delete, password reset/change, role/department change and affected role-permission/inheritance edits revoke sessions at commit. Every API node receives an invalidation broadcast, disconnects local user rooms and protected socket actions reverify the stored token. Old REST/socket access is rejected. | user/role routes and repositories; session invalidation; socket-session; realtime bus | Single-node developer DB/API checks passed; two-node live socket/Valkey QA remains pending |

## Multi-Pass Corner Cases

1. Identity/concurrency: one versus two active SUPER_ADMIN accounts; self versus other; two concurrent removals; inactive/deleted accounts; direct system role versus a custom role with the same name; API and recovery CLI.
2. Directory/privacy: null department, moved user, inactive/deleted user, self record, search/filter/count/page boundaries, guessed IDs, invite lists, DM/group creation and existing conversation membership.
3. Ownership: creator, same-department peer, permitted custom role, read-only role, other department, ADMIN and SUPER_ADMIN; moved/deleted creator; organization/department/restricted/legacy rows; list/detail/mutation/reference/delete; forged nested IDs.
4. Scheduling: every action grant independently, draft/pending/approved/published/cancelled states, same-department peer, Schedule Request lifecycle, stale revision and concurrent account/permission change.
5. Emergency: conditional screen grants, mixed authorized/unauthorized screen list, group/global attempt by delegate, permission revoked during trigger/clear, READY/unready/cross-scope Media, already-cleared idempotency and scoped status/history.
6. Sessions: multiple tabs and namespaces, multiple API nodes, Valkey unavailable, direct/transitive inherited-role edit, password/account mutation races, a socket connected before commit and protected actions immediately after commit.
7. Disabled Requests: route discovery/404, direct URL, stale client bookmark, reports/webhooks, OpenAPI/config registration, and explicit confirmation that Schedule Requests still work.

## Developer Verification

- Server production build passed; final affected unit selection passed 37/37 and
  final DB-backed convergence run passed 65/65.
- Migration `0045` upgrade/repeat/failure/recovery rehearsal passed against a
  disposable real PostgreSQL database.
- CMS unit suite passed 113/113, production build passed and affected Playwright
  flows passed 6/6 with one worker.
- Player production build and all 384 automated unit/integration/performance/
  fault tests passed.
- A built API process passed live HTTP checks for Requests disablement,
  Schedule Requests retention, last-SUPER_ADMIN blocking and immediate
  single-node REST token invalidation.
- The runs found and fixed an open multipart upload when authorization was
  revoked between multipart creation and upload-session activation. The final
  server build and affected suites passed after the fix.

These checks establish strong developer coverage, not independent acceptance.
QA must execute the matrix using `05_TEST_CASES.csv`, record `Actual Result`,
link evidence and file defects for any mismatch. Full detail is in the dated
developer-QA report linked above.

## Known Execution Boundaries

- One built API process, PostgreSQL, Valkey, MinIO and a one-worker browser run
  were exercised. Two live API processes and real Socket.IO clients were not.
- In-memory/tiered bus tests and the single-node REST smoke do not prove
  cross-host Valkey delivery latency or disconnect convergence.
- The current Linux Electron build was not visually rerun in this final cycle;
  full player automation passed, and earlier dated Linux runtime evidence is
  retained separately.
- Static role-gate scanning cannot prove every future dynamic authorization
  path. UI visibility is convenience only; direct API denial remains the
  acceptance authority.
