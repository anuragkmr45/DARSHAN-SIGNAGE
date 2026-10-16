# Release Readiness Checklist

This is a release gate, not a current sign-off. Record owner, date, build/release ID, link to evidence and decision for each item. Targeted PDF/video Linux runtime evidence exists in `evidence/runtime-2026-10-15/runtime-validation.md`. The 2026-10-16 deleted-user ownership feature has partial disposable API/CMS developer evidence plus source/build/pure-unit evidence in `evidence/runtime-2026-10-16/runtime-validation.md` and `evidence/deleted-user-ownership-review.md`; `AUTHZ-07`, `DATA-06`, and `UI-07` are `Partially Tested`, while `CONC-07` remains `Not Tested`. Neither evidence set replaces the complete platform, security, recovery, soak or production-deployment gates.

## Current Targeted Feature Evidence

- [x] Disposable Linux CMS/API/Electron flow demonstrated independent PDF pages, video Loop On/Off, multiple items, simultaneous slots, corrupt-media advance, schedule hard stop, cached offline restart/recovery, take-down and page-aware PoP persistence.
- [x] CMS/server/player focused tests and builds passed; Linux AppImage and amd64 `.deb` were created with recorded hashes.
- [x] Deleted-user ownership source/build checks and a partial disposable API/CMS developer run passed the specifically recorded ownership assertions. This is developer evidence only; migration, deterministic races/sockets, complete browser coverage and the frozen-build repeat remain open. See `evidence/runtime-2026-10-16/runtime-validation.md`.
- [ ] `AUTHZ-07`, `DATA-06`, `CONC-07` and `UI-07` require QA5 runtime evidence; no Pass/Actual Result may be inferred from the checked static item above.
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
- [ ] Migration `0045` is rehearsed on a disposable legacy-data copy for organization/valid-department/restricted/missing/nullable and pre-migration-transferred creator classes, constraints/indexes, tombstone references, repeat invocation and recovery. Human review accepts the migration-time mapping where legacy creation-time department is unknowable. Rollback explicitly disables user deletion on any older server that still physically deletes rows. `DATA-06`, `BKP-03`; R-25/R-29.
- [ ] An interrupted first install resumes correctly, old release stop script cannot stop the new active role, and stable volumes/site identity are preserved. `DEP-05`, `DEP-07`.

## Product And Security

- [ ] All release `P0` cases pass with execution evidence and reviewed defects. Open Critical/High risks in `03_RISK_REGISTER.csv` have explicit disposition; no source-only finding is counted as a passed runtime test.
- [ ] Immediate access withdrawal, all-role SUPER_ADMIN management, every-SUPER_ADMIN delete block and immutable built-in roles are verified on UI, REST and sockets. Include tombstone, transfer, disablement, role/password update, permission-definition and recovery-CLI paths; force both orders for an ownership-sensitive request already in flight during account change. Transfer-first must reject without mutation and write-first must commit before the account change. Source-level revocation is not a measured propagation result. `AUTHN-04`, `AUTHZ-01..02`, `AUTHZ-07`, `CONC-07`.
- [ ] Stable owner authorization passes for Media, Layout, Presentation and Schedule across organization/department/restricted scopes and every actor. Creator transfer/deletion leaves owner fields and historical `created_by` unchanged; Schedule Requests remain manageable by the original custodian; nested resources cannot widen access. `AUTHZ-07`; R-02/R-25/R-26/R-27.
- [ ] User tombstone/email reuse/list exclusion/history display, owning-department deletion counts, UI confirmation/labels/action flags, no deleted-email disclosure, upload/finalization and PROCESSING-worker commit orders, duplicate-worker safety, non-reactivation and retryable source/ready/thumbnail object cleanup pass with evidence. `DATA-06`, `CONC-07`, `REL-02`, `UI-07`; R-25/R-28.
- [ ] Delegated selected-screen emergencies are accessible from CMS and constrained to approved targets; a two-minute backend outage stops schedule/default/emergency playback and erases media cache. `AUTHZ-03`, `PLAYER-03..04`.
- [ ] Migration `0044` is rehearsed; the document page-count backfill dry-run is reviewed before apply; malformed/encrypted failures are resolved; rollback retains nullable compatibility columns until affected snapshots/PoP age out. `DATA-05`, `FILE-06`.
- [ ] Media upload, conversion, selected-page CMS preview, immutable snapshot, capable-player playback, page-aware PoP, webpage preview, chat and reports pass smoke/UAT on actual target hardware. `10_SMOKE_REGRESSION_UAT.md`.
- [ ] Video-only loop selection survives CMS draft/review/request and API/snapshot round trips; a short video completes at least three native cycles on one mounted occurrence, coexists with the selected PDF page, stops at schedule/takeover/secure-lock boundaries, and has no hidden audio, retry storm, stale callback or material resource growth. `UI-06`, `API-07`, `PLAYER-11`, `PLAYER-12`, `OBS-04`, `PERF-06`; R-24.
- [ ] Every target player has advertised `pdf_page_selection_v1`, or schedules using page >1 are demonstrably blocked. Page 1 remains compatible during rollout. `API-06`, `COMP-04`.
- [ ] Presentation authorization closure and exposed Requests API authorization have been runtime-assessed. Requests functional workflow, SSO runtime login, API-key business authentication and automatic webhook delivery are not release acceptance features.
- [ ] Human policies remaining for BQ-007 OPERATOR-directory privacy, BQ-011/012/013/014/015/016/017/018/019, and BQ-020 Media/chat recycle behavior are answered or recorded as explicit accepted scope limits. Stable content ownership and account tombstones are already confirmed; a remaining `TBD` affecting data exposure, recovery, capacity or critical playback cannot be silently converted to Pass.

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
