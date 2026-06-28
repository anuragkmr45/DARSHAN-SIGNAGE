# On-Prem Player Ghost Pairing Recovery

Last code-truth refresh: 2026-06-28.

Historical note: this runbook originated from GP-4 on-prem recovery guidance recorded on 2026-06-16.

## Source References

| Area | Source |
|---|---|
| Backend pairing/recovery | `darshan-server/src/routes/device-pairing.ts` |
| Backend telemetry/pairing status | `darshan-server/src/routes/device-telemetry.ts` |
| CMS Screens/Pairing Health | `darshan-cms/src/pages/Screens.tsx`, `darshan-cms/src/components/screens/*` |
| Player pairing flow | `darshan-player/src/main/services/pairing-service.ts`, `darshan-player/src/main/services/player-flow.ts` |
| Player reset/operator tools | `darshan-player/src/main/services/operator-tools.ts`, `darshan-player/src/main/cli.ts` |

## When To Use

Use this runbook when:

- A reinstalled player says it is paired but CMS does not show the screen.
- CMS Pairing Health shows orphan certificates, pairings, heartbeats, or commands.
- A player was revoked in CMS and must be paired again.
- Backend data was restored or manually cleaned up.
- The player is pointed at the wrong environment.
- A cloned or copied player image is suspected.
- CMS Pairing Health reports duplicate active runtime sessions for one device id.

## Decision Tree

1. Open CMS Screens.
2. Confirm whether the screen is visible.
3. Open Pairing Health on the Screens page.
4. Check backend environment, deployment id, and server id.
5. Compare that environment with the expected player/backend environment.
6. If Pairing Health shows an orphan/stale device or duplicate identity conflict, revoke pairing in CMS when the identity is no longer trusted.
7. On the player machine, stop the player service.
8. Run pairing status.
9. Run reset dry-run.
10. Run reset pairing.
11. Restart the player.
12. Pair as a new screen.
13. Verify CMS shows the screen and Pairing Health is clean.
14. Assign content/default media and verify playback.

## Commands

If the installed player uses a site config file, export it first:

```bash
export DARSHAN_PLAYER_CONFIG_FILE=/etc/darshan/player/config.json
```

Inspect local identity:

```bash
darshan-player --pairing-status
```

Dry-run reset:

```bash
darshan-player reset-pairing --dry-run
```

Reset after CMS revoke:

```bash
darshan-player reset-pairing --reason=admin_revoked_stale_pairing
```

Reset and clear downloaded media cache:

```bash
darshan-player reset-pairing --reason=clean_reinstall --clear-cache
```

Service flow:

```bash
sudo systemctl stop darshan-player
darshan-player --pairing-status
darshan-player reset-pairing --dry-run
darshan-player reset-pairing --reason=ghost_pairing_recovery
sudo systemctl start darshan-player
```

If using the source tree for engineering-only checks:

```bash
cd darshan-player
npm run pairing-status
npm run reset-pairing -- --dry-run
npm run reset-pairing -- --reason=ghost_pairing_recovery
```

## CMS Coordination

If the stale player has a visible screen:

1. Open the screen card.
2. Click Revoke pairing.
3. Confirm that this does not delete the screen.
4. Run local reset on the player.
5. Pair again.

If Pairing Health shows an orphan row:

1. Review the orphan type and timestamp.
2. Confirm the backend identity labels are expected.
3. Revoke from the orphan row if available.
4. Run local reset on the player if the machine is accessible.
5. Pair again.

If Pairing Health shows a duplicate identity conflict:

1. Review the affected screen/device, active session count, first seen, last seen, and redacted install/runtime suffixes.
2. Verify whether more than one physical player is running with the same device id.
3. Stop the stale/reused player.
4. Revoke pairing in CMS if the device identity was copied or cloned.
5. Run local reset on the stale/reused player.
6. Pair it as a new screen.

Do not use disabled Reclaim controls to attach copied app data to an existing screen. Safe reclaim requires a future fresh-pairing workflow.

## Expected Outcomes

After CMS revoke:

- the backend marks active credentials revoked or invalid.
- the player receives `PAIRING_REVOKED` or equivalent invalid pairing status on next validation.
- the player should return to pairing required/recovery state.
- the screen is not deleted by revoke.

After local reset:

- local device id is cleared.
- local certificate/key/CA artifacts are deleted.
- snapshot/default-media identity metadata is deleted.
- media cache remains unless `--clear-cache` is used.
- request queue/proof-of-play data remains.

## Environment Mismatch Checks

Use CMS Pairing Health and player pairing status to compare:

- environment
- deployment id
- server id
- backend URL from the CONFIG-2 player site config or existing runtime config

If the player and CMS point to different backends, do not reset first. Correct the player backend configuration, restart, and validate status. Reset only if the identity remains stale after the environment is corrected.

`reset-pairing` clears identity-bound local state, not the non-secret player site config selected by `DARSHAN_PLAYER_CONFIG_FILE` or `SIGNHEX_PLAYER_CONFIG_FILE`.

## DB Restore Or Manual Cleanup

If backend data was restored:

1. Deploy backend pairing-status first.
2. Open Pairing Health.
3. Locate orphan credentials or stale device rows.
4. Revoke if the device should not retain identity.
5. Reset the local player.
6. Pair as a new screen.

Do not manually recreate screen/device rows to match a copied local identity. Safe reclaim is deferred to GP-5.

## Warnings

- Do not wipe app data during normal upgrades.
- Do not clear proof-of-play/request queues unless support explicitly approves.
- Do not copy app data from one player to another.
- Do not clone a paired image.
- Do not use hardware fingerprint alone as identity authority.
- Duplicate detection is warning-mode and lease-based. It may not catch a non-concurrent clone until both copies connect during the active lease window.

## Escalation

Escalate to engineering if:

- Pairing Health still shows orphan rows after revoke and reset.
- The player clears identity but cannot request a new pairing code.
- The player reports `ENVIRONMENT_MISMATCH` after configuration was corrected.
- Multiple machines appear to share the same device id.
- Duplicate identity conflicts remain open after stale players are stopped and the session lease has expired.
- Pending proof-of-play/request queue data must be recovered before reset.
