# Player Clean Reinstall And Reset Runbook

Status: GP-4 on-prem reset guidance recorded on 2026-06-16.

## Purpose

Use this runbook when a player machine must be reused, re-paired, or cleaned after stale pairing state. Normal upgrades should preserve player identity. Explicit clean reset is the supported path when the operator wants the next launch to behave like a new player install.

## Policy

- Normal upgrade preserves app data, certificates, cache, logs, and offline request queues.
- Normal uninstall must not be treated as a guaranteed clean identity wipe.
- Clean reinstall requires an explicit operator reset before or after package reinstall.
- Reset pairing clears identity-bound state only.
- Media cache is preserved unless the operator passes `--clear-cache`.
- Pending offline request/proof-of-play queue data is preserved by reset pairing.
- Do not copy player app data between machines.
- Do not clone a paired disk image for production players.
- If CMS Pairing Health reports a duplicate identity conflict, treat it as likely copied app data or a cloned paired image until proven otherwise.

## Storage Paths

The player resolves paths from code in `darshan-player/src/common/platform-paths.ts` and `darshan-player/src/common/config.ts`.

Default runtime root:

- Windows: `%APPDATA%\DARSHAN Player`
- macOS: `~/Library/Application Support/DARSHAN Player`
- Linux fallback: `~/.config/darshan-player`
- Electron packaged builds may use Electron `app.getPath("userData")`; run `darshan-player --pairing-status` or `darshan-player --doctor` to see the actual resolved path.

Supported overrides:

- `DARSHAN_RUNTIME_ROOT`
- `DARSHAN_CONFIG_PATH`
- `DARSHAN_CACHE_PATH`
- `DARSHAN_MTLS_CERT_DIR`
- `DARSHAN_MTLS_CERT_PATH`
- `DARSHAN_MTLS_KEY_PATH`
- `DARSHAN_MTLS_CA_PATH`
- legacy `HEXMON_*` equivalents

Legacy Linux import paths:

- config: `/etc/darshan/config.json`
- certs: `/var/lib/darshan/certs`
- cache: `/var/cache/darshan`

Identity-bound files:

- `config.json`: configured `deviceId` and mTLS enablement.
- `device-state.json`: pairing state, fingerprint, validation metadata, recent command ids.
- cert files: `client.crt`, `client.key`, `ca.crt`, `client.csr`, `cert-meta.json`.
- snapshot metadata: `cache/last-snapshot.json`.
- default media metadata: `cache/default-media.json`.

Preserved by default:

- downloaded media cache: `cache/media`, `cache/objects`, `cache/quarantine`.
- request queue: `cache/request-queue.json`, `cache/request-queue.state.json`.
- proof-of-play spool: `cache/pop-spool`.
- logs: `cache/logs`.
- screenshots: `cache/screenshots`.

`--clear-cache` additionally clears media cache targets only: `media`, `objects`, `quarantine`, and `cache-index.db`. It still preserves request queues, proof-of-play spool, logs, and screenshots.

## Commands

Packaged Linux player:

```bash
darshan-player --pairing-status
darshan-player reset-pairing --dry-run
darshan-player reset-pairing --reason=clean_reinstall
darshan-player reset-pairing --reason=clean_reinstall --clear-cache
```

Source/development checkout:

```bash
cd darshan-player
npm run pairing-status
npm run reset-pairing -- --dry-run
npm run reset-pairing -- --reason=clean_reinstall
npm run reset-pairing -- --reason=clean_reinstall --clear-cache
```

Systemd service flow:

```bash
sudo systemctl stop darshan-player
darshan-player reset-pairing --dry-run
darshan-player reset-pairing --reason=clean_reinstall
sudo systemctl start darshan-player
sudo journalctl -u darshan-player -f
```

If the player binary must run as the service user, run the command under that same user and environment so it resolves the same runtime root:

```bash
sudo -u darshan -H darshan-player --pairing-status
sudo -u darshan -H darshan-player reset-pairing --dry-run
sudo -u darshan -H darshan-player reset-pairing --reason=clean_reinstall
```

## Clean Reinstall Procedure

1. In CMS, open Screens and Pairing Health.
2. Confirm the backend environment, deployment id, and server id.
3. If the old device/screen is stale or orphaned, revoke pairing in CMS.
4. Stop the player service.
5. Run `darshan-player --pairing-status`.
6. Run `darshan-player reset-pairing --dry-run` and review the target list.
7. Run `darshan-player reset-pairing --reason=clean_reinstall`.
8. Use `--clear-cache` only when media cache must also be discarded.
9. Reinstall or upgrade the package if needed.
10. Start the player.
11. Pair as a new screen.
12. Verify CMS Screens shows the new screen.
13. Assign content or default media.
14. Confirm the player does not show stale paired/no-content state.

## Duplicate Identity Conflict Procedure

Use this when CMS Pairing Health shows duplicate identity conflicts for a screen/device.

1. Confirm the backend environment, deployment id, and server id.
2. Review the affected screen/device and active session count.
3. Compare the session last-seen times and player versions with the expected physical players.
4. Do not use Reclaim. It is intentionally disabled until a future fresh-pairing reclaim flow exists.
5. On the stale or reused machine, stop the player service.
6. Run `darshan-player --pairing-status` and verify the install/runtime session suffixes match the CMS diagnostic evidence where possible.
7. In CMS, revoke the stale pairing if the device identity is copied or no longer trusted.
8. Run `darshan-player reset-pairing --reason=duplicate_identity_conflict`.
9. Start the player and pair as a new screen.
10. Verify Pairing Health no longer reports multiple active sessions after the session lease expires.

GP-5 detection is lease-based. Non-concurrent clones may not appear until both copies connect during the active lease window.

## Uninstall And Upgrade Policy

Upgrades:

- preserve identity and cache.
- must not force re-pairing.
- should be performed before runtime validation smoke.

Normal uninstall:

- may leave Electron app data and legacy Linux directories behind.
- should be assumed to preserve identity unless a clean reset is run.
- package hooks must not be relied on as the production reset mechanism.

Clean uninstall:

- use CMS revoke plus local `reset-pairing`.
- remove package only after identity has been reset if the machine is being reused.
- do not manually delete `/var/cache/darshan` if proof-of-play or request queue data must still be recovered.

## Data Loss Warnings

- `reset-pairing` does not delete proof-of-play/request queues.
- `reset-pairing --clear-cache` removes cached media only.
- Do not delete the runtime root, `/var/cache/darshan`, or `/var/lib/darshan` manually unless support has confirmed no pending queue data is needed.
- Do not share support bundles publicly; they contain operational metadata even though certificate contents are redacted.
- Pairing Health duplicate identity evidence is redacted to suffixes/hashes. Do not attempt to reconstruct or exchange raw hardware identifiers between sites.

## Rollback

If reset was accidental:

1. Do not pair the device to a different screen.
2. Restore the runtime root or legacy Linux directories from backup.
3. Restart the player and confirm pairing status.
4. If no backup exists, pair as a new screen and reassign content.

## Verification

After reset and re-pairing:

- `darshan-player --pairing-status` shows local identity present and a recent backend validation after the player validates.
- CMS Screens shows the new screen.
- Pairing Health shows no orphan rows for the old identity.
- Player heartbeat/snapshot/default-media calls succeed.
