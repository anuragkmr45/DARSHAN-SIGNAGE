# Confirmed Policies Versus Current Code

Static review of `release-01`, commit `a6e401d2479cd0dee34c33552671cd0f86d4d173`, 2026-09-24. Business source: the user's follow-up answers to BQ-002, BQ-003, BQ-004, BQ-008 and BQ-009. No application code was changed and no tests, services, deployment or database commands were run. Line anchors refer to this baseline.

**Supersession notice, 2026-10-16:** sections BQ-002, BQ-003, BQ-006, BQ-007, BQ-008 and BQ-009 below are retained as point-in-time pre-fix findings. Their current acceptance behavior and source implementation are in `authorization-session-requests-review.md`, BR-055/056/067/068/085/086/091..096 and cases `AUTHN-04`, `AUTHZ-01..03`, `AUTHZ-06`, `AUTHZ-08..13`. Current code protects only the last active SUPER_ADMIN, scopes directories by department, enforces target-aware emergencies, disables general Requests, uses permission-driven custom roles and broadcasts/revalidates session invalidation. Runtime proof remains open.

**Supersession notice, 2026-10-17:** BQ-004 below is also a historical
pre-fix finding. Current secure mode uses one exact 120-second authenticated
backend lease, stops every playback authority, purges only media cache and
requires ordered identity/fresh-snapshot/content/authority recovery before
unlock. See BR-053/069/107, `PLAYER-03..04`, `PLAYER-16` and
`playback-recovery-developer-verification-2026-10-21.md`. Two real Electron
120-second journeys and changed-authority recoveries passed.

This distinguishes intended acceptance from implemented behavior. Source-confirmed branches are not production execution evidence. The recommendations below are test-planning targets, not implemented fixes.

## BQ-002: SUPER_ADMIN Accounts

Historical requirement at the time of this review: block deletion of every SUPER_ADMIN account. **Superseded:** current rule blocks delete/disable/demotion only for the last active direct SUPER_ADMIN; see `authorization-session-requests-review.md` and `AUTHZ-01`.

Actual code:

- `darshan-server/src/rbac/policy.ts:24`, `:41`: SUPER_ADMIN may manage ADMIN and OPERATOR user targets only. DEPARTMENT, SUPER_ADMIN and custom-role targets do not pass these helpers.
- `darshan-server/src/routes/users.ts:63`, `:259`, `:279`, `:356`: create, update and delete apply the target helpers. The normal delete API therefore denies a target whose current role name is SUPER_ADMIN, regardless of how many such accounts exist.
- `darshan-cms/src/lib/access.ts:98` repeats the same restrictive user-target hierarchy. Read access is broader than mutation access.
- Role-definition management is different: `darshan-server/src/rbac/policy.ts:16` allows SUPER_ADMIN to manage system-role definitions, and `darshan-server/src/routes/roles.ts:71` permits only SUPER_ADMIN to create custom roles. Creating a custom role does not establish that the normal user APIs can assign it.
- `darshan-server/src/db/repositories/user.ts:211` performs deletion without a SUPER_ADMIN guard of its own. The normal route's result is not a database-level invariant. Role names are mutable through the role-update surface, so protection must be assessed together with BQ-008, not assumed immutable across all administrative sequences.
- Separate recovery CLI: `darshan-server/src/deployment/admin-recovery.ts:255` refuses to deactivate the last active SUPER_ADMIN; it may deactivate another one and revokes that user's sessions. Deactivation is not deletion.

Assessment: normal API deletion protection exists under the current canonical role identity, but the all-user-role management requirement conflicts with both API and CMS target helpers. Custom-role assignment is an important related gap. Broader tamper/rename/concurrent administration scenarios are not proven safe by inspection.

QA targets: one versus multiple SUPER_ADMIN accounts; self/other deletion; create/invite/update/reset for every target role; role reassignment versus role rename; custom-role assignment; direct API versus visible controls; last-active-account recovery operations once policy is confirmed.

## BQ-003: Delegated Emergency Actions

Confirmed requirement: screen-management permission is sufficient for delegated emergency access, affecting all explicitly selected screens. Do not replace this with an admins-only requirement.

Actual code:

- `darshan-server/src/routes/emergency.ts:75`: ADMIN/SUPER_ADMIN/manage-all pass; otherwise `ability.can('update', 'Screen')` authorizes the operation. A broader manage grant may satisfy the same ability check.
- `:164`, `:505`: selected IDs are deduplicated and checked for existence; a trigger must use exactly one of explicit screen IDs, group IDs or `target_all`. This is not a per-target ownership/department authorization check. The guard accepts a subject type, not each selected Screen record.
- `:679`: clear uses the same broad guard and the emergency ID; no creator-only or selected-screen-scope check is applied there.
- `darshan-cms/src/components/requests/EmergencyTakeoverModal.tsx:84` itself accepts screen-update permission.
- However, its entry point in `darshan-cms/src/pages/ScheduleQueue.tsx:95`, `:267`, `:605` gates the button and mounted modal using `darshan-cms/src/lib/access.ts:56`, which accepts only ADMIN/SUPER_ADMIN role names.

Assessment: backend delegation and the modal's internal guard broadly support the chosen permission. The parent CMS entry gate prevents the delegated workflow. The API also supports global/group targeting and broad clear access; these must not silently become an approved delegation boundary merely because they exist. The user confirmed selected-screen access, not every possible delegation exception.

QA targets: delegate can discover/open/use the control; direct API permission parity; selected versus unselected screens; invalid/mixed scopes; group membership changes; conditional Screen grants; clearing someone else's emergency; global selection as an explicit policy boundary. No emergency was triggered during review.

## BQ-004: Lock At Two Minutes And Remove Cached Media

Confirmed requirement: lock after a two-minute backend outage, erase cached media files as part of the lock behavior, and stop emergency playback too. This does not authorize deleting device identity, certificates, queued proof-of-play or every local application file. Precise purge-completion tolerance is not supplied.

Actual code and configuration:

- `darshan-player/src/common/offline-security-policy.ts:37`: default policy is `standard`, `backendRequiredForPlayback=false`, grace 30,000 ms, lease 120,000 ms, offline lock interval 120,000 ms, purge interval 0.
- `:75`, `:88`: standard policy with no backend-required override does not enable the security lock. Purge interval 0 disables automatic purge; it does not mean purge immediately.
- `scripts/bundle/assemble-runtime-bundle.sh:317`, `:351`: source-free player configuration sets TLS/runtime/webpage policy but omits these offline-lock/purge settings. A fresh installation without other overrides inherits standard/no-purge defaults. Existing local files/environment can override them, so no assertion is made about a live machine's effective settings.
- `darshan-player/src/common/config.ts:266`, `:403`, `:619`: file configuration and explicit environment overrides are supported; production mode does not by itself select secure offline locking.
- `darshan-player/src/common/offline-security-policy.ts:116`: lease expires at last successful backend contact plus lease duration. If a failure is recorded, the offline anchor is the later of that failure and last success. Otherwise the anchor is lease expiry. Lock time is that anchor plus `max(networkSwitchGraceMs, lockAfterOfflineMs)`; the lease check can still permit playback until the lease expires.
- Arithmetic example, not an executed test: enabling secure mode while retaining 120-second lease/lock defaults and recording no failure gives a nominal lock time 240 seconds after last success. A recorded failure instead anchors the grace period at failure detection. Therefore a 120,000-ms lock setting alone does not guarantee locking two minutes after physical loss of connectivity.
- `darshan-player/src/main/services/secure-playback-guard.ts:46`, `:54`, `:113`: successful contact resets failure/purge-request tracking; failure records an anchor; timers drive later evaluation. Heartbeat and pairing/bootstrap report contact outcomes (`player-flow.ts:356`, `:672`; `telemetry/heartbeat.ts:279`, `:312`, `:322`). Detection delay is separate from the configured interval.
- `darshan-player/src/main/services/player-flow.ts:526`: an active lock stops the playback engine. `darshan-player/src/common/player-content-source.ts:3` and `darshan-player/src/renderer/player.ts:288` suppress rendered schedule/default content. There is no emergency exemption in these lock branches.
- `player-flow.ts:552` invokes `darshan-player/src/main/services/media-cache-purge.ts:14` when locked and purge is due. This removes the `media`, `objects`, `quarantine` directories under the cache root and `cache-index.db`, recreating the directories. This is filesystem deletion, not a demonstrated secure-overwrite operation or a complete purge of all Electron/local data.
- Purge failure is logged. The guard sets its one-request flag before emitting; the flow's failure handler resets a different completion flag (`secure-playback-guard.ts:94`; `player-flow.ts:557`). These branches do not establish an automatic successful retry guarantee. Downloads/runtime loops and cache indexes also need assessment for repopulation after purge.

Assessment: lock, renderer suppression and targeted purge mechanisms exist, but the generated production default does not meet the newly confirmed policy. Timer semantics are not an exact two-minute disconnection guarantee. Emergency stop and cache removal must be verified end to end, not inferred from the presence of configuration fields.

QA targets: controlled outage measured independently of failure detection; 119/120/121-second boundaries with approved scheduling tolerance; no previous validation; silent/unreported failure; slow timeout/retries; grace versus lease configuration; active emergency, audio and webpage views; restart while offline; purge permission/disk failures; in-flight download/cache repopulation; recovery/redownload; preservation of identity and evidence queues. All remain unexecuted.

## BQ-008: Fixed Built-In Roles

Confirmed requirement: built-in roles stay fixed; customization uses custom roles.

Actual code:

- `darshan-server/src/server/index.ts:220` calls `syncSystemRolePermissions()` when creating the API server.
- `darshan-server/src/rbac/system-roles.ts:98` finds the four canonical built-in names and overwrites permissions with defaults. Custom role names are not in this reset loop.
- However, `darshan-server/src/routes/roles.ts:203` authorizes and saves updates to system roles; it does not reject all such updates. Its update schema accepts `name`, `description` and `permissions` (`:36`). `darshan-server/src/db/repositories/role.ts:75` saves those supplied fields.
- `darshan-cms/src/components/settings/RolesPermissionsTab.tsx:101`, `:193`, `:228` allows authorized built-in editing, including the role name. `darshan-cms/src/lib/access.ts:82` permits SUPER_ADMIN to edit all system roles and ADMIN to edit DEPARTMENT/OPERATOR.
- Startup reset is name-based; renaming a built-in role is not equivalent to an immutable default configuration.
- System-role deletion is explicitly rejected (`roles.ts:251`). Custom-role creation/persistence is implemented, but assignment through normal user routes is restricted as described under BQ-002.

Assessment: resetting built-in permissions at startup is only partial alignment. Editable built-ins during runtime conflict with the fixed-role requirement; reset-on-restart is not immutability. Custom-role persistence alone does not establish a usable end-to-end customization workflow.

QA targets: built-ins are read-only through UI and direct API; rename/inheritance/permission mutations cannot bypass this; system-role delete rejection; custom create/edit/assign/unassign/delete; restart/update persistence; inherited permissions and conditional grants. Existing editable-role behavior must not be accepted merely because it is implemented.

## BQ-009: Immediate Access Withdrawal

Latest stated acceptance policy: immediate removal of old access. The latest BQ-009 follow-up labels this "Immediate access withdrawal" and describes the implementation gaps below. Earlier notes mentioned a possible delayed alternative without a maximum; no such grace period is approved. This is a requirement, not a claim that the current code meets it.

Actual code, refreshed 2026-10-16:

- Every access-token verification joins the live session to an active, non-deleted user. Repository-backed user update and tombstone transactions lock the user and delete every target session before commit.
- User update, reset, activation and tombstone routes disconnect the target user's shared chat, notification and screen rooms after the database transaction commits.
- Login now verifies the password, then locks and rechecks the current user/password hash and takes a shared lock on the current role before inserting the session in that transaction. Consequently, either login commits first and a waiting account change deletes the new session, or the account change commits first and login cannot issue from the stale password/account row.
- Role-definition update locks the complete effective-permission graph, rechecks the actor/session, changes the role and deletes sessions for users assigned directly or through transitive inheritance in one transaction; the route then disconnects each affected local user room. Guarded owned-resource writes take the complementary graph lock, so a parent-role edit cannot leave a descendant-role session authorizing after commit.
- Custom-role deletion uses the same graph lock and is rejected while any direct or transitive inheritor still references the target. This prevents a delete from silently changing a descendant role's effective permissions; the PostgreSQL route regression is authored but remains unexecuted in the resource-safe phase.
- The separate administrator recovery/deactivation CLI deletes sessions transactionally, but as an out-of-process database tool it cannot directly disconnect sockets held by a live API process. The production runbook therefore requires the backend to be stopped for the change or all backend instances restarted immediately afterward.

Assessment: the ordinary API and role-definition source paths now implement committed-state withdrawal and deterministic login/account ordering. Runtime propagation, multiple live clients, all three namespaces, recovery procedure, and already-in-flight boundaries remain unverified; no runtime pass or grace period is claimed.

QA targets: next REST operation, refresh, multiple browsers, idle/active tabs, already-connected socket subscriptions and reconnect; user/role update commit as timing reference; stopped protected delivery after revocation; concurrent login versus password/role/department change; negative control for another unaffected account; and the stopped/restarted-backend recovery procedure. Old credentials/claims must not authorize subsequent forbidden operations after the change. Distinguish already-in-flight work and record observed propagation delay without treating it as an approved grace period. No runtime guarantee has been verified.

## Existing Tests Read, Not Run

Relevant files include CMS `src/lib/access.test.ts`; server `src/routes/users.test.ts`, `users-invite.test.ts`, `roles-permissions.test.ts`, `auth.test.ts`, `emergency.test.ts`; player `test/unit/common/offline-security-policy.test.ts`, `test/unit/services/secure-playback-guard.test.ts`, `player-flow.test.ts`.

The player policy tests explicitly model standard-mode allowance and additive lease/grace timing. They characterize existing behavior, not approval of this release's new two-minute lock rule. Test-file presence and assertions are not current test execution results.
