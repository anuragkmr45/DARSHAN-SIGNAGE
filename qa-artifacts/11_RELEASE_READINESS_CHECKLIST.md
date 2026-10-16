# Release Readiness Checklist

This is a release gate, not a current sign-off. Record owner, date,
build/release ID, evidence and decision for each item. The authorization/session
review is `evidence/authorization-session-requests-review.md`; the final
developer cycle added real-PostgreSQL, built-API, browser and full-player
automated evidence in
`evidence/runtime-2026-10-16/authorization-end-to-end-devqa.md`. These results
do not replace independent QA, platform, security, recovery, soak or deployment
gates.

## Current Targeted Feature Evidence

- [x] Disposable Linux CMS/API/Electron flow demonstrated independent PDF pages, video Loop On/Off, multiple items, simultaneous slots, corrupt-media advance, schedule hard stop, cached offline restart/recovery, take-down and page-aware PoP persistence.
- [x] CMS/server/player focused tests and builds passed; Linux AppImage and amd64 `.deb` were created with recorded hashes.
- [x] Deleted-user ownership source/build checks, affected DB-backed routes and migration `0045` upgrade/repeat/failure/recovery rehearsal passed on disposable PostgreSQL. This is developer evidence only; the complete QA matrix and release recovery gate remain open.
- [x] Authorization/session/Requests developer verification passed server/CMS/player builds, focused unit/integration suites, six CMS browser cases and built-API HTTP checks. A multipart authorization-revocation cleanup defect was fixed and the final affected server rerun passed 65/65. Multi-process live sockets remain open.
- [ ] `AUTHN-04`, `AUTHZ-01..03`, `AUTHZ-06`, `AUTHZ-08..13` require independent QA runtime evidence; bounded developer checks do not mark these cases Pass.
- [ ] `AUTHZ-07`, `DATA-06`, `CONC-07` and `UI-07` require independent QA runtime evidence; no Pass/Actual Result may be inferred from the checked developer items above.
- [ ] Fresh-machine installation/reboot tests for the generated Linux packages remain pending.
- [ ] Windows x64 package/install/kiosk/playback and supported physical display matrix remain pending.
- [ ] Long soak, approved performance limits, two-minute secure lock/cache purge, mixed-version capability rollout, accessibility and full product/security regression remain pending.
- [x] Server, CMS and player blocking-error lint exits successfully. The two no-behavior errors found during the review were corrected; the existing warning backlog remains technical debt and is not represented as remediated.

## Build And Environment

- [ ] Signed site/release manifest, installer and role archives verify against the independently pinned key; provenance and compatibility generation match. `DEP-01`, `DEP-05`.
- [ ] Approved real capacity evidence matches site/release, workload and resource policy; sample template values are never accepted as measured evidence. `PERF-01`, `DEP-02`; BQ-017.
- [ ] Transfer, staging, Docker, release, worker scratch, database, MinIO and off-host storage have measured free capacity for the entire update and backup; low space rejects before partial activation. `DEP-02`, `BKP-01`.
- [ ] Actual VM firewall rules and certificate trust match the approved network boundary. `DEP-06`, `SEC-02`; BQ-019.
- [ ] The documented client/platform matrix and physical displays have native package, kiosk, autostart, portrait/landscape and content evidence. `COMP-01..03`, `PLAYER-05`; BQ-016.

## Data And Recovery

- [ ] Nonempty database and all contracted object classes, including logs-auth and log archives, are in off-host backup manifest and restore to an isolated clean target with verified counts/hashes. `DATA-03`, `BKP-01..02`.
- [ ] Recovery evidence is fresh, signed by the separate authority and tied to this site/release policy. The recorded measured RPO/RTO meet the approved BQ-018 thresholds.
- [ ] Retention/deletion obligations for DB records, media, chat, screenshots, logs, metrics and backups have owners and evidence. Do not infer compliance from a config field or unused cleanup function. `BKP-01`, `PERF-04`; BQ-015/020.
- [ ] If upgrading, forward migration baseline, backup/restore plan, downtime window and compatible client/player versions are approved. Failed migration leaves a controlled state; no old image is started against unreviewed schema. `DEP-03`, `BKP-03`; BQ-018.
- [ ] Migration `0045` is rehearsed on a disposable legacy-data copy for organization/valid-department/restricted/missing/nullable and pre-migration-transferred creator classes, constraints/indexes, tombstone references, repeat invocation and recovery. The developer PostgreSQL rehearsal passed these technical paths; QA/release still needs frozen-candidate evidence, human acceptance of unknowable historical departments and a rollback decision that disables physical deletion on an older server. `DATA-06`, `BKP-03`; R-25/R-29.
- [ ] An interrupted first install resumes correctly, old release stop script cannot stop the new active role, and stable volumes/site identity are preserved. `DEP-05`, `DEP-07`.

## Product And Security

- [ ] All release `P0` cases pass with execution evidence and reviewed defects. Open Critical/High risks in `03_RISK_REGISTER.csv` have explicit disposition; no source-only finding is counted as a passed runtime test.
- [ ] Last-active SUPER_ADMIN protection passes delete/disable/demotion, one-versus-two account, concurrent removal and recovery CLI paths. Custom roles follow effective direct/inherited/conditional permissions regardless of name. `AUTHZ-01..02`; R-03/R-30/R-33.
- [ ] Immediate withdrawal passes after disable/delete, password, role, department and direct/transitive permission changes across REST, protected socket actions and at least two API nodes. Distinguish already-running work and Valkey failure. `AUTHN-04`, `CONC-07`; R-01.
- [ ] People directories pass same-department active-only filtering across users/operators/invites/chat pickers, guessed IDs, totals and pagination, with global `manage User` as the only global-directory exception. `AUTHZ-08`; R-31.
- [ ] Media/Layout/Presentation creator mutation, permitted same-department read, Schedule same-department action-specific management, cross-department denial, nested closure and ADMIN organization versus SUPER_ADMIN restricted classification pass for every actor/scope. `AUTHZ-09..13`; R-02/R-25/R-26/R-27/R-32.
- [ ] User tombstone/email reuse/list exclusion/history display, owning-department deletion counts, UI confirmation/labels/action flags, no deleted-email disclosure, upload/finalization and PROCESSING-worker commit orders, duplicate-worker safety, non-reactivation and retryable source/ready/thumbnail object cleanup pass with evidence. `DATA-06`, `CONC-07`, `REL-02`, `UI-07`; R-25/R-28.
- [ ] Delegated emergencies are accessible in CMS and constrained to authorized direct Screens for trigger/status/history/clear; global Emergency managers control group/global targets; READY/readable media and transaction-time recheck pass. A two-minute outage still stops playback and erases media cache. `AUTHZ-03`, `PLAYER-03..04`.
- [ ] Migration `0044` is rehearsed; the document page-count backfill dry-run is reviewed before apply; malformed/encrypted failures are resolved; rollback retains nullable compatibility columns until affected snapshots/PoP age out. `DATA-05`, `FILE-06`.
- [ ] Media upload, conversion, selected-page CMS preview, immutable snapshot, capable-player playback, page-aware PoP, webpage preview, chat and reports pass smoke/UAT on actual target hardware. `10_SMOKE_REGRESSION_UAT.md`.
- [ ] Video-only loop selection survives CMS draft/review/request and API/snapshot round trips; a short video completes at least three native cycles on one mounted occurrence, coexists with the selected PDF page, stops at schedule/takeover/secure-lock boundaries, and has no hidden audio, retry storm, stale callback or material resource growth. `UI-06`, `API-07`, `PLAYER-11`, `PLAYER-12`, `OBS-04`, `PERF-06`; R-24.
- [ ] Every target player has advertised `pdf_page_selection_v1`, or schedules using page >1 are demonstrably blocked. Page 1 remains compatible during rollout. `API-06`, `COMP-04`.
- [ ] General Requests old URLs/OpenAPI/CMS/client/report/webhook surfaces are absent and legacy rows are not exposed; Schedule Requests still pass smoke. `AUTHZ-06`; R-18/R-34.
- [ ] Human policies remaining for BQ-011/012/013/014/015/016/017/018/019 and BQ-020 Media/chat recycle behavior are answered or accepted as explicit limits. Directory and four-resource ownership rules are no longer TBD. A remaining TBD affecting recovery, capacity or critical playback cannot be silently converted to Pass.

## Decision Record

| Field | Human completion |
| --- | --- |
| Release and source commit | Pending |
| Site / environment and role generations | Pending |
| QA case evidence location | Pending |
| Approved capacity profile and workload | Pending |
| Restore rehearsal, RPO and RTO evidence | Pending |
| Open defects and risk exceptions | Pending |
| Product/security/operations approvers | Pending |
| Decision: Go / No-go / Conditional with owner and date | Pending |
