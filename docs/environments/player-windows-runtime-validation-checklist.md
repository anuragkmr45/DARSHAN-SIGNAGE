# Windows Runtime Validation Checklist

Use this checklist on a real Windows 10/11 x64 machine or VM. Record each step as `pass`, `degraded but acceptable`, `fail`, or `blocked`.

## Test Host Prerequisites

- Windows 10 or Windows 11 x64
- Desktop session login available
- Node.js 20 LTS
- npm
- Git
- backend reachable over LAN/IP
- sufficient local disk space for cache and logs

## Build And Package

1. Clone the player repo on the Windows machine.
2. Install dependencies.
3. Build the app.
4. Package the Windows installer.

Commands:

```powershell
cd darshan-player
npm ci
npm run clean
npm run build
npm run package:win
```

Expected result:

- `build/` contains an NSIS `.exe` installer
- packaging completes without Linux-only tooling assumptions

Failure hints:

- if packaging expects Linux paths or shell tools, treat that as a Windows blocker

## Install And First Launch

1. Install the NSIS package.
2. Install to a path containing spaces if possible.
3. Launch from:
   - installer completion
   - Start Menu
   - desktop shortcut if created

Expected result:

- app launches successfully
- first launch does not crash
- if backend is not configured, the app remains usable in configuration-required/pairing state

Failure hints:

- if the app exits immediately, check packaged logs and Electron startup errors

## Runtime Paths

1. Determine the runtime root used on Windows.
2. Confirm these are created under the Electron app-data area:
   - config
   - logs
   - cache
   - certs
   - screenshots or diagnostics output if generated

Checks:

- paths are writable
- paths work with spaces
- relaunch reuses the same runtime root

Expected result:

- runtime data lives under `%APPDATA%` or the resolved per-user app-data directory

## CLI / Operator Tools

Run:

```powershell
npm run doctor
npm run clear-cache
npm run collect-logs
npm run pair:request
```

Expected result:

- commands run without Linux shell dependencies
- output paths are valid on Windows
- `doctor` is informative even when Linux-specific tools are absent

Failure hints:

- if `doctor` reports `xset`/`xrandr` absence as informational only, that is acceptable
- if the command crashes due to Linux-only assumptions, treat as failure

## Pairing And Certificates

1. Configure backend IP values.
2. Launch the player.
3. Pair with a real backend using a valid pairing code.
4. Confirm device registration appears in CMS.
5. Relaunch the app and confirm pairing persists.

Expected result:

- pairing succeeds
- certificates are written to the Windows runtime root
- subsequent API traffic uses the persisted identity

## Kiosk Behavior

Validate both `qa` and `production` runtime modes.

Checks:

- app opens fullscreen
- input-blocking policy works as intended
- cursor hiding is acceptable
- relaunch after crash preserves lock policy
- launching a second instance focuses the first instance
- multi-monitor geometry is handled safely

Expected result:

- Windows behavior matches the intended kiosk contract closely enough for deployment

## Playback

Validate all supported content types:

- image
- video
- PDF
- retired webpage item shows Content unavailable without network loading
- default/fallback media

Checks:

- autoplay and looping work
- transitions render correctly
- renderer remains stable when a retired webpage item appears in an old snapshot

Expected result:

- playback is stable enough for a prolonged kiosk session

## Screenshots And Diagnostics

1. Trigger screenshot capture through the supported path.
2. Confirm the image is saved and, where applicable, uploaded.
3. Run log collection again and inspect the output bundle.

Expected result:

- screenshots are captured successfully
- diagnostics bundle includes expected logs and metadata

## Autostart

1. Enable autostart through the supported flow.
2. Sign out and sign in again.
3. Reboot the machine if practical.

Expected result:

- the app relaunches on user login
- behavior matches the user-session install model

## Upgrade

1. Install an older Windows package.
2. Pair/configure the device.
3. Install a newer NSIS package over the top.

Expected result:

- app upgrades cleanly
- config and pairing state remain intact unless intentionally migrated

## Uninstall

1. Uninstall the app.
2. Record what remains in the runtime root.

Expected result:

- only the intended runtime state remains or is removed according to product policy
- no unexpected files are left behind in program directories

## Record Sheet

### Historical pre-local-Docker checkpoint — 2026-11-05

The table below preserves the state before the authorized local-Docker
continuation. Current results are in the later `Authorized local Docker
continuation — 2026-11-06` table and supersede pending entries here.

Detailed evidence: `qa-artifacts/evidence/windows-player-native-runtime-validation-2026-11-05.md`.

| Step | Result | Notes |
| --- | --- | --- |
| Build/package | PASS | Node 20 x64 build and unsigned x64 NSIS package completed |
| Install | PASS | Exact approved initial package installed per user |
| First launch | PASS | Visible fullscreen forest pairing surface; strict API/TLS succeeded |
| Runtime paths | PASS | ProgramData site files plus per-user AppData runtime state |
| CLI tools | PASS (P2 noted) | Installed `doctor`, `pairing-status`, `collect-logs` and paired `clear-cache` exit 0 with Windows paths. Paired clear removed 4 files / 308,607 bytes, preserved identity/certificates/queues/logs, and the same 4 files / 308,607 bytes redownloaded after an exact-path restart without another OTP. The eight-file support bundle passed the required secret scan; retained operational UUIDs and the empty operator-only display inventory are deferred P2 diagnostics/evidence debt. |
| Pairing | IN PROGRESS | Pending restart passed. Server-authoritative generation 55 expired unconfirmed and generation 56 appeared with a different code while hostname and redacted Device ID stayed stable. Authenticated CMS dashboard/Screens/Pair Device loaded, but the CMS production inspection lock redirected Edge to login before old-code rejection or latest-code approval. No screen was created. |
| Kiosk `qa` | PARTIAL PASS | Isolated packaged fixture confirmed mode `qa`, one controlled locked window, and F12/Ctrl+Shift+I blocking; physical cursor/mouse/Alt+Tab and playback remain open. Production mode and the same pending Device ID were restored. |
| Kiosk `production` | PARTIAL PASS | Fullscreen, registered Start Menu/single-instance behavior, exact program launch from a path containing spaces, and F12/Ctrl+Shift+I/Alt+F4/Ctrl+R blocking passed. A native window-targeted right-click produced no context menu or extra player window. The pairing surface remained coherent at 150% display scale. Windows-key injection is prohibited; physical cursor/Alt+Tab, player-content audio and whole-machine sleep checks remain open. |
| Image playback | NOT RUN |  |
| Video playback | NOT RUN |  |
| PDF playback | NOT RUN |  |
| Retired webpage handling | NOT RUN |  |
| Screenshot capture | NOT RUN |  |
| Log collection | NOT RUN |  |
| Autostart | PREPARED / RUNTIME OPEN | Exactly one current-user Run/startup command targets the hash-verified installed executable. Two DARSHAN-specific Current User environment selectors now persist the existing local-Docker canonical `player-runtime/config.json` and runtime root so a future Run launch does not fall back to the unavailable remote ProgramData profile. Both targets were re-read after the fresh re-pair. Actual sign-out/sign-in and reboot inheritance remains to be verified. |
| Upgrade | BLOCKED | No older approved package is available |
| Same-package repair | PASS | The exact final unsigned installer `d5195406…630a`, 105,359,989 bytes, was rehashed immediately before a silent repair. Installer exit was 0, the installed executable returned to the exact approved hash, pairing persisted without OTP, one ONLINE/DEFAULT MEDIA kiosk returned, and the backend retained one fresh dedicated ACTIVE screen with zero active schedules/slots. |
| Uninstall/reinstall | PASS / P2 DEFERRED | Exact hash-recorded uninstaller exited 0, removed all installed program files and its registration, and retained AppData, ProgramData and the isolated paired runtime. It left a stale Current User Run value while the executable was absent (P2). Reinstall of exact `d5195406…630a` exited 0, restored the exact executable hash and registrations, reused pairing without OTP, and returned one ONLINE/DEFAULT MEDIA kiosk plus one fresh dedicated backend screen. |

Observed failure journeys:

- Missing ProgramData config: **PASS**, controlled setup-required screen.
- Malformed selected config: **FAIL (P1)** in the initial package; **PASS** after approved rebuilt installation of SHA-256 `fbaaa365…ca0b`.
- Automated Windows gate: **PARTIAL PASS**. Frozen pnpm install, build, lint, Windows-safe test discovery, and integration (6/6) pass. The final standard-user unit suite records 529 passing, 9 intentionally pending, and 5 failing; every failure stops at Windows symlink-creation privilege before exercising its assertion, while the former suite-order case passes in the full run.
- Native Administrator gate: the five symlink-hardening cases pass 5/5 after correcting two POSIX mode-bit expectations that are not meaningful on Windows. The Docker run remains supplemental.
- Current-source Administrator rerun after the restart repair: **PASS**, 5/5 with exit code 0. No Windows security setting was changed.
- Additional gates: fault injection 22/22, performance 8/8, and the renderer browser regression 1/1 pass. A reproduced portrait emergency overflow and Windows browser-profile cleanup race were fixed before the current package was built.
- Installed operator tools: `doctor`, `pairing-status`, `collect-logs` and `clear-cache` exit 0. The paired clear removed 4 files / 308,607 bytes while preserving the device identity, all three certificate hashes, logs, request queue, proof-of-play spool and screenshots. Because QA kiosk input intentionally blocks Alt+F4, only the five exact-path player processes were terminated for the restart; the relaunched player stayed paired and online, restored the default-content state and redownloaded the same 4 files / 308,607 bytes. The temporary eight-file bundle contained no prohibited secret/certificate material; retained operational UUIDs make it internal-only and are deferred P2 evidence-redaction debt. Doctor's empty operator-only display inventory is also deferred P2 diagnostics debt.
- Start Menu, spaced-path and production input policy: registered app launch preserved exactly one coherent player window; a complete hash-matched temporary program copy launched visibly from a path containing spaces and the installed player was restored after cleanup; F12 and Ctrl+Shift+I opened no DevTools. A native targeted right-click produced no context menu or extra player window. Windows-key injection is safety-blocked, and physical cursor/Alt+Tab behavior remains open.
- QA runtime policy: an isolated packaged fixture was confirmed as mode `qa` by installed doctor, presented one controlled recovery window, and blocked F12/Ctrl+Shift+I without opening DevTools. Its generated runtime was secret-scanned and removed before restoring production mode and the same pending Device ID.
- Additional production input/display: Alt+F4 and Ctrl+R preserved the same player window and Device ID. Native window-targeted right-click blocking passed. Windows reported 1920×1080 backing pixels, 1280×720 logical bounds and 150% scale; the packaged pairing surface was coherent and unclipped. One active Realtek audio render endpoint was inventoried, while player-content audio and whole-machine sleep remain physical checks.
- Lifecycle registration: one exact current-user Run/startup command targets the installed player, and one current-user uninstall record targets the unsigned hash-recorded uninstaller. Same-package repair and full uninstall/reinstall pass on the final approved installer with pairing and one-screen identity preserved. Uninstall leaves the Run value stale until reinstall (P2). The local-Docker runtime/config selectors are now persisted in two app-specific Current User environment values; sign-in/reboot inheritance remains open.
- Pre-uninstall baseline: captured installed-program, per-user runtime and ProgramData file counts/bytes plus ProgramData hashes without reading or hashing pending-pairing credential content, ready for the later retention comparison.
- Pre-pair backend outage/recovery: an isolated `WIN-QA-20261105-` fixture used the same QA host on a deliberately closed port with strict TLS retained. One controlled `Fresh Pairing Required` window persisted across bounded retry, no isolated identity was issued, and normal relaunch restored the same ordinary Device ID and pairing state.
- CMS browser entry: **PASS on the authorized local Docker target**. The isolated CMS was rebuilt with its runtime-config path corrected to `/config/app-config.json`; functional QA uses production-lockdown disabled only for this isolated browser run, while the production-lock guard remains separately tested. Direct user sign-in persisted, the dedicated Windows screen is ONLINE, and `WIN-QA-20261105-LOCAL-INSTALLED-FINAL-VIDEO-02` completed the authenticated create → approve → publish workflow to only that screen. Remote Ubuntu deployment and production TLS are **NOT VERIFIED** non-blocking follow-ups.
- Installed combined-P1 candidate: exact approved unsigned SHA-256 `0b0fe27d…a56`, 105,360,296 bytes. Offline badge, default-only restart and missing-default recovery passed; active-video restart failed twice and superseded the candidate.
- Repaired source restart journeys: active video and selected-page PDF both visibly returned after restart against the isolated Docker target. The exact installed `77718f88…72db0` candidate closed the PoP startup-race P1. Installed `0c161b9c…e28a` then isolated black accelerated-PDF pixels. Final package `af0a1fd6…7845`, 105,360,901 bytes, is installed and closes that P1 with a fresh non-black page-3 CMS preview, one active slot, successful delivery, default handoff, Completed PoP and paired restart recovery. Post-fix unit is 552 pass / 9 pending / 6 host prerequisites; integration 6/6, performance 8/8, fault 22/22, lint zero errors, build and white-centered native smoke pass.

### Authorized local Docker continuation — 2026-11-06

This continuation uses `win-qa-20261105-local` at
`http://localhost:18444` with identity
`windows-player-qa-20261105-local`, release
`windows-player-qa-20261105-local-36f2fc3`, and only
`WIN-QA-20261105-LOCAL-` fixtures. It replaces the unavailable Ubuntu target
for functional validation in this run. Remote Ubuntu deployment and production
TLS remain **NOT VERIFIED** and are non-blocking follow-ups.

| Step | Result | Notes |
| --- | --- | --- |
| Pairing | PASS | Old OTP rejected; renewed OTP retained the device identity; latest approval produced exactly one Windows screen; relaunch reused signed credentials without a new OTP. |
| CMS screen/telemetry | PASS (API + SINGLE-SESSION UI), TWO-SESSION OPEN | Screen is ACTIVE/ONLINE with fresh heartbeats, Windows OS identity and intact pairing. Direct native-Edge sign-in and the authenticated create/approve/publish workflow were verified. One brief duplicate-session warning after the exact-process restart cleared automatically when the old heartbeat aged out; two independent browser-session convergence remains open. |
| Image/video/PDF playback | PASS (CORE + EDGE) | Landscape and portrait images, a verified 6000×4000 JPEG, looping and non-looping MP4 occurrences, a one-page PDF, and selected pages 1–3 of a five-page PDF played. Corrupt and encrypted PDFs failed ingest with explicit reasons. Snapshot/progress evidence confirms audio-enabled/loop-on and muted/loop-off semantics; physical audible output is not claimed. |
| Default/schedule fallback | PASS | Default media displayed with no active schedule, a short schedule replaced it, and default returned after schedule end. |
| Publish/delivery/PoP | PASS | Dedicated schedule resolved one screen; delivery succeeded; 25 completed proof rows contained all four dedicated media names. |
| Screenshot capture | PASS | Windows screenshot commands completed and two CMS preview surfaces exposed a current uploaded screenshot URL and capture timestamp. |
| Future/group schedule | PASS | One-screen dedicated group, one resolved screen, successful delivery targets, one upcoming item, zero current items and no early playback. |
| Conflict behavior | PASS | Overlapping dedicated publish returned HTTP 409 with `SCREEN_TIME_WINDOW_CONFLICT`; no forced conflicting publication. |
| Offline/recovery | FAIL → INSTALLED PASS | Cached default and pairing survived the original >5-minute gateway outage; CMS changed to STALE and recovered automatically with queued work flushed. The old installed player badge incorrectly remained `ONLINE`. The earlier repaired 105,360,676-byte installed candidate visibly changed to `OFFLINE` during the bounded local-API outage, preserved the assigned default frame, returned `ONLINE`, and restored the isolated cache object byte-for-byte after API recovery; the final package does not change that path. |
| Restart during active media | PASS | The repaired installed video journey passed. On installed package `77718f88…72db0`, `WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-03` visibly played page 3, reported one live slot, returned to default and produced exactly one Completed PoP interval. The final installed `af0a1fd6…7845` package then closed the snapshot gate with a fresh white page-3 CMS capture, one active slot, successful delivery and a Completed 09:00:00–09:05:12 proof interval. |
| Restart with default only | PASS | The earlier 105,360,676-byte installed candidate returned paired and ONLINE on three controlled restarts; final same-package repair and uninstall/reinstall repeated paired ONLINE/DEFAULT MEDIA return on the current package. The assigned landscape fixture itself contains DARSHAN's `No content assigned` artwork; debug overlay identification and direct cached-PNG inspection proved the visible frame was the fixture, not the unassigned standby. Normal logging was restored after diagnosis. |
| Missing cached default while offline | FAIL → INSTALLED PASS | The superseded behavior showed a browser broken-image glyph twice; fixed source showed controlled `Content unavailable` when no renderable layer remained. On the earlier repaired 105,360,676-byte candidate, the exact dedicated cache object was isolated and only the local API container stopped. An exact installed-player restart visibly reported `OFFLINE` and safely retained the last-decoded default frame without a broken glyph or crash. API recovery returned the player to `ONLINE` and repopulated the object byte-for-byte. The final package does not change this path. Direct external file tampering is not claimed as a supported continuously monitored cache-clear path. |
| Targeted emergency | PASS | Screen-only CRITICAL takeover was visible; Now Playing and screenshot evidence matched; restart retained takeover; clear while disconnected reconciled to default after reconnect without stale replay. |
| Paired cache clear/recovery | PASS | Pre-state 4 files / 308,607 bytes; `clear-cache` removed only media objects and preserved identity, certificate hashes, logs and queues. An exact-path player restart reused pairing and redownloaded 4 files / 308,607 bytes; visible state was ONLINE / DEFAULT MEDIA with no OTP. Alt+F4 remained blocked by the intended QA kiosk policy. |
| Paired CLI tools | PASS / P2 DEFERRED | Installed `doctor`, `pairing-status` and `collect-logs` exited 0 and confirmed QA/win32, backend reachability, paired identity, matching validation and certificate/key presence. Final-package reruns after uninstall/reinstall again exited 0 with no private-key/JWT/credentialed-URL marker. Pairing-status retained one full operational UUID; the final eight-file/1,828,299-byte bundle retained 1,382 UUID-shaped log values. Both bundles were treated as internal-only and deleted after review. |
| Installed final image-layer candidate | PASS | Exact approved unsigned installer SHA-256 `af0a1fd625a6c3e7a7454cc6765017f986e4e7bbbd6bbcc3b8dbc68826ef7845`, 105,360,901 bytes, installed with exit 0; installed executable SHA-256 `28f9dcfeb3a37ba1ebe49971a8b6ffaa88c840c9dbafa7a33790cb7128e008de`. `WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-05` page 3 rendered white, delivered with `ACKED_SUCCESS`, reported one active slot, captured successfully at 09:01:04 with non-black PDF pixels, returned to default at take-down, and produced Completed PoP from 09:00:00 to 09:05:12. A subsequent exact-process restart reused pairing and restored one four-process `ONLINE` / `DEFAULT MEDIA` player. |
| Revoke and fresh re-pair | PASS / DELETE GUARD EXPECTED | CMS revoke immediately moved the installed player to `Recovery Required`. Packaged `reset-pairing` exited 0 against the isolated runtime and preserved non-identity evidence; the fresh code was approved in CMS and the player returned ONLINE / No content assigned at 09:28:09. Screen deletion was correctly refused because the taken-down final-PDF schedule is audit-preserved; the cleared default-media reference stayed cleared and no database bypass was used. |

Use this minimal record for each execution:

| Step | Result | Notes |
| --- | --- | --- |
| Build/package |  |  |
| Install |  |  |
| First launch |  |  |
| Runtime paths |  |  |
| CLI tools |  |  |
| Pairing |  |  |
| Kiosk `qa` |  |  |
| Kiosk `production` |  |  |
| Image playback |  |  |
| Video playback |  |  |
| PDF playback |  |  |
| Retired webpage handling |  | Confirm controlled unavailable state and no source/preview network request |
| Screenshot capture |  |  |
| Log collection |  |  |
| Autostart |  |  |
| Upgrade |  |  |
| Uninstall |  |  |

## Exit Criteria

Windows is ready for broader rollout only when:

- no blocker is found in packaging, install, startup, pairing, kiosk, or playback
- Linux-only tooling is not required for the supported Windows flow
- diagnostics and autostart are acceptable for support operations
- any degraded but acceptable behavior is explicitly documented
