# Player Secure Offline Playback Lock

## Summary

This implementation adds an optional theft-resistant playback lock for DARSHAN Player. It does not change backend APIs, CMS APIs, database schema, pairing protocol, or realtime architecture.

Default behavior remains unchanged:

- `player.security.offlinePlaybackPolicy: "standard"`
- `player.security.backendRequiredForPlayback: false`
- cached/offline playback can continue under the existing pairing validation grace rules.

When enabled, the player requires recent backend validation before visible scheduled/default playback can continue.

## Scope Implemented

- Pure secure-offline playback policy helper.
- Main-process secure playback guard with backend success/failure lease tracking.
- Heartbeat integration:
  - successful heartbeat renews the playback lease;
  - transient/auth heartbeat failure starts or continues the security grace timer.
- Pairing-status bootstrap success renews the playback lease.
- PlayerFlow gates playlist playback while locked.
- PlaybackEngine also refuses timeline restart while locked.
- Renderer hides schedule/default content and shows a full-screen backend-validation warning while locked.
- Recovery/OTP states are not covered by the security lock overlay.
- Optional media-cache purge after a long-offline timeout:
  - deletes `media`, `objects`, `quarantine`, and legacy `cache-index.db`;
  - preserves logs, screenshots, proof-of-play spool, and request queues.
- Player config file and env override support for non-secret security settings.

## Config Keys

Supported under `player.security`:

- `offlinePlaybackPolicy`: `standard`, `secure`, or `high_security`
- `backendRequiredForPlayback`: boolean
- `networkSwitchGraceMs`: number
- `playbackLeaseMs`: number
- `lockAfterOfflineMs`: number
- `purgeCacheAfterOfflineMs`: number, `0` disables purge
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

1. Player validates pairing with backend before normal paired runtime.
2. Backend pairing-status success or heartbeat success renews the secure playback lease.
3. If backend/network contact is lost, the player remains inside the configured grace window.
4. After grace expires, scheduled/default playback is stopped and the renderer displays a backend-validation warning.
5. Heartbeat/retry paths continue.
6. Backend success unlocks playback and the player returns to the current valid schedule/default media.
7. Optional cache purge only runs after the configured purge timeout and does not delete PoP/request queue data.

## Tests Run

- `cd darshan-player && npm run build`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/common/player-content-source.test.ts --spec test/unit/common/offline-security-policy.test.ts --spec test/unit/common/file-config.test.ts --spec test/unit/services/secure-playback-guard.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/player-flow.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/main/operator-tools.test.ts --spec test/unit/main/cli.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/heartbeat.test.ts`
- `cd darshan-player && npx mocha --config .mocharc.json --spec test/unit/services/playback-engine.test.ts`

All listed local targeted checks passed.

Known unrelated blocked path:

- `test/unit/renderer/player-layout.test.ts` still hits the existing `webpage-playback.ts` CommonJS/ESM module-loader failure when importing `src/renderer/player.ts` through ts-node. The secure-lock content-source decision is covered by `test/unit/common/player-content-source.test.ts`.

## Real-Device Verification Required

Local tests prove policy, config, guard, flow, heartbeat, and build behavior. They do not prove production on-device behavior.

Real-device verification must still be run on the existing AVITA LAP/RPi/AXON target:

1. Install the updated player package.
2. Set `player.security.offlinePlaybackPolicy` to `secure`.
3. Pair and validate normally.
4. Start scheduled/default media.
5. Disconnect the player from the approved backend network.
6. Verify playback continues only inside configured grace.
7. Verify playback stops and the security warning appears after grace expires.
8. Reconnect to the approved backend network.
9. Verify heartbeat succeeds and playback resumes.
10. If testing purge, use a separate test device and verify only media cache targets are removed.

## Recommendation

Proceed to packaged real-device QA before enabling secure or high-security mode on production players. Keep `purgeCacheAfterOfflineMs: 0` until recovery and operator procedures are verified.
