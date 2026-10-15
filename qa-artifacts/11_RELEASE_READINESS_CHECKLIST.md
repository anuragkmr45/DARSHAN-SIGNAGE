# Release Readiness Checklist

This is a release gate, not a current sign-off. Record owner, date, build/release ID, link to evidence and decision for each item. Targeted disposable Linux runtime evidence now exists in `evidence/runtime-2026-10-15/runtime-validation.md`; it does not replace the complete platform, security, recovery, soak or production-deployment gates.

## Current Targeted Feature Evidence

- [x] Disposable Linux CMS/API/Electron flow demonstrated independent PDF pages, video Loop On/Off, multiple items, simultaneous slots, corrupt-media advance, schedule hard stop, cached offline restart/recovery, take-down and page-aware PoP persistence.
- [x] CMS/server/player focused tests and builds passed; Linux AppImage and amd64 `.deb` were created with recorded hashes.
- [ ] Fresh-machine installation/reboot tests for the generated Linux packages remain pending.
- [ ] Windows x64 package/install/kiosk/playback and supported physical display matrix remain pending.
- [ ] Long soak, approved performance limits, two-minute secure lock/cache purge, mixed-version capability rollout, accessibility and full product/security regression remain pending.
- [ ] Repository-wide server lint requires disposition of the unrelated existing `src/jobs/index.ts:211` `prefer-const` error; feature-scope lint has 0 errors.

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
- [ ] An interrupted first install resumes correctly, old release stop script cannot stop the new active role, and stable volumes/site identity are preserved. `DEP-05`, `DEP-07`.

## Product And Security

- [ ] All release `P0` cases pass with execution evidence and reviewed defects. Open Critical/High risks in `03_RISK_REGISTER.csv` have explicit disposition; no source-only finding is counted as a passed runtime test.
- [ ] Immediate access withdrawal, all-role SUPER_ADMIN management, every-SUPER_ADMIN delete block and immutable built-in roles are verified on UI, REST and sockets. `AUTHN-04`, `AUTHZ-01..02`.
- [ ] Delegated selected-screen emergencies are accessible from CMS and constrained to approved targets; a two-minute backend outage stops schedule/default/emergency playback and erases media cache. `AUTHZ-03`, `PLAYER-03..04`.
- [ ] Migration `0044` is rehearsed; the document page-count backfill dry-run is reviewed before apply; malformed/encrypted failures are resolved; rollback retains nullable compatibility columns until affected snapshots/PoP age out. `DATA-05`, `FILE-06`.
- [ ] Media upload, conversion, selected-page CMS preview, immutable snapshot, capable-player playback, page-aware PoP, webpage preview, chat and reports pass smoke/UAT on actual target hardware. `10_SMOKE_REGRESSION_UAT.md`.
- [ ] Video-only loop selection survives CMS draft/review/request and API/snapshot round trips; a short video completes at least three native cycles on one mounted occurrence, coexists with the selected PDF page, stops at schedule/takeover/secure-lock boundaries, and has no hidden audio, retry storm, stale callback or material resource growth. `UI-06`, `API-07`, `PLAYER-11`, `PLAYER-12`, `OBS-04`, `PERF-06`; R-24.
- [ ] Every target player has advertised `pdf_page_selection_v1`, or schedules using page >1 are demonstrably blocked. Page 1 remains compatible during rollout. `API-06`, `COMP-04`.
- [ ] Presentation and exposed Requests API authorization gaps have been assessed. Requests functional workflow, SSO runtime login, API-key business authentication and automatic webhook delivery are not release acceptance features.
- [ ] Human policies remaining in BQ-007/011/012/013/014/015/016/017/018/019/020 are answered or recorded as explicit accepted scope limits. A `TBD` affecting data exposure, recovery, capacity or critical playback cannot be silently converted to Pass.

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
