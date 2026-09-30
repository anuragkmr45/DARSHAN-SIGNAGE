# Test Data And Environment Requirements

`QA5` in the case CSV means an isolated five-role replica: Data (PostgreSQL/MinIO), Valkey, Backend API plus worker, CMS, and Observability, with one or more separate physical or virtual player machines. It must be isolated from production identity, storage, network and recovery destinations. The user's previous VM sizes were Data 2 vCPU/5120 MB/50 GB; Backend 3 vCPU/4608 MB/30 GB; CMS 1 vCPU/1536 MB/15 GB; Valkey 2 vCPU/2048 MB/12 GB; Observability 1 vCPU/2048 MB/25 GB. These are reported specifications, not a measured capacity certificate or proof of available disk.

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
| Media | Valid JPEG/PNG/WebP, MP4/QuickTime, PDF with 2+ pages, Office documents with several slides/pages, corrupt/encrypted/unsupported file, MIME mismatch, size just below/at/above production limit, hashes and multipart parts. Use synthetic media without customer data. |
| Layout/presentation | One-slot and multi-slot layouts, portrait/landscape geometry at boundaries, READY/unready media, duration/loop/audio variants, content owned by each actor/department. |
| Schedule/reservation | Adjacent and overlapping `[start,end)` windows, overlapping groups resolving to same concrete screen, stale revision, expired hold, approved/published/taken-down states, DST and timezone boundary dates. |
| Emergency/defaults | Severity ties, all/group/selected-screen scopes, message capability and no-capability devices, READY/unready media, screen/group/aspect/global defaults, saved group order A/B then edited A. |
| Device/PoP | Pairing codes and revocation, signed request replay, commands with old/current leases, real playback start/end, crash gap, more than 100 buffered events and enough events to exceed spool limits on disposable storage. |
| Chat/notifications | DM/group/forum, attachments, mentions, edited/deleted/archived messages, concurrent send/read, muted/banned members, out-of-order delivery. |
| Reports | Zero screens, ACTIVE/OFFLINE counts, PoP `ended_at` null/non-null, dates straddling UTC/local midnight, empty page, nonempty export, audit rows. |
| Backups | Nonempty DB and each contracted object source including `logs-auth` and `archives/logs/`; exclude staging and recursive backup archives. Record source counts/hashes for restore comparison. |
| Webpage | Controlled HTTPS origin(s): public, RFC1918 intranet, redirect, resource on separate host, invalid certificate, visible login/error page, crash/timeout and captured preview of known age. Never probe an uncontrolled internal service. |

## Environment Controls

- Keep synchronized clocks and record server, browser and player timezones. BQ-014 reporting-day choice remains TBD; the test fixture must expose both UTC and site-local boundaries.
- Provide test PKI for CMS, Backend, MinIO, PostgreSQL, Valkey, player identity and signed roles. Include a wrong CA/expired certificate set for negative cases.
- Provide controllable network rules to isolate Valkey, WSS, backend, MinIO or off-host backup independently. Record actual firewall source/port rules for BQ-019.
- Use disposable PostgreSQL/MinIO/S3 targets for migrations, backup, restore, low disk and archive tests. The isolated recovery VM must reject nonempty/production targets.
- Supply real Windows x64 and Ubuntu user-session player hardware with approved portrait/landscape/multi-display fixtures; X11 and Wayland where the site requires them. Browser matrix and accessibility tools are BQ-016 inputs.
- Capture logs, metrics, screenshots, request/response redactions, DB row counts, object hashes, queue/backup manifests, certificate subjects and video of physical display transitions as case evidence. Never include bearer tokens, private keys or real credentials.
- Seed realistic data volume for capacity work only after BQ-017 workload and capacity evidence are approved. Back up disposable state before destructive fault/recovery scenarios and clean test objects afterward.

## Acceptance Inputs Not Established By Source

Code-based expectations for every BQ topic are in `12_CODE_BASELINE_EXPECTATIONS.md`; none require a person to explain what the source currently does. Actual site workload/SLO, RPO/RTO/downtime, retention/legal hold, hardware/browser/accessibility targets, deployed release baseline and network exposure/egress are external facts or commitments that the repository cannot supply. Product acceptance of code-characterized sharing, webpage fallback, overlapping defaults, PoP loss, report meaning and delete/recovery behavior has not been explicitly supplied. QA may record actual behavior now, but release owners must not silently replace an unapproved requirement with the code default.
