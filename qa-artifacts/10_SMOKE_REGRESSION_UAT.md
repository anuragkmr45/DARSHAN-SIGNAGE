# Smoke, Regression And UAT Selection

These suites select case IDs from `05_TEST_CASES.csv`; they do not duplicate steps. Targeted PDF-page/video-loop paths were partially executed on a disposable Linux setup on 2026-10-15 and are linked from the CSV and `evidence/runtime-2026-10-15/runtime-validation.md`. This does not mean the complete smoke, regression or UAT suites passed. Run remaining cases on the approved setup and record screenshots/logs/results in the CSV or linked test-management record.

## Post-Deployment Smoke

Sequence after a fresh install or planned update:

1. `DEP-01`, `DEP-06`, `OBS-01`: verify signed role and cross-VM trust, then strict Backend/worker readiness. For an already installed update, record the installer verification step rather than reinstalling.
2. `AUTHN-01`: CMS login with an active administrator; failed credential denies.
3. `AUTHZ-01`, `AUTHZ-08`: verify one of two active SUPER_ADMIN accounts can be disabled but the remaining account cannot be deleted/disabled/demoted; verify a non-global user sees only active same-department people while a global User manager sees all.
4. `AUTHZ-09..13`, `DATA-06`, `UI-07`: create department-owned disposable Media/Layout/Presentation/Schedule plus ADMIN/SUPER_ADMIN content; verify creator/global mutation for Media/Layout/Presentation, action-specific same-department Schedule management, cross-department denial, organization versus restricted classification and stable ownership after creator deletion.
5. `AUTHN-04`, `CONC-07`: with multiple REST/socket sessions on two API nodes, change the user's password/role and tombstone a creator with an active upload; verify post-commit old REST/socket access stops everywhere, unfinished upload cannot become READY, and existing published playback remains unchanged.
6. `AUTHZ-03`, `AUTHZ-06`: delegate triggers/clears only an authorized direct screen; global controller handles a group/global target; old general Requests URLs are not found while one Schedule Request flow works.
7. `FILE-01`: small synthetic image upload becomes READY and previews.
8. `FUN-03`, `FUN-04`: hold a short disposable schedule, administrator self-approves or direct-publishes, and published state appears.
9. `WEB-01`, `FUN-08`: register one approved HTTP and one HTTPS page, capture each and confirm the release policy; verify a denied redirect never reaches its target and a Basic-auth page receives no credentials.
10. `WEB-04..06`, `PLAYER-09`: manually refresh v1 to v2, confirm revision/checksum propagation and v2 display, then fail the next refresh/live page and confirm v2 remains visible; corrupt/miss v2 and confirm controlled older-revision/unavailable behavior.
11. `FUN-06`, `DEF-01..03`: resolve overlapping groups with unequal/equal priorities, confirm direct Screen precedence, edit media without changing priority, and make two same-revision saves; expect one success and one recoverable `409`.
12. `DEF-04`, `PLAYER-05`: clear every Screen/Group/aspect/global default and leave no active Schedule; expect the approved standard company image on the packaged player online, after restart and offline. Stop smoke if the display is blank or text-only.
13. `UI-05`, `API-05..06`, `PLAYER-10`, `OBS-03`: verify every updated target has connected and reported `pdf_page_selection_v1`; assign page 2, confirm it in author/review preview and immutable snapshot, play and record PoP. Isolate a post-publish page-count mismatch: expect exact `Unavailable`, `DOCUMENT_PAGE_OUT_OF_RANGE` diagnostics and no substitute page. Restore an invalid draft and confirm CMS preserves/blocks it rather than clamping.
14. `UI-06`, `API-07`, `PLAYER-11..15`, `OBS-04`: keep a selected page-2 PDF beside a short Loop On video for three cycles, then test corrupt video before valid content and a corrupt only-item frame. Expect original-boundary advance, one bounded 1–30 second retry, authority-change cancellation, and display/audio clear within 250 ms of schedule end. Repeat the critical path once.
15. `PLAYER-03..04`, `PLAYER-16`: after an authenticated success disconnect the backend; expect playback at 119 seconds and security lock at 120 seconds within one-second observation tolerance. While locked change server authority, restore reachability, and verify one ordered identity/fresh-snapshot/content/authority recovery; no heartbeat unlock or stale replay. Confirm only media cache was purged.
16. `FUN-09`, `FUN-10`: send a private test message and verify notification/read state.
17. `FUN-11`, `OBS-02`: verify report endpoint and authenticated metrics scrape/alert pipeline access.

Smoke stops on failed signing/trust, data integrity, login, worker readiness, publish, player visibility, or emergency takeover. Report the specific failed ID; no pass by inference from a healthy container alone.

## Regression Suite

Always run all `P0` cases after a release touching shared API, schema, permissions, player identity, security policy, installer, or storage. For a release limited to one role, select relevant cases from these sets and include its cross-role dependency checks:

- Identity/access: `AUTHN-01..04`, `AUTHZ-01..13`, `SEC-01..02`, `UI-02`, `UI-07`, `CONC-07`.
- Media/content: `FILE-01..06`, `FUN-01..02`, `FUN-06`, `FUN-08`, `WEB-01..06`, `DEF-01..04`, `UI-05..06`, `API-05..07`, `DATA-05`, `CONC-06`, `PLAYER-05`, `PLAYER-08..16`, `OBS-03..04`, `COMP-04`, `PERF-05..06`.
- Schedules/emergencies: `FUN-03..05`, `FUN-07`, `CONC-01`, `CONC-03`, `DATA-02`.
- Device/runtime: `API-02..03`, `CONC-05`, `PLAYER-01..07`, `REL-01`.
- Collaboration/reporting: `FUN-09..12`, `CONC-04`, `DATA-04`, `UI-04`.
- Operations: `DATA-01..03`, `DATA-06`, `DEP-01..07`, `BKP-01..03`, `OBS-01..02`, `REL-02`.
- Clients: `COMP-01..03`, `UI-01..03` on approved physical/browser targets.

`PERF-01..06` require a separate approved isolated capacity run and site thresholds; they are not part of every code-change regression. Full planned coverage is the 112-case CSV. Do not treat a unit-test file, TypeScript build or generated bundle validator as proof these live paths passed.

## UAT Journeys

| Actor | Walkthrough | Selected cases | Human acceptance focus |
| --- | --- | --- | --- |
| Site administrator | Log in, manage users/custom roles, exercise last-active protection, create ADMIN/SUPER_ADMIN content, publish own request | `AUTHN-01`, `AUTHZ-01..02`, `AUTHZ-13`, `FUN-01..04` | Last active SUPER_ADMIN survives; permission-driven custom roles; organization versus restricted content; expected screen output |
| Account administrator and department custodian | Delete a creator with active sessions/upload and retained Media/Layout/Presentation/Schedule; inspect history and continue eligible schedule work | `AUTHZ-07`, `DATA-06`, `CONC-07`, `UI-07` | Immediate access loss; no automatic person transfer; original department/organization custody; deleted-name attribution without email; unfinished upload cannot play; published output unchanged |
| Department/operator | See only own-department people; upload/read department content; enforce creator mutation for Media/Layout/Presentation and permitted action-specific Schedule management; use page selection and video loop | `AUTHZ-08..12`, `FUN-01..03`, `UI-01..02`, `UI-05..06`, `API-05`, `PLAYER-11` | Directory privacy and resource matrix match expected results; selected page matches preview/player; loop repeats to its boundary |
| Emergency delegate | Open CMS control, select screens, trigger and clear | `AUTHZ-03`, `FUN-07`, `PLAYER-03` | Selected-screen delegation and emergency stop on lock |
| Viewer/field operator | Pair updated player, verify capability, validate fullscreen/portrait, schedule/default fallback, PDF errors, video failure/retry/boundary and locked recovery | `PLAYER-01..05`, `PLAYER-10..16`, `COMP-01..02`, `FUN-06`, `DEF-04` | Correct output, exact Unavailable state, original-boundary advance, bounded retry, 250 ms hard stop, selected PDF page, exact 120-second lock, targeted purge and fresh-authority recovery |
| Web content administrator | Register approved HTTP/HTTPS pages, reject login-required/escaping redirects, refresh preview and configure overlapping-group priority | `WEB-01..06`, `DEF-01..03`, `FUN-08`, `PLAYER-09` | Clear policy errors, latest successful fallback, deterministic priority and recoverable stale-save workflow |
| Communications/reporting user | Chat, notifications, PoP and report export | `FUN-09..11`, `UI-04`, `PLAYER-07` | Private membership, counts, evidence loss and report meaning TBD |
| Release/recovery operator | Fresh signed role install, backend-only update, backup and isolated restore | `DEP-01..07`, `BKP-01..03` | Compatible releases, complete data, no silent schema rollback, RPO/RTO TBD |

The general Requests workboard is disabled; `AUTHZ-06` verifies absence and confirms Schedule Requests remain usable. SSO login, business API-key authentication and automatic webhook delivery are not UAT requirements for this release; management screens remain in `FUN-12`.
