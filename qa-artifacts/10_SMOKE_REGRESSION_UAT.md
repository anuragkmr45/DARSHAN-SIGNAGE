# Smoke, Regression And UAT Selection

These suites select case IDs from `05_TEST_CASES.csv`; they do not duplicate steps. Targeted PDF-page/video-loop paths were partially executed on a disposable Linux setup on 2026-10-15 and are linked from the CSV and `evidence/runtime-2026-10-15/runtime-validation.md`. This does not mean the complete smoke, regression or UAT suites passed. Run remaining cases on the approved setup and record screenshots/logs/results in the CSV or linked test-management record.

## Post-Deployment Smoke

Sequence after a fresh install or planned update:

1. `DEP-01`, `DEP-06`, `OBS-01`: verify signed role and cross-VM trust, then strict Backend/worker readiness. For an already installed update, record the installer verification step rather than reinstalling.
2. `AUTHN-01`: CMS login with an active administrator; failed credential denies.
3. `FILE-01`: small synthetic image upload becomes READY and previews.
4. `FUN-03`, `FUN-04`: hold a short disposable schedule, administrator self-approves or direct-publishes, and published state appears.
5. `UI-05`, `API-05`, `PLAYER-10`, `OBS-03`: assign page 2 of a multi-page PDF, confirm page 2 in author/review preview and immutable snapshot, play page 2 on a capable device, and confirm PoP records page 2. Native display evidence required.
6. `UI-06`, `API-07`, `PLAYER-11`, `PLAYER-12`, `OBS-04`: in one short multi-slot schedule, keep the selected page-2 PDF visible in one frame and a short Loop On video in another for at least three video durations. Confirm the video repeats complete cycles on one active occurrence, the PDF never changes page, and both clear exactly at schedule end. Repeat once with Loop Off and confirm one video play only.
7. `FUN-07`: trigger and clear a selected-screen emergency during a loop using disposable media; the old video/audio stops, the emergency owns the display, and clear returns to current scheduled/default authority without a stale callback.
8. `FUN-09`, `FUN-10`: send a private test message and verify notification/read state.
9. `FUN-11`, `OBS-02`: verify report endpoint and authenticated metrics scrape/alert pipeline access.

Smoke stops on failed signing/trust, data integrity, login, worker readiness, publish, player visibility, or emergency takeover. Report the specific failed ID; no pass by inference from a healthy container alone.

## Regression Suite

Always run all `P0` cases after a release touching shared API, schema, permissions, player identity, security policy, installer, or storage. For a release limited to one role, select relevant cases from these sets and include its cross-role dependency checks:

- Identity/access: `AUTHN-01..04`, `AUTHZ-01..06`, `SEC-01..02`, `UI-02`.
- Media/content: `FILE-01..06`, `FUN-01..02`, `FUN-06`, `FUN-08`, `UI-05..06`, `API-05..07`, `DATA-05`, `CONC-06`, `PLAYER-08..12`, `OBS-03..04`, `COMP-04`, `PERF-05..06`.
- Schedules/emergencies: `FUN-03..05`, `FUN-07`, `CONC-01`, `CONC-03`, `DATA-02`.
- Device/runtime: `API-02..03`, `CONC-05`, `PLAYER-01..07`, `REL-01`.
- Collaboration/reporting: `FUN-09..12`, `CONC-04`, `DATA-04`, `UI-04`.
- Operations: `DATA-01..03`, `DEP-01..07`, `BKP-01..03`, `OBS-01..02`, `REL-02`.
- Clients: `COMP-01..03`, `UI-01..03` on approved physical/browser targets.

`PERF-01..06` require a separate approved isolated capacity run and site thresholds; they are not part of every code-change regression. Full planned coverage is the 92-case CSV. Do not treat a unit-test file or generated bundle validator as proof these live paths passed.

## UAT Journeys

| Actor | Walkthrough | Selected cases | Human acceptance focus |
| --- | --- | --- | --- |
| Site administrator | Log in, manage user roles, create content, publish own request directly or after self-approval | `AUTHN-01`, `AUTHZ-01..02`, `FILE-01`, `FUN-01..04` | Every SUPER_ADMIN delete blocked; all-role management; fixed built-ins; expected screen content |
| Department/operator | Upload, create layout/presentation/schedule, select and preview different document pages, independently enable video loop, and see only approved collaborators | `AUTHZ-04..05`, `FUN-01..03`, `UI-01..02`, `UI-05..06`, `API-05`, `PLAYER-11` | Selected page matches preview/player; looped video repeats until its defined boundary; BQ-007 content/visibility matrix unresolved; presentation access requires security assessment |
| Emergency delegate | Open CMS control, select screens, trigger and clear | `AUTHZ-03`, `FUN-07`, `PLAYER-03` | Selected-screen delegation and emergency stop on lock |
| Viewer/field operator | Pair player, install package, validate fullscreen/portrait, schedule/default fallbacks, looping video and selected-page PDF coexistence | `PLAYER-01..05`, `PLAYER-10..12`, `COMP-01..02`, `FUN-06` | Correct physical output, complete video cycles with hard stop, selected PDF page, two-minute lock/cache erasure, BQ-012 default choice |
| Communications/reporting user | Chat, notifications, PoP and report export | `FUN-09..11`, `UI-04`, `PLAYER-07` | Private membership, counts, evidence loss and report meaning TBD |
| Release/recovery operator | Fresh signed role install, backend-only update, backup and isolated restore | `DEP-01..07`, `BKP-01..03` | Compatible releases, complete data, no silent schema rollback, RPO/RTO TBD |

The general Requests workboard is excluded from functional/UAT acceptance; `AUTHZ-06` remains a security check because the routes exist. SSO login, business API-key authentication and automatic webhook delivery are not UAT requirements for this release; management screens remain in `FUN-12`.
