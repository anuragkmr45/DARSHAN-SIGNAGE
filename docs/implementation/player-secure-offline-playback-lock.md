# Player Secure Offline Playback Lock

## Summary

This implementation adds a theft-resistant playback lock for DARSHAN Player. It does not change backend APIs, CMS APIs, database schema, pairing protocol, or realtime architecture. Code-level defaults remain compatible with development and legacy configurations, while generated production player bundles and the checked production examples enable secure mode with a 120-second playback lease.

In secure production mode, visible schedule, default and emergency playback requires an authenticated backend success within the preceding 120 seconds. Compatibility grace settings remain parseable but cannot extend that deadline.

## Scope Implemented

- Pure secure-offline playback policy helper.
- Main-process secure playback guard with one deadline anchored to the last authenticated backend success.
- Heartbeat integration:
  - while unlocked, a successful heartbeat renews the playback lease;
  - while locked, a successful heartbeat records reachability and starts recovery but cannot unlock playback.
- Pairing-status bootstrap success renews the playback lease.
- PlayerFlow gates playlist playback while locked.
- PlaybackEngine also refuses timeline restart while locked.
- Renderer hides schedule/default content and shows a full-screen backend-validation warning while locked.
- Recovery/OTP states are not covered by the security lock overlay.
- Media-cache purge at the secure lock deadline:
  - deletes `media`, `objects`, `quarantine`, and legacy `cache-index.db`;
  - preserves identity, certificates, logs, screenshots, proof-of-play spool, and request queues.
- Single-flight recovery with explicit phases: `LOCKED`, `REVALIDATING_IDENTITY`, `FETCHING_CURRENT_SNAPSHOT`, `SYNCING_CONTENT`, `APPLYING_AUTHORITY`, and `READY`.
- Recovery validates stored identity, force-fetches current authority, attempts current-media prefetch/checksum verification and only then unlocks playback.
- Player config file and env override support for non-secret security settings.

## Config Keys

Supported under `player.security`:

- `offlinePlaybackPolicy`: `standard`, `secure`, or `high_security`
- `backendRequiredForPlayback`: boolean
- `networkSwitchGraceMs`: number
- `playbackLeaseMs`: number
- `lockAfterOfflineMs`: number
- `purgeCacheAfterOfflineMs`: retained for configuration compatibility; it cannot delay secure-mode purge beyond the playback lease deadline
- `showSecurityLockScreen`: boolean

Env overrides:

- `DARSHAN_SECURITY_OFFLINE_PLAYBACK_POLICY`
- `SIGNHEX_SECURITY_OFFLINE_PLAYBACK_POLICY`
- `DARSHAN_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK`
- `SIGNHEX_SECURITY_BACKEND_REQUIRED_FOR_PLAYBACK`
- `DARSHAN_SECURITY_NETWORK_SWITCH_GRACE_MS`
- `SIGNHEX_SECURITY_NETWORK_SWITCH_GRACE_MS`
- `DARSHAN_SECURITY_PLAYBACK_LEASE_MS`
- `SIGNHEX_SECURITY_PLAYBACK_LEASE_MS`
- `DARSHAN_SECURITY_LOCK_AFTER_OFFLINE_MS`
- `SIGNHEX_SECURITY_LOCK_AFTER_OFFLINE_MS`
- `DARSHAN_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS`
- `SIGNHEX_SECURITY_PURGE_CACHE_AFTER_OFFLINE_MS`
- `DARSHAN_SECURITY_SHOW_LOCK_SCREEN`
- `SIGNHEX_SECURITY_SHOW_LOCK_SCREEN`

## Runtime Behavior

1. Player validates pairing with the backend before normal paired runtime.
2. While unlocked, pairing-status or heartbeat success sets the lease deadline to `authenticated success time + playbackLeaseMs` (120,000 ms in production examples).
3. Failure-detection time, `networkSwitchGraceMs`, `lockAfterOfflineMs`, and `purgeCacheAfterOfflineMs` cannot extend that secure deadline.
4. At the deadline, schedule/default/emergency playback stops, the security-lock surface appears and media-cache targets are removed. Identity, certificates and evidence queues are preserved.
5. Heartbeats and bounded recovery retries continue. A locked heartbeat reports reachability only.
6. One recovery flow revalidates identity, rejects revoked/deleted/mismatched identity, force-fetches the current snapshot, attempts current-content synchronization and applies fresh authority.
7. Playback unlocks only after fresh authority is applied. Cached playback is never restored first.
8. Snapshot failure keeps the player locked with bounded retry. Invalid identity enters the existing hard-recovery/pairing flow. Media failure under valid fresh authority leaves the security lock and displays the normal `Unavailable` state rather than replaying stale content.

## Tests Run

- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/player-content-source.test.ts --spec test/unit/common/offline-security-policy.test.ts --spec test/unit/common/file-config.test.ts --spec test/unit/services/secure-playback-guard.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts --spec test/unit/main/cli.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/playback-engine.test.ts`

The current focused policy, guard, heartbeat and PlayerFlow checks pass. See the dated developer-verification report in `qa-artifacts/evidence/` for the exact current-worktree results and remaining runtime gates.

## Real-Device Verification Required

Local tests prove policy, config, guard, flow, heartbeat, and build behavior. They do not prove production on-device behavior.

Real-device verification must still be run on the existing AVITA LAP/RPi/AXON target:

1. Install the updated player package.
2. Set `player.security.offlinePlaybackPolicy` to `secure`.
3. Pair and validate normally.
4. Start scheduled/default media.
5. Disconnect the player from the approved backend network.
6. Verify playback is still present at 119 seconds after the last authenticated success.
7. Verify all playback stops and the security warning appears at 120 seconds, within the approved one-second observation tolerance.
8. Reconnect to the approved backend network.
9. Verify heartbeat reachability alone does not resume cached content; identity revalidation and a fresh snapshot/content sync occur first.
10. Verify the current server-side authority resumes, not the stale pre-lock authority.
11. Verify media cache was removed while identity, certificates, PoP and request queues remain.

## Recommendation

Proceed to packaged real-device QA before production rollout. Update and reconnect every target player, then validate the exact 120-second boundary, targeted purge and ordered recovery on representative Windows and Ubuntu hardware.
