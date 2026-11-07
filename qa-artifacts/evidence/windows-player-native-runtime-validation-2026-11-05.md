# Windows Player Native Runtime Validation — 2026-11-05

Status: **FINAL RELEASE DECISION — isolated local-Docker QA is usable, but broader Windows shipment is blocked by the persistent site-profile/autostart defect and unclosed release gates listed below**

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
| final native unit suite, normal Windows host access | post-fix current-source sweep: 552 passed / 9 pending / 6 failed; every failure is an established host prerequisite (five Windows symlink-creation EPERM cases and missing `openssl`). The recovery-reason assertion now passes after immediate confirmed-recovery reconciliation. One scheduled-screenshot test exceeded its five-second limit during an earlier loaded file run and passed immediately in isolation; it passed in the final full sweep. | DEGRADED BUT ACCEPTABLE |
| focused native symlink suite, Administrator | first run reached all five assertions: 3 passed and 2 failed only because POSIX mode-bit expectations are not meaningful on Windows; platform-correct assertions then passed 5/5, exit 0; no Windows security setting was changed. Repro script SHA-256 `089500c3e2fafde1b136b63e9c871e7a48fcf2f95209eeb3fc90f2b2edef09b0`; result log SHA-256 `f582f3d6f8670873243c7374a2c4692c3b7a8a2c71dd93f071f724325555427f`; exit record contains `0` and has SHA-256 `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9` | PASS |
| former suite-order failure | in-place recovery passed in isolation and in the final full suite after replacing a fixed 20 ms sleep with a bounded wait for the submitted recovery and `PAIRED_RUNTIME` state | PASS |
| Docker symlink-capable supplement | official Node 20.20.2 container, frozen lock install, five focused symlink-hardening cases passed; supplemental only, not native-Windows approval | PASS (SUPPLEMENTAL) |
| final native integration suite | 6 passed | PASS |
| final native fault-injection suite | 22 passed | PASS |
| final native performance suite | 8 passed on the post-window-recovery 2026-11-06 rerun; idle CPU P95 19%, memory P95 33.00 MB with no growth, startup 110 ms, timeline jitter P95 1 ms and transition jitter 20 ms | PASS |
| renderer browser regression, initial Windows run | long critical emergency copy overflowed its portrait text box; Edge profile cleanup hit a transient lockfile | FAIL (P1 + TEST HARNESS) |
| final renderer browser regression, remediated Windows run | 1 passed in installed Microsoft Edge; portrait emergency copy fitted and isolated Edge profile cleaned successfully | PASS |
| focused config suites after P1 fix | 42 passed | PASS |
| lint | full lint has 0 errors; warning baseline remains | PASS |
| initial NSIS package | 105,169,690 bytes, SHA-256 `52d1b8da0c510f0dab51618d7c28cffc4fe37622be0a0661d9ea35f44876b4bd` | PASS |
| initial signing | unsigned | DEGRADED BUT ACCEPTABLE |
| superseded rebuilt package | 105,169,750 bytes, SHA-256 `1ea2737421fee04b6e69898f9a77071e625e047cb58be732c7758237dd918359`; not installed and no longer matches the final source tree | NOT A CANDIDATE |
| superseded post-test NSIS package | 105,359,235 bytes, SHA-256 `061041434a208c20a6ad95310e9817f68e8ffb19df376b637cb321715b20f543`; not installed after the emergency-fit source change | NOT A CANDIDATE |
| superseded emergency-fit NSIS package | 105,359,501 bytes, SHA-256 `0725390b555c01054191101790544df9fc87ef25633b3053e1103d77af25cc20`; not installed after the final TLS resource-safety edit | NOT A CANDIDATE |
| installed repaired NSIS package | 105,360,676 bytes, SHA-256 `2454af0bd0cd8fa4f00062e4c85d327a085cf763db25413f883e49045c079cd6` | PASS |
| installed repaired unpacked executable | 188,802,048 bytes, SHA-256 `475e927d57d2d37b05e6b7c5ec26dd9e95afa61d9dae68356cef8bad0dafeeb2` | PASS |
| installed repaired packaged `app.asar` | 83,866,137 bytes, SHA-256 `9fa0758bab3dad7b771a989a4594a950c3158018918d48cf8221bbf8d58e1f65`; installed preload, player bundle and renderer playback artifacts byte-matched the pre-PDF-screenshot-remediation `dist` output | PASS |
| superseded blank-PDF-only remediation NSIS | 105,360,784 bytes, SHA-256 `b779482ea7ba60044980942bb2844850cd7384c441e93f62502e90dbe2607175`; built 2026-11-06 22:22:10 +05:30; unsigned, not installed, and superseded after the schedule-close/window-recovery P1 was confirmed | NOT A CANDIDATE |
| superseded combined PDF/window-recovery NSIS | 105,359,807 bytes, SHA-256 `1be3a3fd05cb697f66df0168596189b71e53099b90a4af3c84376c3eacfc23a6`; built 2026-11-06 23:10:25 +05:30; unsigned, not installed, and superseded after PoP closeout was proved incomplete | NOT A CANDIDATE |
| installed final PDF/window/PoP-closeout NSIS | 105,359,989 bytes, SHA-256 `d51954068efbb223691f3620bf8e02db3e9cf965f2e3a5fad943f0e8c64d630a`; built 2026-11-06 23:21:52 +05:30; explicitly approved and installed 2026-11-06; unsigned QA build | PASS |
| installed final executable | 188,802,048 bytes, SHA-256 `47b9e76f125354393250b9fd5183c98345ce1b6e116b2b8f32c12852fb1b8f34`; unsigned | PASS |
| installed final packaged `app.asar` | SHA-256 `17a963d43ec7ae420089a234b459568da6210c62e658d99c7d7b02d3b07f5de8`; packaged application, playback engine and PDF renderer byte-match the final local production `dist` output | PASS |
| superseded first composed-screenshot/active-slot-retry NSIS | 105,359,653 bytes, SHA-256 `1cd4b417340d2f02035d621a81959e179a85b5d86d6d7e8f5066949b0ad2bc89`; unsigned and never installed. A native Windows smoke test proved Electron did not enumerate the calling process's window source, so the candidate was superseded before approval. | NOT A CANDIDATE |
| installed display-compositor/active-slot-retry NSIS | 105,360,162 bytes, SHA-256 `77718f88d475afe30f676eea146ab09ecb72f6b8f088a535c471f2ce7f172db0`; unsigned; explicitly approved and installed | SNAPSHOT SUPERSEDED |
| installed focus/elevation capture NSIS | 105,360,314 bytes, SHA-256 `0c161b9c128f3c17e21cb90ada22daf86a637693dc642b95ac6c293ac718e28a`; unsigned; explicitly approved and installed 2026-11-07 | PDF SNAPSHOT FAIL |
| superseded PDF image-layer capture NSIS | 105,360,653 bytes, SHA-256 `8fad824ebd0a20a9a2f0ce0815dd9c19b7d41489b141b385998f19a0efa28391`; unsigned; not installed and superseded after the final unit sweep exposed stale recovery-reason reconciliation | NOT A CANDIDATE |
| installed PDF image-layer/recovery-reconciliation NSIS | 105,360,901 bytes, SHA-256 `af0a1fd625a6c3e7a7454cc6765017f986e4e7bbbd6bbcc3b8dbc68826ef7845`; unsigned; explicitly approved and installed 2026-11-07; post-fix unit 552 pass / 9 pending / 6 host prerequisites, integration 6/6, performance 8/8, fault 22/22, lint zero errors, production build and covered-window capture smoke pass | PASS |
| installed packaged provenance | unpacked executable 188,802,048 bytes / SHA-256 `28f9dcfeb3a37ba1ebe49971a8b6ffaa88c840c9dbafa7a33790cb7128e008de`; `app.asar` 83,878,271 bytes / SHA-256 `cfdf87f0b9522107e85aff27bc3c26819019077fcedb810c52c55450b6d3b810`. Packaged application, player-flow recovery reconciliation, Windows compositor helper, PDF renderer and final renderer bundle each byte-match the post-fix production `dist` artifact. | PASS (PROVENANCE) |
| rebuilt signing | unsigned | DEGRADED BUT ACCEPTABLE |
| changed-text secret/redaction audit | no private-key PEM, JWT-shaped value, assigned password/session/access/refresh token, or full device UUID in the Windows evidence; certificate PEM markers are unchanged test fixtures and absent from the diff | PASS |

The current package completed as a per-user x64 NSIS installer without Linux packaging tools. Electron-builder found no signing identity, so both the executable and installer remain unsigned.

The approved `af0a1fd6…7845` candidate was rehashed immediately before install,
installed silently with exit code 0, and produced the exact approved
188,802,048-byte installed executable. It ran as one four-process player tree
against the existing isolated local-Docker runtime and reused the signed paired
identity without an OTP. All six `win-qa-20261105-local` services remained
available and CMS `:18444` returned HTTP 200.

## Installation and visible player journeys

| Case | Observed behavior | Result |
| --- | --- | --- |
| Approved initial install | one-click per-user installation completed | PASS |
| Initial installed executable | `%LOCALAPPDATA%\Programs\darshan-player\DARSHAN-Player.exe`, version 1.0.0, SHA-256 `37c38325d3c3eedaee552fd5bb94fc166d6a91a82e5bf39c1816a3273d5728e2` | PASS |
| Approved rebuilt install | exact unsigned NSIS SHA-256 `fbaaa365e7acb9aacff2e3cfe6c7eab61919bec6caf79ec6af2f7cee1a01ca0b`, 105,359,603 bytes, installed per-user on 2026-11-06 | PASS |
| Current installed executable | version 1.0.0, 188,802,048 bytes, SHA-256 `28f9dcfeb3a37ba1ebe49971a8b6ffaa88c840c9dbafa7a33790cb7128e008de`, unsigned; installed from exact approved `af0a1fd6…7845` package | PASS |
| Start Menu registration | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DARSHAN-Player.lnk` targets the installed executable | PASS |
| ProgramData config and CA | destination hashes matched the bootstrap packet; config contained no credential/private-key markers; CA contained one certificate and no private key | PASS |
| First visible launch | fullscreen forest pairing screen; no window chrome or immediate crash | PASS |
| Host/display/platform | hostname `Ayush`, 1920×1080, `win32 x64` | PASS |
| Pairing diagnostics | DNS and API reachable; strict TLS connection succeeded | PASS |
| Countdown | advanced normally; a strict-TLS read-only status poll confirmed the server-authoritative countdown progressed from generation 55 to expiry without relying on the stale hidden-window accessibility cache | PASS |
| Second launch | one player window remained | PASS |
| Rebuilt second launch | one player window remained after launching the installed executable again | PASS |
| Earlier repaired-candidate second launch | the then-installed 105,360,676-byte candidate was launched again while its paired kiosk process was running; the attempted second main process exited, the original main PID remained, and exactly one main process plus its three Electron children remained | PASS |
| Final post-reinstall Start Menu/single-instance launch | the registered Start Menu shortcut resolved to the exact final installed executable. Launching it while the paired kiosk was running preserved the original root PID, one four-process tree and exactly one visible window. | PASS |
| Final-candidate automatic window recovery | closing the sole default-media kiosk on the installed 105,359,989-byte candidate retained the original main process and one four-process tree, then recreated exactly one visible `ONLINE` / `DEFAULT MEDIA` window in about 1.3 seconds; no new error/fatal or destroyed-object record and no stale backend schedule/slot/open-PoP state | PASS |
| Final-candidate same-package repair | immediately reverified approved installer hash/size, stopped only the idle default-media player, ran the exact installer silently with exit code 0, and confirmed the installed executable returned to the exact 188,802,048-byte approved hash. Relaunch with the isolated selector reused pairing with no OTP, returned one four-process tree and one visible `ONLINE` / `DEFAULT MEDIA` window, and the backend retained exactly one dedicated ACTIVE screen with fresh heartbeat and zero active schedules/slots | PASS |
| Start Menu app launch | launched the registered `com.darshan.player` entry while the player was running; the same window ID remained the only DARSHAN window and the pairing surface stayed coherent | PASS |
| Executable path containing spaces | copied the complete 79-file then-installed program (402,870,170 bytes) to a verified Windows temporary path containing spaces; executable SHA-256 `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda` and `app.asar` SHA-256 `7ba75fa923655082cd657c002fdbf700e251ecf6118a607fc0a567a3110c1a9f` matched that installed candidate. A process and one visible pairing window ran from that exact spaced path with hostname, countdown and waiting state intact. The temporary process was stopped, the ordinary installed player restored to one coherent pairing window, and the exact 79-file duplicate removed. | PASS |
| Close/reopen while pending | same redacted Device ID, OTP and countdown resumed | PASS |
| OTP expiry/renewal | generation 55 expired unconfirmed at the backend and generation 56 appeared automatically with a different six-digit code and a fresh 576-second server window; redacted Device ID `b9e19bbf-…-f72a` and hostname stayed stable | PASS |
| Missing ProgramData config | isolated profile showed controlled `Player setup required`, no device identity, no invented backend | PASS |
| Malformed selected config, initial package | exited with code 1 before creating a window; reproduced twice | FAIL (P1) |
| Malformed selected config, rebuilt package | isolated installed-player launch remained open on `Player setup required`, showed the parse reason, hostname/resolution/platform, Device ID `-`, and no invented backend | PASS |
| Valid config after malformed test | isolated process stopped; ordinary QA launch restored one pairing window with strict TLS diagnostics OK and the same redacted Device ID `b9e19bbf-…-f72a` | PASS |
| Backend unreachable before pairing | exact installed executable launched with isolated fixture `WIN-QA-20261105-unreachable-config.json` (SHA-256 `d8260047e5b360aadd0b25a29c808e4ccc7e56101b2532786c242b99842f0047`) targeting the same QA host on deliberately closed TCP port 1 with strict TLS still enabled. One window showed `Fresh Pairing Required`, a connection-refused reason and coherent recovery guidance; it remained one window after a bounded retry wait and issued no Device ID. | PASS |
| Network restoration before pairing | isolated process stopped; its four-file/40,343-byte runtime contained no reparse point, private-key marker, JWT or full GUID. The ordinary player restored one pairing window, waiting/countdown state and the same internally compared Device ID. Generated runtime state was removed; the safe reproducible config fixture remains. | PASS |

At this historical pre-Docker checkpoint, the first OTP was deliberately not approved. The expired generation-55 value and current generation-56 value were retained only in memory for the next CMS test and were not written to chat or evidence. The later authorized local-Docker continuation below completed old-OTP rejection and latest-OTP approval.

## CMS browser trust gate

The real CMS was first opened at `https://192.168.29.64:18443` in a fresh visible browser session. Chromium stopped at `net::ERR_CERT_AUTHORITY_INVALID`; the warning was not bypassed and no credentials were entered. After explicit approval, the exact QA CA at `C:\ProgramData\DARSHAN\transport-ca.crt` was rechecked as SHA-256 `e98416ad8d0712931ceb5d93f2c1be1edd6f4f65fd07a7ff4ea7f8d0e9c1bc48`, subject/issuer `CN=DARSHAN Windows Player QA CA`, thumbprint `2193117D3BC0500CEDF3A479395D686C65FD2E6C`, valid 2026-11-05 through 2026-12-05, CA basic constraints present, and no private key. Import changed the matching `Current User\Root` count from zero to one while `Local Machine\Root` remained zero. The in-app browser then trusted TLS but triggered the CMS production inspection lock, so its temporary tab was closed.

The user signed in directly in native Microsoft Edge 156; the agent did not enter or inspect credentials. The authenticated `/dashboard` loaded with the expected navigation and zero screens. `/screens` then loaded, reported zero visible screens plus pre-existing orphan pairing diagnostics, and opened the Pair Device dialog. Before any code or fixture was submitted, the same native Edge tab was redirected to `/login?redirect=%2Fdashboard` and exposed the CMS-owned `Inspection tools are blocked on this system` production lock. The lock was not bypassed. No screen, pairing approval or fixture mutation occurred.

This is classified **P1** because a normal native Edge session was blocked before pairing. The lock recorded `devtools viewport heuristic`; no inspection shortcut or context menu caused it. Source inspection found that the production boundary treated any absolute outer/inner browser-size delta above 160 px as developer tools, so ordinary Edge chrome and its visible startup banner could satisfy the trigger. The local CMS remediation now establishes the ordinary browser-chrome delta as a baseline, lowers that baseline when chrome is removed, and locks only on a later increase greater than 160 px. F12/Ctrl+Shift inspection shortcuts and context-menu blocking are unchanged. Focused regression: 4/4 pass; full CMS unit suite: 291/291 pass; full CMS lint: exit 0 with three pre-existing Fast Refresh warnings and zero errors; exact production-lockdown CMS build and bundle-budget gate: pass after restoring the exact lockfile dependencies (2,599 modules transformed). The first unqualified full-unit invocation recorded 290/291 because the checked-out developer `.env` selects `/config/app-config.local.json` while one fallback test assumes the default `/config/app-config.json`; a process-scoped default-path override produced the 291/291 deterministic run without changing source.

The rebuilt static CMS was then served read-only from an isolated Docker `node:20.20.2-bookworm-slim` container on `127.0.0.1:18444`. Native Edge loaded the production-lock-enabled login page with the same visible Edge startup banner and remained unlocked across the initial and polling intervals. The temporary container was stopped and removed. An attempted F12 injection was rejected twice by the Windows-control helper, so preservation of the shortcut trigger is supported by unchanged source and focused logic coverage but is not promoted to a native-input pass from this smoke run. The 104-file/4,026,160-byte static artifact has manifest SHA-256 `8c81b4c6af2ca5a5e9f57548999c2dec9bc9a6c1cc34a2970d139a782afcd1db`; source hashes are `8048407c…f638` for the boundary, `1550d9b5…00c` for the viewport helper and `0d25ad7c…8e` for its test. The official exporter correctly refuses the dirty worktree and requires a clean provenance-bearing commit plus its exact nginx image; that release gate was not bypassed and no deployable signed role archive was fabricated. The fix is not integrated until the updated CMS is explicitly authorized, packaged through the approved path and deployed to the isolated QA host, then the exact Edge pairing journey passes.

The user subsequently authorized SSH access and CMS-only deployment. Read-only preflights on 2026-11-06 found `192.168.29.64:22` unreachable. A narrowly scoped follow-up checked only common SSH alternatives on the same authorized host (`2022`, `2200`, `2222`, `8022`, `10022`, `18222`, and `22222`); none accepted TCP. The Windows profile contains known-host databases but no SSH private-key files, and no SSH agent is running. The resolved `support@192.168.29.64` client configuration remains port 22, while neither repository configuration nor runbooks define a nonstandard endpoint for this QA host. No remote command, transfer, backup, container restart or deployment occurred. Deployment now requires the operator to enable/provide the actual reachable SSH endpoint and make an approved key available through the local SSH agent.

## Operator tooling and production kiosk checks

The then-installed executable (SHA-256 `5e4ff1aacb0821340f88741f4eee64d389779237155661079b825b30674f1fda`) was invoked directly for the read-only operator commands while the ordinary player remained open. The current candidate is recorded separately above and was rehashed after installation.

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
| physical audio | registry inventory identifies one active Realtek render endpoint (`DeviceState=1`); pairing and audio-configured video semantics are verified, but actual audible player output still requires human listening | BLOCKED (PHYSICAL OBSERVATION) |
| display sleep prevention | the packaged player remained visibly responsive during the bounded checks, but the standard-user `powercfg /requests` query requires elevation, so an independent Windows power-request assertion and whole-machine sleep observation are not yet proven | BLOCKED (ADMIN / PHYSICAL OBSERVATION) |
| packaged QA runtime policy | isolated fixture `WIN-QA-20261105-qa-mode-config.json` SHA-256 `fbafe68da44235c4797a3b712a83359e6bb317d5ef0ddf6f60547600a99e4fc7`; installed `doctor` confirmed packaged runtime mode `qa`. One controlled recovery window opened, and F12/Ctrl+Shift+I each left one player window with no DevTools surface. The four-file/34,340-byte generated runtime contained no private-key marker, JWT or full GUID; production mode then restored one waiting window and the same Device ID before the generated runtime was removed. | PASS (BOUNDED) |
| Windows-key kiosk check | not attempted because the Windows automation safety policy forbids Windows-key injection | BLOCKED |

## Autostart and uninstall registration preflight

| Case | Observed behavior | Result |
| --- | --- | --- |
| Current-user autostart registration | exactly one `com.darshan.player` Current User Run entry targets the current installed executable; the registration was re-read after the final install and the executable SHA-256 is `28f9dcfeb3a37ba1ebe49971a8b6ffaa88c840c9dbafa7a33790cb7128e008de` | PASS |
| Local-Docker autostart selector | final delete/re-pair proved that a plain installed/Run launch still falls back to the administrator-owned ProgramData remote-QA site profile. `DARSHAN_PLAYER_CONFIG_FILE` expects a nested site-profile document and cannot point at the mutable top-level runtime `config.json`. The current successful local-Docker player uses a process-scoped nested site profile plus the isolated runtime root. No password, automatic login, security setting or unrelated environment value was changed. | BLOCKED ON ADMIN PROFILE UPDATE |
| Sign-in/reboot autostart | one sign-out and one reboot remain explicitly approved for the end of this run, but running them now would exercise the known remote ProgramData fallback. First update the persistent site profile under Administrator control or install an equivalent valid selector, then perform the approved sign-out/reboot journey. | APPROVED / BLOCKED ON PROFILE PERSISTENCE |
| Uninstall registration | exactly one Current User `DARSHAN-Player 1.0.0` registration points to the installed uninstaller with `/currentuser`; the entry declares no Control Panel modify/repair action | PASS (PREFLIGHT) |
| Installed uninstaller | SHA-256 `b43dc90e9896529de5fd298468a62152e3c26a17ef72eaa22ec36d2536daff28`; unsigned | DEGRADED BUT ACCEPTABLE (QA ONLY) |
| Pre-uninstall retention baseline | installed program: 79 files / 402,870,298 bytes / no reparse points; per-user runtime: 48 files / 1,765,197 bytes / no reparse points, including generic config, device-state and pending-pairing credential files without reading or hashing their contents; ProgramData: only `config.json` (706 bytes, expected SHA-256 `61bdbbd…e6a8`) and `transport-ca.crt` (1,513 bytes, expected SHA-256 `e98416ad…bc48`) | PASS (BASELINE) |
| Final-package uninstall | with the player idle on default media and no active slot, the exact hash-recorded uninstaller ran silently with `/currentuser`, exited 0, removed every file from the installed program directory and removed its uninstall registration. The empty install directory remained temporarily. Both Roaming application-data trees, the updater cache, two ProgramData bootstrap files and all 20 isolated runtime files were retained. | PASS |
| Uninstall autostart cleanup | the `com.darshan.player` Current User Run value remained while the executable was absent. Windows therefore retained a stale login target until reinstall. No data or pairing loss occurred. | P2 DEFERRED |
| Exact-package reinstall | the installer was rehashed to `d5195406…630a` / 105,359,989 bytes immediately before reinstall, ran silently with exit 0, restored the exact installed executable hash, recreated one uninstall registration and left one Run entry. Relaunch with the isolated selector reused pairing without OTP, returned one visible `ONLINE` / `DEFAULT MEDIA` kiosk, and the backend retained one fresh dedicated ACTIVE screen with zero active slots. | PASS |

No uninstall, repair/reinstall, sign-out or reboot action was taken in this historical preflight. The exact final package was later exercised as both a same-package silent repair and a complete silent uninstall/reinstall. Both returned the exact executable bytes and reused pairing without OTP; one ONLINE kiosk and exactly one backend screen with fresh heartbeat returned. The uninstaller left a stale Run value only while the executable was absent, classified P2 and automatically repaired by reinstall. Sign-out/reboot remains blocked on the persistent local site-profile update recorded above.

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

## Superseded pre-Docker blockers and next actions

This checkpoint is retained as history. The authorized local-Docker continuation
immediately below supersedes its functional CMS/SSH blocker; remote Ubuntu and
production TLS remain non-blocking follow-ups rather than gates for this run.

1. Native Edge authentication succeeded and the real dashboard/Screens/Pair Device surfaces loaded, but the CMS production inspection lock then redirected the tab to login before submission. The confirmed P1 false-positive fix passes locally and deployment is authorized, but SSH port 22 is refused and no alternate port/key is available. A reachable SSH endpoint and approved authentication method are required before CMS-only deployment and real-browser reverification; the existing lock will not be bypassed.
2. Expired generation-55 rejection and current generation-56 approval through the real CMS remain pending. Generation change, different code, stable hostname and stable redacted Device ID are verified.
3. This historical checkpoint preceded the successful local-Docker pairing, telemetry, media, scheduling, delivery, proof-of-play, screenshot, offline recovery, emergency, paired `clear-cache`/redownload and final same-package repair journeys documented below. Supported deletion/re-pairing and uninstall/reinstall were completed later; autostart sign-in/reboot remains blocked on persistent local site-profile setup.
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

### Edge media and playback semantics

Only dedicated prefixed fixtures were used.

| Case | Evidence | Result |
| --- | --- | --- |
| Large image | generated JPEG independently verified as 6000×4000, 1,117,911 bytes, SHA-256 `5bc002e94d846d7e26b6c5fb7a5daba070236c52a67031a46430f78a69926861`; READY media fingerprint `dd340eaef11e`; visible centered containment with side letterboxing | PASS |
| One-page PDF | valid one-page fixture reached READY with page count 1 and media fingerprint `b682f3522f81`; page 1 rendered centered | PASS |
| Invalid PDFs | corrupt fixture fingerprint `2cd6e97c567f` failed with `DOCUMENT_PDF_INVALID`; encrypted fixture fingerprint `20f304143983` failed with `DOCUMENT_PDF_ENCRYPTED` | PASS (EXPECTED REJECTION) |
| Portrait and selected page | portrait media retained its aspect ratio with side letterboxing; page 3 of the existing multi-page PDF rendered | PASS |
| Video decode and loop policy | video decoded visibly. Snapshot fields recorded one audio-enabled/loop-on occurrence and one muted/loop-off occurrence. Progress kept the looping occurrence incomplete while wrapping decoded position; the non-loop occurrence completed near decoded duration before its longer display window ended. Physical audible output was not human-verified. | PASS (CONFIG/RUNTIME SEMANTICS) |

Edge playback fingerprints: layout `d1f1bf87a48d`, presentation
`b85505828650`, schedule `f975f47e18f9`, publish `c09aea18e96f`, snapshot
`adcdcb4b2e4a`.

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

First rebuilt candidate (never installed; superseded):

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,359,666 bytes;
- SHA-256: `5973a8e726fcf210587ae3880d8f81ceb41cbd813ac986406b557c8f2c52dece`;
- signing: unsigned QA build.

That candidate was never installed and is now superseded by the combined P1
candidate recorded below. The exact outage/recovery journey has not yet been
rerun against either source fix.

### Restart during active video — confirmed P1 and source remediation

The old installed package was exercised twice with dedicated full-screen,
audio-enabled, looping-video schedules. Video was visibly playing before each
restart. After terminating only the exact installed-player processes and
relaunching the same isolated runtime, exactly one paired ONLINE player window
returned with the correct fresh schedule snapshot, but its playback area stayed
black for at least 18 seconds. A bounded ranged request to the signed video
source returned HTTP 206, so source availability and decode support were not the
cause. Each dedicated publication was taken down after observation and the
player returned to default media.

Safe reproduction fingerprints:

- first schedule `e582fea0ec3d`, publish `b510b47c7865`, snapshot `275f2303c7ad`;
- confirming schedule `9f279cbdd0c9`, publish `17a0145871c7`, snapshot `fbc4eff475d3`.

The first root cause was a startup listener gap: the scheduler emitted the active
item before the renderer registered its `media-change` listener, and the
original main-process best-effort restore ran during the same pre-listener
window. The renderer-ready handshake now subscribes first, applies the
authoritative lifecycle presentation and requests the current item again. The
restored event retains the render token required for proof-of-play confirmation.

The exact approved unsigned installer SHA-256
`0b0fe27dbad23140cb78b71873a26355bf5f320437792bf59f0dec651f0bca56`
(105,360,296 bytes) was then installed per-user. Default-only restart,
offline cached-default playback with the visible `OFFLINE` badge, controlled
missing-default behavior and automatic recovery/redownload all passed. Active
video restart still reproduced the black playback area twice while the player
was paired, ONLINE and using the fresh authoritative snapshot. This installed
candidate is therefore superseded.

Safe instrumentation exposed a second startup race. Ordinary initial renderer
navigation called the live-interruption path even though LIVE did not own
content. That transiently published `mode: live`, `phase: SUSPENDED`, clearing
the normal schedule after it had begun. Same-window attachment now keeps the
content epoch stable, live suspension occurs only when the renderer actually
changes, and ordinary navigation returns without muting, stopping or publishing
a LIVE state unless LIVE owns content. Boot-time playback remains deferred until
a newer authoritative schedule presentation releases it.

The repaired source then passed the exact visible restart journeys against the
isolated Docker target. Active video `SOURCEFIX-06` visibly returned decoded
color bars after restart (schedule `c070ba6ee826`, publish `3045cf776cb9`,
snapshot `13c7a1608b92`). Selected-page PDF `SOURCEFIX-PDF-01` returned page 3
after restart (schedule `07c061a6803f`, publish `aacba4504b1f`, snapshot
`e8186fb6c596`); the fixture pages are intentionally blank, so the expected
visible result is a white 16:9 page. Both publications were taken down after
observation.

The old installed package also reproduced a restart/default handoff failure.
In two observations, including one clean restart while only screen-level default
content was effective, the player returned paired and ONLINE with a fresh
`DEFAULT MEDIA` snapshot but visibly rendered `No content assigned`. The
backend snapshot contained the dedicated default image, the local default-media
record contained the same assigned image and a cached local URL, and the player
log reported `hasMedia: true`; this rules out an absent assignment or missing
cache object. The already-built current source was then launched twice against
the identical isolated runtime. Both launches exposed the assigned image in the
player accessibility tree with no standby copy. This is supporting source-level
evidence only: the exact default-only restart must still pass after the rebuilt
installer is approved and installed.

Combined source verification before the next reinstall:

- final focused playback/handshake/content-owner/live-flow coverage: 29 passing;
- broader playback/player-flow/secure-guard/deferred-playback coverage: 50 passing;
- the broader standard-user run initially hit three Windows hard-link permission failures; those same cases passed when rerun with the required privilege;
- final full unit sweep with normal Windows host access: 537 passing, 9 pending, 6 established host-environment/tooling failures; a restricted runner produced 439 passing / 91 false environmental failures before the host-access rerun separated them from product behavior;
- current-source approved Administrator symlink-hardening gate: 5 passing, exit 0; log SHA-256 `d27f53973d9eaac70aff201317e0a524beaee49d38a19ae6498fac13cc1df613` and exit-record SHA-256 `13bf7b3039c63bf5a50491fa3cfd8eb4e699d1ba1436315aef9cbe5711530354`;
- post-remediation native integration suite: 6 passing;
- post-remediation native fault-injection suite: 22 passing;
- restricted-runner attempts could not open loopback transport or create the protected hard-link cache stage; both exact suites passed in the previously authorized Windows test context, confirming test-host restrictions rather than player regressions;
- lint: zero errors (existing warnings only);
- production build and Windows NSIS packaging: pass.
- final 2026-11-06 regression rerun: integration 6/6, fault injection 22/22, performance 8/8, isolated Edge renderer regression 1/1, lint 0 errors (366 warning-baseline findings), and production build all pass.

Second combined P1 candidate (never installed; superseded):

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,359,871 bytes;
- SHA-256: `7cb447d898b8e093e0d9d49a31a7a02496a63f3d9d1664fa5c4902d5eeb722ee`;
- signing: unsigned QA build.

The previous 105,359,666-byte candidate was not installed and is superseded.
The 105,359,871-byte candidate was also not installed and is superseded by the
default-media remediation candidate recorded below.

### Missing cached default while offline — confirmed P1 and source remediation

The failure/recovery journey used only the isolated runtime. Only the dedicated
cached default object was moved to a prefixed temporary backup and only
`win-qa-20261105-local-cms` was stopped. The assigned default remained present
in local state. In two reproductions the old behavior showed `OFFLINE / DEFAULT
MEDIA / RECONNECTING` but rendered a black area with a browser broken-image
glyph instead of a controlled operator state.

The renderer now ignores stale errors from detached media nodes, removes the
failed assigned element, renders `Content unavailable` with operator guidance,
and keeps retry bounded. Default synchronization is registered before the
initial refresh and is repeated when entering default playback or transitioning
from offline to online. The exact source-level journey showed the controlled
unavailable surface while the gateway was down. After the gateway was restored,
the dedicated file was redownloaded, the player returned to `ONLINE / DEFAULT
MEDIA`, and the assigned image replaced the controlled state without manual
reset. The temporary backup was removed and the Docker gateway was healthy at
the end of the journey.

Additional verification before reinstall:

- focused default-media renderer coverage: 6 passing;
- complete default-media suite in the authorized Windows context: 52 passing;

Current installed-candidate re-verification on 2026-11-06:

- the exact dedicated 31,649-byte default cache object was hashed and moved to
  a recoverable QA backup;
- only `win-qa-20261105-local-api` was stopped; the installed player was
  relaunched against the same isolated runtime without changing pairing;
- the packaged player visibly reported `OFFLINE / DEFAULT MEDIA` and retained
  a safe last-decoded assigned frame, with no broken-image glyph, crash or
  pairing reset;
- after the API returned healthy, the player returned to `ONLINE` and restored
  the cache object byte-for-byte with the pre-outage SHA-256;
- a second hard-reload probe did not dislodge the retained safe frame. Because
  direct filesystem tampering bypasses the supported cache-manager contract,
  the exact backup was restored after the bounded probe rather than claiming
  continuous monitoring of external cache deletion;
- the API was healthy, the normal cache object was present and the installed
  player was visibly `ONLINE / DEFAULT MEDIA` at test end.
- the standard-user run reached 49 passing before three Windows hard-link privilege stops; an initial elevated aggregate run had one suite-order/timing mismatch, while the isolated case and a clean aggregate rerun passed;
- lint: zero errors (existing warnings only);
- production build: pass;
- Windows NSIS packaging: pass.

Superseded combined P1 candidate that was approved and installed:

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,360,296 bytes;
- SHA-256: `0b0fe27dbad23140cb78b71873a26355bf5f320437792bf59f0dec651f0bca56`;
- signing: unsigned QA build;
- packaged `app.asar` SHA-256: `59dcfcc888507e6b0843811e28ab9bcb729a1bbb55266be9e187ab50653926b3`;
- result: default/offline/missing-default journeys passed, but active-video restart failed twice; superseded.

Current repaired candidate approved and installed:

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,360,676 bytes;
- SHA-256: `2454af0bd0cd8fa4f00062e4c85d327a085cf763db25413f883e49045c079cd6`;
- last write: `2026-11-06 17:24:31 +05:30`;
- signing: unsigned QA build;
- unpacked executable: 188,802,048 bytes, SHA-256 `475e927d57d2d37b05e6b7c5ec26dd9e95afa61d9dae68356cef8bad0dafeeb2`;
- packaged `app.asar`: 83,866,137 bytes, SHA-256 `9fa0758bab3dad7b771a989a4594a950c3158018918d48cf8221bbf8d58e1f65`;
- embedded-code provenance: all ten affected compiled main/preload/renderer files byte-match the final local `dist` output, including `player-flow`, `content-owner`, `player`, default-media handling and the renderer playback handshake.

The user explicitly approved this exact unsigned package and it was installed.
The installed executable is 188,802,048 bytes with SHA-256
`475e927d57d2d37b05e6b7c5ec26dd9e95afa61d9dae68356cef8bad0dafeeb2`;
its installed `app.asar` is 83,866,137 bytes with SHA-256
`9fa0758bab3dad7b771a989a4594a950c3158018918d48cf8221bbf8d58e1f65`.
The paired default-only restart was repeated three times with this installed
candidate. The assigned fixture intentionally contains DARSHAN's
`No content assigned` artwork, which initially made the correct frame look like
the unassigned standby. Debug overlay evidence named
`WIN-QA-20261105-LOCAL-LANDSCAPE-IMAGE (IMAGE)`, and direct inspection of the
cached PNG confirmed the displayed pixels are the fixture itself. Normal
logging was restored afterward. This journey is PASS, not a player defect.

The exact installed active-video restart was then rerun through the native CMS
with `WIN-QA-20261105-LOCAL-INSTALLED-FINAL-VIDEO-02`. The request was approved
and published only to the dedicated Windows QA screen for the 20:40–21:28
Asia/Kolkata window. Before restart, two captures 1.8 seconds apart showed
different decoded frames of `WIN-QA-20261105-LOCAL-LOOP-VIDEO`. Publish delivery
was `ACKED_SUCCESS` with zero pending, leased or failed commands; the safe
schedule fingerprint is `03b6e91c36d4` and the snapshot fingerprint is
`8c637d1b190c`.

At 20:44:37 the five exact installed-executable processes were terminated and
the same executable was relaunched with the same isolated runtime root and
local-Docker player selector. Exactly one player window returned paired and
ONLINE. It immediately rendered the correct decoded video; an extended
post-restart observation showed a later moving frame rather than a frozen first
frame. CMS Now Playing reported the expected video, one active `main` slot and
the correct schedule window, with the post-restart slot start at 20:44:40. A
fresh Windows screenshot at 20:56:30 visibly matched the active video. The
brief duplicate-session warning cleared automatically after the old heartbeat
aged out. At the natural 21:28 schedule boundary the installed player returned
ONLINE to the assigned default media without intervention. CMS then showed
exactly one recent completed video proof interval, from the post-restart start
at 20:44:40 through 21:28:00; the next visible record was from hours earlier,
so no duplicate restart interval was present. Local PoP state drained to zero
buffer items and zero spool files, with zero dropped or compacted events. The
installed-video restart and closed-interval PoP gate are PASS.

The exact installed selected-page PDF journey was then published through the
native CMS as `WIN-QA-20261105-LOCAL-INSTALLED-FINAL-PDF-01`, targeting only
the dedicated Windows QA screen for the 21:50–22:50 Asia/Kolkata window. The
backend snapshot named `WIN-QA-20261105-LOCAL-MULTIPAGE-PDF`, type `document`,
fit `contain`, page 3, and a 10,000 ms display interval. Independent local
rendering confirmed that page 3 of the five-page source fixture is intentionally
blank, so the expected player result is a white 16:9 page rather than visible
copy.

At 22:03 the exact installed-player process tree was restarted. The first
manual relaunch omitted the isolated runtime selector and therefore opened the
preserved remote-QA pairing profile; no pairing or CMS mutation was performed
from that window. This was a test-harness launch error, not a reproduced player
defect. The mistaken process tree was closed and the same installed executable
was relaunched with the preserved local-Docker runtime root and player site
selector. Exactly one player window returned paired and `ONLINE`, with a fresh
22:03:22 snapshot, and visibly rendered the expected blank page 3.

CMS then reported the dedicated screen ONLINE with fresh heartbeat, Auth OK,
Heartbeat OK, and the PDF as its current media. Delivery was `ACKED_SUCCESS`
with zero pending, zero leased and zero failed commands. Now Playing identified
the exact PDF schedule, one active `main` slot, and a post-restart slot start at
22:03:23. Safe fingerprints: request `d40c688764da`, schedule `ee4fa7f99172`,
snapshot `2108c242b5e9`. Installed PDF restart rendering, delivery and active-slot
correlation are PASS.

Before the natural boundary, the renderer window closed at 22:34:24 while the
long-lived main process and services remained alive. At 22:50 the timeline
stopped, but a renderer IPC call threw `Object has been destroyed`; the next
snapshot poll reproduced the same failure twice. A subsequent exact second
launch logged the single-instance attempt but did not recreate a visible
window. Consequently the natural visible fallback and closed-interval PoP gate
did not pass on this installed candidate. This is the window-recovery P1
documented below, not a successful PDF closeout.

### P1 — blank PDF screenshot pixels captured as black

While the installed player visibly rendered the intentionally blank white PDF
page, a fresh CMS `Take Snapshot` command completed successfully at 22:12:31
but its preview was mostly black with only a white strip and the player status
overlay. A second successful capture at 22:15:04 reproduced the mismatch while
the live player remained white. An immediate intervening command was correctly
rejected as rate limited and is not counted as the reproduction. Playback,
delivery and the active slot remained correct, so the defect is isolated to
visual evidence but is classified **P1** because the uploaded evidence
materially misrepresented displayed content.

Root cause: PDF.js rendered an intentionally blank page into a transparent
backing canvas. The visible canvas had a white CSS background, but Electron's
pixel capture observed the transparent backing pixels as black. The renderer
now fills the backing pixel buffer opaque white under the identity transform
before restoring the PDF render scale and invoking PDF.js. Focused regression
coverage asserts the white fill and transform order: 6/6 PDF playback helper
tests pass; the broader renderer unit suite passes 48/48. Focused lint has zero
errors (five existing return-type warnings), the production build passes, and
Windows NSIS packaging passes.

The PDF-only candidate below was built but not installed and was superseded by
the combined candidate after the later window-recovery P1 was confirmed:

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,360,784 bytes;
- SHA-256: `b779482ea7ba60044980942bb2844850cd7384c441e93f62502e90dbe2607175`;
- signing: unsigned QA build;
- status: built and verified, not installed, superseded.

### P1 — destroyed renderer window breaks schedule close and relaunch recovery

The installed window closed at 22:34:24 while its main process stayed alive.
At the 22:50 schedule boundary, `PlaybackEngine.stop()` sent to the destroyed
renderer and raised an unhandled `Object has been destroyed` rejection. The
22:52 snapshot refresh reproduced the same exception in both online and
offline-fallback handling. At 22:54, launching the exact installed executable
again reached the existing single-instance process but did not restore any
window. This is classified **P1** because schedule/fallback playback and the
visible kiosk were unavailable while telemetry services continued in the
background.

The playback engine now validates both `BrowserWindow` and `webContents` and
contains the teardown race around every renderer playback IPC send. The
single-instance and activation paths now create a window when none survives,
otherwise restoring/focusing the existing window. A read-only backend
correlation then confirmed the closed PDF fixture had one schedule row but zero
PoP rows (zero completed and zero open), while the local PoP spool was empty.
The close therefore also lost the in-memory interval instead of merely delaying
its upload.

The final lifecycle fix captures the exact window identity, detaches its
content owner immediately on close, closes all active slots as incomplete,
clears stale Now Playing/telemetry, and automatically creates one replacement
kiosk. Graceful quit is fenced from recovery, and a stale close or crash
callback cannot clear or destroy a newer window. Focused PDF/content-owner/
playback/window recovery coverage passes 27/27, including exact-sender detach,
already-destroyed and between-check/send teardown, and missing/destroyed/
minimized window recovery. A real source-build second launch kept exactly one
visible player and logged the `focused` recovery result. Integration passes
6/6, full lint has zero errors, and production build/package pass. The final
full unit sweep recorded 543 passing / 9 pending / 7 failing: six are the
established symlink/OpenSSL host prerequisites, while the existing
recovery-reason suite-order case passed immediately in isolation and in the
complete player-flow run (33/33). The previously recorded fault injection
22/22 and performance 8/8 sweeps remain applicable.

Initial combined candidate (never installed; superseded after PoP closeout was
proved incomplete):

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,359,807 bytes;
- SHA-256: `1be3a3fd05cb697f66df0168596189b71e53099b90a4af3c84376c3eacfc23a6`;
- signing: unsigned QA build;
- status: built and verified, not installed, superseded.

Final combined remediation candidate, explicitly approved and installed:

- path: `darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`;
- size: 105,359,989 bytes;
- SHA-256: `d51954068efbb223691f3620bf8e02db3e9cf965f2e3a5fad943f0e8c64d630a`;
- signing: unsigned QA build;
- unpacked executable SHA-256: `47b9e76f125354393250b9fd5183c98345ce1b6e116b2b8f32c12852fb1b8f34`;
- packaged `app.asar` SHA-256: `17a963d43ec7ae420089a234b459568da6210c62e658d99c7d7b02d3b07f5de8`;
- provenance: packaged application, playback engine and PDF renderer byte-match
  the final local production `dist` output;
- status: installed; installed executable SHA-256
  `47b9e76f125354393250b9fd5183c98345ce1b6e116b2b8f32c12852fb1b8f34`.

The exact installed package passed the automatic missing-window recovery
journey at 23:38:44–23:39:01 +05:30. Before injection it had one responding
four-process Electron tree and exactly one visible kiosk. A native close request
was accepted for that exact kiosk; the original root process remained alive,
the process count stayed four, and one replacement window was observable after
about 1.3 seconds. The recovered installed window visibly reported `ONLINE`,
`DEFAULT MEDIA`, and the expected assigned fallback artwork. Redacted log
correlation since injection recorded one `Main window closed`, one new
`Creating main window`, zero error/fatal records, and zero new `Object has been
destroyed` records. Read-only backend correlation found exactly one dedicated
`WIN-QA-20261105-LOCAL-` screen, `ACTIVE`, with a 9.1-second heartbeat age;
current schedule/media were absent, active slots were zero, and open PoP rows
were zero. Automatic destroyed-window recovery is therefore **PASS on the exact
installed candidate** without a duplicate process or stale telemetry.

The signed-in active-PDF continuation then exercised those gates with
`WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-02`, scheduled for 2026-11-07
00:50–00:57 +05:30 against only the dedicated Windows QA screen. Page 3 of
`WIN-QA-20261105-LOCAL-MULTIPAGE-PDF` was visibly white on the physical player;
the CMS reported `ACKED_SUCCESS`, the correct current media and one active
slot. A native close retained the original four-process tree and automatically
created one replacement window that still showed the white PDF. At the schedule
boundary the player returned to DEFAULT MEDIA. The visible frame is retained as
`runtime-2026-10-16/installed-final-pdf-page3-white-20261107.png`.

Two P1 failures were confirmed on that exact installed candidate. First, a
successful CMS `Take Snapshot` upload displayed a black preview while the
physical player was white. Second, read-only backend correlation showed zero
PoP rows throughout and after the interval despite the active slot and
successful delivery. The first visible slot report can race ahead of
playback-engine scene installation; the old handler remembered that rejected
report permanently. Source now retains a newly reported slot only after
`recordRenderedLayoutPlayback` accepts it, so the next report retries the start.
Previously accepted slots remain stable.

The first window-source implementation was rejected before installation: a
native Electron smoke run showed that Windows did not enumerate the calling
process's own test BrowserWindow. The corrected display-compositor candidate,
unsigned SHA-256 `77718f88d475afe30f676eea146ab09ecb72f6b8f088a535c471f2ce7f172db0`
and 105,360,162 bytes, was explicitly approved and installed on 2026-11-07.
Its exact installed executable SHA-256 was
`f0929309605cb45a07d745deac0360f54ba10d2ebe560c3d036cecc4532a5c3d`.

The signed-in CMS then published
`WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-03` for page 3 from 01:43–01:51
+05:30. The installed player reported ONLINE, rendered the expected white page,
reported one live slot and returned to DEFAULT MEDIA at the natural boundary.
CMS Proof of Play recorded exactly one new page-3 interval, started 01:43:22,
ended 01:51:00 and marked Completed. This closes the active-slot/PoP P1 on the
exact installed package.

The snapshot gate still failed. `Take Snapshot` completed at 01:44:37 and the
preview was fresh, but it contained the foreground CMS window recursively
instead of the player. The player's `moveTop()` call alone does not overcome a
foreground browser on Windows. Source now temporarily sets the player always on
top, moves it to the top, focuses it, waits 250 ms for the compositor, captures
and crops the matching display, then restores the previous always-on-top state.
The strengthened native smoke deliberately covers a non-always-on-top white
canvas window with a black window before capture; it now returns a non-empty
480×360 image with a white sampled center.

Focused active-slot/screenshot/playback/window coverage passes 59/59, including
three compositor-helper cases, and the strengthened native cover smoke passes.
The preceding complete regression remains 551 passing / 9 pending / 6 host
prerequisites, integration 6/6, fault injection 22/22, performance 8/8 and lint
with zero errors. The replacement unsigned installer is
`darshan-player/build/DARSHAN-Player Setup 1.0.0.exe`, 105,360,314 bytes,
SHA-256 `0c161b9c128f3c17e21cb90ada22daf86a637693dc642b95ac6c293ac718e28a`.
Its unpacked executable SHA-256 is
`50af240f24f59ea0e72afabde9801c7af306735da319579882d18f1bcef69613`
and its `app.asar` SHA-256 is
`1f6b593d5985a13870d5ddba8f893c9bd0b413eb902beb962774bed4cfae47fa`.
It was explicitly approved and installed. The exact installed executable was
188,802,048 bytes with SHA-256
`50af240f24f59ea0e72afabde9801c7af306735da319579882d18f1bcef69613`.

The CMS then published `WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-04`, page 3 of
`WIN-QA-20261105-LOCAL-MULTIPAGE-PDF`, to the dedicated screen. Physical
playback was the expected white page and CMS reported one live slot. Snapshot
commands at 03:00:01 and 03:02:41 +05:30 both successfully focused and captured
the player rather than the CMS, but the accelerated PDF canvas pixels were
black while the ordinary HTML overlay remained visible. This proves the
focus/elevation correction and isolates the remaining P1 to Windows compositor
capture of the accelerated canvas.

Source now mirrors each completed PDF canvas into an ordinary decoded PNG image
layer before presenting it. Focused PDF/capture tests pass 19/19, the production
build passes, and the covered-window native smoke captures a 480×360 image with
a white center. The final sweep also exposed a real stale-message race when a
confirmed recovery response omitted `pairing_code`; source now immediately
reconciles that authoritative response instead of leaving the older invalid-
credential reason visible until a later poll. Its exact regression passes.

The resulting unsigned NSIS is 105,360,901 bytes with SHA-256
`af0a1fd625a6c3e7a7454cc6765017f986e4e7bbbd6bbcc3b8dbc68826ef7845`.
Its unpacked executable is 188,802,048 bytes, SHA-256
`28f9dcfeb3a37ba1ebe49971a8b6ffaa88c840c9dbafa7a33790cb7128e008de`,
and packaged `app.asar` is 83,878,271 bytes, SHA-256
`cfdf87f0b9522107e85aff27bc3c26819019077fcedb810c52c55450b6d3b810`.
Post-fix regression records unit 552 pass / 9 pending / 6 host prerequisites,
integration 6/6, performance 8/8, fault injection 22/22, lint zero errors,
build pass and covered-window native smoke pass. The user explicitly approved
the exact hash and size, and it was installed on 2026-11-07.

### Final installed PDF image-layer verification

The signed-in CMS published `WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-05` to only
`WIN-QA-20261105-LOCAL-WINDOWS-PLAYER`, using page 3 of
`WIN-QA-20261105-LOCAL-MULTIPAGE-PDF`. Publish delivery and command delivery
both reported `ACKED_SUCCESS`; before activation CMS reported zero current and
one upcoming item. At 09:00:00 +05:30 the installed player visibly replaced
default content with the expected white page 3, stayed `ONLINE`, and omitted
the `DEFAULT MEDIA` badge. CMS reported exactly one live `main` slot and the
matching document media.

The CMS snapshot command completed at 09:01:04. Its fresh preview showed the
white PDF page, player status overlay and expected black pillarbox margins; it
did not show an all-black PDF region and did not recursively capture the CMS.
This closes the accelerated-PDF snapshot P1 on the exact installed package.

The dedicated schedule was taken down at 09:05:12. The player immediately
returned to the `ONLINE` / `DEFAULT MEDIA` `No content assigned` state. Proof
of Play then recorded one page-3 row for the dedicated screen, started
09:00:00, ended 09:05:12, outcome `Completed`. A controlled exact-process
restart with the isolated runtime/config selectors produced one four-process
tree, reused pairing without an OTP, and restored the same online default state;
the new player overlay reported a 09:08:53 snapshot heartbeat.

### Revocation, deletion guard and fresh re-pair

The dedicated screen could not be deleted through the supported CMS contract
because the taken-down `WIN-QA-20261105-LOCAL-FINAL-PDF-VERIFY-05` schedule is
retained as audit history. The CMS first reported both a default-media and a
schedule reference; the default assignment was cleared through Site Settings,
leaving the single audit-preserved schedule reference. No direct database
mutation or authentication-token extraction was used to bypass that guard.

The supported `Revoke pairing` action then changed the installed player to
`Recovery Required` / `Device credentials revoked`. The packaged
`reset-pairing` operator command exited 0 against the isolated QA runtime,
cleared only identity-bound state and preserved logs, proof-of-play and offline
queues. The relaunched installed player issued a fresh pairing request. CMS
approval created a new online record with the same dedicated QA name, and the
player returned `ONLINE` / `No content assigned` at 09:28:09 without retaining
the revoked certificate. The old revoked record remains visible only because
its schedule audit reference makes deletion intentionally unavailable.

With explicit action-time confirmation, the supported CMS then deleted only
the unreferenced fresh record ending `0042`. The CMS action returned in 147 ms;
the player was observed on a fresh pairing screen 514 ms later, about 0.66
seconds after the click sequence and well inside the five-second contract. The
deleted record disappeared from the Screens list, pairing-code history later
returned to zero active, and the old identity did not resume authenticated
heartbeat or proof-of-play activity.

The installed player initially fell back to the stale ProgramData remote site
profile on an ordinary restart. The run did not bypass UAC or alter security.
Instead, it used a validated nested local-Docker site profile and isolated
runtime root inside the approved workspace, moved only stale pairing metadata
and revoked certificate files to recoverable local backup folders, and issued a
new local request. CMS approval created fresh screen suffix `1421`; player logs
showed `PAIRING_CONFIRMED`, CSR/key generation, certificate storage and
`PAIRED_RUNTIME` at 10:20:50. The visible packaged player then showed `ONLINE`
and `No content assigned`. CMS showed the fresh record Online/Idle/Auth OK/
Heartbeat OK, the protected `4bcc` audit record in Recovery Required, zero
active pairing codes, and after full refresh correct fleet totals `All 2 /
Online 1 / Needs recovery 1`.

### Targeted emergency and recovery

| Case | Evidence | Result |
| --- | --- | --- |
| Trigger scope | emergency fingerprint `691d02015248`; CRITICAL; `target_all=false`; one direct screen and zero groups | PASS |
| Visible takeover | packaged player replaced default content with the dedicated CRITICAL message; CMS Now Playing matched | PASS |
| Screenshot | command completed with no error; two preview surfaces had uploaded screenshot URLs and capture time `2026-11-06T06:56:48.896Z` | PASS |
| Restart active emergency | installed player was closed, relaunched with the same isolated runtime, and immediately restored the same takeover without another OTP | PASS |
| Disconnect and clear | CMS gateway stopped; player retained cached emergency; API cleared the dedicated emergency while disconnected and reported zero active emergencies | PASS |
| Reconnect reconciliation | gateway restored healthy; player removed the stale takeover, returned to DEFAULT MEDIA, stayed paired, and CMS health returned ONLINE with a 22-second heartbeat age | PASS |

### Paired installed operator tools

The exact installed executable was invoked with the isolated runtime root and
local Docker config while the visible player remained available.

| Case | Evidence | Result |
| --- | --- | --- |
| `doctor` | exit 0; runtime `qa`; platform `win32`; config/cache present; paired identity true; local API reachable | PASS |
| `pairing-status` | exit 0; paired locally; device ID present; last validated ID matched; certificate and private-key files present; local deployment identity present | PASS |
| earlier direct CLI output secret scan | zero private-key markers, JWT shapes, credentialed URLs or full UUIDs in the captured doctor/pairing-status output | PASS |
| `collect-logs` | exit 0; eight files, 565,868 bytes, zero reparse points and no unsafe filenames | PASS |
| required bundle secret scan | zero private-key or certificate PEM markers, JWTs, credentialed URLs, bearer values, cookie assignments or password/token assignments | PASS |
| operational identifier review | the sanitized player log contained 126 UUID-shaped values, including 40 occurrences of the current device ID; safe field labels included device, item, media, publish, schedule and snapshot identifiers | DEGRADED BUT ACCEPTABLE / P2 |
| paired `clear-cache` removal | pre-state 4 files / 308,607 bytes; command exit 0; media cache became 0 files / 0 bytes while device identity, all three certificate hashes, logs, request queue, proof-of-play spool and screenshots were preserved; command output contained zero private-key markers, JWT shapes or full UUIDs | PASS |
| online redownload after restart | QA kiosk policy reproducibly blocked Alt+F4 as intended; the five verified exact-path processes were terminated, then the installed executable was relaunched with the same isolated runtime. It reused pairing without an OTP, reported ONLINE / DEFAULT MEDIA, and restored 4 files / 308,607 bytes. A post-restart `pairing-status` exited 0 with paired-local true, valid current identity, matching last-validated device, certificate/private-key files present and zero private-key/JWT shapes in captured output. | PASS |
| final-candidate `doctor` / `pairing-status` rerun | both exited 0 after final uninstall/reinstall; `doctor` reported win32 and paired state. Neither output contained a private-key marker, JWT shape or credentialed URL. `pairing-status` contained one full operational UUID, so raw output remains internal-only. | PASS / P2 REDACTION DEBT |
| final-candidate `collect-logs` rerun | exit 0; eight files / 1,828,299 bytes, zero reparse points and zero unsafe filenames. Content had zero private-key markers, JWT shapes or credentialed URLs, but 1,382 UUID-shaped operational values accumulated in the sanitized log history. The exact verified temporary bundle was deleted immediately after review. | PASS / P2 REDACTION DEBT |

The repository evidence policy requires full device identifiers to be redacted
before sharing. Both reviewed bundles were therefore treated as internal-only and deleted
from the Windows temporary directory immediately after review. It is fully
regenerable with `collect-logs`. No bundle content or raw identifier was added
to evidence or chat. This is deferred P2 evidence-redaction debt rather than a
P0/P1 runtime defect because no credential/certificate secret was present and
the documented manual review gate worked as intended.

### Final automated regression rerun

On 2026-11-07, after the final installed PDF and re-pair journeys, the complete
standard-user unit run reported 552 passing, 9 pending and 7 failing. Six
failures are the previously characterized Windows host prerequisites: five
tests require symlink creation privilege and one test requires an `openssl`
executable on the host. The seventh was the scheduled screenshot-upload case
timing out only in full-suite order; the exact case passed independently in
2.3 seconds and confirmed that an upload failure leaves the runtime active.
This is suite-order timing debt rather than a reproduced player-runtime defect.

The separately executed final gates passed: integration 6/6, performance 8/8,
fault injection 22/22, production build, and lint with zero errors (377
pre-existing warnings). The visible packaged player remained ONLINE with `No
content assigned` after the run. No source or evidence fixture was changed by
the tests.

### CMS pairing fleet-summary correction

After the fresh re-pair, the live Screens list showed both the new ONLINE
record and the old revoked audit-preserved record, but the fleet filters still
showed the pre-pair `All 1 / Online 0 / Needs recovery 1` counts. Source review
confirmed a cache invalidation defect: successful pairing refreshed only the
overview query, while the Screens page reads its counters from the separate
`screens/summary` query.

The pairing-success path now invalidates the complete Screens query family.
The focused browser regression proves the summary endpoint is requested again
after first-time pairing. The full Screens operator suite passes 22/22 against
the existing Chrome installation, the CMS production build and bundle-budget
gate pass, and lint reports zero errors (three pre-existing warnings). The
rebuilt CMS files were deployed to the bind-mounted
`win-qa-20261105-local-cms` container and that container restarted. The final
delete/re-pair completed the visible recheck: after a full page refresh the
filters reported `All 2 / Online 1 / Needs recovery 1`, exactly matching fresh
online screen suffix `1421` and protected revoked audit screen `4bcc`.

### Remaining approval and coverage gates

1. The final image-layer/recovery-reconciliation package is installed and verified: unsigned SHA-256 `af0a1fd625a6c3e7a7454cc6765017f986e4e7bbbd6bbcc3b8dbc68826ef7845`, 105,360,901 bytes. The exact page-3 journey passed visible playback, delivery, one-slot telemetry, non-black CMS snapshot, default handoff, Completed PoP and a paired installed-process restart. No further installer approval is pending unless source changes create a different package hash or size.
2. Direct user login to the local CMS completed. The dedicated installed-video request completed authenticated create, approve and publish to only the QA screen; delivery, Now Playing and screenshot evidence pass. The remaining tab-by-tab and two-session convergence checks stay open.
3. Missing/corrupt image/video runtime fallback, physical audible-output confirmation, missing emergency media and group/site default priority remain open. The final automated regression gates are recorded above. Supported deletion, the sub-five-second fresh-pairing transition and subsequent local re-pair now pass. The old revoked record remains correctly protected until its retained schedule parent can be removed safely. Large-image, corrupt/encrypted-PDF ingest, one-page/selected-page PDF, mute/loop-off and loop-on semantics have evidence above.
4. Same-package repair and complete uninstall/reinstall pass on the exact final installer. The stale Run entry during the uninstalled interval is deferred P2 cleanup debt. Sign-out/reboot remains authorized but must wait for an Administrator update to the persistent ProgramData local site profile (or an equivalent valid nested selector); true upgrade remains blocked unless an older approved package is supplied.
5. Remote Ubuntu deployment and production TLS remain **NOT VERIFIED** non-blocking follow-ups.

## Final candidate readiness report — 2026-11-07

- Branch: `codex/windows-player-runtime-validation-20261105`.
- Validation evidence head before this final report: `26cd907`.
- Installed unsigned candidate: `DARSHAN-Player Setup 1.0.0.exe`, 105,360,901 bytes, SHA-256 `af0a1fd625a6c3e7a7454cc6765017f986e4e7bbbd6bbcc3b8dbc68826ef7845`.
- Installed executable: 188,802,048 bytes, SHA-256 `28f9dcfeb3a37ba1ebe49971a8b6ffaa88c840c9dbafa7a33790cb7128e008de`.
- Runtime at decision time: one four-process installed player tree; local CMS, API, PostgreSQL, MinIO and supporting Docker services running; `/api/v1/health/ready` returned ready with database, migrations, bootstrap, MinIO and worker checks healthy.
- Principal fixes: Windows runtime hardening (`ab689a2`), renderer-restart recovery (`c911144`), offline/runtime and PDF capture recovery (`c84dd2c`), and CMS post-pair fleet-summary invalidation (`bed27d4`).
- Passed journeys: native install/repair/uninstall/reinstall; first pairing, renewal, stale-code rejection and credential reuse; CMS screen details and telemetry; image/video/PDF playback; default/schedule transitions; delivery, proof of play and screenshots; future/group targeting and conflict rejection; cached offline playback and recovery; targeted emergency/restart/disconnected clear; paired operator tools and cache redownload; deletion guard, supported deletion, sub-five-second fresh-pairing transition and fresh re-pair.
- Automated evidence: player integration 6/6, performance 8/8, fault injection 22/22, production build, lint with zero errors; CMS Screens 22/22, CMS build and bundle budget pass. The full player unit run recorded 552 pass, 9 pending and 7 failures: six documented host prerequisites and one suite-order timeout that passed independently.
- OS-dependent evidence: one 1920×1080 display at 150% scale, native Windows/AppData paths, single-instance behavior, fullscreen and tested keyboard restrictions passed. Physical audible output, whole-machine sleep, physical cursor/Alt+Tab and multi-monitor placement remain unverified.
- Closed P1: the Administrator-installed ProgramData profile and current-user selector both resolve the verified local CMS. Ordinary restart preserves identity, and the explicitly enabled Windows login item launches one four-process installed-player tree after the observed Windows startup delay. The player preserves identity, enters offline-safe mode while Docker is unavailable, and returns to `PAIRED_RUNTIME` without a player restart when the backend recovers.
- Additional open gates: two simultaneous CMS-session convergence; missing/corrupt image and video runtime fallback; missing emergency media; group/site default priority; true upgrade without an older approved installer. Remote Ubuntu deployment and production TLS are explicitly not verified and remain non-blocking follow-ups for this local run.
- Deferred P2 debt: stale Run entry while uninstalled, operator display inventory gap, operational UUIDs in internal-only support bundles, and the characterized full-suite timing case.
- Safety decision: safe for continued isolated `win-qa-20261105-local` QA with the verified persistent local site profile. Not approved for broader beta QA or production shipment because the visible/physical gates listed above remain open, true upgrade lacks an older approved package, and remote Ubuntu/production TLS are not verified.

WINDOWS_PLAYER_CANDIDATE_BLOCKED

## Final gate continuation — 2026-11-07

- The current-user persistent selector was corrected to the verified nested local site profile at `out/WIN-QA-20261105-local-docker/player-site-config.json`; its CMS and socket endpoints are `http://localhost:18444` and `ws://localhost:18444/socket.io`. The runtime-root selector remains the isolated QA runtime.
- The installed player remained a single four-process tree. Its log recorded pairing completion, heartbeat startup, snapshot-manager startup and `PAIRED_RUNTIME` against the local Docker CMS. All six local Docker services were running; CMS returned HTTP 200.
- The focused default-media/player-flow regression passed 52/52. This covers fallback selection and teardown, offline cached default behavior, empty default behavior, mode transitions and emergency-message flow at code/runtime-test level.
- The focused live-normal lifecycle, approved-asset and cache/corruption group recorded 63 passes. Its three failures were all Windows host symlink-creation `EPERM` prerequisites; the missing/corrupt pin, repair and lifecycle cases themselves passed.
- A validated Administrator helper was prepared to back up the retired ProgramData profile and install only the verified local profile. Windows UAC consent was triggered but had not been accepted at evidence-write time, so the administrator-owned profile, sign-out and reboot/autostart proof remain open.
- No claim is made for physical audible output, whole-machine sleep, physical cursor/Alt+Tab, or multi-monitor placement. Only one display is available and those checks require human/physical observation.
- Two independent authenticated CMS sessions and visible packaged-player journeys for missing/corrupt image/video, missing emergency media, and group-versus-site default priority remain release gates; the passing focused automated coverage does not replace those visible integration proofs.
- True upgrade still requires an older approved installer. Remote Ubuntu deployment and production TLS remain explicitly **NOT VERIFIED** non-blocking follow-ups for this isolated local run.

The release decision remains blocked pending Administrator consent and the remaining visible/physical gates above; it is not honest to convert the candidate to ship-ready solely from automated coverage.

### Persistent profile and ordinary restart closure

Administrator consent completed at 11:10 on 2026-11-07. The validated helper preserved the former remote profile as `C:\ProgramData\DARSHAN\config.pre-local-20261107.json` and installed the verified nested local profile as `C:\ProgramData\DARSHAN\config.json`. The destination SHA-256 is `CCE0E8303F4D5CB8E6426BCEDA190B820700C5AE921DA8A9400321131FF29B65`; the resolved endpoints are `http://localhost:18444` and `ws://localhost:18444/socket.io`.

An ordinary installed-player restart, launched without process-scoped configuration overrides, resolved the local CMS and socket endpoints successfully. The prior identity had already been invalidated by the supported deletion/re-pair journey, so the player correctly produced a new pairing request. CMS approved that request as dedicated screen `WIN-QA-20261105-LOCAL-AUTOSTART`; CMS immediately showed Online, Auth OK and Heartbeat OK.

A second ordinary installed-player restart then reused that same persisted device identity and certificate without another pairing code. Logs recorded local backend resolution, `BOOTSTRAP_AUTH`, heartbeat and snapshot-manager startup, and `PAIRED_RUNTIME`. The installed process returned as one four-process tree. Persistent profile and ordinary-restart identity reuse are therefore PASS. Reboot/login autostart observation remains the final OS lifecycle proof.

### Reboot and login-item continuation

Windows rebooted at 11:15:32 on 2026-11-07. After interactive sign-in, neither Docker Desktop nor DARSHAN Player was running and the player log had no post-boot start record. The paired runtime identity remained on disk. Other enabled Windows startup entries did launch, while DARSHAN had a correct `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` command but no corresponding enabled `StartupApproved\Run` value. The first reboot autostart observation is therefore FAIL, not pass.

Docker Desktop was started manually within the approved QA scope. All six local containers returned, but the CMS nginx container retained the API container's pre-restart internal address and returned 502 while the API itself was healthy. Restarting only `win-qa-20261105-local-cms` refreshed service discovery and restored `/api/v1/health` to 200. This is a reproducible local-Docker restart-order/recovery defect and not a player identity failure.

Launching the exact registered player command after Docker startup produced one four-process tree and retained the isolated runtime identity. The old retained identity had been revoked by the earlier deletion/re-pair journey, so after CMS recovery the player correctly left offline-safe mode, invalidated the obsolete credential and displayed a fresh pairing request. Supported localhost API confirmation created dedicated screen `WIN-QA-20261105-LOCAL-AUTOSTART-FINAL`; the player completed `PAIRING_CONFIRMED`, `PAIRING_COMPLETING`, `BOOTSTRAP_AUTH`, heartbeat/snapshot startup and `PAIRED_RUNTIME`, with validation status `VALID_NO_CONTENT`.

For the remaining authorized sign-out test, only DARSHAN's existing login item was explicitly enabled in the current-user Windows `StartupApproved\Run` registry (`02 00 00 00 00 00 00 00 00 00 00 00`). No unrelated startup or security setting was changed. The pending sign-out/sign-in observation must prove automatic process creation; backend recovery may still require Docker startup and the documented CMS refresh until that local-Docker defect is fixed.

### Sign-out autostart and recovery result

The authorized sign-out/sign-in completed. Explorer started at 11:27:21 and Windows launched the installed player automatically at 11:30:26 through the enabled current-user login item. The observed startup delay was about three minutes; the resulting process topology was one main process plus three children. Logs proved the correct persistent local endpoints and the same paired runtime identity were loaded. With Docker stopped, the player entered `OFFLINE_USING_LAST_VALID_PAIRING` and retained cached state rather than clearing credentials or requesting re-pairing.

Docker Desktop required a manual start because its separate Windows startup item is not enabled. After all six containers returned healthy, the CMS nginx container again required a restart to refresh the API container address. Once `/api/v1/health` returned 200, the already-running player automatically started heartbeat and snapshot services and reached `PAIRED_RUNTIME` without a player restart. Validation status returned to `VALID_NO_CONTENT` and heartbeat advanced. Sign-out login-item launch, offline-safe startup and online recovery are PASS. The local Docker DNS/start-order issue remains an environment/restart defect requiring follow-up; the single authorized reboot was already consumed before the startup item was explicitly enabled, so a second post-fix cold-reboot observation was not performed.

## Final readiness reconciliation — 2026-11-07 11:34 IST

- Persistent ProgramData/local selector: PASS.
- Ordinary installed-player restart and identity reuse: PASS.
- Enabled login-item launch after sign-out/sign-in: PASS, with an observed approximately three-minute Windows startup delay.
- Backend-down startup and automatic player recovery: PASS.
- Local Docker engine automatic startup: NOT CONFIGURED; Docker Desktop required manual start.
- Local Docker CMS-to-API recovery after engine restart: FAIL until the CMS container is restarted to refresh its upstream address.
- Remaining release coverage: two independent authenticated CMS sessions; visible packaged-player missing/corrupt image and video fallback; visible missing emergency-media behavior; visible group-versus-site default priority; physical audible output, cursor/Alt+Tab, display-sleep and multi-monitor checks where available; true upgrade with an older approved installer.
- Remote Ubuntu deployment and production TLS: **NOT VERIFIED**, non-blocking for this isolated local run but mandatory before production release.

Final disposition remains `WINDOWS_PLAYER_CANDIDATE_BLOCKED` for broader beta/production shipment. The candidate is usable only in the isolated local QA target with the documented Docker recovery step.
