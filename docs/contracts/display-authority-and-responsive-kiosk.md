# Display Authority and Responsive Kiosk Contract

Last code-truth audit: 2026-09-04.

This contract defines how DARSHAN selects an Electron display, records what the player actually observed, and keeps pairing/recovery/playback surfaces usable on arbitrary output sizes. Code is authoritative; real display-driver and window-manager behavior still needs target-device evidence.

## Ownership and data flow

```text
Electron Screen API
        │ main process only
        ▼
DisplayManager ──► BrowserWindow placement ──► renderer viewport report
        │                    │                         │
        └──── DisplayProfileV1 heartbeat/pairing ───────┘
                                      │
                                      ▼
screen_display_states (authoritative observed + desired state)
                                      │
                       CMS screen detail / schedule preflight
```

- `darshan-player/src/main/services/display-manager.ts` is the only player service that accesses Electron's `screen` API. It owns the in-memory `DisplayProfileV1`, display event debounce, target selection, fallback, window reconciliation, and placement verification.
- The main process supplies the pairing payload and heartbeat profile. The renderer only reports its measured viewport/density through the preload IPC bridge; it does not select a display or read `window.screen`.
- `darshan-server/src/services/screen-display-state-service.ts` is the server owner of desired selection, observed profile ordering, profile revisions, and legacy `screens` geometry projection.
- The CMS reads state from `GET /api/v1/screens/:id/display-state` and writes an operator selection to `PUT /api/v1/screens/:id/display-selection`.

## Profile, identity, and ordering

`DisplayProfileV1` includes a runtime session ID, monotonic observation sequence, desired/active selection, fallback reason, placement state, active output, inventory, output geometry, aspect metadata, and renderer viewport conformance.

- Output keys are opaque. Platform IDs are preferred; a hardware-signature key is used only when unique; duplicate signatures are explicitly session-scoped and cannot be safely pinned.
- `estimated_backing_px` is derived from DIP bounds and scale factor. `native_mode_px` remains null unless a platform adapter can provide a genuine native mode.
- Orientation is derived from current width/height, never guessed from rotation metadata alone. Rotation is reported separately.
- Aspect ratios are reduced exactly when integer dimensions permit (`2400×1000` is `12:5`). Compatibility is symmetric and requires at least `0.995`; usable area is `min(layout/display, display/layout)`.
- The server rejects same-session observations whose sequence is not newer. A changed runtime session starts a new ordering domain, but does not increment `profile_revision` when the content hash is unchanged. Selection writes include the observed revision, preventing a stale inventory from pinning the wrong output.

## Selection and fallback

- `PRIMARY` is the default desired selection. `PINNED` requires a current inventory key and expected profile revision.
- A `SET_ACTIVE_DISPLAY` command is created idempotently for each accepted selection version. Desired state is also returned from the player desired-state endpoint, so missed realtime notification is recoverable by polling.
- A missing target, ambiguous session identity, or native Wayland placement uses the primary output and reports `TARGET_MISSING`, `AMBIGUOUS_IDENTITY`, or `WAYLAND_UNVERIFIED` respectively. Wayland is intentionally primary-only/unverified until a reliable output-binding adapter exists.
- A player stores selection separately from pairing identity. Re-pairing cannot silently change the selected display.

## Window and kiosk surface behavior

- QA and production use full display bounds with kiosk/fullscreen policy; development uses the target work area and remains interactive.
- Display add/remove/metrics changes are debounced for 500 ms. Reconciliation is serialized latest-wins so an earlier resize cannot overwrite a newer display selection.
- After placement, the player verifies the window with Electron `getDisplayMatching`; native Wayland remains unverified by design.
- The main window waits for the renderer's first viewport measurement before showing. A five-second safe fallback avoids an indefinitely black display if an old or failed renderer cannot acknowledge layout.
- Pairing/recovery uses a clipped, no-scroll root. The renderer chooses FULL, COMPACT, or MINIMAL density, makes a second measurement after switching to MINIMAL, and reports `conformant: false` only if the final surface still overflows. Operator controls are hidden in QA/production and omitted from MINIMAL status.
- Scene roots use `ResizeObserver` reflow without remounting active media. PDF playback reuses its document, cancels obsolete work, commits a back-buffered frame, and reserves bounded process-wide raster pixels. Web pages require two healthy size/overflow samples before replacing fallback and return to fallback after two stable overflow samples.

## Server and CMS API behavior

| Endpoint | Contract |
|---|---|
| `GET /screens/:id/display-state` | Desired selection, selection/profile revisions, observed profile, placement, and active output. |
| `PUT /screens/:id/display-selection` | `PRIMARY`, or `PINNED` with display key and expected revision. Queues an idempotent `SET_ACTIVE_DISPLAY` command. |
| `GET /device/:id/desired-state` | Player recovery path for desired selection/version plus normal desired state. |
| heartbeat / pairing request | Accept optional `display_profile_v1`; pairing completion and heartbeat persist it. |
| `POST /schedules/display-preflight` | Returns target IDs, aspect mismatch issues, usable area fraction, source profile revision, and issue hash. |
| schedule or request publish | Returns `409 DISPLAY_ASPECT_MISMATCH` until the caller submits the exact current issue hash with an explicit acknowledgment. |

The CMS screen detail shows desired versus active output, placement, geometry, viewport state, and observed inventory. Schedule request publishing runs preflight first; an operator can review predicted unused area and explicitly approve letterboxing. The request's “Approve & publish” path uses that same preflight rather than bypassing it.

## Persistence, migration, and rollback

- `darshan-server/drizzle/migrations/0034_display_authority.sql` adds `screen_display_states` and `SET_ACTIVE_DISPLAY`. Existing screens are seeded as `LEGACY_UNVERIFIED`; a player V1 observation replaces that state.
- `screens.width`, `height`, `aspect_ratio`, and `orientation` are dual-written from full active output DIP bounds for legacy readers.
- Delete-screen cleanup removes display state in the same transaction, preventing orphaned authority records.
- Rollback of the application is safe for legacy readers because geometry remains on `screens`; rolling back the migration itself requires first confirming that no deployed code reads `screen_display_states` or the new command enum value.

## Verification boundary

Code and automated checks cover ratio normalization, stale observation handling, profile revision stability through player restart, pinned selection validation, player config precedence, renderer helpers, server route boot, CMS build/unit tests, and player unit/integration/performance/fault suites.

Before production release, collect device evidence on every supported OS/window-manager combination: primary/pinned selection with hot-plug, 16:9/9:16/24:10/4:10 and HiDPI surfaces, Wayland fallback, first-visible-frame timing, PDF raster memory under multi-slot playback, web-page reflow, and physical input lockout. Those results are runtime evidence, not implied by this contract.
