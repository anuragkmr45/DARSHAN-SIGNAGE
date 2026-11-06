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

### Native run — 2026-11-05 (in progress)

Detailed evidence: `qa-artifacts/evidence/windows-player-native-runtime-validation-2026-11-05.md`.

| Step | Result | Notes |
| --- | --- | --- |
| Build/package | PASS | Node 20 x64 build and unsigned x64 NSIS package completed |
| Install | PASS | Exact approved initial package installed per user |
| First launch | PASS | Visible fullscreen forest pairing surface; strict API/TLS succeeded |
| Runtime paths | PASS | ProgramData site files plus per-user AppData runtime state |
| CLI tools | PARTIAL PASS | Installed `doctor`, `pairing-status` and `collect-logs` exit 0 with Windows paths; eight-file support bundle passed the secret scan. Pre-pair/no-content `clear-cache` passed with identity/config/log preservation; paired cached-content removal/redownload remains open. Empty operator-only display inventory is deferred P2. |
| Pairing | IN PROGRESS | Pending restart passed. Server-authoritative generation 55 expired unconfirmed and generation 56 appeared with a different code while hostname and redacted Device ID stayed stable. Authenticated CMS dashboard/Screens/Pair Device loaded, but the CMS production inspection lock redirected Edge to login before old-code rejection or latest-code approval. No screen was created. |
| Kiosk `qa` | PARTIAL PASS | Isolated packaged fixture confirmed mode `qa`, one controlled locked window, and F12/Ctrl+Shift+I blocking; physical cursor/mouse/Alt+Tab and playback remain open. Production mode and the same pending Device ID were restored. |
| Kiosk `production` | PARTIAL PASS | Fullscreen, registered Start Menu/single-instance behavior, exact program launch from a path containing spaces, and F12/Ctrl+Shift+I/Alt+F4/Ctrl+R blocking passed. A native window-targeted right-click produced no context menu or extra player window. The pairing surface remained coherent at 150% display scale. Windows-key injection is prohibited; physical cursor/Alt+Tab, player-content audio and whole-machine sleep checks remain open. |
| Image playback | NOT RUN |  |
| Video playback | NOT RUN |  |
| PDF playback | NOT RUN |  |
| Retired webpage handling | NOT RUN |  |
| Screenshot capture | NOT RUN |  |
| Log collection | NOT RUN |  |
| Autostart | PARTIAL PASS | Exactly one current-user Run/startup command targets the hash-verified installed executable. Actual sign-out/sign-in and reboot require immediate approval. |
| Upgrade | BLOCKED | No older approved package is available |
| Uninstall | NOT RUN | Current-user uninstall registration and unsigned uninstaller hash are verified; actual uninstall/reinstall is reserved for end-of-run lifecycle validation and requires action-time approval. |

Observed failure journeys:

- Missing ProgramData config: **PASS**, controlled setup-required screen.
- Malformed selected config: **FAIL (P1)** in the initial package; **PASS** after approved rebuilt installation of SHA-256 `fbaaa365…ca0b`.
- Automated Windows gate: **PARTIAL PASS**. Frozen pnpm install, build, lint, Windows-safe test discovery, and integration (6/6) pass. The final standard-user unit suite records 529 passing, 9 intentionally pending, and 5 failing; every failure stops at Windows symlink-creation privilege before exercising its assertion, while the former suite-order case passes in the full run.
- Native Administrator gate: the five symlink-hardening cases pass 5/5 after correcting two POSIX mode-bit expectations that are not meaningful on Windows. The Docker run remains supplemental.
- Additional gates: fault injection 22/22, performance 8/8, and the renderer browser regression 1/1 pass. A reproduced portrait emergency overflow and Windows browser-profile cleanup race were fixed before the current package was built.
- Installed operator tools: `doctor`, `pairing-status` and `collect-logs` exit 0. The temporary eight-file bundle contained no private-key marker, JWT, credentialed URL, bearer value, cookie/password/token assignment, full GUID or secret-bearing filename. The live AppData log also contained no fatal/error entry, Linux-only runtime failure marker or scanned secret shape. Pre-pair/no-content `clear-cache` removed/recreated only the empty media target while preserving the Device ID, config, logs and absent request/PoP queues; paired cache removal/redownload remains open. Doctor's empty operator-only display inventory is deferred P2 diagnostics debt.
- Start Menu, spaced-path and production input policy: registered app launch preserved exactly one coherent player window; a complete hash-matched temporary program copy launched visibly from a path containing spaces and the installed player was restored after cleanup; F12 and Ctrl+Shift+I opened no DevTools. A native targeted right-click produced no context menu or extra player window. Windows-key injection is safety-blocked, and physical cursor/Alt+Tab behavior remains open.
- QA runtime policy: an isolated packaged fixture was confirmed as mode `qa` by installed doctor, presented one controlled recovery window, and blocked F12/Ctrl+Shift+I without opening DevTools. Its generated runtime was secret-scanned and removed before restoring production mode and the same pending Device ID.
- Additional production input/display: Alt+F4 and Ctrl+R preserved the same player window and Device ID. Native window-targeted right-click blocking passed. Windows reported 1920×1080 backing pixels, 1280×720 logical bounds and 150% scale; the packaged pairing surface was coherent and unclipped. One active Realtek audio render endpoint was inventoried, while player-content audio and whole-machine sleep remain physical checks.
- Lifecycle registration: one exact current-user Run/startup command targets the installed player, and one current-user uninstall record targets the unsigned hash-recorded uninstaller. Sign-in/reboot and actual repair/uninstall/reinstall remain approval-gated.
- Pre-uninstall baseline: captured installed-program, per-user runtime and ProgramData file counts/bytes plus ProgramData hashes without reading or hashing pending-pairing credential content, ready for the later retention comparison.
- Pre-pair backend outage/recovery: an isolated `WIN-QA-20261105-` fixture used the same QA host on a deliberately closed port with strict TLS retained. One controlled `Fresh Pairing Required` window persisted across bounded retry, no isolated identity was issued, and normal relaunch restored the same ordinary Device ID and pairing state.
- CMS browser entry: **PARTIAL PASS / BLOCKED AT SUBMISSION** after explicit approval of the exact Current User Root import. Matching trust count is one for Current User and zero for Local Machine. Direct user sign-in reached the real dashboard, zero-screen Screens page and Pair Device dialog. Before any form submission, the tab redirected to login and raised the false-positive `devtools viewport heuristic` production lock. The lock was not bypassed and no screen was created. The P1 baseline-delta fix passes 4/4 focused tests, the full 291/291 CMS unit suite, full lint with zero errors and the exact production-lock CMS build/bundle gate locally. A Docker-served native Edge smoke with the same browser banner remained unlocked; the helper could not deliver a verifiable F12 reinjection, so that is not claimed. CMS-only deployment is authorized, but port 22 plus seven narrowly scoped common SSH alternatives on `192.168.29.64` are unreachable; no local SSH key or agent is available. The operator must provide/enable the actual endpoint and approved local key path before deployment.

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
