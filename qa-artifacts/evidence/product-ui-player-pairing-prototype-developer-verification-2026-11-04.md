# Player pairing and recovery prototype: developer verification

Status: prototype evidence only. This is not human QA acceptance or a release gate.

## User task and hierarchy

- Task: connect a screen from the CMS and recognize the physical machine by its OS hostname.
- Primary information: where to enter the code, hostname, pairing code, expiry, and current approval state.
- Secondary information: device ID, display resolution, model, and network diagnostics on roomier layouts.
- Safety: production hides local operator controls; backend and player main process retain authority for code expiry, identity, recovery, and security lock. Playback content is not restyled.

## Developer observations

- Built renderer CSS is copied into `dist/renderer` as part of the ordinary player build.
- The existing pairing browser regression passes with the new design. It verifies a replacement OTP wins over an older presentation revision, the code and hostname remain visible, and the countdown is unaffected by a one-hour wall-clock skew.
- The browser regression now checks essential fields at 1440×900, 820×768, 390×844, and 640×360 CSS pixels, and verifies full-window recovery with production controls hidden.
- Rendered prototype captures in this folder's `product-ui-player-prototype/` subdirectory show mocked pairing and recovery states. They establish visual layout only; their diagnostic and device fields are not live service evidence.
- Player production build passed.
- Player unit suite passed: 542/542. The first run exposed a false positive in the log redaction test: its broad `abc` search could match the randomly generated bundle ID. The assertion now checks the sanitized log body, and the complete rerun passed.
- Final player build and focused pairing browser regression passed after the short-screen adjustment.

## Still required

- Packaged Ubuntu player with actual backend pairing and recovery, including no-input operation and long hostname/error text.
- Physical landscape, portrait, high-DPI display and Windows checks.
- Security-lock transition and offline playback checks against real services.
- Visual approval checkpoint before rolling the design across all player surfaces.
