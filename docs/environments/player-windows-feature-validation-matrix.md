# Windows Feature Validation Matrix

## Status Key

- `Static pass` = code audit found no blocker
- `Automated coverage` = local test coverage exists for an important branch
- `Manual Windows validation required` = must be executed on Windows 10/11
- `Legacy Linux-only` = not part of supported Windows workflow

## Matrix

| Feature | Primary code/files | Automated coverage | Manual Windows validation | Current status |
| --- | --- | --- | --- | --- |
| Windows packaging (`package:win`) | `package.json` | No Windows-native packaging test in this audit | Run `npm run package:win` on Windows and inspect NSIS output | Manual Windows validation required |
| NSIS install/upgrade/uninstall | `package.json` | None | Install, relaunch, upgrade, uninstall on Windows 10/11 | Manual Windows validation required |
| First launch with no backend config | `src/common/config.ts`, `src/main/index.ts`, `src/renderer/pairing.ts` | `test/unit/common/config.test.ts` covers non-invented backend behavior | Verify packaged app stays in configuration-required/pairing state on Windows | Static pass + manual Windows validation required |
| Windows runtime root / AppData pathing | `src/common/platform-paths.ts` | `test/unit/common/platform-paths.test.ts` | Verify logs, cache, certs, config, screenshots write under AppData | Static pass + automated coverage |
| CLI parsing | `src/main/cli.ts`, `src/main/cli-runner.ts` | `test/unit/main/cli.test.ts` | Run packaged or Node-driven `doctor`, `clear-cache`, `collect-logs`, `pair request`, `pair submit` on Windows | Static pass + automated coverage |
| Runtime mode / kiosk policy | `src/main/runtime-mode.ts`, `src/main/index.ts` | `test/unit/main/runtime-mode.test.ts` | Verify fullscreen, cursor hiding, keyboard/mouse blocking in `qa` and `production` | Static pass + automated coverage |
| Single instance / relaunch focus | `src/main/index.ts` | No direct automated coverage reviewed | Launch twice and confirm existing window is focused correctly | Manual Windows validation required |
| Autostart | `src/main/services/autostart.ts` | No Windows-branch test reviewed | Verify login-item registration, sign-out/sign-in relaunch, disable path | Manual Windows validation required |
| Power-management degradation | `src/main/services/power-manager.ts` | No Windows-branch test reviewed | Confirm no `xset` failures break runtime; confirm Electron blocker behavior is acceptable | Static pass + manual Windows validation required |
| Pairing request/submit flow | `src/main/services/pairing-service.ts`, `src/renderer/pairing.ts`, `src/main/services/cert-manager.ts` | `test/integration/pairing-flow.test.ts` covers logic, not Windows packaged runtime | Pair against a real backend from Windows and confirm cert storage | Static pass + manual Windows validation required |
| mTLS certificate storage | `src/main/services/cert-manager.ts`, `src/common/platform-paths.ts` | No Windows-specific coverage reviewed | Verify cert files are written and reused across relaunch | Manual Windows validation required |
| Image playback | `src/renderer/player.ts`, `src/renderer/default-media-player.ts` | Renderer/unit coverage exists, not Windows-native | Validate slideshow/image playback on Windows | Manual Windows validation required |
| Video playback | `src/renderer/player.ts`, `src/renderer/default-media-player.ts` | No Windows codec/runtime test reviewed | Validate autoplay, looping, and codec behavior on Windows | Manual Windows validation required |
| PDF playback | `src/renderer/player.ts`, renderer media flow | No Windows-native coverage reviewed | Validate PDF display/performance on Windows | Manual Windows validation required |
| Retired webpage handling | `src/common/media-compat.ts`, `src/renderer/player.ts`, `src/main/services/snapshot-manager.ts` | Unit coverage rejects retired webpage/URL items and prevents source or old-preview fetches | Confirm an old item shows controlled `Content unavailable` without a source/preview network request | Static pass + automated coverage + manual Windows validation required |
| Screenshot capture and upload | `src/main/services/screenshot-service.ts` | `test/unit/services/screenshot-service.test.ts` exists, not Windows-native | Validate capturePage path, saved files, upload flow | Static pass + manual Windows validation required |
| Log collection | `src/main/services/operator-tools.ts`, `src/common/platform-paths.ts` | No Windows-native coverage reviewed | Run `collect-logs` and inspect archive contents/paths | Manual Windows validation required |
| Cache clear | `src/main/services/operator-tools.ts`, cache services | No Windows-native coverage reviewed | Run `clear-cache` and confirm only intended runtime data is removed | Manual Windows validation required |
| System telemetry / health | `src/main/services/telemetry/*` | General coverage only | Verify heartbeat/system stats on Windows; temperature may be absent and acceptable | Static pass + manual Windows validation required |
| POP spool / offline buffering | `src/main/services/pop-service.ts`, `src/main/services/log-shipper.ts` | Unit coverage exists, not Windows-native | Validate spool file creation/flush under AppData paths | Manual Windows validation required |
| Operator doctor output | `src/main/services/operator-tools.ts` | CLI parsing coverage only | Confirm Windows output is useful and does not treat absent Linux tools as fatal | Manual Windows validation required |
| Linux shell scripts | `scripts/*.sh`, `scripts/darshan-player.service` | N/A | Not applicable to Windows | Legacy Linux-only |
| Linux legacy import | `src/common/platform-paths.ts` | `test/unit/common/platform-paths.test.ts` | Confirm it does not run on Windows | Static pass + automated coverage |

## Native Windows execution — 2026-11-05 (in progress)

The focused native run is recorded in `qa-artifacts/evidence/windows-player-native-runtime-validation-2026-11-05.md`.

- Native build and x64 NSIS packaging: **pass**.
- Initial install, visible pairing UI, strict TLS, single-instance behavior, pending-pair restart and automatic OTP renewal: **pass**.
- Missing site config controlled UI: **pass**.
- Malformed selected config controlled UI: **fail in the initial package (P1), pass after approved rebuilt install**; the installed player stayed open on the controlled setup-required state with no device identity or invented backend.
- Frozen dependency install, Windows-safe npm test discovery, build, lint, and the six-test native integration suite: **pass after remediation**.
- Final native unit suite as a standard user: **529 pass / 9 pending / 5 privilege-blocked**. The former suite-order failure passed in this full run.
- Native Administrator symlink gate: **5/5 pass** after two Windows-invalid POSIX mode-bit assertions were made platform-correct; Docker also passes the same five cases as supplemental evidence.
- Native fault injection: **22/22 pass**. Performance: **8/8 pass**. Renderer browser regression: **1/1 pass after fixing portrait emergency text overflow and Windows profile cleanup**.
- Installed operator tooling: **doctor, pairing-status, collect-logs and paired clear-cache pass**. The paired clear removed 4 files / 308,607 bytes while preserving identity, certificate hashes, logs and queues; after an exact-path restart the paired player redownloaded the same 4 files / 308,607 bytes and returned ONLINE in the default-content state without an OTP. The support bundle passed the required secret scan; retained operational UUIDs and the empty operator-only display inventory are recorded as deferred P2 evidence/diagnostics debt.
- Registered Start Menu launch, an exact 79-file temporary program copy launched from a path containing spaces, and production F12/Ctrl+Shift+I blocking: **pass**, with exactly one player window and no DevTools surface. The ordinary installed player was restored and the temporary duplicate removed. Windows-key injection is blocked by the automation safety policy.
- Packaged QA runtime: **bounded pass**. Installed doctor reported mode `qa`; the isolated real window remained controlled and F12/Ctrl+Shift+I opened no DevTools. Production mode and the same pending Device ID were restored afterward.
- Production Alt+F4 and Ctrl+R blocking: **pass**, preserving the same window and Device ID. Right-click remains tool-observability blocked; the failed action was not converted into a pass. Windows-key injection remains prohibited.
- Autostart/uninstall preflight: **pass** for one exact current-user Run/startup entry and one current-user uninstall registration. Actual sign-in/reboot, repair/reinstall and uninstall/reinstall remain approval-gated lifecycle tests.
- Pre-pair backend outage/recovery: **pass** using the isolated `WIN-QA-20261105-` closed-port fixture with strict TLS still enabled. The installed player held one coherent recovery window without issuing an identity, then restored the ordinary waiting state and same Device ID when relaunched normally.
- Real CMS browser entry: **partial pass after approved scoped trust import**. The verified QA CA exists once in Current User Root and zero times in Local Machine Root. Direct user sign-in in native Edge reached the authenticated dashboard and Screens page with zero visible screens, and the Pair Device dialog opened. Before any submission, the CMS redirected the tab to login and raised a false-positive `devtools viewport heuristic` production lock; the lock was not bypassed. The P1 baseline-delta remediation passes 4/4 focused tests, the full 291/291 CMS unit suite, full lint with zero errors and the exact production-lock build/bundle gate locally. A Docker-served native Edge smoke with the same startup banner remained unlocked; native F12 reinjection was tool-blocked and is not claimed. Authorized QA packaging/deployment and real-browser reverification remain required.
- CMS pairing and all post-pairing playback/evidence journeys: **blocked at CMS submission**. Server-authoritative generation 55 expiry, automatic generation 56 issuance, changed code, stable hostname and stable redacted Device ID are verified; old-code rejection and latest-code approval are not.

### Local Docker continuation — 2026-11-06

The user-authorized `win-qa-20261105-local` target supersedes the unavailable
Ubuntu deployment for this run. Functional CMS/API/player evidence uses
`http://localhost:18444`, deployment identity
`windows-player-qa-20261105-local`, release
`windows-player-qa-20261105-local-36f2fc3`, and only
`WIN-QA-20261105-LOCAL-` fixtures. Remote Ubuntu deployment and production TLS
are **NOT VERIFIED** non-blocking follow-ups.

- Pairing, signed credential persistence, one-screen identity, Windows OS and fresh heartbeat telemetry: **PASS**.
- Default media, scheduled image/portrait/video/PDF playback, delivery acknowledgement, proof-of-play and screenshot command/upload: **PASS**.
- Future group-targeted publication: **PASS**; one group member resolved to one screen, delivery targets succeeded, the upcoming item was reported and it did not play early.
- Overlapping schedule publication: **PASS**; rejected with `SCREEN_TIME_WINDOW_CONFLICT` and no forced conflicting publication.
- Bounded CMS-gateway outage and recovery: **PASS** for cached playback, pairing preservation, stale backend health, queue flush and automatic heartbeat recovery. The installed player incorrectly kept its visible `ONLINE` badge during the outage: **FAIL (P1)**.
- Targeted CRITICAL emergency: **PASS** for visible takeover, CMS/Now Playing correlation, screenshot upload, restart persistence, clear while disconnected, no stale replay after reconnect, and default recovery.
- Paired installed operator tools: `doctor`, `pairing-status` and `collect-logs` **PASS** for exit status, Windows/QA runtime paths, paired identity/certificate presence and local-backend reachability. The eight-file support bundle contained none of the prohibited secret/certificate material, but its sanitized log retained full operational UUIDs including the current device ID; the bundle is internal-only, was deleted after review, and this is recorded as deferred P2 evidence-redaction debt.
- Paired `clear-cache`: **PASS**. It reduced the media cache from 4 files / 308,607 bytes to zero without changing the paired identity or any certificate hash and without deleting logs, request/PoP queues or screenshots. The intended QA kiosk policy blocked Alt+F4, so the verified exact-path processes were terminated for the restart; the player reused pairing and redownloaded 4 files / 308,607 bytes into an ONLINE / DEFAULT MEDIA state.
- P1 visible-backend-state remediation: focused new tests **2/2 pass**; broader affected tests **35 pass** with three unrelated Windows hard-link privilege cases excluded; lint has zero errors and build passes. Rebuilt unsigned NSIS SHA-256 `5973a8e726fcf210587ae3880d8f81ceb41cbd813ac986406b557c8f2c52dece`, 105,359,666 bytes, awaits explicit installation approval and real outage reverification.

## Recommended Release Gate

Do not declare Windows fully signed off until these rows are manually executed on a Windows machine and recorded:

- Windows packaging
- NSIS install/upgrade/uninstall
- first launch / config-required state
- pairing
- kiosk behavior
- image/video/PDF playback and retired-webpage fail-closed handling
- screenshot capture
- log collection
- autostart

Use `player-windows-runtime-validation-checklist.md` as the execution record.
