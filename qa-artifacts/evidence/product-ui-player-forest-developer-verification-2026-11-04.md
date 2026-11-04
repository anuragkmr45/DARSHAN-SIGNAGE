# Fixed Forest player-owned states: developer verification

Branch: `codex/darshan-product-ui-redesign-20261103`. The 2026-11-04 visual approval covers all player-owned states; these renderer changes do not alter authority, pairing identity, offline recovery, authored media layout or live video pixels.

## Behavior and scope

- Pairing, recovery, security lock, no-assignment standby, missing-default unavailable and live-receiver unavailable screens now use cream/Forest in light mode and a dark Forest palette when the player OS requests dark mode. Player appearance remains fixed and does not depend on CMS site accents or network access. The normal playback and video stages stay black behind authored content.
- The standby SVG uses Forest tones and remains a local packaged asset. Production routine status and connectivity labels remain hidden over normal playback; emergency and lock state remain visible.

## Developer checks

- Player `npm run build`: passed. `npm run test:unit`: **542 passing**.
- Built renderer in cached Chromium: **1/1 end-to-end presentation journey passed**. Replacement OTP and hostname stayed visible, including 1440×900, 820×768, 390×844 and 640×360. The browser explicitly emulated light and dark OS preferences and checked pairing surface/OTP colors. It checked full-screen recovery, standby artwork and missing-default unavailable state, hidden routine badges, visible emergency and lock surfaces.
- Screenshots inspected: [desktop pairing](product-ui-player-prototype/production-pairing-forest-1440.png), [phone pairing](product-ui-player-prototype/production-pairing-forest-390.png), [desktop standby](product-ui-player-prototype/production-playback-no-overlays.png), [phone standby](product-ui-player-prototype/production-standby-390.png), [dark standby](product-ui-player-prototype/production-standby-dark-1440.png), [security lock](product-ui-player-prototype/production-security-lock.png) and [missing default](product-ui-player-prototype/production-default-unavailable.png). These are rendered fixture states, not live backend or physical-display acceptance.

## Remaining independent QA

Check the packaged Ubuntu and Windows players on representative displays, real pairing/recovery and network loss, live receiver failure, all resolutions/orientations, distance legibility, system dark mode, text scaling and accessibility. Verify authored images, PDFs, videos and live events remain pixel-correct and unobscured.
