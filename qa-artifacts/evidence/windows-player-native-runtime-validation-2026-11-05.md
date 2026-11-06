# Windows Player Native Runtime Validation — 2026-11-05

Status: **IN PROGRESS — rebuilt candidate installed; real CMS pairing and post-pairing journeys pending**

This record covers the isolated Windows QA deployment only. It is not production approval.

## Source and host

| Item | Evidence | Result |
| --- | --- | --- |
| Repository | `C:\Users\KIIT0001\Desktop\DARSHAN-SIGNAGE` | PASS |
| Branch | `codex/windows-player-runtime-validation-20261105` | PASS |
| Baseline commit | `c89bd28a7a323a224f0ce377cec744d4aff8d5a3` | PASS |
| Player subtree | `3817664a824df059409e345000c0b1a5308155fa` | PASS |
| Initial tree state | clean | PASS |
| Windows | Windows 11 Home Single Language 26H2, build 26300, x64 | PASS |
| CPU | 12th Gen Intel Core i7-1255U, 10 cores / 12 logical processors | PASS |
| Memory | 15.72 GiB total; 3.52 GiB free at baseline capture | PASS |
| Disk | 210.8 GiB free on `C:` at baseline capture | PASS |
| Display | one primary display; 1920×1080 backing pixels, 1280×720 logical pixels, 150% scale | PASS |
| Audio | Realtek High Definition Audio (SST), status OK | PASS |
| Build runtime | Node 20.20.2 x64, npm 10.8.2 from verified official ZIP | PASS |

The machine-wide Node remains 24.22.1. The validation used a separate Node 20 runtime and did not replace it.

## Private network, bootstrap and TLS

| Case | Evidence | Result |
| --- | --- | --- |
| Windows address and route | `192.168.29.242/24`, direct Wi-Fi route to `192.168.29.64` | PASS |
| TCP 18080 | `Test-NetConnection` true | PASS |
| TCP 18443 | `Test-NetConnection` true | PASS |
| `config.windows.json` | SHA-256 `61bdbbdacc002c7545d54b9f637d7fd95bfb6cf240ab78fbb72b4047538be6a8` | PASS |
| `transport-ca.crt` | SHA-256 `e98416ad8d0712931ceb5d93f2c1be1edd6f4f65fd07a7ff4ea7f8d0e9c1bc48` | PASS |
| `SHA256SUMS.txt` | both expected entries matched | PASS |
| Site config | HTTPS/WSS origin `192.168.29.64:18443`, production mode, strict certificate validation enabled, live playback disabled | PASS |
| Backend readiness | HTTP 200; database, migrations, bootstrap, MinIO, Valkey and worker all `ok` | PASS |
| Backend identity | site/release `windows-player-qa-20261105`, source commit `c89bd28…5a3`, generation 1 | PASS |
| CMS shell, app config, Grafana | HTTP 200; CMS origin matched; Grafana database `ok` | PASS |
| Windows curl | Schannel rejected because revocation status was unavailable | DEGRADED BUT ACCEPTABLE |
| OpenSSL verification | Docker curl 8.16.0 verified the same CA, host identity and responses without disabling TLS | PASS |
| Packaged player TLS | visible diagnostics showed API reachable and pairing requests succeeded | PASS |

The exact QA CA was later imported into `Current User\Root` after explicit user approval; no machine-wide trust change or TLS bypass was used.

## Build, tests and packaging

| Case | Evidence | Result |
| --- | --- | --- |
| `npm ci` | no `package-lock.json` exists | FAIL |
| frozen pnpm install, initial baseline | tracked lock omitted `livekit-client@2.23.0` | FAIL |
| pnpm lock remediation | lock updated for declared `livekit-client@2.23.0`; Electron and esbuild lifecycle scripts explicitly allowed | PASS |
| frozen pnpm install, remediated tree | Node 20 / pnpm 10.33.2 completed and ran the approved Electron/esbuild postinstalls | PASS |
| dependency engine declaration | transitive `machina@7.0.1` declares Node >=22.22 although the player pins Node 20; install/build/runtime tests still execute under Node 20 | DEGRADED BUT ACCEPTABLE |
| build | native Node 20 build completed after all changes | PASS |
| npm test scripts, initial baseline | Unix single-quoted globs were passed literally on Windows | FAIL |
| npm test scripts, remediated tree | cross-platform double-quoted globs discover the intended suites | PASS |
| final native unit suite, standard user | 529 passed / 9 pending / 5 failed; all five failures stop at Windows symlink-creation EPERM before exercising the assertions | DEGRADED BUT ACCEPTABLE |
| focused native symlink suite, Administrator | first run reached all five assertions: 3 passed and 2 failed only because POSIX mode-bit expectations are not meaningful on Windows; platform-correct assertions then passed 5/5, exit 0; no Windows security setting was changed. Repro script SHA-256 `089500c3e2fafde1b136b63e9c871e7a48fcf2f95209eeb3fc90f2b2edef09b0`; result log SHA-256 `f582f3d6f8670873243c7374a2c4692c3b7a8a2c71dd93f071f724325555427f`; exit record contains `0` and has SHA-256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9` | PASS |
| former suite-order failure | in-place recovery passed in isolation and in the final full suite after replacing a fixed 20 ms sleep with a bounded wait for the submitted recovery and `PAIRED_RUNTIME` state | PASS |
| Docker symlink-capable supplement | official Node 20.20.2 container, frozen lock install, five focused symlink-hardening cases passed; supplemental only, not native-Windows approval | PASS (SUPPLEMENTAL) |
| final native integration suite | 6 passed | PASS |
| final native fault-injection suite | 22 passed | PASS |
| final native performance suite | 8 passed; idle CPU 11%, memory P95 42.25 MB, startup 109 ms, timeline jitter P95 1 ms | PASS |
| renderer browser regression, initial Windows run | long critical emergency copy overflowed its portrait text box; Edge profile cleanup hit a transient lockfile | FAIL (P1 + TEST HARNESS) |
| final renderer browser regression, remediated Windows run | 1 passed in installed Microsoft Edge; portrait emergency copy fitted and isolated Edge profile cleaned successfully | PASS |
| focused config suites after P1 fix | 42 passed | PASS |
| lint | full lint has 0 errors; warning baseline remains | PASS |
| initial NSIS package | 105,169,690 bytes, SHA-256 `52d1b8da0c510f0dab51618d7c28cffc4fe37622be0a0661d9ea35f44876b4bd` | PASS |
| initial signing | unsigned | DEGRADED BUT ACCEPTABLE |
| superseded rebuilt package | 105,169,750 bytes, SHA-256 `1ea2737421fee04b6e69898f9a77071e625e047cb58be732c7758237dd918359`; not installed and no longer matches the final source tree | NOT A CANDIDATE |
| superseded post-test NSIS package | 105,359,235 bytes, SHA-256 `061041434a208c20a6ad95310e9817f68e8ffb19df376b637cb321715b20f543`; not installed after the emergency-fit source change | NOT A CANDIDATE |
| superseded emergency-fit NSIS package | 105,359,501 bytes, SHA-256 `0725390b555c01054191101790544df9fc87ef25633b3053e1103d77af25cc20`; not installed after the final TLS resource-safety edit | NOT A CANDIDATE |
| current rebuilt NSIS package | 105,359,603 bytes, SHA-256 `fbaaa365e7acb9aacff2e3cfe6c7eab61919bec6caf79ec6af2f7cee1a01ca0b` | PASS |
| current unpacked executable | 188,802,048 bytes, SHA-256 `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda` | PASS |
| current packaged `app.asar` | 83,857,647 bytes, SHA-256 `7ba75fa923655082cd657c002fdbf700e251ecf6118a607fc0a567a3110c1a9f`; all ten affected compiled main/renderer files byte-match the final `dist` output | PASS |
| rebuilt signing | unsigned | DEGRADED BUT ACCEPTABLE |
| changed-text secret/redaction audit | no private-key PEM, JWT-shaped value, assigned password/session/access/refresh token, or full device UUID in the Windows evidence; certificate PEM markers are unchanged test fixtures and absent from the diff | PASS |

The current package completed as a per-user x64 NSIS installer without Linux packaging tools. Electron-builder found no signing identity, so both the executable and installer remain unsigned.

## Installation and visible player journeys

| Case | Observed behavior | Result |
| --- | --- | --- |
| Approved initial install | one-click per-user installation completed | PASS |
| Initial installed executable | `%LOCALAPPDATA%\Programs\darshan-player\DARSHAN-Player.exe`, version 1.0.0, SHA-256 `37c38325d3c3eedaee552fd5bb94fc166d6a91a82e5bf39c1816a3273d5728e2` | PASS |
| Approved rebuilt install | exact unsigned NSIS SHA-256 `fbaaa365e7acb9aacff2e3cfe6c7eab61919bec6caf79ec6af2f7cee1a01ca0b`, 105,359,603 bytes, installed per-user on 2026-11-06 | PASS |
| Current installed executable | version 1.0.0, 188,802,048 bytes, SHA-256 `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda`, unsigned | PASS |
| Start Menu registration | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DARSHAN-Player.lnk` targets the installed executable | PASS |
| ProgramData config and CA | destination hashes matched the bootstrap packet; config contained no credential/private-key markers; CA contained one certificate and no private key | PASS |
| First visible launch | fullscreen forest pairing screen; no window chrome or immediate crash | PASS |
| Host/display/platform | hostname `Ayush`, 1920×1080, `win32 x64` | PASS |
| Pairing diagnostics | DNS and API reachable; strict TLS connection succeeded | PASS |
| Countdown | advanced normally; a strict-TLS read-only status poll confirmed the server-authoritative countdown progressed from generation 55 to expiry without relying on the stale hidden-window accessibility cache | PASS |
| Second launch | one player window remained | PASS |
| Rebuilt second launch | one player window remained after launching the installed executable again | PASS |
| Start Menu app launch | launched the registered `com.darshan.player` entry while the player was running; the same window ID remained the only DARSHAN window and the pairing surface stayed coherent | PASS |
| Executable path containing spaces | copied the complete 79-file installed program (402,870,170 bytes) to a verified Windows temporary path containing spaces; executable SHA-256 `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda` and `app.asar` SHA-256 `7ba75fa923655082cd657c002fdbf700e251ecf6118a607fc0a567a3110c1a9f` matched the installed candidate. A process and one visible pairing window ran from that exact spaced path with hostname, countdown and waiting state intact. The temporary process was stopped, the ordinary installed player restored to one coherent pairing window, and the exact 79-file duplicate removed. | PASS |
| Close/reopen while pending | same redacted Device ID, OTP and countdown resumed | PASS |
| OTP expiry/renewal | generation 55 expired unconfirmed at the backend and generation 56 appeared automatically with a different six-digit code and a fresh 576-second server window; redacted Device ID `b9e19bbf-…-f72a` and hostname stayed stable | PASS |
| Missing ProgramData config | isolated profile showed controlled `Player setup required`, no device identity, no invented backend | PASS |
| Malformed selected config, initial package | exited with code 1 before creating a window; reproduced twice | FAIL (P1) |
| Malformed selected config, rebuilt package | isolated installed-player launch remained open on `Player setup required`, showed the parse reason, hostname/resolution/platform, Device ID `-`, and no invented backend | PASS |
| Valid config after malformed test | isolated process stopped; ordinary QA launch restored one pairing window with strict TLS diagnostics OK and the same redacted Device ID `b9e19bbf-…-f72a` | PASS |
| Backend unreachable before pairing | exact installed executable launched with isolated fixture `WIN-QA-20261105-unreachable-config.json` (SHA-256 `d8260047e5b360aadd0b25a29c808e4ccc7e56101b2532786c242b99842f0047`) targeting the same QA host on deliberately closed TCP port 1 with strict TLS still enabled. One window showed `Fresh Pairing Required`, a connection-refused reason and coherent recovery guidance; it remained one window after a bounded retry wait and issued no Device ID. | PASS |
| Network restoration before pairing | isolated process stopped; its four-file/40,343-byte runtime contained no reparse point, private-key marker, JWT or full GUID. The ordinary player restored one pairing window, waiting/countdown state and the same internally compared Device ID. Generated runtime state was removed; the safe reproducible config fixture remains. | PASS |

The first OTP was deliberately not approved. The expired generation-55 value and current generation-56 value were retained only in memory for the next CMS test and were not written to chat or evidence. Old-OTP rejection and latest-OTP approval remain pending because the CMS production inspection lock activated before either form submission.

## CMS browser trust gate

The real CMS was first opened at `https://192.168.29.64:18443` in a fresh visible browser session. Chromium stopped at `net::ERR_CERT_AUTHORITY_INVALID`; the warning was not bypassed and no credentials were entered. After explicit approval, the exact QA CA at `C:\ProgramData\DARSHAN\transport-ca.crt` was rechecked as SHA-256 `e98416ad8d0712931ceb5d93f2c1be1edd6f4f65fd07a7ff4ea7f8d0e9c1bc48`, subject/issuer `CN=DARSHAN Windows Player QA CA`, thumbprint `2193117D3BC0500CEDF3A479395D686C65FD2E6C`, valid 2026-11-05 through 2026-12-05, CA basic constraints present, and no private key. Import changed the matching `Current User\Root` count from zero to one while `Local Machine\Root` remained zero. The in-app browser then trusted TLS but triggered the CMS production inspection lock, so its temporary tab was closed.

The user signed in directly in native Microsoft Edge 156; the agent did not enter or inspect credentials. The authenticated `/dashboard` loaded with the expected navigation and zero screens. `/screens` then loaded, reported zero visible screens plus pre-existing orphan pairing diagnostics, and opened the Pair Device dialog. Before any code or fixture was submitted, the same native Edge tab was redirected to `/login?redirect=%2Fdashboard` and exposed the CMS-owned `Inspection tools are blocked on this system` production lock. The lock was not bypassed. No screen, pairing approval or fixture mutation occurred.

This is classified **P1** because a normal native Edge session was blocked before pairing. The lock recorded `devtools viewport heuristic`; no inspection shortcut or context menu caused it. Source inspection found that the production boundary treated any absolute outer/inner browser-size delta above 160 px as developer tools, so ordinary Edge chrome and its visible startup banner could satisfy the trigger. The local CMS remediation now establishes the ordinary browser-chrome delta as a baseline, lowers that baseline when chrome is removed, and locks only on a later increase greater than 160 px. F12/Ctrl+Shift inspection shortcuts and context-menu blocking are unchanged. Focused regression: 4/4 pass; full CMS unit suite: 291/291 pass; full CMS lint: exit 0 with three pre-existing Fast Refresh warnings and zero errors; exact production-lockdown CMS build and bundle-budget gate: pass after restoring the exact lockfile dependencies (2,599 modules transformed). The first unqualified full-unit invocation recorded 290/291 because the checked-out developer `.env` selects `/config/app-config.local.json` while one fallback test assumes the default `/config/app-config.json`; a process-scoped default-path override produced the 291/291 deterministic run without changing source.

The rebuilt static CMS was then served read-only from an isolated Docker `node:20.20.2-bookworm-slim` container on `127.0.0.1:18444`. Native Edge loaded the production-lock-enabled login page with the same visible Edge startup banner and remained unlocked across the initial and polling intervals. The temporary container was stopped and removed. An attempted F12 injection was rejected twice by the Windows-control helper, so preservation of the shortcut trigger is supported by unchanged source and focused logic coverage but is not promoted to a native-input pass from this smoke run. The 104-file/4,026,160-byte static artifact has manifest SHA-256 `8c81b4c6af2ca5a5e9f57548999c2dec9bc9a6c1cc34a2970d139a782afcd1db`; source hashes are `8048407c…f638` for the boundary, `1550d9b5…00c` for the viewport helper and `0d25ad7c…8e` for its test. The official exporter correctly refuses the dirty worktree and requires a clean provenance-bearing commit plus its exact nginx image; that release gate was not bypassed and no deployable signed role archive was fabricated. The fix is not integrated until the updated CMS is explicitly authorized, packaged through the approved path and deployed to the isolated QA host, then the exact Edge pairing journey passes.

The user subsequently authorized SSH access and CMS-only deployment. Read-only preflights on 2026-11-06 found `192.168.29.64:22` unreachable. A narrowly scoped follow-up checked only common SSH alternatives on the same authorized host (`2022`, `2200`, `2222`, `8022`, `10022`, `18222`, and `22222`); none accepted TCP. The Windows profile contains known-host databases but no SSH private-key files, and no SSH agent is running. The resolved `support@192.168.29.64` client configuration remains port 22, while neither repository configuration nor runbooks define a nonstandard endpoint for this QA host. No remote command, transfer, backup, container restart or deployment occurred. Deployment now requires the operator to enable/provide the actual reachable SSH endpoint and make an approved key available through the local SSH agent.

## Operator tooling and production kiosk checks

The installed executable (SHA-256 `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda`) was invoked directly for the read-only operator commands while the ordinary player remained open.

| Case | Observed behavior | Result |
| --- | --- | --- |
| `doctor` | exit 0 from packaged 1.0.0 / Electron 33.4.11 / Node 20.18.3 on win32 x64; production mode; ProgramData/AppData paths were native Windows paths; config/cache present; DNS and HTTPS API ready (200); Windows login-item autostart supported and enabled; `xset`/`xrandr` absent without a fatal result | PASS |
| `pairing-status` before approval | exit 0; pending Device ID present but local paired state, certificates, private key, validation and identity-bound playback state were all absent; every reported runtime path was a Windows path | PASS |
| `collect-logs` | exit 0; created temporary bundle `darshan-support-1793909655234-87d1e73ce2d5` with eight text/JSON files, 7,401 bytes total, no reparse points and no unsafe secret-bearing filename | PASS |
| support-bundle content audit | all eight files scanned; zero private-key markers, JWT shapes, credentialed URLs, bearer values, cookie assignments, password/token assignments or full GUID values; no certificate/key container files were included | PASS |
| live AppData log audit | one 824-byte log under the configured Windows cache root; no reparse point, fatal/error entry, Linux-only runtime failure marker, private-key marker, JWT, credentialed URL or full GUID | PASS |
| `clear-cache`, pending/no-content state | pre-state recorded zero media bytes; command exit 0 removed and recreated the one empty media target. Device ID suffix, unpaired state, config, logs and absent request/PoP queues remained unchanged. Post-doctor showed media present at zero bytes, logs present, screenshots present at zero bytes and no certificates/private key. | PASS (BOUNDED) |
| production F12 and Ctrl+Shift+I | each injected key sequence left exactly one player window, opened no DevTools window and preserved the pairing surface | PASS |
| production Alt+F4 and Ctrl+R | Alt+F4 left the same window ID open; Ctrl+R left the same window ID and pairing surface intact. Both preserved the internally compared Device ID. | PASS |
| production right-click | a native window-targeted right-click on the packaged pairing surface completed successfully; the refreshed accessibility state contained no menu/menu-item role, exactly one player window remained, and no extra player-owned surface appeared | PASS |
| 150% display scaling | Windows reports one primary 1920×1080 backing display with 1280×720 logical bounds and `AppliedDPI=144` (150%). The live packaged pairing surface remained fullscreen, coherent and unclipped at those logical bounds. | PASS (PAIRING SURFACE) |
| physical audio | registry inventory identifies one active Realtek render endpoint (`DeviceState=1`); actual player-content audio output still requires paired media playback and human listening | BLOCKED (PAIRING / PHYSICAL OBSERVATION) |
| display sleep prevention | the packaged player remained visibly responsive during the bounded checks, but the standard-user `powercfg /requests` query requires elevation, so an independent Windows power-request assertion and whole-machine sleep observation are not yet proven | BLOCKED (ADMIN / PHYSICAL OBSERVATION) |
| packaged QA runtime policy | isolated fixture `WIN-QA-20261105-qa-mode-config.json` SHA-256 `fbafe68da44235c4797a3b712a83359e6bb317d5ef0ddf6f60547600a99e4fc7`; installed `doctor` confirmed packaged runtime mode `qa`. One controlled recovery window opened, and F12/Ctrl+Shift+I each left one player window with no DevTools surface. The four-file/34,340-byte generated runtime contained no private-key marker, JWT or full GUID; production mode then restored one waiting window and the same Device ID before the generated runtime was removed. | PASS (BOUNDED) |
| Windows-key kiosk check | not attempted because the Windows automation safety policy forbids Windows-key injection | BLOCKED |

## Autostart and uninstall registration preflight

| Case | Observed behavior | Result |
| --- | --- | --- |
| Current-user autostart registration | exactly one `com.darshan.player` Current User Run entry and one matching Windows startup command target the installed executable; installed hash still `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda` | PASS |
| Sign-in/reboot autostart | registration is present, but actual sign-out/sign-in and reboot behavior require immediate user approval | BLOCKED (APPROVAL) |
| Uninstall registration | exactly one Current User `DARSHAN-Player 1.0.0` registration points to the installed uninstaller with `/currentuser`; the entry declares no Control Panel modify/repair action | PASS (PREFLIGHT) |
| Installed uninstaller | SHA-256 `b43dc90e9896529de5fd298468a62152e3c26a17ef72eaa22ec36d2536daff28`; unsigned | DEGRADED BUT ACCEPTABLE (QA ONLY) |
| Pre-uninstall retention baseline | installed program: 79 files / 402,870,298 bytes / no reparse points; per-user runtime: 48 files / 1,765,197 bytes / no reparse points, including generic config, device-state and pending-pairing credential files without reading or hashing their contents; ProgramData: only `config.json` (706 bytes, expected SHA-256 `61bdbbd…e6a8`) and `transport-ca.crt` (1,513 bytes, expected SHA-256 `e98416ad…bc48`) | PASS (BASELINE) |

No uninstall, repair/reinstall, sign-out or reboot action was taken in this preflight.

`doctor` and the collected `displays.json` reported an empty display inventory even though the running packaged UI and machine baseline identify one 1920×1080 display. Source inspection shows the operator-only process reads `DisplayManager` before starting it. This is a non-blocking diagnostics gap, classified P2 and deferred under the goal's P0/P1-only remediation rule. The pre-pairing doctor also reported WebSocket unreachable; HTTPS bootstrap/API readiness remained healthy, and authenticated realtime behavior still requires pairing.

## Confirmed defect and remediation

### P1 — malformed selected config exits before controlled UI

Root cause: `ConfigManager` constructed during module loading and allowed `loadPlayerFileConfig` to throw before Electron registered its ready handler or created the controlled configuration window.

Remediation in the working tree:

- preserve the selected-config load error as a configuration validation error;
- keep services disabled;
- allow normal window creation so the renderer can show `Player setup required`;
- add focused regression coverage for malformed selected JSON.

Static verification passed: 42 focused configuration tests, the native integration suite (6 tests), build, and lint with no errors. The final standard-user unit suite has 529 passing, 9 intentionally pending and five privilege-dependent symlink cases; the former suite-order failure passed in this full run. The five native symlink cases then passed 5/5 in the approved Administrator process after correcting two Windows-invalid POSIX mode-bit assertions. The rebuilt installed-player malformed-config journey passed on 2026-11-06.

### P1 — portrait emergency copy can remain clipped

Root cause: emergency text fitting used a one-way decrement loop with an implicit width and stopped at a size that could still overflow after a portrait viewport/layout change.

Remediation in the working tree:

- give the emergency copy an explicit bounded width and zeroable grid minimums;
- choose the largest fitting font by measured binary search;
- refit when the emergency surface resizes and disconnect the observer during media teardown;
- wait for the isolated Windows browser process to exit before removing its test profile.

The issue reproduced twice in Edge at 390×844. The remediated browser regression passed and produced a complete, unclipped critical-emergency evidence image.

## Current blockers and next actions

1. Native Edge authentication succeeded and the real dashboard/Screens/Pair Device surfaces loaded, but the CMS production inspection lock then redirected the tab to login before submission. The confirmed P1 false-positive fix passes locally and deployment is authorized, but SSH port 22 is refused and no alternate port/key is available. A reachable SSH endpoint and approved authentication method are required before CMS-only deployment and real-browser reverification; the existing lock will not be bypassed.
2. Expired generation-55 rejection and current generation-56 approval through the real CMS remain pending. Generation change, different code, stable hostname and stable redacted Device ID are verified.
3. Pairing persistence, CMS telemetry, media, scheduling, delivery, proof-of-play, screenshot, offline recovery, emergency, deletion/repairing, paired-content `clear-cache`/redownload, autostart sign-in/reboot, repair and uninstall remain incomplete.
4. No CMS mutation was submitted and the dashboard remained at zero screens before the lock activated.

The CMS false-lock remediation and its deployment-package provenance are committed separately. This verified player hardening packet is preserved in this scoped commit; integrated QA pairing and post-pairing validation remain pending until the authorized CMS deployment transport is reachable.

## 2026-11-06 authorized local Docker continuation

This section supersedes the earlier Ubuntu/SSH blocker for functional testing.
The user authorized the isolated Docker target `win-qa-20261105-local` at
`http://localhost:18444`, deployment/server identity
`windows-player-qa-20261105-local`, release
`windows-player-qa-20261105-local-36f2fc3`, and fixture prefix
`WIN-QA-20261105-LOCAL-`. Remote Ubuntu deployment and production TLS are
**NOT VERIFIED** non-blocking follow-up items; this run does not claim either.

### Pairing, CMS, content and delivery

- The isolated installed-player runtime renewed its OTP without changing device identity. The old OTP was rejected and the latest OTP was approved.
- Exactly one dedicated screen was created. Relaunch reused the signed device credentials and pairing state without requesting another OTP.
- Four READY media fixtures were created: landscape image, portrait image, looping MP4 and a five-page PDF. A five-item presentation selected PDF pages 1 and 2.
- A short screen-targeted schedule delivered successfully, played visibly, produced 25 completed proof-of-play rows covering all four media names, and returned to the screen-specific default afterward.
- Screenshot capture completed on Windows. The latest command had no error; Now Playing and Snapshot previews both exposed an uploaded screenshot URL and capture time.
- Safe correlation fingerprints: screen `dca3ae1d9143`, original presentation `879d3797df21`, original schedule `66922ea347af`, original publish `032c498bca90`, original snapshot `c2449a5a9488`.

### Future, group and conflict journeys

| Case | Evidence | Result |
| --- | --- | --- |
| Dedicated group | fingerprint `7346a51cd5e4`; exactly one member | PASS |
| Future group schedule | schedule fingerprint `ff4ff6cb1431`; publish fingerprint `67e4ecde9e05`; one resolved screen; all publish targets `SUCCESS` | PASS |
| Future state | group availability returned zero current items and one upcoming item about 119 minutes before start; player remained on default content | PASS |
| Conflict | schedule fingerprint `a5a9149f99ec`; publish returned HTTP 409 and `SCREEN_TIME_WINDOW_CONFLICT` | PASS |

### Bounded offline/recovery journey and confirmed P1

Only the isolated `win-qa-20261105-local-cms` gateway was stopped; API,
worker, PostgreSQL, MinIO and Valkey remained available internally. No Windows
firewall or OS security setting changed.

- Cached default content stayed visible and pairing was retained.
- Backend calls and heartbeats failed safely with bounded retries; the queued heartbeat was retained.
- CMS health changed to STALE after the documented five-minute threshold (observed heartbeat age 334 seconds), then returned ONLINE automatically after gateway restoration.
- Queued work flushed after reconnection and current fallback was recalculated without manual reset.
- The installed packaged player kept displaying `ONLINE` for the full outage despite all backend calls failing and CMS health being STALE. This was reproduced and classified **P1** because the visible connectivity state was materially wrong.

Root cause: standard offline policy returned early from the secure playback
guard and therefore never propagated backend failure/recovery boundaries to the
visible player status. The fix keeps cached playback unlocked under standard
policy but records availability and updates `online`/`backendAvailable` until
an authenticated success clears the outage.

Verification before reinstall:

- focused new outage/recovery coverage: 2 passing;
- broader affected secure-guard/player-flow coverage: 35 passing after excluding three unrelated Windows hard-link privilege cases;
- lint: zero errors (existing warnings only);
- production build: pass;
- Windows NSIS packaging: pass.

Fresh rebuilt candidate awaiting explicit installation approval:

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,359,666 bytes;
- SHA-256: `5973a8e726fcf210587ae3880d8f81ceb41cbd813ac986406b557c8f2c52dece`;
- signing: unsigned QA build.

The earlier installer approval does not cover this binary. It has not been
installed, and the exact outage/recovery journey has not yet been rerun against
the fix.

### Targeted emergency and recovery

| Case | Evidence | Result |
| --- | --- | --- |
| Trigger scope | emergency fingerprint `691d02015248`; CRITICAL; `target_all=false`; one direct screen and zero groups | PASS |
| Visible takeover | packaged player replaced default content with the dedicated CRITICAL message; CMS Now Playing matched | PASS |
| Screenshot | command completed with no error; two preview surfaces had uploaded screenshot URLs and capture time `2026-11-06T06:56:48.896Z` | PASS |
| Restart active emergency | installed player was closed, relaunched with the same isolated runtime, and immediately restored the same takeover without another OTP | PASS |
| Disconnect and clear | CMS gateway stopped; player retained cached emergency; API cleared the dedicated emergency while disconnected and reported zero active emergencies | PASS |
| Reconnect reconciliation | gateway restored healthy; player removed the stale takeover, returned to DEFAULT MEDIA, stayed paired, and CMS health returned ONLINE with a 22-second heartbeat age | PASS |

### Remaining approval and coverage gates

1. Fresh approval is required before installing the rebuilt P1 candidate and repeating the exact outage/recovery journey.
2. Direct user login in the real local CMS browser is still required for visible tab-by-tab CMS verification and the two-session convergence journey; credentials will not be automated.
3. Large/missing/corrupt image/video/PDF, audio/mute/loop-off, restart-during-video/PDF, missing emergency media, group/site default priority, operator clear-cache after paired content, deletion/re-pairing and the final integrated regression remain open.
4. Sign-out, reboot, repair/reinstall and uninstall/reinstall remain approval-gated. True upgrade remains blocked unless an older approved package is supplied.
5. Remote Ubuntu deployment and production TLS remain **NOT VERIFIED** non-blocking follow-ups.
