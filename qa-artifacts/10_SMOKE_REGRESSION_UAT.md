# Smoke, Regression And UAT Selection

These suites select case IDs from `05_TEST_CASES.csv`; they do not duplicate steps. Targeted PDF-page/video-loop paths were partially executed on a disposable Linux setup on 2026-10-15 and are linked from the CSV and `evidence/runtime-2026-10-15/runtime-validation.md`. Beta6 delivery/availability/observability developer evidence is in `evidence/dashboard-observability-report-developer-verification-2026-11-02.md`. Neither record means the complete smoke, regression or UAT suites passed. Run remaining cases on the approved setup and record screenshots/logs/results in the CSV or linked test-management record.

## Post-Deployment Smoke

Sequence after a fresh install or planned update:

1. `DEP-01`, `DEP-06`, `OBS-01`: verify signed role and cross-VM trust, then strict Backend/worker readiness. For an already installed update, record the installer verification step rather than reinstalling.
2. `AUTHN-01`: CMS login with an active administrator; failed credential denies.
3. `AUTHZ-01`, `AUTHZ-08`, `AUTHZ-14..18`: verify one of two active SUPER_ADMIN accounts can be disabled but the remaining account cannot be deleted/disabled/demoted; create an A-primary/B-additional operator and verify A/B people and content, C denial, primary-owned new content, session withdrawal after removal, continued access to an already shared chat file or validated file bookmark, old PATCH preservation, and both department relationship views. Global User managers see all; primary-only operators retain same-department visibility.
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
16. `FUN-09..10`, `CHAT-01`, `CHAT-05..07`: keep two operator CMS profiles open, create a private DM and an open forum, send a synthetic message and one READY attachment, verify live recipient view, scoped preview, correct notification deep link and unread count after reading. The full membership/moderation/fault matrix remains regression QA.
17. `FUN-11`, `UI-04`, `OBS-02`, `PLAYER-07`: verify known-time availability, estimated outage, backend unknown, Never seen and IST buckets; publish one target and distinguish assigned, exact application, fresh reported playback and renderer PoP. Verify authenticated machine/player scrapes, truthful target/fleet totals, `/grafana/` health/login/drill-down and one controlled alert transition.

Smoke stops on failed signing/trust, data integrity, login, worker readiness, publish, player visibility, or emergency takeover. Report the specific failed ID; no pass by inference from a healthy container alone.

## Regression Suite

Always run all `P0` cases after a release touching shared API, schema, permissions, player identity, security policy, installer, or storage. For a release limited to one role, select relevant cases from these sets and include its cross-role dependency checks:

- Identity/access: `AUTHN-01..04`, `AUTHZ-01..13`, `SEC-01..02`, `UI-02`, `UI-07`, `CONC-07`.
- Media/content: `FILE-01..06`, `FUN-01..02`, `FUN-06`, `FUN-08`, `WEB-01..06`, `DEF-01..04`, `UI-05..06`, `API-05..07`, `DATA-05`, `CONC-06`, `PLAYER-05`, `PLAYER-08..16`, `OBS-03..04`, `COMP-04`, `PERF-05..06`.
- Schedules/emergencies: `FUN-03..05`, `FUN-07`, `CONC-01`, `CONC-03`, `DATA-02`.
- Device/runtime: `API-02..03`, `CONC-05`, `PLAYER-01..07`, `REL-01`.
- Collaboration/reporting: `FUN-09..12`, `CHAT-01..08`, `CONC-04`, `DATA-04`, `UI-04`.
- Operations: `DATA-01..03`, `DATA-06`, `DEP-01..07`, `BKP-01..03`, `OBS-01..02`, `REL-02`.
- Clients: `COMP-01..03`, `UI-01..03` on approved physical/browser targets.

`PERF-01..06` require a separate approved isolated capacity run and site thresholds; they are not part of every code-change regression. Full planned coverage is the current `05_TEST_CASES.csv`; verify its row count before selecting a run. Do not treat a unit-test file, TypeScript build or generated bundle validator as proof these live paths passed.

## UAT Journeys

| Actor | Walkthrough | Selected cases | Human acceptance focus |
| --- | --- | --- | --- |
| Site administrator | Log in, manage users/custom roles, exercise last-active protection, create ADMIN/SUPER_ADMIN content, publish own request | `AUTHN-01`, `AUTHZ-01..02`, `AUTHZ-13`, `FUN-01..04` | Last active SUPER_ADMIN survives; permission-driven custom roles; organization versus restricted content; expected screen output |
| Account administrator and department custodian | Delete a creator with active sessions/upload and retained Media/Layout/Presentation/Schedule; inspect history and continue eligible schedule work | `AUTHZ-07`, `DATA-06`, `CONC-07`, `UI-07` | Immediate access loss; no automatic person transfer; original department/organization custody; deleted-name attribution without email; unfinished upload cannot play; published output unchanged |
| Department/operator | With primary A and additional B, see permitted A/B people/content but not C; create A-owned content; change primary and revoke old sessions; enforce creator mutation for Media/Layout/Presentation and action-specific Schedule grants; use page selection and video loop | `AUTHZ-08..18`, `FUN-01..03`, `UI-01..02`, `UI-05..06`, `API-05`, `PLAYER-11` | Assigned-set privacy, stable historical ownership, primary-owned new content and chat file retention match expected results; selected page matches preview/player; loop repeats to its boundary |
| Emergency delegate | Open CMS control, select screens, trigger and clear | `AUTHZ-03`, `FUN-07`, `PLAYER-03` | Selected-screen delegation and emergency stop on lock |
| Viewer/field operator | Pair updated player, verify capability, validate fullscreen/portrait, schedule/default fallback, PDF errors, video failure/retry/boundary and locked recovery | `PLAYER-01..05`, `PLAYER-10..16`, `COMP-01..02`, `FUN-06`, `DEF-04` | Correct output, exact Unavailable state, original-boundary advance, bounded retry, 250 ms hard stop, selected PDF page, exact 120-second lock, targeted purge and fresh-authority recovery |
| Web content administrator | Register approved HTTP/HTTPS pages, reject login-required/escaping redirects, refresh preview and configure overlapping-group priority | `WEB-01..06`, `DEF-01..03`, `FUN-08`, `PLAYER-09` | Clear policy errors, latest successful fallback, deterministic priority and recoverable stale-save workflow |
| Communications/reporting user | In three separate browser profiles, create DM/group/forum, invite then remove a member, send text and shared files, react/reply/mention, read notifications, archive and recover after a controlled API/WSS interruption; then inspect availability, delivery evidence, PoP and report export | `FUN-09..11`, `CHAT-01..08`, `CONC-04`, `UI-04`, `PLAYER-07`, `OBS-02` | Private access and post-removal revocation; readable exact notification links; authoritative counts and recovery; known-time uptime/unknown; exact application versus reported playback versus PoP; bounded evidence loss; IST availability day; no physical-display claim |
| Release/recovery operator | Fresh signed role install, backend-only update, backup and isolated restore | `DEP-01..07`, `BKP-01..03` | Compatible releases, complete data, no silent schema rollback, RPO/RTO TBD |

The general Requests workboard is disabled; `AUTHZ-06` verifies absence and confirms Schedule Requests remain usable. SSO login, business API-key authentication and automatic webhook delivery are not UAT requirements for this release; management screens remain in `FUN-12`.

## Live broadcast implementation delta — 2026-11-03

1. Each loop: focused source/DB/lifecycle checks, then the running CMS with
   independent admin/presenter sessions and real packaged Electron receiver.
   Failures keep the loop open; fix and rerun the failed journey plus neighbors.
2. Local live smoke in the same ordinary installed DARSHAN desktop player:
   authorize the scheduled event/fallback, preview/cancel, start and see
   a decoded frame, optional audio, stop/restart, administrator disable,
   live→fallback→live, emergency/clear, local end and authority cutoff.
3. Security/fault delta: `LIVE-02..06`, `LIVE-08..16`, especially same-size group
   replacement, replay versus existing flow, revocation racing admission, late
   picker, supervisor failure, old cleanup, epoch restore and no hidden audio.
4. Stable packet regression: `LIVE-20` plus affected existing scheduling,
   default, emergency, pairing, ownership, cache, delivery and PoP cases.
   Complete server/CMS/player required builds/suites and `/screens` browser gate.
5. Human UAT: execute all `LIVE-01..20` on frozen artifacts; record real
   presenter/player/display/audio, supported browser/OS and site network/capacity
   outcomes. Local developer evidence does not pre-populate QA results.

For every fault require trigger→display→audio→recovery→cleanup evidence. Exact
source/artifact identifiers and remaining gates belong in [evidence/live-broadcast-developer-verification-2026-11-03.md](evidence/live-broadcast-developer-verification-2026-11-03.md).

## Runtime and authoring developer checkpoint — 2026-11-03

The current packet is **implemented in source, default OFF, partially developer-verified**. It is not a closed implementation loop, beta acceptance or release approval. [runtime/authoring developer evidence](evidence/live-runtime-authoring-developer-verification-2026-11-03.md) owns the exact source/build bindings and final evolving check totals. Historical reports retain their original source scope; an older SFU/prototype result cannot validate the new authority/host-readiness/player source. All `LIVE-01..20` remain **Not Tested** and QA-owned execution/result/defect/sign-off fields remain unchanged.

The bounded CMS authoring sequence has developer evidence through future-window Approve/Publish, including immutable reviewed image and request-bound frozen preview. It proves neither a live presenter connection nor an ordinary-player frame/audio result. New source includes presenter capture, normal-player integration and per-target reports; execute their actual combined journey next, including create-only consent, stale two-tab and lost-response recovery, optional audio, stop/restart/admin disable, emergency/security/window end and Unknown after report expiry. Final build/regression results belong in the dated ledger before human UAT.

### Current LIVE handoff

The later [developer ledger](evidence/live-broadcast-developer-verification-2026-11-03.md)
records the local current-source CMS → native capture → Media → ordinary
packaged Linux player frame, Stop/fallback/restart, a separate schedule-end
run and bounded regression. Independent testers must still run **every**
`LIVE-01..20` CSV case on frozen artifacts. Record actual display and optional
audio alongside Backend/player observations; execute cross-VM TLS/media,
Windows/browser, physical display/audio, 10×25 capacity and isolated restore
as explicit site gates. The local Firefox retry has been dropped from the
developer plan because the host isolated before its test window. The BQ-027
release browser matrix remains independent QA for real Chrome/Edge; no Firefox
support or pass is claimed.
