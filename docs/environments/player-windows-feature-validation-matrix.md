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
- Initial install, visible pairing UI, strict TLS, pending-pair restart and automatic OTP renewal: **pass**. Single-instance behavior was reverified on the current 105,360,676-byte installed candidate: a second exact-path launch exited, preserved the original main process and left exactly one kiosk process tree.
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
- CMS browser entry: **PASS for the authorized local-Docker functional target; remote production-TLS follow-up not verified**. The original Ubuntu/native-Edge attempt correctly stopped at certificate trust and later exposed a false-positive production inspection lock; the lock was not bypassed, and the focused remediation passed 4/4 plus the 291/291 CMS unit suite and lint. The user then authorized `win-qa-20261105-local` at `http://localhost:18444`: direct native-Edge sign-in, pairing, screen/media/layout selection, schedule submission and approval succeeded. The current browser session later expired under the configured 900-second idle-token policy and awaits manual reauthentication; this does not invalidate the completed local functional journeys. Remote Ubuntu deployment and production TLS are non-blocking follow-ups for this run.
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
- Edge media: **PASS** for a verified 6000×4000 JPEG, one-page PDF, selected page 3 of a multi-page PDF, portrait containment, and visible MP4 decode. Corrupt and encrypted PDFs were rejected during ingest with explicit invalid/encrypted reasons. Snapshot and progress evidence confirms audio-enabled/loop-on and muted/loop-off video semantics; physical audible output is not claimed.
- Future group-targeted publication: **PASS**; one group member resolved to one screen, delivery targets succeeded, the upcoming item was reported and it did not play early.
- Overlapping schedule publication: **PASS**; rejected with `SCREEN_TIME_WINDOW_CONFLICT` and no forced conflicting publication.
- Bounded CMS-gateway outage and recovery: **PASS** for cached playback, pairing preservation, stale backend health, queue flush and automatic heartbeat recovery. The old installed player incorrectly kept its visible `ONLINE` badge during the outage. The current approved 105,360,676-byte installed candidate visibly reported `OFFLINE`, retained the assigned default frame without a broken-image glyph, returned `ONLINE` after recovery, and restored the isolated cache object byte-for-byte.
- Targeted CRITICAL emergency: **PASS** for visible takeover, CMS/Now Playing correlation, screenshot upload, restart persistence, clear while disconnected, no stale replay after reconnect, and default recovery.
- Paired installed operator tools: `doctor`, `pairing-status` and `collect-logs` **PASS** for exit status, Windows/QA runtime paths, paired identity/certificate presence and local-backend reachability. The eight-file support bundle contained none of the prohibited secret/certificate material, but its sanitized log retained full operational UUIDs including the current device ID; the bundle is internal-only, was deleted after review, and this is recorded as deferred P2 evidence-redaction debt.
- Paired `clear-cache`: **PASS**. It reduced the media cache from 4 files / 308,607 bytes to zero without changing the paired identity or any certificate hash and without deleting logs, request/PoP queues or screenshots. The intended QA kiosk policy blocked Alt+F4, so the verified exact-path processes were terminated for the restart; the player reused pairing and redownloaded 4 files / 308,607 bytes into an ONLINE / DEFAULT MEDIA state.
- Restart during active video: **FAIL (P1) on superseded installed candidate → CURRENT INSTALLED RESTART + PoP PASS**. The approved unsigned 105,360,296-byte package reproduced black playback twice after restart. The first listener-gap fix restored the item, but ordinary initial navigation then published a false LIVE suspension that cleared the normal schedule. Same-window attachment now keeps the content epoch stable and live interruption is a no-op unless LIVE owns content. On the repaired 105,360,676-byte installed candidate, `WIN-QA-20261105-LOCAL-INSTALLED-FINAL-VIDEO-02` published to the dedicated screen, rendered moving decoded video, survived an exact-process restart at 20:44:37, resumed moving video ONLINE, reported one correct active slot, received `ACKED_SUCCESS`, and produced a matching fresh CMS screenshot. The transient old/new heartbeat overlap cleared automatically. At the natural 21:28 boundary the player returned ONLINE to assigned default media; CMS recorded exactly one recent completed interval from 20:44:40 to 21:28:00, and local PoP state drained with zero drops or compaction.
- Restart with only default content: **PASS** on the current approved 105,360,676-byte installed candidate. Three controlled restarts returned paired and ONLINE with the assigned default visible. The fixture intentionally contains DARSHAN's `No content assigned` artwork; debug overlay identification and direct cached-PNG inspection confirmed that the apparent standby was the assigned image itself. Normal logging was restored after diagnosis.
- Missing cached default while offline: **PASS** on the current approved 105,360,676-byte installed candidate. With the exact dedicated media-cache object isolated and only the local API container stopped, an exact installed-player restart visibly reported `OFFLINE` and retained a safe last-decoded default frame instead of a broken-image glyph. Restoring the API returned the player to `ONLINE` and repopulated the exact cache object byte-for-byte. A second direct-file-tamper probe confirmed the renderer safely retained the frame; because direct filesystem tampering bypasses the supported cache-manager contract, the backup was restored after the bounded probe rather than claiming continuous external file-deletion monitoring.
- Active PDF restart: **SOURCE PASS / CURRENT INSTALLED VERIFICATION PENDING**. The exact selected-page `SOURCEFIX-PDF-01` journey returned page 3 after restart; fixture pages are intentionally blank and the expected white 16:9 page was visible. The repaired 105,360,676-byte package is installed; the exact real CMS selected-page restart remains open.
- Combined P1 remediation: the renderer arms listeners before refresh, synchronizes current playback after applying lifecycle state, retains render tokens, defers boot items until a newer authoritative schedule presentation, and avoids false LIVE suspension during ordinary navigation. Default-media failures render a controlled unavailable state and resynchronize on default-entry or recovery. Final focused coverage is **29/29**, broader affected coverage **50/50**, current-source Administrator symlink coverage **5/5**, integration **6/6**, and fault injection **22/22**. The final full unit sweep is **537 pass / 9 pending / 6 established host-environment/tooling failures**; lint has zero errors and the production build passes. The `0b0fe27d…a56` candidate is superseded. Unsigned NSIS SHA-256 `2454af0bd0cd8fa4f00062e4c85d327a085cf763db25413f883e49045c079cd6`, 105,360,676 bytes, was explicitly approved and installed. Exact installed active-video rendering, natural default handoff and no-duplicate closed PoP interval now pass; installed selected-page PDF restart and final regression remain open.

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
