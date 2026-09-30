# System Understanding

Status: PROVISIONAL QA HANDOFF. User-confirmed decisions and current code behavior are recorded separately. Code-derived expectations for every business topic are in `12_CODE_BASELINE_EXPECTATIONS.md`; actual runtime results are blank for QA.

## Baseline And Scope

- Product: DARSHAN digital signage, CMS administration, and Electron playback.
- Branch/commit: `release-01` / `a6e401d2479cd0dee34c33552671cd0f86d4d173`.
- Inspection date: 2026-09-24. This describes checked-in implementation, not the state of a running site.
- 1,215 tracked files: CMS 289; player 164; server 370; deployment 72; documentation 280; scripts 26; standards 8; manifests 3; three root files.
- 239 explicit Fastify route registrations, all resolved to paths by static parsing. Some registrations are configuration-dependent, including `/metrics`.
- 29 CMS route declarations, including shell/catch-all and legacy route aliases. This is not a count of 29 distinct product screens.
- 69 `pgTable` declarations and 15 enums in `darshan-server/src/db/schema.ts`; 45 SQL migration files. The SQL-only `darshan_deployment_runs` table and pg-boss internals are additional data surfaces.
- 182 tracked `*.test`/`*.spec` files: server 97, CMS 29, player 55, bundle configuration 1. None were executed.
- No tracked GitHub Actions, GitLab CI, Jenkinsfile, or Azure Pipelines file was found in the inspected file index. This does not establish whether external CI exists.

Primary machine-readable inventory: `evidence/repository-inventory.json`.

## User-Confirmed Release Scope

Business source: user answers BQ-001 through BQ-006 and follow-ups to BQ-002/003/004/008/009, 2026-09-24. These are intended outcomes, not runtime test results. Detailed comparison: `evidence/policy-behavior-review.md`.

- Documents: first-page-only playback is intentional.
- SUPER_ADMIN: every SUPER_ADMIN account is protected from deletion; SUPER_ADMIN must manage users across all roles. Last-active-account demotion/disablement is a separate edge policy still to settle.
- Emergency: screen-management permission is sufficient for delegated actions on all explicitly selected screens. Additional global/group/clear-scope behavior is not assumed approved.
- Offline player: lock after two minutes of backend outage, remove cached media and stop emergency playback too. Current generated defaults do not enable that policy.
- Built-in roles: fixed; customization belongs in custom roles. Current role-editing APIs/UI are not immutable despite startup resetting default grants.
- Session withdrawal: immediate withdrawal of obsolete access is the intended acceptance rule; no fallback grace period is approved. Ordinary account updates/reset do not revoke sessions; same-role grant edits and the recovery CLI behave differently. Test subsequent protected operations and ongoing socket delivery separately from work already in flight.
- Integrations: management screens and their backing operations are in scope; actual SSO login, API-key request authentication and automatic webhook delivery are not release requirements.
- General Requests workboard: excluded from functional/UAT acceptance. Schedule requests are not excluded. Reachable excluded APIs remain part of security/exposure assessment.
- Schedule approval: user answer BQ-010 on 2026-09-25 permits administrator self-approval and direct administrator publishing. Other permissions, reservations and lifecycle controls remain applicable.

The 2026-09-25 answers to BQ-007/011/012/013 describe existing code rather than approve every observed outcome. They are recorded as implementation baselines in `evidence/content-runtime-review.md`: per-resource sharing differences and presentation authorization omissions; conditional HTTPS/private webpage support and fallback; assignment-order-dependent group defaults; bounded best-effort PoP retention. Business-dependent expected outcomes remain TBD where no acceptance decision was supplied. These answers have not been discarded or treated as unanswered requests for more code analysis.

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

Source-free does not mean uninspectable software. The current production image packages compiled JavaScript and compiled CLI tools, rather than the old source-checkout image layout. CMS/player JavaScript remains executable and inspectable. See `darshan-server/Dockerfile`, `darshan-server/scripts/build-production-package.mjs`, and `scripts/bundle/build-production-bundle.mjs::assertBundleContract`.

## Personas And Roles

Personas are QA actors, not additional database roles.

| Persona | Implemented identity | Important boundary |
| --- | --- | --- |
| Site owner/security administrator | `SUPER_ADMIN` | Broad CASL grants, but user-target helpers currently restrict management to ADMIN/OPERATOR. BQ-002. |
| Site administrator/content approver | `ADMIN` | Broad grants; branding needs explicit permission; manages DEPARTMENT/OPERATOR users; publishes, operates screens and emergencies. |
| Department coordinator | `DEPARTMENT` | Department-scoped resource policy and management of same-department operators, subject to per-operation ownership checks. |
| Content/scheduling operator | `OPERATOR` | Content creation and schedule requests; read-only user access currently includes other operators across departments. BQ-007. |
| Custom-role user | Persisted role with grants/inheritance | Some operations use role names as well as grants. System-role synchronization and conditional grants need dedicated coverage. |
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
| UC-003 | Manage departments/users/operators; authorized manager | Wrong department/target role, duplicate identity, in-use deletion | Server `darshan-server/src/routes/users.ts`, `departments.ts`, `darshan-server/src/rbac/policy.ts` |
| UC-004 | Configure roles, settings and branding; administrator | Conditional grants, inheritance cycles, forbidden branding, restart persistence | Server `darshan-server/src/rbac/index.ts`, `system-roles.ts`, `darshan-server/src/routes/roles.ts`, `settings.ts` |
| UC-005 | Upload/resume/abort verified media; content author | Lost response, duplicate key, wrong SHA-256/parts, URL expiry, cross-user session | CMS `darshan-cms/src/lib/mediaUploadFlow.ts`; server `darshan-server/src/routes/media.ts`, `darshan-server/src/db/repositories/media-upload-session.ts` |
| UC-006 | Process video/documents and inspect previews; content author | Missing tools, worker retry, corrupt/encrypted file, partial object promotion, PDF page count | Server `darshan-server/src/jobs/index.ts`; player `darshan-player/src/renderer/pdf-playback.ts`; CMS `darshan-cms/src/components/common/MediaPreview.tsx` |
| UC-007 | Add/display webpage media; content author and player | Rejected destination, redirect/resource block, TLS failure, offline fallback, empty/crashed page | Server `darshan-server/src/utils/webpage-capture.ts`; player `darshan-player/src/main/services/webpage-view-manager.ts` |
| UC-008 | Create/edit/share layouts; content author | Duplicate/out-of-bounds slots, wrong owner, display mismatch | Server `darshan-server/src/routes/layouts.ts`; CMS `darshan-cms/src/pages/LayoutEditor.tsx` |
| UC-009 | Compose ordered presentation/slot media; content author | Unready/missing media, duration/loop/audio combinations, in-use edits | Server `darshan-server/src/routes/presentations.ts`; CMS schedule-creator components |
| UC-010 | Create schedule, preview conflicts and submit hold; operator | Adjacent/overlapping windows, timezones, group expansion, concurrent submit | Server `darshan-server/src/routes/schedules.ts`, `schedule-reservations.ts`, `services/scheduling/reservation-service.ts` |
| UC-011 | Approve/reject/publish request or direct admin publish | Expired hold, stale revision, duplicate publish, missing target/media, approval separation | Server `darshan-server/src/routes/schedule-requests.ts`, `schedule-publish-helper.ts` |
| UC-012 | Cancel/take down published content; owner/admin | Repeated takedown, disconnected player, reservation release, pending refresh | Server `darshan-server/src/services/scheduling/reservation-service.ts`; player snapshot manager |
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
- Reports `screen_uptime_percent` currently calculates `ACTIVE / (ACTIVE + OFFLINE) * 100`, rounded to two decimals, or null for zero denominator. This is a fleet snapshot, not historical uptime.

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

These are risk hypotheses and source-observed inconsistencies, not runtime-confirmed defects. No release pass/fail judgment is being made by this static planning package.

## Existing QA Evidence And Gaps

- Backend route tests use a dedicated test database guard and disable file parallelism; running them would mutate a database. They were read, not run.
- CMS Playwright configuration targets Chromium and may start Vite. Representative screen tests intercept routes and use mocked responses. Such cases do not prove actual VM/API/player integration.
- Player tests include unit, integration, fault, browser and performance files. Their names do not prove real hardware or outage execution.
- The source-free validator builds fixtures and has optional Docker actions. Its backend role check starts node-exporter/metrics gateway, not a complete fresh API/worker/CMS/player site acceptance. It was not run.
- Older `docs/qa/FEATURE_INVENTORY.md` rows describe mocked SSO/webhook CMS pages; current pages call persisted APIs. Older architecture text describes a combined backend container; current generated production deployment is split. Recheck current source before inheriting any historical expected result.

## Analysis Limits

This is a repository-wide surface inventory plus risk-focused end-to-end static tracing, not a claim to have read and proved every source line. No live VM, certificate store, production archive, browser, player hardware, external identity provider or S3 destination was accessed. No secret/configuration values from private environments were needed. Existing tests, coverage configuration and historical results are not current execution evidence.

The detailed cases, traceability, security/performance/reliability plans, data requirements, suites and release gates are present in this package. QA's next step is authorized execution and evidence capture. An external target or business acceptance decision not supplied by code or user remains explicitly TBD; test observations must not silently approve it.
