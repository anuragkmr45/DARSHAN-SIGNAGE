# Test Data And Environment Requirements

`QA5` in the case CSV means an isolated five-role replica: Data (PostgreSQL/MinIO), Valkey, Backend API plus worker, CMS, and Observability, with one or more separate physical or virtual player machines. It must be isolated from production identity, storage, network and recovery destinations. The user's previous VM sizes were Data 2 vCPU/5120 MB/50 GB; Backend 3 vCPU/4608 MB/30 GB; CMS 1 vCPU/1536 MB/15 GB; Valkey 2 vCPU/2048 MB/12 GB; Observability 1 vCPU/2048 MB/25 GB. These are reported specifications, not a measured capacity certificate or proof of available disk.

The 2026-10-15 targeted run used a smaller disposable single-host Linux topology with loopback CMS/API/Electron and isolated PostgreSQL/Valkey/RustFS containers. Its exact scope and cleanup boundary are recorded in `evidence/runtime-2026-10-15/runtime-validation.md`. That topology is valid evidence only for the named feature scenarios; it is not the required QA5 release environment or target-hardware matrix.

## Provisioned Actors

- SUPER_ADMIN accounts: at least two, to test any-account deletion block and last-active edge without risking sole access.
- ADMIN accounts: two, with one self-authored request for approved self-approval/direct publish.
- DEPARTMENT accounts: one each in departments A and B.
- OPERATOR accounts: creator and peer in A, one in B; include user names/emails visible in cross-department directory characterization.
- Custom roles: one with `update Screen`, one with read-only content permissions, one with conditional department grant and one with no relevant grant.
- Paired devices: active landscape, portrait, overlapping-group, revoked/recovered and offline candidates. Use disposable device certificates and test CA.
- Chat actors: owner, moderator, member, removed member and private DM outsider.

Use distinct accounts and browser profiles for concurrent sessions. Store credentials, keys, release-signing material and recovery attestation keys in approved secret stores, never in QA artifacts or screenshots. Keep a test-only approved change ticket and nonproduction restore evidence for deployment cases.

## Data Recipes

| Domain | Required fixtures |
| --- | --- |
| Media | Valid JPEG/PNG/WebP; short (about 2 seconds) and long MP4/QuickTime videos with known decoded duration, muted/audio variants and representative H.264 profiles; controlled truncated/corrupt/stall sources; PDF fixtures with 1, 2, 5 and many pages; and each accepted document extension `.pdf/.ppt/.pptx/.doc/.docx/.xls/.xlsx/.csv`. Include mixed orientation, merged cells, hidden sheets, varied slide/page sizes, very-large PDFs, corrupt/zero-page-like/encrypted/unsupported files, MIME mismatch, and a controlled source reconversion whose final page count changes. Include size boundaries, hashes and multipart parts. Record expected video duration and final-PDF physical counts. Use synthetic media without customer data. |
| Layout/presentation | One-slot and multi-slot layouts, portrait/landscape geometry at boundaries, READY/unready media, duration/loop/audio variants, the same video twice with loop on/off, a single loop video whose item duration is shorter and longer than decoded duration, two independent looping frames, a multi-item frame, loop video beside a selected page-2 PDF, legacy omitted/contaminated loop values, duplicate document occurrences selecting pages 1 and last, legacy null page rows, invalid slot/order/page rows, content owned by each actor/department. |
| Schedule/reservation | Adjacent and overlapping `[start,end)` windows, overlapping groups resolving to same concrete screen, stale revision, expired hold, approved/published/taken-down states, DST and timezone boundary dates. |
| Emergency/defaults | Severity ties, all/group/selected-screen scopes, message capability and no-capability devices, READY/unready media, screen/group/aspect/global defaults, saved group order A/B then edited A. |
| Device/PoP | Pairing codes and revocation, one player with and one without `pdf_page_selection_v1`, signed request replay, commands with old/current leases, real page-1/page-N playback start/end, crash gap, more than 100 buffered events and enough events to exceed spool limits on disposable storage. |
| Chat/notifications | DM/group/forum, attachments, mentions, edited/deleted/archived messages, concurrent send/read, muted/banned members, out-of-order delivery. |
| Reports | Zero screens, ACTIVE/OFFLINE counts, PoP `ended_at` null/non-null, dates straddling UTC/local midnight, empty page, nonempty export, audit rows. |
| Backups | Nonempty DB and each contracted object source including `logs-auth` and `archives/logs/`; exclude staging and recursive backup archives. Record source counts/hashes for restore comparison. |
| Webpage | Controlled HTTPS origin(s): public, RFC1918 intranet, redirect, resource on separate host, invalid certificate, visible login/error page, crash/timeout and captured preview of known age. Never probe an uncontrolled internal service. |

## Environment Controls

- Keep synchronized clocks and record server, browser and player timezones. BQ-014 reporting-day choice remains TBD; the test fixture must expose both UTC and site-local boundaries.
- Provide test PKI for CMS, Backend, MinIO, PostgreSQL, Valkey, player identity and signed roles. Include a wrong CA/expired certificate set for negative cases.
- Provide controllable network rules to isolate Valkey, WSS, backend, MinIO or off-host backup independently. Record actual firewall source/port rules for BQ-019.
- Use disposable PostgreSQL/MinIO/S3 targets for migrations, backup, restore, low disk and archive tests. The isolated recovery VM must reject nonempty/production targets.
- Run the document count backfill without `--apply` first, archive its JSON result, compare counts manually, then use `--apply` only on the disposable migrated database. Include a failed object and prove it is reported rather than force-updated.
- Supply real Windows x64 and Ubuntu user-session player hardware with approved portrait/landscape/multi-display fixtures; X11 and Wayland where the site requires them. Browser matrix and accessibility tools are BQ-016 inputs.
- Capture logs, metrics, screenshots, request/response redactions, DB row counts, object hashes, queue/backup manifests, certificate subjects and video of physical display transitions as case evidence. Never include bearer tokens, private keys or real credentials.
- Seed realistic data volume for capacity work only after BQ-017 workload and capacity evidence are approved. Back up disposable state before destructive fault/recovery scenarios and clean test objects afterward.

## Acceptance Inputs Not Established By Source

Code-based expectations for every BQ topic are in `12_CODE_BASELINE_EXPECTATIONS.md`; none require a person to explain what the source currently does. Actual site workload/SLO, RPO/RTO/downtime, retention/legal hold, hardware/browser/accessibility targets, deployed release baseline and network exposure/egress are external facts or commitments that the repository cannot supply. Product acceptance of code-characterized sharing, webpage fallback, overlapping defaults, PoP loss, report meaning and delete/recovery behavior has not been explicitly supplied. QA may record actual behavior now, but release owners must not silently replace an unapproved requirement with the code default.
