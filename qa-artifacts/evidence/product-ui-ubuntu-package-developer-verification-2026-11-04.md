# Ubuntu player candidate package: developer verification

Branch `codex/darshan-product-ui-redesign-20261103`, source commit `817e850`. This is an isolated local QA candidate, not a production release or physical-display acceptance.

## Package identity

- `npm run build` passed for the current player source. The earlier Nov 2 DEB was left untouched.
- Electron Builder first produced the current `linux-unpacked` tree, but its DEB packaging process did not finish before the host rebooted. No DEB was published by that attempt. The cause of the reboot was not established.
- With the Docker test stack stopped, Electron Builder packaged the already built tree into `.local/product-ui/player-20261104-package/darshan-player_1.0.0_amd64.deb`. `dpkg-deb` identifies an amd64 `darshan-player` 1.0.0 package with the expected desktop entry, binary, icon, and `app.asar`.
- DEB SHA-256: `1377fc07514109fc978f78fc153b76c712e5ecffa7e0cacbcb930866153d7edd` (142,248,984 bytes). The extracted DEB `app.asar` SHA-256 and the tested unpacked `app.asar` are both `7f8a22356d0161bc2f66e221631c176819b675e6446e6eda122fe6f8e08f4781`.
- The generated DEB `postinst` and `postrm` scripts passed `bash -n`. Their actual effects, including the installed desktop entry and Chromium sandbox permissions, were not executed on this host.
- The original tracked player source was restored after a temporary diagnostic edit; the branch has no player source changes from this packaging check. The packaged tree corresponds to that source. The package was not installed, so DEB post-install desktop/autostart behavior remains unverified.

## Running-system observation

The isolated API, worker, PostgreSQL, MinIO, Valkey, CMS and TLS containers were restarted after the host reboot. API readiness returned `ready=true` for bootstrap, database, migrations, MinIO, Valkey and worker. The packaged Ubuntu binary was launched from its unpacked tree with the existing private QA runtime profile. A host-wide `DARSHAN_PLAYER_CONFIG_FILE` setting initially conflicted with that isolated profile; the player correctly rejected it. Removing that ambient variable **only in the test process** allowed startup without changing the machine's setting or stored identity.

The process reached `PAIRED_RUNTIME`, loaded its renderer, passed the viewport gate, started telemetry, and opened its loopback health server. The health endpoint reported `healthy`. Its metrics recorded successful heartbeat requests; the isolated database contained one Screen and one heartbeat within the previous two minutes (18 seconds old at inspection). The package's own profile reported no active scheduled item or default media; logs show an empty fallback mode. The visible standby artwork was not inspected through a native UI surface, and a server heartbeat cannot prove pixels or audio on the display.

## Remaining verification

- Install the exact DEB on a disposable Ubuntu player and verify desktop entry, autostart, kiosk input and power behavior, pairing/recovery/lock, standby artwork, actual media and live frames, physical display/audio, and clean uninstall/rollback.
- Repeat the supported Windows package and physical-display checks. The current QA runtime did not exercise a new Screen pairing or emergency takeover.
- Keep this candidate separate from release artifacts until the full CMS/player regression and human release gates pass.
