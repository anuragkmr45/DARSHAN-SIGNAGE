# Player playback chrome and standby: developer verification (2026-11-04)

Candidate branch: `codex/darshan-product-ui-redesign-20261103`. This is local developer evidence, not independent QA or a released artifact.

## Behavior checked

- In production mode, connection/snapshot status, routine mode labels, and cached-backend banners do not cover normal playback. QA/dev mode retains its diagnostic presentation.
- Pairing, recovery, active emergency, and security-lock surfaces remain visible.
- When the resolved default source is `NONE`, the player displays a bundled SVG DARSHAN standby graphic and “No content assigned.” A configured source with no usable media displays “Content unavailable” instead. The standby renderer does not report a Media playback or create a proof-of-play event.
- The artwork is copied into `dist/renderer` by the ordinary build and included by the package's `dist/**/*` rule. No remote asset or font is required.

## Executed checks

| Check | Result | Limit |
| --- | --- | --- |
| Player `npm run build` | Passed | Builds renderer and copies SVG; no installer smoke. |
| Chromium pairing/presentation browser regression using the installed Playwright Chromium binary | Passed, 1/1 | Production default, cached-offline and soft-recovery labels absent; emergency and security-lock visible; standby SVG loaded and fit at 1440×900, 820×768 and 390×844; configured-but-missing default showed unavailable. Synthetic presentation snapshots, not a real backend. |
| Player `npm run test:unit` | Passed, 542/542 | Covers player service and renderer helpers; the artwork visibility itself is in the browser check. |

Rendered fixture captures: [1440px standby](product-ui-player-prototype/production-playback-no-overlays.png), [390px portrait standby](product-ui-player-prototype/production-standby-390.png), [assigned default unavailable](product-ui-player-prototype/production-default-unavailable.png), and [security lock](product-ui-player-prototype/production-security-lock.png). They contain no account or device secrets.

## Remaining QA

- Install the built candidate on representative Ubuntu and Windows machines. Check actual scheduled/default media, no-assignment standby, backend outage, emergency and lock transitions on physical displays, including portrait and high DPI.
- Confirm the exact packaged installer contains and loads `standby-artwork.svg` offline. Rehearse a missing/corrupt assigned default and confirm it never becomes the standby state.
- Verify no fabricated proof-of-play rows arise from standby against the running server, and obtain independent visual acceptance.
