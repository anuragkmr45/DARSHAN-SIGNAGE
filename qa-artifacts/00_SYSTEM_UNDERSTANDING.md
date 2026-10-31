# System Understanding

Status: QA PLANNING RECONCILIATION IN PROGRESS, NOT READY FOR QA HANDOFF OR
RELEASE APPROVAL. The repository inventory and human-readable product map are
reconciled at the current application-source baseline; the rule catalogue,
business questions, risks, test catalogue and endpoint-level traceability still
require reconciliation.
Requirements 19-24 playback/recovery source, automation and two current Linux
Electron journeys have developer evidence.
The required no-Schedule/no-default company fallback image also remains a
separate blocker. Real network/capture/object-store failure, physical
platforms, security, capacity and soak remain QA/release gates.
An uncommitted 2026-10-22 P01 worktree delta changes account targeting,
built-in-role immutability and directory filtering; its static/build/unit
evidence is in
`evidence/packet-01-permission-developer-verification-2026-10-22.md`.

## Baseline And Scope

- Product: DARSHAN digital signage, CMS administration, and Electron playback.
- Application-source baseline: `release-01` at
  `db137152cdb8eda7ecf1f836df33e0373b9fc278`, matching
  `origin/release-01` before this QA-document refresh. QA artifact edits remain
  working-tree documentation until separately reviewed and committed.
- Source/runtime evidence refreshed: 2026-10-21. PDF/video targeted Linux
  runtime evidence remains dated 2026-10-15. These describe disposable
  developer environments, not a production site or independent QA result.
- 1,348 files are tracked at the application-source baseline. The refreshed
  inventory was generated from tracked files only; no untracked application
  source was included.
- 234 explicit Fastify method registrations were resolved to paths by static
  parsing. Some registrations are configuration-dependent, including
  `/metrics`; Socket.IO transports and generated framework routes are separate
  surfaces.
- 28 CMS route declarations contain an explicit path, including shell,
  catch-all and legacy aliases. This is not a count of 28 distinct product
  screens.
- 69 `pgTable` declarations and 15 enums in `darshan-server/src/db/schema.ts`;
  49 workspace SQL migrations through `0047`. The SQL-only
  `darshan_deployment_runs` table and pg-boss internals are additional data
  surfaces.
- 211 tracked workspace TypeScript/JavaScript `*.test`/`*.spec` files. Targeted
  browser/Linux Electron/DB execution is recorded in dated evidence, including
  `evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md`. Test-file
  presence alone is not proof.
- No tracked GitHub Actions, GitLab CI, Jenkinsfile, or Azure Pipelines file was found in the inspected file index. This does not establish whether external CI exists.

Primary machine-readable inventory: `evidence/repository-inventory.json`.

## User-Confirmed Release Scope

Business source: user answers BQ-001 through BQ-006 and follow-ups to BQ-002/003/004/008/009, 2026-09-24. These are intended outcomes, not runtime test results. Detailed comparison: `evidence/policy-behavior-review.md`.

- Documents: an author selects one static physical page per presentation occurrence; legacy/missing values remain page 1 and there is no automatic progression. Every release player is updated and connects once before page >1 is allowed. Invalid restored/runtime selections remain explicit and show `Unavailable` without page substitution. Supported extensions are `.pdf`, `.ppt`, `.pptx`, `.doc`, `.docx`, `.xls`, `.xlsx`, and `.csv`.
- Video loop/failure: an enabled occurrence repeats complete decoded-media cycles while active. Corrupt multi-item video shows `Unavailable` until its original boundary; a failed only-item frame retries at a clamped 1–30 second interval with one timer/attempt. Schedule end and every higher-authority change cancel media/retries; display/audio clearance target is <=250 ms.
- SUPER_ADMIN: deleting, disabling or demoting the last active direct SUPER_ADMIN is blocked; one of multiple active SUPER_ADMIN accounts may be removed. Global User managers can administer user types subject to this invariant.
- People directory: non-global users see active, non-deleted, sign-in-eligible people only in their own department across ordinary user/operator/chat-participant surfaces; pending/expired invitations remain in the separately authorized invitation directory without exposing tokens. Global `manage User` is the explicit exception.
- Emergency: conditional Screen delegates control only explicitly selected authorized direct screens, including clear; `manage Emergency` controls group/global scope.
- Offline player: secure production mode locks exactly 120 seconds after the last authenticated backend success, stops schedule/default/emergency and removes only media cache. Reachability cannot unlock; identity validation, forced fresh snapshot, current-content sync and authority apply precede recovery.
- Built-in roles: fixed; customization belongs in custom roles. The current P01 source makes public API/CMS mutations immutable, reserves case/space name variants, stops startup/maintenance on noncanonical identity and repairs permission drift only for exact-name `is_system=true` built-ins. PostgreSQL/startup/browser execution is still pending.
- Session withdrawal: immediate post-commit withdrawal is required. Account/password and direct/transitive permission changes revoke affected sessions transactionally, broadcast invalidation to every API node and disconnect local user rooms. Protected socket actions revalidate the stored handshake token, so a missed broadcast still fails closed on the next protected action. The out-of-process recovery CLI still requires stopped/restarted backend instances. Test post-commit operations separately from work already in flight.
- Integrations: management screens and their backing operations are in scope; actual SSO login, API-key request authentication and automatic webhook delivery are not release requirements.
- SSO management: the current API treats configuration list/upsert/deactivate as subject-wide operations requiring unconditional grants. The active-config list returns the stored client secret to an authorized reader; whether record-scoped delegation or this secret visibility is acceptable remains BQ-021, and API/browser runtime behavior is unverified.
- General Requests workboard: server and CMS surfaces are disabled for this release. Schedule Requests remain enabled and in scope.
- Custom roles: effective actions, subjects, inheritance and record conditions decide feature access, not the custom role's display name. Unfiltered settings/aggregate/collection surfaces require unconditional grants; current P01 source keeps Report, Dashboard, AuditLog and ProofOfPlay subjects distinct and evaluates concrete AuditLog/Screen details against their stored record.
- Schedule approval: user answer BQ-010 on 2026-09-25 permits administrator self-approval and direct administrator publishing. Other permissions, reservations and lifecycle controls remain applicable.
- Deleted users and content ownership: deletion creates a permanent tombstone, immediately ends sessions/sockets, scrubs email/credentials, stops incomplete uploads and preserves stable historical identity. Media, Layout, Presentation and Schedule stay owned by their original department or organization; unresolved legacy ownership is restricted to administrators. There is no automatic person reassignment or restore UI. Ability plus stable ownership governs every resource/nested route, Schedule Requests follow Schedule ownership, and published playback is not rewritten.
- Emergency video looping: the confirmed requirement is continuous complete native cycles for the lifetime of the same emergency takeover, with no harmless-refresh remount and immediate cleanup on clear/expiry/replacement/security lock/shutdown. The current working tree derives `loop_enabled=true` only for resolved READY emergency video snapshots; the existing player parser, equivalent-playlist fingerprint and native video lifecycle consume it. Resource-gated developer checks passed for player logic/build, server integration/build and the real CMS Chromium flow on 2026-10-27; independent packaged Windows/Ubuntu physical-player QA remains pending under BR-109/R-46/`PLAYER-17`.

The 2026-09-25 BQ-011/012 characterizations are superseded by the 2026-10-17 confirmed BR-097..102 webpage/default-priority/company-fallback contract. The current text-only NONE state conflicts with BR-102 and is tracked by DEF-04/R-38. BQ-013 remains a code characterization in `evidence/content-runtime-review.md`. Historical resource and OPERATOR-directory findings are superseded by the current authorization matrix; source closure is not a runtime pass.

Source review of BQ-014 through BQ-020 is recorded in `evidence/operational-behavior-review.md`. It establishes current report formulas, job schedules, player packaging, capacity-evidence validation, maintenance upgrade order, TLS paths and delete behavior. It also identifies values that source cannot establish: actual site workload, operational recovery time, external network exposure, retention policy and the supported hardware/browser matrix. These remain explicit acceptance inputs in the final test plan.

## Runtime Map

| Runtime | Implementation | Responsibility and dependencies |
| --- | --- | --- |
| CMS browser | React 18, Vite, React Router, TanStack Query, Redux; `darshan-cms/src/App.tsx`, `AuthenticatedAppShell.tsx` | Operator UI, forms, uploads, previews, reports, Socket.IO updates. Browser-visible runtime config is not a secret store. |
| API | Fastify, TypeScript, Zod, CASL; `darshan-server/src/server/index.ts` | Authentication, permissions, resource validation, publish authority, device endpoints, REST, realtime wake-ups. |
| Worker | `darshan-server/src/runtime/bootstrap.ts`, `darshan-server/src/jobs/index.ts` | pg-boss workers for processing, telemetry, backup, cleanup, emergency reconciliation. Production uses a separate process/container from API. |
| PostgreSQL | Drizzle schema/repositories, migrations and production baseline | Durable business data, snapshots, commands, outbox, desired state, sessions, job queue, deployment ledger. |
| MinIO/S3 | `darshan-server/src/s3/index.ts` | Source/staged/processed media, previews, screenshots, logs and archives. Signed URLs are access-bearing data. |
| Valkey | `darshan-server/src/realtime/realtime-bus.ts`, `darshan-server/src/auth/login-throttle.ts` | Cross-process realtime fanout and configurable login throttle/replay support; not the durable command or media store. |
| Player | Electron 33, main/preload/renderer; `darshan-player/src/main/index.ts` | Pairing identity, request signing, local cache, timed playback, display detection, commands, PoP, screenshots, offline recovery. |
| Observability | `deploy/shared/observability`, generated production role | Prometheus, Alertmanager, Grafana, exporters and TLS metrics gateways. Application readiness is separate from scrape availability. |
| Build/release/recovery tools | `scripts/export`, `scripts/bundle`, backend `darshan-server/src/deployment`, backend `darshan-server/scripts/restore-offhost-backup.ts` | Compile/package/sign roles; validate configuration; install/update/adopt; independently verify off-host recovery. |

The backend runtime image includes FFmpeg, LibreOffice, PostgreSQL client tools and, for a validated production bundle, Playwright/Chromium. Both API and worker images contain tools; job handlers perform conversion/transcoding/capture in the worker. Report PDF rendering is also a backend concern, so QA must not assume every Chromium invocation belongs only to the worker.

Evidence: `darshan-server/Dockerfile`; `darshan-server/src/runtime/bootstrap.ts`; `darshan-server/src/jobs/index.ts`; `darshan-server/src/routes/reports.ts`; `darshan-server/src/utils/pdf-render.ts`.

## Current Product Surface

This section is a human-readable map of the current source. Exact route records
remain in `evidence/repository-inventory.json`. Counts below are static route
registrations, not proof that a workflow succeeds at runtime.

### CMS routes and screens

| Area | Current routes and behavior | Primary source |
| --- | --- | --- |
| Public entry | `/` is the public home page and `/login` is the login page. The outer `/*` route loads the authenticated application shell. | `darshan-cms/src/App.tsx` |
| Operate | `/dashboard`, `/screens`, `/schedule`, `/schedule/new`. Emergency takeover is a permission-controlled modal in Schedule Queue rather than a separate route. | `darshan-cms/src/AuthenticatedAppShell.tsx`; `darshan-cms/src/pages/ScheduleQueue.tsx` |
| Create content | `/media`, `/layouts`, `/layouts/new`, `/layouts/:id`. Presentation creation and slot assignment are embedded in the schedule-creation journey; there is no separate Presentation page. | `darshan-cms/src/pages/MediaLibrary.tsx`; `Layouts.tsx`; `LayoutEditor.tsx`; `ScheduleCreator.tsx` |
| People | `/departments`, `/operators`, `/users`. Route visibility uses effective module permissions; record visibility and mutation still depend on server-side scope and target checks. | `darshan-cms/src/lib/access.ts`; `darshan-cms/src/pages/Departments.tsx`; `Operators.tsx`; `Users.tsx` |
| Collaboration | `/chat` plus conversation/thread variants is the canonical rich chat UI. `/conversations` variants are legacy URL aliases to the same page. `/notifications` is separate. | `darshan-cms/src/AuthenticatedAppShell.tsx`; `darshan-cms/src/pages/Conversations.tsx`; `Notifications.tsx` |
| Evidence and configuration | `/reports` and `/settings` are sidebar destinations. `/api-keys`, `/webhooks`, `/sso-config` and `/proof-of-play` are direct permission-guarded routes and are not separate sidebar items. | `darshan-cms/src/AuthenticatedAppShell.tsx`; `darshan-cms/src/components/layout/AppSidebar.tsx` |
| Denied/unknown navigation | Every inner route is wrapped by the authenticated shell and its own module/permission guard. An unmatched authenticated path renders Not Found; an unauthenticated request to an inner path is redirected through login. | `darshan-cms/src/components/auth/ProtectedRoute.tsx`; `darshan-cms/src/pages/NotFound.tsx` |

The 28 explicit CMS path declarations consist of three outer declarations and
25 authenticated-shell declarations, including aliases and catch-all routes.
They do not represent 28 distinct feature screens. The sidebar exposes 12
destinations after permission filtering.

### Backend HTTP surface

| Route family | Explicit routes | Registered modules and responsibility |
| --- | ---: | --- |
| Health and metrics | 6 | Four `/api/v1/health*` routes, dashboard `/api/v1/metrics/overview` and the Prometheus `/metrics` scrape endpoint |
| Identity and access | 24 | Auth, users, invitations/activation, departments, roles and permission catalogue |
| Content composition | 30 | Media/upload/preview, layouts and presentations/slots |
| Scheduling | 24 | Schedules/items/publish, Schedule Requests and reservations |
| Screens and devices | 55 | Screens/playback/commands/cache/display, screen groups, pairing and device telemetry |
| Emergency and proof | 11 | Emergency lifecycle and proof-of-play query/export |
| Collaboration | 36 | Rich chat, legacy conversation compatibility routes and notifications |
| Administration and evidence | 48 | Settings, reports, audit/security events, observability, API keys, SSO configuration and webhooks |
| **Total** | **234** | Exact method/path/file records are machine-readable in the inventory |

`darshan-server/src/server/index.ts` registers the route modules explicitly.
The general Requests workboard is not registered and its former route,
repository and CMS page files do not exist. Only the distinct Schedule Requests
surface remains, with ten explicit `/api/v1/schedule-requests*` registrations.
Socket.IO namespaces (`/device`, `/screens`, `/chat`, `/notifications`) are not
part of the 234 HTTP-route count.

### Player surface

| Player area | Responsibility | Primary source |
| --- | --- | --- |
| Identity and onboarding | Local device identity, certificate/private key, pairing code, confirmation and recovery | `darshan-player/src/main/services/pairing-service.ts`; `darshan-player/src/main/services/player-flow.ts` |
| Authority and synchronization | Snapshot polling, realtime wake-up, schedule/default/emergency selection, secure offline lock and recovery | `darshan-player/src/main/services/snapshot-manager.ts`; `darshan-player/src/main/services/schedule-manager.ts`; `darshan-player/src/main/services/realtime-service.ts`; `darshan-player/src/main/services/secure-playback-guard.ts` |
| Playback | Multislot timelines, image/video/document/webpage rendering, page selection, loop/failure behavior and hard authority boundaries | `darshan-player/src/renderer/player.ts`; `darshan-player/src/renderer/pdf-playback.ts`; `darshan-player/src/renderer/scheduled-video-lifecycle.ts`; `darshan-player/src/renderer/webpage-playback.ts` |
| Local persistence | Revision-aware media cache, request queue, proof-of-play/log queues and identity-preserving secure purge | `darshan-player/src/main/services/cache`; `darshan-player/src/main/services/network/request-queue.ts`; `darshan-player/src/main/services/pop-service.ts` |
| Field operation | Display detection/selection, fullscreen/autostart, power schedules, diagnostics, screenshots and recovery/reset CLI | `darshan-player/src/main/services/display-manager.ts`; `darshan-player/src/main/services/power-manager.ts`; `darshan-player/src/main/cli.ts` |

## Trust And Data Flows

1. Browser -> CMS HTTPS origin -> verified HTTPS backend proxy for REST and Socket.IO. Login uses server sessions plus JWT/cookies, CSRF and origin controls. UI route hiding is not authorization.
2. CMS upload -> backend upload session -> signed object-storage URL under the CMS origin -> CMS proxy -> MinIO TLS. Backend checks authoritative object size/checksum and promotes staged objects; worker processing determines readiness.
3. Schedule author -> schedule/items/presentation -> request hold -> administrator approval -> immutable published snapshot and per-screen reservation -> device refresh command/outbox -> player REST fetch/cache -> display.
4. Player HTTPS requests use device identity/signatures; Socket.IO `/device` provides wake-up and synchronization messages. Polling/heartbeat continue as fallback. REST ACK and DB state remain authoritative.
5. Webpage media has two relevant execution environments: backend capture and isolated native player web content. Host/resource/CIDR/port restrictions, redirects, certificates, unavailable pages and fallback imagery need separate checks.
6. Player -> backend telemetry endpoints -> pg-boss/worker -> PostgreSQL and object logs -> CMS reports/monitoring. A queued event is not yet proof of durable report availability.
7. Settings API/production scheduler -> PostgreSQL `backup_runs` plus pg-boss in one transaction -> fenced worker attempt. Production explicitly selects retained `LEGACY_OFF_HOST` or `LOCAL_FILESYSTEM`; the latter is worker-only in the current bundle. Packet 1 validates policy/mount/coordination. Packet 2 closes a PostgreSQL-authoritative five-minute maintenance barrier, drains durable operation permits, gates API/worker/upload mutations, keeps operational player paths live, lets emergency preempt, and seals protected raw DB/object staging before packaging. Packet 3 adds strict configuration-capsule, deterministic package, pinned age, signed-manifest, atomic publication/read-back, database-fencing, restart-reconciliation and offline-discovery primitives. The worker now negotiates and injects one pinned helper policy plus the publication inspector, but the repository still lacks the deployable privileged helper/cross-role capsule producer and production-equivalent runtime proof. Packets 4-7 still provide retention, restore/promotion/recovery generation and final operator/CMS workflow. Existing independent off-host recovery tooling remains separate.
8. Account administrator -> DELETE user -> one tombstone transaction locks identity, aborts unfinished upload state, revokes sessions, scrubs access-bearing fields and writes audit -> post-commit object cleanup and shared-room disconnect. Completed content, schedule history and player snapshots retain their stable owner/attribution; failed cleanup remains retryable.

Source-free does not mean uninspectable software. The current production image packages compiled JavaScript and compiled CLI tools, rather than the old source-checkout image layout. CMS/player JavaScript remains executable and inspectable. See `darshan-server/Dockerfile`, `darshan-server/scripts/build-production-package.mjs`, and `scripts/bundle/build-production-bundle.mjs::assertBundleContract`.

## Personas And Roles

Personas are QA actors, not additional database roles.

| Persona | Implemented identity | Important boundary |
| --- | --- | --- |
| Site owner/security administrator | `SUPER_ADMIN` | Effective `manage all`; user-target policy permits every named role/custom role, subject to the atomic last-active-SUPER_ADMIN invariant. New content is restricted/private. |
| Site administrator/content approver | `ADMIN` | Broad grants except branding without an explicit branding grant. Unconditional global User authority permits account targets across role types, subject to the last-active-SUPER_ADMIN invariant; it does not itself authorize role-definition edits. New content is organization-shared. |
| Department coordinator | `DEPARTMENT` | Built-in grants allow organization/same-department reads. Media/Layout/Presentation mutation remains creator-only, Schedule permits same-department management, and User management is limited to same-department OPERATOR accounts. |
| Content/scheduling operator | `OPERATOR` | With the relevant ability, reads organization and same-department content; Media/Layout/Presentation mutations remain creator-only, while Schedule permits same-department management. Non-global directory results are department-scoped. |
| Custom-role user | Persisted role with grants/inheritance | Effective grants and conditions govern feature access regardless of display name. An unconditional effective `manage User` grants global account targeting; otherwise permitted account management is limited to same-department built-in OPERATOR targets. New content is organization-owned when the role can globally manage that subject; otherwise creation requires a department and creates department-owned content. All built-in role definitions remain immutable through API/CMS. |
| Conversation owner/moderator/member | Chat `OWNER`, `CHAT_ADMIN`, `MOD`, `MEMBER` | Per-conversation roles; system admins have special non-DM access. Not equivalent to global application roles. |
| Player/device | Device ID, certificate/private key, backend pairing | Not a CMS user. Revoke, expiry, stale identity, environment mismatch and duplicate identity must be distinguished from network loss. |
| Infrastructure/release operator | Host/Docker account and pinned trust material | Installs signed roles; must preserve volumes and identities. An approval-ticket string is an audit reference, not an authentication token. |
| Independent recovery operator | Isolated target, separate read credentials and attestation key | Must not rehearse into production or forge approval evidence. |
| Support/auditor | Existing authorized user or local player CLI operator | Access to screenshots, PoP, logs, diagnostics and recovery is sensitive and needs approved scope. |

Evidence: server `darshan-server/src/rbac/system-roles.ts`, `darshan-server/src/rbac/policy.ts`, `darshan-server/src/rbac/index.ts`, `darshan-server/src/db/repositories/chat.ts`; CMS `darshan-cms/src/lib/access.ts`; player `darshan-player/src/main/cli.ts`.

P01 worktree directory nuance: `canAccessDirectoryUser()` and the Users/Invite
list predicates require active, non-deleted same-department users for
non-global actors; the same predicate is applied before count/pagination.
An active actor without a department can discover self only when a matching
read grant exists. A global User manager can see disabled, non-deleted users.
These are source expectations; the full runtime privacy matrix is not yet run.

Evidence: `darshan-server/src/rbac/user-directory.ts::canAccessDirectoryUser`;
`darshan-server/src/db/repositories/user.ts::list`; `darshan-cms/src/pages/Operators.tsx`;
`darshan-cms/src/hooks/chat/useChatQueries.ts`.

## Use-Case Catalogue

These are scope/use-case IDs, not executed test cases. Each final case will reference one or more of them.

| ID | Journey and principal actor | Critical alternate/failure path | Source anchors |
| --- | --- | --- | --- |
| UC-001 | Bootstrap/recover a production administrator; release/security operator | Existing database, interrupted bootstrap, protected password file, wrong approval/evidence | Server `darshan-server/src/deployment/production-bootstrap.ts`, `admin-recovery.ts`; bundle lifecycle generator |
| UC-002 | Login, session refresh, logout, invite/activate/reset; CMS user | Invalid/inactive account, throttle outage, expired/revoked session, concurrent tabs | Server `darshan-server/src/routes/auth.ts`, `users-invite.ts`, `users-activate.ts`; CMS `darshan-cms/src/api/apiClient.ts` |
| UC-003 | Manage departments/users/operators and tombstone an account; authorized manager | Wrong target role, repeated deletion, active sessions/sockets/uploads, reused email, retained history, deletion of an owning department | Server user/department routes and repositories; `src/rbac/policy.ts`; migration `0045` |
| UC-004 | Configure roles, settings and branding; administrator | Conditional grants, inheritance cycles, forbidden branding, restart persistence | Server `darshan-server/src/rbac/index.ts`, `system-roles.ts`, `darshan-server/src/routes/roles.ts`, `settings.ts` |
| UC-005 | Upload/resume/abort verified media; content author | Lost response, duplicate key, wrong SHA-256/parts, URL expiry, cross/deleted-user session, deletion versus activation/finalization and cleanup retry | CMS upload flow; server media/user/upload repositories and routes |
| UC-006 | Process video/documents and inspect previews; content author | Missing tools, worker retry, corrupt/encrypted file, partial object promotion, PDF page count | Server `darshan-server/src/jobs/index.ts`; player `darshan-player/src/renderer/pdf-playback.ts`; CMS `darshan-cms/src/components/common/MediaPreview.tsx` |
| UC-007 | Add/display webpage media; content author and player | Rejected destination, redirect/resource block, TLS failure, offline fallback, empty/crashed page | Server `darshan-server/src/utils/webpage-capture.ts`; player `darshan-player/src/main/services/webpage-view-manager.ts` |
| UC-008 | Create/edit/share stable-owner layouts; content author/custodian | Duplicate/out-of-bounds slots, peer/moved/deleted creator, organization/restricted scope, owner-department deletion, display mismatch | Server layouts route/repository and central ownership helper; CMS Layouts/Editor |
| UC-009 | Compose stable-owner presentation/slot media and select a static page per document occurrence; content author | Unready/missing/inaccessible or scope-incompatible media/layout, invalid page, same document with different pages, atomic replacement, creator deletion/transfer | Server presentations routes and central ownership helper; CMS schedule creator |
| UC-010 | Create stable-owner schedule, preview content/conflicts and submit hold; operator | Adjacent/overlapping windows, inaccessible/incompatible Presentation, creator/requester transfer/deletion, timezones, group expansion, concurrent submit | Server schedule/request/reservation paths |
| UC-011 | Approve/reject/publish request or direct admin publish | Deleted requester, original-owner custody, expired hold, stale revision, duplicate publish, inaccessible nested content, invalid page/incapable player | Server schedule-request/publish helper paths |
| UC-012 | Continue/cancel/take down retained work; original department custodian/admin | Creator/requester deleted or moved, repeated takedown, disconnected player, reservation release, unchanged published snapshot | Reservation/schedule/request services; player snapshot manager |
| UC-013 | Pair a new physical player; field operator and CMS admin | Expired/duplicate code, CSR failure, unconfirmed pairing, wrong site | Server `darshan-server/src/routes/device-pairing.ts`; player `darshan-player/src/main/services/pairing-service.ts`, `player-flow.ts` |
| UC-014 | Recover/revoke/delete an existing device identity | Partial local identity, revoked cert, orphan screen, offline backend, safe cache/queue handling | Server pairing/recovery services; player flow and cert manager |
| UC-015 | Manage screens, groups, membership and display selection | Stale display observation, missing monitor, group change during publish/emergency | Server `darshan-server/src/routes/screens.ts`, `screen-groups.ts`, `services/screen-display-state-service.ts` |
| UC-016 | Send and track remote commands; screen administrator | Duplicate/expired delivery, stale lease ACK, reboot interruption, dead letter | Server `darshan-server/src/services/command-lifecycle-service.ts`; player `darshan-player/src/main/services/command-processor.ts` |
| UC-017 | Play timed/multislot media through restart/offline conditions | Cache miss/full/corrupt, clock skew, future/ended window, secure lock, renderer crash | Player snapshot manager, playback policy, renderer/player, cache manager |
| UC-018 | Assign and resolve screen/group/aspect/global default media | Multiple matching groups, missing/unready object, assignment removal | Server `darshan-server/src/utils/default-media.ts`; CMS `DefaultMediaSection`; player default-media service |
| UC-019 | Trigger/clear/expire emergency takeover; authorized administrator or delegated user | Delegation scope, severity ties, message capability mismatch, lost notification, offline lock | Server `darshan-server/src/routes/emergency.ts`, `screens/playback.ts`, emergency-transition outbox; player snapshot manager; user answer BQ-003 |
| UC-020 | Report heartbeat, screenshot, PoP and cache problems; device | Retry/deduplication, queue overflow, restart gaps, async persistence delay | Server `darshan-server/src/jobs/device-telemetry.ts`; player telemetry, screenshot and PoP services |
| UC-021 | Chat/DM/group/forum/thread/reaction/pin/bookmark/moderation | Removed member, private DM, duplicate send, archived write, attachment cleanup | Server `darshan-server/src/routes/chat.ts`, `darshan-server/src/db/repositories/chat.ts`; CMS chat components/hooks |
| UC-022 | Receive/read notifications and reconcile counters; user | Duplicate/out-of-order event, read-all race, disconnect/reconnect | Server notification repositories/namespaces; CMS notifications/chat hooks |
| UC-023 | Verify the disabled general Requests workboard remains absent while Schedule Requests continue; release/QA owner | Old `/api/v1/requests*` or `/requests` surfaces reappear, legacy rows leak, or Schedule Requests are accidentally disabled | Server registration `darshan-server/src/server/index.ts`; CMS routes `darshan-cms/src/AuthenticatedAppShell.tsx`; static guard `darshan-server/src/deployment/requests-disabled.unit.test.ts`; user answer BQ-006 |
| UC-024 | Inspect/export reports, PoP, audit/security events; authorized user | Empty datasets, time boundaries, report semantics, export exposure | Server `darshan-server/src/routes/reports.ts`, `proof-of-play.ts`, `audit-logs.ts`, `security-events.ts` |
| UC-025 | Manage API keys, SSO configuration, webhook subscriptions; management-only release scope | One-time secret display, persistence, access control, validation and exposed outbound Test action; runtime integrations excluded | Server API-key/SSO/webhook routes; matching CMS pages; user answer BQ-005 |
| UC-026 | Diagnose/monitor site and player health; support/ops | Readiness versus liveness, scrape failure, missing worker, secret redaction | Server `darshan-server/src/runtime/readiness.ts`; `deploy/shared/observability`; player diagnostics/health |
| UC-027 | Build/install/update/adopt/partially replace signed roles | Bad signature/provenance, low disk, wrong volume/site/generation, interrupted migration | `scripts/bundle`; server migration/deployment-state modules |
| UC-028 | Back up, restore, rehearse disaster recovery; ops/recovery authority | Live data churn, incomplete manifest, corrupt archive, unsafe/nonempty target, stale evidence | Server `darshan-server/src/utils/backup-runs.ts`, `darshan-server/src/deployment/backup-contract.ts`, `darshan-server/scripts/restore-offhost-backup.ts` |
| UC-029 | Install/autostart/operate packaged player in fullscreen; field support | Windows/Ubuntu differences, hotplug/portrait/DPI, pinned display fallback, CLI reset | Player package manifest, runtime-mode, display-manager, autostart, power-manager, CLI |

## State Models And Calculations To Preserve

- Media: `PENDING -> PROCESSING -> READY/FAILED`; uploaded image/PDF and conversion-required documents have different paths. Resumable upload states are separate from media readiness.
- Upload session: creation/activation/finalization/completion versus failure, expiry and abort; finalization claim and authoritative S3 part inventory need interruption/concurrency cases.
- Schedule request: `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `PUBLISHED`, `TAKEN_DOWN`, `EXPIRED`. Reservation: `HELD`, `RESERVED`, `PUBLISHED`, `RELEASED`, `EXPIRED`, `CANCELLED`. Not every pair is a valid transition.
- Conflict uses half-open `[start,end)` windows: `existing.start < incoming.end && incoming.start < existing.end`; PostgreSQL exclusion backs active ownership. Group members resolve to concrete screens.
- Publish captures schedule revision and media/layout/display data; edits and stale approval must not silently change committed playback expectations.
- Emergency selection sorts severity, scope, recency, then ID; expiry and clear change authority. Playback precedence is emergency, scheduled content, default media, then empty/offline behavior, subject to identity/security restrictions.
- Default media resolves SCREEN, then matching GROUP by numeric priority descending with target ID ascending as the stable tie-break, then ASPECT_RATIO, GLOBAL and NONE. Editing an assignment does not implicitly change its priority.
- Command schema retains legacy and normalized states; use actual claim/ACK/expiry/cancel transitions rather than asserting every declared enum is always used.
- Player state includes boot, local identity, authentication, pairing phases, paired runtime, offline validated pairing, soft/hard recovery. Identity failure is not the same event as a temporary transport failure.
- Playback resume with a schedule start is wall-clock based. Multiple items repeat as a cycle; a single non-looping item can hold its terminal frame. Persisted progress is an alternate path with identity/freshness checks.
- Display orientation is calculated from detected bounds; ratio reduces width/height by greatest common divisor. Native resolution, DIP/CSS sizes, rotation and scaling must not be conflated.
- PoP duration derives from actual start/end event times. Bounded replay budgets can drop old events. Do not assume crash gaps or lost telemetry count as verified playback.
- Reports `screen_uptime_percent` currently calculates `ACTIVE / (ACTIVE + OFFLINE) * 100`, rounded to two decimals, or null for zero denominator. This is a fleet snapshot, not historical uptime.

Evidence: server schema, reservation service, `screens/playback.ts`, `utils/default-media.ts`, `routes/reports.ts`; player `common/playback-policy.ts`, `common/display-profile.ts`, `main/services/pop-service.ts`.

## Jobs And External Dependencies

Worker queues found: `playback:refresh-dispatch`, `telemetry:heartbeat`, `telemetry:proof-of-play`, `telemetry:screenshot`, `ffmpeg:transcode`, `ffmpeg:thumbnail`, `document:convert`, `webpage:verify-capture`, `webpage:refresh-due`, `archive`, `cleanup`, `chat:media-cleanup`, `backup`, `backup:check`, `emergency:reconcile`.

Recurring registrations include hourly session/upload cleanup at minute 15,
weekly log archive on Sunday at 03:00, a deployment-time daily production
backup check with local-date/DST identity (development/QA retain hourly eligibility),
minute-level emergency reconciliation and hourly due-webpage scanning at minute
20. These are pg-boss cron expressions in the worker environment; a scheduler
registration interval is not itself a promised business completion deadline.

Dependency families: PostgreSQL/pg-boss, MinIO/S3, Valkey, browser/player transport trust, DNS/time synchronization, FFmpeg, LibreOffice, Chromium/Playwright, PDF.js renderer assets, OS graphical session/drivers/autostart, Prometheus/Alertmanager/Grafana, webpage destinations and optional webhook receivers. SSO login and business-event webhook delivery remain scope questions, not assumed working integrations.

For each dependency, final cases must cover denied credentials, timeout, unavailability, slow response, malformed result where relevant, retry exhaustion, duplicate work and recovery consistency. These are planned tests only, on isolated environments.

## Deployment And Recovery Findings

- Source-checkout development/QA and signed source-free production are distinct acceptance profiles. A dev-mode pass cannot establish TLS, filesystem, image-content or air-gap correctness.
- Current bundle flow: config loader -> export artifacts -> verify release/source provenance -> assemble roles -> verify bundle contract -> signed transfer archives. Five serving VM roles plus an isolated recovery role and separate player artifacts.
- Source-free backend install persists deployment steps and separates backend acceptance from final CMS acceptance. Retry after interruption must be tested at each persisted step.
- Managed upgrade validates independently signed restore evidence and stops API/worker before migration; database rollback is not equivalent to restoring an old image. Legacy adoption is a separate ticket/fingerprint path and needs its own maintenance verification.
- Stable stateful volumes, host preparation, active-release guards, independent release trust, compatibility generation, protected secret handling and disk checks are test surfaces, not proof of safe deployment by inspection.
- Cross-VM app and generated monitoring links use TLS verification. Some exporter hops inside the role Docker network remain HTTP. Preserve this distinction in transport checks.
- Backup contract includes durable media, screenshots and logs including `logs-auth`; `archives` includes only `logs/`; staging and recursive local-backup archives are intentionally excluded. Restore validates object paths and verifies restored hashes.
- Backup/recovery Packet 1 adds explicit mutually exclusive repository policy; daily time/timezone/retention metadata; local path/device/owner/mode/free-space preflight; transactionally coupled run/job creation; one-active and one-automatic-date indexes; job/attempt/lease/deadline/cancellation fencing; typed terminal prerequisites; bounded transient retry; recurring stranded-run reconciliation; process/network abort; and worker-only bundle placement. Migration `0049` expands legacy `backup_runs`.
- Packet 2 migration `0050` adds per-site capture authority/history and durable operation permits. HTTP and hidden socket/read writers are deny-by-default; gated pg-boss work acquires admission before fetch; signed browser PUTs traverse the Backend; telemetry queues durably; emergency state changes preempt; watchdog expiry reopens; raw PostgreSQL/object staging seals before packaging.
- Packet 3 migration `0051` and backup modules implement encrypted publication primitives and crash-safe verification, with bounded developer unit/PostgreSQL/native-age evidence. The worker now injects the pinned helper configuration contract, canonical-manifest signer/verifier and reconciliation inspector, and fails startup when helper policy is absent/invalid. The actual privileged helper/service, exact all-role capsule producer, retained verification-key rotation and production PostgreSQL+MinIO run remain open. BQ-027 is resolved by the confirmed narrow-helper/key-separation/failure-domain architecture; site repository/capacity/schedule/trust/inventory values remain deployment inputs. Retention, restore/promotion, recovery generation and final operator UI remain Packets 4-7.

Evidence: `scripts/bundle/build-production-bundle.mjs`; `assemble-runtime-bundle.sh::write_backend_lifecycle_scripts`, `write_production_role_controls`; `install-signed-role.sh`; server `darshan-server/src/deployment/migration-ledger.ts`, `restore-evidence.ts`, `backup-contract.ts`.

## User-Stated Infrastructure, Not Live-Verified Capacity

| VM | vCPU | RAM | Disk |
| --- | --- | --- | --- |
| Data | 2 | 5120 MB | 50 GB |
| Backend | 3 | 4608 MB | 30 GB |
| CMS | 1 | 1536 MB | 15 GB |
| Valkey | 2 | 2048 MB | 12 GB |
| Observability | 1 | 2048 MB | 25 GB |

These values came from the user's earlier deployment information. Fleet size, media volume, worker concurrency, player hardware, live free disk, and accepted SLO/RPO/RTO are not verified. They cannot be used to assert production capacity. Backend backup scratch and Docker extraction can require substantially more disk than a compressed archive.

## Initial Risk Themes

Prioritize authorization across UI/REST/realtime, persistent privilege changes, offline identity/security policy, schedule concurrency/time boundaries, emergency delivery, media integrity and conversion, PoP loss/semantics, staged update/restore consistency, TLS trust/routing, low disk and worker resource pressure. Integration screens and old documentation can overstate capability.

These are risk hypotheses and source-observed inconsistencies unless the dated runtime report says otherwise. The targeted run found and corrected three feature-related runtime defects, but it is not a release pass/fail judgment for the full product.

## 2026-10-15 Document Page Selection Delta

The architecture now adds `media.page_count`, occurrence-level `page_number`, immutable snapshot propagation, a `pdf_page_selection_v1` player capability gate, selected-page PDF.js rendering in CMS/player, and page-aware proof-of-play. Native PDFs and converted Office/CSV files both obtain their count from the final playable PDF. See `evidence/document-page-selection-review.md` for the simulated flow, corner cases, and explicit non-execution limits.

## 2026-10-17 Webpage And Default-Priority Delta

Webpage URLs now pass one explicit policy in both capture and player paths.
HTTP remains off in source defaults and is explicitly enabled by the release
bundle; HTTPS remains supported. Userinfo, HTTP authentication and persistent
login profiles are unsupported. Each redirect/navigation hop is revalidated by
scheme, host, port, DNS result and CIDR.

Migration `0047` adds preview revision/checksum/capture/attempt metadata.
Manual refresh and the 24-hour due scheduler use compare-and-set job ownership;
only a successful capture advances the content-addressed object and revision.
Snapshots and defaults carry that identity to a revision-aware player cache.

Default-media GROUP assignments now carry priority `0..100`. Resolution is
SCREEN, GROUP priority descending with target-ID ascending tie-break,
ASPECT_RATIO, GLOBAL, NONE. Settings carry a revision and use a PostgreSQL
transaction advisory lock so two same-revision writes cannot both commit.

## Existing QA Evidence And Gaps

- Backend route tests use a dedicated test database guard and disable file parallelism. The focused page/loop suites ran against a freshly migrated disposable `_test` database; unrelated route suites remain unexecuted.
- CMS Playwright configuration targets Chromium and may start Vite. Representative screen tests intercept routes and use mocked responses. Such cases do not prove actual VM/API/player integration.
- Player tests include unit, integration, fault, browser and performance files. Their names do not prove real hardware or outage execution.
- The source-free validator builds fixtures and has optional Docker actions. Its backend role check starts node-exporter/metrics gateway, not a complete fresh API/worker/CMS/player site acceptance. Packet 1 exercised both generated repository modes, but that bounded validator result is not full-topology acceptance.
- The 2026-10-28 Packet 1-3 developer reports record focused unit, real disposable PostgreSQL/pg-boss integration, migration-ledger, route/gateway, signed MinIO upload, combined API/worker runtime, parser, source-free validator, native age and build evidence. Those results support the design but do not populate human QA result fields and do not prove actual-player five-minute availability, production trust wiring, retention, restore/promotion, independent-copy failure domains or full production topology.
- Older `docs/qa/FEATURE_INVENTORY.md` rows describe mocked SSO/webhook CMS pages; current pages call persisted APIs. Older architecture text describes a combined backend container; current generated production deployment is split. Recheck current source before inheriting any historical expected result.
- Historical product/API documents still mention the removed general Requests route/page/repository, including `darshan-server/docs/api_catalog.json`, `docs/contracts/backend-api-catalog.md` and `docs/architecture/product-architecture.md`. They are documentation drift, not a current executable surface. The current server/CMS registrations and the Requests-disablement guard are authoritative for this release map.

## Analysis Limits

This is a repository-wide surface inventory plus a current human-readable map,
risk-focused tracing and targeted historical developer evidence, not a claim to
have read and proved every source line. Step 1 repository mapping is complete
for this baseline. No application or test process was run during the 2026-10-21
inventory/map reconciliation. No live VM, certificate store, production
archive, physical player hardware, external identity provider or production S3
destination was accessed. No secret/configuration values from private
environments were needed. Only explicitly dated runtime reports are execution
evidence.

The detailed cases, traceability, security/performance/reliability plans, data requirements, suites and release gates are present in this package. QA's next step is authorized execution and evidence capture. An external target or business acceptance decision not supplied by code or user remains explicitly TBD; test observations must not silently approve it.

## Controlled Recovery Packet 3 Addendum — 2026-10-30

The reduced operator surface now projects independent verified-success, failure, active-attempt, capacity and retention health; streams only exact trusted ciphertext artifacts after fresh authorization; and displays a signed deployment-imported recovery report projection. The CMS cannot access recovery roots or Docker and cannot start restore, promotion, acceptance or rollback. These are developer fixture/source results only; live repository streaming, Docker recovery, topology and RTO remain pending.
