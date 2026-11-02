# Test Data And Environment Requirements

`QA5` in the case CSV means an isolated five-role replica: Data (PostgreSQL/MinIO), Valkey, Backend API plus worker, CMS, and Observability, with one or more separate physical or virtual player machines. It must be isolated from production identity, storage, network and recovery destinations. The user's previous VM sizes were Data 2 vCPU/5120 MB/50 GB; Backend 3 vCPU/4608 MB/30 GB; CMS 1 vCPU/1536 MB/15 GB; Valkey 2 vCPU/2048 MB/12 GB; Observability 1 vCPU/2048 MB/25 GB. These are reported specifications, not a measured capacity certificate or proof of available disk.

The 2026-10-15 targeted run used a smaller disposable single-host Linux topology with loopback CMS/API/Electron and isolated PostgreSQL/Valkey/RustFS containers. Its exact scope and cleanup boundary are recorded in `evidence/runtime-2026-10-15/runtime-validation.md`. That topology is valid evidence only for the named feature scenarios; it is not the required QA5 release environment or target-hardware matrix.

## Provisioned Actors

- SUPER_ADMIN accounts: at least two active direct system-role users, plus inactive/deleted fixtures, to test safe removal, last-active delete/disable/demotion and concurrent removal without risking sole access.
- ADMIN accounts: two, with one self-authored request for approved self-approval/direct publish.
- DEPARTMENT accounts: one each in departments A and B.
- OPERATOR/accounts: creator and peer in A, one in B, inactive/deleted users, a null-department user and a global User manager. Use them across user/operator/invite/chat participant lists, pagination and guessed-ID checks; cross-department visibility is expected only for the global manager.
- Deleted-user fixtures: one tombstoned creator in A, one creator transferred A -> B before deletion, one inactive but not deleted account, and one missing legacy creator. Retain synthetic names and historical references; use a known original email solely to verify scrub/non-disclosure/reuse.
- Custom roles: one with conditional `update Screen` for selected records, one with `manage Emergency`, one department-bound content creator, one read-only role, one with independent Schedule action grants, one inherited/conditional User grant and one with no relevant grant. Rename custom roles during testing without changing permissions.
- Paired devices: active landscape, portrait, overlapping-group, revoked/recovered and offline candidates. Use disposable device certificates and test CA.
- Chat actors: owner, moderator, member, removed member, banned/muted member, global `manage Conversation` actor, custom role with and without that grant, private DM outsider and a cross-department forum participant. Keep at least three distinct accounts signed in concurrently in separate browser profiles; use two profiles for the same recipient during notification-counter races. A second isolated installation is needed to test organization separation because the schema has no tenant entity.

Use distinct accounts and browser profiles for concurrent sessions. Store credentials, keys, release-signing material and recovery attestation keys in approved secret stores, never in QA artifacts or screenshots. Keep a test-only approved change ticket and nonproduction restore evidence for deployment cases.

## Data Recipes

| Domain | Required fixtures |
| --- | --- |
| Media | Valid JPEG/PNG/WebP; short (about 2 seconds) and long MP4/QuickTime videos with known decoded duration, muted/audio variants and representative H.264 profiles; controlled truncated/corrupt/stall sources; PDF fixtures with 1, 2, 5 and many pages; and each accepted document extension `.pdf/.ppt/.pptx/.doc/.docx/.xls/.xlsx/.csv`. Include mixed orientation, merged cells, hidden sheets, varied slide/page sizes, very-large PDFs, corrupt/zero-page-like/encrypted/unsupported files, MIME mismatch, and a controlled source reconversion whose final page count changes. Include size boundaries, hashes, multipart parts, INITIALIZING/ACTIVE/FINALIZING sessions, legacy PENDING media, completed PROCESSING/READY media and injected abort/delete failure. For ownership, seed ORGANIZATION, department A/B and RESTRICTED rows with active/moved/deleted/missing creators. Record expected video duration and final-PDF physical counts. Use synthetic media without customer data. |
| Layout/presentation | One-slot and multi-slot layouts, fullscreen and slotted one-item presentations, portrait/landscape geometry at boundaries, READY/unready media, duration/loop/audio variants, the same video twice with loop on/off, a single loop video whose item duration is below 1 second, normal and above 30 seconds, two independent looping frames, corrupt video followed by valid media, loop video beside a selected page-2 PDF, legacy omitted/contaminated loop values, duplicate document occurrences selecting pages 1 and last, legacy null page rows, and an isolated post-publish page-count mismatch. For both Layout and Presentation seed organization, A, B and restricted owners plus compatible/incompatible nested scope pairs and active/moved/deleted/nullable creators. |
| Schedule/reservation | Adjacent and overlapping `[start,end)` windows, overlapping groups resolving to same concrete screen, stale revision, expired hold, cancelled/taken-down and draft/pending/approved/reserved/published states. Seed organization, A, B and restricted owners; requester distinct from creator; deleted and transferred requesters/creators; a published immutable snapshot captured before deletion; DST and timezone boundary dates. |
| Emergency/defaults | Severity ties, all/group/selected-screen scopes, message capability and no-capability devices, READY/unready media, screen/group/aspect/global defaults, and the versioned approved standard company fallback image. Put one screen in at least three groups; seed priorities 0/1/50/100, equal-priority groups with known target-ID order, legacy missing priority, duplicate targets, invalid bounds and two clients holding the same settings revision. Include a Screen with no active Schedule or eligible default and online/offline first-start, restart and corrupt/missing-fallback variants. |
| Device/PoP | Pairing codes and revocation; updated players before/after first capability-reporting connection; page>1 target groups with one missing capability report; signed request replay; commands with old/current leases; real page-1/page-N playback start/end; crash gap; more than 100 buffered events and enough events to exceed spool limits on disposable storage. Include a secure 120-second player containing distinct synthetic media cache, identity/certificates, logs, PoP spool and request queues, plus a server-side authority changed while that player is locked. Do not maintain an old-player acceptance fixture; all release players are upgraded. |
| Chat/notifications | DM/group/forum with unique IDs and duplicate titles; invited/removed/re-invited members; owner/moderator/global manager/custom role; own and other-user edits/deletes; replies, reactions, pins and link/file/message bookmarks; Unicode/emoji and old UUID mention snippets; at least 55 notifications; simultaneous send/read-all and out-of-order cursors. Include accepted image, PDF, Office, CSV and video attachments, malformed/unsupported/MIME-mismatched/PROCESSING/deleted Media, a forged cross-department Media ID, expired signed URL and conversation-scoped versus Media Library access. Capture DB message sequences/revisions/receipts/notification rows plus object hashes. |
| Reports/observability | Zero screens; never-seen screen; server-received ONLINE heartbeats at 89/90/91-second boundaries; explicit OFFLINE/ERROR; recovery heartbeat; backend-readiness gap; ACTIVE/OFFLINE compatibility counts; exact and mismatched publish/snapshot acknowledgements; fresh/stale active slots; publish-linked and unlinked PoP; dates straddling Asia/Kolkata midnight; empty page; nonempty export; audit rows. Provide empty, healthy two-player, stale and unreachable Prometheus file-discovery inventories plus matching/wrong player metrics CA/client/server certificates. |
| Backups | Nonempty DB and each contracted object source including `logs-auth` and `archives/logs/`; exclude staging and recursive backup archives. Record source counts/hashes for restore comparison. |
| Webpage | Controlled HTTP and HTTPS origins: exact/wildcard approved hosts; ports 80/443 plus denied ports; optional approved RFC1918 CIDR; multi-hop allowed and allowed-to-denied redirects; relative redirects; DNS answer/rebinding fixture; separate resource host; invalid certificate; URL userinfo; HTTP Basic challenge; 200 login form; crash/timeout. Seed successful preview v1/v2/v3 with known bytes, checksum, revision and captured time; missing/corrupt selected revision; valid older cache; due/not-due refresh times; capture/upload/DB publication failures and duplicate jobs. Never probe an uncontrolled internal service or use real credentials. |

## Environment Controls

- For `AUTHZ-14..18`, seed primary A, additional B/C, unassigned D,
  primary-only A/B/C operators, an A department manager, a global User
  manager, an inactive operator, an invitee, and a deleted user. Create
  A/B/C/D-owned Media/Layout/Presentation/Schedule fixtures with stable
  creator and owner columns, plus an A/B chat with a message attachment,
  an authorized file bookmark, and a legacy bookmark lacking share proof.
  Keep two independent CMS cookie origins, one old CMS build, current API and
  worker, and a real migrated PostgreSQL/Valkey/MinIO stack. Capture list
  totals and row IDs before/after primary changes and membership removal.
  Gate deterministic races with user-row locks and concurrent department
  deletion; avoid real user data and production storage.

- Treat the 2026-10-16 workstation OOM as an execution constraint, not a product result. Kernel evidence shows three `chrome-headless` processes launched inside the VS Code user scope were killed at approximately 2.4 GiB, 2.84 GiB and 2.91 GiB resident memory; VS Code then stopped with the same OOM scope. For the bounded sequential developer runtime, require at least 2 GiB `MemAvailable` and 1 GiB free swap after the disposable service tier is healthy. QA should use a larger representative host and record its own approved guardrails.
- Run resource-heavy phases sequentially: database/services and API checks first; one Playwright browser worker second; close it and verify process exit; Electron/player third; and the combined soak only after moving it to an approved host with adequate measured headroom. Never overlap Playwright/Chromium with Electron on this workstation.
- Constrain Node-based build/test commands with `NODE_OPTIONS=--max-old-space-size=768` unless a recorded test requirement proves that insufficient. Configure Playwright with one worker and no fully-parallel projects for the workstation run. A test retry must reuse the same controlled sequence rather than starting another browser concurrently.
- Record `MemAvailable`, swap usage and the largest resident processes before and after each phase. Do not start the bounded developer browser/Electron phase below 2 GiB available or 1 GiB free swap; stop if either threshold is crossed, one browser process exceeds 1.5 GiB RSS, or sustained growth has no explained plateau. These workstation guardrails prevent another host OOM; they are not product capacity acceptance limits.
- After each browser/player phase, prove that no `chrome-headless`, Playwright, Chromium, Electron, Vite, API or worker process from the run remains. Keep unrelated user and non-DARSHAN services out of cleanup scope; never terminate them merely to satisfy the test harness.
- Keep synchronized clocks and record server, browser and player timezones. Availability daily buckets use `Asia/Kolkata`; server receipt time, not the player clock, defines interval boundaries. Keep UTC and site-local boundary fixtures to catch browser/export drift on other report surfaces.
- Provide test PKI for CMS, Backend, MinIO, PostgreSQL, Valkey, player identity and signed roles. Include a wrong CA/expired certificate set for negative cases.
- Provide controllable network rules to isolate Valkey, WSS, backend, MinIO or off-host backup independently. Record actual firewall source/port rules for BQ-019.
- For `CHAT-01..08`, keep three CMS profiles visible simultaneously and capture sender/recipient UI before and after each action; record API and socket events as supporting evidence, not as a substitute for browser behavior. Provide a proxy that can drop API and WSS separately, a second API node for revocation checks, a clock for mute/session expiry, and a database barrier for read-all/new-notification races. Use only synthetic messages and files; remove or restore disposable state after the run.
- Use disposable PostgreSQL/MinIO/S3 targets for migrations, backup, restore, low disk and archive tests. The isolated recovery VM must reject nonempty/production targets.
- Build a pre-0045 legacy copy containing all ownership backfill classes: administrator creator, valid department creator, creator transferred before migration, creator without department, creator pointing at a removed/invalid department where the fixture can safely represent it, missing/nullable creator, and all four resource tables. Capture IDs/counts/checksums before migration. Because legacy rows lack creation-time owner columns, explicitly review the migration-time mapping for transferred creators. Never test the rollback guard by enabling physical deletion against valued data.
- Provide deterministic database barriers and fault controls for deletion versus session checks, socket reconnect, notification insert, multipart activation/finalization and legacy finalization. Provide an S3-compatible target where abort/delete/copy can fail independently, then recover it and replay the cleanup worker.
- Run the document count backfill without `--apply` first, archive its JSON result, compare counts manually, then use `--apply` only on the disposable migrated database. Include a failed object and prove it is reported rather than force-updated.
- Supply real Windows x64 and Ubuntu user-session player hardware with approved portrait/landscape/multi-display fixtures; X11 and Wayland where the site requires them. Browser matrix and accessibility tools are BQ-016 inputs.
- Capture logs, metrics, screenshots, request/response redactions, DB row counts, object hashes, queue/backup manifests, certificate subjects and video of physical display transitions as case evidence. Never include bearer tokens, private keys or real credentials.
- Seed realistic data volume for capacity work only after BQ-017 workload and capacity evidence are approved. Back up disposable state before destructive fault/recovery scenarios and clean test objects afterward.

## Acceptance Inputs Not Established By Source

Code-based expectations for every BQ topic are in `12_CODE_BASELINE_EXPECTATIONS.md`; none require a person to explain what the source currently does. Webpage, competing-default priority and the required company fallback are confirmed under BR-097..102. Current runtime conflicts with BR-102. Actual site workload/SLO, RPO/RTO/downtime, retention/legal hold, hardware/browser/accessibility targets, deployed release baseline and network exposure/egress are external facts or commitments that the repository cannot supply. QA may record actual behavior now, but release owners must not silently replace an unresolved external requirement with a code default.

## Live broadcast implementation delta — 2026-11-03

Use `docker --context default` and explicitly selected Node 20; sequential
builds on the observed approximately 6 GiB/swap-using host. The selected
Docker Desktop socket failure does not prove Docker Engine is absent. Record
actual dependency versions/health and resource observations before launching.

Create feature-only API/CMS ports, DB, buckets, namespace and credentials;
independent admin/presenter browser sessions; the normal DARSHAN installed
player with an isolated profile (not a separately installed receiver);
two departments/custom-role and
revoked/unauthorized actors; an isolated real Electron user-data profile. Do
not overwrite existing deployments, player identities, private recovery data or
runtime directories. Start one receiver; only add another after independent
profile/singleton proof.

Fixtures: image, selected PDF page and video fallbacks; corrupt/missing/hash-
mismatched fallback; cache-full state; readable slide, changing counter/motion,
optional mic and capture sound, static slide; current and unsupported player;
25/26 targets and ten/eleven overlapping windows; original/refreshed admission
replay, late picker/callback/cleanup; expired/wrong-host trust fixture.

Log exact commit/worktree delta, package SHA-256, Node/dependency versions,
CMS/Backend/media URLs without credentials, profile aliases, time source,
resource use, transport and fault boundaries. Available Firefox/Chromium do not
establish actual Chrome/Edge or Windows coverage. Physical audio/display,
whole-machine sleep with separate Backend and cross-VM partitions remain
external. Never commit generated credentials/keys/certificates/profiles.

[Execution plan](../docs/plans/live-broadcast-implementation-loops.md); [in-progress ledger](evidence/live-broadcast-developer-verification-2026-11-03.md).
