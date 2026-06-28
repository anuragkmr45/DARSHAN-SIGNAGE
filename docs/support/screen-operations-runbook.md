# Screen Operations Runbook

Last code-truth refresh: 2026-06-28.

## Source Of Truth

| Area | Current source |
|---|---|
| Backend screen APIs | `darshan-server/src/routes/screens.ts`, `darshan-server/src/routes/screen-groups.ts` |
| Pairing/recovery APIs | `darshan-server/src/routes/device-pairing.ts` |
| Player pairing runtime | `darshan-player/src/main/services/pairing-service.ts`, `darshan-player/src/main/services/player-flow.ts` |
| Heartbeat/screenshots/PoP | `darshan-server/src/routes/device-telemetry.ts`, player telemetry/screenshot/PoP services |
| CMS screen UI | `darshan-cms/src/pages/Screens.tsx`, `darshan-cms/src/components/screens/*` |
| Contract docs | `docs/architecture/player-pairing-identity.md`, `docs/contracts/player-runtime-contracts.md` |

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
- CMS listens on screen realtime hooks/libs for:
  - `screens:state:update`
  - `screens:refresh:required`
- If live detail looks stale, refetch the selected screen detail.

## Common failure meanings
- `Device credentials expired`: recover the same screen identity.
- `Device credentials revoked`: recover the same screen identity.
- `Device not registered`: start fresh pairing.
- `UNSUPPORTED_SCREEN_CODEC`: retarget the publish or use compatible media for that screen.

## Default Media Or Schedule Not Applying

1. Confirm the screen is paired and backend pairing status is valid.
2. Confirm the player heartbeat is recent enough for CMS to show online.
3. Check whether the backend desired-state/command path was updated after the CMS action.
4. Confirm Socket.IO `/device` is reachable if realtime wake-up is expected.
5. Confirm polling fallback eventually fetches snapshot/default media.
6. If only polling works, triage backend/outbox/Valkey before changing player playback code.

Relevant code:

- default media settings: `darshan-server/src/routes/settings.ts`, `darshan-server/src/utils/default-media.ts`
- playback refresh: `darshan-server/src/services/playback-refresh-dispatch.ts`
- player fetch: `darshan-player/src/main/services/settings/default-media-service.ts`
- realtime: `darshan-server/src/realtime/*`, `darshan-player/src/main/services/realtime-service.ts`

## Screenshot Capture Failure

1. Confirm screen is online and paired.
2. Confirm CMS action reaches backend screen/device endpoint.
3. Check player screenshot service and queued upload behavior.
4. Confirm target OS/display stack supports Electron capture.
5. Treat target-device screenshot behavior as `needs runtime verification` until tested on that device.

Relevant code:

- backend telemetry screenshot path: `darshan-server/src/routes/device-telemetry.ts`
- player screenshot service: `darshan-player/src/main/services/screenshot-service.ts`
- CMS screen UI: `darshan-cms/src/components/screens/ScreenDetailsModal.tsx`

## No-Secret Rule

Before sharing screen support evidence, review screenshots, logs, doctor output, browser network payloads, and support bundles for secrets or credentialed URLs. Use `docs/support/runtime-evidence-and-no-secret-review.md`.
