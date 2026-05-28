# Screen Operations Runbook

## Source of truth
- Backend screen lifecycle contract: `darshan-server/docs/DEVICE_PAIRING_AND_DEVICE_RUNTIME_LIFECYCLE.md`
- Pairing and recovery API examples: `darshan-server/docs/DEVICE_PAIRING_API_FLOW_WITH_CURLS.md`
- Live playback/dashboard contract: `darshan-server/docs/SCREENS_REALTIME_PLAYBACK_GUIDE.md`

## Screen creation
- Screens are not created manually from CMS.
- A screen row is created only when a device completes pairing successfully.
- CMS action for a brand new screen: approve the pairing code already shown by the player.

## First-time pairing
1. Device/player requests a pairing code from backend.
2. Device shows the code.
3. In CMS, open `Screens` and use `Pair Device`.
4. Enter the code, choose the screen name/location, and confirm.
5. The device completes pairing and the screen becomes available in the list.

## Recovery for an existing screen
1. Open `Screens`.
2. Use the recovery action on the affected screen.
3. Review auth diagnostics and certificate state.
4. Generate a recovery code for the same `device_id`.
5. Enter the generated code on the player recovery UI.
6. Return to CMS and confirm the code.
7. The player completes recovery with a new certificate; the old one is revoked automatically.

## Health states
- `ONLINE`: recent heartbeat and valid credentials.
- `OFFLINE`: device reported offline.
- `STALE`: heartbeat is older than the freshness threshold.
- `ERROR`: backend sees an inactive/error screen state.
- `RECOVERY_REQUIRED`: auth/certificate issue or an active recovery pairing exists.

## Operator guidance
- If a screen is `STALE`, check device power/network before starting recovery.
- If a screen is `RECOVERY_REQUIRED`, use the recovery flow instead of deleting/recreating the screen.
- If the backend reports `Device not registered`, the screen identity is gone and fresh pairing is required.
- Do not use old manual "add screen" expectations; backend rejects manual screen creation.

## Live monitoring
- CMS screen list uses `/api/v1/screens/overview` for bootstrap.
- CMS listens on `/screens` websocket namespace for:
  - `screens:state:update`
  - `screens:refresh:required`
- If live detail looks stale, refetch the selected screen detail.

## Common failure meanings
- `Device credentials expired`: recover the same screen identity.
- `Device credentials revoked`: recover the same screen identity.
- `Device not registered`: start fresh pairing.
- `UNSUPPORTED_SCREEN_CODEC`: retarget the publish or use compatible media for that screen.
