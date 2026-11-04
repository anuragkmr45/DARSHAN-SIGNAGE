# Product UI exact release-candidate smoke — 2026-11-04

Branch: `codex/darshan-product-ui-redesign-20261103`

Frozen code commit: `add5b0ed1ddd2a15f10e269bd5745f2f0e2b01fe`

This is isolated developer evidence. It is not independent QA, native package installation, physical-display acceptance or a production Go decision.

## Exact candidate boundary

- CMS artifact: `.local/product-ui/release-candidate-add5b0e/darshan-cms-add5b0e.tar.gz`, SHA-256 `45031ad4004a2ad0cbd6affab65360514b2cd59771c003e86b996771e59cba03`.
- Ubuntu player artifact: `.local/product-ui/release-candidate-add5b0e/darshan-player_1.0.0_add5b0e_amd64.deb`, SHA-256 `d653158a15cea44238569d357296a2506675ce57981e965d4a07b40f7eec86e2`.
- Player `app.asar`: SHA-256 `7f8a22356d0161bc2f66e221631c176819b675e6446e6eda122fe6f8e08f4781`; contains the built renderer and `standby-artwork.svg`.
- CMS file tree: SHA-256 `05d8c39e3827434e44b02dd3026689e0f65c9f6a789261f2d3494824d21d3184` in both the build output and read-only container mount.

## Real read-only journey

1. The exact CMS tree was activated in the existing isolated stack at `https://localhost:18443`; Login and backend Health returned `200`.
2. The existing isolated QA administrator restored a browser session and opened Schedule Queue.
3. The pending **Product UI real schedule QA 2026-11-04** request was opened read-only. Its Media tab showed one IMAGE; Preview fetched the authorized Media detail and rendered the named image in the preview dialog.
4. The Screens page showed **Live QA Player Recovery** as **Online / Standby**, with no active or upcoming Schedule and a fresh heartbeat.
5. The real Observability tab showed backend-heartbeat measurements for CPU, memory, disk, queue, display count, hostname, player version, operating system, network address, uptime and power. Direct scrape and Grafana were truthfully unavailable in this isolated stack.
6. The exact candidate player process owned `127.0.0.1:18331`; `/healthz` returned `healthy`, bounded queues/spools were empty, and heartbeat metrics included successful requests.

No approval, publication, cancellation, take-down, emergency, pairing, revocation, edit or other persistent CMS action was performed. The pending local QA Schedule remains unchanged.

## Observed limits

- Pairing diagnostics retained a duplicate-identity warning while the previous and exact candidate runtime observations overlapped. The warning was visible and no revocation was performed; this is isolated-environment cleanup/QA, not proof of a code defect.
- The player ran from the exact Electron Builder unpacked tree corresponding to the DEB. The DEB itself was not installed, so post-install desktop/autostart behavior remains open.
- Native pixels/audio, Windows, physical display, cross-VM networking/TLS, direct player scrape inventory, Grafana, capacity, restore, soak and independent human QA remain open in the release checklist.
