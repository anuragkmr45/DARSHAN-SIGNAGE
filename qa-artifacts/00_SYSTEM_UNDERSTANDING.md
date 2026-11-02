# System Understanding

Status: PRE-QA DEVELOPMENT VERIFICATION IN PROGRESS, NOT RELEASE-APPROVED. The
requirements 19-24 playback/recovery source, automation and two current Linux
Electron journeys are developer-verified. The beta6 player-delivery,
availability and observability candidate also passed focused automation,
source-free package acceptance and one packaged Linux AppImage journey.
The required no-Schedule/no-default company fallback image also remains a
separate blocker. Real network/capture/object-store failure, physical
platforms, the five-VM/player observability network, security, capacity,
restore and soak remain QA/release gates.

## Baseline And Scope

- Product: DARSHAN digital signage, CMS administration, and Electron playback.
- Current delta: `codex/dashboard-observability-report-audit-20261102`; beta6
  implementation/developer-evidence tip `6a34b2f`.
- Source/runtime evidence refreshed: 2026-11-02 for delivery, availability and
  observability. PDF/video targeted Linux runtime evidence remains separately
  dated. These describe disposable developer environments, not a production
  site or independent QA result.
- 1,393 files are tracked at this candidate. Freeze the final reviewed merge
  commit and rebuilt artifact hashes before QA.
- The explicit route and CMS declaration counts in
  `evidence/repository-inventory.json` are a historical supporting inventory;
  use the current route registrations for execution and regenerate that broad
  inventory before treating its totals as release evidence.
- 71 `pgTable` declarations and 15 enums are present in
  `darshan-server/src/db/schema.ts`; workspace SQL migrations run through
  `0053`. The SQL-only
  `darshan_deployment_runs` table and pg-boss internals are additional data
  surfaces.
- 219 workspace TypeScript/JavaScript `*.test`/`*.spec` files. Targeted
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
- People directory: non-global users see active non-deleted people only in their own department across user/operator/invite/chat-participant surfaces; global `manage User` is the explicit exception.
- Emergency: conditional Screen delegates control only explicitly selected authorized direct screens, including clear; `manage Emergency` controls group/global scope.
- Offline player: secure production mode locks exactly 120 seconds after the last authenticated backend success, stops schedule/default/emergency and removes only media cache. Reachability cannot unlock; identity validation, forced fresh snapshot, current-content sync and authority apply precede recovery.
- Built-in roles: fixed; customization belongs in custom roles. Current role-editing APIs/UI are not immutable despite startup resetting default grants.
- Session withdrawal: immediate post-commit withdrawal is required. Account/password and direct/transitive permission changes revoke affected sessions transactionally, broadcast invalidation to every API node and disconnect local user rooms. Protected socket actions revalidate the stored handshake token, so a missed broadcast still fails closed on the next protected action. The out-of-process recovery CLI still requires stopped/restarted backend instances. Test post-commit operations separately from work already in flight.
- Integrations: management screens and their backing operations are in scope; actual SSO login, API-key request authentication and automatic webhook delivery are not release requirements.
- General Requests workboard: server and CMS surfaces are disabled for this release. Schedule Requests remain enabled and in scope.
- Custom roles: effective actions, subjects, inheritance and record conditions decide feature access, not the custom role's display name.
- Schedule approval: user answer BQ-010 on 2026-09-25 permits administrator self-approval and direct administrator publishing. Other permissions, reservations and lifecycle controls remain applicable.
- Deleted users and content ownership: deletion creates a permanent tombstone, immediately ends sessions/sockets, scrubs email/credentials, stops incomplete uploads and preserves stable historical identity. Media, Layout, Presentation and Schedule stay owned by their original department or organization; unresolved legacy ownership is restricted to administrators. There is no automatic person reassignment or restore UI. Ability plus stable ownership governs every resource/nested route, Schedule Requests follow Schedule ownership, and published playback is not rewritten.

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

## Trust And Data Flows

1. Browser -> CMS HTTPS origin -> verified HTTPS backend proxy for REST and Socket.IO. Login uses server sessions plus JWT/cookies, CSRF and origin controls. UI route hiding is not authorization.
2. CMS upload -> backend upload session -> signed object-storage URL under the CMS origin -> CMS proxy -> MinIO TLS. Backend checks authoritative object size/checksum and promotes staged objects; worker processing determines readiness.
3. Schedule author -> schedule/items/presentation -> request hold -> administrator approval -> immutable published snapshot and per-screen reservation -> device refresh command/outbox -> player REST fetch/cache -> display.
4. Player HTTPS requests use device identity/signatures; Socket.IO `/device` provides wake-up and synchronization messages. Polling/heartbeat continue as fallback. REST ACK and DB state remain authoritative.
5. Webpage media has two relevant execution environments: backend capture and isolated native player web content. Host/resource/CIDR/port restrictions, redirects, certificates, unavailable pages and fallback imagery need separate checks.
6. Player -> backend telemetry endpoints -> pg-boss/worker -> PostgreSQL and object logs -> CMS reports/monitoring. A queued event is not yet proof of durable report availability.
7. Worker -> off-host S3 backup destination. Independent recovery tooling restores to a clean isolated PostgreSQL/S3 target and signs restore evidence. Local backup files alone are not disaster recovery.
8. Account administrator -> DELETE user -> one tombstone transaction locks identity, aborts unfinished upload state, revokes sessions, scrubs access-bearing fields and writes audit -> post-commit object cleanup and shared-room disconnect. Completed content, schedule history and player snapshots retain their stable owner/attribution; failed cleanup remains retryable.

Source-free does not mean uninspectable software. The current production image packages compiled JavaScript and compiled CLI tools, rather than the old source-checkout image layout. CMS/player JavaScript remains executable and inspectable. See `darshan-server/Dockerfile`, `darshan-server/scripts/build-production-package.mjs`, and `scripts/bundle/build-production-bundle.mjs::assertBundleContract`.

## Personas And Roles

Personas are QA actors, not additional database roles.

| Persona | Implemented identity | Important boundary |
| --- | --- | --- |
| Site owner/security administrator | `SUPER_ADMIN` | Broad CASL grants, but user-target helpers currently restrict management to ADMIN/OPERATOR. BQ-002. |
| Site administrator/content approver | `ADMIN` | Broad grants; branding needs explicit permission; manages DEPARTMENT/OPERATOR users; publishes, operates screens and emergencies. |
| Department coordinator | `DEPARTMENT` | With the relevant ability, reads and manages content whose stored owner is the same department, including after creator deletion/transfer. User-management target rules remain separate. |
| Content/scheduling operator | `OPERATOR` | Reads same-department/organization content with ability; manages only own department-owned content while still in that owner department. Directory reads can still include other-department operators. |
| Custom-role user | Persisted role with grants/inheritance | Department-bound custom creators follow the same own-content stable-owner rule unless they are the built-in DEPARTMENT lead; conditional grants and role-name gates still need coverage. |
| Conversation owner/moderator/member | Chat `OWNER`, `CHAT_ADMIN`, `MOD`, `MEMBER` | Per-conversation roles; system admins have special non-DM access. Not equivalent to global application roles. |
| Player/device | Device ID, certificate/private key, backend pairing | Not a CMS user. Revoke, expiry, stale identity, environment mismatch and duplicate identity must be distinguished from network loss. |
| Infrastructure/release operator | Host/Docker account and pinned trust material | Installs signed roles; must preserve volumes and identities. An approval-ticket string is an audit reference, not an authentication token. |
| Independent recovery operator | Isolated target, separate read credentials and attestation key | Must not rehearse into production or forge approval evidence. |
| Support/auditor | Existing authorized user or local player CLI operator | Access to screenshots, PoP, logs, diagnostics and recovery is sensitive and needs approved scope. |

Evidence: server `darshan-server/src/rbac/system-roles.ts`, `darshan-server/src/rbac/policy.ts`, `darshan-server/src/rbac/index.ts`, `darshan-server/src/db/repositories/chat.ts`; CMS `darshan-cms/src/lib/access.ts`; player `darshan-player/src/main/cli.ts`.

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
| UC-023 | General Requests workboard: excluded from release functional/UAT scope | Security/exposure assessment remains applicable to reachable endpoints; no approved workflow required | Server `darshan-server/src/routes/requests.ts`; CMS `darshan-cms/src/pages/Requests.tsx`; user answer BQ-006 |
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
- Default media resolves screen, matching group, aspect ratio, global, none. Multiple matching group assignments currently use the first matching assignment; business priority is not established.
- Command schema retains legacy and normalized states; use actual claim/ACK/expiry/cancel transitions rather than asserting every declared enum is always used.
- Player state includes boot, local identity, authentication, pairing phases, paired runtime, offline validated pairing, soft/hard recovery. Identity failure is not the same event as a temporary transport failure.
- Playback resume with a schedule start is wall-clock based. Multiple items repeat as a cycle; a single non-looping item can hold its terminal frame. Persisted progress is an alternate path with identity/freshness checks.
- Display orientation is calculated from detected bounds; ratio reduces width/height by greatest common divisor. Native resolution, DIP/CSS sizes, rotation and scaling must not be conflated.
- PoP duration derives from actual start/end event times. Bounded replay budgets can drop old events. Do not assume crash gaps or lost telemetry count as verified playback.
- Reports retain `screen_uptime_percent` as a compatibility-only fleet snapshot. Historical availability is persisted from server-received heartbeats, estimates offline after 90 seconds, separates backend-unknown time, excludes unknown from the uptime denominator, labels never-seen Screens, and groups daily results in `Asia/Kolkata`.

Evidence: server schema, reservation service, `screens/playback.ts`, `utils/default-media.ts`, `routes/reports.ts`; player `common/playback-policy.ts`, `common/display-profile.ts`, `main/services/pop-service.ts`.

## Jobs And External Dependencies

Worker queues found: `playback:refresh-dispatch`, `telemetry:heartbeat`, `telemetry:proof-of-play`, `telemetry:screenshot`, `ffmpeg:transcode`, `ffmpeg:thumbnail`, `document:convert`, `webpage:verify-capture`, `archive`, `cleanup`, `chat:media-cleanup`, `backup`, `backup:check`, `emergency:reconcile`.

Recurring registrations include hourly session/upload cleanup, weekly log archive, hourly backup eligibility check and minute-level emergency reconciliation. A scheduler registration interval is not itself a promised business completion deadline.

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
- The source-free validator builds fixtures and has optional Docker actions. Its backend role check starts node-exporter/metrics gateway, not a complete fresh API/worker/CMS/player site acceptance. It was not run.
- Older `docs/qa/FEATURE_INVENTORY.md` rows describe mocked SSO/webhook CMS pages; current pages call persisted APIs. Older architecture text describes a combined backend container; current generated production deployment is split. Recheck current source before inheriting any historical expected result.

## Analysis Limits

This is a repository-wide surface inventory plus risk-focused tracing and targeted disposable feature execution, not a claim to have read and proved every source line. No live VM, certificate store, production archive, physical player hardware, external identity provider or production S3 destination was accessed. No secret/configuration values from private environments were needed. Only the dated runtime report is current execution evidence.

The detailed cases, traceability, security/performance/reliability plans, data requirements, suites and release gates are present in this package. QA's next step is authorized execution and evidence capture. An external target or business acceptance decision not supplied by code or user remains explicitly TBD; test observations must not silently approve it.
