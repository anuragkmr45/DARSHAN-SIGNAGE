# Windows Player Preflight Developer Verification — 2026-11-05

## Scope

Developer preflight for building and running the DARSHAN Electron player on a native Windows 10/11 x64 host while the authoritative DARSHAN services run on a separate Ubuntu/Docker host.

Source baseline: `4637e12` (`release-01`) plus the Windows packaging-guidance correction on `codex/windows-player-native-validation-20261105`.

## Code and packaging findings

- `darshan-player/package.json` provides a native Windows x64 NSIS target through `npm run package:win`.
- The export workflow intentionally rejects cross-platform Electron packaging. A Windows installer must be built on Windows; the current Linux deployment bundle contains only `.deb` and `.AppImage` player artifacts.
- The Windows site configuration is discovered at `C:\ProgramData\DARSHAN\config.json`; runtime state remains under the Electron per-user application-data root.
- Windows autostart uses Electron login-item APIs. Linux `xset`/DPMS behavior is platform-gated, while Electron's power-save blocker remains the cross-platform runtime mechanism.
- The generic Electron export previously emitted Linux-only configuration, CA, launch and autostart guidance for every target. It now emits Windows-safe ProgramData paths and Windows launch guidance, and explicitly leaves production live playback disabled.
- Webpage playback is retired. Windows QA now checks the current fail-closed behavior (`Content unavailable`, with no source or old-preview request) instead of referring to removed webview playback.
- Normal production/QA players do not advertise production live-broadcast capability. Native Windows validation must not claim live broadcasting until that separate capability gate and its release evidence are approved.

## Developer verification completed on Ubuntu

From `darshan-player`:

- `npm run build` — passed.
- `npm run test:unit` — passed, 542 tests.
- `npm run test:integration` — passed, 6 tests.
- `npm run test:fault` — passed, 22 tests.

After the export/document correction:

- `bash -n scripts/export/package-electron.sh` — passed.
- `git diff --check` — passed.
- Isolated fake Windows-host export — passed: the generated JSON parsed, used `C:\\ProgramData\\DARSHAN\\transport-ca.crt`, kept `livePlayback.enabled=false`, documented `C:\ProgramData\DARSHAN\config.json` and Windows login-item autostart, and contained no `/etc/darshan` path.
- Windows validation documents contain no remaining `webpage playback`, `webview`, or `webpage-playback` instruction — passed.

Expected error logs emitted by negative-path player tests were reviewed through their final passing suite results.

## Network and environment boundary

- The Ubuntu development machine was observed on `192.168.29.64/24`; it had no route to `192.168.128.0/24` during this preflight.
- DARSHAN Docker services were not left running by this packet.
- A Windows machine outside the Ubuntu host's LAN must use an approved VPN or routed private path. Private backend, CMS, object-storage and media endpoints must not be exposed directly to the public Internet for this test.
- The Windows player must trust the deployment transport CA and use endpoint host/IP identities covered by the deployed certificates. TLS verification must not be disabled to make the test pass.

## Native Windows evidence still required

Execute `docs/environments/player-windows-runtime-validation-checklist.md` on the target Windows host and record at minimum:

1. exact source commit and clean-tree status;
2. Node/npm/Windows versions and x64 architecture;
3. successful `npm ci`, build, tests and `npm run package:win`;
4. installer SHA-256, install, first launch and ProgramData site configuration;
5. private network/TLS reachability to the running Ubuntu deployment;
6. pairing, persisted identity, heartbeat and CMS Online state;
7. focused image/video/PDF playback, controlled retired-webpage handling, diagnostics and autostart;
8. redacted logs and every pass/fail/blocked result.

This document is developer preflight evidence, not native Windows release approval or full cross-machine regression sign-off.
